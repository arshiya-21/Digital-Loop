/*! SandMan Process Flowsheet — 04-canvas.js
 *  SVG rendering, HMI widget commands, canvas interaction (select, move, resize, connect, context menu, keyboard)
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===== Rendering ===== */
/* v1.3 — mouse style: 'studio' (desktop design work, like SandMan Loop Studio) or 'touch' (touch-screen HMI, v1.1
   behaviour). Studio: drag on empty canvas = selection box, Space + drag / middle button = pan, left-click selects,
   right-click opens the item menu, Ctrl+] / Ctrl+[ = front / back. Whole-layout lock: DOC.lockAll. */
function studioMouse() {
  try {
    return PREF.mouse !== 'touch';
  } catch (e) {
    return true; // preferences not loaded yet
  }
}
function layoutLocked() {
  return MODE === 'design' && !!DOC.lockAll;
}
let LOCKTOAST = 0;
function lockedNotice() {
  if (!layoutLocked()) return false;
  if (Date.now() - LOCKTOAST > 1500) {
    toast('The layout is locked — unlock it (🔒 in the toolbar) to edit');
    LOCKTOAST = Date.now();
  }
  return true;
}
function toggleLockAll() {
  if (MODE !== 'design') {
    toast('Switch to Design mode to lock or unlock the layout');
    return;
  }
  DOC.lockAll = !DOC.lockAll;
  if (!DOC.lockAll) delete DOC.lockAll;
  logEv(DOC.lockAll ? 'Layout locked' : 'Layout unlocked');
  changed();
  toast(DOC.lockAll ? 'Layout locked — nothing can be moved, resized or deleted' : 'Layout unlocked — editing is on');
}
let SPACE = false;
/* v1.14 — line appearance, same choices as the Loop Studio: start / end symbol, line style, width and colour.
   Saved on the stream (s.startSym, s.endSym, s.dash, s.width, s.color); unset = the default look (filled
   arrow at the end, style by line type). */
