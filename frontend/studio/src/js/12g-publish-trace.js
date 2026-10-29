/*! SandMan Digital Loop Studio — 12g-publish-trace.js
 *  v9.43 — Traceability in the Publish view: a "Traceability" button in the operator bar opens the same traceability
 *  (shift picker, timeline, play / step, events) without leaving the Publish view. Pressing it again, or "Back to live",
 *  returns to live. Leaving the Publish view also leaves traceability, so the full app always opens live. Read-only:
 *  nothing on the plant changes. */
function pTraceSync() {
  const b = $('#pTrace');
  if (!b) return;
  /*
   * Traceability is still being built, so the button says so and does nothing.
   *
   * It replays a past shift out of the recorded history, and the part of it
   * that reads this plant's history is not finished — so the control is on
   * the bar and the thing behind it is not there yet. It stays rather than
   * being taken off, because it is coming: a control that vanishes reads as
   * something broken, where this is something on the way.
   *
   * Written here rather than over the top of it, because this function runs
   * on a one-second interval and would paint the old label back.
   */
  b.classList.remove('on');
  b.classList.add('dl-under-development');
  b.disabled = true;
  b.textContent = 'Traceability · under development';
  b.title = 'Traceability is under development and is not available yet.';
}
$('#pTrace').onclick = () => {
  if (RP) exitReplay();
  else {
    enterReplay();
    requestAnimationFrame(() => requestAnimationFrame(() => fit()));
  }
  pTraceSync();
};
const _setPresentPT = setPresent;
setPresent = function (on) {
  if (!on && RP) exitReplay(); // leaving the Publish view always returns to live
  _setPresentPT(on);
  pTraceSync();
};
const _exitReplayPT = exitReplay;
exitReplay = function () {
  _exitReplayPT();
  pTraceSync();
};
setInterval(pTraceSync, 1000);
