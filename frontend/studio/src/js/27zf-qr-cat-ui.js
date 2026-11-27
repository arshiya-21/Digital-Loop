/*! SandMan Digital Loop Studio — 27zf-qr-cat-ui.js
 *  v10.4 — clearer Category QR scan page (phone first):
 *   header with an overall status line and 4 count tiles; each reading shows a status word (High / Low / OK),
 *   the value large, where it sits inside its limits (range bar), the trend arrow and the equipment.
 *  Same data and same behaviour as 27s (lock to scanned category, chips, 1 s refresh); only the look changes. */
function qcTrend(id) {
  const h = ((VAL[id] && VAL[id].h) || []).map(x => (typeof x === 'number' ? x : x && x.v)).filter(x => x != null);
  if (h.length < 6) return '';
  const a = h.slice(-12, -6),
    b = h.slice(-6),
    m = L => L.reduce((s, x) => s + x, 0) / L.length,
    t = REG[id],
    span = t && t.lo != null && t.hi != null ? t.hi - t.lo : Math.abs(m(a)) || 1,
    d = (m(b) - m(a)) / span;
  return d > 0.04 ? '<span class="qx-tr up" " title="Rising">▲</span>' : d < -0.04 ? '<span class="qx-tr dn" " title="Falling">▼</span>' : '<span class="qx-tr" " title="Steady"></span>';
}
function qcRange(id) {
  const t = REG[id],
    v = val(id);
  if (!t || v == null || t.lo == null || t.hi == null) return '';
  const lo0 = t.ll != null ? t.ll : t.lo - (t.hi - t.lo) * 0.25,
    hi0 = t.hh != null ? t.hh : t.hi + (t.hi - t.lo) * 0.25,
    a = Math.min(lo0, v),
    z = Math.max(hi0, v),
    P = x => ((x - a) / (z - a || 1)) * 100;
  return `<span class="qx-rg"><small>${t.lo}</small><span class="qx-bar"><i class="ok" style="left:${P(t.lo)}%;width:${P(t.hi) - P(t.lo)}%"></i><b style="left:${Math.min(100, Math.max(0, P(v)))}%"></b></span><small>${t.hi}</small></span>`;
}
qrCatHtml = function () {
  const all = qcDoc(),
    mb = !QS.lock && QS.machine ? DOC.blocks.find(x => x.name === QS.machine) : null,
    mids = mb ? new Set((mb.tags || []).map(t => t.id)) : null;
  const C = QS.lock ? all.filter(x => x.id === QS.lock || (QS.catName && x.name.toLowerCase() === String(QS.catName).toLowerCase())).slice(0, 1) : mids ? all.filter(x => x.tags.some(id => mids.has(id))) : all;
  if (!C.length)
    return `<div class="mc-wrap"><div class="qr-h1">Process Parameter</div><p class="mc-none">${QS.lock ? 'This process parameter is no longer set up in the loop. Check the QR sticker.' : mb ? `${esc(mb.name)} is not in any process parameter.` : 'No process parameters are set up for this loop yet. They are made in QR cards › Process Parameter QR.'}</p></div>`;
  let c = C.find(x => x.id === QS.cat);
  if (!c && QS.catName) c = C.find(x => x.name.toLowerCase() === String(QS.catName).toLowerCase());
  if (!c) c = C[0];
  QS.cat = c.id;
  const WORD = ['OK', 'Near limit', 'Warning', 'Critical'];
  const rows = c.tags.filter(id => REG[id]).map(id => {
    const t = REG[id],
      s = tagSev(id),
      v = val(id),
      b = qcTagOwner(id),
      dir = s && v != null ? (t.hi != null && v > (t.lo != null ? (t.lo + t.hi) / 2 : t.hi) ? 'High' : 'Low') : '',
      has = t.lo != null && t.hi != null,
      lim = has ? '' : t.lo != null || t.hi != null ? `Limit ${t.lo != null ? 'min ' + t.lo : 'max ' + t.hi}` : 'No limits set';
    return {
      s,
      h: (() => {
        const tx = String(tagTxt(id)), u = t.unit && tx.endsWith(' ' + t.unit) ? t.unit : '', num = u ? tx.slice(0, -u.length - 1) : tx;
        const lt = has ? `${t.lo} – ${t.hi}` : t.lo != null ? `min ${t.lo}` : t.hi != null ? `max ${t.hi}` : '—';
        return `<div class="qx-r qs${s}"><div class="qx-c1"><b>${esc(t.desc || t.short || id)}</b>${b ? `<small>${esc(b.name)}</small>` : ''}</div><div class="qx-c2"><span class="qx-num">${esc(num)}</span>${u ? ` <span class="qx-u">${esc(u)}</span>` : ''}${s ? `<em>${dir}</em>` : ''}</div><div class="qx-c3">${lt}${u && lt !== '—' ? ` <span class="qx-u">${esc(u)}</span>` : ''}</div></div>`;
      })(),
    };
  });
  const cnt = [3, 2, 1, 0].map(k => rows.filter(r => r.s === k).length),
    bad = cnt[0] + cnt[1] + cnt[2];
  rows.sort((a, z) => z.s - a.s);
  const missing = c.tags.length - rows.length,
    worst = cnt[0] ? 3 : cnt[1] ? 2 : cnt[2] ? 1 : 0;
  const tile = (n, l, k) => `<div class="qx-t qt${k}${n ? '' : ' z'}"><b>${n}</b><span>${l}</span></div>`;
  return `<div class="mc-wrap qx">${C.length < 2 ? '' : `<div class="qr-chips">${C.map(x => `<button data-qrc="${x.id}" class="${x.id === c.id ? 'on' : ''}" style="--c:${esc(x.color)}">${esc(x.name)}</button>`).join('')}</div>`}
   <div class="qx-h"><div class="qx-ht"><div class="qx-hn">${esc(c.name)}</div>${c.desc ? `<div class="qx-hd">${esc(c.desc)}</div>` : ''}</div><div class="qx-cs">${[[cnt[0], 'Critical', 3], [cnt[1], 'Warning', 2], [cnt[2], 'Near', 1], [cnt[3], 'OK', 0]].map(x => `<div class="${x[0] ? 'qt' + x[2] : ''}"><b>${x[0]}</b>${x[1]}</div>`).join('')}</div></div>
   <div class="qx-sec"><span>Live readings</span><span class="qx-live"><i></i>${new Date().toLocaleTimeString('en-GB')}</span></div>
   <div class="qx-tb"><div class="qx-r qx-hdr"><div class="qx-c1">Parameter</div><div class="qx-c2">Value</div><div class="qx-c3">Limits</div></div>${rows.map(r => r.h).join('')}</div>${rows.length ? '' : '<div class="mc-none">No readings in this process parameter yet.</div>'}${missing > 0 ? `<p class="mc-none">${missing} tag${missing > 1 ? 's are' : ' is'} no longer in the loop.</p>` : ''}
   <div class="mc-foot">ORBIX Digital Loop · ${esc(DOC.name || '')}</div></div>`;
};
document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
.qx{max-width:560px}
.qx-h{background:#fff;border:1px solid #e4e9f0;border-radius:12px;overflow:hidden}.qx-ht{padding:10px 12px}
.qx-hn{font-size:18px;font-weight:800;color:#0e2d5c;line-height:1.2}.qx-hd{color:#667085;font-size:12px;margin-top:1px}
.qx-cs{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid #eef2f6;text-align:center}
.qx-cs div{padding:5px 0;font-size:11px;color:#667085;border-left:1px solid #eef2f6}.qx-cs div:first-child{border-left:0}.qx-cs b{display:block;font-size:15px;color:#98a2b3}
.qx-cs .qt3{background:#fef3f2}.qx-cs .qt3 b{color:#b42318}.qx-cs .qt2{background:#fff4ed}.qx-cs .qt2 b{color:#c4320a}.qx-cs .qt1{background:#fefbe8}.qx-cs .qt1 b{color:#a15c07}.qx-cs .qt0{background:#ecfdf3}.qx-cs .qt0 b{color:#067647}
.qx-sec{display:flex;justify-content:space-between;align-items:center;margin:12px 2px 6px;font:700 12px var(--ui,Inter,sans-serif);letter-spacing:.06em;text-transform:uppercase;color:#475467}
.qx-live{letter-spacing:0;text-transform:none;font-weight:600;color:#667085;display:flex;align-items:center;gap:6px}.qx-live i{width:8px;height:8px;border-radius:50%;background:#12b76a;box-shadow:0 0 0 3px #d1fadf}
.qx-tb{background:#fff;border:1px solid #e4e9f0;border-radius:12px;overflow:hidden}
.qx-r{display:grid;grid-template-columns:1fr auto 92px;gap:10px;align-items:center;padding:10px 12px;border-top:1px solid #eef2f6;border-left:3px solid transparent}
.qx-r.qs1{border-left-color:#eab308}.qx-r.qs2{border-left-color:#f97316;background:#fffaf5}.qx-r.qs3{border-left-color:#dc2626;background:#fff7f7}
.qx-hdr{border-top:0;background:#f8fafc;padding:7px 12px;font-size:11px;font-weight:700;color:#667085;text-transform:uppercase;letter-spacing:.05em}
.qx-c1 b{display:block;font-size:13.5px;font-weight:600;color:#101828;line-height:1.3}.qx-c1 small{font-size:11px;color:#98a2b3}
.qx-c2{text-align:right;white-space:nowrap}.qx-num{font-size:16px;font-weight:700;color:#101828;font-variant-numeric:tabular-nums}.qx-u{font-size:11.5px;color:#667085;font-weight:500}
.qx-c2 em{display:block;font-style:normal;font-size:10.5px;font-weight:700}
.qs1 .qx-num,.qs1 .qx-c2 em{color:#a15c07}.qs2 .qx-num,.qs2 .qx-c2 em{color:#c4320a}.qs3 .qx-num,.qs3 .qx-c2 em{color:#b42318}
.qx-c3{text-align:right;font-size:12.5px;color:#475467;white-space:nowrap;font-variant-numeric:tabular-nums}.qx-hdr .qx-c2,.qx-hdr .qx-c3{font-size:11px;color:#667085}
</style>`,
);
