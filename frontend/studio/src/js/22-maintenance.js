/*! SandMan Digital Loop Studio — 22-maintenance.js
 *  v9.52 — Maintenance module (every machine in the loop)
 *  · Plans: Preventive maintenance (PM), Inspection and Overhaul tasks per machine, due by calendar days and/or running
 *    hours (whichever comes first). "Suggested plans" fills typical foundry tasks for every machine type.
 *  · Work log: every job is recorded (date, machine, type, task, done by, running hours, downtime, parts, notes).
 *    Entries are never deleted — a wrong entry is cancelled with a reason. Breakdowns reported from the shop floor stay
 *    open until a repair closes them.
 *  · Alerts: due soon → Advisory, overdue → Warning, open breakdown → Warning; shown in the Alerts list, Live panel and
 *    on the machine; optional desktop pop-ups; due list can be sent by email / WhatsApp (prepared message).
 *  · Only the maintenance team logs work: each member has a PIN (a simple lock until the Fountrix server adds logins).
 *  · Running hours: an hour-meter tag from the PLC when one is set for the machine, otherwise the meter reading the
 *    technician enters when logging.
 *  · Asset register: make, model, serial, installed, supplier, power, criticality and warranty for every machine.
 *  · Spare parts store: stock, minimum stock (low-stock alert); parts used on a job are taken from stock.
 *  · Costs: every job records labour (man-hours × rate), parts (at store price) and other expenses (contractor,
 *    service); the Costs tab shows spend by machine, by type (planned vs breakdown) and by month, exportable.
 *  Data lives in DOC.maint (saved with the loop; undo/redo never removes maintenance records). */

