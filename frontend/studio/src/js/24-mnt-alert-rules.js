/*! SandMan Digital Loop Studio — 24-mnt-alert-rules.js
 *  v9.53 — Maintenance alert rules (one place to configure who is told what, when, and how)
 *  · One row per event: on/off · when (lead time / delay) · level in the Fault alarm list (Off, Advisory, Warning,
 *    Critical) · desktop pop-up · who is notified (roles) · channels (App now; Email / WhatsApp sent by the Fountrix
 *    server) · escalation (after N hours unanswered → in-charge / production head).
 *  · Condition triggers (condition-based maintenance): a live reading beyond a limit for N minutes opens a service
 *    request by itself — e.g. shakeout vibration > 8 mm/s for 2 min.
 *  · Preview shows what would fire now; Test sends a sample; every notification is kept in the Notification log
 *    (time, rule, people, channel, status: shown in app / queued for the server).
 *  Data: DOC.maint.rules {<event>: {...}}, DOC.maint.conds [...], DOC.maint.outbox [...] (last 300). */

const MNT_ROLES = { incharge: 'Maintenance in-charge', tech: 'Technician (assigned / responsible)', prod: 'Production head', store: 'Store keeper' };
const MNT_SEVN = ['Off', 'Advisory', 'Warning', 'Critical'];
const MNT_EV = [
  ['due', 'Planned work due soon', 'Before a PM / inspection / overhaul falls due', 'lead', 'days before'],
  ['over', 'Planned work overdue', 'A planned task passed its due date or hours', 'grace', 'days after due'],
  ['oversafe', 'Safety-critical task overdue', 'Furnace lining, coil cooling, pouring checks…', 'grace', 'days after due'],
  ['ovh', 'Overhaul due', 'Major rebuild coming up — plan shutdown, spares, crane', 'lead', 'days before'],
  ['req1', 'Service request P1 — emergency', 'Line stopped or safety problem', 'esc', ''],
  ['req2', 'Service request P2 — urgent', 'Fix within the shift', 'esc', ''],
  ['req3', 'Service request P3 / P4', 'This week / next planned stop', 'esc', ''],
  ['cond', 'Condition trigger fired', 'A live reading stayed beyond its limit (rules below)', 'none', ''],
  ['health', 'Equipment health low', 'Health score fell below the threshold', 'thr', 'score below'],
  ['stock', 'Spare part at minimum stock', 'Reorder before the next job needs it', 'none', ''],
  ['war', 'Warranty ending', 'Claim any defect before the warranty ends', 'lead', 'days before'],
  ['summary', 'Daily due list', 'One message each morning with the day\'s work', 'time', 'send at'],
];
const MNT_RULE0 = {
  due: { on: true, v: 3, sev: 0, pop: true, to: ['tech'], ch: ['app'] },
  over: { on: true, v: 0, sev: 1, pop: true, to: ['tech', 'incharge'], ch: ['app', 'wa'], esc: 72, escTo: ['incharge'] },
  oversafe: { on: true, v: 0, sev: 2, pop: true, to: ['tech', 'incharge'], ch: ['app', 'wa', 'email'], esc: 12, escTo: ['incharge', 'prod'] },
  ovh: { on: true, v: 30, sev: 0, pop: false, to: ['incharge', 'prod'], ch: ['app', 'email'] },
  req1: { on: true, sev: 3, pop: true, to: ['tech', 'incharge', 'prod'], ch: ['app', 'wa'], esc: 0.25, escTo: ['incharge', 'prod'] },
  req2: { on: true, sev: 2, pop: true, to: ['tech', 'incharge'], ch: ['app', 'wa'], esc: 2, escTo: ['incharge'] },
  req3: { on: true, sev: 1, pop: false, to: ['tech'], ch: ['app'], esc: 72, escTo: ['incharge'] },
  cond: { on: true, sev: 2, pop: true, to: ['tech', 'incharge'], ch: ['app', 'wa'] },
  health: { on: true, v: 50, sev: 0, pop: false, to: ['incharge'], ch: ['app', 'email'] },
  stock: { on: true, sev: 0, pop: false, to: ['store', 'incharge'], ch: ['app', 'email'] },
  war: { on: true, v: 30, sev: 0, pop: false, to: ['incharge'], ch: ['app', 'email'] },
  summary: { on: true, v: '07:30', sev: 0, pop: false, to: ['incharge', 'tech'], ch: ['email', 'wa'] },
};
function mntRules() {
  const M = mntDoc();
  M.rules = M.rules || {};
  for (const k in MNT_RULE0) M.rules[k] = Object.assign({}, MNT_RULE0[k], M.rules[k] || {});
  M.conds = M.conds || [];
  M.outbox = M.outbox || [];
  M.cfg.warnDays = M.rules.due.v; // one lead time for "due soon" (Due list and alerts agree)
  return M.rules;
}
function mntRoleOf(t) {
  if (t.rk) return t.rk;
  return /charge|manager|head of maint/i.test(t.role || '') ? 'incharge' : /prod/i.test(t.role || '') ? 'prod' : /store/i.test(t.role || '') ? 'store' : 'tech';
}
/* who receives: roles → team members (the assigned / responsible person first for "tech") */
function mntPeople(roles, person) {
  const M = mntDoc(),
    out = [];
  (roles || []).forEach(r => {
    if (r === 'tech' && person) {
      const t = M.team.find(x => x.name === person);
      if (t) return out.push(t);
    }
    M.team.filter(t => mntRoleOf(t) === r && (r !== 'tech' || !person)).forEach(t => out.push(t));
  });
  return [...new Map(out.map(t => [t.id, t])).values()];
}
/* one notification → app pop-up now; email / WhatsApp queued for the Fountrix server; all kept in the log */
const MNT_SENT = new Set();
function mntSend(key, ev, where, msg, person, force) {
  const R = mntRules()[ev];
  if (!R || (!R.on && !force) || (MNT_SENT.has(key) && !force)) return;
  MNT_SENT.add(key);
  const M = mntDoc();
  const ppl = mntPeople(R.to, person);
  const chans = R.ch || [];
  M.outbox.unshift({ t: mntIso(new Date()), ev, where, msg, to: ppl.map(t => t.name), ch: chans, st: chans.filter(c => c !== 'app').length ? 'App shown · email / WhatsApp queued for server' : 'Shown in app' });
  if (M.outbox.length > 300) M.outbox.length = 300;
  if (R.pop) mntNotify(where, msg, R.sev || 1);
}

