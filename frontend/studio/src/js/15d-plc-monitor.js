/*! SandMan Digital Loop Studio — 15d-plc-monitor.js
 *  v9.5 — Equipment → PLC → SCADA data mapping and the PLC Tag Monitor.
 *
 *  DATA MODEL (saved with the flowsheet, in DOC.dmap — separate from material and data LINES):
 *    every equipment / PLC / SCADA gets a stable id in b.props.dmId (EQ-…, PLC-…, SCADA-…) — never derived from the
 *    name, so renaming never breaks a mapping; an optional display name in b.props.dmName.
 *    DOC.dmap.tags  = [{ tag_id, address, param, equipment_id, plc_id, type, unit, prec, sim }]
 *                     tag_id is unique; the same address may exist on two PLCs (they stay distinct).
 *    DOC.dmap.scada = { [scada_id]: { plcs: [plc_id, …] } }   — SCADA → PLC mapping, stored separately.
 *
 *  DATA SERVICE (SandmanData): icons are visual only; values come from an adapter.
 *    SimAdapter  — the clearly labelled simulation used now (sample values, PLC communication can be "lost").
 *    ApiAdapter  — template for the SandMan backend (REST snapshot / WebSocket push). Never talks to PLCs directly.
 *    subscribe() starts polling for the first subscriber and stops it when the last one unsubscribes.
 *    Each tag: { v, q: 'Good' | 'Stale' | 'Bad' | 'Waiting', ts }; each PLC: { status: 'Connected' | 'Disconnected', since }.
 *    Lost communication keeps the LAST value, marks it Stale and keeps its real timestamp — never zero, never fresh.
 *
 *  PLC TAG MONITOR (read-only): Publish → click SCADA (its PLCs) · PLC (that PLC) · equipment (its tags);
 *  Design / Simulate → right-click › View tags…; Design → right-click › Configure data… */

/* ---------- model ---------- */
const DM_TYPES = ['REAL', 'INT', 'DINT', 'BOOL', 'STRING'];
function dmRole(b) {
  if (!b) return null;
  const E = EQ[b.type];
  if (!E || E.widget || ['junction', 'areaBox', 'label'].includes(b.type)) return null;
  if (/ct_scada/.test(b.type)) return 'scada';
  if (/plc/i.test(b.type)) return 'plc';
  if (typeof isIT === 'function' && isIT(b)) return null; // gateways, servers … are not part of this mapping
  return 'equip';
}
function dmEnsure() {
  if (!DOC.dmap || typeof DOC.dmap !== 'object') DOC.dmap = { v: 1, tags: [], scada: {} };
  if (!Array.isArray(DOC.dmap.tags)) DOC.dmap.tags = [];
  if (!DOC.dmap.scada || typeof DOC.dmap.scada !== 'object') DOC.dmap.scada = {};
  if (!DOC.dmap.plcEq || typeof DOC.dmap.plcEq !== 'object') DOC.dmap.plcEq = {}; // v9.6: PLC → equipment it reads (Properties)
  // copy / paste can duplicate an id: the later copy gets a fresh one (its tags stay with the original)
  const seen = new Set();
  DOC.blocks.forEach(b => {
    const id = b.props && b.props.dmId;
    if (!id) return;
    if (seen.has(id)) delete b.props.dmId;
    else seen.add(id);
  });
  return DOC.dmap;
}
const dmRand = () => Math.random().toString(36).slice(2, 8).toUpperCase();
function dmId(b) {
  const r = dmRole(b);
  if (!r) return null;
  if (!b.props.dmId) {
    const pre = r === 'scada' ? 'SCADA-' : r === 'plc' ? 'PLC-' : 'EQ-';
    let id;
    do id = pre + dmRand();
    while (DOC.blocks.some(x => x.props && x.props.dmId === id));
    b.props.dmId = id;
  }
  return b.props.dmId;
}
const dmBlock = id => (id ? DOC.blocks.find(b => b.props && b.props.dmId === id) : null);
const dmName = b => (b ? b.props.dmName || b.name : '—');
const dmNameById = id => {
  const b = dmBlock(id);
  return b ? dmName(b) : id ? `${id} (removed)` : '—';
};
function dmNewTagId() {
  let id;
  do id = 'TAG-' + dmRand() + dmRand().slice(0, 2);
  while (DOC.dmap.tags.some(t => t.tag_id === id));
  return id;
}
/* v9.6 — links come from the Properties panel (explicit) AND from data lines (derived); the monitor uses both */
function dmLineLinks() {
  const out = { scada: {}, plc: {} }; // scada_id → Set(plc_id) · plc_id → Set(equipment_id)
  const isData = s => (typeof streamKind === 'function' ? streamKind(s) : s.kind) === 'data';
  const nb = id => DOC.streams.filter(isData).map(s => (s.from.b === id ? s.to.b : s.to.b === id ? s.from.b : null)).filter(Boolean);
  DOC.blocks.forEach(b => {
    const r = dmRole(b);
    if (r === 'plc') {
      const pid = dmId(b);
      out.plc[pid] = new Set(nb(b.id).map(B).filter(x => dmRole(x) === 'equip').map(dmId));
    } else if (r === 'scada') {
      // PLCs reachable over data lines, through switches / gateways (not through another PLC or SCADA)
      const sid = dmId(b),
        seen = new Set([b.id]),
        q = [b.id],
        found = new Set();
      while (q.length) {
        nb(q.shift()).forEach(o => {
          if (seen.has(o)) return;
          seen.add(o);
          const ob = B(o),
            rr = dmRole(ob);
          if (rr === 'plc') found.add(dmId(ob));
          else if (!rr && ((typeof isIT === 'function' && isIT(ob)) || ob.type === 'junction')) q.push(o); // v9.17: through switches, gateways and line junctions
        });
      }
      out.scada[sid] = found;
    }
  });
  return out;
}
function dmScadaPlcs(sid, L = dmLineLinks()) {
  const ex = ((dmEnsure().scada[sid] || {}).plcs || []).filter(id => dmBlock(id));
  return [...new Set([...ex, ...(L.scada[sid] || [])])];
}
function dmPlcEquip(pid, L = dmLineLinks()) {
  const ex = (dmEnsure().plcEq[pid] || []).filter(id => dmBlock(id));
  return [...new Set([...ex, ...(L.plc[pid] || [])])];
}
/* the equipment's own Studio tags (REG) as read-only monitor tags under the PLC that reads it */
function dmAutoTags(pid, eid) {
  const b = dmBlock(eid);
  if (!b) return [];
  return b.tags
    .filter(t => REG[t.id])
    .map(t => ({ tag_id: `AUTO:${pid}:${t.id}`, address: t.id, param: REG[t.id].desc || t.id.split('.').pop(), equipment_id: eid, plc_id: pid, type: REG[t.id].states ? 'STATUS' : 'REAL', states: REG[t.id].states || null, unit: REG[t.id].unit || '', prec: REG[t.id].d ?? null, auto: true, reg: t.id }));
}
/* tags in a scope: { scada_id } → tags of its PLCs · { plc_id } · { equipment_id } */
function dmScope(sc) {
  const M = dmEnsure(),
    L = dmLineLinks();
  let plcs;
  if (sc.scada_id) plcs = dmScadaPlcs(sc.scada_id, L);
  else if (sc.plc_id) plcs = dmBlock(sc.plc_id) ? [sc.plc_id] : [];
  else plcs = [...new Set([...M.tags.filter(t => t.equipment_id === sc.equipment_id).map(t => t.plc_id), ...DOC.blocks.filter(x => dmRole(x) === 'plc').map(dmId).filter(pid => dmPlcEquip(pid, L).includes(sc.equipment_id))])].filter(id => dmBlock(id));
  let tags = M.tags.filter(t => plcs.includes(t.plc_id));
  plcs.forEach(pid => {
    dmPlcEquip(pid, L).forEach(eid => {
      dmAutoTags(pid, eid).forEach(a => {
        if (!tags.some(t => t.plc_id === pid && t.address === a.address)) tags.push(a);
      });
    });
  });
  if (sc.equipment_id) tags = tags.filter(t => t.equipment_id === sc.equipment_id);
  // equipment a PLC reads that has no tags at all (shown as a hint in the monitor)
  const bare = {};
  plcs.forEach(pid => (bare[pid] = dmPlcEquip(pid, L).filter(eid => !tags.some(t => t.plc_id === pid && t.equipment_id === eid) && (!sc.equipment_id || eid === sc.equipment_id))));
  return { plcs, tags, bare };
}