const LINE_SYMS = {
  none: 'None',
  arrow: 'Classic arrow',
  open: 'Open arrow',
  triangle: 'Filled triangle',
  hollow: 'Hollow triangle',
  circle: 'Filled circle',
  ring: 'Hollow circle',
  diamond: 'Filled diamond',
  diamondOpen: 'Hollow diamond',
  bar: 'Bar',
};
const LINE_DASH = { solid: ['Solid', ''], dashed: ['Dashed', '9 6'], dotted: ['Dotted', '1 5'], dashdot: ['Dash-dot', '10 5 1 5'] };
function lineMarker(id, type, color) {
  if (!type || type === 'none') return '';
  const sh = {
    arrow: '<path d="M1 1L9 5L1 9L3 5Z"/>',
    open: '<path d="M1 1L9 5L1 9" fill="none"/>',
    triangle: '<path d="M1 1L9 5L1 9Z"/>',
    hollow: '<path d="M1 1L9 5L1 9Z" fill="#fff"/>',
    circle: '<circle cx="5" cy="5" r="3.5"/>',
    ring: '<circle cx="5" cy="5" r="3.5" fill="#fff"/>',
    diamond: '<path d="M1 5L5 1L9 5L5 9Z"/>',
    diamondOpen: '<path d="M1 5L5 1L9 5L5 9Z" fill="#fff"/>',
    bar: '<path d="M8 1V9" fill="none"/>',
  }[type];
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><g fill="${color}" stroke="${color}" stroke-width="1.2" stroke-linejoin="round">${sh || ''}</g></marker>`;
}
function buildDefs() {
  $('#mk').innerHTML =
    `<pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--dot)"/></pattern>` +
    Object.entries(KIND)
      .map(
        ([k, o]) =>
          `<marker id="ar-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M0 0L10 5L0 10z" fill="${o.c}"/></marker>`,
      )
      .join('');
}
function route(a, b, mid) {
  const d = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] },
    H = s => s === 'l' || s === 'r',
    G = 6;
  if (
    H(a.side) &&
    H(b.side) &&
    ((a.side === 'r' && b.side === 'l' && b.x > a.x + G) ||
      (a.side === 'l' && b.side === 'r' && b.x < a.x - G))
  ) {
    const mx = mid ?? (a.x + b.x) / 2;
    return { pts: [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b], axis: 'x', seg: 1 };
  }
  if (
    !H(a.side) &&
    !H(b.side) &&
    ((a.side === 'b' && b.side === 't' && b.y > a.y + G) ||
      (a.side === 't' && b.side === 'b' && b.y < a.y - G))
  ) {
    const my = mid ?? (a.y + b.y) / 2;
    return { pts: [a, { x: a.x, y: my }, { x: b.x, y: my }, b], axis: 'y', seg: 1 };
  }
  if (
    mid == null &&
    H(a.side) &&
    !H(b.side) &&
    (a.side === 'r' ? b.x > a.x : b.x < a.x) &&
    (b.side === 't' ? a.y < b.y : a.y > b.y)
  )
    return { pts: [a, { x: b.x, y: a.y }, b], axis: null };
  if (
    mid == null &&
    !H(a.side) &&
    H(b.side) &&
    (a.side === 'b' ? b.y > a.y : b.y < a.y) &&
    (b.side === 'l' ? a.x < b.x : a.x > b.x)
  )
    return { pts: [a, { x: a.x, y: b.y }, b], axis: null };
  const S = 12,
    s1 = { x: a.x + d[a.side][0] * S, y: a.y + d[a.side][1] * S },
    s2 = { x: b.x + d[b.side][0] * S, y: b.y + d[b.side][1] * S };
  if (H(a.side)) {
    const mx = mid ?? (s1.x + s2.x) / 2;
    return { pts: [a, s1, { x: mx, y: s1.y }, { x: mx, y: s2.y }, s2, b], axis: 'x', seg: 2 };
  }
  const my = mid ?? (s1.y + s2.y) / 2;
  return { pts: [a, s1, { x: s1.x, y: my }, { x: s2.x, y: my }, s2, b], axis: 'y', seg: 2 };
}
function streamGeom(s) {
  const fb = B(s.from.b),
    tb = B(s.to.b);
  if (!fb || !tb) return null;
  const a = portOf(fb, s.from.p),
    b = portOf(tb, s.to.p);
  if (!a || !b) return null;
  // v7.3: publish "Fill screen" keeps the drawn shape of every line (no re-routing)
  if (typeof SPREAD !== 'undefined' && SPREAD.on && SPREAD.geo && SPREAD.geo[s.id]) {
    const pts = SPREAD.geo[s.id];
    const segs = pts.length - 1;
    let mi = 0, L = -1;
    for (let i = 0; i < segs; i++) {
      const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (l > L) ((L = l), (mi = i));
    }
    return { pts, raw: pts, seg: mi, axis: Math.abs(pts[mi].y - pts[mi + 1].y) < 0.5 ? 'y' : 'x', d: roundedD(pts, routeOf(s) === 'curve' ? 0 : 7) };
  }
  const R = typeof streamPath === 'function' ? streamPath(s, a, b) : route(a, b, s.mid); // v3.7 routing modes
  const pts = R.pts.filter((p, i) => i === 0 || p.x !== R.pts[i - 1].x || p.y !== R.pts[i - 1].y);
  return { ...R, raw: R.pts, pts, d: roundedD(pts, routeOf(s) === 'curve' ? 0 : 7) };
}
/* v7.1 — line path with rounded corners (radius r, never more than half of either neighbouring segment) */
function roundedD(pts, r) {
  if (!r || pts.length < 3) return 'M' + pts.map(p => `${p.x} ${p.y}`).join('L');
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1],
      p = pts[i],
      c = pts[i + 1];
    const l1 = Math.hypot(p.x - a.x, p.y - a.y),
      l2 = Math.hypot(c.x - p.x, c.y - p.y);
    const k = Math.min(r, l1 / 2, l2 / 2);
    if (k < 0.5) {
      d += `L${p.x} ${p.y}`;
      continue;
    }
    const ax = p.x + ((a.x - p.x) / l1) * k,
      ay = p.y + ((a.y - p.y) / l1) * k,
      cx = p.x + ((c.x - p.x) / l2) * k,
      cy = p.y + ((c.y - p.y) / l2) * k;
    d += `L${+ax.toFixed(2)} ${+ay.toFixed(2)}Q${p.x} ${p.y} ${+cx.toFixed(2)} ${+cy.toFixed(2)}`;
  }
  const z = pts[pts.length - 1];
  return d + `L${z.x} ${z.y}`;
}
/* v7.1 — small direction chevrons along longer straight runs, so the flow direction is clear at a glance */
function lineChevrons(G, col, skip) {
  let h = '';
  for (let i = 1; i < G.pts.length; i++) {
    const a = G.pts[i - 1],
      b = G.pts[i],
      L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 110) continue;
    const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      at = i === skip ? (L >= 220 ? [0.22, 0.78] : []) : [0.5];
    at.forEach(t => {
      const x = a.x + (b.x - a.x) * t,
        y = a.y + (b.y - a.y) * t;
      h += `<path class="chev" d="M-3.2 -3.6L2.4 0L-3.2 3.6" transform="translate(${+x.toFixed(1)} ${+y.toFixed(1)}) rotate(${+ang.toFixed(1)})" stroke="${col}"/>`;
    });
  }
  return h;
}
function streamFlows(s) {
  const fb = B(s.from.b);
  if (!fb || fb.props.oos) return false;
  if (fb.type === 'junction') {
    return srcBlocks(fb).some(isRun);
  }
  return true;
}
function streamSVG(s) {
  const G = streamGeom(s);
  if (!G) return '';
  const c = KIND[s.kind]?.c || '#888',
    sel = SEL && SEL.t === 's' && SEL.id === s.id;
  let best = 0,
    mi = 1;
  for (let i = 1; i < G.pts.length; i++) {
    const L = Math.abs(G.pts[i].x - G.pts[i - 1].x) + Math.abs(G.pts[i].y - G.pts[i - 1].y);
    if (L > best) {
      best = L;
      mi = i;
    }
  }
  const mx = (G.pts[mi].x + G.pts[mi - 1].x) / 2,
    my = (G.pts[mi].y + G.pts[mi - 1].y) / 2,
    horiz = G.pts[mi].y === G.pts[mi - 1].y,
    showLbl = (MODE === 'design' && (PREF.lines || sel)) || s.tag;
  const lbl =
    s.tag && REG[s.tag] && MODE === 'monitor'
      ? `${fmtN(val(s.tag), REG[s.tag].d)} ${REG[s.tag].unit}`
      : s.name;
  const toJ = B(s.to.b)?.type === 'junction';
  let h = '';
  const hs = HS();
  if (sel && MODE === 'design') h = typeof routeHandles === 'function' ? routeHandles(s, G, hs) : ''; // v3.7 bend + segment handles
  if (sel && MODE === 'design') {
    const a = G.pts[0],
      z = G.pts[G.pts.length - 1];
    h += `<rect class="se" data-se="from" data-s="${s.id}" x="${a.x - hs / 2}" y="${a.y - hs / 2}" width="${hs}" height="${hs}" rx="2"><title>Drag to move the start of this line</title></rect><rect class="se" data-se="to" data-s="${s.id}" x="${z.x - hs / 2}" y="${z.y - hs / 2}" width="${hs}" height="${hs}" rx="2"><title>Drag to move the end of this line</title></rect>`;
  }
  const lc = s.color || c,
    custom = s.startSym || s.endSym || s.color;
  const endSym = s.endSym || (toJ ? 'none' : 'triangle');
  const defs = custom ? `<defs>${lineMarker('lm-s-' + s.id, s.startSym, lc)}${lineMarker('lm-e-' + s.id, endSym, lc)}</defs>` : '';
  const ends = custom
    ? `${s.startSym && s.startSym !== 'none' ? `marker-start="url(#lm-s-${s.id})"` : ''} ${endSym !== 'none' ? `marker-end="url(#lm-e-${s.id})"` : ''}`
    : toJ
      ? ''
      : `marker-end="url(#ar-${s.kind})"`;
  const look = [s.dash ? `stroke-dasharray:${LINE_DASH[s.dash]?.[1] || 'none'}` : '', s.width ? `stroke-width:${s.width}px` : ''].filter(Boolean).join(';');
  const fxs = typeof flowStyleOf === 'function' ? flowStyleOf(s) : 'default';
  return `<g class="stream k-${s.kind}${sel ? ' sel' : ''} fx-${fxs}" data-s="${s.id}" id="st_${s.id}">${defs}${typeof flowUnder === 'function' ? flowUnder(s, G, fxs) : ''}<path class="hitp" d="${G.d}"/><path class="vis" id="sv_${s.id}" d="${G.d}" stroke="${lc}" ${ends}${look ? ` style="${look}"` : ''}/>${PREF.chev === false || toJ ? '' : lineChevrons(G, lc, mi)}<path class="fl" d="${G.d}"/>${typeof flowOver === 'function' ? flowOver(s, G, fxs) : ''}${showLbl && best > 44 ? `<text id="stl_${s.id}" x="${mx + (horiz ? 0 : 5)}" y="${my + (horiz ? -4 : 3)}" text-anchor="${horiz ? 'middle' : 'start'}">${esc(lbl)}</text>` : ''}${h}</g>`;
}
function blockSVG(b) {
  const E = EQ[b.type];
  if (!E) return '';
  const st = bState(b),
    sel = (SEL && SEL.t === 'b' && SEL.id === b.id) || SELM.has(b.id),
    { w, h, W, H } = dims(b),
    ss = symState(b);
  const run = effRun(b);
  let s = `<g class="blk t-${b.type}${run ? ' run' : ''}${st ? ' ph-' + st : ''}${sel ? ' sel-b' : ''}${CONNSRC && CONNSRC.b === b.id ? ' srcpick' : ''}${TPATH.has(b.id) ? ' traced' : ''}" data-b="${b.id}" id="bk_${b.id}" transform="translate(${b.x},${b.y})"><rect class="hit" x="-5" y="-5" width="${W + 10}" height="${H + 10}"/><g class="halo-l" id="ha_${b.id}"></g>`;
  if (sel) s += `<rect class="selbox" x="-4" y="-4" width="${W + 8}" height="${H + 8}" rx="4"/>`;
  if (b.lock && MODE === 'design')
    s += `<g class="lockb" transform="translate(${W - 10},-17)" pointer-events="none"><rect x="0" y="0" width="15" height="15" rx="3.5" fill="var(--muted)"/><path d="M4.7 7V5.6a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="#fff" stroke-width="1.4"/><rect x="3.6" y="6.7" width="7.8" height="5.6" rx="1.3" fill="#fff"/><title>Position locked</title></g>`;
  const dd = drawDims(b),
    stretch = dd.sx !== 1 || dd.sy !== 1;
  s += `<g class="sym" transform="${symTf(b)}">${stretch ? `<g transform="scale(${dd.sx} ${dd.sy})">` : ''}${E.draw(dd.dw, dd.dh, ss, b, b.id)}<g class="dyn" id="dy_${b.id}">${E.dyn ? E.dyn(dd.dw, dd.dh, ss, b) : ''}</g>${stretch ? '</g>' : ''}</g>`;
  if (!E.widget && !E.inst && b.type !== 'junction' && !b.props.hideName)
    s += `<text class="bname" id="bn_${b.id}" x="${W / 2}" y="-6" text-anchor="middle">${bnameInner(b, st)}</text>`;
  if (MODE === 'design') {
    const pr = PR(),
      off = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
    ports(b).forEach(p => {
      const un = !portLinks(b.id, p.id).length,
        o = off[p.side],
        fs = FS();
      if (b.type !== 'junction')
        s += `<text class="plabel" x="${p.lx + o[0] * (pr + 3)}" y="${p.ly + o[1] * (pr + fs * 0.4) + fs * 0.35}" text-anchor="${o[0] < 0 ? 'end' : o[0] > 0 ? 'start' : 'middle'}" style="font-size:${fs}px">${p.id}</text>`;
      s += `<circle class="port${p.req ? ' req' : ''}${un ? ' un' : ''}" data-b="${b.id}" data-p="${p.id}" cx="${p.lx}" cy="${p.ly}" r="${b.type === 'junction' ? pr * 0.8 : pr}" fill="${KIND[p.kind].c}"><title>${p.id} · ${p.dir === 'in' ? 'inlet' : p.dir === 'out' ? 'outlet' : 'in/out'} · ${KIND[p.kind].n}${p.req ? ' · required' : ''}</title></circle>`;
    });
    const dp = typeof dataPort === 'function' ? dataPort(b) : null;
    if (dp) {
      const used = portLinks(b.id, '@data').length,
        r = pr * 0.95;
      s += `<path class="port dport${used ? ' used' : ''}" data-b="${b.id}" data-p="@data" d="M${dp.lx} ${dp.ly - r}L${dp.lx + r} ${dp.ly}L${dp.lx} ${dp.ly + r}L${dp.lx - r} ${dp.ly}Z" fill="${KIND.data ? KIND.data.c : '#7c3aed'}"><title>data · network connection (SCADA, PLC, gateway …)</title></path>`;
    }
    if (sel && !SELM.size && b.type !== 'junction') {
      // v1.5: eight handles — drag any corner or edge to resize freely (Shift keeps the proportions)
      const hs = HS();
      for (const [hd, fx, fy] of [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]])
        s += `<rect class="rs rs-${hd}" data-rs="${b.id}" data-hd="${hd}" data-fx="${fx}" data-fy="${fy}" data-w="${W}" data-h="${H}" x="${W * fx - hs / 2}" y="${H * fy - hs / 2}" width="${hs}" height="${hs}" rx="2"><title>Drag to resize · Shift keeps the proportions</title></rect>`;
    }

  }
  return s + '</g>';
}
function bnameInner(b, st) {
  return `${MODE === 'monitor' && st ? `<tspan fill="${STC[st]}">●</tspan> ` : ''}${esc(b.name)}${MODE === 'monitor' && EQ[b.type].batch && st ? ` <tspan class="bstate" fill="${STC[st]}">${st}</tspan>` : ''}`;
}
let TAGSEL = null; // v4.5 — selected data label: "blockId|tagId"
/* default (stacked) layout of an equipment's labels: [{bt, t, w, x, y}] in label-anchor coordinates */
function tagLayout(b) {
  const E = EQ[b.type];
  const list = b.tags.filter(t => t.show && REG[t.id]);
  const card = DOC.tagStyle === 'card', // v9.4: per-flowsheet card style (larger light value cards)
    TS = PREF.ts * (card ? 1.32 : 1),
    bh = Math.round((card ? 17 : 16) * TS),
    cw = (card ? 7.1 : 6.7) * TS;
  let y = 0;
  return list.map(bt => {
    const t = REG[bt.id],
      k = E.inst ? '' : (REG[t.id] && REG[t.id].short) || t.id.split('.').pop(), // v9.3: optional short display label
      txt = MODE === 'monitor' || E.inst ? tagTxt(t.id) : t.txt != null && t.txt !== '' ? t.txt : t.states ? 'status' : t.unit, // v9.39 text / status-list tags // v9.9 status text
      w = Math.max(E.inst ? 40 : 56, (k.length + txt.length + (k ? 1 : 0)) * cw + 12);
    const o = { bt, t, k, txt, w, h: bh, x: bt.pos ? bt.pos.x : 0, y: bt.pos ? bt.pos.y : y };
    if (!bt.pos) y += bh + (card ? 4 : 2);
    return o;
  });
}
function tagAnchor(b) {
  const E = EQ[b.type],
    { W, H } = dims(b),
    bh = Math.round(16 * PREF.ts);
  return { x: (E.inst ? b.x + W + 3 : b.x) + b.tagOff.x, y: (E.inst ? b.y + H / 2 - bh / 2 : b.y + H + 6) + b.tagOff.y };
}
function tagsSVG(b) {
  const E = EQ[b.type];
  if (!SHOWTAGS || E.widget) return '';
  const L = tagLayout(b);
  if (!L.length) return '';
  const { W, H } = dims(b),
    A = tagAnchor(b);
  let s = `<g class="tagg${DOC.tagStyle === 'card' ? ' card' : ''}" data-tg="${b.id}" transform="translate(${A.x},${A.y})">`;
  // leader lines from labels that sit away from their equipment (equipment rectangle in anchor coordinates)
  const ex0 = b.x - A.x,
    ey0 = b.y - A.y,
    ex1 = ex0 + W,
    ey1 = ey0 + H;
  L.forEach(o => {
    if (!o.bt.pos) return;
    const cx = Math.max(ex0, Math.min(o.x + o.w / 2, ex1)),
      cy = Math.max(ey0, Math.min(o.y + o.h / 2, ey1));
    const lx = Math.max(o.x, Math.min(cx, o.x + o.w)),
      ly = Math.max(o.y, Math.min(cy, o.y + o.h));
    if (Math.hypot(lx - cx, ly - cy) > 26) s += `<path class="tlead" d="M${lx} ${ly}L${cx} ${cy}"/><circle class="tlead-dot" cx="${cx}" cy="${cy}" r="2"/>`;
  });
  L.forEach(o => {
    const t = o.t,
      sv = tagSev(t.id),
      sel = TAGSEL === b.id + '|' + t.id;
    s += `<g class="tagb${sel ? ' tsel' : ''}" data-tag="${esc(t.id)}" data-tb="${b.id}" transform="translate(${o.x},${o.y})"><rect class="bg" width="${o.w}" height="${o.h}" rx="3"/><rect width="3" height="${o.h}" rx="1.5" fill="${MODE === 'monitor' || E.inst ? sevC(sv) : '#94a3b8'}"/><text x="6" y="${o.h * 0.72}"><tspan class="k">${esc(o.k)}</tspan>${o.k ? ' ' : ''}<tspan class="tv">${esc(o.txt)}</tspan></text><title>${esc(t.id)} · ${esc(t.desc)} — drag to move this label · Shift+drag moves all labels of ${esc(b.name)} · double-click for the trend</title></g>`;
  });
  return s + '</g>';
}
/* freeze every label of an equipment at its current place (so moving one never shifts the others) */
function freezeTags(b) {
  tagLayout(b).forEach(o => {
    if (!o.bt.pos) o.bt.pos = { x: Math.round(o.x), y: Math.round(o.y) };
  });
}
function tagSoon(b) {
  if (tagSoon.p) return;
  tagSoon.p = true;
  requestAnimationFrame(() => {
    tagSoon.p = false;
    const el = document.querySelector(`#Ltags [data-tg="${b.id}"]`);
    if (el && typeof svgSwap === 'function') svgSwap(el, tagsSVG(b));
    else renderCanvas();
  });
}
function renderCanvas() {
  if (typeof renderPageFrame === 'function') setTimeout(renderPageFrame, 0); // v8.9 publish page frame
  const svg = $('#cv');
  svg.classList.toggle('design', MODE === 'design');
  svg.classList.toggle('monitor', MODE === 'monitor');
  svg.classList.toggle('live', MODE === 'monitor' && LIVE);
  $('#gridbg').style.display = MODE === 'design' ? '' : 'none';
  $('#Lstreams').innerHTML = DOC.streams.map(streamSVG).join('');
  // v9.1 — zone frames sit in their own layer UNDER the lines, so a zone never washes out the flow
  const zl = $('#Lzones');
  if (zl) zl.innerHTML = DOC.blocks.filter(b => b.type === 'areaBox').map(blockSVG).join('');
  $('#Lblocks').innerHTML = DOC.blocks.filter(b => !zl || b.type !== 'areaBox').map(blockSVG).join('') + groupFrames() + selFrame();
  $('#Ltags').innerHTML = DOC.blocks.map(tagsSVG).join('');
  $('#Ltags')._html = null;
  liveCanvas(true);
  miniRender();
  applyView();
  try {
    drawTrace();
  } catch (e) {}
  syncAnims();
}
function liveCanvas(skipStruct) {
  DOC.blocks.forEach(b => {
    const E = EQ[b.type],
      g = document.getElementById('bk_' + b.id);
    if (!g) return;
    const st = bState(b),
      run = effRun(b);
    const cls = `blk t-${b.type}${run ? ' run' : ''}${st ? ' ph-' + st : ''}${SEL && SEL.t === 'b' && SEL.id === b.id ? ' sel-b' : ''}${CONNSRC && CONNSRC.b === b.id ? ' srcpick' : ''}${markAim.cur === b.id ? ' aimed' : ''}${TPATH.has(b.id) ? ' traced' : ''}`;
    if (g.getAttribute('class') !== cls) {
      g.setAttribute('class', cls);
      if (run) syncAnims(g);
    }
    if (E.dyn) {
      const d = document.getElementById('dy_' + b.id);
      const { w, h } = dims(b);
      if (d) {
        const dd = drawDims(b);
        d.innerHTML = E.dyn(dd.dw, dd.dh, symState(b), b);
      }
    }
    const n = document.getElementById('bn_' + b.id);
    if (n) n.innerHTML = bnameInner(b, st);
    const ha = document.getElementById('ha_' + b.id);
    if (ha) {
      const sv = MODE === 'monitor' ? blkSev(b) : 0,
        { W, H } = dims(b);
      ha.innerHTML =
        sv > 0 && !E.inst
          ? `<rect class="s${sv}" x="-6" y="-6" width="${W + 12}" height="${H + 12}" rx="6" stroke="${sevC(sv)}"/>`
          : '';
    }
  });
  DOC.streams.forEach(s => {
    const g = document.getElementById('st_' + s.id);
    if (!g) return;
    const f = MODE === 'monitor' && streamFlows(s);
    g.classList.toggle('flow', f);
    if (s.tag && REG[s.tag]) {
      const t = document.getElementById('stl_' + s.id);
      if (t)
        t.textContent = MODE === 'monitor' ? `${fmtN(val(s.tag), REG[s.tag].d)} ${REG[s.tag].unit}` : s.name;
    }
  });
  if (!skipStruct && !drag) {
    // v4.9 — rebuild the labels only when their content changed (in Design nothing changes from tick to tick)
    const html = DOC.blocks.map(tagsSVG).join(''),
      lt = $('#Ltags');
    if (lt._html !== html || lt.childElementCount !== lt._n) {
      lt.innerHTML = html;
      lt._html = html;
      lt._n = lt.childElementCount;
    }
  }
  try {
    if (PREF.mbOverlay) mbOverlay();
  } catch (e) {}
}
let rafP = false;
/* v2.8 — fast drag: while equipment is being moved, only the moved items, their tag labels, their lines and the
   selection / group frames are updated (instead of rebuilding the whole canvas on every mouse move).
   The full canvas is rebuilt once when the mouse is released (changed()). */
