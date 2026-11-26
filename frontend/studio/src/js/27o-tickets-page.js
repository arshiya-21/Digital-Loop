/*! SandMan Digital Loop Studio — 27o-tickets-page.js
 *  v10.4 — Tickets tab in the Publish bar, right after Maintenance (Item 7 of the development list).
 *  The rules are those of 27h-tickets.js: a ticket is made when the same alert (same equipment and condition) fires on
 *  the set number of days in a row (per equipment / per alert); one ticket per problem; owner, copy-to, due date,
 *  priority; status open · in progress · waiting · closed; notes and history; closing note required; reminder before
 *  the due date; overdue → shift in-charge → production head; reopened if the alert fires again in the watch period.
 *  This page shows them full screen: summary (open, overdue, closed, average time to close, reopened, equipment with
 *  the most repeat tickets), tickets by owner team, filters, list and the ticket itself. The button shows how many are
 *  open, red when one is overdue. */

const TKP = { on: false, t: null };
function tkCounts() {
  const T = tkDoc(),
    now = Date.now(),
    open = T.list.filter(t => t.status !== 'closed');
  return { open: open.length, overdue: open.filter(t => now > t.due).length, T };
}
function tkTeamsStrip() {
  const { T } = tkCounts(),
    now = Date.now();
  const by = {};
  T.list.forEach(t => {
    const o = (by[t.owner] = by[t.owner] || { open: 0, overdue: 0, closed: 0 });
    if (t.status === 'closed') o.closed++;
    else {
      o.open++;
      if (now > t.due) o.overdue++;
    }
  });
  const rows = Object.entries(by).sort((a, b) => b[1].overdue - a[1].overdue || b[1].open - a[1].open);
  if (!rows.length) return '';
  return `<div class="tkp-teams">${rows
    .map(([n, o]) => `<button type="button" class="tkp-team${TKV.team === n ? ' on' : ''}${o.overdue ? ' od' : ''}" data-tkteam="${esc(n)}"><b>${esc(n)}</b><span>${o.open} open${o.overdue ? ` · <em>${o.overdue} overdue</em>` : ''} · ${o.closed} closed</span></button>`)
    .join('')}</div>`;
}
function tkPageRender(force) {
  const box = $('#tkBox');
  if (!box) return;
  const ae = document.activeElement;
  if (!force && ae && box.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return; // never wipe a note being typed
  const { open, overdue } = tkCounts();
  tkBtnSync();
  const html = `<div class="tkp-hd"><h2>Tickets</h2>
   <span class="tkp-sub">Repeated alerts become tickets with an owner and a due date, and stay open until the cause is fixed and noted.</span>
   <span class="tkp-hr"><b>${open}</b> open${overdue ? ` · <b class="tkp-red">${overdue} overdue</b>` : ''}<button class="lk" id="tkpAlerts">Alert monitoring…</button><button class="tkp-x" id="tkpClose" title="Back to the loop">✕</button></span></div>
   ${TKV.sel ? '' : tkTeamsStrip()}
   <div class="tkp-body" id="tkpBody">${tkTab()}</div>`;
  if (box.dataset.h === html) return;
  box.dataset.h = html;
  box.innerHTML = html;
  const body = $('#tkpBody');
  tkBindBody(body, () => tkPageRender(true), () => (closeModal(), tkPageRender(true)));
  $('#tkpClose').onclick = tkPageClose;
  $('#tkpAlerts').onclick = () => typeof openAlertMonitor === 'function' && openAlertMonitor('live');
  const bk = $('#tkpBack');
  if (bk) bk.onclick = () => ((TKV.sel = null), tkPageRender(true));
  $$('#tkBox [data-tkteam]').forEach(b => (b.onclick = () => ((TKV.team = TKV.team === b.dataset.tkteam ? '' : b.dataset.tkteam), tkPageRender(true))));
  /* clicking a ticket's equipment name finds it on the loop */
  $$('#tkpBody .tk-r td:nth-child(3)').forEach(td => (td.title = 'Ticket details'));
}
function tkPageOpen() {
  if (typeof plClose === 'function' && typeof PL !== 'undefined' && PL.on) plClose();
  let O = $('#tkOv');
  if (!O) {
    ($('#cwrap') || document.body).insertAdjacentHTML('beforeend', '<div id="tkOv" class="tkp-ov" role="region" aria-label="Tickets"><div id="tkBox" class="tkp-box"></div></div>');
    O = $('#tkOv');
  }
  TKP.on = true;
  O.classList.add('on');
  const bt = $('#pTk');
  if (bt) bt.setAttribute('aria-pressed', 'true');
  tkPageRender(true);
  clearInterval(TKP.t);
  TKP.t = setInterval(() => TKP.on && !document.hidden && !$('#modal').classList.contains('on') && tkPageRender(), 5000);
}
function tkPageClose() {
  TKP.on = false;
  clearInterval(TKP.t);
  const O = $('#tkOv');
  if (O) O.classList.remove('on');
  const bt = $('#pTk');
  if (bt) bt.setAttribute('aria-pressed', 'false');
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !TKP.on || $('#modal').classList.contains('on')) return;
  if (TKV.sel) (TKV.sel = null), tkPageRender(true);
  else tkPageClose();
});
/* the Publish bar button, right after Maintenance, with the open / overdue count */
function tkBtnSync() {
  const b = $('#pTk');
  if (!b) return;
  const { open, overdue } = tkCounts();
  const k = `${open}|${overdue}`;
  if (b.dataset.k === k) return;
  b.dataset.k = k;
  b.classList.toggle('tkp-od', overdue > 0);
  b.innerHTML = `🎫<span class="p10t"> Tickets</span>${open ? `<span class="tkp-n${overdue ? ' red' : ''}">${open}</span>` : ''}`;
  b.title = `Tickets — ${open} open${overdue ? `, ${overdue} overdue` : ''}`;
}
(function tkBtn() {
  const add = () => {
    const anchor = $('#pMnt');
    if (!anchor || $('#pTk')) return !!$('#pTk');
    anchor.insertAdjacentHTML('afterend', '<button class="p10 p-tk" id="pTk" aria-label="Tickets" aria-pressed="false">🎫<span class="p10t"> Tickets</span></button>');
    $('#pTk').onclick = () => (TKP.on ? tkPageClose() : tkPageOpen());
    tkBtnSync();
    return true;
  };
  if (!add()) setTimeout(add, 1500);
  setInterval(() => {
    try {
      add();
      tkBtnSync();
    } catch (e) {}
  }, 5000);
  /* other Publish-bar screens, Main screen and leaving Publish close the Tickets page */
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#pMain,#pLoop,#pMnt');
    if (b && TKP.on) tkPageClose();
  }, true);
  const _sp = setPresent;
  setPresent = function (on) {
    if (!on && TKP.on) tkPageClose();
    return _sp.apply(this, arguments);
  };
})();

