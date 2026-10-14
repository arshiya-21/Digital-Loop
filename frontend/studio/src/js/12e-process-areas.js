/*! SandMan Digital Loop Studio — 12e-process-areas.js
 *  v9.41 — Process & SOP in the Digital Loop Studio.
 *    · Processes come from the loop's AREA BOXES: everything inside area "A · SAND PREPARATION" belongs to the
 *      process "A · Sand preparation" (same membership rule as the Publish view's Areas pane, afMembers()).
 *      Each area is matched to a green-sand library entry (checks + SOP) by its name; Sand lab is added on its own.
 *      Loops without area boxes fall back to the team's equipment-type grouping (cpSeedByType).
 *    · Automatic checks = the readings of the area's equipment that have limits (status readings excluded).
 *      A check role (compactability, moisture, pouring temperature …) is worked out from the reading's name so SOP steps
 *      show live values; REG is not changed.
 *    · UI: ribbon tab "Process", header chip, area badges on the canvas (#Lpbadge), dock tab "Checks due",
 *      "Process & checks" section in the equipment panel, Record-a-check dialog, SOP library, guided-run picker.
 *  Engine and workspace: 12b-checkpoints.js + 12c-sop.js (team build, 12 Oct 2026). */

/* helper the team build has in 04-canvas.js (deterministic 0–1 hash for the demo history) */
const hfrac = x => {
  const v = Math.sin(x * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

/* ---------- area → library entry ---------- */
const CP_AREA_MAP = [
  [/PREP|MIX|MULL/i, 'mix', ['add']],
  [/MOULD|MOLD|DISA/i, 'mold', []],
  [/POUR|MELT|FURNACE/i, 'pour', []],
  [/SHAKE/i, 'shk', []],
  [/RETURN|COOL/i, 'ret', []],
];
const CP_ROLE_RX = [
  [/COMPACT/i, 'compact'],
  [/MOIST/i, 'moist'],
  [/GCS/i, 'gcs'],
  [/ACTIVE_CLAY|ACTIVE CLAY/i, 'aclay'],
  [/PERM/i, 'perm'],
  [/POUR\d*_TEMP|POURING.*TEMP|POUR.*TEMP/i, 'pourT'],
  [/POURING TIME|POUR.*TIME/i, 'ptime'],
  [/FURNACE\d*_TEMP|MELT.*TEMP/i, 'melt'],
  [/SAND_OUTLET_TEMP|OUTLET_TEMP/i, 'cooltemp'],
  [/INLET_TEMP|RETURN.*TEMP/i, 'rtemp'],
  [/MOULD_PRESSURE|SQUEEZE/i, 'squeeze'],
  [/PRODUCTION_RATE/i, 'mph'],
  [/MIXING_TIME|BATCH_TIME/i, 'btime'],
  [/MIXER_MOTOR_CURRENT/i, 'mcur'],
  [/VIBRATION/i, 'vib'],
  [/LEVEL|\.LVL$/i, 'level'],
];
const CP_CRIT_ROLES = ['compact', 'moist', 'gcs', 'pourT', 'cooltemp', 'rtemp', 'squeeze', 'melt'];
/* starting limits for key readings that have none yet (marked defLim; confirm them in Edit checks) */
const CP_ROLE_DEF = { pourT: [1380, 1460], melt: [1480, 1560] };
const CP_SKIP_ROLES = ['load', 'rpm', 'sfs', 'gate', 'aspd'];
const CP_SKIP_RX = /STATUS|SPEED|RPM|\.LOAD$|LOAD_PCT|POWER|AMBIENT|WEIGHT|SETPOINT|ACTUAL_KG|FLOW/i;

function cpRoleOf(id, t, key) {
  if (t.role) return t.role;
  const s = id + ' ' + (t.desc || '');
  for (const [rx, r] of CP_ROLE_RX)
    if (rx.test(s)) return r === 'vib' && key === 'shk' ? 'svib' : r === 'level' && key === 'mold' ? '' : r;
  return '';
}
function cpAreaLib(name) {
  for (const [rx, key, extra] of CP_AREA_MAP) if (rx.test(name)) return { lib: CP_LIB.find(l => l.key === key), extra };
  return null;
}
function cpAreaTitle(z) {
  const raw = afName(z),
    m = raw.match(/^\s*([A-Z0-9]{1,3})\s*[·.\-:]\s*(.+)$/i),
    code = m ? m[1].toUpperCase() : '',
    rest = (m ? m[2] : raw).trim().toLowerCase();
  const nice = rest.charAt(0).toUpperCase() + rest.slice(1);
  return { code, name: code ? `${code} · ${nice}` : nice };
}
function cpAreaBlocks(z) {
  return afMembers(z)
    .filter(b => !/plc|scada|switch|gateway/i.test(b.type) && !EQ[b.type]?.inst)
    .map(b => b.id);
}
function cpAreaAuto(blockIds, key) {
  const out = [];
  blockIds.forEach(id => {
    const b = B(id);
    if (!b) return;
    b.tags.forEach(x => {
      const t = REG[x.id];
      if (!t || t.text || out.some(o => o.tag === x.id)) return;
      const role = cpRoleOf(x.id, t, key),
        L = spec(t),
        def = CP_ROLE_DEF[role];
      if (CP_SKIP_ROLES.includes(role)) return;
      if (L.min == null && L.max == null && !def) return; // no limits → nothing to check against
      if (!role && CP_SKIP_RX.test(x.id)) return;
      if (role === 'level' && /SILO|BIN/i.test(b.name) === false) return;
      out.push({
        id: 'cpa_' + x.id.replace(/[^A-Za-z0-9]/g, '_'),
        kind: 'auto',
        tag: x.id,
        role,
        name: `${t.desc || x.id} — ${b.name}`,
        method: 'Online sensor',
        freq: 'Continuous',
        crit: CP_CRIT_ROLES.includes(role) ? 1 : 0,
        owner: 'Automatic',
        ...(L.min == null && L.max == null && def ? { min: def[0], max: def[1], defLim: 1 } : {}),
      });
    });
  });
  return out;
}
const cpManualFrom = (lib, owner) =>
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
    owner,
  }));