const FAST_SKIP = ['pourLadle', 'moldLine', 'moldConv', 'coolConv']; // drawings that depend on each other's position
let FASTQ = null;
function moveSoon(bs) {
  if (bs.some(b => FAST_SKIP.includes(b.type))) return renderSoon();
  FASTQ = bs;
  if (moveSoon.p) return;
  moveSoon.p = true;
  requestAnimationFrame(() => {
    moveSoon.p = false;
    const list = FASTQ;
    FASTQ = null;
    if (list) fastMove(list);
  });
}
function svgSwap(el, html) {
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  t.innerHTML = html;
  el.replaceWith(...t.childNodes);
}
function fastMove(bs) {
  try {
    const ids = new Set(bs.map(b => b.id)),
      lt = $('#Ltags'),
      lb = $('#Lblocks');
    for (const b of bs) {
      const g = document.getElementById('bk_' + b.id);
      if (!g) return renderCanvas();
      g.setAttribute('transform', `translate(${b.x},${b.y})`);
      const html = tagsSVG(b),
        tg = lt.querySelector(`[data-tg="${b.id}"]`);
      if (tg) svgSwap(tg, html);
      else if (html) lt.insertAdjacentHTML('beforeend', html);
    }
    DOC.streams.forEach(st => {
      if (!ids.has(st.from.b) && !ids.has(st.to.b)) return;
      const el = document.getElementById('st_' + st.id);
      if (el) svgSwap(el, streamSVG(st));
    });
    lb.querySelectorAll(':scope > .selframe, :scope > .gsz, :scope > .grpframe').forEach(e => e.remove());
    const fr = groupFrames() + selFrame();
    if (fr) lb.insertAdjacentHTML('beforeend', fr);
    miniRender();
    try {
      drawTrace();
    } catch (e) {}
  } catch (e) {
    renderCanvas();
  }
}
function renderSoon() {
  if (rafP) return;
  rafP = true;
  requestAnimationFrame(() => {
    rafP = false;
    renderCanvas();
  });
}
function PR() {
  return clamp(5.5 / VIEW.k, 3, 20);
}
function HS() {
  return clamp(11 / VIEW.k, 5, 30);
}
function FS() {
  return clamp(8.5 / VIEW.k, 6, 22);
}
function sizeHandles() {
  const pr = PR(),
    hs = HS(),
    fs = FS();
  $$('#cv .port').forEach(c => c.setAttribute('r', B(c.dataset.b)?.type === 'junction' ? pr * 0.8 : pr));
  $$('#cv .plabel').forEach(t => (t.style.fontSize = fs + 'px'));
  $$('#cv .se').forEach(q => {
    const x = +q.getAttribute('x') + +q.getAttribute('width') / 2,
      y = +q.getAttribute('y') + +q.getAttribute('height') / 2;
    q.setAttribute('x', x - hs / 2);
    q.setAttribute('y', y - hs / 2);
    q.setAttribute('width', hs);
    q.setAttribute('height', hs);
  });
  $$('#cv .mh').forEach(c => c.setAttribute('r', hs * 0.7));
  $$('#cv .rs').forEach(q => {
    const W = +q.dataset.w,
      H = +q.dataset.h,
      fx = q.dataset.fx === undefined ? 1 : +q.dataset.fx,
      fy = q.dataset.fy === undefined ? 1 : +q.dataset.fy;
    q.setAttribute('x', W * fx - hs / 2);
    q.setAttribute('y', H * fy - hs / 2);
    q.setAttribute('width', hs);
    q.setAttribute('height', hs);
  });
  $('#cv').style.setProperty('--hw', clamp(14 / VIEW.k, 8, 40) + 'px');
}
function applyView() {
  // v7.8 — publish "Fill screen" scales width and height separately (VIEW.ky); everywhere else one zoom
  const ky = PRESENT && VIEW.ky ? VIEW.ky : null;
  $('#vp').setAttribute('transform', `translate(${VIEW.tx},${VIEW.ty}) scale(${VIEW.k}${ky ? ' ' + ky : ''})`);
  const cvs = $('#cv');
  cvs.classList.toggle('stretch', !!ky && Math.abs(ky / VIEW.k - 1) > 0.01);
  if (ky) cvs.style.setProperty('--tsx', (ky / VIEW.k).toFixed(4)); // text is drawn back to its own proportions
  else cvs.style.removeProperty('--tsx');
  clearTimeout(window._shT);
  window._shT = setTimeout(sizeHandles, 60);
  const z = $('#zsel');
  z.options[0].textContent = Math.round(VIEW.k * 100) + '%';
  z.value = 'cur';
  miniView();
}
function toWorld(e) {
  const r = $('#cv').getBoundingClientRect();
  return { x: (e.clientX - r.left - VIEW.tx) / VIEW.k, y: (e.clientY - r.top - VIEW.ty) / (PRESENT && VIEW.ky ? VIEW.ky : VIEW.k) };
}
function bounds() {
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  DOC.blocks.forEach(b => {
    const { W, H } = dims(b);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y - 16);
    x1 = Math.max(x1, b.x + W + (EQ[b.type].inst ? 50 : 10));
    y1 = Math.max(y1, b.y + H + 24);
  });
  return { x0, y0, x1, y1 };
}
/* v1.15 — smooth, predictable view (as in the Loop Studio):
   · Fit shows the whole loop but never zooms in beyond 100 %, so one or two items stay their normal size
   · zoom buttons, keys, the zoom list and Fit glide to the new view (about 0.2 s); the wheel stays direct
   · opening / closing panels keeps the same part of the plant in the middle instead of refitting */
let VIEWANIM = 0;
function animateView(T, ms = 220) {
  cancelAnimationFrame(VIEWANIM);
  const S = { tx: VIEW.tx, ty: VIEW.ty, k: VIEW.k },
    t0 = performance.now();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || PRESENT) ms = 0;
  const step = now => {
    const p = ms ? Math.min(1, (now - t0) / ms) : 1,
      e = 1 - Math.pow(1 - p, 3);
    VIEW.tx = S.tx + (T.tx - S.tx) * e;
    VIEW.ty = S.ty + (T.ty - S.ty) * e;
    VIEW.k = S.k + (T.k - S.k) * e;
    applyView();
    if (p < 1) VIEWANIM = requestAnimationFrame(step);
  };
  VIEWANIM = requestAnimationFrame(step);
}
function fit(mode, instant) {
  if (PRESENT && typeof presentFit === 'function') return presentFit(); // v8.0: publish sizing lives in 05d-present-view.js
  mode = mode || (PRESENT ? ((PREF.pfit || 'fill') === 'fill' ? 'stretch' : PREF.pfit === 'width' ? 'width' : 'page') : PREF.fit); // v5.9 / v7.8
  const r = $('#cwrap').getBoundingClientRect();
  let T;
  if (!DOC.blocks.length || r.width < 10) T = { tx: 40, ty: 30, k: 1 };
  else {
    const { x0, y0, x1, y1 } = bounds();
    const kw = (r.width - 48) / Math.max(1, x1 - x0),
      kp = Math.min(kw, (r.height - 40) / Math.max(1, y1 - y0));
    const k = clamp(Math.min(mode === 'width' ? kw : kp, PRESENT ? 4 : 1), 0.15, PRESENT ? 4 : 1); // editing: never bigger than 100 % · publish: up to 400 % so big screens are filled
    T = {
      k,
      ky: null,
      tx: (r.width - (x1 - x0) * k) / 2 - x0 * k,
      ty: (mode === 'page' || k === 1 ? Math.max(20, (r.height - (y1 - y0) * k) / 2) : 20) - y0 * k,
    };
  }
  if (instant || PRESENT) {
    cancelAnimationFrame(VIEWANIM);
    Object.assign(VIEW, T);
    applyView();
  } else animateView(T);
}
function zoomTo(k) {
  const r = $('#cv').getBoundingClientRect();
  zoomAt(k / VIEW.k, r.width / 2, r.height / 2, true);
}
function zoomAt(f, cx, cy, smooth) {
  const r = $('#cv').getBoundingClientRect();
  if (cx == null) {
    cx = r.width / 2;
    cy = r.height / 2;
    smooth = smooth !== false; // buttons and keys glide; the wheel passes a point and stays direct
  }
  cancelAnimationFrame(VIEWANIM);
  const k = clamp(VIEW.k * f, 0.15, 4);
  const T = { k, tx: cx - ((cx - VIEW.tx) * k) / VIEW.k, ty: cy - ((cy - VIEW.ty) * k) / VIEW.k };
  if (smooth) animateView(T, 180);
  else {
    Object.assign(VIEW, T);
    applyView();
  }
}
function center(b) {
  const { W, H } = dims(b),
    r = $('#cwrap').getBoundingClientRect();
  VIEW.tx = r.width / 2 - (b.x + W / 2) * VIEW.k;
  VIEW.ty = r.height / 2 - (b.y + H / 2) * VIEW.k;
  applyView();
}
function panBy(dx, dy) {
  VIEW.tx += dx;
  VIEW.ty += dy;
  applyView();
}

/* ===== Commands from HMI widgets (Simulate mode; internally MODE === 'monitor') ===== */
function runCmd(b, cmd, i) {
  if (RP) {
    toast('Traceability is read-only — press Back to live to operate');
    return;
  }
  const E = EQ[b.type];
  let msg = '';
  const setRun = (ids, on) =>
    ids
      .map(B)
      .filter(Boolean)
      .forEach(t => setRunning(t, on)); // v6.1: groups start / stop together
  if (cmd === 'start' || cmd === 'stop') {
    const r = b.props.rows[i];
    if (r.targets && r.targets.length) setRun(r.targets, cmd === 'start');
    else r.on = cmd === 'start';
    msg = `${cmd.toUpperCase()} ${r.label || b.props.title}`;
  } else if (cmd === 'light') {
    const r = b.props.rows[i];
    if (!r.targets?.length) {
      r.on = !r.on;
      msg = `${r.label} ${r.on ? 'on' : 'off'}`;
    } else return;
  } else if (cmd === 'rtoggle') {
    const r = b.props.rows[i],
      t = B(r.target);
    if (!t) {
      toast('Choose the equipment for this row in Properties');
      return;
    }
    setRunning(t, !!t.props.oos);
    msg = `${r.label}: ${t.name} ${t.props.oos ? 'OFF' : 'ON'}`;
  } else if (cmd === 'toggle') {
    const t = B(b.props.target);
    if (!t) {
      toast('Choose the equipment for this button in Properties');
      return;
    }
    setRunning(t, !!t.props.oos);
    msg = `${t.name} ${t.props.oos ? 'OFF' : 'ON'}`;
  } else if (cmd === 'blow') {
    const m = B(b.props.cols[i]);
    if (!m) return;
    m.props.manual = !m.props.manual;
    msg = `${m.name} blow ${m.props.manual ? 'manual' : 'auto'}`;
  }
  logEv('Operator: ' + msg);
  toast(msg);
  evalAlerts();
  save();
  liveCanvas();
  renderDock();
  renderTree();
  if (SEL) renderProps();
}

/* ===== Canvas interaction ===== */
let drag = null,
  CONNMODE = false,
  CONNSRC = null,
  NEWKIND = 'auto';
const cv = $('#cv');
function placeAt(type, w, e) {
  if (type.startsWith('mod:')) {
    const m = MODS.find(x => 'mod:' + x.id === type);
    if (m) pasteClip(m.clip, w.x, w.y, 'Placed module');
    if (!e.shiftKey) setPlace(null);
    return;
  }
  const E = EQ[type];
  let x = w.x - E.w / 2,
    y = w.y - E.h / 2;
  if (SNAP) {
    x = Math.round(x / 10) * 10;
    y = Math.round(y / 10) * 10;
  }
  pushUndo();
  const b = addBlock(type, x, y);
  SEL = { t: 'b', id: b.id };
  logEv(`Added ${b.name} (${E.n})`);
  if (typeof tryInline === 'function') tryInline(b, e); // v5.3 — dropped on a line → inserted into it
  if (!e.shiftKey) setPlace(null);
  changed();
  if (PREF.autolink !== false && !e.shiftKey && !E.widget && b.tags.length)
    setTimeout(() => linkWizard(b.id), 60);
}
const connectable = b => b && !EQ[b.type].widget && ports(b).length > 0;

