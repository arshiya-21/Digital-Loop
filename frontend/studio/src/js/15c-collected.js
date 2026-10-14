/*! SandMan Digital Loop Studio — 15c-collected.js
 *  v7.1 — "Collected data" for SCADA and every Control & IT item (PLC, gateway, server, database, cloud …):
 *  follows the data network from the item — through other Control & IT items (PLC, gateway, switch, router …) —
 *  to every piece of plant equipment connected to it, and lists their tags with live values, units and alarm
 *  colour, grouped by equipment, with the path the data takes. Click a tag to open its trend. */

const isIT = b => !!b && CATS[EQ[b.type]?.cat] === 'Control & IT';
function collectedFrom(root) {
  const seen = new Set([root.id]),
    found = [],
    q = [{ b: root, via: [] }];
  while (q.length) {
    const { b, via } = q.shift();
    DOC.streams.forEach(s => {
      const other = s.from.b === b.id ? s.to.b : s.to.b === b.id ? s.from.b : null;
      if (!other || seen.has(other)) return;
      const o = B(other);
      if (!o) return;
      seen.add(other);
      const E = EQ[o.type];
      if (isIT(o) || o.type === 'junction') q.push({ b: o, via: o.type === 'junction' ? via : [...via, o.name] }); // the data passes on
      else if (!E.widget) found.push({ b: o, via });
    });
  }
  return found.sort((a, c) => String(a.b.name).localeCompare(String(c.b.name), undefined, { numeric: true }));
}
function collectedHTML(b) {
  if (!isIT(b)) return '';
  const list = collectedFrom(b),
    nTags = list.reduce((n, x) => n + (x.b.tags || []).length, 0);
  const dot = id => {
    const sv = typeof tagSev === 'function' ? tagSev(id) : 0;
    return `<i class="cd-dot s${sv || 0}"></i>`;
  };
  const body = list.length
    ? list
        .map(({ b: e, via }) => {
          const tags = e.tags || [];
          return `<div class="cd-eq" data-cdq="${esc((e.name + ' ' + (EQ[e.type].n || '') + ' ' + tags.map(t => t.id).join(' ')).toLowerCase())}">
        <div class="cd-eqh"><b>${esc(e.name)}</b><span>${esc(EQ[e.type].n || '')}</span>${via.length ? `<em title="Data path">via ${via.map(esc).join(' → ')}</em>` : ''}</div>
        ${
          tags.length
            ? `<table class="cd-t">${tags
                .map(t => {
                  const R = REG[t.id] || {};
                  const short = t.id.startsWith(e.name + '.') ? t.id.slice(e.name.length + 1) : t.id;
                  return `<tr data-ctag="${esc(t.id)}" title="Open the trend of ${esc(t.id)}"><td>${dot(t.id)}<span class="mono">${esc(short)}</span>${R.desc ? `<small>${esc(R.desc)}</small>` : ''}</td><td class="num mono" data-live="${esc(t.id)}">${fmtT(t.id)}</td></tr>`;
                })
                .join('')}</table>`
            : '<p class="cd-none">No tags on this equipment yet.</p>'
        }
      </div>`;
        })
        .join('')
    : `<div class="cd-empty"><b>No equipment connected yet.</b>Draw a data line from any equipment’s <span class="cd-dia">◆</span> data point to ${esc(b.name)} — its tags appear here.</div>`;
  return `<section class="ix-sec cd"><h4>Collected data <span class="ix-sum">${list.length} equipment · ${nTags} tag${nTags === 1 ? '' : 's'}</span></h4>
  ${list.length > 1 ? `<input class="cd-q" type="search" placeholder="Find equipment or tag…" aria-label="Find equipment or tag">` : ''}
  <div class="cd-list">${body}</div></section>`;
}
/* clicks and search (delegated once) */
document.addEventListener('click', e => {
  const r = e.target.closest('#ptab .cd-t tr[data-ctag]');
  if (r && typeof openTrend === 'function') openTrend(r.dataset.ctag);
});
document.addEventListener('input', e => {
  if (!e.target.classList || !e.target.classList.contains('cd-q')) return;
  const q = e.target.value.trim().toLowerCase();
  e.target.parentElement.querySelectorAll('.cd-eq').forEach(x => (x.hidden = !!q && !x.dataset.cdq.includes(q)));
});

