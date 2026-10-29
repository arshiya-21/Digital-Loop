/*! SandMan Process Flowsheet — 01-equipment-library.js
 *  Built-in equipment, instrument and HMI widget definitions (EQ) and their SVG drawings
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===== Drawing helpers ===== */
function hopperPath(w, h) {
  const cy = Math.round(h * 0.58);
  return { cy, d: `M2 2H${w - 2}V${cy}L${w * 0.62} ${h - 6}H${w * 0.38}L2 ${cy}Z` };
}
function levelRect(x, y0, y1, w, lv, col = '#c9a063') {
  if (lv == null) return '';
  const hh = (y1 - y0) * lv;
  return `<rect x="${x}" y="${y1 - hh}" width="${w}" height="${hh}" fill="${col}" opacity=".88"/>`;
}
function fallDots(x, y, col = '#b8894e') {
  return `<g class="fall"><circle cx="${x - 3}" cy="${y + 2}" r="1.6" fill="${col}"/><circle cx="${x + 2}" cy="${y + 5}" r="1.6" fill="${col}"/><circle cx="${x}" cy="${y + 9}" r="1.6" fill="${col}"/></g><g class="fall d2"><circle cx="${x + 3}" cy="${y + 2}" r="1.6" fill="${col}"/><circle cx="${x - 2}" cy="${y + 6}" r="1.6" fill="${col}"/></g>`;
}
function conveyorMolds(w, h, uid, dark, b) {
  const P = b ? ladleOver(b) : null,
    px = P ? P.px : null,
    off = px != null ? (((px - 20) % 40) + 40) % 40 : 0;
  let m = '';
  const cy = (h - 12) / 2 + 3;
  for (let i = -2; i < w / 40 + 2; i++) {
    const x = i * 40 + 4 + off,
      cx = x + 16,
      poured = dark || (px != null && cx >= px - 2);
    m +=
      `<rect class="s-mold" x="${x}" y="3" width="32" height="${h - 12}" rx="2"${dark ? ' style="fill:#6f6251"' : ''}/>` +
      (poured
        ? `<circle cx="${cx}" cy="${cy}" r="2.6" fill="#ff9f40" opacity=".85"/>`
        : `<circle cx="${cx}" cy="${cy}" r="2.6" fill="#3b2f20"/>`);
  }
  return `<defs><clipPath id="cp${uid}"><rect x="0" y="0" width="${w}" height="${h}"/></clipPath></defs><rect class="s-dark" x="0" y="${h - 9}" width="${w}" height="6" rx="3"/><g clip-path="url(#cp${uid})"><g class="slide idx">${m}</g></g>${px != null ? `<circle class="pourstream" cx="${px}" cy="${cy}" r="4" fill="#ffcf40"/><circle class="pourstream" cx="${px}" cy="${cy}" r="7" fill="#ff9f1c" opacity=".35"/>` : ''}`;
}
function ladleOver(line) {
  if (!DOC || !line || !isFinite(line.x) || !isFinite(line.y)) return null; // v2.8: library icons use a block with no position
  const d = dims(line);
  for (const L of DOC.blocks) {
    if (L.type !== 'pourLadle') continue;
    const dl = dims(L),
      sc = L.sc || 1,
      sx = L.x + (L.flip ? dl.w - 42.8 : 42.8) * sc,
      sy = L.y + dl.H;
    if (sx < line.x + 6 || sx > line.x + d.W - 6) continue;
    const gap = line.y - sy;
    if (gap < -14 || gap > 60) continue;
    const lx = (sx - line.x) / (line.sc || 1);
    return { L, px: line.flip ? d.w - lx : lx };
  }
  return null;
}
function lineUnder(L) {
  return (
    DOC.blocks.find(b => ['moldLine', 'moldConv', 'coolConv'].includes(b.type) && ladleOver(b)?.L === L) ||
    null
  );
}
/* v6.1 — equipment that follows its feed and is waiting for it ("Idle — no feed"); runtime only, never saved */
const IDLE = {},
  IDLE_SINCE = {};
