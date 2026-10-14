/* Sandman header — Digital Loop button: status switch.
   SandmanDigitalLoop.setState('live' | 'alarm' | 'offline')
   live    = green dot, moving bead and dashes (Studio has live data)
   alarm   = red dot and bead (the twin has an active alarm)
   offline = grey, still, no dot (no live data) */
window.SandmanDigitalLoop = {
  el: () => document.getElementById('smDigitalLoop'),
  setState(state) {
    const el = this.el();
    if (!el || !['live', 'alarm', 'offline'].includes(state)) return;
    el.dataset.state = state;
    const t = state === 'alarm' ? 'Digital Loop — alarm active, open the live sand loop'
            : state === 'offline' ? 'Digital Loop — no live data, open the sand loop'
            : 'Digital Loop — open the live sand loop';
    el.title = t; el.setAttribute('aria-label', t);
  },
  /* optional: open in the same tab instead of a new one */
  sameTab() { const el = this.el(); if (el) { el.removeAttribute('target'); el.removeAttribute('rel'); } },
};
