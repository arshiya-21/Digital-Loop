/*! SandMan Process Flowsheet — 27g-eng-alerts.js
 *  v9.83 Item 6 — engineered alerts and alert monitoring.
 *  A rule checks several readings together: variables A–D (tags), an optional calculation (e.g. ΔT = A − B), conditions
 *  joined with AND / OR, only while the equipment runs, for a set duration, with severity, likely cause and action.
 *  One alert, a different message for each team (screen / email / phone). Each team acknowledges from its own message;
 *  without an acknowledgement in time the alert escalates. An alert closes when its condition has cleared and the
 *  team that fixed the cause has added a note (cause and action).
 *  Data (saved with the loop): DOC.eng = { rules: [...], log: [...instances], teams: [...] }.
 *  Email / phone are queued for the SandMan server (the browser cannot send them itself) and shown as "queued". */

const ENG_TEAMS0 = [
  { name: 'Maintenance', email: '', phone: '' },
  { name: 'Sand lab', email: '', phone: '' },
  { name: 'Sand plant & muller', email: '', phone: '' },
  { name: 'Melting & pouring', email: '', phone: '' },
  { name: 'Production head', email: '', phone: '' },
  { name: 'Shift in-charge', email: '', phone: '' },
];
const ENG_VARS = ['A', 'B', 'C', 'D'];
const ENG_SEVN = ['', 'Advisory', 'Warning', 'Critical'];
function engDoc() {
  const E = (DOC.eng = DOC.eng || {});
  E.rules = E.rules || engExamples();
  E.log = E.log || [];
  E.teams = E.teams || JSON.parse(JSON.stringify(ENG_TEAMS0));
  return E;
}
/* the examples from the development list, wired to this loop's tags when they exist; off until the plant confirms values */
function engExamples() {
  const has = id => !!REG[id],
    bn = n => (DOC.blocks.find(b => b.name === n) || {}).id || null,
    R = [];
  if (has('CD-1.STRING2') && has('CD-1.STRING2_2'))
    R.push({
      id: 'eng1', name: 'Sand cooler ΔT low', on: false, equip: bn('CD-1'),
      vars: { A: 'CD-1.STRING2', B: 'CD-1.STRING2_2', C: has('CD-1.WATER_FLOW_PCT') ? 'CD-1.WATER_FLOW_PCT' : '' },
      calc: { name: 'ΔT', expr: 'A - B', unit: '°C', d: 1 },
      conds: [{ l: 'X', op: '<', v: 15 }], join: 'and', runOnly: true, dur: 120, sev: 2,
      cause: 'Hot return sand discharged, or low cooling efficiency (water supply, nozzles, fan)',
      action: 'Check water nozzles, valve and pump; check fan current',
      teams: [
        { team: 'Maintenance', msg: 'Cooler ΔT {X} (limit 15 °C); water flow {C}. Check water nozzles, valve and pump.', ch: ['screen', 'email'] },
        { team: 'Sand lab', msg: 'Return sand at {B} going to the silo; risk of moisture loss and lower compactability. Test more often.', ch: ['screen'] },
        { team: 'Sand plant & muller', msg: 'Hot sand will reach the muller. Adjust water addition for the coming batches.', ch: ['screen'] },
        { team: 'Production head', msg: 'Cooler problem: ΔT {X}. Teams informed. Follow up until closed.', ch: ['screen', 'email'] },
      ],
      escMin: 30, escTo: 'Shift in-charge', example: true,
    });
  if (has('CD-1.STRING2_2') && has('CD-1.WATER_FLOW_PCT'))
    R.push({
      id: 'eng2', name: 'Cooler outlet hot and water flow low', on: false, equip: bn('CD-1'),
      vars: { A: 'CD-1.STRING2_2', B: 'CD-1.WATER_FLOW_PCT' }, calc: null,
      conds: [{ l: 'A', op: '>', v: 50 }, { l: 'B', op: '<', v: 20 }], join: 'and', runOnly: true, dur: 120, sev: 2,
      cause: 'Water supply problem', action: 'Check the water supply to the cooler',
      teams: [{ team: 'Maintenance', msg: 'Cooler outlet {A} with water flow {B}: check the water supply.', ch: ['screen', 'email'] }],
      escMin: 30, escTo: 'Shift in-charge', example: true,
    });
  if (has('CD-1.MAIN_MOTOR_PCT') && has('CD-1.MOISTURE_PCT'))
    R.push({
      id: 'eng3', name: 'Cooler overloaded / dry sand', on: false, equip: bn('CD-1'),
      vars: { A: 'CD-1.MAIN_MOTOR_PCT', B: 'CD-1.MOISTURE_PCT' }, calc: null,
      conds: [{ l: 'A', op: '>', v: 80 }, { l: 'B', op: '<', v: 1.5 }], join: 'and', runOnly: true, dur: 120, sev: 2,
      cause: 'Overloaded or dry sand', action: 'Reduce feed; check water addition',
      teams: [{ team: 'Maintenance', msg: 'Cooler motor current {A} with outlet moisture {B}.', ch: ['screen'] }],
      escMin: 30, escTo: 'Shift in-charge', example: true,
    });
  if (has('MX-1.TOTAL_WATER_L') && has('MX-1.COMPACT_AS_FINAL_MEASURE_PCT'))
    R.push({
      id: 'eng4', name: 'Muller: water high, compactability low', on: false, equip: bn('MX-1'),
      vars: { A: 'MX-1.TOTAL_WATER_L', B: 'MX-1.COMPACT_AS_FINAL_MEASURE_PCT' }, calc: null,
      conds: [{ l: 'A', op: '>', v: 90 }, { l: 'B', op: '<', v: 36 }], join: 'and', runOnly: true, dur: 60, sev: 2,
      cause: 'Water sensor or dosing fault', action: 'Check the water meter and dosing valve',
      teams: [{ team: 'Sand plant & muller', msg: 'Total water {A} but compactability {B}: check water sensor / dosing.', ch: ['screen'] }],
      escMin: 30, escTo: 'Shift in-charge', example: true,
    });
  if (has('POUR-1.ACT_POUR_TIME') && has('POUR-1.ACT_POUR_TEMP'))
    R.push({
      id: 'eng5', name: 'POUR-1: pour time high, temperature low', on: false, equip: bn('POUR-1'),
      vars: { A: 'POUR-1.ACT_POUR_TIME', B: 'POUR-1.ACT_POUR_TEMP' }, calc: null,
      conds: [{ l: 'A', op: '>', v: 12 }, { l: 'B', op: '<', v: 1380 }], join: 'and', runOnly: true, dur: 60, sev: 2,
      cause: 'Metal cooling in the ladle', action: 'Check ladle preheat and metal transfer time',
      teams: [{ team: 'Melting & pouring', msg: 'Pour time {A} with pour temperature {B}: metal cooling in the ladle.', ch: ['screen'] }],
      escMin: 30, escTo: 'Shift in-charge', example: true,
    });
  return R;
}
const ENG_ST = {}; // rule id → { since, inst }
function engExprOk(x) {
  return /^[ABCD0-9+\-*/(). ]*$/.test(String(x || '').replace(/abs\(/g, '('));
}
function engCalc(r, V) {
  // v10.4 — evaluated with the safe formula parser (27l-anim-data.js), not new Function: works under the CSP and can
  // never run anything but arithmetic
  if (!r.calc || !r.calc.expr || !engExprOk(r.calc.expr)) return null;
  const cp = typeof adCompile === 'function' ? adCompile(r.calc.expr) : null;
  if (!cp || cp.err) return null;
  const v = adEval(cp.tree, { vals: { A: V.A, B: V.B, C: V.C, D: V.D }, key: 'eng:' + r.id });
  return v != null && isFinite(v) ? v : null;
}
/* values of a rule now: { A, B, C, D, X (calculation) } and whether its condition holds */
function engEval(r) {
  const V = {};
  ENG_VARS.forEach(k => {
    const id = r.vars && r.vars[k];
    V[k] = id && REG[id] ? val(id) : null;
  });
  V.X = engCalc(r, V);
  const test = c => {
    const v = V[c.l];
    if (v == null || !isFinite(v)) return null;
    const t = +c.v;
    return c.op === '<' ? v < t : c.op === '<=' ? v <= t : c.op === '>' ? v > t : c.op === '>=' ? v >= t : c.op === '=' ? Math.abs(v - t) < 1e-9 : c.op === 'out' ? v < t || v > +c.v2 : null;
  };
  const rs = (r.conds || []).map(test);
  let ok = rs.length ? (r.join === 'or' ? rs.some(x => x === true) : rs.every(x => x === true)) : false;
  const b = r.equip && B(r.equip);
  const running = !b || (typeof effRun === 'function' ? effRun(b) : isRun(b));
  if (r.runOnly && !running) ok = false;
  return { V, ok, running, missing: rs.some(x => x === null) };
}
function engFmt(r, k, V) {
  if (k === 'X') return V.X == null ? '—' : `${fmtN(V.X, r.calc && r.calc.d != null ? r.calc.d : 1)}${r.calc && r.calc.unit ? ' ' + r.calc.unit : ''}`;
  const id = r.vars && r.vars[k],
    t = id && REG[id];
  return !t || V[k] == null ? '—' : `${fmtN(V[k], t.d)}${t.unit ? ' ' + t.unit : ''}`;
}
function engCondText(r) {
  const nm = k => (k === 'X' ? (r.calc && r.calc.name) || 'Calc' : (r.vars[k] && REG[r.vars[k]] && (REG[r.vars[k]].short || REG[r.vars[k]].desc)) || k);
  return (r.conds || []).map(c => `${nm(c.l)} ${c.op === 'out' ? `outside ${c.v}–${c.v2}` : c.op + ' ' + c.v}`).join(r.join === 'or' ? ' OR ' : ' AND ') + (r.runOnly ? ' (while running)' : '') + (r.dur ? ` for ${r.dur >= 60 ? r.dur / 60 + ' min' : r.dur + ' s'}` : '');
}
const engMsg = (r, tpl, V) => String(tpl || '').replace(/\{([ABCDX])\}/g, (m, k) => engFmt(r, k, V));
function engOut(inst, team, ch, text) {
  const E = engDoc();
  (E.outbox = E.outbox || []).unshift({ t: Date.now(), inst: inst.id, team, ch, text, status: ch === 'screen' ? 'shown in app' : 'queued for the server' });
  E.outbox.length = Math.min(E.outbox.length, 300);
}
function engTick() {
  if (MODE !== 'monitor' || RP) return;
  const E = engDoc(),
    now = Date.now();
  let dirty = false;
  E.rules.forEach(r => {
    const st = (ENG_ST[r.id] = ENG_ST[r.id] || { since: null });
    const open = E.log.find(i => i.rule === r.id && !i.closed);
    if (!r.on) {
      if (ALERTS['eng:' + r.id]) raise('eng:' + r.id, 0, {});
      st.since = null;
      return;
    }
    const ev = engEval(r);
    if (ev.ok) {
      if (st.since == null) st.since = now;
      if (now - st.since >= (+r.dur || 0) * 1000) {
        let inst = open && !open.cleared ? open : null;
        if (!inst) {
          inst = { id: 'ea' + now.toString(36) + r.id, rule: r.id, name: r.name, equip: r.equip, sev: r.sev, start: st.since, vals: {}, teams: {}, hits: 1 };
          (r.teams || []).forEach(tm => {
            inst.teams[tm.team] = { st: 'sent', t: now };
            (tm.ch || ['screen']).forEach(ch => engOut(inst, tm.team, ch, engMsg(r, tm.msg, ev.V)));
          });
          E.log.unshift(inst);
          E.log.length = Math.min(E.log.length, 500);
          logEv(`Engineered alert: ${r.name}`, r.sev);
          dirty = true;
        }
        inst.vals = Object.fromEntries(['A', 'B', 'C', 'D', 'X'].map(k => [k, ev.V[k]]));
        inst.peak = inst.peak || {};
        /* escalation: no team acknowledged in time */
        const acked = Object.values(inst.teams).some(x => x.st !== 'sent');
        if (false && !acked && !inst.esc && r.escMin && now - inst.start >= r.escMin * 60000) {
          inst.esc = now;
          engOut(inst, r.escTo || 'Shift in-charge', 'screen', `Escalated: ${r.name} on ${(B(r.equip) || {}).name || ''} not acknowledged in ${r.escMin} min`);
          logEv(`Escalated to ${r.escTo || 'next level'}: ${r.name}`, 3);
          dirty = true;
        }
        raise('eng:' + r.id, r.sev, { blk: r.equip, where: (B(r.equip) || {}).name || 'Plant', msg: `${r.name} — ${engCondText(r)}`, eng: inst.id });
      }
    } else {
      st.since = null;
      if (open && !open.cleared) {
        open.cleared = now;
        if (open.note) open.closed = now;
        dirty = true;
      }
      if (ALERTS['eng:' + r.id]) raise('eng:' + r.id, 0, {});
    }
  });
  if (dirty) save();
  if ($('#emBody')) emRender(true);
}
setInterval(() => {
  try {
    engTick();
  } catch (e) {
    console.warn('engTick', e);
  }
}, 1000);

/* ---------- Alert Monitoring screen ---------- */
let EM = { tab: 'live', f: { days: 7, equip: '', team: '', sev: '', st: '' }, edit: null };
const emDur = ms => {
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const emTime = t => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
function openAlertMonitor(tab) {
  if (tab) EM.tab = tab;
  openModal(`<div class="em-h"><h3 style="margin:0">Alert monitoring</h3><div class="seg" id="emTabs">${[['live', 'Live'], ['hist', 'History'], ['rules', 'Engineered alerts'], ['teams', 'Teams'], ...(typeof tkTab === 'function' ? [['tickets', 'Tickets']] : [])].map(([k, l]) => `<button data-emt="${k}" class="${EM.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div><div id="emBody"></div><div class="mact"><button class="ib pri" id="emClose">Close</button></div>`, 'xxl');
  $('#emClose').onclick = closeModal;
  $$('#emTabs button').forEach(b => (b.onclick = () => ((EM.tab = b.dataset.emt), (EM.edit = null), $$('#emTabs button').forEach(x => x.classList.toggle('on', x === b)), emRender())));
  emRender();
}
function emRender(tick) {
  const body = $('#emBody');
  if (!body) return;
  if (tick && (EM.tab !== 'live' || body.contains(document.activeElement))) return; // live list refreshes; forms are not disturbed
  const E = engDoc();
  let h = '';
  if (EM.tab === 'live') h = emLive(E);
  else if (EM.tab === 'hist') h = emHist(E);
  else if (EM.tab === 'rules') h = EM.edit ? emEdit(E) : emRules(E);
  else if (EM.tab === 'teams') h = emTeams(E);
  else if (EM.tab === 'tickets' && typeof tkTab === 'function') h = tkTab();
  if (body._h === h) return;
  body._h = h;
  body.innerHTML = h;
  emBind(body, E);
}
function emSummary(E, list) {
  const day = 86400000,
    now = Date.now(),
    ack = list.map(i => Math.min(...Object.values(i.teams).filter(x => x.ack).map(x => x.ack), Infinity) - i.start).filter(isFinite),
    clo = list.filter(i => i.closed).map(i => i.closed - i.start),
    avg = a => (a.length ? emDur(a.reduce((x, y) => x + y, 0) / a.length) : '—'),
    byR = {};
  list.forEach(i => (byR[i.name] = (byR[i.name] || 0) + 1));
  const top = Object.entries(byR).sort((a, b) => b[1] - a[1])[0];
  const days = Math.max(1, Math.min(EM.f.days, Math.ceil((now - Math.min(now, ...list.map(i => i.start))) / day) || 1));
  return `<div class="em-sum"><div><b>${list.length}</b><span>alerts (${EM.f.days} d)</span></div><div><b>${(list.length / days).toFixed(1)}</b><span>per day</span></div><div><b>${avg(ack)}</b><span>avg. time to acknowledge</span></div><div><b>${avg(clo)}</b><span>avg. time to close</span></div><div><b>${list.filter(i => !i.closed).length}</b><span>open</span></div><div class="em-top"><b>${top ? esc(top[0]) : '—'}</b><span>most frequent${top ? ` (${top[1]})` : ''}</span></div></div>`;
}
function emLive(E) {
  const open = E.log.filter(i => !i.closed),
    rules = Object.fromEntries(E.rules.map(r => [r.id, r]));
  const on = E.rules.filter(r => r.on).length;
  let h = emSummary(E, E.log.filter(i => i.start > Date.now() - EM.f.days * 86400000));
  if (!on) h += `<div class="em-empty">No engineered alert is switched on. Open <b>Engineered alerts</b> to check the examples and switch them on, or add your own.</div>`;
  if (!open.length) return h + `<div class="em-empty">No open alerts.</div>`;
  return (
    h +
    open
      .map(i => {
        const r = rules[i.rule] || { teams: [], vars: {} },
          live = !i.cleared,
          escIn = false && r.escMin && !i.esc && !Object.values(i.teams).some(x => x.st !== 'sent') ? r.escMin * 60000 - (Date.now() - i.start) : null;
        return `<div class="em-a sev${i.sev}${live ? '' : ' cleared'}"><div class="em-ah"><span class="chip sv${i.sev}">${ENG_SEVN[i.sev]}</span><b>${esc(i.name)}</b><span class="em-eq">${esc((B(i.equip) || {}).name || '')}</span><span class="em-t">${live ? 'active' : 'condition cleared — waiting for the closing note'} · since ${emTime(i.start)} (${emDur((i.cleared || Date.now()) - i.start)})</span>${i.esc ? `<span class="chip sv3">Escalated to ${esc(r.escTo || 'next level')}</span>` : escIn != null ? `<span class="em-esc">escalates in ${emDur(Math.max(0, escIn))}</span>` : ''}</div>
      <div class="em-c">${esc(engCondText(r))} · now ${['X', 'A', 'B', 'C', 'D'].filter(k => (k === 'X' ? r.calc : r.vars[k])).map(k => `${esc(k === 'X' ? r.calc.name || 'Calc' : (REG[r.vars[k]] || {}).short || k)} <b>${esc(engFmt(r, k, i.vals))}</b>`).join(' · ')}</div>
      ${r.cause ? `<div class="em-c">Likely cause: ${esc(r.cause)}${r.action ? ` · Action: ${esc(r.action)}` : ''}</div>` : ''}
      <div class="em-tm">${Object.entries(i.teams)
        .map(([tm, x]) => `<div class="em-ti st-${x.st}"><b>${esc(tm)}</b><span>${{ sent: 'Sent', ack: 'Acknowledged', act: 'Action taken', closed: 'Closed' }[x.st]}${x.by ? ' · ' + esc(x.by) : ''}${x.ack ? ' · ' + emTime(x.ack) : ''}</span>${x.st === 'sent' ? `<button class="sb" data-emack="${i.id}|${esc(tm)}">Acknowledge</button>` : ''}${x.st === 'ack' ? `<button class="sb" data-emact="${i.id}|${esc(tm)}">Action taken…</button>` : ''}${x.note ? `<em>${esc(x.note)}</em>` : ''}</div>`)
        .join('')}</div>
      <div class="em-close">${i.note ? `<span>Closing note: <b>${esc(i.note)}</b>${live ? ' — closes when the condition clears' : ''}</span>` : `<button class="sb" data-emclose="${i.id}">Add closing note (cause and action)…</button>`}</div></div>`;
      })
      .join('')
  );
}
function emHist(E) {
  const f = EM.f,
    from = Date.now() - f.days * 86400000;
  const L = E.log.filter(i => i.start >= from && (!f.equip || i.equip === f.equip) && (!f.sev || i.sev === +f.sev) && (!f.team || i.teams[f.team]) && (!f.st || (f.st === 'open' ? !i.closed : !!i.closed)));
  const eqs = [...new Set(E.log.map(i => i.equip).filter(Boolean))];
  const sel = (k, opts) => `<select data-emf="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(f[k]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return (
    `<div class="em-f">${sel('days', [[1, 'Today'], [7, '7 days'], [30, '30 days'], [365, '1 year']])}${sel('equip', [['', 'All equipment'], ...eqs.map(id => [id, (B(id) || {}).name || id])])}${sel('team', [['', 'All teams'], ...E.teams.map(t => [t.name, t.name])])}${sel('sev', [['', 'All severities'], [1, 'Advisory'], [2, 'Warning'], [3, 'Critical']])}${sel('st', [['', 'Open and closed'], ['open', 'Open'], ['closed', 'Closed']])}</div>` +
    emSummary(E, L) +
    `<table class="em-tb"><thead><tr><th>Start</th><th>Alert</th><th>Equipment</th><th>Severity</th><th>Duration</th><th>Teams</th><th>Status</th><th>Closing note</th></tr></thead><tbody>${L.map(i => `<tr><td>${emTime(i.start)}</td><td>${esc(i.name)}</td><td>${esc((B(i.equip) || {}).name || '')}</td><td><span class="chip sv${i.sev}">${ENG_SEVN[i.sev]}</span></td><td>${emDur((i.cleared || Date.now()) - i.start)}</td><td>${Object.entries(i.teams).map(([t, x]) => `${esc(t)}: ${x.st}`).join('<br>')}</td><td>${i.closed ? 'Closed' : i.cleared ? 'Cleared, note missing' : 'Open'}${i.esc ? ' · escalated' : ''}</td><td>${esc(i.note || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="note">No alerts in this period.</td></tr>'}</tbody></table>`
  );
}
function emRules(E) {
  const wk = Date.now() - 7 * 86400000;
  return `<div class="em-rh"><span class="note">Each rule checks several readings together. Thresholds in the examples are illustrations — set real values with the process engineers.</span><button class="ib pri" id="emNew">＋ New engineered alert</button></div>
  <table class="em-tb"><thead><tr><th>On</th><th>Alert</th><th>Equipment</th><th>Logic</th><th>Severity</th><th>Teams</th><th>Now</th><th>Last 7 days</th><th></th></tr></thead><tbody>${E.rules
    .map(r => {
      const n = E.log.filter(i => i.rule === r.id && i.start > wk).length,
        ev = engEval(r),
        noisy = n / 7 > 3;
      return `<tr><td><input type="checkbox" data-emon="${r.id}" ${r.on ? 'checked' : ''} aria-label="Switch on"></td><td><b>${esc(r.name)}</b>${r.example ? ' <span class="chip">example</span>' : ''}</td><td>${esc((B(r.equip) || {}).name || '—')}</td><td class="em-lg">${r.calc ? `${esc(r.calc.name)} = ${esc(r.calc.expr)}; ` : ''}${esc(engCondText(r))}</td><td><span class="chip sv${r.sev}">${ENG_SEVN[r.sev]}</span></td><td>${(r.teams || []).map(t => esc(t.team)).join(', ')}</td><td>${ev.missing ? '<span class="note">no data</span>' : ev.ok ? '<b class="em-true">condition true</b>' : 'normal'}</td><td>${n}${noisy ? ' <span class="chip sv2" title="Fires very often — check the threshold or logic">fires often</span>' : ''}</td><td><button class="sb" data-emed="${r.id}">Edit</button></td></tr>`;
    })
    .join('') || '<tr><td colspan="9" class="note">No rules yet.</td></tr>'}</tbody></table>`;
}
function emEdit(E) {
  const r = EM.edit,
    tags = Object.keys(REG).filter(id => !tagIsText(REG[id])).sort(),
    eqs = DOC.blocks.filter(b => !EQ[b.type].widget && b.type !== 'areaBox' && b.type !== 'junction').sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const ev = engEval(r);
  const left = [...(r.calc && r.calc.expr ? [['X', (r.calc.name || 'Calc') + ' (calculation)']] : []), ...ENG_VARS.filter(k => r.vars[k]).map(k => [k, `${k} — ${(REG[r.vars[k]] || {}).short || r.vars[k]}`])];
  return `<div class="em-ed"><div class="em-ed-l">
   <div class="fld"><label>Alert name</label><input data-er="name" value="${esc(r.name || '')}"></div>
   <div class="fld"><label>Equipment</label><select data-er="equip"><option value="">—</option>${eqs.map(b => `<option value="${b.id}" ${r.equip === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
   <div class="em-sh">Parameters used</div>
   ${ENG_VARS.map(k => `<div class="em-var"><b>${k}</b><select data-erv="${k}"><option value="">—</option>${tags.map(id => `<option value="${esc(id)}" ${r.vars[k] === id ? 'selected' : ''}>${esc((REG[id].short || REG[id].desc || '') + ' — ' + id)}</option>`).join('')}</select><span class="em-vn">${r.vars[k] ? esc(engFmt(r, k, ev.V)) : ''}</span></div>`).join('')}
   <div class="em-sh">Calculation (optional)</div>
   <div class="em-calc"><input data-erc="name" value="${esc((r.calc && r.calc.name) || '')}" placeholder="Name, e.g. ΔT"><span>=</span><input data-erc="expr" value="${esc((r.calc && r.calc.expr) || '')}" placeholder="e.g. A - B,  A / B,  (A + B) / 2"><input data-erc="unit" value="${esc((r.calc && r.calc.unit) || '')}" placeholder="unit" style="width:60px"></div>
   ${r.calc && r.calc.expr && !engExprOk(r.calc.expr) ? '<div class="em-bad">Use only A, B, C, D, numbers, + − × ÷ and brackets.</div>' : ''}
   <div class="em-now">Now: ${left.map(([k, l]) => `${esc(l.split(' (')[0].split(' — ')[0] === k ? l : l.split(' (')[0])} <b>${esc(engFmt(r, k, ev.V))}</b>`).join(' · ') || '—'} → ${ev.missing ? 'some values missing' : ev.ok ? '<b class="em-true">condition true</b>' : 'condition false'}${r.runOnly && !ev.running ? ' (equipment not running)' : ''}</div>
  </div><div class="em-ed-r">
   <div class="em-sh">Condition and threshold</div>
   ${(r.conds || []).map((c, i) => `<div class="em-cond"><select data-ecl="${i}">${left.map(([k, l]) => `<option value="${k}" ${c.l === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><select data-eco="${i}">${[['<', 'below'], ['<=', 'at or below'], ['>', 'above'], ['>=', 'at or above'], ['out', 'outside']].map(([o, l]) => `<option value="${o}" ${c.op === o ? 'selected' : ''}>${l}</option>`).join('')}</select><input type="number" step="any" data-ecv="${i}" value="${esc(c.v)}">${c.op === 'out' ? `<span>–</span><input type="number" step="any" data-ecv2="${i}" value="${esc(c.v2 ?? '')}">` : ''}<button class="lb" data-ecx="${i}" title="Remove">✕</button></div>`).join('')}
   <div class="em-row"><button class="sb" id="emCondAdd">＋ Condition</button><span class="lc2-seg">${[['and', 'All (AND)'], ['or', 'Any (OR)']].map(([j, l]) => `<button type="button" data-ej="${j}" aria-pressed="${(r.join || 'and') === j}">${l}</button>`).join('')}</span></div>
   <label class="chk"><input type="checkbox" data-er="runOnly" ${r.runOnly ? 'checked' : ''}> Only check while the equipment is running</label>
   <div class="em-row"><label>Must last</label><input type="number" min="0" data-er="dur" value="${r.dur || 0}" style="width:70px"><span>seconds before alerting</span></div>
   <div class="em-row"><label>Severity</label><span class="lc2-seg">${[1, 2, 3].map(s => `<button type="button" data-esv="${s}" aria-pressed="${r.sev === s}">${ENG_SEVN[s]}</button>`).join('')}</span></div>
   <div class="fld"><label>Likely cause (shown to the operator)</label><input data-er="cause" value="${esc(r.cause || '')}"></div>
   <div class="fld"><label>Action</label><input data-er="action" value="${esc(r.action || '')}"></div>
   <div class="em-sh">Teams and messages <span class="note">{A} {B} {C} {D} {X} are replaced by the values</span></div>
   ${(r.teams || []).map((t, i) => `<div class="em-team"><select data-ett="${i}">${E.teams.map(x => `<option ${t.team === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${['screen', 'email', 'phone'].map(ch => `<label class="chk"><input type="checkbox" data-etc="${i}|${ch}" ${(t.ch || []).includes(ch) ? 'checked' : ''}> ${ch}</label>`).join('')}<button class="lb" data-etx="${i}" title="Remove">✕</button><textarea data-etm="${i}" rows="2">${esc(t.msg || '')}</textarea><div class="em-prev">${esc(engMsg(r, t.msg, ev.V))}</div></div>`).join('')}
   <button class="sb" id="emTeamAdd">＋ Team</button>
  </div></div>
  <div class="em-edb"><button class="ib" id="emCancel">Cancel</button>${E.rules.some(x => x.id === r.id) ? '<button class="ib" id="emDel" style="color:var(--crit)">Delete</button>' : ''}<button class="ib pri" id="emSave">Save rule</button></div>`;
}
function emTeams(E) {
  return `<div class="note" style="margin-bottom:8px">Teams that receive alerts and tickets. Email and phone are sent by the SandMan server; until it is connected they are queued here.</div><table class="em-tb"><thead><tr><th>Team</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>${E.teams.map((t, i) => `<tr><td><input data-etn="${i}|name" value="${esc(t.name)}"></td><td><input data-etn="${i}|email" value="${esc(t.email || '')}" placeholder="name@plant.com"></td><td><input data-etn="${i}|phone" value="${esc(t.phone || '')}" placeholder="+91 …"></td><td><button class="lb" data-etd="${i}">✕</button></td></tr>`).join('')}</tbody></table><button class="sb" id="emTAdd" style="margin-top:6px">＋ Team</button>
  <div class="em-sh" style="margin-top:14px">Message log <span class="note">last 30</span></div><table class="em-tb"><tbody>${(E.outbox || []).slice(0, 30).map(o => `<tr><td>${emTime(o.t)}</td><td>${esc(o.team)}</td><td>${esc(o.ch)}</td><td>${esc(o.text)}</td><td>${esc(o.status)}</td></tr>`).join('') || '<tr><td class="note">No messages yet.</td></tr>'}</tbody></table>`;
}
function emBind(body, E) {
  const q = s => body.querySelectorAll(s),
    one = s => body.querySelector(s),
    who = () => (typeof USER !== 'undefined' && USER && USER.name) || 'Operator',
    find = id => E.log.find(i => i.id === id),
    keep = () => (save(), (body._h = null), emRender());
  q('[data-emack]').forEach(b => (b.onclick = () => {
    const [id, tm] = b.dataset.emack.split('|'), i = find(id);
    if (!i) return;
    Object.assign(i.teams[tm], { st: 'ack', ack: Date.now(), by: who() });
    keep();
  }));
  q('[data-emact]').forEach(b => (b.onclick = () => {
    const [id, tm] = b.dataset.emact.split('|'), i = find(id), n = prompt(`Action taken by ${tm}`);
    if (!i || !n) return;
    Object.assign(i.teams[tm], { st: 'act', note: n, by: who(), t: Date.now() });
    keep();
  }));
  q('[data-emclose]').forEach(b => (b.onclick = () => {
    const i = find(b.dataset.emclose), n = prompt('Closing note — cause found and action taken');
    if (!i || !n) return;
    i.note = n;
    i.noteBy = who();
    if (i.cleared) i.closed = Date.now();
    Object.values(i.teams).forEach(x => x.st === 'act' && (x.st = 'closed'));
    keep();
  }));
  q('[data-emf]').forEach(s => (s.onchange = () => ((EM.f[s.dataset.emf] = s.dataset.emf === 'days' ? +s.value : s.value), (body._h = null), emRender())));
  q('[data-emon]').forEach(c => (c.onchange = () => {
    const r = E.rules.find(x => x.id === c.dataset.emon);
    r.on = c.checked;
    keep();
  }));
  q('[data-emed]').forEach(b => (b.onclick = () => ((EM.edit = JSON.parse(JSON.stringify(E.rules.find(x => x.id === b.dataset.emed)))), (body._h = null), emRender())));
  const nw = one('#emNew');
  if (nw) nw.onclick = () => ((EM.edit = { id: 'eng' + Date.now().toString(36), name: 'New engineered alert', on: true, equip: '', vars: {}, calc: null, conds: [], join: 'and', runOnly: true, dur: 120, sev: 2, cause: '', action: '', teams: [], escMin: 0, escTo: '' }), (body._h = null), emRender());
  /* rule editor */
  const r = EM.edit;
  if (r && EM.tab === 'rules') {
    const re = () => ((body._h = null), emRender());
    q('[data-er]').forEach(i => (i.onchange = () => {
      const k = i.dataset.er;
      r[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value;
      re();
    }));
    q('[data-erv]').forEach(s => (s.onchange = () => {
      if (s.value) r.vars[s.dataset.erv] = s.value;
      else delete r.vars[s.dataset.erv];
      if (!r.conds.length && s.value) r.conds.push({ l: s.dataset.erv, op: '>', v: 0 });
      re();
    }));
    q('[data-erc]').forEach(i => (i.onchange = () => {
      r.calc = Object.assign({ name: '', expr: '', unit: '', d: 1 }, r.calc || {}, { [i.dataset.erc]: i.value });
      if (!r.calc.expr) r.calc = null;
      re();
    }));
    q('[data-ecl]').forEach(s => (s.onchange = () => ((r.conds[+s.dataset.ecl].l = s.value), re())));
    q('[data-eco]').forEach(s => (s.onchange = () => ((r.conds[+s.dataset.eco].op = s.value), re())));
    q('[data-ecv]').forEach(s => (s.onchange = () => ((r.conds[+s.dataset.ecv].v = +s.value), re())));
    q('[data-ecv2]').forEach(s => (s.onchange = () => ((r.conds[+s.dataset.ecv2].v2 = +s.value), re())));
    q('[data-ecx]').forEach(b => (b.onclick = () => (r.conds.splice(+b.dataset.ecx, 1), re())));
    q('[data-ej]').forEach(b => (b.onclick = () => ((r.join = b.dataset.ej), re())));
    q('[data-esv]').forEach(b => (b.onclick = () => ((r.sev = +b.dataset.esv), re())));
    q('[data-ett]').forEach(s => (s.onchange = () => ((r.teams[+s.dataset.ett].team = s.value), re())));
    q('[data-etc]').forEach(c => (c.onchange = () => {
      const [i, ch] = c.dataset.etc.split('|'), t = r.teams[+i];
      t.ch = (t.ch || []).filter(x => x !== ch).concat(c.checked ? [ch] : []);
      re();
    }));
    q('[data-etm]').forEach(t => (t.onchange = () => ((r.teams[+t.dataset.etm].msg = t.value), re())));
    q('[data-etx]').forEach(b => (b.onclick = () => (r.teams.splice(+b.dataset.etx, 1), re())));
    const ca = one('#emCondAdd');
    if (ca) ca.onclick = () => (r.conds.push({ l: r.calc ? 'X' : ENG_VARS.find(k => r.vars[k]) || 'A', op: '<', v: 0 }), re());
    const ta = one('#emTeamAdd');
    if (ta) ta.onclick = () => (r.teams.push({ team: E.teams[0].name, msg: '{X}', ch: ['screen', 'email'] }), re());
    one('#emCancel').onclick = () => ((EM.edit = null), re());
    const del = one('#emDel');
    if (del) del.onclick = () => {
      if (!confirm(`Delete the alert rule "${r.name}"? Its past alerts stay in the history.`)) return;
      E.rules = E.rules.filter(x => x.id !== r.id);
      EM.edit = null;
      save();
      re();
    };
    one('#emSave').onclick = () => {
      if (!r.conds.length) return toast('Add at least one condition');
      delete r.example;
      const k = E.rules.findIndex(x => x.id === r.id);
      k >= 0 ? (E.rules[k] = r) : E.rules.push(r);
      EM.edit = null;
      save();
      toast('Engineered alert saved');
      re();
    };
  }
  /* teams */
  q('[data-etn]').forEach(i => (i.onchange = () => {
    const [n, k] = i.dataset.etn.split('|');
    E.teams[+n][k] = i.value;
    save();
  }));
  q('[data-etd]').forEach(b => (b.onclick = () => (E.teams.splice(+b.dataset.etd, 1), keep())));
  const tad = one('#emTAdd');
  if (tad) tad.onclick = () => (E.teams.push({ name: 'New team', email: '', phone: '' }), keep());
}
{
  const b = document.getElementById('bAM');
  if (b) b.onclick = () => openAlertMonitor();
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="emCss">
.em-h{display:flex;align-items:center;gap:16px;margin-bottom:10px}
.em-sum{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:8px 0 12px}
.em-sum div{border:1px solid var(--line,#d6dde6);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;min-width:0}
.em-sum b{font:700 18px var(--sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.em-sum span{font-size:11.5px;color:var(--muted,#5b6b7b)}
.em-top b{font-size:13px}
.em-empty{padding:12px;border:1px dashed var(--line,#d6dde6);border-radius:8px;color:var(--muted,#5b6b7b);margin-bottom:8px;font-size:13px}
.em-a{border:1px solid var(--line,#d6dde6);border-left:5px solid #c2410c;border-radius:8px;padding:10px 12px;margin-bottom:10px;background:var(--panel,#fff)}
.em-a.sev3{border-left-color:#d93636}.em-a.sev1{border-left-color:#a16207}.em-a.cleared{opacity:.85;border-left-style:dashed}
.em-ah{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px}
.em-eq{font-weight:600;color:#1f3b63}.em-t{color:var(--muted,#5b6b7b);font-size:12px}.em-esc{font-size:12px;color:#c2410c;font-weight:600}
.em-c{font-size:12.5px;margin-top:4px}
.em-tm{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px;margin-top:8px}
.em-ti{border:1px solid var(--line,#e3e8ec);border-radius:6px;padding:6px 8px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:12px}
.em-ti b{flex-basis:100%}.em-ti em{flex-basis:100%;color:var(--muted,#5b6b7b)}
.em-ti.st-ack{background:#eef4ff}.em-ti.st-act,.em-ti.st-closed{background:#eefaf3}
.em-close{margin-top:8px;font-size:12.5px}
.em-f{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.em-tb{width:100%;border-collapse:collapse;font-size:12.5px}
.em-tb th{text-align:left;font-weight:600;color:var(--muted,#5b6b7b);padding:6px;border-bottom:1px solid var(--line,#d6dde6)}
.em-tb td{padding:6px;border-bottom:1px solid var(--line,#eef2f5);vertical-align:top}
.em-tb input{width:100%;box-sizing:border-box}
.em-lg{max-width:340px}.em-true{color:#d93636}
.em-rh{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}
.em-ed{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.em-ed .fld input,.em-ed .fld select{width:100%;box-sizing:border-box}
.em-sh{font:700 12.5px var(--sans);margin:12px 0 6px}
.em-var{display:grid;grid-template-columns:20px 1fr 90px;gap:6px;align-items:center;margin-bottom:4px}.em-var select{min-width:0}.em-vn{font:600 12px var(--mono);text-align:right}
.em-calc{display:flex;gap:6px;align-items:center}.em-calc input{min-width:0;flex:1}
.em-bad{color:#d93636;font-size:12px;margin-top:4px}
.em-now{margin-top:10px;padding:8px;border-radius:6px;background:var(--bg2,#f1f5f9);font-size:12.5px}
.em-cond{display:flex;gap:6px;align-items:center;margin-bottom:4px}.em-cond select:first-child{flex:1;min-width:0}.em-cond input{width:80px}
.em-row{display:flex;gap:8px;align-items:center;margin:6px 0;font-size:12.5px;flex-wrap:wrap}
.em-team{border:1px solid var(--line,#e3e8ec);border-radius:6px;padding:6px;margin-bottom:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.em-team textarea{flex-basis:100%;box-sizing:border-box;font:12.5px var(--sans);height:44px!important;min-height:0!important;resize:vertical}.em-prev{flex-basis:100%;font-size:12px;color:var(--muted,#5b6b7b)}
.em-edb{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
</style>`,
);