const cpSopFrom = (lib, name) =>
  Object.assign(
    { title: name + ' — standard operating procedure', version: '1.0', reviewed: new Date().toISOString().slice(0, 10) },
    JSON.parse(JSON.stringify(lib.sop)),
  );

/* ---------- seed (replaces the team's cpSeed; same contract) ---------- */
function cpSeed(force) {
  if (DOC.cps && !force) {
    cpEnsureHistory();
    return;
  }
  const zones = typeof afZones === 'function' ? afZones() : [];
  if (!zones.length) {
    cpSeedByType(force);
    return;
  }
  const P = [];
  zones.forEach(z => {
    const T = cpAreaTitle(z),
      blocks = cpAreaBlocks(z),
      M = cpAreaLib(afName(z));
    if (!blocks.length) return;
    const key = M ? M.lib.key : 'area_' + z.id,
      auto = cpAreaAuto(blocks, key);
    if (!M && !auto.length) return; // e.g. "H · SCADA & plant network": nothing to check
    const owner = M ? M.lib.sop.owner : '';
    let items = auto.concat(M ? cpManualFrom(M.lib, owner) : []);
    if (M)
      M.extra.forEach(k => {
        const L = CP_LIB.find(l => l.key === k);
        if (L) items = items.concat(cpManualFrom(L, owner));
      });
    P.push({
      id: 'cp_area_' + z.id,
      key,
      area: z.id,
      code: T.code,
      name: T.name,
      blocks,
      items,
      sop: M ? cpSopFrom(M.lib, T.name) : { no: 'SOP-' + (T.code || 'X') + '-01', owner: '', steps: [], reaction: '', ppe: '' },
    });
  });
  const lab = CP_LIB.find(l => l.key === 'lab');
  if (lab)
    P.push({ id: 'cp_lab', key: 'lab', code: 'LAB', name: 'Sand lab · Sand testing', blocks: [], items: cpManualFrom(lab, lab.sop.owner), sop: cpSopFrom(lab, 'Sand testing') });
  DOC.cps = P;
  cpDemoRecords();
  try {
    sopAll();
  } catch (e) {}
}
/* demo records so the consolidated view is meaningful in the prototype (same rule as the team build) */
function cpDemoRecords() {
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
        if (k === 6) return;
        const age = k % 6 === 3 ? win * 1.5 : k % 7 === 4 ? win * 1.1 : win * (0.15 + r * 0.6);
        const num = it.min != null || it.max != null,
          lo = it.min ?? it.max * 0.8,
          hi = it.max ?? it.min * 1.2;
        const v = num ? +(k === 10 ? lo - (hi - lo) * 0.15 : lo + (hi - lo) * (0.3 + r * 0.4)).toFixed(1) : null;
        CPLOG[it.id] = [{ t: now - age, v, ok: num ? undefined : true, by: ['R. Kumar', 'S. Prakash', 'A. Selvam', 'M. Rajan'][k % 4], note: '' }];
      }),
  );
  cpSaveLog();
}
/* keep each area process in step with what is inside its area box now (equipment moved in or out) */
function cpAreaSync() {
  (DOC.cps || []).forEach(p => {
    if (!p.area) return;
    const z = B(p.area);
    if (!z) return;
    p.blocks = cpAreaBlocks(z);
  });
}
/* SOP steps linked to "role:x" find the check by its worked-out role too */
function sopParam(p, ref) {
  if (!ref) return null;
  if (ref.startsWith('role:')) {
    const r = ref.slice(5);
    return p.items.find(i => i.kind === 'auto' && (i.role === r || (REG[i.tag] && REG[i.tag].role === r))) || null;
  }
  if (ref.startsWith('man:')) return p.items.find(i => i.id === `cpm_${p.key}_${ref.slice(4)}`) || null;
  return p.items.find(i => i.id === ref) || null;
}

