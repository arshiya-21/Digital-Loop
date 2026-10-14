/*! SandMan Process Flowsheet — 00-core.js
 *  Core utilities, formatting, line (stream) types
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

const $ = s => document.querySelector(s),
  $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const gauss = () => {
  let u = 0,
    v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const fmtN = (v, d) =>
  v == null || !isFinite(v)
    ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const hms = d => d.toLocaleTimeString('en-GB', { hour12: false });
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SEVN = ['Normal', 'Advisory', 'Warning', 'Critical'],
  SEVHEX = ['#1f9d55', '#c99a00', '#ec7a15', '#d93636'];
const sevC = s => SEVHEX[s];
const lines = (t, x, y, lh, cls, anchor = 'middle') =>
  String(t || '')
    .split('\n')
    .map((l, i) => `<text x="${x}" y="${y + i * lh}" class="${cls}" text-anchor="${anchor}">${esc(l)}</text>`)
    .join('');

/* ===== Line types (match plant HMI legend) ===== */
const KIND = {
  sand: { c: '#2f8f46', n: 'Sand / material line' },
  add: { c: '#1f6fd8', n: 'Additive line' },
  water: { c: '#2b8ae6', n: 'Water line' },
  air: { c: '#e6b800', n: 'Air / blower line' },
  ret: { c: '#e53935', n: 'Return / feedback line' },
  metal: { c: '#e8590c', n: 'Liquid metal' },
  mold: { c: '#7a63b0', n: 'Molds' },
  cast: { c: '#5b6675', n: 'Castings' },
  data: { c: '#6b4fd6', n: 'Data / network line' }, // v4.0 — Control & IT communication (animated data packets)
  any: { c: '#94a3b8', n: 'Any material' },
};
const MAT = { Bentonite: '#8a9a7b', 'Coal dust': '#2b2b2b', 'New sand': '#e0c48a', Additive: '#9ca3af' };
