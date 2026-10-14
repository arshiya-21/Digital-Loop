/*! SandMan Process Flowsheet — 09-replay-data.js
 *  Shift history model, castings & genealogy (sample data generator — replace with historian / traceability APIs)
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===================================================================
   Shift replay + casting traceability
   History, molds and genealogy are generated deterministically here so the
   workflow can be tried; in production they come from the SandMan historian
   and traceability tables (see /history, /events, /trace APIs).
   =================================================================== */
const HOUR = 3600e3,
  SHIFT_MS = 8 * HOUR,
  SHIFTS = [
    ['A', 6],
    ['B', 14],
    ['C', 22],
  ];
let TPATH = new Set(),
  RPsave = null;
let _shC = null;
function shiftOf(t) {
  if (_shC && t >= _shC.t0 && t < _shC.t1) return _shC;
  return (_shC = shiftOf_(t));
}
function shiftOf_(t) {
  const d = new Date(t),
    h = d.getHours();
  let L,
    s = new Date(d);
  if (h >= 6 && h < 14) {
    L = 'A';
    s.setHours(6, 0, 0, 0);
  } else if (h >= 14 && h < 22) {
    L = 'B';
    s.setHours(14, 0, 0, 0);
  } else {
    L = 'C';
    if (h < 6) s.setDate(s.getDate() - 1);
    s.setHours(22, 0, 0, 0);
  }
  const k = s.getTime();
  const dc =
    String(s.getFullYear()).slice(2) +
    String(s.getMonth() + 1).padStart(2, '0') +
    String(s.getDate()).padStart(2, '0');
  return {
    t0: k,
    t1: k + SHIFT_MS,
    L,
    code: dc + L,
    label: `Shift ${L} · ${s.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${String(s.getHours()).padStart(2, '0')}:00–${String((s.getHours() + 8) % 24).padStart(2, '0')}:00`,
  };
}
function recentShifts() {
  const now = Date.now(),
    cur = shiftOf(now),
    out = [{ ...cur, current: 1 }];
  let t = cur.t0 - 1;
  for (let i = 0; i < 3; i++) {
    const s = shiftOf(t);
    out.push(s);
    t = s.t0 - 1;
  }
  return out;
}
function hseed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
function hrand(str) {
  return hseed(str + '#' + str.length);
}
const INCIDENTS = [
  {
    id: 'hot',
    n: 'Hot return sand',
    from: 0.17,
    to: 0.27,
    fx: { rtemp: 13, cooltemp: 8, cmoist: -0.45, moist: -0.42, compact: -5.5, shsand: 20, mtemp: 7 },
  },
  {
    id: 'bent',
    n: 'Bentonite under-dosing',
    from: 0.5,
    to: 0.57,
    fx: { bent: -2.6, gcs: -2.8, aclay: -1, compact: -3, dose: -2.4 },
  },
  { id: 'stop', n: 'Second molding line stopped (pattern change)', from: 0.72, to: 0.755, stopIdx: 1 },
  {
    id: 'melt',
    n: 'Low pouring temperature',
    from: 0.85,
    to: 0.9,
    fx: { pourT: -46, melt: -55, hold: -40, ladleT: -45 },
  },
];
const GROUPS = [
  [0, 'Brake Disc'],
  [0.42, 'Hub'],
  [0.78, 'Housing'],
];
function rampAt(inc, t, sh) {
  const a = sh.t0 + inc.from * SHIFT_MS,
    b = sh.t0 + inc.to * SHIFT_MS,
    r = (b - a) * 0.18;
  if (t < a || t > b) return 0;
  return Math.min(1, (t - a) / r, (b - t) / r);
}
function incFx(role, t) {
  if (!role) return 0;
  const sh = shiftOf(t);
  let o = 0;
  INCIDENTS.forEach(i => {
    if (i.fx && i.fx[role]) o += i.fx[role] * rampAt(i, t, sh);
  });
  return o;
}
function moldingMachines() {
  return DOC.blocks.filter(
    b =>
      ['disaMini', 'disa', 'hmold'].includes(b.type) ||
      (EQ[b.type]?.def?.base && ['disaMini', 'disa', 'hmold'].includes(EQ[b.type].def.base)),
  );
}
function stoppedAt(b, t) {
  const sh = shiftOf(t),
    mm = (RP && RP.mm) || moldingMachines();
  return INCIDENTS.some(
    i =>
      i.stopIdx != null &&
      mm[i.stopIdx] === b &&
      t >= sh.t0 + i.from * SHIFT_MS &&
      t <= sh.t0 + i.to * SHIFT_MS,
  );
}
function groupAt(t) {
  const sh = shiftOf(t),
    f = (t - sh.t0) / SHIFT_MS;
  let g = GROUPS[0][1];
  GROUPS.forEach(([a, n]) => {
    if (f >= a) g = n;
  });
  return g;
}
const SEEDS = new Map();
function seedOf(id) {
  let v = SEEDS.get(id);
  if (v == null) {
    v = hseed(id);
    SEEDS.set(id, v);
  }
  return v;
}
const INCROLES = new Set(INCIDENTS.flatMap(i => (i.fx ? Object.keys(i.fx) : [])));
function histVal(id, t) {
  const tg = REG[id];
  if (!tg) return null;
  const s0 = seedOf(id),
    s = s0 * 6.283,
    ts = t / 1000;
  if (tg.cyc) {
    const [mn, mx, P] = tg.cyc,
      ph = ((((ts + s * 500) % P) + P) % P) / P;
    return clamp(ph < 0.4 ? mn + ((mx - mn) * ph) / 0.4 : mx - ((mx - mn) * (ph - 0.4)) / 0.6, 0, 100);
  }
  const tq = tg.lab ? Math.floor(ts / 1800) * 1800 : Math.floor(ts / 5) * 5,
    j = Math.sin(s0 * 9301.7 + tq * 0.0123457) * 43758.5453;
  return (
    tg.typ +
    (Math.sin(tq / 900 + s) * 0.7 + Math.sin(tq / 233 + s * 2) * 0.35 + Math.sin(tq / 61 + s * 3) * 0.15) *
      tg.noise *
      2 +
    (j - Math.floor(j) - 0.5) * tg.noise * 1.2 +
    (INCROLES.has(tg.role) ? incFx(tg.role, tq * 1000) : 0)
  );
}
/* --- genealogy --- */
function upFind(b, test, depth = 6) {
  let q = [b],
    seen = new Set([b.id]);
  for (let d = 0; d < depth && q.length; d++) {
    const nx = [];
    for (const x of q)
      for (const y of srcBlocks(x)) {
        if (seen.has(y.id)) continue;
        seen.add(y.id);
        if (test(y)) return y;
        nx.push(y);
      }
    q = nx;
  }
  return null;
}
function downFind(b, test, depth = 6) {
  let q = [b],
    seen = new Set([b.id]);
  for (let d = 0; d < depth && q.length; d++) {
    const nx = [];
    for (const x of q)
      for (const y of dstBlocks(x)) {
        if (seen.has(y.id)) continue;
        seen.add(y.id);
        if (test(y)) return y;
        nx.push(y);
      }
    q = nx;
  }
  return null;
}
const isMixer = b => EQ[b.type]?.batch || /mixer/i.test(b.type);
function ladleFor(m) {
  const pu = downFind(m, b => b.type === 'pourUnit' || b.type === 'pourLadle');
  if (pu) return pu;
  const line = dstBlocks(m)[0];
  if (!line) return null;
  const L = dims(line);
  return (
    DOC.blocks
      .filter(b => b.type === 'pourLadle')
      .map(b => ({ b, d: Math.abs(b.x - (line.x + L.W / 2)) + Math.abs(b.y - line.y) * 3 }))
      .filter(o => o.b.y < line.y + 20 && o.b.y > line.y - 160)
      .sort((a, b) => a.d - b.d)[0]?.b || null
  );
}
const TRC = new Map();
function tagRole(block, role, suf) {
  const ck = (block ? block.id : '-') + '|' + role + '|' + (suf || '');
  if (TRC.has(ck)) return TRC.get(ck);
  const r = tagRole_(block, role, suf);
  TRC.set(ck, r);
  return r;
}
function tagRole_(block, role, suf) {
  if (block) {
    const t = block.tags.find(
      x => REG[x.id] && (REG[x.id].role === role || (suf && x.id.endsWith('.' + suf))),
    );
    if (t) return t.id;
  }
  const any = Object.values(REG).find(x => x.role === role);
  return any ? any.id : null;
}
function chainFor(m) {
  if (!chainFor.c) chainFor.c = {};
  const k = m.id + ':' + DOC.blocks.length + ':' + DOC.streams.length;
  if (chainFor.c[k]) return chainFor.c[k];
  const mixer = upFind(m, isMixer),
    hopper = hopperOf(m),
    ladle = ladleFor(m),
    so = shakeoutOf(m),
    line = dstBlocks(m)[0] || null;
  return (chainFor.c[k] = { mixer, hopper, ladle, so, line });
}
const DELAY = { sand: 14 * 60e3, pour: 4 * 60e3, cool: 46 * 60e3 };
function mphOf(m) {
  const id = tagRole(m, 'mph', 'MPH');
  return Math.max(60, id ? REG[id].typ : 300);
}
function moldAt(m, sh, i) {
  const int = 3600e3 / mphOf(m),
    t = sh.t0 + i * int;
  if (i < 0 || t > sh.t1) return null;
  const C = chainFor(m),
    id = `${m.name}-${sh.code}-${String(i + 1).padStart(5, '0')}`;
  const sandT = t - DELAY.sand,
    pourT = t + DELAY.pour,
    soT = pourT + DELAY.cool,
    bt = C.mixer ? REG[tagRole(C.mixer, 'btime', 'BT')]?.typ || 90 : 90;
  const g = (blk, role, suf, tt) => {
    const tid = tagRole(blk, role, suf);
    return tid ? { id: tid, v: histVal(tid, tt), t: REG[tid] } : null;
  };
  const F = {
    moist: g(C.mixer, 'moist', 'MOIST', sandT),
    comp: g(C.mixer, 'compact', 'COMP', sandT),
    bent: g(C.mixer, 'bent', 'BENT', sandT),
    gcs: g(null, 'gcs', 'GCS', sandT),
    sqz: g(m, 'squeeze', 'SQZ', t),
    hard: g(m, 'hard', 'HRD', t),
    pour: g(C.ladle, 'pourT', 'TEMP', pourT),
    stmp: g(C.so, 'shsand', 'STMP', soT),
  };
  const dev = (f, dir) => {
    if (!f) return 0;
    const T = f.t;
    if (dir > 0 && T.hi != null) return Math.max(0, (f.v - T.typ) / (T.hi - T.typ));
    if (dir < 0 && T.lo != null) return Math.max(0, (T.typ - f.v) / (T.typ - T.lo));
    return 0;
  };
  const DRV = {
    'Gas porosity': [['moist', 1, 'Mix moisture', 'high moisture releases steam into the mould cavity']],
    'Sand inclusion': [
      ['gcs', -1, 'Green compression strength', 'weak sand erodes and is washed into the casting'],
      ['bent', -1, 'Bentonite dosing', 'under-bonded sand loses strength'],
      ['comp', -1, 'Compactability', 'dry, brittle sand breaks away from the mould face'],
    ],
    'Cold shut / misrun': [['pour', -1, 'Pouring temperature', 'cold metal freezes before the mould fills']],
    'Mold wall movement': [
      ['sqz', -1, 'Squeeze pressure', 'soft moulds bulge under metal pressure'],
      ['hard', -1, 'Mold hardness', 'soft moulds bulge under metal pressure'],
    ],
    'Burn-on / penetration': [
      ['moist', -1, 'Mix moisture', 'dry sand lets metal penetrate the mould surface'],
    ],
  };
  const c = {},
    drv = {};
  Object.entries(DRV).forEach(([k, L]) => {
    let best = null;
    L.forEach(([f, dir, lab, why]) => {
      const v =
        dev(F[f], dir) *
        (k === 'Gas porosity'
          ? 1.6
          : k === 'Cold shut / misrun'
            ? 1.8
            : k === 'Burn-on / penetration'
              ? 0.9
              : k === 'Mold wall movement'
                ? 1.3
                : 1.4);
      if (!best || v > best.v) best = { v, f, dir, lab, why };
    });
    c[k] = best.v;
    drv[k] = best;
  });
  const risk = 0.012 + Object.values(c).reduce((a, v) => a + Math.min(0.09, Math.max(0, v - 0.6) * 0.07), 0),
    r = hrand(id),
    defect = r < risk;
  let cause = null;
  if (defect) {
    cause = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    cause = cause[1] > 0.3 ? cause[0] : 'Surface finish';
  }
  const heat = Math.floor((pourT - sh.t0) / (45 * 60e3)) + 1,
    batch = Math.floor((sandT - sh.t0) / (bt * 1000)) + 1;
  return {
    drv,
    id,
    m,
    i,
    t,
    sandT,
    pourT,
    soT,
    group: groupAt(t),
    batch: `B${sh.code}-${String(batch).padStart(4, '0')}`,
    heat: `H${sh.code}-${String(heat).padStart(2, '0')}`,
    F,
    c,
    risk,
    defect,
    cause,
    stopped: stoppedAt(m, t),
    C,
  };
}
function moldsIn(m, from, to) {
  const A = RP && RP.M && RP.M[m.id];
  if (A && from >= RP.sh.t0 - SHIFT_MS * 0.01 && to <= RP.sh.t1 + 1) {
    const int = A.int;
    const i0 = Math.max(0, Math.ceil((from - RP.sh.t0) / int)),
      i1 = Math.min(A.arr.length - 1, Math.floor((to - RP.sh.t0) / int));
    const out = [];
    for (let i = i0; i <= i1; i++) {
      const md = A.arr[i];
      if (md && !md.stopped && md.t >= from && md.t <= to) out.push(md);
    }
    return out;
  }
  return moldsIn_(m, from, to);
}
function moldsIn_(m, from, to) {
  const out = [];
  const sh = shiftOf(to),
    int = 3600e3 / mphOf(m);
  let i = Math.max(0, Math.floor((Math.max(from, sh.t0) - sh.t0) / int));
  const iEnd = Math.floor((Math.min(to, sh.t1) - sh.t0) / int);
  for (; i <= iEnd; i++) {
    const md = moldAt(m, sh, i);
    if (md && md.t >= from && md.t <= to && !md.stopped) out.push(md);
  }
  return out;
}
function parseMold(id) {
  const m = /^(.+)-(\d{6})([ABC])-(\d{5})$/.exec(String(id).trim().toUpperCase());
  if (!m) return null;
  const mc = DOC.blocks.find(b => b.name.toUpperCase() === m[1]);
  if (!mc) return null;
  const y = 2000 + +m[2].slice(0, 2),
    mo = +m[2].slice(2, 4) - 1,
    d = +m[2].slice(4, 6),
    h = SHIFTS.find(s => s[0] === m[3])[1];
  const t0 = new Date(y, mo, d, h, 0, 0, 0).getTime();
  return moldAt(mc, shiftOf(t0 + 1000), +m[4] - 1);
}