/* ---------- totals ---------- */
function cpTotals() {
  const T = { ok: 0, due: 0, overdue: 0, out: 0, nodata: 0, n: 0 };
  (DOC.cps || []).forEach(p => {
    const s = cpProcStats(p);
    ['ok', 'due', 'overdue', 'out', 'nodata', 'n'].forEach(k => (T[k] += s[k]));
  });
  const m = T.n - T.nodata;
  T.pct = m ? Math.round((T.ok / m) * 100) : 100;
  T.worst = T.out ? 'out' : T.overdue ? 'overdue' : T.due ? 'due' : 'ok';
  return T;
}
function cpAttention() {
  const L = [],
    rank = { out: 0, overdue: 1, due: 2 };
  (DOC.cps || []).forEach(p =>
    p.items.forEach(it => {
      const S = cpStatus(it);
      if (S.st in rank) L.push({ p, it, S });
    }),
  );
  return L.sort((a, b) => rank[a.S.st] - rank[b.S.st] || (b.it.crit || 0) - (a.it.crit || 0));
}
const cpWhen = t => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const cpResTxt = (it, S) => {
  const L = cpLimits(it);
  return S.v != null ? `${fmtN(S.v, L.d)} ${esc(L.unit || '')}` : S.r ? (S.r.ok === false ? 'Not OK' : 'OK') : '—';
};

/* ---------- header chip + ribbon count ---------- */
function cpChipRefresh() {
  const c = $('#cpChip');
  if (!c || !DOC.cps) return;
  const T = cpTotals(),
    tail = T.out ? ` · ${T.out} out` : T.overdue ? ` · ${T.overdue} overdue` : T.due ? ` · ${T.due} due` : '';
  c.title = `Process checks: ${T.pct}% OK · ${T.out} out of limit · ${T.overdue} overdue · ${T.due} due — open Process & SOP`;
  $('#cpChipT').innerHTML = `<span class="cpl">Checks </span>${T.pct}%<span class="cpx">${esc(tail)}</span>`;
  c.className = 'cpchip w-' + T.worst;
  const st = $('#cpStat');
  if (st) {
    st.textContent = `Checks ${T.pct}% OK${T.out ? ` · ${T.out} out of limit` : ''}${T.overdue ? ` · ${T.overdue} overdue` : ''}${T.due ? ` · ${T.due} due` : ''}`;
    st.className = 'cpstat w-' + T.worst;
  }
  const n = T.out + T.overdue + T.due;
  if ($('#cpDueN')) $('#cpDueN').textContent = n ? `(${n})` : '';
  if ($('#cCk')) $('#cCk').textContent = n;
}

