/*! SandMan Process Flowsheet — 27c-card-trend.js
 *  v9.80 — readings inside data cards are clickable:
 *   · Monitor / Simulate: click a reading → its trend chart.
 *   · Design: click picks a reading (ticked in Properties › Data label cards), double-click → trend,
 *     Properties › Plot chart opens the trend of the ticked tag. */
function cardPlot(ids) {
  const id = (ids || []).find(x => REG[x] && !tagIsText(REG[x]));
  if (!id) return toast('Pick one numeric reading to plot');
  openTrend(id);
}
{
  let down = null;
  document.addEventListener(
    'pointerdown',
    e => {
      if (MODE === 'design' || e.button !== 0) return;
      const g = e.target.closest && e.target.closest('#cv .lcard');
      if (!g) return;
      /* the card is a read-out here: don't start the canvas label drag */
      e.stopPropagation();
      const row = e.target.closest('[data-row]'),
        nav = e.target.closest('[data-rotnav]');
      down = { x: e.clientX, y: e.clientY, id: row ? row.dataset.row : null, nav: nav ? +nav.dataset.rotnav : 0, g };
    },
    true,
  );
  document.addEventListener(
    'pointerup',
    e => {
      if (!down) return;
      const d = down;
      down = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      if (d.nav) return rotStep(d.g, d.nav);
      if (!d.id || !REG[d.id]) return;
      openTrend(d.id);
    },
    true,
  );
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="cpCss">
#cv .lcard .lc-row{cursor:pointer}
#cv .lcard .lc-row:hover .lc-hit{fill:rgba(31,111,235,.08)}
#cv:not(.monitor) .lcard .lc-row{cursor:default}
#cv:not(.monitor) .lcard .lc-row:hover .lc-hit{fill:rgba(46,158,79,.08)}
.lc2-chart{display:inline-flex;align-items:center;gap:4px}
</style>`,
);

/* ---------- v9.81 control chart: tag selector ---------- */
/* every numeric tag on the flowsheet, grouped by its equipment (or stream), in flowsheet order */
function ccTagGroups() {
  const seen = new Set(),
    G = [];
  const num = id => REG[id] && !tagIsText(REG[id]) && !seen.has(id);
  DOC.blocks
    .filter(b => !EQ[b.type].widget && b.tags && b.tags.length)
    .slice()
    .sort((a, c) => String(a.name).localeCompare(String(c.name), undefined, { numeric: true }))
    .forEach(b => {
      const ids = b.tags.map(t => t.id).filter(num);
      ids.forEach(id => seen.add(id));
      if (ids.length) G.push({ name: b.name, kind: EQ[b.type].n || '', ids });
    });
  (DOC.streams || []).forEach(s => {
    if (s.tag && num(s.tag)) {
      seen.add(s.tag);
      G.push({ name: s.name || s.id, kind: 'Line', ids: [s.tag] });
    }
  });
  return G;
}
const ccNm = id => (REG[id] && (REG[id].short || REG[id].desc)) || id;
function ccPickerHTML(id) {
  const o = tagOwner(id),
    own = o ? (o.b ? o.b.name : o.s.name) : '';
  return `<div class="ccp"><button type="button" class="ccp-nav" id="ccPrev" title="Previous tag of ${esc(own)} (←)" aria-label="Previous tag">‹</button>
  <button type="button" class="ccp-btn" id="ccPick" aria-haspopup="listbox" aria-expanded="false" title="Choose another tag"><span class="ccp-own">${esc(own)}</span><span class="ccp-nm">${esc(ccNm(id))}</span><span class="ccp-id mono">${esc(id)}</span><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <button type="button" class="ccp-nav" id="ccNext" title="Next tag of ${esc(own)} (→)" aria-label="Next tag">›</button>
  <div class="ccp-pop" id="ccPop" hidden><input type="search" id="ccQ" placeholder="Search tag, name or equipment…" aria-label="Search tags" autocomplete="off"><div class="ccp-list" id="ccList" role="listbox" aria-label="Tags"></div></div></div>`;
}
function ccPickerBind(id) {
  const pop = $('#ccPop'),
    btn = $('#ccPick'),
    q = $('#ccQ'),
    list = $('#ccList');
  if (!pop) return;
  const groups = ccTagGroups();
  const own = groups.find(g => g.ids.includes(id));
  const go = nid => nid && nid !== id && openTrend(nid);
  const step = d => {
    if (!own || own.ids.length < 2) return;
    const i = own.ids.indexOf(id);
    go(own.ids[(i + d + own.ids.length) % own.ids.length]);
  };
  $('#ccPrev').disabled = $('#ccNext').disabled = !own || own.ids.length < 2;
  $('#ccPrev').onclick = () => step(-1);
  $('#ccNext').onclick = () => step(1);
  let act = 0,
    items = [];
  const draw = () => {
    const f = q.value.trim().toLowerCase();
    let h = '';
    items = [];
    groups.forEach(g => {
      const ids = g.ids.filter(x => !f || (g.name + ' ' + g.kind + ' ' + x + ' ' + ccNm(x) + ' ' + (REG[x].desc || '')).toLowerCase().includes(f));
      if (!ids.length) return;
      h += `<div class="ccp-g">${esc(g.name)} <span>${esc(g.kind)}</span></div>`;
      ids.forEach(x => {
        const v = val(x),
          t = REG[x];
        h += `<div class="ccp-i${x === id ? ' cur' : ''}" role="option" data-cc="${esc(x)}" data-n="${items.length}" aria-selected="${x === id}"><span class="ccp-in">${esc(ccNm(x))}</span><span class="ccp-ii mono">${esc(x)}</span><span class="ccp-iv mono">${v == null ? '—' : esc(fmtN(v, t.d))} ${esc(t.unit || '')}</span></div>`;
        items.push(x);
      });
    });
    list.innerHTML = h || '<div class="ccp-none">No tag matches</div>';
    act = Math.max(0, items.indexOf(id));
    if (f) act = 0;
    mark();
  };
  const mark = () => {
    list.querySelectorAll('.ccp-i.act').forEach(e => e.classList.remove('act'));
    const e = list.querySelector(`.ccp-i[data-n="${act}"]`);
    if (e) {
      e.classList.add('act');
      e.scrollIntoView({ block: 'nearest' });
    }
  };
  const open = on => {
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', on);
    if (on) {
      q.value = '';
      draw();
      q.focus();
    }
  };
  btn.onclick = () => open(pop.hidden);
  let tq;
  q.oninput = () => {
    clearTimeout(tq);
    tq = setTimeout(draw, 90);
  };
  q.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      act = (act + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[act]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      open(false);
      btn.focus();
    }
  };
  list.onclick = e => {
    const it = e.target.closest('[data-cc]');
    if (it) it.dataset.cc === id ? open(false) : go(it.dataset.cc);
  };
  $('#mbox').addEventListener('pointerdown', e => {
    if (!pop.hidden && !e.target.closest('.ccp')) open(false);
  });
  CC_STEP = d => (pop.hidden ? step(d) : null);
}
/* ← / → step through the equipment's tags while the control chart is open (not while typing) */
let CC_STEP = null;
document.addEventListener('keydown', e => {
  if (!CC_STEP || !$('#ccPick') || !$('#modal.on') || e.altKey || e.ctrlKey || e.metaKey) return;
  if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
  if (e.key === 'ArrowLeft') (e.preventDefault(), CC_STEP(-1));
  else if (e.key === 'ArrowRight') (e.preventDefault(), CC_STEP(1));
});
/* ribbon › Simulate › Control chart: the last charted tag, or the first one, with the selector open */
let CC_LAST = null;
{
  const _ot = openTrend;
  openTrend = function (id) {
    CC_LAST = id;
    return _ot.apply(this, arguments);
  };
}
function openControlChart() {
  const g = ccTagGroups();
  const id = (CC_LAST && REG[CC_LAST] && CC_LAST) || (g[0] && g[0].ids[0]);
  if (!id) return toast('No numeric tags on this flowsheet yet');
  openTrend(id);
  if (!CC_LAST || CC_LAST === id) setTimeout(() => $('#ccPick') && $('#ccPick').click(), 30);
}
{
  const b = document.getElementById('bCC');
  if (b) b.onclick = openControlChart;
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="ccpCss">
.ccp{position:relative;display:flex;align-items:center;gap:4px;margin-bottom:2px}
.ccp-nav{width:28px;height:30px;border:1px solid var(--line,#d6dde6);background:var(--panel,#fff);color:var(--text,#16212b);border-radius:6px;font:600 17px/1 var(--sans);cursor:pointer;flex:none}
.ccp-nav:disabled{opacity:.35;cursor:default}
.ccp-btn{display:flex;align-items:baseline;gap:8px;min-width:0;max-width:100%;border:1px solid var(--line,#d6dde6);background:var(--panel,#fff);color:var(--text,#16212b);border-radius:6px;padding:5px 10px;cursor:pointer;text-align:left}
.ccp-btn:hover,.ccp-nav:hover:not(:disabled){border-color:#1f6feb}
.ccp-own{font:700 15px var(--sans);white-space:nowrap}
.ccp-nm{font:600 15px var(--sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccp-id{font-size:11.5px;color:var(--muted,#5b6b7b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccp-btn svg{align-self:center;flex:none}
.ccp-pop{position:absolute;z-index:30;top:36px;left:32px;width:min(520px,80vw);background:var(--panel,#fff);border:1px solid var(--line,#d6dde6);border-radius:8px;box-shadow:0 12px 30px rgba(15,30,60,.2);padding:8px}
.ccp-pop input{width:100%;box-sizing:border-box;margin-bottom:6px}
.ccp-list{max-height:340px;overflow:auto}
.ccp-g{position:sticky;top:0;background:var(--bg2,#f1f5f9);font:700 11.5px var(--sans);color:var(--text,#16212b);padding:4px 8px;border-radius:4px;margin-top:4px}
.ccp-g span{font-weight:500;color:var(--muted,#5b6b7b)}
.ccp-i{display:grid;grid-template-columns:1fr auto;column-gap:10px;padding:5px 8px;border-radius:5px;cursor:pointer}
.ccp-i:hover,.ccp-i.act{background:rgba(31,111,235,.10)}
.ccp-i.cur{box-shadow:inset 3px 0 0 #1f6feb}
.ccp-in{font:600 12.5px var(--sans)}
.ccp-ii{font-size:11px;color:var(--muted,#5b6b7b);grid-column:1}
.ccp-iv{grid-column:2;grid-row:1/3;align-self:center;font-size:12px}
.ccp-none{padding:10px;color:var(--muted,#5b6b7b);font-size:12.5px}
</style>`,
);


