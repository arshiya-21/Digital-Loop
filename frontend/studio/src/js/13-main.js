/*! SandMan Process Flowsheet — 13-main.js
 *  Main loop and initialisation (must load last)
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===== Loop ===== */
let toastT;
function toast(m) {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2400);
}
/* Acknowledge banner: top of the page, so it is seen in the Publish view where the bottom toast is hidden behind the bar */
let ackNoticeT;
function ackNotice(msg) {
  let n = document.getElementById('ackNotice');
  if (!n) {
    n = document.createElement('div');
    n.id = 'ackNotice';
    n.setAttribute('role', 'status');
    document.body.appendChild(n);
  }
  n.textContent = '\u2713 ' + msg;
  n.classList.add('on');
  clearTimeout(ackNoticeT);
  ackNoticeT = setTimeout(() => n.classList.remove('on'), 3000);
}
setInterval(() => {
  $('#clk').textContent = hms(new Date());
  if (RP) return;
  if (PRESENT) {
    const d = new Date();
    $('#pClk').textContent =
      d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + '  ' + hms(d);
    const a = Object.values(ALERTS).filter(x => x.active),
      mx = a.reduce((m, x) => Math.max(m, x.sev), 0),
      stop = DOC.blocks.filter(b => b.props.oos && !EQ[b.type].widget).length;
    $('#pState').innerHTML =
      `<i style="background:${sevC(mx)}"></i>${mx === 3 ? 'Critical alarm active' : mx === 2 ? 'Warning active' : mx === 1 ? 'Advisory active' : 'Unit running normally'}${stop ? ` · ${stop} stopped` : ''}`;
  }
  if (MODE === 'monitor' && !LIVE) return;
  if (typeof followTick === 'function') followTick(); // v6.1 follow the feed + group interlocks
  simTick();
  evalAlerts();
  liveCanvas();
  if (SIMT % 3 === 0) miniRender();
  renderDock();
  renderHeader();
  liveText();
  liveTree();
  if (trendTag) drawTrend();
  if (PRESENT && SIMT % 2 === 0 && Object.values(ALERTS).some(a => !a.acked && a.sev === 3)) beep();
  if (PRESENT && $('#ovl').classList.contains('on') && ALV !== window._oALV) {
    window._oALV = ALV;
    renderOvl();
  }
  if (SEL && SEL.t === 'b' && PTAB === 'alerts' && ALV !== window._pALV) {
    /*
     * Do not rebuild the Properties panel while somebody is typing in it.
     * Rebuilding replaces every input, so the Custom rules form (Value, Message ...)
     * was emptied each time an alarm changed. While a field in the panel has focus we
     * wait (window._pALV stays old, so it redraws on the next tick after they leave it).
     */
    const ae = document.activeElement;
    const typing = !!(ae && ae.closest && ae.closest('#props') && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName));
    if (!typing) {
      window._pALV = ALV;
      // keep anything already entered in the rule form across the redraw
      const ruleIds = ['rTag', 'rOp', 'rVal', 'rSev', 'rDel', 'rMsg'];
      const kept = {};
      ruleIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) kept[id] = el.value;
      });
      renderProps();
      ruleIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && kept[id] !== undefined) el.value = kept[id];
      });
    }
  }
}, 1000);

/* ===== Init ===== */
try {
  const th = localStorage.getItem('sandman-theme');
  if (th) document.documentElement.setAttribute('data-theme', th);
} catch (e) {}
try {
  const g = JSON.parse(localStorage.getItem('sandman-gw') || 'null');
  if (g)
    $('#gwTxt').textContent =
      `${g.p.split(' ')[0]} · ${g.m === 'Live' ? 'no connection, simulating' : 'simulated'}`;
} catch (e) {}
buildDefs();
renderLib();
function migRates() {
  try {
    if (DOC.migRates) return;
    DOC.migRates = 1;
    const R = [
      ['DISA-1', 380],
      ['DISA-2', 345],
      ['DISA-3', 410],
    ];
    R.forEach(([n, v]) => {
      const b = byName(n);
      if (!b) return;
      const id = tagRole(b, 'mph', 'MPH'),
        t = id && REG[id];
      if (t && !t.cfg && Math.abs(t.typ - 380) < 1) {
        t.typ = v;
        if (VAL[id]) {
          VAL[id].x = v;
          VAL[id].v = v;
        }
      }
    });
  } catch (e) {}
}
let loaded = false;
try {
  const s = localStorage.getItem(LS);
  if (s) {
    const o = JSON.parse(s);
    if (o.DOC && o.REG && (registerDocCustom(o.DOC), o.DOC.blocks.every(b => EQ[b.type]))) {
      DOC = o.DOC;
      REG = o.REG;
      for (const id in REG) ensureVal(id);
      seedHist();
      loaded = true;
    }
  }
} catch (e) {}
/* v1.11 — a first visit opens an empty flowsheet in Design mode; the reference loop is one click away
   (card on the empty canvas, or File → Templates). ?tpl=sand / ?tpl=foundry open a reference loop directly. */
const tplQ = new URLSearchParams(location.search).get('tpl');
if (!loaded) {
  if (tplQ === 'finalversion') loadFinalVersion(); // v9.37 Final Version (the default loop)
  else if (tplQ === 'demoloop3') loadDemoLoop3(); // v9.17 DemoLoop3 (PLCs at their areas)
  else if (tplQ === 'demoloop4') loadDemoLoop4(); // v9.22 DemoLoop4 (Digital Loop equipment set)
  else if (tplQ === 'demoloop5') loadDemoLoop5(); // v9.28 Demo Loop 5 (Demo Loop 3 flow, latest equipment)
  else if (tplQ === 'finaldemo') loadFinalDemo(); // v9.33 Final Demo (separate moulding, pouring and shakeout)
  else if (tplQ === 'demoloop2') loadDemoLoop2(); // v9.14 DemoLoop 2 (customer's flow)
  else if (tplQ === 'demoloop') loadDemoLoop(); // v9.8 DemoLoop
  else if (tplQ === 'twin') loadSandTwin(); // v9.0 default demonstration loop
  else if (tplQ === 'plcmon') loadPlcDemo(); // v9.5 tag monitor demo
  else if (tplQ === 'sand') loadSandLine();
  else if (tplQ === 'foundry') loadFoundry();
  else if (!tplQ || tplQ === 'default') loadFinalVersion(); // v9.37 — a first visit opens the default loop, Final Version
  else {
    DOC = blankDoc();
    DOC.name = 'New flowsheet';
    REG = {};
    seedHist();
  }
}
migRates();
logEv(loaded ? 'Restored saved flowsheet' : DOC.blocks.length ? 'Loaded a reference loop' : 'New empty flowsheet');
applyPrefs(true);
setMode(loaded || DOC.blocks.length ? 'monitor' : 'design', true);
renderAll();
const ro = new ResizeObserver(() => {
  if (!ro.done && $('#cwrap').clientWidth > 10) {
    ro.done = true;
    fit(null, true);
  } else miniView();
});
ro.observe($('#cwrap'));
requestAnimationFrame(() => requestAnimationFrame(() => fit(null, true)));
/* v2.2 — later modules (15-inspector, 16-flowfx) load after this file: draw once more when everything is ready */
setTimeout(() => renderAll(), 0);