/* ---------- the check (every 5 s): alarm list + notifications + escalation + condition triggers ---------- */
const MNT_COND_T = {},
  MNT_HL = new Set();
function mntCheck() {
  if (!DOC || !DOC.maint) {
    for (const k in ALERTS) if (k.startsWith('mnt:')) delete ALERTS[k];
    return;
  }
  const M = mntDoc(),
    R = mntRules(),
    live = new Set();
  const put = (k, sev, info) => {
    if (!sev) return;
    live.add(k);
    raise(k, sev, info);
    if (ALERTS[k]) {
      ALERTS[k].msg = info.msg;
      ALERTS[k].mnt = true;
    }
  };
  // planned work
  const over = {};
  M.plans.forEach(p => {
    const b = B(p.blk);
    if (!b || p.paused) return;
    const s = mntState(p);
    const ovh = p.kind === 'ovh';
    if (s.st === 'over') {
      const late = s.dl != null ? -s.dl : 0;
      const ev = p.crit ? 'oversafe' : 'over';
      if (R[ev].on && late >= (+R[ev].v || 0)) (over[b.id] = over[b.id] || []).push({ p, s, ev });
      if (R[ev].on && R[ev].esc != null && late * 24 >= (+R[ev].v || 0) * 24 + +R[ev].esc) mntSend(`esc:${p.id}:${p.last}`, ev, b.name, `ESCALATED — still overdue: ${p.task} (${s.text})`, null);
    } else if (ovh && R.ovh.on && s.dl != null && s.dl <= +R.ovh.v) mntSend(`ovh:${p.id}:${p.last}`, 'ovh', b.name, `Overhaul due ${s.text}: ${p.task} — plan the shutdown, spares and manpower`, p.who);
    else if (s.st === 'soon' && R.due.on) mntSend(`due:${p.id}:${p.last}`, 'due', b.name, `Maintenance due: ${p.task} — ${s.text}`, p.who);
  });
  Object.entries(over).forEach(([id, list]) => {
    const b = B(id),
      safe = list.some(x => x.ev === 'oversafe');
    list.sort((a, c) => a.s.score - c.s.score);
    const first = list[0];
    const msg = `Maintenance overdue${safe ? ' (safety-critical)' : ''}: ${list.length > 1 ? `${list.length} tasks — ` : ''}${first.p.task} (${first.s.text})${list.length > 1 ? ` + ${list.length - 1} more` : ''}`;
    put('mnt:od:' + id, Math.max(...list.map(x => +R[x.ev].sev || 0)), { blk: id, where: b.name, msg });
    list.forEach(x => mntSend(`over:${x.p.id}:${x.p.last}`, x.ev, b.name, `Overdue: ${x.p.task} (${x.s.text})`, x.p.who));
  });
  // service requests: level by priority; escalate when nobody has taken it up in time
  mntOpenWO().forEach(e => {
    const b = B(e.blk);
    if (!b) return;
    const ev = e.prio === 'P1' ? 'req1' : e.prio === 'P2' ? 'req2' : 'req3';
    const r = R[ev];
    if (!r.on) return;
    const ageH = (Date.now() - mntDate(e.date)) / 36e5;
    const taken = e.status === 'progress' || e.status === 'hold';
    const esc = r.esc != null && !taken && ageH >= +r.esc;
    if (esc && !e.escAt) {
      e.escAt = mntIso();
      (e.hist = e.hist || []).push({ t: e.escAt, by: 'Fountrix', st: e.status, note: `Escalated to ${(r.escTo || []).map(x => MNT_ROLES[x]).join(', ')} — not taken up in ${r.esc < 1 ? Math.round(r.esc * 60) + ' min' : r.esc + ' h'}` });
      save();
      const R2 = Object.assign({}, r, { to: r.escTo || ['incharge'] });
      M.rules['_esc'] = R2;
      mntSend(`resc:${e.id}`, '_esc', b.name, `ESCALATED ${e.no || ''} ${e.prio}: ${e.task} — not taken up for ${ageH < 1 ? Math.round(ageH * 60) + ' min' : ageH.toFixed(1) + ' h'}`, null);
    }
    const sev = Math.min(3, (+r.sev || 0) + (e.escAt && !taken ? 1 : 0));
    put('mnt:wo:' + e.id, sev, { blk: b.id, where: b.name, msg: `${e.escAt && !taken ? 'ESCALATED · ' : ''}${e.no ? e.no + ' · ' : ''}${e.prio ? e.prio + ' ' : ''}Service request ${(MNT_WST[e.status] || 'open').toLowerCase()}: ${e.task}${e.assign ? ' — ' + e.assign : ''}${e.stop ? ' — machine stopped' : ''} (reported ${mntFmtD(e.date, true)} by ${e.by})` });
    mntSend(`req:${e.id}`, ev, b.name, `${e.no || ''} ${e.prio || ''} ${e.task}${e.stop ? ' — machine stopped' : ''}`, e.assign);
  });
  delete M.rules['_esc'];
  // condition triggers → automatic service request
  if (R.cond.on)
    M.conds.forEach(c => {
      const b = B(c.blk),
        t = REG[c.tag];
      if (!b || !t || c.off) return;
      const v = val(c.tag);
      const bad = c.op === '<' ? v < +c.val : v > +c.val;
      if (!bad) return void delete MNT_COND_T[c.id];
      MNT_COND_T[c.id] = MNT_COND_T[c.id] || Date.now();
      const mins = (Date.now() - MNT_COND_T[c.id]) / 6e4;
      if (mins < +c.mins) return;
      if (M.log.some(e => e.cond === c.id && mntIsOpen(e))) return;
      const e = { id: mntId('w'), blk: b.id, kind: 'breakdown', task: c.task || `${t.desc} ${c.op === '<' ? 'below' : 'above'} ${c.val} ${t.unit || ''}`.trim(), date: mntIso(), by: 'Fountrix (automatic)', stop: false, prio: c.prio || 'P3', status: 'open', cond: c.id, notes: `Automatic: ${t.desc} = ${fmtN(v, t.d)} ${t.unit || ''} (${c.op} ${c.val}) for ${+c.mins} min`, hist: [{ t: mntIso(), by: 'Fountrix', st: 'open', note: 'Opened by condition trigger' }] };
      e.no = mntWoNo();
      M.log.push(e);
      logEv(`Condition trigger: ${b.name} — ${e.task} → ${e.no}`, 2);
      save();
      mntSend(`cond:${e.id}`, 'cond', b.name, `Condition trigger ${e.no}: ${e.task} — ${e.notes}`, null);
    });
  // stock, warranty, health
  M.parts.forEach(pt => {
    if (R.stock.on && pt.min != null && pt.min !== '' && +pt.stock <= +pt.min) mntSend(`part:${pt.id}:${pt.stock}`, 'stock', 'Spare parts', `Low stock: ${pt.name} — ${+pt.stock} ${pt.unit || ''} left (minimum ${pt.min})`, null);
  });
  Object.entries(M.assets).forEach(([id, a]) => {
    const b = B(id);
    if (!b || !a.warranty || !R.war.on) return;
    const d = (mntDate(a.warranty) - Date.now()) / 864e5;
    if (d >= 0 && d <= +R.war.v) mntSend('war:' + id, 'war', b.name, `Warranty ends in ${Math.ceil(d)} days (${mntFmtD(a.warranty)}) — claim any defect now`, null);
  });
  // equipment health: computed once a minute (it reads the whole log)
  if (Date.now() - (mntCheck.hT || 0) > 6e4) {
    mntCheck.hT = Date.now();
    MNT_HL.clear();
    if (R.health.on && typeof mntHealth === 'function' && Object.values(M.assets).some(a => a.life))
      mntEquip().forEach(b => {
        const h = mntHealth(b);
        if (h.score >= +R.health.v) return;
        if (+R.health.sev) {
          put('mnt:hl:' + b.id, +R.health.sev, { blk: b.id, where: b.name, msg: `Equipment health ${h.score}: ${MNT_REC[h.rec].t} — ${h.why[0] ? h.why[0].why : ''}` });
          MNT_HL.add('mnt:hl:' + b.id);
        }
        mntSend('health:' + b.id + ':' + h.rec, 'health', b.name, `Equipment health ${h.score} — ${MNT_REC[h.rec].t}: ${h.why.map(w => w.why).join('; ')}`, null);
      });
  } else MNT_HL.forEach(k => live.add(k));
  for (const k in ALERTS)
    if (k.startsWith('mnt:') && !live.has(k)) {
      delete ALERTS[k];
      ALV++;
    }
  mntBadge();
}

