/*! SandMan Digital Loop Studio — 23-asset-health.js
 *  v9.53 — Asset life-cycle and equipment health (every machine)
 *  · Asset life: installed date, design life (years / running hours), replacement value → age, % of life used,
 *    remaining life.
 *  · History: preventive (PM), inspection, corrective (breakdown → repair) and overhaul — counts, downtime, cost.
 *  · Equipment health score 0–100 with its reasons, and a recommendation: Healthy · Monitor · Overhaul required ·
 *    Plan replacement. Repair cost is compared with the replacement value (the repair-vs-replace rule of thumb).
 *  · "Try it with demo data" fills a realistic 24-month history for every machine (deterministic, demo only).
 *  Data: DOC.maint.assets[blockId] gains inst, life, lifeH, value. */

/* ---------- machine-type profiles (typical green-sand foundry values; demo + suggestions only) ---------- */
const MNT_PROF = [
  [/muller|mixer/i, { life: 20, value: 8500000, bd: 4, kw: 110, crit: 'A', make: 'Demo Foundry Equipment', model: 'Intensive muller 2000 L', fails: [['Mechanical', 'Wear and tear', 'Replaced', 'Plough / scraper broken'], ['Electrical', 'Overload', 'Reset / restarted', 'Main motor tripped on overload'], ['Lubrication', 'Lack of lubrication', 'Lubricated', 'Gearbox running hot']], parts: ['MX-PB', 'MX-SC', 'GR-EP2'] }],
  [/disa|moulding/i, { life: 25, value: 60000000, bd: 6, kw: 75, crit: 'B', make: 'DISA', model: 'Vertical moulding line', fails: [['Hydraulic', 'Wear and tear', 'Replaced', 'Hydraulic hose leaking'], ['Mechanical', 'Misalignment', 'Adjusted / aligned', 'Swing plate misaligned'], ['Control / PLC', 'Contamination (sand, dust, water)', 'Cleaned', 'Proximity sensor fault']], parts: ['DS-HF', 'OIL-H46'] }],
  [/furnace/i, { life: 20, value: 25000000, bd: 2, kw: 1500, crit: 'A', make: 'Demo Induction', model: '3 t coreless furnace', fails: [['Refractory', 'Wear and tear', 'Repaired', 'Lining patch needed'], ['Electrical', 'Overheating', 'Repaired', 'Coil cooling water low flow']], parts: [] }],
  [/pour/i, { life: 15, value: 4000000, bd: 3, kw: 15, crit: 'B', make: 'Demo Pouring Systems', model: 'Bottom-pour unit', fails: [['Mechanical', 'Wear and tear', 'Replaced', 'Stopper rod stuck'], ['Instrumentation / sensor', 'Contamination (sand, dust, water)', 'Cleaned', 'Weighing load cell drift']], parts: [] }],
  [/bucket elevator/i, { life: 15, value: 2500000, bd: 4, kw: 22, crit: 'A', make: 'Demo Conveyors', model: 'Belt bucket elevator 18 m', fails: [['Mechanical', 'Loose / not tightened', 'Adjusted / aligned', 'Belt slipping'], ['Mechanical', 'Wear and tear', 'Replaced', 'Buckets hitting the casing']], parts: ['BE-BK', 'BE-BLT', 'BRG-22216'] }],
  [/cooling drum|cooler/i, { life: 20, value: 6000000, bd: 3, kw: 45, crit: 'A', make: 'Demo Thermal', model: 'Cooling drum 2.4 × 9 m', fails: [['Mechanical', 'Lack of lubrication', 'Replaced', 'Trunnion bearing noise'], ['Instrumentation / sensor', 'Contamination (sand, dust, water)', 'Cleaned', 'Spray nozzles blocked']], parts: ['CD-NZ', 'BRG-22216', 'GR-EP2'] }],
  [/polygon|sieve|screen/i, { life: 12, value: 1200000, bd: 3, kw: 7.5, crit: 'B', make: 'Demo Screens', model: 'Polygon sieve 1.2 m', fails: [['Mechanical', 'Wear and tear', 'Replaced', 'Screen mesh torn']], parts: ['PS-MS'] }],
  [/shakeout/i, { life: 15, value: 3500000, bd: 5, kw: 22, crit: 'B', make: 'Demo Vibro', model: 'Flaskless vibratory shakeout', fails: [['Structural', 'Wear and tear', 'Repaired', 'Deck crack'], ['Mechanical', 'Loose / not tightened', 'Tightened', 'Mounting bolts loose'], ['Electrical', 'Overheating', 'Replaced', 'Vibro-motor bearing failed']], parts: ['GR-EP2'] }],
  [/magnet/i, { life: 15, value: 600000, bd: 1, kw: 3, crit: 'C', make: 'Demo Magnetics', model: 'Overband magnet', fails: [['Mechanical', 'Wear and tear', 'Replaced', 'Cross belt worn']], parts: [] }],
  [/screw feeder|feeder/i, { life: 10, value: 350000, bd: 2, kw: 5.5, crit: 'C', make: 'Demo Feeders', model: 'Screw feeder 200 mm', fails: [['Mechanical', 'Contamination (sand, dust, water)', 'Cleaned', 'Feeder choked']], parts: ['GR-EP2'] }],
  [/conveyor|belt/i, { life: 12, value: 800000, bd: 3, kw: 7.5, crit: 'B', make: 'Demo Conveyors', model: 'Troughed belt conveyor', fails: [['Mechanical', 'Misalignment', 'Adjusted / aligned', 'Belt running off'], ['Mechanical', 'Wear and tear', 'Replaced', 'Idler seized']], parts: ['CV-ID', 'GR-EP2'] }],
  [/silo|bin|hopper/i, { life: 30, value: 1500000, bd: 0.5, kw: 2, crit: 'C', make: 'Demo Fabrication', model: 'Storage silo', fails: [['Instrumentation / sensor', 'Contamination (sand, dust, water)', 'Cleaned', 'Level sensor reading wrong']], parts: [] }],
  [/plc|scada|switch|server|gateway/i, { life: 10, value: 400000, bd: 0.7, kw: 0.5, crit: 'B', make: 'Demo Automation', model: 'Control panel', fails: [['Control / PLC', 'Overheating', 'Cleaned', 'Panel fan failed, PLC hot']], parts: [] }],
];
function mntProfile(b) {
  const k = typeof mntKey === 'function' ? mntKey(b) : b.type;
  for (const [re, p] of MNT_PROF) if (re.test(k)) return p;
  return { life: 15, value: 500000, bd: 1, kw: 5, crit: 'C', make: 'Demo Equipment', model: '', fails: [['Mechanical', 'Wear and tear', 'Repaired', 'Fault']], parts: [] };
}
/* deterministic pseudo-random numbers for demo data (same plant every time) */
function mntRnd(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- life-cycle numbers of one machine ---------- */
function mntLife(b) {
  const M = mntDoc(),
    a = M.assets[b.id] || {};
  const inst = a.inst ? mntDate(a.inst) : a.year ? new Date(+a.year, 6, 1) : null;
  const ageY = inst ? (Date.now() - inst) / (365.25 * 864e5) : null;
  const life = +a.life || null;
  const used = ageY != null && life ? ageY / life : null;
  const t12 = Date.now() - 365 * 864e5;
  const L = M.log.filter(e => e.blk === b.id && e.status !== 'cancelled');
  const L12 = L.filter(e => mntDate(e.date) >= t12);
  const last = k => L.filter(e => e.kind === k).reduce((x, e) => (!x || mntDate(e.date) > mntDate(x.date) ? e : x), null);
  const lastPM = L.filter(e => e.kind === 'pm' || e.kind === 'insp').reduce((x, e) => (!x || mntDate(e.date) > mntDate(x.date) ? e : x), null);
  const bd = L.filter(e => e.kind === 'breakdown' && e.stop !== false),
    bd12 = L12.filter(e => e.kind === 'breakdown' && e.stop !== false);
  const rep12 = L12.filter(e => e.kind === 'repair'),
    repAll = L.filter(e => e.kind === 'repair');
  const cost = list => list.reduce((s, e) => s + mntCostOf(e).tot, 0);
  const down12 = L12.reduce((s, e) => s + (+e.down || 0), 0) / 60;
  const opH = 365 * ((M.cfg && M.cfg.opHours) || 20);
  const av12 = Math.max(0, Math.min(100, ((opH - down12) / opH) * 100));
  const plans = M.plans.filter(p => p.blk === b.id);
  const st = plans.map(p => ({ p, s: mntState(p) }));
  const over = st.filter(x => x.s.st === 'over');
  const ovhPlan = st.find(x => x.p.kind === 'ovh');
  const h = mntHours(b.id);
  return {
    a, inst, ageY, life, used, remY: life && ageY != null ? life - ageY : null, value: +a.value || null,
    hours: h ? h.v : null, lifeH: +a.lifeH || null,
    lastPM, lastRep: last('repair'), lastOvh: last('ovh'), lastBd: bd.reduce((x, e) => (!x || mntDate(e.date) > mntDate(x.date) ? e : x), null),
    bdAll: bd.length, bd12: bd12.length, repCost12: cost(rep12), repCostAll: cost(repAll), pmCost12: cost(L12.filter(e => e.kind === 'pm' || e.kind === 'insp')), ovhCost: cost(L.filter(e => e.kind === 'ovh')),
    cost12: cost(L12), down12, av12, mtbf12: bd12.length ? (opH - down12) / bd12.length : null,
    mttr12: rep12.length ? rep12.reduce((s, e) => s + (+e.down || 0), 0) / rep12.length : null,
    over: over.length, overSafe: over.filter(x => x.p.crit).length, ovhState: ovhPlan ? ovhPlan.s : null, ovhPlan: ovhPlan ? ovhPlan.p : null,
  };
}
/* ---------- health score + recommendation ---------- */
const MNT_REC = {
  ok: { t: 'Healthy', c: 'ok', d: 'Keep the plan as it is.' },
  mon: { t: 'Monitor', c: 'soon', d: 'Watch the trend; tighten inspections.' },
  ovh: { t: 'Overhaul required', c: 'over', d: 'Plan an overhaul at the next long stop.' },
  rep: { t: 'Plan replacement', c: 'rep', d: 'Budget a replacement; keep only safety repairs.' },
};
function mntHealth(b) {
  const L = mntLife(b);
  const R = [];
  let pen = 0;
  const add = (p, why) => {
    if (p > 0.5) R.push({ p: Math.round(p), why });
    pen += p;
  };
  if (L.used != null) add(Math.max(0, Math.min(1, (L.used - 0.5) / 0.5)) * 35, `${Math.round(L.used * 100)}% of its ${L.life}-year design life used`);
  add(Math.min(25, L.bd12 * 6), `${L.bd12} breakdown${L.bd12 === 1 ? '' : 's'} in 12 months`);
  add(Math.min(15, L.over * 4 + L.overSafe * 6), `${L.over} task${L.over === 1 ? '' : 's'} overdue${L.overSafe ? ` (${L.overSafe} safety-critical)` : ''}`);
  const ratio = L.value ? L.repCost12 / L.value : 0;
  add(Math.min(15, ratio * 150), `repairs ${mntRs(L.repCost12)} in 12 months = ${(ratio * 100).toFixed(1)}% of replacement value`);
  add(Math.min(10, Math.max(0, (99 - L.av12) * 5)), `availability ${L.av12.toFixed(1)}%`);
  const score = Math.max(0, Math.round(100 - pen));
  let rec = 'ok';
  if (L.used != null && L.used >= 0.9 && (ratio >= 0.1 || score < 50)) rec = 'rep';
  else if ((L.ovhState && L.ovhState.st === 'over') || score < 60) rec = 'ovh';
  else if (score < 80) rec = 'mon';
  R.sort((x, y) => y.p - x.p);
  return Object.assign(L, { score, rec, why: R.slice(0, 3), ratio });
}
const mntRecChip = r => `<span class="mnt-st mnt-rec-${MNT_REC[r].c}">${MNT_REC[r].t}</span>`;
function mntScoreBar(s) {
  const c = s >= 80 ? '#1f9d55' : s >= 60 ? '#c99a00' : s >= 40 ? '#ea580c' : '#b91c1c';
  return `<span class="mnt-hs"><i style="width:${s}%;background:${c}"></i></span><b class="mnt-hsn" style="color:${c}">${s}</b>`;
}
const mntYrs = y => (y == null ? '—' : y < 0 ? `${Math.abs(y).toFixed(1)} y past` : `${y.toFixed(1)} y`);

/* ---------- life & health block (equipment page, machine pop-up, Properties tab) ---------- */
function mntLifeHtml(b, small) {
  const H = mntHealth(b);
  const row = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
  return `<div class="mnt-life"><div class="mnt-life-h"><div><div class="mnt-sub" style="margin:0">Life &amp; health</div>${mntRecChip(H.rec)}</div><div class="mnt-gauge">${mntScoreBar(H.score)}<span class="note">health score</span></div></div>
   ${H.why.length ? `<ul class="mnt-why">${H.why.map(r => `<li>${esc(r.why)} <span class="note">−${r.p}</span></li>`).join('')}</ul>` : ''}<div class="note" style="margin:2px 0 6px">${MNT_REC[H.rec].d}</div>
   <div class="mnt-lg">${row('Installed', H.inst ? mntFmtD(mntIso(H.inst).slice(0, 10)) : '—')}${row('Age · design life', H.ageY != null ? `${H.ageY.toFixed(1)} y · ${H.life || '—'} y` : '—')}${row('Remaining life', mntYrs(H.remY))}${H.hours != null ? row('Running hours', Math.round(H.hours).toLocaleString('en-IN') + ' h' + (H.lifeH ? ` of ${H.lifeH.toLocaleString('en-IN')}` : '')) : ''}${row('Replacement value', H.value ? mntRs(H.value) : '—')}
   ${row('Last preventive', H.lastPM ? mntFmtD(H.lastPM.date) : '—')}${row('Last breakdown', H.lastBd ? mntFmtD(H.lastBd.date) : 'none recorded')}${row('Last overhaul', H.lastOvh ? mntFmtD(H.lastOvh.date) : '—')}${H.ovhState ? row('Next overhaul', esc(H.ovhState.text)) : ''}
   ${row('Breakdowns · 12 mo / all', `${H.bd12} / ${H.bdAll}`)}${row('Breakdown repair cost · 12 mo', mntRs(H.repCost12))}${small ? '' : row('Repair cost · all records', mntRs(H.repCostAll))}${row('MTBF · MTTR (12 mo)', `${H.mtbf12 ? Math.round(H.mtbf12).toLocaleString('en-IN') + ' h' : '—'} · ${H.mttr12 ? Math.round(H.mttr12) + ' min' : '—'}`)}${row('Availability · 12 mo', H.av12.toFixed(1) + '%')}</div></div>`;
}

/* ---------- Asset health tab: every machine, worst first ---------- */
let MNT_HF = 'all';
function mntTabHealth(body) {
  const eq = mntEquip().map(b => ({ b, h: mntHealth(b) }));
  const cnt = k => eq.filter(x => x.h.rec === k).length;
  const list = eq.filter(x => MNT_HF === 'all' || x.h.rec === MNT_HF).sort((x, y) => x.h.score - y.h.score);
  const bar = h => (h.used == null ? '—' : `<span class="mnt-lifebar" title="${Math.round(h.used * 100)}% of design life used"><i style="width:${Math.min(100, h.used * 100)}%;background:${h.used >= 0.9 ? '#b91c1c' : h.used >= 0.7 ? '#ea580c' : '#1f6feb'}"></i></span> ${Math.round(h.used * 100)}%`);
  const tot12 = eq.reduce((s, x) => s + x.h.repCost12, 0);
  body.innerHTML = `<div class="mnt-flt"><div class="seg" id="mntHF">${[['all', `All (${eq.length})`], ['rep', `Plan replacement (${cnt('rep')})`], ['ovh', `Overhaul required (${cnt('ovh')})`], ['mon', `Monitor (${cnt('mon')})`], ['ok', `Healthy (${cnt('ok')})`]].map(([k, n]) => `<button data-hf="${k}" class="${MNT_HF === k ? 'on' : ''}">${n}</button>`).join('')}</div>
  <span class="note">Breakdown repairs, 12 months: <b>${mntRs(tot12)}</b>. Score 100 = as new; points come off for age, breakdowns, overdue work, repair cost vs replacement value and lost availability.</span><button class="ib" id="mntHCsv">Export (CSV)</button></div>
 <table class="mnt-t mnt-ht"><thead><tr><th>Machine</th><th>Crit.</th><th>Installed</th><th>Life used</th><th>Remaining</th><th>Breakdowns 12 mo</th><th>Repair cost 12 mo</th><th>Last PM</th><th>Last overhaul</th><th>MTBF 12 mo</th><th>Health</th><th>Recommendation</th></tr></thead><tbody>${list
   .map(({ b, h }) => `<tr data-heq="${b.id}" class="mnt-hrow"><td><b>${esc(b.name)}</b><div class="note">${esc(b.props.desc || EQ[b.type].n)}</div></td><td>${h.a.crit ? `<span class="mnt-crit mnt-crit-${esc(h.a.crit)}">${esc(h.a.crit)}</span>` : '—'}</td><td class="mono">${h.inst ? h.inst.getFullYear() : '—'}</td><td style="white-space:nowrap">${bar(h)}</td><td class="mono">${mntYrs(h.remY)}</td><td class="mono">${h.bd12}</td><td class="mono">${mntRs(h.repCost12)}</td><td class="mono">${h.lastPM ? mntFmtD(h.lastPM.date) : '—'}</td><td class="mono">${h.lastOvh ? mntFmtD(h.lastOvh.date) : '—'}</td><td class="mono">${h.mtbf12 ? Math.round(h.mtbf12).toLocaleString('en-IN') + ' h' : '—'}</td><td style="white-space:nowrap">${mntScoreBar(h.score)}</td><td>${mntRecChip(h.rec)}<div class="note">${esc(h.why[0] ? h.why[0].why : '')}</div></td></tr>`)
   .join('')}</tbody></table>`;
  $$('#mntHF [data-hf]').forEach(x => (x.onclick = () => ((MNT_HF = x.dataset.hf), mntRender())));
  $$('#mntBody [data-heq]').forEach(x => (x.onclick = () => ((MNT_F.blk = x.dataset.heq), (MNT_TAB = 'equip'), mntRender())));
  $('#mntHCsv').onclick = () => {
    const rows = [['Machine', 'Description', 'Criticality', 'Installed', 'Age (y)', 'Design life (y)', 'Life used %', 'Remaining life (y)', 'Replacement value', 'Breakdowns 12 mo', 'Breakdowns all', 'Repair cost 12 mo', 'Repair cost all', 'Availability 12 mo %', 'MTBF 12 mo (h)', 'MTTR 12 mo (min)', 'Last PM', 'Last overhaul', 'Health score', 'Recommendation', 'Main reason']];
    eq.sort((x, y) => x.h.score - y.h.score).forEach(({ b, h }) => rows.push([b.name, b.props.desc || EQ[b.type].n, h.a.crit || '', h.inst ? mntIso(h.inst).slice(0, 10) : '', h.ageY != null ? h.ageY.toFixed(1) : '', h.life || '', h.used != null ? Math.round(h.used * 100) : '', h.remY != null ? h.remY.toFixed(1) : '', h.value || '', h.bd12, h.bdAll, Math.round(h.repCost12), Math.round(h.repCostAll), h.av12.toFixed(1), h.mtbf12 ? Math.round(h.mtbf12) : '', h.mttr12 ? Math.round(h.mttr12) : '', h.lastPM ? h.lastPM.date.slice(0, 10) : '', h.lastOvh ? h.lastOvh.date.slice(0, 10) : '', h.score, MNT_REC[h.rec].t, h.why[0] ? h.why[0].why : '']));
    mntCsvRows(rows, 'Asset_health');
  };
}

/* ---------- demo: full life-cycle history for every machine ---------- */
function mntDemoLife() {
  const M = mntDoc(),
    eq = mntEquip(),
    rate = M.cfg.rate;
  const ago = (d, h) => mntIso(new Date(Date.now() - d * 864e5 - (h || 0) * 36e5));
  const use = (no, qty) => {
    const p = M.parts.find(x => x.no === no);
    return p ? { id: p.id, name: p.name, no: p.no, unit: p.unit, qty, cost: p.cost } : null;
  };
  const team = { tech: ['Suresh', 'Suresh', 'Anand'], ic: 'Ravi Kumar' };
  // a few machines kept as clear examples (old / tired / new)
  const PIN = { 'SO-3': 2010, 'P-5': 2012, 'IF-1': 2008, 'CD-1': 2021, 'DISA-3': 2022, 'BE-1': 2014, 'P-10': 2013, 'MX-1': 2015 };
  eq.forEach(b => {
    const P = mntProfile(b),
      r = mntRnd('asset' + b.name);
    const a = (M.assets[b.id] = Object.assign({}, M.assets[b.id] || {}));
    const yr = PIN[b.name] || Math.round(2013 + r() * 11);
    if (!a.inst) a.inst = `${a.year || yr}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 27)).padStart(2, '0')}`;
    a.year = a.inst.slice(0, 4);
    a.life = a.life || P.life;
    a.value = a.value || Math.round((P.value * (0.85 + r() * 0.3)) / 1000) * 1000;
    a.crit = a.crit || P.crit;
    a.make = a.make || P.make;
    a.model = a.model || P.model;
    a.power = a.power || String(P.kw);
    a.serial = a.serial || `${b.name.replace(/[^A-Z0-9]/gi, '')}-${a.year.slice(2)}-${String(Math.floor(100 + r() * 899))}`;
    if (P.kw >= 20) a.lifeH = a.lifeH || a.life * 5000;
  });
  // planned-work history: each plan, back from its last date at its interval (short intervals: recent weeks only)
  M.plans.forEach(p => {
    const b = B(p.blk);
    if (!b || M.log.some(e => e.plan === p.id) || !p.days) return;
    const r = mntRnd('plan' + p.id + p.task);
    const span = p.days <= 1 ? 10 : p.days <= 7 ? 63 : p.days <= 31 ? 365 : 730;
    let d = (Date.now() - mntDate(p.last)) / 864e5;
    const age = (Date.now() - mntDate(M.assets[b.id].inst)) / 864e5;
    let n = 0;
    while (d <= span && d <= age && n < 60) {
      const late = r() < 0.15 ? Math.ceil(r() * Math.min(6, p.days / 3)) : 0;
      const ovh = p.kind === 'ovh';
      const v = M.assets[b.id].value || 500000;
      M.log.push({ id: mntId('w'), blk: b.id, plan: p.id, kind: p.kind, task: p.task, date: ago(d, 8 + r() * 6), by: ovh ? team.ic : team.tech[Math.floor(r() * 3)], status: 'done', late: late || undefined,
        down: ovh ? Math.round(240 + r() * 720) : p.kind === 'insp' ? 0 : Math.round(r() < 0.75 ? 0 : 10 + r() * 30), labHrs: ovh ? Math.round(24 + r() * 48) : p.kind === 'insp' ? 0.5 : Math.round((0.5 + r() * 2.5) * 2) / 2,
        rate, pused: ovh ? [] : /grease|lubric/i.test(p.task) ? [use('GR-EP2', Math.round((0.2 + r() * 0.6) * 10) / 10)].filter(Boolean) : [], other: ovh ? Math.round(Math.min(600000, v * (0.008 + r() * 0.015)) / 1000) * 1000 : 0, notes: ovh ? 'Overhaul — worn parts replaced, test run OK' : '' });
      d += p.days + late * (r() < 0.5 ? 1 : 0);
      n++;
    }
  });
  // corrective history: breakdowns + repairs over 24 months, more on old / tired machines
  eq.forEach(b => {
    const P = mntProfile(b),
      a = M.assets[b.id],
      r = mntRnd('bd' + b.name);
    const ageY = (Date.now() - mntDate(a.inst)) / (365.25 * 864e5);
    const ageF = 0.6 + Math.min(1.6, ageY / a.life) * 1.1;
    const have = M.log.filter(e => e.blk === b.id && e.kind === 'breakdown').length;
    const n = Math.max(0, Math.round(P.bd * 2 * ageF * (0.5 + r()) * (P.crit === 'C' ? 0.6 : 1)) - have);
    for (let i = 0; i < n; i++) {
      const d = 5 + r() * 720,
        f = P.fails[Math.floor(r() * P.fails.length)];
      const stop = r() < 0.75;
      const prio = stop ? (a.crit === 'A' ? 'P1' : 'P2') : 'P3';
      const w = { id: mntId('w'), blk: b.id, kind: 'breakdown', task: f[3], date: ago(d), by: team.tech[Math.floor(r() * 3)], stop, prio, status: 'closed', hist: [{ t: ago(d), by: 'Operator', st: 'open', note: 'Reported' }] };
      const parts = P.parts.length && r() < 0.7 ? [use(P.parts[Math.floor(r() * P.parts.length)], 1 + Math.floor(r() * 2))].filter(Boolean) : [];
      const big = r() < 0.18;
      const rep = { id: mntId('w'), blk: b.id, kind: 'repair', task: `${f[2]} — ${f[3].toLowerCase()}`, date: ago(d, -(1 + r() * 5)), by: team.tech[Math.floor(r() * 3)], status: 'done', down: stop ? Math.round((big ? 180 : 30) + r() * (big ? 480 : 150)) : 0, labHrs: Math.round((big ? 8 : 1.5) + r() * (big ? 16 : 5)), rate, pused: parts, other: big ? Math.round((5000 + r() * 40000) / 500) * 500 : 0, fail: { p: f[0], c: f[1], a: f[2] }, notes: big ? 'Service engineer / crane hire' : '', wo: w.id };
      w.closed = rep.date;
      w.closedBy = rep.id;
      M.log.push(w, rep);
    }
  });
  M.log.forEach(e => e.kind !== 'breakdown' && (e.cost = Math.round(mntCostOf(e).tot)));
  // numbers in date order; plan "last done" = latest job; running hours on hours-based plans
  M.seq = 0;
  M.log.sort((x, y) => mntDate(x.date) - mntDate(y.date)).forEach(e => (e.no = mntWoNo(e.date)));
  M.plans.forEach(p => {
    const L = M.log.filter(e => e.plan === p.id);
    if (L.length) p.last = L.at(-1).date.slice(0, 10);
  });
  eq.forEach(b => {
    if (!M.plans.some(p => p.blk === b.id && p.hours)) return;
    const a = M.assets[b.id],
      ageD = (Date.now() - mntDate(a.inst)) / 864e5,
      h0 = Math.round(ageD * 15);
    M.log.filter(e => e.blk === b.id && (e.kind === 'pm' || e.kind === 'insp')).forEach(e => (e.hours = Math.max(0, Math.round(h0 - ((Date.now() - mntDate(e.date)) / 864e5) * 15))));
    M.plans.filter(p => p.blk === b.id && p.hours).forEach(p => {
      const L = M.log.filter(e => e.plan === p.id);
      p.lastH = L.length ? L.at(-1).hours : null;
    });
  });
  M.cfg.demoLife = true;
}
