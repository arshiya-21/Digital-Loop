/*! SandMan Digital Loop Studio — 05e-publish-page.js
 *  v8.9 — Publish page. In Design the canvas shows a page frame exactly the size of the publish area of the chosen
 *  screen (screen size minus the bottom button bar). The loop is drawn inside it. Publishing shows that page 1 : 1
 *  (100 %) on a screen of that size — same width, height and positions; other screens scale the whole page with one
 *  factor (never stretched). Saved with the flowsheet in DOC.page = { preset, w, h, x, y }. */

const PAGE_PRESETS = {
  fhd: { n: 'Full HD 1920 × 1080', sw: 1920, sh: 1080 },
  hd: { n: 'HD 1366 × 768', sw: 1366, sh: 768 },
  qhd: { n: 'QHD 2560 × 1440', sw: 2560, sh: 1440 },
  uhd: { n: '4K 3840 × 2160', sw: 3840, sh: 2160 },
};
const pageBar = sw => (sw > 1500 ? 54 : 52); // height of the publish button bar at that screen width
function pageSize(preset) {
  if (preset === 'screen') {
    const sw = screen.width,
      sh = screen.height;
    return { w: sw, h: sh - pageBar(sw), n: `This screen ${sw} × ${sh}` };
  }
  const P = PAGE_PRESETS[preset];
  return P ? { w: P.sw, h: P.sh - pageBar(P.sw), n: P.n } : null;
}
const pageOn = () => !!(DOC.page && DOC.page.w && DOC.page.h);
function setPage(preset) {
  if (typeof pushUndo === 'function') pushUndo();
  if (!preset || preset === 'off') DOC.page = null;
  else {
    const S = pageSize(preset);
    const old = DOC.page;
    let x = old ? old.x : null,
      y = old ? old.y : null;
    if (x == null) {
      // first time: the page starts just above-left of the loop
      const b = DOC.blocks.length ? bounds() : { x0: 0, y0: 0 };
      x = Math.floor((b.x0 - 20) / 10) * 10;
      y = Math.floor((b.y0 - 20) / 10) * 10;
    }
    DOC.page = { preset, w: S.w, h: S.h, x, y, n: S.n };
  }
  changed();
  pageSync();
}
/* items not fully inside the page */
function pageOutside() {
  if (!pageOn()) return [];
  const P = DOC.page;
  return DOC.blocks.filter(b => {
    const d = dims(b);
    return b.x < P.x || b.y < P.y || b.x + d.W > P.x + P.w || b.y + d.H > P.y + P.h;
  });
}
/* Design / Simulate: the page frame (outside gently dimmed, dashed edge, label) */
function renderPageFrame() {
  let g = document.getElementById('pgframe');
  const vp = $('#vp');
  if (!vp) return;
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'pgframe';
    const bg = document.getElementById('gridbg');
    vp.insertBefore(g, bg ? bg.nextSibling : vp.firstChild);
  }
  const sel = $('#selPage');
  if (sel && document.activeElement !== sel) sel.value = pageOn() ? DOC.page.preset || 'fhd' : 'off';
  ['bPageMove', 'bPageZoom'].forEach(id => {
    const bt = document.getElementById(id);
    if (bt) bt.disabled = !pageOn();
  });
  if (!pageOn() || PRESENT) return (g.innerHTML = '');
  const P = DOC.page,
    big = 1e5,
    out = pageOutside().length;
  g.innerHTML =
    `<path class="pg-dim" fill-rule="evenodd" d="M${-big} ${-big}H${big}V${big}H${-big}Z M${P.x} ${P.y}H${P.x + P.w}V${P.y + P.h}H${P.x}Z"/>` +
    `<rect class="pg-edge" x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}"/>` +
    `<text class="pg-lbl" x="${P.x}" y="${P.y - 8}">Publish page · ${esc(P.n || '')} · ${P.w} × ${P.h} drawing area${out ? ` · <tspan class="pg-warn">${out} item${out > 1 ? 's' : ''} outside the page</tspan>` : ''}</text>`;
}
/* move the whole loop (equipment, lines, bends) so it starts inside the page */
function moveLoopIntoPage() {
  if (!pageOn() || !DOC.blocks.length) return;
  const P = DOC.page,
    b = bounds(),
    pad = 16;
  const dx = Math.round(P.x + pad - b.x0),
    dy = Math.round(P.y + pad - b.y0);
  pushUndo();
  DOC.blocks.forEach(x => ((x.x += dx), (x.y += dy)));
  DOC.streams.forEach(s => {
    if (s.pts) s.pts = s.pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
    if (s.mid != null && typeof s.mid === 'number') {
      const ax = typeof streamGeom === 'function' ? streamGeom(s)?.axis : null;
      if (ax === 'x') s.mid += dx;
      else if (ax === 'y') s.mid += dy;
    }
  });
  changed();
  const tooW = b.x1 - b.x0 + 2 * pad - P.w,
    tooH = b.y1 - b.y0 + 2 * pad - P.h;
  if (tooW > 0 || tooH > 0)
    toast(`The loop is larger than the page${tooW > 0 ? ` (${Math.ceil(tooW)} px too wide)` : ''}${tooH > 0 ? ` (${Math.ceil(tooH)} px too tall)` : ''} — rearrange it, or choose a larger page`);
  else toast('Loop moved into the publish page');
}
function zoomToPage() {
  if (!pageOn()) return;
  const r = $('#cwrap').getBoundingClientRect(),
    P = DOC.page;
  const k = clamp(Math.min((r.width - 60) / P.w, (r.height - 60) / P.h), 0.1, 2);
  animateView({ k, tx: (r.width - P.w * k) / 2 - P.x * k, ty: (r.height - P.h * k) / 2 - P.y * k });
}
function pageSync() {
  const sel = $('#selPage');
  if (sel) sel.value = pageOn() ? DOC.page.preset || 'fhd' : 'off';
  ['bPageMove', 'bPageZoom'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = !pageOn();
  });
  renderPageFrame();
}
(() => {
  const sel = $('#selPage');
  if (sel) sel.onchange = () => setPage(sel.value);
  const mv = document.getElementById('bPageMove');
  if (mv) mv.onclick = moveLoopIntoPage;
  const zm = document.getElementById('bPageZoom');
  if (zm) zm.onclick = zoomToPage;
})();
