/*! SandMan Digital Loop Studio — 12g-publish-trace.js
 *  v9.43 — Traceability in the Publish view: a "Traceability" button in the operator bar opens the same traceability
 *  (shift picker, timeline, play / step, events) without leaving the Publish view. Pressing it again, or "Back to live",
 *  returns to live. Leaving the Publish view also leaves traceability, so the full app always opens live. Read-only:
 *  nothing on the plant changes. */
function pTraceSync() {
  const b = $('#pTrace');
  if (!b) return;
  b.classList.toggle('on', !!RP);
  b.textContent = RP ? '● Back to live' : 'Traceability';
  b.title = RP ? 'Leave traceability and go back to live values' : 'Traceability — look back at a past shift (read-only)';
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
