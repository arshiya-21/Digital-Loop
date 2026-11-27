/*! SandMan Digital Loop Studio — 27y-alert-routing.js
 *  v10.4 — process-wise alert routing: who gets an email when an alert fires.
 *   Teams        — created by the user (none hard-coded), each with any number of email recipients; team and each
 *                  recipient can be switched off without deleting. Same teams as Engineered alerts and Tickets.
 *   Zones        — the process areas drawn on the loop (Sand preparation, Moulding …); each can be muted (shutdown).
 *   Routing      — rules: zone (or all) × alert type (limit alarm / engineered / ticket) × lowest severity ×
 *                  category (quality / equipment / process) → one or more teams; on/off per rule.
 *                  A rule for one specific alert (a tag or an engineered alert) replaces the general rules for it.
 *   Sending      — when an alert starts (or gets worse) the app finds its equipment → zone → matching rules → teams →
 *                  active recipients, and queues ONE email per alert with all addresses (no duplicates). The same
 *                  alert is not emailed again within the repeat time. Emails are sent by the SandMan server from the
 *                  outbox (see Backend spec); the Sent log shows what was queued and to whom.
 *  Data (with the loop): DOC.route = { rules: [...], zoneOff: {zoneId: 1}, cat: {tagId: cat}, set: {repeatMin, cleared} }
 *  and engDoc().teams[i] = { id, name, on, recips: [{ name, email, on }] (+ old email / phone kept). */

const RT_CATS = { quality: 'Quality', equipment: 'Equipment', process: 'Process' };
const RT_KINDS = { limit: 'Limit alarm', eng: 'Engineered alert', ticket: 'Ticket' };
const RT_SEV = { 1: 'Advisory and worse', 2: 'Warning and worse', 3: 'Critical only' };
const RT = { tab: 'teams', test: '', testSev: 2, last: {} };

function rtDoc() {
  const R = (DOC.route = DOC.route || {});
  R.rules = Array.isArray(R.rules) ? R.rules : [];
  R.zoneOff = R.zoneOff || {};
  R.cat = R.cat || {};
  R.set = Object.assign({ repeatMin: 30, cleared: false }, R.set || {});
  return R;
}
function rtTeams() {
  const T = engDoc().teams;
  T.forEach((t, i) => {
    if (!t.id) t.id = 'tm' + i + Math.random().toString(36).slice(2, 6);
    if (t.on == null) t.on = true;
    if (!Array.isArray(t.recips)) t.recips = t.email ? String(t.email).split(/[,;\s]+/).filter(Boolean).map(e => ({ name: '', email: e, on: true })) : [];
  });
  return T;
}
const rtEmailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
function rtTeamEmails(t) {
  return t && t.on !== false ? (t.recips || []).filter(r => r.on !== false && rtEmailOk(r.email)).map(r => r.email.trim().toLowerCase()) : [];
}
function rtTeamByName(n) {
  return rtTeams().find(t => t.name === n || t.id === n);
}

