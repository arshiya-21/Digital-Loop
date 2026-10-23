/*! SandMan Process Flowsheet — 07-reuse.js
 *  Custom equipment designer, generic industry library, modules, copy/paste, multi-select, templates manager
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===================================================================
   Reusability layer: custom equipment, generic library, templates,
   modules & copy/paste, multi-select, tag CSV export, control charts
   =================================================================== */
const SHAPES = {
  machine: 'Machine with rotor',
  box: 'Box / cabinet',
  tank: 'Vertical tank',
  silo: 'Silo / bin',
  hopper: 'Hopper',
  drum: 'Horizontal drum / kiln',
  conveyor: 'Conveyor',
  pump: 'Pump',
  fan: 'Fan / blower',
  hx: 'Heat exchanger',
  oven: 'Oven / furnace',
  robot: 'Robot / manipulator',
  press: 'Press',
  circle: 'Circle',
  base: 'Copy of a built-in drawing',
  smlib: 'SandMan drawing (original picture)', // v5.2
  svg: 'Custom SVG (paste)',
  img: 'Image (upload)',
};
const ANIMS = {
  none: 'None',
  spin: 'Rotating part',
  vib: 'Vibration',
  flow: 'Material moving on top',
  glow: 'Glow / heat',
  fall: 'Discharge at bottom',
  slide: 'Parts moving along',
  press: 'Press stroke',
};
let CUSTLIB = [];
try {
  CUSTLIB = JSON.parse(localStorage.getItem('sandman-equip-lib') || '[]');
} catch (e) {}
function saveCustLib() {
  try {
    localStorage.setItem('sandman-equip-lib', JSON.stringify(CUSTLIB));
  } catch (e) {
    toast('Browser storage is full — export your library to keep it');
  }
}
function catIdx(name) {
  let i = CATS.indexOf(name);
  if (i < 0) {
    CATS.push(name);
    i = CATS.length - 1;
  }
  return i;
}
const numOrNull = v => (v === '' || v == null || !isFinite(+v) ? null : +v);
function sanitizeSvg(t) {
  return String(t || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#');
}
/*
 * An uploaded drawing keeps its own ids, classes and inherited paint.
 *
 * The root `<svg>` is dropped here — the canvas supplies its own, sized and
 * placed — and the children are inlined into the page. That is three ways for
 * an upload to come out looking unlike the file:
 *
 *   **ids are global.** Illustrator and Figma name their gradients, clips,
 *   masks and filters `a`, `b`, `SVGID_1_`, `clip0_1_2`. Two uploads in one
 *   loop both define `#a`; the second wins for both, so one machine is drawn
 *   with another's gradient, or clipped to another's shape.
 *
 *   **class names are global too.** `.st0 { fill:#fff }` is what Illustrator
 *   writes, every time, counting from zero. Two uploads and the colours swap.
 *
 *   **the root's paint is inherited.** `<svg fill="#333">` colours every child
 *   that does not say otherwise. Dropping the root dropped that, and those
 *   children fell back to black.
 *
 * So ids are renamed with the instance's own suffix and every reference to
 * them is renamed with it, the stylesheet is confined to this drawing's own
 * group, and whatever the root was passing down is passed down by that group.
 */
const SVG_INHERITS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit',
  'color', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'letter-spacing', 'shape-rendering', 'style',
];

/** Every `id="…"` the markup defines, in order of appearance. */
function svgIds(markup) {
  const found = new Set();
  const pattern = /\sid\s*=\s*["']([^"']+)["']/gi;
  let hit;
  while ((hit = pattern.exec(markup))) found.add(hit[1]);
  return [...found];
}

/** `#a` → `#a__u12`, wherever it is written: id, url(), href, begin. */
function renameIds(markup, suffix) {
  for (const id of svgIds(markup)) {
    // Escaped because an id may legally hold regex punctuation.
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const to = `${id}__${suffix}`;
    markup = markup
      .replace(new RegExp(`(\\sid\\s*=\\s*["'])${safe}(["'])`, 'g'), `$1${to}$2`)
      .replace(new RegExp(`url\\((["']?)#${safe}\\1\\)`, 'g'), `url($1#${to}$1)`)
      .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*["'])#${safe}(["'])`, 'g'), `$1#${to}$2`)
      .replace(new RegExp(`(\\sbegin\\s*=\\s*["'])${safe}\\.`, 'g'), `$1${to}.`);
  }
  return markup;
}

/**
 * Confine a `<style>` block to one group, by putting that group in front of
 * every selector in it.
 *
 * Renaming the classes instead would mean rewriting both the stylesheet and
 * every `class` attribute, and getting either half wrong silently unpaints
 * the drawing. An ancestor selector needs no attribute touched at all.
 *
 * At-rules are left exactly as they are: `@keyframes` names frames rather
 * than elements, and prefixing those would break the animation it describes.
 */
function scopeSvgStyles(markup, scope) {
  return markup.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (whole, css) => {
    if (/@(media|supports|keyframes|font-face|import)/i.test(css)) return whole;
    const scoped = css.replace(/(^|\})([^@{}]+)\{/g, (_, close, selectors) =>
      close + selectors.split(',').map(one => {
        const trimmed = one.trim();
        return trimmed ? `.${scope} ${trimmed}` : one;
      }).join(', ') + '{');
    return whole.replace(css, scoped);
  });
}

