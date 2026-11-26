/*! SandMan Digital Loop Studio — 27m-anim-parts.js
 *  v10.4 — Uploaded / designed SVG equipment: the app finds every moving part itself and drives it from data.
 *
 *  When an SVG is added (Equipment designer › SVG drawing) the app reads it and lists its moving parts:
 *    CSS animations  (@keyframes + the elements that use them, also inline style="animation:…")
 *    SMIL animations (<animate>, <animateTransform>, <animateMotion>, <set>)
 *  Each part gets its motion (rotates, moves, flows, pulses, blinks, changes) and its normal time.
 *  Per part, for every copy of this equipment type:  Follows data (default) · Always moves · Never moves.
 *  The drawing's Animation mode is suggested from what moves: rotation / movement / flow → Speed, only blinking → On/Off,
 *  a marked level shape → Level.
 *  Level: any shape of the SVG can be chosen as the "level shape"; it is cut from the top to the level %.
 *  Running: in Simulate / Publish the parts move only while the equipment runs; "Follows data" parts take the speed
 *  from Properties › Animation (rate, speed, on/off, stop rules, no-data choice) exactly like the library drawings. */

const AP_CACHE = new Map(); // svg text → { parts, levels, marked }
const AP_KIND_TXT = { rotate: 'rotates', move: 'moves', flow: 'flows', pulse: 'pulses', blink: 'blinks', change: 'changes' };
function apSecs(t) {
  const m = /^(-?[\d.]+)(ms|s|min|h)?$/.exec(String(t || '').trim());
  if (!m) return null;
  const n = +m[1];
  return m[2] === 'ms' ? n / 1000 : m[2] === 'min' ? n * 60 : m[2] === 'h' ? n * 3600 : n;
}
function apKindOfFrames(body) {
  if (/rotate/i.test(body)) return 'rotate';
  if (/dashoffset/i.test(body)) return 'flow';
  if (/translate|offset-distance|\b(x|y|cx|cy)\s*:/i.test(body)) return 'move';
  if (/scale/i.test(body)) return 'pulse';
  if (/opacity|visibility/i.test(body)) return 'blink';
  return 'change';
}
function apLabel(el, i) {
  const id = el.getAttribute('id'),
    c = (el.getAttribute('class') || '').trim().split(/\s+/)[0],
    t = el.getAttribute('aria-label') || (el.querySelector && el.querySelector(':scope > title') && el.querySelector(':scope > title').textContent);
  return (t || id || c || el.tagName.toLowerCase() + ' ' + (i + 1)).slice(0, 40);
}
/* read one SVG: parts + level candidates + the markup with data-adpart / data-adlv marks */
function apAnalyse(inner) {
  if (AP_CACHE.has(inner)) return AP_CACHE.get(inner);
  const res = { parts: [], levels: [], marked: inner };
  try {
    const doc = new DOMParser().parseFromString(`<!doctype html><body><svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`, 'text/html'),
      root = doc.body.querySelector('svg');
    const css = [...root.querySelectorAll('style')].map(s => s.textContent).join('\n');
    const frames = {};
    const rest = css.replace(/@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g, (m, n, body) => {
      frames[n] = apKindOfFrames(body);
      return '';
    });
    const seen = new Map();
    const add = (el, kind, dur, how) => {
      const k = seen.get(el) || 'p' + res.parts.length;
      if (!seen.has(el)) {
        seen.set(el, k);
        el.setAttribute('data-adpart', k);
        res.parts.push({ k, label: apLabel(el, res.parts.length), kind, dur, how });
      } else {
        const p = res.parts.find(x => x.k === k);
        if (p && p.kind !== kind) p.kind = p.kind === 'blink' ? kind : p.kind;
      }
    };
    const animDecl = decl => {
      const out = [];
      const sh = /(?:^|;)\s*animation\s*:([^;]+)/i.exec(decl),
        nm = /(?:^|;)\s*animation-name\s*:([^;]+)/i.exec(decl),
        du = /(?:^|;)\s*animation-duration\s*:([^;]+)/i.exec(decl);
      if (sh)
        sh[1].split(',').forEach(a => {
          const tok = a.trim().split(/\s+/),
            name = tok.find(t => frames[t]),
            dur = tok.find(t => /^[\d.]+m?s$/.test(t));
          if (name) out.push({ name, dur: apSecs(dur) });
        });
      if (nm)
        nm[1].split(',').forEach((n, i) => {
          n = n.trim();
          if (frames[n]) out.push({ name: n, dur: du ? apSecs(du[1].split(',')[i] || du[1].split(',')[0]) : null });
        });
      return out;
    };
    rest.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, decl) => {
      const A = animDecl(decl);
      if (!A.length) return '';
      sel.split(',').forEach(s => {
        s = s.trim();
        if (!s || /^@/.test(s)) return;
        let els = [];
        try {
          els = [...root.querySelectorAll(s.replace(/:(hover|focus|active)\b/g, ''))];
        } catch (e) {}
        els.forEach(el => A.forEach(a => add(el, frames[a.name], a.dur, 'css')));
      });
      return '';
    });
    root.querySelectorAll('[style*="animation"]').forEach(el => animDecl(el.getAttribute('style')).forEach(a => add(el, frames[a.name], a.dur, 'css')));
    root.querySelectorAll('animate,animateTransform,animateMotion,set,animatetransform,animatemotion').forEach(an => {
      const href = an.getAttribute('href') || an.getAttribute('xlink:href');
      let el = href && href[0] === '#' ? root.querySelector('#' + CSS.escape(href.slice(1))) : an.parentElement;
      if (!el || el === root) el = an;
      const tn = an.tagName.toLowerCase(),
        at = (an.getAttribute('attributeName') || '').toLowerCase(),
        ty = (an.getAttribute('type') || '').toLowerCase();
      const kind =
        tn === 'animatemotion' ? 'move' : tn === 'animatetransform' ? (ty === 'rotate' ? 'rotate' : ty === 'scale' ? 'pulse' : 'move') : /dashoffset/.test(at) ? 'flow' : /opacity|visibility/.test(at) ? 'blink' : /^(x|y|cx|cy|x1|x2|y1|y2|points|d)$/.test(at) ? 'move' : 'change';
      an.setAttribute('data-adsmil', '1');
      an.setAttribute('data-dur0', an.getAttribute('dur') || '');
      add(el, kind, apSecs(an.getAttribute('dur')), 'smil');
    });
    /* level shapes: anything named like a fill / level first, then every named shape */
    const shapes = [...root.querySelectorAll('rect,path,polygon,ellipse,circle,g')];
    const named = shapes.filter(e => e.getAttribute('id') || e.getAttribute('class'));
    const likely = named.filter(e => /level|fill|sand|material|content|liquid|stock|charge|bulk/i.test((e.getAttribute('id') || '') + ' ' + (e.getAttribute('class') || '')));
    [...likely, ...named.filter(e => !likely.includes(e))].slice(0, 40).forEach((e, i) => {
      const k = 'L' + i;
      e.setAttribute('data-adlv', k);
      res.levels.push({ k, label: apLabel(e, i), likely: likely.includes(e) });
    });
    res.marked = root.innerHTML;
  } catch (e) {
    console.warn('SVG animation analysis failed', e);
  }
  AP_CACHE.set(inner, res);
  return res;
}
function apDef(b) {
  const E = b && EQ[b.type];
  return E && E.def && E.def.shape === 'svg' && E.def.svg ? E.def : null;
}
function apInfo(d) {
  return apAnalyse(parseSvg(d.svg).inner);
}
function apBeh(d, k) {
  return (d.animParts && d.animParts[k]) || 'follow';
}