/* ---------- what an alert is: zone, type, category ---------- */
function rtZoneOf(b) {
  if (!b || typeof afZones !== 'function') return null;
  return afZones().find(z => afMembers(z).includes(b)) || null;
}
function rtCatOf(tagId) {
  const R = rtDoc();
  if (tagId && R.cat[tagId]) return R.cat[tagId];
  const t = tagId && REG[tagId];
  if (!t) return 'process';
  const s = `${t.id} ${t.desc || ''} ${t.short || ''} ${t.unit || ''}`.toLowerCase();
  if (t.lab || /moist|compact|gcs|green comp|perm|active clay|\bac\b|loi|vcm|bentonite|strength|afs|spall|inoculant|chemistry|carbon|silicon/.test(s)) return 'quality';
  if (/current|\bamps?\b|power|\bkw\b|motor|fault|trip|vibr|bearing|overload|inverter|lube|oil|hydraul|running|stopped|lamp|door/.test(s) || (typeof tagIsText === 'function' && tagIsText(t))) return 'equipment';
  return 'process';
}
function rtInfo(key) {
  const a = (typeof ALERTS !== 'undefined' && ALERTS[key]) || {};
  let kind = 'limit',
    b = a.blk ? B(a.blk) : null,
    tagId = a.tagId || null,
    name = '';
  if (key.startsWith('eng:')) {
    kind = 'eng';
    const r = engDoc().rules.find(x => 'eng:' + x.id === key);
    if (r) {
      b = B(r.equip) || b;
      name = r.name;
      tagId = (r.vars && (r.vars.A || r.vars.B)) || null;
    }
  } else if (key.startsWith('lim:')) {
    tagId = tagId || key.slice(4);
    if (!b && typeof tagOwner === 'function') b = (tagOwner(tagId) || {}).b || null;
    name = REG[tagId] ? REG[tagId].short || REG[tagId].desc || tagId : tagId;
  } else if (key.startsWith('tk:')) kind = 'ticket';
  const z = rtZoneOf(b);
  return { key, kind, b, tagId, cat: kind === 'eng' && !tagId ? 'process' : rtCatOf(tagId), zone: z, zoneId: z ? z.id : null, name, sev: a.sev || 0 };
}
/* the rules that apply, and the teams they name */
function rtMatch(info, sev) {
  const R = rtDoc();
  const ok = r =>
    r.on !== false &&
    (!r.zone || r.zone === info.zoneId) &&
    (!r.kind || r.kind === info.kind) &&
    (+r.sev || 1) <= (sev ?? info.sev) &&
    (!r.cat || r.cat === info.cat);
  const specific = R.rules.filter(r => r.alert && r.alert === info.key && r.on !== false && (+r.sev || 1) <= (sev ?? info.sev));
  const rules = specific.length ? specific : R.rules.filter(r => !r.alert && ok(r));
  const teams = [...new Set(rules.flatMap(r => r.teams || []))].map(rtTeamByName).filter(Boolean);
  const emails = [...new Set(teams.flatMap(rtTeamEmails))];
  const muted = info.zoneId && R.zoneOff[info.zoneId];
  return { rules, specific: !!specific.length, teams, emails: muted ? [] : emails, muted: !!muted };
}

