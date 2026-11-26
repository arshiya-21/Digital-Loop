/*! SandMan Digital Loop Studio — 27x-anim-modes.js
 *  v10.4 — four more animation modes for every drawing (library and uploaded SVG), set in Properties › Animation:
 *   · Colour by value — 3 colour bands (or a smooth blend); shown as a tint over the drawing, a glow, or both
 *   · Position        — value → 0–100 % of the drawing's own motion; the motion is held there (valve, gate, tilt, stroke)
 *   · Direction       — forward value → normal, reverse value → the motion runs backwards, anything else → still
 *   · Step on event   — each time a counter goes up the motion runs once (one step), then waits
 *  Keys from 27l: 'p<pct>' · 'd1' / 'd-1' · 'e<n>'. Applied here after the normal sync, only when something changed. */

function adHex(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function adMix(a, b, t) {
  const A = adHex(a),
    Bc = adHex(b);
  return '#' + A.map((x, i) => Math.round(x + (Bc[i] - x) * clamp(t, 0, 1)).toString(16).padStart(2, '0')).join('');
}
function adColour(c, v) {
  if (v == null || !isFinite(v)) return null;
  const c1 = c.c1 || '#16a34a',
    c2 = c.c2 || '#f59e0b',
    c3 = c.c3 || '#dc2626',
    b1 = c.b1 != null && c.b1 !== '' ? +c.b1 : 60,
    b2 = c.b2 != null && c.b2 !== '' ? +c.b2 : 80;
  if (!c.cblend) return v < b1 ? c1 : v < b2 ? c2 : c3;
  const w = Math.max(1e-9, b2 - b1);
  if (v <= b1) return c1;
  if (v <= b2) return adMix(c1, c2, (v - b1) / w);
  return adMix(c2, c3, (v - b2) / w);
}
function adPartAnims(b, g) {
  const anims = g.getAnimations ? g.getAnimations({ subtree: true }) : [];
  const d = typeof apDef === 'function' ? apDef(b) : null;
  if (!d) return anims;
  return anims.filter(a => {
    const t = a.effect && a.effect.target,
      el = t && t.closest && t.closest('[data-adpart]');
    return el && apBeh(d, el.getAttribute('data-adpart')) === 'follow';
  });
}
function adDur(a) {
  try {
    const t = a.effect.getComputedTiming();
    return isFinite(t.duration) && t.duration > 0 ? t.duration : 1000;
  } catch (e) {
    return 1000;
  }
}
function adModeSync(b, g) {
  if (!b || !g) return;
  const c = adCfg(b);
  const live = MODE === 'monitor';
  /* colour */
  const S = AD_STATE[b.id];
  let col = null;
  if (live && c && c.mode === 'colour') {
    adDecide(b);
    col = S && (S.st === 'live' || S.st === 'held' || S.st === 'test') ? adColour(c, S.v) : null;
    if (S) S.col = col;
  }
  const ck = col ? col + '|' + (c.ctgt || 'tint') : '';
  if (g.dataset.adcol !== ck) {
    g.dataset.adcol = ck;
    let r = g.querySelector(':scope > .ad-tint');
    const tgt = c && c.ctgt ? c.ctgt : 'tint';
    if (col && (tgt === 'tint' || tgt === 'both')) {
      if (!r) {
        const { W, H } = dims(b);
        g.insertAdjacentHTML('beforeend', `<rect class="ad-tint" x="0" y="0" width="${W}" height="${H}" rx="4"/>`);
        r = g.querySelector(':scope > .ad-tint');
      }
      r.setAttribute('fill', col);
    } else if (r) r.remove();
    g.style.filter = col && (tgt === 'glow' || tgt === 'both') ? `drop-shadow(0 0 3px ${col}) drop-shadow(0 0 6px ${col})` : '';
  }
  /* direction on drawings that no other sync drives (library SVG drawings without parts) */
  const handled = g.dataset.adk != null || (typeof apDef === 'function' && apDef(b));
  if (!handled) {
    const dk = live && c && c.mode === 'dir' ? drvKey(b) : '';
    if ((g.dataset.adx || '') !== dk) {
      g.dataset.adx = dk;
      adApplyBuiltin(g, dk, c && c.base);
    }
  }
  /* reverse: an endless motion played backwards needs room before 0, or it finishes and disappears */
  if (live && c && c.mode === 'dir') {
    const dk = drvKey(b);
    if (dk === 'd-1')
      adPartAnims(b, g).forEach(a => {
        if (a.currentTime != null && a.currentTime < adDur(a) * 50) a.currentTime = adDur(a) * 100000;
      });
  }
  /* position / step: hold or play the motion */
  const key = live && c && ['pos', 'step'].includes(c.mode) ? drvKey(b) : '';
  const running = !live || effRun(b);
  const sig = key + '|' + running + '|' + (g.dataset.apsig || '') + '|' + (g.dataset.adk || '') + '|' + (g.dataset.apt || '');
  if (!key) {
    if (g.dataset.admk) {
      delete g.dataset.admk;
      // leaving Position / Step: give the motion back
      if (!(c && c.mode === 'dir')) adPartAnims(b, g).forEach(a => (a.updatePlaybackRate ? a.updatePlaybackRate(1) : (a.playbackRate = 1), a.play()));
      delete g.dataset.adk;
      delete g.dataset.apsig;
    }
    return;
  }
  if (g.dataset.admk === sig) return;
  const prevKey = (g.dataset.admk || '').split('|')[0];
  g.dataset.admk = sig;
  const anims = adPartAnims(b, g);
  if (key[0] === 'p') {
    const pct = +key.slice(1) / 100;
    anims.forEach(a => {
      a.pause();
      a.currentTime = pct * adDur(a) * 0.999;
    });
  } else if (key[0] === 'e') {
    const base = (+c.base > 0 ? +c.base : 2) * 1000;
    if (key !== prevKey && prevKey && prevKey[0] === 'e' && running) {
      anims.forEach(a => {
        a.updatePlaybackRate ? a.updatePlaybackRate(adDur(a) / base) : (a.playbackRate = adDur(a) / base);
        a.currentTime = 0;
        a.play();
      });
      clearTimeout(g._adStepT);
      g._adStepT = setTimeout(() => (anims.forEach(a => a.pause()), (g._adStepT = null)), base);
    } else if (key === prevKey || !prevKey) anims.forEach(a => a.playState === 'running' && !g._adStepT && a.pause());
  }
}
{
  const prev = smLvSync;
  smLvSync = function (b, g) {
    prev(b, g);
    try {
      adModeSync(b, g);
    } catch (e) {}
  };
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="adModesCss">
.ad-tint{mix-blend-mode:multiply;opacity:.45;pointer-events:none}
.ad-bands{display:flex;flex-direction:column;gap:5px;margin:6px 0}.ad-band{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted)}.ad-band input[type=color]{width:34px;height:24px;padding:0;border:1px solid var(--line);border-radius:5px;background:none}.ad-band input[type=number]{width:80px}
.ad-chk{display:flex;align-items:center;gap:6px;font-size:12.5px;margin:4px 0}
.ad-modes{flex-wrap:wrap}
</style>`,
);
