/*! SandMan Digital Loop Studio — 17-ribbon.js
 *  v3.0 — Option A "colour ribbon": Home (File · Edit · Show · Live data · Layout · Samples), Insert (Tools · Shapes ·
 *  Library · Pipes) and Help tabs, the selection card, My loops (Open / Save, Ctrl+S / Ctrl+O), show options.
 *  Existing commands keep their own ids and handlers; this file only adds the new buttons. */

(() => {
  const btn = id => document.getElementById(id);
  const on = (id, fn) => {
    const b = btn(id);
    if (b) b.addEventListener('click', fn);
  };
  const fileAct = v => {
    const s = btn('selFile');
    if (!s) return;
    s.value = v;
    s.dispatchEvent(new Event('change'));
  };
  const needDesign = () => {
    if (MODE === 'design' && !PRESENT) return true;
    toast('Switch to Design mode to do this');
    return false;
  };

  /* ---------- v5.9 / v6.0 publish view: Fill screen (default) / Whole loop / Fill width ---------- */
  if (PREF.pfit === 'spread') PREF.pfit = 'fill';
  const pfitSync = () => {
    const m = PREF.pfit || 'fill';
    btn('pFitFill')?.classList.toggle('on', m === 'fill');
    btn('pFitPage')?.classList.toggle('on', m === 'page');
    btn('pFitWidth')?.classList.toggle('on', m === 'width');
  };
  const pfitSet = m => {
    PREF.pfit = m;
    savePref();
    pfitSync();
    spreadApply(); // spreads for Fill screen, restores the drawn layout otherwise
    renderAll();
    fit(null, true);
  };
  on('pFitFill', () => pfitSet('fill'));
  on('pFitPage', () => pfitSet('page'));
  on('pFitWidth', () => pfitSet('width'));
  pfitSync();
  /* ---------- v4.9 customer context chip ---------- */
  if (typeof renderCustomerChip === 'function') {
    renderCustomerChip();
    on('custChip', () => customerInfo());
  }
  /* ---------- My loops: Save / Open ---------- */
  const LOOPS_KEY = 'sandman-loops' + (typeof CUSTOMER_NS === 'string' ? CUSTOMER_NS : ''); // v4.9: per customer
  const loops = () => {
    try {
      return JSON.parse(localStorage.getItem(LOOPS_KEY) || '[]');
    } catch (e) {
      return [];
    }
  };
  const putLoops = L => {
    try {
      localStorage.setItem(LOOPS_KEY, JSON.stringify(L));
      return true;
    } catch (e) {
      toast('Browser storage is full — export the flowsheet to keep it');
      return false;
    }
  };
  function saveLoop(asName) {
    const name = (asName || DOC.name || '').trim();
    if (!name || /^(new flowsheet|untitled)/i.test(name)) return saveAs();
    try {
      syncDocCustom();
    } catch (e) {}
    const L = loops().filter(x => x.name !== name);
    L.unshift({ name, saved: Date.now(), n: DOC.blocks.length, data: JSON.stringify({ DOC, REG }) });
    if (putLoops(L)) {
      if (DOC.name !== name) {
        DOC.name = name;
        const dn = btn('docName');
        if (dn) dn.value = name;
      }
      const st = btn('saveSt');
      if (st) {
        st.textContent = '● Saved to My loops';
        st.className = 'savest ok';
      }
      toast(`“${name}” saved to My loops`);
    }
  }
  function saveAs() {
    openModal(
      `<h3>Save to My loops</h3><div class="note">Saved loops stay in this browser and can be opened again with Open.</div>
 <div class="fld" style="margin-top:10px"><label>Loop name</label><input id="slName" value="${esc(DOC.name && !/^new flowsheet/i.test(DOC.name) ? DOC.name : '')}" placeholder="e.g. DISA line 1 — sand loop"></div>
 <div class="mact"><button class="ib" id="slCancel">Cancel</button><button class="ib pri" id="slGo">Save</button></div>`,
    );
    const inp = btn('slName');
    inp.focus();
    btn('slCancel').onclick = closeModal;
    const go = () => {
      const n = inp.value.trim();
      if (!n) {
        toast('Give the loop a name');
        return;
      }
      closeModal();
      saveLoop(n);
    };
    btn('slGo').onclick = go;
    inp.onkeydown = e => e.key === 'Enter' && go();
  }
  function loadData(o, label) {
    if (o && o.DOC) registerDocCustom(o.DOC);
    if (!o || !o.DOC || !o.REG || !Array.isArray(o.DOC.blocks) || o.DOC.blocks.some(b => !EQ[b.type])) {
      toast('That file is not a SandMan flowsheet');
      return false;
    }
    pushUndo();
    DOC = o.DOC;
    REG = o.REG;
    for (const id in REG) ensureVal(id);
    seedHist();
    SEL = null;
    SELM.clear();
    logEv(`${label} opened`);
    changed();
    requestAnimationFrame(() => fit());
    toast(`“${DOC.name || label}” opened — Ctrl+Z goes back`);
    return true;
  }
  function openDialog() {
    const L = loops();
    const when = t => new Date(t).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    openModal(
      `<h3>Open</h3>
 <div class="opn">
  <h5>My loops</h5>
  ${
    L.length
      ? `<div class="opl">${L.map((x, i) => `<div class="opr"><button class="opgo" data-i="${i}"><b>${esc(x.name)}</b><span>${x.n} items · saved ${when(x.saved)}</span></button><button class="ib opdel" data-d="${i}" title="Remove from My loops" aria-label="Remove ${esc(x.name)}">✕</button></div>`).join('')}</div>`
      : '<div class="note">No saved loops yet — press Save (Ctrl+S) to keep the current flowsheet here.</div>'
  }
  <h5>Reference loops</h5>
  <div class="opl">${BUILTIN_TPLS.filter(t => t.id !== 'b_blank')
    .map(t => `<div class="opr"><button class="opgo" data-ref="${t.id}"><b>${esc(t.name)}</b><span>Reference loop</span></button></div>`)
    .join('')}</div>
  <h5>From a file</h5>
  <label class="ib opfile">Choose a flowsheet file (.json)…<input type="file" id="opFile" accept=".json,application/json" hidden></label>
 </div>
 <div class="mact"><button class="ib" id="opClose">Close</button></div>`,
      true,
    );
    btn('opClose').onclick = closeModal;
    $$('#modal .opgo[data-i]').forEach(
      b =>
        (b.onclick = () => {
          const x = loops()[+b.dataset.i];
          if (!x) return;
          closeModal();
          try {
            loadData(JSON.parse(x.data), x.name);
          } catch (e) {
            toast('That saved loop could not be read');
          }
        }),
    );
    $$('#modal .opgo[data-ref]').forEach(
      b =>
        (b.onclick = () => {
          const t = BUILTIN_TPLS.find(x => x.id === b.dataset.ref);
          closeModal();
          if (t) openReference(t);
        }),
    );
    $$('#modal .opdel').forEach(
      b =>
        (b.onclick = () => {
          const L2 = loops();
          const x = L2.splice(+b.dataset.d, 1)[0];
          putLoops(L2);
          toast(`“${x ? x.name : 'Loop'}” removed from My loops`);
          openDialog();
        }),
    );
    btn('opFile').onchange = e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          if (loadData(JSON.parse(r.result), f.name.replace(/\.json$/i, ''))) closeModal();
        } catch (er) {
          toast('That file is not a SandMan flowsheet');
        }
      };
      r.readAsText(f);
    };
  }
  function downloadJson() {
    try {
      syncDocCustom();
    } catch (e) {}
    const name = (DOC.name || 'flowsheet').replace(/[^\w\- ]+/g, '').trim() || 'flowsheet';
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({ format: 'sandman-flowsheet', DOC, REG }));
    a.download = name + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Flowsheet file downloaded — if nothing appears, use “Copy flowsheet JSON”');
  }

  on('bNew', () => needDesign() && fileAct('blank'));
  on('bOpen', () => (RP ? toast('Leave traceability (Back to live) first') : openDialog()));
  on('bSave', () => saveLoop());
  on('bExport', e =>
    menu(e, [
      { t: 'Download flowsheet file (.json)', f: downloadJson },
      { t: 'Copy flowsheet JSON…', f: () => fileAct('export') },
      { t: 'Save as… (new name in My loops)', f: saveAs },
      '-',
      { t: 'Import flowsheet (JSON)…', f: () => fileAct('import'), dis: MODE !== 'design' },
      { t: 'Export tags (CSV)…', f: () => fileAct('csvx') },
      { t: 'Import tags (CSV)…', f: () => fileAct('csv'), dis: MODE !== 'design' },
      '-',
      { t: 'Save as template…', f: () => fileAct('tplsave') },
      { t: 'Templates…', f: () => fileAct('tpls') },
      { t: 'Equipment library import / export…', f: () => fileAct('libio') },
    ]),
  );
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      if (e.shiftKey) saveAs();
      else saveLoop();
    } else if (k === 'o') {
      e.preventDefault();
      if (!RP) openDialog();
    } else if (k === 'f' && MODE === 'design' && !PRESENT && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      e.preventDefault();
      findDialog();
    }
  });

  /* ---------- Edit ---------- */
  on('bPaste', () => pasteHere());
  on('rUndo', () => btn('bUndo').click());
  on('rRedo', () => btn('bRedo').click());

  /* ---------- Show: grid, legend, names, canvas background ---------- */
  let SHOW = { grid: true, legend: true, names: true, bg: '' };
  try {
    SHOW = Object.assign(SHOW, JSON.parse(localStorage.getItem('sandman-show') || '{}'));
  } catch (e) {}
  /* v3.3 — Plant look: saved with the flowsheet (DOC.look); also used by Publish */
  const LOOKS = [
    ['classic', 'Classic (white)'],
    ['grey', 'Control grey'],
    ['floor', 'Plant floor'],
    ['dark', 'Control room dark'],
    ['blueprint', 'Engineering blueprint'],
    ['sand', 'Foundry sand'],
    ['isa', 'ISA-101 high performance'],
    ['hall', 'Background · Industrial hall (blue)'],
    ['steel', 'Background · Plant interior (steel)'],
  ];
  const lookOf = () => (LOOKS.some(l => l[0] === DOC.look) ? DOC.look : '');
  const applyLook = () => {
    const w = btn('cwrap'),
      k = lookOf();
    if (!w) return;
    if (k) {
      if (w.dataset.look !== k) w.dataset.look = k;
    } else if (w.dataset.look) delete w.dataset.look;
    const sl = btn('selLook');
    if (sl && sl.value !== (k || 'classic')) sl.value = k || 'classic';
  };
  window.setLook = k => {
    if (!LOOKS.some(l => l[0] === k)) return;
    if (DOC.look === k) return applyLook();
    pushUndo();
    DOC.look = k;
    try {
      localStorage.setItem('sandman-look', k);
    } catch (e) {}
    applyLook();
    changed();
    toast('Plant look: ' + LOOKS.find(l => l[0] === k)[1]);
  };
  (() => {
    const sl = btn('selLook');
    if (!sl) return;
    sl.innerHTML = LOOKS.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('');
    sl.onchange = () => setLook(sl.value);
    // a new / empty flowsheet starts with the last look chosen
    try {
      const last = localStorage.getItem('sandman-look');
      if (!DOC.look && last && !DOC.blocks.length) DOC.look = last;
    } catch (e) {}
    applyLook();
  })();
  const applyShow = () => {
    cv.classList.toggle('nogrid', !SHOW.grid);
    cv.classList.toggle('nolegend', !SHOW.legend);
    cv.classList.toggle('nonames', !SHOW.names);
    const wrap = btn('cwrap') || cv.parentElement;
    wrap.style.removeProperty('--canvas'); // v3.3: the canvas background comes from the Plant look
    btn('bGrid')?.classList.toggle('on', SHOW.grid);
    btn('bLegend')?.classList.toggle('on', SHOW.legend);
    btn('bNames')?.classList.toggle('on', SHOW.names);
    try {
      localStorage.setItem('sandman-show', JSON.stringify(SHOW));
    } catch (e) {}
  };
  const flip = (k, n) => () => {
    SHOW[k] = !SHOW[k];
    applyShow();
    toast(`${n} ${SHOW[k] ? 'shown' : 'hidden'}`);
  };
  on('bGrid', flip('grid', 'Grid'));
  on('bLegend', flip('legend', 'Legend boxes'));
  on('bNames', flip('names', 'Equipment names'));
  // v9.36 — Sand balance tonnes on the drawing: one-click on/off (also in Simulate › Sand balance)
  on('bTons', () => {
    PREF.mbOverlay = !PREF.mbOverlay;
    savePref();
    if (typeof mbOverlay === 'function') mbOverlay();
    btn('bTons')?.classList.toggle('on', !!PREF.mbOverlay);
    toast(`Sand tonnes ${PREF.mbOverlay ? 'shown on' : 'hidden from'} the drawing`);
  });
  btn('bTons')?.classList.toggle('on', !!PREF.mbOverlay);
  on('bCanvas', e => menu(e, LOOKS.map(([k, n]) => ({ t: ((lookOf() || 'classic') === k ? '✓ ' : '') + n, f: () => setLook(k) }))));
  applyShow();

  /* ---------- Live data ---------- */
  on('hSrc', () => btn('dSrc').click());
  const dataLabel = () => {
    if (!needDesign()) return;
    const b = SEL && SEL.t === 'b' ? B(SEL.id) : null;
    if (!b || EQ[b.type].widget) {
      toast('Select a piece of equipment first, then press Data label');
      return;
    }
    if (!EQ[b.type].notag && b.tags.length) {
      const hidden = b.tags.filter(t => !t.show);
      if (hidden.length) {
        pushUndo();
        hidden.forEach(t => (t.show = true));
        if (!SHOWTAGS) btn('bTags')?.click();
        changed();
        toast(`${hidden.length} data label${hidden.length > 1 ? 's' : ''} shown on ${b.name}`);
        return;
      }
    }
    PTAB = 'eq';
    renderProps();
    const a = btn('ixAdd');
    if (a) {
      a.hidden = false;
      btn('ixQ')?.focus();
    }
    toast(`Add a reading to ${b.name} — it is shown as a data label on the canvas`);
  };
  on('hLabel', dataLabel);
  on('iLabel', dataLabel);
  on('hLabelAll', () => {
    if (!needDesign()) return;
    const list = DOC.blocks.filter(b => !EQ[b.type].widget).flatMap(b => b.tags.filter(t => !t.show && REG[t.id]));
    if (!SHOWTAGS) btn('bTags')?.click();
    if (!list.length) {
      toast('Every reading already has a data label');
      return;
    }
    pushUndo();
    list.forEach(t => (t.show = true));
    changed();
    toast(`${list.length} data label${list.length > 1 ? 's' : ''} added — Ctrl+Z removes them`);
  });

  /* ---------- Samples ---------- */
  on('bSample', e =>
    menu(e, [
      ...BUILTIN_TPLS.filter(t => t.id !== 'b_blank').map(t => ({ t: t.name, f: () => (RP ? toast('Leave traceability first') : openReference(t)) })),
      '-',
      { t: 'More templates (including saved ones)…', f: () => openTemplates() },
    ]),
  );

  /* ---------- Insert › Tools ---------- */
  const place = t => {
    if (!needDesign()) return;
    if (CONNMODE) btn('bConn').click();
    setPan(false);
    setPlace(PLACE === t ? null : t);
    if (PLACE) toast(`Click the canvas to place: ${EQ[t].n} (Esc stops)`);
  };
  on('iSel', () => {
    setPan(false);
    setPlace(null);
    if (CONNMODE) btn('bConn').click();
  });
  on('iText', () => place('label'));
  on('iPan', () => {
    setPlace(null);
    if (CONNMODE) btn('bConn').click();
    setPan(!PANTOOL);
    if (PANTOOL) toast('Pan: drag the canvas to move the view — press V or Select to stop');
  });
  /* ---------- Insert › Shapes ---------- */
  const SH = [
    ['iRect', 'shRect'],
    ['iEllipse', 'shEllipse'],
    ['iArrow', 'shArrow'],
    ['iArea', 'areaBox'],
    ['iBlockArrow', 'shBlockArrow'],
    ['iCallout', 'shCallout'],
  ];
  SH.forEach(([id, t]) => on(id, () => place(t)));
  on('iShapes', e => menu(e, SH.map(([, t]) => ({ t: EQ[t].n === 'Area Box (zone)' ? 'Area / zone' : EQ[t].n, f: () => place(t) }))));
  /* ---------- Insert › Library ---------- */
  on('iPid', () => {
    const i = CATS.indexOf('Instruments & P&ID');
    if (i < 0) return;
    if (!PREF.left) {
      PREF.left = true;
      try {
        savePref();
      } catch (e) {}
      layoutCols();
    }
    const libTab = $$('.ptabs [data-lt]').find(x => !/tree/.test(x.dataset.lt));
    if (libTab && !libTab.classList.contains('on')) libTab.click();
    btn('libQ').value = '';
    LIBCAT = i;
    renderLib();
    btn('libMain').scrollTop = 0;
    toast('P&ID instruments — drag one onto the canvas, or see ISA-5.1 symbols in the rail');
  });
  function findDialog() {
    openModal(
      `<h3>Find equipment</h3><div class="fld"><input id="fdQ" placeholder="Name, type or tag — e.g. MX-1, muller, BIN" autocomplete="off"></div><div class="fdl" id="fdL"></div>
 <div class="mact"><button class="ib" id="fdClose">Close</button></div>`,
    );
    const q = btn('fdQ'),
      L = btn('fdL');
    const list = () => {
      const s = q.value.trim().toLowerCase();
      const hits = DOC.blocks
        .filter(b => !['label', 'junction'].includes(b.type))
        .filter(b => !s || `${b.name} ${EQ[b.type].n} ${(b.tags || []).map(t => t.id).join(' ')} ${b.props.desc || ''}`.toLowerCase().includes(s))
        .slice(0, 60);
      L.innerHTML = hits.length
        ? hits.map(b => `<button class="fdr" data-b="${b.id}"><b>${esc(b.name)}</b><span>${esc(EQ[b.type].n)}</span></button>`).join('')
        : `<div class="note">${DOC.blocks.length ? 'Nothing matches.' : 'The flowsheet is empty.'}</div>`;
      L.querySelectorAll('.fdr').forEach(
        x =>
          (x.onclick = () => {
            closeModal();
            select({ t: 'b', id: x.dataset.b });
            center(B(x.dataset.b));
          }),
      );
    };
    q.oninput = list;
    q.onkeydown = e => {
      if (e.key === 'Enter') L.querySelector('.fdr')?.click();
    };
    btn('fdClose').onclick = closeModal;
    list();
    q.focus();
  }
  on('iFind', () => findDialog());
  /* ---------- Insert › Pipes: flow arrows on the selected line (or every line) ---------- */
  on('iFlow', () => {
    if (!needDesign()) return;
    const s = SEL && SEL.t === 's' ? DOC.streams.find(x => x.id === SEL.id) : null;
    pushUndo();
    if (s) {
      s.anim = s.anim === 'arrows' ? 'inherit' : 'arrows';
      changed();
      toast(s.anim === 'arrows' ? `Flow arrows on ${s.name}` : `${s.name} uses the flowsheet animation again`);
      return;
    }
    const allArrows = (DOC.flowStyle || 'default') === 'arrows';
    DOC.flowStyle = allArrows ? 'default' : 'arrows';
    const fs = btn('flowStyle');
    if (fs) fs.value = DOC.flowStyle;
    changed();
    toast(allArrows ? 'Lines use the standard flow animation again' : 'Flow arrows on every line (they move while the plant runs in Simulate)');
  });

  /* ---------- Help ---------- */
  on('hKeys', () => {
    openModal(
      `<h3>Keyboard and mouse shortcuts</h3><table class="kt">${[
        ['Click', 'Select'],
        ['Double-click', 'Open the Properties panel'],
        ['Drag on empty canvas', 'Selection box'],
        ['Space + drag · middle button · Pan tool', 'Move the view'],
        ['Ctrl + wheel', 'Zoom'],
        ['V · C · T · B', 'Select · Connect · Text · Area'],
        ['Ctrl+Z · Ctrl+Y', 'Undo · Redo'],
        ['Ctrl+C · Ctrl+V · Ctrl+D', 'Copy · Paste at the pointer · Duplicate'],
        ['Del', 'Delete'],
        ['R · H', 'Rotate · Flip'],
        ['Ctrl+G · Ctrl+Shift+G', 'Group · Ungroup'],
        ['Ctrl+] · Ctrl+[', 'Bring to front · Send to back'],
        ['Ctrl+S · Ctrl+Shift+S · Ctrl+O', 'Save · Save as · Open'],
        ['Ctrl+F', 'Find equipment'],
        ['/', 'Search the library'],
        ['Ctrl+F1', 'Collapse the ribbon'],
        ['Esc', 'Stop the current tool'],
      ]
        .map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`)
        .join('')}</table><div class="mact"><button class="ib pri" id="hkOk">Close</button></div>`,
    );
    btn('hkOk').onclick = closeModal;
  });
  on('hGuide', () => {
    openModal(
      `<h3>Quick guide</h3><ol class="qg">
 <li><b>Build</b> — drag equipment from the library, or Home › Load sample. Drag from a port to another port to draw a line.</li>
 <li><b>Connect data</b> — double-click equipment › Data connection: choose the Source, set the equipment data tag, press Map readings.</li>
 <li><b>Label</b> — Home › Data label (selected equipment) or Label all equipment.</li>
 <li><b>Simulate</b> — run the loop with live or simulated values; test a plant fault, open Traceability or Sand balance.</li>
 <li><b>Publish</b> — the full-screen operator view of the whole loop.</li>
 <li><b>Keep it</b> — Save (Ctrl+S) stores the loop in My loops; Export downloads a file to share.</li></ol>
 <div class="mact"><button class="ib pri" id="hgOk">Close</button></div>`,
    );
    btn('hgOk').onclick = closeModal;
  });
  on('hAbout', () => {
    openModal(
      `<h3>SandMan® Digital Loop Studio</h3><div class="note">Version 3.0 · MPM Infosoft<br>Design, simulate and publish green-sand loops with live plant data.</div><div class="mact"><button class="ib pri" id="haOk">Close</button></div>`,
    );
    btn('haOk').onclick = closeModal;
  });

  /* ---------- selection card + button states ---------- */
  const card = () => {
    const bs = typeof selBlocks === 'function' ? selBlocks() : [];
    const st = SEL && SEL.t === 's' ? DOC.streams.find(x => x.id === SEL.id) : null;
    let t, d;
    if (bs.length > 1) {
      t = `${bs.length} items selected`;
      d = 'Arrange › Group keeps them together · Del removes them';
    } else if (bs.length === 1) {
      const b = bs[0];
      t = b.name || EQ[b.type].n;
      d = `${EQ[b.type].n} · double-click for <em>Properties</em>`;
    } else if (st) {
      t = `Line ${st.name}`;
      d = `${KIND[st.kind]?.n || 'Line'} · Pipes › Flow on pipe adds flow arrows`;
    } else {
      t = 'Nothing selected';
      d = 'Double-click equipment to open its <em>Properties</em>';
    }
    const key = t + '|' + d;
    $$('.selcard').forEach(c => {
      if (c._k === key) return;
      c._k = key;
      c.classList.toggle('has', t !== 'Nothing selected');
      c.querySelector('.sct').innerHTML = `<b>${esc(t)}</b><span>${d}</span>`;
    });
  };
  const sync = () => {
    const ed = MODE === 'design' && !PRESENT && !RP;
    let clip = !!CLIP;
    if (!clip)
      try {
        clip = !!localStorage.getItem('sandman-clip');
      } catch (e) {}
    const set = (id, dis, onState) => {
      const b = btn(id);
      if (!b) return;
      b.disabled = dis;
      if (onState !== undefined) b.classList.toggle('on', onState);
    };
    set('bPaste', !ed || !clip);
    set('rUndo', btn('bUndo').disabled);
    set('rRedo', btn('bRedo').disabled);
    set('bNew', !ed);
    set('iSel', !ed, ed && !PLACE && !CONNMODE && !PANTOOL);
    set('iText', !ed, PLACE === 'label');
    set('iPan', !ed, PANTOOL);
    SH.forEach(([id, t]) => set(id, !ed, PLACE === t));
    set('iShapes', !ed, SH.some(([, t]) => PLACE === t));
    set('iFlow', !ed);
    set('hLabel', !ed);
    set('iLabel', !ed);
    set('hLabelAll', !ed);
    set('iFind', !DOC.blocks.length);
    if (!ed && PANTOOL) setPan(false);
    applyLook();
    card();
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && PANTOOL) setPan(false);
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'v' && PANTOOL && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) setPan(false);
  });
  setInterval(sync, 300);
  // refresh at once after any ribbon, canvas or key action so button states never lag
  ['click', 'keyup', 'pointerup'].forEach(ev => document.addEventListener(ev, () => requestAnimationFrame(sync), true));
  sync();
})();