/* Pick the best pair of ports between two items (either may be fixed). Tries both flow directions. */
function bestPair(aId, ap, bId, bp, exclude) {
  const A = B(aId),
    Bb = B(bId);
  if (!A || !Bb) return { err: 'Item not found' };
  if (aId === bId) return { err: 'Choose a different item' };
  if (!connectable(Bb)) return { err: `${Bb.name} has no connection points` };
  // v7.1: a data line dropped on a material point goes to the equipment's data point instead
  const isData = (blk, pid) => portOf(blk, pid)?.kind === 'data';
  // (plant equipment only: Control & IT items and junctions keep the point that was picked)
  if (ap && bp && isData(A, ap) && !isData(Bb, bp) && dataPort(Bb)) bp = '@data';
  if (ap && bp && isData(Bb, bp) && !isData(A, ap) && dataPort(A)) ap = '@data';
  const withData = (blk, list, other) => (other.some(p => p && p.kind === 'data') && dataPort(blk) ? [...list, dataPort(blk)] : list);
  let pa = ap ? [portOf(A, ap)] : ports(A),
    pb = bp ? [portOf(Bb, bp)] : ports(Bb);
  if (!bp) pb = withData(Bb, pb, pa);
  if (!ap) pa = withData(A, pa, pb);
  let best = null,
    err = null;
  const chk = (x, xp, y, yp) => {
    if (!exclude) return canConnect(x, xp, y, yp);
    return canConnectEx(exclude, x, xp, y, yp);
  };
  for (const p of pa)
    for (const q of pb) {
      if (!p || !q) continue;
      const e = chk(aId, p.id, bId, q.id);
      if (e) {
        err = err || e;
        continue;
      }
      const fwd = p.dir === 'out' || (p.dir === 'io' && q.dir !== 'out');
      const usedA = portLinks(aId, p.id).filter(s => s !== exclude).length,
        usedB = portLinks(bId, q.id).filter(s => s !== exclude).length;
      const score =
        (usedA ? 30 : 0) +
        (usedB ? 30 : 0) +
        (fwd ? 0 : 200) -
        (p.req && !usedA ? 8 : 0) -
        (q.req && !usedB ? 8 : 0) +
        Math.hypot(p.x - q.x, p.y - q.y) * 0.04 +
        (p.kind === q.kind && p.kind !== 'any' ? -5 : 0);
      if (!best || score < best.score) best = { score, a: p, b: q, fwd };
    }
  if (!best) {
    if (ap && bp) return { err: err || 'These ports cannot be connected' };
    return {
      err: err && !/already/.test(err) ? err : `No free compatible ports between ${A.name} and ${Bb.name}`,
    };
  }
  return best;
}
function doConnect(aId, ap, bId, bp) {
  const r = bestPair(aId, ap, bId, bp);
  if (r.err) {
    toast(r.err);
    return null;
  }
  pushUndo();
  const s = connect(aId, r.a.id, bId, r.b.id, NEWKIND === 'auto' ? undefined : NEWKIND);
  if (s && !s.route) s.route = 'auto'; // v5.1 — new lines find a clean path around equipment
  if (s) alignNewLine(s); // v7.1 — nearly in line → straight
  SEL = { t: 's', id: s.id };
  logEv(`Connected ${s.name}: ${B(s.from.b).name} · ${s.from.p} → ${B(s.to.b).name} · ${s.to.p}`);
  toast(`${s.name}: ${B(s.from.b).name} → ${B(s.to.b).name}`);
  changed();
  return s;
}
/* Find what the pointer is aiming at: a port, a block, or the nearest compatible port within reach */
function aimAt(e, w, srcB, srcP, exclude) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const pe = el && el.closest && el.closest('#cv .port');
  if (pe && pe.dataset.b !== srcB) {
    const r = bestPair(srcB, srcP, pe.dataset.b, pe.dataset.p, exclude);
    return Object.assign(r, { tb: pe.dataset.b });
  }
  const be = el && el.closest && el.closest('#cv .blk');
  if (be && be.dataset.b !== srcB) {
    const r = bestPair(srcB, srcP, be.dataset.b, null, exclude);
    return Object.assign(r, { tb: be.dataset.b });
  }
  const R = 36 / VIEW.k;
  let best = null;
  DOC.blocks.forEach(b => {
    if (b.id === srcB || !connectable(b)) return;
    ports(b).forEach(p => {
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      if (d < R && (!best || d < best.d)) {
        const r = bestPair(srcB, srcP, b.id, p.id, exclude);
        if (!r.err) best = Object.assign(r, { d, tb: b.id });
      }
    });
  });
  return best;
}
function srcPoint(srcB, srcP) {
  const b = B(srcB);
  if (srcP) return portOf(b, srcP);
  const { W, H } = dims(b);
  return { x: b.x + W / 2, y: b.y + H / 2, side: 'r', kind: 'any' };
}
function markAim(id) {
  if (markAim.cur === id) return;
  if (markAim.cur) {
    const o = document.getElementById('bk_' + markAim.cur);
    if (o) o.classList.remove('aimed');
  }
  markAim.cur = id;
  if (id) {
    const g = document.getElementById('bk_' + id);
    if (g) g.classList.add('aimed');
  }
}
function drawPreview(src, aim, w, srcB) {
  const L = $('#Ltmp'),
    pr = PR();
  markAim(aim && !aim.err ? aim.tb : null);
  if (aim && !aim.err) {
    const [o, i] = aim.fwd ? [aim.a, aim.b] : [aim.b, aim.a];
    const R = route(o, i, null);
    const d = 'M' + R.pts.map(p => `${p.x} ${p.y}`).join('L');
    const kind =
      NEWKIND !== 'auto' ? NEWKIND : o.kind !== 'any' ? o.kind : i.kind !== 'any' ? i.kind : 'sand';
    L.innerHTML = `<path d="${d}" stroke="${KIND[kind].c}" stroke-width="${3 / VIEW.k + 1}" fill="none" stroke-dasharray="${8 / VIEW.k} ${5 / VIEW.k}" marker-end="url(#ar-${kind})"/><circle cx="${aim.a.x}" cy="${aim.a.y}" r="${pr * 1.8}" fill="none" stroke="#1f9d55" stroke-width="${2.5 / VIEW.k}"/><circle cx="${aim.b.x}" cy="${aim.b.y}" r="${pr * 1.8}" fill="none" stroke="#1f9d55" stroke-width="${2.5 / VIEW.k}"/>`;
    const sn = esc(B(srcB)?.name || ''),
      tn = esc(B(aim.tb)?.name || '');
    tip(
      aim.fwd
        ? `<b>${sn}</b> · ${o.id} → <b>${tn}</b> · ${i.id}`
        : `<b>${tn}</b> · ${o.id} → <b>${sn}</b> · ${i.id}`,
    );
  } else {
    L.innerHTML =
      `<path d="M${src.x} ${src.y}L${w.x} ${w.y}" stroke="#64748b" stroke-width="${2 / VIEW.k}" stroke-dasharray="${6 / VIEW.k} ${4 / VIEW.k}" fill="none"/>` +
      (aim && aim.err
        ? `<circle cx="${w.x}" cy="${w.y}" r="${pr * 1.6}" fill="none" stroke="#d93636" stroke-width="${2.5 / VIEW.k}"/>`
        : '');
    tip(aim && aim.err ? aim.err : 'Release on the destination equipment or port');
  }
}
let tipE = null;
function tip(t, e) {
  const el = $('#ctip');
  if (!t) {
    el.style.display = 'none';
    return;
  }
  el.innerHTML = t;
  el.style.display = 'block';
  if (e) tipE = e;
  if (tipE) {
    el.style.left = tipE.clientX + 16 + 'px';
    el.style.top = tipE.clientY + 14 + 'px';
  }
}
function setConnMode(on) {
  if (on && MODE !== 'design') setMode('design', true);
  CONNMODE = on;
  if (!on) CONNSRC = null;
  cv.classList.toggle('connecting', on);
  $('#bConn').classList.toggle('on', on);
  setPlace(null);
  if (on) $('#cmenu').classList.remove('on');
  renderCanvas();
  updateHint();
}
function pickSource(b, p) {
  CONNSRC = { b, p: p || null };
  renderCanvas();
  updateHint();
}

