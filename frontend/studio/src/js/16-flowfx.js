/*! SandMan Digital Loop Studio — 16-flowfx.js
 *  v2.2 — flow animation styles from the original Loop Studio. The current animation stays the default; the
 *  flowsheet can use another style (Simulate tab → Motion), and every line can override it (right-click a line →
 *  Animation, or the line's properties). Styles show while the plant runs in Simulate / Publish / Replay.
 *  Saved as DOC.flowStyle, DOC.flowSpeed and stream.anim. */
var FLOW_STYLES = {
  inherit: ['Same as flowsheet', ''],
  default: ['Standard flow (default)', 'Light dashes running along the line'],
  particles: ['Particles', 'Round particles travel along the line'],
  arrows: ['Direction arrows', 'Chevrons show the flow direction'],
  pulses: ['Pulses', 'Glowing pulses travel along the line'],
  pipe3d: ['3-D industrial pipe', 'Steel pipe with flanges and moving grains inside'],
  steel: ['Plant steel pipe', 'Steel pipe with the material flowing inside'],
  granular: ['Granular sand', 'Dense sand grains, two speeds'],
  none: ['No animation', 'The line stays still'],
};
function flowStyleOf(s) {
  if (!FLOW_STYLES) return 'default'; // first render runs before this file is loaded
  const v = s.anim && s.anim !== 'inherit' ? s.anim : DOC.flowStyle || 'default';
  return FLOW_STYLES[v] ? v : 'default';
}
function flowSpeed() {
  return DOC.flowSpeed || 1;
}
function pathLen(G) {
  let L = 0;
  for (let i = 1; i < G.pts.length; i++) L += Math.hypot(G.pts[i].x - G.pts[i - 1].x, G.pts[i].y - G.pts[i - 1].y);
  return L;
}
/* drawn under the line (pipe bodies) */
function flowUnder(s, G, st) {
  if (st === 'pipe3d')
    return `<g class="fxu"><path d="${G.d}" class="p3-shadow"/><path d="${G.d}" class="p3-out"/><path d="${G.d}" class="p3-body"/><path d="${G.d}" class="p3-sheen"/><path d="${G.d}" class="p3-flange"/></g>`;
  if (st === 'steel') return `<g class="fxu"><path d="${G.d}" class="sp-out"/><path d="${G.d}" class="sp-body"/></g>`;
  return '';
}
/* drawn over the line (moving parts) */
function flowOver(s, G, st) {
  if (!FLOW_STYLES) return '';
  const c = KIND[s.kind]?.c || '#555',
    sp = flowSpeed();
  if (s.kind === 'data' && st === 'default') {
    // v4.0 — data packets travel along the line (SMIL along the line's own path: smooth, no script)
    const L = pathLen(G),
      n = Math.max(1, Math.min(8, Math.round(L / 90))),
      dur = Math.max(1.2, L / (120 * sp));
    let h = '<g class="fx fx-pk">';
    for (let i = 0; i < n; i++)
      h += `<g><rect x="-5" y="-3" width="10" height="6" rx="1.6" fill="${c}" stroke="#ffffff" stroke-width="1.2"/><rect x="-11" y="-1" width="5" height="2" rx="1" fill="${c}" opacity=".45"/><animateMotion dur="${dur.toFixed(2)}s" repeatCount="indefinite" begin="-${((i * dur) / n).toFixed(2)}s" rotate="auto"><mpath href="#sv_${s.id}"/></animateMotion></g>`;
    return h + '</g>';
  }
  if (st === 'particles') return `<path d="${G.d}" class="fx fx-dots" stroke="${c}"/>`;
  if (st === 'pulses') return `<path d="${G.d}" class="fx fx-pulse" stroke="${c}"/>`;
  if (st === 'pipe3d') return `<path d="${G.d}" class="fx fx-grain" stroke="${c}"/><path d="${G.d}" class="fx fx-grain2" stroke="${c}"/>`;
  if (st === 'steel') return `<path d="${G.d}" class="fx fx-inner" stroke="${c}"/>`;
  if (st === 'granular') return `<path d="${G.d}" class="fx fx-g1" stroke="${c}"/><path d="${G.d}" class="fx fx-g2" stroke="${c}"/>`;
  if (st === 'arrows') {
    const n = Math.max(1, Math.floor(pathLen(G) / 16));
    return `<text class="fx fx-arr" style="fill:${c};font-size:15px;font-weight:800;stroke:#fff;stroke-width:2.5px;paint-order:stroke" dy="5"><textPath href="#sv_${s.id}" startOffset="0">${'›'.repeat(n)}<animate attributeName="startOffset" from="0" to="16" dur="${(0.9 / sp).toFixed(2)}s" repeatCount="indefinite"/></textPath></text>`;
  }
  return '';
}
/* menus and settings */
function flowMenuItems(s) {
  const cur = s.anim || 'inherit',
    ds = MODE !== 'design';
  return Object.entries(FLOW_STYLES).map(([k, [n]]) => ({
    t: k === 'inherit' ? `${n} (${FLOW_STYLES[DOC.flowStyle || 'default'][0]})` : n,
    k: cur === k ? '✓' : '',
    dis: ds,
    f: () => {
      pushUndo();
      if (k === 'inherit') delete s.anim;
      else s.anim = k;
      changed();
      toast(`Line animation: ${FLOW_STYLES[k][0]} — runs in Simulate and Publish`);
    },
  }));
}
function applyFlowSpeed() {
  document.documentElement.style.setProperty('--fxs', flowSpeed());
}
(() => {
  const st = $('#flowStyle'),
    sp = $('#flowSpeed');
  if (st) {
    st.innerHTML = Object.entries(FLOW_STYLES)
      .filter(([k]) => k !== 'inherit')
      .map(([k, [n, d]]) => `<option value="${k}" title="${d}">${n}</option>`)
      .join('');
    st.onchange = () => {
      pushUndo();
      DOC.flowStyle = st.value;
      changed();
      toast(`Motion: ${FLOW_STYLES[st.value][0]} for all lines (lines with their own animation keep it)`);
    };
  }
  if (sp)
    sp.onchange = () => {
      DOC.flowSpeed = +sp.value;
      applyFlowSpeed();
      changed();
    };
  const sync = () => {
    if (st && document.activeElement !== st) st.value = DOC.flowStyle || 'default';
    if (sp && document.activeElement !== sp) sp.value = String(flowSpeed());
    applyFlowSpeed();
  };
  setInterval(sync, 700);
  sync();
})();
