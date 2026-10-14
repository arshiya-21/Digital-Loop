/*! SandMan Process Flowsheet — 15-inspector.js
 *  v2.0 — Loop Studio workflow in the Flowsheet: selecting equipment shows ONE context panel with
 *  Equipment (info + properties) → Data connection (source, data tag, map, test) → Readings (one card per
 *  tag: data, name & units, limits, canvas) → More settings. Classic script; shares the global scope. */

/* ---------- data-connection helpers ---------- */
const FAM_HINT = {
  node: ['ns=2;s=', 'e.g. ns=2;s=Line1.CM-1', '.'],
  topic: ['', 'e.g. plant/line1/CM-1', '/'],
  sql: ['', 'e.g. SandMan_Prod.MixerLog', '.'],
  ts: ['', 'e.g. sandman/mixer', '.'],
  reg: ['', 'e.g. 40001', ''],
  api: ['', 'e.g. /api/tags/CM-1', '/'],
};
function famOf(srcId) {
  const s = srcId && SRC(srcId);
  return s ? SRC_TYPES[s.type]?.fam || 'api' : null;
}
/** the part of a tag id after the equipment name, e.g. CM-1.CUR → CUR */
function tagKey(id) {
  const i = id.lastIndexOf('.');
  return i >= 0 ? id.slice(i + 1) : id;
}
/** link a tag to a source with one address string (the Loop Studio "data tag") */
function setTagLink(t, srcId, addr) {
  addr = (addr || '').trim();
  if (!srcId) {
    delete t.link;
    t.src = 'Simulated';
    if (addr) t.addr = addr;
    return;
  }
  const s = SRC(srcId),
    fam = famOf(srcId);
  let L = { src: srcId, db: '', table: '', col: addr };
  if (fam === 'sql' || fam === 'ts') {
    const p = addr.split('.');
    if (p.length >= 3) L = { src: srcId, db: p[0], table: p.slice(1, -1).join('.'), col: p[p.length - 1] };
    else if (p.length === 2) L = { src: srcId, db: s.db || '', table: p[0], col: p[1] };
  } else if (fam === 'topic') {
    const p = addr.split('/');
    L = { src: srcId, db: p[0] || '', table: p.slice(1, -1).join('/'), col: p[p.length - 1] || '' };
  }
  t.link = L;
  t.addr = addr;
  t.src = s?.name || t.src;
}
function tagAddr(t) {
  return t.addr || (t.link ? t.link.col : '');
}
function tagSrcId(t) {
  return t.link ? t.link.src : '';
}
function eqSource(b) {
  return b.props.src || '';
}
function srcOptions(cur, withInherit, inheritLabel) {
  return (
    (withInherit ? `<option value="__eq" ${cur === '__eq' ? 'selected' : ''}>${esc(inheritLabel)}</option>` : '') +
    `<option value="" ${cur === '' ? 'selected' : ''}>Simulated (demo values)</option>` +
    (typeof CUSTOMER !== 'undefined' ? `<option value="customer" ${cur === 'customer' ? 'selected' : ''}>★ Customer default · ${esc(CUSTOMER.defaultDb.db)}</option>` : '') + // v4.9
    sources()
      .map(s => `<option value="${s.id}" ${cur === s.id ? 'selected' : ''}>${SRC_TYPES[s.type]?.icon || '🔌'} ${esc(s.name)} · ${esc(SRC_TYPES[s.type]?.n || s.type)}</option>`)
      .join('') +
    '<option value="__manage">Add or manage data sources…</option>'
  );
}
function chipFor(t) {
  if (!t.link) return '<span class="ix-chip demo">Demo</span>';
  const s = SRC(t.link.src);
  return s ? `<span class="ix-chip live"><i></i>Linked</span>` : '<span class="ix-chip err">Source removed</span>';
}

/* ---------- the panel ---------- */
let IXOPEN = null, // which reading card is open
  IXPOS = false; // position & size section open
