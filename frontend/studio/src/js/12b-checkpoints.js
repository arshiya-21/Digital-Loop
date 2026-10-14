/*! SandMan Process Flowsheet — 12b-checkpoints.js
 *  Consolidated process checkpoints (automatic from tags + manual checks) and SOP per process.
 *  Definitions live in DOC.cps (travel with the flowsheet and templates);
 *  manual check records live in localStorage 'sandman-cp-log' (replace with SandMan DB in production). */
'use strict';
const CP_FREQ = {
  Continuous: 0,
  'Every hour': 1,
  'Every 2 h': 2,
  'Every 4 h': 4,
  'Per shift': 8,
  Daily: 24,
  Weekly: 168,
  'Per batch': -1,
  'Per ladle': -1,
  'Per pattern change': -1,
  'Per delivery': -1,
};
const CP_ST = {
  ok: ['OK', 'sv0'],
  due: ['Due', 'sv1'],
  overdue: ['Overdue', 'sv2'],
  out: ['Out of limit', 'sv3'],
  nodata: ['No data', ''],
};
const CP_LIB = [
  {
    key: 'ret',
    name: 'Return sand & cooling',
    pick: b =>
      ['blowerHopper', 'cooler', 'screen', 'polygonSieve', 'magSep', 'returnBin', 'aerator'].includes(b.type),
    roles: ['rtemp', 'cooltemp', 'cmoist', 'fe', 'vib', 'level'],
    manual: [
      ['Screen / sieve mesh intact, not blinded', 'Visual', 'Per shift', 1],
      ['Magnetic separator cleaned', 'Visual', 'Per shift', 0],
      ['Lumps and core pieces removed from screen reject', 'Visual', 'Every 4 h', 0],
      ['Return sand temperature spot check', 'Probe thermometer', 'Every 2 h', 1, null, 50, '°C'],
    ],
    sop: {
      no: 'SOP-SP-01',
      owner: 'Sand plant in-charge',
      steps: [
        'Start the cooler, aerator and dust extraction before allowing return sand to flow.',
        'Check return sand temperature at the cooler outlet every 2 hours; it must stay at or below 45–50 °C.',
        'Keep the blower hopper between 30 % and 85 % level; never run it empty.',
        'Inspect the screen mesh and magnetic separator at the start of each shift; clean and record.',
        'Remove lumps and core pieces from the screen reject and log the quantity.',
      ],
      reaction:
        'Return sand above 50 °C for more than 15 minutes: increase cooler water and air flow, reduce return flow, and inform the sand engineer.',
      ppe: 'Safety shoes, helmet, dust mask, ear protection.',
    },
  },
  {
    key: 'add',
    name: 'Additive storage & dosing',
    pick: b => {
      try {
        return mbAddSet().has(b.id);
      } catch (e) {
        return false;
      }
    },
    roles: ['level', 'dose', 'sfs', 'pmoist'],
    manual: [
      ['Bentonite / coal dust delivery certificate checked', 'Document', 'Per delivery', 1],
      ['Dosing scale zero check', 'Calibration weight', 'Per shift', 1],
      ['Silo filter and level sensor clean', 'Visual', 'Weekly', 0],
    ],
    sop: {
      no: 'SOP-SP-02',
      owner: 'Sand plant in-charge',
      steps: [
        'Verify the supplier certificate (MB value, moisture, grain size) before unloading bentonite or coal dust.',
        'Fill silos only through the filter; confirm level rises on the level gauge.',
        'Carry out a zero check on every dosing scale at the start of each shift.',
        'Confirm the active component group and its additive prescription before production starts.',
        'Record additive consumption per shift.',
      ],
      reaction:
        'Dosing deviates more than ±8 % from prescription: switch the feeder to manual, check for bridging or blockage, and inform the sand engineer.',
      ppe: 'Dust mask (P2), goggles, gloves.',
    },
  },
  {
    key: 'mix',
    name: 'Sand mixing',
    pick: b => (isMixer(b) && !CP_PICK_ADD(b)) || /water/i.test(b.type),
    roles: ['moist', 'compact', 'mtemp', 'bent', 'coal', 'btime', 'mcur', 'water'],
    manual: [
      ['Water meter verified (bucket test)', 'Bucket test', 'Per shift', 1],
      ['Prepared sand sample sent to lab', 'Sampling', 'Every 2 h', 1],
      ['Mixer ploughs and wall scrapers wear', 'Visual / measure', 'Weekly', 0],
    ],
    sop: {
      no: 'SOP-SP-03',
      owner: 'Sand engineer',
      steps: [
        'Confirm the component group and that its sandmix prescription is loaded in SandMan.',
        'Charge return sand, then additives as per prescription.',
        'Add water through the moisture controller; target compactability 36–44 %.',
        'Mix for at least the set batch time before discharge.',
        'Check mixed sand temperature is at or below 45 °C at discharge.',
        'Take a prepared sand sample every 2 hours and send it to the sand lab.',
      ],
      reaction:
        'Compactability outside 36–44 %: adjust the water set point and recheck the next batch. Three batches in a row out of limit: stop discharge to molding and inform the sand engineer.',
      ppe: 'Safety shoes, helmet, ear protection. Lock-out before entering the mixer.',
    },
  },
  {
    key: 'lab',
    name: 'Sand testing (lab)',
    pick: b => b.type === 'sandLab',
    roles: ['gcs', 'perm', 'aclay', 'compact', 'moist'],
    manual: [
      ['Green compression strength test', 'Universal sand tester', 'Every 2 h', 1, 14, 22, 'N/cm²'],
      ['Permeability test', 'Permeameter', 'Every 2 h', 1, 100, 180, 'No.'],
      ['Active clay (methylene blue)', 'MB test', 'Per shift', 0, 7, 10, '%'],
      ['Loss on ignition', 'Muffle furnace', 'Daily', 0, 3, 5, '%'],
      ['Sand tester calibration', 'Standard specimen', 'Daily', 1],
    ],
    sop: {
      no: 'SOP-LAB-01',
      owner: 'Sand lab chemist',
      steps: [
        'Take the sample at the mixer discharge belt, in a closed container.',
        'Prepare the standard AFS specimen (3 rams) within 10 minutes of sampling.',
        'Test compactability, GCS, permeability and moisture; record in SandMan.',
        'Run the MB test for active clay once per shift and LOI once a day.',
        'Calibrate the sand tester with the standard specimen every day before testing.',
      ],
      reaction:
        'Any result outside its limit: inform the sand plant immediately, repeat the test on the next sample, and record the corrective action.',
      ppe: 'Lab coat, gloves, goggles; heat-resistant gloves for the LOI furnace.',
    },
  },
  {
    key: 'mold',
    name: 'Molding',
    pick: b =>
      moldingMachines().includes(b) ||
      ['holdingHopper', 'moldHopper', 'moldLine', 'moldConv', 'coreSetter'].includes(b.type),
    roles: ['squeeze', 'hard', 'mph', 'lspd', 'ccyc'],
    manual: [
      ['Pattern plates clean, parting agent applied', 'Visual', 'Per pattern change', 1],
      ['Mold hardness hand-tester check', 'Hardness tester', 'Every hour', 1, 85, 95, 'B-scale'],
      ['Cores set and verified', 'Visual', 'Per pattern change', 0],
      ['Sprue and vents clear', 'Visual', 'Every hour', 0],
    ],
    sop: {
      no: 'SOP-MLD-01',
      owner: 'Molding supervisor',
      steps: [
        'At pattern change, clean the pattern plates and apply parting agent.',
        'Set squeeze pressure as per the pattern card.',
        'Check the first mold: hardness at least 85 B-scale, no broken edges, sprue clear.',
        'Check mold hardness with the hand tester every hour and record.',
        'Verify cores are seated correctly before closing.',
      ],
      reaction:
        'Hardness below limit: check compactability and squeeze pressure, mark the affected molds, and inform the molding supervisor before pouring them.',
      ppe: 'Safety shoes, helmet, ear protection, gloves. Use the machine guard interlocks.',
    },
  },
  {
    key: 'pour',
    name: 'Melting & pouring',
    pick: b => ['pourLadle', 'pourUnit', 'induction', 'holding', 'cupola', 'ladle'].includes(b.type),
    roles: ['pourT', 'ptime', 'melt', 'hold', 'ladleT', 'carb', 'ce'],
    manual: [
      ['Ladle preheated', 'Thermocouple / visual', 'Per ladle', 1],
      ['Inoculant added and weighed', 'Weighing', 'Per ladle', 1],
      ['Pouring temperature dip check', 'Immersion thermocouple', 'Per ladle', 1, 1390, 1445, '°C'],
      ['Slag removed before pouring', 'Visual', 'Per ladle', 0],
    ],
    sop: {
      no: 'SOP-MLT-01',
      owner: 'Melting in-charge',
      steps: [
        'Wear full molten-metal PPE; clear the pouring area.',
        'Preheat the ladle before tapping.',
        'Tap, add inoculant as per the specification and record the weight.',
        'Measure temperature with an immersion thermocouple; it must be within the pouring window.',
        'De-slag and pour within the set pour time; record the heat number.',
      ],
      reaction:
        'Temperature below the pouring window: do not pour — return metal to the holding furnace and inform the melting in-charge.',
      ppe: 'Aluminised jacket, face shield, molten-metal gloves, leggings, safety shoes.',
    },
  },
  {
    key: 'shk',
    name: 'Cooling & shakeout',
    pick: b => ['shakeoutUnit', 'shakeout', 'coolConv'].includes(b.type),
    roles: ['shsand', 'stemp', 'ctime', 'svib'],
    manual: [
      ['Casting temperature at shakeout spot check', 'IR thermometer', 'Every 2 h', 1, null, 650, '°C'],
      ['Shakeout grid condition', 'Visual', 'Per shift', 0],
      ['Spilled sand cleaned and returned', 'Visual', 'Per shift', 0],
    ],
    sop: {
      no: 'SOP-SHK-01',
      owner: 'Fettling supervisor',
      steps: [
        'Confirm the minimum cooling time is reached before shakeout.',
        'Spot-check casting temperature at shakeout every 2 hours.',
        'Run the shakeout; route sand to the return system.',
        'Inspect the shakeout grid each shift and report damage.',
        'Clean spilled sand and return it to the system.',
      ],
      reaction:
        'Castings hotter than the limit at shakeout: increase cooling time or reduce line speed, and inform the molding supervisor.',
      ppe: 'Heat-resistant gloves, safety shoes, helmet, ear protection.',
    },
  },
];
function CP_PICK_ADD(b) {
  try {
    return mbAddSet().has(b.id);
  } catch (e) {
    return false;
  }
}
let CPLOG = {};
try {
  CPLOG = JSON.parse(localStorage.getItem('sandman-cp-log') || '{}');
} catch (e) {
  CPLOG = {};
}
function cpSaveLog() {
  try {
    localStorage.setItem('sandman-cp-log', JSON.stringify(CPLOG));
  } catch (e) {}
}
let CPSEL = null,
  CPTAB = 'checks',
  CPEDIT = false,
  CPREC = null,
  CPVIEW = 'checks',
  CPSOP = true,
  CPSOPEDIT = false,
  DEF = null,
  CPPICK = false,
  PFOCUS = null;