cv.addEventListener('pointerdown', e => {
  $('#cmenu').classList.remove('on');
  if (e.button === 2) return;
  const w = toWorld(e);
  if (PLACE) {
    if (lockedNotice()) return;
    placeAt(PLACE, w, e);
    return;
  }
  if (PRESENT && (e.button === 1 || SPACE)) {
    e.preventDefault();
    return;
  }
  if (e.button === 1 || (SPACE && studioMouse()) || (PANTOOL && e.button === 0)) {
    // pan with the middle button, or Space + drag (Studio style)
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    drag = { k: 'pan', sx: e.clientX, sy: e.clientY, tx: VIEW.tx, ty: VIEW.ty };
    cv.classList.add('panning');
    return;
  }
  const gsz = e.target.closest('.gsz');
  if (gsz && MODE === 'design') {
    cv.setPointerCapture(e.pointerId);
    if (lockedNotice()) {
      drag = { k: 'click' };
      return;
    }
    drag = gscaleDrag(gsz.dataset.gsz);
    return;
  }
  const cmd = e.target.closest('[data-cmd]'),
    port = e.target.closest('.port'),
    se = e.target.closest('.se'),
    rs = e.target.closest('.rs'),
    mh = e.target.closest('.mh'),
    tg = e.target.closest('.tagg'),
    blk = e.target.closest('.blk'),
    st = e.target.closest('.stream');
  if (cmd && MODE === 'monitor' && blk) {
    runCmd(B(blk.dataset.b), cmd.dataset.cmd, +cmd.dataset.i);
    return;
  }
  cv.setPointerCapture(e.pointerId);
  tipE = e;
  if (layoutLocked() && (e.target.closest('.port,.se,.rs,.mh,.bp,.bseg,.tagg') || CONNMODE || CONNSRC)) {
    // locked layout: selecting is fine, editing is not
    lockedNotice();
    const lb = e.target.closest('.blk');
    if (lb && !(SEL && SEL.id === lb.dataset.b)) select({ t: 'b', id: lb.dataset.b });
    drag = { k: 'click' };
    return;
  }
  // Second click of click-click connect
  if (CONNSRC && MODE === 'design' && (port || blk)) {
    const tb = port ? port.dataset.b : blk.dataset.b;
    if (tb !== CONNSRC.b) {
      const src = CONNSRC;
      CONNSRC = null;
      if (!CONNMODE) cv.classList.remove('connecting');
      doConnect(src.b, src.p, tb, port ? port.dataset.p : null);
      updateHint();
      drag = { k: 'click' };
      return;
    }
  }
  if (se && MODE === 'design') {
    const s = Sx(se.dataset.s),
      end = se.dataset.se,
      fixed = end === 'from' ? s.to : s.from;
    drag = { k: 'reend', s, end, fixed, src: portOf(B(fixed.b), fixed.p), moved: false };
    return;
  }
  if (rs && rs.dataset.hd) {
    const b = B(rs.dataset.rs),
      d = dims(b),
      E = EQ[b.type],
      nW = (d.r % 180 ? E.h : E.w) * d.sc,
      nH = (d.r % 180 ? E.w : E.h) * d.sc;
    drag = { k: 'free', b, hd: rs.dataset.hd, sx: w.x, sy: w.y, x0: b.x, y0: b.y, W0: d.W, H0: d.H, minW: Math.max(8, nW * 0.25), minH: Math.max(8, nH * 0.25), moved: false };
    return;
  }
  if (rs) {
    const b = B(rs.dataset.rs),
      d = dims(b);
    drag = {
      k: rs.dataset.mode === 'scale' || e.shiftKey ? 'scale' : 'resize',
      b,
      sx: w.x,
      sy: w.y,
      ow: d.w,
      oh: d.h,
      W0: d.W,
      H0: d.H,
      osc: b.sc || 1,
      moved: false,
    };
    return;
  }
  // v3.7 — double-click on a line (detected here: the first click re-draws the line, so the browser's dblclick
  // event does not reach it): on a bend = remove it, elsewhere on the line = add a bend there
  if (st && MODE === 'design' && e.button === 0 && !layoutLocked()) {
    const now = performance.now(),
      sid = st.dataset.s;
    const L = cv._lineClick;
    if (L && L.id === sid && now - L.t < 450 && Math.hypot(e.clientX - L.x, e.clientY - L.y) < 8) {
      cv._lineClick = null;
      const s2 = Sx(sid),
        bpx = e.target.closest('.bp');
      if (bpx) removeBend(s2, +bpx.dataset.i);
      else if (!e.target.closest('.bseg,.se')) addBendAt(s2, w);
      drag = { k: 'click' };
      return;
    }
    cv._lineClick = { id: sid, t: now, x: e.clientX, y: e.clientY };
  }
  const bpH = e.target.closest('.bp'),
    bsH = e.target.closest('.bseg');
  if ((bpH || bsH) && MODE === 'design') {
    const s = Sx((bpH || bsH).dataset.bs);
    drag = bpH ? bendDragStart(s, +bpH.dataset.i, w) : segDragStart(s, +bsH.dataset.g, w);
    return;
  }
  if (mh) {
    const s = Sx(mh.dataset.mh),
      G = streamGeom(s);
    const p = G.raw[G.seg];
    drag = { k: 'mid', s, ax: mh.dataset.ax, o: G.axis === 'x' ? p.x : p.y, sx: w.x, sy: w.y, moved: false };
    return;
  }
  if (MODE === 'design' && (port || (CONNMODE && blk && connectable(B(blk.dataset.b))))) {
    const b = port ? port.dataset.b : blk.dataset.b,
      p = port ? port.dataset.p : null;
    drag = { k: 'conn', b, p, src: srcPoint(b, p), moved: false, sx: e.clientX, sy: e.clientY };
    if (p && portOf(B(b), p)?.kind === 'data') cv.classList.add('cn-data'); // v7.1: show every data point ◆ while drawing a data line
    return;
  }
  if (CONNMODE && blk) {
    toast('This item has no connection points');
    drag = { k: 'click' };
    return;
  }
  if (tg) {
    const b = B(tg.dataset.tg);
    drag = {
      k: 'tag',
      b,
      sx: w.x,
      sy: w.y,
      ox: b.tagOff.x,
      oy: b.tagOff.y,
      moved: false,
      tag: e.target.closest('.tagb')?.dataset.tag,
    };
    // v4.5 — a label moves on its own; Shift+drag moves all labels of the equipment together
    const tb = e.target.closest('.tagb');
    if (tb && !e.shiftKey && MODE === 'design') {
      const bt = b.tags.find(x => x.id === tb.dataset.tag);
      const now = performance.now(),
        L = cv._tagClick;
      if (L && L.id === b.id + '|' + tb.dataset.tag && now - L.t < 450) {
        cv._tagClick = null;
        drag = { k: 'click' };
        openTrend(tb.dataset.tag);
        return;
      }
      cv._tagClick = { id: b.id + '|' + tb.dataset.tag, t: now };
      const o = tagLayout(b).find(x => x.bt === bt);
      drag = { k: 'tag1', b, bt, sx: w.x, sy: w.y, ox: o ? o.x : 0, oy: o ? o.y : 0, moved: false, tag: tb.dataset.tag };
    }
    return;
  }
  if (blk) {
    const b = B(blk.dataset.b);
    // v9.20 — Publish view: a click on an area (Area Box) zooms to that area only (05f-area-focus.js)
    if (PRESENT && b && b.type === 'areaBox' && typeof areaFocus === 'function') {
      if (AF.id !== b.id) areaFocus(b.id);
      drag = { k: 'click' };
      return;
    }
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && MODE === 'design') {
      if (SEL && SEL.t === 'b') SELM.add(SEL.id);
      // a grouped item toggles together with the rest of its group
      const tog = b.grp && grpMembers(b.grp).length > 1 ? grpMembers(b.grp) : [b.id];
      if (SELM.has(b.id)) tog.forEach(id => SELM.delete(id));
      else tog.forEach(id => SELM.add(id));
      SEL = null;
      if (SELM.size === 1) {
        const only = [...SELM][0];
        select({ t: 'b', id: only });
      } else {
        renderCanvas();
        renderProps();
        updateTb();
      }
      drag = { k: 'click' };
      return;
    }
    if (SELM.has(b.id) && SELM.size > 1 && MODE === 'design') {
      drag = gmoveDrag(w, [...SELM]);
      return;
    }
    if (MODE === 'design' && b.grp) {
      const mem = grpMembers(b.grp);
      if (mem.length > 1) {
        SEL = null;
        SELM = new Set(mem);
        renderCanvas();
        renderProps();
        updateTb();
        drag = gmoveDrag(w, mem);
        return;
      }
    }
    if (!(SEL && SEL.id === b.id)) select({ t: 'b', id: b.id });
    // v2.1 — in Design a click only selects (panel on double-click / Properties); Simulate still shows details
    if (!PREF.right && innerWidth > 960 && !PRESENT && (MODE !== 'design' || PREF.autoProps)) {
      PREF.right = true;
      savePref();
      applyPrefs(true);
    }
    if (MODE === 'design')
      drag = b.lock || layoutLocked()
        ? { k: 'click', mb: b, lockedAll: layoutLocked() }
        : { k: 'move', b, mb: b, sx: w.x, sy: w.y, ox: b.x, oy: b.y, moved: false };
    else {
      drag = { k: 'click' };
      const f = b.tags[0];
      const dmr = PRESENT && typeof dmRole === 'function' ? dmRole(b) : null;
      if (dmr === 'scada' || dmr === 'plc' || (dmr === 'equip' && dmScope({ equipment_id: dmId(b) }).plcs.length)) {
        // v9.5 — publish view: SCADA → PLC Tag Monitor of its PLCs · PLC → that PLC · equipment → its mapped tags
        const id = dmId(b);
        openPlcMonitor(dmr === 'scada' ? { scada_id: id } : dmr === 'plc' ? { plc_id: id } : { equipment_id: id });
      } else if (PRESENT && typeof isIT === 'function' && isIT(b)) {
        // v7.4 — publish view: gateway / server … → table of the tags it collects (click again to close)
        if (CDPOP && CDPOP.bid === b.id) closeCollected();
        else openCollected(b);
      } else if (EQ[b.type].inst && f) openTrend(f.id);
      else drag.mb = b;
    }
    return;
  }
  if (st) {
    select({ t: 's', id: st.dataset.s });
    const s0 = Sx(st.dataset.s);
    if (s0 && MODE === 'design' && e.button === 0 && !layoutLocked() && !PRESENT && typeof nearestSeg === 'function' && !e.target.closest('.se'))
      drag = segDragStart(s0, nearestSeg(s0, w), w); // v5.1 — drag the line itself to move that segment
    else drag = { k: 'click' };
    return;
  }
  if (CONNSRC && !CONNMODE) {
    CONNSRC = null;
    cv.classList.remove('connecting');
    renderCanvas();
    updateHint();
  }
  if (MODE === 'design' && (e.shiftKey || studioMouse())) {
    // selection box: Shift + drag in both styles, plain drag in Studio style (which pans with Space / middle button)
    if (!e.shiftKey && (SEL || SELM.size)) select(null);
    drag = { k: 'marq', sx: w.x, sy: w.y, add: e.shiftKey };
    return;
  }
  if (SEL || SELM.size) select(null);
  if (PRESENT) {
    // v8.0 — the loop is larger than the screen (Fit width or zoomed in): drag to move; otherwise a click does nothing
    if (typeof presentCanPan === 'function' && presentCanPan()) {
      drag = { k: 'pan', sx: e.clientX, sy: e.clientY, tx: VIEW.tx, ty: VIEW.ty };
      cv.classList.add('panning');
    } else drag = { k: 'click' };
    return;
  }
  drag = { k: 'pan', sx: e.clientX, sy: e.clientY, tx: VIEW.tx, ty: VIEW.ty };
  cv.classList.add('panning');
});
let LASTW = null; // v2.8 — last mouse position on the canvas (world coordinates), used by paste
cv.addEventListener('pointermove', e => {
  const w = toWorld(e);
  LASTW = { x: w.x, y: w.y, t: Date.now() };
  $('#stXY').textContent = `x ${Math.round(w.x)} · y ${Math.round(w.y)}`;
  if (!drag) {
    if (CONNSRC) {
      const aim = aimAt(e, w, CONNSRC.b, CONNSRC.p);
      tipE = e;
      drawPreview(srcPoint(CONNSRC.b, CONNSRC.p), aim, w, CONNSRC.b);
    }
    return;
  }
  const sn = v => (SNAP ? Math.round(v / 10) * 10 : Math.round(v));
  tipE = e;
  if (drag.k === 'pan') {
    VIEW.tx = drag.tx + e.clientX - drag.sx;
    VIEW.ty = drag.ty + e.clientY - drag.sy;
    if (PRESENT && typeof presentClamp === 'function') presentClamp(); // v8.0: never drag the loop off screen
    applyView();
  } else if (drag.k === 'gmove') {
    let dx = sn(w.x - drag.sx),
      dy = sn(w.y - drag.sy);
    const gd = alignGuides(drag.items.map(o => ({ b: o.b, x: o.ox, y: o.oy })), dx, dy, e.altKey);
    dx = gd.dx;
    dy = gd.dy;
    drawGuides(gd.lines);
    if (!drag.moved && (dx || dy)) {
      pushUndo();
      drag.moved = true;
    }
    if (drag.moved) {
      drag.items.forEach(o => {
        o.b.x = o.ox + dx;
        o.b.y = o.oy + dy;
      });
      if (!drag.lineBase) {
        const ids = new Set(drag.items.map(o => o.b.id));
        drag.lineBase = DOC.streams.filter(st => st.pts && ids.has(st.from.b) && ids.has(st.to.b)).map(st => [st, st.pts.map(p => ({ ...p }))]);
      }
      drag.lineBase.forEach(([st, base]) => (st.pts = base.map(p => ({ x: p.x + dx, y: p.y + dy }))));
      moveSoon(drag.items.map(o => o.b));
    }
  } else if (drag.k === 'free') {
    const g = drag,
      b = g.b,
      d = dims(b),
      hd = g.hd;
    const dx = w.x - g.sx,
      dy = w.y - g.sy;
    let W = g.W0 + (hd.includes('e') ? dx : hd.includes('w') ? -dx : 0),
      H = g.H0 + (hd.includes('s') ? dy : hd.includes('n') ? -dy : 0);
    if (e.shiftKey) {
      // keep the proportions: corners follow the larger change, edges scale both sides
      const f = hd.length === 2 ? Math.max(W / g.W0, H / g.H0) : hd === 'e' || hd === 'w' ? W / g.W0 : H / g.H0;
      W = g.W0 * f;
      H = g.H0 * f;
    }
    // only the sides being dragged snap to the grid; the other side keeps its exact size
    const chW = e.shiftKey || /[ew]/.test(hd),
      chH = e.shiftKey || /[ns]/.test(hd);
    W = chW ? Math.max(g.minW, sn(W)) : g.W0;
    H = chH ? Math.max(g.minH, sn(H)) : g.H0;
    if (EQ[b.type].autoH) H = g.H0; // tables size their own height
    if (!g.moved && (Math.abs(W - g.W0) > 1 || Math.abs(H - g.H0) > 1)) {
      pushUndo();
      g.moved = true;
    }
    if (g.moved) {
      const rot = d.r % 180;
      b.w = Math.round((rot ? H : W) / d.sc);
      b.h = Math.round((rot ? W : H) / d.sc);
      b.x = Math.round(hd.includes('w') ? g.x0 + (g.W0 - W) : g.x0);
      b.y = Math.round(hd.includes('n') ? g.y0 + (g.H0 - H) : g.y0);
      renderSoon();
      $('#Ltmp').innerHTML = `<text class="szlbl" x="${w.x + 12}" y="${w.y + 18}">${Math.round(W)} × ${Math.round(H)}</text>`;
    }
  } else if (drag.k === 'gscale') {
    const g = drag,
      s0 = Math.max(Math.abs(w.x - g.ax) / g.bw, Math.abs(w.y - g.ay) / g.bh),
      s = clamp(s0, g.smin, g.smax);
    if (!g.moved && Math.abs(s - 1) > 0.01) {
      pushUndo();
      g.moved = true;
    }
    if (g.moved) {
      g.items.forEach(o => {
        o.b.x = Math.round(g.ax + (o.ox - g.ax) * s);
        o.b.y = Math.round(g.ay + (o.oy - g.ay) * s);
        o.b.sc = Math.round(o.osc * s * 100) / 100;
      });
      renderSoon();
      $('#Ltmp').innerHTML = `<text class="szlbl" x="${w.x + 12}" y="${w.y + 18}">${Math.round(s * 100)}%</text>`;
    }
  } else if (drag.k === 'marq') {
    const x = Math.min(drag.sx, w.x),
      y = Math.min(drag.sy, w.y),
      ww = Math.abs(w.x - drag.sx),
      hh = Math.abs(w.y - drag.sy);
    drag.r = { x, y, w: ww, h: hh };
    $('#Ltmp').innerHTML =
      `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" fill="rgba(31,111,235,.08)" stroke="#1f6feb" stroke-width="${1.5 / VIEW.k}" stroke-dasharray="${5 / VIEW.k} ${3 / VIEW.k}"/>`;
  } else if (drag.k === 'move') {
    let x = sn(drag.ox + w.x - drag.sx),
      y = sn(drag.oy + w.y - drag.sy);
    const gd = alignGuides([{ b: drag.b, x: drag.ox, y: drag.oy }], x - drag.ox, y - drag.oy, e.altKey);
    x = drag.ox + gd.dx;
    y = drag.oy + gd.dy;
    drawGuides(gd.lines);
    if (!drag.moved && (Math.abs(x - drag.ox) > 2 || Math.abs(y - drag.oy) > 2)) {
      pushUndo();
      drag.moved = true;
    }
    if (drag.moved && (x !== drag.b.x || y !== drag.b.y)) {
      drag.b.x = x;
      drag.b.y = y;
      moveSoon([drag.b]);
      if (typeof inlineHint === 'function' && !e.altKey) drag.inl = inlineHint(drag.b); // v5.3
    }
  } else if (drag.k === 'scale') {
    const b = drag.b,
      f = Math.max((drag.W0 + w.x - drag.sx) / drag.W0, (drag.H0 + w.y - drag.sy) / drag.H0);
    if (!drag.moved) {
      pushUndo();
      drag.moved = true;
    }
    b.sc = clamp(Math.round(drag.osc * f * 20) / 20, 0.3, 4);
    renderSoon();
    requestAnimationFrame(() => {
      const d2 = dims(b);
      $('#Ltmp').innerHTML =
        `<text class="szlbl" x="${b.x + d2.W + 8}" y="${b.y + d2.H + 16}">${Math.round(b.sc * 100)}%</text>`;
    });
  } else if (drag.k === 'resize') {
    const b = drag.b,
      E = EQ[b.type],
      r = (b.rot || 0) % 180;
    let dx = (w.x - drag.sx) / (b.sc || 1),
      dy = (w.y - drag.sy) / (b.sc || 1);
    if (r) {
      [dx, dy] = [dy, dx];
    }
    if (!drag.moved) {
      pushUndo();
      drag.moved = true;
    }
    if (E.resize.includes('w')) b.w = Math.max(Math.round(E.w * 0.4), sn(drag.ow + dx));
    if (E.resize.includes('h') && !E.autoH) b.h = Math.max(Math.round(E.h * 0.4), sn(drag.oh + dy));
    renderSoon();
  } else if (drag.k === 'bend' || drag.k === 'bseg') {
    routeDragMove(drag, w, e);
  } else if (drag.k === 'mid') {
    const d = drag.ax === 'x' ? w.x - drag.sx : w.y - drag.sy;
    if (!drag.moved) {
      pushUndo();
      drag.moved = true;
    }
    drag.s.mid = sn(drag.o + d);
    renderSoon();
  } else if (drag.k === 'tag1') {
    const dx = w.x - drag.sx,
      dy = w.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 3) {
      pushUndo();
      freezeTags(drag.b);
      drag.moved = true;
      TAGSEL = drag.b.id + '|' + drag.tag;
    }
    if (drag.moved) {
      const sn = v => (SNAP && !e.altKey ? Math.round(v / 5) * 5 : Math.round(v));
      drag.bt.pos = { x: sn(drag.ox + dx), y: sn(drag.oy + dy) };
      tagSoon(drag.b);
    }
  } else if (drag.k === 'tag') {
    const dx = w.x - drag.sx,
      dy = w.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 3) {
      pushUndo();
      drag.moved = true;
    }
    if (drag.moved) {
      drag.b.tagOff.x = Math.round(drag.ox + dx);
      drag.b.tagOff.y = Math.round(drag.oy + dy);
      renderSoon();
    }
  } else if (drag.k === 'conn') {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
    if (drag.moved) {
      drag.aim = aimAt(e, w, drag.b, drag.p);
      drawPreview(drag.src, drag.aim, w, drag.b);
    }
  } else if (drag.k === 'reend') {
    drag.moved = true;
    const g = $('#st_' + drag.s.id);
    if (g) g.style.opacity = 0.25;
    drag.aim = aimAt(e, w, drag.fixed.b, drag.fixed.p, drag.s);
    drawPreview(drag.src, drag.aim, w, drag.fixed.b);
  }
});
function clearTmp() {
  $('#Ltmp').innerHTML = '';
  tip(null);
  markAim(null);
}
function endDrag(e) {
  cv.classList.remove('cn-data');
  if (!drag) return;
  const d = drag;
  drag = null;
  cv.classList.remove('panning');
  if (d.lockedAll && d.mb && !d.moved) lockedNotice();
  if (d.mb && !d.moved && !CONNMODE && !CONNSRC && !PLACE && (!e || e.button === 0) && (!studioMouse() || MODE !== 'design'))
    menuSoon(e, d.mb);
  if (d.k === 'bend' || d.k === 'bseg') {
    routeDragEnd(d);
    return;
  }
  if (d.k === 'conn') {
    clearTmp();
    if (!d.moved) {
      pickSource(d.b, d.p);
      cv.classList.add('connecting');
      toast(`Source: ${B(d.b).name}${d.p ? ' · ' + d.p : ''} — click the destination`);
      return;
    }
    const a = d.aim;
    if (a && !a.err) {
      pushUndo();
      const s = connect(d.b, a.a.id, a.tb, a.b.id, NEWKIND === 'auto' ? undefined : NEWKIND);
      if (s && !s.route) s.route = 'auto'; // v5.1 — new lines find a clean path around equipment
      if (s) alignNewLine(s); // v7.1 — nearly in line → straight
  if (s) alignNewLine(s); // v7.1 — nearly in line → straight
      SEL = { t: 's', id: s.id };
      logEv(`Connected ${s.name}: ${B(s.from.b).name} · ${s.from.p} → ${B(s.to.b).name} · ${s.to.p}`);
      changed();
      return;
    }
    toast(a && a.err ? a.err : 'Release on the destination equipment or port');
    renderCanvas();
  } else if (d.k === 'reend') {
    clearTmp();
    const a = d.aim;
    if (d.moved && a && !a.err) {
      pushUndo();
      const fixedIsFrom = a.fwd;
      const np = { b: a.tb, p: a.b.id },
        fp = { b: d.fixed.b, p: a.a.id };
      if (fixedIsFrom) {
        d.s.from = fp;
        d.s.to = np;
      } else {
        d.s.from = np;
        d.s.to = fp;
      }
      d.s.mid = null;
      logEv(
        `${d.s.name} reconnected: ${B(d.s.from.b).name} · ${d.s.from.p} → ${B(d.s.to.b).name} · ${d.s.to.p}`,
      );
      toast(`${d.s.name} reconnected`);
      changed();
      return;
    }
    if (d.moved) toast(a && a.err ? a.err : 'Drop the handle on a port or equipment to reconnect');
    renderCanvas();
  } else if (d.k === 'gmove') {
    clearTmp();
    if (d.moved) changed();
  } else if (d.k === 'gscale' || d.k === 'free') {
    clearTmp();
    if (d.moved) changed();
  } else if (d.k === 'marq') {
    clearTmp();
    const q = d.r;
    if (q && q.w > 4 && q.h > 4) {
      const ids = DOC.blocks
        .filter(b => {
          const D = dims(b);
          return b.x >= q.x && b.y >= q.y && b.x + D.W <= q.x + q.w && b.y + D.H <= q.y + q.h;
        })
        .map(b => b.id);
      for (const id of [...ids]) {
        const g = B(id).grp;
        if (g) grpMembers(g).forEach(m => ids.includes(m) || ids.push(m));
      }
      if (d.add) [...SELM, ...(SEL && SEL.t === 'b' ? [SEL.id] : [])].forEach(id => ids.includes(id) || ids.push(id));
      if (ids.length === 1) {
        select({ t: 'b', id: ids[0] });
      } else {
        SEL = null;
        SELM = new Set(ids);
        renderCanvas();
        renderProps();
        updateTb();
      }
      toast(
        ids.length
          ? `${ids.length} item${ids.length > 1 ? 's' : ''} selected`
          : 'Nothing fully inside the box',
      );
    }
  } else if ((d.k === 'move' || d.k === 'resize' || d.k === 'mid' || d.k === 'scale') && d.moved) {
    clearTmp();
    if (d.k === 'move' && d.b && typeof tryInline === 'function') tryInline(d.b, e); // v5.3 — dropped on a line
    changed();
  } else if (d.k === 'move') {
    clearTmp();
  } else if (d.k === 'tag1') {
    if (d.moved) changed();
    else {
      TAGSEL = d.b.id + '|' + d.tag;
      IXOPEN = d.tag; // the reading's card opens in the Equipment panel
      select({ t: 'b', id: d.b.id });
      renderCanvas();
      toast('Label selected — drag to move it · arrow keys nudge · Del hides it · double-click for the trend');
    }
  } else if (d.k === 'tag') {
    if (d.moved) changed();
    else if (d.tag) openTrend(d.tag);
  }
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', () => {
  drag = null;
  clearTmp();
});
cv.addEventListener('pointerleave', () => {
  if (!drag && CONNSRC) {
    clearTmp();
  }
});