const MNT_KIND = { pm: 'Preventive maintenance', insp: 'Inspection', ovh: 'Overhaul', repair: 'Corrective maintenance (repair)', breakdown: 'Service request' };
const MNT_KS = { pm: 'PM', insp: 'Inspection', ovh: 'Overhaul', repair: 'Corrective', breakdown: 'Service request' };
function mntDoc() {
  if (!DOC.maint) DOC.maint = { plans: [], log: [], team: [], meters: {}, cfg: {} };
  const M = DOC.maint;
  M.plans = M.plans || [];
  M.log = M.log || [];
  M.team = M.team || [];
  M.meters = M.meters || {};
  M.assets = M.assets || {};
  M.parts = M.parts || [];
  M.cfg = Object.assign({ warnDays: 3, warnHours: 24, desktop: false, emails: '', wa: '', rate: 350, budget: 0, opHours: 20 }, M.cfg || {});
  return M;
}
function mntHas() {
  return !!(DOC.maint && (DOC.maint.plans.length || DOC.maint.log.length));
}
function mntEquip() {
  return typeof mcEquip === 'function' ? mcEquip() : DOC.blocks.filter(b => EQ[b.type] && !EQ[b.type].widget);
}
const mntId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function mntHash(pin) {
  let h = 0x811c9dc5;
  for (const c of 'fountrix-mnt|' + String(pin)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
/* dates are kept as local 'YYYY-MM-DDTHH:MM' text */
function mntIso(d) {
  const z = n => String(n).padStart(2, '0');
  d = d || new Date();
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
const mntDate = s => (s ? new Date(s.length <= 10 ? s + 'T00:00' : s) : null);
function mntFmtD(s, time) {
  const d = mntDate(s);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + (time ? ' ' + d.toTimeString().slice(0, 5) : '');
}
function mntEvery(p) {
  const a = [];
  if (p.days === 1) a.push('day');
  else if (p.days) a.push(p.days % 365 === 0 ? `${p.days / 365} yr` : p.days % 30 === 0 && p.days >= 60 ? `${p.days / 30} months` : `${p.days} days`);
  if (p.hours) a.push(`${p.hours.toLocaleString('en-IN')} h`);
  return a.length ? 'Every ' + a.join(' or ') : '—';
}

const mntRs = v => '₹' + Math.round(+v || 0).toLocaleString('en-IN');
function mntCostOf(e) {
  if (!e || e.status === 'cancelled') return { lab: 0, parts: 0, other: 0, tot: 0 };
  const lab = (+e.labHrs || 0) * (e.rate != null ? +e.rate : mntDoc().cfg.rate);
  const parts = (e.pused || []).reduce((a, u) => a + (+u.qty || 0) * (+u.cost || 0), 0);
  const other = +e.other || 0;
  return { lab, parts, other, tot: lab + parts + other };
}

/* ---------- running hours ---------- */
function mntHours(blk) {
  const M = mntDoc(),
    tag = M.meters[blk] && M.meters[blk].tag;
  if (tag && REG[tag]) {
    const v = val(tag);
    if (typeof v === 'number' && isFinite(v)) return { v, src: 'PLC tag ' + tag, live: true };
  }
  let best = null;
  M.log.forEach(e => {
    if (e.blk === blk && e.status !== 'cancelled' && e.hours != null && e.hours !== '' && (!best || mntDate(e.date) > mntDate(best.date))) best = e;
  });
  return best ? { v: +best.hours, src: 'reading on ' + mntFmtD(best.date), live: false } : null;
}

/* ---------- due state of a plan ---------- */
function mntState(p) {
  const M = mntDoc(),
    now = Date.now();
  let dl = null,
    hl = null,
    due = null;
  if (p.days && p.last) {
    due = new Date(mntDate(p.last).getTime() + p.days * 864e5);
    dl = (due - now) / 864e5;
  }
  if (p.hours && p.lastH != null && p.lastH !== '') {
    const ch = mntHours(p.blk);
    if (ch) hl = +p.lastH + p.hours - ch.v;
  }
  let st;
  if (p.paused) st = 'paused';
  else if (!p.last && (p.lastH == null || p.lastH === '')) st = 'new';
  else if ((dl != null && dl < 0) || (hl != null && hl < 0)) st = 'over';
  // "due soon" window: the warning lead, but never more than a third of the interval (a daily check is not "due soon" all day)
  else if ((dl != null && dl <= Math.min(M.cfg.warnDays, p.days / 3)) || (hl != null && hl <= Math.min(M.cfg.warnHours, p.hours / 3))) st = 'soon';
  else st = 'ok';
  const parts = [];
  if (dl != null) parts.push(dl < 0 ? `${Math.ceil(-dl)} day${Math.ceil(-dl) > 1 ? 's' : ''} overdue` : dl < 1 ? 'due today' : `due in ${Math.floor(dl)} day${Math.floor(dl) > 1 ? 's' : ''}`);
  if (hl != null) parts.push(hl < 0 ? `${Math.round(-hl)} h over` : `${Math.round(hl)} h left`);
  const text = st === 'paused' ? 'Paused' : st === 'new' ? 'No record yet — log when it was last done' : parts.join(' · ');
  const score = st === 'paused' ? 1e9 : st === 'new' ? -0.5 : Math.min(dl != null ? dl : 1e6, hl != null ? hl / 16 : 1e6);
  return { st, dl, hl, due, text, score };
}
const MNT_STN = { over: 'Overdue', soon: 'Due soon', ok: 'OK', new: 'No record', paused: 'Paused' };
/* work-order standards (CMMS practice): priority, status workflow, failure codes (ISO 14224 style) */
const MNT_PRIO = { P1: 'P1 Emergency — safety / line stopped', P2: 'P2 Urgent — within the shift', P3: 'P3 Normal — within the week', P4: 'P4 Low — next planned stop' };
const MNT_WST = { open: 'Open', assigned: 'Assigned', progress: 'In progress', hold: 'On hold', closed: 'Closed' };
const MNT_FAIL = {
  p: ['Mechanical', 'Electrical', 'Hydraulic', 'Pneumatic', 'Lubrication', 'Instrumentation / sensor', 'Control / PLC', 'Structural', 'Refractory', 'Other'],
  c: ['Wear and tear', 'Lack of lubrication', 'Misalignment', 'Loose / not tightened', 'Overload', 'Contamination (sand, dust, water)', 'Overheating', 'Operator error', 'Material / part defect', 'Design', 'Unknown'],
  a: ['Replaced', 'Repaired', 'Adjusted / aligned', 'Tightened', 'Cleaned', 'Lubricated', 'Reset / restarted', 'Modified', 'Temporary fix — follow-up needed'],
};
const mntIsOpen = e => e.kind === 'breakdown' && e.status !== 'closed' && e.status !== 'cancelled';
function mntOpenWO(blk) {
  return mntDoc().log.filter(e => mntIsOpen(e) && (!blk || e.blk === blk));
}
function mntWoNo(d) {
  const M = mntDoc();
  M.seq = (M.seq || 0) + 1;
  return `WO-${(d ? mntDate(d) : new Date()).getFullYear()}-${String(M.seq).padStart(4, '0')}`;
}
const mntPrioChip = p => (p ? `<span class="mnt-pr mnt-pr-${p}" title="${MNT_PRIO[p] || ''}">${p}</span>` : '');
const mntWstChip = e => `<span class="mnt-st mnt-w-${e.status}">${MNT_WST[e.status] || e.status}</span>`;

/* ---------- suggested plans by machine type (typical green-sand foundry practice; edit to suit the plant) ---------- */
const MNT_LIB = [
  [/muller|mixer/i, [['Check ploughs, scrapers and wheels for wear', 'insp', 7], ['Grease main bearings', 'pm', 7, 160], ['Replace / adjust plough and scraper blades', 'pm', 30], ['Gearbox oil level and leaks', 'pm', 30], ['Gearbox oil change', 'pm', 180, 4000], ['Overhaul — liners, wheels, gearbox', 'ovh', 365]]],
  [/disa|moulding/i, [['Pattern plates, chamber and squeeze plates check', 'insp', 7], ['Hydraulic oil level, leaks and filter', 'pm', 30, 500], ['Hydraulic oil and filter change', 'pm', 180, 3000], ['Lubrication of guides and swing plate', 'pm', 7, 160], ['Overhaul — squeeze / swing plates, seals, valves', 'ovh', 365]]],
  [/furnace/i, [['Refractory lining check (erosion, cracks)', 'insp', 1, null, 1], ['Coil cooling water flow and temperature', 'insp', 7, null, 1], ['Earth-leak detector and tilt hydraulics test', 'pm', 30, null, 1], ['Coil inspection and insulation test', 'pm', 180, null, 1], ['Relining', 'ovh', 120, null, 1]]],
  [/pour/i, [['Stopper rod and nozzle check', 'insp', 1, null, 1], ['Ladle / pouring unit refractory check', 'pm', 7, null, 1], ['Mechanism lubrication and calibration', 'pm', 30]]],
  [/bucket elevator/i, [['Buckets and bucket bolts check', 'insp', 15], ['Belt / chain tension and tracking', 'pm', 30], ['Head and boot pulley bearings grease', 'pm', 30, 500], ['Head pulley lagging and belt replacement check', 'ovh', 180]]],
  [/cooling drum|cooler/i, [['Water spray nozzles clean', 'pm', 7], ['Trunnion rollers and tyres grease', 'pm', 30, 500], ['Drive chain / girth gear check', 'pm', 30], ['Drum liner and lifter plates — overhaul', 'ovh', 365]]],
  [/polygon|sieve|screen/i, [['Screen mesh check for tears and blinding', 'insp', 7], ['Drive and bearings grease', 'pm', 30, 500], ['Mesh replacement', 'pm', 90]]],
  [/shakeout/i, [['Deck and springs check for cracks', 'insp', 7], ['Vibro-motor bearings grease', 'pm', 30, 500], ['Mounting bolts torque check', 'pm', 30], ['Overhaul — deck, springs, motors', 'ovh', 365]]],
  [/magnet/i, [['Magnet belt and scraper check', 'insp', 7], ['Magnet strength test', 'pm', 90]]],
  [/screw feeder|feeder/i, [['Flight wear and blockage check', 'insp', 7], ['Bearings and gearbox grease', 'pm', 30, 500]]],
  [/conveyor|belt/i, [['Belt, idlers and scraper check', 'insp', 7], ['Belt tension and alignment', 'pm', 30], ['Pulley bearings grease', 'pm', 30, 500], ['Belt / splice replacement check', 'ovh', 365]]],
  [/silo|bin|hopper/i, [['Level sensor clean and check', 'pm', 30], ['Gate / discharge valve operation', 'pm', 30], ['Liner and wall wear check', 'insp', 90]]],
  [/plc|scada|switch|server|gateway/i, [['Panel cleaning, fans and filters', 'pm', 90], ['Backup of program and settings', 'pm', 90], ['UPS and battery check', 'insp', 30]]],
];
function mntSuggest(b) {
  const E = EQ[b.type] || {},
    key = `${b.type} ${E.n || ''} ${b.props.desc || ''}`;
  for (const [re, list] of MNT_LIB) if (re.test(key)) return list;
  return [['General inspection', 'insp', 30], ['Lubrication', 'pm', 30]];
}
const mntKey = b => `${b.type} ${(EQ[b.type] || {}).n || ''} ${b.props.desc || ''}`;
function mntSteps(kind, task) {
  if (kind === 'ovh') return ['Plan the shutdown, spares and manpower with production', 'Isolate and lock out all energy sources (LOTO)', task, 'Replace worn parts; record measurements', 'Test run under load and hand over to production', 'Update the asset record'];
  if (kind === 'insp') return ['Agree with production; isolate if guards must be opened', task, 'Record findings; raise a service request for any defect'];
  return ['Inform production; isolate and lock out the drive (LOTO)', task, 'Check for leaks, unusual noise and loose bolts', 'Remove locks, test run and hand over to production'];
}
function mntAddSuggested(onlyMissing, demo) {
  const M = mntDoc();
  let n = 0,
    k = 0;
  mntEquip().forEach(b => {
    if (onlyMissing && M.plans.some(p => p.blk === b.id)) return;
    mntSuggest(b).forEach(([task, kind, days, hours, crit]) => {
      k++;
      // demo: spread the last-done dates so a few jobs are overdue and some are due soon
      const ago = !demo ? 0 : k % 17 === 5 ? days + 1 + (k % 4) : k % 11 === 3 ? days - Math.min(2, days / 4) : (days * ((k * 37) % 100)) / 160;
      const last = new Date(Date.now() - ago * 864e5);
      const who = demo ? (kind === 'ovh' ? 'Ravi Kumar' : /plc|scada|switch|sensor|electr|coil|earth/i.test(mntKey(b) + task) ? 'Anand' : 'Suresh') : '';
      M.plans.push({ id: mntId('p'), blk: b.id, task, kind, days: days || null, hours: hours || null, crit: !!crit, last: mntIso(last).slice(0, 10), lastH: null, who, steps: mntSteps(kind, task) });
      n++;
    });
  });
  return n;
}
function mntDemo() {
  const M = mntDoc();
  if (!M.team.length)
    M.team = [
      { id: mntId('t'), name: 'Ravi Kumar', role: 'Maintenance in-charge', rk: 'incharge', phone: '+91 90000 00001', email: 'ravi@demo-foundry.example', pin: mntHash('1234') },
      { id: mntId('t'), name: 'Suresh', role: 'Fitter', rk: 'tech', phone: '+91 90000 00002', pin: mntHash('1111') },
      { id: mntId('t'), name: 'Anand', role: 'Electrician', rk: 'tech', phone: '+91 90000 00003', pin: mntHash('2222') },
      { id: mntId('t'), name: 'Prakash', role: 'Production head', rk: 'prod', phone: '+91 90000 00004', email: 'prakash@demo-foundry.example', pin: mntHash('3333') },
      { id: mntId('t'), name: 'Meena', role: 'Store keeper', rk: 'store', email: 'stores@demo-foundry.example', pin: mntHash('4444') },
    ];
  if (!M.plans.length) mntAddSuggested(false, true);
  const eq = mntEquip(),
    by = n => eq.find(b => b.name === n) || eq[0];
  const ago = (d, h) => mntIso(new Date(Date.now() - d * 864e5 - (h || 0) * 36e5));
  // spare parts store (demo prices)
  if (!M.parts.length) {
    const P = [
      ['GR-EP2', 'Grease EP2', 'kg', 260, 18, 10, 'All machines'],
      ['OIL-G220', 'Gear oil ISO VG 220', 'L', 210, 40, 20, 'MX-1, gearboxes'],
      ['OIL-H46', 'Hydraulic oil ISO VG 46', 'L', 180, 60, 40, 'DISA-1/2/3'],
      ['MX-PB', 'Muller plough blade', 'pc', 4800, 2, 2, 'MX-1'],
      ['MX-SC', 'Muller scraper', 'pc', 3200, 4, 2, 'MX-1'],
      ['BE-BK', 'Elevator bucket', 'pc', 1350, 12, 6, 'BE-1'],
      ['BE-BLT', 'Bucket bolt set', 'set', 160, 40, 20, 'BE-1'],
      ['DS-HF', 'Hydraulic filter element', 'pc', 3900, 1, 2, 'DISA-1/2/3'],
      ['CD-NZ', 'Spray nozzle', 'pc', 650, 14, 6, 'CD-1'],
      ['PS-MS', 'Screen mesh panel', 'pc', 9500, 2, 1, 'PS-1'],
      ['CV-ID', 'Conveyor idler', 'pc', 2200, 8, 4, 'Belt conveyors'],
      ['BRG-22216', 'Spherical roller bearing 22216', 'pc', 7400, 3, 2, 'CD-1, BE-1'],
    ];
    M.parts = P.map(([no, name, unit, cost, stock, min, f]) => ({ id: mntId('s'), no, name, unit, cost, stock, min, for: f }));
  }
  const pt = no => M.parts.find(p => p.no === no);
  const use = (no, qty) => {
    const p = pt(no);
    return p ? { id: p.id, name: p.name, no: p.no, unit: p.unit, qty, cost: p.cost } : null;
  };
  // asset register (demo)
  const A = {
    'MX-1': { make: 'Demo Foundry Equipment', model: 'Muller 2000 L', serial: 'MX-19-0457', year: '2019', power: '110', crit: 'A', supplier: 'Demo Engineering Services', phone: '+91 44 0000 0000', notes: 'Batch 2.0 t, gearbox 1:28, oil VG 220' },
    'BE-1': { make: 'Demo Conveyors', model: 'Belt bucket elevator 18 m', serial: 'BE-20-118', year: '2020', power: '22', crit: 'A', supplier: 'Demo Conveyors', phone: '+91 44 0000 0001' },
    'CD-1': { make: 'Demo Thermal', model: 'Cooling drum 2.4 × 9 m', serial: 'CD-21-033', year: '2021', power: '45', crit: 'A', warranty: mntIso(new Date(Date.now() + 21 * 864e5)).slice(0, 10) },
    'DISA-1': { make: 'DISA', model: 'Vertical moulding line', serial: 'D1-2018-221', year: '2018', power: '75', crit: 'B' },
    'DISA-2': { make: 'DISA', model: 'Vertical moulding line', serial: 'D2-2019-305', year: '2019', power: '75', crit: 'B' },
    'DISA-3': { make: 'DISA', model: 'Vertical moulding line', serial: 'D3-2022-412', year: '2022', power: '75', crit: 'B' },
    'IF-1': { make: 'Demo Induction', model: '3 t coreless furnace', serial: 'IF-17-009', year: '2017', power: '1500', crit: 'A' },
    'PS-1': { make: 'Demo Screens', model: 'Polygon sieve 1.2 m', year: '2020', power: '7.5', crit: 'B' },
    'SO-2': { make: 'Demo Vibro', model: 'Flaskless shakeout', year: '2019', power: '2 × 11', crit: 'B' },
  };
  Object.entries(A).forEach(([n, a]) => {
    const b = eq.find(x => x.name === n);
    if (b && !M.assets[b.id]) M.assets[b.id] = a;
  });
  if (!M.log.length) {
    const rate = M.cfg.rate;
    const add = (n, kind, task, d, who, o) => {
      const b = by(n);
      const e = Object.assign({ id: mntId('w'), blk: b.id, kind, task, date: ago(d, o && o.h), by: who, status: kind === 'breakdown' ? 'closed' : 'done', down: 0, labHrs: 0, rate, pused: [], other: 0, notes: '' }, o || {});
      e.pused = (e.pused || []).filter(Boolean);
      delete e.h;
      const p = M.plans.find(x => x.blk === b.id && x.task === task);
      if (p && kind !== 'breakdown' && kind !== 'repair') {
        e.plan = p.id;
        if (mntDate(e.date) > mntDate(p.last || '1970-01-01')) p.last = e.date.slice(0, 10);
        if (e.hours != null) p.lastH = e.hours;
      }
      e.cost = Math.round(mntCostOf(e).tot);
      M.log.push(e);
      return e;
    };
    // routine greasing / checks over the last six months
    for (let m = 0; m < 6; m++) {
      add('MX-1', 'pm', 'Grease main bearings', 6 + m * 30, 'Suresh', { hours: 18420 - m * 480, labHrs: 1, pused: [use('GR-EP2', 0.5)] });
      add('BE-1', 'pm', 'Head and boot pulley bearings grease', 10 + m * 30, 'Suresh', { labHrs: 1.5, pused: [use('GR-EP2', 0.4)] });
      add('CD-1', 'pm', 'Water spray nozzles clean', 9 + m * 30, 'Suresh', { labHrs: 2, down: 20, pused: m % 2 ? [use('CD-NZ', 2)] : [], notes: m ? '' : '3 nozzles blocked' });
      add(['DISA-1', 'DISA-2', 'DISA-3'][m % 3], 'pm', 'Hydraulic oil level, leaks and filter', 20 + m * 30, 'Ravi Kumar', { hours: 22150 - m * 600, labHrs: 2, down: 30, pused: m % 2 ? [] : [use('DS-HF', 1), use('OIL-H46', 10)] });
    }
    add('MX-1', 'insp', 'Check ploughs, scrapers and wheels for wear', 5, 'Suresh', { hours: 18436, labHrs: 0.5, notes: 'Plough 2 worn ~60%' });
    add('MX-1', 'pm', 'Replace / adjust plough and scraper blades', 64, 'Suresh', { labHrs: 6, down: 180, pused: [use('MX-PB', 2), use('MX-SC', 2)] });
    add('PS-1', 'pm', 'Mesh replacement', 75, 'Suresh', { labHrs: 4, down: 120, pused: [use('PS-MS', 1)] });
    add('P-19', 'insp', 'Belt, idlers and scraper check', 3, 'Anand', { labHrs: 0.5, notes: 'OK' });
    add('Additive PLC', 'pm', 'Backup of program and settings', 40, 'Anand', { labHrs: 1 });
    // breakdowns closed by repairs
    const bd = (n, task, d, who, rep, prio) => {
      const w = add(n, 'breakdown', task, d, who, { stop: true, prio: prio || 'P2', hist: [{ t: ago(d), by: who, st: 'open', note: 'Reported' }] });
      const r = add(n, 'repair', rep.task, d, rep.by, Object.assign({ h: -2 }, rep));
      r.wo = w.id;
      w.closed = r.date;
      w.closedBy = r.id;
    };
    bd('BE-1', 'Bucket elevator tripped — belt slipping', 12, 'Anand', { task: 'Belt re-tensioned, 2 buckets replaced', by: 'Suresh', hours: 9310, down: 95, labHrs: 6, pused: [use('BE-BK', 2), use('BE-BLT', 8)], notes: 'Root cause: tension not checked', fail: { p: 'Mechanical', c: 'Loose / not tightened', a: 'Adjusted / aligned' } }, 'P1');
    bd('CD-1', 'Cooling drum trunnion bearing noise and heat', 52, 'Anand', { task: 'Trunnion bearing replaced', by: 'Suresh', down: 260, labHrs: 12, pused: [use('BRG-22216', 1), use('GR-EP2', 1)], other: 18000, notes: 'Crane hire + service engineer', fail: { p: 'Mechanical', c: 'Lack of lubrication', a: 'Replaced' } });
    bd('DISA-2', 'Hydraulic hose burst at swing plate', 97, 'Ravi Kumar', { task: 'Hose replaced, oil topped up', by: 'Ravi Kumar', down: 75, labHrs: 3, pused: [use('OIL-H46', 25)], other: 4500, fail: { p: 'Hydraulic', c: 'Wear and tear', a: 'Replaced' } });
    bd('P-5', 'Conveyor belt running off', 130, 'Anand', { task: 'Idlers replaced and belt trained', by: 'Suresh', down: 55, labHrs: 4, pused: [use('CV-ID', 2)], fail: { p: 'Mechanical', c: 'Misalignment', a: 'Replaced' } }, 'P3');
    // one service request still open
    M.log.push({ id: mntId('w'), blk: by('SO-2').id, kind: 'breakdown', task: 'Abnormal noise from vibro-motor, high vibration', date: ago(0, 3), by: 'Anand', stop: false, status: 'assigned', prio: 'P3', assign: 'Suresh', notes: 'Running — check at next stop', hist: [{ t: ago(0, 3), by: 'Anand', st: 'open', note: 'Reported' }, { t: ago(0, 2), by: 'Ravi Kumar', st: 'assigned', assign: 'Suresh', note: 'Check at the lunch stop' }] });
    // work-order numbers in date order
    M.seq = 0;
    M.log
      .slice()
      .sort((a, c) => mntDate(a.date) - mntDate(c.date))
      .forEach(e => (e.no = mntWoNo(e.date)));    // each plan's "last done" is its latest logged job
    M.plans.forEach(p => {
      const L = M.log.filter(e => e.plan === p.id);
      if (!L.length) return;
      const last = L.reduce((x, e) => (mntDate(e.date) > mntDate(x.date) ? e : x));
      p.last = last.date.slice(0, 10);
      p.lastH = last.hours != null ? last.hours : null;
    });
  }
  M.cfg.budget = M.cfg.budget || 1500000;
  M.cfg.demo = true;
  // v9.53 — full life-cycle history for every machine, condition triggers, standard alert rules
  if (typeof mntDemoLife === 'function') mntDemoLife();
  if (typeof mntDemoConds === 'function') mntDemoConds();
  if (typeof mntRules === 'function') mntRules();
}

/* ---------- alerts ---------- */
const MNT_NOTIFIED = new Set();
function mntCheckV952() { // replaced by the rules-based mntCheck in 24-mnt-alert-rules.js
  if (!DOC || !DOC.maint) {
    for (const k in ALERTS) if (k.startsWith('mnt:')) delete ALERTS[k];
    return;
  }
  const M = mntDoc(),
    live = new Set();
  const put = (k, sev, info) => {
    live.add(k);
    raise(k, sev, info);
    if (ALERTS[k]) {
      ALERTS[k].msg = info.msg;
      ALERTS[k].mnt = true;
    }
    if (sev >= 1 && !MNT_NOTIFIED.has(k + sev)) {
      MNT_NOTIFIED.add(k + sev);
      mntNotify(info.where, info.msg, sev);
    }
  };
  // alarm list (ISA-18.2: only what needs action): one alert per machine with overdue work + open service requests.
  // "Due soon", low stock and warranty reminders go to the Maintenance badge and desktop pop-ups, not the alarm list.
  const tell = (k, where, msg) => {
    if (!MNT_NOTIFIED.has(k)) {
      MNT_NOTIFIED.add(k);
      mntNotify(where, msg, 1);
    }
  };
  const over = {};
  M.plans.forEach(p => {
    const b = B(p.blk);
    if (!b) return;
    const s = mntState(p);
    if (s.st === 'over') (over[b.id] = over[b.id] || []).push({ p, s });
    else if (s.st === 'soon') tell('soon:' + p.id + p.last, b.name, `Maintenance due: ${p.task} — ${s.text}`);
  });
  Object.entries(over).forEach(([id, list]) => {
    const b = B(id),
      crit = list.some(x => x.p.crit);
    list.sort((a, c) => a.s.score - c.s.score);
    const first = list[0];
    put('mnt:od:' + id, crit ? 2 : 1, {
      blk: id,
      where: b.name,
      msg: `Maintenance overdue${crit ? ' (safety-critical)' : ''}: ${list.length > 1 ? `${list.length} tasks — ` : ''}${first.p.task} (${first.s.text})${list.length > 1 ? ` + ${list.length - 1} more` : ''}`,
    });
  });
  M.parts.forEach(pt => {
    if (pt.min != null && pt.min !== '' && +pt.stock <= +pt.min) tell('part:' + pt.id + pt.stock, 'Spare parts', `Low stock: ${pt.name} — ${+pt.stock} ${pt.unit || ''} left (minimum ${pt.min})`);
  });
  Object.entries(M.assets).forEach(([id, a]) => {
    const b = B(id);
    if (!b || !a.warranty) return;
    const d = (mntDate(a.warranty) - Date.now()) / 864e5;
    if (d >= 0 && d <= 30) tell('war:' + id, b.name, `Warranty ends in ${Math.ceil(d)} days (${mntFmtD(a.warranty)}) — plan any claim now`);
  });
  mntOpenWO().forEach(e => {
    const b = B(e.blk);
    if (b) put('mnt:wo:' + e.id, e.prio === 'P1' ? 3 : 2, { blk: b.id, where: b.name, msg: `${e.no ? e.no + ' · ' : ''}${e.prio ? e.prio + ' ' : ''}Service request ${(MNT_WST[e.status] || 'open').toLowerCase()}: ${e.task}${e.assign ? ' — ' + e.assign : ''}${e.stop ? ' — machine stopped' : ''} (reported ${mntFmtD(e.date, true)} by ${e.by})` });
  });
  for (const k in ALERTS)
    if (k.startsWith('mnt:') && !live.has(k)) {
      delete ALERTS[k];
      ALV++;
    }
  mntBadge();
}
/* count on the Maintenance buttons: overdue tasks + open service requests (+ due soon in the tooltip) */
function mntBadge() {
  const M = DOC.maint;
  let n = 0,
    soon = 0,
    low = 0;
  if (M) {
    M.plans.forEach(p => {
      const st = B(p.blk) ? mntState(p).st : '';
      if (st === 'over') n++;
      else if (st === 'soon') soon++;
    });
    n += mntOpenWO().length;
    low = (M.parts || []).filter(pt => pt.min != null && pt.min !== '' && +pt.stock <= +pt.min).length;
  }
  ['#vMnt', '#pMnt'].forEach(id => {
    const el = $(id);
    if (!el) return;
    let bd = el.querySelector('.mnt-badge');
    if (!n && !soon && !low) return bd && bd.remove();
    if (!bd) {
      bd = document.createElement('i');
      bd.className = 'mnt-badge';
      el.appendChild(bd);
    }
    bd.textContent = n || soon || '!';
    bd.classList.toggle('soon', !n);
    el.title = `Maintenance — ${n} overdue / open requests · ${soon} due soon${low ? ` · ${low} spare parts low` : ''}`;
  });
}
function mntNotify(where, msg, sev) {
  const M = DOC.maint && DOC.maint.cfg;
  if (!M || !M.desktop || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(`${sev >= 2 ? '⚠ ' : ''}${where} — Fountrix maintenance`, { body: msg, tag: where + msg });
  } catch (e) {}
}
function mntDueList() {
  const M = mntDoc();
  const due = M.plans
    .map(p => ({ p, s: mntState(p), b: B(p.blk) }))
    .filter(x => x.b && (x.s.st === 'over' || x.s.st === 'soon'))
    .sort((a, b) => a.s.score - b.s.score);
  return { due, open: mntOpenWO() };
}
function mntDueText() {
  const { due, open } = mntDueList();
  const L = [`Fountrix maintenance — ${DOC.name || 'Loop'} — ${mntFmtD(mntIso(), true)}`, ''];
  if (open.length) {
    L.push(`OPEN BREAKDOWNS (${open.length})`);
    open.forEach(e => L.push(`• ${B(e.blk)?.name}: ${e.task} (reported ${mntFmtD(e.date, true)})`));
    L.push('');
  }
  const ov = due.filter(x => x.s.st === 'over'),
    sn = due.filter(x => x.s.st === 'soon');
  if (ov.length) {
    L.push(`OVERDUE (${ov.length})`);
    ov.forEach(x => L.push(`• ${x.b.name}: ${x.p.task} — ${x.s.text}${x.p.who ? ` [${x.p.who}]` : ''}`));
    L.push('');
  }
  if (sn.length) {
    L.push(`DUE SOON (${sn.length})`);
    sn.forEach(x => L.push(`• ${x.b.name}: ${x.p.task} — ${x.s.text}${x.p.who ? ` [${x.p.who}]` : ''}`));
  }
  if (!open.length && !due.length) L.push('Nothing due — all maintenance up to date.');
  return L.join('\n');
}

/* ---------- KPIs (last 30 days) ---------- */
function mntKpi(blk) {
  const M = mntDoc(),
    t0 = Date.now() - 30 * 864e5;
  const L = M.log.filter(e => e.status !== 'cancelled' && (!blk || e.blk === blk) && mntDate(e.date) >= t0);
  const pm = L.filter(e => e.plan && e.kind !== 'repair' && e.kind !== 'breakdown');
  const onTime = pm.filter(e => !(e.late > 0)).length;
  const missed = M.plans.filter(p => (!blk || p.blk === blk) && mntState(p).st === 'over').length;
  const bd = L.filter(e => e.kind === 'breakdown');
  const rep = L.filter(e => e.kind === 'repair' && e.wo);
  const down = L.reduce((s, e) => s + (+e.down || 0), 0);
  const cost = L.reduce((s, e) => s + mntCostOf(e).tot, 0);
  return { cost, jobs: L.length, pmOn: pm.length + missed ? Math.round((onTime / (pm.length + missed)) * 100) : null, bd: bd.length, down, mttr: rep.length ? Math.round(rep.reduce((s, e) => s + (+e.down || 0), 0) / rep.length) : null };
}

/* ================= Maintenance window ================= */
let MNT_TAB = 'due',
  MNT_F = { blk: '', kind: '' };
function mntWindow(tab, blk) {
  mntDoc();
  if (tab) MNT_TAB = tab;
  if (blk != null) MNT_F.blk = blk;
  openModal(`<div id="mntW"></div>`, 'xxl');
  mntRender();
}
function mntRender() {
  const W = $('#mntW');
  if (!W) return;
  const M = mntDoc();
  if (!mntHas()) {
    W.innerHTML = `<h3>🔧 Maintenance</h3>
 <div class="mnt-empty"><p>Plan preventive maintenance, inspections and overhauls for <b>every machine</b> in this loop, log every job, and get alerts before work is due.</p>
 <div class="mnt-types"><div><b>Preventive maintenance</b><span>Planned, on a schedule — greasing, oil, blades, filters</span></div><div><b>Corrective maintenance</b><span>Repair after a breakdown or service request — restores the machine and closes the request</span></div><div><b>Overhaul</b><span>Major periodic rebuild — liners, gearbox, relining</span></div><div><b>Inspection</b><span>Quick checks — wear, leaks, nozzles, lining</span></div></div>
 <div class="mact" style="justify-content:flex-start"><button class="ib pri" id="mntSug">Start with suggested plans for all ${mntEquip().length} machines</button><button class="ib" id="mntDemoB">Try it with demo data</button></div>
 <div class="note">Suggested plans use typical green-sand foundry practice for each machine type; edit any task, interval or responsibility afterwards. Counting starts from today.</div></div>`;
    $('#mntSug').onclick = () => {
      const n = mntAddSuggested(false, false);
      save();
      mntCheck();
      toast(`${n} maintenance tasks added`);
      MNT_TAB = 'plans';
      mntRender();
    };
    $('#mntDemoB').onclick = () => {
      mntDemo();
      save();
      mntCheck();
      toast('Demo maintenance data added (team PINs: Ravi 1234 · Suresh 1111 · Anand 2222)');
      MNT_TAB = 'due';
      mntRender();
    };
    return;
  }
  const { due, open } = mntDueList();
  const k = mntKpi();
  const nOver = due.filter(x => x.s.st === 'over').length,
    nSoon = due.length - nOver;
  const tabs = [
    ['due', `Due${due.length + open.length ? ` (${due.length + open.length})` : ''}`],
    ['equip', 'Equipment'],
    ['health', 'Asset health'],
    ['plans', `Plans (${M.plans.length})`],
    ['log', `Work log (${M.log.length})`],
    ['assets', 'Assets'],
    ['parts', `Spare parts${M.parts.some(p => p.min != null && p.min !== '' && +p.stock <= +p.min) ? ' ⚠' : ''}`],
    ['rel', 'Reliability'],
    ['cost', 'Costs'],
    ['alerts', 'Alert rules'],
    ['set', 'Team & settings'],
  ];
  W.innerHTML = `<div class="mnt-hd"><h3>🔧 Maintenance</h3><div class="mnt-kpis">
  <div class="mnt-k ${nOver ? 'k-over' : ''}"><b>${nOver}</b><span>Overdue</span></div>
  <div class="mnt-k ${nSoon ? 'k-soon' : ''}"><b>${nSoon}</b><span>Due soon</span></div>
  <div class="mnt-k ${open.length ? 'k-over' : ''}"><b>${open.length}</b><span>Open requests</span></div>
  <div class="mnt-k"><b>${k.pmOn == null ? '—' : k.pmOn + '%'}</b><span>PM compliance · 30 d</span></div>
  <div class="mnt-k"><b>${(k.down / 60).toFixed(1)} h</b><span>Downtime · 30 d</span></div>
  <div class="mnt-k"><b>${k.mttr == null ? '—' : k.mttr + ' min'}</b><span>Avg repair time</span></div>
  <div class="mnt-k"><b>${mntRs(k.cost)}</b><span>Spend · 30 d</span></div></div>
  <div class="mnt-acts"><button class="ib pri" id="mntLogB">+ Log work</button><button class="ib" id="mntRepB">⚠ Service request</button></div></div>
 <div class="seg mnt-tabs">${tabs.map(([t, n]) => `<button data-mt="${t}" class="${MNT_TAB === t ? 'on' : ''}">${n}</button>`).join('')}</div>
 <div id="mntBody" class="mnt-body"></div>`;
  $$('#mntW [data-mt]').forEach(x => (x.onclick = () => ((MNT_TAB = x.dataset.mt), mntRender())));
  $('#mntLogB').onclick = () => mntForm({ kind: 'pm', blk: MNT_F.blk || '' });
  $('#mntRepB').onclick = () => mntForm({ kind: 'breakdown', blk: MNT_F.blk || '' });
  const body = $('#mntBody');
  if (MNT_TAB === 'due') mntTabDue(body, due, open);
  else if (MNT_TAB === 'plans') mntTabPlans(body);
  else if (MNT_TAB === 'equip') mntTabEquip(body);
  else if (MNT_TAB === 'log') mntTabLog(body);
  else if (MNT_TAB === 'assets') mntTabAssets(body);
  else if (MNT_TAB === 'parts') mntTabParts(body);
  else if (MNT_TAB === 'cost') mntTabCost(body);
  else if (MNT_TAB === 'rel') mntTabRel(body);
  else if (MNT_TAB === 'health') mntTabHealth(body);
  else if (MNT_TAB === 'alerts') mntTabRules(body);
  else mntTabSet(body);
}
const mntChip = st => `<span class="mnt-st mnt-${st}">${MNT_STN[st]}</span>`;
const mntKindChip = k => `<span class="mnt-kd mnt-kd-${k}">${MNT_KS[k] || k}</span>`;
function mntEqOpts(sel, any) {
  return (any ? `<option value="">${any}</option>` : '') + mntEquip().map(b => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${esc(b.name)} — ${esc(b.props.desc || EQ[b.type].n)}</option>`).join('');
}
function mntTabDue(body, due, open) {
  const blkF = MNT_F.blk;
  const d2 = due.filter(x => !blkF || x.p.blk === blkF),
    o2 = open.filter(e => !blkF || e.blk === blkF);
  body.innerHTML = `<div class="mnt-flt"><div class="fld"><label>Machine</label><select id="mntFB">${mntEqOpts(blkF, 'All machines')}</select></div>
  <span class="note">Due soon = within ${mntDoc().cfg.warnDays} days or ${mntDoc().cfg.warnHours} running hours. Change it under Team &amp; alerts.</span><button class="ib" id="mntPrDue">🖨 Print due list</button></div>
 ${o2.length ? `<h5 class="mnt-h5">Open service requests (work orders)</h5><table class="mnt-t"><thead><tr><th>WO no.</th><th>Priority</th><th>Machine</th><th>Problem</th><th>Reported</th><th>Production</th><th>Status</th><th>Assigned to</th><th></th></tr></thead><tbody>${o2
   .sort((a, c) => (a.prio || 'P3').localeCompare(c.prio || 'P3') || mntDate(a.date) - mntDate(c.date))
   .map(e => `<tr class="mnt-rover"><td class="mono"><b>${esc(e.no || '')}</b></td><td>${mntPrioChip(e.prio)}</td><td><b>${esc(B(e.blk)?.name || '?')}</b></td><td>${esc(e.task)}${e.notes ? `<div class="note">${esc(e.notes)}</div>` : ''}</td><td class="mono">${mntFmtD(e.date, true)}<div class="note">by ${esc(e.by)}</div></td><td>${e.stop ? '<span class="mnt-st mnt-over">Stopped</span>' : 'Running'}</td><td>${mntWstChip(e)}</td><td>${esc(e.assign || '—')}</td><td style="white-space:nowrap"><button class="ib sm" data-upd="${e.id}">Update</button> <button class="ib pri sm" data-close="${e.id}">Close with repair</button> <button class="lb" data-prw="${e.id}">Print</button></td></tr>`)
   .join('')}</tbody></table>` : ''}
 <h5 class="mnt-h5">Planned work due</h5>
 ${d2.length ? `<table class="mnt-t"><thead><tr><th>Status</th><th>Machine</th><th>Task</th><th>Type</th><th>Interval</th><th>Last done</th><th>When</th><th>Responsible</th><th></th></tr></thead><tbody>${d2.map(({ p, s, b }) => `<tr class="mnt-r${s.st}"><td>${mntChip(s.st)}</td><td><b>${esc(b.name)}</b></td><td>${esc(p.task)}${p.crit ? ' <span class="mnt-safe" title="Safety-critical">Safety</span>' : ''}</td><td>${mntKindChip(p.kind)}</td><td>${mntEvery(p)}</td><td class="mono">${mntFmtD(p.last)}${p.lastH != null && p.lastH !== '' ? ` · ${(+p.lastH).toLocaleString('en-IN')} h` : ''}</td><td><b>${esc(s.text)}</b></td><td>${esc(p.who || '—')}</td><td style="white-space:nowrap"><button class="ib pri sm" data-done="${p.id}">Mark done</button> <button class="lb" data-prp="${p.id}">Print WO</button> <button class="lb" data-loc="${b.id}">Locate</button></td></tr>`).join('')}</tbody></table>` : `<div class="mnt-ok">✓ Nothing due${blkF ? ' on this machine' : ''} — all planned maintenance is up to date.</div>`}`;
  $('#mntFB').onchange = e => ((MNT_F.blk = e.target.value), mntRender());
  $$('#mntBody [data-done]').forEach(x => (x.onclick = () => mntForm({ plan: x.dataset.done })));
  $$('#mntBody [data-close]').forEach(x => (x.onclick = () => mntForm({ kind: 'repair', wo: x.dataset.close })));
  $$('#mntBody [data-upd]').forEach(x => (x.onclick = () => mntForm({ upd: x.dataset.upd })));
  $$('#mntBody [data-prw]').forEach(x => (x.onclick = () => mntPrint({ entry: x.dataset.prw })));
  $$('#mntBody [data-prp]').forEach(x => (x.onclick = () => mntPrint({ plan: x.dataset.prp })));
  $('#mntPrDue').onclick = () => mntPrint({ due: 1, blk: blkF });
  $$('#mntBody [data-loc]').forEach(x => (x.onclick = () => mntLocate(x.dataset.loc)));
}
function mntLocate(id) {
  closeModal();
  if (!PRESENT && typeof select === 'function') select({ t: 'b', id });
  if (typeof mpLocate === 'function') mpLocate(id);
}
function mntTabPlans(body) {
  const M = mntDoc(),
    blkF = MNT_F.blk;
  const eq = mntEquip().filter(b => !blkF || b.id === blkF);
  const missing = mntEquip().filter(b => !M.plans.some(p => p.blk === b.id)).length;
  body.innerHTML = `<div class="mnt-flt"><div class="fld"><label>Machine</label><select id="mntFB">${mntEqOpts(blkF, 'All machines')}</select></div>
  <button class="ib" id="mntAddP">+ Add task</button>${missing ? `<button class="ib" id="mntSugM">Add suggested plans for ${missing} machine${missing > 1 ? 's' : ''} without a plan</button>` : ''}</div>
 <div id="mntPF"></div>
 ${eq
   .map(b => {
     const ps = M.plans.filter(p => p.blk === b.id);
     const h = mntHours(b.id);
     return `<div class="mnt-eq"><div class="mnt-eqh"><b>${esc(b.name)}</b><span class="note">${esc(b.props.desc || EQ[b.type].n)}</span><button class="lb" data-asset="${b.id}">Asset details</button><span class="mnt-hrs">${h ? `Running hours ${Math.round(h.v).toLocaleString('en-IN')} h <i>(${esc(h.src)})</i>` : '<i>No running-hours reading yet</i>'}</span></div>
   ${ps.length ? `<table class="mnt-t"><tbody>${ps.map(p => {
     const s = mntState(p);
     return `<tr><td style="width:96px">${mntChip(s.st)}</td><td>${esc(p.task)}${p.crit ? ' <span class="mnt-safe">Safety</span>' : ''}</td><td style="width:110px">${mntKindChip(p.kind)}</td><td style="width:170px">${mntEvery(p)}</td><td style="width:180px" class="note">${esc(s.text)}</td><td style="width:120px">${esc(p.who || '—')}</td><td style="width:150px;text-align:right"><button class="lb" data-ed="${p.id}">Edit</button><button class="lb" data-pz="${p.id}">${p.paused ? 'Resume' : 'Pause'}</button><button class="lb" data-rm="${p.id}" style="color:var(--crit)">Remove</button></td></tr>`;
   }).join('')}</tbody></table>` : '<div class="note" style="padding:6px 0">No maintenance plan for this machine yet.</div>'}</div>`;
   })
   .join('')}`;
  $('#mntFB').onchange = e => ((MNT_F.blk = e.target.value), mntRender());
  $('#mntAddP').onclick = () => mntPlanForm(null);
  const sm = $('#mntSugM');
  if (sm)
    sm.onclick = () => {
      const n = mntAddSuggested(true, false);
      save();
      mntCheck();
      toast(`${n} tasks added`);
      mntRender();
    };
  $$('#mntBody [data-ed]').forEach(x => (x.onclick = () => mntPlanForm(x.dataset.ed)));
  $$('#mntBody [data-asset]').forEach(x => (x.onclick = () => ((MNT_TAB = 'assets'), mntRender(), mntAssetForm(x.dataset.asset))));
  $$('#mntBody [data-pz]').forEach(
    x =>
      (x.onclick = () => {
        const p = M.plans.find(q => q.id === x.dataset.pz);
        p.paused = !p.paused;
        save();
        mntCheck();
        mntRender();
      }),
  );
  $$('#mntBody [data-rm]').forEach(
    x =>
      (x.onclick = () => {
        const p = M.plans.find(q => q.id === x.dataset.rm);
        if (!p || !confirmInline(x, 'Remove?')) return;
        M.plans = M.plans.filter(q => q !== p);
        save();
        mntCheck();
        toast('Task removed — its past work stays in the log');
        mntRender();
      }),
  );
}
/* two-click confirm without a browser dialog */
function confirmInline(btn, txt) {
  if (btn.dataset.sure) return true;
  btn.dataset.sure = 1;
  btn.textContent = txt;
  setTimeout(() => btn.isConnected && (delete btn.dataset.sure, (btn.textContent = 'Remove')), 3000);
  return false;
}
function mntPlanForm(id) {
  const M = mntDoc(),
    p = id ? M.plans.find(q => q.id === id) : { blk: MNT_F.blk || mntEquip()[0]?.id, task: '', kind: 'pm', days: 30, hours: null, crit: false, last: mntIso().slice(0, 10), lastH: null, who: '' };
  const F = $('#mntPF');
  F.innerHTML = `<div class="mnt-form"><h5>${id ? 'Edit task' : 'New maintenance task'}</h5><div class="mnt-g">
  <div class="fld" style="grid-column:span 2"><label>Machine</label><select id="pfB">${mntEqOpts(p.blk)}</select></div>
  <div class="fld" style="grid-column:span 2"><label>Task</label><input id="pfT" value="${esc(p.task)}" placeholder="e.g. Grease main bearings"></div>
  <div class="fld"><label>Type</label><select id="pfK">${['pm', 'insp', 'ovh'].map(k => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${MNT_KIND[k]}</option>`).join('')}</select></div>
  <div class="fld"><label>Every (days)</label><input id="pfD" type="number" min="0" value="${p.days ?? ''}"></div>
  <div class="fld"><label>or every (running hours)</label><input id="pfH" type="number" min="0" value="${p.hours ?? ''}" placeholder="optional"></div>
  <div class="fld"><label>Responsible</label><input id="pfW" value="${esc(p.who || '')}" list="mntTeamL" placeholder="name or role"></div>
  <div class="fld"><label>Last done (date)</label><input id="pfL" type="date" value="${esc((p.last || '').slice(0, 10))}"></div>
  <div class="fld"><label>Hours at last done</label><input id="pfLH" type="number" min="0" value="${p.lastH ?? ''}" placeholder="optional"></div>
  <label class="mnt-cb"><input type="checkbox" id="pfC" ${p.crit ? 'checked' : ''}> Safety-critical</label>
  <div class="fld" style="grid-column:1/-1"><label>Checklist steps (one per line — printed on the work order and ticked when logging)</label><textarea id="pfSt" rows="3" placeholder="Isolate and lock out the drive&#10;Clean grease nipples&#10;Apply grease until fresh grease shows">${esc((p.steps || []).join('\n'))}</textarea></div></div>
  <datalist id="mntTeamL">${M.team.map(t => `<option value="${esc(t.name)}">`).join('')}</datalist>
  <div class="mact" style="justify-content:flex-start"><button class="ib pri" id="pfS">${id ? 'Save task' : 'Add task'}</button><button class="ib" id="pfX">Cancel</button></div></div>`;
  F.scrollIntoView({ block: 'nearest' });
  $('#pfX').onclick = () => (F.innerHTML = '');
  $('#pfS').onclick = () => {
    const task = $('#pfT').value.trim(),
      days = +$('#pfD').value || null,
      hours = +$('#pfH').value || null;
    if (!task) return toast('Enter the task');
    if (!days && !hours) return toast('Enter an interval in days or running hours');
    const q = id ? p : { id: mntId('p') };
    Object.assign(q, { blk: $('#pfB').value, task, kind: $('#pfK').value, days, hours, who: $('#pfW').value.trim(), last: $('#pfL').value || null, lastH: $('#pfLH').value === '' ? null : +$('#pfLH').value, crit: $('#pfC').checked, steps: $('#pfSt').value.split('\n').map(x => x.trim()).filter(Boolean) });
    if (!id) M.plans.push(q);
    save();
    mntCheck();
    toast(id ? 'Task saved' : 'Task added');
    mntRender();
  };
}
function mntTabLog(body) {
  const M = mntDoc();
  const L = M.log
    .filter(e => (!MNT_F.blk || e.blk === MNT_F.blk) && (!MNT_F.kind || e.kind === MNT_F.kind))
    .sort((a, b) => mntDate(b.date) - mntDate(a.date));
  body.innerHTML = `<div class="mnt-flt"><div class="fld"><label>Machine</label><select id="mntFB">${mntEqOpts(MNT_F.blk, 'All machines')}</select></div>
  <div class="fld"><label>Type</label><select id="mntFK"><option value="">All types</option>${Object.keys(MNT_KIND).map(k => `<option value="${k}" ${MNT_F.kind === k ? 'selected' : ''}>${MNT_KIND[k]}</option>`).join('')}</select></div>
  <button class="ib" id="mntCsv">Export to Excel (CSV)</button><span class="note">Entries are never deleted — cancel a wrong entry with a reason.</span></div>
 ${L.length ? `<table class="mnt-t mnt-log"><thead><tr><th>WO no.</th><th>Date</th><th>Machine</th><th>Type</th><th>Task / problem</th><th>Done by</th><th>Hours</th><th>Downtime</th><th>Labour</th><th>Parts</th><th>Cost</th><th>Notes</th><th></th></tr></thead><tbody>${L.map(e => `<tr class="${e.status === 'cancelled' ? 'mnt-cx' : ''}"><td class="mono">${esc(e.no || '')}</td><td class="mono">${mntFmtD(e.date, true)}</td><td><b>${esc(B(e.blk)?.name || '(removed)')}</b></td><td>${mntKindChip(e.kind)}${e.kind === 'breakdown' ? ` ${mntPrioChip(e.prio)} ${e.status === 'cancelled' ? '' : mntWstChip(e)}` : ''}${e.fail ? `<div class="note">${esc([e.fail.p, e.fail.c, e.fail.a].filter(Boolean).join(' · '))}</div>` : ''}${e.late > 0 ? ` <span class="mnt-st mnt-soon">${e.late} d late</span>` : ''}</td><td>${esc(e.task)}</td><td>${esc(e.by || '')}</td><td class="mono">${e.hours != null && e.hours !== '' ? (+e.hours).toLocaleString('en-IN') : ''}</td><td class="mono">${+e.down ? e.down + ' min' : ''}</td><td class="mono">${+e.labHrs ? e.labHrs + ' h' : ''}</td><td>${mntPartsTxt(e)}</td><td class="mono">${mntCostOf(e).tot ? mntRs(mntCostOf(e).tot) : ''}</td><td>${esc(e.notes || '')}${e.status === 'cancelled' ? `<div class="note">Cancelled by ${esc(e.cxBy)}: ${esc(e.cxWhy)}</div>` : ''}</td><td style="white-space:nowrap"><button class="lb" data-prw="${e.id}">Print</button>${e.status === 'cancelled' ? '' : `<button class="lb" data-cx="${e.id}">Cancel</button>`}</td></tr>`).join('')}</tbody></table>` : '<div class="note" style="padding:10px 0">No work logged yet.</div>'}`;
  $('#mntFB').onchange = e => ((MNT_F.blk = e.target.value), mntRender());
  $('#mntFK').onchange = e => ((MNT_F.kind = e.target.value), mntRender());
  $('#mntCsv').onclick = () => mntCsv(L);
  $$('#mntBody [data-cx]').forEach(x => (x.onclick = () => mntForm({ cancel: x.dataset.cx })));
  $$('#mntBody [data-prw]').forEach(x => (x.onclick = () => mntPrint({ entry: x.dataset.prw })));
}
function mntCsv(L) {
  const rows = [['WO no.', 'Date', 'Machine', 'Type', 'Task / problem', 'Done by', 'Running hours', 'Downtime (min)', 'Labour (man-h)', 'Labour rate', 'Labour cost', 'Parts used', 'Parts cost', 'Other expenses', 'Total cost', 'Priority', 'Failure — problem', 'Failure — cause', 'Action taken', 'Notes', 'Status']];
  L.forEach(e => {
    const c = mntCostOf(e);
    rows.push([e.no || '', e.date.replace('T', ' '), B(e.blk)?.name || '', MNT_KIND[e.kind] || e.kind, e.task, e.by, e.hours ?? '', e.down || '', e.labHrs || '', e.labHrs ? e.rate : '', Math.round(c.lab) || '', mntPartsTxt(e, true), Math.round(c.parts) || '', e.other || '', Math.round(c.tot) || '', e.prio || '', e.fail?.p || '', e.fail?.c || '', e.fail?.a || '', e.notes || '', e.status === 'cancelled' ? `Cancelled: ${e.cxWhy}` : MNT_WST[e.status] || e.status]);
  });
  mntCsvRows(rows, 'Maintenance_log');
}
function mntTabSet(body) {
  const M = mntDoc(),
    c = M.cfg;
  const hasN = typeof Notification !== 'undefined';
  body.innerHTML = `<div class="mnt-cols"><div>
  <h5 class="mnt-h5">Maintenance team</h5><div class="note">Only these people can log work or report a problem. Each has a PIN. ${c.demo ? '<b>Demo PINs: Ravi 1234 · Suresh 1111 · Anand 2222 · Prakash 3333 · Meena 4444.</b>' : ''}</div>
  <table class="mnt-t"><tbody>${M.team.map(t => `<tr><td><b>${esc(t.name)}</b><div class="note">${esc(t.role || '')}</div></td><td>${esc(typeof MNT_ROLES === 'object' ? MNT_ROLES[mntRoleOf(t)] : '')}</td><td class="note">${esc([t.phone, t.email].filter(Boolean).join(' · ') || 'no contact')}</td><td class="note">PIN set</td><td style="text-align:right"><button class="lb" data-tpin="${t.id}">Change PIN</button><button class="lb" data-trm="${t.id}" style="color:var(--crit)">Remove</button></td></tr>`).join('') || '<tr><td class="note">No team members yet — add one to start logging.</td></tr>'}</tbody></table>
  <div class="mnt-g3"><div class="fld"><label>Name</label><input id="tmN"></div><div class="fld"><label>Job title</label><input id="tmR" placeholder="Fitter / Electrician / In-charge"></div><div class="fld"><label>Receives alerts as</label><select id="tmK">${Object.entries(typeof MNT_ROLES === 'object' ? MNT_ROLES : {}).map(([k, v]) => `<option value="${k}" ${k === 'tech' ? 'selected' : ''}>${v}</option>`).join('')}</select></div><span></span>
   <div class="fld"><label>WhatsApp / mobile</label><input id="tmPh" placeholder="+91 98xxxxxxxx"></div><div class="fld"><label>Email</label><input id="tmE" placeholder="name@plant.com"></div><div class="fld"><label>PIN (4–6 digits)</label><input id="tmP" type="password" inputmode="numeric" maxlength="6"></div><button class="ib pri" id="tmAdd">Add</button></div>
  <h5 class="mnt-h5">Running hours</h5><div class="note">Pick an hour-meter tag from the PLC where one exists. Machines without one use the meter reading entered when work is logged.</div>
  <div class="mnt-meters">${mntEquip()
    .filter(b => M.plans.some(p => p.blk === b.id && p.hours))
    .map(b => `<div class="fld"><label>${esc(b.name)}</label><select data-meter="${b.id}"><option value="">Meter reading in the log</option>${Object.values(REG).map(t => `<option value="${esc(t.id)}" ${M.meters[b.id]?.tag === t.id ? 'selected' : ''}>${esc(t.id)}${t.unit ? ` (${esc(t.unit)})` : ''}</option>`).join('')}</select></div>`)
    .join('') || '<div class="note">No task uses running hours yet.</div>'}</div>
 </div><div>
  <h5 class="mnt-h5">When to warn</h5><div class="mnt-g3"><div class="fld"><label>Due soon — days before</label><input id="cfD" type="number" min="0" value="${c.warnDays}"></div><div class="fld"><label>Due soon — running hours before</label><input id="cfH" type="number" min="0" value="${c.warnHours}"></div></div>
  <h5 class="mnt-h5">Costs</h5><div class="mnt-g3"><div class="fld"><label>Labour rate (₹ per man-hour)</label><input id="cfR" type="number" min="0" value="${c.rate}"></div><div class="fld"><label>Monthly maintenance budget (₹)</label><input id="cfB" type="number" min="0" value="${c.budget || ''}" placeholder="optional"></div><div class="fld"><label>Plant operating hours per day (for MTBF / availability)</label><input id="cfOp" type="number" min="1" max="24" value="${c.opHours}"></div></div>
  <h5 class="mnt-h5">Alerts</h5><div class="note">Who is told what, when, how loud and on which channel is set per event in <b>Alert rules</b>. Team members receive alerts by the role chosen above.</div>
  <label class="mnt-cb"><input type="checkbox" id="cfN" ${c.desktop ? 'checked' : ''} ${hasN ? '' : 'disabled'}> Desktop pop-up on this computer${hasN && Notification.permission === 'denied' ? ' <span class="note">(blocked in this browser’s settings)</span>' : ''}</label>
  <h5 class="mnt-h5">Extra recipients</h5><div class="note">People outside the team who also receive the due list. Automatic sending (daily list + instant overdue / breakdown alerts) comes with the Fountrix server; until then the buttons prepare the message for you to send.</div>
  <div class="fld"><label>Email addresses (comma separated)</label><input id="cfE" value="${esc(c.emails)}" placeholder="maintenance@plant.com"></div>
  <div class="fld"><label>WhatsApp numbers (with country code, comma separated)</label><input id="cfW" value="${esc(c.wa)}" placeholder="+91 98xxxxxxxx"></div>
  <div class="mact" style="justify-content:flex-start"><button class="ib pri" id="cfSave">Save settings</button><button class="ib" id="cfMail">✉ Email due list</button><button class="ib" id="cfWa">WhatsApp due list</button></div>
 </div></div>`;
  $('#tmAdd').onclick = () => {
    const n = $('#tmN').value.trim(),
      pin = $('#tmP').value.trim();
    if (!n) return toast('Enter the name');
    if (!/^\d{4,6}$/.test(pin)) return toast('PIN must be 4 to 6 digits');
    if (M.team.some(t => t.name.toLowerCase() === n.toLowerCase())) return toast('That name is already in the team');
    M.team.push({ id: mntId('t'), name: n, role: $('#tmR').value.trim(), rk: $('#tmK').value, phone: $('#tmPh').value.trim(), email: $('#tmE').value.trim(), pin: mntHash(pin) });
    save();
    toast(`${n} added to the maintenance team`);
    mntRender();
  };
  $$('#mntBody [data-trm]').forEach(
    x =>
      (x.onclick = () => {
        if (!confirmInline(x, 'Remove?')) return;
        M.team = M.team.filter(t => t.id !== x.dataset.trm);
        save();
        mntRender();
      }),
  );
  $$('#mntBody [data-tpin]').forEach(
    x =>
      (x.onclick = () => {
        const t = M.team.find(q => q.id === x.dataset.tpin);
        x.outerHTML = `<input type="password" inputmode="numeric" maxlength="6" class="mnt-pin" id="np${t.id}" placeholder="new PIN"><button class="lb" id="nps${t.id}">Set</button>`;
        $('#nps' + t.id).onclick = () => {
          const v = $('#np' + t.id).value.trim();
          if (!/^\d{4,6}$/.test(v)) return toast('PIN must be 4 to 6 digits');
          t.pin = mntHash(v);
          save();
          toast('PIN changed');
          mntRender();
        };
      }),
  );
  $$('#mntBody [data-meter]').forEach(
    x =>
      (x.onchange = () => {
        if (x.value) M.meters[x.dataset.meter] = { tag: x.value };
        else delete M.meters[x.dataset.meter];
        save();
        mntCheck();
      }),
  );
  const saveCfg = () => {
    c.warnDays = Math.max(0, +$('#cfD').value || 0);
    c.warnHours = Math.max(0, +$('#cfH').value || 0);
    if (M.rules && M.rules.due) M.rules.due.v = Math.max(0, +$('#cfD').value || 0);
    c.rate = Math.max(0, +$('#cfR').value || 0);
    c.budget = Math.max(0, +$('#cfB').value || 0);
    c.opHours = Math.min(24, Math.max(1, +$('#cfOp').value || 20));
    c.emails = $('#cfE').value.trim();
    c.wa = $('#cfW').value.trim();
    save();
    mntCheck();
  };
  $('#cfN').onchange = async e => {
    if (e.target.checked && Notification.permission !== 'granted') {
      try {
        await Notification.requestPermission();
      } catch (er) {}
    }
    c.desktop = e.target.checked && Notification.permission === 'granted';
    if (e.target.checked && !c.desktop) toast('This browser did not allow pop-ups — alerts still show in the app');
    MNT_NOTIFIED.clear();
    save();
    mntRender();
  };
  $('#cfSave').onclick = () => (saveCfg(), toast('Maintenance settings saved'));
  $('#cfMail').onclick = () => {
    saveCfg();
    const href = `mailto:${encodeURIComponent(c.emails).replace(/%2C/g, ',').replace(/%20/g, '')}?subject=${encodeURIComponent(`Maintenance due — ${DOC.name || 'Loop'}`)}&body=${encodeURIComponent(mntDueText())}`;
    window.open(href, '_blank');
  };
  $('#cfWa').onclick = () => {
    saveCfg();
    const first = (c.wa.split(',')[0] || '').replace(/\D/g, '');
    window.open(`https://wa.me/${first}?text=${encodeURIComponent(mntDueText())}`, '_blank');
  };
}

function mntPartsTxt(e, plain) {
  const a = (e.pused || []).map(u => `${u.name} × ${u.qty}${u.unit ? ' ' + u.unit : ''}`);
  if (e.parts) a.push(e.parts);
  return plain ? a.join('; ') : esc(a.join(', '));
}

/* ---------- Asset register ---------- */
const MNT_CRIT = { A: 'A — stops the whole line', B: 'B — stops one line / has a workaround', C: 'C — no production loss' };
function mntTabAssets(body) {
  const M = mntDoc(),
    blkF = MNT_F.blk;
  const eq = mntEquip().filter(b => !blkF || b.id === blkF);
  const filled = mntEquip().filter(b => M.assets[b.id] && Object.values(M.assets[b.id]).some(v => v)).length;
  body.innerHTML = `<div class="mnt-flt"><div class="fld"><label>Machine</label><select id="mntFB">${mntEqOpts(blkF, 'All machines')}</select></div>
  <span class="note">${filled} of ${mntEquip().length} machines have asset details. Criticality A machines stop the whole loop when they fail — plan their spares first.</span><button class="ib" id="mntAsCsv">Export asset register (CSV)</button></div>
 <div id="mntPF"></div>
 <table class="mnt-t"><thead><tr><th>Machine</th><th>Description</th><th>Make / model</th><th>Serial no.</th><th>Installed</th><th>Power</th><th>Criticality</th><th>Warranty to</th><th>Supplier / service contact</th><th>Spend · 30 d</th><th></th></tr></thead><tbody>${eq
   .map(b => {
     const a = M.assets[b.id] || {};
     const w = a.warranty ? (mntDate(a.warranty) - Date.now()) / 864e5 : null;
     return `<tr><td><b>${esc(b.name)}</b></td><td>${esc(b.props.desc || EQ[b.type].n)}</td><td>${esc([a.make, a.model].filter(Boolean).join(' ') || '—')}</td><td class="mono">${esc(a.serial || '—')}</td><td>${esc(a.year || '—')}</td><td>${a.power ? esc(a.power) + ' kW' : '—'}</td><td>${a.crit ? `<span class="mnt-crit mnt-crit-${esc(a.crit)}">${esc(a.crit)}</span>` : '—'}</td><td>${a.warranty ? `${mntFmtD(a.warranty)}${w < 0 ? ' <span class="note">(ended)</span>' : w <= 30 ? ' <span class="mnt-st mnt-soon">ends soon</span>' : ''}` : '—'}</td><td>${esc(a.supplier || '—')}${a.phone ? `<div class="note">${esc(a.phone)}</div>` : ''}</td><td class="mono">${mntRs(mntKpi(b.id).cost)}</td><td><button class="lb" data-asset="${b.id}">Edit</button></td></tr>`;
   })
   .join('')}</tbody></table>`;
  $('#mntFB').onchange = e => ((MNT_F.blk = e.target.value), mntRender());
  $$('#mntBody [data-asset]').forEach(x => (x.onclick = () => mntAssetForm(x.dataset.asset)));
  $('#mntAsCsv').onclick = () => {
    const rows = [['Machine', 'Description', 'Make', 'Model', 'Serial no.', 'Installed', 'Power (kW)', 'Criticality', 'Warranty to', 'Supplier', 'Contact', 'Location', 'Notes', 'Spend last 30 days']];
    mntEquip().forEach(b => {
      const a = M.assets[b.id] || {};
      rows.push([b.name, b.props.desc || EQ[b.type].n, a.make, a.model, a.serial, a.year, a.power, a.crit, a.warranty, a.supplier, a.phone, a.loc, a.notes, Math.round(mntKpi(b.id).cost)]);
    });
    mntCsvRows(rows, 'Asset_register');
  };
}
function mntAssetForm(id) {
  const M = mntDoc(),
    b = B(id),
    F = $('#mntPF');
  if (!b || !F) return;
  const a = M.assets[id] || {};
  const f = (k, l, ph, t) => `<div class="fld"><label>${l}</label><input data-af="${k}" ${t ? `type="${t}"` : ''} value="${esc(a[k] || '')}" placeholder="${ph || ''}"></div>`;
  F.innerHTML = `<div class="mnt-form"><h5>Asset details — ${esc(b.name)} <span class="note">${esc(b.props.desc || EQ[b.type].n)}</span></h5><div class="mnt-g">
  ${f('make', 'Make / manufacturer')}${f('model', 'Model')}${f('serial', 'Serial no.')}${f('year', 'Installed (year)', 'e.g. 2019')}
  ${f('power', 'Motor power (kW)', '', 'number')}<div class="fld"><label>Criticality</label><select data-af="crit"><option value="">—</option>${Object.entries(MNT_CRIT).map(([k, v]) => `<option value="${k}" ${a.crit === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  ${f('warranty', 'Warranty to', '', 'date')}${f('loc', 'Location', 'e.g. Sand plant, level 2')}
  ${f('inst', 'Installed (commissioning date)', '', 'date')}${f('life', 'Design life (years)', 'e.g. 20', 'number')}${f('lifeH', 'Design life (running hours)', 'optional', 'number')}${f('value', 'Replacement value (₹)', 'today\'s price', 'number')}
  ${f('supplier', 'Supplier / service company')}${f('phone', 'Service contact phone')}
  <div class="fld" style="grid-column:span 2"><label>Specifications / notes</label><input data-af="notes" value="${esc(a.notes || '')}" placeholder="capacity, gearbox ratio, bearing nos., oil grade…"></div></div>
  <div class="mact" style="justify-content:flex-start"><button class="ib pri" id="afS">Save asset details</button><button class="ib" id="afX">Cancel</button></div></div>`;
  F.scrollIntoView({ block: 'nearest' });
  $('#afX').onclick = () => (F.innerHTML = '');
  $('#afS').onclick = () => {
    const o = {};
    $$('#mntPF [data-af]').forEach(x => x.value.trim() && (o[x.dataset.af] = x.value.trim()));
    if (o.inst) o.year = o.inst.slice(0, 4);
    M.assets[id] = o;
    save();
    mntCheck();
    toast(`Asset details saved — ${b.name}`);
    mntRender();
  };
}

/* ---------- Spare parts store ---------- */
function mntTabParts(body) {
  const M = mntDoc(),
    t0 = Date.now() - 30 * 864e5;
  const used = {};
  M.log.forEach(e => e.status !== 'cancelled' && mntDate(e.date) >= t0 && (e.pused || []).forEach(u => (used[u.id] = (used[u.id] || 0) + u.qty)));
  const val = M.parts.reduce((a, p) => a + (+p.stock || 0) * (+p.cost || 0), 0);
  body.innerHTML = `<div class="mnt-flt"><button class="ib pri" id="ptAdd">+ Add part</button><span class="note">${M.parts.length} parts · stock value <b>${mntRs(val)}</b>. Parts used on a job are taken from stock automatically; cancelling the job puts them back. At or below the minimum, an Advisory alert asks to reorder.</span><button class="ib" id="ptCsv">Export (CSV)</button></div>
 <div id="mntPF"></div>
 ${M.parts.length ? `<table class="mnt-t"><thead><tr><th>Part no.</th><th>Part</th><th>Unit</th><th>Unit cost</th><th>In stock</th><th>Minimum</th><th>Stock value</th><th>Used · 30 d</th><th>For machines</th><th></th></tr></thead><tbody>${M.parts
   .map(pt => {
     const low = pt.min != null && pt.min !== '' && +pt.stock <= +pt.min;
     return `<tr class="${low ? 'mnt-rsoon' : ''}"><td class="mono">${esc(pt.no || '')}</td><td><b>${esc(pt.name)}</b>${low ? ' <span class="mnt-st mnt-soon">Reorder</span>' : ''}</td><td>${esc(pt.unit || '')}</td><td class="mono">${mntRs(pt.cost)}</td><td class="mono"><b>${+pt.stock}</b></td><td class="mono">${pt.min ?? ''}</td><td class="mono">${mntRs((+pt.stock || 0) * (+pt.cost || 0))}</td><td class="mono">${used[pt.id] || ''}</td><td>${esc(pt.for || '')}</td><td style="white-space:nowrap"><button class="lb" data-rcv="${pt.id}">Receive</button><button class="lb" data-pte="${pt.id}">Edit</button></td></tr>`;
   })
   .join('')}</tbody></table>` : '<div class="note" style="padding:10px 0">No spare parts yet. Add the parts you keep in the maintenance store — grease, oils, blades, belts, bearings, filters, nozzles, screen mesh.</div>'}`;
  $('#ptAdd').onclick = () => mntPartForm(null);
  $$('#mntBody [data-pte]').forEach(x => (x.onclick = () => mntPartForm(x.dataset.pte)));
  $$('#mntBody [data-rcv]').forEach(
    x =>
      (x.onclick = () => {
        const pt = M.parts.find(q => q.id === x.dataset.rcv);
        x.outerHTML = `<input type="number" min="0" step="any" class="mnt-pin" id="rq${pt.id}" placeholder="qty in"><button class="lb" id="rs${pt.id}">Add to stock</button>`;
        $('#rq' + pt.id).focus();
        $('#rs' + pt.id).onclick = () => {
          const q = +$('#rq' + pt.id).value;
          if (!(q > 0)) return toast('Enter the quantity received');
          pt.stock = Math.round((+pt.stock + q) * 1000) / 1000;
          (pt.rcv = pt.rcv || []).push({ date: mntIso(), qty: q });
          logEv(`Spare part received: ${pt.name} + ${q} ${pt.unit || ''}`);
          save();
          mntCheck();
          toast(`${pt.name}: ${pt.stock} in stock`);
          mntRender();
        };
      }),
  );
  $('#ptCsv').onclick = () => {
    const rows = [['Part no.', 'Part', 'Unit', 'Unit cost', 'In stock', 'Minimum', 'Stock value', 'Used last 30 days', 'For machines']];
    M.parts.forEach(pt => rows.push([pt.no, pt.name, pt.unit, pt.cost, pt.stock, pt.min, Math.round((+pt.stock || 0) * (+pt.cost || 0)), used[pt.id] || 0, pt.for]));
    mntCsvRows(rows, 'Spare_parts');
  };
}
function mntPartForm(id) {
  const M = mntDoc(),
    pt = id ? M.parts.find(q => q.id === id) : { no: '', name: '', unit: 'pc', cost: '', stock: 0, min: '', for: '' },
    F = $('#mntPF');
  const f = (k, l, t, ph) => `<div class="fld"><label>${l}</label><input data-pf="${k}" ${t ? `type="${t}" step="any" min="0"` : ''} value="${esc(pt[k] ?? '')}" placeholder="${ph || ''}"></div>`;
  F.innerHTML = `<div class="mnt-form"><h5>${id ? 'Edit spare part' : 'New spare part'}</h5><div class="mnt-g">
  ${f('name', 'Part name', '', 'e.g. Muller plough blade')}${f('no', 'Part no.')}${f('unit', 'Unit', '', 'pc / kg / L / set / m')}${f('cost', 'Unit cost (₹)', 'number')}
  ${f('stock', 'In stock', 'number')}${f('min', 'Minimum stock (reorder level)', 'number')}<div class="fld" style="grid-column:span 2"><label>For machines</label><input data-pf="for" value="${esc(pt.for || '')}" placeholder="e.g. MX-1, BE-1"></div></div>
  <div class="mact" style="justify-content:flex-start"><button class="ib pri" id="pfS2">${id ? 'Save part' : 'Add part'}</button><button class="ib" id="pfX2">Cancel</button></div></div>`;
  F.scrollIntoView({ block: 'nearest' });
  $('#pfX2').onclick = () => (F.innerHTML = '');
  $('#pfS2').onclick = () => {
    const g = k => $(`#mntPF [data-pf="${k}"]`).value.trim();
    if (!g('name')) return toast('Enter the part name');
    if (g('cost') === '' || +g('cost') < 0) return toast('Enter the unit cost');
    const q = id ? pt : { id: mntId('s') };
    Object.assign(q, { name: g('name'), no: g('no'), unit: g('unit'), cost: +g('cost'), stock: +g('stock') || 0, min: g('min') === '' ? null : +g('min'), for: g('for') });
    if (!id) M.parts.push(q);
    save();
    mntCheck();
    toast(id ? 'Part saved' : 'Part added to the store');
    mntRender();
  };
}

/* ---------- Costs ---------- */
let MNT_PER = '30';
/* ---------- Reliability (standard maintenance KPIs) ---------- */
function mntFrom(per) {
  const now = new Date();
  return per === 'm' ? new Date(now.getFullYear(), now.getMonth(), 1) : per === 'y' ? new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1) : per === 'all' ? null : new Date(Date.now() - +per * 864e5);
}
function mntRelStats(per) {
  const M = mntDoc();
  let from = mntFrom(per);
  if (!from) from = M.log.length ? new Date(Math.min(...M.log.map(e => +mntDate(e.date)))) : new Date();
  const days = Math.max(1, (Date.now() - from) / 864e5);
  const opH = days * (M.cfg.opHours || 20);
  const L = M.log.filter(e => e.status !== 'cancelled' && mntDate(e.date) >= from);
  const per_m = {};
  mntEquip().forEach(b => (per_m[b.id] = { f: 0, down: 0, rep: 0, nrep: 0 }));
  L.forEach(e => {
    const o = per_m[e.blk];
    if (!o) return;
    if (e.kind === 'breakdown' && e.stop) o.f++;
    if (e.kind === 'repair') {
      o.down += +e.down || 0;
      o.rep += +e.down || 0;
      o.nrep++;
    } else o.down += +e.down || 0;
  });
  const rows = Object.entries(per_m)
    .map(([id, o]) => {
      const upH = opH - o.down / 60;
      return { id, f: o.f, down: o.down, mtbf: o.f ? upH / o.f : null, mttr: o.nrep ? o.rep / o.nrep : null, av: Math.max(0, Math.min(100, (upH / opH) * 100)) };
    })
    .filter(r => r.f || r.down)
    .sort((a, c) => c.f - a.f || c.down - a.down);
  const pm = L.filter(e => e.plan && e.kind !== 'repair' && e.kind !== 'breakdown');
  const overNow = M.plans.filter(p => mntState(p).st === 'over').length;
  const lab = k => L.filter(k).reduce((a, e) => a + (+e.labHrs || 0), 0);
  const plannedLab = lab(e => e.kind === 'pm' || e.kind === 'insp' || e.kind === 'ovh'),
    allLab = lab(e => e.kind !== 'breakdown');
  const closed = L.filter(e => e.kind === 'breakdown' && e.closed);
  const resp = closed.length ? closed.reduce((a, e) => a + (mntDate(e.closed) - mntDate(e.date)) / 36e5, 0) / closed.length : null;
  const fails = L.filter(e => e.kind === 'breakdown' && e.stop).length,
    repDown = L.filter(e => e.kind === 'repair').map(e => +e.down || 0);
  const cnt = key => {
    const c = {};
    L.forEach(e => e.fail && e.fail[key] && (c[e.fail[key]] = (c[e.fail[key]] || 0) + 1));
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  };
  return {
    days,
    opH,
    rows,
    pmComp: pm.length + overNow ? Math.round((pm.filter(e => !(e.late > 0)).length / (pm.length + overNow)) * 100) : null,
    plannedPct: allLab ? Math.round((plannedLab / allLab) * 100) : null,
    backlog: mntOpenWO().length + M.plans.filter(p => mntState(p).st === 'over').length,
    resp,
    fails,
    mtbf: fails ? Math.max(0, opH - L.filter(e => e.kind === 'repair').reduce((a, e) => a + (+e.down || 0), 0) / 60) / fails : null,
    mttr: repDown.length ? repDown.reduce((a, b) => a + b, 0) / repDown.length : null,
    byP: cnt('p'),
    byC: cnt('c'),
  };
}
function mntTabRel(body) {
  const r = mntRelStats(MNT_PER);
  const fmtH = h => (h == null ? '—' : h >= 1000 ? Math.round(h).toLocaleString('en-IN') + ' h' : h.toFixed(0) + ' h');
  const bars = list => {
    const mx = list.length ? list[0][1] : 1;
    return list.length ? list.map(([k, n]) => `<div class="mnt-fb"><span>${esc(k)}</span><div class="mnt-bar"><i style="width:${(n / mx) * 100}%"></i></div><b>${n}</b></div>`).join('') : '<div class="note">No failure codes recorded in this period.</div>';
  };
  const kpi = (v, l, t, bad) => `<div class="mnt-k ${bad ? 'k-over' : ''}" title="${esc(t)}"><b>${v}</b><span>${l}</span></div>`;
  body.innerHTML = `<div class="mnt-flt"><div class="seg" id="mntPer">${[['m', 'This month'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['y', 'This financial year'], ['all', 'All']].map(([k, n]) => `<button data-per="${k}" class="${MNT_PER === k ? 'on' : ''}">${n}</button>`).join('')}</div><span class="note">Based on ${mntDoc().cfg.opHours} operating hours a day (Team &amp; alerts). Failures = service requests where the machine stopped.</span><button class="ib" id="mntPrRel">🖨 Print report</button></div>
 <div class="mnt-kpis mnt-ck">
  ${kpi(r.pmComp == null ? '—' : r.pmComp + '%', 'PM compliance', 'Planned jobs done on time ÷ (planned jobs done + tasks overdue now). Benchmark ≥ 90%', r.pmComp != null && r.pmComp < 90)}
  ${kpi(r.plannedPct == null ? '—' : r.plannedPct + '%', 'Planned work', 'Labour hours on planned work (PM, inspection, overhaul) ÷ all labour hours. Benchmark ≥ 80%', r.plannedPct != null && r.plannedPct < 80)}
  ${kpi(r.backlog, 'Backlog', 'Open work orders + overdue planned tasks', r.backlog > 10)}
  ${kpi(r.fails, 'Failures', 'Service requests where the machine stopped')}
  ${kpi(fmtH(r.mtbf), 'MTBF (loop)', 'Mean time between failures of the loop = operating hours − repair downtime, ÷ failures')}
  ${kpi(r.mttr == null ? '—' : Math.round(r.mttr) + ' min', 'MTTR', 'Mean time to repair = repair downtime ÷ repairs')}
  ${kpi(r.resp == null ? '—' : r.resp.toFixed(1) + ' h', 'Request → closed', 'Average time from service request to repair')}</div>
 <div class="mnt-cols"><div><h5 class="mnt-h5">Reliability by machine</h5>${r.rows.length ? `<table class="mnt-t"><thead><tr><th>Machine</th><th>Failures</th><th>Downtime</th><th>MTBF</th><th>MTTR</th><th>Availability</th></tr></thead><tbody>${r.rows.map(x => `<tr><td><b>${esc(B(x.id)?.name || '')}</b></td><td class="mono">${x.f}</td><td class="mono">${(x.down / 60).toFixed(1)} h</td><td class="mono">${fmtH(x.mtbf)}</td><td class="mono">${x.mttr == null ? '—' : Math.round(x.mttr) + ' min'}</td><td><div class="mnt-av"><div class="mnt-bar"><i style="width:${x.av}%;background:${x.av < 98 ? '#ec7a15' : '#1f9d55'}"></i></div><b>${x.av.toFixed(1)}%</b></div></td></tr>`).join('')}</tbody></table>` : '<div class="note">No failures or downtime recorded in this period.</div>'}</div>
 <div><h5 class="mnt-h5">Failures by problem</h5>${bars(r.byP)}<h5 class="mnt-h5">Failures by cause</h5>${bars(r.byC)}
 <div class="note" style="margin-top:8px">Repeated causes show where to act: e.g. “Lack of lubrication” → shorten the greasing interval; “Loose / not tightened” → add a torque check to the PM checklist.</div></div></div>`;
  $$('#mntPer [data-per]').forEach(x => (x.onclick = () => ((MNT_PER = x.dataset.per), mntRender())));
  $('#mntPrRel').onclick = () => mntPrint({ rel: 1 });
}

/* ---------- Printable work orders and reports (A4) ---------- */
function mntPrint(o) {
  const M = mntDoc();
  const head = (title, no, right) => `<header><div><div class="brand">Fountrix · Maintenance</div><h1>${title}</h1><div class="sub">${esc(DOC.name || '')}</div></div><div class="hr">${no ? `<div class="no">${esc(no)}</div>` : ''}${right || ''}<div class="pd">Printed ${mntFmtD(mntIso(), true)}</div></div></header>`;
  const assetBox = b => {
    const a = M.assets[b.id] || {};
    const h = mntHours(b.id);
    return `<table class="kv"><tr><th>Machine</th><td><b>${esc(b.name)}</b> — ${esc(b.props.desc || EQ[b.type].n)}</td><th>Criticality</th><td>${esc(a.crit ? MNT_CRIT[a.crit] : '—')}</td></tr>
    <tr><th>Make / model</th><td>${esc([a.make, a.model].filter(Boolean).join(' ') || '—')}</td><th>Serial no.</th><td>${esc(a.serial || '—')}</td></tr>
    <tr><th>Location</th><td>${esc(a.loc || '—')}</td><th>Running hours</th><td>${h ? Math.round(h.v).toLocaleString('en-IN') + ' h' : '—'}</td></tr></table>`;
  };
  const blankRows = (cols, n) => Array.from({ length: n }, () => `<tr>${cols.map(() => '<td>&nbsp;</td>').join('')}</tr>`).join('');
  const sign = `<div class="sign"><div>Done by<br><span></span>Name · signature · date / time</div><div>Checked by (in-charge)<br><span></span>Name · signature · date / time</div><div>Handed over to production<br><span></span>Name · signature · date / time</div></div>`;
  const loto = `<div class="safety">⚠ SAFETY — Inform production. Isolate and lock out all energy sources (electrical, hydraulic, pneumatic, gravity / stored sand) and verify zero energy before work. Use the PPE required for the area.</div>`;
  let html = '';
  if (o.plan) {
    const p = M.plans.find(q => q.id === o.plan),
      b = B(p.blk),
      s = mntState(p);
    html = `${head(`${MNT_KIND[p.kind]} work order`, '', `<div class="st">${MNT_STN[s.st]} · ${esc(s.text)}</div>`)}${assetBox(b)}
    <table class="kv"><tr><th>Task</th><td colspan="3"><b>${esc(p.task)}</b>${p.crit ? ' <span class="tag">SAFETY-CRITICAL</span>' : ''}</td></tr>
    <tr><th>Interval</th><td>${mntEvery(p)}</td><th>Last done</th><td>${mntFmtD(p.last)}${p.lastH != null && p.lastH !== '' ? ` · ${p.lastH} h` : ''}</td></tr>
    <tr><th>Due</th><td>${s.due ? mntFmtD(mntIso(s.due)) : '—'}</td><th>Responsible</th><td>${esc(p.who || '')}</td></tr></table>
    ${loto}<h2>Checklist</h2><table class="grid"><thead><tr><th style="width:28px">#</th><th>Step</th><th style="width:60px">Done</th><th style="width:30%">Remarks / measurement</th></tr></thead><tbody>${(p.steps && p.steps.length ? p.steps : [p.task]).map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t)}</td><td class="box">☐</td><td></td></tr>`).join('')}</tbody></table>`;
  } else if (o.entry) {
    const e = M.log.find(q => q.id === o.entry),
      b = B(e.blk);
    const isReq = e.kind === 'breakdown';
    const c = mntCostOf(e);
    const rep = isReq && e.closedBy ? M.log.find(q => q.id === e.closedBy) : null;
    const done = !isReq;
    html = `${head(isReq ? 'Service request — work order' : `${MNT_KIND[e.kind]} — work record`, e.no, `${e.prio ? `<div class="st">${esc(MNT_PRIO[e.prio])}</div>` : ''}<div class="st">Status: ${esc(e.status === 'cancelled' ? 'Cancelled' : MNT_WST[e.status] || 'Done')}</div>`)}${assetBox(b)}
    <table class="kv"><tr><th>${isReq ? 'Problem' : 'Work done'}</th><td colspan="3"><b>${esc(e.task)}</b></td></tr>
    <tr><th>${isReq ? 'Reported' : 'Done'}</th><td>${mntFmtD(e.date, true)} by ${esc(e.by || '')}</td><th>${isReq ? 'Production' : 'Downtime'}</th><td>${isReq ? (e.stop ? 'Machine stopped' : 'Machine running') : (e.down || 0) + ' min'}</td></tr>
    ${isReq ? `<tr><th>Assigned to</th><td>${esc(e.assign || '')}</td><th>Notes</th><td>${esc(e.notes || '')}</td></tr>` : `<tr><th>Failure</th><td>${esc(e.fail ? [e.fail.p, e.fail.c, e.fail.a].filter(Boolean).join(' · ') : '—')}</td><th>Notes</th><td>${esc(e.notes || '')}</td></tr>`}</table>
    ${isReq ? `${loto}${rep ? `<h2>Closed by ${esc(rep.no || '')}</h2><p>${esc(rep.task)} — ${mntFmtD(rep.date, true)} by ${esc(rep.by)} · ${rep.down || 0} min downtime · ${mntRs(mntCostOf(rep).tot)}</p>` : `<h2>Repair</h2><table class="grid"><thead><tr><th style="width:28%">Problem</th><th style="width:28%">Cause</th><th>Action taken</th></tr></thead><tbody>${blankRows([1, 2, 3], 2)}</tbody></table>`}` : ''}
    ${e.checks ? `<h2>Checklist</h2><table class="grid"><tbody>${e.checks.map((x, i) => `<tr><td style="width:28px">${i + 1}</td><td>${esc(x.t)}</td><td class="box" style="width:60px">${x.ok ? '☑' : '☐'}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>Parts and material</h2><table class="grid"><thead><tr><th>Part no.</th><th>Part</th><th style="width:70px">Qty</th><th style="width:90px">Unit cost</th><th style="width:100px">Amount</th></tr></thead><tbody>${done && (e.pused || []).length ? e.pused.map(u => `<tr><td>${esc(u.no || '')}</td><td>${esc(u.name)}</td><td>${u.qty} ${esc(u.unit || '')}</td><td>${mntRs(u.cost)}</td><td>${mntRs(u.qty * u.cost)}</td></tr>`).join('') + (e.parts ? `<tr><td></td><td colspan="4">${esc(e.parts)}</td></tr>` : '') : blankRows([1, 2, 3, 4, 5], 4)}</tbody></table>
    <h2>Labour and cost</h2><table class="grid"><thead><tr><th>Labour (man-hours)</th><th>Labour cost</th><th>Parts cost</th><th>Other expenses</th><th>Total</th></tr></thead><tbody>${done ? `<tr><td>${e.labHrs || 0} h × ${mntRs(e.rate)}</td><td>${mntRs(c.lab)}</td><td>${mntRs(c.parts)}</td><td>${mntRs(c.other)}</td><td><b>${mntRs(c.tot)}</b></td></tr>` : blankRows([1, 2, 3, 4, 5], 1)}</tbody></table>`;
  } else if (o.due) {
    const { due, open } = mntDueList();
    const d2 = due.filter(x => !o.blk || x.p.blk === o.blk),
      o2 = open.filter(e => !o.blk || e.blk === o.blk);
    html = `${head('Maintenance schedule — work due', '', `<div class="st">${o2.length} open requests · ${d2.length} planned tasks</div>`)}
    ${o2.length ? `<h2>Open service requests</h2><table class="grid"><thead><tr><th>WO no.</th><th>Pri.</th><th>Machine</th><th>Problem</th><th>Reported</th><th>Status</th><th>Assigned</th><th style="width:70px">Done ☐</th></tr></thead><tbody>${o2.map(e => `<tr><td>${esc(e.no || '')}</td><td>${esc(e.prio || '')}</td><td><b>${esc(B(e.blk)?.name || '')}</b></td><td>${esc(e.task)}</td><td>${mntFmtD(e.date, true)}</td><td>${esc(MNT_WST[e.status] || '')}</td><td>${esc(e.assign || '')}</td><td class="box">☐</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>Planned work due</h2><table class="grid"><thead><tr><th>Status</th><th>Machine</th><th>Task</th><th>Type</th><th>When</th><th>Responsible</th><th style="width:70px">Done ☐</th></tr></thead><tbody>${d2.map(({ p, s, b }) => `<tr><td>${MNT_STN[s.st]}</td><td><b>${esc(b.name)}</b></td><td>${esc(p.task)}${p.crit ? ' <span class="tag">SAFETY</span>' : ''}</td><td>${MNT_KS[p.kind]}</td><td>${esc(s.text)}</td><td>${esc(p.who || '')}</td><td class="box">☐</td></tr>`).join('') || '<tr><td colspan="7">Nothing due.</td></tr>'}</tbody></table>`;
  } else if (o.rel) {
    const r = mntRelStats(MNT_PER);
    html = `${head('Maintenance reliability report', '', `<div class="st">${{ m: 'This month', 30: 'Last 30 days', 90: 'Last 90 days', y: 'This financial year', all: 'All records' }[MNT_PER]}</div>`)}
    <table class="kv"><tr><th>PM compliance</th><td>${r.pmComp ?? '—'}%</td><th>Planned work</th><td>${r.plannedPct ?? '—'}%</td></tr><tr><th>Failures</th><td>${r.fails}</td><th>Backlog</th><td>${r.backlog}</td></tr><tr><th>MTBF (loop)</th><td>${r.mtbf ? Math.round(r.mtbf).toLocaleString('en-IN') + ' h' : '—'}</td><th>MTTR</th><td>${r.mttr ? Math.round(r.mttr) + ' min' : '—'}</td></tr></table>
    <h2>By machine</h2><table class="grid"><thead><tr><th>Machine</th><th>Failures</th><th>Downtime</th><th>MTBF</th><th>MTTR</th><th>Availability</th></tr></thead><tbody>${r.rows.map(x => `<tr><td>${esc(B(x.id)?.name || '')}</td><td>${x.f}</td><td>${(x.down / 60).toFixed(1)} h</td><td>${x.mtbf ? Math.round(x.mtbf) + ' h' : '—'}</td><td>${x.mttr ? Math.round(x.mttr) + ' min' : '—'}</td><td>${x.av.toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="6">No failures.</td></tr>'}</tbody></table>
    <h2>Failure causes</h2><table class="grid"><tbody>${r.byC.map(([k, n]) => `<tr><td>${esc(k)}</td><td style="width:80px">${n}</td></tr>`).join('') || '<tr><td>None recorded.</td></tr>'}</tbody></table>`;
  }
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${o.entry ? esc(M.log.find(q => q.id === o.entry)?.no || 'Work order') : 'Maintenance'} — ${esc(DOC.name || '')}</title><style>
  @page{size:A4;margin:12mm}body{font:11pt/1.35 Inter,Segoe UI,Arial,sans-serif;color:#111;margin:0}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0e2d5c;padding-bottom:6px;margin-bottom:10px}
  .brand{font-size:9pt;letter-spacing:.12em;text-transform:uppercase;color:#0e2d5c;font-weight:700}h1{font-size:17pt;margin:2px 0;color:#0e2d5c}.sub{color:#555}
  .hr{text-align:right}.no{font:700 15pt monospace;border:2px solid #0e2d5c;padding:3px 10px;border-radius:4px;display:inline-block}.st{margin-top:4px;font-weight:600}.pd{color:#666;font-size:9pt;margin-top:4px}
  h2{font-size:11.5pt;margin:12px 0 4px;color:#0e2d5c;text-transform:uppercase;letter-spacing:.06em}
  table{width:100%;border-collapse:collapse;margin-bottom:6px}.kv th{width:16%;text-align:left;background:#eef2f7;font-weight:600}.kv th,.kv td,.grid th,.grid td{border:1px solid #9aa6b8;padding:4px 6px;vertical-align:top}
  .grid th{background:#eef2f7;text-align:left}.grid td{height:20px}.box{text-align:center;font-size:13pt}
  .tag{background:#b91c1c;color:#fff;font-size:8pt;font-weight:700;padding:1px 5px;border-radius:3px}
  .safety{border:2px solid #b91c1c;background:#fff1f1;padding:6px 8px;margin:8px 0;font-weight:600;font-size:10pt}
  .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:22px;font-size:9.5pt;color:#333}.sign span{display:block;border-bottom:1px solid #333;height:34px;margin-bottom:3px}
  footer{margin-top:14px;font-size:8.5pt;color:#777;border-top:1px solid #ccc;padding-top:4px}
  </style>${html}${o.plan || o.entry ? `<h2>Findings / notes</h2><table class="grid"><tbody>${blankRows([1], 3)}</tbody></table>${sign}` : ''}<footer>Fountrix Digital Loop · Maintenance module · ${esc(DOC.name || '')}</footer><script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}


function mntTabCost(body) {
  const M = mntDoc(),
    now = new Date();
  const from = MNT_PER === 'm' ? new Date(now.getFullYear(), now.getMonth(), 1) : MNT_PER === 'y' ? new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1) : MNT_PER === 'all' ? new Date(0) : new Date(Date.now() - +MNT_PER * 864e5);
  const L = M.log.filter(e => e.status !== 'cancelled' && mntDate(e.date) >= from && e.kind !== 'breakdown');
  const sum = f => L.reduce((a, e) => a + f(e), 0);
  const c = { lab: sum(e => mntCostOf(e).lab), parts: sum(e => mntCostOf(e).parts), other: sum(e => mntCostOf(e).other) };
  c.tot = c.lab + c.parts + c.other;
  const byK = {};
  L.forEach(e => (byK[e.kind] = (byK[e.kind] || 0) + mntCostOf(e).tot));
  const planned = (byK.pm || 0) + (byK.insp || 0) + (byK.ovh || 0),
    unplanned = byK.repair || 0;
  const byM = {};
  L.forEach(e => {
    const o = (byM[e.blk] = byM[e.blk] || { tot: 0, down: 0, n: 0, rep: 0 });
    o.tot += mntCostOf(e).tot;
    o.down += +e.down || 0;
    o.n++;
    if (e.kind === 'repair') o.rep += mntCostOf(e).tot;
  });
  const top = Object.entries(byM).sort((a, b) => b[1].tot - a[1].tot);
  const mx = top.length ? top[0][1].tot || 1 : 1;
  // month by month (last 6 months)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d0 = new Date(now.getFullYear(), now.getMonth() - i, 1),
      d1 = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const LL = M.log.filter(e => e.status !== 'cancelled' && mntDate(e.date) >= d0 && mntDate(e.date) < d1);
    const pl = LL.filter(e => e.kind !== 'repair').reduce((a, e) => a + mntCostOf(e).tot, 0),
      un = LL.filter(e => e.kind === 'repair').reduce((a, e) => a + mntCostOf(e).tot, 0);
    months.push({ n: d0.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), pl, un });
  }
  const mm = Math.max(1, ...months.map(m => m.pl + m.un));
  const bud = +M.cfg.budget || 0;
  const thisM = months[5].pl + months[5].un;
  body.innerHTML = `<div class="mnt-flt"><div class="seg" id="mntPer">${[['m', 'This month'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['y', 'This financial year'], ['all', 'All']].map(([k, n]) => `<button data-per="${k}" class="${MNT_PER === k ? 'on' : ''}">${n}</button>`).join('')}</div><button class="ib" id="mntCostCsv">Export for accounts (CSV)</button></div>
 <div class="mnt-kpis mnt-ck">
  <div class="mnt-k"><b>${mntRs(c.tot)}</b><span>Total maintenance spend</span></div>
  <div class="mnt-k"><b>${mntRs(c.lab)}</b><span>Labour</span></div>
  <div class="mnt-k"><b>${mntRs(c.parts)}</b><span>Spare parts</span></div>
  <div class="mnt-k"><b>${mntRs(c.other)}</b><span>Other (contractor, service)</span></div>
  <div class="mnt-k ${unplanned > planned ? 'k-over' : ''}"><b>${c.tot ? Math.round((planned / c.tot) * 100) : 0}% / ${c.tot ? Math.round((unplanned / c.tot) * 100) : 0}%</b><span>Planned / breakdown repair</span></div>
  ${bud ? `<div class="mnt-k ${thisM > bud ? 'k-over' : ''}"><b>${Math.round((thisM / bud) * 100)}%</b><span>of monthly budget ${mntRs(bud)} used</span></div>` : ''}</div>
 <div class="mnt-cols"><div><h5 class="mnt-h5">Spend by machine</h5>${top.length ? `<table class="mnt-t"><thead><tr><th>Machine</th><th>Spend</th><th></th><th>Jobs</th><th>Breakdown repairs</th><th>Downtime</th></tr></thead><tbody>${top.map(([id, o]) => `<tr><td><b>${esc(B(id)?.name || '(removed)')}</b></td><td class="mono">${mntRs(o.tot)}</td><td style="width:34%"><div class="mnt-bar"><i style="width:${((o.tot / mx) * 100).toFixed(1)}%"></i><i class="u" style="width:${((o.rep / mx) * 100).toFixed(1)}%"></i></div></td><td class="mono">${o.n}</td><td class="mono">${o.rep ? mntRs(o.rep) : ''}</td><td class="mono">${o.down ? (o.down / 60).toFixed(1) + ' h' : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="note">No costs recorded in this period.</div>'}</div>
 <div><h5 class="mnt-h5">Month by month</h5><div class="mnt-months">${months.map(m => `<div class="mnt-mo"><div class="mnt-mob" title="${m.n}: planned ${mntRs(m.pl)}, breakdown repair ${mntRs(m.un)}"><i class="u" style="height:${((m.un / mm) * 100).toFixed(1)}%"></i><i style="height:${((m.pl / mm) * 100).toFixed(1)}%"></i></div><b>${mntRs(m.pl + m.un)}</b><span>${m.n}</span></div>`).join('')}</div>
 <div class="mnt-leg"><span><i></i>Planned (PM, inspection, overhaul)</span><span><i class="u"></i>Breakdown repairs</span></div>
 <h5 class="mnt-h5">By type of work</h5><table class="mnt-t"><tbody>${['pm', 'insp', 'ovh', 'repair'].map(k => `<tr><td>${mntKindChip(k)} ${MNT_KIND[k]}</td><td class="mono" style="text-align:right">${mntRs(byK[k] || 0)}</td></tr>`).join('')}</tbody></table></div></div>`;
  $$('#mntPer [data-per]').forEach(x => (x.onclick = () => ((MNT_PER = x.dataset.per), mntRender())));
  $('#mntCostCsv').onclick = () => {
    const rows = [['Date', 'Machine', 'Type', 'Planned / unplanned', 'Task', 'Done by', 'Labour (man-h)', 'Labour cost', 'Parts cost', 'Other expenses', 'Total cost', 'Downtime (min)']];
    L.forEach(e => {
      const cc = mntCostOf(e);
      rows.push([e.date.slice(0, 10), B(e.blk)?.name || '', MNT_KIND[e.kind], e.kind === 'repair' ? 'Unplanned' : 'Planned', e.task, e.by, e.labHrs || 0, Math.round(cc.lab), Math.round(cc.parts), Math.round(cc.other), Math.round(cc.tot), e.down || 0]);
    });
    mntCsvRows(rows, 'Maintenance_costs');
  };
}
function mntCsvRows(rows, name) {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_${(DOC.name || 'loop').replace(/\W+/g, '_')}_${mntIso().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 500);
  toast('Exported');
}

/* ================= Log work / report a problem / close repair / cancel entry =================
 * opts: {kind, blk} | {plan} (mark a planned task done) | {wo} (close a breakdown with a repair) | {cancel} (cancel an entry)
 * host: element to draw into (phone card) — otherwise the Maintenance window */
function mntForm(opts, host) {
  const M = mntDoc();
  const inWin = !host;
  if (inWin && !$('#mntW')) mntWindow();
  const box = host || $('#mntBody');
  if (!M.team.length) {
    box.innerHTML = `<div class="mnt-form"><h5>Maintenance team needed</h5><p class="note">Only the maintenance team can log work. Add the team and their PINs first${inWin ? ' under <b>Team &amp; alerts</b>' : ' on the control-room computer (Maintenance › Team &amp; alerts)'}.</p><div class="mact" style="justify-content:flex-start">${inWin ? '<button class="ib pri" id="mfTeam">Open Team &amp; alerts</button>' : ''}<button class="ib" id="mfX">Back</button></div></div>`;
    const t = $('#mfTeam');
    if (t) t.onclick = () => ((MNT_TAB = 'set'), mntRender());
    $('#mfX').onclick = () => (inWin ? mntRender() : host.onclose && host.onclose());
    return;
  }
  const plan = opts.plan && M.plans.find(p => p.id === opts.plan);
  const wo = opts.wo && M.log.find(e => e.id === opts.wo);
  const cx = opts.cancel && M.log.find(e => e.id === opts.cancel);
  const blk = plan ? plan.blk : wo ? wo.blk : cx ? cx.blk : opts.blk || MNT_F.blk || mntEquip()[0]?.id;
  let kind = plan ? plan.kind : wo ? 'repair' : opts.kind || 'pm';
  const who = `<div class="fld"><label>Your name</label><select id="mfBy">${M.team.map(t => `<option value="${t.id}">${esc(t.name)}${t.role ? ` — ${esc(t.role)}` : ''}</option>`).join('')}</select></div>
  <div class="fld"><label>Your PIN</label><input id="mfPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div>`;
  const back = () => (inWin ? mntRender() : host.onclose && host.onclose());
  const auth = () => {
    const t = M.team.find(q => q.id === $('#mfBy').value);
    if (!t || t.pin !== mntHash($('#mfPin').value.trim())) {
      toast('Wrong PIN — only the maintenance team can log work');
      $('#mfPin').value = '';
      $('#mfPin').focus();
      return null;
    }
    return t;
  };
  const up = opts.upd && M.log.find(e => e.id === opts.upd);
  if (up) {
    box.innerHTML = `<div class="mnt-form"><h5>Update work order ${esc(up.no || '')}</h5><p class="note">${esc(B(up.blk)?.name || '')} · ${esc(up.task)} — reported ${mntFmtD(up.date, true)} by ${esc(up.by)}</p>
   ${(up.hist || []).length ? `<div class="mnt-hist">${up.hist.map(h => `<div><span class="mono">${mntFmtD(h.t, true)}</span> ${esc(h.by)} — <b>${esc(MNT_WST[h.st] || h.st)}</b>${h.assign ? ` → ${esc(h.assign)}` : ''}${h.note ? ` · ${esc(h.note)}` : ''}</div>`).join('')}</div>` : ''}
   <div class="mnt-g"><div class="fld"><label>Status</label><select id="muSt">${['open', 'assigned', 'progress', 'hold'].map(k => `<option value="${k}" ${up.status === k ? 'selected' : ''}>${MNT_WST[k]}</option>`).join('')}</select></div>
   <div class="fld"><label>Priority</label><select id="muPr">${Object.entries(MNT_PRIO).map(([k, v]) => `<option value="${k}" ${up.prio === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
   <div class="fld"><label>Assigned to</label><select id="muAs"><option value="">—</option>${M.team.map(t => `<option ${up.assign === t.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
   <div class="fld"><label>Note</label><input id="muN" placeholder="e.g. waiting for bearing from store"></div>${who}</div>
   <div class="mact" style="justify-content:flex-start"><button class="ib pri" id="mfS">Update</button><button class="ib" id="mfX">Back</button></div><div class="note">To finish the job use <b>Close with repair</b> — it records the work, failure codes, parts and cost.</div></div>`;
    $('#mfX').onclick = back;
    $('#mfS').onclick = () => {
      const t = auth();
      if (!t) return;
      const st = $('#muSt').value,
        as = $('#muAs').value;
      Object.assign(up, { status: st === 'open' && as ? 'assigned' : st, prio: $('#muPr').value, assign: as });
      (up.hist = up.hist || []).push({ t: mntIso(), by: t.name, st: up.status, assign: as, note: $('#muN').value.trim() });
      logEv(`${up.no || 'Work order'} ${MNT_WST[up.status]} by ${t.name}: ${B(up.blk)?.name} — ${up.task}`);
      save();
      mntCheck();
      toast(`${up.no || 'Work order'} — ${MNT_WST[up.status]}`);
      back();
    };
    return;
  }
  if (cx) {
    box.innerHTML = `<div class="mnt-form"><h5>Cancel a log entry</h5><p class="note">${mntFmtD(cx.date, true)} · ${esc(B(cx.blk)?.name || '')} · ${esc(cx.task)}. The entry stays in the log marked as cancelled.</p>
   <div class="mnt-g"><div class="fld" style="grid-column:span 2"><label>Reason</label><input id="mfWhy" placeholder="e.g. Entered on the wrong machine"></div>${who}</div>
   <div class="mact" style="justify-content:flex-start"><button class="ib pri" id="mfS">Cancel entry</button><button class="ib" id="mfX">Back</button></div></div>`;
    $('#mfX').onclick = back;
    $('#mfS').onclick = () => {
      const why = $('#mfWhy').value.trim();
      if (!why) return toast('Enter the reason');
      const t = auth();
      if (!t) return;
      Object.assign(cx, { status: 'cancelled', cxBy: t.name, cxWhy: why, cxAt: mntIso() });
      // parts go back to the store
      (cx.pused || []).forEach(u => {
        const pt = M.parts.find(q => q.id === u.id);
        if (pt) pt.stock = Math.round((+pt.stock + u.qty) * 1000) / 1000;
      });
      if (cx.kind === 'repair' && cx.wo) {
        const w = M.log.find(e => e.id === cx.wo);
        if (w) Object.assign(w, { status: 'open', closed: null, closedBy: null });
      }
      logEv(`Maintenance entry cancelled by ${t.name}: ${B(cx.blk)?.name} — ${cx.task}`);
      save();
      mntCheck();
      toast('Entry cancelled');
      back();
    };
    return;
  }
  const isBd = kind === 'breakdown';
  const tasks = M.plans.filter(p => p.blk === blk && !p.paused);
  const h = mntHours(blk);
  const title = plan ? 'Mark planned work done' : wo ? 'Close the service request with a repair' : isBd ? 'Service request — report a problem' : 'Log maintenance work';
  box.innerHTML = `<div class="mnt-form"><h5>${title}</h5>${wo ? `<p class="note">Service request: <b>${esc(wo.task)}</b> — reported ${mntFmtD(wo.date, true)} by ${esc(wo.by)}</p>` : ''}
 <div class="mnt-g">
  <div class="fld" style="grid-column:span 2"><label>Machine</label><select id="mfB" ${plan || wo ? 'disabled' : ''}>${mntEqOpts(blk)}</select></div>
  ${plan || wo || isBd ? '' : `<div class="fld"><label>Type of work</label><select id="mfK">${['pm', 'insp', 'ovh', 'repair'].map(k => `<option value="${k}" ${kind === k ? 'selected' : ''}>${MNT_KIND[k]}</option>`).join('')}</select></div>`}
  ${isBd ? `<div class="fld" style="grid-column:span 2"><label>What is wrong?</label><input id="mfT" placeholder="e.g. Belt slipping, abnormal noise, oil leak"></div>
   <div class="fld"><label>Production</label><select id="mfStop"><option value="0">Machine still running</option><option value="1">Machine stopped</option></select></div>
   <div class="fld"><label>Priority</label><select id="mfPr">${Object.entries(MNT_PRIO).map(([k, v]) => `<option value="${k}" ${k === 'P3' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
   <div class="fld"><label>Assign to (optional)</label><select id="mfAs"><option value="">—</option>${M.team.map(t => `<option>${esc(t.name)}</option>`).join('')}</select></div>` : plan ? `<div class="fld" style="grid-column:span 2"><label>Task</label><input value="${esc(plan.task)}" disabled></div>` : `<div class="fld" style="grid-column:span 2"><label>Task / work done</label><input id="mfT" list="mfTL" value="${wo ? 'Repair: ' + esc(wo.task) : ''}" placeholder="pick a planned task or type"><datalist id="mfTL">${tasks.map(p => `<option value="${esc(p.task)}">`).join('')}</datalist></div>`}
  <div class="fld"><label>${isBd ? 'Noticed at' : 'Done at'}</label><input id="mfD" type="datetime-local" value="${mntIso()}"></div>
  ${isBd ? '' : `<div class="fld"><label>Running hours (meter)</label><input id="mfH" type="number" min="0" step="any" placeholder="${h ? 'last ' + Math.round(h.v) : 'optional'}" value="${h && h.live ? Math.round(h.v) : ''}"></div>
  <div class="fld"><label>Machine downtime (min)</label><input id="mfDn" type="number" min="0" value="${wo && wo.stop ? Math.max(0, Math.round((Date.now() - mntDate(wo.date)) / 6e4)) : 0}"></div>
  <div class="fld"><label>Labour (man-hours)</label><input id="mfLab" type="number" min="0" step="0.25" placeholder="e.g. 2 people × 1.5 h = 3"></div>
  <div class="mnt-pu" style="grid-column:1/-1"><label>Parts from the store</label><div id="mfPU"></div>
   <div class="mnt-pu-add"><select id="mfPart"><option value="">${M.parts.length ? 'Pick a spare part…' : 'No parts in the store yet (Spare parts tab)'}</option>${M.parts.map(pt => `<option value="${pt.id}">${esc(pt.name)}${pt.no ? ` · ${esc(pt.no)}` : ''} — ${mntRs(pt.cost)}/${esc(pt.unit || 'pc')} · ${+pt.stock} in stock</option>`).join('')}</select><input id="mfQ" type="number" min="0" step="any" value="1"><button class="ib" id="mfPA" type="button">Add part</button></div></div>
  <div class="fld" style="grid-column:span 2"><label>Other material (not in the store)</label><input id="mfP" placeholder="optional"></div>
  <div class="fld"><label>Other expenses ₹ (contractor, service, hire)</label><input id="mfO" type="number" min="0" step="any" placeholder="0"></div>
  <div class="fld mnt-tot"><label>Cost of this job</label><div id="mfTot">₹0</div></div>`}
  ${isBd ? '' : `<div class="mnt-fail" id="mfFail" style="grid-column:1/-1;${wo || kind === 'repair' ? '' : 'display:none'}"><label>Failure analysis (for repairs)</label><div class="mnt-g3"><div class="fld"><label>Problem</label><select id="mfFp"><option value="">—</option>${MNT_FAIL.p.map(x => `<option>${x}</option>`).join('')}</select></div><div class="fld"><label>Cause</label><select id="mfFc"><option value="">—</option>${MNT_FAIL.c.map(x => `<option>${x}</option>`).join('')}</select></div><div class="fld"><label>Action taken</label><select id="mfFa"><option value="">—</option>${MNT_FAIL.a.map(x => `<option>${x}</option>`).join('')}</select></div></div></div>`}
  ${plan && (plan.steps || []).length ? `<div class="mnt-chk" style="grid-column:1/-1"><label>Checklist</label>${plan.steps.map((t, i) => `<label class="mnt-cb"><input type="checkbox" data-chk="${i}"> ${esc(t)}</label>`).join('')}</div>` : ''}
  <div class="fld" style="grid-column:span 2"><label>Notes</label><input id="mfN" placeholder="${isBd ? 'optional — sound, smell, where exactly' : 'findings, condition, follow-up'}"></div>
  ${who}
 </div>
 <div class="mact" style="justify-content:flex-start"><button class="ib pri" id="mfS">${isBd ? 'Report' : 'Save to log'}</button><button class="ib" id="mfX">Back</button></div></div>`;
  $('#mfX').onclick = back;
  if ($('#mfK')) $('#mfK').onchange = () => ($('#mfFail').style.display = $('#mfK').value === 'repair' ? '' : 'none');
  if ($('#mfStop')) $('#mfStop').onchange = () => $('#mfStop').value === '1' && $('#mfPr').value === 'P3' && ($('#mfPr').value = 'P2');
  // parts picked from the store + live cost total
  const pu = [];
  const tot = () => {
    if (!$('#mfTot')) return;
    const c = mntCostOf({ labHrs: +$('#mfLab').value || 0, rate: M.cfg.rate, pused: pu, other: +$('#mfO').value || 0 });
    $('#mfTot').innerHTML = `<b>${mntRs(c.tot)}</b> <span class="note">labour ${mntRs(c.lab)} (${mntRs(M.cfg.rate)}/h) · parts ${mntRs(c.parts)} · other ${mntRs(c.other)}</span>`;
  };
  const drawPU = () => {
    $('#mfPU').innerHTML = pu.map((u, i) => `<div class="mnt-pu-r"><b>${esc(u.name)}</b> × ${u.qty} ${esc(u.unit || '')} <span class="note">@ ${mntRs(u.cost)}</span> <span class="mono">${mntRs(u.qty * u.cost)}</span><button class="lb" data-pur="${i}" type="button">✕</button></div>`).join('');
    $$('#mfPU [data-pur]').forEach(x => (x.onclick = () => (pu.splice(+x.dataset.pur, 1), drawPU())));
    tot();
  };
  if ($('#mfPA')) {
    $('#mfPA').onclick = () => {
      const pt = M.parts.find(q => q.id === $('#mfPart').value),
        q = +$('#mfQ').value;
      if (!pt) return toast('Pick a part');
      if (!(q > 0)) return toast('Enter the quantity');
      const have = pu.filter(u => u.id === pt.id).reduce((a, u) => a + u.qty, 0);
      if (have + q > +pt.stock) toast(`Only ${+pt.stock} ${pt.unit || ''} of ${pt.name} in stock — saved anyway, check the store`);
      pu.push({ id: pt.id, name: pt.name, no: pt.no || '', unit: pt.unit || '', qty: q, cost: +pt.cost || 0 });
      $('#mfPart').value = '';
      $('#mfQ').value = 1;
      drawPU();
    };
    ['#mfLab', '#mfO'].forEach(id => ($(id).oninput = tot));
    tot();
  }
  $('#mfS').onclick = () => {
    const b2 = plan ? plan.blk : wo ? wo.blk : $('#mfB').value;
    const task = plan ? plan.task : ($('#mfT').value || '').trim();
    if (!task) return toast(isBd ? 'Describe the problem' : 'Enter the work done');
    const d = $('#mfD').value || mntIso();
    if (mntDate(d) > Date.now() + 6e4) return toast('The time cannot be in the future');
    const t = auth();
    if (!t) return;
    const k2 = plan ? plan.kind : wo ? 'repair' : isBd ? 'breakdown' : $('#mfK').value;
    const e = { id: mntId('w'), blk: b2, kind: k2, task, date: d, by: t.name, notes: $('#mfN').value.trim() };
    e.no = mntWoNo(d);
    if (isBd) {
      const as = $('#mfAs').value;
      Object.assign(e, { status: as ? 'assigned' : 'open', stop: $('#mfStop').value === '1', prio: $('#mfPr').value, assign: as, hist: [{ t: mntIso(), by: t.name, st: as ? 'assigned' : 'open', assign: as, note: 'Reported' }] });
    }
    else {
      const hv = $('#mfH').value;
      Object.assign(e, { status: 'done', hours: hv === '' ? null : +hv, down: +$('#mfDn').value || 0, parts: $('#mfP').value.trim(), labHrs: +$('#mfLab').value || 0, rate: M.cfg.rate, pused: pu.slice(), other: +$('#mfO').value || 0 });
      e.cost = Math.round(mntCostOf(e).tot);
      if (k2 === 'repair' && $('#mfFp')) {
        const fl = { p: $('#mfFp').value, c: $('#mfFc').value, a: $('#mfFa').value };
        if (fl.p || fl.c || fl.a) e.fail = fl;
      }
      const ck = $$('[data-chk]');
      if (ck.length) e.checks = ck.map(x => ({ t: plan.steps[+x.dataset.chk], ok: x.checked }));
      // parts leave the store
      pu.forEach(u => {
        const pt = M.parts.find(q => q.id === u.id);
        if (pt) pt.stock = Math.round((+pt.stock - u.qty) * 1000) / 1000;
      });
    }
    // link to a planned task (marked done, or picked by name) and remember whether it was late
    const p = plan || (!isBd && !wo ? tasks.find(q => q.task.toLowerCase() === task.toLowerCase()) : null);
    if (p) {
      const s = mntState(p);
      e.plan = p.id;
      if (s.st === 'over') e.late = Math.max(1, Math.ceil(-(s.dl != null ? s.dl : s.hl / 16)));
      p.last = d.slice(0, 10);
      if (e.hours != null) p.lastH = e.hours;
      else {
        const hh = mntHours(b2);
        if (p.hours && hh) p.lastH = Math.round(hh.v);
      }
    }
    if (wo) {
      Object.assign(wo, { status: 'closed', closed: d, closedBy: e.id });
      (wo.hist = wo.hist || []).push({ t: mntIso(), by: t.name, st: 'closed', note: `${e.no} ${task}` });
      e.wo = wo.id;
    }
    M.log.push(e);
    logEv(`${MNT_KIND[k2]} logged by ${t.name}: ${B(b2)?.name} — ${task}`, isBd ? 2 : 0);
    save();
    mntCheck();
    if (typeof renderDock === 'function') renderDock(true);
    toast(isBd ? 'Service request sent — the control room sees it in Alerts' : wo ? 'Repair logged — service request closed' : 'Work saved to the log');
    back();
  };
}

/* ================= Equipment-wise view + machine QR ================= */
function mntQrBlock(b) {
  const u = mcUrl(b),
    based = DOC.plant && DOC.plant.cardBase;
  return `<div class="mnt-qr"><div class="mnt-qr-c">${typeof mcQr === 'function' ? mcQr(u, 3) : ''}</div><div class="mnt-qr-t"><b>Machine QR — ${esc(b.name)}</b><div class="note">Scan on the shop floor: live readings, alarms, maintenance due, open requests, last work and SOP — with Log work / Service request.</div><div class="mono mnt-qr-u">${esc(u)}</div>${based ? '' : '<div class="mnt-warn">Set the address the phones open (View › Machine QR) before printing — this file’s own address works only on this computer.</div>'}<div class="mnt-qr-b"><button class="sb" data-qrp="${b.id}">🖨 Print sticker</button><button class="sb" data-qro="${b.id}">Open card</button></div></div></div>`;
}
function mntBindQr(root) {
  root.querySelectorAll('[data-qrp]').forEach(x => (x.onclick = () => mntPrintStickers([B(x.dataset.qrp)])));
  root.querySelectorAll('[data-qro]').forEach(
    x =>
      (x.onclick = () => {
        closeModal();
        mcOpen(B(x.dataset.qro).name);
      }),
  );
}
/* printable stickers (one or many): QR + tag + description + asset identity */
function mntPrintStickers(list, base) {
  const M = mntDoc();
  const b0 = base || mcBase();
  const st = list
    .filter(Boolean)
    .map(b => {
      const a = M.assets[b.id] || {};
      const u = mcUrl(b, b0);
      const id = [[a.make, a.model].filter(Boolean).join(' '), a.serial && 'S/N ' + a.serial].filter(Boolean).join(' · ');
      return `<div class="s"><div class="h"><span class="n">${esc(b.name)}</span>${a.crit ? `<span class="c c${esc(a.crit)}">${esc(a.crit)}</span>` : ''}</div><div class="q">${mcQr(u, 4)}</div><div class="d">${esc(b.props.desc || EQ[b.type].n)}</div>${id ? `<div class="a">${esc(id)}</div>` : ''}<div class="k">Scan: live readings · alarms · maintenance</div><div class="f">Fountrix · ${esc(DOC.name || '')}</div></div>`;
    })
    .join('');
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print the stickers');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Machine QR stickers — ${esc(DOC.name || '')}</title><style>@page{size:A4;margin:10mm}body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}
  .s{border:2px solid #0e2d5c;border-radius:4mm;padding:4mm;text-align:center;break-inside:avoid}.h{display:flex;justify-content:center;align-items:center;gap:6px}.n{font-weight:800;font-size:18pt;color:#0e2d5c}
  .c{display:inline-block;width:7mm;height:7mm;line-height:7mm;border-radius:1.5mm;color:#fff;font-weight:800;font-size:10pt}.cA{background:#b91c1c}.cB{background:#c2410c}.cC{background:#0f7a5a}
  .q svg{width:44mm;height:44mm}.d{font-size:9.5pt;color:#334155}.a{font-size:8.5pt;color:#475569;margin-top:1mm}.k{font-size:8pt;color:#1f6feb;margin-top:1.5mm;font-weight:600}.f{font-size:7pt;color:#94a3b8;margin-top:1mm}</style><div class="g">${st}</div><script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}
function mntTabEquip(body) {
  const M = mntDoc();
  const eq = mntEquip();
  const sel = B(MNT_F.blk) && eq.includes(B(MNT_F.blk)) ? B(MNT_F.blk) : eq[0];
  const stat = b => {
    const ps = M.plans.filter(p => p.blk === b.id).map(mntState);
    return { over: ps.filter(s => s.st === 'over').length, soon: ps.filter(s => s.st === 'soon').length, wo: mntOpenWO(b.id).length, n: ps.length };
  };
  const q = (MNT_F.q || '').toLowerCase();
  const list = eq
    .filter(b => !q || (b.name + ' ' + (b.props.desc || '') + ' ' + EQ[b.type].n).toLowerCase().includes(q))
    .map(b => {
      const s = stat(b);
      const dot = s.wo || s.over ? 'over' : s.soon ? 'soon' : s.n ? 'ok' : 'none';
      return `<button class="mnt-el ${b === sel ? 'on' : ''}" data-eq="${b.id}"><i class="mnt-dot mnt-dot-${dot}"></i><span><b>${esc(b.name)}</b><small>${esc(b.props.desc || EQ[b.type].n)}</small></span>${s.wo ? `<em class="mnt-st mnt-over">${s.wo} req</em>` : ''}${s.over ? `<em class="mnt-st mnt-over">${s.over}</em>` : s.soon ? `<em class="mnt-st mnt-soon">${s.soon}</em>` : ''}</button>`;
    })
    .join('');
  let det = '';
  if (sel) {
    const E = EQ[sel.type] || {};
    const run = typeof effRun === 'function' ? effRun(sel) : true;
    const tags = sel.tags.filter(t => REG[t.id]);
    const k = mntKpi(sel.id);
    const rel = mntRelStats('90').rows.find(r => r.id === sel.id);
    det = `<div class="mnt-eqd-h"><div><div class="mnt-eqd-n">${esc(sel.name)} <span class="mc-st ${run ? 'on' : ''}">${run ? 'RUNNING' : 'STOPPED'}</span></div><div class="note">${esc(sel.props.desc || E.n || '')}</div></div>
      <div class="mnt-pacts" style="margin:0"><button class="ib pri" id="eqLog">+ Log work</button><button class="ib" id="eqRep">⚠ Service request</button><button class="ib" id="eqPlan">Edit plan</button><button class="ib" id="eqAsset">Asset details</button></div></div>
     <div class="mnt-eqd-g"><div>${typeof mntLifeHtml === 'function' && mntHas() ? mntLifeHtml(sel) : ''}${mntQrBlock(sel)}
      <div class="mnt-sub">Live readings</div>${tags.length ? `<div class="mnt-live">${tags.map(bt => `<div class="mcs${tagSev(bt.id)}"><span>${esc(REG[bt.id].desc || bt.id)}</span><b data-live="${esc(bt.id)}">${esc(tagTxt(bt.id))}</b></div>`).join('')}</div>` : '<div class="note">No readings on this machine.</div>'}
      <div class="mnt-sub">Last 30 days</div><div class="mnt-kpis mnt-kmini"><div class="mnt-k"><b>${k.jobs}</b><span>Jobs</span></div><div class="mnt-k"><b>${k.bd}</b><span>Requests</span></div><div class="mnt-k"><b>${(k.down / 60).toFixed(1)} h</b><span>Downtime</span></div><div class="mnt-k"><b>${mntRs(k.cost)}</b><span>Spend</span></div>${rel ? `<div class="mnt-k"><b>${rel.av.toFixed(1)}%</b><span>Availability · 90 d</span></div>` : ''}</div></div>
      <div>${mntMachineHtml(sel, false)}</div></div>`;
  }
  body.innerHTML = `<div class="mnt-eqv"><div class="mnt-eql"><input type="search" id="eqQ" placeholder="Find a machine…" value="${esc(MNT_F.q || '')}"><div class="mnt-eqs">${list || '<div class="note">No match.</div>'}</div><button class="ib" id="eqAllQr" style="width:100%;margin-top:6px">🖨 Print QR stickers — all ${eq.length}</button></div><div class="mnt-eqd">${det}</div></div>`;
  $$('#mntBody [data-eq]').forEach(x => (x.onclick = () => ((MNT_F.blk = x.dataset.eq), mntRender())));
  const qi = $('#eqQ');
  qi.oninput = () => {
    MNT_F.q = qi.value;
    mntRender();
    const n = $('#eqQ');
    n.focus();
    n.setSelectionRange(n.value.length, n.value.length);
  };
  $('#eqAllQr').onclick = () => mntPrintStickers(eq);
  if (!sel) return;
  mntBindQr(body);
  $('#eqLog').onclick = () => mntForm({ kind: 'pm', blk: sel.id });
  $('#eqRep').onclick = () => mntForm({ kind: 'breakdown', blk: sel.id });
  $('#eqPlan').onclick = () => ((MNT_TAB = 'plans'), mntRender());
  $('#eqAsset').onclick = () => ((MNT_TAB = 'assets'), mntRender(), mntAssetForm(sel.id));
  body.querySelectorAll('[data-mdone]').forEach(x => (x.onclick = () => mntForm({ plan: x.dataset.mdone })));
  body.querySelectorAll('[data-mclose]').forEach(x => (x.onclick = () => mntForm({ wo: x.dataset.mclose })));
}

/* ================= Publish view: machine pop-up (PLC Tag Monitor) gets a Maintenance tab ================= */
let MNT_PMTAB = 'live';
function pmMntMount(ov, scope) {
  const b = dmBlock(scope.equipment_id || scope.plc_id || scope.scada_id);
  if (!b || !EQ[b.type] || EQ[b.type].widget) return;
  const head = ov.querySelector('.pm-head');
  if (!head) return;
  const M = DOC.maint;
  const n = M ? M.plans.filter(p => p.blk === b.id && mntState(p).st === 'over').length + mntOpenWO(b.id).length : 0;
  head.insertAdjacentHTML('afterend', `<div class="pm-tabs"><button data-pmt="live">Live data</button><button data-pmt="mnt">🔧 Maintenance${n ? ` <i class="mnt-badge">${n}</i>` : ''}</button></div><div class="pm-mnt" id="pmMnt" hidden></div>`);
  const pane = ov.querySelector('#pmMnt');
  const parts = ['.pm-bar', '.pm-msg', '.pm-scroll'].map(s => ov.querySelector(s));
  const draw = () => {
    if (!mntHas()) {
      pane.innerHTML = `${mntQrBlock(b)}<div class="note" style="margin:8px 0">No maintenance plan yet for this loop.</div><button class="ib pri" id="pmMSet">Set up maintenance</button>`;
      pane.querySelector('#pmMSet').onclick = () => (closePlcMonitor(), mntWindow('due', b.id));
    } else {
      const k = mntKpi(b.id);
      pane.innerHTML = `<div class="pm-mnt-g"><div><div class="mnt-pacts" style="margin:0 0 10px"><button class="ib pri" id="pmMLog">+ Log work</button><button class="ib" id="pmMRep">⚠ Service request</button><button class="ib" id="pmMAll">Open in Maintenance</button></div>${mntQrBlock(b)}
       <div class="mnt-sub">Last 30 days</div><div class="mnt-kpis mnt-kmini"><div class="mnt-k"><b>${k.jobs}</b><span>Jobs</span></div><div class="mnt-k"><b>${k.bd}</b><span>Requests</span></div><div class="mnt-k"><b>${(k.down / 60).toFixed(1)} h</b><span>Downtime</span></div><div class="mnt-k"><b>${mntRs(k.cost)}</b><span>Spend</span></div></div></div>
       <div>${typeof mntLifeHtml === 'function' ? mntLifeHtml(b, true) : ''}${mntMachineHtml(b, false)}</div></div>`;
      const go = f => () => (closePlcMonitor(), mntWindow('equip', b.id), f && f());
      pane.querySelector('#pmMLog').onclick = go(() => mntForm({ kind: 'pm', blk: b.id }));
      pane.querySelector('#pmMRep').onclick = go(() => mntForm({ kind: 'breakdown', blk: b.id }));
      pane.querySelector('#pmMAll').onclick = go();
      pane.querySelectorAll('[data-mdone]').forEach(x => (x.onclick = go(() => mntForm({ plan: x.dataset.mdone }))));
      pane.querySelectorAll('[data-mclose]').forEach(x => (x.onclick = go(() => mntForm({ wo: x.dataset.mclose }))));
    }
    mntBindQr(pane);
    pane.querySelectorAll('[data-qro]').forEach(x => {
      const f = x.onclick;
      x.onclick = () => (closePlcMonitor(), f());
    });
  };
  const show = t => {
    MNT_PMTAB = t;
    ov.querySelectorAll('[data-pmt]').forEach(x => x.classList.toggle('on', x.dataset.pmt === t));
    parts.forEach(el => el && el.classList.toggle('pm-hide', t !== 'live'));
    pane.hidden = t !== 'mnt';
    if (t === 'mnt') draw();
  };
  ov.querySelectorAll('[data-pmt]').forEach(x => (x.onclick = () => show(x.dataset.pmt)));
  show(MNT_PMTAB);
}

/* ================= Per-machine maintenance (Properties panel tab + QR card) ================= */
function mntMachineHtml(b, phone) {
  const M = mntDoc();
  const ps = M.plans.filter(p => p.blk === b.id).map(p => ({ p, s: mntState(p) })).sort((a, c) => a.s.score - c.s.score);
  const wo = mntOpenWO(b.id);
  const L = M.log.filter(e => e.blk === b.id && e.status !== 'cancelled').sort((a, c) => mntDate(c.date) - mntDate(a.date)).slice(0, phone ? 5 : 6);
  const h = mntHours(b.id);
  const k = mntKpi(b.id);
  const a = M.assets[b.id] || {};
  const aTxt = [a.make, a.model].filter(Boolean).join(' ');
  const asset = aTxt || a.serial || a.year || a.crit ? `<div class="mnt-asset">${a.crit ? `<span class="mnt-crit mnt-crit-${esc(a.crit)}" title="Criticality">${esc(a.crit)}</span>` : ''}<div><b>${esc(aTxt || 'Asset')}</b><div class="note">${[a.serial && 'S/N ' + esc(a.serial), a.year && 'installed ' + esc(a.year), a.power && esc(a.power) + ' kW', a.warranty && 'warranty to ' + mntFmtD(a.warranty)].filter(Boolean).join(' · ')}</div>${a.supplier ? `<div class="note">Supplier: ${esc(a.supplier)}${a.phone ? ` · <a href="tel:${esc(a.phone.replace(/[^\d+]/g, ''))}">${esc(a.phone)}</a>` : ''}</div>` : ''}</div></div>` : '';
  return `${phone ? '' : asset}${wo.map(e => `<div class="mnt-wo">${mntPrioChip(e.prio)} <b>${esc(e.no || 'Service request')}</b> ${mntWstChip(e)} ${esc(e.task)}<div class="note">Reported ${mntFmtD(e.date, true)} by ${esc(e.by)}${e.stop ? ' · machine stopped' : ''}${e.assign ? ' · assigned to ' + esc(e.assign) : ''}</div>${phone ? '' : `<button class="sb" data-mclose="${e.id}">Close with repair</button>`}</div>`).join('')}
 <div class="mnt-mh">${h ? `Running hours <b>${Math.round(h.v).toLocaleString('en-IN')} h</b> <span class="note">(${esc(h.src)})</span>` : '<span class="note">No running-hours reading yet</span>'}</div>
 ${ps.length ? `<div class="mnt-ml">${ps.map(({ p, s }) => `<div class="mnt-mi mnt-mi-${s.st}"><div class="mnt-mi1">${mntChip(s.st)}<b>${esc(p.task)}</b></div><div class="note">${mntKindChip(p.kind)} ${mntEvery(p)} · ${esc(s.text)}${p.who ? ` · ${esc(p.who)}` : ''}</div>${phone || s.st === 'paused' ? '' : `<button class="sb" data-mdone="${p.id}">Mark done</button>`}</div>`).join('')}</div>` : `<div class="note">No maintenance plan for this machine yet.</div>`}
 <div class="mnt-sub">Last work</div>${L.length ? `<div class="mnt-last">${L.map(e => `<div>${mntKindChip(e.kind)} <b>${esc(e.task)}</b><div class="note">${mntFmtD(e.date, true)} · ${esc(e.by || '')}${+e.down ? ` · ${e.down} min down` : ''}${e.notes ? ` · ${esc(e.notes)}` : ''}</div></div>`).join('')}</div>` : '<div class="note">Nothing logged yet.</div>'}
 ${phone ? '' : `<div class="note" style="margin-top:6px">30 days: ${k.jobs} jobs · ${k.bd} service request${k.bd === 1 ? '' : 's'} · ${(k.down / 60).toFixed(1)} h downtime · spend ${mntRs(k.cost)}</div>`}`;
}
function mntTab(b) {
  if (!mntHas())
    return `<div class="sec"><h5>Maintenance</h5>${mntQrBlock(b)}<div class="note">Plan preventive maintenance, inspections and overhauls for this machine, log every job and get alerts when work is due.</div><button class="ib pri" id="mtStart" style="width:100%;margin-top:8px">Set up maintenance</button></div>`;
  return `<div class="sec"><h5>Maintenance</h5>${typeof mntLifeHtml === 'function' ? mntLifeHtml(b, true) : ''}${mntQrBlock(b)}${mntMachineHtml(b, false)}
  <div class="mnt-pacts"><button class="ib pri" id="mtLog">+ Log work</button><button class="ib" id="mtRep">⚠ Service request</button><button class="ib" id="mtPlans">Edit plan</button><button class="ib" id="mtAsset">Asset details</button></div></div>`;
}
function bindMntTab(b, T) {
  mntBindQr(T);
  const st = $('#mtStart');
  if (st) st.onclick = () => mntWindow('due', b.id);
  const on = (id, f) => $(id) && ($(id).onclick = f);
  on('#mtLog', () => (mntWindow(null, b.id), mntForm({ kind: 'pm', blk: b.id })));
  on('#mtRep', () => (mntWindow(null, b.id), mntForm({ kind: 'breakdown', blk: b.id })));
  on('#mtPlans', () => mntWindow('plans', b.id));
  on('#mtAsset', () => (mntWindow('assets', b.id), mntAssetForm(b.id)));
  on('#mtStart', () => mntWindow('due', b.id));
  T.querySelectorAll('[data-mdone]').forEach(x => (x.onclick = () => (mntWindow(null, b.id), mntForm({ plan: x.dataset.mdone }))));
  T.querySelectorAll('[data-mclose]').forEach(x => (x.onclick = () => (mntWindow(null, b.id), mntForm({ wo: x.dataset.mclose }))));
}
/* phone card section (machine QR) */
function mntCardHtml(b) {
  if (!DOC.maint || !mntHas()) return '';
  const { due } = mntDueList();
  const n = due.filter(x => x.p.blk === b.id).length + mntOpenWO(b.id).length;
  return `<div class="mc-sec">Maintenance${n ? ` <span class="mnt-st mnt-over">${n} need attention</span>` : ''}</div><div class="mnt-card">${mntMachineHtml(b, true)}</div>
 <div class="mc-acts"><button class="x3-b mnt-cb1" id="mcLogW">🔧 Log work</button><button class="x3-b mnt-cb2" id="mcRep">⚠ Service request</button></div>`;
}
function mntCardSheet(b, kind) {
  const ov = $('#mcard');
  if (!ov) return;
  MC_PAUSE = true;
  // a closed Maintenance window may still hold a form with the same field names — clear it
  if ($('#mntW') && !$('#modal').classList.contains('on')) $('#mbox').innerHTML = '';
  let sh = $('#mntSheet');
  if (!sh) {
    sh = document.createElement('div');
    sh.id = 'mntSheet';
    ov.appendChild(sh);
  }
  sh.innerHTML = '<div class="mc-wrap" id="mntSheetIn"></div>';
  const host = $('#mntSheetIn');
  host.onclose = () => {
    sh.remove();
    MC_PAUSE = false;
  };
  mntForm({ kind, blk: b.id }, host);
}

/* ---------- wiring ---------- */
(() => {
  const lp = $('#pQR') || $('#pMon') || $('#pAlarm');
  if (lp && !$('#pMnt')) {
    lp.insertAdjacentHTML('afterend', '<button class="p10 p-mnt" id="pMnt" title="Maintenance — plans, work log and due alerts for every machine" aria-label="Maintenance">🔧<span class="p10t"> Maintenance</span></button>');
    $('#pMnt').onclick = () => mntWindow();
  }
  const vq = $('#vQR');
  if (vq && !$('#vMnt')) {
    vq.parentElement.insertAdjacentHTML(
      'beforeend',
      `<button class="ib rbig" id="vMnt" title="Maintenance — plans, work log and due alerts for every machine"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg><span class="rl">Maintenance</span></button>`,
    );
    $('#vMnt').onclick = () => mntWindow();
  }
  setInterval(() => {
    try {
      mntCheck();
    } catch (e) {}
  }, 5000);
  setTimeout(() => {
    try {
      mntCheck();
    } catch (e) {}
  }, 800);
})();