/* v10.4 — an uploaded SVG's CSS is scoped to its own drawing: every selector gets [data-cust="<key>"] in front and every
   @keyframes name gets the key as suffix, so two drawings never clash and no drawing can restyle the Studio itself */
function apScopeKey(d) {
  return 'c' + String(d.id || '').replace(/[^\w-]/g, '').slice(-24);
}
const AP_SCOPED = new Map();
function apScopeCss(css, k) {
  const names = new Set();
  css.replace(/@(?:-webkit-)?keyframes\s+([\w-]+)/g, (m, n) => names.add(n));
  const ren = t => t.replace(/[\w-]+/g, w => (names.has(w) ? w + '_' + k : w));
  const pre = sel =>
    sel
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => (/^(html|body|:root|svg)$/i.test(x) ? `[data-cust="${k}"]` : `[data-cust="${k}"] ${x.replace(/^(html|body|:root|svg)\s+/i, '')}`))
      .join(',');
  let out = '',
    i = 0;
  while (i < css.length) {
    const at = css.slice(i).match(/^\s*@(-webkit-)?keyframes\s+([\w-]+)\s*\{/);
    if (at) {
      let depth = 1,
        j = i + at[0].length;
      while (j < css.length && depth) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0, j++;
      out += css.slice(i, j).replace(at[2], at[2] + '_' + k);
      i = j;
      continue;
    }
    const med = css.slice(i).match(/^\s*@media[^{]*\{/);
    if (med) {
      let depth = 1,
        j = i + med[0].length;
      while (j < css.length && depth) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0, j++;
      out += med[0] + apScopeCss(css.slice(i + med[0].length, j - 1), k) + '}';
      i = j;
      continue;
    }
    const r = css.slice(i).match(/^([^{}]*)\{([^{}]*)\}/);
    if (!r) break;
    if (r[1].trim().startsWith('@')) out += r[0];
    else out += pre(r[1]) + '{' + r[2].replace(/(animation(?:-name)?\s*:)([^;}]*)/gi, (m, a, b) => a + ren(b)) + '}';
    i += r[0].length;
  }
  return out;
}
function apScoped(inner, k) {
  const key = k + '|' + inner.length + '|' + inner.slice(0, 64);
  if (AP_SCOPED.has(key) && AP_SCOPED.get(key).src === inner) return AP_SCOPED.get(key).out;
  const out = inner
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, c) => a + apScopeCss(css, k) + c)
    .replace(/(style="[^"]*?animation(?:-name)?\s*:)([^";]*)/gi, (m, a, b) => {
      const names = new Set();
      inner.replace(/@(?:-webkit-)?keyframes\s+([\w-]+)/g, (x, n) => names.add(n));
      return a + b.replace(/[\w-]+/g, w => (names.has(w) ? w + '_' + k : w));
    });
  AP_SCOPED.set(key, { src: inner, out });
  return out;
}