function eqInspector(b) {
  const E = EQ[b.type],
    ed = MODE === 'design' && !RP ? '' : 'disabled',
    d = dims(b),
    tags = b.tags.map(bt => ({ bt, t: REG[bt.id] })).filter(x => x.t),
    linked = tags.filter(x => x.t.link).length,
    src = eqSource(b),
    fam = famOf(src),
    hint = FAM_HINT[fam] || ['', 'e.g. plant.mixer_01', '.'];
  if (IXOPEN && !tags.some(x => x.t.id === IXOPEN)) IXOPEN = null;
  const rot = b.rot || 0;
  return `<div class="ix">
<section class="ix-sec"><h4>Equipment</h4>
 <div class="ix-preview">${palIcon(b.type)}</div>
 <label class="ix-f">Equipment tag<input id="ixName" value="${esc(b.name)}" ${ed} spellcheck="false"></label>
 <label class="ix-f">Description<input id="ixDesc" value="${esc(b.props.desc || '')}" placeholder="Purpose, location, asset number" ${ed}></label>
 <label class="ix-c"><input type="checkbox" id="ixShow" ${b.props.hideName ? '' : 'checked'} ${ed}> Show name on the canvas</label>${E.smlib && typeof SMLIB_PAINTABLE !== 'undefined' && SMLIB_PAINTABLE.has(smlibIdOf(E.def)) ? `<label class="ix-f">Paint colour<select id="ixPaint" ${ed}><option value="" ${!('paint' in b.props ? b.props.paint : E.def.paint) ? 'selected' : ''}>Original</option>${Object.entries(SMLIB_PAINTS).map(([k, P]) => `<option value="${k}" ${('paint' in b.props ? b.props.paint : E.def.paint) === k ? 'selected' : ''}>${P.n}</option>`).join('')}</select></label>` : ''}${E.smlib && typeof DL_PAINT !== 'undefined' && DL_PAINT[smlibIdOf(E.def)] ? (() => { const P = DL_PAINT[smlibIdOf(E.def)], cur = dlPaintOf(smlibIdOf(E.def), 'paint' in b.props ? b.props.paint : E.def.paint); return `<label class="ix-f">Colour<select id="ixPaint" ${ed}>${Object.keys(P).map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${DL_CNAME[k] || k}</option>`).join('')}</select></label>`; })() : ''}${E.smlib && typeof smlibHasOwn === 'function' && smlibHasOwn(b.type) ? `<label class="ix-f">Colour style<select id="ixPal" ${ed}><option value="" ${!b.props.smpal ? 'selected' : ''}>Library setting (${esc(SMLIB_PALS.find(x => x[0] === SMPAL)[1])})</option>${SMLIB_PALS.map(([k, n]) => `<option value="${k}" ${b.props.smpal === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
 <details class="ix-pos" ${IXPOS ? 'open' : ''}><summary>Position, size and rotation <span>${Math.round(b.x)}, ${Math.round(b.y)} · ${Math.round(d.W)} × ${Math.round(d.H)}${rot ? ` · ${rot}°` : ''}</span></summary>
 <div class="ix-2"><label class="ix-f">X position<input type="number" id="ixX" value="${Math.round(b.x)}" ${ed}></label><label class="ix-f">Y position<input type="number" id="ixY" value="${Math.round(b.y)}" ${ed}></label></div>
 <div class="ix-2"><label class="ix-f">Width<input type="number" id="ixW" value="${Math.round(d.W)}" min="8" ${ed}></label><label class="ix-f">Height<input type="number" id="ixH" value="${Math.round(d.H)}" min="8" ${ed}></label></div>
 <div class="ix-2"><label class="ix-f">Rotation (°)<select id="ixRot" ${ed || (E.noflip ? 'disabled' : '')}>${[0, 90, 180, 270].map(r => `<option ${r === rot ? 'selected' : ''}>${r}</option>`).join('')}</select></label><label class="ix-f">&nbsp;<button class="ib" id="ixFlip" ${ed || (E.noflip ? 'disabled' : '')}>⇋ Flip</button></label></div>
 <label class="ix-c"><input type="checkbox" id="ixLock" ${b.lock ? 'checked' : ''} ${ed}> Lock position</label></details>
 ${typeof followCapable === 'function' && followCapable(b) ? `<label class="ix-c" title="When everything feeding it has stopped, it runs on for the run-out time and then waits (Idle — no feed); it starts again with its feed"><input type="checkbox" id="ixFollow" ${b.props.follow !== false ? 'checked' : ''}> Follows its feed (idles when its feed stops)</label>${b.props.follow !== false ? `<label class="ix-f">Run-out before idling<select id="ixRunout">${[0, 5, 10, 20, 30, 60, 120].map(s => `<option value="${s}" ${(b.props.runout ?? 10) === s ? 'selected' : ''}>${s ? s + ' s' : 'none'}</option>`).join('')}</select></label>` : ''}` : ''}
 <div class="ix-acts">${typeof rpIsEquipment === 'function' && rpIsEquipment(b) ? `<button class="ib" id="ixRep" ${ed} title="Replace this equipment with another drawing (keeps name, readings and connections)">Replace…</button>` : ''}<button class="ib" id="ixDup" ${ed}>Duplicate</button><button class="ib ix-del" id="ixDel" ${ed}>Delete</button></div>
</section>
${typeof collectedHTML === 'function' ? collectedHTML(b) : ''}
${b.grp && typeof grpInfo === 'function' ? (() => {
   const gi = grpInfo(b.grp),
     ord = grpOrder(b.grp);
   return `<section class="ix-sec ix-gctl"><h4>Group <span class="ix-sum">${ord.length} items</span></h4>
 <label class="ix-f">Group name<input id="ixGName" value="${esc(gi.name || '')}" placeholder="e.g. DISA-1 line"></label>
 <label class="ix-c"><input type="checkbox" id="ixGCtl" ${gi.ctl ? 'checked' : ''}> Start / stop together</label>
 ${gi.ctl ? `<label class="ix-f">Delay between steps<select id="ixGDelay">${[0, 1, 2, 3, 5, 10].map(s => `<option value="${s}" ${(gi.delay ?? 2) === s ? 'selected' : ''}>${s ? s + ' s' : 'none'}</option>`).join('')}</select></label>
 <div class="ix-seq"><b>Stop</b> front to back: ${ord.map(o => esc(o.name)).join(' → ')}<br><b>Start</b> back to front: ${ord.slice().reverse().map(o => esc(o.name)).join(' → ')}</div>
 <p class="ix-hint">Stopping or starting any member (HMI button, Properties, right-click) runs the whole group in this order. A fault on a member stops everything feeding it in the group.</p>
 <div class="ix-acts"><button class="ib" id="ixGStop">Stop group</button><button class="ib" id="ixGStart">Start group</button></div>` : '<p class="ix-hint">Items in this group move together. Turn on “Start / stop together” to run them as one line.</p>'}
</section>`;
 })() : ''}
${
  E.widget
    ? ''
    : `<section class="ix-sec"><h4>Data connection <span class="ix-sum">${linked} of ${tags.length} reading${tags.length === 1 ? '' : 's'} linked</span></h4>
 <h5 class="ix-sub">Tags from a database</h5>
 ${typeof dbBlockHTML === 'function' ? dbBlockHTML(b, ed) : ''}
 <h5 class="ix-sub">Live source for the whole equipment</h5>
 <label class="ix-f">Source<select id="ixSrc" ${ed}>${srcOptions(src)}</select></label>
 ${
   src
     ? `<label class="ix-f">Equipment data tag<input id="ixDtag" class="mono" value="${esc(b.props.dtag || '')}" placeholder="${esc(hint[1])}" ${ed} spellcheck="false"></label>
 <div class="ix-acts"><button class="ib pri" id="ixMap" ${ed} title="Fill every reading's data tag from the equipment data tag and link it to this source">Map readings</button><button class="ib" id="ixTest">Test connection</button><button class="ib" id="ixBrowse" ${ed} title="Pick tables, nodes or topics from the source">Browse…</button></div>
 <p class="ix-status" id="ixStat">${linked ? `● ${linked} reading${linked === 1 ? ' takes' : 's take'} live values from ${esc(SRC(src)?.name || 'the source')}.` : 'Set the equipment data tag, then press <b>Map readings</b>.'}</p>`
     : `<p class="ix-hint">Values are simulated (demo). Choose a source to connect this equipment to the plant — PLC gateway, OPC UA, MQTT, Modbus, SQL or REST.</p>`
 }
</section>
<section class="ix-sec"><h4>Readings <span class="ix-sum">${tags.length}</span>${ed ? '' : '<button class="ix-link" id="ixAddBtn">＋ Add reading</button>'}</h4>
 <div class="ix-add" id="ixAdd" hidden><input type="search" id="ixQ" placeholder="Search tags by name or description" autocomplete="off"><div class="ix-dd" id="ixDD"></div><button class="ib" id="ixNew">＋ Create a new tag</button></div>
 ${tags.length ? tags.map(({ bt, t }, i) => readingCard(b, bt, t, i, ed)).join('') : '<p class="ix-hint">No readings yet. Add one to show a live value next to this equipment.</p>'}
</section>`
}
<section class="ix-sec ix-more"><h4>More settings</h4>
 ${E.widget ? '' : `<button class="ix-row" data-goto="gen"><b>Connections &amp; inventory</b><span>Ports, lines, sand inventory, traceability stage</span></button>`}
 ${E.widget ? '' : `<button class="ix-row" data-goto="alerts"><b>Alert rules</b><span>Rules and actions for this equipment</span></button>`}
 ${traceKind(b) ? `<button class="ix-row" data-goto="trace"><b>Traceability</b><span>Sand batches and castings</span></button>` : ''}
 ${b.tags.some(t => REG[t.id]?.role === 'bent') ? `<button class="ix-row" data-goto="presc"><b>Prescription</b><span>Additive dosing</span></button>` : ''}
</section></div>`;
}
function readingCard(b, bt, t, i, ed) {
  const v = typeof val === 'function' ? val(t.id) : null,
    own = bt.own || (t.link && t.link.src !== eqSource(b)) || (!t.link && eqSource(b)),
    cur = bt.own ? tagSrcId(t) : '__eq',
    fam = famOf(tagSrcId(t)),
    hint = FAM_HINT[fam] || ['', 'e.g. CM-1.CUR', '.'];
  const open = IXOPEN === t.id;
  return `<details class="ix-card" data-tid="${esc(t.id)}" data-i="${i}" ${open ? 'open' : ''}>
<summary><span class="ix-sev" style="background:${sevC(tagSev(t.id))}"></span><span class="ix-nm"><b>${esc(t.desc || t.id)}</b><small class="mono">${esc(t.id)}</small></span><span class="ix-val">${v == null ? '—' : fmtN(v, t.d)}<small>${esc(t.unit || '')}</small></span>${chipFor(t)}</summary>
<div class="ix-body">
 <div class="ix-grp"><h5>Data</h5>
  <label class="ix-f">Source<select data-ix="src" ${ed}>${srcOptions(cur, true, `Same as equipment (${eqSource(b) ? SRC(eqSource(b))?.name || '—' : 'Simulated'})`)}</select></label>
  <label class="ix-f">Data tag<input data-ix="addr" class="mono" value="${esc(tagAddr(t))}" placeholder="${esc(hint[1])}" ${ed} spellcheck="false"></label>
  ${t.link ? `<p class="ix-status">● Live from ${esc(SRC(t.link.src)?.name || 'a removed source')}</p>` : `<label class="ix-f">Demo value (optimal)<input type="number" step="any" data-ix="typ" value="${t.typ ?? ''}" ${ed}></label>`}
 </div>
 <div class="ix-grp"><h5>Name and units</h5>
  <label class="ix-f">Parameter<input data-ix="desc" value="${esc(t.desc || '')}" ${ed}></label>
  <div class="ix-2"><label class="ix-f">Unit<input data-ix="unit" value="${esc(t.unit || '')}" ${ed}></label><label class="ix-f">Decimals<select data-ix="d" ${ed}>${[0, 1, 2, 3].map(x => `<option ${x === (t.d ?? 1) ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
 </div>
 <div class="ix-grp"><h5>Limits</h5>
  <div class="ix-4"><label class="ix-f">Low-low<input type="number" step="any" data-ix="ll" value="${t.ll ?? ''}" placeholder="—" ${ed}></label><label class="ix-f">Low<input type="number" step="any" data-ix="lo" value="${t.lo ?? ''}" placeholder="—" ${ed}></label><label class="ix-f">High<input type="number" step="any" data-ix="hi" value="${t.hi ?? ''}" placeholder="—" ${ed}></label><label class="ix-f">High-high<input type="number" step="any" data-ix="hh" value="${t.hh ?? ''}" placeholder="—" ${ed}></label></div>
  <p class="ix-hint">Outside Low–High the value turns amber; outside Low-low / High-high it raises an alarm.</p>
 </div>
 <div class="ix-grp"><h5>On the canvas</h5>
  <label class="ix-c"><input type="checkbox" data-ix="show" ${bt.show ? 'checked' : ''} ${ed}> Show this value next to the equipment</label>
  <div class="ix-acts"><button class="ib" data-ixa="trend">↗ Trend</button><button class="ib" data-ixa="full" ${ed}>All tag settings…</button><button class="ib ix-del" data-ixa="rm" ${ed}>Remove</button></div>
 </div>
</div></details>`;
}

/* ---------- behaviour ---------- */
function bindEqInspector(b) {
  const root = $('#ptab');
  if (!root) return;
  const E = EQ[b.type];
  const on = (sel, ev, fn) => {
    const el = root.querySelector(sel);
    if (el) el[ev] = fn;
  };
  const edit = fn => {
    pushUndo();
    fn();
    changed();
  };
  if (typeof dbWire === 'function') dbWire(root, b); // v4.2 Database → Table → Tag +
  // v6.1 follow the feed / group control
  on('#ixFollow', 'onchange', e => edit(() => (e.target.checked ? delete b.props.follow : (b.props.follow = false))));
  on('#ixRunout', 'onchange', e => edit(() => (b.props.runout = +e.target.value)));
  on('#ixGName', 'onchange', e => edit(() => (grpInfo(b.grp).name = e.target.value.trim())));
  on('#ixGCtl', 'onchange', e => edit(() => (grpInfo(b.grp).ctl = e.target.checked)));
  on('#ixGDelay', 'onchange', e => edit(() => (grpInfo(b.grp).delay = +e.target.value)));
  on('#ixGStop', 'onclick', () => (groupRun(b.grp, false), save(), liveCanvas(), renderProps()));
  on('#ixGStart', 'onclick', () => (groupRun(b.grp, true), save(), liveCanvas(), renderProps()));
  on('#ixName', 'onchange', e => renameBlock(b, e.target.value.trim()));
  on('#ixDesc', 'onchange', e => edit(() => (b.props.desc = e.target.value)));
  on('#ixShow', 'onchange', e => edit(() => (b.props.hideName = !e.target.checked)));
  on('#ixPal', 'onchange', e => edit(() => (e.target.value ? (b.props.smpal = e.target.value) : delete b.props.smpal)));
  on('#ixPaint', 'onchange', e => edit(() => (b.props.paint = e.target.value))); // v5.7 ('' = original grey, also overrides a red / blue / green library item)
  on('#ixX', 'onchange', e => edit(() => (b.x = Math.round(+e.target.value || 0))));
  on('#ixY', 'onchange', e => edit(() => (b.y = Math.round(+e.target.value || 0))));
  const size = (W, H) =>
    edit(() => {
      const d = dims(b),
        rot = d.r % 180;
      W = Math.max(8, +W || d.W);
      H = Math.max(8, +H || d.H);
      b.w = Math.round((rot ? H : W) / d.sc);
      b.h = Math.round((rot ? W : H) / d.sc);
    });
  on('#ixW', 'onchange', e => size(e.target.value, dims(b).H));
  on('#ixH', 'onchange', e => size(dims(b).W, e.target.value));
  on('#ixRot', 'onchange', e => edit(() => (b.rot = +e.target.value)));
  on('#ixFlip', 'onclick', () => flipSel());
  on('#ixLock', 'onchange', () => toggleLock(b));
  on('#ixDup', 'onclick', () => dupSel());
  on('#ixRep', 'onclick', () => openReplace(B(SEL.id)));
  on('#ixDel', 'onclick', () => delSel());
  const pos = root.querySelector('.ix-pos');
  if (pos) pos.addEventListener('toggle', () => (IXPOS = pos.open));
  root.querySelectorAll('[data-goto]').forEach(x => (x.onclick = () => ((PTAB = x.dataset.goto), renderProps())));
  if (E.widget) return;
  // equipment-level source and data tag
  on('#ixSrc', 'onchange', e => {
    const v = e.target.value;
    if (v === '__manage') {
      e.target.value = eqSource(b);
      sourcesForm();
      return;
    }
    edit(() => {
      b.props.src = v;
      b.tags.forEach(bt => {
        const t = REG[bt.id];
        if (t && !bt.own) setTagLink(t, v, tagAddr(t));
      });
    });
    toast(v ? `${b.name} now reads from ${SRC(v)?.name}` : `${b.name} uses simulated values`);
  });
  on('#ixDtag', 'onchange', e => edit(() => (b.props.dtag = e.target.value.trim())));
  on('#ixMap', 'onclick', () => {
    const src = eqSource(b),
      pre = (b.props.dtag || '').trim(),
      sep = (FAM_HINT[famOf(src)] || [, , '.'])[2];
    let n = 0;
    edit(() =>
      b.tags.forEach(bt => {
        const t = REG[bt.id];
        if (!t || bt.own) return;
        setTagLink(t, src, pre ? pre + sep + tagKey(t.id) : tagAddr(t) || t.id);
        n++;
      }),
    );
    toast(`${n} reading${n === 1 ? '' : 's'} mapped to ${SRC(src)?.name}`);
  });
  on('#ixTest', 'onclick', () => testSource(SRC(eqSource(b)), $('#ixStat')));
  on('#ixBrowse', 'onclick', () => linkWizard(b.id));
  // add a reading
  const addBox = root.querySelector('#ixAdd'),
    q = root.querySelector('#ixQ'),
    dd = root.querySelector('#ixDD');
  on('#ixAddBtn', 'onclick', () => {
    addBox.hidden = !addBox.hidden;
    if (!addBox.hidden) q.focus();
  });
  if (q) {
    const show = () => {
      const s = q.value.trim().toLowerCase();
      const list = Object.values(REG)
        .filter(t => !b.tags.some(x => x.id === t.id) && (!s || t.id.toLowerCase().includes(s) || (t.desc || '').toLowerCase().includes(s)))
        .slice(0, 30);
      dd.innerHTML = list.length
        ? list.map(t => `<button data-id="${esc(t.id)}"><b class="mono">${esc(t.id)}</b><span>${esc(t.desc || '')}</span></button>`).join('')
        : '<div class="ix-hint">No matching tags — create a new one.</div>';
      dd.querySelectorAll('[data-id]').forEach(
        x =>
          (x.onmousedown = ev => {
            ev.preventDefault();
            IXOPEN = x.dataset.id;
            edit(() => {
              b.tags.push({ id: x.dataset.id, show: true });
              const t = REG[x.dataset.id];
              if (t && eqSource(b) && !t.link) setTagLink(t, eqSource(b), (b.props.dtag ? b.props.dtag + (FAM_HINT[famOf(eqSource(b))] || [, , '.'])[2] : '') + tagKey(t.id));
            });
          }),
      );
    };
    q.oninput = show;
    q.onfocus = show;
  }
  on('#ixNew', 'onclick', () => tagForm(null, b));
  // reading cards
  root.querySelectorAll('.ix-card').forEach(card => {
    const t = REG[card.dataset.tid],
      bt = b.tags[+card.dataset.i];
    if (!t || !bt) return;
    card.addEventListener('toggle', () => {
      if (card.open) IXOPEN = t.id;
      else if (IXOPEN === t.id) IXOPEN = null;
    });
    card.querySelectorAll('[data-ix]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.ix;
        if (k === 'src') {
          if (el.value === '__manage') {
            el.value = bt.own ? tagSrcId(t) : '__eq';
            sourcesForm();
            return;
          }
          edit(() => {
            if (el.value === '__eq') {
              delete bt.own;
              setTagLink(t, eqSource(b), tagAddr(t));
            } else {
              bt.own = true;
              setTagLink(t, el.value, tagAddr(t));
            }
          });
          return;
        }
        if (k === 'addr') return edit(() => setTagLink(t, tagSrcId(t), el.value));
        if (k === 'show') return edit(() => (bt.show = el.checked));
        if (k === 'desc' || k === 'unit') return edit(() => (t[k] = el.value));
        if (k === 'd') return edit(() => (t.d = +el.value));
        // numbers: limits and demo value
        edit(() => {
          const v = el.value === '' ? null : +el.value;
          if (k === 'typ') {
            if (v != null && Number.isFinite(v)) {
              t.typ = v;
              ensureVal(t.id, true);
            }
          } else t[k] = v != null && Number.isFinite(v) ? v : null;
        });
      };
    });
    card.querySelectorAll('[data-ixa]').forEach(
      x =>
        (x.onclick = () => {
          const a = x.dataset.ixa;
          if (a === 'trend') openTrend(t.id);
          else if (a === 'full') tagForm(t.id, b);
          else if (a === 'rm')
            edit(() => {
              b.tags.splice(+card.dataset.i, 1);
              logEv(`Removed reading ${t.id} from ${b.name}`);
            });
        }),
    );
  });
}

/* ---------- live values in the open panel (Simulate / linked) ---------- */
setInterval(() => {
  if (!SEL || SEL.t !== 'b' || PTAB !== 'eq') return;
  $$('#ptab .ix-card').forEach(card => {
    const t = REG[card.dataset.tid];
    if (!t) return;
    const el = card.querySelector('.ix-val'),
      v = typeof val === 'function' ? val(t.id) : null;
    if (el) el.innerHTML = `${v == null ? '—' : fmtN(v, t.d)}<small>${esc(t.unit || '')}</small>`;
    const sv = card.querySelector('.ix-sev');
    if (sv) sv.style.background = sevC(tagSev(t.id));
  });
}, 1000);

/* ---------- Data tab (ribbon) and save state ---------- */
(() => {
  const on = (id, fn) => $('#' + id) && ($('#' + id).onclick = fn);
  on('dSrc', () => sourcesForm());
  on('dTest', () => {
    const n = sources().length;
    toast(`Testing ${n} data source${n === 1 ? '' : 's'}…`);
    setTimeout(() => toast(`${n} of ${n} data sources reachable (simulated test)`), 900);
  });
  on('dBrowse', () => {
    const b = SEL && SEL.t === 'b' ? B(SEL.id) : null;
    if (!b || !b.tags.length) return toast('Select equipment with readings first');
    linkWizard(b.id);
  });
  on('dMapAll', () => {
    pushUndo();
    let n = 0,
      e = 0;
    DOC.blocks.forEach(b => {
      const src = b.props && b.props.src;
      if (!src || EQ[b.type]?.widget) return;
      const pre = (b.props.dtag || '').trim(),
        sep = (FAM_HINT[famOf(src)] || [, , '.'])[2];
      e++;
      b.tags.forEach(bt => {
        const t = REG[bt.id];
        if (!t || bt.own) return;
        setTagLink(t, src, pre ? pre + sep + tagKey(t.id) : tagAddr(t) || t.id);
        n++;
      });
    });
    changed();
    toast(e ? `${n} readings mapped on ${e} equipment` : 'No equipment has a data source yet — select equipment and choose a Source');
  });
  on('dSimAll', () => {
    pushUndo();
    let n = 0;
    Object.values(REG).forEach(t => {
      if (t.link) (delete t.link, (t.src = 'Simulated'), n++);
    });
    DOC.blocks.forEach(b => b.props && delete b.props.src);
    changed();
    toast(`${n} readings back on demo values`);
  });
  on('dTags', () => {
    DTAB = 'tags';
    setDockTab();
  });
  on('dCsvIn', () => csvForm());
  on('dCsvOut', () => csvExportForm());
  // save state: "● Saved 10:42" after every save, "● Saving…" while a change is pending
  const st = $('#saveSt');
  if (st && typeof save === 'function') {
    const orig = save;
    save = function () {
      st.textContent = '● Saving…';
      st.className = 'savest busy';
      orig.apply(this, arguments);
      clearTimeout(st._t);
      st._t = setTimeout(() => {
        st.textContent = '● Saved ' + new Date().toTimeString().slice(0, 5);
        st.className = 'savest ok';
      }, 450);
    };
    st.textContent = '● Saved';
    st.className = 'savest ok';
  }
})();

/* v3.4 — the floating tool palette was removed (its tools are in Insert › Tools); the shortcuts stay:
   V = select, T = text, B = area / zone (C = connect is handled with the Connect tool) */
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || MODE !== 'design') return;
  const k = e.key.toLowerCase();
  if (k === 't') setPlace(PLACE === 'label' ? null : 'label');
  else if (k === 'b') setPlace(PLACE === 'areaBox' ? null : 'areaBox');
  else if (k === 'v') setPlace(null);
});