/* ---------- v9.83 rotation: ‹ › step, pointer on the card holds the page ---------- */
function rotRefresh(g) {
  const b = g && B(g.dataset.tg);
  if (b && typeof tagSoon === 'function') tagSoon(b);
  else if (typeof liveCanvas === 'function') liveCanvas();
}
function rotStep(g, d) {
  const r = g && g.querySelector('.lc-rot');
  if (!r) return;
  const k = r.dataset.rk,
    pn = +r.dataset.pn,
    pg = +r.dataset.pg;
  if (ROT_HOLD[k] != null) ROT_HOLD[k] = (pg + d + pn) % pn;
  else ROT_OFF[k] = (ROT_OFF[k] || 0) + d;
  rotRefresh(g);
}
{
  let over = null;
  document.addEventListener(
    'pointerover',
    e => {
      const g = e.target.closest && e.target.closest('#cv .lcard');
      if (g === over) return;
      if (over) {
        const r0 = over.querySelector('.lc-rot');
        if (r0 && ROT_HOLD[r0.dataset.rk] != null) {
          /* carry on from the page that was held */
          const k = r0.dataset.rk,
            b = B(over.dataset.tg),
            R = b && lblRot(b, over.dataset.lc),
            sec = Math.max(2, +(R && R.sec) || 5),
            pn = +r0.dataset.pn,
            base = Math.floor(Date.now() / (sec * 1000));
          ROT_OFF[k] = (((ROT_HOLD[k] - base) % pn) + pn) % pn;
          delete ROT_HOLD[k];
        }
      }
      over = g;
      if (!g) return;
      const r = g.querySelector('.lc-rot'),
        b = B(g.dataset.tg);
      if (r && b && lblRot(b, g.dataset.lc).pause) ROT_HOLD[r.dataset.rk] = +r.dataset.pg;
    },
    true,
  );
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="rotCss">
#cv .lcard .lc-rotb{cursor:pointer}
#cv .lcard .lc-rotb:hover path{stroke:#1f6feb}
.lc2-rot{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;font-size:12px}
.lc2-rot>span:first-child,.lc2-rotd>span:first-child{font-weight:600;color:var(--muted,#5b6b7b);min-width:42px}
.lc2-rot select,.lc2-rotd select{padding:2px 4px;font-size:12px}
.lc2-rot em,.lc2-rotd em{font-style:normal;color:var(--muted,#5b6b7b)}
.lc2-rot select{max-width:190px}
.lc2-rotn{flex-basis:100%;padding-left:48px;color:var(--muted,#5b6b7b);font-size:11.5px}
.lc2-rotd{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}
.lc2-rotd span:first-child{flex-basis:100%}
.lc2-rotd label{display:inline-flex;gap:4px;align-items:center;font-size:12px}
.lc2-pin{border:0;background:none;padding:0 2px 0 0;cursor:pointer;opacity:.3;font-size:11px;filter:grayscale(1)}
.lc2-chip.pinned .lc2-pin{opacity:1;filter:none}
.lc2-chip.pinned{border-color:#c99a00}
</style>`,
);

/* v9.84 — in Design the live refresh does not run: turn the pages of rotating cards here (only blocks that rotate) */
setInterval(() => {
  if (typeof MODE === 'undefined' || MODE !== 'design' || document.hidden || typeof tagSoon !== 'function') return;
  DOC.blocks.forEach(b => {
    const cd = b.props && b.props.lblCardD;
    if (!cd || !b.props.lblStyle) return;
    if (Object.keys(cd).some(k => lblRot(b, k).on)) tagSoon(b);
  });
}, 1000);