/* ---------- sending: queue one email per alert with all recipients ---------- */
function rtQueue(o) {
  const E = engDoc();
  (E.outbox = E.outbox || []).unshift(Object.assign({ t: Date.now(), ch: 'email', status: 'queued for the server' }, o));
  E.outbox.length = Math.min(E.outbox.length, 300);
}
/* how long the same alert stays quiet after an email: its own setting, else the plant setting (30 / 60 / 100 min …) */
function rtRepeatKey(key) {
  const m = /^st:(.+):\w+$/.exec(key);
  return m ? 'lim:' + m[1] : key;
}
function rtRepeatMin(key) {
  const R = rtDoc(),
    own = R.repeat && +R.repeat[rtRepeatKey(key)];
  return own > 0 ? own : +R.set.repeatMin || 30;
}
function rtSend(key, what) {
  const info = rtInfo(key),
    m = rtMatch(info);
  if (!m.emails.length) return;
  const R = rtDoc(),
    now = Date.now(),
    last = RT.last[key];
  if (what === 'start' && last && now - last < rtRepeatMin(key) * 60000) return;
  RT.last[key] = now;
  const a = ALERTS[key] || {},
    sevN = (typeof SEVN !== 'undefined' && SEVN[a.sev]) || ['', 'Advisory', 'Warning', 'Critical'][a.sev] || '';
  const where = [info.zone ? afName(info.zone) : '', info.b ? info.b.name : a.where || ''].filter(Boolean).join(' · ');
  const zoneOnly = info.zone ? afName(info.zone) : where; // subject: zone only, no equipment code
  const subject = what === 'clear' ? `[Back to normal] ${info.name || a.msg || key} — ${zoneOnly}` : `[${sevN}] ${info.name || key} — ${zoneOnly}`;
  const L = [
    subject,
    '',
    `Alert     : ${a.msg || info.name || key}`,
    `Where     : ${where || '—'}`,
    `Type      : ${RT_KINDS[info.kind]} · ${RT_CATS[info.cat]}`,
    `Severity  : ${sevN}`,
    ...rtWhyLines(key, info, a),
    `Time      : ${new Date().toLocaleString('en-GB')}`,
    `Sent to   : ${m.teams.map(t => t.name).join(', ')}`,
  ];
  rtQueue({ inst: key, team: m.teams.map(t => t.name).join(', '), to: m.emails, subject, text: L.join('\n') });
}
{
  const prev = raise;
  raise = function (key, sev, info) {
    const a0 = ALERTS[key],
      wasOn = !!(a0 && a0.active),
      sev0 = a0 ? a0.sev : 0;
    const r = prev.apply(this, arguments);
    try {
      if (MODE === 'monitor' && !RP) {
        const a = ALERTS[key];
        if (sev > 0 && a && a.active && !wasOn) rtSend(key, 'start');
        else if (sev > 0 && a && a.active && sev > sev0) rtSend(key, 'worse'); // got worse (e.g. Warning → Critical): told at once
        else if (sev <= 0 && wasOn && rtDoc().set.cleared) rtSend(key, 'clear');
      }
    } catch (e) {
      console.warn('alert routing', e);
    }
    return r;
  };
}
/* ticket and engineered-alert emails to a team go to that team's active recipients */
{
  const tkPrev = tkMsg;
  tkMsg = function (t, ch, text) {
    if (ch && ch.ch === 'email') {
      const tm = rtTeamByName(ch.team),
        to = rtTeamEmails(tm);
      if (!to.length) return;
      const first = String(text).split('\n')[0].replace(/^Subject:\s*/, '');
      return rtQueue({ inst: t.no, team: ch.team, to, subject: first, text: String(text) });
    }
    return tkPrev.apply(this, arguments);
  };
  const eoPrev = engOut;
  engOut = function (inst, team, ch, text) {
    if (ch === 'email') {
      const to = rtTeamEmails(rtTeamByName(team));
      if (!to.length) return;
      const r = (engDoc().rules || []).find(x => x.id === inst.rule) || {},
        key = 'eng:' + inst.rule,
        info = rtInfo(key),
        sevN = ['', 'Advisory', 'Warning', 'Critical'][+inst.sev || +r.sev || 2],
        zone = info.zone ? afName(info.zone) : (B(inst.equip) || {}).name || '',
        where = [info.zone ? afName(info.zone) : '', (B(inst.equip) || {}).name || ''].filter(Boolean).join(' · ');
      const subject = `[${sevN}] ${inst.name || r.name || 'Engineered alert'}${zone ? ' — ' + zone : ''}`;
      const msg = String(text || '').trim();
      const L = [subject, '', `Alert     : ${inst.name || r.name}`, `Where     : ${where || '—'}`, `Type      : Engineered alert`, `Severity  : ${sevN}`, ...rtWhyLines(key, info, { sev: +inst.sev || +r.sev }), ...(msg && msg !== '—' ? [`Message   : ${msg}`] : []), `Time      : ${new Date().toLocaleString('en-GB')}`, `Sent to   : ${team}`];
      return rtQueue({ inst: inst.id, team, to, subject, text: L.join('\n') });
    }
    return eoPrev.apply(this, arguments);
  };
}