function parseSvg(src, uid) {
  src = String(src || '');
  const m = src.match(/<svg[^>]*>/i);
  let vb = null,
    inner = src,
    inherited = '';
  if (m) {
    const v = m[0].match(/viewBox\s*=\s*["']([^"']+)["']/i);
    if (v) vb = v[1];
    else {
      const w = m[0].match(/\swidth\s*=\s*["']?([\d.]+)/i),
        h = m[0].match(/\sheight\s*=\s*["']?([\d.]+)/i);
      if (w && h) vb = `0 0 ${w[1]} ${h[1]}`;
    }
    // What the root was passing down to its children, which they still need.
    inherited = SVG_INHERITS.map(name => {
      const got = m[0].match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
      return got ? ` ${name}="${esc(got[1])}"` : '';
    }).join('');
    inner = src.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
  }

  const suffix = `u${uid == null ? '0' : String(uid).replace(/[^A-Za-z0-9_-]/g, '')}`;
  const scope = `svgs-${suffix}`;
  let body = sanitizeSvg(inner);
  body = renameIds(body, suffix);
  body = scopeSvgStyles(body, scope);

  return {
    vb: vb || '0 0 100 100',
    inner: `<g class="${scope}"${inherited}>${body}</g>`,
  };
}
function shade(hex, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#334155';
  const n = parseInt(m[1], 16);
  return `rgb(${Math.round((n >> 16) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}
function customDraw(d, w, h, b, uid) {
  if (d.shape === 'smlib' && typeof smlibDraw === 'function') return smlibDraw(d, w, h, b); // v2.5 — copy of a SandMan library drawing
  const c = d.color || '#9aa8ba',
    k = shade(c, 0.55),
    anim = d.anim || 'none',
    sw = 'stroke-width="1.4"';
  let s = '';
  const rotor = (cx, cy, r) =>
    `<g class="spin"><path d="M${cx} ${cy - r}L${cx + r * 0.28} ${cy - r * 0.28}L${cx + r} ${cy}L${cx + r * 0.28} ${cy + r * 0.28}L${cx} ${cy + r}L${cx - r * 0.28} ${cy + r * 0.28}L${cx - r} ${cy}L${cx - r * 0.28} ${cy - r * 0.28}Z" fill="${k}" opacity=".85"/></g>`;
  switch (d.shape) {
    case 'machine':
      s = `<rect x="1" y="${h * 0.1}" width="${w - 2}" height="${h * 0.8}" rx="4" fill="${c}" stroke="${k}" ${sw}/><rect x="${w * 0.12}" y="${h * 0.24}" width="${w * 0.5}" height="${h * 0.5}" rx="3" fill="${k}" opacity=".3"/>${rotor(w * 0.37, h * 0.49, Math.min(w, h) * 0.18)}<circle cx="${w * 0.82}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.09}" fill="#1f9d55" stroke="#fff"/><rect x="${w * 0.74}" y="${h * 0.48}" width="${w * 0.16}" height="${h * 0.26}" rx="2" fill="#0e2a47"/><rect x="${w * 0.04}" y="${h * 0.9}" width="${w * 0.92}" height="${h * 0.1}" fill="${k}"/>`;
      break;
    case 'tank':
      s = `<rect x="1" y="${h * 0.08}" width="${w - 2}" height="${h * 0.84}" fill="${c}" stroke="${k}" ${sw}/><ellipse cx="${w / 2}" cy="${h * 0.08}" rx="${w / 2 - 1}" ry="${h * 0.06}" fill="${c}" stroke="${k}" ${sw}/><path d="M1 ${h * 0.92}A${w / 2 - 1} ${h * 0.06} 0 0 0 ${w - 1} ${h * 0.92}" fill="none" stroke="${k}" ${sw}/>`;
      break;
    case 'silo': {
      const by = h * 0.7;
      s = `<path d="M2 8V${by}L${w / 2 - 5} ${h - 4}H${w / 2 + 5}L${w - 2} ${by}V8Q${w / 2} -2 2 8Z" fill="${c}" stroke="${k}" ${sw}/>`;
      break;
    }
    case 'hopper':
      s = `<path d="${hopperPath(w, h).d}" fill="${c}" stroke="${k}" ${sw}/>`;
      break;
    case 'drum':
      s = `<rect x="1" y="${h * 0.15}" width="${w - 2}" height="${h * 0.7}" rx="${h * 0.35}" fill="${c}" stroke="${k}" ${sw}/><path d="M${w * 0.3} ${h * 0.15}V${h * 0.85}M${w * 0.7} ${h * 0.15}V${h * 0.85}" stroke="${k}"/>`;
      break;
    case 'conveyor':
      s = beltDraw(w, h);
      break;
    case 'pump': {
      const r = Math.min(w, h) * 0.38;
      s = `<rect x="${w * 0.08}" y="${h - 6}" width="${w * 0.74}" height="6" fill="${k}"/><path d="M${w * 0.45} ${h * 0.5 - r}H${w - 1}V${h * 0.5 - r * 0.35}H${w * 0.6}" fill="${c}" stroke="${k}" stroke-width="1.2"/><circle cx="${w * 0.45}" cy="${h * 0.5}" r="${r}" fill="${c}" stroke="${k}" ${sw}/>${rotor(w * 0.45, h * 0.5, r * 0.7)}`;
      break;
    }
    case 'fan': {
      const r = Math.min(w, h) * 0.45;
      s = `<circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="${c}" stroke="${k}" ${sw}/><g class="spin">${[0, 1, 2, 3].map(i => `<ellipse cx="${w / 2}" cy="${h / 2 - r * 0.45}" rx="${r * 0.18}" ry="${r * 0.42}" fill="${k}" opacity=".8" transform="rotate(${i * 90} ${w / 2} ${h / 2})"/>`).join('')}</g><circle cx="${w / 2}" cy="${h / 2}" r="${r * 0.12}" fill="#fff"/>`;
      break;
    }
    case 'hx':
      s = `<rect x="1" y="${h * 0.2}" width="${w - 2}" height="${h * 0.6}" rx="${h * 0.3}" fill="${c}" stroke="${k}" ${sw}/><path d="M${w * 0.1} ${h / 2}${[...Array(7)].map((_, i) => `L${w * (0.18 + i * 0.11)} ${h * (i % 2 ? 0.32 : 0.68)}`).join('')}L${w * 0.9} ${h / 2}" fill="none" stroke="${k}" stroke-width="1.6"/>`;
      break;
    case 'oven':
      s = `<rect x="1" y="1" width="${w - 2}" height="${h - 8}" rx="3" fill="${c}" stroke="${k}" ${sw}/><rect class="glow" x="${w * 0.15}" y="${h * 0.2}" width="${w * 0.7}" height="${h * 0.45}" rx="2" fill="#ffb347" stroke="#d9480f"/><rect x="${w * 0.1}" y="${h - 7}" width="${w * 0.8}" height="7" fill="${k}"/>`;
      break;
    case 'robot':
      s = `<rect x="${w * 0.28}" y="${h * 0.82}" width="${w * 0.44}" height="${h * 0.18}" fill="${k}"/><g class="ram"><path d="M${w * 0.5} ${h * 0.82}V${h * 0.45}L${w * 0.82} ${h * 0.24}" stroke="${c}" stroke-width="${Math.max(4, w * 0.09)}" fill="none" stroke-linecap="round"/><circle cx="${w * 0.5}" cy="${h * 0.45}" r="${Math.max(3, w * 0.07)}" fill="${k}"/><path d="M${w * 0.82} ${h * 0.24}l${w * 0.08} -${h * 0.06}M${w * 0.82} ${h * 0.24}l${w * 0.08} ${h * 0.06}" stroke="${k}" stroke-width="2"/></g>`;
      break;
    case 'press':
      s = `<rect x="${w * 0.1}" y="1" width="${w * 0.8}" height="${h * 0.22}" fill="${c}" stroke="${k}" ${sw}/><rect x="${w * 0.1}" y="${h * 0.22}" width="${w * 0.08}" height="${h * 0.7}" fill="${k}"/><rect x="${w * 0.82}" y="${h * 0.22}" width="${w * 0.08}" height="${h * 0.7}" fill="${k}"/><g class="ramv"><rect x="${w * 0.25}" y="${h * 0.24}" width="${w * 0.5}" height="${h * 0.16}" fill="${c}" stroke="${k}"/></g><rect x="${w * 0.2}" y="${h * 0.75}" width="${w * 0.6}" height="${h * 0.17}" fill="${k}" opacity=".6"/><rect x="0" y="${h * 0.92}" width="${w}" height="${h * 0.08}" fill="${k}"/>`;
      break;
    case 'circle':
      s = `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2 - 1}" fill="${c}" stroke="${k}" ${sw}/>`;
      break;
    case 'svg': {
      // The instance's own id, so two placements of one drawing — and two
      // different drawings — cannot define the same `#a`.
      const P = parseSvg(d.svg, uid);
      s = `<svg x="0" y="0" width="${w}" height="${h}" viewBox="${esc(P.vb)}" preserveAspectRatio="${d.stretch ? 'none' : 'xMidYMid meet'}" overflow="visible">${P.inner}</svg>`;
      break;
    }
    case 'img':
      s = d.img
        ? `<image href="${d.img}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="${d.stretch ? 'none' : 'xMidYMid meet'}"/>`
        : `<rect width="${w}" height="${h}" fill="none" stroke="#94a3b8" stroke-dasharray="4 3"/><text x="${w / 2}" y="${h / 2 + 3}" text-anchor="middle" class="t-sm">Upload an image</text>`;
      break;
    case 'base': {
      const BE = EQ[d.base];
      s =
        BE && !BE.custom
          ? BE.draw(
              w,
              h,
              { level: null, sev: 0, pos: 80 },
              b || { props: Object.assign({}, BE.props || {}), tags: [], name: '' },
              uid,
            )
          : '';
      break;
    }
    default:
      s = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="4" fill="${c}" stroke="${k}" ${sw}/>`;
  }
  if (anim === 'vib') s = `<g class="vib">${s}</g>`;
  if (anim === 'press' && d.shape !== 'press') s = `<g class="ramv">${s}</g>`;
  if (anim === 'spin' && !['machine', 'pump', 'fan', 'base'].includes(d.shape))
    s += rotor(w / 2, h / 2, Math.min(w, h) * 0.18);
  if (anim === 'flow')
    s += `<path class="sandflow" d="M6 1H${w - 6}" stroke="${d.mat || '#c9a063'}" stroke-width="3" stroke-dasharray="4 4" stroke-linecap="round"/>`;
  if (anim === 'glow' && d.shape !== 'oven')
    s += `<ellipse class="glow" cx="${w / 2}" cy="${h * 0.12}" rx="${w * 0.35}" ry="${Math.max(3, h * 0.06)}" fill="#ffb020" opacity=".9"/>`;
  if (anim === 'fall') s += fallDots(w / 2, h - 2, d.mat || '#b8894e');
  if (anim === 'slide') {
    let m = '';
    for (let i = -1; i < w / 30 + 1; i++)
      m += `<rect x="${i * 30 + 4}" y="${h * 0.12}" width="20" height="${h * 0.4}" rx="2" fill="${d.mat || '#a08d70'}" stroke="${k}" stroke-width=".8"/>`;
    s += `<defs><clipPath id="cp${uid}"><rect width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#cp${uid})"><g class="slide c30">${m}</g></g>`;
  }
  return s;
}
function customDyn(d, w, h, s, b) {
  let o = '';
  const BE = d.shape === 'base' && EQ[d.base];
  if (BE && BE.dyn && !BE.custom) o += BE.dyn(w, h, s, b || { props: {}, tags: [] });
  if (d.level && s.level != null && !BE) {
    const top = d.shape === 'tank' ? h * 0.1 : h * 0.08,
      bot = d.shape === 'silo' ? h * 0.7 : d.shape === 'hopper' ? h * 0.58 : h * 0.9;
    o += levelRect(w * 0.08, top, bot, w * 0.84, s.level, d.mat || '#dcc9a1');
  }
  if (d.label) {
    const L = String(d.label).split('\n');
    o += lines(d.label, w / 2, h / 2 - (L.length - 1) * 6 + 3, 12, 't-in');
  }
  if (d.showVal && b && b.tags && b.tags[0] && REG[b.tags[0].id]) {
    const t = REG[b.tags[0].id];
    o += `<text x="${w / 2}" y="${h - 5}" text-anchor="middle" class="t-val">${esc(tagTxt(t.id))}</text>`;
  }
  return o;
}
function regCustom(d) {
  const E = {
    type: d.id,
    custom: 1,
    builtinCustom: !!d.builtin,
    cat: catIdx(d.cat || 'My equipment'),
    n: d.n || 'Custom equipment',
    pre: d.pre || 'EQ',
    w: +d.w || 80,
    h: +d.h || 60,
    resize: 'wh',
    noflip: !!(d.label || d.showVal || d.shape === 'svg' || d.shape === 'img'),
    batch: d.batch ? 1 : 0,
    notag: !(d.tags && d.tags.length),
    ports: (w, h) =>
      (d.ports || []).map(p => {
        const f = clamp(+p.pos || 0, 0, 100) / 100;
        if (d.shape === 'smlib' && Array.isArray(d.vb)) {
          // v5.4 — a copy of a SandMan drawing: sides are the drawing's own edges (the picture keeps its
          // proportions inside the box), so a point at "Right" sits at the end of the picture, not past it
          const [, , vw, vh] = d.vb,
            sc = Math.min(w / vw, h / vh),
            aw = vw * sc,
            ah = vh * sc,
            ax = (w - aw) / 2,
            ay = (h - ah) / 2;
          const q = p.side === 'l' ? [ax, ay + ah * f] : p.side === 'r' ? [ax + aw, ay + ah * f] : p.side === 't' ? [ax + aw * f, ay] : [ax + aw * f, ay + ah];
          return [p.id, p.side, q[0], q[1], p.dir, p.kind || 'any', p.req ? 1 : 0];
        }
        const xy =
          p.side === 'l'
            ? [0, h * f]
            : p.side === 'r'
              ? [w, h * f]
              : p.side === 't'
                ? [w * f, 0]
                : [w * f, h];
        return [p.id, p.side, xy[0], xy[1], p.dir, p.kind || 'any', p.req ? 1 : 0];
      }),
    tags: (d.tags || []).map(t => {
      const typ = +t.typ || 0;
      return [
        t.suf,
        t.desc || t.suf,
        t.unit || '',
        typ,
        numOrNull(t.ll),
        numOrNull(t.lo),
        numOrNull(t.hi),
        numOrNull(t.hh),
        numOrNull(t.noise) ?? Math.max(Math.abs(typ) * 0.006, 0.01),
        t.level ? 'level' : '',
        numOrNull(t.d) ?? 1,
        0,
        t.level ? [20, 90, 240] : null,
      ];
    }),
    tagSpec: Object.fromEntries(
      (d.tags || [])
        .map(t => [t.suf, { min: numOrNull(t.min), max: numOrNull(t.max), sd: numOrNull(t.sd) }])
        .filter(([k, v]) => v.min != null || v.max != null || v.sd != null),
    ),
    draw: (w, h, s, b, uid) => customDraw(d, w, h, b, uid),
    dyn: (w, h, s, b) => customDyn(d, w, h, s, b),
    def: d,
  };
  if (d.shape === 'base' && EQ[d.base] && !EQ[d.base].custom) {
    E.noflip = EQ[d.base].noflip || E.noflip;
  }
  EQ[d.id] = E;
  return E;
}
function allCustomDefs() {
  const m = {};
  GENLIB.forEach(d => (m[d.id] = d));
  CUSTLIB.forEach(d => (m[d.id] = d));
  ((DOC && DOC.custom) || []).forEach(d => {
    if (!m[d.id]) m[d.id] = d;
  });
  return Object.values(m);
}
function syncDocCustom() {
  if (!DOC) return;
  const used = new Set(DOC.blocks.map(b => b.type));
  DOC.custom = allCustomDefs().filter(d => used.has(d.id) && !d.builtin);
}
function registerDocCustom(o) {
  ((o && o.custom) || []).forEach(d => {
    if (!EQ[d.id] || EQ[d.id].custom) regCustom(d);
  });
}
/* Industry-agnostic starter library, built with the same engine users get */
const P_ = (id, side, pos, dir, req = 1, kind = 'any') => ({ id, side, pos, dir, kind, req });
const T_ = (suf, desc, unit, typ, ll, lo, hi, hh, o = {}) =>
  Object.assign({ suf, desc, unit, typ, ll, lo, hi, hh }, o);
const GENLIB = [
  {
    id: 'g_tank',
    builtin: 1,
    n: 'Process Tank',
    cat: 'General Industry',
    pre: 'TK',
    w: 60,
    h: 90,
    shape: 'tank',
    color: '#cfe3f5',
    mat: '#7db4e6',
    level: 1,
    anim: 'none',
    ports: [P_('in', 't', 50, 'in'), P_('out', 'b', 50, 'out')],
    tags: [
      T_('LVL', 'Tank level', '%', 60, 10, 20, 90, 96, { level: 1, d: 0 }),
      T_('TEMP', 'Tank temperature', '°C', 45, null, null, 60, 70),
    ],
  },
  {
    id: 'g_pump',
    builtin: 1,
    n: 'Pump',
    cat: 'General Industry',
    pre: 'PMP',
    w: 56,
    h: 46,
    shape: 'pump',
    color: '#7aa7d8',
    anim: 'none',
    ports: [P_('in', 'l', 55, 'in'), P_('out', 'r', 18, 'out')],
    tags: [
      T_('FLOW', 'Pump flow', 'm³/h', 40, 20, 28, 52, 58),
      T_('PRES', 'Discharge pressure', 'bar', 4, 2, 2.8, 5.5, 6.2, { d: 2 }),
    ],
  },
  {
    id: 'g_fan',
    builtin: 1,
    n: 'Fan / Blower',
    cat: 'General Industry',
    pre: 'FAN',
    w: 52,
    h: 52,
    shape: 'fan',
    color: '#b9c7d8',
    anim: 'none',
    ports: [P_('in', 'l', 50, 'in', 0), P_('out', 'r', 50, 'out', 0, 'air')],
    tags: [
      T_('SPD', 'Fan speed', 'rpm', 1450, 1200, 1300, 1550, 1600, { d: 0 }),
      T_('CUR', 'Motor current', 'A', 18, null, null, 24, 27),
    ],
  },
  {
    id: 'g_hx',
    builtin: 1,
    n: 'Heat Exchanger',
    cat: 'General Industry',
    pre: 'HX',
    w: 100,
    h: 40,
    shape: 'hx',
    color: '#d7dee8',
    anim: 'none',
    ports: [
      P_('in', 'l', 50, 'in'),
      P_('out', 'r', 50, 'out'),
      P_('cin', 't', 80, 'in', 0, 'water'),
      P_('cout', 'b', 20, 'out', 0, 'water'),
    ],
    tags: [
      T_('TIN', 'Inlet temperature', '°C', 85, null, null, 95, 100),
      T_('TOUT', 'Outlet temperature', '°C', 40, null, 30, 50, 55),
    ],
  },
  {
    id: 'g_oven',
    builtin: 1,
    n: 'Oven / Curing Furnace',
    cat: 'General Industry',
    pre: 'OV',
    w: 110,
    h: 70,
    shape: 'oven',
    color: '#b0b8c4',
    anim: 'none',
    ports: [P_('in', 'l', 60, 'in'), P_('out', 'r', 60, 'out')],
    tags: [
      T_('TEMP', 'Zone temperature', '°C', 220, 190, 200, 240, 250, { d: 0 }),
      T_('TIME', 'Dwell time', 'min', 18, 12, 14, 22, 25),
    ],
  },
  {
    id: 'g_robot',
    builtin: 1,
    n: 'Robot Cell',
    cat: 'General Industry',
    pre: 'RB',
    w: 62,
    h: 62,
    shape: 'robot',
    color: '#f59e0b',
    anim: 'none',
    ports: [P_('in', 'l', 85, 'in', 0), P_('out', 'r', 85, 'out', 0)],
    tags: [
      T_('CYC', 'Robot cycle time', 's', 24, null, null, 28, 32),
      T_('OEE', 'Cell OEE', '%', 82, 60, 70, null, null, { d: 0 }),
    ],
  },
  {
    id: 'g_press',
    builtin: 1,
    n: 'Press',
    cat: 'General Industry',
    pre: 'PR',
    w: 70,
    h: 80,
    shape: 'press',
    color: '#7b8fa8',
    anim: 'none',
    ports: [P_('in', 'l', 85, 'in'), P_('out', 'r', 85, 'out')],
    tags: [
      T_('FORCE', 'Press force', 'kN', 850, null, 700, 950, 1000, { d: 0 }),
      T_('SPM', 'Strokes per minute', 'spm', 18, 10, 14, 22, 24, { d: 0 }),
    ],
  },
  {
    id: 'g_mach',
    builtin: 1,
    n: 'Machine Tool / Workstation',
    cat: 'General Industry',
    pre: 'MC',
    w: 92,
    h: 62,
    shape: 'machine',
    color: '#a8c0d8',
    anim: 'none',
    ports: [P_('in', 'l', 60, 'in'), P_('out', 'r', 60, 'out')],
    tags: [
      T_('CYC', 'Cycle time', 's', 45, null, null, 52, 60),
      T_('SPD', 'Spindle speed', 'rpm', 3200, 2500, 2800, 3600, 3800, { d: 0 }),
      T_('OEE', 'OEE', '%', 78, 55, 65, null, null, { d: 0 }),
    ],
  },
  {
    id: 'g_conv',
    builtin: 1,
    n: 'Parts Conveyor',
    cat: 'General Industry',
    pre: 'CV',
    w: 200,
    h: 28,
    shape: 'conveyor',
    color: '#3a4656',
    mat: '#7b8794',
    anim: 'slide',
    ports: [P_('in', 'l', 50, 'in', 0), P_('out', 'r', 50, 'out', 0)],
    tags: [T_('SPD', 'Conveyor speed', 'm/min', 12, 8, 10, 14, 16)],
  },
  {
    id: 'g_cab',
    builtin: 1,
    n: 'Control Cabinet',
    cat: 'General Industry',
    pre: 'CC',
    w: 50,
    h: 72,
    shape: 'box',
    color: '#d7dee8',
    label: 'PLC',
    anim: 'none',
    ports: [],
    tags: [T_('TEMP', 'Cabinet temperature', '°C', 32, null, null, 40, 45)],
  },
];
GENLIB.forEach(regCustom);
CUSTLIB.forEach(regCustom);

/* ---------- Equipment designer ---------- */
let DZ = null,
  DZnew = false;
function dzDefault() {
  return {
    id: 'c_' + Date.now().toString(36),
    n: 'New equipment',
    cat: 'My equipment',
    pre: 'EQ',
    w: 90,
    h: 60,
    shape: 'machine',
    color: '#a8c0d8',
    mat: '#c9a063',
    anim: 'none',
    label: '',
    showVal: false,
    level: false,
    batch: false,
    ports: [P_('in', 'l', 50, 'in'), P_('out', 'r', 50, 'out')],
    tags: [T_('PV', 'Process value', '', 50, null, null, null, null)],
  };
}
function dzFromBuiltin(type) {
  const E = EQ[type];
  if (!E) return dzDefault();
  const fb = fakeBlock(type);
  const w = E.w,
    h = E.autoH ? E.autoH(fb) : E.h;
  const raw = typeof E.ports === 'function' ? E.ports(w, h) : E.ports;
  if (E.custom) {
    const d = JSON.parse(JSON.stringify(E.def));
    if (d.shape === 'smlib') {
      d.src = d.src || E.def.id || type; // v5.2 — keep the link to the original SandMan drawing (else the picture is blank)
      (d.ports || []).forEach(p => {
        delete p.vx; // the copy's points are edited by side / position in the designer
        delete p.vy;
      });
    }
    d.id = 'c_' + Date.now().toString(36);
    d.n = d.n + ' (custom)';
    d.builtin = 0;
    d.cat = d.cat === 'General Industry' ? 'My equipment' : d.cat;
    return d;
  }
  return {
    id: 'c_' + Date.now().toString(36),
    n: E.n + ' (custom)',
    cat: 'My equipment',
    pre: E.pre,
    w,
    h,
    shape: 'base',
    base: type,
    color: '#a8c0d8',
    mat: '#c9a063',
    anim: 'none',
    label: '',
    showVal: false,
    level: false,
    batch: !!E.batch,
    ports: raw.map(p => ({
      id: p[0],
      side: p[1],
      pos: Math.round((p[1] === 'l' || p[1] === 'r' ? p[3] / h : p[2] / w) * 100),
      dir: p[4],
      kind: p[5],
      req: p[6] ? 1 : 0,
    })),
    tags: E.tags.map(t => ({
      suf: t[0],
      desc: t[1],
      unit: t[2],
      typ: t[3],
      ll: t[4],
      lo: t[5],
      hi: t[6],
      hh: t[7],
      d: t[10],
      level: t[9] === 'level' ? 1 : 0,
    })),
  };
}
function openDesigner(type) {
  const E = type && EQ[type];
  if (E && E.custom && !E.builtinCustom) {
    DZ = JSON.parse(JSON.stringify(E.def));
    DZnew = false;
  } else if (type) {
    DZ = dzFromBuiltin(type);
    DZnew = true;
  } else {
    DZ = dzDefault();
    DZnew = true;
  }
  dzRender();
}
function dzPreview() {
  const d = DZ,
    w = +d.w || 80,
    h = +d.h || 60,
    pad = 24,
    fb = { id: 'dzp', type: d.id, name: d.pre + '-1', props: {}, tags: [] };
  let inner = '';
  try {
    inner = customDraw(d, w, h, fb, 'dz') + customDyn(d, w, h, { level: 0.6, sev: 0, pos: 80 }, fb);
  } catch (e) {
    inner = '';
  }
  const pts = (d.ports || [])
    .map(p => {
      const f = clamp(+p.pos || 0, 0, 100) / 100,
        xy =
          p.side === 'l'
            ? [0, h * f]
            : p.side === 'r'
              ? [w, h * f]
              : p.side === 't'
                ? [w * f, 0]
                : [w * f, h],
        o = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] }[p.side] || [0, 0];
      return `<circle cx="${xy[0]}" cy="${xy[1]}" r="4.5" fill="${KIND[p.kind]?.c || '#94a3b8'}" stroke="${p.req ? '#d93636' : '#fff'}" stroke-width="${p.req ? 2 : 1.5}"/><text x="${xy[0] + o[0] * 8}" y="${xy[1] + o[1] * 10 + 3}" text-anchor="${o[0] < 0 ? 'end' : o[0] > 0 ? 'start' : 'middle'}" style="font:600 9px var(--mono);fill:var(--muted)">${esc(p.id)}</text>`;
    })
    .join('');
  $('#dzPrev').innerHTML =
    `<svg viewBox="${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}" class="live" style="width:100%;height:100%"><g class="blk run ph-MIXING">${inner}</g>${pts}</svg>`;
  $('#dzSize').textContent = `${w} × ${h}`;
}
function dzRender() {
  const d = DZ,
    catList = [...new Set([...CATS.filter(c => c !== 'HMI Widgets'), 'My equipment'])];
  const sel = (id, obj, v) =>
    `<select data-f="${id}">${Object.entries(obj)
      .map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`)
      .join('')}</select>`;
  const builtins = Object.values(EQ)
    .filter(e => !e.widget && !e.custom)
    .sort((a, b) => a.n.localeCompare(b.n));
  openModal(
    `<div style="display:flex;align-items:center;gap:10px"><h3 style="margin:0">${DZnew ? 'New equipment' : 'Edit equipment'}</h3><span class="note">Build any machine for any industry — shape, connection points, live tags and animation.</span></div>
 <div class="dz">
  <div class="dz-l">
   <div class="fld"><label>Start from</label><select id="dzFrom"><option value="">Keep current design</option><option value="__blank">Blank equipment</option>${builtins.map(e => `<option value="${e.type}">${esc(e.n)} (${esc(CATS[e.cat])})</option>`).join('')}${GENLIB.map(g => `<option value="${g.id}">${esc(g.n)} (General Industry)</option>`).join('')}</select></div>
   <div class="row2"><div class="fld"><label>Name *</label><input data-f="n" value="${esc(d.n)}"></div><div class="fld"><label>Tag prefix (auto-naming)</label><input data-f="pre" value="${esc(d.pre)}" class="mono" maxlength="8"></div></div>
   <div class="row2"><div class="fld"><label>Library category</label><input data-f="cat" value="${esc(d.cat)}" list="dzCats"><datalist id="dzCats">${catList.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div><div class="fld"><label>Default size (W × H)</label><div class="row2"><input data-f="w" type="number" min="10" value="${d.w}"><input data-f="h" type="number" min="10" value="${d.h}"></div></div></div>
   <div class="row2"><div class="fld"><label>Shape</label>${sel('shape', SHAPES, d.shape)}</div><div class="fld"><label>Animation when running</label>${sel('anim', ANIMS, d.anim)}</div></div>
   ${d.shape === 'base' ? `<div class="fld"><label>Built-in drawing</label><select data-f="base">${builtins.map(e => `<option value="${e.type}" ${e.type === d.base ? 'selected' : ''}>${esc(e.n)}</option>`).join('')}</select></div>` : ''}
   ${d.shape === 'svg' ? `<div class="fld"><label>Paste SVG markup (from Inkscape, Illustrator, Figma…)</label><textarea data-f="svg" rows="4" class="mono" placeholder="<svg viewBox=&quot;0 0 100 60&quot;>…</svg>">${esc(d.svg || '')}</textarea><label class="chk"><input type="checkbox" data-f="stretch" ${d.stretch ? 'checked' : ''}> Stretch to fill</label></div>` : ''}
   ${d.shape === 'img' ? `<div class="fld"><label>Image (PNG, JPG or SVG, up to 400 KB)</label><input type="file" id="dzImg" accept="image/*"><label class="chk"><input type="checkbox" data-f="stretch" ${d.stretch ? 'checked' : ''}> Stretch to fill</label></div>` : ''}
   <div class="row2">${!['svg', 'img', 'base', 'conveyor'].includes(d.shape) ? `<div class="fld"><label>Body colour</label><input type="color" data-f="color" value="${d.color || '#a8c0d8'}"></div>` : '<div></div>'}<div class="fld"><label>Material colour (level, flow)</label><input type="color" data-f="mat" value="${d.mat || '#c9a063'}"></div></div>
   <div class="fld"><label>Text inside (↵ for new line)</label><textarea data-f="label" rows="2">${esc(d.label || '')}</textarea></div>
   <label class="chk"><input type="checkbox" data-f="showVal" ${d.showVal ? 'checked' : ''}> Show first tag's live value inside</label>
   <label class="chk"><input type="checkbox" data-f="level" ${d.level ? 'checked' : ''}> Fill level from the tag marked “Level”</label>
   <label class="chk"><input type="checkbox" data-f="batch" ${d.batch ? 'checked' : ''}> Batch machine (shows LOADING / MIXING / DISCHARGING)</label>
  </div>
  <div class="dz-r"><div class="dz-prev" id="dzPrev"></div><div class="note" style="text-align:center">Preview with animation · <span id="dzSize"></span> · red ring = required port</div></div>
 </div>
 <h4 class="dz-h">Connection points <button class="sb" id="dzAddP">＋ Add port</button></h4>
 <div class="tbl-wrap"><table class="dz-t"><thead><tr><th>ID</th><th>Side</th><th>Position %</th><th>Flow</th><th>Material</th><th>Required</th><th></th></tr></thead><tbody>${
   (d.ports || [])
     .map(
       (p, i) => `<tr>
  <td><input data-p="${i}:id" value="${esc(p.id)}" class="mono" style="width:80px"></td>
  <td><select data-p="${i}:side">${[
    ['l', 'Left'],
    ['r', 'Right'],
    ['t', 'Top'],
    ['b', 'Bottom'],
  ]
    .map(([k, l]) => `<option value="${k}" ${p.side === k ? 'selected' : ''}>${l}</option>`)
    .join('')}</select></td>
  <td><input data-p="${i}:pos" type="number" min="0" max="100" value="${p.pos}" style="width:64px"></td>
  <td><select data-p="${i}:dir">${[
    ['in', 'Inlet'],
    ['out', 'Outlet'],
    ['io', 'In / out'],
  ]
    .map(([k, l]) => `<option value="${k}" ${p.dir === k ? 'selected' : ''}>${l}</option>`)
    .join('')}</select></td>
  <td><select data-p="${i}:kind">${Object.keys(KIND)
    .map(k => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${KIND[k].n}</option>`)
    .join('')}</select></td>
  <td style="text-align:center"><input type="checkbox" data-p="${i}:req" ${p.req ? 'checked' : ''}></td><td><button class="lb" data-rp="${i}" style="color:var(--crit)">Remove</button></td></tr>`,
     )
     .join('') ||
   '<tr><td colspan="7" class="note">No connection points — fine for instruments or stand-alone machines.</td></tr>'
 }</tbody></table></div>
 <h4 class="dz-h">Default tags <span class="note" style="font-weight:400">created automatically each time this equipment is placed</span><button class="sb" id="dzAddT">＋ Add tag</button></h4>
 <div class="tbl-wrap"><table class="dz-t"><thead><tr><th>Suffix</th><th>Description</th><th>Unit</th><th>Optimal</th><th>Min</th><th>Max</th><th>σ</th><th>LL</th><th>L</th><th>H</th><th>HH</th><th>Dec.</th><th>Level</th><th></th></tr></thead><tbody>${
   (d.tags || [])
     .map(
       (t, i) => `<tr>
  <td><input data-t="${i}:suf" value="${esc(t.suf)}" class="mono" style="width:64px"></td><td><input data-t="${i}:desc" value="${esc(t.desc)}" style="width:160px"></td><td><input data-t="${i}:unit" value="${esc(t.unit)}" style="width:56px"></td>
  ${['typ', 'min', 'max', 'sd', 'll', 'lo', 'hi', 'hh'].map(k => `<td><input data-t="${i}:${k}" type="number" step="any" value="${t[k] ?? ''}" style="width:62px"></td>`).join('')}
  <td><input data-t="${i}:d" type="number" min="0" max="4" value="${t.d ?? 1}" style="width:44px"></td><td style="text-align:center"><input type="radio" name="dzlvl" data-t="${i}:level" ${t.level ? 'checked' : ''}></td><td><button class="lb" data-rt="${i}" style="color:var(--crit)">Remove</button></td></tr>`,
     )
     .join('') ||
   '<tr><td colspan="14" class="note">No tags yet. Add the measurements this equipment reports.</td></tr>'
 }</tbody></table></div>
 <div class="note" style="margin-top:6px">Tags appear as <span class="mono">${esc(d.pre || 'EQ')}-1.SUFFIX</span>. Limits drive Advisory / Warning / Critical alerts and the control chart.</div>
 <div class="mact">${!DZnew && CUSTLIB.some(x => x.id === d.id) ? '<button class="ib" id="dzDel" style="color:var(--crit);margin-right:auto">Delete from library</button>' : ''}<button class="ib" id="dzCancel">Cancel</button><button class="ib" id="dzSave">Save to library</button><button class="ib pri" id="dzPlace">Save &amp; place</button></div>`,
    'xl',
  );
  const M = $('#mbox');
  M.querySelectorAll('[data-f]').forEach(el => {
    const ev = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'color' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const f = el.dataset.f;
      d[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
      if (f === 'shape') {
        if (f === 'shape' && d.shape === 'base' && !d.base) d.base = 'disaMini';
        dzRender();
        return;
      }
      if (f === 'base') {
        dzRender();
        return;
      }
      dzPreview();
    });
    if (el.type === 'color')
      el.addEventListener('input', () => {
        d[el.dataset.f] = el.value;
        dzPreview();
      });
  });
  M.querySelectorAll('[data-p]').forEach(el =>
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
      const [i, k] = el.dataset.p.split(':');
      d.ports[+i][k] =
        el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.type === 'number' ? +el.value : el.value;
      dzPreview();
    }),
  );
  M.querySelectorAll('[data-t]').forEach(el =>
    el.addEventListener(el.type === 'radio' ? 'change' : 'input', () => {
      const [i, k] = el.dataset.t.split(':');
      if (k === 'level') {
        d.tags.forEach((t, j) => (t.level = j === +i ? 1 : 0));
        d.level = true;
        M.querySelector('[data-f="level"]').checked = true;
      } else d.tags[+i][k] = el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value;
      dzPreview();
    }),
  );
  M.querySelectorAll('[data-rp]').forEach(
    b =>
      (b.onclick = () => {
        d.ports.splice(+b.dataset.rp, 1);
        dzRender();
      }),
  );
  M.querySelectorAll('[data-rt]').forEach(
    b =>
      (b.onclick = () => {
        d.tags.splice(+b.dataset.rt, 1);
        dzRender();
      }),
  );
  $('#dzAddP').onclick = () => {
    let n = d.ports.length + 1;
    while (d.ports.some(p => p.id === 'p' + n)) n++;
    d.ports.push(P_('p' + n, 'r', 50, 'out', 0));
    dzRender();
  };
  $('#dzAddT').onclick = () => {
    let n = d.tags.length + 1;
    while (d.tags.some(t => t.suf === 'T' + n)) n++;
    d.tags.push(T_('T' + n, 'New measurement', '', 0, null, null, null, null));
    dzRender();
  };
  $('#dzFrom').onchange = e => {
    const v = e.target.value;
    if (!v) return;
    const keepId = d.id;
    DZ = v === '__blank' ? dzDefault() : dzFromBuiltin(v);
    if (!DZnew) DZ.id = keepId;
    dzRender();
  };
  const fi = $('#dzImg');
  if (fi)
    fi.onchange = () => {
      const f = fi.files[0];
      if (!f) return;
      if (f.size > 400 * 1024) {
        toast('Image is larger than 400 KB — please compress it');
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        d.img = r.result;
        dzPreview();
      };
      r.readAsDataURL(f);
    };
  $('#dzCancel').onclick = closeModal;
  $('#dzSave').onclick = () => dzSave(false);
  $('#dzPlace').onclick = () => dzSave(true);
  const del = $('#dzDel');
  if (del)
    del.onclick = () => {
      const used = DOC.blocks.filter(b => b.type === d.id).length;
      CUSTLIB = CUSTLIB.filter(x => x.id !== d.id);
      saveCustLib();
      if (!used) {
        delete EQ[d.id];
      }
      closeModal();
      renderLib();
      toast(
        used
          ? `Removed from library — ${used} item(s) in this flowsheet keep working`
          : 'Removed from library',
      );
    };
  dzPreview();
}
function dzSave(place) {
  const d = DZ;
  d.n = String(d.n || '').trim();
  if (!d.n) {
    toast('Give the equipment a name');
    return;
  }
  d.pre =
    String(d.pre || 'EQ')
      .trim()
      .replace(/[^A-Za-z0-9_]/g, '') || 'EQ';
  d.cat = String(d.cat || 'My equipment').trim() || 'My equipment';
  d.w = Math.max(10, +d.w || 80);
  d.h = Math.max(10, +d.h || 60);
  const pid = new Set(),
    tid = new Set();
  for (const p of d.ports) {
    p.id = String(p.id || '').trim();
    if (!p.id || pid.has(p.id)) {
      toast(`Port IDs must be unique and not empty (“${p.id || 'blank'}”)`);
      return;
    }
    pid.add(p.id);
  }
  for (const t of d.tags) {
    t.suf = String(t.suf || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '');
    if (!t.suf || tid.has(t.suf)) {
      toast('Tag suffixes must be unique and not empty');
      return;
    }
    tid.add(t.suf);
    if (t.typ == null || !isFinite(+t.typ)) {
      toast(`Enter a typical value for tag ${t.suf}`);
      return;
    }
  }
  if (d.level && !d.tags.some(t => t.level)) {
    toast('Mark one tag as “Level” or untick level fill');
    return;
  }
  d.builtin = 0;
  const i = CUSTLIB.findIndex(x => x.id === d.id);
  if (i >= 0) CUSTLIB[i] = JSON.parse(JSON.stringify(d));
  else CUSTLIB.push(JSON.parse(JSON.stringify(d)));
  saveCustLib();
  regCustom(CUSTLIB.find(x => x.id === d.id));
  // update items already on the flowsheet: add new tags, drop lines on removed ports
  let added = 0,
    dropped = 0;
  DOC.blocks
    .filter(b => b.type === d.id)
    .forEach(b => {
      d.tags.forEach(t => {
        const id = `${b.name}.${t.suf}`;
        if (!b.tags.some(x => x.id === id)) {
          const E = EQ[d.id],
            td = E.tags.find(x => x[0] === t.suf);
          mkTag(id, {
            desc: td[1],
            unit: td[2],
            typ: td[3],
            ll: td[4],
            lo: td[5],
            hi: td[6],
            hh: td[7],
            noise: td[8],
            role: td[9],
            d: td[10],
            cyc: td[12],
            addr: `ns=2;s=${id}`,
          });
          b.tags.push({ id, show: false });
          added++;
        }
      });
    });
  const before = DOC.streams.length;
  DOC.streams = DOC.streams.filter(s => {
    const fb = B(s.from.b),
      tb = B(s.to.b);
    return !(fb && fb.type === d.id && !pid.has(s.from.p)) && !(tb && tb.type === d.id && !pid.has(s.to.p));
  });
  dropped = before - DOC.streams.length;
  seedHist();
  closeModal();
  renderLib();
  logEv(`Equipment “${d.n}” saved to library`);
  changed();
  toast(
    `“${d.n}” saved${added ? ` · ${added} tag(s) added to placed items` : ''}${dropped ? ` · ${dropped} line(s) removed from deleted ports` : ''}`,
  );
  if (place) {
    if (MODE !== 'design') setMode('design');
    setPlace(d.id);
  }
}
function libIOForm() {
  openModal(
    `<h3>Equipment library — import / export</h3><div class="note">Share custom equipment between plants and machines. Export copies every custom item; paste an export below to import (items with the same ID are updated).</div>
 <textarea id="libT" style="margin-top:8px">${esc(JSON.stringify({ format: 'sandman-equipment', version: 1, items: CUSTLIB }))}</textarea>
 <div class="mact"><button class="ib" id="lClose">Close</button><button class="ib" id="lCopy">Copy export</button><button class="ib pri" id="lImp">Import pasted items</button></div>`,
    true,
  );
  $('#lClose').onclick = closeModal;
  $('#lCopy').onclick = () => copyText($('#libT').value, 'Library JSON copied');
  $('#lImp').onclick = () => {
    try {
      const o = JSON.parse($('#libT').value);
      const items = Array.isArray(o) ? o : o.items;
      if (!Array.isArray(items)) throw 0;
      let n = 0;
      items.forEach(d => {
        if (!d.id || !d.n) return;
        d.builtin = 0;
        const i = CUSTLIB.findIndex(x => x.id === d.id);
        if (i >= 0) CUSTLIB[i] = d;
        else CUSTLIB.push(d);
        regCustom(d);
        n++;
      });
      saveCustLib();
      closeModal();
      renderLib();
      toast(`Imported ${n} equipment item(s)`);
    } catch (e) {
      toast('That text is not a SandMan equipment export');
    }
  };
}
async function copyText(t, msg) {
  try {
    await navigator.clipboard.writeText(t);
    toast(msg || 'Copied');
  } catch (e) {
    const ta = $('#mbox textarea');
    if (ta) {
      ta.select();
      toast('Text selected — press Ctrl+C');
    } else toast('Copy is blocked here');
  }
}

