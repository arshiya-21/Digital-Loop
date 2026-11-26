/*! SandMan Digital Loop Studio — 27q-ticket-ui.js
 *  v10.4 — Tickets screens in the style of service desks (Jira Service Management / Zoho Desk).
 *  Same workflow, rules and data as 27p-ticket-workflow.js; only the screens change:
 *   · left sidebar of queues (My open, Unassigned, All open, Overdue, Waiting, Verifying, Recently closed, Cancelled)
 *     and teams, with counts
 *   · queue as a dense table (key, summary, status lozenge, priority, assignee, SLA, updated) or as a board
 *   · ticket page: title, status button with the next steps, description, readings, resolution, activity
 *     (All / Comments / History) with a comment box; right side Details, SLA and Dates cards. */

const TKQ_LOZ = {
  new: ['NEW', '#42526e', '#dfe1e6'],
  ack: ['ACKNOWLEDGED', '#0747a6', '#deebff'],
  progress: ['IN PROGRESS', '#0747a6', '#b3d4ff'],
  waiting: ['WAITING', '#974f0c', '#fff0b3'],
  resolved: ['RESOLVED', '#006644', '#e3fcef'],
  closed: ['CLOSED', '#006644', '#abf5d1'],
  cancelled: ['CANCELLED', '#5e6c84', '#ebecf0'],
};
const tkqLoz = st => `<span class="tkq-loz" style="--f:${TKQ_LOZ[st][1]};--b:${TKQ_LOZ[st][2]}">${TKQ_LOZ[st][0]}</span>`;
const tkqPri = p =>
  `<span class="tkq-pri tkq-pri-${p}" title="${esc(p)} priority">${p === 'High' ? '<svg viewBox="0 0 16 16"><path d="M3 10l5-5 5 5" /></svg>' : p === 'Low' ? '<svg viewBox="0 0 16 16"><path d="M3 6l5 5 5-5" /></svg>' : '<svg viewBox="0 0 16 16"><path d="M3 6h10M3 10h10" /></svg>'}${esc(p)}</span>`;
