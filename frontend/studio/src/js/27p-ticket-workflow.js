/*! SandMan Digital Loop Studio — 27p-ticket-workflow.js
 *  v10.4 — Ticket workflow (Item 7), replacing the simple open / closed handling of 27h and the page of 27o.
 *
 *  Life of a ticket
 *    New ──Acknowledge──► Acknowledged ──Start work──► In progress ──Resolve──► Resolved (verifying) ──auto──► Closed
 *                                                        │   ▲                       │
 *                                             Wait (reason, until)  Resume           └─ alert fires again ─► Reopened (In progress)
 *                                                        ▼   │
 *                                                       Waiting (fix clock paused)
 *    Cancel (duplicate / false alarm / not a problem) from New or Acknowledged — supervisor, reason required.
 *    Closed / Cancelled tickets can be reopened with a reason. "Close now" (skip verification) — supervisor.
 *  Required at each step: Waiting → reason + expected date · Resolved → cause category, root cause, action taken.
 *  Deadlines by priority: response (acknowledge) and fix (resolve) hours; the fix clock pauses while Waiting.
 *    Response missed → escalation level 1 (shift in-charge) · fix missed → level 2 (production head).
 *  Verification: after Resolved the alert is watched for the verification days; quiet → closed by the system
 *    ("verified"); fires → reopened to In progress, reopen count + 1.
 *  People: the Maintenance team (name, role, PIN). Signed in as … (PIN) for this browser session.
 *    Supervisors (in-charge, production head) may do everything; others act on tickets of their teams / assigned to them.
 *  Data (with the loop): DOC.tk.list[] tickets, DOC.tk.set settings, DOC.tk.people {person id: [teams]}. */

const TKW_ST = {
  new: ['New', '#1f6feb'],
  ack: ['Acknowledged', '#7c3aed'],
  progress: ['In progress', '#0891b2'],
  waiting: ['Waiting', '#d97706'],
  resolved: ['Resolved · verifying', '#16a34a'],
  closed: ['Closed', '#475569'],
  cancelled: ['Cancelled', '#94a3b8'],
};
const TKW_ACTIVE = ['new', 'ack', 'progress', 'waiting'];
const TKW_PRIO = { High: '#dc2626', Medium: '#d97706', Low: '#64748b' };
const TKW_WAIT = ['Spare part', 'Planned shutdown needed', 'Vendor / contractor', 'Production cannot stop', 'Lab result awaited', 'Other'];
const TKW_CANCEL = ['Duplicate of another ticket', 'False alarm — sensor / instrument fault', 'Not a problem — limit to be reviewed', 'Other'];
const TKW_SET0 = { ackH: { High: 1, Medium: 4, Low: 8 }, fixH: { High: 24, Medium: 72, Low: 168 }, verifyDays: 3 };
const TKW = { view: 'board', q: '', team: '', equip: '', prio: '', mine: false, sel: null, drag: null };