/* ---------- area badges on the canvas ---------- */
const CP_BADGE_COL = { out: '#d93636', overdue: '#c2410c', due: '#a16207', ok: '#15803d' };
function cpDrawBadges() {
  const L = $('#Lpbadge');
  if (!L) return;
  if (PREF.pbadge === false || !DOC.cps || CPPICK) {
    L.innerHTML = '';
    return;
  }
  L.innerHTML = DOC.cps
    .filter(p => p.area && B(p.area))
    .map(p => {
      const z = B(p.area),
        R = afRect(z),
        s = cpProcStats(p),
        tail = s.out ? `${s.out} out of limit` : s.overdue ? `${s.overdue} overdue` : s.due ? `${s.due} due` : 'all OK',
        lab = `${s.pct}% · ${tail}`,
        room = R.w - (afName(z).length * 7.2 + 34),
        full = Math.round(lab.length * 6.6 + 30),
        short = `${s.pct}%`,
        fits = full <= room,
        txt = fits ? lab : short,
        tw = fits ? full : Math.round(short.length * 6.6 + 30),
        x = R.x + R.w - tw - 8,
        y = R.y + 5,
        col = CP_BADGE_COL[s.worst];
      return `<g class="pbadge" data-pid="${p.id}" transform="translate(${x},${y})"><title>${esc(p.name)} · ${esc(lab)} — open Process &amp; SOP</title><rect width="${tw}" height="20" rx="10" fill="#fff" stroke="${col}" stroke-width="1.4"/><circle cx="12" cy="10" r="4" fill="${col}"/><text x="21" y="14" style="font:600 11px var(--sans);fill:${col}">${esc(txt)}</text></g>`;
    })
    .join('');
}
$('#Lpbadge').addEventListener(
  'pointerdown',
  e => {
    const g = e.target.closest && e.target.closest('.pbadge');
    if (!g) return;
    e.stopPropagation();
    e.preventDefault();
    openCP(g.dataset.pid);
  },
  true,
);

/* ---------- dock tab: Checks due ---------- */
let cpDockKey = '';
const _renderDockCP = renderDock;
renderDock = function (force) {
  if (DTAB !== 'checks') {
    cpDockKey = '';
    return _renderDockCP(force);
  }
  $('#cAl').textContent = Object.values(ALERTS).filter(a => a.active).length;
  $('#cTg').textContent = Object.keys(REG).length;
  $('#cSt').textContent = DOC.streams.length;
  if (!DOC.cps) return;
  const A = cpAttention(),
    key = A.map(x => x.it.id + x.S.st + (x.S.t || '')).join();
  if (!force && key === cpDockKey) return;
  cpDockKey = key;
  $('#dockCtl').innerHTML = `<button class="sb" id="cpDockOpen">Open Process &amp; SOP</button>`;
  $('#cpDockOpen').onclick = () => openCP();
  $('#dbody').innerHTML = A.length
    ? `<table class="cp-dt"><thead><tr><th>Status</th><th>Process</th><th>Check</th><th>Frequency</th><th>Last done / value</th><th></th></tr></thead><tbody>${A.map(
        ({ p, it, S }) =>
          `<tr><td>${cpChip(S.st)}</td><td>${esc(p.name)}</td><td><b>${esc(it.name)}</b>${it.crit ? ' <span class="cp-crit">critical</span>' : ''}</td><td class="note">${esc(it.freq)}</td><td class="mono">${it.kind === 'auto' ? cpResTxt(it, S) : `${cpWhen(S.t)} · ${cpResTxt(it, S)}`}</td><td style="text-align:right">${it.kind === 'manual' ? `<button class="sb" data-cprd="${it.id}">Record</button>` : `<button class="sb" data-cptr="${esc(it.tag)}">Trend</button>`}</td></tr>`,
      ).join('')}</tbody></table>`
    : '<div class="note" style="padding:14px">All checks are OK — nothing is out of limit, overdue or due.</div>';
  $$('#dbody [data-cprd]').forEach(b => (b.onclick = () => cpRecordDialog(b.dataset.cprd)));
  $$('#dbody [data-cptr]').forEach(b => (b.onclick = () => openTrend(b.dataset.cptr)));
};