const tkqAv = (n, big) => `<span class="tkq-av${big ? ' big' : ''}" style="--h:${[...String(n || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${n ? tkwIni(n) : '?'}</span>`;
function tkqAgo(t) {
  if (!t) return '—';
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : s < 7 * 86400 ? Math.round(s / 86400) + ' d ago' : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
const tkqUpd = t => (t.hist && t.hist.length ? t.hist[t.hist.length - 1].t : t.created);
const TKQ = { queue: 'open' };
TKW.view = 'list'; // queues open as a list, like a service desk; Board is one click away
function tkqQueues(T) {
  const me = tkwMe(),
    now = Date.now(),
    act = t => TKW_ACTIVE.includes(t.status),
    late = t => act(t) && ((t.status === 'new' && now > t.ackDue) || (t.status !== 'waiting' && now > t.fixDue));
  const Q = [
    ['mine', 'My open tickets', t => act(t) && me && (t.person === me.name || (!t.person && tkwTeamsOf(me).includes(t.owner)))],
    ['unassigned', 'Unassigned', t => act(t) && !t.person],
    ['open', 'All open', act],
    ['late', 'Overdue (SLA breached)', late],
    ['waiting', 'Waiting', t => t.status === 'waiting'],
    ['verify', 'Resolved · verifying', t => t.status === 'resolved'],
    ['closed', 'Recently closed', t => t.status === 'closed' && now - (t.closedAt || 0) < 30 * 86400000],
    ['cancelled', 'Cancelled', t => t.status === 'cancelled'],
    ['all', 'All tickets · history', () => true],
  ];
  const teams = typeof engDoc === 'function' ? engDoc().teams.map(t => t.name) : [];
  teams.forEach(n => Q.push(['team:' + n, n, t => act(t) && t.owner === n, 'team']));
  return Q;
}
function tkqSla(t) {
  const now = Date.now();
  const one = (lab, due, done, paused) => {
    if (done) return { lab, txt: done <= due ? 'Met' : 'Breached', cls: done <= due ? 'met' : 'br', pct: 100 };
    if (paused) return { lab, txt: 'Paused', cls: 'pz', pct: 50 };
    const total = due - t.created,
      left = due - now;
    return { lab, txt: tkwLeft(left), cls: left < 0 ? 'br' : left < total * 0.25 ? 'wr' : 'ok', pct: Math.max(0, Math.min(100, ((now - t.created) / Math.max(1, total)) * 100)) };
  };
  const out = [one('Time to first response', t.ackDue, t.ackAt)];
  if (!['cancelled'].includes(t.status)) out.push(one('Time to resolution', t.fixDue, t.resolvedAt, t.status === 'waiting'));
  return out;
}
function tkqSlaCell(t) {
  if (!TKW_ACTIVE.includes(t.status)) return t.status === 'resolved' ? '<span class="tkq-sl met">Verifying</span>' : '<span class="tkq-dim">—</span>';
  const s = tkqSla(t).find(x => x.cls !== 'met') || tkqSla(t)[0];
  return `<span class="tkq-sl ${s.cls}" title="${esc(s.lab)}">${s.cls === 'br' ? '⚠ ' : s.cls === 'pz' ? '⏸ ' : '⏱ '}${s.txt}</span>`;
}
function tkqList(L) {
  return `<table class="tkq-tb"><thead><tr><th style="width:92px">Key</th><th>Summary</th><th style="width:130px">Status</th><th style="width:96px">Priority</th><th style="width:170px">Assignee</th><th style="width:130px">SLA</th><th style="width:100px">Updated</th></tr></thead><tbody>${
    L.map(
      t => `<tr data-tkw="${t.no}"><td class="tkq-key">${t.no}</td><td><div class="tkq-sum">${esc(t.name)}${t.reopened ? ` <span class="tkq-tag re">↺ reopened ${t.reopened}×</span>` : ''}${t.source === 'manual' ? ' <span class="tkq-tag">reported</span>' : ''}</div><div class="tkq-sub">${esc((B(t.equip) || {}).name || '—')} · ${esc(t.process || '')} · ${esc(t.owner)}</div></td><td>${tkqLoz(t.status)}</td><td>${tkqPri(t.prio)}</td><td>${t.person ? `${tkqAv(t.person)} ${esc(t.person)}` : '<span class="tkq-dim">Unassigned</span>'}</td><td>${tkqSlaCell(t)}</td><td class="tkq-dim">${tkqAgo(tkqUpd(t))}</td></tr>`,
    ).join('') || `<tr><td colspan="7"><div class="tkq-empty"><b>No tickets in this queue</b><span>A ticket is made when the same alert repeats on the set days in a row, or when someone reports a problem.</span></div></td></tr>`
  }</tbody></table>`;
}
function tkqDesc(t) {
  if (t.source === 'manual') return t.desc ? esc(t.desc) : '<span class="tkq-dim">No description.</span>';
  const b = B(t.equip);
  const v = t.trig && t.trig[0] && t.trig[0].vals ? Object.entries(t.trig[0].vals).filter(([, x]) => x != null && isFinite(x)).map(([k, x]) => `${esc(k)} = ${fmtN(x, 2)}`).join(', ') : '';
  return `The alert <b>${esc(t.name.replace(/ — recurring$/, ''))}</b> on <b>${esc((b || {}).name || '—')}</b> was active on <b>${t.days} days</b> (rule: ${(() => { const w = tkwWin(t.key); return w ? `within the last ${w} days` : 'in a row'; })()}) (${t.count} times in total since ${emTime(t.first)}).${v ? ` Latest values: ${v}.` : ''}<br>Find the cause, fix it and resolve the ticket with the root cause and action taken. The alert is then watched for ${tkDoc().set.verifyDays} days before the ticket closes.`;
}
function tkqStatusMenu(t) {
  const steps = [];
  const add = (act, lab, to) => steps.push({ act, lab, to, ok: tkwCan(t, act) });
  if (t.status === 'new') add('ack', 'Acknowledge', 'ack');
  if (t.status === 'ack') add('start', 'Start work', 'progress');
  if (t.status === 'waiting') add('resume', 'Resume work', 'progress');
  if (t.status === 'progress') add('wait', 'Put on hold (waiting)…', 'waiting');
  if (t.status === 'ack' || t.status === 'progress') add('resolve', 'Resolve…', 'resolved');
  if (t.status === 'resolved') add('closeNow', 'Close now (skip verification)…', 'closed');
  if (t.status === 'new' || t.status === 'ack') add('cancel', 'Cancel ticket…', 'cancelled');
  if (['resolved', 'closed', 'cancelled'].includes(t.status)) add('reopen', 'Reopen…', 'progress');
  return `<div class="tkq-stw"><button class="tkq-stb" id="tkqSt" style="--f:${TKQ_LOZ[t.status][1]};--b:${TKQ_LOZ[t.status][2]}">${TKQ_LOZ[t.status][0]} <span>▾</span></button><div class="tkq-menu" id="tkqMenu" hidden>${steps
    .map(s => `<button type="button" data-act="${s.act}" ${s.ok ? '' : `disabled title="${esc(tkwWhy(t, s.act))}"`}><span>${esc(s.lab)}</span>${tkqLoz(s.to)}</button>`)
    .join('') || '<div class="tkq-dim" style="padding:8px 12px">No further steps</div>'}<div class="tkq-mf">Workflow: New → Acknowledged → In progress → Resolved → Closed</div></div></div>`;
}
function tkqIssue(t) {
  tkwSla(t);
  const b = B(t.equip),
    me = tkwMe();
  const sla = tkqSla(t)
    .map(s => `<div class="tkq-slr"><div class="tkq-slh"><span>${s.lab}</span><b class="${s.cls}">${s.txt}</b></div><div class="tkq-bar ${s.cls}"><i style="width:${s.pct}%"></i></div></div>`)
    .join('');
  const tab = TKQ.atab || 'all';
  const H = t.hist.slice().reverse().filter(h => (tab === 'comments' ? h.k === 'note' : tab === 'history' ? h.k !== 'note' : true));
  const act = H.map(
    h => `<div class="tkq-ev${h.k === 'note' ? ' cm' : ''}">${h.by === 'System' ? '<span class="tkq-av sys">⚙</span>' : tkqAv(h.by)}<div><div class="tkq-evh"><b>${esc(h.by)}</b>${h.k === 'note' ? '' : ` <span class="tkq-dim">${h.k === 'esc' ? 'escalation' : h.k === 'reopen' ? 'reopened' : 'updated the ticket'}</span>`}<span class="tkq-dim"> · ${emTime(h.t)}</span></div><div class="tkq-evb${h.k === 'note' ? ' bubble' : ''}">${esc(h.text)}</div></div></div>`,
  ).join('');
  const row = (k, v) => `<div class="tkq-dr"><span>${k}</span><div>${v}</div></div>`;
  return `<div class="tkq-bc"><button class="lk" id="tkqBack">Tickets</button> / <button class="lk" id="tkqBackQ">${esc((tkqQueues(tkDoc()).find(q => q[0] === TKQ.queue) || [, 'Queue'])[1])}</button> / <b>${t.no}</b></div>
  <div class="tkq-is"><div class="tkq-im">
   <h1>${esc(t.name)}</h1>
   <div class="tkq-ia">${tkqStatusMenu(t)}${TKW_ACTIVE.includes(t.status) && me && t.person !== me.name && tkwCan(t, 'assign') ? '<button class="tkq-btn" id="tkqMe">Assign to me</button>' : ''}${TKW_ACTIVE.includes(t.status) ? `<button class="tkq-btn" data-act="assign" ${tkwCan(t, 'assign') ? '' : 'disabled'}>Assign…</button>` : ''}${TKW_ACTIVE.includes(t.status) && typeof mntForm === 'function' ? `<button class="tkq-btn" data-act="wo">🔧 Create work order</button>` : ''}${b ? '<button class="tkq-btn" id="tkqLoc">⌖ Locate on loop</button>' : ''}</div>
   <div class="tkq-sec"><h4>Description</h4><div class="tkq-desc">${tkqDesc(t)}</div></div>
   ${t.status === 'waiting' ? `<div class="tkq-note wait"><b>Waiting for ${esc(t.waitReason || '')}</b> — expected ${t.waitUntil ? new Date(t.waitUntil).toLocaleDateString('en-GB') : '—'}. The resolution clock is paused.</div>` : ''}
   ${t.res ? `<div class="tkq-sec"><h4>Resolution</h4><div class="tkq-res"><div><span>Problem area</span>${esc(t.res.cat)}${t.res.cause ? ' · ' + esc(t.res.cause) : ''}</div><div><span>Root cause</span>${esc(t.res.root)}</div><div><span>Action taken</span>${esc(t.res.action)}</div>${t.res.prevent ? `<div><span>Prevention</span>${esc(t.res.prevent)}</div>` : ''}<small>${esc(t.res.by)} · ${emTime(t.res.at)}${t.status === 'resolved' ? ` · verifying until ${emTime(t.verifyUntil)}` : ''}</small></div></div>` : ''}
   ${t.source === 'manual' ? '' : `<div class="tkq-sec"><h4>Readings at each trigger</h4>${tkwTrend(t) || '<span class="tkq-dim">No readings.</span>'}</div>`}
   <div class="tkq-sec"><h4>Activity</h4><div class="tkq-tabs">${[['all', 'All'], ['comments', 'Comments'], ['history', 'History']].map(([k, l]) => `<button data-atab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="tkq-cmp">${me ? tkqAv(me.name) : tkqAv('?')}<div><textarea id="tkwCm" rows="2" placeholder="Add a comment… what was checked, part ordered, next step"></textarea><div class="tkq-cmb"><span class="tkq-dim">Comments are kept with the ticket</span><button class="tkq-btn pri" id="tkwCmB">Save</button></div></div></div>
    <div class="tkq-act">${act || '<span class="tkq-dim">Nothing yet.</span>'}</div></div>
  </div>
  <aside class="tkq-ir">
   <div class="tkq-card"><h4>Details</h4>
    ${row('Assignee', t.person ? `${tkqAv(t.person)} ${esc(t.person)}` : '<span class="tkq-dim">Unassigned</span>')}
    ${row('Reporter', t.source === 'manual' ? `${tkqAv(t.raisedBy)} ${esc(t.raisedBy || '')}` : '<span class="tkq-av sys">⚙</span> Alert monitor')}
    ${row('Team', esc(t.owner))}
    ${row('Priority', tkqPri(t.prio))}
    ${row('Equipment', `${esc((b || {}).name || '—')}${b ? ' <button class="lk" id="tkqLoc2">Locate</button>' : ''}`)}
    ${row('Process', esc(t.process || '—'))}
    ${row('Request type', t.source === 'manual' ? 'Reported problem' : 'Repeated alert')}
    ${t.source === 'manual' ? '' : row('Repeats', `${t.days} bad days${tkwWin(t.key) ? ` of ${tkwWin(t.key)}` : ' in a row'} · ${t.count}×`)}
    ${row('Copy to', esc((t.cc || []).join(', ') || '—'))}
    ${t.reopened ? row('Reopened', `<span class="tkq-tag re">${t.reopened}×</span>`) : ''}
   </div>
   <div class="tkq-card"><h4>SLA</h4>${sla}${t.paused ? `<div class="tkq-dim" style="font-size:12px">Paused ${emDur(t.paused)} in total</div>` : ''}${t.esc ? `<div class="tkq-dim" style="font-size:12px;color:#bf2600">Escalated: level ${t.esc}</div>` : ''}</div>
   <div class="tkq-card"><h4>Dates</h4>${row('Created', emTime(t.created))}${row('Updated', tkqAgo(tkqUpd(t)))}${row('Respond by', emTime(t.ackDue))}${row('Resolve by', emTime(t.fixDue))}${t.resolvedAt ? row('Resolved', emTime(t.resolvedAt)) : ''}${t.closedAt ? row('Closed', emTime(t.closedAt)) : ''}</div>
  </aside></div>`;
}
tkwPage = function (force) {
  const box = $('#tkBox');
  if (!box) return;
  const ae = document.activeElement;
  if (!force && ae && box.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
  if (!force && (TKW.drag || ($('#tkqMenu') && !$('#tkqMenu').hidden))) return;
  const T = tkwDoc(),
    me = tkwMe(),
    P = tkwPeople(),
    Q = tkqQueues(T),
    q = Q.find(x => x[0] === TKQ.queue) || Q[2],
    t = TKW.sel && T.list.find(x => x.no === TKW.sel);
  const prioOrd = { High: 0, Medium: 1, Low: 2 };
  let L = tkwFilter(T.list.filter(q[2]));
  L.sort((a, b) => prioOrd[a.prio] - prioOrd[b.prio] || tkqUpd(b) - tkqUpd(a));
  const side = `<nav class="tkq-nav"><div class="tkq-nh">Queues</div>${Q.filter(x => !x[3])
    .map(x => {
      const n = T.list.filter(x[2]).length;
      return `<button class="tkq-q${x[0] === TKQ.queue && !t ? ' on' : ''}${x[0] === 'late' && n ? ' red' : ''}" data-q="${esc(x[0])}"><span>${esc(x[1])}</span><b>${n}</b></button>`;
    })
    .join('')}<div class="tkq-nh">Teams</div>${Q.filter(x => x[3])
    .map(x => `<button class="tkq-q${x[0] === TKQ.queue && !t ? ' on' : ''}" data-q="${esc(x[0])}"><span>${esc(x[1])}</span><b>${T.list.filter(x[2]).length}</b></button>`)
    .join('')}<div class="tkq-nh">Settings</div><button class="tkq-q" id="tkwRul"><span>Ticket rules</span></button><button class="tkq-q" id="tkwSet"><span>Deadlines &amp; people</span></button><button class="tkq-q" id="tkpAlerts"><span>Alert monitoring</span></button></nav>`;
  const top = `<header class="tkq-top"><div class="tkq-brand"><span class="tkq-logo">🎫</span><b>Tickets</b><span class="tkq-dim">Digital Loop service desk</span></div>
   <input class="tkq-search" id="tkwQ" placeholder="Search tickets" value="${esc(TKW.q)}">
   <button class="tkq-btn pri" id="tkwNew">＋ Create</button>
   <div class="tkq-user">${me ? `${tkqAv(me.name, 1)}<span><b>${esc(me.name)}</b><small>${tkwIsSup(me) ? 'Supervisor' : esc(tkwTeamsOf(me).join(', '))}</small></span>` : '<b class="tkq-red">Not signed in</b>'}${P.length ? `<button class="lk" id="tkwSign">${me ? 'Switch' : 'Sign in'}</button>` : ''}</div>
   <button class="tkp-x" id="tkpClose" title="Back to the loop">✕</button></header>`;
  const teams = typeof engDoc === 'function' ? engDoc().teams.map(x => x.name) : [],
    eqs = [...new Set(T.list.map(x => x.equip).filter(Boolean))];
  const sel = (k, opts) => `<select class="tkq-fs" data-tkwf="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${TKW[k] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const main = t
    ? tkqIssue(t)
    : `<div class="tkq-qh"><h2>${esc(q[1])}</h2><span class="tkq-dim">${L.length} ticket${L.length === 1 ? '' : 's'}</span><div class="tkq-qr">${sel('prio', [['', 'Priority: all'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']])}${sel('equip', [['', 'Equipment: all'], ...eqs.map(id => [id, (B(id) || {}).name || id])])}<button class="tkq-btn" id="tkqCsv" title="Download this queue with every date, SLA result and resolution">⭳ Export CSV</button><div class="tkq-vs"><button data-tkv="list" class="${TKW.view !== 'board' ? 'on' : ''}">☰ List</button><button data-tkv="board" class="${TKW.view === 'board' ? 'on' : ''}">▦ Board</button></div></div></div>
     ${tkwKpis(T)}
     <div class="tkq-body">${TKW.view === 'board' ? tkwBoard({ list: L }) : tkqList(L)}</div>`;
  const html = `${top}<div class="tkq-wrap">${side}<main class="tkq-main">${main}</main></div>`;
  tkBtnSync();
  if (box.dataset.h === html) return;
  const sc = box.querySelector('.tkq-main') ? box.querySelector('.tkq-main').scrollTop : 0;
  box.dataset.h = html;
  box.innerHTML = html;
  box.classList.add('tkq');
  if (box.querySelector('.tkq-main')) box.querySelector('.tkq-main').scrollTop = sc;
  tkqBind(T, t);
};
tkPageRender = tkwPage;
function tkqBind(T, t) {
  const on = (s, f) => {
    const e = $(s);
    if (e) e.onclick = f;
  };
  on('#tkpClose', tkPageClose);
  on('#tkpAlerts', () => typeof openAlertMonitor === 'function' && openAlertMonitor('live'));
  on('#tkwNew', tkwNew);
  on('#tkwSet', tkwSettings);
  on('#tkwRul', tkwRules);
  on('#tkwSign', tkwSignIn);
  $$('#tkBox [data-q]').forEach(b => (b.onclick = () => ((TKQ.queue = b.dataset.q), (TKW.sel = null), tkwPage(true))));
  $$('#tkBox [data-tkv]').forEach(b => (b.onclick = () => ((TKW.view = b.dataset.tkv), tkwPage(true))));
  $$('#tkBox [data-tkwf]').forEach(s => (s.onchange = () => ((TKW[s.dataset.tkwf] = s.value), tkwPage(true))));
  const q = $('#tkwQ');
  q.oninput = () => {
    TKW.q = q.value;
    TKW.sel = null;
    if (TKW.q && TKQ.queue !== 'all') TKQ.queue = 'all';
    const p = q.selectionStart;
    tkwPage(true);
    const n = $('#tkwQ');
    n.focus();
    n.setSelectionRange(p, p);
  };
  $$('#tkBox [data-tkw]').forEach(r => (r.onclick = () => ((TKW.sel = r.dataset.tkw), tkwPage(true))));
  /* board drag and drop (same rules as 27p) */
  $$('#tkBox .tkw-card').forEach(c => {
    c.ondragstart = e => ((TKW.drag = c.dataset.tkw), e.dataTransfer.setData('text/plain', c.dataset.tkw), c.classList.add('dragging'));
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
      const map = { ack: from === 'new' ? 'ack' : null, progress: from === 'ack' ? 'start' : from === 'waiting' ? 'resume' : ['resolved', 'closed', 'cancelled'].includes(from) ? 'reopen' : null, waiting: from === 'progress' ? 'wait' : null, resolved: from === 'progress' || from === 'ack' ? 'resolve' : null, closed: from === 'resolved' ? 'closeNow' : from === 'new' || from === 'ack' ? 'cancel' : null };
      if (to === from) return;
      if (!map[to]) return toast(`${TKW_ST[from][0]} → ${TKW_ST[to] ? TKW_ST[to][0] : to} is not a step in the workflow`), tkwPage(true);
      tkwAct(tk, map[to]);
      tkwPage(true);
    };
  });
  on('#tkqCsv', () => tkqCsv(T));
  if (!t) return;
  on('#tkqBack', () => ((TKW.sel = null), (TKQ.queue = 'open'), tkwPage(true)));
  on('#tkqBackQ', () => ((TKW.sel = null), tkwPage(true)));
  const stb = $('#tkqSt'),
    menu = $('#tkqMenu');
  if (stb)
    stb.onclick = e => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    };
  document.addEventListener('click', function cl(e) {
    if (menu && !menu.contains(e.target) && e.target !== stb) {
      menu.hidden = true;
      document.removeEventListener('click', cl);
    }
  });
  $$('#tkBox [data-act]').forEach(b => (b.onclick = () => (menu && (menu.hidden = true), tkwAct(t, b.dataset.act))));
  on('#tkqMe', () => {
    const me = tkwMe();
    if (!me) return toast('Sign in first');
    t.person = me.name;
    tkwLog(t, `Assigned to ${me.name}`);
    save();
    tkwPage(true);
  });
  const loc = () => {
    tkPageClose();
    if (typeof mpLocate === 'function') mpLocate(t.equip);
    else select({ t: 'b', id: t.equip });
  };
  on('#tkqLoc', loc);
  on('#tkqLoc2', loc);
  $$('#tkBox [data-atab]').forEach(b => (b.onclick = () => ((TKQ.atab = b.dataset.atab), tkwPage(true))));
  on('#tkwCmB', () => {
    const v = $('#tkwCm').value.trim();
    if (!v) return;
    if (!tkwMe()) return toast('Sign in first');
    tkwLog(t, v, 'note');
    save();
    tkwPage(true);
  });
}
/* ticket history export (the current queue, filters applied) */
function tkqCsv(T) {
  const Q = tkqQueues(T),
    q = Q.find(x => x[0] === TKQ.queue) || Q[2],
    L = tkwFilter(T.list.filter(q[2])).sort((a, b) => a.created - b.created);
  const d = t => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : '');
  const cell = typeof csvCell === 'function' ? csvCell : v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Ticket', 'Problem', 'Equipment', 'Process', 'Team', 'Assignee', 'Priority', 'Status', 'Source', 'Created', 'Acknowledged', 'Respond by', 'Response SLA', 'Resolved', 'Resolve by', 'Resolution SLA', 'Paused (h)', 'Closed', 'Closed by', 'Problem area', 'Root cause', 'Action taken', 'Prevention', 'Reopened', 'Days in a row', 'Times triggered', 'Cancel reason', 'Last update'];
  const rows = L.map(t => [t.no, t.name, (B(t.equip) || {}).name || '', t.process || '', t.owner, t.person || '', t.prio, TKW_ST[t.status][0], t.source === 'manual' ? 'Reported' : 'Repeated alert', d(t.created), d(t.ackAt), d(t.ackDue), t.ackAt ? (t.ackAt <= t.ackDue ? 'Met' : 'Breached') : Date.now() > t.ackDue ? 'Breached' : '', d(t.resolvedAt), d(t.fixDue), t.resolvedAt ? (t.resolvedAt <= t.fixDue ? 'Met' : 'Breached') : TKW_ACTIVE.includes(t.status) && Date.now() > t.fixDue ? 'Breached' : '', ((t.paused || 0) / 3600000).toFixed(1), d(t.closedAt), t.closedBy || '', t.res ? t.res.cat : '', t.res ? t.res.root : '', t.res ? t.res.action : '', t.res ? t.res.prevent || '' : '', t.reopened || 0, t.days || 0, t.count || 0, t.cancelReason || '', d(tkqUpd(t))]);
  const csv = [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
  a.download = `Tickets_${q[1].replace(/[^\w]+/g, '_')}_${tkDay(Date.now())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`${L.length} ticket${L.length === 1 ? '' : 's'} exported`);
}
/* Escape: ticket → queue → loop */
document.addEventListener(
  'keydown',
  e => {
    if (e.key !== 'Escape' || !TKP.on || $('#modal').classList.contains('on')) return;
    const m = $('#tkqMenu');
    if (m && !m.hidden) return e.stopImmediatePropagation(), (m.hidden = true);
  },
  true,
);

document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="tkqCss">
.tkp-box.tkq{padding:0;gap:0;background:#f4f5f7;color:#172b4d;font:14px/1.45 var(--sans)}
.tkq .lk{border:0;background:none;color:#0052cc;font:500 13px var(--sans);cursor:pointer;padding:0}.tkq .lk:hover{text-decoration:underline}
.tkq-top{display:flex;align-items:center;gap:14px;padding:8px 16px;background:#fff;border-bottom:1px solid #dfe1e6;box-shadow:0 1px 1px rgba(9,30,66,.08)}
.tkq-brand{display:flex;align-items:center;gap:8px}.tkq-brand b{font-size:16px}.tkq-logo{width:28px;height:28px;border-radius:6px;background:#0052cc;display:inline-flex;align-items:center;justify-content:center;font-size:15px}
.tkq-search{margin-left:auto;width:320px;border:2px solid #dfe1e6;border-radius:4px;padding:6px 10px;font:14px var(--sans);background:#fafbfc}.tkq-search:focus{border-color:#4c9aff;background:#fff;outline:0}
.tkq-user{display:flex;align-items:center;gap:8px;padding-left:10px;border-left:1px solid #dfe1e6}.tkq-user small{display:block;color:#6b778c;font-size:11.5px;line-height:1.1}.tkq-red{color:#bf2600}
.tkq-btn{border:0;border-radius:3px;background:rgba(9,30,66,.06);color:#42526e;font:500 14px var(--sans);padding:6px 12px;cursor:pointer}.tkq-btn:hover{background:rgba(9,30,66,.12)}.tkq-btn.pri{background:#0052cc;color:#fff}.tkq-btn.pri:hover{background:#0065ff}.tkq-btn:disabled{opacity:.5;cursor:not-allowed}
.tkq-wrap{flex:1;min-height:0;display:grid;grid-template-columns:240px minmax(0,1fr)}
.tkq-nav{background:#f4f5f7;border-right:1px solid #dfe1e6;padding:12px 8px;overflow:auto;display:flex;flex-direction:column;gap:1px}
.tkq-nh{font:700 11px var(--sans);color:#6b778c;letter-spacing:.04em;text-transform:uppercase;padding:14px 10px 6px}.tkq-nh:first-child{padding-top:2px}
.tkq-q{display:flex;justify-content:space-between;align-items:center;border:0;background:none;border-radius:3px;padding:7px 10px;font:14px var(--sans);color:#42526e;cursor:pointer;text-align:left}.tkq-q:hover{background:#ebecf0}.tkq-q.on{background:#deebff;color:#0052cc;font-weight:600}.tkq-q b{font-weight:600;font-size:12px;color:#5e6c84;background:#dfe1e6;border-radius:10px;padding:0 7px}.tkq-q.red b{background:#ffebe6;color:#bf2600}
.tkq-main{overflow:auto;padding:18px 24px;min-height:0}
.tkq-qh{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}.tkq-qh h2{margin:0;font:600 22px var(--sans);color:#172b4d}.tkq-qr{margin-left:auto;display:flex;gap:8px;align-items:center}
.tkq-fs{border:1px solid #dfe1e6;border-radius:3px;padding:5px 8px;font:13px var(--sans);background:#fff;color:#42526e}
.tkq-vs{display:flex;border:1px solid #dfe1e6;border-radius:3px;overflow:hidden}.tkq-vs button{border:0;background:#fff;padding:5px 10px;font:13px var(--sans);color:#42526e;cursor:pointer}.tkq-vs button.on{background:#deebff;color:#0052cc;font-weight:600}
.tkq .tkw-kpis{margin-bottom:14px}.tkq .tkw-k{border-radius:4px;border-color:#dfe1e6;box-shadow:none}
.tkq-body{background:#fff;border:1px solid #dfe1e6;border-radius:4px}
.tkq-tb{width:100%;border-collapse:collapse;font-size:14px}.tkq-tb th{text-align:left;font:600 12px var(--sans);color:#5e6c84;padding:8px 10px;border-bottom:2px solid #dfe1e6}.tkq-tb td{padding:9px 10px;border-bottom:1px solid #ebecf0;vertical-align:middle}.tkq-tb tr[data-tkw]{cursor:pointer}.tkq-tb tr[data-tkw]:hover td{background:#f4f5f7}
.tkq-key{color:#0052cc;font-weight:500;white-space:nowrap}.tkq-sum{font-weight:500;color:#172b4d}.tkq-sub{font-size:12px;color:#6b778c}.tkq-dim{color:#6b778c}
.tkq-loz{display:inline-block;font:700 11px/16px var(--sans);letter-spacing:.02em;color:var(--f);background:var(--b);border-radius:3px;padding:0 5px;white-space:nowrap}
.tkq-pri{display:inline-flex;align-items:center;gap:4px;font-size:13px}.tkq-pri svg{width:14px;height:14px;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.tkq-pri-High svg{stroke:#de350b}.tkq-pri-Medium svg{stroke:#ff991f}.tkq-pri-Low svg{stroke:#2684ff}
.tkq-av{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:hsl(var(--h),55%,45%);color:#fff;font:600 10.5px var(--sans);vertical-align:middle;flex:none}.tkq-av.big{width:32px;height:32px;font-size:12px}.tkq-av.sys{background:#dfe1e6;color:#42526e;font-size:12px}
.tkq-sl{display:inline-block;font:600 12px var(--sans);border-radius:3px;padding:1px 6px;background:#ebecf0;color:#42526e;white-space:nowrap}.tkq-sl.ok{background:#e3fcef;color:#006644}.tkq-sl.wr{background:#fffae6;color:#974f0c}.tkq-sl.br{background:#ffebe6;color:#bf2600}.tkq-sl.met{background:#e3fcef;color:#006644}.tkq-sl.pz{background:#eae6ff;color:#403294}
.tkq-tag{font:600 11px var(--sans);color:#42526e;background:#ebecf0;border-radius:3px;padding:0 5px}.tkq-tag.re{color:#974f0c;background:#fffae6}
.tkq-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:40px;color:#6b778c}.tkq-empty b{color:#172b4d;font-size:15px}
.tkq .tkw-board{background:#fff;padding:10px}.tkq .tkw-col{background:#f4f5f7;border-radius:4px}.tkq .tkw-card{border-radius:3px;box-shadow:0 1px 2px rgba(9,30,66,.25);border-left-width:3px}
.tkq-bc{font-size:14px;color:#6b778c;margin-bottom:8px}.tkq-bc b{color:#42526e}
.tkq-is{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;align-items:start}
.tkq-im h1{margin:0 0 12px;font:500 24px/1.25 var(--sans);color:#172b4d}
.tkq-ia{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;align-items:center}
.tkq-stw{position:relative}.tkq-stb{border:0;border-radius:3px;font:700 13px var(--sans);letter-spacing:.02em;color:var(--f);background:var(--b);padding:6px 12px;cursor:pointer}.tkq-stb span{font-weight:400;margin-left:4px}
.tkq-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:20;min-width:300px;background:#fff;border-radius:4px;box-shadow:0 4px 8px -2px rgba(9,30,66,.25),0 0 1px rgba(9,30,66,.31);padding:6px 0}
.tkq-menu button{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;border:0;background:none;padding:8px 14px;font:14px var(--sans);color:#172b4d;cursor:pointer;text-align:left}.tkq-menu button:hover{background:#f4f5f7}.tkq-menu button:disabled{opacity:.45;cursor:not-allowed}
.tkq-mf{border-top:1px solid #ebecf0;margin-top:4px;padding:6px 14px 2px;font-size:11.5px;color:#6b778c}
.tkq-sec{margin-bottom:22px}.tkq-sec h4{margin:0 0 8px;font:600 14px var(--sans);color:#172b4d}
.tkq-desc{font-size:14px;line-height:1.55}
.tkq-note.wait{background:#fffae6;border-radius:3px;padding:10px 12px;margin-bottom:18px;font-size:14px}
.tkq-res{background:#e3fcef;border-radius:3px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:14px}.tkq-res span{display:inline-block;width:120px;color:#6b778c}.tkq-res small{color:#6b778c}
.tkq-tabs{display:flex;gap:6px;margin-bottom:12px}.tkq-tabs button{border:0;background:rgba(9,30,66,.04);border-radius:3px;padding:4px 10px;font:500 13px var(--sans);color:#42526e;cursor:pointer}.tkq-tabs button.on{background:#253858;color:#fff}
.tkq-cmp{display:grid;grid-template-columns:32px 1fr;gap:10px;margin-bottom:16px}.tkq-cmp textarea{width:100%;box-sizing:border-box;border:1px solid #dfe1e6;border-radius:3px;padding:8px 10px;font:14px var(--sans);resize:vertical}.tkq-cmp textarea:focus{border-color:#4c9aff;outline:0}.tkq-cmb{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:12px}
.tkq-act{display:flex;flex-direction:column;gap:14px}.tkq-ev{display:grid;grid-template-columns:32px 1fr;gap:10px}.tkq-evh{font-size:13.5px}.tkq-evb{font-size:14px;margin-top:2px}.tkq-evb.bubble{background:#f4f5f7;border-radius:3px;padding:8px 10px}
.tkq-ir{display:flex;flex-direction:column;gap:12px;position:sticky;top:0}
.tkq-card{background:#fff;border:1px solid #dfe1e6;border-radius:4px;padding:12px 14px}.tkq-card h4{margin:0 0 8px;font:600 12px var(--sans);color:#5e6c84;text-transform:uppercase;letter-spacing:.04em}
.tkq-dr{display:grid;grid-template-columns:110px 1fr;gap:8px;padding:5px 0;font-size:14px;align-items:center}.tkq-dr>span{color:#6b778c;font-size:13px}.tkq-dr>div{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.tkq-slr{margin-bottom:10px}.tkq-slh{display:flex;justify-content:space-between;font-size:13px}.tkq-slh b.br{color:#bf2600}.tkq-slh b.wr{color:#974f0c}.tkq-slh b.ok,.tkq-slh b.met{color:#006644}.tkq-slh b.pz{color:#403294}
.tkq-bar{height:6px;border-radius:3px;background:#ebecf0;margin-top:4px;overflow:hidden}.tkq-bar i{display:block;height:100%;background:#36b37e}.tkq-bar.wr i{background:#ffab00}.tkq-bar.br i{background:#de350b}.tkq-bar.pz i{background:#6554c0}
</style>`,
);