/* draw with the marks (the drawing itself is unchanged) */
{
  const cdPrev = customDraw;
  customDraw = function (d, w, h, b, uid) {
    const s = cdPrev(d, w, h, b, uid);
    if (d.shape !== 'svg' || !d.svg) return s;
    const P = parseSvg(d.svg),
      I = apAnalyse(P.inner);
    const i = s.indexOf(P.inner);
    if (i < 0) return s;
    const k = apScopeKey(d);
    const out = s.slice(0, i) + apScoped(I.marked, k) + s.slice(i + P.inner.length);
    return out.replace(/<svg x="0" y="0"/, `<svg data-cust="${k}" x="0" y="0"`);
  };
  /* EQ[type].draw captured customDraw by name inside regCustom's arrow → already calls this version */
}

/* what the drawing can do (adds uploaded SVGs to Properties › Animation) */
{
  const aPrev = adAnimatable,
    lPrev = adCanLevel,
    kPrev = adKind;
  adAnimatable = function (b) {
    const d = apDef(b);
    if (d) {
      const I = apInfo(d);
      return I.parts.length > 0 || !!d.levelPart;
    }
    return aPrev(b);
  };
  adCanLevel = function (b) {
    const d = apDef(b);
    return d ? !!d.levelPart : lPrev(b);
  };
  adKind = function (b) {
    const d = apDef(b);
    if (!d) return kPrev(b);
    if (d.levelPart) return 'level';
    const ks = apInfo(d)
      .parts.filter(p => apBeh(d, p.k) === 'follow')
      .map(p => p.kind);
    if (ks.some(k => k === 'rotate' || k === 'move' || k === 'flow')) return 'speed';
    return 'onoff';
  };
}

/* level % for an uploaded drawing: the Animation setting, else the equipment's own level reading */
function apLevelPct(b) {
  const c = adCfg(b);
  if (c && c.mode === 'level' && MODE === 'monitor') {
    const S = adDecide(b);
    if (S && S.v != null && (S.st === 'live' || S.st === 'held' || S.st === 'test')) {
      let p = null;
      if (c.lvAs === 'weight') p = +c.cap > 0 ? (S.v / +c.cap) * 100 : null;
      else {
        const lo = c.lvLo != null && c.lvLo !== '' ? +c.lvLo : 0,
          hi = c.lvHi != null && c.lvHi !== '' ? +c.lvHi : 100;
        p = hi > lo ? ((S.v - lo) / (hi - lo)) * 100 : null;
      }
      if (p != null) return (S.pct = clamp(p, 0, 100));
    }
  }
  const L = symState(b).level;
  return L != null ? clamp(L * 100, 0, 100) : null;
}