/* ---------- data service ---------- */
const SimAdapter = (() => {
  const st = {}, // tag_id → { v, ts }
    plc = {}; // plc_id → { connected, since }
  const now = () => Date.now();
  const plcState = id => (plc[id] = plc[id] || { connected: true, since: now() });
  return {
    name: 'sim',
    label: 'Simulation adapter — sample values, not plant data',
    setConnected(plc_id, on) {
      const p = plcState(plc_id);
      if (p.connected !== !!on) Object.assign(p, { connected: !!on, since: now() });
    },
    read(spec) {
      const out = { tags: {}, plcs: {}, at: now() };
      spec.plcs.forEach(id => {
        const p = plcState(id);
        out.plcs[id] = { status: p.connected ? 'Connected' : 'Disconnected', since: p.since };
      });
      spec.tags.forEach(t => {
        const p = plcState(t.plc_id),
          s = st[t.tag_id];
        if (t.auto && t.reg) {
          // the equipment's own Studio tag: its current simulated value
          const v = typeof val === 'function' ? val(t.reg) : null;
          if (v == null || isNaN(v)) out.tags[t.tag_id] = { v: null, q: 'Bad', ts: s ? s.ts : null };
          else {
            st[t.tag_id] = { v, ts: now() };
            out.tags[t.tag_id] = { v, q: 'Good', ts: st[t.tag_id].ts };
          }
          return;
        }
        const base = t.sim != null && t.sim !== '' ? +t.sim : null;
        if (!p.connected) {
          // communication lost: keep the last value and its real timestamp, marked stale
          out.tags[t.tag_id] = s ? { v: s.v, q: 'Stale', ts: s.ts } : { v: null, q: 'Stale', ts: null };
          return;
        }
        if (base == null || isNaN(base)) {
          out.tags[t.tag_id] = { v: null, q: 'Bad', ts: s ? s.ts : null, err: 'No value configured for this tag' };
          return;
        }
        // tags update at their own pace (staggered timestamps), values move a little around the sample value
        if (!s || Math.random() < 0.6) {
          const amp = t.type === 'DINT' ? Math.max(Math.abs(base) * 0.0004, 1) : Math.max(Math.abs(base) * 0.012, 0.05); // counters move little
          const v = t.type === 'BOOL' ? (base ? 1 : 0) : t.type === 'INT' || t.type === 'DINT' ? Math.round(base + (Math.random() - 0.5) * 2 * amp) : base + (Math.random() - 0.5) * 2 * amp;
          st[t.tag_id] = { v, ts: now() };
        }
        out.tags[t.tag_id] = { v: st[t.tag_id].v, q: 'Good', ts: st[t.tag_id].ts };
      });
      return Promise.resolve(out);
    },
  };
})();
/* backend adapter — the SandMan Gateway / backend serves tag values; the browser never connects to PLCs.
   Expected REST: POST {base}/tags/snapshot  body { tag_ids, plc_ids } → { tags: {id:{v,q,ts}}, plcs: {id:{status,since}} }
   or WebSocket {ws} with the same message shape pushed on change. Not active until configured. */
