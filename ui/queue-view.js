// Shared queue UI — used by the in-page YouTube panel (content script) and the
// toolbar popup, so both look and behave identically.
// Exposes window.DaQueueUI = { el, icon, toast, createQueueView }.
// No innerHTML anywhere: YouTube enforces Trusted Types.
(() => {
  'use strict';
  if (window.DaQueueUI) return;

  // ---------- DOM helpers ----------

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  const ICON_PATHS = {
    queueAdd:
      'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12zm-5-7v2h-3v3h-2v-3H8v-2h3V7h2v3h3z',
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    playNext:
      'M21 3H3c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h5v2h8v-2h2v-2H3V5h18v8h2V5c0-1.11-.9-2-2-2zm-8 7V7h-2v3H8v2h3v3h2v-3h3v-2h-3zm11 8l-4.5 4.5L18 21l3-3-3-3 1.5-1.5L24 18z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    close:
      'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    chevron: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
    drag:
      'M9 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  };

  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'daq-svg');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.append(path);
    return svg;
  }

  let toastEl;
  let toastTimer;
  function toast(text) {
    if (!toastEl) {
      toastEl = el('div', { class: 'daq-toast', role: 'status' });
      document.body.append(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('daq-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('daq-show'), 2500);
  }

  // ---------- queue view ----------
  //
  // opts:
  //   mode          'panel' (collapsible, in YouTube) | 'popup' (always expanded)
  //   send(msg)     message the background; returns a promise
  //   onPlayItem(id), onPlayNext()
  //   onAddCurrent()  optional — shows an "Add this video" pill (enabled when something is playing)
  //   onTogglePlay()  optional — shows play/pause + next mini controls on the now-playing row
  //   emptyExtra    optional element appended to the empty-state message
  //
  // returns { el, setState({ queue, settings }), setNowPlaying(now | null), setPaused(bool) }

  function createQueueView(opts) {
    const { mode = 'panel', send, onPlayItem, onPlayNext, onAddCurrent, onTogglePlay, emptyExtra } = opts;
    const isPanel = mode === 'panel';

    let queue = [];
    let settings = {};
    let now = null;
    let nowKey = '';
    let paused = true;
    let clearTimer;

    // ---- build ----

    const subEl = el('div', { class: 'daq-sub' });
    const heading = el('div', { class: 'daq-heading' }, [el('div', { class: 'daq-title', text: 'DaQueue' }), subEl]);
    const collapseBtn = isPanel ? el('button', { class: 'daq-icon-btn daq-collapse', type: 'button' }, icon('chevron')) : null;

    const autoInput = el('input', { type: 'checkbox' });
    const toggle = el(
      'label',
      { class: 'daq-toggle', title: 'Play the next queued video when the current one ends' },
      [el('span', { text: 'Auto-advance' }), autoInput, el('span', { class: 'daq-switch' })]
    );
    const header = el('div', { class: 'daq-header' }, [collapseBtn, heading, toggle]);

    const pill = (iconName, label, extraClass = '') =>
      el('button', { class: `daq-pill ${extraClass}`, type: 'button' }, [icon(iconName), el('span', { text: label })]);
    const addBtn = onAddCurrent ? pill('add', 'Add this video') : null;
    const nextBtn = pill('next', 'Play next');
    const clearBtn = pill('delete', 'Clear', 'daq-clear');
    const actions = el('div', { class: 'daq-actions' }, [addBtn, nextBtn, clearBtn]);

    const nowEl = el('div', { class: 'daq-now' });
    const upNextEl = el('div', { class: 'daq-section', text: 'Up next' });
    const listEl = el('ol', { class: 'daq-list' });
    const emptyEl = el('div', { class: 'daq-empty' }, [
      el('div', { text: 'Queue is empty. Hover a thumbnail on YouTube and click the queue button to add videos.' }),
      emptyExtra,
    ]);

    const root = el('div', { id: 'daqueue-panel', class: `daq-${mode}` }, [
      header,
      el('div', { class: 'daq-body' }, [actions, nowEl, upNextEl, listEl, emptyEl]),
    ]);

    let playPauseBtn = null;
    let ctrlNextBtn = null;

    // ---- behaviour ----

    function updateSettings(patch) {
      settings = { ...settings, ...patch };
      render();
      send({ type: 'setSettings', patch });
    }

    if (collapseBtn) {
      const toggleCollapse = () => updateSettings({ collapsed: !settings.collapsed });
      collapseBtn.addEventListener('click', toggleCollapse);
      heading.addEventListener('click', toggleCollapse);
    }
    autoInput.addEventListener('change', () => updateSettings({ autoAdvance: autoInput.checked }));
    addBtn?.addEventListener('click', () => onAddCurrent());
    nextBtn.addEventListener('click', () => onPlayNext());
    clearBtn.addEventListener('click', onClear);

    function onClear() {
      if (!queue.length) return;
      const label = clearBtn.querySelector('span');
      if (clearBtn.classList.contains('daq-confirm')) {
        clearTimeout(clearTimer);
        clearBtn.classList.remove('daq-confirm');
        label.textContent = 'Clear';
        send({ type: 'clear' });
        return;
      }
      clearBtn.classList.add('daq-confirm');
      label.textContent = 'Clear all?';
      clearTimer = setTimeout(() => {
        clearBtn.classList.remove('daq-confirm');
        label.textContent = 'Clear';
      }, 3000);
    }

    // Thumbnail hue → CSS vars; the stylesheet picks lightness per theme.
    const tintCache = new Map();
    function applyTint(node, id) {
      if (!tintCache.has(id)) tintCache.set(id, Promise.resolve(send({ type: 'color', id })));
      tintCache.get(id).then((c) => {
        if (!c || c.error) return;
        node.style.setProperty('--daq-h', String(c.h));
        node.style.setProperty('--daq-s', String(c.s));
        node.classList.add('daq-tinted');
      });
    }

    // ---- list (keyed: nodes are reused, so reorders don't reload thumbnails) ----

    const itemNodes = new Map(); // video id -> <li>

    function createItem(video) {
      const li = el('li', { class: 'daq-item', title: video.title }, [
        el('span', { class: 'daq-grip' }, [el('span', { class: 'daq-index' }), icon('drag')]),
        el('img', { class: 'daq-thumb', src: video.thumb, alt: '', loading: 'lazy', draggable: 'false' }),
        el('div', { class: 'daq-meta' }, [
          el('div', { class: 'daq-item-title', text: video.title }),
          el('div', { class: 'daq-item-channel', text: video.channel }),
        ]),
        el('button', { class: 'daq-icon-btn daq-remove', type: 'button', title: 'Remove from queue', 'aria-label': 'Remove from queue' }, icon('close')),
      ]);
      li.dataset.id = video.id;
      applyTint(li, video.id);
      return li;
    }

    function renderList() {
      const nodes = queue.map((video, i) => {
        let li = itemNodes.get(video.id);
        if (!li) itemNodes.set(video.id, (li = createItem(video)));
        li.dataset.index = i;
        li.querySelector('.daq-index').textContent = String(i + 1);
        return li;
      });
      const live = new Set(queue.map((v) => v.id));
      for (const id of itemNodes.keys()) if (!live.has(id)) itemNodes.delete(id);
      // Move nodes into order; anything stale ends up past the end and is dropped.
      nodes.forEach((li, i) => {
        if (listEl.children[i] !== li) listEl.insertBefore(li, listEl.children[i] || null);
      });
      while (listEl.children.length > nodes.length) listEl.lastElementChild.remove();
    }

    // ---- drag to reorder (pointer events, animated) ----
    // Native HTML5 DnD can't animate siblings, so: the grabbed card follows the pointer
    // via transform, siblings slide out of the way with CSS transitions, and on release
    // the card settles into its slot before the DOM is actually reordered.

    const DRAG_THRESHOLD = 5;
    const SETTLE_MS = 200;
    let drag = null;
    let renderPending = false;
    let suppressClick = false;

    function onPointerDown(e) {
      if (e.button !== 0 || drag) return;
      const li = e.target.closest('.daq-item');
      if (!li || e.target.closest('.daq-remove')) return;
      // Mouse can grab anywhere on the card; touch/pen only via the grip so the list still scrolls.
      if (e.pointerType !== 'mouse' && !e.target.closest('.daq-grip')) return;
      if (e.pointerType === 'mouse') e.preventDefault(); // no text selection while dragging
      drag = { li, pointerId: e.pointerId, startY: e.clientY, y: e.clientY, startScroll: listEl.scrollTop, active: false };
      li.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      if (!drag || drag.settling || e.pointerId !== drag.pointerId) return;
      drag.y = e.clientY;
      if (!drag.active) {
        if (Math.abs(drag.y - drag.startY) < DRAG_THRESHOLD) return;
        startDrag();
      }
      updateDrag();
    }

    function startDrag() {
      const items = [...listEl.children];
      Object.assign(drag, {
        active: true,
        items,
        from: items.indexOf(drag.li),
        gap: parseFloat(getComputedStyle(listEl).rowGap) || 0,
        tops: items.map((n) => n.offsetTop),
        heights: items.map((n) => n.offsetHeight),
      });
      drag.to = drag.from;
      root.classList.add('daq-sorting');
      drag.li.classList.add('daq-lifted');
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function updateDrag() {
      const { li, items, from, tops, heights, gap } = drag;
      const last = items.length - 1;
      const rawDy = drag.y - drag.startY + (listEl.scrollTop - drag.startScroll);
      const minDy = tops[0] - tops[from];
      const maxDy = tops[last] + heights[last] - (tops[from] + heights[from]);
      const dy = Math.min(Math.max(rawDy, minDy), maxDy);
      li.style.transform = `translateY(${dy}px) scale(1.02)`;

      // Swap once the dragged card's leading edge crosses a sibling's midpoint.
      // (Centre-vs-centre can't reach the ends: the clamp stops the card exactly
      // at the end card's centre when heights match.)
      const top = tops[from] + dy;
      const bottom = top + heights[from];
      const shift = heights[from] + gap;
      let to = from;
      items.forEach((item, i) => {
        if (i === from) return;
        const mid = tops[i] + heights[i] / 2;
        let offset = 0;
        if (i > from && bottom > mid) {
          offset = -shift;
          to = Math.max(to, i);
        } else if (i < from && top < mid) {
          offset = shift;
          to = Math.min(to, i);
        }
        item.style.transform = offset ? `translateY(${offset}px)` : '';
      });
      if (to !== drag.to) renumber(from, to);
      drag.to = to;
    }

    // Live numbering so the order the user sees always matches where things will land.
    function renumber(from, to) {
      drag.items.forEach((item, i) => {
        let pos = i;
        if (i === from) pos = to;
        else if (from < to && i > from && i <= to) pos = i - 1;
        else if (to < from && i >= to && i < from) pos = i + 1;
        item.querySelector('.daq-index').textContent = String(pos + 1);
      });
    }

    // Scroll the list while the pointer is held near its top/bottom edge.
    function autoScroll() {
      if (!drag?.active || drag.settling) return;
      const rect = listEl.getBoundingClientRect();
      const edge = 40;
      let speed = 0;
      if (drag.y < rect.top + edge) speed = -(rect.top + edge - drag.y) / 4;
      else if (drag.y > rect.bottom - edge) speed = (drag.y - (rect.bottom - edge)) / 4;
      if (speed) {
        const before = listEl.scrollTop;
        listEl.scrollTop += Math.max(-12, Math.min(12, speed));
        if (listEl.scrollTop !== before) updateDrag();
      }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function endDrag(cancel) {
      if (!drag) return;
      const d = drag;
      if (d.li.hasPointerCapture?.(d.pointerId)) d.li.releasePointerCapture(d.pointerId);
      if (!d.active) {
        drag = null; // plain click — let the click handler play the item
        if (renderPending) render();
        return;
      }
      cancelAnimationFrame(d.raf);
      d.settling = true;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);

      const { from, tops, heights } = d;
      const to = cancel ? from : d.to;
      if (cancel) {
        for (const item of d.items) if (item !== d.li) item.style.transform = '';
        renumber(from, from);
      }
      const finalOffset =
        to > from ? tops[to] + heights[to] - heights[from] - tops[from]
        : to < from ? tops[to] - tops[from]
        : 0;
      d.li.classList.add('daq-settling');
      d.li.style.transform = `translateY(${finalOffset}px)`;

      setTimeout(() => {
        // Snap: drop transforms without animating, reorder DOM to match.
        listEl.classList.add('daq-no-anim');
        for (const item of d.items) item.style.transform = '';
        d.li.classList.remove('daq-lifted', 'daq-settling');
        root.classList.remove('daq-sorting');
        drag = null;
        // Skip if the queue changed underneath us mid-drag (indices would be stale).
        if (to !== from && queue[from]?.id === d.li.dataset.id) {
          const [moved] = queue.splice(from, 1);
          queue.splice(to, 0, moved);
          send({ type: 'move', from, to });
        }
        render();
        void listEl.offsetHeight; // flush styles before re-enabling transitions
        listEl.classList.remove('daq-no-anim');
      }, SETTLE_MS);
    }

    listEl.addEventListener('click', (e) => {
      if (suppressClick) return;
      const li = e.target.closest('.daq-item');
      if (!li) return;
      if (e.target.closest('.daq-remove')) send({ type: 'remove', id: li.dataset.id });
      else onPlayItem(li.dataset.id);
    });
    listEl.addEventListener('pointerdown', onPointerDown);
    listEl.addEventListener('pointermove', onPointerMove);
    listEl.addEventListener('pointerup', () => endDrag(false));
    listEl.addEventListener('pointercancel', () => endDrag(true));
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && drag?.active && !drag.settling) {
          e.stopPropagation();
          endDrag(true);
        }
      },
      true
    );

    // ---- now playing ----

    function renderNow() {
      const key = now ? `${now.id}|${now.title}|${now.channel}` : '';
      if (key === nowKey) return;
      nowKey = key;
      nowEl.hidden = !now;
      if (addBtn) addBtn.disabled = !now;
      playPauseBtn = ctrlNextBtn = null;
      if (!now) {
        nowEl.replaceChildren();
        return;
      }
      const bars = el('span', { class: 'daq-eq', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]);
      let controls = null;
      if (onTogglePlay) {
        playPauseBtn = el('button', { class: 'daq-icon-btn daq-ctrl', type: 'button' });
        ctrlNextBtn = el('button', { class: 'daq-icon-btn daq-ctrl', type: 'button', title: 'Play next in queue', 'aria-label': 'Play next in queue' }, icon('next'));
        playPauseBtn.addEventListener('click', () => onTogglePlay());
        ctrlNextBtn.addEventListener('click', () => onPlayNext());
        controls = el('div', { class: 'daq-ctrls' }, [playPauseBtn, ctrlNextBtn]);
      }
      const row = el('div', { class: 'daq-item daq-now-item', title: now.title }, [
        el('span', { class: 'daq-grip' }, bars),
        el('img', { class: 'daq-thumb', src: `https://i.ytimg.com/vi/${now.id}/mqdefault.jpg`, alt: '', draggable: 'false' }),
        el('div', { class: 'daq-meta' }, [
          el('div', { class: 'daq-item-title', text: now.title }),
          el('div', { class: 'daq-item-channel', text: now.channel }),
        ]),
        controls,
      ]);
      applyTint(row, now.id);
      nowEl.replaceChildren(el('div', { class: 'daq-section', text: 'Now playing' }), row);
      renderPaused();
      renderControls();
    }

    function renderPaused() {
      root.classList.toggle('daq-paused', paused);
      if (playPauseBtn) {
        const label = paused ? 'Play' : 'Pause';
        playPauseBtn.replaceChildren(icon(paused ? 'play' : 'pause'));
        playPauseBtn.title = label;
        playPauseBtn.setAttribute('aria-label', label);
      }
    }

    function renderControls() {
      if (ctrlNextBtn) ctrlNextBtn.disabled = !queue.length;
    }

    // ---- render ----

    function render() {
      // Storage updates mid-drag would yank nodes around; apply them after the drop.
      if (drag) {
        renderPending = true;
        return;
      }
      renderPending = false;
      const n = queue.length;
      const collapsed = isPanel && !!settings.collapsed;
      root.classList.toggle('daq-collapsed', collapsed);
      if (collapseBtn) {
        collapseBtn.setAttribute('aria-expanded', String(!collapsed));
        collapseBtn.title = collapsed ? 'Expand queue' : 'Collapse queue';
      }
      autoInput.checked = !!settings.autoAdvance;
      subEl.textContent = !n
        ? 'Empty'
        : `${n} video${n > 1 ? 's' : ''}` + (collapsed ? ` · Next: ${queue[0].title}` : '');
      nextBtn.disabled = !n;
      clearBtn.disabled = !n;
      emptyEl.hidden = n > 0;
      listEl.hidden = !n;
      upNextEl.hidden = !n;
      renderList();
      renderControls();
    }

    nowEl.hidden = true;
    if (addBtn) addBtn.disabled = true;
    render();
    renderPaused();

    return {
      el: root,
      setState(state) {
        if (state.queue) queue = [...state.queue];
        if (state.settings) settings = { ...state.settings };
        render();
      },
      setNowPlaying(next) {
        now = next;
        renderNow();
      },
      setPaused(value) {
        if (paused === !!value) return;
        paused = !!value;
        renderPaused();
      },
    };
  }

  window.DaQueueUI = { el, icon, toast, createQueueView };
})();