/* run the parts: Follows data → speed from the data; Always → normal pace; Never → still. Only while running. */
function apSync(b, g) {
  const d = apDef(b);
  if (!d || !g) return;
  const live = MODE === 'monitor',
    running = !live || effRun(b),
    c = adCfg(b),
    key = live && c ? drvKey(b) : '',
    rate = adKeyRate(key, c && c.base),
    stopData = key === 'stop';
  const sig = `${running}|${key}|${JSON.stringify(d.animParts || {})}`;
  /* CSS animations: Web Animations API, per part */
  // perf: getAnimations() forces a style recalculation — run it when the state changes, and re-check every 10 s
  // (a redraw replaces the element, which clears apsig, so a new drawing is always set up at once)
  if (g.dataset.apsig !== sig || (SIMT % 10 === 0 && g.dataset.apt !== String(SIMT))) {
    g.dataset.apt = String(SIMT);
    const anims = g.getAnimations ? g.getAnimations({ subtree: true }) : [];
    g.dataset.apn = anims.length;
    for (const a of anims) {
      const t = a.effect && a.effect.target,
        el = t && t.closest && t.closest('[data-adpart]');
      if (!el) continue;
      const beh = apBeh(d, el.getAttribute('data-adpart'));
      const stop = beh === 'never' || !running || (beh === 'follow' && stopData),
        r = beh === 'follow' ? rate : 1;
      if (stop) {
        if (a.playState === 'running') a.pause();
      } else {
        if (a.playState === 'paused') a.play();
        if (Math.abs(a.playbackRate - r) > 0.001) a.updatePlaybackRate(r);
      }
    }
    /* SMIL animations: scale their duration; a stopped part is frozen at its start */
    g.querySelectorAll('[data-adsmil]').forEach(an => {
      const el = an.closest('[data-adpart]') || an,
        k = el.getAttribute('data-adpart') || (an.getAttribute('data-adpart') || ''),
        beh = apBeh(d, k),
        d0 = apSecs(an.getAttribute('data-dur0'));
      if (!d0) return;
      const stop = beh === 'never' || !running || (beh === 'follow' && stopData),
        r = beh === 'follow' ? rate : 1,
        nd = stop ? 'indefinite' : +(d0 / Math.max(0.05, Math.abs(r))).toFixed(3) + 's';
      if (an.getAttribute('dur') !== nd) an.setAttribute('dur', nd);
    });
    g.dataset.apsig = sig;
  }
  /* level shape */
  if (d.levelPart) {
    const el = g.querySelector(`[data-adlv="${d.levelPart}"]`);
    if (el) {
      const p = apLevelPct(b),
        q = p == null ? '' : `inset(${(100 - Math.round(p)).toFixed(0)}% 0 0 0)`;
      if (el.style.clipPath !== q) el.style.clipPath = q;
    }
  }
}
{
  const sPrev = smLvSync;
  smLvSync = function (b, g) {
    sPrev(b, g);
    if (b && g && apDef(b)) apSync(b, g);
  };
}

