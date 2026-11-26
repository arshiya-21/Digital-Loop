/*! SandMan Digital Loop Studio — 27r-publish-fixes.js
 *  v10.4 — Publish view: the Fault alarm (Live Monitor) panel floats over the drawing instead of taking a column of the
 *  page, so opening it no longer shrinks the Digital Loop. Close it with ✕ / Fault alarm as before. */
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="mpFloatCss">
body.present.mpon .work,body.present.mpon.mpright .work{grid-template-columns:minmax(0,1fr)!important;position:relative}
body.present.mpon .mpanel{position:absolute;top:0;bottom:0;left:0;width:var(--mpw,360px);z-index:35;border-right:1px solid #d5dce7;box-shadow:6px 0 18px rgba(14,45,92,.16);background:var(--panel,#fff)}
body.present.mpon.mpright .mpanel{left:auto;right:0;border-left:1px solid #d5dce7;border-right:0;box-shadow:-6px 0 18px rgba(14,45,92,.16)}
</style>`,
);