/* ===== Groups, locking & stacking order ===== */
/* v1.2 — group any selection (not only what sits inside an Area Box), ungroup a selection,
   group frames, and smart alignment guides while dragging */
function selBlocks() {
  return [...new Set([...SELM, ...(SEL && SEL.t === 'b' ? [SEL.id] : [])])].map(B).filter(Boolean);
}
function canGroupSel() {
  const bs = selBlocks();
  if (bs.length < 2) return false;
  const g = bs[0].grp; // already exactly one whole group → nothing to do
  return !(g && bs.every(o => o.grp === g) && grpMembers(g).length === bs.length);
}
function groupSel() {
  if (MODE !== 'design' || lockedNotice()) return;
  const bs = selBlocks();
  if (bs.length < 2) {
    toast('Select two or more items first (Shift or Ctrl + click, or Shift + drag a box)');
    return;
  }
  if (!canGroupSel()) {
    toast('These items are already one group');
    return;
  }
  // members of groups that are only partly selected join the new group too, so no group is split
  const ids = new Set(bs.map(o => o.id));
  bs.forEach(o => o.grp && grpMembers(o.grp).forEach(id => ids.add(id)));
  pushUndo();
  const g = 'g' + DOC.seq++;
  ids.forEach(id => (B(id).grp = g));
  SEL = null;
  SELM = new Set(ids);
  logEv(`Grouped ${ids.size} items`);
  changed();
  toast(`Grouped ${ids.size} items — they now move together · Ctrl+Shift+G to ungroup`);
}
function ungroupSel() {
  if (MODE !== 'design' || lockedNotice()) return;
  const groups = new Set(selBlocks().map(o => o.grp).filter(Boolean));
  if (!groups.size) {
    toast('Nothing grouped in the selection');
    return;
  }
  pushUndo();
  let n = 0;
  DOC.blocks.forEach(o => {
    if (groups.has(o.grp)) {
      delete o.grp;
      n++;
    }
  });
  logEv(`Ungrouped ${n} items`);
  changed();
  toast(`Ungrouped ${n} items${groups.size > 1 ? ` from ${groups.size} groups` : ''}`);
}
/* frame with four corner handles around a multi-selection: dragging a handle scales the whole selection
   (positions and sizes) from the opposite corner */
function selRect() {
  const bs = selBlocks();
  if (bs.length < 2) return null;
  const r = bs.map(bBox),
    x = Math.min(...r.map(q => q.x)),
    y = Math.min(...r.map(q => q.y));
  return { bs, x, y, w: Math.max(...r.map(q => q.x + q.w)) - x, h: Math.max(...r.map(q => q.y + q.h)) - y };
}
function selFrame() {
  if (MODE !== 'design' || SELM.size < 2 || layoutLocked()) return '';
  const R = selRect();
  if (!R) return '';
  const hs = HS(),
    c = { nw: [R.x, R.y], ne: [R.x + R.w, R.y], sw: [R.x, R.y + R.h], se: [R.x + R.w, R.y + R.h] };
  return (
    `<rect class="selframe" x="${R.x - 6}" y="${R.y - 6}" width="${R.w + 12}" height="${R.h + 12}" rx="4" pointer-events="none"/>` +
    Object.entries(c)
      .map(
        ([k, [px, py]]) =>
          `<rect class="gsz" data-gsz="${k}" x="${px + (k[1] === 'w' ? -6 : 6) - hs / 2}" y="${py + (k[0] === 'n' ? -6 : 6) - hs / 2}" width="${hs}" height="${hs}" rx="2"><title>Drag to resize the whole selection</title></rect>`,
      )
      .join('')
  );
}
function gscaleDrag(corner) {
  const R = selRect();
  if (!R) return { k: 'click' };
  const items = R.bs.filter(o => !o.lock).map(o => ({ b: o, ox: o.x, oy: o.y, osc: o.sc || 1 }));
  const ax = corner[1] === 'w' ? R.x + R.w : R.x,
    ay = corner[0] === 'n' ? R.y + R.h : R.y;
  // every item keeps its display scale within 0.3 … 4
  const smin = Math.max(...items.map(o => 0.3 / o.osc), 0.05),
    smax = Math.min(...items.map(o => 4 / o.osc));
  return { k: 'gscale', items, ax, ay, bw: R.w || 1, bh: R.h || 1, smin, smax, moved: false };
}
/* dashed frame around each group whose members are all selected */
function groupFrames() {
  if (MODE !== 'design' || SELM.size < 2) return '';
  const seen = new Set();
  let s = '';
  for (const id of SELM) {
    const g = B(id)?.grp;
    if (!g || seen.has(g)) continue;
    seen.add(g);
    const mem = grpMembers(g);
    if (mem.length < 2 || !mem.every(m => SELM.has(m))) continue;
    const r = mem.map(m => bBox(B(m)));
    const x = Math.min(...r.map(q => q.x)) - 12,
      y = Math.min(...r.map(q => q.y)) - 22,
      X = Math.max(...r.map(q => q.x + q.w)) + 12,
      Y = Math.max(...r.map(q => q.y + q.h)) + 12;
    s += `<g class="grpframe" pointer-events="none"><rect x="${x}" y="${y}" width="${X - x}" height="${Y - y}" rx="8"/><text x="${x + 8}" y="${y - 6}">Group · ${mem.length} items</text></g>`;
  }
  return s;
}
/* Smart alignment guides: the moving outline snaps its left / centre / right and top / middle / bottom to the
   same lines of other items within a few screen pixels, and a guide line is drawn. Alt switches them off. */
function alignGuides(starts, dx, dy, off) {
  const lines = [];
  if (off || !starts.length) return { dx, dy, lines };
  const moving = new Set(starts.map(o => o.b.id)),
    rs = starts.map(o => {
      const D = dims(o.b);
      return { x: o.x, y: o.y, w: D.W, h: D.H };
    });
  const bx = Math.min(...rs.map(r => r.x)) + dx,
    by = Math.min(...rs.map(r => r.y)) + dy,
    bw = Math.max(...rs.map(r => r.x + r.w)) + dx - bx,
    bh = Math.max(...rs.map(r => r.y + r.h)) + dy - by,
    thr = 6 / VIEW.k;
  let best = { x: null, y: null };
  const mx = [bx, bx + bw / 2, bx + bw],
    my = [by, by + bh / 2, by + bh];
  for (const o of DOC.blocks) {
    if (moving.has(o.id) || EQ[o.type]?.widget && o.type === 'areaBox') continue;
    const q = bBox(o),
      ox = [q.x, q.x + q.w / 2, q.x + q.w],
      oy = [q.y, q.y + q.h / 2, q.y + q.h];
    for (const a of mx)
      for (const t of ox) {
        const d = Math.abs(t - a);
        if (d < thr && (!best.x || d < best.x.d)) best.x = { d, sh: t - a, at: t, q };
      }
    for (const a of my)
      for (const t of oy) {
        const d = Math.abs(t - a);
        if (d < thr && (!best.y || d < best.y.d)) best.y = { d, sh: t - a, at: t, q };
      }
  }
  if (best.x) {
    dx += best.x.sh;
    const q = best.x.q;
    lines.push([best.x.at, Math.min(by, q.y) - 20, best.x.at, Math.max(by + bh, q.y + q.h) + 20]);
  }
  if (best.y) {
    dy += best.y.sh;
    const q = best.y.q;
    lines.push([Math.min(bx, q.x) - 20, best.y.at, Math.max(bx + bw, q.x + q.w) + 20, best.y.at]);
  }
  return { dx: Math.round(dx), dy: Math.round(dy), lines };
}
function drawGuides(lines) {
  $('#Ltmp').innerHTML = lines
    .map(
      ([x1, y1, x2, y2]) =>
        `<line class="aguide" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${1.2 / VIEW.k}"/>`,
    )
    .join('');
}
function grpMembers(g) {
  return g ? DOC.blocks.filter(b => b.grp === g).map(b => b.id) : [];
}
function gmoveDrag(w, ids) {
  if (layoutLocked()) {
    lockedNotice();
    return { k: 'click' };
  }
  return {
    k: 'gmove',
    sx: w.x,
    sy: w.y,
    items: ids
      .map(B)
      .filter(x => x && !x.lock)
      .map(x => ({ b: x, ox: x.x, oy: x.y })),
    moved: false,
  };
}
function bBox(b) {
  const D = dims(b);
  return { x: b.x, y: b.y, w: D.W, h: D.H };
}
/* Everything whose outline sits fully inside this block's outline */
function insideOf(b) {
  const q = bBox(b);
  return DOC.blocks.filter(o => {
    if (o.id === b.id) return false;
    const r = bBox(o);
    return r.x >= q.x && r.y >= q.y && r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h;
  });
}
function groupArea(b) {
  const inner = insideOf(b);
  if (!inner.length) {
    toast('Nothing sits fully inside this box — make it bigger, or drag items into it');
    return;
  }
  pushUndo();
  const g = 'g' + DOC.seq++;
  [b, ...inner].forEach(o => (o.grp = g));
  SEL = null;
  SELM = new Set([b.id, ...inner.map(o => o.id)]);
  logEv(`Grouped ${inner.length + 1} items in ${b.name}`);
  changed();
  toast(`Grouped ${inner.length + 1} items — they now move together`);
}
function ungroup(b) {
  const mem = grpMembers(b.grp);
  if (!mem.length) return;
  pushUndo();
  mem.forEach(id => delete B(id).grp);
  SELM.clear();
  select({ t: 'b', id: b.id });
  changed();
  toast(`Ungrouped ${mem.length} items`);
}
function toggleLock(b) {
  const mem = b.grp ? grpMembers(b.grp) : [b.id];
  const on = !b.lock;
  pushUndo();
  mem.forEach(id => {
    const o = B(id);
    if (on) o.lock = true;
    else delete o.lock;
  });
  changed();
  toast(on ? 'Position locked — it can no longer be dragged' : 'Position unlocked');
}
/* DOC.blocks order is the stacking order: later in the array draws on top */
function reorder(ids, how) {
  const set = new Set(ids.filter(id => B(id)));
  if (!set.size) return;
  const arr = DOC.blocks;
  let next;
  if (how === 'front' || how === 'back') {
    const picked = arr.filter(b => set.has(b.id)),
      rest = arr.filter(b => !set.has(b.id));
    next = how === 'front' ? [...rest, ...picked] : [...picked, ...rest];
  } else {
    next = arr.slice();
    const step = how === 'fwd' ? 1 : -1;
    const order = how === 'fwd' ? [...next.keys()].reverse() : [...next.keys()];
    for (const i of order) {
      const b = next[i];
      if (!set.has(b.id)) continue;
      const j = i + step;
      if (j < 0 || j >= next.length || set.has(next[j].id)) continue;
      next[i] = next[j];
      next[j] = b;
    }
  }
  const moved = next.some((b, i) => arr[i] !== b);
  if (!moved) {
    toast(how === 'fwd' || how === 'front' ? 'Already at the front' : 'Already at the back');
    return;
  }
  pushUndo();
  DOC.blocks = next;
  changed();
  toast(
    { front: 'Brought to front', back: 'Sent to back', fwd: 'Brought forward', bwd: 'Sent backward' }[how],
  );
}
function zSel(how) {
  if (lockedNotice()) return;
  if (MODE !== 'design') return;
  const ids = selIds();
  if (!ids.length) {
    toast('Select something first');
    return;
  }
  reorder(ids, how);
}