/* ---------- Properties › Animation: the drawing's moving parts (saved on the equipment type) ---------- */
function apSaveDef(d) {
  if (typeof saveCustLib === 'function') saveCustLib();
  if (typeof syncDocCustom === 'function') syncDocCustom();
  changed();
  renderCanvas();
  renderProps();
}
function apPartsHtml(b) {
  const d = apDef(b),
    I = apInfo(d),
    n = EQ[b.type].n || b.type;
  const opt = (k, v, l) => `<option value="${v}" ${apBeh(d, k) === v ? 'selected' : ''}>${l}</option>`;
  const rows = I.parts
    .map(
      p => `<tr data-aph="${p.k}"><td title="${esc(p.label)}">${esc(p.label)}</td><td>${AP_KIND_TXT[p.kind] || p.kind}${p.dur ? ' · ' + fmtN(p.dur, p.dur < 10 ? 1 : 0) + ' s' : ''}</td><td><select data-app="${p.k}">${opt(p.k, 'follow', 'Follows data')}${opt(p.k, 'always', 'Always')}${opt(p.k, 'never', 'Never')}</select></td></tr>`,
    )
    .join('');
  const lv = `<div class="fld"><label>Level shape</label><select id="apLv"><option value="">(none — no level)</option>${I.levels
    .map(l => `<option value="${l.k}" ${d.levelPart === l.k ? 'selected' : ''}>${esc(l.label)}${l.likely ? ' ★' : ''}</option>`)
    .join('')}</select><div class="ad-hint">The shape is cut from the top to the level %. ★ = named like a fill / level.</div></div>`;
  return `<div class="ap" id="apSec"><div class="ap-h">Moving parts in this drawing <span>— for every ${esc(n)}</span></div>
   ${I.parts.length ? `<table class="ap-t"><tbody>${rows}</tbody></table>` : '<p class="lc2-note">No moving parts found: this SVG has no animation inside (CSS or SMIL), so only Level and Colour by value can be used. For rotating or moving parts, ask for an animated SVG.</p>'}
   ${I.levels.length ? lv : ''}</div>`;
}
{
  const rpPrev = renderProps;
  renderProps = function () {
    rpPrev();
    try {
      const b = SEL && SEL.t === 'b' ? B(SEL.id) : null,
        P = document.getElementById('props');
      if (!b || !P || PTAB !== 'eq' || RP) return;
      const d = apDef(b);
      if (!d) return;
      const I = apInfo(d);
      if (!I.parts.length && !I.levels.length) return;
      let S = P.querySelector('#drvSec');
      if (!S) {
        // a drawing without moving parts can still get a level shape
        P.insertAdjacentHTML('beforeend', `<section class="ix-sec drv ad" id="drvSec"><h4>Animation</h4></section>`);
        S = P.querySelector('#drvSec');
      }
      const ms = S.querySelector('.ad-modes');
      ms ? ms.insertAdjacentHTML('afterend', apPartsHtml(b)) : S.insertAdjacentHTML('beforeend', apPartsHtml(b));
      S.querySelectorAll('[data-app]').forEach(
        x =>
          (x.onchange = () => {
            pushUndo();
            d.animParts = Object.assign({}, d.animParts || {}, { [x.dataset.app]: x.value });
            apSaveDef(d);
          }),
      );
      const lv = S.querySelector('#apLv');
      if (lv)
        lv.onchange = () => {
          pushUndo();
          d.levelPart = lv.value || null;
          apSaveDef(d);
        };
      /* point at the part on the drawing */
      S.querySelectorAll('[data-aph]').forEach(tr => {
        const on = v => document.querySelectorAll(`#bk_${b.id} [data-adpart="${tr.dataset.aph}"]`).forEach(e => e.classList.toggle('ap-hi', v));
        tr.onmouseenter = () => on(true);
        tr.onmouseleave = () => on(false);
      });
    } catch (e) {
      console.error(e);
    }
  };
}

/* ---------- when an SVG is saved in the designer: say what was found ---------- */
if (typeof dzSave === 'function') {
  const zPrev = dzSave;
  dzSave = function (place) {
    const d = typeof DZ !== 'undefined' ? DZ : null;
    const r = zPrev(place);
    try {
      if (d && d.shape === 'svg' && d.svg && EQ[d.id]) {
        const I = apInfo(d),
          ks = [...new Set(I.parts.map(p => AP_KIND_TXT[p.kind]))].join(', ');
        if (I.parts.length) toast(`${I.parts.length} moving part${I.parts.length > 1 ? 's' : ''} found (${ks}) — they follow data once a tag is set in Properties › Animation`);
        else if (I.levels.some(l => l.likely)) toast('No moving parts; a level shape can be chosen in Properties › Animation');
      }
    } catch (e) {}
    return r;
  };
}

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
.drv.ad .ap{margin:6px 0 10px;padding:8px;border:1px solid var(--line);border-radius:8px}
.drv.ad .ap-h{font:600 12.5px var(--sans);margin-bottom:6px}.drv.ad .ap-h span{font-weight:400;color:var(--muted)}
.drv.ad .ap-t{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}.drv.ad .ap-t td{padding:3px 4px;border-top:1px solid var(--line);vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drv.ad .ap-t td:first-child{width:30%;font-weight:600}.drv.ad .ap-t td:nth-child(2){width:32%;color:var(--muted);white-space:normal;font-size:11.5px;line-height:1.2}.drv.ad .ap-t select{width:100%;font-size:12px}
.drv.ad .ap-t tr:hover td{background:var(--bg2,#f3f5f8)}
#cv .ap-hi{outline:2px solid #1f6feb;outline-offset:1px;filter:drop-shadow(0 0 3px #1f6feb)}
</style>`,
);
