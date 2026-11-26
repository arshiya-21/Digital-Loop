/*! SandMan Digital Loop Studio — 27v-calc-trend.js
 *  v10.4 — a calculated value (ƒx) opens a plain trend, not the control chart: live value, the line over 5 min / 15 min /
 *  1 h / 8 h, limits if set, min · avg · max of the window, and the formula with its inputs. Updates every second. */

const CTT = { id: null, win: 15, t: null, hist: null, busy: false };
let ctCtrlChart = null;
{
  const prev = openTrend;
  ctCtrlChart = id => prev(id);
  openTrend = function (id) {
    if (REG[id] && REG[id].calc) return ctTrendOpen(id);
    return prev.apply(this, arguments);
  };
}
function ctTrendOpen(id) {
  CTT.id = id;
  openModal('<div id="cttBox"></div>', 'wide');
  ctTrendDraw();
  clearInterval(CTT.t);
  CTT.t = setInterval(() => {
    if (!$('#cttBox')) return clearInterval(CTT.t);
    if (!document.hidden) ctTrendDraw();
  }, 1000);
}
function ctTrendDraw() {
  const box = $('#cttBox'),
    id = CTT.id,
    t = REG[id];
  if (!box || !t) return;
  const C = (DOC.calc || []).find(c => c.id === t.calc) || {};
  const V = VAL[id] || {},
    now = Date.now(),
    from = now - CTT.win * 60000;
  const long = CTT.win > 15;
  if (long && (!CTT.hist || CTT.hist.win !== CTT.win || CTT.hist.id !== id || now - CTT.hist.at > 60000) && !CTT.busy) {
    CTT.busy = true;
    const w = CTT.win;
    ctHistory(id, now - w * 60000, now)
      .then(h => (CTT.hist = { id, win: w, at: Date.now(), pts: h }))
      .catch(e => (CTT.hist = { id, win: w, at: Date.now(), pts: [], err: String(e && e.message || e) }))
      .finally(() => ((CTT.busy = false), ctTrendDraw()));
  }
  const live = (V.h || []).filter(p => p.t >= from);
  const pts = (long ? [...((CTT.hist && CTT.hist.win === CTT.win && CTT.hist.id === id && CTT.hist.pts) || []).filter(p => !live.length || p.t < live[0].t), ...live] : V.h || []).filter(p => p.t >= from && p.v != null && isFinite(p.v));
  const W = 860,
    H = 300,
    L = 64,
    R = 16,
    T = 14,
    Bm = 30;
  let lo = Math.min(...pts.map(p => p.v)),
    hi = Math.max(...pts.map(p => p.v));
  [t.lo, t.hi].forEach(x => x != null && ((lo = Math.min(lo, x)), (hi = Math.max(hi, x))));
  if (!isFinite(lo)) (lo = 0), (hi = 1);
  if (hi - lo < 1e-9) (lo -= 1), (hi += 1);
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const x0 = pts.length ? Math.max(from, pts[0].t - 2000) : from;
  const X = tt => L + ((tt - x0) / (now - x0)) * (W - L - R),
    Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - Bm);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const area = pts.length ? `${line}L${X(pts[pts.length - 1].t).toFixed(1)},${H - Bm}L${X(pts[0].t).toFixed(1)},${H - Bm}Z` : '';
  const yt = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const xt = Array.from({ length: 6 }, (_, i) => x0 + ((now - x0) * i) / 5);
  const fmt = v => fmtN(v, t.d);
  const hm = ms => (CTT.win > 1440 ? new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' : '') + new Date(ms).toLocaleTimeString('en-GB', CTT.win <= 15 ? {} : { hour: '2-digit', minute: '2-digit' });
  const lim = (v, c, n) => (v == null ? '' : `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c}" stroke-dasharray="6 4" stroke-width="1.3"/><text x="${W - R - 4}" y="${Y(v) - 4}" text-anchor="end" fill="${c}" font-size="11" font-weight="600">${n} ${fmt(v)}</text>`);
  const vs = pts.map(p => p.v),
    avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  const cur = V.v,
    bad = cur != null && ((t.lo != null && cur < t.lo) || (t.hi != null && cur > t.hi));
  const u = t.unit ? ' ' + esc(t.unit) : '';
  const blk = B(t.calcOf) || (DOC.blocks || []).find(b => (b.tags || []).some(x => x.id === id));
  box.innerHTML = `<div class="ctt-h"><div><div class="ctt-n"><span class="ctt-fx">ƒx</span>${esc(String(t.short || t.desc || id).replace(/^ƒx\s*/, ''))}</div><div class="ctt-s">${blk ? esc(blk.name) + ' · ' : ''}Calculated value${t.desc && t.desc !== t.short ? ' · ' + esc(t.desc) : ''}</div></div>
   <div class="ctt-v${bad ? ' bad' : ''}">${cur == null ? '—' : fmt(cur)}<small>${u}</small><span>${cur == null ? 'No value' : bad ? 'Outside limits' : t.lo != null || t.hi != null ? 'Within limits' : 'Live'}</span></div></div>
   <div class="ctt-bar"><div class="lc2-seg">${[5, 15, 60, 480, 1440, 10080].map(m => `<button data-cttw="${m}" aria-pressed="${CTT.win === m}">${m < 60 ? m + ' min' : m < 1440 ? m / 60 + ' h' : m === 1440 ? '24 h' : '7 days'}</button>`).join('')}</div>
    <div class="ctt-k"><span>Min <b>${vs.length ? fmt(Math.min(...vs)) : '—'}</b></span><span>Avg <b>${avg == null ? '—' : fmt(avg)}</b></span><span>Max <b>${vs.length ? fmt(Math.max(...vs)) : '—'}</b></span><span>Points <b>${vs.length}</b></span></div><button class="ib" id="cttCC" style="margin-left:auto">Control chart</button></div>
   <svg class="ctt-c" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend">
    ${yt.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line,#e5e7eb)"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted,#64748b)">${fmt(v)}</text>`).join('')}
    ${xt.map(x => `<text x="${X(x)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--muted,#64748b)">${hm(x)}</text>`).join('')}
    ${lim(t.hi, '#dc2626', 'Max')}${lim(t.lo, '#dc2626', 'Min')}
    <path d="${area}" fill="#7c3aed" opacity=".08"/><path d="${line}" fill="none" stroke="#6d28d9" stroke-width="2" stroke-linejoin="round"/>
    ${pts.length ? `<circle cx="${X(pts[pts.length - 1].t)}" cy="${Y(pts[pts.length - 1].v)}" r="4" fill="${bad ? '#dc2626' : '#6d28d9'}"/>` : ''}
    ${!pts.length ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--muted)" font-size="13">No values in this window yet — the trend fills as values come in.</text>` : ''}
   </svg>
   ${C.expr ? `<div class="ctt-f"><div class="ctt-fl">Formula</div><pre>${esc(C.expr)}</pre></div>` : ''}
   <div class="ctt-nt">${long ? (CTT.busy && !(CTT.hist && CTT.hist.win === CTT.win) ? 'Working out the history…' : CTT.hist && CTT.hist.err ? 'History not available: ' + esc(CTT.hist.err) : `Worked out from the inputs' history${ctHistSource() === 'server' ? ' (SandMan server)' : ' — <b>demo history</b>: the SandMan history service is not connected'} · one point every ${Math.max(5, Math.round((CTT.win * 60) / 600))} s · nothing extra is stored.`) : 'Live — worked out every second.'}</div>`;
  $('#cttCC').onclick = () => (clearInterval(CTT.t), closeModal(), ctCtrlChart(id));
  $$('#cttBox [data-cttw]').forEach(b => (b.onclick = () => ((CTT.win = +b.dataset.cttw), ctTrendDraw())));
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="cttCss">
.ctt-h{display:flex;align-items:center;gap:16px}.ctt-n{font:700 20px var(--sans);display:flex;align-items:center;gap:8px}.ctt-fx{background:#6d28d9;color:#fff;border-radius:6px;padding:1px 7px;font:700 14px var(--mono)}.ctt-s{color:var(--muted);font-size:12.5px;margin-top:2px}
.ctt-v{margin-left:auto;font:700 30px var(--mono);text-align:right;color:var(--text)}.ctt-v small{font-size:14px;color:var(--muted);margin-left:4px}.ctt-v span{display:block;font:600 11.5px var(--sans);color:#15803d}.ctt-v.bad{color:#dc2626}.ctt-v.bad span{color:#dc2626}
.ctt-bar{display:flex;align-items:center;gap:16px;margin:12px 0 6px;flex-wrap:wrap}.ctt-k{display:flex;gap:16px;font-size:12.5px;color:var(--muted)}.ctt-k b{color:var(--text);font-family:var(--mono);margin-left:4px}
.ctt-c{width:100%;height:auto;display:block}
.ctt-f{margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:8px 10px}.ctt-fl{font:700 11px var(--sans);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.ctt-f pre{margin:4px 0 0;font:12.5px var(--mono);white-space:pre-wrap}
.ctt-nt{margin-top:6px;font-size:11.5px;color:var(--muted)}
</style>`,
);
