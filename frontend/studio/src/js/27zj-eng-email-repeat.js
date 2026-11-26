/*! SandMan Digital Loop Studio — 27zj-eng-email-repeat.js
 *  Engineered alerts obey the same email settings as tags (Administration › Engineered alerts):
 *   · Email switch off → no email from this alert (it still shows on screen and in Alert history);
 *   · Repeat (min) → once the alert has emailed, it does not email again until that time has passed, even if it clears
 *     and fires again in between (no repeat value → the plant setting "Same alert again: no new email for N min").
 *  One firing still reaches every team on the alert: the teams of the same firing are not blocked by each other.
 *  Before this, the per-team email of an engineered alert (engOut) skipped both settings; only the zone email did not. */
{
  const prev = engOut;
  engOut = function (inst, team, ch, text) {
    if (ch !== 'email' || !inst || !inst.rule) return prev.apply(this, arguments);
    const key = 'eng:' + inst.rule,
      R = rtDoc();
    if (R.mute && R.mute[key]) return; // Email switched off for this alert
    const E = engDoc(),
      now = Date.now(),
      win = rtRepeatMin(key) * 60000;
    const recent = (E.outbox || []).find(o => o.ch === 'email' && o.rule === inst.rule && o.inst !== inst.id && now - o.t < win);
    if (recent) return; // emailed within the repeat time by an earlier firing
    const r = prev.apply(this, arguments);
    const o = (E.outbox || [])[0];
    if (o && o.inst === inst.id && !o.rule) o.rule = inst.rule; // so the next firing can find it
    return r;
  };
}
