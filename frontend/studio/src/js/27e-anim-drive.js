/*! SandMan Process Flowsheet — 27e-anim-drive.js
 *  v9.83 Item 3 — data-driven animation.
 *  Each equipment can have a drive tag (Properties › Equipment › Animation):
 *    · Moulds per hour (moulding line / pouring unit): one mould step = 3,600 ÷ moulds per hour seconds (e.g. 70 → 51 s)
 *    · Speed from a reading (belt speed, motor current, …): animation speed = reading ÷ its normal value
 *  0 or no value → the drawing stands still. No drive tag → today's fixed animation. Stopped equipment stops as before.
 *  How: every Digital Loop drawing times its motion with --sm-speed (and the moulding line with --mm-cycle); the running
 *  picture is made with those values set, in steps, and cached. */
function drvOf(b) {
  const d = b && b.props && b.props.drive;
  return d && d.tag && REG[d.tag] && d.mode && d.mode !== 'fixed' ? d : null;
}
/* the live drive key: '' (fixed), 'stop', 'c<sec>' (mould cycle) or 's<factor>' (speed) */
function drvKey(b) {
  const d = drvOf(b);
  if (!d || MODE !== 'monitor') return '';
  const v = val(d.tag);
  if (v == null || !isFinite(v) || v <= 0) return 'stop';
  if (d.mode === 'rate') {
    const c = clamp(3600 / v, 0.5, 900);
    return 'c' + (c < 10 ? Math.round(c * 10) / 10 : Math.round(c));
  }
  const ref = +d.ref > 0 ? +d.ref : REG[d.tag].typ > 0 ? REG[d.tag].typ : null;
  if (!ref) return '';
  const f = clamp(v / ref, 0.1, 5);
  return 's' + (f < 1 ? Math.round(f * 20) / 20 : Math.round(f * 10) / 10);
}
function drvText(b) {
  const d = drvOf(b);
  if (!d) return '';
  const t = REG[d.tag],
    v = val(d.tag),
    k = drvKey(b);
  if (MODE !== 'monitor') return 'Takes effect in Simulate / Publish';
  if (k === 'stop') return `${t.short || t.id} is ${v == null ? 'not available' : fmtN(v, t.d) + ' ' + (t.unit || '')} — the drawing stands still`;
  if (k[0] === 'c') return `${fmtN(v, t.d)} moulds/h → one mould every ${k.slice(1)} s`;
  if (k[0] === 's') return `${fmtN(v, t.d)} ${t.unit || ''} → ${Math.round(+k.slice(1) * 100)} % of normal speed`;
  return 'Set the normal value to scale the speed';
}
var smlibUrlDrv0 = smlibUrl;
smlibUrl = function (id, v, pal, paint, lv, dk) {
  if (!dk || v !== 'run') return smlibUrlDrv0(id, v, pal, paint, lv);
  if (dk === 'stop') return smlibUrlDrv0(id, 'still', pal, paint, lv);
  const key = 'drv:' + [id, v, pal, paint, lv, dk].join(':');
  if (SMLIB_URL[key]) return SMLIB_URL[key];
  const u = smlibUrlDrv0(id, v, pal, paint, lv);
  let s = decodeURIComponent(u.slice(u.indexOf(',') + 1));
  const vars = dk[0] === 'c' ? `--mm-cycle:${dk.slice(1)}s;--sm-speed:1;` : `--sm-speed:${dk.slice(1)};`;
  s = /<svg[^>]*\bstyle="/.test(s) ? s.replace(/(<svg[^>]*\bstyle=")/, '$1' + vars) : s.replace(/<svg\b/, `<svg style="${vars}"`);
  return (SMLIB_URL[key] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s));
};
{
  const _sync = smLvSync;
  smLvSync = function (b, g) {
    _sync(b, g);
    if (!g) return;
    const k = drvKey(b);
    /* built-in drawings (belts …) move with canvas animations: scale them on the equipment itself */
    if (g.dataset.drv !== k) {
      g.dataset.drv = k;
      if (k && k[0] === 's') g.style.setProperty('--drv', k.slice(1));
      else g.style.removeProperty('--drv');
    }
    g.querySelectorAll('image.smi-run').forEach(el => {
      const p = el.getAttribute('data-smi').split('|');
      while (p.length < 6) p.push('');
      if (p[5] === k) return;
      p[5] = k;
      el.setAttribute('data-smi', p.join('|'));
      smlibSet(el);
    });
  };
}
/* Properties › Equipment: the Animation section (only for drawings that move) */
function drvSection(b) {
  const E = EQ[b.type],
    d = (b.props && b.props.drive) || {},
    mode = d.mode && d.tag ? d.mode : d.mode || 'fixed',
    isMould = /disa|mould|mold|pouring/i.test(b.type + ' ' + (E.n || ''));
  const tags = b.tags.map(t => t.id).filter(id => REG[id] && !tagIsText(REG[id]));
  const all = Object.keys(REG).filter(id => !tagIsText(REG[id]) && !tags.includes(id));
  const opt = id => `<option value="${esc(id)}" ${d.tag === id ? 'selected' : ''}>${esc(REG[id].short || REG[id].desc || id)} — ${esc(id)}</option>`;
  return `<section class="ix-sec drv" id="drvSec"><h4>Animation <span class="ix-sum">${mode === 'fixed' ? 'fixed' : mode === 'rate' ? 'moulds per hour' : 'follows a reading'}</span></h4>
  <div class="lc2-seg drv-m">${[['fixed', 'Fixed'], ...(isMould || mode === 'rate' ? [['rate', 'Moulds/hour']] : []), ['speed', 'From a reading']].map(([m, l]) => `<button type="button" data-drvm="${m}" aria-pressed="${mode === m}">${l}</button>`).join('')}</div>
  ${mode === 'fixed' ? `<p class="lc2-note">The drawing moves at its own fixed pace while the equipment runs, and stops when it stops.${isMould ? ' Choose <b>Moulds per hour</b> to move one mould every 3,600 ÷ moulds-per-hour seconds.' : ''}</p>` : `
  <div class="fld"><label>${mode === 'rate' ? 'Moulds-per-hour tag' : 'Reading that sets the speed'}</label><select id="drvTag"><option value="">Choose…</option>${tags.length ? `<optgroup label="${esc(b.name)}">${tags.map(opt).join('')}</optgroup>` : ''}<optgroup label="Other tags">${all.map(opt).join('')}</optgroup></select></div>
  ${mode === 'speed' ? `<div class="fld"><label>Normal value (= normal speed)</label><input id="drvRef" type="number" step="any" value="${d.ref != null ? esc(d.ref) : ''}" placeholder="${d.tag && REG[d.tag] && REG[d.tag].typ != null ? 'tag typical: ' + REG[d.tag].typ : 'e.g. 120'}"></div>` : ''}
  <div class="drv-now" id="drvNow">${d.tag ? esc(drvText(b)) : 'Choose the tag'}</div>
  <p class="lc2-note">No value or 0 → the drawing stands still. Stopped equipment stops as before; equipment in alarm shows its alarm colour.</p>`}</section>`;
}
{
  const _rp = renderProps;
  renderProps = function () {
    _rp();
    try {
      const b = SEL && SEL.t === 'b' ? B(SEL.id) : null;
      if (!b || PTAB !== 'eq' || RP || !EQ[b.type] || EQ[b.type].widget || !((EQ[b.type].def && EQ[b.type].def.anim2) || b.type === 'belt')) return;
      const P = $('#props');
      if (P.querySelector('#drvSec')) return;
      const at = P.querySelector('#lc2') || [...P.querySelectorAll('.ix-sec')].find(s => /Readings/.test(s.querySelector('h4')?.textContent || ''));
      const html = drvSection(b);
      at ? at.insertAdjacentHTML('beforebegin', html) : P.insertAdjacentHTML('beforeend', html);
      const S = P.querySelector('#drvSec'),
        set = o => {
          pushUndo();
          b.props.drive = Object.assign({}, b.props.drive || {}, o);
          if (b.props.drive.mode === 'fixed') delete b.props.drive;
          changed();
          renderProps();
        };
      S.querySelectorAll('[data-drvm]').forEach(x => (x.onclick = () => set({ mode: x.dataset.drvm })));
      const t = S.querySelector('#drvTag');
      if (t) t.onchange = () => set({ tag: t.value || null });
      const r = S.querySelector('#drvRef');
      if (r) r.onchange = () => set({ ref: r.value === '' ? null : +r.value });
    } catch (e) {}
  };
}
setInterval(() => {
  const n = document.getElementById('drvNow'),
    b = SEL && SEL.t === 'b' ? B(SEL.id) : null;
  if (n && b && drvOf(b)) n.textContent = drvText(b);
}, 1000);
document.head.insertAdjacentHTML('beforeend', `<style>
#cv.live .blk.run[data-drv^="s"] .beltd{animation-duration:calc(.8s / var(--drv,1))}
#cv.live .blk.run[data-drv^="s"] .sandflow{animation-duration:calc(.9s / var(--drv,1))}
#cv.live .blk.run[data-drv="stop"] .beltd,#cv.live .blk.run[data-drv="stop"] .sandflow,#cv.live .blk.run[data-drv="stop"] .glow,#cv.live .blk.run[data-drv="stop"] .fall{animation-play-state:paused}
.drv .drv-m{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;margin:4px 0 8px}.drv .drv-m button{white-space:nowrap}.drv .fld select,.drv .fld input{width:100%;box-sizing:border-box}.drv-now{font:600 12.5px var(--sans);padding:6px 8px;border-radius:6px;background:var(--bg2,#f1f5f9);margin:6px 0}</style>`);
