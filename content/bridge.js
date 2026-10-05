// Runs in the page's MAIN world (document_start). Things only possible here:
//  1. Trigger YouTube's own SPA navigation (no full page reload).
//  2. Wrap the Media Session "nexttrack" handler so media keys / OS controls play
//     the next DaQueue video instead of YouTube's pick.
//  3. Redirect YouTube's native "Add to queue" actions (3-dot menu item, thumbnail
//     hover button) into DaQueue. Detection reads Polymer element data, which the
//     isolated content script can't see — so it works in any UI language.
// Talks to content.js via window.postMessage:
//   in:  { source: 'daqueue', type: 'navigate' | 'state' | 'getHeatmap' | 'seek' }
//   out: { source: 'daqueue-bridge', type: 'playNext' | 'add' | 'ended' | 'heatmap' }
(() => {
  if (window.__daqueueBridge) return;
  window.__daqueueBridge = true;

  const ID_RE = /^[\w-]{11}$/;
  let hasQueue = false;

  const post = (msg) => window.postMessage({ source: 'daqueue-bridge', ...msg }, location.origin);

  // ---------- 1. SPA navigation ----------

  function navigate(id) {
    const url = `/watch?v=${id}`;
    const app = document.querySelector('ytd-app');
    if (!app) {
      location.assign(url);
      return;
    }
    app.dispatchEvent(
      new CustomEvent('yt-navigate', {
        bubbles: true,
        composed: true,
        detail: {
          endpoint: {
            commandMetadata: {
              webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 },
            },
            watchEndpoint: { videoId: id },
          },
        },
      })
    );
  }

  // ---------- 2. Media keys ----------

  const originalSetHandler = window.MediaSession?.prototype.setActionHandler;
  let nativeNext = null;

  function queueAwareNext(details) {
    if (hasQueue) post({ type: 'playNext' });
    else nativeNext?.(details);
  }

  function registerNext() {
    if (!originalSetHandler || !navigator.mediaSession) return;
    // Keep the OS "next" control enabled whenever either DaQueue or YouTube can handle it.
    const handler = hasQueue || nativeNext ? queueAwareNext : null;
    try {
      originalSetHandler.call(navigator.mediaSession, 'nexttrack', handler);
    } catch {
      /* action unsupported */
    }
  }

  if (originalSetHandler) {
    MediaSession.prototype.setActionHandler = function (action, handler) {
      if (action !== 'nexttrack') return originalSetHandler.call(this, action, handler);
      nativeNext = handler;
      registerNext();
    };
  }

  // ---------- 2b. End-of-video detection ----------
  // Seeking to the end (dragging the scrubber, arrow keys, End key) often never fires
  // the <video> "ended" event — the player jumps straight to its own ENDED state.
  // The player API's onStateChange (0 = ENDED) is reliable however the end is reached.

  const hookedPlayers = new WeakSet();
  function hookPlayer() {
    const player = document.querySelector('ytd-watch-flexy #movie_player');
    if (!player || hookedPlayers.has(player) || typeof player.getPlayerState !== 'function') return;
    hookedPlayers.add(player);
    player.addEventListener('onStateChange', (state) => {
      if (state !== 0) return;
      post({ type: 'ended', videoId: player.getVideoData?.()?.video_id || null });
    });
  }
  for (const type of ['yt-navigate-finish', 'yt-player-updated']) document.addEventListener(type, hookPlayer);
  setInterval(hookPlayer, 2000); // cheap no-op once hooked; covers late player init

  // ---------- 2c. "Most replayed" heatmap (for Jump ahead) ----------
  // Lives in the watch-page data: ytInitialData on first load, the yt-navigate-finish
  // response after SPA navigations. Only readable from the main world.

  let lastNavResponse = null;
  document.addEventListener('yt-navigate-finish', (e) => {
    lastNavResponse = e.detail?.response?.response || null;
  });

  function heatmapFor(id) {
    for (const data of [lastNavResponse, window.ytInitialData]) {
      if (!data) continue;
      const vid = data.currentVideoEndpoint?.watchEndpoint?.videoId;
      if (vid && vid !== id) continue;
      for (const m of data.frameworkUpdates?.entityBatchUpdate?.mutations || []) {
        const list = m?.payload?.macroMarkersListEntity?.markersList;
        if (list?.markerType !== 'MARKER_TYPE_HEATMAP' || !Array.isArray(list.markers)) continue;
        return list.markers.map((k) => ({
          start: +k.startMillis / 1000,
          dur: +k.durationMillis / 1000,
          v: +k.intensityScoreNormalized || 0,
        }));
      }
    }
    return [];
  }

  // ---------- 3. Native "Add to queue" → DaQueue ----------

  // Elements that can carry a native add-to-queue command. Only the *closest* one is
  // inspected: containers (cards, menus) also hold the command in their data and
  // would otherwise hijack unrelated clicks.
  const ACTION_EL =
    'ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, yt-list-item-view-model, ' +
    'ytd-thumbnail-overlay-toggle-button-renderer, toggle-button-view-model, button-view-model';
  const RENDERER =
    'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ' +
    'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model';

  function findQueueCommand(obj, depth = 0, seen = new Set()) {
    if (!obj || typeof obj !== 'object' || depth > 12 || seen.has(obj) || obj instanceof Node) return null;
    seen.add(obj);
    const cmd = obj.addToPlaylistCommand;
    if (cmd?.listType === 'PLAYLIST_EDIT_LIST_TYPE_QUEUE') return cmd;
    for (const key of Object.keys(obj)) {
      const found = findQueueCommand(obj[key], depth + 1, seen);
      if (found) return found;
    }
    return null;
  }

  function elementData(el) {
    return [el.data, el.__data?.data, el.polymerController?.data, el.componentProps, el.props];
  }

  // Card whose 3-dot menu was opened last — fallback video id for menu items whose
  // data doesn't carry one.
  let lastCardVideoId = null;
  function cardVideoId(node) {
    const href = node?.closest?.(RENDERER)?.querySelector('a[href*="/watch?v="]')?.href;
    try {
      const id = href && new URL(href).searchParams.get('v');
      return ID_RE.test(id || '') ? id : null;
    } catch {
      return null;
    }
  }

  // Returns the video id if this event targets a native add-to-queue control, else null.
  function nativeQueueTarget(target) {
    const el = target?.closest?.(ACTION_EL);
    if (!el || el.closest('#daqueue-panel, .daq-thumb-actions')) return null;
    for (const data of elementData(el)) {
      const cmd = findQueueCommand(data);
      if (cmd) return ID_RE.test(cmd.videoId || '') ? cmd.videoId : cardVideoId(el) || lastCardVideoId;
    }
    // Language-dependent fallback for markup whose data we can't read.
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (/^add to queue$/i.test(label)) return cardVideoId(el) || lastCardVideoId;
    return null;
  }

  function closeMenu(target) {
    const dropdown = target.closest?.('tp-yt-iron-dropdown');
    if (dropdown?.close) dropdown.close();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }

  // Window-capture runs before YouTube's own (document-level Polymer gesture) handlers.
  // Block the whole press sequence so YouTube never sees a tap; act only on click.
  function interceptNativeQueue(e) {
    if (e.type === 'pointerdown') {
      const id = cardVideoId(e.target);
      if (id) lastCardVideoId = id;
    }
    const id = nativeQueueTarget(e.target);
    if (!id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') {
      post({ type: 'add', videoId: id });
      closeMenu(e.target);
    }
  }
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'tap']) {
    window.addEventListener(type, interceptNativeQueue, true);
  }

  // ---------- messages from content script ----------

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'daqueue') return;
    if (e.data.type === 'navigate' && ID_RE.test(e.data.videoId || '')) {
      navigate(e.data.videoId);
    } else if (e.data.type === 'seek' && Number.isFinite(e.data.time)) {
      // Seek the way YouTube's own UI does; poking <video>.currentTime can stall its streaming.
      const player = document.querySelector('ytd-watch-flexy #movie_player');
      if (typeof player?.seekTo === 'function') player.seekTo(e.data.time, true);
      else if (player?.querySelector('video')) player.querySelector('video').currentTime = e.data.time;
    } else if (e.data.type === 'getHeatmap' && ID_RE.test(e.data.videoId || '')) {
      post({ type: 'heatmap', videoId: e.data.videoId, markers: heatmapFor(e.data.videoId) });
    } else if (e.data.type === 'state') {
      const next = !!e.data.hasQueue;
      if (next !== hasQueue) {
        hasQueue = next;
        registerNext();
      }
    }
  });
})();
