/*! SandMan Digital Loop Studio — 05d-present-view.js
 *  v8.0 — Publish view sizing, one place for all of it. Positions and lines are never changed (no spreading); Whole loop
 *  and Fit width keep true proportions; Fill screen (v8.1) fills the whole area. The diagram area is the canvas wrapper (between the top of the window and the
 *  bottom control bar); nothing floats over the diagram.
 *    Fill screen  — full screen; the drawing fills the whole area (width and height scaled separately, ≤ 1.45×; text upright)
 *    Whole loop   — the whole loop with comfortable margins, centred
 *    Fit width    — the loop fills the width; when it is taller than the screen, drag / mouse-wheel moves up and down
 *    − % + / Fit  — manual zoom (drag or wheel to move); Fit returns to the chosen mode
 *  A resize observer refits in the chosen mode (manual zoom keeps its scale and centre) — once per size change,
 *  so there is no flicker and no creeping zoom. */

const PVIEW = { manual: false, w: 0, h: 0 };
const pMode = () => (['fill', 'page', 'width'].includes(PREF.pfit) ? PREF.pfit : 'fill');
function presentArea() {
  const r = $('#cwrap').getBoundingClientRect();
  return { W: r.width, H: r.height };
}
/* fit the loop for a mode (uniform scale) */
function presentFit() {
  /* v8.7 — the published flow exactly as designed ("contain" fit):
     · one scale factor for width and height — never stretched, squashed, moved or rearranged
     · the largest scale at which the COMPLETE drawn flow fits (measured on the drawn pixels, labels included),
       up to 300 % on big screens (vector, stays sharp)
     · centred both ways, so spare space is shared equally; shown on a framed sheet (presentSheet)
     · refitted on every resize (resize observer) — same result for the same size */
  const r = $('#cwrap').getBoundingClientRect();
  if (!DOC.blocks.length || r.width < 10 || r.height < 10) return;
  if (typeof afRefit === 'function' && afRefit()) return; // v9.20 — one area is shown: keep showing it (05f-area-focus.js)
  if (typeof pageOn === 'function' && pageOn()) {
    // v8.9 — publish page: the page fills the publish area (1 : 1 on a screen of that size), one scale, centred
    const P = DOC.page;
    const k = clamp(Math.min(r.width / P.w, r.height / P.h), 0.1, 4);
    cancelAnimationFrame(VIEWANIM);
    Object.assign(VIEW, { k: Math.abs(k - 1) < 0.002 ? 1 : k, ky: null, tx: 0, ty: 0 });
    VIEW.tx = (r.width - P.w * VIEW.k) / 2 - P.x * VIEW.k;
    VIEW.ty = (r.height - P.h * VIEW.k) / 2 - P.y * VIEW.k;
    PVIEW.manual = false;
    applyView();
    presentSheet(null);
    presentSync();
    return;
  }
  const M = 8; // v8.8: as large as fits — small even margin
  const { x0, y0, x1, y1 } = bounds();
  let k = clamp(Math.min((r.width - 2 * M) / Math.max(1, x1 - x0), (r.height - 2 * M) / Math.max(1, y1 - y0)), 0.1, 3);
  cancelAnimationFrame(VIEWANIM);
  Object.assign(VIEW, { k, ky: null, tx: (r.width - (x1 - x0) * k) / 2 - x0 * k, ty: (r.height - (y1 - y0) * k) / 2 - y0 * k });
  PVIEW.manual = false;
  applyView();
  // correct on what is really drawn (names / value labels can reach past the estimate) — uniform, then centre
  let box = null;
  for (let pass = 0; pass < 4; pass++) {
    box = presentDrawn(r);
    if (!box) break;
    const s = Math.min((r.width - 2 * M) / box.w, (r.height - 2 * M) / box.h, 3 / VIEW.k);
    const cx = box.x + box.w / 2,
      cy = box.y + box.h / 2;
    const wx = (cx - VIEW.tx) / VIEW.k,
      wy = (cy - VIEW.ty) / VIEW.k;
    const k2 = VIEW.k * s;
    const tx2 = r.width / 2 - wx * k2,
      ty2 = r.height / 2 - wy * k2;
    if (Math.abs(s - 1) < 0.0015 && Math.abs(tx2 - VIEW.tx) < 0.5 && Math.abs(ty2 - VIEW.ty) < 0.5) break;
    Object.assign(VIEW, { k: k2, tx: tx2, ty: ty2 });
    applyView();
  }
  presentSheet(null); // v8.8: published canvas looks exactly like the design canvas (no frame / dimming)
  presentSync();
}
/* the drawn flow's box on screen, relative to the canvas area */
function presentDrawn(r) {
  let a = Infinity,
    b = Infinity,
    c = -Infinity,
    d = -Infinity;
  ['#Lzones', '#Lstreams', '#Lblocks', '#Ltags'].forEach(sel => {
    const el = $(sel);
    if (!el || !el.childElementCount) return;
    const q = el.getBoundingClientRect();
    if (!q.width && !q.height) return;
    a = Math.min(a, q.left - r.left);
    b = Math.min(b, q.top - r.top);
    c = Math.max(c, q.right - r.left);
    d = Math.max(d, q.bottom - r.top);
  });
  return isFinite(a) && c - a > 10 && d - b > 10 ? { x: a, y: b, w: c - a, h: d - b } : null;
}
/* the published sheet: a soft frame around the finalised flow; the space outside it gently dimmed */
function presentSheet(box) {
  let g = document.getElementById('psheet');
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'psheet';
    const vp = $('#vp'),
      bg = document.getElementById('gridbg');
    vp.insertBefore(g, bg ? bg.nextSibling : vp.firstChild);
  }
  if (!box || !PRESENT) return (g.innerHTML = '');
  const P = 12; // sheet padding around the flow (screen px)
  const k = VIEW.k,
    X = (box.x - P - VIEW.tx) / k,
    Y = (box.y - P - VIEW.ty) / k,
    W = (box.w + 2 * P) / k,
    H = (box.h + 2 * P) / k,
    rr = 10 / k;
  const big = 1e5;
  g.innerHTML =
    `<path class="ps-dim" fill-rule="evenodd" d="M${-big} ${-big}H${big}V${big}H${-big}Z M${X + rr} ${Y}H${X + W - rr}A${rr} ${rr} 0 0 1 ${X + W} ${Y + rr}V${Y + H - rr}A${rr} ${rr} 0 0 1 ${X + W - rr} ${Y + H}H${X + rr}A${rr} ${rr} 0 0 1 ${X} ${Y + H - rr}V${Y + rr}A${rr} ${rr} 0 0 1 ${X + rr} ${Y}Z"/>` +
    `<rect class="ps-edge" x="${X}" y="${Y}" width="${W}" height="${H}" rx="${rr}" stroke-width="${1 / k}"/>`;
}
/* keep the loop on screen when it is larger than the area (pan limits); centre it on an axis where it fits */
function presentClamp() {
  const { W, H } = presentArea();
  const { x0, y0, x1, y1 } = bounds(),
    pad = 10;
  const cw = (x1 - x0) * VIEW.k,
    ch = (y1 - y0) * VIEW.k;
  if (cw <= W - 2 * pad) VIEW.tx = (W - cw) / 2 - x0 * VIEW.k;
  else VIEW.tx = Math.min(pad - x0 * VIEW.k, Math.max(W - pad - x1 * VIEW.k, VIEW.tx));
  if (ch <= H - 2 * pad) {
    if (PVIEW.manual || pMode() !== 'width') VIEW.ty = (H - ch) / 2 - y0 * VIEW.k;
  } else VIEW.ty = Math.min(pad - y0 * VIEW.k, Math.max(H - pad - y1 * VIEW.k, VIEW.ty));
}
const presentCanPan = () => false; // v8.2: one fitted view — nothing to move
const presentCanPanOld = () => {
  const { W, H } = presentArea(),
    { x0, y0, x1, y1 } = bounds();
  return (x1 - x0) * VIEW.k > W - 20 || (y1 - y0) * (VIEW.ky || VIEW.k) > H - 20;
};
function presentZoom(f) {
  const { W, H } = presentArea();
  if (VIEW.ky) {
    // leaving the filled (scaled) view: continue from true proportions around the same centre
    const k0 = Math.min(VIEW.k, VIEW.ky),
      cx = (W / 2 - VIEW.tx) / VIEW.k,
      cy = (H / 2 - VIEW.ty) / VIEW.ky;
    Object.assign(VIEW, { k: k0, ky: null, tx: W / 2 - cx * k0, ty: H / 2 - cy * k0 });
  }
  const k = clamp(VIEW.k * f, 0.1, 6);
  VIEW.tx = W / 2 - ((W / 2 - VIEW.tx) / VIEW.k) * k;
  VIEW.ty = H / 2 - ((H / 2 - VIEW.ty) / VIEW.k) * k;
  VIEW.k = k;
  VIEW.ky = null;
  PVIEW.manual = true;
  presentClamp();
  applyView();
  presentSync();
}
function presentSetMode(m) {
  PREF.pfit = m;
  savePref();
  if (m === 'fill' && typeof setFull === 'function' && !document.fullscreenElement) setFull(true, true); // full screen: more room
  presentFit(m);
  requestAnimationFrame(() => requestAnimationFrame(() => presentFit(m))); // again once full screen has settled
}
/* bottom bar: active mode, zoom %, pan cursor */
function presentSync() {
  const m = pMode();
  document.querySelectorAll('#pView [data-pv]').forEach(b => b.classList.toggle('on', !PVIEW.manual && b.dataset.pv === m));
  const z = $('#pZoomV');
  if (z) z.textContent = Math.round(VIEW.k * 100) + '%';
  $('#cwrap')?.classList.toggle('pcanpan', PRESENT && presentCanPan());
}
/* wiring */
(() => {
  const bar = $('#pView');
  if (bar)
    bar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.pv) presentSetMode(b.dataset.pv);
      else if (b.id === 'pZoomIn') presentZoom(1.2);
      else if (b.id === 'pZoomOut') presentZoom(1 / 1.2);
    });
  // resize: refit in the chosen mode (manual zoom keeps scale and centre); only when the size really changed
  let raf = 0;
  new ResizeObserver(() => {
    if (!PRESENT) return;
    const { W, H } = presentArea();
    if (Math.abs(W - PVIEW.w) < 1 && Math.abs(H - PVIEW.h) < 1) return;
    const ow = PVIEW.w,
      oh = PVIEW.h;
    PVIEW.w = W;
    PVIEW.h = H;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!PVIEW.manual || !ow) {
        presentArrange(); // v8.3: the panels follow the new screen shape
        renderAll();
        presentFit();
      }
      else {
        VIEW.tx += (W - ow) / 2;
        VIEW.ty += (H - oh) / 2;
        presentClamp();
        applyView();
        presentSync();
      }
    });
  }).observe($('#cwrap'));
})();

