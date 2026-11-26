/*! SandMan Process Flowsheet — 27h-tickets.js
 *  v9.83 Item 7 — ticket system for repeated alerts.
 *  Every alert (engineered alerts and single-tag limit alarms of warning or worse) records the days it fired. When the
 *  same alert (same equipment and condition) fires on N days in a row, a ticket is created and sent to its owner.
 *  N is set per equipment (plant default otherwise) and can be changed for each engineered alert.
 *  One ticket per problem: while it is open, new triggers are added to it. Only a closing note (cause found and action
 *  taken) closes it. Reminder before the due date; overdue → next level (shift in-charge, then production head).
 *  After closing the alert is watched: if it fires again within the watch period, the ticket reopens.
 *  Data (saved with the loop): DOC.tk = { set: {...}, days: {key: [YYYY-MM-DD…]}, list: [tickets], seq }. */
const TK_SET0 = { days: 3, dueDays: 3, watchDays: 7, remindH: 24, owner: 'Maintenance', esc1: 'Shift in-charge', esc2: 'Production head' };
function tkDoc() {
  const T = (DOC.tk = DOC.tk || {});
  T.set = Object.assign({}, TK_SET0, T.set || {});
  T.eqDays = T.eqDays || {};
  T.days = T.days || {};
  T.list = T.list || [];
  T.seq = T.seq || 0;
  return T;
}
const tkDay = t => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/* how many days in a row (ending today) a key fired */
function tkRun(days, now) {
  const set = new Set(days);
  let n = 0,
    d = new Date(now);
  while (set.has(tkDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
function tkNeed(key, equip) {
  const T = tkDoc();
  const r = key.startsWith('eng:') && typeof engDoc === 'function' ? engDoc().rules.find(x => 'eng:' + x.id === key) : null;
  if (r && +r.tkDays > 0) return +r.tkDays;
  if (equip && +T.eqDays[equip] > 0) return +T.eqDays[equip];
  return +T.set.days || 3;
}
function tkOwner(key, equip) {
  const T = tkDoc();
  const r = key.startsWith('eng:') && typeof engDoc === 'function' ? engDoc().rules.find(x => 'eng:' + x.id === key) : null;
  return {
    team: (r && (r.tkOwner || (r.teams && r.teams[0] && r.teams[0].team))) || T.set.owner,
    person: (r && r.tkPerson) || '',
    cc: r && r.teams ? r.teams.map(t => t.team).filter(t => t !== (r.tkOwner || r.teams[0].team)) : [],
  };
}
function tkMsg(t, ch, text) {
  if (typeof engDoc !== 'function') return;
  const E = engDoc();
  (E.outbox = E.outbox || []).unshift({ t: Date.now(), inst: t.no, team: ch.team, ch: ch.ch, text, status: ch.ch === 'screen' ? 'shown in app' : 'queued for the server' });
  E.outbox.length = Math.min(E.outbox.length, 300);
}
/* an alert fired now: record the day, add to an open ticket, or open / reopen one */
function tkHit(key, name, equip, sev, vals) {
  const T = tkDoc(),
    now = Date.now(),
    today = tkDay(now),
    D = (T.days[key] = T.days[key] || []);
  let dirty = false;
  if (!D.includes(today)) {
    D.push(today);
    D.splice(0, Math.max(0, D.length - 60));
    dirty = true;
  }
  let tk = T.list.find(t => t.key === key && t.status !== 'closed');
  if (tk) {
    if (now - (tk.last || 0) > 60000) {
      tk.last = now;
      tk.count++;
      tk.days = tkRun(D, now);
      tk.trig.unshift({ t: now, vals });
      tk.trig.length = Math.min(tk.trig.length, 50);
      dirty = true;
    }
    return dirty && save();
  }
  /* reopen a ticket closed within the watch period */
  const closed = T.list.find(t => t.key === key && t.status === 'closed' && now - t.closedAt < T.set.watchDays * 86400000);
  if (closed) {
    closed.status = 'open';
    closed.reopened = (closed.reopened || 0) + 1;
    closed.last = now;
    closed.count++;
    closed.trig.unshift({ t: now, vals });
    closed.hist.push({ t: now, by: 'System', text: `Reopened: the alert fired again within ${T.set.watchDays} days of closing` });
    tkMsg(closed, { team: closed.owner, ch: 'screen' }, `Ticket ${closed.no} reopened — ${closed.name} fired again`);
    logEv(`Ticket ${closed.no} reopened: ${closed.name}`, 2);
    return save();
  }
  const need = tkNeed(key, equip),
    run = tkRun(D, now);
  if (run >= need) {
    const o = tkOwner(key, equip),
      b = B(equip),
      area = typeof afZones === 'function' && b ? (afZones().find(z => afMembers(z).includes(b)) || null) : null;
    tk = {
      no: 'TK-' + String(++T.seq).padStart(4, '0'), key, name: `${name} — recurring`, equip, process: area ? afName(area) : '',
      first: D.length ? new Date(D[Math.max(0, D.length - run)] + 'T00:00').getTime() : now, last: now, days: run, count: 1,
      trig: [{ t: now, vals }], owner: o.team, person: o.person, cc: o.cc, due: now + T.set.dueDays * 86400000,
      prio: sev >= 3 ? 'High' : sev === 2 ? 'Medium' : 'Low', status: 'open', created: now,
      hist: [{ t: now, by: 'System', text: `Created: the alert fired on ${run} days in a row (setting: ${need})` }], esc: 0,
    };
    T.list.unshift(tk);
    tkMsg(tk, { team: tk.owner, ch: 'screen' }, `New ticket ${tk.no}: ${tk.name} on ${(b || {}).name || ''} — due ${new Date(tk.due).toLocaleDateString('en-GB')}`);
    tkMsg(tk, { team: tk.owner, ch: 'email' }, `New ticket ${tk.no}: ${tk.name}`);
    tk.cc.forEach(c => tkMsg(tk, { team: c, ch: 'screen' }, `Copy: ticket ${tk.no} — ${tk.name}`));
    logEv(`Ticket ${tk.no} created: ${tk.name}`, 2);
    dirty = true;
  }
  if (dirty) save();
}
/* reminders and overdue escalation, every minute */
function tkTimers() {
  const T = tkDoc(),
    now = Date.now();
  let dirty = false;
  T.list.forEach(t => {
    if (t.status === 'closed') return;
    if (!t.reminded && t.due - now < T.set.remindH * 3600000 && t.due > now) {
      t.reminded = now;
      tkMsg(t, { team: t.owner, ch: 'screen' }, `Reminder: ticket ${t.no} is due ${new Date(t.due).toLocaleString('en-GB')}`);
      dirty = true;
    }
    const lvl = now > t.due + 86400000 ? 2 : now > t.due ? 1 : 0;
    if (lvl > (t.esc || 0)) {
      t.esc = lvl;
      const to = lvl === 1 ? T.set.esc1 : T.set.esc2;
      t.hist.push({ t: now, by: 'System', text: `Overdue — sent to ${to}` });
      tkMsg(t, { team: to, ch: 'screen' }, `Overdue ticket ${t.no}: ${t.name} (owner ${t.owner})`);
      tkMsg(t, { team: to, ch: 'email' }, `Overdue ticket ${t.no}: ${t.name}`);
      dirty = true;
    }
  });
  if (dirty) save();
}
setInterval(() => {
  try {
    tkTimers();
  } catch (e) {}
}, 60000);
/* single-tag limit alarms (warning or worse) count as alerts too */
setInterval(() => {
  try {
    if (MODE !== 'monitor' || RP) return;
    for (const k in ALERTS) {
      const a = ALERTS[k];
      if (!a.active || a.sev < 2) continue;
      if (k.startsWith('lim:') && a.tagId && REG[a.tagId]) {
        const t = REG[a.tagId];
        tkHit(k, `${t.short || t.desc || t.id} out of limit`, a.blk || (tagOwner(a.tagId) || {}).b?.id, a.sev, { [t.short || t.desc || 'Value']: val(a.tagId) });
      } else if (k.startsWith('eng:') && typeof engDoc === 'function') {
        const r = engDoc().rules.find(x => 'eng:' + x.id === k);
        if (r) tkHit(k, r.name, r.equip, r.sev, Object.fromEntries(['A', 'B', 'C', 'D'].filter(x => r.vars[x] && REG[r.vars[x]]).map(x => [REG[r.vars[x]].short || REG[r.vars[x]].desc || x, val(r.vars[x])])));
      }
    }
  } catch (e) {}
}, 5000);

/* ---------- Tickets view (Alert monitoring › Tickets) ---------- */
let TKV = { sel: null, team: '', equip: '', st: 'active' };
const tkStN = { open: 'Open', progress: 'In progress', waiting: 'Waiting', closed: 'Closed' };
function tkTab() {
  const T = tkDoc(),
    now = Date.now();
  if (TKV.sel) return tkDetail(T.list.find(t => t.no === TKV.sel));
  const L = T.list.filter(t => (!TKV.team || t.owner === TKV.team) && (!TKV.equip || t.equip === TKV.equip) && (TKV.st === 'all' || (TKV.st === 'active' ? t.status !== 'closed' : TKV.st === 'overdue' ? t.status !== 'closed' && now > t.due : t.status === TKV.st)));
  const cl = T.list.filter(t => t.closedAt),
    avg = cl.length ? emDur(Math.max(0, cl.reduce((a, t) => a + Math.max(0, t.closedAt - t.created), 0) / cl.length)) : '—',
    byEq = {};
  T.list.forEach(t => (byEq[t.equip] = (byEq[t.equip] || 0) + 1));
  const topEq = Object.entries(byEq).sort((a, b) => b[1] - a[1])[0];
  const eqs = [...new Set(T.list.map(t => t.equip).filter(Boolean))],
    teams = typeof engDoc === 'function' ? engDoc().teams.map(t => t.name) : [];
  const sel = (k, opts) => `<select data-tkf="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${TKV[k] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `<div class="em-sum"><div><b>${T.list.filter(t => t.status !== 'closed').length}</b><span>open</span></div><div><b>${T.list.filter(t => t.status !== 'closed' && now > t.due).length}</b><span>overdue</span></div><div><b>${cl.length}</b><span>closed</span></div><div><b>${avg}</b><span>avg. time to close</span></div><div><b>${T.list.reduce((a, t) => a + (t.reopened || 0), 0)}</b><span>reopened</span></div><div class="em-top"><b>${topEq ? esc((B(topEq[0]) || {}).name || topEq[0]) : '—'}</b><span>most repeat tickets${topEq ? ` (${topEq[1]})` : ''}</span></div></div>
  <div class="em-f">${sel('st', [['active', 'Open, in progress, waiting'], ['overdue', 'Overdue'], ['closed', 'Closed'], ['all', 'All']])}${sel('team', [['', 'All owners'], ...teams.map(t => [t, t])])}${sel('equip', [['', 'All equipment'], ...eqs.map(id => [id, (B(id) || {}).name || id])])}<button class="sb" id="tkSetB">Ticket settings…</button></div>
  <table class="em-tb"><thead><tr><th>Ticket</th><th>Alert</th><th>Equipment</th><th>Days</th><th>Times</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead><tbody>${L.map(t => `<tr class="tk-r" data-tko="${t.no}"><td><b>${t.no}</b>${t.reopened ? ' <span class="chip sv2">reopened</span>' : ''}</td><td>${esc(t.name)}</td><td>${esc((B(t.equip) || {}).name || '')}</td><td>${t.days}</td><td>${t.count}</td><td>${esc(t.owner)}${t.person ? ' · ' + esc(t.person) : ''}</td><td class="${t.status !== 'closed' && now > t.due ? 'tk-od' : ''}">${new Date(t.due).toLocaleDateString('en-GB')}${t.status !== 'closed' && now > t.due ? ' · overdue' : ''}</td><td>${t.prio}</td><td>${tkStN[t.status]}</td></tr>`).join('') || `<tr><td colspan="9" class="note">No tickets here. A ticket is made when the same alert fires on ${T.set.days} days in a row (plant default).</td></tr>`}</tbody></table>`;
}
function tkSpark(t) {
  const vs = t.trig.slice().reverse().map(x => x.vals && (x.vals.X ?? x.vals.A)).filter(v => v != null && isFinite(v));
  if (vs.length < 2) return '';
  const lo = Math.min(...vs), hi = Math.max(...vs), W = 220, H = 40;
  const pts = vs.map((v, i) => `${((i / (vs.length - 1)) * W).toFixed(1)},${(H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8)).toFixed(1)}`).join(' ');
  return `<svg width="${W}" height="${H}" class="tk-sp"><polyline points="${pts}" fill="none" stroke="#1f6feb" stroke-width="1.6"/></svg>`;
}
function tkDetail(t) {
  if (!t) return ((TKV.sel = null), tkTab());
  const now = Date.now();
  return `<div class="tk-d"><button class="sb" id="tkBack">‹ All tickets</button>
  <div class="tk-dh"><h3>${t.no} · ${esc(t.name)}</h3><span class="chip tk-st tk-st-${t.status}">${tkStN[t.status]}</span><span class="chip ${t.prio === 'High' ? 'sv3' : t.prio === 'Medium' ? 'sv2' : ''}">${t.prio}</span>${t.status !== 'closed' && now > t.due ? '<span class="chip sv3">Overdue</span>' : ''}${t.reopened ? `<span class="chip sv2">Reopened ×${t.reopened}</span>` : ''}</div>
  <div class="tk-g"><div><span>Equipment</span><b>${esc((B(t.equip) || {}).name || '—')}</b></div><div><span>Process</span><b>${esc(t.process || '—')}</b></div><div><span>First trigger</span><b>${emTime(t.first)}</b></div><div><span>Latest trigger</span><b>${emTime(t.last)}</b></div><div><span>Days in a row</span><b>${t.days}</b></div><div><span>Times triggered</span><b>${t.count}</b></div><div><span>Owner</span><b>${esc(t.owner)}${t.person ? ' · ' + esc(t.person) : ''}</b></div><div><span>Copy to</span><b>${esc((t.cc || []).join(', ') || '—')}</b></div><div><span>Due</span><b>${emTime(t.due)}</b></div></div>
  ${tkSpark(t) ? `<div class="em-sh">Readings at each trigger</div>${tkSpark(t)}` : ''}
  <div class="em-sh">Values at each trigger <span class="note">latest first</span></div><div class="tk-trig">${t.trig.slice(0, 10).map(x => `<div>${emTime(x.t)} · ${Object.entries(x.vals || {}).filter(([, v]) => v != null).map(([k, v]) => `${k} ${fmtN(v, 1)}`).join(' · ')}</div>`).join('')}</div>
  ${t.status !== 'closed' ? `<div class="em-row"><label>Status</label><span class="lc2-seg">${['open', 'progress', 'waiting'].map(s => `<button type="button" data-tks="${s}" aria-pressed="${t.status === s}">${tkStN[s]}</button>`).join('')}</span><label>Person</label><input id="tkPerson" value="${esc(t.person || '')}" placeholder="name" style="width:140px"><label>Due</label><input id="tkDue" type="date" value="${tkDay(t.due)}"></div>
  <div class="em-row"><input id="tkNote" placeholder="Add a note (what was done, part ordered …)" style="flex:1"><button class="sb" id="tkNoteB">Add note</button></div>
  <div class="em-row"><input id="tkClose" placeholder="Closing note: cause found and action taken" style="flex:1"><button class="ib pri" id="tkCloseB">Close ticket</button></div>` : `<div class="em-now">Closed ${emTime(t.closedAt)} by ${esc(t.closedBy || '')}: <b>${esc(t.closeNote || '')}</b> — the alert is watched for ${tkDoc().set.watchDays} days; if it fires again the ticket reopens.</div>`}
  <div class="em-sh">History</div><div class="tk-h">${t.hist.slice().reverse().map(h => `<div><span>${emTime(h.t)}</span><b>${esc(h.by)}</b>${esc(h.text)}</div>`).join('')}</div></div>`;
}
function tkSettingsHTML() {
  const T = tkDoc(),
    S = T.set,
    teams = typeof engDoc === 'function' ? engDoc().teams.map(t => t.name) : [],
    eqs = DOC.blocks.filter(b => !EQ[b.type].widget && b.tags && b.tags.length).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const tsel = k => `<select data-tkset="${k}">${teams.map(t => `<option ${S[k] === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  return `<h3 style="margin:0 0 8px">Ticket settings</h3>
  <div class="em-row"><label>A ticket is made when the same alert fires on</label><input type="number" min="1" data-tkset="days" value="${S.days}" style="width:60px"><span>days in a row (plant default)</span></div>
  <div class="em-row"><label>Due</label><input type="number" min="1" data-tkset="dueDays" value="${S.dueDays}" style="width:60px"><span>days after the ticket is made · reminder</span><input type="number" min="1" data-tkset="remindH" value="${S.remindH}" style="width:60px"><span>hours before</span></div>
  <div class="em-row"><label>Watch period after closing</label><input type="number" min="1" data-tkset="watchDays" value="${S.watchDays}" style="width:60px"><span>days (the ticket reopens if the alert fires again)</span></div>
  <div class="em-row"><label>Owner when the alert has none</label>${tsel('owner')}<label>Overdue → first</label>${tsel('esc1')}<label>then (a day later)</label>${tsel('esc2')}</div>
  <div class="em-sh">Days in a row for each equipment <span class="note">blank = plant default (${S.days})</span></div>
  <div class="tk-eq">${eqs.map(b => `<label><span>${esc(b.name)}</span><input type="number" min="1" data-tkeq="${b.id}" value="${T.eqDays[b.id] || ''}" placeholder="${S.days}"></label>`).join('')}</div>
  <div class="note" style="margin-top:8px">For an engineered alert, its own number of days and owner can be set in the alert's editor.</div>
  <div class="mact"><button class="ib pri" id="tkSetClose">Done</button></div>`;
}
/* bind: wrap the Alert monitoring binder so the Tickets tab gets its handlers */
{
  const _bind = emBind;
  emBind = function (body, E) {
    _bind(body, E);
    if (EM.tab !== 'tickets') return;
    tkBindBody(body, () => ((body._h = null), emRender()), () => openAlertMonitor('tickets'));
  };
}
/* v10.4 — the ticket handlers work on any container (Alert monitoring › Tickets and the Tickets page) */
function tkBindBody(body, re, afterSettings) {
  {
    const T = tkDoc(),
      who = () => (typeof USER !== 'undefined' && USER && USER.name) || 'Operator',
      t = TKV.sel && T.list.find(x => x.no === TKV.sel),
      one = s => body.querySelector(s);
    body.querySelectorAll('[data-tko]').forEach(r => (r.onclick = () => ((TKV.sel = r.dataset.tko), re())));
    body.querySelectorAll('[data-tkf]').forEach(s => (s.onchange = () => ((TKV[s.dataset.tkf] = s.value), re())));
    const sb = one('#tkSetB');
    if (sb)
      sb.onclick = () => {
        openModal(tkSettingsHTML(), 'wide');
        $$('#mbox [data-tkset]').forEach(i => (i.onchange = () => ((T.set[i.dataset.tkset] = i.type === 'number' ? +i.value : i.value), save())));
        $$('#mbox [data-tkeq]').forEach(i => (i.onchange = () => (i.value ? (T.eqDays[i.dataset.tkeq] = +i.value) : delete T.eqDays[i.dataset.tkeq], save())));
        $('#tkSetClose').onclick = () => (afterSettings ? afterSettings() : closeModal());
      };
    const back = one('#tkBack');
    if (back) back.onclick = () => ((TKV.sel = null), re());
    if (!t) return;
    body.querySelectorAll('[data-tks]').forEach(b => (b.onclick = () => {
      t.status = b.dataset.tks;
      t.hist.push({ t: Date.now(), by: who(), text: `Status: ${tkStN[t.status]}` });
      save();
      re();
    }));
    const pe = one('#tkPerson');
    if (pe) pe.onchange = () => ((t.person = pe.value), t.hist.push({ t: Date.now(), by: who(), text: `Assigned to ${pe.value || '—'}` }), save(), re());
    const du = one('#tkDue');
    if (du) du.onchange = () => ((t.due = new Date(du.value + 'T18:00').getTime()), (t.esc = 0), (t.reminded = 0), t.hist.push({ t: Date.now(), by: who(), text: `Due date set to ${du.value}` }), save(), re());
    const nb = one('#tkNoteB');
    if (nb) nb.onclick = () => {
      const n = one('#tkNote').value.trim();
      if (!n) return;
      t.hist.push({ t: Date.now(), by: who(), text: n });
      save();
      re();
    };
    const cb = one('#tkCloseB');
    if (cb) cb.onclick = () => {
      const n = one('#tkClose').value.trim();
      if (!n) return toast('A closing note is required: cause found and action taken');
      Object.assign(t, { status: 'closed', closedAt: Date.now(), closedBy: who(), closeNote: n });
      t.hist.push({ t: Date.now(), by: who(), text: `Closed: ${n}` });
      save();
      re();
    };
  };
}
/* the engineered-alert editor gets ticket settings for that alert */
{
  const _ed = emEdit;
  emEdit = function (E) {
    const r = EM.edit,
      h = _ed(E);
    const add = `<div class="em-sh">Ticket</div><div class="em-row"><label>Ticket after</label><input type="number" min="1" data-er="tkDays" value="${r.tkDays || ''}" placeholder="equipment" style="width:80px"><span>days in a row · owner</span><select data-er="tkOwner"><option value="">first team above</option>${E.teams.map(t => `<option ${r.tkOwner === t.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select><input data-er="tkPerson" value="${esc(r.tkPerson || '')}" placeholder="named person" style="width:130px"></div>`;
    return h.replace('<div class="em-edb">', add + '<div class="em-edb">');
  };
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="tkCss">
.tk-st{background:#eef4ff;color:#1f3b63;border:1px solid #c7d7f5}.tk-st-closed{background:#eefaf3;color:#15803d;border-color:#9fd3b4}.tk-st-waiting{background:#fff7e6;color:#a16207;border-color:#f0d49a}
.tk-r{cursor:pointer}.tk-r:hover td{background:rgba(31,111,235,.06)}.tk-od{color:#d93636;font-weight:600}
.tk-dh{display:flex;align-items:center;gap:8px;margin:10px 0}.tk-dh h3{margin:0}
.tk-g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.tk-g div{border:1px solid var(--line,#e3e8ec);border-radius:6px;padding:6px 8px;display:flex;flex-direction:column}.tk-g span{font-size:11.5px;color:var(--muted,#5b6b7b)}
.tk-trig{font:12px var(--mono);display:flex;flex-direction:column;gap:2px}
.tk-h div{display:grid;grid-template-columns:130px 110px 1fr;gap:8px;font-size:12.5px;padding:4px 0;border-bottom:1px solid var(--line,#eef2f5)}.tk-h span{color:var(--muted,#5b6b7b)}
.tk-eq{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 12px;max-height:40vh;overflow:auto}.tk-eq label{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;gap:6px}.tk-eq input{width:60px}
</style>`,
);
