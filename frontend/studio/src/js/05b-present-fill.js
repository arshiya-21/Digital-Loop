/*! SandMan Digital Loop Studio — 05b-present-fill.js
 *  v6.0 — Publish view "Fill screen": the loop fills the whole page automatically.
 *  The layout is SPREAD (distances between equipment grow along the short direction) until the loop has the
 *  screen's shape; every machine, symbol and text keeps its own proportions (nothing is stretched). The spread is
 *  temporary: saving, undo and leaving the publish view always use the original positions. Re-adjusts on resize. */

const SPREAD = { on: false, orig: null, sx: 1, sy: 1 };
const SPAN_TYPES = new Set(['legend', 'areaBox', 'title']); // frames and bands stretch with the layout

function spreadRestore() {
  if (!SPREAD.on || !SPREAD.orig) return;
  const O = SPREAD.orig;
  DOC.blocks.forEach(b => {
    const o = O.b[b.id];
    if (!o) return;
    b.x = o.x;
    b.y = o.y;
    if ('w' in o) o.w == null ? delete b.w : (b.w = o.w);
    if ('h' in o) o.h == null ? delete b.h : (b.h = o.h);
  });
  DOC.streams.forEach(s => {
    const o = O.s[s.id];
    if (!o) return;
    if (o.pts) s.pts = o.pts;
    s.mid = o.mid;
  });
  SPREAD.on = false;
  SPREAD.orig = null;
  SPREAD.geo = null;
}
function spreadApply() {
  spreadRestore();
  if (!PRESENT || PREF.pfit !== 'spread' || !DOC.blocks.length) return; // v7.8: Fill screen now scales the drawing (fit › stretch)
  const r = $('#cwrap').getBoundingClientRect();
  if (r.width < 50 || r.height < 50) return;
  const { x0, y0, x1, y1 } = bounds(),
    W = Math.max(1, x1 - x0),
    H = Math.max(1, y1 - y0),
    scr = (r.width - 48) / (r.height - 40),
    cnt = W / H;
  let sx = 1,
    sy = 1;
  if (scr > cnt * 1.02) sx = Math.min(2.5, scr / cnt);
  else if (cnt > scr * 1.02) sy = Math.min(2.5, cnt / scr);
  if (sx === 1 && sy === 1) return;
  // the drawn shape of every line (absolute points) and the originals (restored when leaving publish / saving)
  const shape0 = {};
  DOC.streams.forEach(st => {
    try {
      const G = streamGeom(st);
      if (G) shape0[st.id] = G.pts.map(p => ({ x: p.x, y: p.y }));
    } catch (e) {}
  });
  const O = { b: {}, s: {} };
  DOC.streams.forEach(st => (O.s[st.id] = { pts: st.pts ? st.pts.map(p => ({ ...p })) : null, mid: st.mid }));
  DOC.blocks.forEach(b => (O.b[b.id] = { x: b.x, y: b.y, ...('w' in b ? { w: b.w } : { w: null }), ...('h' in b ? { h: b.h } : { h: null }) }));
  /* v7.3 — "only the empty gaps grow". Items that belong together form a unit: touching (≤ 12 px), grouped, or joined
     by a short line (≤ 40 px; ≤ 80 px for a junction). Along each axis the units' extents form bands; only the empty
     gaps between bands are widened. The mapping is monotonic, so nothing changes order, touching items stay joined
     and every line keeps exactly its drawn corners and directions (its runs only get longer). */
  const TOUCH = 12;
  const parts = DOC.blocks.filter(b => !SPAN_TYPES.has(b.type));
  const par = {};
  const find = id => (par[id] === id ? id : (par[id] = find(par[id])));
  parts.forEach(b => (par[b.id] = b.id));
  const bx = {};
  parts.forEach(b => {
    const d = dims(b);
    bx[b.id] = { x0: b.x, y0: b.y, x1: b.x + d.W, y1: b.y + d.H };
  });
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = bx[parts[i].id],
        c = bx[parts[j].id];
      const near = a.x0 <= c.x1 + TOUCH && c.x0 <= a.x1 + TOUCH && a.y0 <= c.y1 + TOUCH && c.y0 <= a.y1 + TOUCH;
      const sameGroup = parts[i].grp && parts[i].grp === parts[j].grp;
      if (near || sameGroup) par[find(parts[i].id)] = find(parts[j].id);
    }
  DOC.streams.forEach(st => {
    const A = bx[st.from.b],
      C = bx[st.to.b];
    if (!A || !C) return;
    const gap = Math.max(0, Math.max(A.x0, C.x0) - Math.min(A.x1, C.x1)) + Math.max(0, Math.max(A.y0, C.y0) - Math.min(A.y1, C.y1));
    const jn = B(st.from.b)?.type === 'junction' || B(st.to.b)?.type === 'junction';
    if (gap <= (jn ? 80 : 40)) par[find(st.from.b)] = find(st.to.b);
  });
  const axisMap = (key, s, lo0, hi0) => {
    if (s === 1) return v => v;
    const units = {};
    parts.forEach(b => {
      const r = find(b.id),
        a = bx[b.id],
        lo = key === 'x' ? a.x0 : a.y0,
        hi = key === 'x' ? a.x1 : a.y1;
      const u = (units[r] = units[r] || { lo, hi });
      u.lo = Math.min(u.lo, lo);
      u.hi = Math.max(u.hi, hi);
    });
    const bands = [];
    Object.values(units)
      .sort((p, q) => p.lo - q.lo)
      .forEach(u => {
        const last = bands[bands.length - 1];
        if (last && u.lo <= last.hi + 1) last.hi = Math.max(last.hi, u.hi);
        else bands.push({ lo: u.lo, hi: u.hi });
      });
    const gaps = bands.slice(1).map((b, i) => b.lo - bands[i].hi),
      G = gaps.reduce((t, g) => t + g, 0);
    if (G <= 0) return v => v; // everything overlaps: nothing can be spread without changing the drawing
    const extra = (hi0 - lo0) * (s - 1),
      off = [0];
    gaps.forEach((g, i) => off.push(Math.round(off[i] + (extra * g) / G)));
    return v => {
      if (v <= bands[0].hi) return v;
      for (let i = 1; i < bands.length; i++) {
        if (v < bands[i].lo) {
          const a = bands[i - 1].hi,
            g = bands[i].lo - a;
          return a + off[i - 1] + ((v - a) / g) * (g + off[i] - off[i - 1]);
        }
        if (v <= bands[i].hi) return v + off[i];
      }
      return v + off[off.length - 1];
    };
  };
  const fx = axisMap('x', sx, x0, x1),
    fy = axisMap('y', sy, y0, y1);
  DOC.blocks.forEach(b => {
    const d = dims(b);
    if (SPAN_TYPES.has(b.type)) {
      // frames, legend and title: stretch with the layout (their content is laid out inside)
      const E = EQ[b.type],
        nx = Math.round(fx(b.x)),
        ny = Math.round(fy(b.y));
      if (/w/.test(E.resize || '') || b.type === 'areaBox') b.w = Math.round(fx(b.x + d.W) - nx);
      if (b.type === 'areaBox') b.h = Math.round(fy(b.y + d.H) - ny);
      b.x = nx;
      b.y = ny;
      return;
    }
    b.x = Math.round(fx(b.x));
    b.y = Math.round(fy(b.y));
  });
  DOC.streams.forEach(st => {
    if (st.pts) st.pts = st.pts.map(p => ({ x: Math.round(fx(p.x)), y: Math.round(fy(p.y)) }));
  });
  // every line: its drawn points carried through the same mapping (ends sit exactly on the moved ports)
  SPREAD.geo = {};
  DOC.streams.forEach(st => {
    const P = shape0[st.id];
    if (!P || P.length < 2) return;
    const a = portOf(B(st.from.b), st.from.p),
      z = portOf(B(st.to.b), st.to.p);
    if (!a || !z) return;
    const Q = P.map(p => ({ x: fx(p.x), y: fy(p.y) }));
    Q[0] = { x: a.x, y: a.y };
    Q[Q.length - 1] = { x: z.x, y: z.y };
    if (Q.length > 2) {
      // keep the first / last run exactly horizontal or vertical against the (rounded) port position
      if (Math.abs(P[0].y - P[1].y) < 0.5) Q[1].y = a.y;
      else if (Math.abs(P[0].x - P[1].x) < 0.5) Q[1].x = a.x;
      const n = Q.length - 1;
      if (Math.abs(P[n].y - P[n - 1].y) < 0.5) Q[n - 1].y = z.y;
      else if (Math.abs(P[n].x - P[n - 1].x) < 0.5) Q[n - 1].x = z.x;
    }
    SPREAD.geo[st.id] = Q;
  });
  SPREAD.orig = O;
  SPREAD.on = true;
  SPREAD.sx = sx;
  SPREAD.sy = sy;
}
/* run something on the ORIGINAL layout (saving, undo snapshots), then spread again */
function spreadSuspend(fn) {
  if (!SPREAD.on) return fn();
  const keep = { sx: SPREAD.sx, sy: SPREAD.sy },
    keepGeo = SPREAD.geo;
  const O = SPREAD.orig;
  // swap to originals, run, swap back exactly (no recalculation, so nothing drifts)
  const now = { b: {}, s: {} };
  DOC.blocks.forEach(b => (now.b[b.id] = { x: b.x, y: b.y, w: b.w, h: b.h, hw: 'w' in b, hh: 'h' in b }));
  DOC.streams.forEach(s => (now.s[s.id] = { pts: s.pts, mid: s.mid }));
  spreadRestore();
  let out;
  try {
    out = fn();
  } finally {
    DOC.blocks.forEach(b => {
      const n = now.b[b.id];
      if (!n) return;
      b.x = n.x;
      b.y = n.y;
      n.hw ? (b.w = n.w) : delete b.w;
      n.hh ? (b.h = n.h) : delete b.h;
    });
    DOC.streams.forEach(s => {
      const n = now.s[s.id];
      if (!n) return;
      s.pts = n.pts;
      s.mid = n.mid;
    });
    SPREAD.orig = O;
    SPREAD.on = true;
    SPREAD.geo = keepGeo;
    Object.assign(SPREAD, keep);
  }
  return out;
}
