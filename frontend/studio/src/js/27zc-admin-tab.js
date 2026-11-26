/*! SandMan Digital Loop Studio — 27zc-admin-tab.js
 *  v10.4 — Administration ribbon tab: everything about alerts, teams, emails and tickets in one place.
 *    Teams: Teams & emails · Who gets emails · Sent emails
 *    Alerts: Tag alerts · Engineered alerts
 *    Tickets: Ticket rules · Deadlines & people
 *    Advanced: Routing rules
 *  The scattered shortcuts (Publish-bar 🔔 Alerts, extra links in the Tickets menu) are removed. */
setTimeout(() => {
  const on = (id, f) => {
    const b = document.getElementById(id);
    if (b) b.onclick = f;
  };
  on('adTeams', () => asOpen(1));
  on('adWho', () => asOpen(2));
  on('adTag', () => asOpen(3));
  on('adEng', () => asOpen(4));
  on('adLog', () => rtOpen('log'));
  on('adRoute', () => rtOpen('routing'));
  on('adTkRules', () => tkwRules());
  on('adTkSet', () => tkwSettings());
}, 0);
/* one place only: drop the extra entry points added earlier */
setInterval(() => {
  ['#pAlS', '.tkq-nav [data-asopen]', '.tkq-nav [data-rtopen]'].forEach(s => $$(s).forEach(x => x.remove()));
}, 600);
