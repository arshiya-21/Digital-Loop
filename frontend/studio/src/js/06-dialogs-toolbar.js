/*! SandMan Process Flowsheet — 06-dialogs-toolbar.js
 *  Modal framework and forms, mode switching, toolbar, view preferences, sizing, minimap
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===== Modals ===== */
function openModal(html, wide) {
  $('#mbox').className = 'mbox' + (wide === 'xl' ? ' xl' : wide === 'xxl' ? ' xxl' : wide ? ' wide' : '');
  $('#mbox').innerHTML =
    '<button class="mclose" id="mClose" type="button" aria-label="Close" title="Close (Esc)">✕</button>' +
    html;
  $('#mClose').onclick = closeModal;
  $('#modal').classList.add('on');
  setTimeout(() => $('#mbox input:not([disabled]),#mbox textarea')?.focus(), 20);
}
function closeModal() {
  $('#modal').classList.remove('on');
  trendTag = null;
}
$('#modal').addEventListener('pointerdown', e => {
  if (e.target.id === 'modal') closeModal();
});
function exportForm() {
  syncDocCustom();
  openModal(
    `<h3>Export flowsheet</h3><div class="note">Copy this JSON to save the layout, equipment, lines, tags, panels and alert rules.</div><textarea id="exT" readonly style="margin-top:8px">${esc(JSON.stringify({ format: 'sandman-flowsheet', version: 2, DOC, REG }))}</textarea>
 <div class="mact"><button class="ib" id="eClose">Close</button><button class="ib pri" id="eCopy">Copy JSON</button></div>`,
    true,
  );
  $('#eClose').onclick = closeModal;
  $('#eCopy').onclick = async () => {
    const t = $('#exT');
    try {
      await navigator.clipboard.writeText(t.value);
      toast('Flowsheet JSON copied');
    } catch (e) {
      t.select();
      toast('Text selected — press Ctrl+C');
    }
  };
}
function importForm() {
  openModal(
    `<h3>Import flowsheet</h3><div class="note">Paste JSON exported from SandMan Digital Loop Studio (or the earlier Process Flowsheet). This replaces the current flowsheet (you can undo).</div><textarea id="imT" style="margin-top:8px" placeholder='{"format":"sandman-flowsheet", ...}'></textarea>
 <div class="mact"><button class="ib" id="iCancel">Cancel</button><button class="ib pri" id="iGo">Import flowsheet</button></div>`,
    true,
  );
  $('#iCancel').onclick = closeModal;
  $('#iGo').onclick = () => {
    try {
      const o = JSON.parse($('#imT').value);
      if (o && o.DOC) registerDocCustom(o.DOC);
      if (!o.DOC || !o.REG || !Array.isArray(o.DOC.blocks) || o.DOC.blocks.some(b => !EQ[b.type])) throw 0;
      pushUndo();
      DOC = o.DOC;
      REG = o.REG;
      for (const id in REG) ensureVal(id);
      seedHist();
      SEL = null;
      logEv('Flowsheet imported');
      closeModal();
      changed();
      fit();
      toast('Flowsheet imported');
    } catch (e) {
      toast('That text is not a valid SandMan flowsheet export');
    }
  };
}
function gwForm() {
  let g = {};
  try {
    g = JSON.parse(localStorage.getItem('sandman-gw') || '{}');
  } catch (e) {}
  openModal(`<h3>Data gateway</h3><div class="note" style="margin-bottom:10px">Where SandMan reads live tag values. This preview has no path to plant systems, so values are simulated from each tag's typical value and limits.</div>
 <div class="fld"><label>Protocol</label><select id="gP">${['SandMan REST API', 'OPC UA', 'MQTT (Sparkplug B)', 'Modbus TCP'].map(p => `<option ${g.p === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
 <div class="fld"><label>Endpoint</label><input id="gE" class="mono" value="${esc(g.e || 'https://sandman.local/api/v1/tags')}"></div>
 <div class="row2"><div class="fld"><label>Poll interval (s)</label><input id="gI" type="number" value="${g.i || 1}" min="1"></div><div class="fld"><label>Mode</label><select id="gM"><option>Simulated</option><option ${g.m === 'Live' ? 'selected' : ''}>Live</option></select></div></div>
 <div class="mact"><button class="ib" id="gC">Cancel</button><button class="ib pri" id="gS">Save gateway</button></div>`);
  $('#gC').onclick = closeModal;
  $('#gS').onclick = () => {
    const o = { p: $('#gP').value, e: $('#gE').value, i: +$('#gI').value, m: $('#gM').value };
    try {
      localStorage.setItem('sandman-gw', JSON.stringify(o));
    } catch (e) {}
    $('#gwTxt').textContent =
      `${o.p.split(' ')[0]} · ${o.m === 'Live' ? 'no connection, simulating' : 'simulated'}`;
    closeModal();
    toast('Gateway saved');
  };
}
function diagForm() {
  const c = completeness(),
    stop = DOC.blocks.filter(b => b.props.oos && !EQ[b.type].widget),
    al = Object.values(ALERTS).filter(a => a.active);
  openModal(`<h3>System diagnosis</h3><div class="kv"><span>Active alerts</span><b>${al.length} (${al.filter(a => a.sev === 3).length} critical)</b></div><div class="kv"><span>Equipment stopped</span><b>${stop.length ? stop.map(b => esc(b.name)).join(', ') : 'None'}</b></div>
 <div class="kv"><span>Unconnected required ports</span><b>${c.req.length}</b></div><div class="kv"><span>Equipment without tags</span><b>${c.untag.length}</b></div><div class="kv"><span>Active disturbances</span><b>${DISTS.length ? DISTS.map(d => esc(d.n)).join(', ') : 'None'}</b></div>
 <div class="kv"><span>Data source</span><b>${esc($('#gwTxt').textContent)}</b></div><div class="mact"><button class="ib pri" id="dC">Close</button></div>`);
  $('#dC').onclick = closeModal;
}

/* ===== Mode & toolbar ===== */
function setMode(m, quiet) {
  if (RP && m === 'design') {
    toast('Leave traceability (Back to live) to edit the flowsheet');
    return;
  }
  if (m !== 'design' && typeof CONNMODE !== 'undefined') {
    CONNMODE = false;
    CONNSRC = null;
    cv.classList.remove('connecting');
    $('#bConn').classList.remove('on');
    tip(null);
    $('#Ltmp').innerHTML = '';
  }
  MODE = m;
  document.body.classList.toggle('is-sim', m !== 'design');
  if (typeof syncBrand === 'function') setTimeout(syncBrand, 0);
  if (typeof ribbonForMode === 'function') ribbonForMode(m); // the Simulate group in the toolbar shows only in Simulate
  $('#mDesign').classList.toggle('on', m === 'design');
  $('#mMonitor').classList.toggle('on', m === 'monitor');
  $('#monCtl').style.display = m === 'monitor' ? 'inline-flex' : 'none';
  setPlace(null);
  if (m === 'monitor' && !quiet) {
    const c = completeness();
    if (c.req.length)
      toast(`Simulating with ${c.req.length} unconnected required port${c.req.length > 1 ? 's' : ''}`);
  }
  logEv(m === 'design' ? 'Design mode' : 'Simulate mode');
  if (!quiet) renderAll();
}
function openRight() {
  if (innerWidth <= 960) {
    $('#right').classList.add('open');
    $('#backdrop').classList.add('on');
  } else if (!PREF.right) {
    PREF.right = true;
    savePref();
    applyPrefs();
  }
}
function closeDrawers() {
  $('#left').classList.remove('open');
  $('#right').classList.remove('open');
  $('#backdrop').classList.remove('on');
}
$('#mDesign').onclick = () => setMode('design');
$('#mMonitor').onclick = () => setMode('monitor');
$('#bPresent').onclick = () => {
  if (RP) exitReplay();
  setPresent(true);
};
$('#bUndo').onclick = undo;
$('#bRedo').onclick = redo;
$('#bDel').onclick = delSel;
$('#bRot').onclick = rotSel;
$('#bFlip').onclick = flipSel;
$('#bDup').onclick = dupSel;
$('#bGroup') && ($('#bGroup').onclick = groupSel);
$('#bUngroup') && ($('#bUngroup').onclick = ungroupSel);
$('#bLockAll') && ($('#bLockAll').onclick = toggleLockAll);
$('#vMouse') &&
  ($('#vMouse').onchange = e => {
    PREF.mouse = e.target.value;
    savePref();
    applyPrefs();
    toast(
      PREF.mouse === 'touch'
        ? 'Touch HMI style: drag pans, left-click opens the item menu, right-click opens Properties'
        : 'Studio style: drag draws a selection box (Space + drag pans), right-click opens the item menu',
    );
  });
$('#bZi').onclick = () => zoomAt(1.2);
$('#bZo').onclick = () => zoomAt(1 / 1.2);
$('#bFit').onclick = e => fit(e.shiftKey ? 'width' : 'page'); // the whole loop (Shift: width)
$('#bSnap').onclick = e => {
  SNAP = !SNAP;
  e.currentTarget.classList.toggle('on', SNAP);
};
$('#bTags').onclick = e => {
  SHOWTAGS = !SHOWTAGS;
  e.currentTarget.classList.toggle('on', SHOWTAGS);
  renderCanvas();
};
$('#selFile').onchange = e => {
  const v = e.target.value;
  e.target.value = '';
  if (v === 'tpls') openTemplates();
  else if (v === 'tplsave') saveTplForm();
  else if (v === 'neweq') openDesigner(null);
  else if (v === 'libio') libIOForm();
  else if (v === 'csvx') csvExportForm();
  else if (v === 'blank') {
    pushUndo();
    DOC = blankDoc();
    DOC.name = 'New flowsheet';
    REG = {};
    SEL = null;
    logEv('New blank flowsheet');
    changed();
    fit();
    toast('Blank flowsheet — undo to restore');
  } else if (v === 'export') exportForm();
  else if (v === 'import') importForm();
  else if (v === 'csv') csvForm();
};
$('#selDist').innerHTML =
  '<option value="">Simulate disturbance…</option>' +
  DIST.map(d => `<option value="${d.id}">${d.n}</option>`).join('');
$('#selDist').onchange = e => {
  const d = DIST.find(x => x.id === e.target.value);
  e.target.value = '';
  if (!d || DISTS.some(x => x.id === d.id)) return;
  DISTS.push(Object.assign({ t0: SIMT }, d));
  logEv('Disturbance started: ' + d.n, 1);
  renderDist();
  toast(d.n + ' — ramping in');
};
function renderDist() {
  $('#distList').innerHTML = DISTS.map(
    d => `<button class="fchip on" data-dx="${d.id}" title="Clear">${esc(d.n)} ×</button>`,
  ).join(' ');
  $$('[data-dx]').forEach(
    x =>
      (x.onclick = () => {
        DISTS = DISTS.filter(d => d.id !== x.dataset.dx);
        logEv('Disturbance cleared');
        renderDist();
      }),
  );
}
$('#bLive').onclick = e => {
  LIVE = !LIVE;
  e.currentTarget.textContent = LIVE ? '⏸ Pause' : '▶ Resume';
  renderCanvas();
  renderStatus();
};
$$('.ptabs [data-lt]').forEach(
  b =>
    (b.onclick = () => {
      LTAB = b.dataset.lt;
      $$('.ptabs [data-lt]').forEach(x => x.classList.toggle('on', x === b));
      $('#libPane').style.display = LTAB === 'lib' ? '' : 'none';
      $('#treePane').style.display = LTAB === 'tree' ? '' : 'none';
      renderTree();
    }),
);
function setDockTab() {
  $$('.dtabs [data-dt]').forEach(x => x.classList.toggle('on', x.dataset.dt === DTAB));
  $('#dock').classList.remove('min');
  syncDockBtn();
  renderDock(true);
}
/* v1.12 — the Alerts / tables panel starts collapsed (tab bar only); the arrow or any tab opens it */
function syncDockBtn() {
  const min = $('#dock').classList.contains('min'),
    b = $('#bDock');
  b.textContent = min ? '▴' : '▾';
  b.title = min ? 'Expand panel' : 'Collapse panel';
  b.setAttribute('aria-label', b.title);
}
$$('.dtabs [data-dt]').forEach(
  b =>
    (b.onclick = () => {
      DTAB = b.dataset.dt;
      setDockTab();
    }),
);
$('#bDock').onclick = () => {
  $('#dock').classList.toggle('min');
  syncDockBtn();
};
$('#railAlerts').onclick = () => {
  if (PRESENT) {
    $('#ovl').classList.add('on');
    renderOvl();
  } else {
    DTAB = 'alerts';
    setDockTab();
  }
};
$$('[data-mod]').forEach(b => (b.onclick = () => toast(`${b.dataset.mod} is a separate SandMan module`)));
$('#gwBtn').onclick = () => sourcesForm();
$('#themeBtn').onclick = () => {
  const cur =
      document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    n = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', n);
  try {
    localStorage.setItem('sandman-theme', n);
  } catch (e) {}
  renderAll();
};
$('#mLeft').onclick = () => {
  $('#left').classList.toggle('open');
  $('#backdrop').classList.toggle('on', $('#left').classList.contains('open'));
};
$('#mRight').onclick = () => {
  $('#right').classList.toggle('open');
  $('#backdrop').classList.toggle('on', $('#right').classList.contains('open'));
};
$('#backdrop').onclick = closeDrawers;
$('#libQ').oninput = renderLib;
$('#docName').onchange = e => {
  DOC.name = e.target.value.trim() || DOC.name;
  save();
};
$('#pMain').onclick = () => (typeof afClear === 'function' && afClear(true), fit('page')); // v9.20: also leaves an area
$('#pFit').onclick = () => (typeof afClear === 'function' && afClear(true), presentFit()); // v8.0: back to the chosen size (Fill screen / Whole loop / Fit width)
$('#pExit').onclick = () => setPresent(false);
$('#pReset').onclick = () => {
  ackAll();
  if ($('#ovl').classList.contains('on')) renderOvl();
  toast('Faults acknowledged');
};
$('#pAlarm').onclick = () => {
  const o = $('#ovl');
  o.classList.toggle('on');
  if (o.classList.contains('on')) renderOvl();
};
$('#pDiag').onclick = diagForm;
$('#stMsg').style.cursor = 'pointer';
$('#stMsg').title = 'Click to go to the next item that needs attention';
$('#stMsg').onclick = () => {
  const c = completeness(),
    x = c.req[0] ? c.req[0].b : c.untag[0];
  if (!x) return;
  if (MODE !== 'design') setMode('design');
  PTAB = 'gen';
  select({ t: 'b', id: x.id });
  center(x);
  openRight();
  if (c.req[0]) toast(`${x.name}: connect required port “${c.req[0].p.id}”`);
};
$('#pSound').onclick = e => {
  SOUND = !SOUND;
  e.currentTarget.textContent = SOUND ? 'Silence alarm' : 'Alarm sound on';
  toast(SOUND ? 'Alarm sound on' : 'Alarm silenced');
};
let rT;
window.addEventListener('resize', () => {
  if (innerWidth > 960) closeDrawers();
  applyPrefs(true);
  clearTimeout(rT);
  rT = setTimeout(() => {
    // v8.0: publish view refits through its own resize observer (05d-present-view.js), keeping a manual zoom
    miniView();
  }, 150);
});

/* ===== View preferences, sizing, minimap ===== */
const PREF_DEF = {
  ts: 1,
  ui: 1,
  left: true,
  right: true,
  dock: true,
  mini: false,
  lines: false,
  fit: 'width',
  v: 2,
  rw: 320,
  autolink: true,
  mouse: 'studio', // v1.3: 'studio' (desktop) or 'touch' (touch-screen HMI)
  rail: false, // v1.7: the dark SandMan module bar is off; its buttons live in the header
  autoProps: false, // v2.1: open Properties on every click on equipment (off = click only selects)
};
let PREF = Object.assign({}, PREF_DEF);
try {
  const sv = JSON.parse(localStorage.getItem('sandman-view') || '{}');
  if (sv.v !== 2) {
    sv.mini = false;
    sv.v = 2;
  }
  Object.assign(PREF, sv);
} catch (e) {}
function savePref() {
  try {
    localStorage.setItem('sandman-view', JSON.stringify(PREF));
  } catch (e) {}
}
function layoutCols() {
  const w = $('.work'),
    sh = $('.shell');
  // v1.9: the side panel is the shell's first column, full height next to the header (Loop Studio layout)
  sh.classList.toggle('has-left', !!(PREF.left && !RP && !PRESENT && innerWidth > 960));
  if (innerWidth <= 960 || PRESENT) {
    w.style.gridTemplateColumns = PRESENT ? 'minmax(0,1fr)' : '';
    return;
  }
  const cols = [];
  const showR = PREF.right;
  cols.push('minmax(0,1fr)');
  if (showR) cols.push(`calc(${RP ? Math.max(PREF.rw || 320, 360) : PREF.rw || 320}px * var(--ui))`);
  w.style.gridTemplateColumns = cols.join(' ');
}
function applyPrefs(quiet) {
  const rs = document.documentElement.style;
  rs.setProperty('--ts', PREF.ts);
  rs.setProperty('--ui', PREF.ui);
  $('#left').style.display = PREF.left || innerWidth <= 960 ? '' : 'none';
  $('#right').style.display = PREF.right || innerWidth <= 960 ? '' : 'none';
  $('#dock').style.display = PREF.dock ? '' : 'none';
  $('#mini').classList.toggle('off', !PREF.mini);
  layoutCols();
  $('#bFocus').classList.toggle('on', !PREF.left && !PREF.right && !PREF.dock);
  $('#vTs').value = PREF.ts;
  $('#vTsV').textContent = Math.round(PREF.ts * 100) + '%';
  $('#vUi').value = PREF.ui;
  $('#vUiV').textContent = Math.round(PREF.ui * 100) + '%';
  $('#vLines').checked = PREF.lines;
  $('#bProps').classList.toggle('on', !!PREF.right);
  $('#rWide').textContent = (PREF.rw || 320) > 420 ? '⤡' : '⤢';
  $('#rWide').title = (PREF.rw || 320) > 420 ? 'Shrink panel' : 'Enlarge panel';
  $('#bMap')?.classList.toggle('on', PREF.mini);
  $('#vLeft').checked = PREF.left;
  $('#vRight').checked = PREF.right;
  $('#vDock').checked = PREF.dock;
  $('#vMini').checked = PREF.mini;
  $('#vFit').value = PREF.fit;
  if ($('#vMouse')) $('#vMouse').value = PREF.mouse === 'touch' ? 'touch' : 'studio';
  document.body.classList.toggle('show-rail', !!PREF.rail);
  if ($('#vRail')) $('#vRail').checked = !!PREF.rail;
  if ($('#vAutoProps')) $('#vAutoProps').checked = !!PREF.autoProps;
  document.body.classList.toggle('mouse-touch', PREF.mouse === 'touch');
  if (!quiet) {
    renderCanvas();
    requestAnimationFrame(miniView);
  }
}
let focusPrev = null;
function toggleFocus() {
  const focused = !PREF.left && !PREF.right && !PREF.dock;
  if (focused) {
    Object.assign(PREF, focusPrev || { left: true, right: true, dock: true });
  } else {
    focusPrev = { left: PREF.left, right: PREF.right, dock: PREF.dock };
    PREF.left = PREF.right = PREF.dock = false;
  }
  savePref();
  applyPrefs(); // the view keeps its centre (ResizeObserver) — no refit, no jump
  toast(focused ? 'Panels restored' : 'Focus view — Ctrl+. or the Focus button brings panels back');
}
function setFull(on, quiet) {
  try {
    if (on && !document.fullscreenElement) {
      const p = document.documentElement.requestFullscreen?.();
      if (p && p.catch)
        p.catch(() => {
          if (!quiet) toast('Full screen is blocked in this view. Use Focus or Publish instead.');
        });
    } else if (!on && document.fullscreenElement) document.exitFullscreen();
  } catch (e) {
    if (!quiet) toast('Full screen is blocked in this view. Use Focus or Publish instead.');
  }
}
document.addEventListener('fullscreenchange', () => {
  $('#bFull').classList.toggle('on', !!document.fullscreenElement);
  setTimeout(() => fit(), 120);
  if (!document.fullscreenElement && PRESENT) setPresent(false);
});
function setScale(b, sc) {
  if (!b) return;
  sc = clamp(Math.round(sc * 100) / 100, 0.3, 4);
  pushUndo();
  b.sc = sc;
  logEv(`${b.name} display scale ${Math.round(sc * 100)}%`);
  changed();
  updVSc();
}
function scaleAll(f) {
  if (!DOC.blocks.length) return;
  pushUndo();
  const { x0, y0 } = bounds();
  DOC.streams.forEach(s => {
    if (s.mid != null) {
      const G = streamGeom(s);
      if (G && G.axis === 'x') s.midN = x0 + (s.mid - x0) * f;
      else if (G && G.axis === 'y') s.midN = y0 + (s.mid - y0) * f;
    }
  });
  DOC.streams.forEach(s => s.pts && (s.pts = s.pts.map(q => ({ x: Math.round(x0 + (q.x - x0) * f), y: Math.round(y0 + (q.y - y0) * f) })))); // v3.7
  DOC.blocks.forEach(b => {
    b.x = Math.round(x0 + (b.x - x0) * f);
    b.y = Math.round(y0 + (b.y - y0) * f);
    b.sc = clamp((b.sc || 1) * f, 0.3, 4);
    b.tagOff = { x: Math.round(b.tagOff.x * f), y: Math.round(b.tagOff.y * f) };
  });
  DOC.streams.forEach(s => {
    if (s.midN != null) {
      s.mid = Math.round(s.midN);
      delete s.midN;
    }
  });
  logEv(`All equipment scaled ${f > 1 ? 'up' : 'down'}`);
  changed();
  fit();
}
function updVSc() {
  const b = SEL && SEL.t === 'b' ? B(SEL.id) : null;
  $('#vScV').textContent = b ? Math.round((b.sc || 1) * 100) + '%' : '—';
  $('#vScDn').disabled = $('#vScUp').disabled = !b;
}
$('#bView').onclick = e => {
  const p = $('#vpop');
  if (p.classList.contains('on')) {
    p.classList.remove('on');
    return;
  }
  const r = e.currentTarget.getBoundingClientRect();
  p.style.top = r.bottom + 6 + 'px';
  p.style.left = Math.max(8, Math.min(innerWidth - 310, r.left)) + 'px';
  updVSc();
  p.classList.add('on');
};
$('#vClose').onclick = () => $('#vpop').classList.remove('on');
$('#vX').onclick = () => $('#vpop').classList.remove('on');
document.addEventListener(
  'keydown',
  e => {
    if (e.key !== 'Escape') return;
    if ($('#modal').classList.contains('on')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeModal();
    } else if ($('#vpop').classList.contains('on')) {
      e.stopImmediatePropagation();
      $('#vpop').classList.remove('on');
    } else if ($('#ovl').classList.contains('on')) {
      e.stopImmediatePropagation();
      $('#ovl').classList.remove('on');
    }
  },
  true,
);
document.addEventListener('pointerdown', e => {
  const p = $('#vpop');
  if (p.classList.contains('on') && !p.contains(e.target) && !e.target.closest('#bView'))
    p.classList.remove('on');
});
$('#vTs').oninput = e => {
  PREF.ts = +e.target.value;
  savePref();
  applyPrefs();
};
$('#vUi').oninput = e => {
  PREF.ui = +e.target.value;
  savePref();
  applyPrefs(true);
};
$('#vUi').onchange = () => {}; // interface size: the view keeps its centre
$('#vLines').onchange = e => {
  PREF.lines = e.target.checked;
  savePref();
  renderCanvas();
};
[
  ['vLeft', 'left'],
  ['vRight', 'right'],
  ['vDock', 'dock'],
  ['vMini', 'mini'],
].forEach(
  ([id, k]) =>
    ($('#' + id).onchange = e => {
      PREF[k] = e.target.checked;
      savePref();
      applyPrefs();
    }),
);
$('#vFit').onchange = e => {
  PREF.fit = e.target.value;
  savePref();
  fit();
};
$('#vScUp').onclick = () => {
  const b = B(SEL?.id);
  if (b) setScale(b, (b.sc || 1) * 1.1);
};
$('#vScDn').onclick = () => {
  const b = B(SEL?.id);
  if (b) setScale(b, (b.sc || 1) / 1.1);
};
$('#vAllUp').onclick = () => scaleAll(1.15);
$('#vAllDn').onclick = () => scaleAll(1 / 1.15);
$('#vReset').onclick = () => {
  PREF = Object.assign({}, PREF_DEF);
  savePref();
  applyPrefs();
  requestAnimationFrame(() => fit());
  toast('View settings reset');
};
$('#bFocus').onclick = toggleFocus;
$('#bFull').onclick = () => setFull(!document.fullscreenElement);
$('#pExit2').onclick = () => setPresent(false);
$('#zsel').onchange = e => {
  const v = e.target.value;
  if (v === 'page' || v === 'width') fit(v);
  else if (v !== 'cur') zoomTo(+v);
};
let MINI = { x0: 0, y0: 0, w: 1, h: 1 };
function miniRender() {
  if (!PREF.mini || !DOC) return;
  const { x0, y0, x1, y1 } = bounds();
  const pad = 20;
  MINI = { x0: x0 - pad, y0: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  const svg = $('#miniSvg');
  svg.setAttribute('viewBox', `${MINI.x0} ${MINI.y0} ${MINI.w} ${MINI.h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const st = DOC.streams
    .map(s => {
      const G = streamGeom(s);
      return G
        ? `<path d="${G.d}" stroke="${KIND[s.kind]?.c || '#888'}" stroke-width="3" fill="none" opacity=".7"/>`
        : '';
    })
    .join('');
  const bl = DOC.blocks
    .filter(b => !EQ[b.type].inst && b.type !== 'junction')
    .map(b => {
      const { W, H } = dims(b),
        sv = EQ[b.type].widget ? 0 : blkSev(b);
      return `<rect x="${b.x}" y="${b.y}" width="${W}" height="${H}" rx="2" fill="${EQ[b.type].widget ? '#cbd5e1' : b.props.oos ? '#9aa5b5' : sv ? sevC(sv) : '#64748b'}" opacity="${EQ[b.type].widget ? 0.5 : 0.85}"/>`;
    })
    .join('');
  svg.innerHTML = st + bl + '<rect class="vr" id="miniVr"/>';
  miniView();
}
function miniView() {
  const vr = document.getElementById('miniVr');
  if (!vr) return;
  const r = $('#cwrap').getBoundingClientRect();
  vr.setAttribute('x', -VIEW.tx / VIEW.k);
  vr.setAttribute('y', -VIEW.ty / VIEW.k);
  vr.setAttribute('width', r.width / VIEW.k);
  vr.setAttribute('height', r.height / VIEW.k);
}
function miniGo(e) {
  const svg = $('#miniSvg'),
    r = svg.getBoundingClientRect(),
    s = Math.min(r.width / MINI.w, r.height / MINI.h),
    ox = (r.width - MINI.w * s) / 2,
    oy = (r.height - MINI.h * s) / 2;
  const wx = MINI.x0 + (e.clientX - r.left - ox) / s,
    wy = MINI.y0 + (e.clientY - r.top - oy) / s,
    c = $('#cwrap').getBoundingClientRect();
  VIEW.tx = c.width / 2 - wx * VIEW.k;
  VIEW.ty = c.height / 2 - wy * VIEW.k;
  applyView();
}
let miniDrag = false;
$('#mini').addEventListener('pointerdown', e => {
  miniDrag = true;
  $('#mini').setPointerCapture(e.pointerId);
  miniGo(e);
});
$('#mini').addEventListener('pointermove', e => {
  if (miniDrag) miniGo(e);
});
$('#mini').addEventListener('pointerup', () => (miniDrag = false));
$('#mini').addEventListener(
  'wheel',
  e => {
    e.preventDefault();
    e.stopPropagation();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);

/* v1.7 — like the Loop Studio there is no module bar: its useful buttons moved into the header.
   Alarm counters open the alerts list, the data-status chip opens data sources / gateway, and the round
   button at the far right switches the theme. The bar can be turned back on in View settings. */
(() => {
  const alerts = () => $('#railAlerts').onclick && $('#railAlerts').onclick();
  const sev = $('#sevc');
  if (sev) {
    sev.addEventListener('click', alerts);
    sev.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), alerts()));
  }
  const gw = $('.hdr .gw');
  if (gw) {
    gw.setAttribute('role', 'button');
    gw.tabIndex = 0;
    gw.title = 'Data sources and gateway';
    gw.addEventListener('click', () => sourcesForm());
    gw.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), sourcesForm()));
  }
  const th = $('#themeBtn2');
  if (th) th.onclick = () => $('#themeBtn').onclick && $('#themeBtn').onclick();
  const vr = $('#vRail');
  if (vr)
    vr.onchange = e => {
      PREF.rail = e.target.checked;
      savePref();
      applyPrefs();
    };
})();

