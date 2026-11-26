/*! SandMan Digital Loop Studio — 27zk-alert-keep.js
 *  Fix: evalAlerts() (02-model.js) ends by deleting every alert it did not raise in that pass. It only raises tag
 *  limits (lim:), signal faults (bad:) and equipment rules (rule:), so it also deleted engineered alerts (eng:),
 *  statistical tag alerts (st: — Nelson, drift, forecast, stuck) and anything else other modules raise. Those alerts
 *  flickered: raised by their own check, wiped by the next live-data tick, so they came and went on screen, in the
 *  Fault alarm panel and in ticket day counting.
 *  Now evalAlerts() clears only its own kinds; every other kind is cleared by the module that raises it (each already
 *  does: engTick, the statistical checks, maintenance). */
{
  const OWN = /^(lim|bad|rule):/;
  const prev = evalAlerts;
  evalAlerts = function () {
    const keep = {};
    for (const k in ALERTS) if (!OWN.test(k)) keep[k] = ALERTS[k];
    const r = prev.apply(this, arguments);
    for (const k in keep) if (!(k in ALERTS)) ALERTS[k] = keep[k];
    return r;
  };
}
