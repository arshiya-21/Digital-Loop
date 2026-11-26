/*! SandMan Digital Loop Studio — 27zb-eng-basis.js
 *  v10.4 — engineered alerts get the same one-click choice as tags: "Alert on (pick one)"
 *    Limits · Nelson rules · Drift · Forecast · Stuck / no data — on the alert's value (the calculation, or tag A)
 *    Conditions — the combination of several tags (A > x AND B < y), as before
 *  Limits: Critical low · Min · Max · Critical high on the value; Warning / Critical follows the limit crossed.
 *  Stored on the rule: r.basis ('cond' when missing), r.lim = { ll, lo, hi, hh }. */

const EB = [
  ['lim', 'Limits'],
  ['spc', 'Nelson rules'],
  ['drift', 'Drift'],
  ['fc', 'Forecast'],
  ['stuck', 'Stuck / no data'],
  ['cond', 'Conditions'],
];
const ebBasis = r => r.basis || 'cond';
function ebValue(r, V) {
  return r.calc && r.calc.expr ? V.X : V.A;
}
function ebValName(r) {
  return r.calc && r.calc.expr ? (r.calc && r.calc.name) || 'Calculation' : engVarName(r, 'A');
}
{
  const prev = engEval;
  engEval = function (r) {
    const ev = prev(r),
      b = ebBasis(r);
    if (b === 'cond') return (r._sevNow = null), ev;
    const v = ebValue(r, ev.V),
      now = Date.now(),
      L = r.lim || {};
    let ok = false,
      sev = r.sev || 2;
    if (v == null || !isFinite(v)) return Object.assign(ev, { ok: false, missing: true });
    const buf = engBuf(r, 'basis', null, v, now);
    if (b === 'lim') {
      const n = k => (L[k] != null && L[k] !== '' ? +L[k] : null);
      if ((n('ll') != null && v < n('ll')) || (n('hh') != null && v > n('hh'))) (ok = true), (sev = 3);
      else if ((n('lo') != null && v < n('lo')) || (n('hi') != null && v > n('hi'))) (ok = true), (sev = 2);
    } else if (b === 'spc') ok = engStatTest((r._ebc = r._ebc && r._ebc.op === 'spc' ? r._ebc : { op: 'spc', v: 1, v2: 300 }), buf, v) === true;
    else if (b === 'drift') ok = engStatTest((r._ebc = r._ebc && r._ebc.op === 'ewma' ? r._ebc : { op: 'ewma', v: 0.2, v2: 300 }), buf, v) === true;
    else if (b === 'fc') {
      for (const k of ['hi', 'lo']) {
        if (L[k] == null || L[k] === '') continue;
        const c = (r['_fc' + k] = r['_fc' + k] || { op: 'predict', v2: 30, v3: 60 });
        c.v = +L[k];
        if (engStatTest(c, buf, v) === true) ok = true;
      }
    } else if (b === 'stuck') {
      const s = (r._st0 = r._st0 && r._st0.v === v ? r._st0 : { v, since: now });
      ok = now - s.since > 15 * 60000;
    }
    if (r.runOnly && !ev.running) ok = false;
    r._sevNow = ok ? sev : null;
    return Object.assign(ev, { ok, missing: false });
  };
}
/* severity of a Limits alert follows the limit crossed */
{
  const prev = raise;
  raise = function (key, sev, info) {
    if (sev > 0 && key.startsWith('eng:')) {
      const r = engDoc().rules.find(x => 'eng:' + x.id === key);
      if (r && ebBasis(r) === 'lim' && r._sevNow) sev = r._sevNow;
    }
    return prev.call(this, key, sev, info);
  };
}
/* text and automatic name */
{
  const tPrev = engCondText;
  engCondText = function (r) {
    const b = ebBasis(r);
    if (b === 'cond') return tPrev(r);
    const n = ebValName(r),
      L = r.lim || {},
      f = x => (x == null || x === '' ? '—' : x);
    const run = r.runOnly ? ' (while running)' : '';
    if (b === 'lim') return `${n} outside ${f(L.lo)} – ${f(L.hi)} (critical ${f(L.ll)} – ${f(L.hh)})${run}`;
    if (b === 'spc') return `${n} breaks a Nelson rule${run}`;
    if (b === 'drift') return `${n} drifting from its normal level${run}`;
    if (b === 'fc') return `${n} will reach ${f(L.lo)} or ${f(L.hi)} within 30 min${run}`;
    return `${n} not changing for 15 min${run}`;
  };
  const nPrev = engAutoName;
  engAutoName = function (r) {
    const b = ebBasis(r);
    if (b === 'cond') return nPrev(r);
    return `${ebValName(r)} ${{ lim: 'Out of limit', spc: 'Out of control', drift: 'Drifting', fc: 'Heading to limit', stuck: 'Not changing' }[b]}`;
  };
}
/* editor: the choice on top; condition rows only for "Conditions" */
{
  const prev = emEdit;
  emEdit = function (E) {
    let h = prev(E);
    const r = EM.edit;
    if (!r) return h;
    const b = ebBasis(r),
      L = r.lim || {};
    const num = (k, lab, cls) => `<div class="fld eb-${cls}"><label>${lab}</label><input type="number" step="any" data-ebl="${k}" value="${L[k] != null ? esc(L[k]) : ''}"></div>`;
    const top = `<div class="em-sh">Alert on (pick one)</div><div class="eb-ch">${EB.map(([k, l]) => `<button type="button" data-eb="${k}" class="${b === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="note eb-what">${b === 'cond' ? 'A combination of the parameters, e.g. A above x AND B below y.' : `On <b>${esc(ebValName(r))}</b> ${r.calc && r.calc.expr ? '(the calculation)' : '(parameter A)'}.`}</div>
      ${b === 'lim' || b === 'fc' ? `<div class="eb-lim">${num('ll', 'Critical low', 'c3')}${num('lo', 'Min', 'c2')}${num('hi', 'Max', 'c2')}${num('hh', 'Critical high', 'c3')}</div>${b === 'lim' ? '<div class="note">Outside Min / Max → Warning · outside Critical → Critical (severity set automatically).</div>' : ''}` : ''}`;
    h = h.replace('<div class="em-sh">Condition and threshold</div>', `${top}<div class="eb-cond${b === 'cond' ? '' : ' eb-hide'}"><div class="em-sh">Conditions</div>`);
    h = h.replace(/(<label class="chk"><input type="checkbox" data-er="runOnly")/, '</div>$1');
    if (b === 'lim') h = h.replace(/<div class="em-row"><label>Severity<\/label>[\s\S]*?<\/span><\/div>/, '');
    return h;
  };
}
document.addEventListener(
  'click',
  e => {
    const t = e.target.closest && e.target.closest('[data-eb]');
    if (!t || !EM || !EM.edit) return;
    EM.edit.basis = t.dataset.eb;
    if (EM.edit.basis === 'cond') EM.edit.conds = (EM.edit.conds || []).filter(c => !c._basis);
    if (EM.edit.autoName !== false) EM.edit.name = engAutoName(EM.edit);
    const bd = $('#emBody');
    if (bd) bd._h = null;
    emRender();
  },
  true,
);
document.addEventListener(
  'change',
  e => {
    const i = e.target;
    if (!i.matches || !i.matches('[data-ebl]') || !EM || !EM.edit) return;
    EM.edit.lim = Object.assign({}, EM.edit.lim, { [i.dataset.ebl]: i.value === '' ? null : +i.value });
    const bd = $('#emBody');
    if (bd) bd._h = null;
    emRender();
  },
  true,
);
/* saving a rule without conditions is fine when the basis is not "Conditions" */
document.addEventListener(
  'click',
  e => {
    if (!EM || !EM.edit || ebBasis(EM.edit) === 'cond') return;
    const t = e.target;
    if (t && t.id && /^emSave|^emRuleSave|emEdSave/.test(t.id) && !(EM.edit.conds || []).length) EM.edit.conds = [{ l: EM.edit.calc && EM.edit.calc.expr ? 'X' : 'A', op: 'basis', v: 0, _basis: 1 }];
  },
  true,
);
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="ebCss">
.eb-ch{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0 6px}.eb-ch button{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:4px 12px;font:600 12.5px var(--sans);cursor:pointer;color:var(--text)}.eb-ch button.on{background:#1f6feb;border-color:#1f6feb;color:#fff}
.eb-what{margin-bottom:6px}.eb-lim{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.eb-lim input{width:100%;box-sizing:border-box}.eb-c3 label{color:#b91c1c}.eb-c2 label{color:#b45309}
.eb-hide{display:none}
</style>`,
);
