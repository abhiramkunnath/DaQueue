// Toolbar popup: the same queue view as the in-page panel, usable from any tab.
// - Queue + settings sync live through chrome.storage (same as YouTube tabs).
// - Incognito: the popup always runs as a normal extension page, so it checks its
//   window and passes `incognito` along with each message to the background.
// - Playing: in the active tab if it's YouTube (SPA navigation), else a new tab.
// - Now playing + mini controls come from the active YouTube tab's content script.
(async () => {
  'use strict';

  const { el, icon, toast, createQueueView } = window.DaQueueUI;
  const YT = 'https://www.youtube.com';
  const DEFAULT_SETTINGS = { autoAdvance: true, collapsed: false };

  // ---- theme: match YouTube's last-seen theme, else the system ----
  function applyTheme(ytTheme) {
    const dark = ytTheme ? ytTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.toggleAttribute('dark', dark);
  }
  applyTheme((await chrome.storage.local.get('ytTheme')).ytTheme);

  // ---- context ----
  const win = await chrome.windows.getCurrent();
  const incognito = !!win.incognito;
  const queueArea = incognito ? 'session' : 'local';
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ytTab = activeTab?.url?.startsWith(`${YT}/`) ? activeTab : null;

  const send = (msg) => chrome.runtime.sendMessage({ ...msg, incognito }).catch(() => null);
  const tabMessage = (msg) => (ytTab ? chrome.tabs.sendMessage(ytTab.id, msg).catch(() => null) : Promise.resolve(null));

  async function play(id) {
    const url = `${YT}/watch?v=${id}`;
    if (!ytTab) {
      await chrome.tabs.create({ url, windowId: win.id });
      return;
    }
    // Content script may be missing (tab not reloaded since install) → plain navigation.
    const delivered = await chrome.tabs
      .sendMessage(ytTab.id, { type: 'navigate', id })
      .then(() => true, () => false);
    if (!delivered) await chrome.tabs.update(ytTab.id, { url });
  }

  // ---- view ----
  const openYouTube = el('button', { class: 'daq-pill', type: 'button' }, [icon('play'), el('span', { text: 'Open YouTube' })]);
  openYouTube.addEventListener('click', () => {
    chrome.tabs.create({ url: `${YT}/`, windowId: win.id });
    window.close();
  });

  let now = null;

  const view = createQueueView({
    mode: 'popup',
    send,
    emptyExtra: openYouTube,
    async onPlayItem(id) {
      const item = await send({ type: 'take', id });
      if (item?.id) play(item.id);
    },
    async onPlayNext() {
      const item = await send({ type: 'next' });
      if (item?.id) play(item.id);
      else toast('Queue is empty');
    },
    async onAddCurrent() {
      if (!now) return;
      const res = await send({ type: 'add', id: now.id, hint: { title: now.title, channel: now.channel } });
      if (res?.text) toast(res.text);
    },
    async onTogglePlay() {
      const res = await tabMessage({ type: 'togglePlay' });
      if (res) view.setPaused(res.paused);
    },
  });
  // ---- tabs: Queue | Skipping ----
  // YouTube channel-page style: text tabs with a sliding underline. On switch the panes
  // slide/cross-fade and the popup height animates between the two panes' natural sizes.
  const skipUI = buildSkipSettings((skip) => send({ type: 'setSettings', patch: { skip } }));
  const TABS = [['queue', 'Queue'], ['skip', 'Skipping']];
  const tabBar = el('div', { class: 'daq-tabs', role: 'tablist' });
  const indicator = el('div', { class: 'daq-tab-indicator', 'aria-hidden': 'true' });
  const panes = {
    queue: el('div', { class: 'daq-pane', role: 'tabpanel' }, view.el),
    skip: el('div', { class: 'daq-pane', role: 'tabpanel' }, skipUI.el),
  };
  const panesEl = el('div', { class: 'daq-panes' }, [panes.queue, panes.skip]);
  for (const [id, label] of TABS) {
    const tab = el('button', { class: 'daq-tab', type: 'button', role: 'tab', 'data-tab': id, text: label });
    tab.addEventListener('click', () => selectTab(id));
    tabBar.append(tab);
  }
  tabBar.append(indicator);

  const SLIDE = 24; // px
  const DURATION = 260;
  const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let currentTab = null;
  let settle = null; // finishes an in-flight switch immediately

  function placeIndicator(animate) {
    const tab = tabBar.querySelector('.daq-tab[aria-selected="true"]');
    if (!tab) return;
    const inset = 24;
    if (!animate) indicator.style.transition = 'none';
    indicator.style.width = `${tab.offsetWidth - inset * 2}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft + inset}px)`;
    if (!animate) {
      void indicator.offsetWidth;
      indicator.style.transition = '';
    }
  }

  function selectTab(id) {
    if (id === currentTab) return;
    settle?.();
    const prevId = currentTab;
    currentTab = id;
    try {
      localStorage.setItem('daq-tab', id);
    } catch {
      /* storage unavailable: just don't remember the tab */
    }
    for (const tab of tabBar.querySelectorAll('.daq-tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === id));
    placeIndicator(!!prevId && !reduceMotion);

    const next = panes[id];
    const prev = prevId ? panes[prevId] : null;
    if (!prev || reduceMotion) {
      for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== id;
      return;
    }

    const order = TABS.map(([t]) => t);
    const dir = Math.sign(order.indexOf(id) - order.indexOf(prevId));
    panesEl.classList.add('daq-switching');
    const fromHeight = panesEl.offsetHeight;
    // Outgoing pane becomes an overlay; the incoming one now defines the layout.
    prev.classList.add('daq-leaving');
    next.hidden = false;
    const toHeight = panesEl.offsetHeight;

    const timing = { duration: DURATION, easing: EASE };
    const anims = [
      next.animate([{ opacity: 0, transform: `translateX(${dir * SLIDE}px)` }, { opacity: 1, transform: 'none' }], timing),
      prev.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * SLIDE}px)` }], timing),
    ];
    if (fromHeight !== toHeight) {
      // Chrome resizes the popup window to follow the body, so this grows/shrinks it smoothly.
      anims.push(panesEl.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], timing));
    }

    let done = false;
    settle = () => {
      if (done) return;
      done = true;
      settle = null;
      for (const a of anims) a.cancel();
      prev.classList.remove('daq-leaving');
      prev.hidden = true;
      panesEl.classList.remove('daq-switching');
    };
    Promise.all(anims.map((a) => a.finished)).then(() => settle?.(), () => {});
  }

  document.body.classList.add('daq-scope');
  document.body.append(tabBar, panesEl);
  let startTab = 'queue';
  try {
    if (panes[localStorage.getItem('daq-tab')]) startTab = localStorage.getItem('daq-tab');
  } catch {
    /* default to the queue */
  }
  selectTab(startTab);
  // Layout (and fonts) settle after first paint; re-place the underline without animating.
  requestAnimationFrame(() => placeIndicator(false));

  // ---- state sync ----
  const [{ queue = [] }, { settings }] = await Promise.all([
    chrome.storage[queueArea].get('queue'),
    chrome.storage.local.get('settings'),
  ]);
  view.setState({ queue, settings: { ...DEFAULT_SETTINGS, ...settings } });
  skipUI.render(window.DaQueueSkip.resolve(settings));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === queueArea && changes.queue) view.setState({ queue: changes.queue.newValue || [] });
    if (area === 'local' && changes.settings) {
      view.setState({ settings: { ...DEFAULT_SETTINGS, ...changes.settings.newValue } });
      skipUI.render(window.DaQueueSkip.resolve(changes.settings.newValue));
    }
    if (area === 'local' && changes.ytTheme) applyTheme(changes.ytTheme.newValue);
  });

  // ---- now playing: poll the active YouTube tab while the popup is open ----
  async function pollNow() {
    const res = await tabMessage({ type: 'getNowPlaying' });
    now = res?.id ? { id: res.id, title: res.title, channel: res.channel } : null;
    view.setNowPlaying(now);
    if (res) view.setPaused(res.paused);
  }
  if (ytTab) {
    pollNow();
    setInterval(pollNow, 1000);
  }

  // ---- Skipping tab ----
  function buildSkipSettings(save) {
    const SK = window.DaQueueSkip;
    let cfg = SK.resolve();
    const commit = (next) => {
      cfg = next;
      render(cfg);
      save(cfg);
    };

    const master = el('input', { type: 'checkbox' });
    master.addEventListener('change', () => commit({ ...cfg, enabled: master.checked }));
    const header = el('div', { class: 'daq-header' }, [
      el('div', { class: 'daq-heading' }, [
        el('div', { class: 'daq-title', text: 'Segment skipping' }),
        el('div', { class: 'daq-sub', text: 'Sponsors, intros and more' }),
      ]),
      el('label', { class: 'daq-toggle', title: 'Turn segment skipping on or off' }, [master, el('span', { class: 'daq-switch' })]),
    ]);

    const MODE_LABELS = { auto: 'Auto', button: 'Button', off: 'Off' };
    const rows = SK.CATEGORIES.map((cat) => {
      const buttons = SK.MODES.map((m) => {
        const b = el('button', { type: 'button', 'data-mode': m, text: MODE_LABELS[m] });
        b.addEventListener('click', () => commit({ ...cfg, categories: { ...cfg.categories, [cat.id]: m } }));
        return b;
      });
      const dot = el('span', { class: 'daq-cat-dot' });
      dot.style.background = cat.color;
      const row = el('div', { class: 'daq-cat' }, [
        dot,
        el('div', { class: 'daq-cat-text' }, [el('div', { class: 'daq-cat-label', text: cat.label }), el('div', { class: 'daq-cat-desc', title: cat.desc, text: cat.desc })]),
        el('div', { class: 'daq-seg-ctl', role: 'radiogroup', 'aria-label': cat.label }, buttons),
      ]);
      return { cat, row, buttons };
    });

    const jumpInput = el('input', { type: 'checkbox' });
    jumpInput.addEventListener('change', () => commit({ ...cfg, jumpAhead: jumpInput.checked }));
    const jumpDot = el('span', { class: 'daq-cat-dot' });
    jumpDot.style.background = SK.HIGHLIGHT.color;
    const jumpRow = el('div', { class: 'daq-cat' }, [
      jumpDot,
      el('div', { class: 'daq-cat-text' }, [
        el('div', { class: 'daq-cat-label', text: 'Jump ahead' }),
        el('div', { class: 'daq-cat-desc', title: 'Button to jump to the highlight or the most-replayed part', text: 'Button to jump to the highlight or the most-replayed part' }),
      ]),
      el('label', { class: 'daq-toggle' }, [jumpInput, el('span', { class: 'daq-switch' })]),
    ]);

    const link = el('a', { href: 'https://sponsor.ajay.app', target: '_blank', rel: 'noopener', text: 'SponsorBlock' });
    const credit = el('div', { class: 'daq-credit' }, ['Segment data from ', link, ' (CC BY-NC-SA 4.0), crowdsourced by its community.']);

    const body = el('div', { class: 'daq-settings-body' }, [...rows.map((r) => r.row), jumpRow]);
    const root = el('div', { class: 'daq-settings' }, [header, body, credit]);

    function render(next) {
      cfg = next;
      master.checked = cfg.enabled;
      jumpInput.checked = cfg.jumpAhead;
      body.classList.toggle('daq-disabled', !cfg.enabled);
      for (const { cat, buttons } of rows) {
        for (const b of buttons) b.setAttribute('aria-pressed', String(cfg.categories[cat.id] === b.dataset.mode));
      }
    }
    render(cfg);
    return { el: root, render };
  }
})();