function ApiAdapter(base, ws) {
  let last = null;
  return {
    name: 'api',
    label: 'SandMan backend',
    read(spec) {
      return fetch(base + '/tags/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_ids: spec.tags.map(t => t.tag_id), plc_ids: spec.plcs }),
      })
        .then(r => {
          if (!r.ok) throw new Error('Backend answered ' + r.status);
          return r.json();
        })
        .then(d => ((last = d), d));
    },
    ws,
    last: () => last,
  };
}
const SandmanData = (() => {
  let adapter = SimAdapter,
    timer = null,
    period = 1000;
  const subs = new Set();
  async function poll() {
    for (const s of [...subs]) {
      try {
        const snap = await adapter.read(s.spec());
        if (subs.has(s)) s.cb(snap, null);
      } catch (e) {
        if (subs.has(s)) s.cb(null, e);
      }
    }
  }
  return {
    get adapter() {
      return adapter;
    },
    setAdapter(a) {
      adapter = a || SimAdapter;
    },
    subscribe(spec, cb) {
      const s = { spec, cb };
      subs.add(s);
      if (!timer) timer = setInterval(poll, period);
      poll();
      return () => {
        subs.delete(s);
        if (!subs.size && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    refresh: () => poll(),
    get active() {
      return subs.size;
    },
    get polling() {
      return !!timer;
    },
  };
})();
window.SandmanData = SandmanData;

/* ---------- PLC Tag Monitor (read-only modal) ---------- */
let PMON = null;
const pmFmtTime = ts => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
function pmFmtVal(t, d) {
  if (!d || d.v == null) return '—';
  if (t.states) return esc(t.states[Math.round(d.v)] ?? String(d.v)); // v9.9 status text (RUNNING / STOPPED)
  if (t.type === 'BOOL') return d.v ? 'On' : 'Off';
  if (t.type === 'STRING') return esc(String(d.v));
  const p = t.prec != null && t.prec !== '' ? +t.prec : t.type === 'INT' || t.type === 'DINT' ? 0 : Math.abs(d.v) >= 100 ? 0 : Math.abs(d.v) >= 10 ? 1 : 2;
  return Number(d.v).toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p });
}
function openPlcMonitor(scope) {
  closePlcMonitor();
  dmEnsure();
  let ov = document.getElementById('plcmon');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'plcmon';
    ov.className = 'pm-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    document.body.appendChild(ov);
    ov.addEventListener('pointerdown', e => {
      if (e.target === ov) closePlcMonitor();
    });
  }
  const title = scope.scada_id ? dmNameById(scope.scada_id) : scope.plc_id ? dmNameById(scope.plc_id) : dmNameById(scope.equipment_id);
  PMON = { scope, title, plcF: scope.plc_id || 'all', eqF: scope.equipment_id || 'all', q: '', qual: 'all', collapsed: new Set(), more: {}, data: { tags: {}, plcs: {} }, at: null, err: null, loaded: false, unsub: null };
  ov.innerHTML = `<div class="pm-box" role="document">
    <header class="pm-head"><div><h3>PLC Tag Monitor <span class="pm-for">— ${esc(title)}</span></h3>
      <div class="pm-sub"><span class="pm-src">${esc(SandmanData.adapter.label)}</span> · read-only</div></div>
      <div class="pm-hbtn"><button class="pm-btn" id="pmRefresh" type="button" title="Refresh now">⟳ Refresh</button><button class="pm-x" id="pmClose" type="button" aria-label="Close" title="Close (Esc)">✕</button></div></header>
    <div class="pm-bar">
      <label>PLC<select id="pmPlc"></select></label>
      <label>Equipment<select id="pmEq"></select></label>
      <label class="pm-q">Search<input id="pmQ" type="search" placeholder="Tag name or parameter" autocomplete="off"></label>
      <label>Quality<select id="pmQual"><option value="all">All</option><option value="Good">Good</option><option value="Stale">Stale</option><option value="Bad">Bad</option><option value="Waiting">Waiting</option></select></label>
      <div class="pm-meta"><span id="pmCount"></span><span id="pmAt"></span></div>
    </div>
    <div class="pm-msg" id="pmMsg" hidden></div>
    <div class="pm-scroll" id="pmScroll"><table class="pm-t"><thead><tr><th>Equipment</th><th>Tag name</th><th>Parameter</th><th class="num">Value</th><th>Unit</th><th>Quality</th><th>Last updated</th></tr></thead><tbody id="pmBody"></tbody></table></div>
  </div>`;
  ov.classList.add('on');
  $('#pmClose').onclick = closePlcMonitor;
  $('#pmRefresh').onclick = () => SandmanData.refresh();
  $('#pmPlc').onchange = e => {
    PMON.plcF = e.target.value;
    PMON.eqF = 'all';
    pmFilters();
    pmRender();
  };
  $('#pmEq').onchange = e => ((PMON.eqF = e.target.value), pmRender());
  $('#pmQ').oninput = e => ((PMON.q = e.target.value.trim().toLowerCase()), pmRender());
  $('#pmQual').onchange = e => ((PMON.qual = e.target.value), pmRender());
  pmFilters();
  pmRender();
  const S = dmScope(scope);
  PMON.unsub = SandmanData.subscribe(
    () => {
      const s = dmScope(PMON.scope);
      return { tags: s.tags, plcs: s.plcs };
    },
    (snap, err) => {
      if (!PMON) return;
      if (err) PMON.err = err;
      else {
        PMON.err = null;
        Object.assign(PMON.data.tags, snap.tags);
        Object.assign(PMON.data.plcs, snap.plcs);
        PMON.at = snap.at;
      }
      const first = !PMON.loaded;
      PMON.loaded = true;
      if (first) pmRender();
      else pmUpdate();
    },
  );
  if (!S.tags.length) pmRender();
  setTimeout(() => $('#pmQ')?.focus(), 30);
}
function closePlcMonitor() {
  if (PMON && PMON.unsub) PMON.unsub();
  PMON = null;
  const ov = document.getElementById('plcmon');
  if (ov) {
    ov.classList.remove('on');
    ov.innerHTML = '';
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && PMON) {
    e.stopPropagation();
    closePlcMonitor();
  }
}, true);
function pmFilters() {
  const S = dmScope(PMON.scope);
  const plcSel = $('#pmPlc'),
    eqSel = $('#pmEq');
  plcSel.innerHTML = (S.plcs.length > 1 ? '<option value="all">All PLCs</option>' : '') + S.plcs.map(id => `<option value="${esc(id)}">${esc(dmNameById(id))}</option>`).join('');
  if (!S.plcs.includes(PMON.plcF)) PMON.plcF = S.plcs.length > 1 ? 'all' : S.plcs[0] || 'all';
  plcSel.value = PMON.plcF;
  plcSel.disabled = S.plcs.length <= 1;
  // equipment list depends on the selected PLC
  const eqs = [...new Set(S.tags.filter(t => PMON.plcF === 'all' || t.plc_id === PMON.plcF).map(t => t.equipment_id))];
  eqSel.innerHTML = '<option value="all">All equipment</option>' + eqs.map(id => `<option value="${esc(id || '')}">${esc(id ? dmNameById(id) : '(no equipment)')}</option>`).join('');
  if (PMON.eqF !== 'all' && !eqs.includes(PMON.eqF)) PMON.eqF = 'all';
  eqSel.value = PMON.eqF;
}
const pmQual = t => {
  const d = PMON.data.tags[t.tag_id];
  return d ? d.q : 'Waiting';
};
function pmVisible(t) {
  if (PMON.plcF !== 'all' && t.plc_id !== PMON.plcF) return false;
  if (PMON.eqF !== 'all' && t.equipment_id !== PMON.eqF) return false;
  if (PMON.qual !== 'all' && pmQual(t) !== PMON.qual) return false;
  if (PMON.q) {
    const hay = (t.address + ' ' + t.param + ' ' + dmNameById(t.equipment_id)).toLowerCase();
    if (!hay.includes(PMON.q)) return false;
  }
  return true;
}
const PM_PAGE = 50;
function pmRender() {
  if (!PMON) return;
  const S = dmScope(PMON.scope),
    body = $('#pmBody'),
    msg = $('#pmMsg');
  const show = (t, cls) => {
    msg.hidden = !t;
    msg.className = 'pm-msg' + (cls ? ' ' + cls : '');
    msg.textContent = t || '';
  };
  const scroll = $('#pmScroll'),
    top = scroll.scrollTop;
  if (!S.plcs.length) {
    body.innerHTML = '';
    show(PMON.scope.scada_id ? 'No PLCs are linked to this SCADA. In Design mode select the SCADA › Properties › PLC Tag Monitor and tick its PLCs — or connect them with data lines.' : PMON.scope.plc_id ? 'This PLC has no tags yet.' : 'No PLC reads this equipment yet. In Design mode select a PLC › Properties › tick this equipment.', 'info');
    return pmMeta(0, 0);
  }
  if (!S.tags.length) {
    const bareN = Object.values(S.bare).reduce((n, a) => n + a.length, 0);
    body.innerHTML = '';
    show(bareN ? `The linked equipment has no tags yet (${bareN} equipment). In Design mode select a PLC › Properties › Create standard tags — or add tags with Configure tags….` : 'The linked PLCs read no equipment yet. In Design mode select a PLC › Properties › tick the equipment it reads (or connect them with data lines).', 'info');
    return pmMeta(0, 0);
  }
  if (!PMON.loaded) {
    body.innerHTML = '';
    show('Loading tag values…', 'info');
    return pmMeta(0, S.tags.length);
  }
  const vis = S.tags.filter(pmVisible);
  if (PMON.err) show(`Data service error: ${PMON.err.message || PMON.err}. Showing the last known values.`, 'err');
  else if (!vis.length) show('No tags match the current filters.', 'info');
  else show('');
  let html = '';
  const plcs = PMON.plcF === 'all' ? S.plcs : [PMON.plcF];
  plcs.forEach(pid => {
    const rows = vis.filter(t => t.plc_id === pid);
    if (!rows.length) return;
    const P = PMON.data.plcs[pid] || { status: 'Connecting' },
      col = PMON.collapsed.has(pid),
      lim = PMON.more[pid] || PM_PAGE;
    html += `<tr class="pm-g" data-plc="${esc(pid)}"><th colspan="7"><button type="button" class="pm-tog" aria-expanded="${!col}">${col ? '▸' : '▾'}</button><b>${esc(dmNameById(pid))}</b><span class="pm-id">${esc(pid)}</span><span class="pm-st st-${P.status.toLowerCase()}" data-plcst="${esc(pid)}">${pmPlcStatus(P)}</span><span class="pm-n">${rows.length} tag${rows.length === 1 ? '' : 's'}</span></th></tr>`;
    const bare = (S.bare[pid] || []).filter(eid => PMON.eqF === 'all' || PMON.eqF === eid);
    if (col) return;
    if (bare.length && !PMON.q && PMON.qual === 'all')
      html += `<tr class="pm-hint"><td colspan="7">No tags yet: ${bare.map(id => esc(dmNameById(id))).join(', ')} — in Design, select ${esc(dmNameById(pid))} › Properties › <b>Create standard tags</b>.</td></tr>`;
    rows.slice(0, lim).forEach(t => {
      const d = PMON.data.tags[t.tag_id],
        q = d ? d.q : 'Waiting';
      html += `<tr class="pm-r q-${q.toLowerCase()}" data-tag="${esc(t.tag_id)}"><td>${esc(dmNameById(t.equipment_id))}</td><td class="mono">${esc(t.address)}</td><td>${esc(t.param)}</td><td class="num" data-v>${pmFmtVal(t, d)}</td><td>${esc(t.unit || '')}</td><td data-q><span class="pm-q q-${q.toLowerCase()}">${q}</span></td><td class="mono" data-ts>${pmFmtTime(d && d.ts)}</td></tr>`;
    });
    if (rows.length > lim) html += `<tr class="pm-more"><td colspan="7"><button type="button" class="pm-btn" data-more="${esc(pid)}">Show ${Math.min(PM_PAGE, rows.length - lim)} more of ${rows.length - lim}</button></td></tr>`;
  });
  body.innerHTML = html;
  scroll.scrollTop = top;
  body.querySelectorAll('.pm-tog').forEach(b =>
    (b.onclick = () => {
      const pid = b.closest('tr').dataset.plc;
      PMON.collapsed.has(pid) ? PMON.collapsed.delete(pid) : PMON.collapsed.add(pid);
      pmRender();
    }),
  );
  body.querySelectorAll('[data-more]').forEach(b => (b.onclick = () => ((PMON.more[b.dataset.more] = (PMON.more[b.dataset.more] || PM_PAGE) + PM_PAGE), pmRender())));
  pmMeta(vis.length, S.tags.length);
}
function pmPlcStatus(P) {
  if (P.status === 'Disconnected') return `● Disconnected · since ${pmFmtTime(P.since)}`;
  if (P.status === 'Connected') return '● Connected';
  return '○ Connecting…';
}
function pmMeta(n, total) {
  $('#pmCount').textContent = total ? `${n} of ${total} tag${total === 1 ? '' : 's'}` : '';
  $('#pmAt').textContent = PMON.at ? `Last refresh ${pmFmtTime(PMON.at)}` : '';
}
/* live update in place: keeps scroll position, expanded groups, filters and focus */
function pmUpdate() {
  if (!PMON) return;
  const S = dmScope(PMON.scope),
    byId = Object.fromEntries(S.tags.map(t => [t.tag_id, t]));
  let needRender = false;
  document.querySelectorAll('#pmBody tr.pm-r').forEach(tr => {
    const t = byId[tr.dataset.tag];
    if (!t) return (needRender = true);
    const d = PMON.data.tags[t.tag_id],
      q = d ? d.q : 'Waiting';
    if (PMON.qual !== 'all' && q !== PMON.qual) needRender = true; // quality filter: the row no longer belongs
    tr.querySelector('[data-v]').innerHTML = pmFmtVal(t, d);
    tr.querySelector('[data-q]').innerHTML = `<span class="pm-q q-${q.toLowerCase()}">${q}</span>`;
    tr.querySelector('[data-ts]').textContent = pmFmtTime(d && d.ts);
    tr.className = `pm-r q-${q.toLowerCase()}`;
  });
  document.querySelectorAll('#pmBody [data-plcst]').forEach(el => {
    const P = PMON.data.plcs[el.dataset.plcst] || { status: 'Connecting' };
    el.className = `pm-st st-${P.status.toLowerCase()}`;
    el.textContent = pmPlcStatus(P);
  });
  // a row that now matches the quality filter must appear
  if (PMON.qual !== 'all' && S.tags.filter(pmVisible).length !== document.querySelectorAll('#pmBody tr.pm-r').length) needRender = true;
  const msg = $('#pmMsg');
  if (PMON.err) {
    msg.hidden = false;
    msg.className = 'pm-msg err';
    msg.textContent = `Data service error: ${PMON.err.message || PMON.err}. Showing the last known values.`;
  } else if (msg.classList.contains('err')) msg.hidden = true;
  if (needRender) pmRender();
  else pmMeta(S.tags.filter(pmVisible).length, S.tags.length);
}

