/*! SandMan Digital Loop Studio — 27ze-ticket-simple.js
 *  v10.4 final — Tickets made simple (replaces the service-desk screen of 27q on the Tickets page).
 *   Three steps: Open → In progress → Closed. Closing needs one note (cause and action taken).
 *   A closed ticket reopens by itself when the same alert is emailed again within 3 days; it can also be reopened by hand.
 *   One screen: filter chips (Open · In progress · Closed · Overdue · All), search, team filter, one table; click a row →
 *   the ticket on the right: why it was raised (day by day), team / person / priority, notes and history, 2–3 buttons.
 *   No sign-in: a common ticket list — each action records the name typed once in "Your name".
 *  Internally the statuses stay those of 27p: Open = new/ack, In progress = progress/waiting, Closed = resolved/closed/
 *  cancelled — so alerts, emails, escalation and the day log keep working unchanged. */

const TKS = { f: 'open', q: '', team: '', equip: '', tag: '', from: '', to: '', page: 0, size: 15, sel: null, name: '' };
/* the list opens on the last week (opened from 7 days ago up to today); the dates can be changed or cleared */
{
  const ymd = t => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  TKS.from = ymd(Date.now() - 6 * 86400000);
  TKS.to = ymd(Date.now());
}
try {
  TKS.name = localStorage.getItem('dl.tkName') || '';
} catch (e) {}
const tksSt = t => (['new', 'ack'].includes(t.status) ? 'open' : ['progress', 'waiting'].includes(t.status) ? 'progress' : 'closed');
const TKS_LAB = { open: ['Open', '#1f6feb'], progress: ['In progress', '#d97706'], closed: ['Closed', '#15803d'] };
const tksOver = t => tksSt(t) !== 'closed' && t.fixDue && Date.now() > t.fixDue;
/* who acts: the name typed once (common ticket list, no PIN) */
tkwMe = function () {
  return { id: '_me', name: TKS.name || 'Plant user', rk: 'incharge', nopin: true };
};
tkwIsSup = () => true;
/* a closed ticket reopens when the same alert comes back within 3 days */
{
  const prev = tkHit;
  tkHit = function () {
    const S = tkDoc().set;
    S.watchDays = 3;
    S.verifyDays = 0;
    /* closed while the alarm was still on: the same alarm must first return to normal, else the ticket would reopen
       5 s after closing (the alert loop calls tkHit every 5 s while an alert is active) */
    const key = arguments[0];
    if (tkDoc().list.some(t => t.key === key && t.closedActive && ['closed', 'resolved'].includes(t.status))) return;
    return prev.apply(this, arguments);
  };
}
{
  const prev = tkwSet;
  tkwSet = function (t, st) {
    const a = t && ALERTS[t.key];
    if (['closed', 'resolved'].includes(st)) t.closedActive = !!(a && a.active) || undefined;
    else if (t) delete t.closedActive;
    return prev.apply(this, arguments);
  };
}
/* the alarm of a closed ticket is seen back to normal (after the alerts have had 30 s to settle) → it may reopen it again */
setInterval(() => {
  if (MODE !== 'monitor' || RP || performance.now() < 30000) return;
  let dirty = false;
  tkDoc().list.forEach(t => {
    if (t.closedActive && !(ALERTS[t.key] && ALERTS[t.key].active)) (delete t.closedActive), (dirty = true);
  });
  if (dirty) save();
}, 5000);
function tksPill(t) {
  const s = tksSt(t),
    [l, c] = TKS_LAB[s];
  return `<span class="tks-pill" style="--c:${c}">${l}</span>${tksOver(t) ? '<span class="tks-pill" style="--c:#dc2626">Overdue</span>' : ''}${t.reopened ? `<span class="tks-re" title="Reopened ${t.reopened}×">↺${t.reopened}</span>` : ''}`;
}
/* the parameter a ticket is about: a tag (limit alarm) or an engineered alert */
function tksTagOf(t) {
  const k = t.key || '';
  let m = /^(?:lim:|st:)(.+?)(?::\w+)?$/.exec(k);
  if (m && REG[m[1]]) return { id: m[1], label: `${REG[m[1]].short || REG[m[1]].desc || m[1]} · ${m[1]}` };
  if (k.startsWith('eng:') && typeof engDoc === 'function') {
    const r = engDoc().rules.find(x => 'eng:' + x.id === k);
    return { id: k, label: `ƒx ${r ? r.name : k.slice(4)} (engineered)` };
  }
  return null;
}
const tksDay0 = s => (s ? new Date(s + 'T00:00').getTime() : null);
const tksDate = t => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
function tksList() {
  const T = tkDoc(),
    q = TKS.q.trim().toLowerCase();
  return T.list
    .filter(t => (TKS.f === 'all' ? true : TKS.f === 'over' ? tksOver(t) : tksSt(t) === TKS.f))
    .filter(t => !TKS.team || t.owner === TKS.team)
    .filter(t => !TKS.equip || t.equip === TKS.equip)
    .filter(t => !TKS.tag || (tksTagOf(t) || {}).id === TKS.tag)
    .filter(t => !TKS.from || t.created >= tksDay0(TKS.from))
    .filter(t => !TKS.to || t.created < tksDay0(TKS.to) + 864e5)
    .filter(t => !q || `${t.no} ${t.name} ${(B(t.equip) || {}).name || ''} ${t.owner} ${t.person || ''} ${tksRemark(t)}`.toLowerCase().includes(q))
    .sort((a, b) => (tksOver(b) - tksOver(a)) || ({ High: 0, Medium: 1, Low: 2 }[a.prio] - { High: 0, Medium: 1, Low: 2 }[b.prio]) || b.created - a.created);
}
tkPageRender = function (force) {
  const box = $('#tkBox');
  if (!box) return;
  const ae = document.activeElement;
  if (!force && ae && box.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
  const T = tkDoc(),
    teams = [...new Set([...(typeof engDoc === 'function' ? engDoc().teams.map(x => x.name) : []), ...T.list.map(t => t.owner)])].filter(Boolean);
  const n = f => T.list.filter(t => (f === 'all' ? true : f === 'over' ? tksOver(t) : tksSt(t) === f)).length;
  const all = tksList(),
    sel = TKS.sel && T.list.find(t => t.no === TKS.sel);
  const pages = Math.max(1, Math.ceil(all.length / TKS.size));
  if (TKS.page >= pages) TKS.page = pages - 1;
  const L = all.slice(TKS.page * TKS.size, (TKS.page + 1) * TKS.size);
  const eqs = [...new Set(T.list.map(t => t.equip).filter(Boolean))].map(id => B(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const tags = [...new Map(T.list.map(tksTagOf).filter(Boolean).map(x => [x.id, x])).values()].sort((a, b) => a.label.localeCompare(b.label));
  if (typeof tkBtnSync === 'function') tkBtnSync();
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  const html = `<div class="tks-hd"><h2>Tickets</h2><span class="tks-sub">A ticket is raised when the same alert is emailed on several days in a row.</span>
     <span class="tks-r"><label class="tks-me">Your name <input id="tksName" value="${esc(TKS.name)}" placeholder="type once"></label><button class="tks-btn" id="tksCsv">Export CSV</button><button class="tks-btn pri" id="tksNew">＋ New ticket</button><button class="tkp-x" id="tkpClose" title="Back to the loop">✕</button></span></div>
   <div class="tks-bar">${[['open', 'Open'], ['progress', 'In progress'], ['closed', 'Closed'], ['over', 'Overdue'], ['all', 'All']].map(([k, l]) => `<button class="tks-f${TKS.f === k ? ' on' : ''}${k === 'over' && n('over') ? ' red' : ''}" data-tksf="${k}">${l} <b>${n(k)}</b></button>`).join('')}
     <input id="tksQ" placeholder="Search ticket, problem, remark…" value="${esc(TKS.q)}"></div>
   <div class="tks-bar tks-flt"><label>Opened from <input type="date" data-tksd="from" value="${esc(TKS.from)}"></label><label>to <input type="date" data-tksd="to" value="${esc(TKS.to)}"></label>
     <select data-tksx="equip"><option value="">All equipment</option>${eqs.map(b => opt(b.id, b.name, TKS.equip)).join('')}</select>
     <select data-tksx="tag"><option value="">All tags / alerts</option>${tags.map(x => opt(x.id, x.label, TKS.tag)).join('')}</select>
     <select data-tksx="team"><option value="">All teams</option>${teams.map(x => opt(x, x, TKS.team)).join('')}</select>
     ${TKS.from || TKS.to || TKS.equip || TKS.tag || TKS.team || TKS.q ? '<button class="tks-lk" id="tksClr">Clear filters</button>' : ''}</div>
   <div class="tks-main${sel ? ' sel' : ''}"><div class="tks-tw"><div class="tks-sc"><table class="tks-tb"><thead><tr><th>Ticket</th><th>Problem</th><th>Equipment</th><th>Team</th><th>Status</th><th>Opened</th><th>Fix by / closed</th><th>Remarks</th></tr></thead><tbody>
     ${L.map(t => { const rm = tksRemark(t); return `<tr data-tks="${t.no}" class="${t.no === TKS.sel ? 'on' : ''}"><td class="mono"><b>${t.no}</b></td><td>${esc(t.name.replace(/ — recurring$/, ''))}<div class="tks-s">${t.source === 'manual' ? 'Reported by ' + esc(t.raisedBy || '') : `${t.days || 0} days in a row`}</div></td><td>${esc((B(t.equip) || {}).name || '—')}</td><td>${esc(t.owner || '—')}${t.person ? `<div class="tks-s">${esc(t.person)}</div>` : ''}</td><td>${tksPill(t)}</td><td>${tksDate(t.created)}</td><td class="${tksOver(t) ? 'tks-red' : ''}">${tksSt(t) === 'closed' ? tksDate(t.closedAt) : tksDate(t.fixDue)}</td><td title="${esc(rm)}"><div class="tks-rm${tksSt(t) === 'closed' ? ' cl' : ''}">${esc(rm) || '<span class="tks-s">—</span>'}</div></td></tr>`; }).join('') || '<tr><td colspan="8" class="tks-none">No tickets here.</td></tr>'}
   </tbody></table></div>
   <div class="tks-pg"><span>${all.length ? `${TKS.page * TKS.size + 1}–${Math.min(all.length, (TKS.page + 1) * TKS.size)} of ${all.length}` : '0 tickets'}</span>
     <label>Rows <select id="tksSize">${[10, 15, 25, 50].map(k => `<option ${TKS.size === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
     <button class="tks-btn" data-tksp="-1" ${TKS.page ? '' : 'disabled'}>‹ Prev</button><span>Page ${TKS.page + 1} / ${pages}</span><button class="tks-btn" data-tksp="1" ${TKS.page < pages - 1 ? '' : 'disabled'}>Next ›</button></div></div>${sel ? tksPanel(sel, teams) : ''}</div>`;
  if (!force && box.dataset.h === html) return;
  box.dataset.h = html;
  box.innerHTML = html;
  tksBind(sel);
};
function tksRemark(t) {
  if (tksSt(t) === 'closed' && t.closeNote) return t.closeNote;
  const h = (t.hist || []).filter(x => x.k === 'note').slice(-1)[0];
  return h ? h.text : '';
}
function tksPanel(t, teams) {
  const s = tksSt(t),
    b = B(t.equip);
  const why = (t.hist || []).filter(h => h.k === 'trig' || /^Day \d+ of/.test(h.text));
  const notes = (t.hist || []).filter(h => !why.includes(h)).slice().reverse();
  const btn = s === 'open' ? '<button class="tks-btn pri" data-tksa="start">Start work</button><button class="tks-btn" data-tksa="close">Close…</button>' : s === 'progress' ? '<button class="tks-btn pri" data-tksa="close">Close…</button>' : '<button class="tks-btn" data-tksa="reopen">Reopen…</button>';
  return `<aside class="tks-p"><div class="tks-ph"><b class="mono">${t.no}</b>${tksPill(t)}<button class="tkp-x" id="tksX" title="Close panel">✕</button></div>
   <h3>${esc(t.name.replace(/ — recurring$/, ''))}</h3>
   <div class="tks-g"><div><span>Equipment</span><b>${esc(b ? b.name : '—')}${t.process ? ` · ${esc(t.process)}` : ''}</b></div>
    <div><span>Team</span><select data-tksk="owner">${teams.map(x => `<option ${t.owner === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
    <div><span>Person</span><input data-tksk="person" value="${esc(t.person || '')}" placeholder="who does the work"></div>
    <div><span>Priority</span><select data-tksk="prio">${['High', 'Medium', 'Low'].map(p => `<option ${t.prio === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div><span>Opened</span><b>${tksDate(t.created)}</b></div><div><span>Fix by</span><b class="${tksOver(t) ? 'tks-red' : ''}">${s === 'closed' ? 'Closed ' + tksDate(t.closedAt) : tksDate(t.fixDue)}</b></div></div>
   <div class="tks-act">${btn}</div>
   ${t.closeNote && s === 'closed' ? `<div class="tks-cn"><span>Closing note</span>${esc(t.closeNote)}</div>` : ''}
   ${t.desc ? `<div class="tks-sec">Description</div><p class="tks-desc">${esc(t.desc)}</p>` : ''}
   ${why.length ? `<div class="tks-sec">Why it was raised</div><ul class="tks-why">${why.map(h => `<li>${esc(h.text.replace(/^Alert again today — /, ''))}</li>`).join('')}</ul>` : ''}
   <div class="tks-sec">Notes and history</div>
   <div class="tks-add"><input id="tksNote" placeholder="Add a note…"><button class="tks-btn" id="tksNoteAdd">Add</button></div>
   <ul class="tks-h">${notes.map(h => `<li><span>${tksDate(h.t)} · ${esc(h.by || '')}</span>${esc(h.text)}</li>`).join('')}</ul></aside>`;
}
function tksAsk(title, label, req, ok) {
  openModal(`<h3>${title}</h3><div class="fld"><label>${label}</label><textarea id="tksAskT" rows="4" style="width:100%;box-sizing:border-box"></textarea></div><div class="mact"><button class="ib" id="tksAskC">Cancel</button><button class="ib pri" id="tksAskOk">${title}</button></div>`);
  $('#tksAskC').onclick = closeModal;
  $('#tksAskOk').onclick = () => {
    const v = $('#tksAskT').value.trim();
    if (req && v.length < 5) return toast(req);
    closeModal();
    ok(v);
  };
  setTimeout(() => $('#tksAskT') && $('#tksAskT').focus(), 30);
}
function tksBind(t) {
  const re = () => tkPageRender(true),
    on = (s, f) => $(s) && ($(s).onclick = f);
  on('#tkpClose', tkPageClose);
  on('#tksX', () => ((TKS.sel = null), re()));
  on('#tksCsv', () => typeof tkqCsv === 'function' && ((TKQ.queue = 'all'), tkqCsv(tkDoc())));
  on('#tksNew', () => (typeof tkwNew === 'function' ? tkwNew() : toast('New ticket is not available')));
  const nm = $('#tksName');
  if (nm)
    nm.onchange = () => {
      TKS.name = nm.value.trim();
      try {
        localStorage.setItem('dl.tkName', TKS.name);
      } catch (e) {}
    };
  $$('#tkBox [data-tksf]').forEach(b => (b.onclick = () => ((TKS.f = b.dataset.tksf), (TKS.page = 0), re())));
  const q = $('#tksQ');
  if (q)
    q.oninput = () => {
      TKS.q = q.value;
      TKS.page = 0;
      const p = q.selectionStart;
      re();
      const n = $('#tksQ');
      n.focus();
      n.setSelectionRange(p, p);
    };
  $$('#tkBox [data-tksx]').forEach(x => (x.onchange = () => ((TKS[x.dataset.tksx] = x.value), (TKS.page = 0), re())));
  $$('#tkBox [data-tksd]').forEach(x => (x.onchange = () => ((TKS[x.dataset.tksd] = x.value), (TKS.page = 0), re())));
  on('#tksClr', () => (Object.assign(TKS, { from: '', to: '', equip: '', tag: '', team: '', q: '', page: 0 }), re()));
  const sz = $('#tksSize');
  if (sz) sz.onchange = () => ((TKS.size = +sz.value), (TKS.page = 0), re());
  $$('#tkBox [data-tksp]').forEach(x => (x.onclick = () => ((TKS.page = Math.max(0, TKS.page + +x.dataset.tksp)), re())));
  $$('#tkBox [data-tks]').forEach(r => (r.onclick = () => ((TKS.sel = TKS.sel === r.dataset.tks ? null : r.dataset.tks), re())));
  if (!t) return;
  const need = () => {
    if (!TKS.name) {
      toast('Type your name first (top right)');
      $('#tksName') && $('#tksName').focus();
      return false;
    }
    return true;
  };
  $$('#tkBox [data-tksk]').forEach(x => (x.onchange = () => {
    if (!need()) return re();
    const k = x.dataset.tksk,
      old = t[k];
    t[k] = x.value.trim();
    if (k === 'prio' && typeof tkwSla === 'function') tkwSla(t);
    tkwLog(t, `${{ owner: 'Team', person: 'Person', prio: 'Priority' }[k]}: ${old || '—'} → ${t[k] || '—'}`);
    if (k !== 'prio') tkMsg(t, { team: t.owner, ch: 'screen' }, `Ticket ${t.no} assigned to ${t.owner}${t.person ? ' · ' + t.person : ''}`);
    save();
    re();
  }));
  on('#tksNoteAdd', () => {
    const v = ($('#tksNote').value || '').trim();
    if (!v || !need()) return;
    tkwLog(t, v, 'note');
    save();
    re();
  });
  $$('#tkBox [data-tksa]').forEach(b => (b.onclick = () => {
    if (!need()) return;
    const a = b.dataset.tksa;
    if (a === 'start') return tkwSet(t, 'progress', 'Work started'), re();
    if (a === 'close')
      return tksAsk('Close ticket', 'Cause and action taken *', 'Write the cause and the action taken', v => {
        t.closeNote = v;
        t.closedBy = TKS.name;
        tkwSet(t, 'closed', 'Closed — ' + v);
        re();
      });
    if (a === 'reopen') return tksAsk('Reopen ticket', 'Why *', 'Write why it is reopened', v => ((t.reopened = (t.reopened || 0) + 1), tkwSet(t, 'progress', 'Reopened — ' + v), re()));
  }));
}
/* Escape closes the panel, then the page */
document.addEventListener(
  'keydown',
  e => {
    if (e.key !== 'Escape' || !TKP.on || $('#modal').classList.contains('on')) return;
    e.stopImmediatePropagation();
    if (TKS.sel) (TKS.sel = null), tkPageRender(true);
    else tkPageClose();
  },
  true,
);
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="tksCss">
.tks-hd{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.tks-hd h2{margin:0;font:700 22px var(--sans);color:#0e2d5c}.tks-sub{color:#55657d;font-size:13px}
.tks-r{margin-left:auto;display:flex;align-items:center;gap:8px}.tks-me{font-size:12.5px;color:#55657d;display:flex;align-items:center;gap:6px}.tks-me input{width:130px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px}
.tks-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 12px;font:600 13px var(--sans);cursor:pointer;color:#152238}.tks-btn.pri{background:#1f6feb;border-color:#1f6feb;color:#fff}
.tks-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.tks-f{border:1px solid #dbe2ec;background:#fff;border-radius:18px;padding:6px 14px;font:600 13px var(--sans);cursor:pointer;color:#334155}.tks-f b{margin-left:4px;color:#64748b}.tks-f.on{background:#0e2d5c;border-color:#0e2d5c;color:#fff}.tks-f.on b{color:#cbd5e1}.tks-f.red b{color:#dc2626}
.tks-bar input{flex:1;min-width:200px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-left:8px}.tks-bar select{padding:7px 8px;border:1px solid #cbd5e1;border-radius:8px}
.tks-main{display:grid;grid-template-columns:1fr;gap:12px;min-height:0;flex:1}.tks-main.sel{grid-template-columns:minmax(0,1fr) 400px}
.tks-tw{background:#fff;border:1px solid #dbe2ec;border-radius:12px;overflow:auto}
.tks-tb{width:100%;border-collapse:collapse;font-size:13.5px}.tks-tb th{text-align:left;font-size:12px;color:#64748b;padding:9px 10px;border-bottom:1px solid #e2e8f0;position:sticky;top:0;background:#f8fafc}.tks-tb td{padding:9px 10px;border-bottom:1px solid #eef2f6;vertical-align:top}
.tks-tb tr[data-tks]{cursor:pointer}.tks-tb tr[data-tks]:hover td{background:#f5f8fd}.tks-tb tr.on td{background:#eaf2ff}.tks-s{font-size:12px;color:#64748b;margin-top:2px}.tks-none{text-align:center;color:#94a3b8;padding:30px!important}
.tks-pill{display:inline-block;border-radius:10px;padding:1px 9px;font:700 11.5px var(--sans);color:var(--c);background:color-mix(in srgb,var(--c) 12%,#fff);border:1px solid color-mix(in srgb,var(--c) 35%,#fff);margin-right:4px}.tks-re{font:700 11.5px var(--sans);color:#7c3aed}.tks-red{color:#dc2626;font-weight:700}
.tks-p{background:#fff;border:1px solid #dbe2ec;border-radius:12px;padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px}
.tks-ph{display:flex;align-items:center;gap:8px}.tks-ph .tkp-x{margin-left:auto}.tks-p h3{margin:0;font:700 17px var(--sans);color:#0f172a}
.tks-g{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tks-g>div{display:flex;flex-direction:column;gap:3px;font-size:13px}.tks-g span{font-size:11.5px;color:#64748b}.tks-g select,.tks-g input{padding:5px 7px;border:1px solid #cbd5e1;border-radius:7px;font-size:13px}
.tks-act{display:flex;gap:8px}.tks-cn{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 10px;font-size:13px}.tks-cn span{display:block;font-size:11.5px;color:#15803d;font-weight:700}
.tks-sec{font:700 11.5px var(--sans);text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-top:4px}.tks-desc{margin:0;font-size:13px}
.tks-why,.tks-h{margin:0;padding-left:18px;font-size:12.5px;display:flex;flex-direction:column;gap:5px}.tks-h{list-style:none;padding:0}.tks-h li{border-left:3px solid #e2e8f0;padding-left:8px}.tks-h span{display:block;font-size:11.5px;color:#64748b}
.tks-add{display:flex;gap:6px}.tks-add input{flex:1;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px}
#tkBox{display:flex;flex-direction:column;gap:10px}
.tks-flt{font-size:12.5px;color:#55657d}.tks-flt label{display:flex;align-items:center;gap:6px}.tks-flt input[type=date],.tks-flt select{padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;max-width:240px}
.tks-lk{border:0;background:none;color:#1f6feb;font:600 12.5px var(--sans);cursor:pointer}
.tks-tw{display:flex;flex-direction:column;overflow:hidden!important;min-height:0}.tks-sc{flex:1;overflow:auto;min-height:0}.tks-main{min-height:0;overflow:hidden}.tks-p{min-height:0}
.tks-rm{max-width:260px;font-size:12.5px;color:#334155;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.tks-rm.cl{color:#15803d}
.tks-pg{display:flex;align-items:center;gap:10px;justify-content:flex-end;padding:10px 12px;border-top:1px solid #eef2f6;font-size:12.5px;color:#55657d;margin-top:auto}.tks-pg select{padding:3px 6px;border:1px solid #cbd5e1;border-radius:6px}.tks-pg .tks-btn{padding:4px 10px}.tks-pg .tks-btn:disabled{opacity:.45;cursor:default}
</style>`,
);

/* the Tickets page lives in Publish only (Publish bar › 🎫 Tickets), never over Design or Simulate */
{
  const prev = tkPageOpen;
  tkPageOpen = function () {
    if (typeof PRESENT !== 'undefined' && !PRESENT) return toast('Tickets open from the Publish view (Publish › 🎫 Tickets)');
    return prev.apply(this, arguments);
  };
  setInterval(() => {
    if (TKP.on && typeof PRESENT !== 'undefined' && !PRESENT) tkPageClose();
  }, 500);
}
