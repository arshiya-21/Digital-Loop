/*! SandMan Digital Loop Studio — 19-replace-equipment.js
 *  v9.34 — Replace equipment: select a machine → right-click "Replace…" (or Properties › Replace) → pick any drawing from
 *  the library. The new drawing takes the old one's place: name, readings (tags), data / PLC link (dmId), description and
 *  position are kept; it is fitted to the old height without distortion; every line is moved to the matching port
 *  (same port name → same direction and material → nearest side). A message reports kept / re-attached / removed lines.
 *  One undo step (Ctrl+Z) restores the original. */
const RP_SKIP = new Set(['areaBox', 'label', 'title', 'clock', 'notice', 'legend', 'junction', 'controlPanel', 'statusMatrix', 'requestStation', 'toggleBtn']);
function rpIsEquipment(b) {
  const E = b && EQ[b.type];
  return !!E && !E.widget && !RP_SKIP.has(b.type);
}
function rpNatural(t) {
  const E = EQ[t];
  return { w: (E.def && E.def.w) || E.w || 80, h: (E.def && E.def.h) || E.h || 80 };
}
function rpPortsOfType(t) {
  // port list of a type at its natural size (for suggestions)
  try {
    const n = rpNatural(t);
    return rawPorts({ type: t, x: 0, y: 0, w: n.w, h: n.h, flip: false, rot: 0, props: {} }).map(p => ({ id: p[0], dir: p[4], kind: p[5] }));
  } catch (e) {
    return [];
  }
}
function rpScore(old, t) {
  // how well a library type fits as a replacement: same category, same port names, same in/out + material
  if (t === old.type) return -1;
  const a = rpPortsOfType(old.type), b = rpPortsOfType(t);
  let s = EQ[t].cat === EQ[old.type].cat ? 3 : 0;
  a.forEach(p => {
    if (p.kind === 'data') return;
    if (b.some(q => q.id === p.id)) s += 2;
    else if (b.some(q => q.dir === p.dir && q.kind === p.kind)) s += 1;
  });
  return s;
}
function rpThumb(t) {
  const E = EQ[t];
  if (E.smlib && typeof smlibUrl === 'function') {
    try {
      return `<img src="${smlibUrl(t, 'still', 'func', '')}" alt="">`;
    } catch (e) {}
  }
  return `<span class="rp-ph">${(E.n || t).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()}</span>`;
}
function openReplace(b) {
  if (!b || !rpIsEquipment(b)) return;
  if (typeof lockedNotice === 'function' && lockedNotice()) return;
  if (MODE !== 'design') {
    toast('Switch to Design to replace equipment');
    return;
  }
  const all = Object.keys(EQ).filter(t => rpIsEquipment({ type: t }) && EQ[t].n && t !== b.type && !(EQ[t].hidden));
  const sugg = all.map(t => [t, rpScore(b, t)]).filter(x => x[1] >= 3).sort((x, y) => y[1] - x[1]).slice(0, 12).map(x => x[0]);
  const card = t => `<button type="button" class="rp-card" data-t="${t}" title="${(EQ[t].n || t).replace(/"/g, '&quot;')}">${rpThumb(t)}<b>${EQ[t].n || t}</b><small>${CATS[EQ[t].cat] || ''}</small></button>`;
  openModal(
    `<h3>Replace ${b.name}</h3>
     <p class="rp-note">Pick the equipment to put in place of <b>${b.name}</b> (${EQ[b.type].n || b.type}). Its name, readings, data link and
     connections are kept; lines move to the matching inlets and outlets. Ctrl+Z undoes it.</p>
     <input id="rpQ" class="rp-q" placeholder="Search equipment (name or category)…" autocomplete="off">
     <div id="rpBody">${sugg.length ? `<h5>Suggested replacements</h5><div class="rp-grid">${sugg.map(card).join('')}</div>` : ''}<h5>All equipment</h5><div class="rp-grid" id="rpAll">${all.slice(0, 160).map(card).join('')}</div></div>`,
    'xl'
  );
  const pick = e => {
    const c = e.target.closest('.rp-card');
    if (!c) return;
    closeModal();
    replaceBlock(b.id, c.dataset.t);
  };
  $('#rpBody').onclick = pick;
  $('#rpQ').oninput = () => {
    const q = $('#rpQ').value.trim().toLowerCase();
    const hit = all.filter(t => !q || (EQ[t].n || t).toLowerCase().includes(q) || (CATS[EQ[t].cat] || '').toLowerCase().includes(q) || t.toLowerCase().includes(q));
    $('#rpBody').innerHTML = `<h5>${q ? hit.length + ' found' : 'All equipment'}</h5><div class="rp-grid">${hit.slice(0, 160).map(card).join('') || '<p class="rp-note">No equipment matches.</p>'}</div>`;
  };
}
function replaceBlock(id, type) {
  const b = B(id);
  if (!b || !EQ[type] || !rpIsEquipment(b)) return null;
  pushUndo();
  const oldType = b.type, oldName = EQ[oldType].n || oldType;
  const d0 = dims(b), cx = b.x + d0.W / 2, cy = b.y + d0.H / 2;
  const before = {};
  ports(b).forEach(p => (before[p.id] = { dir: p.dir, kind: p.kind, side: p.side, fx: p.lx / Math.max(1, d0.W), fy: p.ly / Math.max(1, d0.H) }));
  // the new drawing: same height (no distortion), width capped so a very wide drawing does not swamp the page
  const n = rpNatural(type);
  let k = d0.H / n.h;
  if (n.w * k > Math.max(d0.W * 2.2, 160)) k = Math.max(d0.W * 2.2, 160) / n.w;
  b.type = type;
  delete b.sc;
  b.w = Math.round(n.w * k);
  b.h = Math.round(n.h * k);
  ['smpal', 'paint', 'label'].forEach(x => delete b.props[x]);
  if (!b.props.desc || b.props.desc === oldName) b.props.desc = EQ[type].n || type;
  const d1 = dims(b);
  b.x = Math.round(cx - d1.W / 2);
  b.y = Math.round(cy - d1.H / 2);
  // move every line to the matching port of the new drawing
  const now = ports(b);
  const pick = (pid, end) => {
    if (now.some(p => p.id === pid)) return pid;                              // same port name
    const o = before[pid];
    if (!o) return pid === '@data' || /^@/.test(pid) ? pid : null;
    const util = x => /air|dust|gas|water|overflow|exhaust|vent/.test(x);   // utility connections (filters, water, gas)
    const sameUse = p => util(p.id) === util(pid);                            // material ports map to material ports
    let c = now.filter(p => p.dir === o.dir && p.kind === o.kind && sameUse(p)); // same direction, material and use
    if (!c.length) c = now.filter(p => p.dir === o.dir && p.kind !== 'data' && sameUse(p)); // same direction and use
    if (!c.length) c = now.filter(p => p.dir === o.dir && p.kind !== 'data');  // same direction
    if (!c.length && o.kind === 'data') c = now.filter(p => p.kind === 'data');
    if (!c.length) return null;
    const dist = p => (p.side === o.side ? 0 : 1) + Math.hypot(p.lx / Math.max(1, d1.W) - o.fx, p.ly / Math.max(1, d1.H) - o.fy);
    return c.sort((x, y) => dist(x) - dist(y))[0].id;
  };
  let kept = 0, moved = 0;
  const lost = [];
  DOC.streams = DOC.streams.filter(s => {
    let touched = false;
    for (const end of ['from', 'to']) {
      if (s[end].b !== id) continue;
      touched = true;
      const np = pick(s[end].p, end);
      if (!np) {
        lost.push(`${B(s.from.b)?.name || '?'} → ${B(s.to.b)?.name || '?'}`);
        return false;
      }
      if (np === s[end].p) kept++;
      else moved++;
      s[end].p = np;
    }
    if (touched) {
      s.pts = null;
      if (s.route === 'orth') s.route = 'auto';
      s.mid = null;
    }
    return true;
  });
  if (typeof logEv === 'function') logEv(`Replaced ${b.name}: ${oldName} → ${EQ[type].n || type}`);
  if (typeof changed === 'function') changed();
  else renderAll();
  toast(`${b.name} replaced with ${EQ[type].n || type} · ${kept} line${kept === 1 ? '' : 's'} kept · ${moved} re-attached` + (lost.length ? ` · ${lost.length} not connected (${lost.join(', ')}) — Ctrl+Z to undo` : ''));
  return { kept, moved, lost };
}
(function rpStyle() {
  const st = document.createElement('style');
  st.textContent = `.rp-note{color:var(--muted,#5b6b7a);font-size:13px;margin:4px 0 10px}.rp-q{width:100%;padding:8px 10px;border:1px solid var(--line,#cfd8e3);border-radius:8px;font-size:14px;margin-bottom:8px}
  #rpBody h5{margin:10px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#5b6b7a)}#rpBody{max-height:60vh;overflow:auto}
  .rp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px}.rp-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border:1px solid var(--line,#cfd8e3);border-radius:10px;background:var(--panel,#fff);cursor:pointer;text-align:center;font:inherit}
  .rp-card:hover,.rp-card:focus-visible{border-color:#1f6fd8;box-shadow:0 0 0 2px #1f6fd833}.rp-card img{width:100%;height:64px;object-fit:contain}.rp-card b{font-size:12px;line-height:1.2}.rp-card small{font-size:10.5px;color:var(--muted,#5b6b7a)}
  .rp-ph{width:100%;height:64px;display:flex;align-items:center;justify-content:center;background:#e8eef5;border-radius:6px;font-weight:700;color:#5b6b7a}`;
  document.head.appendChild(st);
})();