/* ---------- data ---------- */
function tkwDoc() {
  const T = tkDoc();
  T.set.ackH = Object.assign({}, TKW_SET0.ackH, T.set.ackH || {});
  T.set.fixH = Object.assign({}, TKW_SET0.fixH, T.set.fixH || {});
  if (T.set.verifyDays == null) T.set.verifyDays = TKW_SET0.verifyDays;
  T.people = T.people || {};
  T.list.forEach(tkwMigrate);
  return T;
}
function tkwMigrate(t) {
  if (t.v2) return;
  t.v2 = 1;
  if (t.status === 'open') t.status = t.ackAt ? 'ack' : 'new';
  t.source = t.source || 'alert';
  t.paused = t.paused || 0;
  t.created = t.created || Date.now();
  tkwSla(t);
}
function tkwSla(t) {
  const S = tkDoc().set,
    ackH = (S.ackH || TKW_SET0.ackH)[t.prio] || 4,
    fixH = (S.fixH || TKW_SET0.fixH)[t.prio] || 72;
  t.ackDue = t.created + ackH * 3600000;
  t.fixDue = t.created + fixH * 3600000 + (t.paused || 0) + (t.waitFrom ? Date.now() - t.waitFrom : 0);
  t.due = t.fixDue; // the older views read t.due
}
/* ---------- people, sign-in, rights ---------- */
function tkwPeople() {
  const M = typeof mntDoc === 'function' ? mntDoc() : { team: [] };
  return M.team || [];
}
function tkwIsSup(p) {
  return !!p && /incharge|prod/.test(p.rk || '');
}
function tkwTeamsOf(p) {
  const T = tkDoc(),
    all = typeof engDoc === 'function' ? engDoc().teams.map(t => t.name) : [];
  if (!p) return [];
  if (T.people && T.people[p.id]) return T.people[p.id];
  if (tkwIsSup(p)) return all;
  if (/store/.test(p.rk || '')) return [];
  return ['Maintenance'];
}
let TKW_ME = null;
try {
  TKW_ME = sessionStorage.getItem('tkw-me');
} catch (e) {}
function tkwMe() {
  const P = tkwPeople();
  if (!P.length) return { id: '_plant', name: 'Plant user', rk: 'incharge', nopin: true }; // no team set up: one plant user
  return P.find(p => p.id === TKW_ME) || null;
}
function tkwCan(t, act) {
  const me = tkwMe();
  if (!me) return false;
  if (tkwIsSup(me)) return true;
  const mine = tkwTeamsOf(me).includes(t.owner) || t.person === me.name;
  if (act === 'cancel' || act === 'closeNow') return false;
  if (act === 'reopen' || act === 'comment') return true;
  return mine;
}
function tkwWhy(t, act) {
  const me = tkwMe();
  if (!me) return 'Sign in first';
  if (act === 'cancel' || act === 'closeNow') return 'Only a supervisor (in-charge or production head) can do this';
  return `Only the ${t.owner} team, the assigned person or a supervisor can do this`;
}
/* ---------- history and transitions ---------- */
function tkwLog(t, text, kind) {
  const me = tkwMe();
  t.hist.push({ t: Date.now(), by: kind === 'sys' ? 'System' : me ? me.name : 'Operator', text, k: kind || 'act' });
}
function tkwSet(t, st, text) {
  const now = Date.now(),
    was = t.status;
  if (was === 'waiting' && st !== 'waiting' && t.waitFrom) {
    t.paused = (t.paused || 0) + (now - t.waitFrom);
    t.waitFrom = null;
  }
  if (st === 'waiting') t.waitFrom = now;
  if (st === 'ack' && !t.ackAt) t.ackAt = now;
  if (st === 'progress' && !t.startAt) t.startAt = now;
  if (st === 'resolved') {
    t.resolvedAt = now;
    t.verifyUntil = now + (tkDoc().set.verifyDays || 3) * 86400000;
  }
  if (st === 'closed') t.closedAt = now;
  t.status = st;
  tkwSla(t);
  tkwLog(t, text || `${TKW_ST[was] ? TKW_ST[was][0] : was} → ${TKW_ST[st][0]}`);
  /* every status change is emailed to the owner team and the copied teams */
  if (was !== st) tkwStatusMail(t, `${TKW_ST[was] ? TKW_ST[was][0] : was} → ${TKW_ST[st][0]}`, text);
  save();
}
function tkwStatusMail(t, change, note) {
  const me = tkwMe(),
    b = B(t.equip);
  const L = [
    `Subject: Ticket ${t.no} — ${change} — ${t.name}`,
    '',
    `Ticket    : ${t.no} · ${t.name}`,
    `Equipment : ${b ? b.name : '—'}${t.process ? ' · ' + t.process : ''}`,
    `Status    : ${change}`,
    `By        : ${me ? me.name : 'System'} · ${new Date().toLocaleString('en-GB')}`,
    note ? `Note      : ${note}` : '',
    `Owner     : ${t.owner}${t.person ? ' · ' + t.person : ''} · Priority ${t.prio}`,
    t.status !== 'closed' && t.status !== 'cancelled' && t.fixDue ? `Fix by    : ${emTime(t.fixDue)}` : '',
    '',
    'Open the Tickets page in the Digital Loop to see the full history and update the ticket.',
  ].filter(x => x !== '');
  [t.owner, ...(t.cc || [])].filter(Boolean).forEach(team => tkMsg(t, { team, ch: 'email' }, L.join('\n')));
}
/* counting days: "N days in a row" (win = 0) or "N days within the last M days" (win = M) */
function tkwWin(key) {
  const T = tkDoc(),
    r = typeof tkwRule === 'function' ? tkwRule(tkwKeyOf(key)) : null;
  if (r && r.win != null && r.win !== '') return +r.win || 0;
  return +T.set.win || 0;
}
function tkwMinMin(key) {
  const T = tkDoc(),
    r = typeof tkwRule === 'function' ? tkwRule(tkwKeyOf(key)) : null;
  return (r && +r.minMin > 0 && +r.minMin) || +T.set.minMin || 1;
}
function tkwCount(key, D, now) {
  const win = tkwWin(key);
  if (!win) return tkRun(D, now);
  const from = tkDay(now - (win - 1) * 86400000);
  return new Set(D.filter(d => d >= from)).size;
}
/* the story of one day of an alert, for comments and the email */
function tkwFmtVals(o) {
  return Object.entries(o || {})
    .filter(([, v]) => v != null && isFinite(v))
    .map(([k, v]) => `${k} ${fmtN(v, Math.abs(v) < 10 ? 2 : 1)}`)
    .join(', ');
}
function tkwDayLine(key, d) {
  const T = tkDoc(),
    x = T.dlog && T.dlog[key] && T.dlog[key][d];
  const day = new Date(d + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  if (!x) return `${day}: active (details not recorded)`;
  const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const worst = Object.entries(x.worst || {})
    .map(([k, w]) => (w.hi === w.lo ? '' : `${k} ${fmtN(w.lo, 2)}–${fmtN(w.hi, 2)}`))
    .filter(Boolean)
    .join(', ');
  return `${day}: first at ${hm(x.first)}${tkwFmtVals(x.firstVals) ? ` (${tkwFmtVals(x.firstVals)})` : ''}, last at ${hm(x.last)}, active ${x.mins || 1} min in ${x.n || 1} episode${(x.n || 1) > 1 ? 's' : ''}${worst ? ` · range ${worst}` : ''}`;
}
function tkwMail(tk, key, days) {
  const b = B(tk.equip),
    L = [];
  L.push(`Subject: [${tk.prio}] Ticket ${tk.no} — ${tk.name}${b ? ' on ' + b.name : ''}`);
  L.push('');
  L.push(`A ticket was raised because the same alert was active on ${days.length} day${days.length > 1 ? 's' : ''}${tkwWin(key) ? ` within the last ${tkwWin(key)} days` : ' in a row'}.`);
  L.push('');
  L.push(`Equipment : ${b ? b.name : '—'}${tk.process ? ' · ' + tk.process : ''}`);
  L.push(`Alert     : ${tk.name.replace(/ — recurring$/, '')}`);
  L.push(`Owner     : ${tk.owner}${tk.person ? ' · ' + tk.person : ''}`);
  L.push(`Priority  : ${tk.prio} · acknowledge by ${emTime(tk.ackDue)} · fix by ${emTime(tk.fixDue)}`);
  L.push('');
  L.push('When it fired:');
  days.forEach((d, i) => L.push(`  ${i + 1}. ${tkwDayLine(key, d)}`));
  L.push('');
  L.push('Open the Tickets page in the Digital Loop to acknowledge, add notes and close it.');
  return L.join('\n');
}
/* alerts: create / add to / reopen tickets (replaces 27h tkHit) */
tkHit = function (key, name, equip, sev, vals) {
  const T = tkwDoc(),
    now = Date.now(),
    today = tkDay(now),
    D = (T.days[key] = T.days[key] || []);
  let dirty = false;
  /* a day counts once the alert has been active for the rule's minutes that day (default 1 minute) */
  const R = typeof tkwRule === 'function' ? tkwRule(tkwKeyOf(key)) || {} : {},
    minMin = +R.minMin > 0 ? +R.minMin : +T.set.minMin > 0 ? +T.set.minMin : 1;
  T.mins = T.mins || {};
  const M = (T.mins[key] = T.mins[key] || {}),
    minute = Math.floor(now / 60000);
  /* what happened each day: first / last time active, minutes, readings at the start and the worst ones */
  T.dlog = T.dlog || {};
  const DL = (T.dlog[key] = T.dlog[key] || {}),
    dd = (DL[today] = DL[today] || { first: now, firstVals: vals, mins: 0, n: 0, worst: {} });
  if (!dd._on || now - dd.last > 120000) dd.n++; // a new episode after a 2-minute gap
  dd._on = 1;
  dd.last = now;
  dd.lastVals = vals;
  Object.entries(vals || {}).forEach(([k, v]) => {
    if (v == null || !isFinite(v)) return;
    const w = (dd.worst[k] = dd.worst[k] || { hi: v, lo: v });
    w.hi = Math.max(w.hi, v);
    w.lo = Math.min(w.lo, v);
  });
  Object.keys(DL).filter(d => d < tkDay(now - 70 * 86400000)).forEach(d => delete DL[d]);
  if (M._m !== minute) {
    M._m = minute;
    M[today] = (M[today] || 0) + 1;
    dd.mins = M[today];
    Object.keys(M).filter(d => d !== '_m' && d < tkDay(now - 70 * 86400000)).forEach(d => delete M[d]);
    dirty = true;
  }
  if (!D.includes(today) && (M[today] || 0) >= minMin) {
    D.push(today);
    D.splice(0, Math.max(0, D.length - 60));
    dirty = true;
  }
  if (!D.includes(today)) return dirty && save(); // not a bad day yet
  const addTrig = tk => {
    if (now - (tk.last || 0) < 60000) return false;
    tk.last = now;
    tk.count++;
    tk.days = tkwCount(key, D, now);
    tk.trig.unshift({ t: now, vals });
    tk.trig.length = Math.min(tk.trig.length, 60);
    return true;
  };
  let tk = T.list.find(t => t.key === key && TKW_ACTIVE.includes(t.status));
  if (tk) {
    if (tk.dayNoted !== today && (M[today] || 0) >= minMin) {
      tk.dayNoted = today;
      tk.hist.push({ t: now, by: 'System', text: 'Alert again today — ' + tkwDayLine(key, today), k: 'trig' });
      dirty = true;
    }
    return (addTrig(tk) || dirty) && save();
  }
  /* verifying, or closed recently → reopen */
  const back = T.list.find(t => t.key === key && (t.status === 'resolved' || (t.status === 'closed' && now - (t.closedAt || 0) < (T.set.watchDays || 7) * 86400000)));
  if (back) {
    addTrig(back);
    back.reopened = (back.reopened || 0) + 1;
    const was = back.status;
    back.verifyUntil = null;
    back.status = 'progress';
    tkwSla(back);
    back.hist.push({ t: now, by: 'System', text: `Reopened — the alert fired again ${was === 'resolved' ? 'during verification' : 'after closing'}`, k: 'reopen' });
    tkMsg(back, { team: back.owner, ch: 'screen' }, `Ticket ${back.no} reopened — ${back.name} fired again`);
    tkwStatusMail(back, `Reopened — the alert fired again ${was === 'resolved' ? 'during verification' : 'after closing'}`, tkwDayLine(key, today));
    if (back.person) tkMsg(back, { team: back.owner, ch: 'phone' }, `${back.person}: ticket ${back.no} reopened`);
    logEv(`Ticket ${back.no} reopened: ${back.name}`, 2);
    return save();
  }
  const need = tkNeed(key, equip),
    run = tkwCount(key, D, now),
    win = tkwWin(key);
  if (run < need) return dirty && save();
  const o = tkOwner(key, equip),
    b = B(equip),
    area = typeof afZones === 'function' && b ? afZones().find(z => afMembers(z).includes(b)) || null : null;
  tk = {
    no: 'TK-' + String(++T.seq).padStart(4, '0'), key, name: `${name} — recurring`, equip, process: area ? afName(area) : '', source: 'alert', v2: 1,
    first: D.length ? new Date(D[Math.max(0, D.length - run)] + 'T00:00').getTime() : now, last: now, days: run, count: 1,
    trig: [{ t: now, vals }], owner: o.team, person: o.person, cc: o.cc, prio: sev >= 3 ? 'High' : sev === 2 ? 'Medium' : 'Low',
    status: 'new', created: now, paused: 0, esc: 0,
    hist: [{ t: now, by: 'System', text: `Created — the alert was active on ${win ? `${run} of the last ${win} days` : `${run} days in a row`} (rule: ${need} days${win ? ` within ${win}` : ' in a row'}, a day counts after ${tkwMinMin(key)} min active)`, k: 'sys' }],
  };
  tkwSla(tk);
  /* one comment per counted day: when it fired, how long, the readings */
  const counted = [...new Set(D)].sort().filter(d => (win ? d >= tkDay(now - (win - 1) * 86400000) : true)).slice(-run);
  counted.forEach((d, i) => tk.hist.push({ t: now, by: 'System', text: `Day ${i + 1} of ${run} — ${tkwDayLine(key, d)}`, k: 'trig' }));
  tk.dayNoted = today;
  T.list.unshift(tk);
  tkMsg(tk, { team: tk.owner, ch: 'screen' }, `New ticket ${tk.no}: ${tk.name} on ${(b || {}).name || ''}`);
  tkMsg(tk, { team: tk.owner, ch: 'email' }, tkwMail(tk, key, counted));
  (tk.cc || []).forEach(c => tkMsg(tk, { team: c, ch: 'screen' }, `Copy: ticket ${tk.no} — ${tk.name}`));
  logEv(`Ticket ${tk.no} created: ${tk.name}`, 2);
  save();
};
/* deadlines, escalation, verification (replaces 27h tkTimers) */
tkTimers = function () {
  const T = tkwDoc(),
    now = Date.now();
  let dirty = false;
  T.list.forEach(t => {
    if (t.status === 'resolved' && t.verifyUntil && now > t.verifyUntil) {
      t.status = 'closed';
      t.closedAt = now;
      t.closedBy = 'System';
      t.closeNote = `Verified — no repeat for ${T.set.verifyDays} days after the fix`;
      t.hist.push({ t: now, by: 'System', text: `Closed — verified: the alert did not fire for ${T.set.verifyDays} days after the fix`, k: 'sys' });
      tkMsg(t, { team: t.owner, ch: 'screen' }, `Ticket ${t.no} closed — fix verified`);
      return (dirty = true);
    }
    if (!TKW_ACTIVE.includes(t.status)) return;
    tkwSla(t);
    if (t.status === 'new' && now > t.ackDue && (t.esc || 0) < 1) {
      t.esc = 1;
      t.hist.push({ t: now, by: 'System', text: `Response time missed — escalated to ${T.set.esc1}`, k: 'esc' });
      tkMsg(t, { team: T.set.esc1, ch: 'screen' }, `Not acknowledged in time: ticket ${t.no} — ${t.name} (owner ${t.owner})`);
      tkMsg(t, { team: T.set.esc1, ch: 'phone' }, `Ticket ${t.no} not acknowledged`);
      tkMsg(t, { team: T.set.esc1, ch: 'email' }, `Subject: Escalated — ticket ${t.no} not acknowledged in time\n\n${t.name} (owner ${t.owner}${t.person ? ', ' + t.person : ''}) was not acknowledged by ${emTime(t.ackDue)}.`);
      dirty = true;
    }
    if (t.status !== 'waiting' && now > t.fixDue && (t.esc || 0) < 2) {
      t.esc = 2;
      t.hist.push({ t: now, by: 'System', text: `Fix time missed — escalated to ${T.set.esc2}`, k: 'esc' });
      tkMsg(t, { team: T.set.esc2, ch: 'screen' }, `Overdue ticket ${t.no}: ${t.name} (owner ${t.owner}${t.person ? ', ' + t.person : ''})`);
      tkMsg(t, { team: T.set.esc2, ch: 'email' }, `Overdue ticket ${t.no}: ${t.name}`);
      dirty = true;
    }
    if (t.status === 'waiting' && t.waitUntil && now > t.waitUntil && !t.waitLate) {
      t.waitLate = 1;
      t.hist.push({ t: now, by: 'System', text: `Expected date passed while waiting (${t.waitReason})`, k: 'esc' });
      tkMsg(t, { team: t.owner, ch: 'screen' }, `Ticket ${t.no}: waiting longer than expected (${t.waitReason})`);
      dirty = true;
    }
    if (!t.reminded && TKW_ACTIVE.includes(t.status) && t.status !== 'waiting' && t.fixDue - now < (T.set.remindH || 24) * 3600000 && t.fixDue > now) {
      t.reminded = now;
      tkMsg(t, { team: t.owner, ch: 'screen' }, `Reminder: ticket ${t.no} must be fixed by ${emTime(t.fixDue)}`);
      dirty = true;
    }
  });
  if (dirty) save();
};


/* ---------- one ticket rule per alert source: engineered alert ('eng:<id>') or limit alarm of a tag ('lim:<tag>') ----------
   rule = { on (default true), days, owner, person, prio ('' = from the alert's severity), cc:[] }
   Order of precedence: this rule → (engineered alert's own ticket fields) → equipment days → plant default. */
function tkwRule(key) {
  const T = tkDoc();
  T.rules = T.rules || {};
  return T.rules[key] || null;
}
function tkwKeyOf(key) {
  return key.startsWith('lim:') ? 'lim:' + key.slice(4) : key; // alarms key on the tag
}
{
  const needPrev = tkNeed,
    ownerPrev = tkOwner;
  tkNeed = function (key, equip) {
    const r = tkwRule(tkwKeyOf(key));
    if (r && +r.days > 0) return +r.days;
    return needPrev(key, equip);
  };
  tkOwner = function (key, equip) {
    const o = ownerPrev(key, equip),
      r = tkwRule(tkwKeyOf(key));
    if (!r) return o;
    return { team: r.owner || o.team, person: r.person || o.person, cc: r.cc && r.cc.length ? r.cc : o.cc };
  };
  const hitPrev = tkHit;
  tkHit = function (key, name, equip, sev, vals) {
    const r = tkwRule(tkwKeyOf(key));
    if (r && r.on === false) return; // tickets switched off for this alert
    const before = tkDoc().list.length;
    hitPrev(key, name, equip, sev, vals);
    const T = tkDoc();
    if (r && r.prio && T.list.length > before && T.list[0].key === key) {
      T.list[0].prio = r.prio;
      tkwSla(T.list[0]);
      save();
    }
  };
}
/* every alert source in this loop, for the rules table */
function tkwSources() {
  const out = [];
  if (typeof engDoc === 'function')
    engDoc().rules.forEach(r => out.push({ key: 'eng:' + r.id, kind: 'Engineered alert', name: r.name, equip: r.equip, sev: r.sev, on: r.on }));
  Object.keys(REG)
    .filter(id => { const t = REG[id]; return !t.calc || true ? [t.ll, t.lo, t.hi, t.hh].some(v => v != null) : false; })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach(id => {
      const t = REG[id],
        ow = typeof tagOwner === 'function' ? tagOwner(id) : null;
      out.push({ key: 'lim:' + id, kind: t.calc ? 'Calculated tag limit' : 'Tag limit alarm', name: `${t.short || t.desc || id}`, tag: id, equip: ow && ow.b ? ow.b.id : null });
    });
  return out;
}
function tkwRules() {
  const T = tkDoc(),
    S = tkwSources(),
    teams = typeof engDoc === 'function' ? engDoc().teams.map(t => t.name) : [],
    P = tkwPeople();
  T.rules = T.rules || {};
  const W = { q: '', kind: '', only: false };
  const rowH = s => {
    const r = T.rules[s.key] || {},
      eqd = s.equip && T.eqDays[s.equip],
      defDays = (s.key.startsWith('eng:') && typeof engDoc === 'function' && (engDoc().rules.find(x => 'eng:' + x.id === s.key) || {}).tkDays) || eqd || T.set.days,
      o = tkOwner(s.key, s.equip);
    return `<tr data-rk="${esc(s.key)}" class="${r.on === false ? 'off' : ''}"><td><input type="checkbox" data-rf="on" ${r.on === false ? '' : 'checked'} title="Make tickets for this alert"></td>
     <td><b>${esc(s.name)}</b><div class="note">${esc(s.kind)}${s.tag ? ' · ' + esc(s.tag) : ''}</div></td><td>${esc((B(s.equip) || {}).name || '—')}</td>
     <td><input type="number" min="1" data-rf="days" value="${r.days || ''}" placeholder="${defDays}" style="width:52px"></td>
     <td><input type="number" min="0" data-rf="win" value="${r.win != null ? r.win : ''}" placeholder="${+T.set.win ? T.set.win : 'in a row'}" style="width:74px" title="Count the days within this many days (blank = plant default; 0 = in a row)"></td>
     <td><input type="number" min="1" data-rf="minMin" value="${r.minMin || ''}" placeholder="${+T.set.minMin || 1}" style="width:52px" title="A day counts when the alert was active at least this many minutes"></td>
     <td><select data-rf="owner"><option value="">${esc(o.team)} (default)</option>${teams.map(t => `<option ${r.owner === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
     <td><select data-rf="person"><option value="">${o.person ? esc(o.person) + ' (default)' : '—'}</option>${P.map(p => `<option ${r.person === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
     <td><select data-rf="prio"><option value="">Auto (severity)</option>${['High', 'Medium', 'Low'].map(p => `<option ${r.prio === p ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
     <td>${r.days || r.owner || r.person || r.prio || r.on === false ? '<button class="lk" data-rclr title="Back to the defaults">reset</button>' : ''}</td></tr>`;
  };
  const draw = () => {
    const L = S.filter(s => (!W.kind || s.kind === W.kind) && (!W.only || T.rules[s.key]) && (!W.q || (s.name + ' ' + (s.tag || '') + ' ' + ((B(s.equip) || {}).name || '')).toLowerCase().includes(W.q.toLowerCase())));
    $('#tkwRb').innerHTML = L.slice(0, 400).map(rowH).join('') || '<tr><td colspan="10" class="note">Nothing matches.</td></tr>';
    $('#tkwRn').textContent = `${L.length} of ${S.length} alert sources · ${Object.keys(T.rules).length} with their own rule`;
    $$('#tkwRb tr[data-rk]').forEach(tr => {
      const k = tr.dataset.rk;
      tr.querySelectorAll('[data-rf]').forEach(i => (i.onchange = () => {
        const r = (T.rules[k] = T.rules[k] || {}),
          f = i.dataset.rf;
        if (f === 'on') r.on = i.checked ? undefined : false;
        else if (f === 'days' || f === 'minMin') r[f] = i.value ? +i.value : undefined;
        else if (f === 'win') r.win = i.value === '' ? undefined : +i.value;
        else r[f] = i.value || undefined;
        Object.keys(r).forEach(x => r[x] === undefined && delete r[x]);
        if (!Object.keys(r).length) delete T.rules[k];
        save();
        draw();
      }));
      const c = tr.querySelector('[data-rclr]');
      if (c) c.onclick = () => (delete T.rules[k], save(), draw());
    });
  };
  openModal(
    `<h3>Ticket rules — for each alert</h3>
   <div class="note">The same rule for engineered alerts and for every parameter's limit alarm: does it make tickets, after how many bad days (in a row, or N within the last M days), how many minutes make a bad day, who owns it, who does the work, and its priority. Empty = the default shown in grey (alert → equipment → plant: ${T.set.days} days, ${esc(T.set.owner)}).</div>
   <div class="tkw-bar" style="margin:10px 0"><input class="tkw-q" id="tkwRq" placeholder="Search alert, tag or equipment…"><select id="tkwRkind"><option value="">All alert types</option><option>Engineered alert</option><option>Tag limit alarm</option><option>Calculated tag limit</option></select><label class="tkw-mine"><input type="checkbox" id="tkwRonly"> Only with their own rule</label><span class="note" id="tkwRn"></span></div>
   <div class="tbl-wrap" style="max-height:56vh;overflow:auto"><table class="tkw-tb small tkw-rules"><thead><tr><th>On</th><th>Alert</th><th>Equipment</th><th title="How many bad days make a ticket">Days</th><th title="…within how many days (blank / 0 = in a row)">Within</th><th title="Minutes the alert must be active for a day to count">Min/day</th><th>Owner team</th><th>Person</th><th>Priority</th><th></th></tr></thead><tbody id="tkwRb"></tbody></table></div>
   <div class="em-row" style="margin-top:10px"><label>Plant default: a ticket when the alert is active on</label><input type="number" min="1" id="tkwRdef" value="${T.set.days}" style="width:56px"><span>days</span><select id="tkwRwin"><option value="0" ${!+T.set.win ? 'selected' : ''}>in a row</option>${[5, 7, 10, 14, 30].map(w => `<option value="${w}" ${+T.set.win === w ? 'selected' : ''}>within the last ${w} days</option>`).join('')}</select><span>· a day counts after</span><input type="number" min="1" id="tkwRmin" value="${+T.set.minMin || 1}" style="width:52px"><span>min active · owner</span><select id="tkwRdo">${teams.map(t => `<option ${T.set.owner === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><button class="lk" id="tkwReq">Days per equipment…</button></div>
   <div class="mact"><button class="ib pri" id="tkwRok">Done</button></div>`,
    'xl',
  );
  $('#tkwRq').oninput = e => ((W.q = e.target.value), draw());
  $('#tkwRkind').onchange = e => ((W.kind = e.target.value), draw());
  $('#tkwRonly').onchange = e => ((W.only = e.target.checked), draw());
  $('#tkwRdef').onchange = e => ((T.set.days = +e.target.value || 3), save(), draw());
  $('#tkwRdo').onchange = e => ((T.set.owner = e.target.value), save(), draw());
  $('#tkwRwin').onchange = e => ((T.set.win = +e.target.value), save(), draw());
  $('#tkwRmin').onchange = e => ((T.set.minMin = Math.max(1, +e.target.value || 1)), save(), draw());
  $('#tkwReq').onclick = () => {
    openModal(tkSettingsHTML(), 'wide');
    $$('#mbox [data-tkset]').forEach(i => (i.onchange = () => ((T.set[i.dataset.tkset] = i.type === 'number' ? +i.value : i.value), save())));
    $$('#mbox [data-tkeq]').forEach(i => (i.onchange = () => (i.value ? (T.eqDays[i.dataset.tkeq] = +i.value) : delete T.eqDays[i.dataset.tkeq], save())));
    $('#tkSetClose').onclick = tkwRules;
  };
  $('#tkwRok').onclick = () => (closeModal(), TKP.on && tkwPage(true));
  draw();
}

/* ---------- small view helpers ---------- */
const tkwChip = st => `<span class="tkw-st" style="--c:${TKW_ST[st][1]}">${TKW_ST[st][0]}</span>`;
const tkwPrio = p => `<span class="tkw-pr" style="--c:${TKW_PRIO[p] || '#64748b'}">${esc(p)}</span>`;
function tkwLeft(ms) {
  const a = Math.abs(ms),
    h = a / 3600000;
  const s = h >= 48 ? Math.round(h / 24) + ' d' : h >= 1 ? Math.round(h) + ' h' : Math.max(1, Math.round(a / 60000)) + ' min';
  return ms < 0 ? s + ' late' : s + ' left';
}
function tkwClock(t) {
  const now = Date.now();
  if (t.status === 'new') return { txt: 'Respond: ' + tkwLeft(t.ackDue - now), bad: now > t.ackDue, warn: t.ackDue - now < 3600000 };
  if (t.status === 'waiting') return { txt: 'Paused · ' + esc(t.waitReason || 'waiting'), bad: false, paused: true };
  if (TKW_ACTIVE.includes(t.status)) return { txt: 'Fix: ' + tkwLeft(t.fixDue - now), bad: now > t.fixDue, warn: t.fixDue - now < 8 * 3600000 };
  if (t.status === 'resolved') return { txt: 'Verifying · ' + tkwLeft(t.verifyUntil - now).replace(' left', ''), ok: true };
  return null;
}
const tkwIni = n => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function tkwFilter(L) {
  const me = tkwMe(),
    q = TKW.q.trim().toLowerCase();
  return L.filter(
    t =>
      (!TKW.team || t.owner === TKW.team) &&
      (!TKW.equip || t.equip === TKW.equip) &&
      (!TKW.prio || t.prio === TKW.prio) &&
      (!TKW.mine || (me && (t.person === me.name || tkwTeamsOf(me).includes(t.owner)))) &&
      (!q || `${t.no} ${t.name} ${(B(t.equip) || {}).name || ''} ${t.owner} ${t.person || ''}`.toLowerCase().includes(q)),
  );
}

/* ---------- page ---------- */
function tkwKpis(T) {
  const now = Date.now(),
    L = T.list,
    act = L.filter(t => TKW_ACTIVE.includes(t.status));
  const late = act.filter(t => (t.status === 'new' && now > t.ackDue) || (t.status !== 'waiting' && now > t.fixDue)).length;
  const fixed = L.filter(t => t.resolvedAt && now - t.resolvedAt < 30 * 86400000);
  const mttr = fixed.length ? fixed.reduce((a, t) => a + Math.max(0, t.resolvedAt - t.created - (t.paused || 0)), 0) / fixed.length : null;
  const reo = L.filter(t => t.reopened).length;
  const k = (n, l, c, f) => `<button type="button" class="tkw-k${c ? ' ' + c : ''}" ${f ? `data-kf="${f}"` : ''}><b>${n}</b><span>${l}</span></button>`;
  return `<div class="tkw-kpis">${k(L.filter(t => t.status === 'new').length, 'New · not acknowledged', L.some(t => t.status === 'new' && now > t.ackDue) ? 'bad' : '')}${k(L.filter(t => t.status === 'ack' || t.status === 'progress').length, 'Being worked on')}${k(L.filter(t => t.status === 'waiting').length, 'Waiting')}${k(late, 'Late (response or fix)', late ? 'bad' : '')}${k(L.filter(t => t.status === 'resolved').length, 'Resolved · verifying', 'ok')}${k(mttr == null ? '—' : emDur(mttr), 'Average time to fix (30 d)')}${k(L.length ? Math.round((reo / L.length) * 100) + ' %' : '—', 'Tickets reopened')}</div>`;
}
function tkwCard(t) {
  const c = tkwClock(t),
    b = B(t.equip);
  return `<div class="tkw-card${t.no === TKW.sel ? ' sel' : ''}" draggable="true" data-tkw="${t.no}" style="--p:${TKW_PRIO[t.prio] || '#94a3b8'}">
  <div class="tkw-c1"><b>${t.no}</b>${tkwPrio(t.prio)}${t.reopened ? `<span class="tkw-re" title="Reopened ${t.reopened}×">↺${t.reopened}</span>` : ''}${t.source === 'manual' ? '<span class="tkw-man" title="Raised by a person">manual</span>' : ''}</div>
  <div class="tkw-c2">${esc(t.name)}</div>
  <div class="tkw-c3"><span>${esc((b || {}).name || '—')}</span><span>${t.source === 'manual' ? '' : `${t.days} d · ${t.count}×`}</span></div>
  <div class="tkw-c4">${c ? `<span class="tkw-clk${c.bad ? ' bad' : c.warn ? ' warn' : c.ok ? ' ok' : ''}">${c.txt}</span>` : '<span></span>'}<span class="tkw-av" title="${esc(t.person || 'Not assigned') + ' · ' + esc(t.owner)}">${t.person ? tkwIni(t.person) : '—'}</span></div></div>`;
}
function tkwBoard(T) {
  const now = Date.now(),
    L = tkwFilter(T.list);
  const cols = [
    ['new', 'New'],
    ['ack', 'Acknowledged'],
    ['progress', 'In progress'],
    ['waiting', 'Waiting'],
    ['resolved', 'Resolved · verifying'],
    ['closed', 'Closed · last 7 days'],
  ];
  return `<div class="tkw-board">${cols
    .map(([st, lab]) => {
      const items = L.filter(t => (st === 'closed' ? (t.status === 'closed' || t.status === 'cancelled') && now - (t.closedAt || t.cancelAt || 0) < 7 * 86400000 : t.status === st)).sort((a, b) => (TKW_PRIO[a.prio] === TKW_PRIO[b.prio] ? a.created - b.created : ['High', 'Medium', 'Low'].indexOf(a.prio) - ['High', 'Medium', 'Low'].indexOf(b.prio)));
      return `<div class="tkw-col" data-col="${st}"><div class="tkw-ch" style="--c:${TKW_ST[st][1]}"><b>${lab}</b><span>${items.length}</span></div><div class="tkw-cl">${items.map(tkwCard).join('') || '<div class="tkw-empty">—</div>'}</div></div>`;
    })
    .join('')}</div>`;
}
function tkwTable(T) {
  const L = tkwFilter(T.list).sort((a, b) => b.created - a.created);
  return `<table class="tkw-tb"><thead><tr><th>Ticket</th><th>Problem</th><th>Equipment</th><th>Priority</th><th>Status</th><th>Clock</th><th>Owner · person</th><th>Days · times</th><th>Created</th></tr></thead><tbody>${
    L.map(t => {
      const c = tkwClock(t);
      return `<tr data-tkw="${t.no}" class="${t.no === TKW.sel ? 'sel' : ''}"><td><b>${t.no}</b>${t.reopened ? ` <span class="tkw-re">↺${t.reopened}</span>` : ''}</td><td>${esc(t.name)}</td><td>${esc((B(t.equip) || {}).name || '—')}</td><td>${tkwPrio(t.prio)}</td><td>${tkwChip(t.status)}</td><td>${c ? `<span class="tkw-clk${c.bad ? ' bad' : c.warn ? ' warn' : c.ok ? ' ok' : ''}">${c.txt}</span>` : '—'}</td><td>${esc(t.owner)}${t.person ? ' · ' + esc(t.person) : ''}</td><td>${t.source === 'manual' ? '—' : `${t.days} · ${t.count}`}</td><td>${emTime(t.created)}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="note">No tickets match.</td></tr>'
  }</tbody></table>`;
}
function tkwSteps(t) {
  const order = ['new', 'ack', 'progress', 'resolved', 'closed'],
    lab = { new: 'New', ack: 'Acknowledged', progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
  const cur = t.status === 'waiting' ? 'progress' : t.status === 'cancelled' ? null : t.status,
    ci = order.indexOf(cur);
  if (t.status === 'cancelled') return `<div class="tkw-steps"><div class="tkw-stp done">New</div><div class="tkw-stp cancel">Cancelled — ${esc(t.cancelReason || '')}</div></div>`;
  const at = { new: t.created, ack: t.ackAt, progress: t.startAt, resolved: t.resolvedAt, closed: t.closedAt };
  return `<div class="tkw-steps">${order.map((s, i) => `<div class="tkw-stp${i < ci ? ' done' : i === ci ? ' cur' : ''}"><b>${lab[s]}${s === 'progress' && t.status === 'waiting' ? ' · waiting' : ''}</b><span>${at[s] && i <= ci ? emTime(at[s]) : ''}</span></div>`).join('')}</div>`;
}
function tkwActions(t) {
  const A = [];
  const btn = (act, label, cls) => {
    const ok = tkwCan(t, act);
    A.push(`<button type="button" class="tkw-ab ${cls || ''}" data-act="${act}" ${ok ? '' : `disabled title="${esc(tkwWhy(t, act))}"`}>${label}</button>`);
  };
  if (t.status === 'new') btn('ack', '✓ Acknowledge', 'pri');
  if (t.status === 'ack') btn('start', '▶ Start work', 'pri');
  if (t.status === 'waiting') btn('resume', '▶ Resume work', 'pri');
  if (t.status === 'ack' || t.status === 'progress') btn('resolve', '✔ Resolve…', t.status === 'progress' ? 'pri' : '');
  if (t.status === 'progress') btn('wait', '⏸ Waiting…');
  if (TKW_ACTIVE.includes(t.status)) btn('assign', '👤 Assign…');
  if (TKW_ACTIVE.includes(t.status) && typeof mntForm === 'function') btn('wo', '🔧 Work order');
  if (t.status === 'resolved') btn('closeNow', 'Close now (skip verification)…');
  if (t.status === 'new' || t.status === 'ack') btn('cancel', 'Cancel ticket…', 'warn');
  if (['resolved', 'closed', 'cancelled'].includes(t.status)) btn('reopen', '↺ Reopen…', 'warn');
  return `<div class="tkw-acts">${A.join('')}</div>`;
}
function tkwTrend(t) {
  const pts = t.trig.slice().reverse().map(x => {
    const v = x.vals ? x.vals.X ?? x.vals.A ?? Object.values(x.vals).find(v => v != null && isFinite(v)) : null;
    return { t: x.t, v };
  }).filter(p => p.v != null && isFinite(p.v));
  if (pts.length < 2) return pts.length ? `<div class="note">One trigger so far: ${fmtN(pts[0].v, 2)} at ${emTime(pts[0].t)}</div>` : '';
  const lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v)), W = 500, H = 90, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = tt => 30 + ((tt - t0) / Math.max(1, t1 - t0)) * (W - 40), y = v => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 28);
  return `<svg class="tkw-tr" viewBox="0 0 ${W} ${H}"><text x="2" y="${y(hi) + 4}">${fmtN(hi, 1)}</text><text x="2" y="${y(lo) + 4}">${fmtN(lo, 1)}</text><polyline points="${pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}"/>${pts.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3"><title>${emTime(p.t)} · ${fmtN(p.v, 2)}</title></circle>`).join('')}<text x="30" y="${H - 1}">${emTime(t0)}</text><text x="${W - 10}" y="${H - 1}" text-anchor="end">${emTime(t1)}</text></svg>`;
}
function tkwDetail(t) {
  if (!t) return '';
  tkwSla(t);
  const now = Date.now(),
    b = B(t.equip),
    c = tkwClock(t);
  const sla = `<div class="tkw-sla"><div class="${t.ackAt ? (t.ackAt <= t.ackDue ? 'ok' : 'bad') : now > t.ackDue ? 'bad' : ''}"><span>Response by</span><b>${emTime(t.ackDue)}</b><small>${t.ackAt ? `acknowledged ${emTime(t.ackAt)}${t.ackAt > t.ackDue ? ' · late' : ' · in time'}` : now > t.ackDue ? 'late · escalated to ' + esc(tkDoc().set.esc1) : tkwLeft(t.ackDue - now)}</small></div>
   <div class="${t.resolvedAt ? (t.resolvedAt <= t.fixDue ? 'ok' : 'bad') : t.status === 'waiting' ? 'pause' : now > t.fixDue ? 'bad' : ''}"><span>Fix by</span><b>${emTime(t.fixDue)}</b><small>${t.resolvedAt ? `resolved ${emTime(t.resolvedAt)}${t.resolvedAt > t.fixDue ? ' · late' : ' · in time'}` : t.status === 'waiting' ? 'clock paused while waiting' : now > t.fixDue ? 'late · escalated to ' + esc(tkDoc().set.esc2) : tkwLeft(t.fixDue - now)}${t.paused ? ` · paused ${emDur(t.paused)}` : ''}</small></div>
   ${t.status === 'resolved' ? `<div class="ok"><span>Verification until</span><b>${emTime(t.verifyUntil)}</b><small>closes by itself if the alert stays quiet</small></div>` : ''}</div>`;
  const people = tkwPeople();
  const info = `<div class="tkw-info">
   <div><span>Equipment</span><b>${esc((b || {}).name || '—')}</b>${b ? `<button class="lk" id="tkwLoc">⌖ Locate</button>` : ''}</div><div><span>Process</span><b>${esc(t.process || '—')}</b></div>
   <div><span>Owner team</span><b>${esc(t.owner)}</b></div><div><span>Assigned to</span><b>${esc(t.person || '— not assigned')}</b></div>
   <div><span>Copy to</span><b>${esc((t.cc || []).join(', ') || '—')}</b></div><div><span>Source</span><b>${t.source === 'manual' ? 'Raised by ' + esc(t.raisedBy || 'a person') : 'Repeated alert'}</b></div>
   ${t.source === 'manual' ? '' : `<div><span>First / latest trigger</span><b>${emTime(t.first)} · ${emTime(t.last)}</b></div><div><span>Days in a row · times</span><b>${t.days} days · ${t.count}×</b></div>`}
   ${t.wo ? `<div><span>Work order</span><b>${esc(t.wo)}</b></div>` : ''}
  </div>`;
  const res = t.res ? `<div class="tkw-res"><b>Resolution</b><div><span>Category</span>${esc(t.res.cat)}${t.res.cause ? ` · ${esc(t.res.cause)}` : ''}</div><div><span>Root cause</span>${esc(t.res.root)}</div><div><span>Action taken</span>${esc(t.res.action)}</div>${t.res.prevent ? `<div><span>To prevent it</span>${esc(t.res.prevent)}</div>` : ''}<small>by ${esc(t.res.by)} · ${emTime(t.res.at)}</small></div>` : '';
  const icon = k => ({ sys: '⚙', esc: '⚠', reopen: '↺', note: '💬' })[k] || '●';
  const tl = `<div class="tkw-tl">${t.hist.slice().reverse().map(h => `<div class="tkw-ev ${h.k || ''}"><i>${icon(h.k)}</i><div><b>${esc(h.by)}</b> <span>${emTime(h.t)}</span><p>${esc(h.text)}</p></div></div>`).join('')}</div>`;
  return `<div class="tkw-dr-h"><div><div class="tkw-dno">${t.no} ${tkwPrio(t.prio)} ${tkwChip(t.status)}${t.reopened ? ` <span class="tkw-re">Reopened ${t.reopened}×</span>` : ''}</div><h3>${esc(t.name)}</h3></div><button class="tkw-x" id="tkwDrX" title="Close">✕</button></div>
  ${tkwSteps(t)}${tkwActions(t)}${sla}${info}${res}
  ${t.source === 'manual' && t.desc ? `<div class="tkw-sec">Description</div><p class="tkw-desc">${esc(t.desc)}</p>` : ''}
  ${t.source === 'manual' ? '' : `<div class="tkw-sec">Readings at each trigger</div>${tkwTrend(t)}`}
  <div class="tkw-sec">Activity</div><div class="tkw-cm"><input id="tkwCm" placeholder="Add a comment — what was checked, part ordered …"><button class="tkw-ab" id="tkwCmB">Comment</button></div>${tl}`;
}
function tkwPage(force) {
  const box = $('#tkBox');
  if (!box) return;
  const ae = document.activeElement;
  if (!force && ae && box.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
  if (!force && TKW.drag) return;
  const T = tkwDoc(),
    me = tkwMe(),
    P = tkwPeople(),
    teams = typeof engDoc === 'function' ? engDoc().teams.map(t => t.name) : [],
    eqs = [...new Set(T.list.map(t => t.equip).filter(Boolean))];
  const sel = (k, opts) => `<select data-tkwf="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${TKW[k] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const t = TKW.sel && T.list.find(x => x.no === TKW.sel);
  const html = `<div class="tkp-hd"><h2>Tickets</h2><span class="tkp-sub">Repeated alerts and reported problems — owned, timed and closed only when the fix is verified.</span>
   <span class="tkp-hr"><span class="tkw-me">${me ? `<span class="tkw-av big">${tkwIni(me.name)}</span><span><b>${esc(me.name)}</b><small>${tkwIsSup(me) ? 'Supervisor' : esc(tkwTeamsOf(me).join(', ') || me.role || '')}</small></span>` : '<b class="tkp-red">Not signed in</b>'}${P.length ? `<button class="lk" id="tkwSign">${me ? 'Switch' : 'Sign in'}</button>` : ''}</span>
   <button class="tkw-ab pri" id="tkwNew">＋ New ticket</button><button class="lk" id="tkwRul">Ticket rules</button><button class="lk" id="tkwSet">Settings</button><button class="lk" id="tkpAlerts">Alert monitoring…</button><button class="tkp-x" id="tkpClose" title="Back to the loop">✕</button></span></div>
   ${tkwKpis(T)}
   <div class="tkw-bar"><div class="lc2-seg tkw-vs"><button type="button" data-tkv="board" aria-pressed="${TKW.view === 'board'}">Board</button><button type="button" data-tkv="list" aria-pressed="${TKW.view === 'list'}">List</button></div>
   <input class="tkw-q" id="tkwQ" placeholder="Search ticket, problem, equipment, person…" value="${esc(TKW.q)}">${sel('team', [['', 'All teams'], ...teams.map(x => [x, x])])}${sel('equip', [['', 'All equipment'], ...eqs.map(id => [id, (B(id) || {}).name || id])])}${sel('prio', [['', 'All priorities'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']])}
   <label class="tkw-mine"><input type="checkbox" id="tkwMine" ${TKW.mine ? 'checked' : ''}> My tickets</label></div>
   <div class="tkw-main${t ? ' has-dr' : ''}"><div class="tkw-lst">${TKW.view === 'board' ? tkwBoard(T) : tkwTable(T)}</div>${t ? `<aside class="tkw-dr" id="tkwDr">${tkwDetail(t)}</aside>` : ''}</div>`;
  tkBtnSync();
  if (box.dataset.h === html) return;
  const scr = { b: box.querySelector('.tkw-lst') ? box.querySelector('.tkw-lst').scrollTop : 0, d: box.querySelector('#tkwDr') ? box.querySelector('#tkwDr').scrollTop : 0 };
  box.dataset.h = html;
  box.innerHTML = html;
  if (box.querySelector('.tkw-lst')) box.querySelector('.tkw-lst').scrollTop = scr.b;
  if (box.querySelector('#tkwDr')) box.querySelector('#tkwDr').scrollTop = scr.d;
  tkwBind(T, t);
}
tkPageRender = tkwPage;

/* ---------- dialogs (required fields) ---------- */
function tkwDlg(title, body, okLabel, onOk, danger) {
  openModal(`<h3>${title}</h3>${body}<div class="mact"><button class="ib" id="tkwDc">Cancel</button><button class="ib ${danger ? 'danger' : 'pri'}" id="tkwDo">${okLabel}</button></div>`);
  $('#tkwDc').onclick = closeModal;
  $('#tkwDo').onclick = () => {
    const err = onOk();
    if (err) return toast(err);
    closeModal();
    tkwPage(true);
  };
}
const tkwF = (lab, h) => `<div class="fld" style="margin:8px 0"><label>${lab}</label>${h}</div>`;
function tkwAct(t, act) {
  if (!tkwCan(t, act)) return toast(tkwWhy(t, act));
  const me = tkwMe(),
    T = tkDoc();
  const ppl = tkwPeople();
  const pplSel = (id, cur) => `<select id="${id}"><option value="">— not assigned</option>${ppl.map(p => `<option ${cur === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  if (act === 'ack') {
    if (!t.person && me && !me.nopin) t.person = me.name;
    tkwSet(t, 'ack', `Acknowledged${t.person ? ' — assigned to ' + t.person : ''}`);
    tkMsg(t, { team: t.owner, ch: 'screen' }, `Ticket ${t.no} acknowledged by ${me.name}`);
    return tkwPage(true);
  }
  if (act === 'start') return tkwSet(t, 'progress', 'Work started'), tkwPage(true);
  if (act === 'resume') return tkwSet(t, 'progress', `Work resumed (was waiting: ${t.waitReason || ''})`), tkwPage(true);
  if (act === 'assign')
    return tkwDlg(`Assign ${t.no}`, tkwF('Owner team', `<select id="tkwAT">${(typeof engDoc === 'function' ? engDoc().teams : []).map(x => `<option ${t.owner === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`) + tkwF('Person', pplSel('tkwAP', t.person)) + tkwF('Priority', `<select id="tkwAPr">${['High', 'Medium', 'Low'].map(p => `<option ${t.prio === p ? 'selected' : ''}>${p}</option>`).join('')}</select>`), 'Save', () => {
      const tm = $('#tkwAT').value, pe = $('#tkwAP').value, pr = $('#tkwAPr').value;
      const ch = [];
      if (tm !== t.owner) ch.push(`team ${t.owner} → ${tm}`);
      if (pe !== (t.person || '')) ch.push(`person → ${pe || 'not assigned'}`);
      if (pr !== t.prio) ch.push(`priority ${t.prio} → ${pr}`);
      if (!ch.length) return;
      Object.assign(t, { owner: tm, person: pe, prio: pr });
      tkwSla(t);
      tkwLog(t, 'Changed: ' + ch.join(', '));
      if (pe) tkMsg(t, { team: tm, ch: 'phone' }, `${pe}: ticket ${t.no} assigned to you — ${t.name}`);
      save();
    });
  if (act === 'wait')
    return tkwDlg(`Put ${t.no} on hold`, tkwF('Waiting for', `<select id="tkwWR">${TKW_WAIT.map(r => `<option>${r}</option>`).join('')}</select>`) + tkwF('Expected by', `<input type="date" id="tkwWD" value="${tkDay(Date.now() + 2 * 86400000)}">`) + tkwF('Note', `<input id="tkwWN" placeholder="e.g. bearing 6312 ordered, PO 4512">`) + '<p class="note">The fix clock pauses while the ticket is waiting.</p>', 'Put on hold', () => {
      const d = $('#tkwWD').value;
      if (!d) return 'Give the expected date';
      t.waitReason = $('#tkwWR').value;
      t.waitUntil = new Date(d + 'T18:00').getTime();
      t.waitLate = 0;
      tkwSet(t, 'waiting', `Waiting: ${t.waitReason} — expected ${new Date(t.waitUntil).toLocaleDateString('en-GB')}${$('#tkwWN').value.trim() ? ' — ' + $('#tkwWN').value.trim() : ''}`);
    });
  if (act === 'resolve') {
    const F = typeof MNT_FAIL === 'object' ? MNT_FAIL : { p: ['Mechanical', 'Electrical', 'Process', 'Instrumentation / sensor', 'Other'], c: [], a: [] };
    return tkwDlg(
      `Resolve ${t.no}`,
      `<p class="note">${esc(t.name)} — after this the alert is watched for ${T.set.verifyDays} days; the ticket closes by itself if it stays quiet, and reopens if it fires again.</p>` +
        `<div class="tkw-2">${tkwF('Problem area *', `<select id="tkwRC"><option value="">Choose…</option>${F.p.map(x => `<option>${x}</option>`).join('')}<option>Process / sand condition</option><option>Limit / alert setting</option></select>`)}${tkwF('Cause type', `<select id="tkwRK"><option value="">—</option>${(F.c || []).map(x => `<option>${x}</option>`).join('')}</select>`)}</div>` +
        tkwF('Root cause found *', `<textarea id="tkwRR" rows="2" placeholder="e.g. 2 of 8 water nozzles blocked with fines"></textarea>`) +
        tkwF('Action taken *', `<textarea id="tkwRA" rows="2" placeholder="e.g. nozzles cleaned, strainer fitted; ΔT back to 18 °C"></textarea>`) +
        tkwF('To stop it coming back (optional)', `<input id="tkwRP" placeholder="e.g. add nozzle cleaning to the weekly PM">`),
      'Resolve',
      () => {
        const cat = $('#tkwRC').value, root = $('#tkwRR').value.trim(), action = $('#tkwRA').value.trim();
        if (!cat || !root || !action) return 'Problem area, root cause and action taken are required';
        t.res = { cat, cause: $('#tkwRK').value, root, action, prevent: $('#tkwRP').value.trim(), by: me.name, at: Date.now() };
        if (t.status === 'ack' && !t.startAt) t.startAt = Date.now();
        tkwSet(t, 'resolved', `Resolved — ${cat}: ${root}. Action: ${action}`);
        tkMsg(t, { team: t.owner, ch: 'screen' }, `Ticket ${t.no} resolved by ${me.name} — verifying for ${T.set.verifyDays} days`);
      },
    );
  }
  if (act === 'closeNow')
    return tkwDlg(`Close ${t.no} now`, '<p class="note">Skips the verification period. Use when the fix is proven (e.g. part replaced and checked).</p>' + tkwF('Reason *', `<input id="tkwCN" placeholder="e.g. checked on trial run, readings normal">`), 'Close ticket', () => {
      const n = $('#tkwCN').value.trim();
      if (!n) return 'A reason is required';
      Object.assign(t, { closedBy: me.name, closeNote: n });
      tkwSet(t, 'closed', `Closed without waiting for verification — ${n}`);
    });
  if (act === 'cancel')
    return tkwDlg(`Cancel ${t.no}`, tkwF('Reason *', `<select id="tkwXR">${TKW_CANCEL.map(r => `<option>${r}</option>`).join('')}</select>`) + tkwF('Note *', `<input id="tkwXN" placeholder="e.g. duplicate of TK-0012 / radar dirty, cleaned">`), 'Cancel ticket', () => {
      const n = $('#tkwXN').value.trim();
      if (!n) return 'A note is required';
      t.cancelReason = $('#tkwXR').value;
      t.cancelAt = Date.now();
      tkwSet(t, 'cancelled', `Cancelled — ${t.cancelReason}: ${n}`);
    }, true);
  if (act === 'reopen')
    return tkwDlg(`Reopen ${t.no}`, tkwF('Why *', `<input id="tkwOR" placeholder="e.g. same fault again on night shift">`), 'Reopen', () => {
      const n = $('#tkwOR').value.trim();
      if (!n) return 'Say why it is reopened';
      t.reopened = (t.reopened || 0) + 1;
      t.verifyUntil = null;
      tkwSet(t, 'progress', `Reopened — ${n}`);
      t.hist[t.hist.length - 1].k = 'reopen';
    });
  if (act === 'wo') {
    closeModal && $('#modal').classList.contains('on') && closeModal();
    if (typeof mntForm === 'function') {
      t.woAsked = Date.now();
      tkwLog(t, 'Breakdown work order opened from this ticket');
      save();
      mntForm({ kind: 'breakdown', blk: t.equip || '', task: `${t.no}: ${t.name}` });
    }
  }
}
function tkwNew() {
  const me = tkwMe();
  if (!me) return toast('Sign in first');
  const eqs = DOC.blocks.filter(b => b.name && EQ[b.type] && !EQ[b.type].widget && b.type !== 'areaBox').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const teams = typeof engDoc === 'function' ? engDoc().teams.map(t => t.name) : ['Maintenance'];
  tkwDlg(
    'New ticket',
    tkwF('Problem *', `<input id="tkwNT" placeholder="e.g. Abnormal noise from muller gearbox">`) +
      `<div class="tkw-2">${tkwF('Equipment *', `<select id="tkwNE"><option value="">Choose…</option>${eqs.map(b => `<option value="${b.id}" ${SEL && SEL.id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`)}${tkwF('Priority', `<select id="tkwNP"><option>High</option><option selected>Medium</option><option>Low</option></select>`)}</div>` +
      `<div class="tkw-2">${tkwF('Owner team', `<select id="tkwNO">${teams.map(t => `<option>${esc(t)}</option>`).join('')}</select>`)}${tkwF('Assign to', `<select id="tkwNA"><option value="">— not assigned</option>${tkwPeople().map(p => `<option>${esc(p.name)}</option>`).join('')}</select>`)}</div>` +
      tkwF('Description', `<textarea id="tkwND" rows="3" placeholder="What was seen, when, what was already checked"></textarea>`),
    'Create ticket',
    () => {
      const name = $('#tkwNT').value.trim(), eq = $('#tkwNE').value;
      if (!name || !eq) return 'Problem and equipment are required';
      const T = tkwDoc(), now = Date.now(), b = B(eq),
        area = typeof afZones === 'function' && b ? afZones().find(z => afMembers(z).includes(b)) || null : null;
      const t = { no: 'TK-' + String(++T.seq).padStart(4, '0'), key: 'man:' + now, name, equip: eq, process: area ? afName(area) : '', source: 'manual', raisedBy: me.name, desc: $('#tkwND').value.trim(), v2: 1,
        first: now, last: now, days: 0, count: 0, trig: [], owner: $('#tkwNO').value, person: $('#tkwNA').value, cc: [], prio: $('#tkwNP').value, status: 'new', created: now, paused: 0, esc: 0,
        hist: [{ t: now, by: me.name, text: 'Reported', k: 'act' }] };
      tkwSla(t);
      T.list.unshift(t);
      tkMsg(t, { team: t.owner, ch: 'screen' }, `New ticket ${t.no}: ${name} on ${b.name} (reported by ${me.name})`);
      tkwStatusMail(t, 'New ticket (reported by ' + me.name + ')', t.desc);
      TKW.sel = t.no;
      save();
    },
  );
}
function tkwSignIn() {
  const P = tkwPeople();
  tkwDlg('Sign in to Tickets', tkwF('Name', `<select id="tkwSN">${P.map(p => `<option value="${p.id}" ${p.id === TKW_ME ? 'selected' : ''}>${esc(p.name)} — ${esc(p.role || '')}</option>`).join('')}</select>`) + tkwF('PIN', `<input id="tkwSP" type="password" inputmode="numeric" autocomplete="off" placeholder="4–6 digits">`) + '<p class="note">The same people and PINs as Maintenance › Team. Stays signed in for this browser session.</p>', 'Sign in', () => {
    const p = P.find(x => x.id === $('#tkwSN').value),
      pin = $('#tkwSP').value.trim();
    if (!p) return 'Choose a name';
    if (p.pin && (typeof mntHash !== 'function' || mntHash(pin) !== p.pin)) return 'Wrong PIN';
    TKW_ME = p.id;
    try {
      sessionStorage.setItem('tkw-me', p.id);
    } catch (e) {}
  });
  setTimeout(() => $('#tkwSP') && $('#tkwSP').focus(), 50);
}
function tkwSettings() {
  const T = tkwDoc(), S = T.set, P = tkwPeople(), teams = typeof engDoc === 'function' ? engDoc().teams.map(t => t.name) : [];
  const n = (k, p, v) => `<input type="number" min="0.25" step="0.25" data-tws="${k}|${p}" value="${v}" style="width:70px">`;
  openModal(
    `<h3>Ticket settings</h3>
   <div class="em-sh">Deadlines by priority <span class="note">hours from creation</span></div>
   <table class="tkw-tb small"><thead><tr><th></th><th>Respond (acknowledge) within</th><th>Fix (resolve) within</th></tr></thead><tbody>${['High', 'Medium', 'Low'].map(p => `<tr><td>${tkwPrio(p)}</td><td>${n('ackH', p, S.ackH[p])} h</td><td>${n('fixH', p, S.fixH[p])} h</td></tr>`).join('')}</tbody></table>
   <div class="em-row" style="margin-top:10px"><label>Verify the fix for</label><input type="number" min="0" data-tws="verifyDays|" value="${S.verifyDays}" style="width:60px"><span>days before the system closes the ticket</span></div>
   <div class="em-row"><label>Response missed → </label><select data-tws="esc1|">${teams.map(t => `<option ${S.esc1 === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><label>Fix missed →</label><select data-tws="esc2|">${teams.map(t => `<option ${S.esc2 === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
   <div class="em-sh">Who works on which team's tickets <span class="note">supervisors (in-charge, production head) can act on every ticket</span></div>
   ${P.length ? `<table class="tkw-tb small"><thead><tr><th>Person</th>${teams.map(t => `<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>${P.map(p => `<tr><td><b>${esc(p.name)}</b><div class="note">${esc(p.role || '')}${tkwIsSup(p) ? ' · supervisor' : ''}</div></td>${teams.map(t => `<td><input type="checkbox" data-twp="${p.id}|${esc(t)}" ${tkwTeamsOf(p).includes(t) ? 'checked' : ''} ${tkwIsSup(p) ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="note">No people yet — add them in Maintenance › Team (name, role, PIN).</p>'}
   <p class="note">Which alerts make tickets, after how many days, owner, person and priority: <button class="lk" id="tkwOld">Ticket rules for each alert…</button></p>
   <div class="mact"><button class="ib pri" id="tkwSetOk">Done</button></div>`,
    'wide',
  );
  $$('#mbox [data-tws]').forEach(i => (i.onchange = () => {
    const [k, p] = i.dataset.tws.split('|');
    if (p) S[k][p] = +i.value;
    else S[k] = i.type === 'number' ? +i.value : i.value;
    T.list.forEach(tkwSla);
    save();
  }));
  $$('#mbox [data-twp]').forEach(i => (i.onchange = () => {
    const [pid, tm] = i.dataset.twp.split('|');
    const p = P.find(x => x.id === pid);
    const cur = new Set(tkwTeamsOf(p));
    i.checked ? cur.add(tm) : cur.delete(tm);
    T.people[pid] = [...cur];
    save();
  }));
  $('#tkwSetOk').onclick = () => (closeModal(), tkwPage(true));
  $('#tkwOld').onclick = tkwRules;
}

/* ---------- binding ---------- */
function tkwBind(T, t) {
  const box = $('#tkBox');
  $('#tkpClose').onclick = tkPageClose;
  $('#tkpAlerts').onclick = () => typeof openAlertMonitor === 'function' && openAlertMonitor('live');
  $('#tkwNew').onclick = tkwNew;
  $('#tkwSet').onclick = tkwSettings;
  $('#tkwRul').onclick = tkwRules;
  const si = $('#tkwSign');
  if (si) si.onclick = tkwSignIn;
  $$('#tkBox [data-tkv]').forEach(b => (b.onclick = () => ((TKW.view = b.dataset.tkv), tkwPage(true))));
  $$('#tkBox [data-tkwf]').forEach(s => (s.onchange = () => ((TKW[s.dataset.tkwf] = s.value), tkwPage(true))));
  const q = $('#tkwQ');
  q.oninput = () => {
    TKW.q = q.value;
    const p = q.selectionStart;
    tkwPage(true);
    const n = $('#tkwQ');
    n.focus();
    n.setSelectionRange(p, p);
  };
  $('#tkwMine').onchange = e => ((TKW.mine = e.target.checked), tkwPage(true));
  $$('#tkBox [data-tkw]').forEach(c => (c.onclick = () => ((TKW.sel = TKW.sel === c.dataset.tkw ? null : c.dataset.tkw), tkwPage(true))));
  /* drag a card to another column = that step (with its required fields) */
  $$('#tkBox .tkw-card').forEach(c => {
    c.ondragstart = e => {
      TKW.drag = c.dataset.tkw;
      e.dataTransfer.setData('text/plain', c.dataset.tkw);
      c.classList.add('dragging');
    };
    c.ondragend = () => ((TKW.drag = null), c.classList.remove('dragging'));
  });
  $$('#tkBox .tkw-col').forEach(col => {
    col.ondragover = e => (e.preventDefault(), col.classList.add('over'));
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = e => {
      e.preventDefault();
      col.classList.remove('over');
      const tk = T.list.find(x => x.no === (TKW.drag || e.dataTransfer.getData('text/plain')));
      TKW.drag = null;
      if (!tk) return;
      const to = col.dataset.col,
        from = tk.status;
      const map = {
        ack: from === 'new' ? 'ack' : null,
        progress: from === 'ack' ? 'start' : from === 'waiting' ? 'resume' : ['resolved', 'closed', 'cancelled'].includes(from) ? 'reopen' : null,
        waiting: from === 'progress' ? 'wait' : null,
        resolved: from === 'progress' || from === 'ack' ? 'resolve' : null,
        closed: from === 'resolved' ? 'closeNow' : from === 'new' || from === 'ack' ? 'cancel' : null,
      };
      const act = map[to];
      if (to === from || (to === 'closed' && from === 'cancelled')) return;
      if (!act) return toast(`${TKW_ST[from][0]} → ${TKW_ST[to] ? TKW_ST[to][0] : to} is not a step — use the buttons on the ticket`), tkwPage(true);
      TKW.sel = tk.no;
      tkwAct(tk, act);
      tkwPage(true);
    };
  });
  $$('#tkBox [data-kf]').forEach(k => (k.onclick = () => {}));
  if (!t) return;
  $('#tkwDrX').onclick = () => ((TKW.sel = null), tkwPage(true));
  $$('#tkwDr [data-act]').forEach(b => (b.onclick = () => tkwAct(t, b.dataset.act)));
  const loc = $('#tkwLoc');
  if (loc)
    loc.onclick = () => {
      tkPageClose();
      if (typeof mpLocate === 'function') mpLocate(t.equip);
      else select({ t: 'b', id: t.equip });
    };
  const cm = $('#tkwCmB');
  cm.onclick = () => {
    const v = $('#tkwCm').value.trim();
    if (!v) return;
    if (!tkwMe()) return toast('Sign in first');
    tkwLog(t, v, 'note');
    save();
    tkwPage(true);
  };
  $('#tkwCm').onkeydown = e => e.key === 'Enter' && cm.onclick();
}
/* button count: active tickets, red when one is late */
tkCounts = function () {
  const T = tkwDoc(), now = Date.now(), open = T.list.filter(t => TKW_ACTIVE.includes(t.status));
  return { open: open.length, overdue: open.filter(t => (t.status === 'new' && now > t.ackDue) || (t.status !== 'waiting' && now > t.fixDue)).length, T };
};
/* Escape closes the drawer first */
document.addEventListener(
  'keydown',
  e => {
    if (e.key === 'Escape' && TKP.on && TKW.sel && !$('#modal').classList.contains('on')) {
      e.stopImmediatePropagation();
      TKW.sel = null;
      tkwPage(true);
    }
  },
  true,
);

document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="tkwCss">
.tkp-box{gap:10px}
.tkw-me{display:flex;align-items:center;gap:8px;padding-right:6px;border-right:1px solid #dbe2ec}.tkw-me small{display:block;color:#64748b;font-size:11.5px}
.tkw-av{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#e0e7ff;color:#3730a3;font:700 10.5px var(--sans)}.tkw-av.big{width:32px;height:32px;font-size:12.5px}
.tkw-ab{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 12px;font:600 13px var(--sans);color:#152238;cursor:pointer}.tkw-ab.pri{background:#1f6feb;border-color:#1f6feb;color:#fff}.tkw-ab.warn{color:#b42318;border-color:#f3c4c4}.tkw-ab:disabled{opacity:.45;cursor:not-allowed}
.tkw-kpis{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
.tkw-k{display:flex;flex-direction:column;align-items:flex-start;border:1px solid #dbe2ec;background:#fff;border-radius:10px;padding:8px 12px;font:12px var(--sans);color:#55657d;text-align:left;cursor:default}.tkw-k b{font:700 22px var(--sans);color:#152238}.tkw-k.bad{border-color:#f5b5b5;background:#fff5f5}.tkw-k.bad b{color:#d93636}.tkw-k.ok b{color:#15803d}
.tkw-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tkw-bar select,.tkw-q{border:1px solid #cbd5e1;border-radius:8px;padding:7px 9px;font:13px var(--sans);background:#fff}.tkw-q{flex:1;min-width:220px}.tkw-vs{display:grid;grid-auto-flow:column}.tkw-mine{font-size:13px;display:flex;gap:6px;align-items:center}
.tkw-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.tkw-main.has-dr{grid-template-columns:minmax(0,1fr) 560px}
.tkw-lst{min-height:0;overflow:auto}
.tkw-board{display:grid;grid-template-columns:repeat(6,minmax(170px,1fr));gap:10px;min-height:100%}
.tkw-col{background:#e7ecf3;border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:8px;min-height:200px}.tkw-col.over{outline:2px dashed #1f6feb;background:#dbe7fb}
.tkw-ch{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:2px 4px;border-bottom:3px solid var(--c)}.tkw-ch span{background:#fff;border-radius:9px;padding:0 7px;font-weight:700}
.tkw-cl{display:flex;flex-direction:column;gap:8px}.tkw-empty{color:#94a3b8;text-align:center;padding:10px}
.tkw-card{background:#fff;border-radius:9px;padding:8px 10px;border-left:4px solid var(--p);box-shadow:0 1px 3px rgba(14,45,92,.1);cursor:pointer;display:flex;flex-direction:column;gap:4px}.tkw-card:hover{box-shadow:0 3px 10px rgba(14,45,92,.16)}.tkw-card.sel{outline:2px solid #1f6feb}.tkw-card.dragging{opacity:.5}
.tkw-c1{display:flex;align-items:center;gap:6px;font-size:12px}.tkw-c2{font:600 13px/1.3 var(--sans)}.tkw-c3{display:flex;justify-content:space-between;color:#64748b;font-size:12px}.tkw-c4{display:flex;justify-content:space-between;align-items:center}
.tkw-pr{font:700 10.5px var(--sans);color:var(--c);border:1px solid var(--c);border-radius:8px;padding:0 6px}
.tkw-st{font:700 11px var(--sans);color:#fff;background:var(--c);border-radius:9px;padding:1px 8px;white-space:nowrap}
.tkw-re{font:700 10.5px var(--sans);color:#b45309;background:#fff7ed;border-radius:8px;padding:0 6px}.tkw-man{font:600 10.5px var(--sans);color:#475569;background:#f1f5f9;border-radius:8px;padding:0 6px}
.tkw-clk{font:600 11.5px var(--sans);color:#334155;background:#f1f5f9;border-radius:8px;padding:1px 7px}.tkw-clk.warn{background:#fff7e6;color:#b45309}.tkw-clk.bad{background:#fee2e2;color:#b91c1c}.tkw-clk.ok{background:#dcfce7;color:#15803d}
.tkw-tb{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;font-size:13px}.tkw-tb th{background:#f1f5f9;text-align:left;padding:8px;font-size:12px;color:#475569}.tkw-tb td{padding:8px;border-top:1px solid #eef2f7}.tkw-tb tr[data-tkw]{cursor:pointer}.tkw-tb tr[data-tkw]:hover td,.tkw-tb tr.sel td{background:#f5f8fd}.tkw-tb.small td,.tkw-tb.small th{padding:5px 8px}
.tkw-dr{background:#fff;border:1px solid #dbe2ec;border-radius:12px;padding:14px 16px;overflow:auto;min-height:0;box-shadow:0 6px 20px rgba(14,45,92,.1)}
.tkw-dr-h{display:flex;justify-content:space-between;gap:10px}.tkw-dr-h h3{margin:6px 0 0;font-size:18px}.tkw-dno{display:flex;gap:6px;align-items:center;font-weight:700}.tkw-x{border:1px solid #dbe2ec;background:#fff;border-radius:8px;width:30px;height:30px;cursor:pointer}
.tkw-steps{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;margin:12px 0 10px}.tkw-stp{position:relative;padding:6px 8px;border-radius:6px;background:#f1f5f9;font-size:11.5px;color:#64748b;display:flex;flex-direction:column}.tkw-stp b{font-size:12px}.tkw-stp.done{background:#dcfce7;color:#166534}.tkw-stp.cur{background:#1f6feb;color:#fff}.tkw-stp.cancel{background:#f1f5f9;color:#475569;grid-column:span 4}
.tkw-acts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.tkw-sla{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px}.tkw-sla>div{border:1px solid #e2e8f0;border-radius:8px;padding:7px 9px;display:flex;flex-direction:column}.tkw-sla span{font-size:11.5px;color:#64748b}.tkw-sla small{font-size:11.5px;color:#475569}.tkw-sla .ok{border-color:#bbf7d0;background:#f0fdf4}.tkw-sla .bad{border-color:#fecaca;background:#fef2f2}.tkw-sla .bad small{color:#b91c1c}.tkw-sla .pause{border-color:#fde68a;background:#fffbeb}
.tkw-info{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:13px}.tkw-info>div{display:flex;flex-direction:column;border-bottom:1px dashed #eef2f7;padding-bottom:4px}.tkw-info span{font-size:11.5px;color:#64748b}.tkw-info .lk{align-self:flex-start;margin-top:2px}
.tkw-res{margin-top:10px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;padding:8px 10px;font-size:13px;display:flex;flex-direction:column;gap:3px}.tkw-res span{display:inline-block;width:110px;color:#64748b;font-size:12px}.tkw-res small{color:#64748b}
.tkw-sec{margin:14px 0 6px;font:700 12px var(--sans);letter-spacing:.06em;color:#475569;text-transform:uppercase}.tkw-desc{margin:0;font-size:13px;white-space:pre-wrap}
.tkw-tr{width:100%;height:auto;background:#f8fafc;border-radius:8px}.tkw-tr polyline{fill:none;stroke:#1f6feb;stroke-width:2}.tkw-tr circle{fill:#1f6feb}.tkw-tr text{font:10px var(--sans);fill:#64748b}
.tkw-cm{display:flex;gap:6px;margin-bottom:8px}.tkw-cm input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:7px 9px;font:13px var(--sans)}
.tkw-tl{display:flex;flex-direction:column}.tkw-ev{display:grid;grid-template-columns:26px 1fr;gap:6px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}.tkw-ev i{font-style:normal;width:22px;height:22px;border-radius:50%;background:#e0e7ff;display:flex;align-items:center;justify-content:center;font-size:11px}.tkw-ev.sys i{background:#f1f5f9}.tkw-ev.esc i{background:#fee2e2}.tkw-ev.reopen i{background:#fff7ed}.tkw-ev.note i{background:#ecfeff}.tkw-ev span{color:#64748b;font-size:11.5px}.tkw-ev p{margin:2px 0 0}
.tkw-rules tr.off td{opacity:.5}.tkw-rules select{max-width:128px;font-size:12px}.tkw-rules td,.tkw-rules th{padding:5px 5px!important}.tkw-rules td:nth-child(2){max-width:210px}
.tkw-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tkp-box{height:100%;display:flex;flex-direction:column}
</style>`,
);