/* Right-click menu */
function menu(e, items, opts = {}) {
  // v2.3 — the published (operator) screen shows no item menus; Simulate shows only what can be used there
  if (PRESENT) return;
  if (MODE !== 'design') {
    items = items.filter(it => it === '-' || !it.dis);
    items = items.filter((it, i, a) => it !== '-' || (i > 0 && i < a.length - 1 && a[i - 1] !== '-'));
    if (!items.length) return;
  }
  const m = $('#cmenu');
  m.classList.toggle('symgrid', items.length > 0 && items.every(it => it !== '-' && it.sym)); // v4.4 symbol picker
  m.innerHTML =
    (opts.title ? `<div class="mhd"><b>${esc(opts.title)}</b><button type="button" class="mx" aria-label="Close" title="Close (Esc)">✕</button></div>` : '') +
    items
    .map((it, i) =>
      it === '-'
        ? '<hr>'
        : `<button data-mi="${i}" ${it.tip ? `title="${esc(it.tip)}" aria-label="${esc(it.tip)}"` : ''} ${it.dis ? 'disabled style="opacity:.4"' : ''}>${it.sw ? `<i class="sw" style="background:${it.sw}"></i>` : ''}${it.t}${it.k ? `<span class="k">${it.k}</span>` : ''}</button>`,
    )
    .join('');
  m.classList.add('on');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
  const mx = m.querySelector('.mx');
  if (mx) mx.onclick = () => m.classList.remove('on');
  m.querySelectorAll('[data-mi]').forEach(
    b =>
      (b.onclick = () => {
        m.classList.remove('on');
        const it = items[+b.dataset.mi];
        if (!it.dis) it.f();
      }),
  );
}
cv.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (PLACE) {
    setPlace(null);
    return;
  }
  if (CONNSRC) {
    CONNSRC = null;
    if (!CONNMODE) cv.classList.remove('connecting');
    clearTmp();
    renderCanvas();
    updateHint();
    return;
  }
  const blk = e.target.closest('.blk'),
    st = e.target.closest('.stream'),
    ds = MODE !== 'design';
  const tgl = e.target.closest('.tagb'); // v4.5 — menu for one data label
  if (tgl && tgl.dataset.tb) {
    const b = B(tgl.dataset.tb),
      tid = tgl.dataset.tag,
      bt = b && b.tags.find(x => x.id === tid);
    if (b && bt) {
      TAGSEL = b.id + '|' + tid;
      IXOPEN = tid;
      select({ t: 'b', id: b.id });
      renderCanvas();
      menu(e, [
        { t: 'Open trend', f: () => openTrend(tid) },
        { t: 'Reading settings…', f: () => ((IXOPEN = tid), (PTAB = 'eq'), openRight()) },
        '-',
        { t: 'Hide this label', f: () => (pushUndo(), freezeTags(b), (bt.show = false), (TAGSEL = null), changed()), dis: ds },
        { t: 'Reset this label’s position', f: () => (pushUndo(), delete bt.pos, changed()), dis: ds || !bt.pos },
        { t: `Reset all labels of ${b.name}`, f: () => (pushUndo(), b.tags.forEach(x => delete x.pos), (b.tagOff = { x: 0, y: 0 }), changed()), dis: ds || !b.tags.some(x => x.pos) },
      ]);
      return;
    }
  }
  if (st) {
    const s = Sx(st.dataset.s);
    select({ t: 's', id: s.id });
    menu(e, lineMenuItems(s, e, toWorld(e))); // v3.7 — symbols, style, type, direction, routing, bends
    return;
  }
  if (blk && studioMouse() && e.ctrlKey && e.button === 0) return; // macOS Ctrl+click = add to selection, not a menu
  if (blk && studioMouse() && MODE === 'design') {
    cancelMenuSoon();
    const b = B(blk.dataset.b);
    if (!(SELM.has(b.id) && SELM.size > 1) && !(SEL && SEL.id === b.id)) select({ t: 'b', id: b.id });
    menu(e, blockMenuItems(b));
    return;
  }
  if (blk) {
    cancelMenuSoon();
    $('#cmenu').classList.remove('on');
    PTAB = 'gen';
    select({ t: 'b', id: blk.dataset.b });
    openRight();
    return;
  }
  menu(e, [
    { t: 'Paste', k: 'Ctrl+V', f: pasteHere, dis: ds },
    { t: 'Connect tool', k: 'C', f: () => setConnMode(!CONNMODE), dis: ds },
    { t: 'Fit width', k: 'F', f: () => fit('width') },
    { t: 'Fit page', k: 'Shift+F', f: () => fit('page') },
    { t: 'Zoom 100%', k: '0', f: () => zoomTo(1) },
  ]);
});
function blockMenuItems(b) {
  const E = EQ[b.type],
    ds = MODE !== 'design';
  {
    return [
      ...(typeof isIT === 'function' && isIT(b) ? [{ t: 'Collected data…', f: () => openCollected(b) }] : []), // v7.4
      ...(typeof smPalCan === 'function' && smPalCan(b) && MODE === 'design' ? [{ t: 'Colour style…', f: () => setTimeout(() => smPalMenuFor(b), 0) }] : []), // v9.7
      // v9.5 — data mapping: configure (Design) · view tags (any mode) · simulate PLC communication loss (Simulate)
      ...(typeof dmRole === 'function' && dmRole(b)
        ? [
            { t: 'Configure data…', f: () => dmConfigure(b), dis: MODE !== 'design' },
            { t: 'View tags…', f: () => { const id = dmId(b), r = dmRole(b); openPlcMonitor(r === 'scada' ? { scada_id: id } : r === 'plc' ? { plc_id: id } : { equipment_id: id }); } },
            ...(dmRole(b) === 'plc' && MODE === 'monitor' && SandmanData.adapter.setConnected
              ? [{ t: SandmanData.adapter.name === 'sim' && SimAdapterLost(b) ? 'Restore PLC communication (simulation)' : 'Simulate PLC communication loss', f: () => SimToggle(b) }]
              : []),
          ]
        : []),
      {
        t: 'Connect from here…',
        k: 'C',
        f: () => {
          setConnMode(true);
          pickSource(b.id, null);
        },
        dis: ds || !connectable(b),
      },
      ...(studioMouse()
        ? [
            {
              t: 'Properties…',
              f: () => {
                PTAB = 'gen';
                select({ t: 'b', id: b.id });
                openRight();
              },
            },
          ]
        : []),
      {
        t: 'Show connections',
        f: () => {
          PTAB = 'gen';
          renderProps();
          openRight();
          setTimeout(() => $('#props .cbox')?.scrollIntoView({ block: 'center' }), 50);
        },
      },
      '-',
      { t: 'Rotate 90°', k: 'R', f: rotSel, dis: ds || E.noflip },
      { t: 'Flip', k: 'H', f: flipSel, dis: ds || E.noflip },
      { t: 'Bigger', k: ']', f: () => setScale(b, (b.sc || 1) * 1.1) },
      { t: 'Smaller', k: '[', f: () => setScale(b, (b.sc || 1) / 1.1) },
      { t: 'Duplicate', k: 'Ctrl+D', f: dupSel, dis: ds },
      ...(typeof rpIsEquipment === 'function' && rpIsEquipment(b) ? [{ t: 'Replace…', k: '', f: () => openReplace(b), dis: ds }] : []),
      { t: 'Copy', k: 'Ctrl+C', f: copySel },
      '-',
      { t: 'Bring to front', k: studioMouse() ? 'Ctrl+]' : 'Ctrl+Shift+]', f: () => zSel('front'), dis: ds },
      { t: 'Bring forward', k: studioMouse() ? 'Ctrl+Shift+]' : 'Ctrl+]', f: () => zSel('fwd'), dis: ds },
      { t: 'Send backward', k: studioMouse() ? 'Ctrl+Shift+[' : 'Ctrl+[', f: () => zSel('bwd'), dis: ds },
      { t: 'Send to back', k: studioMouse() ? 'Ctrl+[' : 'Ctrl+Shift+[', f: () => zSel('back'), dis: ds },
      '-',
      {
        t: b.lock ? 'Unlock position' : 'Lock position',
        k: b.lock ? '🔒' : '',
        f: () => toggleLock(b),
        dis: ds,
      },
      ...(SELM.size > 1 && SELM.has(b.id)
        ? [{ t: `Group selected items (${SELM.size})`, k: 'Ctrl+G', f: groupSel, dis: ds || !canGroupSel() }]
        : []),
      {
        t: b.grp ? 'Ungroup' : 'Group everything inside this',
        k: b.grp ? 'Ctrl+Shift+G' : '',
        f: () => (b.grp ? ungroupSel() : groupArea(b)),
        dis: ds,
      },
      { t: 'Save as module…', f: saveModuleForm },
      { t: E.widget ? '' : 'Edit equipment design…', f: () => openDesigner(b.type), dis: !!E.widget },
      '-',
      {
        t: b.props.oos ? 'Start (simulated)' : 'Stop (simulated)',
        f: () => {
          setRunning(b, !!b.props.oos);
          logEv(`Operator: ${b.name} ${b.props.oos ? 'stopped' : 'started'}`);
          evalAlerts();
          save();
          liveCanvas();
          renderProps();
        },
        dis: E.widget || E.inst,
      },
      {
        t: 'Disconnect all lines',
        f: () => {
          const n = DOC.streams.filter(s => s.from.b === b.id || s.to.b === b.id).length;
          if (!n) {
            toast('No lines to remove');
            return;
          }
          pushUndo();
          DOC.streams = DOC.streams.filter(s => s.from.b !== b.id && s.to.b !== b.id);
          logEv(`Disconnected ${b.name}`);
          changed();
          toast(`Removed ${n} line${n > 1 ? 's' : ''}`);
        },
        dis: ds,
      },
      { t: 'Delete', k: 'Del', f: delSel, dis: ds },
    ];
  }
}
/* Left-click opens the same menu, unless the click turns out to be a drag or a double-click */
let MENUT = null;
function menuSoon(e, b) {
  clearTimeout(MENUT);
  const ev = { clientX: e.clientX, clientY: e.clientY };
  MENUT = setTimeout(() => {
    if (B(b.id)) menu(ev, blockMenuItems(B(b.id)));
  }, 260);
}
function cancelMenuSoon() {
  clearTimeout(MENUT);
  MENUT = null;
}
cv.addEventListener('dblclick', e => {
  cancelMenuSoon();
  $('#cmenu').classList.remove('on');
  if (CONNMODE) return;
  // the first click re-draws the canvas, so look up what is under the pointer now
  const blk = e.target.closest('.blk') || document.elementFromPoint(e.clientX, e.clientY)?.closest('.blk');
  if (blk) {
    select({ t: 'b', id: blk.dataset.b });
    PTAB = EQ[B(blk.dataset.b)?.type]?.widget ? 'gen' : 'eq';
    setTimeout(() => $('#props .nm')?.select(), 0);
    openRight();
  }
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#cmenu')) {
    cancelMenuSoon();
    $('#cmenu').classList.remove('on');
  }
});
$('#cwrap').addEventListener(
  'wheel',
  e => {
    e.preventDefault();
    if (PRESENT) {
      // v8.0 — Ctrl / ⌘ + wheel zooms; the wheel moves the view only when the loop is larger than the screen
      if (!presentCanPan()) return; // v8.2: one fitted view
      VIEW.tx -= e.shiftKey ? e.deltaY : e.deltaX;
      VIEW.ty -= e.shiftKey ? 0 : e.deltaY;
      presentClamp();
      applyView();
      return;
    }
    const r = cv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
    else if (e.shiftKey) panBy(-e.deltaY, 0);
    else panBy(-e.deltaX, -e.deltaY);
  },
  { passive: false },
);
cv.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
cv.addEventListener('drop', e => {
  e.preventDefault();
  const t = e.dataTransfer.getData('text/plain');
  if (lockedNotice()) return;
  if (EQ[t] || String(t).startsWith('mod:')) placeAt(t, toWorld(e), { shiftKey: false });
});
function connectOpts(b, p) {
  const groups = [];
  DOC.blocks.forEach(o => {
    if (o.id === b.id || !connectable(o)) return;
    const opts = ports(o)
      .filter(q => !canConnect(b.id, p.id, o.id, q.id))
      .map(
        q =>
          `<option value="${o.id}|${q.id}">${esc(o.name)} · ${q.id}${portLinks(o.id, q.id).length ? ' (in use)' : ''}</option>`,
      );
    if (opts.length)
      groups.push(`<optgroup label="${esc(o.name)} — ${esc(EQ[o.type].n)}">${opts.join('')}</optgroup>`);
  });
  return groups.join('') || '<option disabled>No compatible ports</option>';
}
function select(s) {
  if (TAGSEL && !(s && s.t === 'b' && TAGSEL.startsWith(s.id + '|'))) TAGSEL = null; // v4.5
  // v2.0 — selecting equipment opens its Equipment panel on the right (Loop Studio behaviour)
  if (s && s.t === 'b' && !(SEL && SEL.t === 'b' && SEL.id === s.id)) {
    const nb = B(s.id);
    if (nb && !EQ[nb.type]?.widget) {
      PTAB = 'eq';
      // v2.1 — a click only selects (Loop Studio). The panel opens on double-click, right-click → Properties,
      // the Properties button, or — if the user turns it on in View settings — on every selection.
      if (PREF.autoProps && MODE === 'design' && !PREF.right && innerWidth > 960 && !PRESENT) {
        PREF.right = true;
        savePref();
        applyPrefs(true);
      }
    }
  }
  SEL = s;
  if (RP && s && s.t === 'b') RPT = 'eq';
  SELM.clear();
  if (typeof updVSc === 'function') setTimeout(updVSc);
  if (s && s.t === 'b' && PTAB === 'presc' && !B(s.id)?.tags.some(t => REG[t.id]?.role === 'bent'))
    PTAB = 'gen';
  renderCanvas();
  renderProps();
  renderTree();
  updateTb();
}
let PANTOOL = false; // v3.0 — Insert › Pan: left-drag moves the view
function setPan(on) {
  PANTOOL = !!on;
  cv.classList.toggle('pantool', PANTOOL);
}
function setPlace(t) {
  if (t) setPan(false);
  PLACE = t;
  cv.classList.toggle('placing', !!t);
  $$('.pal').forEach(p => p.classList.toggle('on', p.dataset.t === t));
  updateHint();
}
function delSel() {
  if (lockedNotice()) return;
  if (SELM.size > 1 && MODE === 'design') {
    pushUndo();
    const n = SELM.size;
    [...SELM].forEach(id => {
      if (B(id)) delBlock(id);
    });
    SELM.clear();
    SEL = null;
    logEv(`Deleted ${n} items`);
    changed();
    toast(`Deleted ${n} items`);
    return;
  }
  if (!SEL || MODE !== 'design') return;
  pushUndo();
  if (SEL.t === 'b') {
    const b = B(SEL.id);
    logEv(`Deleted ${b.name}`);
    delBlock(SEL.id);
  } else {
    const s = Sx(SEL.id);
    logEv(`Deleted stream ${s.name}`);
    DOC.streams = DOC.streams.filter(x => x.id !== SEL.id);
  }
  SEL = null;
  changed();
}
function rotSel() {
  if (lockedNotice()) return;
  if (!SEL || SEL.t !== 'b' || MODE !== 'design') return;
  const b = B(SEL.id);
  if (EQ[b.type].noflip) {
    toast('This item keeps a fixed orientation');
    return;
  }
  pushUndo();
  b.rot = ((b.rot || 0) + 90) % 360;
  changed();
}
function flipSel() {
  if (lockedNotice()) return;
  if (!SEL || SEL.t !== 'b' || MODE !== 'design') return;
  const b = B(SEL.id);
  if (EQ[b.type].noflip) {
    toast('This item keeps a fixed orientation');
    return;
  }
  pushUndo();
  b.flip = !b.flip;
  changed();
}
function dupSel() {
  if (lockedNotice()) return;
  if (MODE !== 'design') return;
  if (SELM.size > 1) {
    const c = makeClip(selIds());
    pasteClip(c, c.origin.x + 40, c.origin.y + 40, 'Duplicated');
    return;
  }
  if (!SEL || SEL.t !== 'b') return;
  pushUndo();
  const nb = dupBlock(B(SEL.id));
  SEL = { t: 'b', id: nb.id };
  logEv(`Duplicated as ${nb.name}`);
  changed();
}
document.addEventListener(
  'keydown',
  e => {
    // v4.5 — a selected data label: arrows nudge it (Shift = 10 px), Del hides it, Esc clears the selection
    if (!TAGSEL || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || MODE !== 'design') return;
    const [bid, tid] = TAGSEL.split('|'),
      b = B(bid),
      bt = b && b.tags.find(x => x.id === tid);
    if (!bt) return (TAGSEL = null);
    const step = e.shiftKey ? 10 : 1,
      mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!tagNudge.t) pushUndo();
      clearTimeout(tagNudge.t);
      tagNudge.t = setTimeout(() => ((tagNudge.t = 0), changed()), 600);
      freezeTags(b);
      bt.pos = { x: bt.pos.x + mv[0], y: bt.pos.y + mv[1] };
      tagSoon(b);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopImmediatePropagation();
      pushUndo();
      freezeTags(b);
      bt.show = false;
      TAGSEL = null;
      changed();
      toast(`Label ${tid} hidden — show it again in the reading's settings (Ctrl+Z undoes)`);
    } else if (e.key === 'Escape') {
      TAGSEL = null;
      renderCanvas();
    }
  },
  true,
);
function tagNudge() {}
document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const k = e.key;
  if (k === 'Escape') {
    $('#cmenu').classList.remove('on');
    if (SELM.size) {
      SELM.clear();
      renderCanvas();
      renderProps();
      updateTb();
      return;
    }
    if (CONNSRC) {
      CONNSRC = null;
      if (!CONNMODE) cv.classList.remove('connecting');
      clearTmp();
      renderCanvas();
      updateHint();
      return;
    }
    if (CONNMODE) {
      setConnMode(false);
      return;
    }
    setPlace(null);
    closeModal();
    $('#ovl').classList.remove('on');
    if (drag) {
      drag = null;
      clearTmp();
    }
    if (PRESENT && !$('#modal').classList.contains('on')) setPresent(false);
  } else if (k === 'Delete' || k === 'Backspace') {
    e.preventDefault();
    delSel();
  } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') {
    e.preventDefault();
    dupSel();
  } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'c') {
    if (window.getSelection && String(getSelection()).length) return;
    e.preventDefault();
    copySel();
  } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'v') {
    e.preventDefault();
    pasteHere();
  } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a' && MODE === 'design') {
    e.preventDefault();
    SEL = null;
    SELM = new Set(DOC.blocks.map(b => b.id));
    renderCanvas();
    renderProps();
    updateTb();
    toast(`${SELM.size} items selected`);
  } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'g' && MODE === 'design') {
    e.preventDefault();
    e.shiftKey ? ungroupSel() : groupSel();
  } else if ((e.ctrlKey || e.metaKey) && k === '.') {
    e.preventDefault();
    toggleFocus();
  } else if ((e.ctrlKey || e.metaKey) && (k === ']' || k === '}')) {
    e.preventDefault();
    const sh = e.shiftKey || k === '}';
    zSel(studioMouse() ? (sh ? 'fwd' : 'front') : sh ? 'front' : 'fwd');
  } else if ((e.ctrlKey || e.metaKey) && (k === '[' || k === '{')) {
    e.preventDefault();
    const sh = e.shiftKey || k === '{';
    zSel(studioMouse() ? (sh ? 'bwd' : 'back') : sh ? 'back' : 'bwd');
  } else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else if (k === 'c' || k === 'C') {
    setConnMode(!CONNMODE);
  } else if (k === 'r' || k === 'R') rotSel();
  else if (k === 'h' || k === 'H') flipSel();
  else if (k === 'f' || k === 'F') fit(e.shiftKey ? 'page' : 'width');
  else if (k === '+' || k === '=') zoomAt(1.2);
  else if (k === '-' || k === '_') zoomAt(1 / 1.2);
  else if (k === '0') zoomTo(1);
  else if (k === ']' && SEL && SEL.t === 'b') setScale(B(SEL.id), (B(SEL.id).sc || 1) * 1.1);
  else if (k === '[' && SEL && SEL.t === 'b') setScale(B(SEL.id), (B(SEL.id).sc || 1) / 1.1);
  else if (k.startsWith('Arrow')) {
    e.preventDefault();
    const st = e.shiftKey ? 10 : 1;
    const nudge = selIds()
      .map(B)
      .filter(b => b && !b.lock);
    if (MODE === 'design' && nudge.length && lockedNotice()) {
      /* locked layout: no nudging */
    } else if (MODE === 'design' && nudge.length) {
      pushUndo();
      nudge.forEach(b => {
        b.x += k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0;
        b.y += k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0;
      });
      changed();
    } else if (MODE === 'design' && selIds().length) {
      toast('This item is locked — unlock it to move it');
    } else {
      const p = 80;
      panBy(
        k === 'ArrowLeft' ? p : k === 'ArrowRight' ? -p : 0,
        k === 'ArrowUp' ? p : k === 'ArrowDown' ? -p : 0,
      );
    }
  }
});
$$('.navpad [data-pan]').forEach(
  b =>
    (b.onclick = () => {
      const [x, y] = b.dataset.pan.split(',').map(Number);
      panBy(x * 120, y * 120);
    }),
);
$('#bHome') && ($('#bHome').onclick = () => fit());
$('#selKind').innerHTML =
  '<option value="auto">Line type: automatic</option>' +
  Object.keys(KIND)
    .filter(k => k !== 'any')
    .map(k => `<option value="${k}">${KIND[k].n}</option>`)
    .join('');