/* ---------- equipment panel: Process & checks ---------- */
function cpIxHtml(b) {
  if (!DOC.cps || EQ[b.type]?.widget) return '';
  const p = cpProcOf(b);
  if (!p)
    return `<section class="ix-sec cp-ix"><h4>Process &amp; checks</h4><p class="ix-hint">Not part of a process. Equipment placed inside an area box joins that area's process automatically.</p></section>`;
  const s = cpProcStats(p),
    sop = p.sop || {},
    own = p.items.filter(it => it.kind === 'auto' && b.tags.some(x => x.id === it.tag)),
    rank = { out: 0, overdue: 1, due: 2, ok: 3, nodata: 4 },
    man = p.items
      .filter(it => it.kind === 'manual')
      .map(it => ({ it, S: cpStatus(it) }))
      .sort((a, c) => rank[a.S.st] - rank[c.S.st])
      .slice(0, 4);
  const row = (it, S, sub) =>
    `<div class="cp-ixr"><i class="d-${S.st}"></i><span><b>${esc(it.name.replace(/ — .*$/, ''))}</b><small>${sub}</small></span><em class="v-${S.st}">${S.st === 'ok' || it.kind === 'auto' ? cpResTxt(it, S) : CP_ST[S.st][0]}</em></div>`;
  const autoRows = own
      .map(it => {
        const L = cpLimits(it);
        return row(it, cpStatus(it), `Automatic · ${it.defLim ? "starting limit" : "limit"} ${cpSpecTxt(L)}`);
      })
      .join(''),
    manRows = man.map(({ it, S }) => row(it, S, `Manual · ${esc(it.freq.toLowerCase())} · ${S.t ? cpWhen(S.t) : 'never'}`)).join('');
  return `<section class="ix-sec cp-ix"><h4>Process &amp; checks <span class="ix-sum">${s.pct}%</span></h4>
 <div class="cp-ixi"><div><span>Process</span><b>${esc(p.name)}</b></div><div><span>SOP</span><b class="mono">${esc(sop.no || '—')} · Rev ${esc(sop.version || '1.0')}</b></div><div><span>Compliance</span><b class="v-${s.worst}">${s.pct}%${s.out ? ` · ${s.out} out of limit` : s.overdue ? ` · ${s.overdue} overdue` : s.due ? ` · ${s.due} due` : ''}</b></div></div>
 ${autoRows ? `<div class="cp-ixh">Checks on this equipment</div>${autoRows}` : ''}
 ${manRows ? `<div class="cp-ixh">Process checks</div>${manRows}` : ''}
 ${sfIxHtml(p, b)}
 <div class="ix-acts"><button class="ib pri" id="cpIxRec">Record a check</button><button class="ib" id="cpIxSop">Open SOP</button></div>
 <div class="ix-acts"><button class="ix-link" id="cpIxAll">All checks</button><button class="ix-link" id="cpIxZoom">Zoom to process</button></div></section>`;
}
function cpIxInsert(T, b) {
  const h = cpIxHtml(b);
  if (!h) return;
  const more = T.querySelector('.ix-more');
  if (more) more.insertAdjacentHTML('beforebegin', h);
  else (T.querySelector('.ix') || T).insertAdjacentHTML('beforeend', h);
  const p = cpProcOf(b);
  if (!p) return;
  const on = (id, fn) => {
    const el = T.querySelector(id);
    if (el) el.onclick = fn;
  };
  on('#cpIxRec', () => cpRecordPicker(p.id));
  sfIxBind(T, p);
  on('#cpIxSop', () => openCP(p.id, 'sop'));
  on('#cpIxAll', () => openCP(p.id));
  on('#cpIxZoom', () => focusProcess(p.id));
}

