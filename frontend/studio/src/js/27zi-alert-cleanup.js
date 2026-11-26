/*! SandMan Digital Loop Studio — 27zi-alert-cleanup.js
 *  v10.4 — one place to configure alerts: Administration.
 *   · the Simulate › Alert monitoring button and the Advanced › Routing rules button are hidden;
 *   · Administration gets "Alert history" (the Live and History views);
 *   · the Alert monitoring window keeps only Live and History (the rule editor still opens in it from Administration). */
document.head.insertAdjacentHTML('beforeend', `<style>
#bAM{display:none!important}
.rpanel[data-rp="admin"] .grp[aria-label="Advanced"]{display:none!important}
#emTabs [data-emt="rules"],#emTabs [data-emt="teams"],#emTabs [data-emt="tickets"]{display:none!important}
</style>`);
(function addHist() {
  const g = document.querySelector('.rpanel[data-rp="admin"] .grp[aria-label="Teams"] .rcol');
  if (!g) return setTimeout(addHist, 500);
  if (document.getElementById('adHist')) return;
  g.insertAdjacentHTML('beforeend', '<button class="ib rsm" id="adHist" title="Live alerts and the last 7 days — who was told, who acted"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg><span class="rl">Alert history</span></button>');
  document.getElementById('adHist').onclick = () => openAlertMonitor('live');
})();
/* the window title follows what is open */
{
  const prev = openAlertMonitor;
  openAlertMonitor = function (tab) {
    const r = prev.apply(this, arguments);
    const h = document.querySelector('.em-h h3');
    if (h) h.textContent = tab === 'rules' ? 'Engineered alert' : 'Alert history';
    return r;
  };
}
/* Administration is the only place to configure alerts:
   · the Sent emails window shows only the log (its Teams / Routing / Zones / Test tabs are hidden);
   · the "Alert monitoring…" links on the Tickets page are hidden. */
document.head.insertAdjacentHTML('beforeend', `<style>
.rt-tabs{display:none!important}
#tkpAlerts{display:none!important}
</style>`);
{
  const prev = rtOpen;
  rtOpen = function (tab) {
    const r = prev.call(this, 'log');
    const h = document.querySelector('.rt-h h3, .modal h3');
    return r;
  };
}

/* ---- v10.4 clean-up round 2 ----
   1 "Deadlines & people" and 2 "Ticket rules" are hidden: tickets are set per parameter with "Ticket after"
     (Tag alerts / Engineered alerts) and run Open → In progress → Closed, with no deadlines or PINs.
   3 old advanced routing rules are removed: only the zone → team and "Critical — any zone" settings remain.
   4 teams with no email address are flagged in red, so an alert is never silently not emailed. */
document.head.insertAdjacentHTML('beforeend', `<style>
#adTkSet,#adTkRules{display:none!important}
.rpanel[data-rp="admin"] .grp[aria-label="Tickets"]{display:none!important}
.as-noaddr{background:#fef3f2;border:1px solid #fecdca;color:#b42318;border-radius:10px;padding:9px 12px;margin:0 0 10px;font-size:13px}
.as-noaddr b{font-weight:700}
</style>`);
{
  const prev = rtDoc;
  rtDoc = function () {
    const R = prev.apply(this, arguments);
    if (R && Array.isArray(R.rules) && R.rules.some(r => !r.simple)) {
      /* old advanced rules become normal settings: a zone rule's teams join that zone; an all-zones rule's teams join "Critical — any zone" */
      const adv = R.rules.filter(r => !r.simple && r.on !== false && (r.teams || []).length);
      R.rules = R.rules.filter(r => r.simple === 'zone' || r.simple === 'crit');
      adv.forEach(a => {
        let t;
        if (a.zone) {
          t = R.rules.find(x => x.simple === 'zone' && x.zone === a.zone);
          if (!t) R.rules.push((t = { id: 'rz' + a.zone, simple: 'zone', on: true, zone: a.zone, kind: '', sev: 2, cat: '', alert: '', teams: [] }));
        } else {
          t = R.rules.find(x => x.simple === 'crit');
          if (!t) R.rules.push((t = { id: 'rcrit', simple: 'crit', on: true, zone: '', kind: '', sev: 3, cat: '', alert: '', teams: [] }));
        }
        t.teams = [...new Set([...(t.teams || []), ...a.teams])];
      });
    }
    return R;
  };
}
function asAddrWarn() {
  const T = rtTeams().filter(t => t.on !== false);
  const none = T.filter(t => !rtTeamEmails(t).length).map(t => t.name);
  const R = rtDoc();
  const zones = (typeof afZones === 'function' ? afZones() : [])
    .filter(z => !R.zoneOff[z.id])
    .filter(z => {
      const r = R.rules.find(x => x.simple === 'zone' && x.zone === z.id);
      const c = R.rules.find(x => x.simple === 'crit' && x.on !== false);
      const names = [...((r && r.teams) || []), ...((c && c.teams) || [])];
      return !names.some(n => rtTeamEmails(rtTeamByName(n)).length);
    })
    .map(z => afName(z));
  const eng = (engDoc().rules || []).filter(r => r.on && !(r.teams || []).some(tm => (tm.ch || []).includes('email') && rtTeamEmails(rtTeamByName(tm.team)).length)).map(r => r.name);
  const L = [];
  if (none.length) L.push(`<div>⚠ <b>No email address:</b> ${none.map(esc).join(', ')} — add addresses in Teams &amp; emails, or these teams get nothing.</div>`);
  if (zones.length) L.push(`<div>⚠ <b>Critical alerts from these zones reach nobody by email:</b> ${zones.map(esc).join(', ')} — tick a team that has addresses.</div>`);
  if (eng.length) L.push(`<div>⚠ <b>Engineered alerts with nobody to email:</b> ${eng.map(esc).join(', ')}.</div>`);
  return L.length ? `<div class="as-noaddr">${L.join('')}</div>` : '';
}
{
  const prev = asRender;
  asRender = function () {
    const r = prev.apply(this, arguments);
    try {
      const box = $('#asBody');
      if (box && !box.querySelector('.as-noaddr')) box.insertAdjacentHTML('afterbegin', asAddrWarn());
    } catch (e) {
      console.warn(e);
    }
    return r;
  };
}
/* PLC log replay buttons removed from the ribbon and the Publish bar */
document.head.insertAdjacentHTML('beforeend', '<style>#bPlcLog,#hPlcLog,#pPlcLog{display:none!important}</style>');