/* ---------- Library panel (with modules and edit buttons) ---------- */
let MODS = [];
try {
  MODS = JSON.parse(localStorage.getItem('sandman-modules') || '[]');
} catch (e) {}
function saveMods() {
  try {
    localStorage.setItem('sandman-modules', JSON.stringify(MODS));
  } catch (e) {
    toast('Browser storage is full — delete unused modules or templates');
  }
}
const modIcon = `<svg viewBox="0 0 66 42"><rect x="4" y="6" width="18" height="14" rx="2" fill="#a8c0d8" stroke="#475569"/><rect x="40" y="6" width="22" height="14" rx="2" fill="#7cc576" stroke="#2f7d32"/><rect x="20" y="26" width="26" height="12" rx="2" fill="#f2c27b" stroke="#9a5b13"/><path d="M22 13H40M33 20V26" stroke="#2f8f46" stroke-width="2"/></svg>`;
/* v1.7 — Loop Studio–style library: category icon rail, header with count, tiles / list view */
let LIBCAT = 'all',
  LIBVIEW = 'tiles';
try {
  LIBVIEW = localStorage.getItem('sandman-libview') === 'list' ? 'list' : 'tiles'; // v3.1 — tiles by default (Side panel A); the user's choice is kept
} catch (e) {}
const CAT_IC = {
  all: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  'Storage & Dosing': '<path d="M5 4h14v8l-4 6h-6l-4-6z"/><path d="M10 18v3h4v-3"/>',
  'Sand Preparation': '<rect x="4" y="8" width="16" height="10" rx="2"/><path d="M8 8V5h8v3M12 11v4M10 13h4"/>',
  Conveying: '<rect x="2" y="9" width="20" height="6" rx="3"/><circle cx="6" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  Molding: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3 12h18M9 6v12"/>',
  'Melting & Pouring': '<path d="M6 8h12l-1.5 11h-9z"/><path d="M9 4c0 1.5 1.5 1.5 1.5 3M13 4c0 1.5 1.5 1.5 1.5 3"/>',
  'Cooling & Shakeout': '<path d="M12 3v18M4 7.5l16 9M20 7.5l-16 9"/>',
  Finishing: '<circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/>',
  Instruments: '<circle cx="12" cy="12" r="8"/><path d="M12 12l4-3"/>',
  'HMI Widgets': '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  'General Industry': '<path d="M3 21V10l6 4V10l6 4V6l6 4v11z"/>',
  mods: '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/><path d="M7 11v4h6"/>',
  other: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
};
/* v3.1 — Side panel A: every category has its own colour (same colour language as the ribbon) */
const CAT_COL = {
  all: '#475569',
  mods: '#6b4fd6',
  'Storage & Dosing': '#1f6feb',
  'Sand Preparation': '#c27803',
  Conveying: '#0e7c86',
  Molding: '#6b4fd6',
  'Melting & Pouring': '#d9480f',
  'Cooling & Shakeout': '#0891b2',
  Finishing: '#64748b',
  Instruments: '#2f8f46',
  'HMI Widgets': '#1f6feb',
  'General Industry': '#475569',
  Machines: '#2f8f46',
  'Engineering elements': '#0e7c86',
  'Valves & fittings': '#c27803',
  'Control & IT': '#475569',
  'Instruments & P&ID': '#6b4fd6',
  'ISA-5.1 symbols': '#334155',
  'v3 standard set': '#1f6feb',
  'My equipment': '#d9480f',
};
const catCol = k => CAT_COL[k] || '#475569';
const catIc = (k, sz = 16) =>
  `<svg class="cic" viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="--cc:${catCol(k)}">${CAT_IC[k] || CAT_IC.other}</svg>`;