try {
  CPSOP = localStorage.getItem('sandman-cp-sop') !== '0';
} catch (e) {}

/* ---------- seed / scan ---------- */
function cpScanBlocks(lib) {
  return DOC.blocks.filter(b => !EQ[b.type].widget && !EQ[b.type].inst && lib.pick(b)).map(b => b.id);
}
function cpAutoItems(blockIds, roles) {
  const out = [];
  blockIds.forEach(id => {
    const b = B(id);
    if (!b) return;
    b.tags.forEach(x => {
      const t = REG[x.id];
      if (t && roles.includes(t.role) && !out.some(o => o.tag === x.id))
        out.push({
          id: 'cpa_' + x.id.replace(/[^A-Za-z0-9]/g, '_'),
          kind: 'auto',
          tag: x.id,
          name: `${t.desc} — ${b.name}`,
          method: 'Online sensor',
          freq: 'Continuous',
          crit: [
            'moist',
            'compact',
            'mtemp',
            'bent',
            'rtemp',
            'cooltemp',
            'squeeze',
            'hard',
            'pourT',
            'gcs',
            'shsand',
          ].includes(t.role)
            ? 1
            : 0,
          owner: 'Automatic',
        });
    });
  });
  return out;
}
/* v9.41: kept as the fallback for loops without area boxes; cpSeed() itself is in 12e-process-areas.js */
function cpSeedByType(force) {
  if (DOC.cps && !force) {
    cpEnsureHistory();
    return;
  }
  DOC.cps = CP_LIB.map(lib => {
    const blocks = cpScanBlocks(lib);
    const items = cpAutoItems(blocks, lib.roles).concat(
      lib.manual.map((m, i) => ({
        id: `cpm_${lib.key}_${i}`,
        kind: 'manual',
        name: m[0],
        method: m[1],
        freq: m[2],
        crit: m[3],
        min: m[4] ?? null,
        max: m[5] ?? null,
        unit: m[6] || '',
        owner: lib.sop.owner,
      })),
    );
    return {
      id: 'cp_' + lib.key,
      key: lib.key,
      name: lib.name,
      blocks,
      items,
      sop: Object.assign(
        {
          title: lib.name + ' — standard operating procedure',
          version: '1.0',
          reviewed: new Date().toISOString().slice(0, 10),
        },
        JSON.parse(JSON.stringify(lib.sop)),
      ),
    };
  }).filter(p => p.blocks.length || p.key === 'lab');
  // demo records so the consolidated view is meaningful in the prototype
  const now = Date.now();
  let n = 0;
  DOC.cps.forEach(p =>
    p.items
      .filter(i => i.kind === 'manual')
      .forEach(it => {
        if (CPLOG[it.id] && CPLOG[it.id].length) return;
        const k = n++,
          fh = CP_FREQ[it.freq],
          win = (fh > 0 ? fh : 8) * 3600e3,
          r = hseed(it.id);
        if (k === 6) return; // never recorded → overdue
        const age = k % 6 === 3 ? win * 1.5 : k % 7 === 4 ? win * 1.1 : win * (0.15 + r * 0.6);
        const num = it.min != null || it.max != null,
          lo = it.min ?? it.max * 0.8,
          hi = it.max ?? it.min * 1.2;
        const v = num
          ? +(k === 10 ? lo - (hi - lo) * 0.15 : lo + (hi - lo) * (0.3 + r * 0.4)).toFixed(1)
          : null;
        CPLOG[it.id] = [
          {
            t: now - age,
            v,
            ok: num ? undefined : true,
            by: ['R. Patil', 'S. Kulkarni', 'A. Jadhav', 'M. Shinde'][k % 4],
            note: '',
          },
        ];
      }),
  );
  cpSaveLog();
}
/* ---------- status ---------- */
function cpNow() {
  return RP ? RP.T : Date.now();
}
function cpLast(it) {
  const L = (CPLOG[it.id] || []).filter(r => r.t <= cpNow());
  return L.length ? L[L.length - 1] : null;
}
function cpLimits(it) {
  if (it.kind === 'auto' && REG[it.tag]) {
    const s = spec(REG[it.tag]);
    return {
      min: it.min ?? s.min,
      max: it.max ?? s.max,
      opt: s.opt,
      sd: s.sd,
      unit: REG[it.tag].unit,
      d: REG[it.tag].d,
      num: true,
    };
  }
  const mn = it.min ?? null,
    mx = it.max ?? null,
    num = mn != null || mx != null;
  const opt =
    it.opt ??
    (mn != null && mx != null ? (mn + mx) / 2 : mx != null ? mx * 0.85 : mn != null ? mn * 1.15 : null);
  const sd =
    it.sd ??
    (mn != null && mx != null
      ? (mx - mn) / 6
      : mx != null
        ? (mx - opt) / 3
        : mn != null
          ? (opt - mn) / 3
          : null);
  return {
    min: mn,
    max: mx,
    opt,
    sd,
    unit: it.unit || '',
    d: it.d ?? (Math.abs(opt || 0) >= 100 ? 0 : 1),
    num,
  };
}
function cpStatus(it) {
  const L = cpLimits(it);
  if (it.kind === 'auto') {
    const v = val(it.tag);
    if (v == null || !REG[it.tag]) return { st: 'nodata', v: null };
    const out = (L.min != null && v < L.min) || (L.max != null && v > L.max);
    return { st: out ? 'out' : 'ok', v, t: cpNow() };
  }
  const r = cpLast(it),
    fh = CP_FREQ[it.freq] ?? 8,
    win = (fh > 0 ? fh : 8) * 3600e3,
    now = cpNow();
  if (!r) return { st: 'overdue', v: null };
  if (r.v != null && ((L.min != null && r.v < L.min) || (L.max != null && r.v > L.max)))
    return { st: 'out', v: r.v, t: r.t, r };
  if (r.ok === false) return { st: 'out', v: null, t: r.t, r };
  const age = now - r.t;
  return { st: age > win * 1.25 ? 'overdue' : age > win ? 'due' : 'ok', v: r.v, t: r.t, r };
}
function cpProcStats(p) {
  const S = { ok: 0, due: 0, overdue: 0, out: 0, nodata: 0 };
  p.items.forEach(it => S[cpStatus(it).st]++);
  const n = p.items.length - S.nodata;
  S.n = p.items.length;
  S.pct = n ? Math.round((S.ok / n) * 100) : 100;
  S.worst = S.out ? 'out' : S.overdue ? 'overdue' : S.due ? 'due' : 'ok';
  return S;
}
function cpProcOf(b) {
  return (DOC.cps || []).find(p => p.blocks.includes(b.id)) || null;
}
/* ---------- alerts: critical manual checks that are overdue, and out-of-limit manual readings ---------- */
function cpAlerts() {
  if (RP || !DOC.cps) return;
  DOC.cps.forEach(p =>
    p.items.forEach(it => {
      if (it.kind !== 'manual') return;
      const s = cpStatus(it).st,
        sev = s === 'out' ? 2 : s === 'overdue' && it.crit ? 2 : s === 'due' && it.crit ? 1 : 0;
      raise('cp:' + it.id, sev, {
        blk: p.blocks[0],
        where: p.name,
        msg:
          s === 'out'
            ? `Checkpoint out of limit: ${it.name}`
            : `Checkpoint ${s === 'due' ? 'due' : 'overdue'}: ${it.name} (${it.freq.toLowerCase()})`,
      });
    }),
  );
}
/* ---------- UI ---------- */
const cpChip = s => `<span class="chip ${CP_ST[s][1]}">${CP_ST[s][0]}</span>`;
const cpAgo = t => {
  if (t == null) return '—';
  const m = Math.round((cpNow() - t) / 60e3);
  return m < 1
    ? 'just now'
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.floor(m / 60)} h ${m % 60} min ago`
        : `${Math.floor(m / 1440)} d ago`;
};
const cpPctCol = p => (p >= 90 ? 'var(--ok)' : p >= 75 ? 'var(--adv)' : 'var(--crit)');
function openCP(procId, view) {
  cpSeed();
  if (procId) CPSEL = procId;
  if (!CPSEL || !DOC.cps.some(p => p.id === CPSEL)) CPSEL = DOC.cps[0]?.id;
  CPREC = null;
  CPVIEW = view || 'checks';
  if (CPVIEW !== 'def') DEF = null;
  cpRender(true);
}
function cpRender(fresh) {
  const P = DOC.cps,
    all = P.map(p => [p, cpProcStats(p)]),
    tot = all.reduce((a, [, s]) => {
      ['ok', 'due', 'overdue', 'out', 'nodata', 'n'].forEach(k => (a[k] = (a[k] || 0) + s[k]));
      return a;
    }, {});
  const pct = tot.n - tot.nodata ? Math.round((tot.ok / (tot.n - tot.nodata)) * 100) : 100,
    p = P.find(x => x.id === CPSEL);
  const html = `<div id="cpBody"><div class="cp-h"><div><h3 style="margin:0">Process &amp; SOP</h3><div class="note">${RP ? `<span class="rp-badge">REPLAY</span> at ${fmtHM(RP.T)} · ` : ''}${P.length} processes · ${tot.n} checks</div></div>
   <div class="cp-acts"><button class="sb" id="cpHow" title="How processes, equipment and tags fit together">How it works</button><button class="sb" id="cpCsv">Export check sheet</button></div></div>
  <div class="cp-kpi"><div><span>Compliance</span><b style="color:${cpPctCol(pct)}">${pct}%</b><small>${tot.ok} of ${tot.n - tot.nodata} checks OK</small></div><div><span>Out of limit</span><b class="${tot.out ? 'tx3' : 'tx0'}">${tot.out}</b><small>reaction plan needed</small></div><div><span>Overdue</span><b class="${tot.overdue ? 'tx2' : 'tx0'}">${tot.overdue}</b><small>manual checks not done</small></div><div><span>Due now</span><b class="${tot.due ? 'tx1' : 'tx0'}">${tot.due}</b><small>within frequency window</small></div></div>
  <div class="cp-g ${CPSOP && CPVIEW === 'checks' ? 'sopon' : ''}"><div class="cp-list">${all.map(([q, s]) => `<button class="cp-p ${q.id === CPSEL ? 'on' : ''}" data-cpp="${q.id}"><div class="cp-p-h"><b>${esc(q.name)}</b>${cpChip(s.worst)}</div><div class="cp-bar"><i style="width:${s.pct}%;background:${cpPctCol(s.pct)}"></i></div><div class="note">${s.pct}% · ${q.blocks.length} equipment · ${s.n} checks${s.out ? ` · <span class="tx3">${s.out} out</span>` : ''}${s.overdue ? ` · <span class="tx2">${s.overdue} overdue</span>` : ''}</div></button>`).join('')}
   <button class="cp-new" id="cpNew">＋ New process</button></div>
  <div class="cp-d">${CPVIEW === 'how' ? cpHowHtml() : CPVIEW === 'def' ? cpDefHtml() : CPVIEW === 'docs' && p ? sopFilesHtml(p) : CPVIEW === 'sop' && p ? sopDocHtml(p) : CPVIEW === 'run' && p && RUN ? sopRunHtml(p) : CPVIEW === 'sopedit' && p && SOPDRAFT ? sopEditHtml(p) : p ? cpDetail(p) : '<div class="note">No processes yet.</div>'}</div></div>
  <div class="mact">${CPVIEW !== 'checks' ? '<button class="ib" id="cpBackB">← Back</button>' : ''}<button class="ib pri" id="cpClose">Close</button></div></div>`;
  const keep = $('#cpBody') && $('#modal').classList.contains('on');
  const sc = keep && $('.cp-main') ? $('.cp-main').scrollTop : 0;
  if (keep && !fresh) $('#cpBody').outerHTML = html;
  else openModal(html, 'xxl');
  if (keep && $('.cp-main')) $('.cp-main').scrollTop = sc;
  cpBind();
}
const cpDate = t => {
  const d = new Date(t);
  return d.toLocaleDateString(
    'en-GB',
    d.getFullYear() === new Date().getFullYear()
      ? { day: '2-digit', month: 'short' }
      : { day: '2-digit', month: 'short', year: 'numeric' },
  );
};
const cpTime = t =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
function cpSpecTxt(L) {
  if (!L.num) return 'OK / Not OK';
  if (L.min != null && L.max != null) return `${fmtN(L.min, L.d)} – ${fmtN(L.max, L.d)}`;
  return L.max != null ? `≤ ${fmtN(L.max, L.d)}` : `≥ ${fmtN(L.min, L.d)}`;
}
function cpRowHtml(it) {
  const S = cpStatus(it),
    L = cpLimits(it),
    auto = it.kind === 'auto';
  const t = auto ? (S.v != null ? cpNow() : null) : S.t;
  const vcls = S.st === 'out' ? 'tx3' : S.st === 'ok' ? '' : '';
  const dev = L.num && S.v != null && L.opt != null ? S.v - L.opt : null;
  const valTxt = auto
    ? S.v == null
      ? '—'
      : `<b class="mono ${vcls}">${fmtN(S.v, L.d)}</b>`
    : S.r
      ? S.v != null
        ? `<b class="mono ${vcls}">${fmtN(S.v, L.d)}</b>`
        : S.r.ok === false
          ? '<b class="tx3">Not OK</b>'
          : '<b>OK</b>'
      : '<span class="note">never</span>';
  const own = auto ? tagOwner(it.tag) : null;
  const chartId = auto ? it.tag : L.num ? 'cp:' + it.id : null;
  const rec =
    CPREC === it.id
      ? `<tr class="cp-rec"><td colspan="11"><div class="cp-recf">${L.num ? `<div class="fld"><label>Reading (${esc(L.unit)}) · spec ${cpSpecTxt(L)}</label><input type="number" step="any" id="cprV"></div>` : `<div class="fld"><label>Result</label><div class="seg" id="cprOkSeg"><button data-ok="1" class="on">OK</button><button data-ok="0">Not OK</button></div></div>`}<div class="fld"><label>Checked by</label><input id="cprBy" value="${esc(localStorage.getItem('sandman-cp-by') || 'Operator')}"></div><div class="fld" style="flex:1;min-width:160px"><label>Note</label><input id="cprN" placeholder="Optional"></div><button class="ib pri" id="cprSave">Save</button><button class="ib" id="cprX">Cancel</button></div></td></tr>`
      : '';
  return `<tr class="cp-r ${S.st}${chartId ? ' cp-click' : ''}" ${chartId ? `data-cprow="${esc(chartId)}" title="Open control chart"` : ''}><td><span class="cp-dot ${S.st}"></span></td>
   <td class="cp-nm"><b>${esc(it.name)}</b>${it.crit ? ' <span class="cp-crit" title="Critical checkpoint">critical</span>' : ''}<div class="note">${esc(it.method || '')} · ${esc(it.freq)}${own && own.b ? ` · <a class="cp-lnk" data-cploc="${own.b.id}">${esc(own.b.name)}</a>` : ''}</div></td>
   <td class="mono">${t ? cpDate(t) : '—'}</td><td class="mono" title="${t ? cpAgo(t) : ''}">${t ? cpTime(t) : '—'}${auto && t ? '<div class="note">live</div>' : ''}</td>
   <td class="mono">${cpSpecTxt(L)} <span class="note">${esc(L.num ? L.unit || '' : '')}</span></td><td class="mono">${L.num && L.opt != null ? fmtN(L.opt, L.d) : L.num ? '—' : 'OK'}</td>
   <td class="cp-val">${valTxt}${dev != null ? `<div class="note mono">${dev >= 0 ? '+' : '−'}${fmtN(Math.abs(dev), L.d)} vs opt</div>` : ''}</td>
   <td>${auto ? '<span class="note">Sensor</span>' : S.r ? esc(S.r.by || '') : '—'}</td><td>${cpChip(S.st)}</td>
   <td class="cp-cc">${chartId ? `<button class="cp-ic" data-cpch="${esc(chartId)}" title="Control chart" aria-label="Control chart"><svg viewBox="0 0 16 16" width="15" height="15"><path d="M1.5 13.5h13M2.5 11l3.2-4 3 2.5 4.3-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '<span class="note">—</span>'}</td><td class="cp-a">${!auto && !L.num && !RP ? `<button class="sb" data-cprec="${it.id}">Record</button>` : ''}${!auto && !L.num ? `<button class="cp-ic" data-cphist="${it.id}" title="History" aria-label="History"><svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>` : ''}${CPEDIT ? `<button class="lb tx3" data-cpdel="${it.id}" title="Remove checkpoint">✕</button>` : ''}</td></tr>${rec}`;
}
function cpDetail(p) {
  const s = cpProcStats(p),
    eq = p.blocks.map(id => B(id)).filter(Boolean),
    auto = p.items.filter(i => i.kind === 'auto'),
    man = p.items.filter(i => i.kind === 'manual');
  const head = `<div class="cp-dh"><div style="min-width:0"><div class="cp-tt"><h4>${esc(p.name)}</h4>${cpChip(s.worst)}</div>
    <div class="cp-eq"><span class="note">${eq.length} equipment:</span>${eq.map(b => `<button class="cp-eqc" data-cploc="${b.id}" title="Locate ${esc(b.name)}">${esc(b.name)}</button>`).join('') || '<span class="note">none — use Define process</span>'}</div></div>
    <div class="cp-pct"><b style="color:${cpPctCol(s.pct)}">${s.pct}%</b><span>compliance</span></div></div>
   <div class="cp-tools"><button class="ib" id="cpZoom" title="Zoom the flowsheet to this process">⌖ Zoom to process</button><button class="ib" id="cpDef" title="Choose equipment and tags for this process">⚙ Define process</button><button class="ib" id="cpDocs" title="Upload and view SOP documents (PDF, Word, Excel, CSV)">📎 SOP documents (${(p.docs || []).length})</button><button class="ib ${CPEDIT ? 'on' : ''}" id="cpEdit">${CPEDIT ? '✓ Done' : '✎ Edit checks'}</button>
    <label class="cp-sw" title="Show the SOP beside the checkpoints"><input type="checkbox" id="cpSopT" ${CPSOP ? 'checked' : ''}><span class="cp-sw-t"></span>SOP ${esc(p.sop.no || '')}</label></div>`;
  const table = rows =>
    `<table class="cp-t"><thead><tr><th></th><th>Parameter / check</th><th>Date</th><th>Time</th><th>Specification</th><th>Optimal</th><th>Current value</th><th>Checked by</th><th>Status</th><th class="cp-cch">Control chart</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
  const add = CPEDIT
    ? `<div class="cp-add"><div class="spec-h">Add a manual checkpoint</div><div class="cp-recf"><div class="fld" style="flex:2;min-width:200px"><label>Checkpoint</label><input id="cpaN" placeholder="e.g. Mixer door seal intact"></div><div class="fld"><label>Method</label><input id="cpaM" placeholder="Visual" style="width:110px"></div><div class="fld"><label>Frequency</label><select id="cpaF">${Object.keys(
        CP_FREQ,
      )
        .filter(k => k !== 'Continuous')
        .map(k => `<option ${k === 'Per shift' ? 'selected' : ''}>${k}</option>`)
        .join(
          '',
        )}</select></div><div class="fld"><label>Min</label><input id="cpaMin" type="number" step="any" style="width:70px"></div><div class="fld"><label>Max</label><input id="cpaMax" type="number" step="any" style="width:70px"></div><div class="fld"><label>Optimal</label><input id="cpaOpt" type="number" step="any" style="width:70px"></div><div class="fld"><label>σ</label><input id="cpaSd" type="number" step="any" style="width:60px"></div><div class="fld"><label>Unit</label><input id="cpaU" style="width:60px"></div><label class="chk"><input type="checkbox" id="cpaC"> Critical</label><button class="ib pri" id="cpaAdd">Add</button></div></div>`
    : '';
  const main = `<div class="cp-main">
   <div class="cp-grp"><div class="cp-grp-h"><b>Automatic checks</b><span class="note">${auto.length} · read live from equipment tags · limits are each tag's Min / Max</span></div>${auto.length ? table(auto.map(cpRowHtml).join('')) : '<div class="note cp-empty">No tags selected — open Define process to choose which tags are checked.</div>'}</div>
   <div class="cp-grp"><div class="cp-grp-h"><b>Manual checks</b><span class="note">${man.length} · sand parameters come from SandMan lab records — click a row for its control chart</span></div>${man.length ? table(man.map(cpRowHtml).join('')) : '<div class="note cp-empty">No manual checks yet.</div>'}</div>${add}</div>`;
  return (
    head +
    `<div class="cp-split ${CPSOP ? 'sop' : ''}">${main}${CPSOP ? `<aside class="cp-sopp">${cpSopHtml(p)}</aside>` : ''}</div>`
  );
}
function cpSopHtml(p) {
  const s = p.sop;
  if (CPSOPEDIT)
    return `<div class="cp-sop"><div class="cp-sop-h"><b>Edit SOP</b></div><div class="row2"><div class="fld"><label>Document no.</label><input data-sop="no" value="${esc(s.no || '')}"></div><div class="fld"><label>Version</label><input data-sop="version" value="${esc(s.version || '')}"></div></div><div class="fld"><label>Owner</label><input data-sop="owner" value="${esc(s.owner || '')}"></div>
   <div class="fld"><label>Title</label><input data-sop="title" value="${esc(s.title || '')}"></div><div class="fld"><label>Steps (one per line)</label><textarea data-sop="steps" style="min-height:170px">${esc((s.steps || []).join('\n'))}</textarea></div>
   <div class="fld"><label>Reaction plan</label><textarea data-sop="reaction" style="min-height:70px">${esc(s.reaction || '')}</textarea></div><div class="fld"><label>Safety / PPE</label><input data-sop="ppe" value="${esc(s.ppe || '')}"></div><div class="row2"><button class="ib" id="sopX">Cancel</button><button class="ib pri" id="sopSave">Save SOP</button></div></div>`;
  const outs = p.items.filter(it => cpStatus(it).st === 'out');
  return `<div class="cp-sop"><div class="cp-sop-h"><div><b>${esc(s.title || p.name)}</b><div class="note">${esc(s.no || '')} · v${esc(s.version || '—')} · ${esc(s.owner || '—')} · reviewed ${esc(s.reviewed || '—')}</div></div><div class="cp-sop-a"><button class="lb" id="sopE">Edit</button><button class="lb" id="sopCopy">Copy</button></div></div>
   ${outs.length ? `<div class="cp-react"><b>Reaction needed now</b> — ${outs.map(o => esc(o.name)).join(', ')}<div>${esc(s.reaction || '')}</div></div>` : ''}
   <ol class="cp-steps">${(s.steps || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li class="note">No steps yet.</li>'}</ol>
   <div class="cp-box"><b>Reaction plan</b><div>${esc(s.reaction || '—')}</div></div><div class="cp-box ppe"><b>Safety / PPE</b><div>${esc(s.ppe || '—')}</div></div></div>`;
}
function cpHowHtml() {
  const st = [
    [
      '1',
      'Process',
      'A named stage of the plant, e.g. Sand mixing. Seven are created from the flowsheet; you can add your own.',
    ],
    [
      '2',
      'Equipment',
      'Each process owns a set of equipment from the flowsheet — chosen in Define process or by clicking items on the canvas.',
    ],
    [
      '3',
      'Tags → automatic checks',
      'Tags of that equipment become automatic checkpoints. Their limits are the tag Min / Max set in Properties → Tags.',
    ],
    [
      '4',
      'Manual checks',
      'Operator checks (visual, test, calibration) with a frequency and optional limits, recorded with name and time.',
    ],
    ['5', 'SOP', 'The procedure and reaction plan for the process, shown beside its checkpoints.'],
  ];
  return `<div class="cp-how"><h4>How processes, equipment and tags fit together</h4><div class="cp-flow">${st.map(([n, h, b], i) => `<div class="cp-fs"><div class="cp-fn">${n}</div><b>${h}</b><p>${b}</p></div>${i < st.length - 1 ? '<div class="cp-fa">→</div>' : ''}`).join('')}</div>
   <div class="cp-box"><b>Status rules</b><div>Automatic: OK inside Min–Max, Out of limit outside. Manual: OK if recorded within its frequency, Due when the window has passed, Overdue after 1.25× the window or if never recorded, Out of limit when the reading is outside its limits or marked Not OK.</div></div>
   <div class="cp-box"><b>Alerts</b><div>Manual checks out of limit, and critical checks that are overdue, raise Warnings in the alert list and cockpit; critical checks that are due raise an Advisory.</div></div>
   <div class="cp-box"><b>On the flowsheet</b><div>Use ⌖ Zoom to process (or the Process selector in the toolbar) to fit the view to a process and fade everything else. "Show process zones" outlines every process on the canvas.</div></div>
   <button class="ib pri" id="cpHowX" style="margin-top:6px">Back to checkpoints</button></div>`;
}
/* ---------- Define process ---------- */
function cpDefStart(p) {
  DEF = p
    ? {
        id: p.id,
        name: p.name,
        owner: p.sop.owner || '',
        blocks: new Set(p.blocks),
        tags: new Set(p.items.filter(i => i.kind === 'auto').map(i => i.tag)),
        q: '',
      }
    : { id: null, name: 'New process', owner: '', blocks: new Set(), tags: new Set(), q: '' };
  CPVIEW = 'def';
  cpRender();
}
function cpDefHtml() {
  const others = id => (DOC.cps || []).filter(p => p.id !== DEF.id && p.blocks.includes(id)).map(p => p.name);
  const eqAll = DOC.blocks.filter(
    b =>
      !EQ[b.type].widget &&
      !EQ[b.type].inst &&
      b.type !== 'junction' &&
      (!DEF.q || (b.name + ' ' + EQ[b.type].n).toLowerCase().includes(DEF.q)),
  );
  const groups = {};
  eqAll.forEach(b => {
    const c = CATS[EQ[b.type].cat] || 'Other';
    (groups[c] = groups[c] || []).push(b);
  });
  Object.values(groups).forEach(L =>
    L.sort((a, b) => (DEF.blocks.has(b.id) ? 1 : 0) - (DEF.blocks.has(a.id) ? 1 : 0)),
  );
  [].forEach(b => {});
  const mem = [...DEF.blocks].map(id => B(id)).filter(Boolean);
  const tagRows = mem
    .map(
      b =>
        `<div class="cp-tg"><div class="cp-tg-h"><b>${esc(b.name)}</b><span class="note">${esc(EQ[b.type].n)}</span></div>${
          b.tags
            .filter(x => REG[x.id])
            .map(x => {
              const t = REG[x.id],
                sp = spec(t);
              return `<label class="cp-tr"><span class="cp-sw sm"><input type="checkbox" data-dt="${esc(x.id)}" ${DEF.tags.has(x.id) ? 'checked' : ''}><span class="cp-sw-t"></span></span><span class="cp-tr-n"><b>${esc(t.desc)}</b><span class="note mono">${esc(x.id)}</span></span><span class="note mono">${sp.min != null ? fmtN(sp.min, t.d) : '—'} · ${fmtN(sp.opt, t.d)} · ${sp.max != null ? fmtN(sp.max, t.d) : '—'} ${esc(t.unit)}</span>${t.cfg ? '' : '<span class="chip sv1" title="Limits not confirmed">default</span>'}</label>`;
            })
            .join('') || '<div class="note">No tags on this item.</div>'
        }</div>`,
    )
    .join('');
  return `<div class="cp-def"><div class="cp-def-h"><h4>${DEF.id ? 'Define process' : 'New process'}</h4><div class="cp-steps-mini"><span>① Name</span><span>② Equipment</span><span>③ Tags to check</span><span>④ Save</span></div></div>
   <div class="row2"><div class="fld"><label>Process name</label><input id="dfN" value="${esc(DEF.name)}"></div><div class="fld"><label>Process owner (SOP owner)</label><input id="dfO" value="${esc(DEF.owner)}" placeholder="e.g. Sand engineer"></div></div>
   <div class="cp-def-g"><div class="cp-def-c"><div class="cp-def-ch"><b>② Equipment</b><span class="note">${DEF.blocks.size} selected</span><button class="sb" id="dfPick" title="Click equipment on the flowsheet to add or remove it">⌖ Pick on flowsheet</button></div>
     <input type="search" id="dfQ" placeholder="Search equipment" value="${esc(DEF.q)}" class="cp-q">
     <div class="cp-eql">${
       Object.entries(groups)
         .map(
           ([g, L]) =>
             `<div class="cp-eqg"><div class="note cp-eqg-h">${esc(g)}</div>${L.map(b => {
               const o = others(b.id);
               return `<label class="cp-eqi ${DEF.blocks.has(b.id) ? 'on' : ''}"><input type="checkbox" data-db="${b.id}" ${DEF.blocks.has(b.id) ? 'checked' : ''}><b>${esc(b.name)}</b><span class="note">${esc(EQ[b.type].n)}</span>${o.length ? `<span class="cp-also" title="Also in ${esc(o.join(', '))}">also in ${esc(o[0])}${o.length > 1 ? ' +' + (o.length - 1) : ''}</span>` : ''}</label>`;
             }).join('')}</div>`,
         )
         .join('') || '<div class="note">No equipment matches.</div>'
     }</div></div>
    <div class="cp-def-c"><div class="cp-def-ch"><b>③ Tags checked automatically</b><span class="note">${DEF.tags.size} on</span><button class="sb" id="dfAll">All on</button><button class="sb" id="dfNone">All off</button></div>
     <div class="note" style="margin:-2px 0 6px">Limits come from each tag's Min · Optimal · Max (Properties → Tags).</div>
     <div class="cp-tgl">${tagRows || '<div class="note cp-empty">Select equipment to see its tags.</div>'}</div></div></div>
   ${sfDefHtml()}
   <div class="cp-def-f">${DEF.id ? '<button class="ib tx3" id="dfDel">Delete process</button>' : ''}<span style="flex:1"></span><button class="ib" id="dfX">Cancel</button><button class="ib pri" id="dfSave">Save process</button></div></div>`;
}
function cpDefSave() {
  const name = ($('#dfN')?.value ?? DEF.name).trim();
  if (!name) {
    toast('Enter a process name');
    return;
  }
  DEF.name = name;
  DEF.owner = ($('#dfO')?.value ?? DEF.owner).trim();
  pushUndo();
  let p = DEF.id && DOC.cps.find(x => x.id === DEF.id);
  if (!p) {
    p = {
      id: 'cp_' + Date.now().toString(36),
      key: 'custom',
      name,
      blocks: [],
      items: [],
      sop: {
        title: name + ' — standard operating procedure',
        no: 'SOP-' + String(DOC.cps.length + 1).padStart(2, '0'),
        version: '1.0',
        owner: DEF.owner,
        reviewed: new Date().toISOString().slice(0, 10),
        steps: [],
        reaction: '',
        ppe: '',
      },
    };
    DOC.cps.push(p);
  }
  p.name = name;
  p.sop.owner = DEF.owner || p.sop.owner;
  p.blocks = [...DEF.blocks].filter(id => B(id));
  const keepAuto = p.items.filter(
    i =>
      i.kind === 'auto' && DEF.tags.has(i.tag) && p.blocks.some(id => B(id).tags.some(x => x.id === i.tag)),
  );
  const newAuto = [...DEF.tags]
    .filter(
      tid =>
        REG[tid] &&
        !keepAuto.some(i => i.tag === tid) &&
        p.blocks.some(id => B(id).tags.some(x => x.id === tid)),
    )
    .map(tid => {
      const o = tagOwner(tid),
        t = REG[tid];
      return {
        id: 'cpa_' + tid.replace(/[^A-Za-z0-9]/g, '_'),
        kind: 'auto',
        tag: tid,
        name: `${t.desc} — ${o && o.b ? o.b.name : ''}`,
        method: 'Online sensor',
        freq: 'Continuous',
        crit: 0,
        owner: 'Automatic',
      };
    });
  p.items = keepAuto.concat(
    newAuto,
    p.items.filter(i => i.kind === 'manual'),
  );
  if (DEF.file) sfAdd(p, DEF.file, { equip: p.blocks.slice(), by: sfBy(), note: 'Uploaded with the process' });
  save();
  CPSEL = p.id;
  DEF = null;
  CPVIEW = 'checks';
  logEv(`Process defined: ${name} — ${p.blocks.length} equipment, ${p.items.length} checkpoints`);
  procSelFill();
  drawProc();
  cpRender();
  toast('Process saved');
}
/* ---------- zoom / focus on the flowsheet ---------- */
function procBox(p) {
  const L = p.blocks.map(id => B(id)).filter(Boolean);
  if (!L.length) return null;
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  L.forEach(b => {
    const d = dims(b);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + d.W);
    y1 = Math.max(y1, b.y + d.H);
  });
  return { x0: x0 - 22, y0: y0 - 34, x1: x1 + 22, y1: y1 + 22 };
}
function focusProcess(id) {
  const p = (DOC.cps || []).find(x => x.id === id);
  PFOCUS = p ? p.id : null;
  if ($('#procSel')) $('#procSel').value = PFOCUS || '';
  if (p) {
    const bx = procBox(p),
      r = $('#cwrap').getBoundingClientRect();
    if (bx && r.width > 20) {
      const k = clamp(Math.min((r.width - 80) / (bx.x1 - bx.x0), (r.height - 110) / (bx.y1 - bx.y0)), 0.2, 3);
      VIEW.k = k;
      VIEW.tx = (r.width - (bx.x1 - bx.x0) * k) / 2 - bx.x0 * k;
      VIEW.ty = (r.height - (bx.y1 - bx.y0) * k) / 2 - bx.y0 * k + 20;
      applyView();
      try {
        sizeHandles();
      } catch (e) {}
    }
  }
  drawProc();
}
function procSelFill() {
  const s = $('#procSel');
  if (!s || !DOC.cps) return;
  const cur = PFOCUS || '';
  s.innerHTML = `<option value="">⌖ Process: whole plant</option>${DOC.cps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}<option value="__zones">${PREF.zones ? '☑' : '☐'} Show process zones</option>`;
  s.value = cur;
}
function drawProc() {
  const L = $('#Lproc'),
    cv = $('#cv');
  if (!L || !DOC.cps) return;
  const show = DOC.cps.filter(
    p => p.id === PFOCUS || (PREF.zones && !CPPICK) || (CPPICK && DEF && p.id === DEF.id),
  );
  const pickSet = CPPICK && DEF ? DEF.blocks : null;
  L.innerHTML = (
    CPPICK && DEF ? [{ id: DEF.id || '_new', name: DEF.name, blocks: [...DEF.blocks], items: [] }] : show
  )
    .map(p => {
      const bx = procBox(p);
      if (!bx) return '';
      const s = p.items.length ? cpProcStats(p) : null,
        col = CPPICK
          ? '#7c3aed'
          : s
            ? s.worst === 'out'
              ? '#d93636'
              : s.worst === 'overdue'
                ? '#ec7a15'
                : s.worst === 'due'
                  ? '#c99a00'
                  : '#1f9d55'
            : '#1f6feb',
        lab = `${p.name}${s ? ` · ${s.pct}%` : ''}`,
        tw = lab.length * 6.4 + 22;
      return `<g class="pzone ${p.id === PFOCUS ? 'focus' : ''}"><rect x="${bx.x0}" y="${bx.y0}" width="${bx.x1 - bx.x0}" height="${bx.y1 - bx.y0}" rx="14" fill="${col}" fill-opacity=".05" stroke="${col}" stroke-width="2" stroke-dasharray="8 5"/><g transform="translate(${bx.x0 + 10},${bx.y0 - 11})"><rect width="${tw}" height="22" rx="11" fill="${col}"/><text x="${tw / 2}" y="15" text-anchor="middle" style="font:700 11.5px var(--sans);fill:#fff">${esc(lab)}</text></g></g>`;
    })
    .join('');
  const focus = PFOCUS && DOC.cps.find(p => p.id === PFOCUS);
  const pin = pickSet || (focus ? new Set(focus.blocks) : null);
  cv.classList.toggle('pfocus', !!pin);
  cv.classList.toggle('ppick', !!CPPICK);
  $$('#Lblocks .blk').forEach(g => g.toggleAttribute('data-pin', !!(pin && pin.has(g.dataset.b))));
  $$('#Lstreams .stream').forEach(g => {
    const s = Sx(g.dataset.s);
    g.toggleAttribute('data-pin', !!(pin && s && (pin.has(s.from.b) || pin.has(s.to.b))));
  });
  const bar = $('#pfBar');
  if (CPPICK && DEF) {
    bar.className = 'pfbar on pick';
    bar.innerHTML = `<b>Picking equipment for “${esc(DEF.name)}”</b><span>Click equipment to add or remove · ${DEF.blocks.size} selected</span><button class="ib pri" id="pfDone">Done</button><button class="ib" id="pfCancel">Cancel</button>`;
    $('#pfDone').onclick = () => cpPickEnd(true);
    $('#pfCancel').onclick = () => cpPickEnd(false);
  } else if (focus) {
    const s = cpProcStats(focus);
    bar.className = 'pfbar on';
    bar.innerHTML = `<span class="pf-dot" style="background:${cpPctCol(s.pct)}"></span><b>${esc(focus.name)}</b><span>${s.pct}% · ${s.n} checks${s.out ? ` · <span class="tx3">${s.out} out</span>` : ''}${s.overdue ? ` · ${s.overdue} overdue` : ''}</span><button class="sb" id="pfCk">Process &amp; SOP</button><button class="sb" id="pfSop">SOP</button><button class="sb" id="pfAll" title="Show the whole plant">✕ Whole plant</button>`;
    $('#pfCk').onclick = () => openCP(focus.id);
    $('#pfSop').onclick = () => {
      CPSOP = true;
      openCP(focus.id);
    };
    $('#pfAll').onclick = () => {
      focusProcess(null);
      fit();
    };
  } else {
    bar.className = 'pfbar';
    bar.innerHTML = '';
  }
}
let CPPICK_SAVE = null;
function cpPickStart() {
  if (!DEF) return;
  DEF.name = ($('#dfN')?.value ?? DEF.name).trim() || DEF.name;
  DEF.owner = ($('#dfO')?.value ?? DEF.owner).trim();
  CPPICK_SAVE = new Set(DEF.blocks);
  CPPICK = true;
  closeModal(true);
  const p = DOC.cps.find(x => x.id === DEF.id);
  if (p) focusProcess(p.id);
  PFOCUS = null;
  drawProc();
  toast('Click equipment on the flowsheet, then press Done');
}
function cpPickEnd(ok) {
  if (!ok && CPPICK_SAVE) DEF.blocks = CPPICK_SAVE;
  CPPICK = false;
  drawProc();
  CPVIEW = 'def';
  openCP(DEF.id || CPSEL, 'def');
}
$('#cwrap').addEventListener(
  'pointerdown',
  e => {
    if (!CPPICK || !DEF) return;
    const g = e.target.closest && e.target.closest('#Lblocks .blk');
    if (!g) return;
    e.stopPropagation();
    e.preventDefault();
    const id = g.dataset.b,
      b = B(id);
    if (!b || EQ[b.type].widget || EQ[b.type].inst) {
      toast('Only equipment can belong to a process');
      return;
    }
    if (DEF.blocks.has(id)) DEF.blocks.delete(id);
    else {
      DEF.blocks.add(id);
      b.tags.forEach(x => {
        const t = REG[x.id];
        if (t && ['level', 'vib', 'sfs', 'rpm', 'gate', 'aspd'].indexOf(t.role) < 0) DEF.tags.add(x.id);
      });
    }
    drawProc();
  },
  true,
);
/* ---------- binding ---------- */
function cpBind() {
  setTimeout(() => sopBind(DOC.cps.find(x => x.id === CPSEL)), 0);
  const p = DOC.cps.find(x => x.id === CPSEL);
  const on = (id, fn) => {
    const el = $(id);
    if (el) el.onclick = fn;
  };
  on('#cpClose', () => closeModal(true));
  on('#cpBackB', cpBack);
  on('#cpHow', () => {
    CPVIEW = 'how';
    cpRender();
  });
  on('#cpHowX', () => {
    CPVIEW = 'checks';
    cpRender();
  });
  on('#cpNew', () => cpDefStart(null));
  $$('#mbox [data-cpp]').forEach(
    x =>
      (x.onclick = () => {
        CPSEL = x.dataset.cpp;
        CPREC = null;
        CPVIEW = 'checks';
        CPSOPEDIT = false;
        DEF = null;
        cpRender();
      }),
  );
  on('#cpEdit', () => {
    CPEDIT = !CPEDIT;
    cpRender();
  });
  on('#cpDef', () => cpDefStart(p));
  on('#cpDocs', () => {
    SFUP = null;
    CPVIEW = 'docs';
    cpRender();
  });
  if (p) (CPVIEW === 'docs' ? sopFilesBind : sfLinkBind)(p);
  on('#cpZoom', () => {
    closeModal(true);
    focusProcess(p.id);
  });
  const sw = $('#cpSopT');
  if (sw)
    sw.onchange = () => {
      CPSOP = sw.checked;
      try {
        localStorage.setItem('sandman-cp-sop', CPSOP ? '1' : '0');
      } catch (e) {}
      cpRender();
    };
  $$('#mbox [data-cploc]').forEach(
    x =>
      (x.onclick = () => {
        const b = B(x.dataset.cploc);
        closeModal(true);
        if (b) {
          select({ t: 'b', id: b.id });
          center(b);
        }
      }),
  );
  $$('#mbox [data-cptr]').forEach(x => (x.onclick = () => openTrend(x.dataset.cptr)));
  $$('#mbox [data-cpch]').forEach(
    x =>
      (x.onclick = e => {
        e.stopPropagation();
        openTrend(x.dataset.cpch);
      }),
  );
  $$('#mbox [data-cprow]').forEach(
    r =>
      (r.onclick = e => {
        if (e.target.closest('button,a,input')) return;
        openTrend(r.dataset.cprow);
      }),
  );
  $$('#mbox [data-cprec]').forEach(
    x =>
      (x.onclick = () => {
        CPREC = x.dataset.cprec;
        cpRender();
        setTimeout(() => $('#cprV')?.focus(), 30);
      }),
  );
  $$('#mbox [data-cphist]').forEach(x => (x.onclick = () => cpHistory(x.dataset.cphist)));
  $$('#mbox [data-cpdel]').forEach(
    x =>
      (x.onclick = () => {
        pushUndo();
        p.items = p.items.filter(i => i.id !== x.dataset.cpdel);
        save();
        cpRender();
      }),
  );
  $$('#cprOkSeg button').forEach(
    b => (b.onclick = () => $$('#cprOkSeg button').forEach(x => x.classList.toggle('on', x === b))),
  );
  on('#cprX', () => {
    CPREC = null;
    cpRender();
  });
  on('#cprSave', () => {
    const it = p.items.find(i => i.id === CPREC),
      v = $('#cprV') ? parseFloat($('#cprV').value) : null;
    if ($('#cprV') && !isFinite(v)) {
      toast('Enter the reading');
      return;
    }
    const by = $('#cprBy').value.trim() || 'Operator';
    try {
      localStorage.setItem('sandman-cp-by', by);
    } catch (e) {}
    const okb = $('#cprOkSeg button.on');
    (CPLOG[it.id] = CPLOG[it.id] || []).push({
      t: Date.now(),
      v: $('#cprV') ? v : null,
      ok: okb ? okb.dataset.ok === '1' : undefined,
      by,
      note: $('#cprN').value.trim(),
    });
    CPLOG[it.id] = CPLOG[it.id].slice(-500);
    cpSaveLog();
    logEv(`Checkpoint recorded: ${p.name} — ${it.name}`);
    CPREC = null;
    cpAlerts();
    renderDock(true);
    drawProc();
    cpRender();
    toast('Checkpoint recorded');
  });
  on('#cpaAdd', () => {
    const n = $('#cpaN').value.trim();
    if (!n) {
      toast('Enter the checkpoint');
      return;
    }
    const num = id => {
      const v = parseFloat($(id).value);
      return isFinite(v) ? v : null;
    };
    pushUndo();
    p.items.push({
      id: 'cpm_' + Date.now().toString(36),
      kind: 'manual',
      name: n,
      method: $('#cpaM').value.trim() || 'Visual',
      freq: $('#cpaF').value,
      crit: $('#cpaC').checked ? 1 : 0,
      min: num('#cpaMin'),
      max: num('#cpaMax'),
      opt: num('#cpaOpt'),
      sd: num('#cpaSd'),
      unit: $('#cpaU').value.trim(),
      owner: p.sop.owner || '',
    });
    save();
    cpRender();
    toast('Checkpoint added');
  });
  on('#sopE', () => {
    CPSOPEDIT = true;
    cpRender();
  });
  on('#sopX', () => {
    CPSOPEDIT = false;
    cpRender();
  });
  on('#sopSave', () => {
    pushUndo();
    $$('#mbox [data-sop]').forEach(i => {
      const k = i.dataset.sop;
      p.sop[k] =
        k === 'steps'
          ? i.value
              .split('\n')
              .map(x => x.trim())
              .filter(Boolean)
          : i.value;
    });
    p.sop.reviewed = new Date().toISOString().slice(0, 10);
    save();
    CPSOPEDIT = false;
    cpRender();
    toast('SOP saved');
  });

  on('#cpCsv', () => {
    const rows = [
      [
        'process',
        'checkpoint',
        'type',
        'method',
        'frequency',
        'min',
        'max',
        'unit',
        'current_or_last',
        'last_time',
        'checked_by',
        'status',
        'critical',
        'sop',
      ],
    ];
    DOC.cps.forEach(q =>
      q.items.forEach(it => {
        const S = cpStatus(it),
          L = cpLimits(it);
        rows.push([
          q.name,
          it.name,
          it.kind,
          it.method || '',
          it.freq,
          L.min ?? '',
          L.max ?? '',
          L.unit,
          S.v ?? (S.r ? (S.r.ok === false ? 'Not OK' : 'OK') : ''),
          S.t ? new Date(S.t).toISOString() : '',
          S.r?.by || '',
          CP_ST[S.st][0],
          it.crit ? 'yes' : 'no',
          q.sop.no || '',
        ]);
      }),
    );
    copyText(
      rows
        .map(r =>
          r
            .map(v => {
              v = String(v);
              return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            })
            .join(','),
        )
        .join('\n'),
      'Check sheet copied as CSV',
    );
  });
  // define view
  if (CPVIEW === 'def' && DEF) {
    const keepInputs = () => {
      DEF.name = $('#dfN').value;
      DEF.owner = $('#dfO').value;
    };
    $$('#mbox [data-db]').forEach(
      c =>
        (c.onchange = () => {
          keepInputs();
          const id = c.dataset.db,
            b = B(id);
          if (c.checked) {
            DEF.blocks.add(id);
            b.tags.forEach(x => {
              const t = REG[x.id];
              if (t && ['level', 'vib', 'sfs', 'rpm', 'gate', 'aspd'].indexOf(t.role) < 0) DEF.tags.add(x.id);
            });
          } else {
            DEF.blocks.delete(id);
            b.tags.forEach(x => DEF.tags.delete(x.id));
          }
          cpRender();
        }),
    );
    $$('#mbox [data-dt]').forEach(
      c =>
        (c.onchange = () => {
          if (c.checked) DEF.tags.add(c.dataset.dt);
          else DEF.tags.delete(c.dataset.dt);
          const n = $('#mbox .cp-def-c:last-child .cp-def-ch .note');
          if (n) n.textContent = DEF.tags.size + ' on';
        }),
    );
    const q = $('#dfQ');
    q.oninput = () => {
      keepInputs();
      DEF.q = q.value.toLowerCase();
      const pos = q.selectionStart;
      cpRender();
      const q2 = $('#dfQ');
      q2.focus();
      q2.setSelectionRange(pos, pos);
    };
    on('#dfAll', () => {
      keepInputs();
      [...DEF.blocks].forEach(id => B(id)?.tags.forEach(x => REG[x.id] && DEF.tags.add(x.id)));
      cpRender();
    });
    on('#dfNone', () => {
      keepInputs();
      DEF.tags.clear();
      cpRender();
    });
    on('#dfPick', cpPickStart);
    on('#dfX', () => {
      DEF = null;
      CPVIEW = 'checks';
      cpRender();
    });
    on('#dfSave', cpDefSave);
    on('#dfDel', () => {
      if (
        !confirm(
          `Delete the process “${DEF.name}”? Its manual checks and SOP are removed; equipment and tags stay on the flowsheet.`,
        )
      )
        return;
      pushUndo();
      DOC.cps = DOC.cps.filter(x => x.id !== DEF.id);
      if (PFOCUS === DEF.id) PFOCUS = null;
      save();
      DEF = null;
      CPVIEW = 'checks';
      CPSEL = DOC.cps[0]?.id;
      procSelFill();
      drawProc();
      cpRender();
      toast('Process deleted');
    });
  }
}
function cpHistory(id) {
  const p = DOC.cps.find(x => x.items.some(i => i.id === id)),
    it = p.items.find(i => i.id === id),
    L = (CPLOG[id] || []).slice().reverse();
  openModal(
    `<h3>${esc(it.name)}</h3><div class="note">${esc(p.name)} · ${esc(it.freq)} · ${esc(it.method || '')}</div>
   <div class="tbl-wrap" style="margin-top:10px;max-height:50vh;overflow:auto"><table><thead><tr><th>Time</th><th>Result</th><th>Checked by</th><th>Note</th></tr></thead><tbody>${L.map(r => `<tr><td class="mono">${new Date(r.t).toLocaleString('en-GB', { hour12: false })}</td><td>${r.v != null ? `<b class="mono">${fmtN(r.v, 1)}</b> ${esc(it.unit || '')}` : r.ok === false ? '<b class="tx3">Not OK</b>' : 'OK'}</td><td>${esc(r.by || '')}</td><td>${esc(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="note">No records yet.</td></tr>'}</tbody></table></div>
   <div class="mact"><button class="ib pri" id="cphB">Back</button></div>`,
    true,
  );
  $('#cphB').onclick = () => cpRender(true);
}
/* Properties → General section for equipment that belongs to a process */
function cpPropsHtml(b) {
  if (!DOC.cps) return '';
  const L = DOC.cps.filter(p => p.blocks.includes(b.id));
  if (!L.length)
    return `<div class="sec"><h5>Process</h5><div class="note">Not part of any process.</div><button class="ib" data-cpadd="1" style="margin-top:6px">Add to a process…</button></div>`;
  return L.map(p => {
    const s = cpProcStats(p),
      own = p.items.filter(it => it.kind === 'auto' && b.tags.some(x => x.id === it.tag));
    return `<div class="sec"><h5>Process: ${esc(p.name)} <span class="r">${cpChip(s.worst)}</span></h5><div class="note">${s.n} checkpoints · ${s.pct}% compliance · ${own.length} tag${own.length === 1 ? '' : 's'} of this item checked</div>
   <div class="row3" style="margin-top:6px"><button class="ib" data-cpo="checks" data-pid="${p.id}">Checks</button><button class="ib" data-cpo="sop" data-pid="${p.id}">SOP</button><button class="ib" data-cpz="${p.id}">⌖ Zoom</button></div></div>`;
  }).join('');
}
function bindCpProps(b) {
  $$('#ptab [data-cpo]').forEach(
    x =>
      (x.onclick = () => {
        if (x.dataset.cpo === 'sop') CPSOP = true;
        openCP(x.dataset.pid);
      }),
  );
  $$('#ptab [data-cpz]').forEach(x => (x.onclick = () => focusProcess(x.dataset.cpz)));
  $$('#ptab [data-cpadd]').forEach(
    x =>
      (x.onclick = () => {
        cpSeed();
        openCP(null);
      }),
  );
}
$('#bCP').onclick = () => openCP();
$('#procSel').onchange = e => {
  const v = e.target.value;
  if (v === '__zones') {
    PREF.zones = !PREF.zones;
    savePref();
    procSelFill();
    drawProc();
    return;
  }
  if (v) focusProcess(v);
  else {
    focusProcess(null);
    fit();
  }
};
setTimeout(() => {
  try {
    cpSeed();
    procSelFill();
    drawProc();
  } catch (e) {}
}, 300);
setInterval(() => {
  try {
    cpSeed();
    cpAlerts();
    if (PFOCUS || PREF.zones) drawProc();
    if (
      $('#cpBody') &&
      $('#modal').classList.contains('on') &&
      CPVIEW === 'checks' &&
      !CPREC &&
      !CPEDIT &&
      !CPSOPEDIT &&
      !$('#mbox').matches(':hover')
    )
      cpRender();
  } catch (e) {}
}, 10000);

/* ---------- manual sand parameters: history + control chart ---------- */
function cpEnsureHistory() {
  let done = false;
  try {
    done = localStorage.getItem('sandman-cp-hist') === '2';
  } catch (e) {}
  if (done || !DOC.cps) return;
  const now = Date.now(),
    who = ['R. Patil', 'S. Kulkarni', 'A. Jadhav', 'M. Shinde'];
  DOC.cps.forEach(p =>
    p.items
      .filter(i => i.kind === 'manual')
      .forEach(it => {
        const L = cpLimits(it),
          have = CPLOG[it.id] || [];
        if (have.length >= 6) return;
        const fh = CP_FREQ[it.freq],
          step = (fh > 0 ? Math.min(fh, 24) : 2) * 3600e3,
          first = have.length ? have[0].t : now,
          n = Math.min(48, Math.floor((5 * 24 * 3600e3) / step));
        const sd = hseed(it.id) * 1000,
          hist = [];
        for (let k = n; k >= 1; k--) {
          const t = first - k * step + (hfrac(sd + k) - 0.5) * step * 0.2;
          const z =
            (hfrac(sd + k * 3.1) + hfrac(sd + k * 7.7) + hfrac(sd + k * 1.3) - 1.5) * 1.4 +
            Math.sin(k / 6 + sd) * 0.6;
          hist.push({
            t,
            v: L.num ? +(L.opt + z * (L.sd || 1) * 0.9).toFixed(L.d ?? 1) : null,
            ok: L.num ? undefined : hfrac(sd + k * 5) > 0.04,
            by: who[k % 4],
            note: '',
          });
        }
        CPLOG[it.id] = hist.concat(have);
      }),
  );
  cpSaveLog();
  try {
    localStorage.setItem('sandman-cp-hist', '2');
  } catch (e) {}
}
function cpItemById(id) {
  for (const p of DOC.cps || []) {
    const it = p.items.find(i => i.id === id);
    if (it) return { p, it };
  }
  return null;
}
/* a tag-like object so the standard control chart can plot a manual checkpoint */
function ttag(id) {
  if (REG[id]) return REG[id];
  if (!String(id).startsWith('cp:')) return null;
  const f = cpItemById(id.slice(3));
  if (!f) return null;
  const L = cpLimits(f.it);
  return {
    id,
    desc: f.it.name,
    unit: L.unit,
    d: L.d ?? 1,
    typ: L.opt ?? 0,
    min: L.min,
    max: L.max,
    sd: L.sd,
    cfg: true,
    src: `Manual check · ${f.it.method || ''} · ${f.it.freq}`,
    manual: f,
  };
}
function tcur(id) {
  const t = ttag(id);
  if (!t) return { v: null, sev: 0 };
  if (!t.manual) {
    const v = RP ? histVal(id, RP.T) : val(id);
    return { v, sev: tagSev(id, v) };
  }
  const r = cpLast(t.manual.it),
    v = r ? r.v : null;
  const sev =
    v == null
      ? 0
      : (t.min != null && v < t.min) || (t.max != null && v > t.max)
        ? 2
        : t.sd && Math.abs(v - t.typ) > 2 * t.sd
          ? 1
          : 0;
  return { v, sev };
}
function cpSeries() {
  const t = ttag(trendTag);
  if (!t || !t.manual) return [];
  const now = cpNow();
  return (CPLOG[t.manual.it.id] || [])
    .filter(r => r.v != null && r.t <= now && r.t >= now - TR.win * 1000)
    .map(r => ({ t: r.t, v: r.v }));
}
const _ccDataCP = ccData;
ccData = function () {
  return String(trendTag).startsWith('cp:') ? cpSeries() : _ccDataCP();
};
