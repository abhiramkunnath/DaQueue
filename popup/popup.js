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
  document.body.append(view.el);

  // ---- state sync ----
  const [{ queue = [] }, { settings }] = await Promise.all([
    chrome.storage[queueArea].get('queue'),
    chrome.storage.local.get('settings'),
  ]);
  view.setState({ queue, settings: { ...DEFAULT_SETTINGS, ...settings } });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === queueArea && changes.queue) view.setState({ queue: changes.queue.newValue || [] });
    if (area === 'local' && changes.settings) {
      view.setState({ settings: { ...DEFAULT_SETTINGS, ...changes.settings.newValue } });
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
})();
