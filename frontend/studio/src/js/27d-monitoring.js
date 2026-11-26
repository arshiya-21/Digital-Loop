/*! SandMan Process Flowsheet — 27d-monitoring.js
 *  v9.83 Item 2 — Parameters under monitoring.
 *  Top bar: "Parameters N · in limits · warning · alarm" (Simulate / Publish); click → the readings in warning / alarm.
 *  Each area (Area Box) shows the same counts on its header strip.
 *  Counted: numeric readings bound to equipment. In limits / warning / alarm only for readings that have limits and a
 *  value; readings without limits or without data are counted apart, so "in limits" is never claimed without a limit. */
function pmCount(blocks) {
  const seen = new Set(),
    C = { n: 0, ok: 0, warn: 0, alarm: 0, nolim: 0, nodata: 0, list: [] };
  blocks.forEach(b => {
    const E = EQ[b.type];
    if (!E || E.widget || !b.tags) return;
    b.tags.forEach(bt => {
      const t = REG[bt.id];
      if (!t || seen.has(bt.id) || tagIsText(t)) return;
      seen.add(bt.id);
      C.n++;
      const v = val(bt.id);
      const lim = ['hh', 'hi', 'lo', 'll'].some(k => t[k] != null) || (typeof alBand === 'function' && alBand(t));
      if (v == null || !isFinite(v)) return void C.nodata++;
      if (!lim) return void C.nolim++;
      const s = tagSev(bt.id);
      if (s >= 3) (C.alarm++, C.list.push([bt.id, b, 3]));
      else if (s === 2) (C.warn++, C.list.push([bt.id, b, 2]));
      else C.ok++;
    });
  });
  return C;
}
const pmWorst = C => (C.alarm ? 'out' : C.warn ? 'due' : 'ok');
function pmChipRefresh() {
  const c = $('#pmChip');
  if (!c) return;
  const on = MODE === 'monitor';
  c.hidden = !on;
  if (!on) return;
  const C = pmCount(DOC.blocks);
  const h = `<span class="cpl">Parameters </span>${C.n}<span class="pm-k pm-ok" title="In limits">${C.ok}</span><span class="pm-k pm-w" title="Warning">${C.warn}</span><span class="pm-k pm-a" title="Alarm">${C.alarm}</span>`;
  if (c._h !== h) {
    $('#pmChipT').innerHTML = h;
    c._h = h;
  }
  c.className = 'cpchip pmchip w-' + pmWorst(C);
  c.title = `Parameters under monitoring: ${C.n} · in limits ${C.ok} · warning ${C.warn} · alarm ${C.alarm}${C.nolim ? ` · ${C.nolim} without limits` : ''}${C.nodata ? ` · ${C.nodata} without data` : ''} — click for the list`;
}
function pmOpen() {
  const C = pmCount(DOC.blocks),
    row = ([id, b, s]) => {
      const t = REG[id],
        v = val(id);
      return `<button type="button" class="pm-r" data-pmt="${esc(id)}"><i class="pm-d pm-d${s}"></i><b>${esc(b.name)}</b><span>${esc(t.short || t.desc || id)}</span><span class="mono">${v == null ? '—' : esc(fmtN(v, t.d))} ${esc(t.unit || '')}</span><span class="mono pm-lim">${t.lo != null || t.hi != null ? `${t.lo != null ? fmtN(t.lo, t.d) : '…'} – ${t.hi != null ? fmtN(t.hi, t.d) : '…'}` : ''}</span></button>`;
    };
  const areas = afZones()
    .map(z => [afName(z), pmCount(afMembers(z))])
    .filter(([, c]) => c.n);
  openModal(
    `<h3 style="margin:0 0 4px">Parameters under monitoring</h3>
 <div class="pm-sum"><div><b>${C.n}</b><span>monitored</span></div><div class="pm-ok"><b>${C.ok}</b><span>in limits</span></div><div class="pm-w"><b>${C.warn}</b><span>warning</span></div><div class="pm-a"><b>${C.alarm}</b><span>alarm</span></div><div class="pm-g"><b>${C.nolim}</b><span>no limits set</span></div><div class="pm-g"><b>${C.nodata}</b><span>no data</span></div></div>
 ${areas.length ? `<table class="pm-at"><thead><tr><th>Area</th><th>Monitored</th><th>In limits</th><th>Warning</th><th>Alarm</th><th>No limits</th><th>No data</th></tr></thead><tbody>${areas.map(([n, c]) => `<tr><td>${esc(n)}</td><td>${c.n}</td><td class="pm-ok">${c.ok}</td><td class="pm-w">${c.warn}</td><td class="pm-a">${c.alarm}</td><td>${c.nolim}</td><td>${c.nodata}</td></tr>`).join('')}</tbody></table>` : ''}
 <div class="pm-h">In alarm or warning <span class="note">click a reading for its control chart</span></div>
 <div class="pm-l">${C.list.sort((a, b) => b[2] - a[2]).map(row).join('') || '<div class="note" style="padding:10px">Nothing in warning or alarm.</div>'}</div>
 <div class="mact"><button class="ib pri" id="pmClose">Close</button></div>`,
    'wide',
  );
  $('#pmClose').onclick = closeModal;
  $$('#mbox [data-pmt]').forEach(x => (x.onclick = () => openTrend(x.dataset.pmt)));
}
{
  const c = $('#pmChip');
  if (c) c.onclick = pmOpen;
}
/* area counters on the canvas, beside the area name (shortened when the strip is narrow) */
function pmDrawBadges() {
  const L = $('#Lpmbadge');
  if (!L) return;
  if (MODE !== 'monitor' || PREF.pmbadge === false) {
    if (L._h !== '') (L.innerHTML = ''), (L._h = '');
    return;
  }
  const h = afZones()
    .map(z => {
      const C = pmCount(afMembers(z));
      if (!C.n) return '';
      const R = afRect(z),
        x0 = R.x + afName(z).length * 7.6 + 30,
        pb = document.querySelector(`#Lpbadge .pbadge`) ? [...document.querySelectorAll('#Lpbadge .pbadge')].map(g => {
          const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
          return m && Math.abs(+m[2] - (R.y + 5)) < 2 && +m[1] > R.x && +m[1] < R.x + R.w ? +m[1] : null;
        }).filter(v => v != null) : [],
        xMax = (pb.length ? Math.min(...pb) : R.x + R.w) - 8,
        room = xMax - x0;
      const parts = [
        [`${C.n} parameters`, null],
        [String(C.ok), '#15803d'],
        [String(C.warn), '#c2410c'],
        [String(C.alarm), '#d93636'],
      ];
      const full = Math.round(parts[0][0].length * 6.3 + 3 * 26 + 18);
      const shortW = Math.round(String(C.n).length * 6.6 + 3 * 26 + 18);
      if (room < shortW) return '';
      const lab = full <= room ? parts[0][0] : String(C.n);
      let x = 10,
        s = `<text x="${x}" y="14" class="pm-bt">${esc(lab)}</text>`;
      x += Math.round(lab.length * (lab === parts[0][0] ? 6.3 : 6.6)) + 8;
      parts.slice(1).forEach(([v, col]) => {
        s += `<circle cx="${x + 4}" cy="10" r="4" fill="${col}"/><text x="${x + 11}" y="14" class="pm-bt">${v}</text>`;
        x += 11 + v.length * 6.6 + 8;
      });
      const w = Math.round(x + 2);
      return `<g class="pmbadge" transform="translate(${Math.round(x0)},${R.y + 5})"><title>${esc(afName(z))}: ${C.n} parameters under monitoring · ${C.ok} in limits · ${C.warn} warning · ${C.alarm} alarm${C.nolim ? ` · ${C.nolim} without limits` : ''}${C.nodata ? ` · ${C.nodata} without data` : ''}</title><rect width="${w}" height="20" rx="10" fill="#fff" stroke="${C.alarm ? '#d93636' : C.warn ? '#c2410c' : '#9fd3b4'}" stroke-width="1.2"/>${s}</g>`;
    })
    .join('');
  if (L._h !== h) (L.innerHTML = h), (L._h = h);
}
setInterval(() => {
  try {
    pmChipRefresh();
    pmDrawBadges();
  } catch (e) {}
}, 1000);
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="pmCss">
.pmchip .pm-k{display:inline-flex;align-items:center;gap:3px;margin-left:6px;font-weight:700}
.pmchip .pm-k::before{content:'';width:8px;height:8px;border-radius:50%;background:currentColor}
.pm-ok{color:#15803d}.pm-w{color:#c2410c}.pm-a{color:#d93636}.pm-sum .pm-g{color:var(--muted,#5b6b7b)}
#Lpmbadge .pm-bt{font:600 11px var(--sans);fill:#16212b}
#Lpmbadge .pmbadge{cursor:pointer}
.pm-sum{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:12px 0}
.pm-sum div{border:1px solid var(--line,#d6dde6);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column}
.pm-sum b{font:700 22px var(--sans)}.pm-sum span{font-size:12px;color:var(--muted,#5b6b7b)}
.pm-at{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:12px}
.pm-at th,.pm-at td{padding:5px 8px;border-bottom:1px solid var(--line,#e3e8ec);text-align:right}
.pm-at th:first-child,.pm-at td:first-child{text-align:left}
.pm-h{font:700 13px var(--sans);margin:6px 0}
.pm-l{max-height:40vh;overflow:auto;display:flex;flex-direction:column;gap:4px}
button.pm-r{display:grid;grid-template-columns:14px 90px 1fr 110px 110px;gap:8px;align-items:center;text-align:left;border:1px solid var(--line,#e3e8ec);background:var(--panel,#fff);border-radius:6px;padding:6px 8px;cursor:pointer;font-size:12.5px;color:var(--text,#16212b)}
button.pm-r:hover{border-color:#1f6feb}
.pm-d{width:10px;height:10px;border-radius:50%}.pm-d3{background:#d93636}.pm-d2{background:#c2410c}
.pm-lim{color:var(--muted,#5b6b7b)}
</style>`,
);
$('#Lpmbadge').addEventListener('pointerdown', e => {
  if (e.target.closest && e.target.closest('.pmbadge')) {
    e.stopPropagation();
    pmOpen();
  }
});