/* --- traceability panel --- */
let TRW = 15;
function traceKind(b) {
  if (moldingMachines().includes(b)) return 'mold';
  if (isMixer(b)) return 'mixer';
  if (b.type === 'pourLadle' || b.type === 'pourUnit') return 'pour';
  if (['shakeoutUnit', 'shakeout'].includes(b.type)) return 'shake';
  if (['moldLine', 'moldConv', 'coolConv', 'holdingHopper', 'moldHopper'].includes(b.type)) return 'line';
  return null;
}
function machinesFor(b, k) {
  const mm = moldingMachines();
  if (k === 'mold') return [b];
  if (k === 'mixer') return mm.filter(m => chainFor(m).mixer === b);
  if (k === 'pour') return mm.filter(m => chainFor(m).ladle === b);
  if (k === 'shake') return mm.filter(m => chainFor(m).so === b);
  return mm.filter(m => {
    const C = chainFor(m);
    return C.line === b || C.hopper === b;
  });
}
function traceTab(b) {
  const k = traceKind(b),
    T = RP ? RP.T : Date.now(),
    mm = machinesFor(b, k);
  if (!mm.length)
    return `<div class="sec note">No molding line is connected to ${esc(b.name)}, so no castings can be traced through it.</div>`;
  const off =
    k === 'mixer' ? DELAY.sand : k === 'pour' ? -DELAY.pour : k === 'shake' ? -(DELAY.pour + DELAY.cool) : 0;
  const from = T - TRW * 60e3 + off,
    to = T + off;
  let molds = [];
  mm.forEach(m => (molds = molds.concat(moldsIn(m, from, to))));
  molds.sort((a, b) => b.t - a.t);
  const d = molds.filter(x => x.defect).length;
  const byCause = {};
  molds.filter(x => x.defect).forEach(x => (byCause[x.cause] = (byCause[x.cause] || 0) + 1));
  let extra = '';
  if (k === 'mixer') {
    const bat = {};
    molds.forEach(x => {
      bat[x.batch] = bat[x.batch] || { n: 0, d: 0, t: x.sandT, F: x.F };
      bat[x.batch].n++;
      if (x.defect) bat[x.batch].d++;
    });
    extra = `<div class="sec"><h5>Sand batches → molds</h5><div class="tbl-wrap"><table><thead><tr><th>Batch</th><th>Mixed</th><th>Moist.</th><th>Comp.</th><th>Molds</th><th>Defects</th></tr></thead><tbody>${Object.entries(
      bat,
    )
      .slice(0, 12)
      .map(
        ([n, o]) =>
          `<tr><td class="mono">${n.slice(-4)}</td><td class="mono">${hms(new Date(o.t))}</td><td class="num">${o.F.moist ? fmtN(o.F.moist.v, 2) : '—'}</td><td class="num">${o.F.comp ? fmtN(o.F.comp.v, 0) : '—'}</td><td class="num">${o.n}</td><td class="num ${o.d ? 'tx3' : ''}">${o.d}</td></tr>`,
      )
      .join('')}</tbody></table></div></div>`;
  }
  return `<div class="sec"><div class="note">${k === 'mixer' ? 'Castings molded from sand mixed in' : k === 'pour' ? 'Castings poured in' : k === 'shake' ? 'Castings knocked out in' : 'Castings made through'} this window${RP ? '' : ' (live, last minutes)'}.</div>
  <div class="row3" style="margin-top:8px"><div class="tile2"><span>Castings</span><b>${molds.length}</b></div><div class="tile2"><span>Defects</span><b class="${d ? 'tx3' : ''}">${d}</b></div><div class="tile2"><span>Defect rate</span><b class="${molds.length && d / molds.length > 0.05 ? 'tx3' : d ? 'tx2' : 'tx0'}">${molds.length ? ((d / molds.length) * 100).toFixed(1) : '0'}%</b></div></div>
  <div class="row2" style="margin-top:8px"><div class="fld"><label>Window</label><select id="trWinSel">${[5, 15, 30, 60].map(m => `<option value="${m}" ${TRW === m ? 'selected' : ''}>Last ${m} min</option>`).join('')}</select></div><div class="fld"><label>Find casting</label><input id="trFind" class="mono" placeholder="${esc(molds[0]?.id || 'DISA-1-…')}"></div></div>
  ${
    Object.keys(byCause).length
      ? `<div class="note">${Object.entries(byCause)
          .map(([c, n]) => `<span class="chip sv3" style="margin:2px 4px 2px 0">${esc(c)} · ${n}</span>`)
          .join('')}</div>`
      : ''
  }</div>${extra}
  <div class="sec"><h5>Castings <span class="r note">click to trace</span></h5><div class="tbl-wrap" style="max-height:340px;overflow:auto"><table><thead><tr><th>Casting / mold ID</th><th>Molded</th><th>Group</th><th>Result</th></tr></thead><tbody>${
    molds
      .slice(0, 80)
      .map(
        x =>
          `<tr data-mold="${x.id}" style="cursor:pointer"><td class="mono">${x.id}</td><td class="mono">${hms(new Date(x.t))}</td><td>${esc(x.group)}</td><td>${x.defect ? `<span class="chip sv3">${esc(x.cause)}</span>` : '<span class="chip sv0">OK</span>'}</td></tr>`,
      )
      .join('') || '<tr><td colspan="4" class="note">No castings in this window.</td></tr>'
  }</tbody></table></div></div>`;
}
function bindTraceTab(b) {
  const ws = $('#trWinSel');
  if (ws)
    ws.onchange = e => {
      TRW = +e.target.value;
      renderProps();
    };
  const f = $('#trFind');
  if (f)
    f.onkeydown = e => {
      if (e.key === 'Enter') {
        const m = parseMold(f.value);
        if (m) openGenealogy(m);
        else toast('Casting ID not found — format MACHINE-YYMMDDshift-00001');
      }
    };
  $$('#props [data-mold]').forEach(
    r =>
      (r.onclick = () => {
        const m = parseMold(r.dataset.mold);
        if (m) openGenealogy(m);
      }),
  );
}