/* ---------- v8.3 — publish view arranges the HMI panels for the screen's shape ----------
   The process (equipment, instruments, lines, title, clock, buttons beside equipment) stays exactly as drawn. The
   large HMI panels (legend, control panels, status tables, request stations, notices) are placed into the free space
   around the process — each as close as possible to its drawn position — inside a frame that has the screen's own
   shape. That frame is then fitted at true proportions, so the screen is filled with no blank side bands, nothing
   stretched and nothing cut off. Temporary: saving, undo and leaving publish always use the drawn layout (SPREAD). */
const PANEL_TYPES = new Set(['legend', 'controlPanel', 'statusMatrix', 'requestStation', 'notice', 'note', 'textBox', 'tagTable', 'kpiPanel']);
const isPanel = b => PANEL_TYPES.has(b.type) && !DOC.streams.some(s => s.from.b === b.id || s.to.b === b.id);
function presentArrange() {
  if (typeof spreadRestore === 'function') spreadRestore();
  PVIEW.box = null;
  return; // v8.4: the original publish view shows the design exactly as drawn (panels are not rearranged)
  if (!PRESENT || !DOC.blocks.length) return;
  const panels = DOC.blocks.filter(isPanel);
  const { W, H } = presentArea();
  if (W < 50 || H < 50 || !panels.length) return;
  const A = (W - 20) / (H - 20); // the screen's shape
  // what stays: everything else, plus every line (its drawn shape is frozen while the panels move)
  const fixed = DOC.blocks.filter(b => !panels.includes(b));
  const shape0 = {};
  DOC.streams.forEach(st => {
    try {
      const G = streamGeom(st);
      if (G) shape0[st.id] = G.pts.map(p => ({ x: p.x, y: p.y }));
    } catch (e) {}
  });
  const rect = b => {
    const d = dims(b);
    return { x0: b.x, y0: b.y, x1: b.x + d.W, y1: b.y + d.H };
  };
  let cx0 = Infinity,
    cy0 = Infinity,
    cx1 = -Infinity,
    cy1 = -Infinity;
  const grow = r => ((cx0 = Math.min(cx0, r.x0)), (cy0 = Math.min(cy0, r.y0)), (cx1 = Math.max(cx1, r.x1)), (cy1 = Math.max(cy1, r.y1)));
  fixed.forEach(b => grow(rect(b)));
  Object.values(shape0).forEach(P => P.forEach(p => grow({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })));
  if (!isFinite(cx0)) return;
  // occupancy grid (10 px cells) of the process and its lines
  const C = 10,
    PAD = 14;
  const span = Math.max(cx1 - cx0, (cy1 - cy0) * A) * 2.4 + 400,
    gx0 = Math.floor((cx0 + cx1) / 2 - span / 2),
    gy0 = Math.floor((cy0 + cy1) / 2 - span / A / 2);
  const GW = Math.ceil(span / C) + 2,
    GH = Math.ceil(span / A / C) + 2;
  const occ = new Uint8Array(GW * GH);
  const mark = (x0, y0, x1, y1) => {
    const a = Math.max(0, Math.floor((x0 - gx0) / C)),
      b = Math.max(0, Math.floor((y0 - gy0) / C)),
      c = Math.min(GW - 1, Math.floor((x1 - gx0) / C)),
      d = Math.min(GH - 1, Math.floor((y1 - gy0) / C));
    for (let j = b; j <= d; j++) for (let i = a; i <= c; i++) occ[j * GW + i] = 1;
  };
  fixed.forEach(b => {
    const r = rect(b);
    mark(r.x0 - PAD, r.y0 - PAD - (EQ[b.type].widget ? 0 : 16), r.x1 + PAD, r.y1 + PAD); // room for the name above equipment
  });
  // tag value labels and other overlays beside equipment
  $$('#Lblocks .tagb, #Lblocks .bname').forEach(el => {
    try {
      const bb = el.getBBox(),
        m = el.getCTM && el.closest('svg') ? el.getCTM() : null,
        v = document.getElementById('vp').getCTM();
      if (!m || !v) return;
      const inv = v.inverse().multiply(m);
      const p1 = new DOMPoint(bb.x, bb.y).matrixTransform(inv),
        p2 = new DOMPoint(bb.x + bb.width, bb.y + bb.height).matrixTransform(inv);
      mark(Math.min(p1.x, p2.x) - 6, Math.min(p1.y, p2.y) - 6, Math.max(p1.x, p2.x) + 6, Math.max(p1.y, p2.y) + 6);
    } catch (e) {}
  });
  Object.values(shape0).forEach(P => {
    for (let i = 1; i < P.length; i++) mark(Math.min(P[i - 1].x, P[i].x) - 8, Math.min(P[i - 1].y, P[i].y) - 8, Math.max(P[i - 1].x, P[i].x) + 8, Math.max(P[i - 1].y, P[i].y) + 8);
  });
  // free-space lookups in O(1) with a summed-area table
  const sat = new Int32Array((GW + 1) * (GH + 1));
  for (let j = 0; j < GH; j++)
    for (let i = 0, row = 0; i < GW; i++) {
      row += occ[j * GW + i];
      sat[(j + 1) * (GW + 1) + i + 1] = sat[j * (GW + 1) + i + 1] + row;
    }
  const busy = (a, b, c, d) => sat[d * (GW + 1) + c] - sat[b * (GW + 1) + c] - sat[d * (GW + 1) + a] + sat[b * (GW + 1) + a]; // cells [a,c) × [b,d)
  // the frame: the process box widened / heightened to the screen's shape; it grows only if the panels do not fit
  let bw = cx1 - cx0,
    bh = cy1 - cy0;
  if (bw / bh < A) bw = bh * A;
  else bh = bw / A;
  const ccx = (cx0 + cx1) / 2,
    ccy = (cy0 + cy1) / 2;
  const order = panels.slice().sort((p, q) => dims(q).W * dims(q).H - dims(p).W * dims(p).H);
  let placed = null;
  for (let it = 0; it < 40 && !placed; it++) {
    const fx0 = ccx - bw / 2,
      fy0 = ccy - bh / 2,
      fx1 = ccx + bw / 2,
      fy1 = ccy + bh / 2;
    const taken = new Uint8Array(occ); // panels placed in this attempt also take space
    const tmark = (a, b, c, d) => {
      for (let j = b; j < d; j++) for (let i = a; i < c; i++) taken[j * GW + i] = 1;
    };
    let tsat = sat;
    const res = {};
    let okAll = true;
    for (const pnl of order) {
      const d = dims(pnl),
        wc = Math.ceil((d.W + 2 * PAD) / C),
        hc = Math.ceil((d.H + 2 * PAD) / C);
      const ia = Math.ceil((fx0 - gx0) / C),
        ja = Math.ceil((fy0 - gy0) / C),
        ib = Math.floor((fx1 - gx0) / C) - wc,
        jb = Math.floor((fy1 - gy0) / C) - hc;
      const ox = (pnl.x - PAD - gx0) / C,
        oy = (pnl.y - PAD - gy0) / C;
      let best = null;
      for (let j = Math.max(0, ja); j <= Math.min(GH - hc - 1, jb); j++)
        for (let i = Math.max(0, ia); i <= Math.min(GW - wc - 1, ib); i++) {
          const dd = (i - ox) * (i - ox) + (j - oy) * (j - oy);
          if (best && dd >= best.dd) continue;
          const s = tsat[(j + hc) * (GW + 1) + i + wc] - tsat[j * (GW + 1) + i + wc] - tsat[(j + hc) * (GW + 1) + i] + tsat[j * (GW + 1) + i];
          if (!s) best = { i, j, dd };
        }
      if (!best) {
        okAll = false;
        break;
      }
      res[pnl.id] = { x: Math.round(gx0 + best.i * C + PAD), y: Math.round(gy0 + best.j * C + PAD) };
      tmark(best.i, best.j, best.i + wc, best.j + hc);
      // rebuild the lookup with this panel taken
      tsat = new Int32Array((GW + 1) * (GH + 1));
      for (let j = 0; j < GH; j++)
        for (let i = 0, row = 0; i < GW; i++) {
          row += taken[j * GW + i];
          tsat[(j + 1) * (GW + 1) + i + 1] = tsat[j * (GW + 1) + i + 1] + row;
        }
    }
    if (okAll) placed = { res, box: { x0: fx0, y0: fy0, x1: fx1, y1: fy1 } };
    else {
      bw *= 1.04;
      bh *= 1.04;
    }
  }
  if (!placed) return;
  // apply (temporary — restored on leave / save / undo)
  const O = { b: {}, s: {} };
  DOC.blocks.forEach(b => (O.b[b.id] = { x: b.x, y: b.y, ...('w' in b ? { w: b.w } : { w: null }), ...('h' in b ? { h: b.h } : { h: null }) }));
  DOC.streams.forEach(st => (O.s[st.id] = { pts: st.pts ? st.pts.map(p => ({ ...p })) : null, mid: st.mid }));
  Object.entries(placed.res).forEach(([id, p]) => {
    const b = B(id);
    b.x = p.x;
    b.y = p.y;
  });
  SPREAD.orig = O;
  SPREAD.geo = shape0; // lines keep their drawn shape (the process did not move)
  SPREAD.on = true;
  SPREAD.sx = SPREAD.sy = 1;
  // the frame to fit: everything as the app measures it (incl. names and value labels beside equipment), in the screen's shape
  const ub = bounds();
  let w2 = ub.x1 - ub.x0,
    h2 = ub.y1 - ub.y0;
  const mx = (ub.x0 + ub.x1) / 2,
    my = (ub.y0 + ub.y1) / 2;
  if (w2 / h2 < A) w2 = h2 * A;
  else h2 = w2 / A;
  PVIEW.box = { x0: mx - w2 / 2, y0: my - h2 / 2, x1: mx + w2 / 2, y1: my + h2 / 2 };
}
