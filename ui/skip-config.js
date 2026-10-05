// Segment-skip configuration shared by the content script (content/skip.js) and the popup.
// Segment data comes from SponsorBlock (https://sponsor.ajay.app), licensed CC BY-NC-SA 4.0.
// Exposes window.DaQueueSkip = { CATEGORIES, HIGHLIGHT, MODES, DEFAULTS, resolve, category }.
(() => {
  'use strict';
  if (window.DaQueueSkip) return;

  // Colours match SponsorBlock's defaults so markers look familiar to its users.
  const CATEGORIES = [
    { id: 'sponsor', label: 'Sponsor', desc: 'Paid promotions and sponsored reads', color: '#00d400' },
    { id: 'selfpromo', label: 'Self-promotion', desc: 'Merch, Patreon, the creator’s own products', color: '#ffff00' },
    { id: 'interaction', label: 'Interaction reminder', desc: '“Like and subscribe”, “comment below”', color: '#cc00ff' },
    { id: 'intro', label: 'Intro', desc: 'Intro animations and pauses', color: '#00ffff' },
    { id: 'outro', label: 'Endcards / credits', desc: 'End screens and credits', color: '#0202ed' },
    { id: 'preview', label: 'Preview / recap', desc: 'Clips of what’s coming or what happened', color: '#008fd6' },
    { id: 'filler', label: 'Filler tangent', desc: 'Off-topic jokes and tangents', color: '#7300ff' },
    { id: 'music_offtopic', label: 'Non-music section', desc: 'Talking parts of music videos', color: '#ff9900' },
  ];
  const HIGHLIGHT = { id: 'poi_highlight', label: 'Highlight', color: '#ff1684' };

  // auto: skip immediately · button: offer a "Skip" button · off: ignore
  const MODES = ['auto', 'button', 'off'];

  const DEFAULTS = {
    enabled: true,
    jumpAhead: true,
    categories: {
      sponsor: 'auto',
      selfpromo: 'button',
      interaction: 'button',
      intro: 'button',
      outro: 'button',
      preview: 'button',
      filler: 'off',
      music_offtopic: 'off',
    },
  };

  // settings.skip is stored partially; always read it through resolve().
  function resolve(settings) {
    const s = settings?.skip || {};
    return { ...DEFAULTS, ...s, categories: { ...DEFAULTS.categories, ...(s.categories || {}) } };
  }

  function category(id) {
    return CATEGORIES.find((c) => c.id === id) || (id === HIGHLIGHT.id ? HIGHLIGHT : null);
  }

  window.DaQueueSkip = { CATEGORIES, HIGHLIGHT, MODES, DEFAULTS, resolve, category };
})();
