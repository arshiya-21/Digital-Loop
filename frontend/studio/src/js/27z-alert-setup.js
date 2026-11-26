/*! SandMan Digital Loop Studio — 27z-alert-setup.js
 *  v10.4 — one simple place for alerts: Publish bar › 🔔 Alerts setup, four steps
 *   1 Teams            — teams and their email addresses (on/off per team and per person)
 *   2 Who gets emails  — one row per process zone: tick the teams; plus "Critical alerts also to"
 *   3 Tag alerts       — every parameter: Min-Min · Min · Max · Max-Max, email on/off, ticket after N days
 *   4 Engineered alerts— every engineered alert: on/off, condition, severity, email on/off, ticket after N days, edit
 *  Built on the same data as Alert routing (27y), Tickets (27p) and Engineered alerts (27g); the detailed Alert routing
 *  screen stays available under "Advanced". */

const AS = { tab: 1, q: '', zone: '', only: true };
function asOpen(tab) {
  if (tab) AS.tab = tab;
  openModal(
    `<div class="as-h"><h3>Alerts setup</h3><span class="note">Teams → who gets emails → limits for each parameter → engineered alerts</span></div>
     <div class="as-steps">${['Teams', 'Who gets emails', 'Tag alerts', 'Engineered alerts'].map((l, i) => `<button data-ast="${i + 1}" class="${AS.tab === i + 1 ? 'on' : ''}"><b>${i + 1}</b>${l}</button>`).join('')}</div>
     <div id="asBody" class="as-body"></div>
     <div class="mact"><span style="margin-right:auto"></span><button class="ib pri" id="asDone">Done</button></div>`,
    'xl',
  );
  $$('#mbox [data-ast]').forEach(b => (b.onclick = () => ((AS.tab = +b.dataset.ast), $$('#mbox [data-ast]').forEach(x => x.classList.toggle('on', x === b)), asRender())));
  $('#asDone').onclick = closeModal;
  asRender();
}
/* the quiet time after an email: 30 / 60 / 100 min (or what was set before) */
function asRepSel(id, cur, perAlert) {
  const R = rtDoc(),
    attr = perAlert ? `data-asrep="${esc(id)}"` : `id="${id}"`;
  return `<span class="as-days"><input type="number" min="1" step="1" ${attr} class="as-rep" value="${cur ? esc(cur) : ''}" placeholder="${perAlert ? R.set.repeatMin : '30'}">min</span>`;
}
function asSave() {
  save();
  if (typeof changed === 'function') changed();
}
function asRender() {
  const box = $('#asBody');
  if (!box) return;
  if (AS.tab === 1) {
    box.innerHTML = '<div id="rtBody"></div>';
    RT.tab = 'teams';
    rtRender();
    return;
  }
  const R = rtDoc(),
    T = rtTeams(),
    Z = typeof afZones === 'function' ? afZones() : [];
  const chips = (sel, attr) => T.map(t => `<label class="rt-chip${sel.includes(t.name) ? ' on' : ''}${t.on === false ? ' dim' : ''}"><input type="checkbox" ${attr} value="${esc(t.name)}" ${sel.includes(t.name) ? 'checked' : ''}>${esc(t.name)}</label>`).join('') || '<span class="note">Create teams in step 1</span>';
  const sw = (on, attr) => `<label class="rt-sw"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><i></i></label>`;
  if (AS.tab === 2) {
    const zr = z => R.rules.find(r => r.simple === 'zone' && r.zone === z.id);
    const cr = R.rules.find(r => r.simple === 'crit');
    box.innerHTML = `<p class="note"><b>When an email is sent:</b> a tag or calculated value outside its LL / HH (Critical) · an engineered alert whenever its own condition fires. Advisory and Warning of tags show in Fault alarm only. A ticket is created only when the same alert was emailed on N days in a row. The ticked teams of the equipment's zone get the email.</p>
     <table class="as-tb"><thead><tr><th>Email</th><th>Zone</th><th>Teams</th></tr></thead><tbody>
     ${Z.map(z => {
       const r = zr(z);
       return `<tr class="${R.zoneOff[z.id] ? 'off' : ''}"><td>${sw(!R.zoneOff[z.id], `data-asz="${z.id}"`)}</td><td><b>${esc(afName(z))}</b></td><td><div class="rt-chips">${chips(r ? r.teams || [] : [], `data-aszt="${z.id}"`)}</div></td></tr>`;
     }).join('') || '<tr><td colspan="3" class="note">No process zones on this loop.</td></tr>'}
     <tr class="as-crit"><td>${sw(!cr || cr.on !== false, 'data-ascon')}</td><td><b>Critical alerts — any zone</b><div class="note">also sent to</div></td><td><div class="rt-chips">${chips(cr ? cr.teams || [] : [], 'data-asct')}</div></td></tr></tbody></table>
     <div class="as-row"><span>Same alert again: no new email for</span>${asRepSel('asRep', R.set.repeatMin, false)}<label><input type="checkbox" id="asClr" ${R.set.cleared ? 'checked' : ''}> Also email when it is back to normal</label></div>
     <p class="note">Emails go out through the SandMan server (mail server settings are kept there, not in the loop).</p>`;
  } else if (AS.tab === 3) {
    const q = AS.q.trim().toLowerCase();
    const rows = [];
    DOC.blocks
      .filter(b => b.name && (b.tags || []).length)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .forEach(b => {
        const z = rtZoneOf(b);
        if (AS.zone && (!z || z.id !== AS.zone)) return;
        (b.tags || []).forEach(bt => {
          const t = REG[bt.id];
          if (!t || tagIsText(t) || t.calc) return; // ƒx calculated fields are listed under Engineered alerts
          const has = [t.ll, t.lo, t.hi, t.hh].some(x => x != null);
          if (AS.only && !has && !q) return;
          if (q && !`${b.name} ${t.short || ''} ${t.desc || ''} ${t.id}`.toLowerCase().includes(q)) return;
          rows.push({ b, t, z });
        });
      });
    const tk = tkDoc();
    tk.rules = tk.rules || {};
    const n = (id, k) => `<input type="number" step="any" data-asl="${esc(id)}|${k}" value="${REG[id][k] != null ? esc(REG[id][k]) : ''}">`;
    box.innerHTML = `<div class="as-bar"><input id="asQ" placeholder="Search parameter or equipment…" value="${esc(AS.q)}"><select id="asZ"><option value="">All zones</option>${Z.map(z => `<option value="${z.id}" ${AS.zone === z.id ? 'selected' : ''}>${esc(afName(z))}</option>`).join('')}</select><label><input type="checkbox" id="asOnly" ${AS.only ? 'checked' : ''}> Only parameters with limits</label><span class="note">${rows.length} parameters</span></div>
     <div class="as-tw"><table class="as-tb as-lim"><thead><tr><th>Equipment</th><th>Parameter</th><th>Email</th><th>Repeat email after</th><th>Ticket after</th></tr></thead><tbody>
     ${rows
       .slice(0, 400)
       .map(({ b, t }) => {
         const k = 'lim:' + t.id,
           tr = tk.rules[k] || {},
           sev = tagSev(t.id);
         return `<tr><td>${esc(b.name)}</td><td><b>${esc(t.short || t.desc || t.id)}</b>${t.unit ? ` <span class="note">${esc(t.unit)}</span>` : ''}<div class="note mono">${esc(t.id)}</div></td><td>${sw(!R.mute || !R.mute[k], `data-asm="${esc(k)}"`)}</td><td>${asRepSel(k, R.repeat && R.repeat[k], true)}</td><td><span class="as-days">${sw(tr.on !== false, `data-astk="${esc(k)}"`)}<input type="number" min="1" data-astd="${esc(k)}" value="${tr.days || ''}" placeholder="${tk.set.days}">days</span></td></tr>`;
       })
       .join('') || '<tr><td colspan="5" class="note" style="padding:14px">No parameters match.</td></tr>'}</tbody></table></div>
     <p class="note">Email is sent when the value goes outside its LL / HH (Critical). Repeat email after: type minutes (empty = plant default ${rtDoc().set.repeatMin} min). Ticket after N bad days in a row (empty = plant default ${tk.set.days}). The alarm limits themselves are set on each tag (Edit limits).</p>`;
  } else {
    const E = engDoc(),
      tk = tkDoc();
    tk.rules = tk.rules || {};
    box.innerHTML = `<div class="as-bar"><button class="sb" id="asENew">＋ New engineered alert</button><span class="note">Rules on several readings together, averages over time, statistics and forecasts — and your ƒx calculated fields.</span></div>
     <div class="as-tw"><table class="as-tb"><thead><tr><th>On</th><th>Alert</th><th>Equipment</th><th>Condition</th><th>Severity</th><th>Email</th><th>Repeat email after</th><th>Ticket after</th><th></th></tr></thead><tbody>
     ${E.rules
       .map((r, i) => {
         const k = 'eng:' + r.id,
           tr = tk.rules[k] || {};
         return `<tr class="${r.on ? '' : 'off'}"><td>${sw(r.on, `data-ason="${i}"`)}</td><td><b>${esc(r.name)}</b>${asCalcLine(r)}</td><td>${esc((B(r.equip) || {}).name || 'Plant')}</td><td class="as-cond">${esc(engCondText(r))}</td>
          <td><select data-assev="${i}">${[[1, 'Advisory'], [2, 'Warning'], [3, 'Critical']].map(([v, l]) => `<option value="${v}" ${+r.sev === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td>${sw(!R.mute || !R.mute[k], `data-asm="${esc(k)}"`)}</td><td>${asRepSel(k, R.repeat && R.repeat[k], true)}</td><td><span class="as-days">${sw(tr.on !== false, `data-astk="${esc(k)}"`)}<input type="number" min="1" data-astd="${esc(k)}" value="${tr.days || r.tkDays || ''}" placeholder="${tk.set.days}">days</span></td>
          <td><button class="lk" data-ased="${i}">Edit</button></td></tr>`;
       })
       .join('') || '<tr><td colspan="9" class="note" style="padding:14px">No engineered alerts yet.</td></tr>'}
     ${(() => {
       const L = (typeof ctDoc === 'function' ? ctDoc() : []).map(C => {
         const id = Object.keys(REG).find(x => REG[x].calc === C.id);
         return id ? { C, id, t: REG[id] } : null;
       }).filter(Boolean);
       if (!L.length) return '';
       return `<tr class="as-grp"><td colspan="9">ƒx Calculated fields · email when outside LL / HH (Critical), same as a tag</td></tr>` + L.map(({ C, id, t }) => {
         const k = 'lim:' + id, tr = tk.rules[k] || {}, own = typeof qcTagOwner === 'function' ? qcTagOwner(id) : null;
         const lim = t.ll != null || t.hh != null ? `Outside LL / HH (${t.ll != null ? t.ll : '—'} … ${t.hh != null ? t.hh : '—'}${t.unit ? ' ' + esc(t.unit) : ''})${t.critAuto ? ' <span class="note">auto</span>' : ''}` : '<span class="as-warn">No limits set — set L / H to get alerts</span>';
         return `<tr><td><span class="as-fx">ƒx</span></td><td><b>${esc(C.name || t.short || id)}</b><div class="note mono">${esc(String(C.expr || '').replace(/\s+/g, ' ').slice(0, 70))}</div></td><td>${esc(own ? own.name : 'Plant')}</td><td class="as-cond">${lim}</td><td>Critical</td>
          <td>${sw(!R.mute || !R.mute[k], `data-asm="${esc(k)}"`)}</td><td>${asRepSel(k, R.repeat && R.repeat[k], true)}</td><td><span class="as-days">${sw(tr.on !== false, `data-astk="${esc(k)}"`)}<input type="number" min="1" data-astd="${esc(k)}" value="${tr.days || ''}" placeholder="${tk.set.days}">days</span></td>
          <td><button class="lk" data-asfx="${esc(C.id)}">Edit</button></td></tr>`;
       }).join('');
     })()}</tbody></table></div>`;
  }
  asBind();
}
function asBind() {
  const R = rtDoc(),
    q = s => $$('#asBody ' + s),
    re = () => (asSave(), asRender());
  /* step 2 */
  const zr = id => {
    let r = R.rules.find(x => x.simple === 'zone' && x.zone === id);
    if (!r) R.rules.push((r = { id: 'rz' + id, simple: 'zone', on: true, zone: id, kind: '', sev: 2, cat: '', alert: '', teams: [] }));
    return r;
  };
  const cr = () => {
    let r = R.rules.find(x => x.simple === 'crit');
    if (!r) R.rules.push((r = { id: 'rcrit', simple: 'crit', on: true, zone: '', kind: '', sev: 3, cat: '', alert: '', teams: [] }));
    return r;
  };
  q('[data-asz]').forEach(x => (x.onchange = () => (x.checked ? delete R.zoneOff[x.dataset.asz] : (R.zoneOff[x.dataset.asz] = 1), re())));
  q('[data-aszt]').forEach(x => (x.onchange = () => {
    const r = zr(x.dataset.aszt);
    r.teams = x.checked ? [...new Set([...r.teams, x.value])] : r.teams.filter(n => n !== x.value);
    re();
  }));
  q('[data-asct]').forEach(x => (x.onchange = () => {
    const r = cr();
    r.teams = x.checked ? [...new Set([...r.teams, x.value])] : r.teams.filter(n => n !== x.value);
    re();
  }));
  q('[data-ascon]').forEach(x => (x.onchange = () => ((cr().on = x.checked), re())));
  const rp = $('#asRep');
  if (rp) rp.onchange = () => ((R.set.repeatMin = Math.max(1, +rp.value || 30)), re());
  q('[data-asrep]').forEach(x => (x.onchange = () => {
    R.repeat = R.repeat || {};
    if (x.value === '' || !(+x.value > 0)) (delete R.repeat[x.dataset.asrep]), (x.value = '');
    else R.repeat[x.dataset.asrep] = Math.round(+x.value);
    asSave();
  }));
  const cl = $('#asClr');
  if (cl) cl.onchange = () => ((R.set.cleared = cl.checked), re());
  /* step 3 */
  const sq = $('#asQ');
  if (sq)
    sq.oninput = () => {
      AS.q = sq.value;
      const p = sq.selectionStart;
      asRender();
      const n = $('#asQ');
      n.focus();
      n.setSelectionRange(p, p);
    };
  const sz = $('#asZ');
  if (sz) sz.onchange = () => ((AS.zone = sz.value), asRender());
  const so = $('#asOnly');
  if (so) so.onchange = () => ((AS.only = so.checked), asRender());
  q('[data-asl]').forEach(x => (x.onchange = () => {
    const [id, k] = x.dataset.asl.split('|');
    pushUndo();
    REG[id][k] = x.value === '' ? null : +x.value;
    const t = REG[id];
    if (t.lo != null && t.hi != null && t.lo > t.hi) toast('Min is above Max — check the limits');
    asSave();
    if (typeof liveCanvas === 'function') liveCanvas();
    x.closest('tr').querySelector('.as-v').className = 'mono as-v s' + tagSev(id);
  }));
  q('[data-asm]').forEach(x => (x.onchange = () => {
    R.mute = R.mute || {};
    if (x.checked) delete R.mute[x.dataset.asm];
    else R.mute[x.dataset.asm] = 1;
    asSave();
  }));
  const tk = tkDoc();
  tk.rules = tk.rules || {};
  q('[data-astk]').forEach(x => (x.onchange = () => {
    tk.rules[x.dataset.astk] = Object.assign({}, tk.rules[x.dataset.astk], { on: x.checked });
    asSave();
  }));
  q('[data-astd]').forEach(x => (x.onchange = () => {
    const r = Object.assign({}, tk.rules[x.dataset.astd]);
    if (x.value === '') delete r.days;
    else r.days = Math.max(1, +x.value);
    tk.rules[x.dataset.astd] = r;
    asSave();
  }));
  /* step 4 */
  const E = engDoc();
  q('[data-ason]').forEach(x => (x.onchange = () => ((E.rules[+x.dataset.ason].on = x.checked), re())));
  q('[data-assev]').forEach(x => (x.onchange = () => ((E.rules[+x.dataset.assev].sev = +x.value), re())));
  const ed = r => {
    closeModal();
    openAlertMonitor('rules');
    EM.edit = r;
    const bd = $('#emBody');
    if (bd) bd._h = null;
    emRender();
  };
  q('[data-asfx]').forEach(x => (x.onclick = () => (closeModal(), ctOpen(x.dataset.asfx))));
  q('[data-ased]').forEach(x => (x.onclick = () => ed(JSON.parse(JSON.stringify(E.rules[+x.dataset.ased])))));
  const nw = $('#asENew');
  if (nw) nw.onclick = () => ed({ id: 'eng' + Date.now().toString(36), name: 'New engineered alert', on: true, equip: '', vars: {}, calc: null, conds: [], join: 'and', runOnly: true, dur: 120, sev: 2, cause: '', action: '', teams: [], escMin: 0, escTo: '' });
}
/* the calculation of an engineered alert, with tag names: ƒx ΔT = Inlet temp − Outlet temp */
function asCalcLine(r) {
  const nm = k => (r.vars && r.vars[k] && REG[r.vars[k]] ? String(REG[r.vars[k]].short || REG[r.vars[k]].desc || k).replace(/^ƒx\s*/, 'ƒx ') : k);
  const parts = [];
  if (r.calc && r.calc.expr) parts.push(`<span class="as-fx">ƒx</span> <b>${esc(r.calc.name || 'Calculation')}</b> = ${esc(String(r.calc.expr).replace(/\b([ABCD])\b/g, (m, k) => nm(k)))}`);
  const fx = ['A', 'B', 'C', 'D'].filter(k => r.vars && r.vars[k] && REG[r.vars[k]] && REG[r.vars[k]].calc);
  fx.forEach(k => parts.push(`<span class="as-fx">ƒx</span> ${esc(nm(k).replace(/^ƒx /, ''))} <span class="note">(calculated tag)</span>`));
  return parts.length ? `<div class="as-calc">${parts.join('<br>')}</div>` : '';
}
/* per-alert email off (step 3 / 4) */
{
  const prev = rtMatch;
  rtMatch = function (info, sev) {
    const m = prev(info, sev),
      R = rtDoc();
    if (R.mute && R.mute[info.key]) return Object.assign({}, m, { emails: [], mutedAlert: true });
    return m;
  };
}
/* Publish bar button next to Tickets */
setInterval(() => {
  try {
    /* v10.4 final: no Publish-bar button — Alerts setup lives in Design › Administration only */
    const nav = $('.tkq-nav');
    if (nav && !nav.querySelector('[data-asopen]')) {
      const rul = nav.querySelector('#tkwRul');
      rul && rul.insertAdjacentHTML('beforebegin', '<button class="tkq-q" data-asopen="1"><span>Alerts setup</span></button>');
      const b = nav.querySelector('[data-asopen]');
      if (b) b.onclick = () => asOpen();
    }
  } catch (e) {}
}, 700);

document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="asCss">
.as-h{display:flex;align-items:baseline;gap:12px}.as-h h3{margin:0}
.as-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:12px 0}.as-steps button{display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:9px 12px;font:600 13.5px var(--sans);cursor:pointer;color:var(--text)}.as-steps b{display:inline-flex;width:24px;height:24px;border-radius:50%;background:#e2e8f0;align-items:center;justify-content:center;font-size:12.5px}.as-steps button.on{border-color:#1f6feb;box-shadow:0 0 0 2px #dbeafe}.as-steps button.on b{background:#1f6feb;color:#fff}
.as-body{min-height:440px;max-height:66vh;overflow:auto}.as-body #rtBody{max-height:none;min-height:0}
.as-tb{width:100%;border-collapse:collapse;font-size:13px}.as-tb th{text-align:left;font-size:11.5px;color:var(--muted);padding:7px 6px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--panel);z-index:1}.as-tb td{padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:middle}.as-tb tr.off td{opacity:.5}
.as-tb.as-lim input{width:78px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;font:12.5px var(--mono)}.as-tb th.c3{color:#b91c1c}.as-tb th.c2{color:#b45309}
.as-v.s2{color:#b45309;font-weight:700}.as-v.s3{color:#dc2626;font-weight:700}
.as-days{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}.as-days input{width:48px}
.as-cond{max-width:360px;font-size:12px;color:var(--muted)}
.as-crit td{background:#fff7ed}.as-rep{width:64px}
.as-calc{font-size:12px;color:#475569;margin-top:3px}.as-fx{display:inline-block;background:#6d28d9;color:#fff;border-radius:4px;padding:0 5px;font:700 11px var(--mono)}
.as-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:8px}.as-bar input#asQ{flex:1;min-width:220px;padding:7px 10px;border:1px solid var(--line);border-radius:8px}
.as-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;font-size:13px}
.as-tw{overflow:auto;max-height:52vh}
</style>`,
);