/* ---------- what fires now (preview) ---------- */
function mntRulePreview(ev) {
  const M = mntDoc(),
    R = mntRules(),
    r = R[ev];
  const out = [];
  if (ev === 'due') M.plans.forEach(p => B(p.blk) && mntState(p).st === 'soon' && out.push(`${B(p.blk).name}: ${p.task}`));
  if (ev === 'over' || ev === 'oversafe') M.plans.forEach(p => B(p.blk) && !!p.crit === (ev === 'oversafe') && mntState(p).st === 'over' && out.push(`${B(p.blk).name}: ${p.task} (${mntState(p).text})`));
  if (ev === 'ovh') M.plans.forEach(p => { const s = mntState(p); B(p.blk) && p.kind === 'ovh' && s.dl != null && s.dl <= +r.v && out.push(`${B(p.blk).name}: ${s.text}`); });
  if (ev.startsWith('req')) mntOpenWO().forEach(e => (e.prio === 'P1' ? 'req1' : e.prio === 'P2' ? 'req2' : 'req3') === ev && out.push(`${e.no} ${B(e.blk)?.name}: ${e.task}`));
  if (ev === 'cond') M.conds.forEach(c => { const t = REG[c.tag]; if (t) { const v = val(c.tag); out.push(`${B(c.blk)?.name} ${t.desc}: now ${fmtN(v, t.d)} ${t.unit || ''} — limit ${c.op} ${c.val} ${(c.op === '<' ? v < +c.val : v > +c.val) ? '· BEYOND LIMIT' : '· ok'}`); } });
  if (ev === 'health' && typeof mntHealth === 'function') mntEquip().forEach(b => { const h = mntHealth(b); h.score < +r.v && out.push(`${b.name}: ${h.score} — ${MNT_REC[h.rec].t}`); });
  if (ev === 'stock') M.parts.forEach(pt => pt.min != null && pt.min !== '' && +pt.stock <= +pt.min && out.push(`${pt.name}: ${pt.stock} ${pt.unit || ''}`));
  if (ev === 'war') Object.entries(M.assets).forEach(([id, a]) => { if (a.warranty && B(id)) { const d = (mntDate(a.warranty) - Date.now()) / 864e5; d >= 0 && d <= +r.v && out.push(`${B(id).name}: ${mntFmtD(a.warranty)}`); } });
  if (ev === 'summary') out.push(mntDueText().split('\n').slice(2, 5).join(' · ') || 'Nothing due');
  return out;
}