/* ---------- Record a check (dialog) ---------- */
function cpRecordDialog(itemId) {
  cpSeed();
  const p = DOC.cps.find(x => x.items.some(i => i.id === itemId));
  if (!p) return;
  const it = p.items.find(i => i.id === itemId),
    L = cpLimits(it),
    S = cpStatus(it),
    by = (() => {
      try {
        return localStorage.getItem('sandman-cp-by') || '';
      } catch (e) {
        return '';
      }
    })();
  openModal(
    `<div class="cpr-dlg"><div class="cp-rec-h"><div><div class="note">${esc(p.name)} · ${esc(p.sop?.no || '')}${it.crit ? ' · <span class="cp-crit">critical</span>' : ''}</div><h3>${esc(it.name)}</h3></div></div>
 <div class="cp-rec-g"><div><span>Method</span><b>${esc(it.method || '—')}</b></div><div><span>Frequency</span><b>${esc(it.freq)}</b></div><div><span>Limit</span><b class="mono">${L.num ? cpSpecTxt(L) + (L.unit ? ' ' + esc(L.unit) : '') : 'OK / Not OK'}</b></div></div>
 <div class="cp-rec-st st-${S.st}">${CP_ST[S.st][0]}${S.r ? ` · last recorded ${cpWhen(S.t)} by ${esc(S.r.by || 'Operator')}${S.r.v != null ? ` · ${fmtN(S.r.v, L.d)} ${esc(L.unit)}` : ''}` : ' · never recorded'}</div>
 ${
   L.num
     ? `<label class="cp-rec-l">Measured value<span class="cp-rec-v"><input id="crV" type="number" step="any" inputmode="decimal" autocomplete="off"><em>${esc(L.unit || '')}</em><span id="crJ" class="cp-rec-j"></span></span></label>`
     : `<div class="cp-rec-l">Result<div class="seg cp-rec-ok" id="crOk"><button data-ok="1" class="on">OK</button><button data-ok="0">Not OK</button></div></div>`
 }
 <label class="cp-rec-l">Checked by<input id="crBy" value="${esc(by)}" placeholder="Name · shift"></label>
 <label class="cp-rec-l">Note (optional)<textarea id="crN" rows="2" placeholder="Where the sample was taken, action taken …"></textarea></label>
 <div class="mact"><button class="ib" id="crX">Cancel</button><button class="ib pri" id="crS">Save record</button></div></div>`,
    true,
  );
  const v = $('#crV');
  if (v)
    v.oninput = () => {
      const x = parseFloat(v.value),
        j = $('#crJ');
      if (!isFinite(x)) {
        j.textContent = '';
        j.className = 'cp-rec-j';
        return;
      }
      const out = (L.min != null && x < L.min) || (L.max != null && x > L.max);
      j.textContent = out ? 'Outside limit — reaction plan applies' : 'Within limit';
      j.className = 'cp-rec-j ' + (out ? 'bad' : 'good');
    };
  $$('#crOk button').forEach(b => (b.onclick = () => $$('#crOk button').forEach(x => x.classList.toggle('on', x === b))));
  $('#crX').onclick = () => closeModal();
  $('#crS').onclick = () => {
    const x = v ? parseFloat(v.value) : null;
    if (v && !isFinite(x)) {
      toast('Enter the measured value');
      v.focus();
      return;
    }
    const who = $('#crBy').value.trim() || 'Operator';
    try {
      localStorage.setItem('sandman-cp-by', who);
    } catch (e) {}
    const okb = $('#crOk button.on');
    (CPLOG[it.id] = CPLOG[it.id] || []).push({ t: Date.now(), v: v ? x : null, ok: okb ? okb.dataset.ok === '1' : undefined, by: who, note: $('#crN').value.trim() });
    CPLOG[it.id] = CPLOG[it.id].slice(-500);
    cpSaveLog();
    logEv(`Check recorded: ${p.name} — ${it.name}`);
    cpAlerts();
    cpRefreshAll();
    closeModal();
    toast('Check recorded');
  };
  setTimeout(() => (v || $('#crBy'))?.focus(), 40);
}
function cpRecordPicker(procId) {
  cpSeed();
  const rank = { out: 0, overdue: 1, due: 2, ok: 3, nodata: 4 },
    L = [];
  DOC.cps
    .filter(p => !procId || p.id === procId)
    .forEach(p => p.items.filter(i => i.kind === 'manual').forEach(it => L.push({ p, it, S: cpStatus(it) })));
  L.sort((a, b) => rank[a.S.st] - rank[b.S.st] || (b.it.crit || 0) - (a.it.crit || 0));
  const P = procId && DOC.cps.find(p => p.id === procId);
  openModal(
    `<h3>Record a check</h3><div class="note">${P ? esc(P.name) + ' · ' : ''}${L.length} manual checks · most urgent first</div>
 <div class="tbl-wrap cp-pick"><table><thead><tr><th>Status</th>${procId ? '' : '<th>Process</th>'}<th>Check</th><th>Frequency</th><th>Last done</th><th></th></tr></thead><tbody>${L.map(
   ({ p, it, S }) =>
     `<tr><td>${cpChip(S.st)}</td>${procId ? '' : `<td>${esc(p.name)}</td>`}<td><b>${esc(it.name)}</b>${it.crit ? ' <span class="cp-crit">critical</span>' : ''}</td><td class="note">${esc(it.freq)}</td><td class="mono">${cpWhen(S.t)}</td><td style="text-align:right"><button class="ib" data-cprd="${it.id}">Record</button></td></tr>`,
 ).join('')}</tbody></table></div>
 <div class="mact"><button class="ib pri" id="crpX">Close</button></div>`,
    'xl',
  );
  $$('#mbox [data-cprd]').forEach(b => (b.onclick = () => cpRecordDialog(b.dataset.cprd)));
  $('#crpX').onclick = () => closeModal(true);
}

