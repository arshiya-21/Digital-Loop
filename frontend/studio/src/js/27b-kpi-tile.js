/*! SandMan Process Flowsheet — 27b-kpi-tile.js
 *  v9.78 KPI scorecard tile (EQ.kpiTile): icon, title, big value with unit and an honest status pill. */
function kpiIcons() {
  return {
  sand: ['#c98a2b', '<path d="M2 19c2.5-6.5 6-9.5 10-9.5s7.5 3 10 9.5z" fill="#d9a441"/><path d="M7 15.5c1.5-2 3-3 5-3" stroke="#a86b14" stroke-width="1.2" fill="none"/>'],
  trend: ['#1e3a8a', '<path d="M3 17l6-6 4 4 8-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h6v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'],
  hourglass: ['#1e3a8a', '<path d="M6 3h12M6 21h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7.5 3c0 5 9 6 9 9s-9 4-9 9M16.5 3c0 5-9 6-9 9s9 4 9 9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9.5 19.5c1-1.6 4-1.6 5 0z" fill="currentColor"/>'],
  gear: ['#1e3a8a', '<path d="M12 1.8l1.6 2.6 3-.7.7 3 2.6 1.6-1.4 2.7 1.4 2.7-2.6 1.6-.7 3-3-.7L12 22.2l-1.6-2.6-3 .7-.7-3-2.6-1.6L5.5 13 4.1 10.3l2.6-1.6.7-3 3 .7z" fill="currentColor"/><circle cx="12" cy="12" r="3.6" fill="#fff"/>'],
  thermo: ['#1e3a8a', '<path d="M9.5 14.2V5a2.5 2.5 0 0 1 5 0v9.2a4.6 4.6 0 1 1-5 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="2.4" fill="#d93636"/><path d="M12 9.5v7" stroke="#d93636" stroke-width="2"/>'],
  drop: ['#1f6feb', '<path d="M12 2.5s6.5 7.4 6.5 11.7a6.5 6.5 0 0 1-13 0C5.5 9.9 12 2.5 12 2.5z" fill="currentColor"/><path d="M8.6 14.5a3.4 3.4 0 0 0 2.6 3.2" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/>'],
  bars: ['#1e3a8a', '<rect x="3" y="13" width="4" height="8" rx="1" fill="currentColor"/><rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor"/><rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor"/>'],
  alert: ['#d93636', '<path d="M12 2.5l10.5 18.5H1.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9v6" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/><circle cx="12" cy="18" r="1.3" fill="#fff"/>'],
  bolt: ['#c27803', '<path d="M13.5 2L4.5 13.5h6L9.5 22l9-11.5h-6z" fill="currentColor"/>'],
  clock: ['#1e3a8a', '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5.5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
};
}
function kpiIconList() { return [['sand', 'Sand pile'], ['trend', 'Trend'], ['hourglass', 'Hourglass'], ['gear', 'Gear'], ['thermo', 'Thermometer'], ['drop', 'Water drop'], ['bars', 'Bar chart'], ['alert', 'Alarm'], ['bolt', 'Power'], ['clock', 'Clock']]; }

/* value, unit, decimals and status for one tile */
function kpiTileValue(b) {
  const p = b.props;
  if (p.src === 'alarms') {
    const n = typeof ALERTS === 'object' ? Object.values(ALERTS).filter(a => a.active).length : 0;
    return { v: n, u: '', d: 0, sev: n ? 3 : -1, txt: null, alarmCount: true };
  }
  if (p.src === 'avail') {
    const eq = DOC.blocks.filter(x => !EQ[x.type].widget && !EQ[x.type].inst && x.type !== 'junction');
    const up = eq.filter(x => !x.props.oos).length;
    return { v: eq.length ? (up / eq.length) * 100 : null, u: '%', d: 1, sev: -1 };
  }
  const ids = (b.tags || []).map(t => t.id).filter(id => REG[id]);
  if (!ids.length) return { v: null, u: p.unit || '', d: 1, sev: -1, empty: true };
  const t0 = REG[ids[0]];
  if (tagIsText(t0)) return { v: null, txt: tagTxt(ids[0]), u: '', sev: -1 };
  const vs = ids.map(id => val(id)).filter(v => v != null && isFinite(v));
  let v = vs.length ? vs[0] : null;
  if (vs.length && p.agg === 'sum') v = vs.reduce((a, c) => a + c, 0);
  if (vs.length && p.agg === 'avg') v = vs.reduce((a, c) => a + c, 0) / vs.length;
  const use = p.agg === 'first' || !p.agg ? ids.slice(0, 1) : ids;
  const lim = use.some(id => ['hh', 'hi', 'lo', 'll'].some(k => REG[id][k] != null) || (typeof alBand === 'function' && alBand(REG[id])));
  const sev = lim ? Math.max(...use.map(id => tagSev(id))) : -1;
  const dp = p.dp !== '' && p.dp != null && isFinite(+p.dp) ? +p.dp : t0.d;
  return { v, u: p.unit || t0.unit || '', d: dp, sev };
}
function kpiTileSVG(w, h, b) {
  const p = b.props, IC = kpiIcons(), I = IC[p.icon] || IC.bars, r = kpiTileValue(b);
  const vs = r.txt != null ? esc(r.txt) : r.v == null ? '—' : esc(fmtN(r.v, r.d));
  const pill = r.alarmCount ? null : r.sev === 0 ? ['On target', '#1f9d55'] : r.sev === 1 ? ['Check', '#c27803'] : r.sev === 2 ? ['Warning', '#c27803'] : r.sev === 3 ? ['Alarm', '#d93636'] : null;
  const vc = r.alarmCount ? (r.v ? '#d93636' : 'var(--text)') : r.sev === 3 ? '#d93636' : 'var(--text)';
  const ix = 8, iy = (h - 26) / 2, tx = 40;
  let s = `<g class="kpi-ic" transform="translate(${ix} ${iy}) scale(${26 / 24})" style="color:${I[0]}">${I[1]}</g>`;
  s += `<text x="${tx}" y="${h / 2 - 5}" class="kpi-t">${esc(p.title || '')}</text>`;
  s += `<text x="${tx}" y="${h / 2 + 15}" class="kpi-v" style="fill:${vc}">${vs}<tspan class="kpi-u" dx="3">${esc(r.u)}</tspan></text>`;
  if (pill) {
    /* the pill follows the value (as on the reference scorecard); if it would not fit, a status dot sits top-right instead */
    const cw = c => (/[0-9]/.test(c) ? 9.8 : /[.,:]/.test(c) ? 5.2 : /[-–]/.test(c) ? 7 : 11.5);
    const vEnd = tx + [...String(r.txt != null ? r.txt : r.v == null ? '—' : fmtN(r.v, r.d))].reduce((a, c) => a + cw(c), 0) + 3 + [...String(r.u)].reduce((a, c) => a + (c === '°' ? 5 : 7.8), 0);
    const pw = pill[0].length * 5 + 11, px = w - pw - 7;
    if (px >= vEnd + 4)
      s += `<g class="kpi-pill" transform="translate(${px.toFixed(1)} ${h / 2 + 2.5})"><rect width="${pw.toFixed(1)}" height="15" rx="7.5" fill="${pill[1]}"/><text x="${(pw / 2).toFixed(1)}" y="10.8" text-anchor="middle">${pill[0]}</text></g>`;
    else s += `<circle class="kpi-dot" cx="${w - 11}" cy="11" r="4.5" fill="${pill[1]}"><title>${pill[0]}</title></circle>`;
  }
  if (r.empty) s += `<text x="${tx}" y="${h / 2 + 15}" class="kpi-u" dx="18"> bind a tag</text>`;
  return s;
}

/* ---------- v9.82 Score card designer: make a KPI tile from a tag, from inside Digital Loop ----------
   Opens from Properties › Data label cards › Score card, and from the ▣ button on a tag in Properties › Tags. */
function scIconFor(id) {
  const t = REG[id] || {},
    s = ((t.short || '') + ' ' + (t.desc || '') + ' ' + id).toLowerCase(),
    u = (t.unit || '').toLowerCase();
  if (/alarm|fault/.test(s)) return 'alert';
  if (u === '°c' || /temp/.test(s)) return 'thermo';
  if (/moist|water/.test(s)) return 'drop';
  if (/compact|gcs|strength/.test(s)) return 'bars';
  if (u === 'a' || u === 'kw' || /current|power/.test(s)) return 'bolt';
  if (u === 't/h' || /sand|load|weight/.test(s)) return 'sand';
  if (u === 'min' || u === 's' || /time|cycle/.test(s)) return 'clock';
  if (/count|batch|mould|mold|today|shift/.test(s)) return 'hourglass';
  if (/speed|rpm|motor/.test(s)) return 'gear';
  return 'trend';
}
function scOpen(id) {
  const st = { id: REG[id] ? id : null, title: REG[id] ? REG[id].short || REG[id].desc || id : 'Score card', icon: REG[id] ? scIconFor(id) : 'bars', src: 'tag' };
  /* all tags, grouped by the equipment they belong to */
  const groups = [];
  DOC.blocks
    .filter(b => !EQ[b.type].widget && b.tags && b.tags.length)
    .slice()
    .sort((a, c) => String(a.name).localeCompare(String(c.name), undefined, { numeric: true }))
    .forEach(b => {
      const ids = b.tags.map(t => t.id).filter(x => REG[x]);
      if (ids.length) groups.push([b.name, ids]);
    });
  const IC = kpiIcons();
  openModal(
    `<h3 style="margin:0 0 2px">New score card</h3><div class="note" style="margin-bottom:12px">A KPI tile on the flowsheet: icon, title, live value. The status pill shows when the tag has min / max limits.</div>
 <div class="scd">
  <div class="scd-f">
   <div class="fld"><label>Value from</label><div class="seg" id="scSrc">${[['tag', 'A tag'], ['alarms', 'Active alarms'], ['avail', 'Availability']].map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div></div>
   <div class="fld" id="scTagF"><label for="scTag">Tag</label><select id="scTag"><option value="">Choose a tag…</option>${groups
     .map(([n, ids]) => `<optgroup label="${esc(n)}">${ids.map(x => `<option value="${esc(x)}">${esc(REG[x].short || REG[x].desc || x)} — ${esc(x)}</option>`).join('')}</optgroup>`)
     .join('')}</select></div>
   <div class="fld"><label for="scTitle">Title</label><input id="scTitle" maxlength="40"></div>
   <div class="fld"><label>Icon</label><div class="scd-ic" id="scIc">${kpiIconList()
     .map(([k, n]) => `<button type="button" data-ic="${k}" title="${esc(n)}" aria-label="${esc(n)}"><svg viewBox="0 0 24 24" width="22" height="22" style="color:${IC[k][0]}">${IC[k][1]}</svg></button>`)
     .join('')}</div></div>
  </div>
  <div class="scd-p"><div class="scd-pl">Preview</div><svg id="scPrev" viewBox="-4 -4 192 56" width="288" height="84"></svg><div class="note" id="scNote"></div></div>
 </div>
 <div class="mact"><button class="ib" id="scCancel">Cancel</button><button class="ib pri" id="scAdd">Add score card</button></div>`,
    'wide',
  );
  const fake = () => ({ id: 'scprev', type: 'kpiTile', name: 'KPI', props: { title: st.title, icon: st.icon, src: st.src, agg: 'first', unit: '', dp: '' }, tags: st.src === 'tag' && st.id ? [{ id: st.id, show: false }] : [] });
  const draw = () => {
    $$('#scSrc button').forEach(b => b.classList.toggle('on', b.dataset.v === st.src));
    $('#scTagF').hidden = st.src !== 'tag';
    $$('#scIc button').forEach(b => b.classList.toggle('on', b.dataset.ic === st.icon));
    const f = fake();
    $('#scPrev').innerHTML = EQ.kpiTile.draw(184, 48, '', f) + `<g>${kpiTileSVG(184, 48, f)}</g>`;
    const t = st.id && REG[st.id];
    $('#scNote').textContent =
      st.src !== 'tag' ? '' : !t ? 'Choose a tag to see its live value.' : ['hh', 'hi', 'lo', 'll'].some(k => t[k] != null) ? 'Limits set — the pill shows On target / Warning / Alarm.' : 'This tag has no min / max limits, so no status pill is shown. Set them on the reading: Properties › Equipment › open the reading › Min / Max.';
    $('#scAdd').disabled = st.src === 'tag' && !t;
  };
  $('#scTag').value = st.id || '';
  $('#scTitle').value = st.title;
  $('#scTag').onchange = e => {
    const old = st.id;
    st.id = e.target.value || null;
    const auto = old && REG[old] ? REG[old].short || REG[old].desc || old : 'Score card';
    if (!$('#scTitle').value.trim() || $('#scTitle').value === auto) $('#scTitle').value = st.title = st.id ? REG[st.id].short || REG[st.id].desc || st.id : 'Score card';
    if (st.id) st.icon = scIconFor(st.id);
    draw();
  };
  $('#scTitle').oninput = e => ((st.title = e.target.value), draw());
  $$('#scSrc button').forEach(
    b =>
      (b.onclick = () => {
        st.src = b.dataset.v;
        if (st.src === 'alarms') (st.icon = 'alert'), ($('#scTitle').value = st.title = 'Active alarms');
        else if (st.src === 'avail') (st.icon = 'trend'), ($('#scTitle').value = st.title = 'System availability');
        draw();
      }),
  );
  $$('#scIc button').forEach(b => (b.onclick = () => ((st.icon = b.dataset.ic), draw())));
  $('#scCancel').onclick = closeModal;
  $('#scAdd').onclick = () => {
    closeModal();
    if (MODE !== 'design') setMode('design');
    pushUndo();
    /* next free place in the score card row (same row as the existing tiles), otherwise the middle of the view */
    const row = DOC.blocks.filter(b => b.type === 'kpiTile');
    const W = 183,
      pg = DOC.page || { x: 0, w: 1920 };
    let x, y;
    if (row.length) {
      y = Math.min(...row.map(b => b.y));
      const inRow = row.filter(b => Math.abs(b.y - y) < 4);
      x = Math.max(...inRow.map(b => b.x + (b.w || W))) + 6;
      if (x + W > (pg.x || 0) + pg.w - 6) x = null;
    }
    if (x == null) {
      const r = cvRect();
      x = Math.round((r.width / 2 - VIEW.tx) / VIEW.k - W / 2);
      y = Math.round((r.height / 2 - VIEW.ty) / VIEW.k - 24);
    }
    const nb = addBlock('kpiTile', x, y, { w: W, bind: st.src === 'tag' && st.id ? [st.id] : [], showBind: false, props: { title: st.title || 'Score card', icon: st.icon, src: st.src } });
    SEL = { t: 'b', id: nb.id };
    PTAB = 'gen';
    changed();
    renderCanvas();
    renderProps();
    toast(row.length && Math.abs(nb.y - Math.min(...row.map(b => b.y))) < 4 ? 'Score card added to the score card row' : 'Score card added in the middle of the view — drag it where you want it');
  };
  draw();
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="scdCss">
.scd{display:grid;grid-template-columns:1fr 300px;gap:18px;align-items:start}
.scd-f .fld{margin-bottom:10px}
.scd-f select,.scd-f input{width:100%;box-sizing:border-box}
.scd-ic{display:grid;grid-template-columns:repeat(5,40px);gap:6px}
.scd-ic button{width:40px;height:38px;border:1px solid var(--line,#d6dde6);border-radius:7px;background:var(--panel,#fff);display:grid;place-items:center;cursor:pointer}
.scd-ic button.on{border-color:#1f6feb;box-shadow:0 0 0 2px rgba(31,111,235,.25)}
.scd-p{background:var(--bg2,#f1f5f9);border-radius:10px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px}
.scd-pl{align-self:flex-start;font:600 11.5px var(--sans);color:var(--muted,#5b6b7b)}
.scd-p .note{text-align:center}
@media (max-width:720px){.scd{grid-template-columns:1fr}}
</style>`,
);