$('#selKind').onchange = e => {
  NEWKIND = e.target.value;
  if (SEL && SEL.t === 's' && NEWKIND !== 'auto' && MODE === 'design') {
    const s = Sx(SEL.id);
    pushUndo();
    s.kind = NEWKIND;
    changed();
  }
};
$('#bConn').onclick = () => setConnMode(!CONNMODE);

/* v1.3 — Space + drag pans the canvas in Studio style */
document.addEventListener('keydown', e => {
  if (e.key !== ' ' || !studioMouse() || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) return;
  e.preventDefault();
  if (!SPACE) {
    SPACE = true;
    cv.classList.add('space-pan');
  }
});
document.addEventListener('keyup', e => {
  if (e.key === ' ') {
    SPACE = false;
    cv.classList.remove('space-pan');
  }
});
addEventListener('blur', () => {
  SPACE = false;
  cv.classList.remove('space-pan');
});


/* v1.15 — when the canvas area changes size (panels opened or closed, Focus, window resize) keep the plant
   where it is: the point in the middle of the canvas stays in the middle. Publish refits instead (above). */
(() => {
  let w = 0,
    h = 0;
  new ResizeObserver(() => {
    const r = $('#cwrap').getBoundingClientRect();
    if (w && h && !PRESENT && r.width > 10 && r.height > 10) {
      VIEW.tx += (r.width - w) / 2;
      VIEW.ty += (r.height - h) / 2;
      applyView();
    }
    w = r.width;
    h = r.height;
  }).observe($('#cwrap'));
})();

/* v7.1 — existing data lines that end on a material point are moved to that equipment's data point */
function fixDataEnds() {
  let n = 0;
  DOC.streams.forEach(s => {
    if (s.kind !== 'data') return;
    ['from', 'to'].forEach(k => {
      const b = B(s[k].b),
        p = b && portOf(b, s[k].p);
      if (b && p && p.kind !== 'data' && dataPort(b)) {
        s[k].p = '@data';
        s.pts = null;
        s.mid = null;
        n++;
      }
    });
  });
  return n;
}

/* v7.1 — a new line between two points that are almost in line (≤ 10 px) becomes perfectly straight: the item that
   has no other connections is nudged into line (never an item that is already wired to something else) */
function alignNewLine(s) {
  const fb = B(s.from.b),
    tb = B(s.to.b),
    a = portOf(fb, s.from.p),
    b = portOf(tb, s.to.p);
  if (!a || !b) return false;
  const horiz = /[lr]/.test(a.side) && /[lr]/.test(b.side),
    vert = /[tb]/.test(a.side) && /[tb]/.test(b.side);
  const off = horiz ? b.y - a.y : vert ? b.x - a.x : 0;
  if (!off || Math.abs(off) > 10) return false;
  const free = blk => DOC.streams.filter(x => x.from.b === blk.id || x.to.b === blk.id).length === 1 && !blk.grp;
  const mv = free(tb) ? [tb, -1] : free(fb) ? [fb, 1] : null;
  if (!mv) return false;
  if (horiz) mv[0].y += mv[1] * off;
  else mv[0].x += mv[1] * off;
  s.pts = null;
  s.mid = null;
  return true;
}
