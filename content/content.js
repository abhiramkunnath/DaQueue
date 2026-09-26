// DaQueue content script (isolated world). The queue UI itself lives in
// ui/queue-view.js (shared with the toolbar popup); this file does the YouTube parts:
// - "add to queue" / "play next" buttons on video thumbnails
// - mounts the queue view above recommendations on watch pages
// - auto-advance, and taking over YouTube's next button / Shift+N / media keys
// - answers the popup (now playing, play/pause, navigate) and records YouTube's theme
(() => {
  'use strict';
  if (window.__daqueueLoaded) return;
  window.__daqueueLoaded = true;

  const { el, icon, toast, createQueueView } = window.DaQueueUI;

  const ID_RE = /^[\w-]{11}$/;
  const DEFAULT_SETTINGS = { autoAdvance: true, collapsed: false };
  // YouTube markup changes often — keep every selector here.
  const SEL = {
    thumbLink: 'a[href*="/watch?v="]',
    sidebar: 'ytd-watch-flexy #secondary-inner',
    watchPlayer: 'ytd-watch-flexy #movie_player',
    nextButton: '#movie_player .ytp-next-button',
    watchTitle: 'ytd-watch-metadata h1',
    watchChannel: 'ytd-watch-metadata #owner ytd-channel-name a, ytd-watch-metadata #channel-name a',
    renderer:
      'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ' +
      'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model',
    rendererTitle: '#video-title, h3',
  };

  let queue = [];
  let settings = { ...DEFAULT_SETTINGS };

  // ---------- helpers ----------

  function parseId(href) {
    try {
      const id = new URL(href, location.origin).searchParams.get('v');
      return ID_RE.test(id || '') ? id : null;
    } catch {
      return null;
    }
  }

  function currentVideoId() {
    return location.pathname === '/watch' ? parseId(location.href) : null;
  }

  function watchVideo() {
    return document.querySelector(`${SEL.watchPlayer} video`);
  }

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (err) {
      if (String(err).includes('context invalidated')) toast('DaQueue was updated — reload this tab');
      else console.warn('[DaQueue]', err);
      return null;
    }
  }

  // ---------- queue actions ----------

  // next=true → front of the queue ("play next").
  async function addVideo(id, hint = {}, next = false) {
    if (!id) return;
    const res = await send({ type: 'add', id, hint, next });
    if (res?.text) toast(res.text);
  }

  function navigate(id) {
    window.postMessage({ source: 'daqueue', type: 'navigate', videoId: id }, location.origin);
    // Fallback: if YouTube's SPA router ignored us, do a normal page load.
    setTimeout(() => {
      if (currentVideoId() !== id) location.assign(`/watch?v=${id}`);
    }, 3000);
  }

  async function playNext() {
    const item = await send({ type: 'next' });
    if (item?.id) navigate(item.id);
    else toast('Queue is empty');
  }

  async function playItem(id) {
    const item = await send({ type: 'take', id });
    if (item?.id) navigate(item.id);
  }

  // ---------- thumbnail buttons ----------

  function scanThumbnails() {
    for (const link of document.querySelectorAll(SEL.thumbLink)) {
      if (link.dataset.daq || !link.querySelector('img')) continue;
      link.dataset.daq = '1';
      link.classList.add('daq-thumb-host');
      // Stacked like YouTube's own hover buttons; labels slide out on hover.
      const thumbBtn = (action, iconName, label) =>
        el('button', { class: 'daq-add-btn', type: 'button', 'data-action': action, 'aria-label': label }, [
          icon(iconName),
          el('span', { class: 'daq-add-label', text: label }),
        ]);
      const actions = el('div', { class: 'daq-thumb-actions' }, [
        thumbBtn('add', 'queueAdd', 'Add to queue'),
        thumbBtn('next', 'playNext', 'Play next'),
      ]);
      // Swallow every click inside the stack (incl. the gap) so the thumbnail link never fires.
      actions.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        const btn = e.target.closest('.daq-add-btn');
        if (!btn) return;
        // Read href at click time — YouTube recycles renderer DOM nodes.
        const renderer = link.closest(SEL.renderer);
        const title = renderer?.querySelector(SEL.rendererTitle)?.textContent?.trim();
        addVideo(parseId(link.href), { title }, btn.dataset.action === 'next');
      });
      link.append(actions);
    }
  }

  // ---------- panel (shared queue view, mounted in YouTube's sidebar) ----------

  let view = null;

  // "Now playing" reflects whatever the watch page shows, queued or not. Title/channel
  // come from the page DOM, which YouTube fills in shortly after navigation — this is
  // re-read on every DOM-change tick; the view only re-renders on actual change.
  function getNowPlaying() {
    const id = currentVideoId();
    if (!id) return null;
    const title =
      document.querySelector(SEL.watchTitle)?.textContent?.trim() ||
      document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '');
    const channel = document.querySelector(SEL.watchChannel)?.textContent?.trim() || '';
    return { id, title, channel };
  }

  function isPaused() {
    const video = watchVideo();
    return !video || video.paused;
  }

  function syncPaused() {
    view?.setPaused(isPaused());
  }

  function ensurePanel() {
    if (location.pathname !== '/watch') return;
    const host = document.querySelector(SEL.sidebar);
    if (!host) return;
    if (!view) {
      view = createQueueView({
        mode: 'panel',
        send,
        onPlayItem: playItem,
        onPlayNext: playNext,
        onAddCurrent: () => {
          const now = getNowPlaying();
          if (now) addVideo(now.id, { title: now.title, channel: now.channel });
        },
      });
      view.setState({ queue, settings });
    }
    if (host.firstElementChild !== view.el) host.prepend(view.el);
    view.setNowPlaying(getNowPlaying());
    syncPaused();
  }

  // ---------- auto-advance ----------

  // Several end signals feed one guarded check, since no single one is reliable:
  //  - player onStateChange ENDED (via bridge.js) — covers seeking to the end
  //  - native <video> "ended" — natural end
  //  - a seek that lands within END_SLACK of the end — backup if both above are missed
  // advancedFor makes sure each video advances at most once.
  const END_SLACK = 0.3; // seconds
  let advancedFor = null;

  function maybeAdvance() {
    if (!settings.autoAdvance || !queue.length || location.pathname !== '/watch') return;
    const player = document.querySelector(SEL.watchPlayer);
    if (!player || player.classList.contains('ad-showing')) return;
    const vid = currentVideoId();
    if (!vid || advancedFor === vid) return;
    advancedFor = vid;
    playNext();
  }

  function isWatchVideo(target) {
    return !!document.querySelector(SEL.watchPlayer)?.contains(target);
  }

  // Media events don't bubble, but capture on document sees them.
  document.addEventListener('ended', (e) => isWatchVideo(e.target) && maybeAdvance(), true);
  document.addEventListener(
    'seeked',
    (e) => {
      const video = e.target;
      if (!isWatchVideo(video) || !video.duration) return;
      if (video.ended || video.duration - video.currentTime <= END_SLACK) maybeAdvance();
    },
    true
  );

  for (const type of ['play', 'pause', 'emptied']) document.addEventListener(type, syncPaused, true);

  // ---------- take over YouTube's "next" (only while the queue has videos) ----------

  // Player ⏭ button. Window-capture runs before the player's own handlers.
  window.addEventListener(
    'click',
    (e) => {
      if (!queue.length || !e.target.closest?.(SEL.nextButton)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      playNext();
    },
    true
  );

  // Shift+N — YouTube's own "next video" shortcut.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!queue.length || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.key.toLowerCase() !== 'n') return;
      if (e.target.isContentEditable || e.target.closest?.('input, textarea, select')) return;
      if (!document.querySelector(SEL.watchPlayer) || location.pathname !== '/watch') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      playNext();
    },
    true
  );

  // bridge.js (main world) handles media keys + native "Add to queue" and reports back.
  function syncBridge() {
    window.postMessage({ source: 'daqueue', type: 'state', hasQueue: queue.length > 0 }, location.origin);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'daqueue-bridge') return;
    if (e.data.type === 'playNext') playNext();
    else if (e.data.type === 'ended' && (!e.data.videoId || e.data.videoId === currentVideoId())) maybeAdvance();
    else if (e.data.type === 'add' && ID_RE.test(e.data.videoId || '')) addVideo(e.data.videoId);
  });

  // ---------- theme: remember YouTube's light/dark so the popup can match it ----------

  let lastTheme = null;
  function recordTheme() {
    const theme = document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
    if (theme === lastTheme) return;
    lastTheme = theme;
    chrome.storage.local.set({ ytTheme: theme }).catch(() => {});
  }
  new MutationObserver(recordTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
  recordTheme();

  // ---------- state sync ----------

  // Incognito gets its own in-memory queue (storage.session); settings are shared.
  const QUEUE_AREA = chrome.extension.inIncognitoContext ? 'session' : 'local';

  function pushState() {
    syncBridge();
    view?.setState({ queue, settings });
  }

  async function loadState(retries = 3) {
    try {
      const [{ queue: q = [] }, { settings: s }] = await Promise.all([
        chrome.storage[QUEUE_AREA].get('queue'),
        chrome.storage.local.get('settings'),
      ]);
      queue = q;
      settings = { ...DEFAULT_SETTINGS, ...s };
      pushState();
    } catch (err) {
      // storage.session access is granted by the service worker at startup — may lag on first load.
      if (retries > 0) setTimeout(() => loadState(retries - 1), 1000);
      else console.warn('[DaQueue]', err);
    }
  }
  loadState();

  chrome.storage.onChanged.addListener((changes, area) => {
    let changed = false;
    if (area === QUEUE_AREA && changes.queue) {
      queue = changes.queue.newValue || [];
      changed = true;
    }
    if (area === 'local' && changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      changed = true;
    }
    if (changed) pushState();
  });

  // ---------- messages from background / popup ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'toast':
        toast(msg.text);
        break;
      case 'playNext':
        playNext();
        break;
      case 'navigate':
        if (ID_RE.test(msg.id || '')) navigate(msg.id);
        break;
      case 'getNowPlaying': {
        const now = getNowPlaying();
        sendResponse(now ? { ...now, paused: isPaused() } : null);
        break;
      }
      case 'togglePlay': {
        const video = watchVideo();
        if (video?.paused) video.play().catch(() => {});
        else video?.pause();
        sendResponse({ paused: isPaused() });
        break;
      }
    }
  });

  // ---------- DOM watching ----------

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scanThumbnails();
      ensurePanel();
    }, 400);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', () => {
    advancedFor = null;
    schedule();
  });
  schedule();
})();