/* ---------- Configure data… (Design mode, right-click) ---------- */
function dmConfigure(b) {
  const role = dmRole(b);
  if (!role) return;
  const M = dmEnsure(),
    id = dmId(b);
  const plcs = DOC.blocks.filter(x => dmRole(x) === 'plc'),
    equips = DOC.blocks.filter(x => dmRole(x) === 'equip');
  plcs.forEach(dmId);
  equips.forEach(dmId);
  const roleN = role === 'scada' ? 'SCADA' : role === 'plc' ? 'PLC' : 'Equipment';
  let work = M.tags.filter(t => (role === 'plc' ? t.plc_id === id : role === 'equip' ? t.equipment_id === id : false)).map(t => ({ ...t }));
  const opt = (list, sel) => list.map(x => `<option value="${esc(x.props.dmId)}" ${x.props.dmId === sel ? 'selected' : ''}>${esc(dmName(x))}</option>`).join('');
  const rowHTML = (t, i) => `<tr data-i="${i}">
    <td><input data-f="address" value="${esc(t.address || '')}" placeholder="e.g. MX01_SPEED" aria-label="Tag name / address"></td>
    <td><input data-f="param" value="${esc(t.param || '')}" placeholder="Parameter" aria-label="Parameter"></td>
    ${role === 'plc' ? `<td><select data-f="equipment_id" aria-label="Equipment"><option value="">—</option>${opt(equips, t.equipment_id)}</select></td>` : `<td><select data-f="plc_id" aria-label="PLC"><option value="">—</option>${opt(plcs, t.plc_id)}</select></td>`}
    <td><select data-f="type" aria-label="Data type">${DM_TYPES.map(x => `<option ${x === (t.type || 'REAL') ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
    <td><input data-f="unit" value="${esc(t.unit || '')}" class="sm" aria-label="Unit"></td>
    <td><input data-f="prec" value="${t.prec ?? ''}" class="xs" inputmode="numeric" aria-label="Display precision"></td>
    <td><input data-f="sim" value="${t.sim ?? ''}" class="sm" inputmode="decimal" aria-label="Simulation value" title="Sample value used by the simulation adapter"></td>
    <td><button type="button" class="ib dm-del" title="Remove tag" aria-label="Remove tag">✕</button></td></tr>`;
  const tableHTML = () => `<div class="dm-tw"><table class="dm-t"><thead><tr><th>Tag name / address</th><th>Parameter</th><th>${role === 'plc' ? 'Equipment' : 'PLC'}</th><th>Data type</th><th>Unit</th><th>Decimals</th><th title="Sample value for the simulation adapter">Sim. value</th><th></th></tr></thead><tbody id="dmRows">${work.map(rowHTML).join('')}</tbody></table></div>
    <div class="dm-acts"><button type="button" class="ib" id="dmAdd">＋ Add tag</button><span class="note" id="dmWarn"></span></div>`;
  const scadaHTML = () => {
    const cur = (M.scada[id] || {}).plcs || [];
    return `<div class="dm-sec"><b>PLCs monitored by this SCADA</b><div class="dm-chk">${plcs.length ? plcs.map(p => `<label><input type="checkbox" data-plc="${esc(p.props.dmId)}" ${cur.includes(p.props.dmId) ? 'checked' : ''}> ${esc(dmName(p))} <span class="note">${esc(p.props.dmId)} · ${M.tags.filter(t => t.plc_id === p.props.dmId).length} tags</span></label>`).join('') : '<span class="note">No PLC on the canvas yet — add a PLC from Library › Control &amp; IT.</span>'}</div>
      <button type="button" class="ib" id="dmFromLines">Select PLCs connected by data lines</button></div>`;
  };
  openModal(
    `<h3>Configure data — ${esc(roleN)} ${esc(b.name)}</h3>
     <div class="dm-ids"><label>${roleN} id<input value="${esc(id)}" readonly title="Stable identifier — does not change when the object is renamed"></label>
       <label>Display name<input id="dmName" value="${esc(b.props.dmName || '')}" placeholder="${esc(b.name)}"></label></div>
     ${role === 'scada' ? scadaHTML() : `<div class="dm-sec"><b>${role === 'plc' ? 'Tags read by this PLC' : 'Tags of this equipment'}</b><div class="note">Tag ids are unique; the same tag name may exist on another PLC.</div>${tableHTML()}</div>`}
     <div class="mact"><button class="ib" id="dmCancel" type="button">Cancel</button><button class="ib pri" id="dmSave" type="button">Save</button></div>`,
    'xl',
  );
  const readRows = () =>
    $$('#dmRows tr').forEach(tr => {
      const t = work[+tr.dataset.i];
      tr.querySelectorAll('[data-f]').forEach(el => (t[el.dataset.f] = el.value.trim()));
    });
  const bindRows = () => {
    $$('#dmRows .dm-del').forEach(btn =>
      (btn.onclick = () => {
        readRows();
        work.splice(+btn.closest('tr').dataset.i, 1);
        $('#dmRows').innerHTML = work.map(rowHTML).join('');
        bindRows();
      }),
    );
  };
  if (role !== 'scada') {
    bindRows();
    $('#dmAdd').onclick = () => {
      readRows();
      work.push({ tag_id: null, address: '', param: '', equipment_id: role === 'equip' ? id : '', plc_id: role === 'plc' ? id : '', type: 'REAL', unit: '', prec: '', sim: '' });
      $('#dmRows').innerHTML = work.map(rowHTML).join('');
      bindRows();
      $$('#dmRows tr:last-child input')[0]?.focus();
    };
  } else
    $('#dmFromLines').onclick = () => {
      // PLCs reachable from this SCADA over data lines (the existing data network walk)
      const reach = new Set();
      const q = [b.id];
      const seen = new Set(q);
      while (q.length) {
        const cur = q.shift();
        DOC.streams.forEach(s => {
          if ((typeof streamKind === 'function' ? streamKind(s) : s.kind) !== 'data') return;
          const o = s.from.b === cur ? s.to.b : s.to.b === cur ? s.from.b : null;
          if (!o || seen.has(o)) return;
          seen.add(o);
          const ob = B(o);
          if (dmRole(ob) === 'plc') reach.add(dmId(ob));
          else if (typeof isIT === 'function' && isIT(ob)) q.push(o); // through switches / gateways
        });
      }
      $$('.dm-chk input[data-plc]').forEach(c => (c.checked = reach.has(c.dataset.plc)));
      toast(reach.size ? `${reach.size} PLC${reach.size > 1 ? 's' : ''} connected by data lines` : 'No PLC is connected to this SCADA by data lines');
    };
  $('#dmCancel').onclick = closeModal;
  $('#dmSave').onclick = () => {
    if (role !== 'scada') readRows();
    // validation: tag name required; unique per PLC
    const keep = work.filter(t => t.address);
    const dup = new Set();
    const key = t => (t.plc_id || '') + '|' + t.address.toUpperCase();
    const others = M.tags.filter(t => !work.some(w => w.tag_id && w.tag_id === t.tag_id) && !(role === 'plc' ? t.plc_id === id : role === 'equip' ? t.equipment_id === id : false));
    [...others, ...keep].forEach((t, i, arr) => {
      if (t.plc_id && arr.findIndex(x => key(x) === key(t)) !== i) dup.add(t.address);
    });
    if (dup.size) {
      $('#dmWarn').textContent = `Tag name used twice on the same PLC: ${[...dup].join(', ')}`;
      return;
    }
    pushUndo();
    b.props.dmName = $('#dmName').value.trim() || undefined;
    if (!b.props.dmName) delete b.props.dmName;
    if (role === 'scada') M.scada[id] = { plcs: $$('.dm-chk input[data-plc]').filter(c => c.checked).map(c => c.dataset.plc) };
    else {
      keep.forEach(t => {
        if (!t.tag_id) t.tag_id = dmNewTagId();
        t.prec = t.prec === '' || t.prec == null ? null : +t.prec;
        t.sim = t.sim === '' || t.sim == null ? null : t.type === 'STRING' ? t.sim : +t.sim;
      });
      M.tags = [...others, ...keep];
    }
    changed();
    closeModal();
    toast('Data configuration saved');
  };
}

/* simulation helpers for the context menu (Simulate mode) */
const SIM_LOST = new Set();
const SimAdapterLost = b => SIM_LOST.has(dmId(b));
function SimToggle(b) {
  const id = dmId(b),
    lost = !SIM_LOST.has(id);
  lost ? SIM_LOST.add(id) : SIM_LOST.delete(id);
  SimAdapter.setConnected(id, !lost);
  toast(lost ? `${dmName(b)}: communication lost (simulation) — values are kept and marked stale` : `${dmName(b)}: communication restored (simulation)`);
  SandmanData.refresh();
}

/* ---------- v9.6 Properties panel: PLC Tag Monitor section (SCADA → PLCs, PLC → equipment) ---------- */
const dmSlug = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'EQ';
function dmStdTags(pid) {
  const M = dmEnsure(),
    L = dmLineLinks();
  let n = 0;
  dmPlcEquip(pid, L).forEach(eid => {
    const eb = dmBlock(eid);
    if (!eb || eb.tags.some(t => REG[t.id]) || M.tags.some(t => t.equipment_id === eid && t.plc_id === pid)) return;
    const base = dmSlug(eb.name);
    [
      [`${base}_RUN`, 'Running', 'BOOL', '', 1, 0],
      [`${base}_CURRENT`, 'Motor current', 'REAL', 'A', Math.round(30 + Math.random() * 40), 1],
    ].forEach(([address, param, type, unit, sim, prec]) => {
      if (M.tags.some(t => t.plc_id === pid && t.address === address)) return;
      M.tags.push({ tag_id: dmNewTagId(), address, param, equipment_id: eid, plc_id: pid, type, unit, prec, sim });
      n++;
    });
  });
  return n;
}
function dmPropsMount(T, b) {
  const role = dmRole(b);
  if (!role || !T) return;
  const M = dmEnsure(),
    id = dmId(b),
    L = dmLineLinks(),
    ed = MODE === 'design';
  const byName = (a, c) => dmName(a).localeCompare(dmName(c), undefined, { numeric: true });
  let h = `<div class="sec dm-props"><h5>PLC Tag Monitor <span class="r"><button class="sb" id="dmOpen" type="button">View tags</button></span></h5><div class="kv"><span>${role === 'scada' ? 'SCADA' : role === 'plc' ? 'PLC' : 'Equipment'} id</span><b class="mono">${esc(id)}</b></div>`;
  if (role === 'scada') {
    const ex = (M.scada[id] || {}).plcs || [],
      vl = L.scada[id] || new Set(),
      plcs = DOC.blocks.filter(x => dmRole(x) === 'plc').sort(byName);
    h += `<div class="note">PLCs this SCADA monitors — tick them here, or connect them with data lines.</div><div class="dm-pl">${
      plcs.length
        ? plcs.map(p => {
            const pid = dmId(p),
              viaL = vl.has(pid),
              n = dmScope({ plc_id: pid }).tags.length;
            return `<label><input type="checkbox" data-dmplc="${esc(pid)}" ${ex.includes(pid) || viaL ? 'checked' : ''} ${!ed || (viaL && !ex.includes(pid)) ? 'disabled' : ''}> ${esc(dmName(p))} <span class="note">${n} tag${n === 1 ? '' : 's'}${viaL ? ' · via data line' : ''}</span></label>`;
          }).join('')
        : '<span class="note">No PLC on the canvas yet — Library › Control &amp; IT › PLC.</span>'
    }</div>`;
  } else if (role === 'plc') {
    const ex = M.plcEq[id] || [],
      vl = L.plc[id] || new Set(),
      eqs = DOC.blocks.filter(x => dmRole(x) === 'equip').sort(byName);
    const sc = DOC.blocks.filter(x => dmRole(x) === 'scada' && dmScadaPlcs(dmId(x), L).includes(id)).map(dmName);
    const bareN = dmPlcEquip(id, L).filter(eid => {
      const e = dmBlock(eid);
      return e && !e.tags.some(t => REG[t.id]) && !M.tags.some(t => t.equipment_id === eid && t.plc_id === id);
    }).length;
    h += `<div class="kv"><span>Monitored by</span><b>${sc.length ? esc(sc.join(', ')) : '—'}</b></div><div class="note">Equipment this PLC reads — tick it here, or connect it with data lines. Its tags appear in the tag monitor.</div><div class="dm-pl">${eqs
      .map(e => {
        const eid = dmId(e),
          viaL = vl.has(eid),
          nt = e.tags.filter(t => REG[t.id]).length + M.tags.filter(t => t.equipment_id === eid && t.plc_id === id).length;
        return `<label><input type="checkbox" data-dmeq="${esc(eid)}" ${ex.includes(eid) || viaL ? 'checked' : ''} ${!ed || (viaL && !ex.includes(eid)) ? 'disabled' : ''}> ${esc(dmName(e))} <span class="note">${nt ? nt + ' tag' + (nt === 1 ? '' : 's') : 'no tags'}${viaL ? ' · via data line' : ''}</span></label>`;
      })
      .join('')}</div>
      <div class="row2"><button class="ib" id="dmStd" type="button" ${!ed || !bareN ? 'disabled' : ''} title="Adds a running status and a motor current tag (sample values) for each linked equipment without tags">Create standard tags${bareN ? ` (${bareN})` : ''}</button><button class="ib" id="dmCfg" type="button" ${ed ? '' : 'disabled'}>Configure tags…</button></div>`;
  } else {
    const rd = DOC.blocks.filter(x => dmRole(x) === 'plc' && dmPlcEquip(dmId(x), L).includes(id)).map(dmName);
    h += `<div class="kv"><span>Read by PLC</span><b>${rd.length ? esc(rd.join(', ')) : '—'}</b></div>${rd.length ? '' : '<div class="note">Select a PLC › Properties and tick this equipment, or connect it to a PLC with a data line.</div>'}`;
  }
  h += '</div>';
  T.insertAdjacentHTML('beforeend', h);
  T.querySelector('#dmOpen').onclick = () => openPlcMonitor(role === 'scada' ? { scada_id: id } : role === 'plc' ? { plc_id: id } : { equipment_id: id });
  T.querySelectorAll('[data-dmplc]').forEach(c =>
    (c.onchange = () => {
      pushUndo();
      const cur = new Set((M.scada[id] || {}).plcs || []);
      c.checked ? cur.add(c.dataset.dmplc) : cur.delete(c.dataset.dmplc);
      M.scada[id] = { plcs: [...cur] };
      changed();
    }),
  );
  T.querySelectorAll('[data-dmeq]').forEach(c =>
    (c.onchange = () => {
      pushUndo();
      const cur = new Set(M.plcEq[id] || []);
      c.checked ? cur.add(c.dataset.dmeq) : cur.delete(c.dataset.dmeq);
      M.plcEq[id] = [...cur];
      changed();
    }),
  );
  const std = T.querySelector('#dmStd');
  if (std)
    std.onclick = () => {
      pushUndo();
      const n = dmStdTags(id);
      changed();
      toast(n ? `${n} standard tags created — edit them in Configure tags…` : 'Every linked equipment already has tags');
    };
  const cfg = T.querySelector('#dmCfg');
  if (cfg) cfg.onclick = () => dmConfigure(b);
}