/* ---------- Alert rules tab ---------- */
let MNT_RSEL = null;
function mntTabRules(body) {
  const M = mntDoc(),
    R = mntRules();
  const chip = (on, label, data) => `<button class="mnt-tg ${on ? 'on' : ''}" ${data}>${label}</button>`;
  const when = (k, kind, unit) => {
    const r = R[k];
    if (kind === 'lead' || kind === 'grace' || kind === 'thr') return `<input class="mnt-in" type="number" min="0" data-rv="${k}" value="${esc(r.v)}"> <span class="note">${unit}</span>`;
    if (kind === 'time') return `<input class="mnt-in" type="time" data-rv="${k}" value="${esc(r.v)}">`;
    if (kind === 'esc') return '<span class="note">at once</span>';
    return '<span class="note">when it happens</span>';
  };
  const rows = MNT_EV.map(([k, name, desc, kind, unit]) => {
    const r = R[k],
      n = mntRulePreview(k).length;
    return `<tr class="${r.on ? '' : 'mnt-off'} ${MNT_RSEL === k ? 'mnt-rsel' : ''}"><td><label class="mnt-sw"><input type="checkbox" data-ron="${k}" ${r.on ? 'checked' : ''}><i></i></label></td>
   <td><b>${name}</b><div class="note">${desc}</div></td><td style="white-space:nowrap">${when(k, kind, unit)}</td>
   <td><select class="mnt-in" data-rsev="${k}" ${k === 'summary' ? 'disabled' : ''}>${MNT_SEVN.map((s, i) => `<option value="${i}" ${+r.sev === i ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
   <td style="text-align:center"><input type="checkbox" data-rpop="${k}" ${r.pop ? 'checked' : ''}></td>
   <td>${Object.keys(MNT_ROLES).map(x => chip((r.to || []).includes(x), { incharge: 'In-charge', tech: 'Technician', prod: 'Production', store: 'Store' }[x], `data-rto="${k}:${x}"`)).join('')}</td>
   <td>${[['app', 'App'], ['email', 'Email'], ['wa', 'WhatsApp']].map(([c, l]) => chip((r.ch || []).includes(c), l, `data-rch="${k}:${c}"`)).join('')}</td>
   <td style="white-space:nowrap">${r.esc != null ? `<input class="mnt-in" type="number" min="0" step="0.25" data-resc="${k}" value="${r.esc}" style="width:64px"> <span class="note">h → ${(r.escTo || []).map(x => ({ incharge: 'In-charge', prod: 'Production', tech: 'Technician', store: 'Store' })[x]).join(' + ')}</span>` : '<span class="note">—</span>'}</td>
   <td style="white-space:nowrap"><button class="lb" data-rprev="${k}">${n ? `Now: ${n}` : 'Now: 0'}</button><button class="lb" data-rtest="${k}">Test</button></td></tr>`;
  }).join('');
  const prev = MNT_RSEL ? mntRulePreview(MNT_RSEL) : null;
  const tags = b => b.tags.filter(t => REG[t.id] && typeof val(t.id) === 'number');
  body.innerHTML = `<div class="note" style="margin-bottom:8px">Each event: when it is raised, how loud it is in the <b>Fault alarm</b> list (Off = only the Maintenance badge and notifications), who is told, on which channel, and who is told next if nobody acts. <b>App</b> works now; <b>Email</b> and <b>WhatsApp</b> are queued and sent by the Fountrix server (Phase 2).</div>
 <table class="mnt-t mnt-rules"><thead><tr><th>On</th><th>Event</th><th>When</th><th>Fault alarm list</th><th>Pop-up</th><th>Notify</th><th>Channels</th><th>Escalate if not taken up</th><th></th></tr></thead><tbody>${rows}</tbody></table>
 ${prev ? `<div class="mnt-prev"><b>${esc(MNT_EV.find(x => x[0] === MNT_RSEL)[1])} — what fires now (${prev.length})</b>${prev.length ? `<ul>${prev.slice(0, 12).map(x => `<li>${esc(x)}</li>`).join('')}${prev.length > 12 ? `<li class="note">+ ${prev.length - 12} more</li>` : ''}</ul>` : '<div class="note">Nothing at the moment.</div>'}</div>` : ''}
 <div class="mnt-cols" style="margin-top:12px"><div>
  <h5 class="mnt-h5">Condition triggers — open a service request automatically</h5><div class="note">Condition-based maintenance: when a live reading stays beyond its limit for the set minutes, Fountrix opens a service request on that machine (once, until it is closed).</div>
  <table class="mnt-t"><thead><tr><th>Machine</th><th>Reading</th><th>Limit</th><th>For</th><th>Priority</th><th>Now</th><th></th></tr></thead><tbody>${M.conds.map(c => { const t = REG[c.tag]; const v = t ? val(c.tag) : null; const bad = t && (c.op === '<' ? v < +c.val : v > +c.val); return `<tr class="${c.off ? 'mnt-off' : ''}"><td><b>${esc(B(c.blk)?.name || '?')}</b></td><td>${esc(t ? t.desc : c.tag)}</td><td class="mono">${c.op} ${esc(c.val)} ${esc(t?.unit || '')}</td><td class="mono">${c.mins} min</td><td>${mntPrioChip(c.prio)}</td><td class="mono">${t ? `${fmtN(v, t.d)}${bad ? ' <span class="mnt-st mnt-over">beyond</span>' : ''}` : '—'}</td><td style="white-space:nowrap"><button class="lb" data-coff="${c.id}">${c.off ? 'Turn on' : 'Turn off'}</button><button class="lb" data-crm="${c.id}" style="color:var(--crit)">Remove</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="note">No condition triggers yet.</td></tr>'}</tbody></table>
  <div class="mnt-cond-add"><select id="cnB">${mntEquip().filter(b => tags(b).length).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select><select id="cnT"></select><select id="cnO"><option value=">">above</option><option value="<">below</option></select><input id="cnV" type="number" step="any" placeholder="limit"><input id="cnM" type="number" min="0" value="5" title="minutes"><span class="note">min</span><select id="cnP">${['P1', 'P2', 'P3', 'P4'].map(p => `<option ${p === 'P2' ? 'selected' : ''}>${p}</option>`).join('')}</select><button class="ib pri" id="cnAdd">Add trigger</button></div>
 </div><div>
  <h5 class="mnt-h5">Notification log</h5><div class="note">Every notification Fountrix raised — for audit. Email / WhatsApp rows are queued until the server sends them.</div>
  <div class="mnt-outbox">${M.outbox.slice(0, 60).map(o => `<div><span class="mono">${mntFmtD(o.t, true)}</span> <b>${esc(o.where)}</b> — ${esc(o.msg)}<div class="note">${esc((MNT_EV.find(x => x[0] === o.ev) || [, o.ev === '_esc' ? 'Escalation' : o.ev])[1])} → ${esc(o.to.join(', ') || 'no team member with that role')} · ${o.ch.map(c => ({ app: 'App', email: 'Email', wa: 'WhatsApp' })[c]).join(', ')} · ${esc(o.st)}</div></div>`).join('') || '<div class="note">Nothing sent yet.</div>'}</div>
 </div></div>`;
  const redraw = () => (save(), mntCheck(), mntRender());
  $$('#mntBody [data-ron]').forEach(x => (x.onchange = () => ((R[x.dataset.ron].on = x.checked), redraw())));
  $$('#mntBody [data-rv]').forEach(x => (x.onchange = () => ((R[x.dataset.rv].v = x.type === 'time' ? x.value : +x.value), x.dataset.rv === 'due' && (M.cfg.warnDays = +x.value), redraw())));
  $$('#mntBody [data-rsev]').forEach(x => (x.onchange = () => ((R[x.dataset.rsev].sev = +x.value), redraw())));
  $$('#mntBody [data-rpop]').forEach(x => (x.onchange = () => ((R[x.dataset.rpop].pop = x.checked), save())));
  $$('#mntBody [data-resc]').forEach(x => (x.onchange = () => ((R[x.dataset.resc].esc = +x.value), redraw())));
  const tog = (attr, key) =>
    $$(`#mntBody [${attr}]`).forEach(
      x =>
        (x.onclick = () => {
          const [k, v] = x.getAttribute(attr).split(':');
          const a = (R[k][key] = R[k][key] || []);
          const i = a.indexOf(v);
          i >= 0 ? a.splice(i, 1) : a.push(v);
          redraw();
        }),
    );
  tog('data-rto', 'to');
  tog('data-rch', 'ch');
  $$('#mntBody [data-rprev]').forEach(x => (x.onclick = () => ((MNT_RSEL = MNT_RSEL === x.dataset.rprev ? null : x.dataset.rprev), mntRender())));
  $$('#mntBody [data-rtest]').forEach(
    x =>
      (x.onclick = () => {
        const k = x.dataset.rtest,
          r = R[k];
        mntSend('test:' + k + Date.now(), k, 'Test', `Test — ${MNT_EV.find(e => e[0] === k)[1]}`, null, true);
        const ppl = mntPeople(r.to).map(t => t.name);
        toast(`Test sent to ${ppl.join(', ') || 'nobody — add team members with that role'} · ${(r.ch || []).map(c => ({ app: 'App', email: 'Email (queued)', wa: 'WhatsApp (queued)' })[c]).join(', ')}`);
        save();
        mntRender();
      }),
  );
  const cnB = $('#cnB'),
    cnT = $('#cnT');
  const fillT = () => (cnT.innerHTML = (B(cnB.value) ? tags(B(cnB.value)) : []).map(t => `<option value="${esc(t.id)}">${esc(REG[t.id].desc || t.id)} (${esc(REG[t.id].unit || '')})</option>`).join(''));
  if (cnB) {
    cnB.onchange = fillT;
    fillT();
    $('#cnAdd').onclick = () => {
      if (!cnT.value || $('#cnV').value === '') return toast('Pick a reading and enter the limit');
      M.conds.push({ id: mntId('c'), blk: cnB.value, tag: cnT.value, op: $('#cnO').value, val: +$('#cnV').value, mins: +$('#cnM').value || 0, prio: $('#cnP').value });
      toast('Condition trigger added');
      redraw();
    };
  }
  $$('#mntBody [data-coff]').forEach(x => (x.onclick = () => { const c = M.conds.find(q => q.id === x.dataset.coff); c.off = !c.off; redraw(); }));
  $$('#mntBody [data-crm]').forEach(x => (x.onclick = () => { if (!confirmInline(x, 'Remove?')) return; M.conds = M.conds.filter(q => q.id !== x.dataset.crm); redraw(); }));
}
/* demo condition triggers on readings that exist in the demo loop */
function mntDemoConds() {
  mntRules();
  const M = mntDoc();
  if (M.conds.length) return;
  const add = (n, re, op, v, mins, prio, task) => {
    const b = mntEquip().find(x => x.name === n);
    const t = b && b.tags.find(t => REG[t.id] && re.test(t.id));
    if (t) M.conds.push({ id: mntId('c'), blk: b.id, tag: t.id, op, val: v, mins, prio, task });
  };
  add('SO-3', /VIBRATION/i, '>', 8, 2, 'P2', 'Shakeout vibration high — check springs, motors, mounting bolts');
  add('MX-1', /MOTOR_CURRENT/i, '>', 28, 10, 'P3', 'Muller motor current high — check blades / overload');
  add('CD-1', /OUTLET/i, '>', 45, 15, 'P2', 'Sand outlet temperature high — check spray nozzles and water flow');
  add('BE-1', /SPEED/i, '<', 1.2, 2, 'P1', 'Bucket elevator slowing — belt slip');
}
