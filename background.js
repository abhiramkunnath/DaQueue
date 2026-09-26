// DaQueue service worker: single owner of all queue mutations.
//
// Incognito: the extension runs in "spanning" mode (one worker for both), so the
// queue is kept per context — normal windows use storage.local (persisted to disk),
// incognito windows use storage.session (memory only, wiped when the last
// incognito window closes). Settings are shared.

const DEFAULT_SETTINGS = { autoAdvance: true, collapsed: false };
const ID_RE = /^[\w-]{11}$/;
const YT_ORIGIN = 'https://www.youtube.com';

// Content scripts need this to read the incognito queue from storage.session.
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

function queueArea(incognito) {
  return incognito ? chrome.storage.session : chrome.storage.local;
}

function parseVideoId(url) {
  try {
    const u = new URL(url);
    const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
    return ID_RE.test(id || '') ? id : null;
  } catch {
    return null;
  }
}

async function getQueue(incognito) {
  const { queue = [] } = await queueArea(incognito).get('queue');
  return queue;
}

// Serialize read-modify-write cycles so concurrent messages can't clobber each other.
let lock = Promise.resolve();
function mutate(incognito, fn) {
  const run = lock.then(async () => {
    const queue = await getQueue(incognito);
    const result = fn(queue);
    await queueArea(incognito).set({ queue });
    return result;
  });
  lock = run.catch(() => {});
  return run;
}