/* ---------- the screen ---------- */
function rtOpen(tab) {
  RT.tab = tab || RT.tab;
  openModal(
    `<div class="rt-h"><h3>Alert routing</h3><span class="note">Who gets an email when an alert fires — by process zone, alert type, severity and process parameter.</span></div>
     <div class="lc2-seg rt-tabs">${[['teams', 'Teams & emails'], ['routing', 'Routing rules'], ['zones', 'Zones'], ['test', 'Test'], ['log', 'Sent log']].map(([k, l]) => `<button data-rtt="${k}" aria-pressed="${RT.tab === k}">${l}</button>`).join('')}</div>
     <div id="rtBody" class="rt-body"></div><div class="mact"><button class="ib pri" id="rtClose">Done</button></div>`,
    'xl',
  );
  $$('#mbox [data-rtt]').forEach(b => (b.onclick = () => ((RT.tab = b.dataset.rtt), $$('#mbox [data-rtt]').forEach(x => x.setAttribute('aria-pressed', x === b)), rtRender())));
  $('#rtClose').onclick = closeModal;
  rtRender();
}
function rtSave() {
  save();
  if (typeof changed === 'function') changed();
}
function rtRender() {
  const box = $('#rtBody');
  if (!box) return;
  const R = rtDoc(),
    T = rtTeams(),
    Z = typeof afZones === 'function' ? afZones() : [];
  const tg = (on, attr) => `<label class="rt-sw" title="${on ? 'On' : 'Off'}"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><i></i></label>`;
  let h = '';
  if (RT.tab === 'teams') {
    h = `<div class="rt-teams">${T.map(
      (t, i) => `<div class="rt-team${t.on === false ? ' off' : ''}"><div class="rt-th">${tg(t.on !== false, `data-rtton="${i}"`)}<input class="rt-tn" data-rttn="${i}" value="${esc(t.name)}" placeholder="Team name"><span class="note">${rtTeamEmails(t).length} active email${rtTeamEmails(t).length === 1 ? '' : 's'}</span><button class="lb" data-rttd="${i}" title="Delete team">🗑</button></div>
       ${(t.recips || [])
         .map(
           (r, j) => `<div class="rt-rc${r.on === false ? ' off' : ''}">${tg(r.on !== false, `data-rtron="${i}|${j}"`)}<input data-rtrf="${i}|${j}|name" value="${esc(r.name || '')}" placeholder="Name"><input data-rtrf="${i}|${j}|email" value="${esc(r.email || '')}" placeholder="name@plant.com" class="${r.email && !rtEmailOk(r.email) ? 'bad' : ''}"><button class="lb" data-rtrd="${i}|${j}" title="Remove">✕</button></div>`,
         )
         .join('')}<button class="lk" data-rtra="${i}">＋ Add email</button><textarea data-rtrp="${i}" rows="1" placeholder="…or paste several emails (comma, semicolon or new line)"></textarea></div>`,
    ).join('')}</div><button class="sb" id="rtTNew">＋ New team</button>
    <p class="note">Teams are shared with Engineered alerts and Tickets. A team that is off, or a recipient that is off, receives nothing — nothing is deleted.</p>`;
  } else if (RT.tab === 'routing') {
    const alerts = rtAlertList();
    const sel = (k, i, cur, opts) => `<select data-rtf="${i}|${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    h = `<div class="note" style="margin-bottom:8px">Every rule that matches an alert adds its teams (one email per alert, no duplicates). A rule for <b>one specific alert</b> replaces the general rules for that alert. Severity = the lowest level that is sent.</div>
     <div class="rt-tw"><table class="rt-tb"><thead><tr><th>On</th><th>Zone</th><th>Alert type</th><th>Severity</th><th>Process parameter</th><th>Specific alert</th><th>Teams</th><th></th></tr></thead><tbody>${R.rules
       .map(
         (r, i) => `<tr class="${r.on === false ? 'off' : ''}"><td>${tg(r.on !== false, `data-rton="${i}"`)}</td>
         <td>${r.alert ? '<span class="note">—</span>' : sel('zone', i, r.zone || '', [['', 'All zones'], ...Z.map(z => [z.id, afName(z)])])}</td>
         <td>${r.alert ? '<span class="note">—</span>' : sel('kind', i, r.kind || '', [['', 'All types'], ...Object.entries(RT_KINDS)])}</td>
         <td>${sel('sev', i, r.sev || 1, Object.entries(RT_SEV))}</td>
         <td>${r.alert ? '<span class="note">—</span>' : sel('cat', i, r.cat || '', [['', 'All'], ...Object.entries(RT_CATS)])}</td>
         <td>${sel('alert', i, r.alert || '', [['', '(general rule)'], ...alerts])}</td>
         <td><div class="rt-chips">${T.map(t => `<label class="rt-chip${(r.teams || []).includes(t.name) ? ' on' : ''}${t.on === false ? ' dim' : ''}"><input type="checkbox" data-rtrt="${i}" value="${esc(t.name)}" ${(r.teams || []).includes(t.name) ? 'checked' : ''}>${esc(t.name)}</label>`).join('') || '<span class="note">Add teams first</span>'}</div></td>
         <td><button class="lb" data-rtdel="${i}" title="Delete rule">✕</button></td></tr>`,
       )
       .join('') || '<tr><td colspan="8" class="note" style="padding:14px">No routing rules yet — add one, or start with one rule per zone.</td></tr>'}</tbody></table></div>
     <div class="rt-act"><button class="sb" id="rtRNew">＋ Rule</button>${Z.length ? `<button class="sb" id="rtRZones">＋ One rule per zone (${Z.length})</button>` : ''}<span class="rt-set">Same alert again only after <input type="number" min="1" id="rtRep" value="${R.set.repeatMin}" style="width:56px"> min</span><label class="rt-set"><input type="checkbox" id="rtClr" ${R.set.cleared ? 'checked' : ''}> Also email when back to normal</label></div>`;
  } else if (RT.tab === 'zones') {
    h = Z.length
      ? `<div class="note" style="margin-bottom:8px">The process areas drawn on the loop. A muted zone sends no alert emails (e.g. during a shutdown); alerts still show on screen.</div><table class="rt-tb"><thead><tr><th>Email</th><th>Zone</th><th>Equipment</th><th>Teams by rule</th></tr></thead><tbody>${Z.map(z => {
          const ts = [...new Set(R.rules.filter(r => r.on !== false && !r.alert && (!r.zone || r.zone === z.id)).flatMap(r => r.teams || []))];
          return `<tr class="${R.zoneOff[z.id] ? 'off' : ''}"><td>${tg(!R.zoneOff[z.id], `data-rtz="${z.id}"`)}</td><td><b>${esc(afName(z))}</b></td><td>${afMembers(z).filter(b => b.name).length}</td><td>${ts.map(esc).join(', ') || '<span class="rt-warn">no team — alerts from here are not emailed</span>'}</td></tr>`;
        }).join('')}</tbody></table>`
      : '<p class="note">This loop has no process areas yet. Draw them with Insert › Process area; every zone can then be routed.</p>';
  } else if (RT.tab === 'test') {
    const alerts = rtAlertList();
    if (!RT.test && alerts.length) RT.test = alerts[0][0];
    const info = RT.test ? rtInfo(RT.test) : null,
      m = info ? rtMatch(info, RT.testSev) : null;
    h = `<div class="rt-test"><select id="rtTA">${alerts.map(([v, l]) => `<option value="${esc(v)}" ${RT.test === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><div class="lc2-seg">${[[1, 'Advisory'], [2, 'Warning'], [3, 'Critical']].map(([v, l]) => `<button data-rtsv="${v}" aria-pressed="${RT.testSev === v}">${l}</button>`).join('')}</div></div>
     ${info ? `<div class="rt-res"><div><span>Equipment</span><b>${esc(info.b ? info.b.name : '—')}</b></div><div><span>Zone</span><b>${esc(info.zone ? afName(info.zone) : 'not in a zone')}</b>${info.zoneId && R.zoneOff[info.zoneId] ? ' <em class="rt-warn">muted</em>' : ''}</div><div><span>Type</span><b>${RT_KINDS[info.kind]}</b></div>
       <div><span>Process parameter</span><select id="rtTC">${Object.entries(RT_CATS).map(([k, l]) => `<option value="${k}" ${info.cat === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${info.tagId ? `<small class="note">${R.cat[info.tagId] ? 'set by you' : 'worked out from the tag'}</small>` : ''}</div>
       <div><span>Rules</span><b>${m.rules.length ? m.rules.map(r => (r.alert ? 'specific rule' : [r.zone ? afName(B(r.zone) || {}) : 'all zones', r.kind ? RT_KINDS[r.kind] : 'all types', r.cat ? RT_CATS[r.cat] : 'all'].join(' · '))).join(' | ') : 'none match'}</b></div>
       <div><span>Teams</span><b>${m.teams.map(t => esc(t.name) + (t.on === false ? ' (off)' : '')).join(', ') || '—'}</b></div>
       <div><span>Emails</span><b class="mono">${m.emails.map(esc).join(', ') || (m.muted ? 'none — zone muted' : 'none')}</b></div></div>
       <button class="sb" id="rtTSend" ${m.emails.length ? '' : 'disabled'}>Queue a test email to these ${m.emails.length}</button>` : '<p class="note">No alert sources yet — set tag limits or engineered alerts.</p>'}`;
  } else {
    const O = (engDoc().outbox || []).filter(o => o.ch === 'email').slice(0, 60);
    h = `<table class="rt-tb"><thead><tr><th>Time</th><th>Subject</th><th>Team</th><th>To</th><th>Status</th></tr></thead><tbody>${O.map(o => `<tr><td>${esc(typeof emTime === 'function' ? emTime(o.t) : new Date(o.t).toLocaleString())}</td><td title="${esc(o.text || '')}">${esc(o.subject || o.text || '')}</td><td>${esc(o.team || '')}</td><td class="mono">${esc((o.to || []).join(', ') || '— no address')}</td><td>${esc(o.status || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="note" style="padding:14px">Nothing sent yet.</td></tr>'}</tbody></table><p class="note">Emails are queued here and sent by the SandMan server. Hover a subject to see the full text.</p>`;
  }
  box.innerHTML = h;
  rtBind();
}
function rtAlertList() {
  const L = [];
  engDoc().rules.forEach(r => L.push(['eng:' + r.id, `Engineered · ${r.name}${B(r.equip) ? ' · ' + B(r.equip).name : ''}`]));
  Object.values(REG)
    .filter(t => !tagIsText(t) && (t.lo != null || t.hi != null || t.ll != null || t.hh != null))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .forEach(t => L.push(['lim:' + t.id, `Limit · ${t.short || t.desc || t.id} · ${t.id}`]));
  return L;
}
function rtBind() {
  const R = rtDoc(),
    T = rtTeams(),
    q = s => $$('#rtBody ' + s),
    re = () => (rtSave(), rtRender());
  q('[data-rtton]').forEach(x => (x.onchange = () => ((T[+x.dataset.rtton].on = x.checked), re())));
  q('[data-rttn]').forEach(x => (x.onchange = () => {
    const t = T[+x.dataset.rttn],
      old = t.name,
      nw = x.value.trim();
    if (!nw) return re();
    if (T.some(o => o !== t && o.name === nw)) return toast('A team with that name exists'), re();
    t.name = nw;
    R.rules.forEach(r => (r.teams = (r.teams || []).map(n => (n === old ? nw : n)))); // keep the routing when renaming
    engDoc().rules.forEach(r => (r.teams || []).forEach(tm => tm.team === old && (tm.team = nw)));
    re();
  }));
  q('[data-rttd]').forEach(x => (x.onclick = () => {
    const t = T[+x.dataset.rttd];
    if (!confirm(`Delete the team “${t.name}”? It is removed from every routing rule.`)) return;
    pushUndo();
    T.splice(+x.dataset.rttd, 1);
    R.rules.forEach(r => (r.teams = (r.teams || []).filter(n => n !== t.name)));
    re();
  }));
  q('[data-rtra]').forEach(x => (x.onclick = () => (T[+x.dataset.rtra].recips.push({ name: '', email: '', on: true }), rtRender(), setTimeout(() => { const ins = $$(`#rtBody [data-rtrf^="${x.dataset.rtra}|"][data-rtrf$="|email"]`); ins.length && ins[ins.length - 1].focus(); }, 20))));
  q('[data-rtrp]').forEach(x => (x.onchange = () => {
    const t = T[+x.dataset.rtrp],
      em = x.value.split(/[\s,;]+/).map(s => s.trim()).filter(rtEmailOk);
    em.forEach(e => !t.recips.some(r => r.email.toLowerCase() === e.toLowerCase()) && t.recips.push({ name: '', email: e, on: true }));
    toast(`${em.length} email${em.length === 1 ? '' : 's'} added`);
    re();
  }));
  q('[data-rtrf]').forEach(x => (x.onchange = () => {
    const [i, j, k] = x.dataset.rtrf.split('|');
    T[+i].recips[+j][k] = x.value.trim();
    if (k === 'email' && x.value && !rtEmailOk(x.value)) toast('That email address does not look right');
    re();
  }));
  q('[data-rtron]').forEach(x => (x.onchange = () => {
    const [i, j] = x.dataset.rtron.split('|');
    T[+i].recips[+j].on = x.checked;
    re();
  }));
  q('[data-rtrd]').forEach(x => (x.onclick = () => {
    const [i, j] = x.dataset.rtrd.split('|');
    T[+i].recips.splice(+j, 1);
    re();
  }));
  const nt = $('#rtTNew');
  if (nt)
    nt.onclick = () => {
      let n = 'New team',
        k = 2;
      while (T.some(t => t.name === n)) n = 'New team ' + k++;
      T.push({ id: 'tm' + Date.now().toString(36), name: n, on: true, recips: [], email: '', phone: '' });
      re();
      setTimeout(() => { const ins = $$('#rtBody [data-rttn]'); ins.length && (ins[ins.length - 1].select(), ins[ins.length - 1].focus()); }, 20);
    };
  /* routing */
  q('[data-rton]').forEach(x => (x.onchange = () => ((R.rules[+x.dataset.rton].on = x.checked), re())));
  q('[data-rtf]').forEach(x => (x.onchange = () => {
    const [i, k] = x.dataset.rtf.split('|');
    R.rules[+i][k] = k === 'sev' ? +x.value : x.value || '';
    re();
  }));
  q('[data-rtrt]').forEach(x => (x.onchange = () => {
    const r = R.rules[+x.dataset.rtrt];
    r.teams = x.checked ? [...new Set([...(r.teams || []), x.value])] : (r.teams || []).filter(n => n !== x.value);
    re();
  }));
  q('[data-rtdel]').forEach(x => (x.onclick = () => (R.rules.splice(+x.dataset.rtdel, 1), re())));
  const rn = $('#rtRNew');
  if (rn) rn.onclick = () => (R.rules.push({ id: 'rr' + Date.now().toString(36), on: true, zone: '', kind: '', sev: 2, cat: '', alert: '', teams: [] }), re());
  const rz = $('#rtRZones');
  if (rz)
    rz.onclick = () => {
      let n = 0;
      afZones().forEach(z => {
        if (R.rules.some(r => r.zone === z.id && !r.alert)) return;
        R.rules.push({ id: 'rr' + Date.now().toString(36) + n, on: true, zone: z.id, kind: '', sev: 2, cat: '', alert: '', teams: [] });
        n++;
      });
      toast(n ? `${n} rule${n > 1 ? 's' : ''} added — tick the teams for each zone` : 'Every zone already has a rule');
      re();
    };
  const rp = $('#rtRep');
  if (rp) rp.onchange = () => ((R.set.repeatMin = Math.max(1, +rp.value || 30)), re());
  const rc = $('#rtClr');
  if (rc) rc.onchange = () => ((R.set.cleared = rc.checked), re());
  /* zones */
  q('[data-rtz]').forEach(x => (x.onchange = () => {
    if (x.checked) delete R.zoneOff[x.dataset.rtz];
    else R.zoneOff[x.dataset.rtz] = 1;
    re();
  }));
  /* test */
  const ta = $('#rtTA');
  if (ta) ta.onchange = () => ((RT.test = ta.value), rtRender());
  q('[data-rtsv]').forEach(x => (x.onclick = () => ((RT.testSev = +x.dataset.rtsv), rtRender())));
  const tc = $('#rtTC');
  if (tc)
    tc.onchange = () => {
      const info = rtInfo(RT.test);
      if (info.tagId) (R.cat[info.tagId] = tc.value), re();
    };
  const ts = $('#rtTSend');
  if (ts)
    ts.onclick = () => {
      const info = rtInfo(RT.test),
        m = rtMatch(info, RT.testSev);
      rtQueue({ inst: 'test', team: m.teams.map(t => t.name).join(', '), to: m.emails, subject: `[Test] ${info.name || RT.test}`, text: `Test email from Digital Loop alert routing.\nAlert: ${info.name || RT.test}\nZone: ${info.zone ? afName(info.zone) : '—'}` });
      toast(`Test email queued for ${m.emails.length} recipient${m.emails.length === 1 ? '' : 's'}`);
    };
}

/* ---------- where to open it ---------- */
document.addEventListener(
  'click',
  e => {
    const t = e.target.closest && e.target.closest('#rtOpenBtn,[data-rtopen]');
    if (t) (e.preventDefault(), rtOpen(t.dataset.rtopen || 'teams'));
  },
  true,
);
/* Tickets › Settings and Alert monitoring › Teams get a link */
setInterval(() => {
  try {
    const nav = $('.tkq-nav');
    if (nav && !nav.querySelector('[data-rtopen]')) {
      const rul = nav.querySelector('#tkwRul');
      rul && rul.insertAdjacentHTML('beforebegin', '<button class="tkq-q" data-rtopen="routing"><span>Alert routing (email)</span></button>');
    }
    const eb = $('#emBody');
    if (eb && typeof EM !== 'undefined' && EM.tab === 'teams' && !eb.querySelector('[data-rtopen]'))
      eb.insertAdjacentHTML('afterbegin', '<div class="rt-ban">Teams, their email recipients and which zones they receive alerts from are set in <button class="lk" data-rtopen="teams">Alert routing</button>.</div>');
  } catch (e) {}
}, 700);

document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="rtCss">
.rt-h{display:flex;align-items:baseline;gap:12px;margin-bottom:8px}.rt-h h3{margin:0}
.rt-tabs{margin-bottom:10px}.rt-body{min-height:420px;max-height:68vh;overflow:auto}
.rt-teams{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px;margin-bottom:10px}
.rt-team{border:1px solid var(--line);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;background:var(--panel)}.rt-team.off{opacity:.55}
.rt-th{display:flex;align-items:center;gap:8px}.rt-tn{flex:1;font-weight:700;font-size:14px;border:1px solid transparent;border-radius:6px;padding:4px 6px;background:none}.rt-tn:hover,.rt-tn:focus{border-color:var(--line)}
.rt-rc{display:grid;grid-template-columns:34px 1fr 1.6fr 24px;gap:6px;align-items:center}.rt-rc.off input{opacity:.5}.rt-rc input{min-width:0;padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-size:12.5px}.rt-rc input.bad{border-color:#dc2626;background:#fef2f2}
.rt-team textarea{height:34px!important;min-height:34px;flex:none;font-size:12px;border:1px dashed var(--line);border-radius:6px;padding:5px 7px;resize:vertical}
.rt-sw{position:relative;display:inline-block;width:30px;height:17px;flex:none}.rt-sw input{opacity:0;width:0;height:0}.rt-sw i{position:absolute;inset:0;background:#cbd5e1;border-radius:9px;cursor:pointer;transition:.15s}.rt-sw i::after{content:'';position:absolute;left:2px;top:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:.15s}.rt-sw input:checked+i{background:#16a34a}.rt-sw input:checked+i::after{left:15px}
.rt-tw{overflow:auto}.rt-tb{width:100%;border-collapse:collapse;font-size:12.5px}.rt-tb th{text-align:left;font-size:11.5px;color:var(--muted);padding:6px;border-bottom:1px solid var(--line);white-space:nowrap}.rt-tb td{padding:6px;border-bottom:1px solid var(--line);vertical-align:top}.rt-tb tr.off td{opacity:.5}.rt-tb select{max-width:190px;font-size:12.5px}
.rt-chips{display:flex;flex-wrap:wrap;gap:4px;min-width:280px;max-width:360px}.rt-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:12px;padding:2px 9px;cursor:pointer;font-size:12px}.rt-chip input{display:none}.rt-chip.on{background:#1f6feb;border-color:#1f6feb;color:#fff}.rt-chip.dim{opacity:.6}
.rt-act{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}.rt-set{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted)}
.rt-warn{color:#b45309;font-style:normal;font-weight:600}
.rt-test{display:flex;gap:10px;align-items:center;margin-bottom:12px}.rt-test select{flex:1;max-width:520px}
.rt-res{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}.rt-res>div{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:3px}.rt-res span{font-size:11.5px;color:var(--muted)}.rt-res>div:nth-last-child(-n+3){grid-column:1/-1}
.rt-ban{margin-bottom:10px;padding:8px 10px;border-radius:8px;background:#eef4ff;font-size:12.5px}
</style>`,
);

/* v10.4 — the email says why it fired, in plain words (no LL / HH jargon) */
function rtWhyLines(key, info, a) {
  if (key.startsWith('eng:')) {
    const r = (engDoc().rules || []).find(x => 'eng:' + x.id === key);
    if (!r) return [`Value     : —`];
    const vals = ['A', 'B', 'C', 'D'].filter(k => r.vars && r.vars[k] && REG[r.vars[k]]).map(k => `${REG[r.vars[k]].short || REG[r.vars[k]].desc || r.vars[k]} ${tagTxt(r.vars[k])}`);
    const L = [`Values    : ${vals.join(' · ') || '—'}`, `Condition : ${typeof engCondText === 'function' ? engCondText(r) : ''}`];
    if (r.cause) L.push(`Cause     : ${r.cause}`);
    if (r.action) L.push(`Action    : ${r.action}`);
    return L;
  }
  const id = info.tagId,
    t = id && REG[id];
  if (!t) return [`Value     : —`];
  const v = val(id),
    sev = (a && a.sev) || 0,
    lim = (hiK, loK) => (v != null && t[hiK] != null && v >= t[hiK] ? `above the limit (${t[hiK]}${t.unit ? ' ' + t.unit : ''})` : v != null && t[loK] != null && v <= t[loK] ? `below the limit (${t[loK]}${t.unit ? ' ' + t.unit : ''})` : '');
  const why = sev >= 3 ? lim('hh', 'll') || lim('hi', 'lo') : lim('hi', 'lo');
  return [`Value     : ${tagTxt(id)}${why ? ' — ' + why : ''}`];
}