function effRun(b, depth = 0) {
  const st = bState(b);
  if (b.props.oos || st === 'FAULT' || IDLE[b.id]) return false;
  if (depth > 4) return true;
  if (['moldLine', 'moldConv', 'coolConv'].includes(b.type)) {
    const up = srcBlocks(b).find(
      u => moldingMachines().includes(u) || ['moldLine', 'moldConv', 'coolConv'].includes(u.type),
    );
    if (up && !effRun(up, depth + 1)) return false;
  }
  if (b.type === 'pourLadle') {
    const ln = lineUnder(b);
    if (ln && !effRun(ln, depth + 1)) return false;
  }
  return true;
}
const CYC = 5000;
/* every molding line has its own cycle: cycle time = 3600 / molds per hour of its molding machine, with its own phase */
function machineOf(b) {
  if (!b) return null;
  const mm = moldingMachines();
  if (mm.includes(b)) return b;
  if (['moldLine', 'moldConv', 'coolConv'].includes(b.type)) return upFind(b, x => mm.includes(x), 6);
  if (b.type === 'pourLadle') {
    const ln = lineUnder(b);
    return ln ? machineOf(ln) : null;
  }
  return null;
}
function cycleOf(b) {
  const m = machineOf(b);
  if (!m) return { T: CYC, off: 0, m: null };
  const id = tagRole(m, 'mph', 'MPH'),
    t = id && REG[id],
    mph = t ? Math.max(60, t.typ) : 300;
  return { T: clamp(3600 / mph, 4, 40) * 1000, off: hseed(m.id + '#cyc') * 1e6, m, mph };
}
function syncAnims(root) {
  const now = performance.now(),
    cache = new Map();
  (root || document).querySelectorAll('.idx,.tilt,.pourstream,.ram,.ramv,.pop').forEach(e => {
    const g = e.closest('.blk');
    const b = g && B(g.dataset.b);
    let c = CYC,
      o = 0;
    if (b) {
      if (!cache.has(b.id)) cache.set(b.id, cycleOf(b));
      const k = cache.get(b.id);
      c = k.T;
      o = k.off;
    }
    e.style.animationDuration = c / 1000 + 's';
    e.style.animationDelay = -(((now + o) % c) / 1000) + 's';
  });
}
function beltDraw(w, h) {
  const y = 4,
    bh = h - 8;
  return `<rect x="2" y="${y}" width="${w - 4}" height="${bh}" rx="${bh / 2}" fill="#3a4656"/><path class="beltd" d="M${bh / 2 + 2} ${y + 0.8}H${w - bh / 2 - 2}M${bh / 2 + 2} ${y + bh - 0.8}H${w - bh / 2 - 2}" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="5 5"/><circle cx="${bh / 2 + 2}" cy="${y + bh / 2}" r="${bh / 2 - 1}" fill="#64748b" stroke="#cbd5e1"/><circle cx="${w - bh / 2 - 2}" cy="${y + bh / 2}" r="${bh / 2 - 1}" fill="#64748b" stroke="#cbd5e1"/><path class="sandflow" d="M${bh + 2} ${y - 1}H${w - bh - 2}" stroke="#c9a063" stroke-width="3" stroke-dasharray="4 4" stroke-linecap="round"/>`;
}
function bin(w, h, s, b, label) {
  const top = Math.round(h * 0.24),
    cy = Math.round(h * 0.78);
  return {
    s: `<rect class="s-dark" x="${w / 2 - 12}" y="0" width="24" height="10" rx="2"/><rect class="s-green" x="${w / 2 - 10}" y="10" width="20" height="14"/><circle cx="${w / 2 + 13}" cy="16" r="5" fill="#fff" stroke="#2d3748"/><path class="s-line" d="M${w / 2} 24V${top}"/>
  <path class="s-silo" d="M2 ${top + 6}Q2 ${top} ${w / 2} ${top}Q${w - 2} ${top} ${w - 2} ${top + 6}V${cy}L${w / 2 + 5} ${h - 8}H${w / 2 - 5}L2 ${cy}Z"/><rect class="s-dark" x="${w / 2 - 5}" y="${h - 8}" width="10" height="8"/><circle cx="${w / 2}" cy="${cy + (h - 8 - cy) * 0.45}" r="4" fill="#7cc576" stroke="#2f7d32"/>`,
    d: lv =>
      levelRect(4, top + 8, cy, w - 8, lv, '#dcc9a1') +
      lines(label, w / 2, top + 30, 15, 't-in') +
      (lv != null
        ? `<text x="${w / 2}" y="${cy - 6}" text-anchor="middle" class="t-val">${Math.round(lv * 100)}%</text>`
        : ''),
  };
}
const NOFLIP = 1;
/* E.draw returns static svg; E.dyn returns per-tick svg (levels, values, lamps). */
const EQ = {
  /* ---------- Storage & dosing ---------- */
  additiveBin: {
    cat: 0,
    n: 'Storage Bin (with filter)',
    pre: 'BIN',
    w: 70,
    h: 215,
    resize: 'wh',
    noflip: 1,
    ports: (w, h) => [
      ['in', 'l', 0, h * 0.42, 'in', 'any', 0],
      ['in2', 'r', w, h * 0.42, 'in', 'any', 0],
      ['out', 'b', w / 2, h, 'out', 'any', 1],
    ],
    tags: [['LVL', 'Bin level', '%', 60, 8, 15, 92, 97, 0.3, 'level', 0, 0, [30, 88, 420]]],
    props: { label: 'Additive\nBin' },
    draw: (w, h, s, b) => bin(w, h, s, b, b.props.label).s,
    dyn: (w, h, s, b) => bin(w, h, s, b, b.props.label).d(s.level),
  },
  gaugeSilo: {
    cat: 0,
    n: 'Dosing Silo (level gauge)',
    pre: 'SILO',
    w: 56,
    h: 150,
    resize: 'wh',
    noflip: 1,
    ports: (w, h) => [
      ['in', 't', w / 2, 0, 'in', 'any', 1],
      ['out', 'b', w / 2, h, 'out', 'any', 1],
    ],
    tags: [['LVL', 'Silo level', '%', 60, 8, 15, 95, 98, 0.3, 'level', 0, 0, [20, 95, 260]]],
    props: { label: 'SILO-1\nADD 1' },
    draw: (w, h) => {
      const by = h * 0.8,
        gx = w - 14;
      let t = '';
      for (let i = 0; i <= 5; i++) {
        const y = 8 + (by - 30) * (1 - i / 5);
        t += `<text x="${gx - 3}" y="${y + 2.5}" class="t-tick" text-anchor="end">${i ? '+' : ''}${i * 20}</text><path d="M${gx} ${y}H${gx + 3}" stroke="#1e3a8a"/>`;
      }
      return `<path class="s-silo" d="M2 6Q2 2 6 2H${w - 6}Q${w - 2} 2 ${w - 2} 6V${by}L${w / 2 + 5} ${h - 6}H${w / 2 - 5}L2 ${by}Z"/><rect x="${gx}" y="8" width="8" height="${by - 30}" fill="#fff" stroke="#1e3a8a"/>${t}<rect class="s-dark" x="${w / 2 - 5}" y="${h - 6}" width="10" height="6"/>`;
    },
    dyn: (w, h, s, b) => {
      const by = h * 0.8,
        gx = w - 14,
        gh = by - 30,
        lv = s.level ?? 0;
      return (
        `<rect x="${gx + 1}" y="${8 + gh * (1 - lv)}" width="6" height="${gh * lv}" fill="#1f5fbf"/>` +
        lines(b.props.label, w / 2 - 4, by - 14, 9, 't-sm') +
        `<text x="${w / 2 - 4}" y="${by + 10}" class="t-val" text-anchor="middle">${Math.round(lv * 100)}%</text>`
      );
    },
  },
  truck: {
    cat: 0,
    n: 'Bulk Delivery Truck',
    pre: 'TRK',
    w: 80,
    h: 45,
    notag: 1,
    ports: (w, h) => [['out', 'r', w, 14, 'out', 'any', 0]],
    tags: [],
    draw: () =>
      `<rect x="2" y="6" width="50" height="26" fill="#e9eef5" stroke="#475569"/><path d="M52 14H66L76 24V32H52Z" fill="#cbd5e1" stroke="#475569"/><rect x="57" y="17" width="9" height="7" fill="#93c5fd"/><rect x="0" y="32" width="78" height="4" fill="#475569"/><circle cx="14" cy="38" r="5" fill="#1f2937"/><circle cx="34" cy="38" r="5" fill="#1f2937"/><circle cx="66" cy="38" r="5" fill="#1f2937"/>`,
  },
  screwFeeder: {
    cat: 0,
    n: 'Screw Feeder',
    pre: 'SF',
    w: 60,
    h: 16,
    resize: 'w',
    ports: (w, h) => [
      ['in', 't', 12, 0, 'in', 'any', 1],
      ['out', 'r', w, h / 2, 'out', 'any', 1],
    ],
    tags: [['SPD', 'Feeder speed', 'rpm', 42, null, 20, 60, 70, 0.4, 'sfs', 0]],
    draw: (w, h, s, b, uid) => {
      let a = '';
      for (let x = -8; x < w + 8; x += 8)
        a += `<path d="M${x} ${h - 3}L${x + 6} 3" stroke="#475569" stroke-width="1.6"/>`;
      return `<defs><clipPath id="cp${uid}"><rect x="3" y="3" width="${w - 6}" height="${h - 6}"/></clipPath></defs><rect class="s-steel" x="0" y="1" width="${w}" height="${h - 2}" rx="3"/><g clip-path="url(#cp${uid})"><g class="auger">${a}</g></g><rect class="s-dark" x="${w - 8}" y="0" width="8" height="${h}"/>`;
    },
  },
  dosingFeeder: {
    cat: 0,
    n: 'Dosing Feeder',
    pre: 'DF',
    w: 54,
    h: 38,
    resize: 'wh',
    noflip: 1,
    ports: (w, h) => [
      ['in', 't', w / 2, 0, 'in', 'any', 1],
      ['out', 'b', w / 2, h, 'out', 'add', 1],
    ],
    tags: [['RATE', 'Dosing rate', 'kg/min', 8.5, null, 6, 11, 13, 0.08, 'dose', 1]],
    props: { label: 'DOSING\nFEEDER' },
    draw: (w, h, s, b) =>
      `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="2" fill="#7cc576" stroke="#2f7d32" stroke-width="1.5"/>${lines(b.props.label, w / 2, h / 2 - 2, 11, 't-in')}`,
  },
  waterInlet: {
    cat: 0,
    n: 'Water Inlet',
    pre: 'W',
    w: 22,
    h: 40,
    noflip: 1,
    ports: (w, h) => [['out', 'b', w / 2, h, 'out', 'water', 1]],
    tags: [['FLOW', 'Water flow', 'L/min', 24, null, 12, 34, 40, 0.3, 'water', 1]],
    draw: (w, h) =>
      `<text x="${w / 2}" y="-4" class="t-in" text-anchor="middle">WATER</text><path d="M3 2H19L14 14H8Z" fill="#cfe5ff" stroke="#2b7de9"/><rect x="8" y="14" width="6" height="10" fill="#9fb6d4" stroke="#475569"/><path d="M5 26L17 34M5 34L17 26" stroke="#475569" stroke-width="1.5"/>${fallDots(w / 2, h - 4, '#2b7de9')}`,
  },
  blowerHopper: {
    cat: 0,
    n: 'Blower Hopper',
    pre: 'BH',
    w: 80,
    h: 88,
    resize: 'wh',
    noflip: 1,
    ports: (w, h) => [
      ['in', 't', w / 2, 0, 'in', 'any', 1],
      ['out', 'b', w / 2, h, 'out', 'any', 1],
      ['air', 'l', 0, h * 0.5, 'out', 'air', 0],
    ],
    tags: [['LVL', 'Hopper level', '%', 55, 8, 15, 90, 96, 0.3, 'level', 0, 0, [25, 85, 200]]],
    props: { label: 'BLOWER\nHOPPER' },
    draw: (w, h) => {
      const { d } = hopperPath(w, h);
      return `<path class="s-silo" d="${d}"/><path class="s-line" d="M2 ${h * 0.58}H${w - 2}"/><rect class="s-dark" x="${w * 0.4}" y="${h - 6}" width="${w * 0.2}" height="6"/>`;
    },
    dyn: (w, h, s, b) => {
      const { cy } = hopperPath(w, h);
      return (
        levelRect(5, 10, cy, w - 10, s.level, '#dcc9a1') +
        lines(b.props.label, w / 2, cy * 0.45, 11, 't-in') +
        (s.level != null
          ? `<text x="${w / 2}" y="${cy - 4}" text-anchor="middle" class="t-val">${Math.round(s.level * 100)}%</text>`
          : '')
      );
    },
  },
  holdingHopper: {
    cat: 3,
    n: 'Molding Holding Hopper',
    pre: 'HH',
    w: 46,
    h: 76,
    resize: 'wh',
    noflip: 1,
    ports: (w, h) => [
      ['in', 't', w / 2, 0, 'in', 'any', 1],
      ['out', 'b', w / 2, h, 'out', 'any', 1],
    ],
    tags: [['LVL', 'Hopper level', '%', 60, 10, 20, 92, 97, 0.3, 'level', 0, 0, [25, 90, 160]]],
    props: { label: '24M' },
    draw: (w, h) => {
      const { d } = hopperPath(w, h);
      return `<path class="s-silo" d="${d}"/><path class="s-line" d="M2 ${h * 0.58}H${w - 2}"/><rect class="s-dark" x="${w * 0.4}" y="${h - 6}" width="${w * 0.2}" height="6"/><circle cx="${w / 2}" cy="${h * 0.7}" r="3.5" fill="#7cc576" stroke="#2f7d32"/>${fallDots(w / 2, h - 2)}`;
    },
    dyn: (w, h, s) => {
      const { cy } = hopperPath(w, h);
      return (
        levelRect(5, 6, cy, w - 10, s.level, '#dcc9a1') +
        (s.level != null
          ? `<text x="${w / 2}" y="${cy - 5}" text-anchor="middle" class="t-val">${Math.round(s.level * 100)}%</text>`
          : '')
      );
    },
  },
  returnBin: {
    cat: 0,
    n: 'Return Sand Bin',
    pre: 'RSB',
    w: 70,
    h: 80,
    ports: [
      ['in', 't', 35, 0, 'in', 'any', 1],
      ['out', 'b', 35, 80, 'out', 'any', 1],
    ],
    tags: [
      ['LVL', 'Bin level', '%', 62, 10, 20, 88, 95, 0.4, 'level', 0, 0, [35, 85, 300]],
      ['TEMP', 'Return sand temperature', '°C', 46, null, null, 50, 55, 0.25, 'rtemp', 1],
    ],
    draw: (w, h) => {
      const { d, cy } = hopperPath(w, h);
      return `<path class="s-steel" d="${d}"/><path class="s-line" d="M2 ${cy}H${w - 2}"/><rect class="s-dark" x="${w * 0.4}" y="${h - 6}" width="${w * 0.2}" height="6"/>`;
    },
    dyn: (w, h, s) => {
      const { cy } = hopperPath(w, h);
      return levelRect(6, 9, cy, w - 12, s.level);
    },
  },
  silo: {
    cat: 0,
    n: 'Sand Silo',
    pre: 'SL',
    w: 60,
    h: 100,
    resize: 'wh',
    ports: (w, h) => [
      ['in', 't', w / 2, 0, 'in', 'any', 1],
      ['out', 'b', w / 2, h, 'out', 'any', 1],
    ],
    tags: [['LVL', 'Silo level', '%', 70, 10, 20, 90, 96, 0.4, 'level', 0, 0, [40, 90, 400]]],
    draw: (w, h) => {
      const by = h * 0.7;
      return `<path class="s-steel" d="M3 8V${by}L${w / 2 - 6} ${h - 6}H${w / 2 + 6}L${w - 3} ${by}V8Z"/><ellipse class="s-steel" cx="${w / 2}" cy="8" rx="${w / 2 - 3}" ry="5"/><path class="s-line" d="M3 ${by}H${w - 3}M7 ${by}L2 ${h}M${w - 7} ${by}L${w - 2} ${h}"/><rect class="s-dark" x="${w / 2 - 6}" y="${h - 6}" width="12" height="6"/>`;
    },
    dyn: (w, h, s) => levelRect(6, 14, h * 0.7, w - 12, s.level),
  },
  addBin: {
    cat: 0,
    n: 'Additive Bin (small)',
    pre: 'AB',
    w: 50,
    h: 70,
    ports: [['out', 'b', 25, 70, 'out', 'add', 1]],
    tags: [['LVL', 'Bin level', '%', 55, 10, 20, 95, 98, 0.35, 'level', 0, 0, [30, 90, 500]]],
    props: { material: 'Bentonite' },
    draw: (w, h, s, b) => {
      const { d, cy } = hopperPath(w, h);
      return `<path class="s-steel" d="${d}"/><rect x="2" y="2" width="${w - 4}" height="6" fill="${MAT[b.props.material] || MAT.Bentonite}"/><path class="s-line" d="M2 ${cy}H${w - 2}"/><rect class="s-dark" x="${w * 0.4}" y="${h - 6}" width="${w * 0.2}" height="6"/>`;
    },
    dyn: (w, h, s) => {
      const { cy } = hopperPath(w, h);
      return levelRect(6, 10, cy, w - 12, s.level);
    },
  },
  waterDose: {
    cat: 0,
    n: 'Water Dosing Tank',
    pre: 'WD',
    w: 50,
    h: 50,
    ports: [['out', 'l', 0, 25, 'out', 'water', 1]],
    tags: [['FLOW', 'Water addition', 'L/batch', 32, 26, 28, 36, 38, 0.35, 'water', 1]],
    draw: (w, h) =>
      `<rect class="s-water" x="8" y="4" width="${w - 16}" height="${h - 16}" rx="4"/><path d="M${w / 2} 11C${w / 2 - 6} 19 ${w / 2 - 6} 25 ${w / 2} 25S${w / 2 + 6} 19 ${w / 2} 11Z" fill="#fff" opacity=".9"/><path class="s-line" d="M0 25H8"/><path class="s-dark" d="M${w / 2 - 8} ${h - 12}H${w / 2 + 8}L${w / 2} ${h - 4}Z"/>`,
  },
  /* ---------- Sand preparation ---------- */
  sandMixer: {
    cat: 1,
    n: 'Sand Mixer (batch)',
    pre: 'SM',
    w: 125,
    h: 115,
    noflip: 1,
    batch: 1,
    ports: (w, h) => [
      ['sand', 't', 58, 0, 'in', 'any', 1],
      ['water', 'l', 0, 40, 'in', 'water', 0],
      ['add', 'l', 0, 80, 'in', 'add', 0],
      ['out', 'b', 62, h, 'out', 'any', 1],
    ],
    tags: [
      ['MOIST', 'Mix moisture', '%', 3.4, 2.8, 3.0, 3.8, 4.1, 0.035, 'moist', 2],
      ['COMP', 'Compactability', '%', 40, 33, 36, 44, 47, 0.35, 'compact', 0],
      ['TEMP', 'Mixed sand temperature', '°C', 38, null, null, 45, 50, 0.2, 'mtemp', 1],
      ['RPM', 'Rotor speed', 'rpm', 62, 50, 55, 70, 75, 0.3, 'rpm', 0],
      ['CUR', 'Mixer motor current', 'A', 185, null, null, 220, 240, 1.6, 'mcur', 0],
      ['BENT', 'Bentonite dosed', 'kg/batch', 18, 0, 0, 0, 0, 0.12, 'bent', 1],
      ['BT', 'Batch time', 's', 92, null, null, 110, 125, 0.8, 'btime', 0],
    ],
    props: { group: 'Brake Disc' },
    draw: (
      w,
      h,
    ) => `<path class="s-red" d="M44 2H72L80 26H36Z"/><rect class="s-dark" x="52" y="0" width="12" height="6"/><path class="s-red" d="M8 26H118V84H8Z"/><rect x="40" y="36" width="44" height="14" rx="2" fill="#1e3a8a"/><text x="62" y="46.5" class="t-inw" text-anchor="middle">RPM</text>
   <rect x="14" y="56" width="34" height="22" rx="2" fill="#7f1d1d" opacity=".55"/><g class="spin"><path d="M31 58L33 66L40 67L33 69L31 76L29 69L22 67L29 66Z" fill="#fca5a5"/></g><text x="80" y="72" class="t-inw" text-anchor="middle">SAND MIXER</text>
   <rect class="s-dark" x="2" y="84" width="122" height="7"/><circle cx="20" cy="${h - 10}" r="9" fill="#fff" stroke="#1f2937" stroke-width="1.6"/><text x="20" y="${h - 6.5}" class="t-in" text-anchor="middle">M</text><circle cx="104" cy="${h - 10}" r="9" fill="#fff" stroke="#1f2937" stroke-width="1.6"/><text x="104" y="${h - 6.5}" class="t-in" text-anchor="middle">M</text><rect class="s-dark" x="54" y="91" width="16" height="${h - 91}"/>`,
  },
  contMixer: {
    cat: 1,
    n: 'Continuous Mixer',
    pre: 'CM',
    w: 76,
    h: 70,
    noflip: 1,
    ports: (w, h) => [
      ['in', 't', w / 2, 0, 'in', 'any', 1],
      ['add', 'r', w, 30, 'in', 'add', 0],
      ['out', 'b', w / 2, h, 'out', 'any', 1],
    ],
    tags: [
      ['CUR', 'Mixer motor current', 'A', 95, null, null, 120, 135, 0.8, 'cmcur', 0],
      ['MOIST', 'Premix moisture', '%', 6.2, 5, 5.5, 7, 7.6, 0.04, 'pmoist', 1],
    ],
    draw: (w, h) =>
      `<path class="s-red" d="M6 4H70V58H6Z"/><rect x="6" y="4" width="64" height="8" fill="#7f1d1d"/><rect x="16" y="20" width="44" height="22" rx="2" fill="#7f1d1d" opacity=".5"/><g class="spin"><path d="M38 21V41M28 31H48M31 24L45 38M45 24L31 38" stroke="#fecaca" stroke-width="2"/></g><text x="38" y="50" class="t-inw" text-anchor="middle" style="font-size:7px">CONTINUOUS MIXER</text><rect class="s-dark" x="0" y="58" width="${w}" height="8"/><rect class="s-dark" x="${w / 2 - 6}" y="62" width="12" height="${h - 62}"/>`,
  },
  mixer: {
    cat: 1,
    n: 'Intensive Mixer',
    pre: 'MX',
    w: 110,
    h: 80,
    batch: 1,
    ports: [
      ['sand', 't', 20, 0, 'in', 'any', 1],
      ['add1', 't', 50, 0, 'in', 'add', 0],
      ['add2', 't', 75, 0, 'in', 'add', 0],
      ['water', 'r', 110, 25, 'in', 'water', 0],
      ['out', 'b', 55, 80, 'out', 'any', 1],
    ],
    tags: [
      ['MOIST', 'Mix moisture', '%', 3.4, 2.8, 3.0, 3.8, 4.1, 0.035, 'moist', 2],
      ['COMP', 'Compactability', '%', 40, 33, 36, 44, 47, 0.35, 'compact', 0],
      ['BENT', 'Bentonite dosed', 'kg/batch', 18, 0, 0, 0, 0, 0.12, 'bent', 1],
      ['COAL', 'Coal dust dosed', 'kg/batch', 6, 0, 0, 0, 0, 0.05, 'coal', 1],
      ['CUR', 'Mixer motor current', 'A', 185, null, null, 220, 240, 1.6, 'mcur', 0],
      ['BT', 'Batch time', 's', 92, null, null, 110, 125, 0.8, 'btime', 0],
    ],
    props: { group: 'Brake Disc' },
    draw: () =>
      `<rect class="s-dark" x="72" y="0" width="26" height="12" rx="2"/><path class="s-steel" d="M6 16H104V62Q104 72 94 72H16Q6 72 6 62Z"/><ellipse class="s-sand" cx="55" cy="22" rx="44" ry="6"/><g class="spin"><path d="M55 26L59 39L72 43L59 47L55 60L51 47L38 43L51 39Z" fill="#334155"/></g><circle cx="55" cy="43" r="3" fill="#e2e8f0"/><rect class="s-dark" x="47" y="72" width="16" height="8"/>`,
  },
  polygonSieve: {
    cat: 1,
    n: 'Polygon Sieve',
    pre: 'PS',
    w: 76,
    h: 36,
    ports: (w, h) => [
      ['in', 'r', w, h / 2, 'in', 'any', 1],
      ['out', 'b', w / 2, h, 'out', 'any', 1],
    ],
    tags: [['CUR', 'Sieve motor current', 'A', 14, null, null, 18, 21, 0.15, 'pscur', 1]],
    draw: (w, h) =>
      `<rect class="s-steel" x="6" y="4" width="${w - 12}" height="${h - 10}" rx="3"/><g class="spin slow"><polygon points="${[0, 1, 2, 3, 4, 5].map(i => `${w / 2 + 11 * Math.cos((i * Math.PI) / 3)},${h / 2 - 1 + 11 * Math.sin((i * Math.PI) / 3)}`).join(' ')}" fill="#7cc576" stroke="#2f7d32"/></g><rect class="s-dark" x="0" y="8" width="7" height="${h - 18}"/><path d="M${w / 2 - 6} ${h - 6}H${w / 2 + 6}L${w / 2} ${h}Z" fill="#4a5568"/>`,
  },
  magSep: {
    cat: 1,
    n: 'Magnetic Separator',
    pre: 'MS',
    w: 80,
    h: 50,
    ports: [
      ['in', 'l', 0, 25, 'in', 'any', 1],
      ['out', 'r', 80, 25, 'out', 'any', 1],
    ],
    tags: [['FE', 'Tramp iron removed', 'kg/h', 4, null, null, 9, 14, 0.25, 'fe', 1]],
    draw: w =>
      `<rect class="s-belt" x="2" y="18" width="${w - 20}" height="14" rx="7"/><circle class="s-steel" cx="${w - 20}" cy="25" r="18"/><g class="spin"><circle cx="${w - 20}" cy="25" r="11" fill="none" stroke="#d93636" stroke-width="3" stroke-dasharray="17 17.5"/></g><circle class="s-dark" cx="${w - 20}" cy="25" r="4"/>`,
  },
  screen: {
    cat: 1,
    n: 'Vibrating Screen',
    pre: 'SC',
    w: 90,
    h: 50,
    ports: [
      ['in', 'l', 0, 14, 'in', 'any', 1],
      ['out', 'r', 90, 38, 'out', 'any', 1],
    ],
    tags: [['VIB', 'Screen vibration', 'mm/s', 4.2, null, null, 7, 9, 0.12, 'vib', 1]],
    draw: w =>
      `<g class="vib"><path class="s-steel" d="M4 8L${w - 4} 28V36L4 16Z"/><path class="s-line" d="M18 13V20M32 17V24M46 21V28M60 25V32M74 29V35" stroke-dasharray="2 2"/></g><path class="s-line" d="M14 18L10 28L18 32L12 44M${w - 16} 36L${w - 20} 41L${w - 12} 44"/><path class="s-dark" d="M2 44H30V50H2ZM${w - 30} 44H${w - 2}V50H${w - 30}Z"/>`,
  },
  cooler: {
    cat: 1,
    n: 'Sand Cooler',
    pre: 'SCL',
    w: 80,
    h: 70,
    ports: [
      ['in', 't', 20, 0, 'in', 'any', 1],
      ['out', 'b', 60, 70, 'out', 'any', 1],
    ],
    tags: [
      ['TOUT', 'Cooler outlet temperature', '°C', 41, null, null, 47, 52, 0.25, 'cooltemp', 1],
      ['MOUT', 'Cooler outlet moisture', '%', 2.1, 1.5, 1.7, 2.6, 2.9, 0.025, 'cmoist', 2],
    ],
    draw: (w, h) =>
      `<rect class="s-steel" x="4" y="6" width="${w - 8}" height="${h - 18}" rx="3"/><path class="s-line" d="M10 22Q20 16 30 22T50 22T70 22M10 34Q20 28 30 34T50 34T70 34"/><circle class="s-dark" cx="${w - 18}" cy="${h - 17}" r="9"/><g class="spin"><path d="M${w - 18} ${h - 25}V${h - 9}M${w - 26} ${h - 17}H${w - 10}" stroke="#cbd5e1" stroke-width="2"/></g>`,
  },
  aerator: {
    cat: 1,
    n: 'Aerator',
    pre: 'AE',
    w: 70,
    h: 50,
    ports: [
      ['in', 'l', 0, 25, 'in', 'any', 1],
      ['out', 'r', 70, 25, 'out', 'any', 1],
    ],
    tags: [['SPD', 'Aerator speed', 'rpm', 980, 850, 900, 1100, 1150, 3, 'aspd', 0]],
    draw: (w, h) =>
      `<rect class="s-steel" x="2" y="8" width="${w - 4}" height="${h - 16}" rx="4"/><g class="spin"><circle cx="${w / 2}" cy="${h / 2}" r="10" fill="#475569"/><path d="M${w / 2} ${h / 2 - 16}V${h / 2 + 16}M${w / 2 - 16} ${h / 2}H${w / 2 + 16}M${w / 2 - 11} ${h / 2 - 11}L${w / 2 + 11} ${h / 2 + 11}M${w / 2 + 11} ${h / 2 - 11}L${w / 2 - 11} ${h / 2 + 11}" stroke="#475569" stroke-width="2"/></g>`,
  },
  sandLab: {
    cat: 1,
    n: 'Inline Sand Tester',
    pre: 'ST',
    w: 60,
    h: 50,
    ports: [
      ['in', 'l', 0, 25, 'in', 'any', 1],
      ['out', 'r', 60, 25, 'out', 'any', 1],
    ],
    tags: [
      ['GCS', 'Green compression strength', 'N/cm²', 18, 15, 16, 21, 23, 0.12, 'gcs', 1, 1],
      ['PERM', 'Permeability', 'no.', 140, 100, 115, 170, 190, 1.2, 'perm', 0, 1],
      ['AC', 'Active clay', '%', 8.5, 7.0, 7.6, 9.4, 10, 0.05, 'aclay', 2, 1],
    ],
    draw: (w, h) =>
      `<rect class="s-steel" x="2" y="2" width="${w - 4}" height="${h - 4}" rx="5"/><rect class="s-screen" x="9" y="8" width="${w - 18}" height="19" rx="2"/><path d="M12 22L18 16L24 20L30 13L36 18L42 14L48 17" stroke="#4ade80" stroke-width="1.5" fill="none"/><circle cx="16" cy="37" r="4" fill="#1f9d55"/><circle cx="28" cy="37" r="4" fill="#c99a00"/>`,
  },
  dischargeGate: {
    cat: 1,
    n: 'Discharging Gate',
    pre: 'DG',
    w: 68,
    h: 34,
    noflip: 1,
    ports: (w, h) => [
      ['in', 't', w / 2, 0, 'in', 'any', 1],
      ['out', 'b', w / 2, h, 'out', 'any', 0],
    ],
    tags: [['POS', 'Gate position', '%', 30, null, null, 90, 98, 0.3, 'gate', 0]],
    draw: (w, h) =>
      `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="var(--panel)" stroke="#475569"/>${lines('DISCHARGING\nGATE', w / 2, 14, 10, 't-sm')}`,
  },
  /* ---------- Conveying ---------- */
  belt: {
    cat: 2,
    n: 'Belt Conveyor',
    pre: 'P',
    w: 140,
    h: 16,
    resize: 'w',
    ports: (w, h) => [
      ['in', 'l', 0, h / 2, 'in', 'any', 0],
      ['feed', 't', 12, 0, 'in', 'any', 0],
      ['feedb', 'b', 12, h, 'in', 'any', 0],
      ['out', 'r', w, h / 2, 'out', 'any', 0],
      ['drop', 'b', w - 6, h, 'out', 'any', 0],
    ],
    tags: [['LOAD', 'Belt load', 't/h', 120, null, 60, 160, 180, 1.2, 'load', 0]],
    draw: (w, h) => beltDraw(w, h),
  },
  inclinedBelt: {
    cat: 2,
    n: 'Inclined Conveyor',
    pre: 'P',
    w: 270,
    h: 56,
    resize: 'wh',
    ports: (w, h) => [
      ['in', 'l', 0, h - 6, 'in', 'any', 0],
      ['feed', 't', 16, h - 14, 'in', 'any', 0],
      ['tap', 'b', w * 0.22, h - 6 - ((w * 0.22 - 6) * (h - 12)) / (w - 12) + 6, 'out', 'any', 0],
      ['out', 'r', w, 6, 'out', 'any', 0],
    ],
    tags: [['LOAD', 'Belt load', 't/h', 90, null, 40, 130, 150, 1, 'load', 0]],
    draw: (w, h) => {
      const L = `M6 ${h - 6}L${w - 6} 6`;
      let r = '';
      for (let i = 0; i <= 6; i++) {
        const x = 6 + ((w - 12) * i) / 6,
          y = h - 6 - ((h - 12) * i) / 6;
        r += `<circle cx="${x}" cy="${y + 5}" r="2.4" fill="#64748b"/>`;
      }
      return `<path d="${L}" stroke="#3a4656" stroke-width="7" stroke-linecap="round"/><path class="beltd" d="${L}" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="5 5"/>${r}<path class="sandflow" d="M14 ${h - 11}L${w - 14} 5" stroke="#c9a063" stroke-width="3" stroke-dasharray="4 4" stroke-linecap="round"/><circle cx="6" cy="${h - 6}" r="5" fill="#64748b" stroke="#cbd5e1"/><circle cx="${w - 6}" cy="6" r="5" fill="#64748b" stroke="#cbd5e1"/>`;
    },
  },
  elevator: {
    cat: 2,
    n: 'Bucket Elevator',
    pre: 'T',
    w: 24,
    h: 300,
    resize: 'h',
    ports: (w, h) => [
      ['in', 'l', 0, h - 12, 'in', 'any', 1],
      ['out', 'r', w, 12, 'out', 'any', 1],
    ],
    tags: [['CUR', 'Elevator motor current', 'A', 28, null, null, 36, 40, 0.25, 'ecur', 1]],
    draw: (w, h, s, b, uid) => {
      let k = '';
      for (let i = -1; i < h / 16 + 1; i++)
        k += `<rect x="${w * 0.28}" y="${i * 16 + 4}" width="${w * 0.44}" height="7" fill="#c9a063" stroke="#5d513f" stroke-width=".8"/>`;
      return `<defs><clipPath id="cp${uid}"><rect x="3" y="14" width="${w - 6}" height="${h - 24}"/></clipPath></defs><rect class="s-blue" x="0" y="8" width="${w}" height="${h - 8}" rx="2"/><g clip-path="url(#cp${uid})"><g class="lift">${k}</g></g><path class="s-blue" d="M-2 10L${w / 2} 0L${w + 2} 10Z"/><path class="s-blue" d="M${w} 8H${w + 6}V18H${w}Z"/>`;
    },
  },
  feeder: {
    cat: 2,
    n: 'Vibratory Feeder',
    pre: 'VF',
    w: 70,
    h: 40,
    ports: [
      ['in', 't', 20, 0, 'in', 'any', 1],
      ['out', 'r', 70, 23, 'out', 'any', 1],
    ],
    tags: [['RATE', 'Feed rate', 't/h', 60, 30, 40, 80, 90, 0.5, 'frate2', 0]],
    draw: w =>
      `<path class="s-steel" d="M4 4H36L30 16H10Z"/><g class="vib"><path class="s-steel" d="M2 18H${w}V28H2Z"/></g><path class="s-line" d="M10 28L8 40M${w - 10} 28L${w - 8} 40"/>`,
  },
  junction: {
    cat: 2,
    n: 'Junction / Splitter',
    pre: 'J',
    w: 10,
    h: 10,
    notag: 1,
    noflip: 1,
    ports: [
      ['t', 't', 5, 0, 'io', 'any', 0],
      ['r', 'r', 10, 5, 'io', 'any', 0],
      ['b', 'b', 5, 10, 'io', 'any', 0],
      ['l', 'l', 0, 5, 'io', 'any', 0],
    ],
    tags: [],
    draw: () => `<circle cx="5" cy="5" r="4" fill="#475569" stroke="#fff" stroke-width="1"/>`,
  },
  /* ---------- Molding ---------- */
  disaMini: {
    cat: 3,
    n: 'DISA Molding Machine',
    pre: 'DISA',
    w: 42,
    h: 34,
    ports: (w, h) => [
      ['sand', 'l', 0, 18, 'in', 'any', 1],
      ['sandt', 't', w / 2, 0, 'in', 'any', 0],
      ['out', 'r', w, 26, 'out', 'mold', 1],
    ],
    tags: [
      ['MPH', 'Molding rate', 'mold/h', 380, 300, 340, 420, 440, 1.6, 'mph', 0],
      ['SQZ', 'Squeeze pressure', 'bar', 12, 10, 10.8, 13.2, 14, 0.07, 'squeeze', 1],
      ['HRD', 'Mold hardness', 'B-scale', 88, 78, 82, 94, 97, 0.35, 'hard', 0],
    ],
    draw: (w, h) =>
      `<rect class="s-blue" x="0" y="8" width="16" height="20" rx="2"/><g class="ram"><rect x="15" y="13" width="8" height="10" fill="#93c5fd" stroke="#1e3a8a"/></g><rect class="s-blue" x="22" y="4" width="18" height="26" rx="2"/><path class="s-blue" d="M24 0H38L34 6H28Z"/><g class="pop"><rect x="34" y="19" width="10" height="10" class="s-mold"/></g><rect x="0" y="30" width="${w}" height="4" fill="#1e3a8a"/>`,
  },
  disa: {
    cat: 3,
    n: 'Vertical Molding (large)',
    pre: 'DM',
    w: 140,
    h: 80,
    ports: [
      ['sand', 't', 90, 0, 'in', 'any', 1],
      ['out', 'r', 140, 60, 'out', 'mold', 1],
    ],
    tags: [
      ['MPH', 'Molding rate', 'mold/h', 380, 300, 340, 420, 440, 1.6, 'mph', 0],
      ['SQZ', 'Squeeze pressure', 'bar', 12, 10, 10.8, 13.2, 14, 0.07, 'squeeze', 1],
      ['HRD', 'Mold hardness', 'B-scale', 88, 78, 82, 94, 97, 0.35, 'hard', 0],
    ],
    draw: w =>
      `<rect class="s-dark" x="0" y="70" width="${w}" height="10"/><rect class="s-steel" x="4" y="30" width="34" height="34" rx="3"/><g class="ram"><rect x="38" y="40" width="22" height="14" fill="#94a3b8" stroke="#475569"/></g><rect class="s-steel" x="60" y="22" width="56" height="48" rx="3"/><rect class="s-mold" x="68" y="32" width="40" height="30"/><path class="s-steel" d="M76 2H104V12L96 22H84L76 12Z"/><rect class="s-steel" x="116" y="40" width="24" height="30"/><g class="pop"><rect x="118" y="46" width="16" height="18" class="s-mold"/></g>`,
  },
  hmold: {
    cat: 3,
    n: 'Horizontal Flaskless Molding',
    pre: 'HM',
    w: 130,
    h: 80,
    ports: [
      ['sand', 't', 105, 0, 'in', 'any', 1],
      ['out', 'r', 130, 58, 'out', 'mold', 1],
    ],
    tags: [
      ['MPH', 'Molding rate', 'mold/h', 220, 170, 190, 250, 265, 1.2, 'mph', 0],
      ['SQZ', 'Squeeze pressure', 'bar', 9, 7.5, 8.2, 9.8, 10.5, 0.06, 'squeeze', 1],
    ],
    draw: w =>
      `<rect class="s-dark" x="0" y="70" width="${w}" height="10"/><rect class="s-steel" x="14" y="4" width="70" height="18" rx="2"/><g class="ramv"><rect x="42" y="22" width="14" height="10" fill="#94a3b8" stroke="#475569"/></g><rect class="s-mold" x="12" y="34" width="74" height="17"/><rect class="s-mold" x="12" y="51" width="74" height="17" style="fill:#8f7d62"/><path class="s-steel" d="M95 0H115V10L109 18H101L95 10Z"/><rect class="s-steel" x="88" y="42" width="${w - 88}" height="28"/>`,
  },
  moldLine: {
    cat: 3,
    n: 'Mold Line Conveyor',
    pre: 'P',
    w: 255,
    h: 22,
    resize: 'w',
    ports: (w, h) => [
      ['in', 'l', 0, h / 2, 'in', 'any', 0],
      ['feed', 't', 12, 0, 'in', 'any', 0],
      ['out', 'r', w, h / 2, 'out', 'any', 0],
    ],
    tags: [
      ['SPD', 'Line speed', 'm/min', 4.6, 3.8, 4.2, 5, 5.4, 0.025, 'lspd', 2],
      ['CNT', 'Molds on line', 'count', 120, null, 90, 150, 165, 0.8, 'mcount', 0],
    ],
    draw: (w, h, s, b, uid) =>
      conveyorMolds(w, h, uid, false, b) +
      `<circle cx="6" cy="${h - 6}" r="5" fill="#64748b" stroke="#cbd5e1"/><circle cx="${w - 6}" cy="${h - 6}" r="5" fill="#64748b" stroke="#cbd5e1"/>`,
  },
  coreSetter: {
    cat: 3,
    n: 'Core Setter',
    pre: 'CS',
    w: 70,
    h: 60,
    ports: [
      ['in', 'l', 0, 45, 'in', 'any', 1],
      ['out', 'r', 70, 45, 'out', 'any', 1],
    ],
    tags: [['CYC', 'Core setting cycle', 's', 9, null, null, 11, 12.5, 0.08, 'ccyc', 1]],
    draw: (w, h) =>
      `<rect class="s-dark" x="8" y="${h - 14}" width="24" height="14"/><path d="M20 ${h - 14}V24L46 13" stroke="#f59e0b" stroke-width="7" fill="none" stroke-linecap="round"/><rect x="42" y="12" width="15" height="10" fill="#c7b299" stroke="#5d513f"/><path class="s-belt" d="M0 41H${w}V49H0Z"/>`,
  },
  moldHopper: {
    cat: 3,
    n: 'Molding Hopper (small)',
    pre: 'MH',
    w: 60,
    h: 70,
    ports: [
      ['in', 't', 30, 0, 'in', 'any', 1],
      ['out', 'b', 30, 70, 'out', 'any', 1],
    ],
    tags: [['LVL', 'Hopper level', '%', 60, 10, 25, 90, 96, 0.5, 'level', 0, 0, [30, 88, 180]]],
    draw: (w, h) => {
      const { d, cy } = hopperPath(w, h);
      return `<path class="s-steel" d="${d}"/><path class="s-line" d="M2 ${cy}H${w - 2}"/><rect class="s-dark" x="${w * 0.4}" y="${h - 6}" width="${w * 0.2}" height="6"/>${fallDots(w / 2, h - 2)}`;
    },
    dyn: (w, h, s) => {
      const { cy } = hopperPath(w, h);
      return levelRect(6, 9, cy, w - 12, s.level);
    },
  },
  moldConv: {
    cat: 3,
    n: 'Mold Conveyor (fixed)',
    pre: 'MC',
    w: 220,
    h: 40,
    ports: [
      ['in', 'l', 0, 20, 'in', 'any', 1],
      ['out', 'r', 220, 20, 'out', 'any', 1],
    ],
    tags: [['SPD', 'Line speed', 'm/min', 4.6, 3.8, 4.2, 5, 5.4, 0.025, 'lspd', 2]],
    draw: (w, h, s, b, uid) => conveyorMolds(w, h, uid, false, b),
  },
  /* ---------- Melting & pouring ---------- */
  pourLadle: {
    cat: 4,
    n: 'Pouring Ladle',
    pre: 'PL',
    w: 46,
    h: 50,
    ports: (w, h) => [['in', 't', 16, 0, 'in', 'metal', 0]],
    tags: [
      ['TEMP', 'Pouring temperature', '°C', 1420, 1370, 1390, 1445, 1460, 1.3, 'pourT', 0],
      ['PT', 'Pour time', 's', 7.8, null, null, 9.5, 11, 0.07, 'ptime', 1],
    ],
    draw: (w, h) =>
      `<path d="M19 -3V16" stroke="#475569" stroke-width="1.6"/><path d="M1 16Q19 -10 37 16" fill="none" stroke="#475569" stroke-width="1.6"/><g class="tilt" style="transform-origin:47.5% 50%"><rect x="0" y="0" width="40" height="32" fill="none" stroke="none"/><path class="s-steel" d="M4 6H34L30 30H8Z"/><ellipse cx="19" cy="7" rx="14.5" ry="3.2" fill="#ffb020" stroke="#d9480f"/><path d="M32.5 4.2L41.5 2.8L36.5 9Z" fill="#64748b" stroke="#334155" stroke-width=".8"/><path d="M33.5 5.2L40 4" stroke="#ffb020" stroke-width="1.6"/><circle cx="19" cy="16" r="2.4" fill="#475569"/></g><path class="pourstream" d="M43.2 17C44 26 42.8 38 42.8 ${h + 6}" stroke="#ff9f1c" stroke-width="3.2" fill="none" stroke-linecap="round"/><ellipse class="pourstream" cx="42.8" cy="${h + 6}" rx="4" ry="1.4" fill="#ffcf40"/>`,
  },
  charge: {
    cat: 4,
    n: 'Charge Bucket',
    pre: 'CB',
    w: 60,
    h: 50,
    ports: [['out', 'r', 60, 25, 'out', 'metal', 1]],
    tags: [['WT', 'Charge weight', 'kg', 1500, null, 1300, 1700, null, 8, 'cwt', 0]],
    draw: () =>
      `<path class="s-steel" d="M6 10H54L48 46H12Z"/><path class="s-line" d="M10 10L16 2H44L50 10"/><path d="M14 18H46M16 28H44M18 38H42" stroke="#64748b" stroke-dasharray="5 3"/>`,
  },
  induction: {
    cat: 4,
    n: 'Induction Furnace',
    pre: 'IF',
    w: 70,
    h: 90,
    ports: [
      ['in', 'l', 0, 32, 'in', 'metal', 0],
      ['out', 'r', 70, 24, 'out', 'metal', 1],
    ],
    tags: [
      ['TEMP', 'Melt temperature', '°C', 1525, 1470, 1495, 1550, 1570, 1.8, 'melt', 0],
      ['PWR', 'Furnace power', 'kW', 2800, null, null, 3100, 3300, 12, 'pwr', 0],
    ],
    draw: (w, h) =>
      `<rect class="s-dark" x="0" y="${h - 10}" width="${w}" height="10"/><rect class="s-steel" x="10" y="14" width="50" height="${h - 26}"/><path d="M10 26H60M10 36H60M10 46H60M10 56H60M10 66H60" stroke="#c2410c" stroke-width="3"/><ellipse class="glow" cx="35" cy="14" rx="25" ry="6" fill="#ffc533" stroke="#d9480f"/><path class="s-steel" d="M58 17L70 24L58 28Z"/>`,
  },
  holding: {
    cat: 4,
    n: 'Holding Furnace',
    pre: 'HF',
    w: 90,
    h: 60,
    ports: [
      ['in', 'l', 0, 30, 'in', 'metal', 1],
      ['out', 'r', 90, 30, 'out', 'metal', 1],
    ],
    tags: [['TEMP', 'Holding temperature', '°C', 1480, 1440, 1455, 1505, 1520, 1.4, 'hold', 0]],
    draw: (w, h) =>
      `<rect class="s-dark" x="10" y="${h - 8}" width="${w - 20}" height="8"/><rect class="s-steel" x="4" y="6" width="${w - 8}" height="${h - 16}" rx="${(h - 16) / 2}"/><ellipse class="glow" cx="${w / 2}" cy="${h / 2 - 3}" rx="${w / 3}" ry="8" fill="#ffb020"/>`,
  },
  spectro: {
    cat: 4,
    n: 'Spectrometer',
    pre: 'SP',
    w: 60,
    h: 50,
    ports: [],
    tags: [
      ['C', 'Carbon', '%', 3.62, 3.45, 3.5, 3.75, 3.8, 0.01, 'carb', 2, 1],
      ['CE', 'Carbon equivalent', '–', 4.37, 4.2, 4.25, 4.48, 4.55, 0.01, 'ce', 2, 1],
    ],
    draw: (w, h) =>
      `<rect class="s-steel" x="2" y="10" width="${w - 4}" height="${h - 12}" rx="4"/><rect class="s-screen" x="8" y="16" width="28" height="17" rx="2"/><path d="M11 29L15 21L19 27L23 19L27 25L31 22" stroke="#60a5fa" stroke-width="1.5" fill="none"/><circle cx="46" cy="24" r="6" fill="#fde68a" stroke="#b45309"/>`,
  },
  ladle: {
    cat: 4,
    n: 'Treatment Ladle',
    pre: 'LD',
    w: 60,
    h: 60,
    ports: [
      ['in', 'l', 0, 30, 'in', 'metal', 1],
      ['out', 't', 30, 0, 'out', 'metal', 1],
    ],
    tags: [['TEMP', 'Ladle temperature', '°C', 1460, 1400, 1420, 1490, 1510, 1.8, 'ladleT', 0]],
    draw: () =>
      `<path class="s-steel" d="M8 10H52L46 54H14Z"/><ellipse class="glow" cx="30" cy="12" rx="21" ry="5" fill="#ffb020" stroke="#d9480f"/><path class="s-dark" d="M26 0H34V8H26Z"/>`,
  },
  pourUnit: {
    cat: 4,
    n: 'Auto Pouring Unit',
    pre: 'PU',
    w: 90,
    h: 80,
    ports: [
      ['mold', 'l', 0, 60, 'in', 'any', 1],
      ['metal', 'b', 45, 80, 'in', 'metal', 1],
      ['out', 'r', 90, 60, 'out', 'any', 1],
    ],
    tags: [
      ['TEMP', 'Pouring temperature', '°C', 1420, 1370, 1390, 1445, 1460, 1.3, 'pourT', 0],
      ['PT', 'Pour time', 's', 7.8, null, null, 9.5, 11, 0.07, 'ptime', 1],
    ],
    draw: w =>
      `<rect class="s-dark" x="0" y="66" width="${w}" height="6"/><path class="s-steel" d="M14 6H76V44Q76 54 66 54H24Q14 54 14 44Z"/><ellipse class="glow" cx="45" cy="14" rx="26" ry="6" fill="#ffb020"/><rect x="43" y="0" width="4" height="42" fill="#64748b"/><path class="pour" d="M45 54V66" stroke="#ff9f1c" stroke-width="3"/><path class="s-dark" d="M40 72H50V80H40Z"/>`,
  },
  /* ---------- Cooling & shakeout ---------- */
  shakeoutUnit: {
    cat: 5,
    n: 'Mold Dump / Shakeout',
    pre: 'SO',
    w: 72,
    h: 34,
    ports: (w, h) => [
      ['in', 'l', 0, 12, 'in', 'any', 1],
      ['sand', 'b', w / 2, h, 'out', 'any', 1],
      ['cast', 'r', w, 12, 'out', 'cast', 0],
    ],
    tags: [
      ['VIB', 'Grid vibration', 'mm/s', 9, null, null, 14, 17, 0.15, 'svib', 1],
      ['STMP', 'Sand temp at shakeout', '°C', 85, null, null, 110, 130, 0.6, 'shsand', 0],
    ],
    draw: (w, h) =>
      `<g class="vib"><path class="s-orange" d="M2 6H${w - 2}V20H2Z"/><path d="M6 13H${w - 6}" stroke="#7c2d12" stroke-width="1.6" stroke-dasharray="3 3"/><rect class="s-mold" x="16" y="0" width="16" height="7" style="fill:#6f6251"/><rect x="38" y="1" width="12" height="6" fill="#7b8794" stroke="#4b5563"/><circle cx="56" cy="4" r="3" fill="#2f8f46"/></g><path class="s-orange" d="M${w / 2 - 14} 20H${w / 2 + 14}L${w / 2 + 6} 28H${w / 2 - 6}Z"/><path class="s-line" d="M6 20L4 30M${w - 6} 20L${w - 4} 30"/>${fallDots(w / 2, h - 6)}`,
  },
  shakeout: {
    cat: 5,
    n: 'Shakeout Grid (large)',
    pre: 'SG',
    w: 110,
    h: 60,
    ports: [
      ['in', 'l', 0, 30, 'in', 'any', 1],
      ['cast', 'r', 110, 30, 'out', 'cast', 0],
      ['sand', 'b', 55, 60, 'out', 'any', 1],
    ],
    tags: [
      ['CTMP', 'Casting temp at shakeout', '°C', 560, null, null, 650, 720, 3, 'stemp', 0],
      ['STMP', 'Sand temp at shakeout', '°C', 85, null, null, 110, 130, 0.6, 'shsand', 0],
    ],
    draw: () =>
      `<g class="vib"><path class="s-steel" d="M2 18H108V34H2Z"/><path d="M8 26H102" stroke="#334155" stroke-width="2" stroke-dasharray="3 3"/><rect class="s-mold" x="28" y="6" width="26" height="12" style="fill:#6f6251"/><rect class="s-cast" x="62" y="9" width="18" height="9"/></g><path class="s-steel" d="M30 38H80L62 56H48Z"/>${fallDots(55, 52)}`,
  },
  coolConv: {
    cat: 5,
    n: 'Cooling Line',
    pre: 'CL',
    w: 220,
    h: 40,
    resize: 'w',
    ports: (w, h) => [
      ['in', 'l', 0, h / 2, 'in', 'any', 1],
      ['out', 'r', w, h / 2, 'out', 'any', 1],
    ],
    tags: [['CT', 'Mold cooling time', 'min', 46, 34, 38, 60, 70, 0.15, 'ctime', 0]],
    draw: (w, h, s, b, uid) => conveyorMolds(w, h, uid, true, b),
  },
  castCooler: {
    cat: 5,
    n: 'Casting Cooler',
    pre: 'CC',
    w: 90,
    h: 50,
    ports: [
      ['in', 'l', 0, 25, 'in', 'cast', 1],
      ['out', 'r', 90, 25, 'out', 'cast', 1],
    ],
    tags: [['TOUT', 'Casting exit temperature', '°C', 115, null, null, 160, 200, 0.8, 'cctemp', 0]],
    draw: w =>
      `<rect class="s-steel" x="6" y="8" width="${w - 12}" height="30" rx="15"/><g class="vib"><path class="s-line" d="M26 9V37M${w / 2} 9V37M${w - 26} 9V37"/></g><circle class="s-dark" cx="18" cy="44" r="5"/><circle class="s-dark" cx="${w - 18}" cy="44" r="5"/>`,
  },
  /* ---------- Finishing ---------- */
  shotBlast: {
    cat: 6,
    n: 'Shot Blast',
    pre: 'SB',
    w: 80,
    h: 70,
    ports: [
      ['in', 'l', 0, 35, 'in', 'cast', 1],
      ['out', 'r', 80, 35, 'out', 'cast', 1],
    ],
    tags: [['AMP', 'Turbine load', 'A', 62, null, 45, 78, 85, 0.5, 'sbamp', 0]],
    draw: (w, h) =>
      `<rect class="s-steel" x="4" y="4" width="${w - 8}" height="${h - 12}" rx="3"/><rect class="s-screen" x="12" y="13" width="28" height="22" rx="2" opacity=".85"/><g class="spin"><circle cx="58" cy="24" r="10" fill="#64748b"/><path d="M58 14V34M48 24H68" stroke="#cbd5e1" stroke-width="2"/></g>`,
  },
  fettling: {
    cat: 6,
    n: 'Fettling / Grinding',
    pre: 'FG',
    w: 70,
    h: 60,
    ports: [
      ['in', 'l', 0, 30, 'in', 'cast', 1],
      ['out', 'r', 70, 30, 'out', 'cast', 1],
    ],
    tags: [['RATE', 'Throughput', 'pcs/h', 220, 150, 180, null, null, 1.6, 'frate', 0]],
    draw: (w, h) =>
      `<rect class="s-dark" x="10" y="${h - 12}" width="50" height="12"/><rect class="s-steel" x="14" y="22" width="22" height="${h - 34}"/><g class="spin"><circle cx="46" cy="22" r="14" fill="#94a3b8" stroke="#475569" stroke-width="2"/><path d="M46 8V36M32 22H60" stroke="#475569"/></g>`,
  },
  inspection: {
    cat: 6,
    n: 'Inspection',
    pre: 'IN',
    w: 70,
    h: 60,
    ports: [
      ['in', 'l', 0, 30, 'in', 'cast', 1],
      ['out', 'r', 70, 30, 'out', 'cast', 0],
    ],
    tags: [['REJ', 'Reject rate', '%', 2.4, null, null, 4, 6, 0.04, 'reject', 1]],
    draw: (w, h) =>
      `<path class="s-belt" d="M0 26H${w}V34H0Z"/><rect class="s-cast" x="24" y="16" width="22" height="10" rx="2"/><rect class="s-dark" x="27" y="0" width="16" height="8" rx="2"/><path d="M29 8L22 16M41 8L48 16" stroke="#60a5fa" stroke-dasharray="2 2"/>`,
  },
  /* ---------- Instruments ---------- */
  analyzer: {
    cat: 7,
    n: 'Analyzer / Sensor Point',
    pre: 'A',
    w: 20,
    h: 20,
    inst: 1,
    noflip: 1,
    ports: [],
    tags: [['PV', 'Analyzer reading', '%', 50, null, null, null, null, 0.3, '', 1]],
    draw: () => '',
    dyn: (w, h, s, b) =>
      `<circle cx="10" cy="10" r="9" fill="${sevC(s.sev)}" stroke="#fff" stroke-width="1.4"/><text x="10" y="13.5" class="t-inw" text-anchor="middle">A</text>`,
  },
  motor: {
    cat: 7,
    n: 'Motor',
    pre: 'M',
    w: 20,
    h: 20,
    inst: 1,
    noflip: 1,
    ports: [],
    tags: [['CUR', 'Motor current', 'A', 22, null, null, 30, 34, 0.25, '', 1]],
    draw: () =>
      `<circle cx="10" cy="10" r="9" fill="#fff" stroke="#1f2937" stroke-width="1.6"/><text x="10" y="13.5" class="t-in" text-anchor="middle">M</text><g class="spin"><path d="M10 1A9 9 0 0119 10" stroke="#2f8f46" stroke-width="2" fill="none"/></g>`,
  },
  valve: {
    cat: 7,
    n: 'Valve',
    pre: 'V',
    w: 18,
    h: 14,
    inst: 1,
    noflip: 1,
    ports: [],
    tags: [['POS', 'Valve position', '%', 100, null, null, null, null, 0, 'vpos', 0]],
    draw: () => '',
    dyn: (w, h, s) => {
      const c = s.pos == null ? '#94a3b8' : s.pos > 60 ? '#2f8f46' : s.pos < 10 ? '#d93636' : '#c99a00';
      return `<path d="M1 1L9 7L1 13Z M17 1L9 7L17 13Z" fill="${c}" stroke="#1f2937" stroke-width="1"/>`;
    },
  },
  ctrlValve: {
    cat: 7,
    n: 'Control Valve',
    pre: 'XV',
    w: 18,
    h: 22,
    inst: 1,
    noflip: 1,
    ports: [],
    tags: [['POS', 'Valve position', '%', 55, null, 5, 95, null, 0.6, 'cvpos', 0]],
    draw: () =>
      `<path d="M9 8V2" stroke="#1f2937"/><path d="M3 4Q9 -3 15 4Z" fill="#cbd5e1" stroke="#1f2937"/>`,
    dyn: (w, h, s) => {
      const c = s.pos == null ? '#94a3b8' : s.pos > 60 ? '#2f8f46' : s.pos < 10 ? '#d93636' : '#c99a00';
      return `<path d="M1 9L9 15L1 21Z M17 9L9 15L17 21Z" fill="${c}" stroke="#1f2937" stroke-width="1"/>`;
    },
  },
  flowTx: {
    cat: 7,
    n: 'Flow Transmitter',
    pre: 'FT',
    w: 32,
    h: 28,
    inst: 1,
    noflip: 1,
    ports: [],
    tags: [['PV', 'Flow', 't/h', 12, null, 8, 16, 18, 0.12, 'flow', 1]],
    draw: (w, h, s, b) =>
      `<rect x="1" y="1" width="${w - 2}" height="11" fill="#7cc576" stroke="#2f7d32"/><text x="${w / 2}" y="9.5" class="t-sm" text-anchor="middle">${esc(b.name)}</text><path d="M${w / 2} 12V18M${w / 2 - 6} 18L${w / 2 + 6} 26M${w / 2 - 6} 26L${w / 2 + 6} 18" stroke="#2f7d32" stroke-width="1.4"/>`,
  },
  levelTx: {
    cat: 7,
    n: 'Level Transmitter',
    pre: 'LT',
    w: 32,
    h: 28,
    inst: 1,
    noflip: 1,
    ports: [],
    tags: [['PV', 'Level', '%', 60, 10, 20, 90, 96, 0.3, '', 0]],
    draw: (w, h, s, b) =>
      `<rect x="1" y="1" width="${w - 2}" height="11" fill="#e9eef5" stroke="#475569"/><text x="${w / 2}" y="9.5" class="t-sm" text-anchor="middle">${esc(b.name)}</text><rect x="${w / 2 - 5}" y="13" width="10" height="13" fill="#7cc576" stroke="#2f7d32"/>`,
  },
  tempSensor: {
    cat: 7,
    n: 'Temperature Sensor',
    pre: 'TE',
    w: 34,
    h: 16,
    inst: 1,
    noflip: 1,
    ports: [],
    tags: [['PV', 'Temperature', '°C', 40, null, null, 48, 55, 0.2, '', 1]],
    draw: (w, h, s, b) =>
      `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="var(--panel)" stroke="#1f5fbf"/><text x="${w / 2}" y="${h - 4.5}" class="t-sm" text-anchor="middle" style="fill:#1f5fbf">${esc(b.name)}</text>`,
  },
  speedMon: {
    cat: 7,
    n: 'Speed Monitor',
    pre: 'SE',
    w: 34,
    h: 16,
    inst: 1,
    noflip: 1,
    ports: [],
    tags: [['PV', 'Speed', 'rpm', 60, 40, 50, 70, 80, 0.3, '', 0]],
    draw: (w, h, s, b) =>
      `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="var(--panel)" stroke="#1f5fbf"/><text x="${w / 2}" y="${h - 4.5}" class="t-sm" text-anchor="middle" style="fill:#1f5fbf">${esc(b.name)}</text>`,
  },
  /* ---------- HMI widgets ---------- */
  title: {
    cat: 8,
    n: 'Title Block',
    pre: 'TITLE',
    w: 600,
    h: 72,
    resize: 'w',
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    props: { title: 'SAND HANDLING & MOLDING LINE', sub: 'LINE DIAGRAM' },
    draw: (w, h, s, b) =>
      `<text x="${w / 2}" y="34" class="w-title" text-anchor="middle">${esc(b.props.title)}</text><text x="${w / 2}" y="62" class="w-sub" text-anchor="middle">${esc(b.props.sub)}</text>`,
  },
  clock: {
    cat: 8,
    n: 'Clock',
    pre: 'CLK',
    w: 76,
    h: 76,
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    draw: w =>
      `<circle cx="${w / 2}" cy="${w / 2}" r="${w / 2 - 3}" fill="var(--panel)" stroke="#0e2d5c" stroke-width="3"/>${[
        ...Array(12),
      ]
        .map((_, i) => {
          const a = (i * Math.PI) / 6;
          return `<path d="M${w / 2 + Math.cos(a) * (w / 2 - 8)} ${w / 2 + Math.sin(a) * (w / 2 - 8)}L${w / 2 + Math.cos(a) * (w / 2 - 12)} ${w / 2 + Math.sin(a) * (w / 2 - 12)}" stroke="#0e2d5c" stroke-width="1.5"/>`;
        })
        .join('')}`,
    dyn: w => {
      const d = new Date(),
        c = w / 2,
        hand = (a, l, sw, col) =>
          `<path d="M${c} ${c}L${c + Math.sin(a) * l} ${c - Math.cos(a) * l}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
      return (
        hand((((d.getHours() % 12) + d.getMinutes() / 60) * Math.PI) / 6, c * 0.5, 3, '#0e2d5c') +
        hand(((d.getMinutes() + d.getSeconds() / 60) * Math.PI) / 30, c * 0.72, 2, '#0e2d5c') +
        hand((d.getSeconds() * Math.PI) / 30, c * 0.78, 1, '#d93636') +
        `<circle cx="${c}" cy="${c}" r="2.5" fill="#0e2d5c"/>`
      );
    },
  },
  controlPanel: {
    cat: 8,
    n: 'Control Panel (start/stop)',
    pre: 'CP',
    w: 246,
    h: 120,
    resize: 'w',
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    props: {
      title: 'SYSTEM CONTROLS',
      rows: [
        { label: 'SAND TRANSFER', kind: 'cmd', targets: [], on: true },
        { label: 'DUST COLLECTOR RUNNING', kind: 'light', targets: [], on: true },
      ],
    },
    autoH: b => 30 + b.props.rows.length * 24 + 6,
    draw: (w, h, s, b) => {
      let r = `<rect class="w-frame" x="0" y="0" width="${w}" height="${h}" rx="6"/><text x="${w / 2}" y="18" class="w-h" text-anchor="middle">${esc(b.props.title)}</text><path d="M8 26H${w - 8}" stroke="#d5dce7"/>`;
      b.props.rows.forEach((row, i) => {
        const y = 30 + i * 24;
        r += `<text x="22" y="${y + 15}" class="w-l">${esc(row.label)}</text>`;
        if (row.kind === 'cmd')
          r += `<g class="cmdb" data-cmd="start" data-i="${i}"><rect x="${w - 118}" y="${y + 3}" width="50" height="17" rx="2" fill="#5cb85c"/><text x="${w - 93}" y="${y + 15}" class="w-b" text-anchor="middle">START</text></g><g class="cmdb" data-cmd="stop" data-i="${i}"><rect x="${w - 62}" y="${y + 3}" width="50" height="17" rx="2" fill="#d93636"/><text x="${w - 37}" y="${y + 15}" class="w-b" text-anchor="middle">STOP</text></g>`;
        else
          r += `<g class="cmdb" data-cmd="light" data-i="${i}"><rect x="${w - 50}" y="${y + 2}" width="30" height="20" fill="transparent"/></g>`;
        if (i < b.props.rows.length - 1) r += `<path d="M8 ${y + 24}H${w - 8}" stroke="#eef1f6"/>`;
      });
      return r;
    },
    dyn: (w, h, s, b) =>
      b.props.rows
        .map((row, i) => {
          const y = 30 + i * 24,
            on = rowOn(row);
          return row.kind === 'cmd'
            ? `<circle cx="12" cy="${y + 11.5}" r="4" fill="${on ? '#1f9d55' : '#9aa5b5'}"/>` +
                (on
                  ? `<rect x="${w - 118}" y="${y + 3}" width="50" height="17" rx="2" fill="none" stroke="#14532d" stroke-width="1.5"/>`
                  : `<rect x="${w - 62}" y="${y + 3}" width="50" height="17" rx="2" fill="none" stroke="#7f1d1d" stroke-width="1.5"/>`)
            : `<circle cx="${w - 35}" cy="${y + 12}" r="5.5" fill="${on ? '#1f9d55' : '#9aa5b5'}" stroke="#14532d"/>`;
        })
        .join(''),
  },
  requestStation: {
    cat: 8,
    n: 'Request Station (on/off)',
    pre: 'RS',
    w: 170,
    h: 140,
    resize: 'w',
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    props: { title: 'MOLDING SAND\nREQUEST STATION', rows: [{ label: 'P-14', target: null }] },
    autoH: b => 44 + b.props.rows.length * 28 + 6,
    draw: (w, h, s, b) =>
      `<rect class="w-frame" x="0" y="0" width="${w}" height="${h}" rx="3"/>${lines(b.props.title, w / 2, 17, 13, 'w-h')}<path d="M0 40H${w}" stroke="#b8c4d6"/>` +
      b.props.rows
        .map((r, i) => {
          const y = 44 + i * 28;
          return `<text x="14" y="${y + 17}" class="w-h" text-anchor="start">${esc(r.label)}</text><path d="M${w * 0.45} ${y - 4}V${y + 24}" stroke="#d5dce7"/><g class="cmdb" data-cmd="rtoggle" data-i="${i}"><rect x="${w - 82}" y="${y + 3}" width="62" height="18" rx="2" fill="transparent" stroke="#2f7d32"/></g>`;
        })
        .join(''),
    dyn: (w, h, s, b) =>
      b.props.rows
        .map((r, i) => {
          const y = 44 + i * 28,
            t = B(r.target),
            on = t && !t.props.oos;
          return `<rect x="${w - 81}" y="${y + 4}" width="60" height="16" rx="2" fill="${on ? '#5cb85c' : '#cbd5e1'}"/><text x="${w - 51}" y="${y + 15.5}" class="w-b" text-anchor="middle" style="fill:${on ? '#fff' : '#334155'}">${t ? (on ? 'ON' : 'OFF') : 'SET'}</text>`;
        })
        .join(''),
  },
  statusMatrix: {
    cat: 8,
    n: 'Station Status Matrix',
    pre: 'SS',
    w: 266,
    h: 188,
    resize: 'w',
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    props: { title: 'MOLDING SAND STATION', cols: [] },
    draw: (w, h, s, b) => {
      const rows = [
          'REQUEST SAND',
          'READY',
          'E-STOP',
          'WAITING FOR\nSHAKEOUT',
          'SHAKEOUT\nSTART',
          'BLOW AUTO /\nMANUAL',
        ],
        cols = b.props.cols.length ? b.props.cols : [null],
        lw = 88,
        cw = (w - lw) / cols.length;
      let r = `<rect class="w-frame" x="0" y="0" width="${w}" height="${h}"/><text x="${lw + (w - lw) / 2}" y="16" class="w-h" text-anchor="middle">${esc(b.props.title)}</text><path d="M${lw} 22H${w}M0 46H${w}M${lw} 0V${h}" stroke="#b8c4d6"/>`;
      cols.forEach((c, i) => {
        const x = lw + cw * i;
        r += lines(c ? (B(c)?.name || '?') + '\nDM/OFF' : 'Choose\nmachines', x + cw / 2, 32, 10, 't-sm');
        if (i) r += `<path d="M${x} 22V${h}" stroke="#d5dce7"/>`;
      });
      rows.forEach((l, j) => {
        const y = 46 + j * 23.5;
        r +=
          lines(l, 6, y + 14 - (l.includes('\n') ? 4 : 0), 8, 't-sm', 'start') +
          `<path d="M0 ${y + 23.5}H${w}" stroke="#eef1f6"/>`;
        if (j === 5)
          cols.forEach((c, i) => {
            r += `<g class="cmdb" data-cmd="blow" data-i="${i}"><rect x="${lw + cw * i + cw / 2 - 10}" y="${y + 2}" width="20" height="20" fill="transparent"/></g>`;
          });
      });
      return r;
    },
    dyn: (w, h, s, b) => {
      const cols = b.props.cols,
        lw = 88,
        cw = (w - lw) / Math.max(1, cols.length);
      let r = '';
      cols.forEach((c, i) => {
        const m = B(c);
        if (!m) return;
        const st = matrixState(m);
        st.forEach((on, j) => {
          const y = 46 + j * 23.5;
          r += `<circle cx="${lw + cw * i + cw / 2}" cy="${y + 12}" r="5.5" fill="${on ? (j === 2 ? '#d93636' : j === 0 || j === 3 ? '#ec9a15' : '#1f9d55') : '#fff'}" stroke="#475569"/>`;
        });
      });
      return r;
    },
  },
  toggleBtn: {
    cat: 8,
    n: 'Equipment On/Off Button',
    pre: 'BTN',
    w: 50,
    h: 34,
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    props: { label: 'DISA-1\nON/OFF', target: null },
    draw: (w, h, s, b) =>
      `<g class="cmdb" data-cmd="toggle"><rect x="0" y="0" width="${w}" height="${h}" rx="2" fill="transparent" stroke="#2f7d32" stroke-width="1.4"/></g>`,
    dyn: (w, h, s, b) => {
      const t = B(b.props.target),
        on = t && !t.props.oos;
      return (
        `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="2" fill="${on ? '#7cc576' : '#cbd5e1'}"/>` +
        lines(b.props.label, w / 2, h / 2 - 2, 11, 't-in')
      );
    },
  },
  notice: {
    cat: 8,
    n: 'Notice Sign',
    pre: 'NT',
    w: 132,
    h: 40,
    resize: 'w',
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    props: { text: 'DO NOT OPERATE:\nSand Tech Use Only' },
    draw: (w, h, s, b) =>
      `<rect class="w-frame" x="0" y="0" width="${w}" height="${h}" rx="4"/><circle cx="17" cy="${h / 2}" r="10" fill="none" stroke="#d93636" stroke-width="3"/><path d="M10 ${h / 2 - 7}L24 ${h / 2 + 7}" stroke="#d93636" stroke-width="3"/>${lines(b.props.text, 34, h / 2 - 2, 11, 'w-l', 'start')}`,
  },
  legend: {
    cat: 8,
    n: 'Legend',
    pre: 'LEG',
    w: 1100,
    h: 62,
    resize: 'wh',
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    draw: (w, h, st, b) => {
      /*
       * The legend lists what this loop actually uses.
       *
       * It used to print the same twelve entries on every drawing — eight
       * instrument symbols and four line types — whatever was on the canvas.
       * On a loop with no valves and no air line that is four entries
       * explaining symbols nobody can find, and the two line colours that
       * *are* on the drawing have to be hunted for among them. A legend that
       * does not match its drawing is worse than none: it is read as the key
       * to the drawing, so every wrong entry is a thing to go looking for.
       *
       * So the instruments are the ones placed, and the line types are the
       * ones drawn. A legend somebody has set a list on by hand (`props.items`,
       * added in v9.0) is still theirs and is left exactly alone.
       *
       * The canned list stays as the fallback for an empty canvas, where
       * deriving would leave a blank strip that reads as broken.
       */
      const SYMBOL = {
        analyzer: ['A', 'Analyzer / sensor point'],
        motor: ['M', 'Motor'],
        valve: ['V', 'Valve'],
        ctrlValve: ['CV', 'Control valve'],
        flowTx: ['FT', 'Flow transmitter'],
        levelTx: ['LT', 'Level transmitter'],
        tempSensor: ['TE', 'Temperature sensor'],
        speedMon: ['RPM', 'Speed monitor'],
      };
      const inUse = () => {
        if (typeof DOC === 'undefined' || !DOC) return [];
        const blocks = DOC.blocks || [],
          streams = DOC.streams || [];
        const out = [];
        // Instruments first, in the order the legend has always listed them.
        for (const type of Object.keys(SYMBOL)) {
          if (blocks.some(x => x.type === type)) out.push(SYMBOL[type]);
        }
        // Then the line types actually drawn, in KIND's own order so the
        // colours read down the legend the same way on every loop.
        const drawn = new Set(streams.map(s => s.kind).filter(Boolean));
        for (const k of Object.keys(KIND)) if (drawn.has(k)) out.push([k, '']);
        return out;
      };
      // v9.0 — a legend can carry its own list (props.items): ['#rrggbb', 'label'] draws a line in that colour
      const derived = inUse();
      const items = (b && b.props && Array.isArray(b.props.items) && b.props.items.length && b.props.items) ||
        (derived.length ? derived : [
        ['A', 'Analyzer / sensor point'],
        ['M', 'Motor'],
        ['V', 'Valve'],
        ['CV', 'Control valve'],
        ['FT', 'Flow transmitter'],
        ['LT', 'Level transmitter'],
        ['TE', 'Temperature sensor'],
        ['RPM', 'Speed monitor'],
        ['ret', ''],
        ['add', ''],
        ['sand', ''],
        ['air', ''],
      ]);
      // v5.0 — larger labels: each entry gets the width its label needs (short entries give room to long ones),
      // and the font size is the largest that fits the legend's width (9 px minimum = the old size, 13 px maximum)
      const split = l => l.replace(' / ', '/\n').replace(' transmitter', '\ntransmitter').replace(' sensor', '\nsensor').replace(' monitor', '\nmonitor').replace(' line', '\nline').replace(' valve', '\nvalve').split('\n');
      const symW = k => (KIND[k] || String(k).startsWith('#') ? 34 : k === 'A' || k === 'M' || k === 'V' || k === 'CV' ? 27 : 36);
      const info = items.map(([k, l]) => {
        const lab = KIND[k] ? KIND[k].n : l,
          parts = split(lab);
        return { k, lab, parts, chars: Math.max(...parts.map(p => p.length)), sw: symW(k) };
      });
      const PAD = 12,
        CH = 0.66; // average character width ÷ font size (bold sans, generous so nothing overlaps)
      // v9.16 — when the entries do not fit on one row at a readable size (≥ 9 px), they wrap evenly over 2+ rows
      const need = list => ({ fixed: list.reduce((a, o) => a + o.sw + PAD, 10), chars: list.reduce((a, o) => a + o.chars, 0) });
      const fitFs = list => {
        const n = need(list);
        return (w - n.fixed) / (n.chars * CH);
      };
      const chunk = (a, k) => Array.from({ length: Math.ceil(a.length / k) }, (_, i) => a.slice(i * k, i * k + k));
      let rows = 1;
      while (rows < info.length && !chunk(info, Math.ceil(info.length / rows)).every(r => fitFs(r) >= 9)) rows++;
      const groups = chunk(info, Math.ceil(info.length / rows)),
        band = h / groups.length,
        maxP = Math.max(...info.map(o => o.parts.length));
      let fs = Math.max(8.5, Math.min(13, ...groups.map(fitFs))); // never smaller than needed to fit, never above 13 px
      if (groups.length > 1) fs = Math.max(8, Math.min(fs, (band - 6) / (maxP * 1.18))); // rows must fit the height too
      const lh = Math.round(fs * 1.18 * 10) / 10,
        ks = Math.max(8, Math.min(10.5, fs * 0.8));
      return (
        `<rect class="w-frame" x="0" y="0" width="${w}" height="${h}" rx="6"/>` +
        groups
          .map((row, ri) => {
            const n = need(row),
              extra = Math.max(0, w - n.fixed - n.chars * CH * fs) / row.length; // spread any remaining space evenly
            let cx = 10;
            return row
              .map(o => {
                const k = o.k,
                  x = cx,
                  y = band * ri + band / 2;
                cx += o.sw + o.chars * CH * fs + PAD + extra;
                let sym;
                if (String(k).startsWith('#')) {
                  sym = `<path d="M${x} ${y}H${x + 28}" stroke="${k}" stroke-width="3"/>`;
                } else if (KIND[k]) {
                  sym = `<path d="M${x} ${y}H${x + 28}" stroke="${KIND[k].c}" stroke-width="2.8" ${k === 'ret' ? 'stroke-dasharray="5 3"' : ''}/>`;
                } else if (k === 'A')
                  sym = `<circle cx="${x + 10}" cy="${y}" r="9" fill="#1f9d55"/><text x="${x + 10}" y="${y + ks * 0.36}" text-anchor="middle" style="font:700 ${ks}px var(--sans);fill:#fff">A</text>`;
                else if (k === 'M')
                  sym = `<circle cx="${x + 10}" cy="${y}" r="9" fill="#fff" stroke="#1f2937"/><text x="${x + 10}" y="${y + ks * 0.36}" text-anchor="middle" style="font:700 ${ks}px var(--sans);fill:#1f2937">M</text>`;
                else if (k === 'V')
                  sym = `<path d="M${x + 2} ${y - 7}L${x + 11} ${y}L${x + 2} ${y + 7}ZM${x + 20} ${y - 7}L${x + 11} ${y}L${x + 20} ${y + 7}Z" fill="#2f8f46" stroke="#1f2937"/>`;
                else if (k === 'CV')
                  sym = `<path d="M${x + 2} ${y - 2}L${x + 11} ${y + 5}L${x + 2} ${y + 12}ZM${x + 20} ${y - 2}L${x + 11} ${y + 5}L${x + 20} ${y + 12}Z" fill="#2f8f46" stroke="#1f2937"/><path d="M${x + 4} ${y - 6}Q${x + 11} ${y - 14} ${x + 18} ${y - 6}Z" fill="#cbd5e1" stroke="#1f2937"/><path d="M${x + 11} ${y - 6}V${y + 5}" stroke="#1f2937"/>`;
                else
                  sym = `<rect x="${x}" y="${y - 9}" width="30" height="17" fill="${k === 'FT' ? '#7cc576' : 'var(--panel)'}" stroke="${k === 'TE' || k === 'RPM' ? '#1f5fbf' : '#475569'}"/><text x="${x + 15}" y="${y + ks * 0.36}" text-anchor="middle" style="font:600 ${k === 'RPM' ? ks * 0.85 : ks}px var(--sans);fill:#334155">${k}</text>`;
                const parts = o.parts;
                const tx = x + o.sw,
                  y0 = y - ((parts.length - 1) * lh) / 2 + fs * 0.35;
                return (
                  sym +
                  `<text class="w-l lg-l" x="${tx}" y="${y0}" style="font-size:${fs.toFixed(1)}px">${parts.map((t, n) => `<tspan x="${tx}" ${n ? `dy="${lh}"` : ''}>${esc(t)}</tspan>`).join('')}</text>`
                );
              })
              .join('');
          })
          .join('')
      );
    },
  },
  tagCard: {
    cat: 8,
    n: 'Tag Display Card',
    pre: 'TD',
    w: 130,
    h: 56,
    resize: 'w',
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    draw: (w, h) =>
      `<rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="var(--panel)" stroke="var(--line)"/>`,
    dyn: (w, h, s, b) => {
      const id = b.tags?.[0]?.id,
        t = id && REG[id];
      return `<rect x="0" y="0" width="5" height="${h}" rx="2" fill="${t ? sevC(tagSev(id)) : '#94a3b8'}"/><text x="12" y="16" class="tc-l">${t ? esc(t.id) : 'Bind a tag in Properties'}</text><text x="12" y="${h - 12}" class="tc-v">${t ? (tagIsText(t) ? esc(tagTxt(id)) : fmtN(val(id), t.d)) : '—'} <tspan class="tc-u">${t && !tagIsText(t) ? esc(t.unit) : ''}</tspan></text>`;
    },
  },
  areaBox: {
    cat: 8,
    n: 'Area Box (zone)',
    pre: 'AR',
    w: 340,
    h: 220,
    resize: 'wh',
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    props: { text: 'Area' },
    // v9.1 — zone style (props.zstyle): 'dashed' (default) · 'panel' (soft solid panel, no dotted border) · 'title' (heading only)
    draw: (w, h, s, b) => {
      const zs = b?.props?.zstyle || 'dashed',
        t = esc(b?.props?.text || 'Area');
      if (zs === 'title') return `<text x="4" y="17" class="lbl-t zone-t">${t}</text>`;
      if (zs === 'panel') {
        // v9.4 — optional number badge (props.num) before the heading
        const n = b?.props?.num;
        const badge = n ? `<circle class="zone-num" cx="22" cy="20" r="11"/><text x="22" y="24.5" text-anchor="middle" class="zone-numt">${esc(String(n))}</text>` : '';
        return `<rect class="zone-panel" x="0" y="0" width="${w}" height="${h}" rx="10"/>${n ? '' : `<path class="zone-head" d="M10 0H${w - 10}A10 10 0 0 1 ${w} 10V28H0V10A10 10 0 0 1 10 0Z"/>`}${badge}<text x="${n ? 42 : 12}" y="${n ? 25 : 19}" class="lbl-t zone-t${n ? ' zone-tn' : ''}">${t}</text>`;
      }
      return `<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="var(--accent-l)" fill-opacity=".38" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="7 5"/><text x="11" y="19" class="lbl-t">${t}</text>`;
    },
  },
  label: {
    cat: 8,
    n: 'Text Label',
    pre: 'TX',
    w: 160,
    h: 24,
    widget: 1,
    noflip: 1,
    ports: [],
    tags: [],
    props: { text: 'Label' },
    draw: (w, h, s, b) => `<text x="0" y="17" class="lbl-t">${esc(b?.props?.text || 'Label')}</text>`,
  },
  /* v3.0 — Insert › Shapes (Option A ribbon): plain drawing shapes with an optional text and a colour */
  shRect: shapeDef('Rectangle', 'SH', 160, 100, (w, h, c) => `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-width="2"/>`),
  shEllipse: shapeDef('Ellipse', 'SH', 150, 100, (w, h, c) => `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 1.5}" ry="${h / 2 - 1.5}" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-width="2"/>`),
  shArrow: shapeDef('Arrow line', 'SH', 180, 28, (w, h, c) => `<path d="M2 ${h / 2}H${w - 14}" stroke="${c}" stroke-width="3" stroke-linecap="round"/><path d="M${w - 16} ${h / 2 - 9}L${w - 2} ${h / 2}L${w - 16} ${h / 2 + 9}z" fill="${c}"/>`, true),
  shBlockArrow: shapeDef('Block arrow', 'SH', 170, 80, (w, h, c) => `<path d="M2 ${h * 0.28}H${w * 0.62}V2L${w - 2} ${h / 2}L${w * 0.62} ${h - 2}V${h * 0.72}H2z" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`),
  shCallout: shapeDef('Callout', 'SH', 190, 96, (w, h, c) => `<path d="M8 2H${w - 8}a6 6 0 0 1 6 6V${h * 0.7 - 6}a6 6 0 0 1-6 6H${w * 0.36}L${w * 0.2} ${h - 2}L${w * 0.24} ${h * 0.7}H8a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`, false, 0.35),
};
/* v3.6 — Create Loop from Image: placeholder for equipment that is not in the library (never listed in the library) */
EQ.unmapped = {
  type: 'unmapped',
  cat: -1,
  n: 'Equipment not found in Library',
  pre: 'EQ',
  w: 120,
  h: 80,
  resize: 'wh',
  noflip: 1,
  notag: 1,
  tags: [],
  props: { text: '' },
  ports: (w, h) => [
    ['in', 'l', 0, h / 2, 'in', 'any', 0],
    ['out', 'r', w, h / 2, 'out', 'any', 0],
    ['top', 't', w / 2, 0, 'io', 'any', 0],
    ['bottom', 'b', w / 2, h, 'io', 'any', 0],
  ],
  draw: (w, h, s, b) =>
    `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" fill="#fff7e6" stroke="#c27803" stroke-width="2" stroke-dasharray="7 5"/>` +
    `<text x="${w / 2}" y="${h / 2 - 4}" text-anchor="middle" style="font:700 22px var(--sans);fill:#c27803">?</text>` +
    `<text x="${w / 2}" y="${h / 2 + 16}" text-anchor="middle" style="font:600 10px var(--sans);fill:#8a5a00">${esc((b && b.props && b.props.text) || 'Not in library')}</text>`,
};

function shapeDef(n, pre, w, h, body, noText, ty) {
  return {
    cat: 8,
    n,
    pre,
    w,
    h,
    resize: 'wh',
    widget: 1,
    shape: 1,
    ports: [],
    tags: [],
    props: { text: '', color: '#1f6feb' },
    draw: (W, H, s, b) => {
      const c = /^#[0-9a-f]{6}$/i.test(b?.props?.color || '') ? b.props.color : '#1f6feb',
        t = b?.props?.text || '';
      return body(W, H, c) + (t && !noText ? `<text x="${W / 2}" y="${H * (ty || 0.5) + 4}" text-anchor="middle" class="lbl-t" style="font-size:13px">${esc(t)}</text>` : '');
    },
  };
}
const CATS = [
  'Storage & Dosing',
  'Sand Preparation',
  'Conveying',
  'Molding',
  'Melting & Pouring',
  'Cooling & Shakeout',
  'Finishing',
  'Instruments',
  'HMI Widgets',
];
// v7.5 — the sand additive bin and the ACK sand bin without text inside (same drawing, live level and % reading)
EQ.sandBinPlain = { ...EQ.additiveBin, n: 'Sand additive bin (no text)', pre: 'BIN', w: 72, h: 220, props: { label: '' } };
EQ.ackBinPlain = { ...EQ.additiveBin, n: 'ACK sand bin (no text)', pre: 'BIN', w: 72, h: 200, props: { label: '' } };
Object.keys(EQ).forEach(k => {
  EQ[k].type = k;
});
const PRESC = {
  'Brake Disc': { bent: 18, coal: 6, water: 32 },
  Hub: { bent: 16.5, coal: 5.2, water: 30 },
  Housing: { bent: 19.5, coal: 6.8, water: 34 },
  Bracket: { bent: 15, coal: 4.5, water: 28 },
};
const AREA_STAGE = [
  'Sand Preparation',
  'Sand Preparation',
  'Sand Preparation',
  'Molding',
  'Pouring',
  'Cooling & Knockout',
  'Fettling & Inspection',
  '—',
  '—',
];
const DIST = [
  {
    id: 'hot',
    n: 'Hot return sand',
    fx: { rtemp: 14, cooltemp: 9, cmoist: -0.5, moist: -0.45, compact: -6, shsand: 22, mtemp: 8 },
  },
  { id: 'wet', n: 'Water valve stuck open', fx: { water: 12, moist: 0.75, compact: 7, gcs: -1.6 } },
  {
    id: 'bent',
    n: 'Bentonite under-dosing',
    fx: { bent: -2.6, gcs: -2.9, aclay: -1.1, compact: -3, dose: -2.5 },
  },
  { id: 'melt', n: 'Low pouring temperature', fx: { melt: -60, hold: -42, ladleT: -48, pourT: -48 } },
  { id: 'sqz', n: 'Squeeze pressure loss', fx: { squeeze: -2.3, hard: -9, reject: 2.7 } },
  { id: 'mot', n: 'Mixer motor overload', fx: { mcur: 50, btime: 22, rpm: -9 } },
  { id: 'elev', n: 'Elevator overload', fx: { ecur: 10, load: 30 } },
];