/* v1.8 — Loop Studio–style ribbon: tabs Home · Arrange · View · Simulate, collapse (Ctrl+F1 or double-click a
   tab), Design opens Home and Simulate opens the Simulate tab. */
(() => {
  const tabs = $$('#ribbon .rtabs [data-rt]');
  if (!tabs.length) return;
  const show = k => {
    tabs.forEach(b => b.classList.toggle('on', b.dataset.rt === k));
    $$('#ribbon .rpanel').forEach(p => p.classList.toggle('on', p.dataset.rp === k));
    if (document.body.classList.contains('rb-collapsed')) document.body.classList.add('rb-peek');
  };
  tabs.forEach(b => {
    b.onclick = () => show(b.dataset.rt);
    b.ondblclick = () => collapse(!document.body.classList.contains('rb-collapsed'));
  });
  const collapse = on => {
    document.body.classList.toggle('rb-collapsed', on);
    document.body.classList.remove('rb-peek');
    $('#rbCollapse').title = on ? 'Expand the ribbon (Ctrl+F1)' : 'Collapse the ribbon (Ctrl+F1)';
    try {
      localStorage.setItem('sandman-ribbon', on ? 'collapsed' : 'open');
    } catch (e) {}
  };
  $('#rbCollapse').onclick = () => collapse(!document.body.classList.contains('rb-collapsed'));
  try {
    if (localStorage.getItem('sandman-ribbon') === 'collapsed') collapse(true);
  } catch (e) {}
  document.addEventListener('pointerdown', e => {
    if (document.body.classList.contains('rb-peek') && !e.target.closest('#ribbon')) document.body.classList.remove('rb-peek');
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'F1') {
      e.preventDefault();
      collapse(!document.body.classList.contains('rb-collapsed'));
    }
  });
  $('#bFront') && ($('#bFront').onclick = () => zSel('front'));
  $('#bBack') && ($('#bBack').onclick = () => zSel('back'));
  window.ribbonForMode = m => show(m === 'design' ? 'home' : 'sim');
})();

$('#vAutoProps') &&
  ($('#vAutoProps').onchange = e => {
    PREF.autoProps = e.target.checked;
    savePref();
    toast(PREF.autoProps ? 'Properties opens whenever you click equipment' : 'Click selects; double-click or right-click → Properties opens the panel');
  });