/* ---------- v7.4 — publish view: click SCADA (or any Control & IT item) → table of its connected tags ---------- */
let CDPOP = null;
function cdStatus(id, e) {
  if (e.props.oos || (typeof IDLE !== 'undefined' && IDLE[e.id])) return ['off', e.props.oos ? 'STOPPED' : 'IDLE'];
  const sv = typeof tagSev === 'function' ? tagSev(id) : 0,
    t = REG[id],
    v = val(id);
  if (sv >= 3) return ['a', 'ALARM'];
  if (sv === 2) return ['w', t && t.hi != null && v >= t.hi ? 'HIGH' : 'LOW'];
  if (sv === 1) return ['n', 'WATCH'];
  return ['ok', 'OK'];
}
function cdRows(b) {
  const rank = { a: 0, w: 1, n: 2, ok: 3, off: 4 };
  const rows = [];
  collectedFrom(b).forEach(({ b: e, via }) =>
    (e.tags || []).forEach(t => {
      const R = REG[t.id] || {},
        [cls, txt] = cdStatus(t.id, e);
      rows.push({ e, via, id: t.id, short: t.id.startsWith(e.name + '.') ? t.id.slice(e.name.length + 1) : t.id, desc: R.desc || '', unit: R.unit || '', d: R.d, cls, txt });
    }),
  );
  return rows.sort((p, q) => rank[p.cls] - rank[q.cls] || String(p.e.name).localeCompare(String(q.e.name), undefined, { numeric: true }));
}
function cdRender() {
  if (!CDPOP) return;
  const b = B(CDPOP.bid);
  if (!b) return closeCollected();
  const rows = cdRows(b),
    nEq = new Set(rows.map(r => r.e.id)).size || collectedFrom(b).length,
    nA = rows.filter(r => r.cls === 'a').length,
    nW = rows.filter(r => r.cls === 'w').length;
  const body = CDPOP.el.querySelector('.cdp-body'),
    sc = body ? body.scrollTop : 0;
  CDPOP.el.innerHTML = `<header class="cdp-h"><h2>${esc(b.name)}</h2><span class="cdp-live">LIVE</span><button type="button" class="cdp-x" aria-label="Close">×</button></header>
  <div class="cdp-sum"><span>${nEq} equipment</span><span>${rows.length} tag${rows.length === 1 ? '' : 's'}</span>${nA ? `<span class="red">${nA} alarm${nA > 1 ? 's' : ''}</span>` : ''}${nW ? `<span class="amb">${nW} high / low</span>` : ''}</div>
  <div class="cdp-body">${
    rows.length
      ? `<table class="cdp-t"><thead><tr><th>Equipment</th><th>Tag</th><th class="dsc">Description</th><th class="num">Value</th><th>Unit</th><th>Status</th></tr></thead><tbody>${rows
          .map(
            r =>
              `<tr class="${r.cls === 'a' ? 'al' : r.cls === 'w' ? 'wn' : ''}" data-ctag="${esc(r.id)}" title="Open the trend of ${esc(r.id)}"><td class="eqc"><b>${esc(r.e.name)}</b>${r.via.length ? `<small>via ${r.via.map(esc).join(' → ')}</small>` : ''}</td><td class="mono">${esc(r.short)}</td><td class="dsc">${esc(r.desc)}</td><td class="num mono">${fmtN(val(r.id), r.d)}</td><td class="u">${esc(r.unit)}</td><td><span class="stb ${r.cls}">${r.txt}</span></td></tr>`,
          )
          .join('')}</tbody></table>`
      : `<div class="cdp-empty"><b>No equipment connected yet.</b>Connect equipment to ${esc(b.name)} with a data line (from its ◆ data point) — its tags appear here.</div>`
  }</div>
  <footer class="cdp-f">${rows.length ? 'Alarms first · click a row for its trend' : ''}</footer>`;
  const nb = CDPOP.el.querySelector('.cdp-body');
  if (nb) nb.scrollTop = sc;
}
function cdPlace() {
  if (!CDPOP) return;
  const b = B(CDPOP.bid),
    el = CDPOP.el,
    k = document.getElementById('bk_' + CDPOP.bid);
  if (!b || !k) return;
  const r = k.getBoundingClientRect(),
    w = el.offsetWidth,
    h = el.offsetHeight,
    m = 12;
  let x = r.right + m,
    y = r.top + r.height / 2 - h / 2;
  if (x + w > innerWidth - m) x = r.left - m - w; // not enough room on the right: open on the left
  if (x < m) x = Math.max(m, Math.min(innerWidth - w - m, r.left + r.width / 2 - w / 2));
  y = Math.max(m, Math.min(innerHeight - h - m, y));
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
  el.dataset.side = x >= r.right ? 'r' : x + w <= r.left ? 'l' : 'c';
}
function openCollected(b) {
  if (!b || !isIT(b)) return;
  closeCollected();
  const el = document.createElement('div');
  el.className = 'cdp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `${b.name}: connected tags`);
  document.body.appendChild(el);
  CDPOP = { bid: b.id, el, t: setInterval(cdRender, 1000) };
  cdRender();
  cdPlace();
  el.querySelector('.cdp-x')?.focus();
}
function closeCollected() {
  if (!CDPOP) return;
  clearInterval(CDPOP.t);
  CDPOP.el.remove();
  CDPOP = null;
}
document.addEventListener(
  'pointerdown',
  e => {
    if (!CDPOP) return;
    if (e.target.closest('.cdp')) return;
    const k = e.target.closest('.blk');
    if (k && k.dataset.b === CDPOP.bid) return; // a click on the same item toggles below
    closeCollected();
  },
  true,
);
document.addEventListener('click', e => {
  if (e.target.closest('.cdp-x')) return closeCollected();
  const r = e.target.closest('.cdp tr[data-ctag]');
  if (r && typeof openTrend === 'function') openTrend(r.dataset.ctag);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && CDPOP) {
    closeCollected();
    e.stopPropagation();
  }
}, true);
addEventListener('resize', () => CDPOP && cdPlace());
