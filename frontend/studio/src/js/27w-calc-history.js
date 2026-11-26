/*! SandMan Digital Loop Studio — 27w-calc-history.js
 *  v10.4 — calculated values over any past period, with nothing extra stored (option A):
 *  the inputs' history is fetched for the period and the formula is worked out at each step (the same formula, the
 *  same AVG / SD / RATE windows), so the trend of a ƒx value can cover hours or days, and a corrected formula shows
 *  corrected history.
 *  History comes from the SandMan server when it provides it:
 *     window.SandmanHistory.fetch({ ids, from, to, step }) → Promise<{ [tagId]: [[ms, value], …] }>
 *  (step = wanted spacing in ms; the server may return averages per step). Without it the app's demo history is used
 *  and the chart says so. */

const CTH = { cache: {} };
function ctHistSource() {
  return window.SandmanHistory && typeof window.SandmanHistory.fetch === 'function' ? 'server' : 'demo';
}
/* tags the formula reads (each instance, LET included) */
function ctInputIds(C, b) {
  const cp = ctCompile(C, b),
    ids = new Set();
  const walk = n => {
    if (!n || typeof n !== 'object') return;
    if (n.ref) (n.group ? n.ids : [n.id]).forEach(id => id && ids.add(id));
    Object.values(n).forEach(v => (Array.isArray(v) ? v.forEach(walk) : typeof v === 'object' && walk(v)));
  };
  if (cp.tree) walk(cp.tree);
  return [...ids];
}
/* the largest time window used in the formula (AVG(x, 1h) needs an hour of input before the first point) */
function ctMaxWin(C) {
  let m = 0;
  String(C.expr || '').replace(/,\s*(\d+(?:\.\d+)?)\s*(s|m|h|d)\s*\)/gi, (_, n, u) => (m = Math.max(m, n * { s: 1, m: 60, h: 3600, d: 86400 }[u.toLowerCase()])));
  return m * 1000;
}
async function ctHistFetch(ids, from, to, step) {
  if (ctHistSource() === 'server') {
    const r = await window.SandmanHistory.fetch({ ids, from, to, step });
    const out = {};
    ids.forEach(id => (out[id] = (r && r[id] ? r[id] : []).map(p => (Array.isArray(p) ? { t: +p[0], v: p[1] == null ? null : +p[1] } : { t: +p.t, v: p.v == null ? null : +p.v })).filter(p => isFinite(p.t)).sort((a, b) => a.t - b.t)));
    return out;
  }
  const out = {},
    st = Math.max(5000, step);
  ids.forEach(id => {
    const a = [];
    for (let t = Math.floor(from / st) * st; t <= to; t += st) {
      const v = histVal(id, t);
      if (v != null && isFinite(v)) a.push({ t, v });
    }
    out[id] = a;
  });
  return out;
}
/* the ƒx value at each step from `from` to `to` (about 600 points) */
async function ctHistory(tagId, from, to) {
  const t = REG[tagId];
  if (!t || !t.calc) return [];
  const C = (DOC.calc || []).find(c => c.id === t.calc);
  if (!C) return [];
  const inst = ctInstances(C).find(i => i.id === tagId) || ctInstances(C)[0];
  const step = Math.max(5000, Math.round((to - from) / 600 / 1000) * 1000);
  const key = `${tagId}|${C.expr}|${from / step | 0}|${to / step | 0}`;
  if (CTH.cache[key]) return CTH.cache[key];
  const ids = ctInputIds(C, inst.b),
    pre = ctMaxWin(C);
  const hist = await ctHistFetch(ids, from - pre, to, Math.min(step, pre ? Math.max(5000, pre / 20) : step));
  const out = [],
    stKey = 'hist:' + tagId + ':' + Date.now();
  try {
    for (let tt = from; tt <= to; tt += step) {
      CT_AT = { t: tt, hist, stale: Math.max(600000, step * 3) };
      const r = ctRun(C, inst.b, stKey);
      if (r.v != null && isFinite(r.v)) out.push({ t: tt, v: r.v });
    }
  } finally {
    CT_AT = null;
    delete CT_STATE[stKey];
  }
  CTH.cache = { [key]: out };
  return out;
}
