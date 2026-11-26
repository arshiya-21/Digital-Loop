/*! SandMan Digital Loop Studio — 19b-level-fill.js
 *  v9.47 — realistic sand levels in the storage drawings (bins, silos, hoppers, sieve hopper).
 *  Before: the drawing's own animation filled and emptied the vessel in a fixed loop, whatever the plant did.
 *  Now: the fill height follows the vessel's level — its Level reading when it has one, otherwise a level kept from
 *  the material balance (rises while the feeding equipment runs, falls while the outlet draws sand). The inflow /
 *  outflow streams inside the drawing show only when sand really goes in / out. The level moves smoothly
 *  (levelShown in 02-model.js), and is kept per equipment, so editing or redrawing the layout never makes it jump. */

var LV_RE = /\ba-rlvl\b/;
var LV_HAS = {};
function smlibHasLevel(id) {
  if (!LV_HAS) return false; // first render runs before this file is loaded
  if (!(id in LV_HAS)) LV_HAS[id] = LV_RE.test(SMLIB_SRC[id] || '');
  return LV_HAS[id];
}
/* simulated level for vessels without a Level reading: { x: % , flow: 'in' | 'out' | 'both' | 'none', t } */
var LVSIM = {};
function lvSimStep(b) {
  const o = (LVSIM[b.id] = LVSIM[b.id] || { x: 62, flow: 'both', v: 0.62 });
  if (MODE !== 'monitor' || RP) return o;
  const ups = lvLinks(b, 'in'),
    dns = lvLinks(b, 'out');
  const inOn = ups.length ? ups.some(u => lvFed(u)) : true,
    outOn = dns.length ? dns.some(isRun) : true;
  const fillR = 70 / 120,
    drainR = 70 / 180;
  let rate;
  if (inOn && outOn) rate = clamp((62 + Math.sin(SIMT / 90 + b.id.length) * 8 - o.x) * 0.03, -0.25, 0.25);
  else rate = (inOn ? fillR : 0) - (outOn ? drainR : 0);
  o.x = clamp(o.x + rate, 3, 97);
  o.flow = inOn && outOn ? 'both' : inOn ? 'in' : outOn ? 'out' : 'none';
  return o;
}
/* level key for a block's drawing: "<percent in 2 % steps>~<flow>" or '' (drawing keeps its own animation) */
function lvKey(b) {
  if (!b || !b.id || !EQ[b.type]) return '';
  const d = EQ[b.type].def,
    id = d ? smlibIdOf(d) : null;
  if (!id || !smlibHasLevel(id)) return '';
  const ss = symState(b);
  let L, flow;
  /* a level reading with no value is "no data" (28-live-level.js decides: stand still or keep the drawing's own loop) —
     not a level made up from the material balance, which is only for vessels with no level reading at all */
  if (ss.level == null && lvTagOf(b)) return '';
  if (ss.level != null) {
    L = ss.level;
    const lt = lvTagOf(b) || b.tags[0];
    flow = (lt && VAL[lt.id] && VAL[lt.id].flow) || 'both';
  } else {
    const o = LVSIM[b.id] || lvSimStep(b);
    if (o.v == null) o.v = o.x / 100;
    o.v += clamp(o.x / 100 - o.v, -0.04, 0.04);
    L = o.v;
    flow = o.flow;
  }
  if (!effRun(b) && MODE === 'monitor') flow = 'none';
  return `${Math.round(clamp(L, 0, 1) * 50) * 2}~${MODE === 'monitor' ? flow : 'none'}`;
}
/* the drawing with its fill fixed at the level and the inflow / outflow shown as the plant does it */
var smlibUrlLv0 = smlibUrl;
smlibUrl = function (id, v, pal, paint, lv) {
  const u = smlibUrlLv0(id, v, pal, paint);
  if (!lv || !smlibHasLevel(id)) return u;
  const key = 'lv:' + id + ':' + v + ':' + pal + ':' + paint + ':' + lv;
  if (SMLIB_URL[key]) return SMLIB_URL[key];
  const [q, flow] = lv.split('~'),
    L = clamp(+q / 100, 0, 1);
  let s = decodeURIComponent(u.slice(u.indexOf(',') + 1));
  const restyle = (attrs, add) =>
    /style="/.test(attrs) ? attrs.replace(/style="([^"]*)"/, (m, st) => `style="${st};${add}"`) : attrs + ` style="${add}"`;
  // fill level: the element animated by rh-lvl travels --lo px between full (0) and empty (--lo)
  s = s.replace(/<([a-zA-Z]+)([^>]*?)class="([^"]*?)\ba-rlvl\b([^"]*)"([^>]*?)(\/?)>/g, (m, tag, pre, c1, c2, post, sl) => {
    const lo = +(((pre + post).match(/--lo:\s*(-?[\d.]+)px/) || [])[1] || 0);
    const y = (lo * (1 - L)).toFixed(1);
    return `<${tag}${restyle(`${pre}class="${(c1 + c2).replace(/\s+/g, ' ').trim()}"${post}`, `transform:translateY(${y}px);animation:none`)}${sl}>`;
  });
  // inflow / outflow sand streams inside the drawing
  const showIn = flow === 'in' || flow === 'both',
    showOut = flow === 'out' || flow === 'both';
  s = s.replace(/<([a-zA-Z]+)([^>]*?)class="([^"]*?)\ba-r(in|out)\b([^"]*)"([^>]*?)(\/?)>/g, (m, tag, pre, c1, io, c2, post, sl) => {
    const on = io === 'in' ? showIn : showOut;
    return `<${tag}${restyle(`${pre}class="${(c1 + c2).replace(/\s+/g, ' ').trim()}"${post}`, `animation:none;opacity:${on ? 1 : 0}`)}${sl}>`;
  });
  return (SMLIB_URL[key] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s));
};
/* keep the pictures of one block at its current level (called from liveCanvas every second) */
function smLvSync(b, g) {
  if (!g) return;
  const k = lvKey(b);
  g.querySelectorAll('image.smi').forEach(el => {
    const p = el.getAttribute('data-smi').split('|');
    if ((p[4] || '') === k) return;
    p[4] = k;
    el.setAttribute('data-smi', p.join('|'));
    smlibSet(el);
  });
}
/* the simulated levels move with the plant (Simulate / Publish, every second while live) */
setInterval(() => {
  if (MODE !== 'monitor' || RP || (typeof LIVE !== 'undefined' && !LIVE)) return;
  DOC.blocks.forEach(b => {
    const d = EQ[b.type] && EQ[b.type].def,
      id = d ? smlibIdOf(d) : null;
    if (id && smlibHasLevel(id) && !lvTagOf(b)) lvSimStep(b);
  });
}, 1000);

/* v9.47 — line direction: a line drawn from an inlet to an outlet animates backwards, so its moving sand is
   reversed to run from the outlet to the inlet (the real direction of the material) */
function streamReversed(s) {
  try {
    const fb = B(s.from.b),
      tb = B(s.to.b);
    if (!fb || !tb || fb.type === 'junction' || tb.type === 'junction') return false;
    const fp = ports(fb).find(p => p.id === s.from.p),
      tp = ports(tb).find(p => p.id === s.to.p);
    return !!(fp && tp && fp.dir === 'in' && tp.dir === 'out');
  } catch (e) {
    return false;
  }
}
