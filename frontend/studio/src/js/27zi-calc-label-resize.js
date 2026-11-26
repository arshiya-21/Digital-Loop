/*! SandMan Digital Loop Studio — 27zi-calc-label-resize.js
 *  ƒx calculated-value labels resize like the normal data labels: in Design a corner handle appears on the label;
 *  drag it to make the label bigger or smaller (50 % – 300 %). The size is the label's own scale, ent.look.z — the same
 *  value as Label style › Size (S / M / L / XL), so both stay in step. Saved with the loop; one undo step per drag.
 *  Not offered in Simulate or Publish: operators do not change the drawing. */

const CTR_MIN = 0.5,
  CTR_MAX = 3;
let CT_RESIZE = null;

/* the handle: a small square on the bottom-right corner, drawn inside the label so it scales with it */
function ctrGrips() {
  const L = typeof ctLayer === 'function' ? ctLayer() : null;
  if (!L) return;
  const on = MODE === 'design';
  L.querySelectorAll('.ct-lab').forEach(g => {
    const had = g.querySelector('.ct-grip');
    if (!on) return had && had.remove();
    if (had) return;
    const r = g.querySelector('.ct-lb');
    if (!r) return;
    const w = +r.getAttribute('width') || 0,
      h = +r.getAttribute('height') || 0,
      z = +(((B(g.dataset.cb) || {}).tags || []).find(t => t.id === g.dataset.ctid)?.look?.z) || 1,
      s = 9 / z; // about 9 px on screen at 100 %, whatever the label's size
    g.insertAdjacentHTML('beforeend', `<rect class="ct-grip" x="${w - s / 2}" y="${h - s / 2}" width="${s}" height="${s}" rx="${s / 4}"><title>Drag to resize</title></rect>`);
  });
}
{
  const prev = ctLabelsAll;
  ctLabelsAll = function () {
    const r = prev.apply(this, arguments);
    if (!CT_RESIZE) ctrGrips();
    return r;
  };
}

/* window, capture phase: runs before the label's own drag-to-move handler (on document) */
window.addEventListener(
  'pointerdown',
  e => {
    const grip = e.target.closest && e.target.closest('#Lct .ct-grip');
    if (!grip || MODE !== 'design') return;
    const l = grip.closest('.ct-lab'),
      b = B(l.dataset.cb),
      ent = b && (b.tags || []).find(t => t.id === l.dataset.ctid);
    if (!ent) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const r = l.querySelector('.ct-lb');
    CT_RESIZE = { l, b, ent, x0: e.clientX, y0: e.clientY, z0: +(ent.look && ent.look.z) || 1, w: +r.getAttribute('width') || 100, h: +r.getAttribute('height') || 28, moved: false };
  },
  true,
);
window.addEventListener('pointermove', e => {
  const R = CT_RESIZE;
  if (!R) return;
  const k = (VIEW && VIEW.k) || 1,
    dx = (e.clientX - R.x0) / k,
    dy = (e.clientY - R.y0) / k;
  if (!R.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
  if (!R.moved) pushUndo();
  R.moved = true;
  // the corner follows the pointer: the larger of the width and height changes sets the new scale
  const z = clamp(Math.max((R.w * R.z0 + dx) / R.w, (R.h * R.z0 + dy) / R.h), CTR_MIN, CTR_MAX);
  R.z = Math.round(z * 100) / 100;
  const p = R.ent.cpos || { x: dims(R.b).W + 8, y: 0 };
  R.l.setAttribute('transform', `translate(${R.b.x + p.x},${R.b.y + p.y}) scale(${R.z})`);
});
window.addEventListener('pointerup', () => {
  const R = CT_RESIZE;
  CT_RESIZE = null;
  if (!R || !R.moved) return;
  R.ent.look = Object.assign({}, R.ent.look, { z: R.z });
  if (R.z === 1) delete R.ent.look.z;
  changed();
  ctLabelsAll();
});

document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="ctrCss">
#Lct .ct-grip{fill:#fff;stroke:#6d28d9;stroke-width:1.5;vector-effect:non-scaling-stroke;cursor:nwse-resize;opacity:0;transition:opacity .12s}
#Lct .ct-lab:hover .ct-grip,#Lct .ct-grip:hover{opacity:1}
</style>`,
);