/* ---------- SOP library + guided-run picker ---------- */
function cpSopList(mode) {
  cpSeed();
  sopAll();
  openModal(
    `<h3>${mode === 'run' ? 'Start a guided SOP run' : 'SOP library'}</h3><div class="note">${mode === 'run' ? 'Choose the process. The run walks through its pre-start checks and steps and ends with sign-off.' : `${DOC.cps.length} SOPs · one per process`}</div>
 <div class="tbl-wrap cp-pick"><table><thead><tr><th>SOP</th><th>Title</th><th>Rev</th><th>Status</th><th>Process</th><th></th></tr></thead><tbody>${DOC.cps
   .map(p => {
     const s = sopUpgrade(p),
       st = sopState(s);
     return `<tr><td class="mono">${esc(s.no || '')}</td><td><b>${esc((s.title || p.name).replace(/ — standard operating procedure$/, ''))}</b></td><td class="mono">${esc(s.version || '1.0')}</td><td><span class="chip ${st === 'Approved' ? 'sv0' : 'sv1'}">${esc(st)}</span></td><td>${esc(p.name)}</td><td style="text-align:right;white-space:nowrap">${mode === 'run' ? '' : `<button class="ib" data-sopo="${p.id}">Open</button> `}<button class="ib ${mode === 'run' ? 'pri' : ''}" data-sopr="${p.id}">▶ Guided run</button></td></tr>`;
   })
   .join('')}</tbody></table></div>
 <div class="mact"><button class="ib pri" id="sopLX">Close</button></div>`,
    'xl',
  );
  $$('#mbox [data-sopo]').forEach(b => (b.onclick = () => openCP(b.dataset.sopo, 'sop')));
  $$('#mbox [data-sopr]').forEach(b => (b.onclick = () => cpStartRun(b.dataset.sopr)));
  $('#sopLX').onclick = () => closeModal(true);
}
function cpStartRun(pid) {
  const p = DOC.cps.find(x => x.id === pid);
  if (!p) return;
  CPSEL = p.id;
  openCP(p.id);
  sopRunStart(p);
}

/* ---------- ribbon ---------- */
function cpRefreshAll() {
  try {
    cpChipRefresh();
    cpDrawBadges();
    if (DTAB === 'checks') renderDock(true);
    drawProc();
  } catch (e) {}
}
(() => {
  const on = (id, fn) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  };
  on('bCPRec', () => cpRecordPicker());
  on('bCPDue', () => {
    DTAB = 'checks';
    setDockTab();
    if ($('#dock').classList.contains('min')) $('#bDock').click();
    renderDock(true);
  });
  on('bSopRun', () => (PFOCUS ? cpStartRun(PFOCUS) : cpSopList('run')));
  on('bSopLib', () => cpSopList('lib'));
  on('bCPExp', () => {
    openCP();
    setTimeout(() => $('#cpCsv')?.click(), 30);
  });
  on('cpChip', () => openCP());
  on('cpStat', () => openCP());
  const cb = $('#procBadges');
  if (cb) {
    cb.checked = PREF.pbadge !== false;
    cb.onchange = () => {
      PREF.pbadge = cb.checked;
      savePref();
      cpDrawBadges();
    };
  }
})();

/* ---------- refresh ---------- */
let cpDocRef = null;
setInterval(() => {
  try {
    if (DOC !== cpDocRef) {
      // another loop was opened: new processes for it
      cpDocRef = DOC;
      if (!DOC.cps) cpSeed();
      PFOCUS = null;
      procSelFill();
    }
    cpAreaSync();
    cpChipRefresh();
    cpDrawBadges();
    if (DTAB === 'checks') renderDock();
  } catch (e) {}
}, 1500);