document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="tkpCss">
.tkp-ov{position:absolute;inset:0;z-index:41;display:none;background:#eef2f7}.tkp-ov.on{display:block}
.tkp-box{height:100%;overflow:auto;padding:12px 18px 16px;color:#152238;font:14px/1.4 var(--sans);display:flex;flex-direction:column;gap:12px;box-sizing:border-box}
.tkp-hd{display:flex;align-items:center;gap:18px}.tkp-hd h2{margin:0;font:600 24px var(--sans);color:#0e2d5c;display:flex;align-items:center;gap:6px}
.tkp-back{font-size:22px!important;color:#0e2d5c!important}.tkp-sub{color:#55657d;font-size:13px}
.tkp-hr{margin-left:auto;display:flex;align-items:center;gap:16px;color:#55657d;font-size:13.5px}.tkp-hr b{color:#152238}.tkp-red{color:#d93636!important}
.tkp-box .lk{border:0;background:none;color:#1f6feb;font:600 13px var(--sans);cursor:pointer;padding:0}
.tkp-x{border:1px solid #dbe2ec;background:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:14px}
.tkp-teams{display:flex;flex-wrap:wrap;gap:8px}
.tkp-team{display:flex;flex-direction:column;align-items:flex-start;gap:1px;border:1px solid #dbe2ec;background:#fff;border-radius:10px;padding:7px 12px;cursor:pointer;font:13px var(--sans);color:#152238;min-width:150px}
.tkp-team span{color:#55657d;font-size:12px}.tkp-team em{color:#d93636;font-style:normal;font-weight:700}.tkp-team.od{border-color:#f5b5b5}.tkp-team.on{border-color:#1f6feb;box-shadow:0 0 0 2px #dbeafe}
.tkp-body{background:#fff;border:1px solid #dbe2ec;border-radius:12px;padding:14px 16px;box-shadow:0 2px 8px rgba(14,45,92,.05)}
.tkp-body .em-sum{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
.tkp-body .em-tb{width:100%}.tkp-body .tk-r{cursor:pointer}.tkp-body .tk-r:hover td{background:#f5f8fd}
.p10.p-tk{position:relative}.p10.p-tk.tkp-od{box-shadow:inset 0 0 0 2px #f87171}
.tkp-body .em-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:10px 0}
.tkp-body .em-row input,.tkp-body .em-row select{padding:8px 10px;font:14px var(--sans);border:1px solid #cbd5e1;border-radius:8px}
.tkp-body .em-row .lc2-seg button{padding:7px 14px;font-size:13px}.tkp-body .ib.pri,.tkp-body .sb{padding:8px 14px;font-size:13.5px;border-radius:8px}
.tkp-body .tk-dh h3{font-size:20px}.tkp-body .tk-h>div{padding:6px 0}
.tkp-n{display:inline-block;margin-left:6px;min-width:18px;padding:0 6px;border-radius:9px;background:#ffd166;color:#3b2a00;font:700 11px/18px var(--sans);text-align:center}.tkp-n.red{background:#ef4444;color:#fff}
</style>`,
);
