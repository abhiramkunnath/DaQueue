// DaQueue v2: segment skipping + Jump ahead (content script, isolated world).
// - Segments (sponsors, intros, …) come from SponsorBlock via the background worker.
// - Per category: auto-skip (with Undo), offer a "Skip" button, or ignore (see ui/skip-config.js).
// - Coloured marks on the progress bar show where segments are.
// - Jump ahead: SponsorBlock highlight, else the next "most replayed" peak (heatmap via bridge.js).
// - Seeking into a segment yourself means you want to watch it: it won't be auto-skipped.
// - Steps aside if the SponsorBlock extension is installed, to avoid double skipping.
(() => {
  'use strict';
  if (window.__daqueueSkipLoaded) return;
  window.__daqueueSkipLoaded = true;

  const SK = window.DaQueueSkip;
  const { el, icon } = window.DaQueueUI;

  const ID_RE = /^[\w-]{11}$/;
  const SEL = {
    player: 'ytd-watch-flexy #movie_player',
    progress: '.ytp-progress-bar .ytp-progress-list, .ytp-progress-bar',
    // YouTube overlays in the bottom corners (fullscreen like/dislike/comment row, product badges).
    // Our buttons and notice are lifted above whatever of these is showing.
    obstaclesRight: '.ytp-overlay-bottom-right, .ytp-fullscreen-quick-actions',
    obstaclesLeft: '.ytp-overlay-bottom-left, .ytp-suggested-action-badge',
    // Elements the SponsorBlock extension injects; if present we don't skip or draw marks.
    sponsorBlock: '#previewbar, .sponsorSkipButton, #sponsorblock-skip-notice, .sponsorSkipObject, [id^="sponsorBlock"]',
  };
  const STALE_TOLERANCE = 3; // s — segments submitted for a different cut of the video are ignored
  const END_GUARD = 0.25; // s — don't re-trigger right at a segment's end
  const NOTICE_MS = 5000;
  const JUMP_MIN_AHEAD = 10; // s — Jump ahead targets must be at least this far ahead

  let cfg = SK.resolve();
  let videoId = null;
  let segments = [];
  let heat = [];
  let heatRetried = false;
  const allowed = new Set(); // segment UUIDs the user chose to watch
  let ourSeek = false;

  const player = () => document.querySelector(SEL.player);
  const video = () => player()?.querySelector('video');
  const isAd = () => !!player()?.classList.contains('ad-showing');
  const sponsorBlockInstalled = () => !!document.querySelector(SEL.sponsorBlock);
  const isWatchVideo = (target) => !!player()?.contains(target);

  function currentId() {
    if (location.pathname !== '/watch') return null;
    const id = new URLSearchParams(location.search).get('v');
    return ID_RE.test(id || '') ? id : null;
  }

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      return null; // extension reloaded — content.js already tells the user to refresh
    }
  }

  function mode(seg) {
    if (!cfg.enabled || sponsorBlockInstalled()) return 'off';
    return cfg.categories[seg.category] || 'off';
  }

  // Segments submitted against a different duration (re-uploads, edits) would skip the wrong part.
  function fresh(seg) {
    const d = video()?.duration;
    return !seg.videoDuration || !d || !isFinite(d) || Math.abs(seg.videoDuration - d) <= STALE_TOLERANCE;
  }

  const skippable = () => segments.filter((s) => s.actionType === 'skip' && s.end > s.start && fresh(s));
  const labelOf = (seg) => SK.category(seg.category)?.label || 'segment';

  // ---------- player overlay: Skip / Jump ahead buttons + "Skipped" notice ----------

  let actionsEl, skipBtn, jumpBtn, noticeEl, noticeTimer, markersEl;
  let markersEmpty = false; // last render had nothing to draw
  let shownSkip = null;
  let shownJumpTime = null;

  function ensureUI() {
    const p = player();
    if (!p) return false;
    if (!actionsEl) {
      skipBtn = el('button', { class: 'daq-skip-btn', type: 'button' });
      jumpBtn = el('button', { class: 'daq-skip-btn daq-jump-btn', type: 'button' });
      actionsEl = el('div', { class: 'daq-player-actions' }, [jumpBtn, skipBtn]);
      noticeEl = el('div', { class: 'daq-skip-notice', role: 'status' });
      skipBtn.hidden = jumpBtn.hidden = noticeEl.hidden = true;
      // Keep clicks from reaching the player (which would toggle play/pause or fullscreen).
      for (const node of [actionsEl, noticeEl]) {
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) {
          node.addEventListener(type, (e) => e.stopPropagation());
        }
      }
      skipBtn.addEventListener('click', () => shownSkip && skip(shownSkip));
      jumpBtn.addEventListener('click', () => shownJumpTime != null && seek(shownJumpTime));
    }
    if (actionsEl.parentElement !== p) p.append(actionsEl, noticeEl);
    return true;
  }

  // Keep clear of YouTube's own bottom-corner overlays (they change with fullscreen and per video).
  const OVERLAY_GAP = 12;
  function layoutOverlay() {
    const p = player();
    if (!p || !actionsEl) return;
    const pr = p.getBoundingClientRect();
    const base = p.classList.contains('ytp-big-mode') ? 100 : 72; // above the control bar
    const lift = (selector) => {
      let bottom = base;
      for (const node of p.querySelectorAll(selector)) {
        const r = node.getBoundingClientRect();
        if (r.width && r.height) bottom = Math.max(bottom, pr.bottom - r.top + OVERLAY_GAP);
      }
      return `${Math.round(bottom)}px`;
    };
    actionsEl.style.bottom = lift(SEL.obstaclesRight);
    noticeEl.style.bottom = lift(SEL.obstaclesLeft);
  }

  function showSkip(seg) {
    if (!skipBtn || seg === shownSkip) return;
    shownSkip = seg;
    skipBtn.hidden = !seg;
    if (seg) skipBtn.replaceChildren(el('span', { text: `Skip ${labelOf(seg).toLowerCase()}` }), icon('next'));
  }

  function showJump(target) {
    if (!jumpBtn) return;
    const time = target ? target.time : null;
    if (time === shownJumpTime) return;
    shownJumpTime = time;
    jumpBtn.hidden = !target;
    if (target) jumpBtn.replaceChildren(el('span', { text: target.label }), icon('fastForward'));
  }

  function hideNotice() {
    clearTimeout(noticeTimer);
    if (noticeEl) noticeEl.hidden = true;
  }

  function showNotice(seg) {
    if (!noticeEl) return;
    const undo = el('button', { class: 'daq-skip-undo', type: 'button', text: 'Undo' });
    undo.addEventListener('click', () => {
      allowed.add(seg.uuid);
      seek(seg.start);
      hideNotice();
    });
    noticeEl.replaceChildren(el('span', { text: `Skipped ${labelOf(seg).toLowerCase()}` }), undo);
    noticeEl.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(hideNotice, NOTICE_MS);
  }

  // ---------- seeking ----------

  // Routed through bridge.js → player.seekTo(), the same path YouTube's own UI uses.
  function seek(time) {
    if (!video()) return;
    ourSeek = true;
    window.postMessage({ source: 'daqueue', type: 'seek', time }, location.origin);
  }

  function skip(seg) {
    const v = video();
    if (!v) return;
    // Skipping an outro straight to the end lets DaQueue's auto-advance take over.
    seek(isFinite(v.duration) ? Math.min(seg.end, v.duration) : seg.end);
    showSkip(null);
    showNotice(seg);
  }

  // ---------- Jump ahead ----------

  function jumpTarget(t) {
    const highlight = segments.find((s) => s.actionType === 'poi' && fresh(s) && s.start > t + 5);
    if (highlight) return { time: highlight.start, label: 'Jump to highlight' };
    if (heat.length < 3) return null;
    const here = heat.find((m) => t >= m.start && t < m.start + m.dur)?.v ?? 0;
    for (let i = 1; i < heat.length - 1; i++) {
      const m = heat[i];
      if (m.start < t + JUMP_MIN_AHEAD) continue;
      const isPeak = m.v >= heat[i - 1].v && m.v >= heat[i + 1].v;
      if (isPeak && m.v >= 0.5 && m.v >= here + 0.15) return { time: m.start, label: 'Jump ahead' };
    }
    return null;
  }

  // ---------- main loop (driven by timeupdate, ~4x/second) ----------

  function tick() {
    if (currentId() !== videoId) load();
    // YouTube rebuilds the progress bar (e.g. when chapters load), dropping our marks.
    if (segments.length && (markersEl ? !markersEl.isConnected : !markersEmpty)) renderMarkers();
    const v = video();
    if (!v || !videoId || isAd() || !ensureUI()) {
      showSkip(null);
      showJump(null);
      return;
    }
    layoutOverlay();
    const t = v.currentTime;
    let offer = null;
    for (const s of skippable()) {
      if (t < s.start || t >= s.end - END_GUARD || allowed.has(s.uuid)) continue;
      const m = mode(s);
      if (m === 'auto') {
        skip(s);
        return;
      }
      if (m === 'button' && !offer) offer = s;
    }
    showSkip(offer);
    showJump(cfg.jumpAhead ? jumpTarget(t) : null);
  }

  // ---------- progress-bar markers ----------

  function renderMarkers() {
    markersEl?.remove();
    markersEl = null;
    markersEmpty = false;
    const bar = player()?.querySelector(SEL.progress);
    const d = video()?.duration;
    if (!bar || !d || !isFinite(d)) return;
    const spans = [];
    for (const s of segments) {
      const cat = SK.category(s.category);
      if (!cat || !fresh(s)) continue;
      const isPoi = s.actionType === 'poi';
      if (isPoi ? !cfg.jumpAhead || !cfg.enabled || sponsorBlockInstalled() : mode(s) === 'off') continue;
      const span = el('span', { class: `daq-seg${isPoi ? ' daq-seg-poi' : ''}`, title: cat.label });
      span.style.left = `${(s.start / d) * 100}%`;
      if (!isPoi) span.style.width = `${((s.end - s.start) / d) * 100}%`;
      span.style.background = cat.color;
      spans.push(span);
    }
    markersEmpty = !spans.length;
    if (markersEmpty) return;
    markersEl = el('div', { class: 'daq-seg-markers' }, spans);
    bar.append(markersEl);
  }

  // ---------- per-video loading ----------

  function requestHeatmap(id) {
    window.postMessage({ source: 'daqueue', type: 'getHeatmap', videoId: id }, location.origin);
  }

  const wanted = () => cfg.enabled || cfg.jumpAhead;

  async function load() {
    const id = currentId();
    if (id === videoId) return;
    videoId = id;
    segments = [];
    heat = [];
    heatRetried = false;
    allowed.clear();
    markersEl?.remove();
    markersEl = null;
    markersEmpty = false;
    showSkip(null);
    showJump(null);
    hideNotice();
    if (!id || !wanted()) return; // both features off → no SponsorBlock request at all
    requestHeatmap(id);
    const result = await send({ type: 'segments', id });
    if (videoId !== id) return; // navigated away meanwhile
    segments = Array.isArray(result) ? result : [];
    renderMarkers();
    tick();
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'daqueue-bridge' || e.data.type !== 'heatmap') return;
    if (e.data.videoId !== videoId) return;
    heat = Array.isArray(e.data.markers) ? e.data.markers : [];
    // Page data can land after navigation finishes — ask once more.
    if (!heat.length && !heatRetried) {
      heatRetried = true;
      const id = videoId;
      setTimeout(() => videoId === id && requestHeatmap(id), 2000);
    }
  });

  // ---------- events ----------

  document.addEventListener('timeupdate', (e) => isWatchVideo(e.target) && tick(), true);
  document.addEventListener(
    'seeked',
    (e) => {
      if (!isWatchVideo(e.target)) return;
      if (ourSeek) {
        ourSeek = false;
        return;
      }
      // The user sought into a segment: let it play.
      const t = e.target.currentTime;
      for (const s of skippable()) if (t >= s.start && t < s.end) allowed.add(s.uuid);
      tick();
    },
    true
  );
  for (const type of ['loadedmetadata', 'durationchange']) {
    document.addEventListener(type, (e) => isWatchVideo(e.target) && renderMarkers(), true);
  }
  document.addEventListener('yt-navigate-finish', load);
  // Fullscreen swaps in YouTube's quick-action row; re-place once its layout has settled.
  document.addEventListener('fullscreenchange', () => setTimeout(layoutOverlay, 300));
  window.addEventListener('resize', layoutOverlay);

  // Settings first, so a user who turned everything off never triggers a lookup.
  chrome.storage.local.get('settings').then(({ settings }) => {
    cfg = SK.resolve(settings);
    load();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const wasWanted = wanted();
    cfg = SK.resolve(changes.settings.newValue);
    if (!wasWanted && wanted()) videoId = null; // re-enabled: fetch for the current video
    renderMarkers();
    shownSkip = undefined; // force the buttons to re-evaluate
    shownJumpTime = undefined;
    tick();
  });
})();
