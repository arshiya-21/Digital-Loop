/*! SandMan Digital Loop Studio — 27zh-eng-editor-ui.js
 *  v10.4 — clearer Engineered alert editor. Same fields and the same logic; only arranged as 4 numbered steps:
 *   1 What to watch (equipment, parameters A–D, optional calculation)
 *   2 When to alert (Alert on · conditions · must last)
 *   3 What the operator sees (severity, cause, action)
 *   4 Who is told (teams, escalation, ticket)
 *  A live status strip on top shows the automatic name and whether the condition is true right now.
 *  The A–D lists group the tags: ƒx calculated fields first, then the chosen equipment, then every other equipment. */
{
  const prev = emRender;
  emRender = function () {
    const r = prev.apply(this, arguments);
    try {
      ezShape();
    } catch (e) {
      console.error(e);
    }
    return r;
  };
}
const EZ = { more: false, calc: false };
function ezGroupTags(sel, eqId) {
  if (sel.dataset.ezg) return;
  sel.dataset.ezg = 1;
  const opts = [...sel.options].filter(o => o.value);
  const cur = sel.value;
  const fx = [],
    by = {};
  opts.forEach(o => {
    const t = REG[o.value];
    const label = t ? `${String(t.short || t.desc || o.value).replace(/^ƒx\s*/, '')}` : o.textContent;
    if (t && t.calc) return fx.push([o.value, 'ƒx ' + label]);
    const b = typeof qcTagOwner === 'function' ? qcTagOwner(o.value) : null;
    const g = b ? b.name : 'Other tags';
    (by[g] = by[g] || { id: b && b.id, L: [] }).L.push([o.value, label]);
  });
  const own = Object.entries(by).filter(([, v]) => v.id === eqId),
    rest = Object.entries(by)
      .filter(([, v]) => v.id !== eqId)
      .sort((a, z) => a[0].localeCompare(z[0], undefined, { numeric: true }));
  const og = (n, L) => `<optgroup label="${esc(n)}">${L.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</optgroup>`;
  sel.innerHTML =
    '<option value="">— choose a tag —</option>' +
    (fx.length ? og('ƒx Calculated fields', fx) : '') +
    own.map(([n, v]) => og(n + ' (this equipment)', v.L)).join('') +
    rest.map(([n, v]) => og(n, v.L)).join('');
  sel.value = cur;
}
function ezShape() {
  const ed = $('#emBody .em-ed');
  if (!ed || ed.dataset.ez) return;
  ed.dataset.ez = 1;
  const body = $('#emBody'),
    L = ed.querySelector('.em-ed-l'),
    R = ed.querySelector('.em-ed-r');
  const r = EM.edit || {};
  const card = (n, t, s) => {
    const c = document.createElement('section');
    c.className = 'ez-card';
    c.innerHTML = `<div class="ez-ch"><span class="ez-n">${n}</span><div><b>${t}</b><small>${s}</small></div></div><div class="ez-cb"></div>`;
    return c;
  };
  const c1 = card(1, 'What to watch', 'Equipment and the tags or ƒx fields used'),
    c2 = card(2, 'When to alert', 'Pick one basis, then its condition'),
    c3 = card(3, 'What the operator sees', 'Severity, likely cause and action'),
    c4 = card(4, 'Who is told', 'Teams, escalation and ticket');
  const b1 = c1.lastChild,
    b2 = c2.lastChild,
    b3 = c3.lastChild,
    b4 = c4.lastChild;
  const kids = [...L.children, ...R.children];
  const fld = sel => kids.find(k => k.querySelector && k.querySelector(sel));
  const nameF = fld('[data-er="name"]'),
    eqF = fld('[data-er="equip"]'),
    now = L.querySelector('.em-now'),
    vars = [...L.querySelectorAll('.em-var')],
    calcRow = L.querySelector('.em-calc'),
    calcBad = L.querySelector('.em-bad');
  /* status strip */
  const top = document.createElement('div');
  top.className = 'ez-top';
  if (nameF) {
    nameF.classList.add('ez-name');
    top.appendChild(nameF);
  }
  if (now) {
    now.classList.toggle('ez-true', /condition true/.test(now.textContent));
    top.appendChild(now);
  }
  /* 1 */
  if (eqF) b1.appendChild(eqF);
  const vh = document.createElement('div');
  vh.className = 'ez-sub';
  vh.textContent = 'Parameters (A – D)';
  b1.appendChild(vh);
  const used = vars.map(v => !!v.querySelector('select').value);
  vars.forEach((v, i) => {
    ezGroupTags(v.querySelector('select'), r.equip);
    if (i >= 2 && !used[i] && !EZ.more) v.hidden = true;
    b1.appendChild(v);
  });
  if (!EZ.more && vars.some(v => v.hidden)) {
    const m = document.createElement('button');
    m.type = 'button';
    m.className = 'ez-link';
    m.textContent = '＋ More parameters (C, D)';
    m.onclick = () => {
      EZ.more = true;
      vars.forEach(v => (v.hidden = false));
      m.remove();
    };
    b1.appendChild(m);
  }
  if (calcRow) {
    const hasCalc = !!(r.calc && r.calc.expr);
    const ch = document.createElement('div');
    ch.className = 'ez-sub';
    ch.textContent = 'Calculation (optional) — e.g. A − B';
    const wrap = document.createElement('div');
    wrap.append(ch, calcRow);
    if (calcBad) wrap.appendChild(calcBad);
    if (!hasCalc && !EZ.calc) {
      wrap.hidden = true;
      const m = document.createElement('button');
      m.type = 'button';
      m.className = 'ez-link';
      m.textContent = '＋ Add a calculation';
      m.onclick = () => {
        EZ.calc = true;
        wrap.hidden = false;
        m.remove();
      };
      b1.appendChild(m);
    }
    b1.appendChild(wrap);
  }
  /* 2 — from "Alert on" to "Must last" */
  /* 3 — severity, cause, action · 4 — teams, escalation, ticket */
  let mode = 2;
  [...R.children].forEach(k => {
    const t = k.textContent || '';
    if (k.querySelector && k.querySelector('[data-esv]')) mode = 3;
    if (k.classList.contains('em-sh') && /Teams and messages/.test(t)) mode = 4;
    if (k.classList.contains('em-sh') && /Alert on/.test(t)) return k.remove();
    (mode === 2 ? b2 : mode === 3 ? b3 : b4).appendChild(k);
  });
  /* ticket rows live after the grid */
  let n = ed.nextElementSibling;
  while (n && !n.classList.contains('em-edb')) {
    const nx = n.nextElementSibling;
    if (n.classList.contains('em-sh')) n.className = 'ez-sub';
    b4.appendChild(n);
    n = nx;
  }
  /* new layout */
  ed.innerHTML = '';
  ed.classList.add('ez');
  const grid = document.createElement('div');
  grid.className = 'ez-grid';
  grid.append(c1, c2, c3, c4);
  ed.append(top, grid);
  body.scrollTop = 0;
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
.em-ed.ez{display:block}
.ez-top{display:flex;gap:14px;align-items:flex-end;background:#f8fafc;border:1px solid #e4e9f0;border-radius:12px;padding:10px 14px;margin-bottom:12px}
.ez-top .ez-name{flex:1;margin:0}.ez-top .ez-name>label{display:flex;justify-content:flex-start;align-items:center;gap:12px;font-size:12px;color:#475467;margin-bottom:4px}.ez-top .ez-name .em-auto{flex:none;width:auto!important;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#667085;margin:0}.ez-top .ez-name .em-auto input{order:-1;margin:0}.ez-card .em-var[hidden],.ez-card [hidden]{display:none!important}.ez-top .ez-name input{font-weight:700;font-size:15px}
.ez-top .em-now{flex:1.3;margin:0;border-radius:10px;padding:9px 12px;background:#fff;border:1px solid #e4e9f0;font-size:13px}
.ez-top .em-now.ez-true{background:#fef3f2;border-color:#fecdca}.ez-top .em-now .em-true{color:#b42318}
.ez-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ez-card{background:#fff;border:1px solid #e4e9f0;border-radius:12px;padding:12px 14px;min-width:0}
.ez-ch{display:flex;gap:10px;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #eef2f6}
.ez-ch b{display:block;font-size:14.5px;color:#0e2d5c}.ez-ch small{color:#667085;font-size:12px}
.ez-n{flex:none;width:26px;height:26px;border-radius:50%;background:#1f6feb;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}
.ez-sub{font-size:11.5px;font-weight:700;color:#475467;text-transform:uppercase;letter-spacing:.04em;margin:10px 0 6px}
.ez-card .fld{margin-bottom:8px}.ez-card .fld label{font-size:12px;color:#475467}
.ez-card .em-var{display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:center;margin-bottom:6px}
.ez-card .em-var b{width:22px;height:22px;border-radius:6px;background:#eef2f7;color:#344054;display:flex;align-items:center;justify-content:center;font-size:12px}
.ez-card .em-var select{min-width:0}.ez-card .em-vn{font:600 12.5px var(--mono,monospace);color:#067647;white-space:nowrap}
.ez-card select,.ez-card input:not([type=checkbox]),.ez-card textarea{border:1px solid #d0d5dd;border-radius:8px;padding:6px 8px;font-size:13px;background:#fff}
.ez-card .em-calc{display:flex;gap:6px;align-items:center}.ez-card .em-calc input{min-width:0}
.ez-link{border:0;background:none;color:#1f6feb;font-weight:600;font-size:12.5px;padding:4px 0;cursor:pointer;display:block}
.ez-card .eb-ch{display:flex;flex-wrap:wrap;gap:6px}.ez-card .eb-what{margin:6px 0 4px}
.ez-card .em-cond{display:grid;grid-template-columns:1.4fr 1fr .8fr auto;gap:6px;margin-bottom:6px;align-items:center}
.ez-card .em-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
.ez-card .em-team{border:1px solid #eef2f6;border-radius:10px;padding:8px;margin-bottom:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ez-card .em-team textarea{flex-basis:100%;min-height:38px}.ez-card .em-prev{flex-basis:100%;font-size:12px;color:#667085}
@media (max-width:1100px){.ez-grid{grid-template-columns:1fr}.ez-top{flex-direction:column;align-items:stretch}}
</style>`,
);
document.head.insertAdjacentHTML('beforeend', '<style>.ct-3.ct-5{grid-template-columns:repeat(5,1fr)!important}.ct-hint{font-size:11.5px;color:#667085}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>.as-tb tr.as-grp td{background:#f5f3ff;color:#5b21b6;font-weight:700;font-size:12px;padding:7px 10px}.as-fx{display:inline-block;background:#ede9fe;color:#6d28d9;font-weight:800;border-radius:6px;padding:1px 7px}.as-warn{color:#b42318;font-weight:600}</style>');