/* ---------- automatic alert names: the calculated field (or tag) name + what the condition means ----------
   "ΔT Low", "Outlet temp High · Water flow Low", "Moisture Out of limit", "GCS Trending" … The name follows the
   condition when it is edited. Typing an own name in the editor switches this off for that alert. */
const ENG_WORD = {
  '<': 'Low', '<=': 'Low', avgbelow: 'Low', minbelow: 'Low',
  '>': 'High', '>=': 'High', avgabove: 'High', maxabove: 'High', count: 'High (repeated)',
  out: 'Out of limit', sig: 'Out of limit', spc: 'Out of control', t2: 'Unusual combination',
  in: 'In range', '=': 'Equal', '!=': 'Changed', trend: 'Trending', roc: 'Changing fast', delta: 'Changing fast',
  stuck: 'Not changing', nodata: 'No data', predict: 'Heading to limit', rel: 'Relationship broken', ewma: 'Drifting', cusum: 'Shifted',
};
function engVarName(r, k) {
  if (k === 'X') return (r.calc && r.calc.name) || 'Calculation';
  const t = r.vars && r.vars[k] && REG[r.vars[k]];
  return t ? String(t.short || t.desc || k).replace(/^ƒx\s*/, '') : k;
}
function engAutoName(r) {
  const C = r.conds || [];
  if (!C.length) return r.calc && r.calc.name ? r.calc.name : 'New engineered alert';
  if (C.some(c => c.op === 't2')) return `${['A', 'B', 'C', 'D'].filter(k => r.vars && r.vars[k]).map(k => engVarName(r, k)).join(' / ')} Unusual combination`;
  const by = [];
  C.forEach(c => {
    const n = engVarName(r, c.l),
      w = ENG_WORD[c.op] || '';
    const e = by.find(x => x.n === n);
    if (e) !e.w.includes(w) && e.w.push(w);
    else by.push({ n, w: [w] });
  });
  return by.map(x => `${x.n} ${x.w.filter(Boolean).join(' / ')}`.trim()).join(r.join === 'or' ? ' or ' : ' · ');
}
function engNamesSync() {
  if (typeof engDoc !== 'function') return;
  engDoc().rules.forEach(r => {
    if (r.autoName === false) return;
    const n = engAutoName(r);
    if (r.name !== n) r.name = n;
  });
}
{
  const tickPrev = engTick;
  engTick = function () {
    try {
      engNamesSync();
    } catch (e) {}
    return tickPrev.apply(this, arguments);
  };
  const asPrev = asRender;
  asRender = function () {
    if (AS.tab === 4) engNamesSync();
    return asPrev.apply(this, arguments);
  };
  const edPrev = emEdit;
  emEdit = function (E) {
    let h = edPrev(E);
    const r = EM.edit;
    if (!r) return h;
    const auto = r.autoName !== false;
    if (auto) r.name = engAutoName(r);
    return h.replace(
      /<div class="fld"><label>Alert name<\/label><input data-er="name" value="[^"]*"><\/div>/,
      `<div class="fld"><label>Alert name <label class="em-auto"><input type="checkbox" data-er="autoName" ${auto ? 'checked' : ''}> automatic — from the calculated field / tag and the condition</label></label><input data-er="name" value="${esc(r.name || '')}" ${auto ? 'readonly class="em-ro"' : ''}></div>`,
    );
  };
}
document.addEventListener(
  'change',
  e => {
    const i = e.target;
    if (!EM || !EM.edit || !i.matches) return;
    if (i.matches('input[data-er="name"]')) EM.edit.autoName = false;
    if (i.matches('input[data-er="autoName"]') && i.checked) EM.edit.name = engAutoName(EM.edit);
  },
  true,
);
setTimeout(engNamesSync, 1500);
document.head.insertAdjacentHTML('beforeend', '<style>.em-auto{display:inline-flex;align-items:center;gap:4px;font-weight:400;font-size:11.5px;color:var(--muted);margin-left:8px}.em-ro{background:var(--bg2,#f1f5f9);color:var(--muted)}</style>');