async function fetchMeta(id) {
  try {
    const target = encodeURIComponent(`${YT_ORIGIN}/watch?v=${id}`);
    const res = await fetch(`${YT_ORIGIN}/oembed?format=json&url=${target}`, { credentials: 'omit' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// next=true puts the video at the front ("play next"); if it's already queued it's
// moved to the front instead of duplicated.
async function addVideo(incognito, id, hint = {}, next = false) {
  if (!ID_RE.test(id || '')) return { status: 'invalid' };
  const existing = await getQueue(incognito);
  const queued = existing.some((v) => v.id === id);
  if (queued && !next) return { status: 'duplicate', length: existing.length };

  const meta = queued ? null : await fetchMeta(id);
  return mutate(incognito, (q) => {
    const i = q.findIndex((v) => v.id === id);
    if (i >= 0) {
      if (!next) return { status: 'duplicate', length: q.length };
      if (i === 0) return { status: 'already-next', length: q.length };
      q.unshift(q.splice(i, 1)[0]);
      return { status: 'moved', length: q.length };
    }
    const item = {
      id,
      title: meta?.title || hint.title || id,
      channel: meta?.author_name || hint.channel || '',
      thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      addedAt: Date.now(),
    };
    if (next) q.unshift(item);
    else q.push(item);
    return { status: next ? 'added-next' : 'added', length: q.length };
  });
}

function addResultText(res) {
  switch (res?.status) {
    case 'added': return `Added to queue (${res.length})`;
    case 'added-next': return 'Will play next';
    case 'moved': return 'Moved to play next';
    case 'already-next': return 'Already playing next';
    case 'duplicate': return 'Already in queue';
    default: return 'Could not add video';
  }
}

// Dominant thumbnail hue for YouTube-style tinted highlights. Done here because
// the service worker can read i.ytimg.com pixels (host permission bypasses CORS);
// a content script's canvas would be tainted.
const colorCache = new Map();

function thumbColor(id) {
  if (!ID_RE.test(id || '')) return null;
  if (!colorCache.has(id)) colorCache.set(id, computeThumbColor(id).catch(() => null));
  return colorCache.get(id);
}

async function computeThumbColor(id) {
  const res = await fetch(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`, { credentials: 'omit' });
  if (!res.ok) return null;
  const w = 32, h = 18;
  const bitmap = await createImageBitmap(await res.blob(), { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' });
  const ctx = new OffscreenCanvas(w, h).getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  // Circular mean of hue, weighted by saturation² so vivid colours dominate.
  let x = 0, y = 0, satSum = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (l < 0.08 || l > 0.92 || max === min) continue;
    const d = max - min;
    const s = d / (1 - Math.abs(2 * l - 1));
    const hue =
      max === r ? ((g - b) / d + 6) % 6
      : max === g ? (b - r) / d + 2
      : (r - g) / d + 4;
    const angle = (hue / 6) * 2 * Math.PI;
    x += Math.cos(angle) * s * s;
    y += Math.sin(angle) * s * s;
    satSum += s;
    count++;
  }
  const avgSat = count ? satSum / count : 0;
  if (avgSat < 0.1) return { h: 0, s: 0 }; // near-greyscale thumbnail → neutral highlight
  const hueDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { h: Math.round(hueDeg), s: Math.round(Math.min(Math.max(avgSat * 100, 25), 60)) };
}

async function setSettings(patch) {
  const { settings } = await chrome.storage.local.get('settings');
  const next = { ...DEFAULT_SETTINGS, ...settings, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

// Each handler gets (message, incognito) — incognito comes from the sender tab.
const handlers = {
  add: async (m, inc) => {
    const res = await addVideo(inc, m.id, m.hint, !!m.next);
    return { ...res, text: addResultText(res) };
  },
  remove: (m, inc) =>
    mutate(inc, (q) => {
      const i = q.findIndex((v) => v.id === m.id);
      if (i >= 0) q.splice(i, 1);
    }),
  move: (m, inc) =>
    mutate(inc, (q) => {
      if (!Number.isInteger(m.from) || !Number.isInteger(m.to) || m.from < 0 || m.from >= q.length) return;
      const [item] = q.splice(m.from, 1);
      q.splice(Math.max(0, Math.min(m.to, q.length)), 0, item);
    }),
  clear: (_m, inc) => mutate(inc, (q) => void q.splice(0)),
  next: (_m, inc) => mutate(inc, (q) => q.shift() || null),
  take: (m, inc) =>
    mutate(inc, (q) => {
      const i = q.findIndex((v) => v.id === m.id);
      return i >= 0 ? q.splice(i, 1)[0] : null;
    }),
  setSettings: (m) => setSettings(m.patch),
  color: (m) => thumbColor(m.id),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  // Tabs report their own mode; the popup (no tab) passes it explicitly.
  const incognito = sender.tab ? !!sender.tab.incognito : !!msg.incognito;
  Promise.resolve(handler(msg, incognito)).then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true;
});

// ---- Badge: global text for normal windows, per-tab override for incognito tabs ----
const badgeText = (queue) => (queue.length ? String(queue.length) : '');

async function updateBadges() {
  const [normal, priv] = await Promise.all([getQueue(false), getQueue(true)]);
  chrome.action.setBadgeText({ text: badgeText(normal) });
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.incognito) chrome.action.setBadgeText({ tabId: t.id, text: badgeText(priv) });
  }
}

chrome.action.setBadgeBackgroundColor({ color: '#cc0000' });
updateBadges();
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' || area === 'session') && changes.queue) updateBadges();
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (tab.incognito && info.status === 'complete') {
    chrome.action.setBadgeText({ tabId, text: badgeText(await getQueue(true)) });
  }
});

// Incognito queue dies with the incognito session.
chrome.windows.onRemoved.addListener(async () => {
  const windows = await chrome.windows.getAll();
  if (!windows.some((w) => w.incognito)) chrome.storage.session.remove('queue');
});

// ---- Install: context menus + default settings ----
chrome.runtime.onInstalled.addListener(async () => {
  await setSettings({});
  const link = { contexts: ['link'], targetUrlPatterns: ['*://www.youtube.com/watch*', '*://youtu.be/*'] };
  const page = { contexts: ['page'], documentUrlPatterns: ['*://www.youtube.com/watch*'] };
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'daq-add-link', title: 'Add to DaQueue', ...link });
    chrome.contextMenus.create({ id: 'daq-next-link', title: 'Play next in DaQueue', ...link });
    chrome.contextMenus.create({ id: 'daq-add-page', title: 'Add this video to DaQueue', ...page });
    chrome.contextMenus.create({ id: 'daq-next-page', title: 'Play this video next in DaQueue', ...page });
  });
});

function notifyTab(tabId, text) {
  if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'toast', text }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = String(info.menuItemId);
  const url = menuId.endsWith('-link') ? info.linkUrl : info.pageUrl;
  const id = parseVideoId(url);
  if (!id) return;
  const res = await addVideo(!!tab?.incognito, id, {}, menuId.startsWith('daq-next'));
  notifyTab(tab?.id, addResultText(res));
});

// ---- Keyboard shortcut ----
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'play-next') return;
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) return;
  if (tab.url?.startsWith(`${YT_ORIGIN}/`)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'playNext' });
      return;
    } catch {
      // No content script in tab (e.g. not reloaded after install) — fall through.
    }
  }
  const item = await handlers.next(null, tab.incognito);
  if (item) chrome.tabs.create({ windowId: tab.windowId, url: `${YT_ORIGIN}/watch?v=${item.id}` });
});