const CAT_SHORT = { 'Storage & Dosing': 'Storage', 'Sand Preparation': 'Sand', Conveying: 'Convey', Molding: 'Mold', 'Melting & Pouring': 'Melt', 'Cooling & Shakeout': 'Cool', Finishing: 'Finish', Instruments: 'Instr.', 'HMI Widgets': 'HMI', 'General Industry': 'General', 'My equipment': 'Mine' };
function renderLibRail(q, nMods) {
  const rail = $('#libRail');
  if (!rail) return;
  const count = i => Object.values(EQ).filter(e => e.cat === i && (!q || e.n.toLowerCase().includes(q) || CATS[i].toLowerCase().includes(q))).length;
  const ic = k => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CAT_IC[k] || CAT_IC.other}</svg>`;
  const btn = (k, label, title, n) =>
    `<button type="button" data-lc="${k}" class="${String(LIBCAT) === String(k) ? 'on' : ''}" style="--cc:${catCol(typeof k === 'number' ? CATS[k] : k)}" title="${esc(title)}${n != null ? ' · ' + n : ''}">${ic(typeof k === 'number' ? CATS[k] : k)}<span>${esc(label)}</span></button>`;
  let total = 0;
  const cats = CATS.map((c, i) => [i, count(i)]).filter(([, n]) => n);
  cats.forEach(([, n]) => (total += n));
  rail.innerHTML =
    btn('all', 'All', 'All equipment', total + nMods) +
    (nMods ? btn('mods', 'Modules', 'My modules', nMods) : '') +
    cats.map(([i, n]) => btn(i, CAT_SHORT[CATS[i]] || CATS[i].split(' ')[0], CATS[i], n)).join('');
  const shown = LIBCAT === 'all' ? total + nMods : LIBCAT === 'mods' ? nMods : count(LIBCAT);
  $('#libCount').textContent = shown;
  const head = $('#libCatHead');
  head.innerHTML =
    LIBCAT === 'all' ? '' : `${catIc(LIBCAT === 'mods' ? 'mods' : CATS[LIBCAT], 15)}<b>${esc(LIBCAT === 'mods' ? 'My modules' : CATS[LIBCAT])}</b><span>${shown} item${shown === 1 ? '' : 's'}</span>`;
  const all = Object.values(EQ).filter(e => e.cat >= 0).length; // hidden helper types (cat -1) are not library items
  const qi = $('#libQ');
  if (qi) qi.placeholder = `Search ${all} items`;
  const lf = $('#libFootN');
  if (lf) lf.textContent = `${all} SVG items · animated`;
  const main = $('#libMain');
  main.classList.toggle('one', LIBCAT !== 'all' && !$('#libQ').value.trim());
  main.classList.toggle('list', LIBVIEW === 'list');
  $$('.lview [data-lv]').forEach(b => b.classList.toggle('on', b.dataset.lv === LIBVIEW));
  rail.querySelectorAll('[data-lc]').forEach(
    b =>
      (b.onclick = () => {
        const k = b.dataset.lc;
        LIBCAT = k === 'all' || k === 'mods' ? k : +k;
        renderLib();
        $('#libMain').scrollTop = 0;
      }),
  );
}
$$('.lview [data-lv]').forEach(
  b =>
    (b.onclick = () => {
      LIBVIEW = b.dataset.lv;
      try {
        localStorage.setItem('sandman-libview', LIBVIEW);
      } catch (e) {}
      renderLib();
    }),
);
/* "/" focuses the library search */
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const q = $('#libQ');
  if (!q || !q.offsetParent) return;
  e.preventDefault();
  q.focus();
  q.select();
});
function renderLib() {
  const q = $('#libQ').value.trim().toLowerCase();
  const mods = MODS.filter(m => !q || m.name.toLowerCase().includes(q));
  const modHtml = mods.length && (LIBCAT === 'all' || LIBCAT === 'mods' || q)
    ? `<div class="cat"><button aria-expanded="true"><svg class="chev" viewBox="0 0 10 10"><path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>My modules<i>${mods.length}</i></button><div class="items">${mods.map(m => `<div class="pal" draggable="true" data-t="mod:${m.id}" tabindex="0" role="button" title="${esc(m.name)} — ${m.clip.blocks.length} items">${modIcon}<span>${esc(m.name)}</span><button class="pedit" data-delmod="${m.id}" title="Delete module">×</button></div>`).join('')}</div></div>`
    : '';
  $('#lib').innerHTML =
    modHtml +
      CATS.map((c, i) => {
        if (LIBCAT !== 'all' && LIBCAT !== i && !q) return ''; // v1.7: category picked in the rail · v6.2: a search always covers the whole library
        const items = Object.values(EQ).filter(
          e => e.cat === i && (!q || e.n.toLowerCase().includes(q) || c.toLowerCase().includes(q)),
        );
        if (!items.length) return '';
        return `<div class="cat"><button aria-expanded="true"><svg class="chev" viewBox="0 0 10 10"><path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>${catIc(c, 15)}${esc(c)}<i>${items.length}</i></button><div class="items">${items.map(e => `<div class="pal" draggable="true" data-t="${e.type}" tabindex="0" role="button" aria-label="${esc(e.n)}">${palIcon(e.type)}<span>${esc(e.n)}<small class="psub">${esc(c)}${e.custom && !e.builtinCustom ? ' · custom' : ''}</small></span>${e.widget ? '' : `<button class="pedit" data-edit="${e.type}" title="${e.custom && !e.builtinCustom ? 'Edit equipment' : 'Make a custom copy'}">✎</button>`}</div>`).join('')}</div></div>`;
      }).join('') ||
    '<div class="note" style="padding:12px">No match. Try “tank”, “DISA”, “pump” — or create it with ＋ New equipment.</div>';
  renderLibRail(q, mods.length);
  $$('#lib .cat>button').forEach(
    b =>
      (b.onclick = () => {
        const c = b.parentElement;
        c.classList.toggle('closed');
        b.setAttribute('aria-expanded', !c.classList.contains('closed'));
      }),
  );
  $$('#lib .pedit[data-edit]').forEach(b => {
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.onclick = e => {
      e.stopPropagation();
      openDesigner(b.dataset.edit);
    };
  });
  $$('#lib .pedit[data-delmod]').forEach(b => {
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.onclick = e => {
      e.stopPropagation();
      const m = MODS.find(x => x.id === b.dataset.delmod);
      MODS = MODS.filter(x => x !== m);
      saveMods();
      renderLib();
      toast(`Module “${m.name}” deleted`);
    };
  });
  $$('#lib .pal').forEach(p => {
    p.addEventListener('dragstart', e => {
      if (MODE !== 'design') {
        e.preventDefault();
        toast('Switch to Design mode to add equipment');
        return;
      }
      e.dataTransfer.setData('text/plain', p.dataset.t);
      e.dataTransfer.effectAllowed = 'copy';
    });
    const pick = () => {
      if (MODE !== 'design') {
        setMode('design');
      }
      setPlace(PLACE === p.dataset.t ? null : p.dataset.t);
      closeDrawers();
    };
    p.addEventListener('click', pick);
    p.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
  });
}
function placeName(t) {
  if (!t) return '';
  if (t.startsWith('mod:')) {
    const m = MODS.find(x => 'mod:' + x.id === t);
    return m ? `module “${m.name}”` : 'module';
  }
  return EQ[t]?.n || t;
}

/* ---------- Multi-select, copy / paste, modules ---------- */
let SELM = new Set(),
  CLIP = null;
function selIds() {
  return SELM.size ? [...SELM] : SEL && SEL.t === 'b' ? [SEL.id] : [];
}
function makeClip(ids) {
  const set = new Set(ids),
    blocks = DOC.blocks.filter(b => set.has(b.id)).map(b => JSON.parse(JSON.stringify(b)));
  if (!blocks.length) return null;
  const tags = {};
  const addT = id => {
    if (id && REG[id]) tags[id] = JSON.parse(JSON.stringify(REG[id]));
  };
  blocks.forEach(b => {
    b.tags.forEach(t => addT(t.id));
    (b.rules || []).forEach(r => addT(r.tag));
  });
  const streams = DOC.streams
    .filter(s => set.has(s.from.b) && set.has(s.to.b))
    .map(s => JSON.parse(JSON.stringify(s)));
  streams.forEach(s => addT(s.tag));
  let x0 = 1e9,
    y0 = 1e9;
  blocks.forEach(b => {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
  });
  return {
    v: 1,
    blocks,
    streams,
    tags,
    custom: allCustomDefs().filter(d => !d.builtin && blocks.some(b => b.type === d.id)),
    origin: { x: x0, y: y0 },
  };
}
function uniqueName(name, taken) {
  const m = /^(.*?)(\d+)$/.exec(name);
  let cand;
  if (m) {
    let n = +m[2];
    do {
      n++;
      cand = m[1] + n;
    } while (taken.has(cand));
  } else {
    let n = 2;
    do {
      cand = `${name}-${n++}`;
    } while (taken.has(cand));
  }
  taken.add(cand);
  return cand;
}
function pasteClip(c, ox, oy, label) {
  if (!c || !c.blocks) return;
  (c.custom || []).forEach(d => {
    if (!EQ[d.id]) {
      regCustom(d);
      if (!CUSTLIB.some(x => x.id === d.id)) {
        CUSTLIB.push(d);
        saveCustLib();
      }
    }
  });
  const miss = c.blocks.filter(b => !EQ[b.type]);
  if (miss.length) {
    toast(`Unknown equipment type: ${miss[0].type}`);
    return;
  }
  pushUndo();
  const taken = new Set(DOC.blocks.map(b => b.name)),
    idMap = {},
    grpMap = {},
    nameMap = {};
  c.blocks.forEach(src => {
    nameMap[src.name] = taken.has(src.name) ? uniqueName(src.name, taken) : (taken.add(src.name), src.name);
  });
  const mapTag = tid => {
    if (!tid) return tid;
    for (const on in nameMap) {
      if (tid.startsWith(on + '.')) return nameMap[on] + tid.slice(on.length);
    }
    return tid;
  };
  const ensureTag = old => {
    const nid = mapTag(old);
    if (!REG[nid]) {
      const def = c.tags[old] || REG[old];
      if (def) {
        const o = JSON.parse(JSON.stringify(def));
        o.id = nid;
        if (o.addr && nid !== old) {
          const on = Object.keys(nameMap).find(k => old.startsWith(k + '.'));
          if (on) o.addr = o.addr.split(on).join(nameMap[on]);
        }
        REG[nid] = o;
        ensureVal(nid, true);
      }
    }
    return nid;
  };
  const newIds = [];
  c.blocks.forEach(src => {
    const nb = JSON.parse(JSON.stringify(src));
    nb.id = 'b' + DOC.seq++;
    idMap[src.id] = nb.id;
    nb.name = nameMap[src.name];
    nb.x = Math.round(src.x - c.origin.x + ox);
    nb.y = Math.round(src.y - c.origin.y + oy);
    if (SNAP) {
      nb.x = Math.round(nb.x / 10) * 10;
      nb.y = Math.round(nb.y / 10) * 10;
    }
    nb.tags = src.tags.map(t => ({ ...t, id: ensureTag(t.id) }));
    nb.rules = (src.rules || []).map(r => ({ ...r, id: 'r' + DOC.seq++, tag: ensureTag(r.tag) }));
    nb.props.oos = false;
    if (nb.grp) nb.grp = grpMap[src.grp] || (grpMap[src.grp] = 'g' + DOC.seq++);
    DOC.blocks.push(nb);
    newIds.push(nb.id);
  });
  DOC.blocks
    .filter(b => newIds.includes(b.id))
    .forEach(b => {
      const p = b.props;
      if (p.rows)
        p.rows.forEach(r => {
          if (r.targets) r.targets = r.targets.map(x => idMap[x]).filter(Boolean);
          if ('target' in r) r.target = idMap[r.target] || null;
        });
      if (p.cols) p.cols = p.cols.map(x => idMap[x]).filter(Boolean);
      if ('target' in p) p.target = idMap[p.target] || null;
    });
  const sn = new Set(DOC.streams.map(s => s.name));
  c.streams.forEach(s => {
    let n = 1;
    while (sn.has('S' + n)) n++;
    sn.add('S' + n);
    DOC.streams.push({
      ...s,
      id: 's' + DOC.seq++,
      name: 'S' + n,
      from: { b: idMap[s.from.b], p: s.from.p },
      to: { b: idMap[s.to.b], p: s.to.p },
      tag: s.tag ? ensureTag(s.tag) : null,
      mid: null,
      pts: s.pts ? s.pts.map(q => ({ x: Math.round(q.x - c.origin.x + ox), y: Math.round(q.y - c.origin.y + oy) })) : undefined, // v3.7
    });
  });
  seedHist();
  SEL = null;
  SELM = new Set(newIds);
  logEv(`${label || 'Pasted'} ${newIds.length} item(s)`);
  changed();
  if (newIds.length === 1) select({ t: 'b', id: newIds[0] });
  toast(`${label || 'Pasted'} ${newIds.length} item${newIds.length > 1 ? 's' : ''} — tags renamed to match`);
}
function copySel() {
  const ids = selIds();
  if (!ids.length) {
    toast('Select equipment first (Shift-click or Shift-drag for several)');
    return;
  }
  CLIP = makeClip(ids);
  try {
    localStorage.setItem('sandman-clip', JSON.stringify(CLIP));
  } catch (e) {}
  toast(`Copied ${ids.length} item${ids.length > 1 ? 's' : ''} — Ctrl+V pastes here or in another flowsheet`);
}
function pasteHere() {
  if (MODE !== 'design') {
    toast('Switch to Design mode to paste');
    return;
  }
  let c = CLIP;
  if (!c) {
    try {
      c = JSON.parse(localStorage.getItem('sandman-clip') || 'null');
    } catch (e) {}
  }
  if (!c) {
    toast('Nothing copied yet');
    return;
  }
  // v2.8 — paste at the mouse pointer when it is over the canvas, otherwise at the centre of the view;
  // never exactly on top of what is already there (each further paste steps 24 px down-right)
  const r = $('#cwrap').getBoundingClientRect();
  let x, y;
  if (typeof LASTW !== 'undefined' && LASTW && Date.now() - LASTW.t < 60000) {
    x = LASTW.x;
    y = LASTW.y;
  } else {
    x = (r.width / 2 - VIEW.tx) / VIEW.k - 60;
    y = (r.height / 2 - VIEW.ty) / VIEW.k - 40;
  }
  x = Math.round(x);
  y = Math.round(y);
  const ox = c.origin ? c.origin.x : 0,
    oy = c.origin ? c.origin.y : 0,
    first = c.blocks[0],
    at = (px, py) => DOC.blocks.some(b => first && Math.abs(b.x - (px + first.x - ox)) < 8 && Math.abs(b.y - (py + first.y - oy)) < 8);
  for (let i = 0; i < 40 && at(x, y); i++) {
    x += 24;
    y += 24;
  }
  pasteClip(c, x, y);
}
function saveModuleForm() {
  const ids = selIds();
  if (!ids.length) {
    toast('Select the equipment to save as a module');
    return;
  }
  openModal(`<h3>Save as reusable module</h3><div class="note">A module is a group of equipment with its lines, tags, alert rules and panels — for example one complete molding station. Place it again from the library; names and tags are renumbered automatically.</div>
 <div class="fld" style="margin-top:10px"><label>Module name</label><input id="mName" value="Station ${MODS.length + 1}"></div><div class="note">${ids.length} item(s) selected.</div>
 <div class="mact"><button class="ib" id="mC">Cancel</button><button class="ib pri" id="mS">Save module</button></div>`);
  $('#mC').onclick = closeModal;
  $('#mS').onclick = () => {
    const n = $('#mName').value.trim();
    if (!n) {
      toast('Name the module');
      return;
    }
    MODS.push({ id: Date.now().toString(36), name: n, clip: makeClip(ids) });
    saveMods();
    closeModal();
    renderLib();
    toast(`Module “${n}” added to the library`);
  };
}
function alignSel(mode) {
  const bs = selIds().map(B).filter(Boolean);
  if (bs.length < 2) return;
  pushUndo();
  const D = bs.map(b => ({ b, ...dims(b) }));
  if (mode === 'left') {
    const x = Math.min(...D.map(o => o.b.x));
    D.forEach(o => (o.b.x = x));
  } else if (mode === 'top') {
    const y = Math.min(...D.map(o => o.b.y));
    D.forEach(o => (o.b.y = y));
  } else if (mode === 'cx') {
    const c = D.reduce((a, o) => a + o.b.x + o.W / 2, 0) / D.length;
    D.forEach(o => (o.b.x = Math.round(c - o.W / 2)));
  } else if (mode === 'cy') {
    const c = D.reduce((a, o) => a + o.b.y + o.H / 2, 0) / D.length;
    D.forEach(o => (o.b.y = Math.round(c - o.H / 2)));
  } else if (mode === 'dh') {
    D.sort((a, b) => a.b.x - b.b.x);
    const tot = D.reduce((a, o) => a + o.W, 0),
      span = D[D.length - 1].b.x + D[D.length - 1].W - D[0].b.x,
      gap = (span - tot) / (D.length - 1);
    let x = D[0].b.x;
    D.forEach(o => {
      o.b.x = Math.round(x);
      x += o.W + gap;
    });
  } else if (mode === 'dv') {
    D.sort((a, b) => a.b.y - b.b.y);
    const tot = D.reduce((a, o) => a + o.H, 0),
      span = D[D.length - 1].b.y + D[D.length - 1].H - D[0].b.y,
      gap = (span - tot) / (D.length - 1);
    let y = D[0].b.y;
    D.forEach(o => {
      o.b.y = Math.round(y);
      y += o.H + gap;
    });
  }
  changed();
}
function multiProps() {
  const bs = [...SELM].map(B).filter(Boolean),
    ds = MODE !== 'design';
  return `<div class="ph"><div style="font-weight:700;font-size:15px">${bs.length} items selected</div><small>Shift-click to add or remove · Esc clears</small></div>
 <div class="sec"><h5>Reuse</h5><div class="row2"><button class="ib" data-ma="copy">Copy (Ctrl+C)</button><button class="ib" data-ma="dup" ${ds ? 'disabled' : ''}>Duplicate</button></div><button class="ib pri" data-ma="mod" style="width:100%;margin-top:6px">Save as reusable module…</button></div>
 <div class="sec"><h5>Arrange</h5><div class="row3"><button class="ib" data-ma="left" ${ds ? 'disabled' : ''}>Align left</button><button class="ib" data-ma="top" ${ds ? 'disabled' : ''}>Align top</button><button class="ib" data-ma="cx" ${ds ? 'disabled' : ''}>Centre (vert.)</button><button class="ib" data-ma="cy" ${ds ? 'disabled' : ''}>Centre (horiz.)</button><button class="ib" data-ma="dh" ${ds || bs.length < 3 ? 'disabled' : ''}>Space across</button><button class="ib" data-ma="dv" ${ds || bs.length < 3 ? 'disabled' : ''}>Space down</button></div>
 <div class="row2" style="margin-top:6px"><button class="ib" data-ma="big">＋ Bigger</button><button class="ib" data-ma="small">− Smaller</button></div></div>
 <div class="sec"><h5>Items</h5>${bs.map(b => `<div class="kv"><span>${esc(EQ[b.type].n)}</span><b>${esc(b.name)}</b></div>`).join('')}<button class="ib" data-ma="del" style="width:100%;margin-top:8px;color:var(--crit)" ${ds ? 'disabled' : ''}>Delete ${bs.length} items</button></div>`;
}
function bindMultiProps() {
  $$('#props [data-ma]').forEach(
    x =>
      (x.onclick = () => {
        const a = x.dataset.ma;
        if (a === 'copy') copySel();
        else if (a === 'dup') {
          const c = makeClip(selIds());
          pasteClip(c, c.origin.x + 40, c.origin.y + 40, 'Duplicated');
        } else if (a === 'mod') saveModuleForm();
        else if (a === 'del') delSel();
        else if (a === 'big' || a === 'small') {
          pushUndo();
          selIds()
            .map(B)
            .forEach(b => (b.sc = clamp((b.sc || 1) * (a === 'big' ? 1.1 : 1 / 1.1), 0.3, 4)));
          changed();
        } else alignSel(a);
      }),
  );
}

/* ---------- Templates (reuse a plant for another plant) ---------- */
let TPLS = [];
try {
  TPLS = JSON.parse(localStorage.getItem('sandman-templates') || '[]');
} catch (e) {}
function saveTpls() {
  try {
    localStorage.setItem('sandman-templates', JSON.stringify(TPLS));
    return true;
  } catch (e) {
    toast('Browser storage is full — export and delete older templates');
    return false;
  }
}
const INDUSTRIES = [
  'Foundry',
  'Forging',
  'Machining',
  'Assembly',
  'Process / chemical',
  'Food & beverage',
  'Packaging',
  'Plastics / moulding',
  'Other',
];
const BUILTIN_TPLS = [
  {
    id: 'b_finalversion',
    name: 'Final Version',
    industry: 'Foundry',
    desc: 'The default loop: the customer-approved Final Version of the foundry sand loop — sand preparation, three DISA moulding lines with tilting induction furnaces and pouring units, shakeouts, return sand and cooling, PLCs and SCADA-1.',
    gen: loadFinalVersion,
  },
  {
    id: 'b_demoloop',
    name: 'DemoLoop',
    industry: 'Foundry',
    desc: 'Demo sand loop with PLCs and SCADA: the full foundry sand loop (storage → red muller → 3 DISA lines → shakeout → recovery → cooling → return) plus 4 PLCs → SCADA-1 and demo data on every equipment. Click SCADA-1 or a PLC in Publish view for the PLC Tag Monitor.',
    gen: loadDemoLoop,
  },
  {
    id: 'b_demoloop2',
    name: 'Demo Loop 2',
    industry: 'Foundry',
    desc: 'Your reworked DemoLoop, finished: bentonite + new sand feeders and two return sand silos feed the red sand muller; P-19 → 3 DISA lines, each with induction furnace → pouring station → shakeout; recovery, cooling, bucket elevator back to the return silos; 4 PLCs → SCADA-1 (72 demo tags).',
    gen: loadDemoLoop2,
  },
  {
    id: 'b_demoloop3',
    name: 'DemoLoop3',
    industry: 'Foundry',
    desc: 'DemoLoop 2 with every PLC beside its own area (preparation, moulding, shakeout & recovery, cooling & return) and the SCADA PC unchanged; all PLCs connected to SCADA-1 over a plant network with two switches. Same 87 demo tags.',
    gen: loadDemoLoop3,
  },
  {
    id: 'b_demoloop4',
    name: 'DemoLoop 4 — Digital Loop equipment',
    industry: 'Foundry',
    desc: 'The sand plant built from the latest Digital Loop equipment: bulk truck, bentonite / coal dust / new sand silos and water tank → weigh hopper → DISA mixer → aerator → inline sand tester and belt → storage hopper → moulding machine hopper → DISA line with induction furnace → DISA cooling drum → casting cooling conveyor → shot blast; magnetic separator → bucket elevator → polygon sieve → return sand silo; dust collector; core shop (core sand mixer, core shooter, amine generator, gas scrubber); 4 PLCs → switch → SCADA-1. Demo data and two sample alarms.',
    gen: loadDemoLoop4,
  },
  {
    id: 'b_demoloop5',
    name: 'Demo Loop 5',
    industry: 'Foundry',
    desc: 'Demo Loop 3\'s flow, readings, demo alarms, PLCs, network and controls, drawn with the latest Digital Loop equipment: bentonite and new sand silos with screw feeders → sand muller → P-19 → three DISA moulding lines (moulding machine, mould line and pouring in one drawing, induction furnace metal in) → flaskless shakeouts (castings out, sand to return belts) → recovery conveyor → polygon sieve → sieve hopper → rotary cooling drum → bucket elevator → return sand silos 1 / 2 → muller.',
    gen: loadDemoLoop5,
  },
  {
    id: 'b_finaldemo',
    name: 'Final Demo',
    industry: 'Foundry',
    desc: 'Demo Loop 3\'s layout, flow, readings, alarms, PLCs and controls with the latest equipment and moulding, melting & pouring and shakeout as separate machines: three rows of DISA moulding line (moulding only) → DISA pouring unit with induction furnace → vibratory shakeout (shakeout only) → castings belt; sand returns via the collector, recovery conveyor, polygon sieve, sieve hopper, cooling drum, bucket elevator and return sand silos to the muller.',
    gen: loadFinalDemo,
  },
  {
    id: 'b_twin',
    name: 'Sandman Digital Twin — Foundry Sand Loop',
    industry: 'Foundry',
    desc: 'Default demonstration loop: bentonite, new and return sand → weighing hopper → mixer → three DISA lines → shakeout (castings separated) → recovery → polygon sleeve → sieve → cooling drum → bucket elevator → return sand. Full HD publish page.',
    gen: loadSandTwin,
  },
  {
    id: 'b_sand',
    name: 'Sand handling & molding line',
    industry: 'Foundry',
    desc: 'Bond storage, dosing, batch mixer, three DISA lines, shakeout and sand return, with HMI panels.',
    gen: loadSandLine,
  },
  {
    id: 'b_found',
    name: 'Complete foundry line',
    industry: 'Foundry',
    desc: 'Sand loop, molding, melting, pouring, shakeout and finishing.',
    gen: loadFoundry,
  },
  {
    id: 'b_plcmon',
    name: 'Equipment → PLC → SCADA — tag monitor demo',
    industry: 'Any',
    desc: 'Sand mixer, additive feeder, DISA 1 and pouring station mapped to their PLCs and SCADA-1 (plus an unrelated utility PLC on SCADA-2). Click a SCADA, PLC or equipment in Publish view for the PLC Tag Monitor. Simulation data.',
    gen: loadPlcDemo,
  },
  {
    id: 'b_iiot',
    name: 'IIoT communication — PLC → Gateway → SCADA → Cloud',
    industry: 'Any',
    desc: 'Control & IT reference: sensors, Modbus, PLC, HMI, network switch, edge gateway, OPC UA, SCADA, database, router and cloud, with animated data packets.',
    gen: loadIIoT,
  },
  {
    id: 'b_blank',
    name: 'Blank flowsheet',
    industry: 'Any',
    desc: 'Start empty — any industry.',
    gen: () => {
      DOC = blankDoc();
      DOC.name = 'New flowsheet';
      REG = {};
    },
  },
];
function tplCounts(doc) {
  return `${doc.blocks.length} items · ${doc.streams.length} lines`;
}
function openTemplates() {
  const all = [...BUILTIN_TPLS.map(t => ({ ...t, builtin: 1 })), ...TPLS];
  openModal(
    `<div style="display:flex;align-items:center;gap:10px"><h3 style="margin:0">Templates</h3><span class="note">Reuse a proven layout for another plant or line with minimal changes.</span></div>
 <div class="mact" style="justify-content:flex-start;margin:10px 0"><button class="ib pri" id="tSave">Save current flowsheet as template…</button><button class="ib" id="tImp">Import template…</button></div>
 <div class="tpl-g">${all
   .map(
     t => `<div class="tpl"><div class="tpl-h"><b>${esc(t.name)}</b><span class="chip" style="background:${t.builtin ? '#64748b' : '#1f6feb'}">${esc(t.industry || 'Other')}</span></div><div class="note">${esc(t.desc || '')}</div><div class="note mono" style="margin-top:4px">${t.builtin ? 'Built-in' : `${tplCounts(t.doc)} · saved ${new Date(t.date).toLocaleDateString()}`}</div>
  <div class="tpl-a"><button class="ib pri" data-use="${t.id}">Use template</button>${t.builtin ? '' : `<button class="ib" data-exp="${t.id}">Export</button><button class="ib" data-del="${t.id}" style="color:var(--crit)">Delete</button>`}</div></div>`,
   )
   .join('')}</div>
 <div class="mact"><button class="ib" id="tClose">Close</button></div>`,
    'xl',
  );
  $('#tClose').onclick = closeModal;
  $('#tSave').onclick = saveTplForm;
  $('#tImp').onclick = importTplForm;
  $$('#mbox [data-use]').forEach(b => (b.onclick = () => useTplForm(all.find(t => t.id === b.dataset.use))));
  $$('#mbox [data-exp]').forEach(
    b =>
      (b.onclick = () => {
        const t = TPLS.find(x => x.id === b.dataset.exp);
        openModal(
          `<h3>Export template “${esc(t.name)}”</h3><div class="note">Copy and keep this text, or paste it into Templates → Import on another computer.</div><textarea readonly style="margin-top:8px">${esc(JSON.stringify({ format: 'sandman-template', version: 1, template: t }))}</textarea><div class="mact"><button class="ib" id="xB">Back</button><button class="ib pri" id="xC">Copy</button></div>`,
          true,
        );
        $('#xB').onclick = openTemplates;
        $('#xC').onclick = () => copyText($('#mbox textarea').value, 'Template copied');
      }),
  );
  $$('#mbox [data-del]').forEach(
    b =>
      (b.onclick = () => {
        const t = TPLS.find(x => x.id === b.dataset.del);
        TPLS = TPLS.filter(x => x !== t);
        saveTpls();
        toast(`Template “${t.name}” deleted`);
        openTemplates();
      }),
  );
}
function saveTplForm() {
  openModal(`<h3>Save as template</h3><div class="note">Saves the layout, equipment (including custom equipment), lines, tags with limits, alert rules and HMI panels.</div>
 <div class="row2" style="margin-top:10px"><div class="fld"><label>Template name</label><input id="tN" value="${esc(DOC.name)}"></div><div class="fld"><label>Industry</label><select id="tI">${INDUSTRIES.map(i => `<option>${i}</option>`).join('')}</select></div></div>
 <div class="fld"><label>Description</label><textarea id="tD" rows="2" placeholder="What this line covers, which plant it came from"></textarea></div>
 <div class="mact"><button class="ib" id="tB">Back</button><button class="ib pri" id="tS">Save template</button></div>`);
  $('#tB').onclick = openTemplates;
  $('#tS').onclick = () => {
    const n = $('#tN').value.trim();
    if (!n) {
      toast('Name the template');
      return;
    }
    syncDocCustom();
    const doc = JSON.parse(JSON.stringify(DOC));
    doc.blocks.forEach(b => (b.props.oos = false));
    TPLS.push({
      id: 't' + Date.now().toString(36),
      name: n,
      industry: $('#tI').value,
      desc: $('#tD').value.trim(),
      date: Date.now(),
      doc,
      reg: JSON.parse(JSON.stringify(REG)),
    });
    if (saveTpls()) {
      logEv(`Saved template “${n}”`);
      toast(`Template “${n}” saved`);
      openTemplates();
    }
  };
}
function importTplForm() {
  openModal(
    `<h3>Import template</h3><textarea id="iT" placeholder='{"format":"sandman-template", ...}'></textarea><div class="mact"><button class="ib" id="iB">Back</button><button class="ib pri" id="iG">Import</button></div>`,
    true,
  );
  $('#iB').onclick = openTemplates;
  $('#iG').onclick = () => {
    try {
      const o = JSON.parse($('#iT').value),
        t = o.template || o;
      if (!t.doc || !t.reg || !t.name) throw 0;
      t.id = 't' + Date.now().toString(36);
      TPLS.push(t);
      saveTpls();
      toast(`Template “${t.name}” imported`);
      openTemplates();
    } catch (e) {
      toast('That text is not a SandMan template export');
    }
  };
}
function useTplForm(t) {
  openModal(`<h3>Use template “${esc(t.name)}”</h3><div class="note">Adjust the few things that differ between plants. Everything else — layout, equipment, lines, limits, rules and panels — is reused.</div>
 <div class="row2" style="margin-top:10px"><div class="fld"><label>New flowsheet name</label><input id="uN" value="${esc(t.builtin ? t.name : t.name + ' — copy')}"></div><div class="fld"><label>Tag prefix for this plant (optional)</label><input id="uP" class="mono" placeholder="e.g. PUNE2."></div></div>
 <div class="row2"><div class="fld"><label>In tag addresses, replace</label><input id="uF" class="mono" placeholder="e.g. Line1"></div><div class="fld"><label>with</label><input id="uR" class="mono" placeholder="e.g. Line3"></div></div>
 <div class="row2"><div class="fld"><label>Data source for all tags</label><select id="uS"><option value="">Keep as in template</option>${['SandMan Gateway', 'OPC UA', 'Modbus TCP', 'MQTT', 'SandMan Lab', 'Manual entry'].map(s => `<option>${s}</option>`).join('')}</select></div><div class="fld"><label>Alert rules</label><select id="uK"><option value="keep">Keep custom rules</option><option value="drop">Remove custom rules</option></select></div></div>
 <div class="note">After applying: open <b>Tag table → Export CSV</b>, fill in this plant's addresses in Excel, then <b>Import CSV</b>. The current flowsheet is replaced — Ctrl+Z brings it back.</div>
 <div class="mact"><button class="ib" id="uB">Back</button><button class="ib pri" id="uG">Create flowsheet</button></div>`);
  $('#uB').onclick = openTemplates;
  $('#uG').onclick = () => {
    const prev = snap();
    let doc, reg;
    if (t.builtin) {
      const sd = DOC,
        sr = REG;
      t.gen();
      doc = DOC;
      reg = REG;
      DOC = sd;
      REG = sr;
    } else {
      doc = JSON.parse(JSON.stringify(t.doc));
      reg = JSON.parse(JSON.stringify(t.reg));
      registerDocCustom(doc);
    }
    const miss = doc.blocks.find(b => !EQ[b.type]);
    if (miss) {
      toast(`Template needs equipment “${miss.type}” that is not in this library`);
      return;
    }
    const P = $('#uP').value.trim(),
      F = $('#uF').value,
      Rp = $('#uR').value,
      S = $('#uS').value;
    if (P) {
      const map = {},
        nr = {};
      Object.keys(reg).forEach(id => {
        const n = id.startsWith(P) ? id : P + id;
        map[id] = n;
        nr[n] = { ...reg[id], id: n };
      });
      reg = nr;
      doc.blocks.forEach(b => {
        b.tags.forEach(x => (x.id = map[x.id] || x.id));
        (b.rules || []).forEach(r => (r.tag = map[r.tag] || r.tag));
      });
      doc.streams.forEach(s => {
        if (s.tag) s.tag = map[s.tag] || s.tag;
      });
    }
    Object.values(reg).forEach(x => {
      if (F)
        x.addr = String(x.addr || '')
          .split(F)
          .join(Rp);
      if (S) {
        x.src = S;
        x.lab = S === 'SandMan Lab' ? 1 : 0;
      }
    });
    if ($('#uK').value === 'drop') doc.blocks.forEach(b => (b.rules = []));
    UNDO.push(prev);
    REDO = [];
    DOC = doc;
    REG = reg;
    DOC.name = $('#uN').value.trim() || DOC.name;
    for (const id in REG) ensureVal(id, true);
    seedHist();
    SEL = null;
    SELM.clear();
    closeModal();
    logEv(`Created flowsheet from template “${t.name}”`);
    changed();
    fit();
    toast('Flowsheet created from template');
  };
}

/* ---------- Control chart (I-MR) ---------- */
let trendTag = null;
const TR = { win: 300, basis: 'win', spec: true, hover: null, sig: 'mr' };
function ccData() {
  const t = REG[trendTag],
    V = VAL[trendTag];
  if (!t || !V) return [];
  const now = Date.now();
  let pts = V.h.filter(p => p.t >= now - TR.win * 1000);
  if (t.lab) pts = pts.filter((p, i) => i === 0 || p.v !== pts[i - 1].v);
  return pts;
}
function ccRules(S) {
  const vs = S.vs,
    z = v => (v - S.cl) / S.sigma,
    f = vs.map(() => 0);
  for (let i = 0; i < vs.length; i++) {
    const zi = z(vs[i]);
    if (Math.abs(zi) > 3) {
      f[i] = 1;
      continue;
    }
    if (i >= 2) {
      const w = [i - 2, i - 1, i].map(j => z(vs[j]));
      if ((zi > 2 && w.filter(x => x > 2).length >= 2) || (zi < -2 && w.filter(x => x < -2).length >= 2)) {
        f[i] = 2;
        continue;
      }
    }
    if (i >= 4) {
      const w = [0, 1, 2, 3, 4].map(j => z(vs[i - j]));
      if ((zi > 1 && w.filter(x => x > 1).length >= 4) || (zi < -1 && w.filter(x => x < -1).length >= 4)) {
        f[i] = 3;
        continue;
      }
    }
    if (i >= 7) {
      const w = [...Array(8)].map((_, j) => z(vs[i - j]));
      if (w.every(x => x > 0) || w.every(x => x < 0)) f[i] = 4;
    }
  }
  return f;
}
const RULEN = {
  1: 'Point beyond 3σ control limit',
  2: '2 of 3 points beyond 2σ on one side',
  3: '4 of 5 points beyond 1σ on one side',
  4: '8 points in a row on one side of the centre line',
};
function ccCanvas(cv) {
  const r = cv.getBoundingClientRect();
  if (r.width < 20) return null;
  const d = devicePixelRatio || 1;
  cv.width = Math.round(r.width * d);
  cv.height = Math.round(r.height * d);
  const c = cv.getContext && cv.getContext('2d');
  if (!c) return null;
  c.setTransform(d, 0, 0, d, 0, 0);
  return { c, W: r.width, H: r.height };
}
function tfmt(t) {
  return new Date(t).toLocaleTimeString('en-GB', { hour12: false });
}

$('#bNewEq').onclick = () => openDesigner(null);
$('#bLibIO').onclick = libIOForm;
$('#bTplLib').onclick = openTemplates;

/* v1.11 — empty-canvas card: open a reference loop in one click, or choose one */
function openReference(t) {
  pushUndo();
  t.gen();
  for (const id in REG) ensureVal(id);
  seedHist();
  SEL = null;
  SELM = new Set();
  logEv(`Opened reference loop “${t.name}”`);
  changed();
  requestAnimationFrame(() => fit());
  toast(`“${t.name}” opened — adapt it to your plant. Ctrl+Z goes back to the empty flowsheet.`);
}
(() => {
  const ref = $('#feRef'),
    ch = $('#feChoose');
  if (ref) ref.onclick = () => openReference(BUILTIN_TPLS[0]); // v2.7: button removed from the empty-canvas card
  if (!ch) return;
  ch.onclick = e =>
    menu(e, [
      ...BUILTIN_TPLS.filter(t => t.id !== 'b_blank').map(t => ({ t: t.name, f: () => openReference(t) })),
      { t: 'More templates (including saved ones)…', f: () => openTemplates() },
    ]);
})();

/* v9.10 — the empty canvas offers the demo loops directly */
(() => {
  const d = document.getElementById('fseDemo'),
    m = document.getElementById('fseMore');
  if (d) d.onclick = () => openReference(BUILTIN_TPLS.find(t => t.id === 'b_finalversion') || BUILTIN_TPLS[0]); // v9.37: the default loop
  if (m)
    m.onclick = e =>
      menu(e, BUILTIN_TPLS.filter(t => t.id !== 'b_blank').map(t => ({ t: t.name, f: () => openReference(t) })), { title: 'Sample loops' });
})();
