/*! SandMan Process Flowsheet — 05-panels.js
 *  Equipment library, flowsheet tree, Properties panel, bottom dock (alerts, events, tags, streams), header & status
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===== Library & tree ===== */
function fakeBlock(type) {
  const E = EQ[type];
  return {
    id: 'pal_' + type,
    type,
    name: E.pre,
    props: Object.assign({ desc: '', oos: false }, JSON.parse(JSON.stringify(E.props || {}))),
    tags: [],
    tagOff: { x: 0, y: 0 },
  };
}
function palIcon(type, cls = '') {
  const E = EQ[type],
    fb = fakeBlock(type);
  let w = E.w,
    h = E.h;
  if (E.autoH) h = E.autoH(fb);
  const ss = { level: 0.6, sev: 0, pos: 80 };
  const inner =
    E.draw(w, h, ss, fb, 'pal' + type + cls) + (E.dyn && type !== 'tagCard' ? E.dyn(w, h, ss, fb) : '');
  return `<svg class="${cls}" viewBox="-4 -14 ${w + 8} ${h + 18}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}
function renderTree() {
  if (LTAB !== 'tree') return;
  const by = {};
  DOC.blocks.forEach(b => {
    const c = CATS[EQ[b.type].cat];
    (by[c] = by[c] || []).push(b);
  });
  $('#tree').innerHTML =
    (DOC.blocks.length
      ? ''
      : '<div class="note" style="padding:12px">The flowsheet is empty. Add equipment from the library.</div>') +
    CATS.filter(c => by[c])
      .map(
        c =>
          `<h4>${c} (${by[c].length})</h4>` +
          by[c]
            .map(
              b =>
                `<button data-b="${b.id}" class="${SEL && SEL.id === b.id ? 'on' : ''}"><span class="sd" data-bsev="${b.id}"></span>${esc(b.name)}<span class="ty">${esc(EQ[b.type].n)}</span></button>`,
            )
            .join(''),
      )
      .join('') +
    (DOC.streams.length
      ? `<h4>Streams (${DOC.streams.length})</h4>` +
        DOC.streams
          .map(
            s =>
              `<button data-s="${s.id}" class="${SEL && SEL.id === s.id ? 'on' : ''}"><span class="sd" style="background:${KIND[s.kind].c};border-radius:1px"></span>${esc(s.name)}<span class="ty">${esc(B(s.from.b)?.name)} → ${esc(B(s.to.b)?.name)}</span></button>`,
          )
          .join('')
      : '');
  $$('#tree button').forEach(
    x =>
      (x.onclick = () => {
        if (x.dataset.b) {
          select({ t: 'b', id: x.dataset.b });
          center(B(x.dataset.b));
        } else select({ t: 's', id: x.dataset.s });
        closeDrawers();
      }),
  );
  liveTree();
}
function liveTree() {
  $$('[data-bsev]').forEach(d => {
    const b = B(d.dataset.bsev);
    if (!b) return;
    d.style.background = b.props.oos ? '#7b8794' : sevC(blkSev(b));
  });
}

/* ===== Properties ===== */
function fmtT(id) {
  const t = REG[id];
  return t ? tagTxt(id) : '—';
}
function eqOptions(sel, filter) {
  return DOC.blocks
    .filter(b => !EQ[b.type].widget && !EQ[b.type].inst && b.type !== 'junction' && (!filter || filter(b)))
    .map(
      b =>
        `<option value="${b.id}" ${sel === b.id ? 'selected' : ''}>${esc(b.name)} · ${esc(EQ[b.type].n)}</option>`,
    )
    .join('');
}
function widgetEditor(b) {
  const p = b.props;
  let h = '';
  if ('title' in p && b.type !== 'requestStation')
    h += `<div class="fld"><label>Title</label><input data-pp="title" value="${esc(p.title)}"></div>`;
  if (b.type === 'requestStation')
    h += `<div class="fld"><label>Title (use ↵ for a new line)</label><textarea data-pp="title" rows="2">${esc(p.title)}</textarea></div>`;
  if ('sub' in p)
    h += `<div class="fld"><label>Subtitle</label><input data-pp="sub" value="${esc(p.sub)}"></div>`;
  if ('label' in p)
    h += `<div class="fld"><label>Label (↵ for a new line)</label><textarea data-pp="label" rows="2">${esc(p.label)}</textarea></div>`;
  if (b.type === 'notice' || b.type === 'label')
    h += `<div class="fld"><label>Text</label><textarea data-pp="text" rows="2">${esc(p.text)}</textarea></div>`;
  if (b.type === 'areaBox')
    h += `<div class="fld"><label>Area name</label><input data-pp="text" value="${esc(p.text)}"></div>`;
  if (EQ[b.type].shape) // v3.0 — Insert › Shapes
    h += `<div class="fld"><label>Text</label><input data-pp="text" value="${esc(p.text || '')}"></div><div class="fld"><label>Colour</label><select data-pp="color">${[['#1f6feb', 'Blue'], ['#2f8f46', 'Green'], ['#c27803', 'Amber'], ['#d93636', 'Red'], ['#6b4fd6', 'Violet'], ['#0e7c86', 'Teal'], ['#475569', 'Slate']].map(([v, n]) => `<option value="${v}" ${p.color === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  if (b.type === 'addBin')
    h += `<div class="fld"><label>Material</label><select data-pp="material">${Object.keys(MAT)
      .map(m => `<option ${p.material === m ? 'selected' : ''}>${m}</option>`)
      .join('')}</select></div>`;
  if (b.type === 'toggleBtn')
    h += `<div class="fld"><label>Controls equipment</label><select data-pp="target"><option value="">Choose…</option>${eqOptions(p.target)}</select></div>`;
  if (b.type === 'controlPanel') {
    h +=
      `<div class="cpr-title"><b>Rows</b><span>${p.rows.length} row${p.rows.length === 1 ? '' : 's'}</span></div>` +
      p.rows
        .map((r, i) => {
          // v6.9 — clean row card: number, label, type, move / delete; equipment as chips + searchable checklist
          const eqs = DOC.blocks
            .filter(x => !EQ[x.type].widget && !EQ[x.type].inst && x.type !== 'junction' && x.type !== 'truck')
            .sort((a, c) => String(a.name).localeCompare(String(c.name), undefined, { numeric: true }));
          const sel = (r.targets || []).map(B).filter(Boolean);
          const ico = d => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
          return `<div class="cpr">
   <div class="cpr-h"><span class="cpr-n">${i + 1}</span>
     <input class="cpr-lbl" data-row="${i}" data-rk="label" value="${esc(r.label)}" placeholder="Row label" aria-label="Row ${i + 1} label">
     <span class="cpr-acts"><button type="button" class="cpr-ib" data-mvrow="${i}" data-dir="-1" title="Move up" aria-label="Move row up" ${i === 0 ? 'disabled' : ''}>${ico('M8 12.5v-9M4.5 7 8 3.5 11.5 7')}</button><button type="button" class="cpr-ib" data-mvrow="${i}" data-dir="1" title="Move down" aria-label="Move row down" ${i === p.rows.length - 1 ? 'disabled' : ''}>${ico('M8 3.5v9M4.5 9 8 12.5 11.5 9')}</button><button type="button" class="cpr-ib del" data-rmrow="${i}" title="Remove row" aria-label="Remove row">${ico('M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5')}</button></span>
   </div>
   <div class="cpr-eq">
     <label class="cpr-type"><span>Type</span><select class="cpr-kind" data-row="${i}" data-rk="kind" aria-label="Row ${i + 1} type"><option value="cmd" ${r.kind === 'cmd' ? 'selected' : ''}>Start / stop button</option><option value="light" ${r.kind === 'light' ? 'selected' : ''}>Status lamp</option></select></label>
     <div class="cpr-eqh"><span>${r.kind === 'light' ? 'Equipment monitored' : 'Equipment controlled'}</span><span class="cpr-cnt" data-cnt="${i}">${sel.length ? sel.length + ' selected' : 'None — local switch'}</span><button type="button" class="cpr-clr" data-clrrow="${i}" ${sel.length ? '' : 'hidden'}>Clear</button></div>
     <div class="cpr-chips" data-chips="${i}" ${sel.length ? '' : 'hidden'}>${sel.map(x => `<span class="cpr-chip">${esc(x.name)}<button type="button" data-unrow="${i}" data-unt="${x.id}" aria-label="Remove ${esc(x.name)}">×</button></span>`).join('')}</div>
     <input class="cpr-q" type="search" data-q="${i}" placeholder="Find equipment…" aria-label="Find equipment for row ${i + 1}">
     <div class="cpr-list">${eqs.map(x => `<label data-nm="${esc(String(x.name).toLowerCase() + ' ' + (EQ[x.type].n || '').toLowerCase())}"><input type="checkbox" data-row="${i}" data-tgt="${x.id}" ${r.targets?.includes(x.id) ? 'checked' : ''}><span class="nm">${esc(x.name)}</span><span class="ty">${esc(EQ[x.type].n || '')}</span></label>`).join('') || '<p class="cpr-empty">No equipment on the flowsheet yet.</p>'}<p class="cpr-none" hidden>No match.</p></div>
   </div>
 </div>`;
        })
        .join('') +
      `<button class="cpr-add" id="addRow" type="button">＋ Add row</button>`;
  }
  if (b.type === 'requestStation') {
    h +=
      `<h5 style="margin:10px 0 6px;font-size:11.5px">Rows</h5>` +
      p.rows
        .map(
          (r, i) =>
            `<div class="rowed"><div class="row2"><div class="fld"><label>Label</label><input data-row="${i}" data-rk="label" value="${esc(r.label)}"></div><div class="fld"><label>Equipment</label><select data-row="${i}" data-rk="target"><option value="">Choose…</option>${eqOptions(r.target)}</select></div></div><button class="lb" data-rmrow="${i}" style="color:var(--crit)">Remove row</button></div>`,
        )
        .join('') +
      `<button class="ib" id="addRow" style="width:100%">＋ Add row</button>`;
  }
  if (b.type === 'statusMatrix')
    h += `<div class="fld"><label>Molding machines (columns)</label><div class="tlist">${
      DOC.blocks
        .filter(x => ['disaMini', 'disa', 'hmold'].includes(x.type))
        .map(
          x =>
            `<label><input type="checkbox" data-col="${x.id}" ${p.cols.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`,
        )
        .join('') || '<span class="note">Add a molding machine first.</span>'
    }</div></div><div class="note">Lamps: request sand (hopper filling), ready, e-stop/stopped, waiting for shakeout, shakeout running, blow auto (click lamp in Simulate mode to switch auto/manual).</div>`;
  return h;
}
function bindWidgetEditor(b) {
  const p = b.props;
  $$('#ptab [data-pp]').forEach(
    el =>
      (el.onchange = () => {
        pushUndo();
        p[el.dataset.pp] = el.value || (el.dataset.pp === 'target' ? null : '');
        changed();
      }),
  );
  $$('#ptab [data-rk]').forEach(
    el =>
      (el.onchange = () => {
        pushUndo();
        p.rows[+el.dataset.row][el.dataset.rk] = el.value || (el.dataset.rk === 'target' ? null : '');
        changed();
      }),
  );
  $$('#ptab [data-tgt]').forEach(
    el =>
      (el.onchange = () => {
        pushUndo();
        const r = p.rows[+el.dataset.row];
        r.targets = r.targets || [];
        if (el.checked) r.targets.push(el.dataset.tgt);
        else r.targets = r.targets.filter(x => x !== el.dataset.tgt);
        save();
        renderCanvas();
      }),
  );
  // v6.9 control panel rows: move, clear, remove chip, find, live count
  $$('#ptab [data-mvrow]').forEach(
    el =>
      (el.onclick = () => {
        const a = +el.dataset.mvrow,
          c = a + +el.dataset.dir;
        if (c < 0 || c >= p.rows.length) return;
        pushUndo();
        [p.rows[a], p.rows[c]] = [p.rows[c], p.rows[a]];
        changed();
      }),
  );
  $$('#ptab [data-clrrow]').forEach(
    el =>
      (el.onclick = () => {
        pushUndo();
        p.rows[+el.dataset.clrrow].targets = [];
        changed();
      }),
  );
  $$('#ptab .cpr-q').forEach(
    el =>
      (el.oninput = () => {
        const q = el.value.trim().toLowerCase(),
          list = el.nextElementSibling;
        let n = 0;
        list.querySelectorAll('label').forEach(l => {
          const on = !q || l.dataset.nm.includes(q);
          l.hidden = !on;
          n += on;
        });
        const none = list.querySelector('.cpr-none');
        if (none) none.hidden = n > 0;
      }),
  );
  const cprRefresh = i => {
    const ids = (p.rows[i].targets || []).filter(id => B(id)),
      c = $(`#ptab [data-cnt="${i}"]`),
      ch = $(`#ptab [data-chips="${i}"]`),
      cl = $(`#ptab [data-clrrow="${i}"]`);
    if (c) c.textContent = ids.length ? ids.length + ' selected' : 'None — local switch';
    if (cl) cl.hidden = !ids.length;
    if (ch) {
      ch.hidden = !ids.length;
      ch.innerHTML = ids.map(id => `<span class="cpr-chip">${esc(B(id).name)}<button type="button" data-unrow="${i}" data-unt="${id}" aria-label="Remove ${esc(B(id).name)}">×</button></span>`).join('');
    }
  };
  $$('#ptab .cpr [data-tgt]').forEach(el => el.addEventListener('change', () => cprRefresh(+el.dataset.row)));
  // chip × (also for chips added after a tick): untick in the list and refresh in place
  const cprRoot = $('#ptab');
  if (cprRoot && !cprRoot._cprChips) {
    cprRoot._cprChips = true;
    cprRoot.addEventListener('click', e => {
      const x = e.target.closest('[data-unrow]');
      if (!x || !SEL || !B(SEL.id) || !B(SEL.id).props.rows) return;
      e.stopImmediatePropagation();
      const pp = B(SEL.id).props,
        i = +x.dataset.unrow;
      pushUndo();
      pp.rows[i].targets = (pp.rows[i].targets || []).filter(t => t !== x.dataset.unt);
      const box = $(`#ptab [data-row="${i}"][data-tgt="${x.dataset.unt}"]`);
      if (box) box.checked = false;
      save();
      renderCanvas();
      cprRefresh(i);
    }, true);
  }
  $$('#ptab [data-rmrow]').forEach(
    el =>
      (el.onclick = () => {
        pushUndo();
        p.rows.splice(+el.dataset.rmrow, 1);
        changed();
      }),
  );
  $$('#ptab [data-col]').forEach(
    el =>
      (el.onchange = () => {
        pushUndo();
        if (el.checked) p.cols.push(el.dataset.col);
        else p.cols = p.cols.filter(x => x !== el.dataset.col);
        changed();
      }),
  );
  const ar = $('#addRow');
  if (ar)
    ar.onclick = () => {
      pushUndo();
      p.rows.push(
        b.type === 'controlPanel'
          ? { label: 'NEW ROW', kind: 'cmd', targets: [], on: true }
          : { label: 'P-xx', target: null },
      );
      changed();
    };
}
function renderProps() {
  const P = $('#props');
  if (RP) {
    P.innerHTML = rpPanel();
    bindRpPanel();
    return;
  }
  if (SELM.size > 1) {
    P.innerHTML = multiProps();
    bindMultiProps();
    return;
  }
  if (!SEL) {
    P.innerHTML = flowsheetProps();
    $$('#props [data-tlim]').forEach(x => (x.onclick = () => tagLimitsForm(null)));
    $$('#props [data-gb]').forEach(
      x =>
        (x.onclick = () => {
          const b = B(x.dataset.gb);
          select({ t: 'b', id: b.id });
          center(b);
        }),
    );
    return;
  }
  if (SEL.t === 's') {
    const s = Sx(SEL.id);
    if (!s) {
      SEL = null;
      return renderProps();
    }
    P.innerHTML = streamProps(s);
    bindStreamProps(s);
    return;
  }
  const b = B(SEL.id);
  if (!b) {
    SEL = null;
    return renderProps();
  }
  const E = EQ[b.type],
    st = bState(b);
  // v2.0 — equipment opens the Loop Studio–style Equipment panel (info, properties, data connection, readings);
  // the remaining tabs hold the extra settings. HMI widgets keep their own editor.
  const tabs = E.widget ? [['gen', 'General']] : [['eq', 'Equipment'], ['gen', 'Connections']];
  if (E.widget && b.type === 'tagCard') tabs.push(['tags', 'Tags']);
  if (!E.widget) tabs.push(['alerts', 'Alerts']);
  if (traceKind(b)) tabs.push(['trace', 'Traceability']);
  if (b.tags.some(t => REG[t.id]?.role === 'bent')) tabs.push(['presc', 'Prescription']);
  if (!tabs.some(t => t[0] === PTAB)) PTAB = tabs[0][0];
  P.innerHTML = `<div class="ph"><div class="ttl">${palIcon(b.type, 'ic')}<div style="flex:1;min-width:0"><input class="nm" value="${esc(b.name)}" aria-label="Name"><small>${esc(E.n)} · ${CATS[E.cat]}</small></div></div>
  ${st ? `<div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="st-pill" data-stp="${b.id}" style="background:${STC[st]}">${st}</span><span class="note">Health <b data-bsevt="${b.id}">${SEVN[blkSev(b)]}</b></span><button class="sb" id="pRun" style="margin-left:auto">${b.props.oos ? 'Start' : 'Stop'} (simulated)</button></div>` : ''}</div>
  <div class="ptabs">${tabs.map(([k, n]) => `<button data-pt="${k}" class="${PTAB === k ? 'on' : ''}">${n}${k === 'tags' ? ` (${b.tags.length})` : ''}</button>`).join('')}</div><div id="ptab"></div>`;
  $$('#props [data-pt]').forEach(
    x =>
      (x.onclick = () => {
        PTAB = x.dataset.pt;
        renderProps();
      }),
  );
  const nm = $('#props .nm');
  nm.onchange = () => renameBlock(b, nm.value.trim());
  const pr = $('#pRun');
  if (pr)
    pr.onclick = () => {
      setRunning(b, !!b.props.oos);
      logEv(`Operator: ${b.name} ${b.props.oos ? 'stopped' : 'started'}`);
      evalAlerts();
      save();
      liveCanvas();
      renderProps();
      renderTree();
    };
  const T = $('#ptab'),
    { w, h } = dims(b);
  if (PTAB === 'eq') {
    T.innerHTML = eqInspector(b);
    bindEqInspector(b);
    if (typeof cpIxInsert === 'function') cpIxInsert(T, b); // v9.41 Process & checks section
    if (typeof shiIxInsert === 'function') shiIxInsert(T, b); // v9.42 Sand health section
  } else if (PTAB === 'gen') {
    const cons = ports(b)
      .map(p => {
        const ls = portLinks(b.id, p.id);
        return `<div class="cbox"><div class="hd"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${KIND[p.kind].c}"></i>${p.id}<span class="note" style="font-weight:500">${p.dir === 'in' ? 'inlet' : p.dir === 'out' ? 'outlet' : 'in / out'}</span><span class="tag ${!ls.length && p.req ? 'tx3' : ''}">${!ls.length ? (p.req ? 'Required — not connected' : 'Optional') : ls.length + ' line' + (ls.length > 1 ? 's' : '')}</span></div>
   ${ls
     .map(s => {
       const o = s.from.b === b.id ? B(s.to.b) : B(s.from.b),
         op = s.from.b === b.id ? s.to.p : s.from.p;
       return `<div class="ln"><i class="sw" style="display:inline-block;width:12px;height:3px;background:${KIND[s.kind].c}"></i><b>${esc(s.name)}</b> ${s.from.b === b.id ? '→' : '←'} ${esc(o?.name)} · ${op}<button class="lb" data-selst="${s.id}">Select</button>${MODE === 'design' ? `<button class="lb" data-delst="${s.id}" style="color:var(--crit)">Remove</button>` : ''}</div>`;
     })
     .join('')}
   ${MODE === 'design' ? `<select data-cport="${p.id}"><option value="">＋ Connect ${p.dir === 'in' ? 'from' : 'to'}…</option>${connectOpts(b, p)}</select>` : ''}</div>`;
      })
      .join('');
    T.innerHTML = `<div class="sec">${widgetEditor(b)}${E.widget ? '' : `<div class="fld"><label>Description</label><textarea id="pDesc" rows="2" placeholder="Purpose, location, asset number">${esc(b.props.desc)}</textarea></div>`}
   <div class="row4"><div class="fld"><label>X</label><input id="pX" type="number" value="${b.x}"></div><div class="fld"><label>Y</label><input id="pY" type="number" value="${b.y}"></div>
   ${E.resize ? `<div class="fld"><label>Width</label><input id="pW" type="number" value="${w}" ${E.resize.includes('w') ? '' : 'disabled'}></div><div class="fld"><label>Height</label><input id="pH" type="number" value="${h}" ${E.resize.includes('h') && !E.autoH ? '' : 'disabled'}></div>` : ''}</div>
   ${b.type !== 'junction' ? `<div class="fld"><label>Display scale</label><div style="display:flex;gap:6px;align-items:center"><button class="sb" id="pScDn">−</button><input id="pSc" type="number" min="30" max="400" step="10" value="${Math.round((b.sc || 1) * 100)}" style="width:80px"> %<button class="sb" id="pScUp">＋</button></div></div>` : ''}
   ${!E.widget && !E.inst && b.type !== 'junction' ? `<div class="fld"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pName" ${b.props.hideName ? '' : 'checked'} style="width:auto"> Show name on canvas</label></div>` : ''}
   <div class="fld"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pLock" ${b.lock ? 'checked' : ''} style="width:auto"> Lock position${b.grp ? ' (whole group)' : ''}</label></div>
   ${b.grp ? `<div class="row2"><button class="ib" id="pUngrp">Ungroup</button></div>` : ''}
   ${E.noflip ? '' : `<div class="row2"><button class="ib" id="pRot">Rotate 90° (${b.rot || 0}°)</button><button class="ib" id="pFlip">Flip${b.flip ? ' (on)' : ''}</button></div>`}
   ${!E.widget && !E.inst ? `<div class="kv" style="margin-top:8px"><span>SandMan traceability stage</span><b>${AREA_STAGE[E.cat]}</b></div>` : ''}</div>
   ${ports(b).length ? `<div class="sec"><h5>Connections <span class="r"><button class="sb" id="pConnFrom" ${MODE !== 'design' ? 'disabled' : ''}>Connect from here</button></span></h5>${cons}</div>` : ''}`;
    if (typeof smPalPropMount === 'function') smPalPropMount(T, b); // v9.7 colour style of this item only
    if (typeof dmPropsMount === 'function') dmPropsMount(T, b); // v9.6 PLC Tag Monitor links (SCADA → PLCs, PLC → equipment)
    $$('#ptab [data-selst]').forEach(x => (x.onclick = () => select({ t: 's', id: x.dataset.selst })));
    $$('#ptab [data-delst]').forEach(
      x =>
        (x.onclick = () => {
          pushUndo();
          const st = Sx(x.dataset.delst);
          DOC.streams = DOC.streams.filter(y => y !== st);
          logEv(`Deleted stream ${st.name}`);
          changed();
        }),
    );
    $$('#ptab [data-cport]').forEach(
      x =>
        (x.onchange = () => {
          if (!x.value) return;
          const [ob, op] = x.value.split('|');
          doConnect(b.id, x.dataset.cport, ob, op);
        }),
    );
    const cf = $('#pConnFrom');
    if (cf)
      cf.onclick = () => {
        setConnMode(true);
        CONNSRC = { b: b.id, p: null };
        renderCanvas();
        updateHint();
        toast('Now click the destination on the canvas');
      };
    T.insertAdjacentHTML('beforeend', mbPropsHtml(b));
    bindMbProps(b);
    bindWidgetEditor(b);
    const on = (id, fn) => {
      const el = $(id);
      if (el) el.onchange = fn;
    };
    on('#pDesc', e => {
      pushUndo();
      b.props.desc = e.target.value;
      changed();
    });
    on('#pX', e => {
      pushUndo();
      b.x = +e.target.value || 0;
      changed();
    });
    on('#pY', e => {
      pushUndo();
      b.y = +e.target.value || 0;
      changed();
    });
    on('#pW', e => {
      pushUndo();
      b.w = Math.max(10, +e.target.value || E.w);
      changed();
    });
    on('#pH', e => {
      pushUndo();
      b.h = Math.max(10, +e.target.value || E.h);
      changed();
    });
    on('#pName', e => {
      pushUndo();
      b.props.hideName = !e.target.checked;
      changed();
    });
    const lk = $('#pLock');
    if (lk) lk.onchange = () => toggleLock(b);
    const ug = $('#pUngrp');
    if (ug) ug.onclick = () => ungroup(b);
    on('#pSc', e => setScale(b, (+e.target.value || 100) / 100));
    const sd = $('#pScDn'),
      su = $('#pScUp');
    if (sd) sd.onclick = () => setScale(b, (b.sc || 1) / 1.1);
    if (su) su.onclick = () => setScale(b, (b.sc || 1) * 1.1);
    const r = $('#pRot');
    if (r) r.onclick = rotSel;
    const f = $('#pFlip');
    if (f) f.onclick = flipSel;
  } else if (PTAB === 'tags') {
    T.innerHTML = `<div class="sec"><h5>Bound tags <span class="r note">${E.inst || b.type === 'tagCard' ? 'First tag drives the symbol' : '👁 shows the value on canvas'}</span></h5>
   ${
     b.tags.length
       ? b.tags
           .map((bt, i) => {
             const t = REG[bt.id];
             if (!t) return '';
             return `<div class="trow ${OPENTAG === t.id ? 'open' : ''}" data-i="${i}" data-tid="${esc(t.id)}"><div class="top"><span class="bar" data-sevbar="${esc(t.id)}" style="background:${sevC(tagSev(t.id))}"></span><div style="min-width:0"><div class="id">${esc(t.id)}</div><div class="ds">${esc(t.desc)} · ${esc(t.src)}</div><div class="ds mono">${(sp => `Min ${sp.min != null ? fmtN(sp.min, t.d) : '—'} · Opt ${fmtN(sp.opt, t.d)} · Max ${sp.max != null ? fmtN(sp.max, t.d) : '—'} · σ ${fmtN(sp.sd, (t.d || 0) + 2)}`)(spec(t))}</div></div>${t.cfg ? '' : '<span title="Default limits — not confirmed yet" style="width:9px;height:9px;border-radius:50%;background:var(--adv);flex-shrink:0"></span>'}<span class="v" data-live="${esc(t.id)}">${fmtT(t.id)}</span>
    <button class="lb" data-act="show" title="${bt.show ? 'Hide on canvas' : 'Show on canvas'}">${bt.show ? '👁' : '◌'}</button><button class="lb" data-act="trend" title="Trend">↗</button><button class="lb" data-act="edit" title="Limits">⚙</button><button class="lb" data-act="rm" title="Unbind" style="color:var(--crit)">×</button></div>
    <div class="ex">${tagEditorHtml(t)}</div></div>`;
           })
           .join('')
       : '<div class="note">No tags bound. Search the registry below or create a tag.</div>'
   }
   </div><div class="sec"><h5>Add tag</h5><div class="dd"><input type="search" id="tagQ" placeholder="Search registry by tag or description" autocomplete="off" style="width:100%;border:1px solid var(--line);border-radius:5px;padding:6px 8px;background:var(--panel)"><div class="ddl" id="tagDD" style="display:none"></div></div>
   <div class="row2" style="margin-top:8px"><button class="ib" id="bNewTag">＋ Create new tag</button><button class="ib" id="bTagLim">Edit all limits</button></div></div>`;
    $$('#ptab .trow').forEach(r => {
      const i = +r.dataset.i,
        bt = b.tags[i],
        t = REG[bt.id];
      r.querySelectorAll('[data-act]').forEach(
        x =>
          (x.onclick = () => {
            const a = x.dataset.act;
            if (a === 'show') {
              pushUndo();
              bt.show = !bt.show;
              changed();
            } else if (a === 'trend') openTrend(t.id);
            else if (a === 'edit') {
              OPENTAG = OPENTAG === t.id ? null : t.id;
              r.classList.toggle('open', OPENTAG === t.id);
            } else if (a === 'rm') {
              pushUndo();
              b.tags.splice(i, 1);
              logEv(`Unbound ${t.id} from ${b.name}`);
              changed();
            }
          }),
      );
    });
    bindTagEditors($('#ptab'));
    const q = $('#tagQ'),
      dd = $('#tagDD');
    const showDD = () => {
      const s = q.value.trim().toLowerCase();
      const list = Object.values(REG)
        .filter(
          t =>
            !b.tags.some(x => x.id === t.id) &&
            (!s || t.id.toLowerCase().includes(s) || t.desc.toLowerCase().includes(s)),
        )
        .slice(0, 40);
      dd.innerHTML = list.length
        ? list
            .map(t => {
              const o = tagOwner(t.id);
              return `<button data-id="${esc(t.id)}"><b class="mono">${esc(t.id)}</b> <span class="note">${esc(t.desc)} · ${o ? (o.b ? o.b.name : o.s.name) : 'unbound'}</span></button>`;
            })
            .join('')
        : '<div class="e">No matching tags. Create a new one.</div>';
      dd.style.display = 'block';
      dd.querySelectorAll('button').forEach(
        x =>
          (x.onmousedown = ev => {
            ev.preventDefault();
            pushUndo();
            b.tags.push({ id: x.dataset.id, show: true });
            logEv(`Bound ${x.dataset.id} to ${b.name}`);
            changed();
          }),
      );
    };
    q.onfocus = showDD;
    q.oninput = showDD;
    q.onblur = () => setTimeout(() => (dd.style.display = 'none'), 150);
    $('#bNewTag').onclick = () => tagForm(null, b);
    $('#bTagLim').onclick = () => tagLimitsForm(b.id);
  } else if (PTAB === 'alerts') {
    const act = Object.values(ALERTS).filter(a => a.blk === b.id);
    T.innerHTML = `<div class="sec"><h5>Active alerts</h5>${act.length ? act.map(a => `<div class="kv"><span><span class="chip sv${a.sev}">${SEVN[a.sev]}</span> ${esc(a.msg)}</span><b>${a.acked ? 'ACK' : `<button class="sb" data-ack="${esc(a.key)}">Ack</button>`}</b></div>`).join('') : '<div class="note">No active alerts on this equipment.</div>'}</div>
   <div class="sec"><h5>Limit alerts</h5><div class="note">Every bound tag raises Advisory at 75% of the way to a limit, Warning at L/H and Critical at LL/HH.</div></div>
   <div class="sec"><h5>Custom rules</h5>${(b.rules || []).map((r, i) => `<div class="kv"><span><span class="chip sv${r.sev}">${SEVN[r.sev]}</span> <span class="mono">${esc(r.tag)} ${r.op} ${r.val}</span>${r.delay ? ` for ${r.delay}s` : ''}<br><span class="note">${esc(r.msg)}</span></span><b><button class="lb" data-rr="${i}" style="color:var(--crit)">Remove</button></b></div>`).join('') || '<div class="note">No custom rules yet.</div>'}
   ${
     b.tags.length
       ? `<div style="margin-top:10px"><div class="fld"><label>Tag</label><select id="rTag">${b.tags.map(t => `<option>${esc(t.id)}</option>`).join('')}</select></div>
   <div class="row2"><div class="fld"><label>Condition</label><select id="rOp"><option value=">">greater than</option><option value="<">less than</option></select></div><div class="fld"><label>Value</label><input id="rVal" type="number" step="any"></div></div>
   <div class="row2"><div class="fld"><label>Severity</label><select id="rSev"><option value="1">Advisory</option><option value="2" selected>Warning</option><option value="3">Critical</option></select></div><div class="fld"><label>Persist for (s)</label><input id="rDel" type="number" value="5" min="0"></div></div>
   <div class="fld"><label>Message</label><input id="rMsg" placeholder="e.g. Hopper running low — check sand discharge"></div><button class="ib pri" id="bRule" style="width:100%">Add rule</button></div>`
       : '<div class="note">Bind a tag first to create rules.</div>'
   }</div>`;
    $$('#ptab [data-ack]').forEach(
      x =>
        (x.onclick = () => {
          ack(x.dataset.ack);
          renderProps();
        }),
    );
    $$('#ptab [data-rr]').forEach(
      x =>
        (x.onclick = () => {
          pushUndo();
          b.rules.splice(+x.dataset.rr, 1);
          changed();
        }),
    );
    const br = $('#bRule');
    if (br)
      br.onclick = () => {
        const v = parseFloat($('#rVal').value);
        if (!isFinite(v)) {
          toast('Enter a threshold value');
          return;
        }
        pushUndo();
        b.rules = b.rules || [];
        b.rules.push({
          id: 'r' + DOC.seq++,
          tag: $('#rTag').value,
          op: $('#rOp').value,
          val: v,
          sev: +$('#rSev').value,
          delay: +$('#rDel').value || 0,
          msg: $('#rMsg').value.trim(),
        });
        logEv(`Rule added on ${b.name}`);
        changed();
        toast('Rule added');
      };
  } else if (PTAB === 'trace') {
    T.innerHTML = traceTab(b);
    bindTraceTab(b);
  } else if (PTAB === 'data') {
    T.innerHTML = dataTab(b);
    $('#pLink').onclick = () => linkWizard(b.id);
    $('#pSrc').onclick = () => sourcesForm();
    $$('#ptab [data-unl]').forEach(
      x =>
        (x.onclick = () => {
          pushUndo();
          const t = REG[x.dataset.unl];
          delete t.link;
          t.src = 'Simulated';
          logEv(`Unlinked ${t.id}`);
          changed();
        }),
    );
  } else if (PTAB === 'presc') {
    const p = PRESC[b.props.group] || PRESC['Brake Disc'];
    const rows = [
      ['Bentonite', 'bent'],
      ['Coal dust', 'coal'],
    ]
      .map(([n, r]) => {
        const bt = b.tags.find(t => REG[t.id]?.role === r);
        if (!bt) return '';
        const v = val(bt.id),
          dv = ((v - p[r]) / p[r]) * 100;
        return `<tr><td>${n}</td><td class="num">${fmtN(p[r], 1)}</td><td class="num" data-live="${esc(bt.id)}">${fmtT(bt.id)}</td><td class="num ${Math.abs(dv) > 15 ? 'tx3' : Math.abs(dv) > 8 ? 'tx2' : 'tx0'}">${dv >= 0 ? '+' : ''}${fmtN(dv, 1)}%</td></tr>`;
      })
      .join('');
    T.innerHTML = `<div class="sec"><div class="fld"><label>Component group</label><select id="pGrp">${Object.keys(
      PRESC,
    )
      .map(g => `<option ${b.props.group === g ? 'selected' : ''}>${g}</option>`)
      .join(
        '',
      )}</select></div><table><thead><tr><th>Additive</th><th>Prescribed</th><th>Actual</th><th>Deviation</th></tr></thead><tbody>${rows}</tbody></table><div class="note" style="margin-top:8px">From SandMan Sandmix. Alerts at ±8% (Warning) and ±15% (Critical).</div></div>`;
    $('#pGrp').onchange = e => {
      pushUndo();
      b.props.group = e.target.value;
      applyPresc(b);
      logEv(`${b.name} prescription set to ${b.props.group}`);
      changed();
    };
  }
}
function renameBlock(b, n) {
  if (!n || n === b.name) return renderProps();
  if (DOC.blocks.some(x => x !== b && x.name === n)) {
    toast('Another item already uses ' + n);
    return renderProps();
  }
  pushUndo();
  logEv(`Renamed ${b.name} to ${n}`);
  b.name = n;
  changed();
}
function streamProps(s) {
  const fb = B(s.from.b),
    tb = B(s.to.b);
  return `<div class="ph"><div class="ttl"><svg class="ic" viewBox="0 0 46 32"><path d="M4 16H38" stroke="${KIND[s.kind].c}" stroke-width="3" ${s.kind === 'ret' ? 'stroke-dasharray="5 3"' : ''}/><path d="M34 10L42 16L34 22Z" fill="${KIND[s.kind].c}"/></svg><div style="flex:1"><input class="nm" value="${esc(s.name)}" aria-label="Stream name"><small>${KIND[s.kind].n}</small></div></div></div>
 <div class="sec"><div class="kv"><span>From</span><b>${esc(fb?.name)} · ${s.from.p}</b></div><div class="kv"><span>To</span><b>${esc(tb?.name)} · ${s.to.p}</b></div>
 <div class="fld" style="margin-top:8px"><label>Line type</label><select id="sKind">${Object.keys(KIND)
   .filter(k => k !== 'any')
   .map(k => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${KIND[k].n}</option>`)
   .join('')}</select></div>
 <div class="fld"><label>Stream tag (value shown on the line in Simulate mode)</label><select id="sTag"><option value="">None</option>${Object.values(
   REG,
 )
   .map(
     t =>
       `<option value="${esc(t.id)}" ${s.tag === t.id ? 'selected' : ''}>${esc(t.id)} · ${esc(t.desc)}</option>`,
   )
   .join('')}</select></div>
 </div><div class="sec"><h5>Connection</h5>
 <div class="fld"><label>From (outlet)</label><div class="row2"><select id="sFb">${endBlockOpts(s.from.b)}</select><select id="sFp">${endPortOpts(s, 'from')}</select></div></div>
 <div class="fld"><label>To (inlet)</label><div class="row2"><select id="sTb">${endBlockOpts(s.to.b)}</select><select id="sTp">${endPortOpts(s, 'to')}</select></div></div>
 <div class="row3"><button class="ib" id="sRev" ${MODE !== 'design' ? 'disabled' : ''}>⇄ Reverse</button><button class="ib" id="sRoute" ${(s.mid == null && !(s.pts && s.pts.length)) || MODE !== 'design' ? 'disabled' : ''}>Reset route</button><button class="ib" id="sDel" style="color:var(--crit)" ${MODE !== 'design' ? 'disabled' : ''}>Delete</button></div>
 <div class="fld" style="margin-top:8px"><label>Routing</label><select id="sRouteMode" ${MODE !== 'design' ? 'disabled' : ''}>${Object.entries(ROUTES).map(([k, n]) => `<option value="${k}" ${routeOf(s) === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
 <div class="note" style="margin-top:8px">Drag a square handle on a segment to move it, drag a round handle to move a bend, double-click the line to add a bend and double-click a bend to remove it (Shift keeps a segment straight). The square handles at the two ends move the line to another port. Right-click the line for symbols, style, direction and routing.</div></div>${lineLookSec(s)}`;
}
/* v1.14 — Line appearance section (Loop Studio choices) */
function kindPlural(k, one) {
  const n = (KIND[k]?.n || '').replace(/\s*lines?$/i, '');
  return `${n} line${one ? '' : 's'}`;
}
function symPreview(key, v, color, where = 'pv') {
  const id = `${where}-${key}-${v}`; // v4.4: unique per place (panel / menu), else the menu's pictures point at hidden copies
  return `<svg viewBox="0 0 64 20" aria-hidden="true"><defs>${lineMarker(id, v, color)}</defs><path d="M10 10H54" stroke="${color}" stroke-width="2" fill="none" ${v !== 'none' ? `marker-${key === 'startSym' ? 'start' : 'end'}="url(#${id})"` : ''}/></svg>`;
}
function lineLookSec(s) {
  const ed = MODE === 'design' ? '' : 'disabled',
    toJ = B(s.to.b)?.type === 'junction',
    endV = s.endSym || (toJ ? 'none' : 'triangle'),
    startV = s.startSym || 'none',
    col = s.color || KIND[s.kind]?.c || '#555',
    dashV = s.dash || (s.kind === 'ret' ? 'dashed' : 'solid'),
    wV = s.width || (s.kind === 'ret' ? 1.8 : 2.6);
  const picker = (key, cur) =>
    `<div class="sympick" role="radiogroup" aria-label="${key === 'startSym' ? 'Start symbol' : 'End symbol'}">${Object.entries(LINE_SYMS)
      .map(([v, t]) => `<button type="button" class="${v === cur ? 'on' : ''}" data-sym="${key}" data-v="${v}" title="${t}" aria-label="${t}" aria-pressed="${v === cur}" ${ed}>${symPreview(key, v, col)}</button>`)
      .join('')}</div>`;
  return `<div class="sec"><h5>Line appearance</h5>
 <div class="fld"><label>End symbol <span class="note">· ${LINE_SYMS[endV]}</span></label>${picker('endSym', endV)}</div>
 <div class="fld"><label>Start symbol <span class="note">· ${LINE_SYMS[startV]}</span></label>${picker('startSym', startV)}</div>
 <div class="row2"><div class="fld"><label>Line style</label><select id="sDash" ${ed}>${Object.entries(LINE_DASH).map(([k, [n]]) => `<option value="${k}" ${k === dashV ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
 <div class="fld"><label>Width</label><select id="sWid" ${ed}>${[1, 1.5, 1.8, 2, 2.6, 3, 4, 5, 6, 8].map(w => `<option value="${w}" ${w === wV ? 'selected' : ''}>${w} px</option>`).join('')}</select></div></div>
 <div class="fld"><label>Animation (Simulate / Publish)</label><select id="sAnim" ${ed}>${Object.entries(FLOW_STYLES).map(([k, [n]]) => `<option value="${k}" ${(s.anim || 'inherit') === k ? 'selected' : ''}>${k === 'inherit' ? `${n} (${FLOW_STYLES[DOC.flowStyle || 'default'][0]})` : n}</option>`).join('')}</select></div>
 <div class="row2"><div class="fld"><label>Colour</label><input type="color" id="sCol" value="${col}" ${ed}></div><div class="fld"><label>&nbsp;</label><button class="ib" id="sLookReset" ${ed} title="Back to the default look for this line type">Default look</button></div></div>
 <div class="note">Use the same look on other lines: select one line, set it, then press <b>Apply to all ${esc(kindPlural(s.kind))}</b>.</div>
 <button class="ib" id="sLookAll" ${ed} style="margin-top:6px">Apply to all ${esc(kindPlural(s.kind))}</button></div>`;
}
function endBlockOpts(sel) {
  return DOC.blocks
    .filter(b => !EQ[b.type].widget && ports(b).length)
    .map(b => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${esc(b.name)}</option>`)
    .join('');
}
function endPortOpts(s, end) {
  const b = B(s[end].b);
  if (!b) return '';
  return ports(b)
    .filter(p => (end === 'from' ? p.dir !== 'in' : p.dir !== 'out'))
    .map(
      p =>
        `<option value="${p.id}" ${p.id === s[end].p ? 'selected' : ''}>${p.id} · ${KIND[p.kind].n.split(' /')[0]}</option>`,
    )
    .join('');
}
function setEnd(s, end, bid, pid) {
  const other = end === 'from' ? s.to : s.from;
  const b = B(bid);
  if (!b) return;
  if (!pid) {
    const ok = ports(b).filter(
      p =>
        (end === 'from' ? p.dir !== 'in' : p.dir !== 'out') && !canConnectEx(s, bid, p.id, other.b, other.p),
    );
    if (!ok.length) {
      toast(`${b.name} has no compatible ${end === 'from' ? 'outlet' : 'inlet'}`);
      renderProps();
      return;
    }
    pid = (ok.find(p => !portLinks(bid, p.id).length) || ok[0]).id;
  }
  const err = canConnectEx(s, bid, pid, other.b, other.p);
  if (err) {
    toast(err);
    renderProps();
    return;
  }
  pushUndo();
  s[end] = { b: bid, p: pid };
  s.mid = null;
  logEv(`${s.name} ${end === 'from' ? 'start' : 'end'} moved to ${b.name} · ${pid}`);
  changed();
}
function canConnectEx(s, a, ap, b, bp) {
  const keep = DOC.streams;
  DOC.streams = keep.filter(x => x !== s);
  const e = canConnect(a, ap, b, bp);
  DOC.streams = keep;
  return e;
}
function reverseStream(s) {
  if (!s) return;
  const fp = portOf(B(s.from.b), s.from.p),
    tp = portOf(B(s.to.b), s.to.p);
  // v7.2: data / network links work both ways (SCADA reads from equipment and sends commands to it) — any data line
  // can change direction; material lines keep the one-way rule of their ports
  const isData = s.kind === 'data' || fp?.kind === 'data' || tp?.kind === 'data';
  if (!isData && (fp.dir === 'out' || tp.dir === 'in')) {
    toast('These ports only flow one way. Move the ends to other ports instead.');
    return false;
  }
  pushUndo();
  [s.from, s.to] = [s.to, s.from];
  s.mid = null;
  logEv(`Reversed ${s.name}`);
  changed();
  return true;
}
function bindStreamProps(s) {
  const nm = $('#props .nm');
  nm.onchange = () => {
    const n = nm.value.trim();
    if (!n) return;
    pushUndo();
    s.name = n;
    changed();
  };
  $('#sKind').onchange = e => {
    pushUndo();
    s.kind = e.target.value;
    changed();
  };
  // line appearance
  $$('[data-sym]').forEach(
    b =>
      (b.onclick = () => {
        pushUndo();
        s[b.dataset.sym] = b.dataset.v;
        changed();
      }),
  );
  const setLook = (k, v) => {
    pushUndo();
    s[k] = v;
    changed();
  };
  $('#sDash') && ($('#sDash').onchange = e => setLook('dash', e.target.value));
  $('#sAnim') &&
    ($('#sAnim').onchange = e => {
      pushUndo();
      if (e.target.value === 'inherit') delete s.anim;
      else s.anim = e.target.value;
      changed();
    });
  $('#sWid') && ($('#sWid').onchange = e => setLook('width', +e.target.value));
  $('#sCol') && ($('#sCol').onchange = e => setLook('color', e.target.value));
  $('#sLookReset') &&
    ($('#sLookReset').onclick = () => {
      pushUndo();
      ['startSym', 'endSym', 'dash', 'width', 'color', 'anim'].forEach(k => delete s[k]);
      changed();
    });
  $('#sLookAll') &&
    ($('#sLookAll').onclick = () => {
      pushUndo();
      let n = 0;
      DOC.streams.forEach(o => {
        if (o.kind !== s.kind || o === s) return;
        ['startSym', 'endSym', 'dash', 'width', 'color', 'anim'].forEach(k => (s[k] == null ? delete o[k] : (o[k] = s[k])));
        n++;
      });
      changed();
      toast(`Same look applied to ${n} other ${kindPlural(s.kind, n === 1)}`);
    });
  $('#sTag').onchange = e => {
    pushUndo();
    s.tag = e.target.value || null;
    changed();
  };
  $('#sDel').onclick = delSel;
  const dz = MODE !== 'design';
  ['#sFb', '#sFp', '#sTb', '#sTp'].forEach(x => ($(x).disabled = dz));
  $('#sFb').onchange = e => setEnd(s, 'from', e.target.value, null);
  $('#sTb').onchange = e => setEnd(s, 'to', e.target.value, null);
  $('#sFp').onchange = e => setEnd(s, 'from', s.from.b, e.target.value);
  $('#sTp').onchange = e => setEnd(s, 'to', s.to.b, e.target.value);
  $('#sRev').onclick = () => reverseLine(s);
  $('#sRoute').onclick = () => resetRoute(s); // v3.7: clears bend points too
  if ($('#sRouteMode')) $('#sRouteMode').onchange = e => setRoute(s, e.target.value);
}
function completeness() {
  const req = [],
    untag = [];
  DOC.blocks.forEach(b => {
    const E = EQ[b.type];
    ports(b).forEach(p => {
      if (p.req && !portLinks(b.id, p.id).length) req.push({ b, p });
    });
    if (!E.widget && !E.notag && !b.tags.length) untag.push(b);
  });
  return { req, untag };
}
function flowsheetProps() {
  const c = completeness(),
    g = [];
  if (!DOC.blocks.length) g.push('Drag equipment from the library onto the canvas.');
  c.req
    .slice(0, 8)
    .forEach(x =>
      g.push(
        `Connect required port <b>${x.p.id}</b> on <button data-gb="${x.b.id}">${esc(x.b.name)}</button>.`,
      ),
    );
  if (c.req.length > 8) g.push(`…and ${c.req.length - 8} more required ports.`);
  c.untag
    .slice(0, 6)
    .forEach(b => g.push(`Bind a tag to <button data-gb="${b.id}">${esc(b.name)}</button>.`));
  {
    const un = Object.values(REG).filter(t => !t.cfg && tagOwner(t.id)).length;
    if (un)
      g.push(
        `${un} tag(s) still use default limits — <button data-tlim="1">confirm Min / Optimal / Max / σ</button>.`,
      );
  }
  return `<div class="ph"><div style="font-weight:700;font-size:15px">Flowsheet</div><small>Nothing selected</small></div>
 <div class="sec"><div class="kv"><span>Equipment &amp; instruments</span><b>${DOC.blocks.filter(b => !EQ[b.type].widget).length}</b></div><div class="kv"><span>HMI widgets</span><b>${DOC.blocks.filter(b => EQ[b.type].widget).length}</b></div><div class="kv"><span>Streams</span><b>${DOC.streams.length}</b></div><div class="kv"><span>Tags</span><b>${Object.keys(REG).length}</b></div></div>
 <div class="sec"><h5>${g.length ? 'Next steps' : 'Flowsheet complete'}</h5>${g.length ? `<ol class="guide" style="padding-left:18px;margin:0">${g.map(x => `<li>${x}</li>`).join('')}</ol>` : '<div class="note">All required ports are connected and every equipment has tags. Switch to Simulate or Publish to run it live.</div>'}</div>
 <div class="sec"><h5>Building tips</h5><ul class="note" style="padding-left:16px;margin:0"><li>Drag between ports to draw a line. Ports accept several lines, so one outlet can feed many inlets.</li><li>Use a Junction to branch or route a line.</li><li>Select a conveyor and drag its blue corner to change length; R rotates, H flips.</li><li>Drag the white handle on a selected line to re-route it.</li><li>Plain mouse wheel or trackpad scrolls the canvas; Ctrl + wheel zooms.</li></ul></div>`;
}

/* ===== Dock ===== */
let lastDock = '';
function renderDock(force) {
  const D = $('#dbody'),
    ctl = $('#dockCtl'),
    al = Object.values(ALERTS);
  $('#cAl').textContent = al.filter(a => a.active).length;
  $('#cTg').textContent = Object.keys(REG).length;
  $('#cSt').textContent = DOC.streams.length;
  const key =
    DTAB +
    ALV +
    AFILT +
    (DTAB === 'events' ? EVENTS.length : '') +
    (DTAB === 'tags' || DTAB === 'streams'
      ? [Object.keys(REG).length, DOC.streams.length, DOC.blocks.length].join()
      : '');
  if (!force && key === lastDock) {
    liveText();
    return;
  }
  lastDock = key;
  if (DTAB === 'alerts') {
    ctl.innerHTML =
      [-1, 3, 2, 1]
        .map(
          s =>
            `<button class="fchip ${AFILT === s ? 'on' : ''}" data-f="${s}">${s < 0 ? 'All' : SEVN[s]}</button>`,
        )
        .join('') + `<button class="sb" id="bAckAll">Acknowledge all</button>`;
    D.innerHTML = alertTable(al);
    $$('#dockCtl [data-f]').forEach(
      x =>
        (x.onclick = () => {
          AFILT = +x.dataset.f;
          renderDock(true);
        }),
    );
    $('#bAckAll').onclick = ackAll;
    bindAlertTable(D);
  } else if (DTAB === 'events') {
    ctl.innerHTML = '';
    D.innerHTML = `<table><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody>${
      EVENTS.length
        ? EVENTS.slice(0, 200)
            .map(
              e =>
                `<tr><td class="mono">${hms(e.t)}</td><td class="${e.sev ? 'tx' + e.sev : ''}">${esc(e.msg)}</td></tr>`,
            )
            .join('')
        : '<tr><td colspan="2" class="note">No events yet.</td></tr>'
    }</tbody></table>`;
  } else if (DTAB === 'tags') {
    ctl.innerHTML = `<button class="sb" id="bTagNew">＋ New tag</button><button class="sb" id="bTagLimAll">Edit limits</button><button class="sb" id="bTagExp">Export CSV</button><button class="sb" id="bTagCsv">Import CSV</button>`;
    D.innerHTML = `<table><thead><tr><th>Tag</th><th>Description</th><th>Value</th><th>Severity</th><th>Data link</th><th>Source</th><th>Address</th><th>Min · Opt · Max</th><th>σ</th><th>Limits</th><th>LL / L / H / HH</th><th>Bound to</th><th></th></tr></thead><tbody>${Object.values(
      REG,
    )
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(t => {
        const o = tagOwner(t.id);
        return `<tr><td class="mono"><b>${esc(t.id)}</b></td><td>${esc(t.desc)}</td><td class="num mono" data-live="${esc(t.id)}">${fmtT(t.id)}</td><td><span class="chip sv${tagSev(t.id)}" data-sevchip="${esc(t.id)}">${SEVN[tagSev(t.id)]}</span></td><td>${t.link ? '<span class="chip sv0">Linked</span>' : '<span class="chip" style="background:#94a3b8">Simulated</span>'} <button class="lb" data-tl="${esc(t.id)}">${t.link ? 'Edit' : 'Link'}</button></td><td>${esc(t.src)}</td><td class="mono">${esc(t.addr)}</td><td class="mono">${(sp => `${sp.min != null ? fmtN(sp.min, t.d) : '—'} · ${fmtN(sp.opt, t.d)} · ${sp.max != null ? fmtN(sp.max, t.d) : '—'}`)(spec(t))}</td><td class="mono">${fmtN(spec(t).sd, (t.d || 0) + 2)}</td><td>${specIssues(t).length ? '<span class="chip sv3">Check</span>' : t.cfg ? '<span class="chip sv0">Confirmed</span>' : '<span class="chip sv1">Default</span>'}</td><td class="mono">${[t.ll, t.lo, t.hi, t.hh].map(x => (x == null ? '–' : fmtN(x, t.d))).join(' / ')}</td><td>${o ? esc(o.b ? o.b.name : o.s.name) : '<span class="note">unbound</span>'}</td><td><button class="lb" data-tt="${esc(t.id)}">Trend</button><button class="lb" data-te="${esc(t.id)}">Edit</button>${o ? '' : `<button class="lb" data-td="${esc(t.id)}" style="color:var(--crit)">Delete</button>`}</td></tr>`;
      })
      .join('')}</tbody></table>`;
    $$('#dbody [data-tl]').forEach(
      x =>
        (x.onclick = () => {
          const o = tagOwner(x.dataset.tl);
          linkWizard(o && o.b ? o.b.id : null, o && o.b ? null : [x.dataset.tl]);
        }),
    );
    $('#bTagNew').onclick = () => tagForm(null, null);
    $('#bTagCsv').onclick = csvForm;
    $('#bTagExp').onclick = csvExportForm;
    $('#bTagLimAll').onclick = () => tagLimitsForm(null);
    $$('#dbody [data-tt]').forEach(x => (x.onclick = () => openTrend(x.dataset.tt)));
    $$('#dbody [data-te]').forEach(x => (x.onclick = () => tagForm(x.dataset.te, null)));
    $$('#dbody [data-td]').forEach(
      x =>
        (x.onclick = () => {
          pushUndo();
          delete REG[x.dataset.td];
          logEv('Deleted tag ' + x.dataset.td);
          changed();
        }),
    );
  } else {
    ctl.innerHTML = '';
    D.innerHTML = `<table><thead><tr><th>Stream</th><th>Line type</th><th>From</th><th>To</th><th>Tag</th><th>Value</th><th></th></tr></thead><tbody>${DOC.streams.length ? DOC.streams.map(s => `<tr><td><b>${esc(s.name)}</b></td><td><i style="display:inline-block;width:14px;height:3px;background:${KIND[s.kind].c};vertical-align:middle;margin-right:5px"></i>${KIND[s.kind].n}</td><td>${esc(B(s.from.b)?.name)} · ${s.from.p}</td><td>${esc(B(s.to.b)?.name)} · ${s.to.p}</td><td class="mono">${esc(s.tag || '—')}</td><td class="num mono" ${s.tag ? `data-live="${esc(s.tag)}"` : ''}>${s.tag ? fmtT(s.tag) : ''}</td><td><button class="lb" data-sst="${s.id}">Select</button>${MODE === 'design' ? `<button class="lb" data-rst="${s.id}">Reverse</button><button class="lb" data-dst="${s.id}" style="color:var(--crit)">Delete</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="note">No streams. In Design mode press C, click the source, then the destination.</td></tr>'}</tbody></table>`;
    $$('#dbody [data-sst]').forEach(
      x =>
        (x.onclick = () => {
          select({ t: 's', id: x.dataset.sst });
          const G = streamGeom(Sx(x.dataset.sst));
          if (G) {
            const m = G.pts[Math.floor(G.pts.length / 2)],
              c = $('#cwrap').getBoundingClientRect();
            VIEW.tx = c.width / 2 - m.x * VIEW.k;
            VIEW.ty = c.height / 2 - m.y * VIEW.k;
            applyView();
          }
        }),
    );
    $$('#dbody [data-rst]').forEach(x => (x.onclick = () => reverseStream(Sx(x.dataset.rst))));
    $$('#dbody [data-dst]').forEach(
      x =>
        (x.onclick = () => {
          pushUndo();
          const st = Sx(x.dataset.dst);
          DOC.streams = DOC.streams.filter(y => y !== st);
          logEv(`Deleted stream ${st.name}`);
          changed();
        }),
    );
  }
}
function alertTable(al) {
  const list = al
    .filter(a => AFILT < 0 || a.sev === AFILT)
    .sort((a, b) => b.active - a.active || a.acked - b.acked || b.sev - a.sev || b.t - a.t);
  return `<table><thead><tr><th>Severity</th><th>Time</th><th>Equipment</th><th>Tag</th><th>Message</th><th>Value</th><th>State</th><th></th></tr></thead><tbody>${list.length ? list.map(a => `<tr class="${a.acked ? '' : 'unack'} ${a.active ? '' : 'rtn'}"><td><span class="chip sv${a.sev}">${SEVN[a.sev]}</span></td><td class="mono">${hms(a.t)}</td><td><b>${esc(a.where)}</b></td><td class="mono">${esc(a.tagId || '')}</td><td>${esc(a.msg)}</td><td class="num mono" ${a.tagId ? `data-live="${esc(a.tagId)}"` : ''}>${a.tagId ? fmtT(a.tagId) : ''}</td><td>${a.active ? (a.acked ? 'Active · ack' : 'Active · unack') : 'Returned · unack'}</td><td>${a.acked ? '' : `<button class="sb" data-ack="${esc(a.key)}">Ack</button>`} ${a.blk ? `<button class="lb" data-loc="${a.blk}">Locate</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="8" class="note" style="padding:14px">No alerts. Switch to Simulate mode and use “Simulate disturbance”, or stop equipment from a control panel.</td></tr>`}</tbody></table>`;
}
function bindAlertTable(root) {
  root.querySelectorAll('[data-ack]').forEach(
    x =>
      (x.onclick = () => {
        ack(x.dataset.ack);
        if (root.id === 'ovl') renderOvl();
      }),
  );
  root.querySelectorAll('[data-loc]').forEach(
    x =>
      (x.onclick = () => {
        const b = B(x.dataset.loc);
        if (b) {
          select({ t: 'b', id: b.id });
          center(b);
        }
      }),
  );
}
function liveText() {
  $$('[data-live]').forEach(el => {
    const t = el.dataset.live;
    if (REG[t]) el.textContent = fmtT(t);
  });
  $$('[data-sevbar]').forEach(el => (el.style.background = sevC(tagSev(el.dataset.sevbar))));
  $$('[data-sevchip]').forEach(el => {
    const s = tagSev(el.dataset.sevchip);
    el.className = 'chip sv' + s;
    el.textContent = SEVN[s];
  });
  $$('[data-stp]').forEach(el => {
    const b = B(el.dataset.stp);
    if (!b) return;
    const st = bState(b);
    if (!st) return;
    el.textContent = st;
    el.style.background = STC[st];
  });
  $$('[data-bsevt]').forEach(el => {
    const b = B(el.dataset.bsevt);
    if (b) {
      const s = blkSev(b);
      el.textContent = SEVN[s];
      el.className = 'tx' + s;
    }
  });
}

/* ===== Header, status, present ===== */
function renderHeader() {
  try {
    const tags = Object.values(REG),
      n = tags.filter(t => t.link).length;
    $('#gwTxt').textContent =
      `${sources().length} data sources · ${n}/${tags.length} tags linked · simulated`;
  } catch (e) {}
  const a = Object.values(ALERTS).filter(x => x.active),
    n = [3, 2, 1].map(s => a.filter(x => x.sev === s).length);
  $('#sevc').innerHTML = [3, 2, 1]
    .map((s, i) => `<span class="sv${s}" title="${SEVN[s]} alerts">${n[i]}</span>`)
    .join('');
  const un = Object.values(ALERTS).filter(x => !x.acked).length,
    d = $('#railDot');
  d.style.display = un ? 'grid' : 'none';
  d.textContent = un;
  const pa = $('#pAlarm');
  const nw = a.filter(x => !x.acked).length; // v9.44: the number counts alarms still waiting for acknowledgement
  pa.textContent = `🔔 Fault alarm (${nw})`;
  pa.title = `${nw} unacknowledged · ${a.length} active in total`;
  pa.classList.toggle(
    'blink',
    Object.values(ALERTS).some(x => !x.acked && x.sev >= 2),
  );
}
function renderStatus() {
  const c = completeness(),
    m = $('#stMsg');
  let col, txt;
  if (c.req.length) {
    col = 'var(--crit)';
    txt = `Flowsheet not complete — ${c.req.length} required port${c.req.length > 1 ? 's' : ''} unconnected`;
  } else if (c.untag.length) {
    col = 'var(--warn)';
    txt = `Tag binding incomplete — ${c.untag.length} equipment without tags`;
  } else if (!DOC.blocks.length) {
    col = 'var(--muted)';
    txt = 'Empty flowsheet';
  } else {
    col = 'var(--ok)';
    txt = 'Flowsheet complete — ready to simulate';
  }
  m.querySelector('i').style.background = col;
  const sp = m.querySelector('span');
  sp.textContent = txt;
  sp.style.color = col;
  $('#stCounts').textContent =
    `${DOC.blocks.length} items · ${DOC.streams.length} streams · ${Object.keys(REG).length} tags`;
  $('#stMode').textContent = RP
    ? `TRACEABILITY · ${RP.play ? 'PLAYING' : 'PAUSED'}`
    : MODE === 'design'
      ? 'DESIGN'
      : LIVE
        ? 'SIMULATE · LIVE'
        : 'SIMULATE · PAUSED';
}
function updateHint() {
  const h = $('#hint');
  let t = '';
  if (PLACE)
    t = `Placing <b>${esc(placeName(PLACE))}</b> — click the canvas. Shift-click places several. Esc stops.`;
  else if (MODE === 'design' && !DOC.blocks.length)
    t = 'Drag equipment from the library to start your flowsheet.';
  else if (CONNMODE || CONNSRC)
    t = CONNSRC
      ? `From <b>${esc(B(CONNSRC.b)?.name)}${CONNSRC.p ? ' · ' + CONNSRC.p : ''}</b> — now click the destination equipment or port. Esc cancels.`
      : '<b>Connect tool</b> — click the source equipment (or a port), then the destination. Matching ports are chosen for you. Press C or Esc to leave.';
  else if (MODE === 'design' && SEL && SEL.t === 'b' && !PREF.right && B(SEL.id))
    t = `<b>${esc(B(SEL.id).name)}</b> selected — <b>double-click</b> it (or right-click → Properties) to edit its data connection and readings.`;
  else if (MODE === 'design')
    t =
      'Click equipment to select it · <b>double-click</b> to open its properties · press <b>C</b> to connect · right-click for options.';
  else
    t =
      'Simulate mode — START/STOP and ON/OFF buttons operate the simulated plant. Click any value for its trend.';
  h.innerHTML = t;
}
/* v1.7 — brand block: live mode line (Design mode · Simulating · Publishing) and the Flowsheet tab count */
function syncBrand() {
  const el = $('#brandMode');
  if (el) {
    const m = PRESENT ? 'publish' : MODE === 'design' ? 'design' : 'sim';
    el.className = 'mpill m-' + m; // v2.4 — option A: the mode is a pill on the right of the brand block
    el.querySelector('span').textContent = m === 'publish' ? 'Publish' : m === 'sim' ? (RP ? 'Traceability' : 'Simulating') : 'Design';
  }
  const fe = $('#fsEmpty');
  if (fe) fe.hidden = DOC.blocks.length > 0 || PRESENT;
  const tc = $('#treeCount');
  if (tc) tc.textContent = DOC.blocks.length;
}
function updateTb() {
  syncBrand();
  $('#bUndo').disabled = !UNDO.length;
  $('#bRedo').disabled = !REDO.length;
  const ed = MODE === 'design',
    bs = SEL && SEL.t === 'b' ? B(SEL.id) : null;
  $('#bDel').disabled = !ed || (!SEL && !SELM.size);
  $('#bDup').disabled = !ed || (!bs && SELM.size < 2);
  $('#bFlip').disabled = $('#bRot').disabled = !ed || !bs || EQ[bs.type].noflip;
  if ($('#bLockAll')) {
    $('#bLockAll').classList.toggle('on', !!DOC.lockAll);
    $('#bLockAll').disabled = !ed;
    $('#bLockAll').title = DOC.lockAll ? 'Unlock the layout' : 'Lock the layout so nothing is moved, resized or deleted by accident';
  }
  if ($('#bFront')) $('#bFront').disabled = $('#bBack').disabled = !ed || !selIds().length;
  if ($('#bGroup')) {
    $('#bGroup').disabled = !ed || !canGroupSel();
    $('#bUngroup').disabled = !ed || !selBlocks().some(o => o.grp);
  }
}
function renderAll() {
  if (typeof fixDataEnds === 'function' && fixDataEnds()) save(); // v7.1: data lines on material points → data point
  renderCanvas();
  renderProps();
  renderTree();
  renderDock(true);
  renderHeader();
  renderStatus();
  updateHint();
  updateTb();
  $('#docName').value = DOC.name;
}
let ACX = null;
function beep() {
  if (!SOUND || !ACX) return;
  try {
    const o = ACX.createOscillator(),
      g = ACX.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.06;
    o.connect(g);
    g.connect(ACX.destination);
    o.start();
    o.stop(ACX.currentTime + 0.18);
  } catch (e) {}
}
function setPresent(on) {
  setTimeout(syncBrand, 0);
  if (typeof afReset === 'function') afReset(); // v9.20 — Areas: start / leave with the whole loop
  PRESENT = on;
  document.body.classList.toggle('present', on);
  layoutCols();
  $('#vpop').classList.remove('on');
  closeDrawers();
  setFull(on, true);
  if (typeof PVIEW !== 'undefined') Object.assign(PVIEW, { manual: false, w: 0, h: 0 });
  if (on) {
    if (!ACX) {
      try {
        ACX = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {}
    }
    if (MODE !== 'monitor') setMode('monitor', true);
    SEL = null;
    // v8.3 — arrange the HMI panels for the screen's shape (temporary), then fit
    requestAnimationFrame(() => requestAnimationFrame(() => (presentArrange(), renderAll(), fit())));
    renderAll();
  } else {
    $('#ovl').classList.remove('on');
    if (typeof spreadRestore === 'function') {
      spreadRestore(); // back to the real layout
      renderAll();
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => fit()));
}
function renderOvl() {
  const o = $('#ovl');
  o.innerHTML =
    `<div style="display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line)"><b>Active alarms</b><button class="sb" style="margin-left:auto" id="oAck">Acknowledge all</button><button class="lb" id="oClose">Close</button></div>` +
    alertTable(Object.values(ALERTS));
  bindAlertTable(o);
  $('#oAck').onclick = () => {
    ackAll();
    renderOvl();
  };
  $('#oClose').onclick = () => o.classList.remove('on');
  // v9.19 — demo alarms (sample data only): add / clear from the alarm list itself, in any mode
  const head = o.firstElementChild,
    active = Object.values(ALERTS).some(a => a.active),
    held = Object.values(REG).some(t => t.hold != null);
  if (demoAlarmTags().length && !active && !held)
    head.querySelector('#oAck').insertAdjacentHTML('beforebegin', '<button class="sb" id="oDemo" style="margin-left:auto;margin-right:6px" title="Holds a few sample tags beyond their limits so the alarm list can be demonstrated">Add demo alarms</button>');
  if (held)
    head.querySelector('#oAck').insertAdjacentHTML('beforebegin', '<button class="sb" id="oDemoX" style="margin-left:auto;margin-right:6px" title="Returns the held sample tags to normal">Clear demo alarms</button>');
  const ack = head.querySelector('#oAck');
  if ($('#oDemo') || $('#oDemoX')) ack.style.marginLeft = '0';
  if ($('#oDemo')) $('#oDemo').onclick = () => (setDemoAlarms(true), renderOvl());
  if ($('#oDemoX')) $('#oDemoX').onclick = () => (setDemoAlarms(false), renderOvl());
}
/* v9.19 — which sample tags make a good set of demo alarms: the DemoLoop set when present, otherwise one critical,
   two warnings and one advisory on different equipment (sample data only — never real data sources) */
function demoAlarmTags() {
  const own = {};
  DOC.blocks.forEach(b => b.tags.forEach(t => (own[t.id] = own[t.id] || b)));
  const demo = id => REG[id] && own[id] && /sample|demo/i.test(REG[id].src || '') && !REG[id].cyc && !REG[id].states;
  const known = { COOLER_INLET_TEMP_C: 101.2, MULLER_MOISTURE_PCT: 3.92, ML2_GCS_KPA: 124, SHAKEOUT3_VIBRATION_MM_S: 10.6 };
  if (Object.keys(known).every(demo)) return Object.entries(known).map(([id, v]) => ({ id, v }));
  const out = [], used = new Set(), pick = (f, mk) => {
    const id = Object.keys(REG).find(i => demo(i) && !used.has(own[i].id) && !out.some(o => o.id === i) && f(REG[i]));
    if (id) { used.add(own[id].id); out.push({ id, v: mk(REG[id]) }); }
  };
  pick(t => t.hh != null && t.hh > t.typ, t => t.hh + Math.max(Math.abs(t.hh - t.typ) * 0.04, 10 ** -(t.d || 0)));
  pick(t => t.hi != null && t.hi > t.typ, t => t.hi + Math.max(Math.abs(t.hi - t.typ) * 0.06, 10 ** -(t.d || 0)));
  pick(t => t.lo != null && t.lo < t.typ, t => t.lo - Math.max(Math.abs(t.typ - t.lo) * 0.12, 10 ** -(t.d || 0)));
  pick(t => t.hi != null && t.hi > t.typ, t => t.typ + (t.hi - t.typ) * 0.86);
  return out;
}
function setDemoAlarms(on) {
  pushUndo();
  if (on)
    demoAlarmTags().forEach(({ id, v }) => {
      const t = REG[id];
      t.hold = Math.round(v * 10 ** ((t.d || 0) + 1)) / 10 ** ((t.d || 0) + 1);
      t.noise = Math.min(t.noise || 0, Math.abs(t.hold) * 0.002);
      ensureVal(id);
      VAL[id].x = VAL[id].v = t.hold;
      ALST['lim:' + id] = { since: Date.now() - ALCFG.onDelay - 1 }; // demo alarms show at once (no on-delay)
    });
  else
    Object.values(REG).forEach(t => {
      if (t.hold == null) return;
      delete t.hold;
      ensureVal(t.id, true);
    });
  evalAlerts();
  changed();
  toast(on ? 'Demo alarms added (sample data held beyond limits)' : 'Demo alarms cleared — values back to normal');
}
