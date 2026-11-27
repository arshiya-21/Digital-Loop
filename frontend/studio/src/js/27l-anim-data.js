/*! SandMan Digital Loop Studio — 27l-anim-data.js
 *  v10.4 — Data-driven animation for every moving drawing, configured in Properties › Animation.
 *
 *  Default: a drawing runs at its own fixed pace. Connect a tag or a calculated value and it follows the data.
 *  Modes (what the value means for the drawing):
 *    Fixed            — the drawing's own pace (default)
 *    Production rate  — moulds / pours per hour. Step time = time at capacity × capacity ÷ actual
 *                       e.g. capacity 240/h, 5 s at capacity, actual 300/h → one step every 4.0 s
 *    Speed            — rpm, Hz, m/s, t/h … Speed = value ÷ rated value (e.g. 1,088 rpm ÷ 1,450 rpm = 75 %)
 *    Level            — fill height of a silo / hopper / bin: a % value, or a weight ÷ capacity
 *    On / Off         — moves at normal pace while the value is true / 1 / running, stands still when false / 0
 *  Source: a tag, or a calculated value from up to four tags (A–D) with a formula (no script is ever run).
 *  Stop rules: value ≤ 0, below a set % of rated, or an extra "stop when" condition (e.g. no pour for 120 s).
 *  No data / old data: Fixed pace (default), Stop, or Hold the last value for N minutes — with a grey "no data" dot.
 *  Equipment-type defaults: "Use for every <type>" stores the settings for the drawing type itself (DOC.animTypes);
 *  each piece of equipment uses them unless it has its own.
 *  Plant animation settings (All equipment drivers…): motion quality (Full / Balanced / Light) and lamp blinking. */

/* ---------- what each drawing can do ---------- */
const AD_ANIM_RE = /\b(spin|auger|lift|vib|ram|ramv|idx|index|tilt|fall|glow|beltd|sandflow|pourstream|pop|slide|blade|rotor)\b/;
const AD_BUILTIN = {};
function adBuiltinAnimated(type) {
  if (type in AD_BUILTIN) return AD_BUILTIN[type];
  let r = false;
  try {
    const E = EQ[type];
    if (E && !E.widget && !E.smlib && E.draw) r = AD_ANIM_RE.test(E.draw(E.w || 80, E.h || 80, {}, { id: '', type, props: {}, tags: [] }, ''));
  } catch (e) {}
  return (AD_BUILTIN[type] = r);
}
function adCanLevel(b) {
  const d = EQ[b.type] && EQ[b.type].def,
    id = d && typeof smlibIdOf === 'function' ? smlibIdOf(d) : null;
  return !!(id && typeof smlibHasLevel === 'function' && smlibHasLevel(id));
}
function adAnimatable(b) {
  const E = b && EQ[b.type];
  if (!E || E.widget || b.type === 'statusLamp') return false;
  return !!((E.def && E.def.anim2) || b.type === 'belt' || adBuiltinAnimated(b.type) || adCanLevel(b));
}
/* the kind of drawing → which modes make sense, and the suggested one */
function adKind(b) {
  if (adCanLevel(b)) return 'level';
  const c = typeof anClass === 'function' ? anClass(b) : null;
  if (c === 'mould') return 'rate';
  if (c === 'flow' || c === 'rotate') return 'speed';
  if (c === 'motion') return 'speed';
  return 'onoff';
}
const AD_MODES = {
  fixed: 'Fixed',
  rate: 'Production rate',
  speed: 'Speed',
  level: 'Level',
  onoff: 'On / Off',
  colour: 'Colour by value',
  pos: 'Position',
  dir: 'Direction',
  step: 'Step on event',
};
function adModesFor(b) {
  const k = adKind(b);
  const m = ['fixed', k];
  ['speed', 'onoff', 'rate'].forEach(x => !m.includes(x) && m.push(x));
  if (adCanLevel(b) && !m.includes('level')) m.push('level');
  ['colour', 'pos', 'dir', 'step'].forEach(x => m.push(x));
  return m;
}
const AD_UNIT_HINT = { rate: 'per hour', speed: 'rpm · Hz · m/s · t/h', level: '% or weight', onoff: 'true / 1 = running', colour: 'temperature, load, status …', pos: 'valve % open, angle, stroke …', dir: 'forward / reverse signal', step: 'a counter that goes up by one per event' };

/* ---------- settings: equipment → equipment type → none ---------- */
function adCfgOwn(b) {
  const d = b && b.props && b.props.drive;
  return d && d.mode && d.mode !== 'fixed' && (d.v10_4 || d.mode === 'rate' || d.mode === 'speed') ? d : null;
}
function adCfgType(b) {
  const t = b && DOC.animTypes && DOC.animTypes[b.type];
  return t && t.mode && t.mode !== 'fixed' ? t : null;
}
/* the settings in force for this equipment (a type default only applies when a source is set and bound) */
function adCfg(b) {
  if (!b || !b.props) return null;
  if (b.props.drive && b.props.drive.mode === 'fixed') return null;
  const own = adCfgOwn(b);
  if (own) return own;
  if (b.props.driveAuto === false) return null;
  const ty = adCfgType(b);
  if (!ty) return null;
  // a type default names a tag role, not a tag: use this equipment's own tag of the same kind when the type default has none
  const c = Object.assign({}, ty);
  if (c.src !== 'calc' && !(c.tag && REG[c.tag])) {
    const id = adGuessTag(b, c.mode);
    if (!id) return null;
    c.tag = id;
  }
  return c;
}
/* best tag of this equipment for a mode (used by type defaults and as the suggestion) */
function adGuessTag(b, mode) {
  const ids = (b.tags || []).map(t => t.id).filter(id => REG[id]);
  const role = id => (typeof anRole === 'function' ? anRole(id) : null);
  const pick = f => ids.find(f);
  if (mode === 'rate') return pick(id => role(id) === 'rate') || null;
  if (mode === 'speed') return pick(id => role(id) === 'speed') || pick(id => role(id) === 'load') || pick(id => role(id) === 'current') || null;
  if (mode === 'level') return pick(id => REG[id].role === 'level' || /LEVEL|LVL/i.test(id + ' ' + (REG[id].desc || ''))) || null;
  if (mode === 'onoff') return pick(id => role(id) === 'running') || null;
  return null;
}

/* ---------- calculated values: A–D + formula, parsed safely (no eval) ---------- */
const AD_FN = ['min', 'max', 'abs', 'round', 'if', 'avg', 'rate', 'sqrt'];
function adTok(s) {
  const out = [],
    re = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([A-Za-z_]\w*)|(>=|<=|==|!=|&&|\|\||[-+*/^(),<>!%]))/gy;
  let m,
    i = 0;
  s = String(s || '');
  while (i < s.length) {
    re.lastIndex = i;
    m = re.exec(s);
    if (!m) {
      if (/^\s*$/.test(s.slice(i))) break;
      throw new Error('Not understood near "' + s.slice(i, i + 8) + '"');
    }
    i = re.lastIndex;
    if (m[1]) out.push({ n: +m[1] });
    else if (m[2]) out.push({ id: m[2] });
    else out.push({ op: m[3] });
  }
  return out;
}
/* precedence climbing → a small tree */
function adParse(src) {
  const T = adTok(src);
  let p = 0;
  const peek = () => T[p],
    eat = o => {
      if (T[p] && T[p].op === o) return p++, true;
      return false;
    };
  const BIN = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%'], ['^']];
  function prim() {
    const t = T[p++];
    if (!t) throw new Error('Formula ends too early');
    if ('n' in t) return { n: t.n };
    if (t.op === '(') {
      const e = expr(0);
      if (!eat(')')) throw new Error('Missing )');
      return e;
    }
    if (t.op === '-') return { u: '-', a: prim() };
    if (t.op === '!') return { u: '!', a: prim() };
    if (t.id) {
      const k = t.id.toLowerCase();
      if (T[p] && T[p].op === '(') {
        if (!AD_FN.includes(k)) throw new Error('Unknown function ' + t.id);
        p++;
        const args = [];
        if (!eat(')')) {
          do args.push(expr(0));
          while (eat(','));
          if (!eat(')')) throw new Error('Missing ) after ' + t.id);
        }
        return { f: k, args };
      }
      if (/^[ABCD]$/i.test(t.id)) return { v: t.id.toUpperCase() };
      throw new Error('Use A, B, C or D for tags (found ' + t.id + ')');
    }
    throw new Error('Not understood: ' + (t.op || ''));
  }
  function expr(lv) {
    if (lv >= BIN.length) return prim();
    let a = expr(lv + 1);
    for (;;) {
      const t = peek();
      if (!t || !t.op || !BIN[lv].includes(t.op)) return a;
      p++;
      a = { b: t.op, a, c: expr(lv === BIN.length - 1 ? lv : lv + 1) };
    }
  }
  const e = expr(0);
  if (p < T.length) throw new Error('Extra text in the formula');
  return e;
}
const AD_PARSED = new Map();
function adCompile(src) {
  if (AD_PARSED.has(src)) return AD_PARSED.get(src);
  let r;
  try {
    r = { tree: adParse(src) };
  } catch (e) {
    r = { err: e.message };
  }
  AD_PARSED.set(src, r);
  return r;
}
/* history per block + variable, for avg(X, sec) and rate(X, sec) */
const AD_HIST = {};
function adHistPush(key, v) {
  const h = (AD_HIST[key] = AD_HIST[key] || []),
    now = Date.now();
  if (!h.length || now - h[h.length - 1].t >= 900) h.push({ t: now, v });
  while (h.length && now - h[0].t > 3700 * 1000) h.shift();
  return h;
}
function adEval(n, env) {
  if ('n' in n) return n.n;
  if (n.v) return env.vals[n.v];
  if (n.u) {
    const a = adEval(n.a, env);
    return a == null ? null : n.u === '-' ? -a : a ? 0 : 1;
  }
  if (n.b) {
    const a = adEval(n.a, env),
      c = adEval(n.c, env);
    if (n.b === '&&') return a && c ? 1 : 0;
    if (n.b === '||') return a || c ? 1 : 0;
    if (a == null || c == null) return null;
    switch (n.b) {
      case '+': return a + c;
      case '-': return a - c;
      case '*': return a * c;
      case '/': return c === 0 ? null : a / c;
      case '%': return c === 0 ? null : a % c;
      case '^': return Math.pow(a, c);
      case '<': return a < c ? 1 : 0;
      case '>': return a > c ? 1 : 0;
      case '<=': return a <= c ? 1 : 0;
      case '>=': return a >= c ? 1 : 0;
      case '==': return a === c ? 1 : 0;
      case '!=': return a !== c ? 1 : 0;
    }
  }
  if (n.f) {
    const A = n.args;
    if (n.f === 'if') {
      const c = adEval(A[0], env);
      return c == null ? null : adEval(c ? A[1] : A[2], env);
    }
    if (n.f === 'avg' || n.f === 'rate') {
      if (!A[0] || !A[0].v) return null;
      const sec = A[1] ? adEval(A[1], env) : 300,
        h = (AD_HIST[env.key + ':' + A[0].v] || []).filter(x => Date.now() - x.t <= sec * 1000 && x.v != null);
      if (n.f === 'avg') return h.length ? h.reduce((s, x) => s + x.v, 0) / h.length : null;
      if (h.length < 2) return null;
      const dt = (h[h.length - 1].t - h[0].t) / 3600000;
      return dt < 30 / 3600 ? null : (h[h.length - 1].v - h[0].v) / dt; // change per hour
    }
    const xs = A.map(a => adEval(a, env));
    if (xs.some(x => x == null)) return null;
    if (n.f === 'min') return Math.min(...xs);
    if (n.f === 'max') return Math.max(...xs);
    if (n.f === 'abs') return Math.abs(xs[0]);
    if (n.f === 'sqrt') return xs[0] < 0 ? null : Math.sqrt(xs[0]);
    if (n.f === 'round') return Math.round(xs[0] * Math.pow(10, xs[1] || 0)) / Math.pow(10, xs[1] || 0);
  }
  return null;
}

/* ---------- reading the value, with its age ---------- */
const AD_LAST = {}; // per tag: last value and when it was received (live adapters may also set VAL[id].ts)
function adTagNow(id) {
  if (!id || !REG[id]) return { v: null, age: Infinity };
  let v = val(id);
  const t = REG[id];
  if (tagIsText(t)) {
    const s = String(tagTxt(id)).trim().toLowerCase();
    v = typeof lampBool === 'function' ? (lampBool(s) === true ? 1 : lampBool(s) === false ? 0 : null) : null;
  }
  if (v == null || !isFinite(v)) return { v: null, age: Infinity };
  const V = VAL[id],
    now = Date.now();
  if (V && V.ts) return { v, age: (now - V.ts) / 1000 };
  const L = (AD_LAST[id] = AD_LAST[id] || { v, t: now });
  if (L.v !== v || RP == null) {
    L.v = v;
    L.t = now;
  }
  return { v, age: (now - L.t) / 1000 };
}
/* the value that drives the drawing: { v, age, err } */
function adValue(b, c) {
  if (c.src === 'calc') {
    const k = c.calc || {},
      cp = adCompile(k.expr || '');
    if (!k.expr) return { v: null, age: Infinity, err: 'Write the formula' };
    if (cp.err) return { v: null, age: Infinity, err: cp.err };
    const vals = {};
    let age = 0;
    for (const L of ['A', 'B', 'C', 'D']) {
      if (!k[L]) continue;
      const x = adTagNow(k[L]);
      vals[L] = x.v;
      age = Math.max(age, x.age);
      adHistPush(b.id + ':' + L, x.v);
    }
    const v = adEval(cp.tree, { vals, key: b.id });
    return { v: v == null || !isFinite(v) ? null : v, age: v == null ? Infinity : age };
  }
  return adTagNow(c.tag);
}

/* ---------- value → animation key ('' fixed · 'stop' · 'c<sec>' cycle · 's<factor>' speed) ---------- */
const AD_STATE = {}; // per block: { key, st, txt, held, t }
const AD_TEST = {}; // per block: test value from the slider
function adKeyFor(b, c, x) {
  const v = x.v;
  if (c.mode === 'onoff') return v ? '' : 'stop';
  if (c.mode === 'colour') return '';
  if (c.mode === 'pos') {
    const lo = c.pLo != null && c.pLo !== '' ? +c.pLo : 0,
      hi = c.pHi != null && c.pHi !== '' ? +c.pHi : 100;
    const pct = hi !== lo ? clamp(((v - lo) / (hi - lo)) * 100, 0, 100) : 0;
    return 'p' + Math.round(pct / 2) * 2; // 2 % steps
  }
  if (c.mode === 'dir') {
    const f = c.fwd != null && c.fwd !== '' ? +c.fwd : 1,
      r = c.rev != null && c.rev !== '' ? +c.rev : -1;
    return Math.abs(v - f) < 1e-9 ? 'd1' : Math.abs(v - r) < 1e-9 ? 'd-1' : 'stop';
  }
  if (c.mode === 'step') {
    const S = (AD_STATE[b.id] = AD_STATE[b.id] || {});
    if (S.ev0 == null || v < S.ev0) (S.ev0 = v), (S.evn = 0); // first value, or the counter was reset
    else if (v > S.ev0) (S.evn = (S.evn || 0) + 1), (S.ev0 = v), (S.evt = Date.now());
    return 'e' + (S.evn || 0);
  }
  if (c.mode === 'rate') {
    if (v <= 0) return 'stop';
    const cap = +c.cap > 0 ? +c.cap : null,
      base = +c.base > 0 ? +c.base : 5;
    let sec;
    if (cap) sec = (base * cap) / clamp(v, cap * 0.1, cap * 1.5);
    else sec = clamp(3600 / v, 0.5, 900);
    return 'c' + (sec < 10 ? Math.round(sec * 10) / 10 : Math.round(sec));
  }
  if (c.mode === 'speed') {
    const ref = +c.ref > 0 ? +c.ref : REG[c.tag] && REG[c.tag].typ > 0 ? REG[c.tag].typ : null;
    if (!ref) return '';
    const f = v / ref;
    if (v <= 0 || f * 100 < (+c.minPct >= 0 ? +c.minPct : 5)) return 'stop';
    return 's' + Math.round(clamp(f, 0.1, 1.5) * 10) / 10; // 10 % steps: the picture is not redrawn for noise
  }
  return '';
}
function adStopRule(c) {
  if (!c.stopTag || !REG[c.stopTag] || !c.stopOp) return false;
  const x = adTagNow(c.stopTag),
    lim = +c.stopVal;
  if (x.v == null) return false;
  return c.stopOp === '>' ? x.v > lim : c.stopOp === '<' ? x.v < lim : c.stopOp === '=' ? x.v === lim : false;
}
/* the full decision for one block: key + state + text for the panel */
function adDecide(b) {
  const c = adCfg(b);
  if (!c) return null;
  const S = (AD_STATE[b.id] = AD_STATE[b.id] || {});
  let x;
  if (AD_TEST[b.id] != null) x = { v: AD_TEST[b.id], age: 0, test: true };
  else x = adValue(b, c);
  const staleAfter = +c.stale > 0 ? +c.stale : 120;
  const nod = c.nodata || 'fixed';
  let key,
    st,
    v = x.v;
  if (x.v == null || x.age > staleAfter) {
    st = x.v == null ? 'nodata' : 'stale';
    if (nod === 'stop') key = 'stop';
    else if (nod === 'hold' && S.lastGood && Date.now() - S.lastGood.t < (+c.holdMin > 0 ? +c.holdMin : 5) * 60000) {
      key = S.lastGood.key;
      v = S.lastGood.v;
      st = 'held';
    } else key = '';
  } else {
    st = x.test ? 'test' : 'live';
    if (adStopRule(c)) {
      key = 'stop';
      st = 'stoprule';
    } else if (c.mode === 'level' || c.mode === 'colour') key = '';
    else key = adKeyFor(b, c, x);
    S.lastGood = { key, v, t: Date.now() };
  }
  /* hysteresis: keep the previous speed step unless the value moved past it by more than half a step */
  if (S.key && key && S.key[0] === 's' && key[0] === 's' && Math.abs(+S.key.slice(1) - +key.slice(1)) < 0.1 + 1e-9 && st === 'live') {
    const ref = +c.ref > 0 ? +c.ref : REG[c.tag] && REG[c.tag].typ;
    if (ref && Math.abs(v / ref - +S.key.slice(1)) < 0.07) key = S.key;
  }
  S.key = key;
  S.st = st;
  S.v = v;
  S.err = x.err;
  return S;
}

/* ---------- the drive key used by the drawings (replaces v9.83 / v10.0 decision) ---------- */
const adKeyPrev = drvKey;
drvKey = function (b) {
  if (MODE !== 'monitor' || !b) return '';
  const c = adCfg(b);
  if (c) {
    const S = adDecide(b);
    return S ? S.key || '' : '';
  }
  return ''; // v10.4: nothing connected → the drawing's own fixed pace
};
const adOfPrev = drvOf;
drvOf = function (b) {
  const c = adCfg(b);
  return c && c.src !== 'calc' && c.tag ? c : c ? { tag: null, mode: c.mode } : null;
};

/* ---------- level: fill height from the configured value ---------- */
if (typeof lvKey === 'function') {
  const lvPrev = lvKey;
  lvKey = function (b) {
    const k = lvPrev(b);
    const c = b && adCfg(b);
    // not `!k`: the base returns '' when the vessel's own level tag has no value — the tag chosen here must still win
    if (!c || c.mode !== 'level' || MODE !== 'monitor' || !adCanLevel(b)) return k;
    const S = adDecide(b);
    let pct = null;
    if (S && S.v != null && (S.st === 'live' || S.st === 'held' || S.st === 'test')) {
      if (c.lvAs === 'weight') pct = +c.cap > 0 ? (S.v / +c.cap) * 100 : null;
      else {
        const lo = isFinite(+c.lvLo) && c.lvLo !== '' && c.lvLo != null ? +c.lvLo : 0,
          hi = isFinite(+c.lvHi) && c.lvHi !== '' && c.lvHi != null ? +c.lvHi : 100;
        pct = hi > lo ? ((S.v - lo) / (hi - lo)) * 100 : null;
      }
    } else if (S && (c.nodata || 'fixed') === 'stop') pct = null;
    if (pct == null) return k; // no data: the drawing keeps its own level animation
    pct = clamp(pct, 0, 100);
    S.pct = pct;
    const flow = (k && k.split('~')[1]) || 'none';
    return `${Math.round(pct / 5) * 5}~${flow}`; // 5 % steps: fewer redraws of the picture
  };
}

/* ---------- applying the key to built-in drawings (CSS animations) and the "no data" dot ---------- */
function adKeyRate(key, base) {
  if (key && key[0] === 'd') return +key.slice(1);
  if (key && (key[0] === 'p' || key[0] === 'e')) return 1;
  return !key || key === 'stop' ? 1 : key[0] === 's' ? +key.slice(1) : key[0] === 'c' ? (+base > 0 ? +base : 5) / +key.slice(1) : 1;
}
function adApplyBuiltin(g, key, base) {
  if (!g || !g.getAnimations) return;
  const pause = key === 'stop',
    rate = adKeyRate(key, base);
  const anims = g.getAnimations({ subtree: true });
  for (const a of anims) {
    if (pause) {
      if (a.playState === 'running') a.pause();
    } else {
      if (a.playState === 'paused') a.play();
      if (Math.abs(a.playbackRate - rate) > 0.001) a.updatePlaybackRate ? a.updatePlaybackRate(rate) : (a.playbackRate = rate);
    }
  }
}
function adDot(g, b, S) {
  let d = g.querySelector(':scope > .ad-dot');
  const show = MODE === 'monitor' && S && (S.st === 'nodata' || S.st === 'stale' || S.st === 'held');
  if (!show) {
    if (d) d.remove();
    return;
  }
  if (!d) {
    const { W } = dims(b);
    g.insertAdjacentHTML('beforeend', `<g class="ad-dot" transform="translate(${W - 3},3)"><title>No live data — ${S.st === 'held' ? 'holding the last value' : 'fixed animation'}</title><circle r="5"/></g>`);
  }
}
if (typeof smLvSync === 'function') {
  const syncPrev = smLvSync;
  smLvSync = function (b, g) {
    syncPrev(b, g);
    if (!g || !b) return;
    const S = AD_STATE[b.id];
    const has = adCfg(b);
    const E = EQ[b.type];
    if (E && !E.smlib && !(E.def && E.def.shape === 'svg')) {
      // uploaded SVGs are driven part by part in 27m-anim-parts.js
      // v10.4 perf — getAnimations() forces a style recalculation: call it only when this drawing's key changes
      // (nothing connected = key '' = the drawing's own pace, nothing to do)
      const k = has ? drvKey(b) : '';
      const prev = g.dataset.adk == null ? '' : g.dataset.adk;
      if (prev !== k || (k && g.dataset.adn !== String(SIMT))) {
        g.dataset.adk = k;
        if (k || prev) adApplyBuiltin(g, k, has && has.base);
        if (k) g.dataset.adn = String(SIMT);
      }
    }
    adDot(g, b, has ? S : null);
  };
}
/* built-in moulding drawings time their stroke with cycleOf(): use the configured production rate there too */
if (typeof cycleOf === 'function') {
  const cyPrev = cycleOf;
  cycleOf = function (b) {
    const r = cyPrev(b);
    try {
      const m = r.m || b;
      const k = m && adCfg(m) ? drvKey(m) : '';
      if (k && k[0] === 'c') r.T = +k.slice(1) * 1000;
    } catch (e) {}
    return r;
  };
}

/* ---------- live text for the panel ---------- */
function adFmt(v, c) {
  const t = c.src !== 'calc' && REG[c.tag];
  return v == null ? 'no data' : (t ? fmtN(v, t.d) : fmtN(v, Math.abs(v) < 10 ? 2 : 1)) + ' ' + (c.unit || (t && t.unit) || '');
}
function adText(b) {
  const c = adCfg(b);
  if (!c) return 'Moves at its own fixed pace while the equipment runs.';
  if (MODE !== 'monitor') return 'Takes effect in Simulate / Publish';
  const S = adDecide(b) || {};
  if (S.err) return 'Formula: ' + S.err;
  const vt = adFmt(S.v, c),
    k = S.key || '';
  const pre = S.st === 'test' ? 'Test value ' : '';
  if (S.st === 'nodata' || S.st === 'stale')
    return `${S.st === 'stale' ? 'Data is old' : 'No data'} → ${(c.nodata || 'fixed') === 'stop' ? 'stands still' : 'fixed animation'} (grey dot shown)`;
  if (S.st === 'held') return `No new data → holding the last value ${vt}`;
  if (S.st === 'stoprule') return `Stop condition met → stands still`;
  if (c.mode === 'onoff') return `${pre}${vt} → ${k === 'stop' ? 'stopped' : 'running at normal pace'}`;
  if (c.mode === 'level') return `${pre}${vt} → filled to ${S.pct != null ? Math.round(S.pct) : '—'} %`;
  if (c.mode === 'colour') return `${pre}${vt} → colour ${S.col || '—'}`;
  if (c.mode === 'pos') return `${pre}${vt} → held at ${k ? k.slice(1) : '—'} % of its movement`;
  if (c.mode === 'dir') return `${pre}${vt} → ${k === 'd1' ? 'forward' : k === 'd-1' ? 'reverse' : 'stands still'}`;
  if (c.mode === 'step') return `${pre}${vt} → ${S.evn || 0} step${S.evn === 1 ? '' : 's'} since the page opened${S.evt ? ' · last ' + Math.round((Date.now() - S.evt) / 1000) + ' s ago' : ''}`;
  if (k === 'stop') return `${pre}${vt} → stands still`;
  if (c.mode === 'rate') {
    const pct = +c.cap > 0 && S.v != null ? ` = ${Math.round((S.v / +c.cap) * 100)} % of capacity` : '';
    return `${pre}${vt}${pct} → one step every ${k.slice(1)} s`;
  }
  if (c.mode === 'speed') return k ? `${pre}${vt} → ${Math.round(+k.slice(1) * 100)} % of rated speed` : 'Set the rated value';
  return '';
}
drvText = function (b) {
  return adText(b);
};

/* ---------- Properties › Animation ---------- */
function adTagOptions(sel, b, mode) {
  const own = (b.tags || []).map(t => t.id).filter(id => REG[id]);
  const all = Object.keys(REG).filter(id => !own.includes(id));
  const nice = id => esc((REG[id].short || REG[id].desc || id) + (REG[id].unit ? ' (' + REG[id].unit + ')' : '')) + ' — ' + esc(id);
  const o = id => `<option value="${esc(id)}" ${sel === id ? 'selected' : ''}>${nice(id)}</option>`;
  const g = mode ? adGuessTag(b, mode) : null;
  return `<option value="">Choose a tag…</option>${g ? `<optgroup label="Suggested">${o(g)}</optgroup>` : ''}${own.length ? `<optgroup label="${esc(b.name || 'This equipment')}">${own.filter(x => x !== g).map(o).join('')}</optgroup>` : ''}<optgroup label="All tags">${all.map(o).join('')}</optgroup>`;
}
function adSection(b) {
  const E = EQ[b.type],
    own = b.props.drive && b.props.drive.v10_4 ? b.props.drive : null,
    ty = adCfgType(b),
    legacy = !own && adCfgOwn(b),
    d = own || (legacy ? Object.assign({ src: 'tag' }, legacy) : null) || {},
    mode = (b.props.drive && b.props.drive.mode === 'fixed') || b.props.driveAuto === false ? 'fixed' : d.mode || (ty ? ty.mode : 'fixed'),
    usingType = !own && !legacy && ty && mode !== 'fixed';
  const c = usingType ? ty : d;
  const src = c.src || 'tag';
  const M = adModesFor(b).filter(m => m !== 'level' || adCanLevel(b));
  const kind = adKind(b);
  const sum = mode === 'fixed' ? 'fixed pace' : AD_MODES[mode].toLowerCase() + (usingType ? ' · type default' : '');
  const fld = (lab, html, hint) => `<div class="fld"><label>${lab}</label>${html}${hint ? `<div class="ad-hint">${hint}</div>` : ''}</div>`;
  const num = (k, v, ph, step = 'any') => `<input type="number" step="${step}" data-adf="${k}" value="${v != null && v !== '' ? esc(v) : ''}" placeholder="${esc(ph || '')}">`;
  let body = '';
  if (mode === 'fixed') {
    body = `<p class="lc2-note">The drawing moves at its own fixed pace while the equipment runs, and stops when it stops. Choose <b>${AD_MODES[kind]}</b> to drive it from a tag or a calculated value.</p>`;
  } else {
    const calc = c.calc || {};
    body += `<div class="ad-row"><span class="ad-lab">Value from</span><div class="lc2-seg ad-src">${[['tag', 'Tag'], ['ctag', 'Calculated tag']].map(([k, l]) => `<button type="button" data-ads="${k}" aria-pressed="${src === k || (k === 'ctag' && src === 'calc')}">${l}</button>`).join('')}</div></div>`;
    if (src === 'tag') body += fld('Tag', `<select data-adf="tag">${adTagOptions(c.tag, b, mode)}</select>`, AD_UNIT_HINT[mode]);
    else if (src === 'ctag' || !(calc && calc.expr)) {
      // v10.4 — one formula system: pick a calculated tag (Data › Calculated tags) or make one for this equipment
      const cts = Object.keys(REG).filter(id => REG[id].calc);
      const mine = cts.filter(id => (b.tags || []).some(t => t.id === id) || id.startsWith((b.name || '\u0000') + '.'));
      const others = cts.filter(id => !mine.includes(id));
      const opt = id => `<option value="${esc(id)}" ${c.tag === id ? 'selected' : ''}>${esc(String(REG[id].short || id).replace(/^ƒx\s*/, 'ƒx '))} — ${esc(tagTxt(id))}</option>`;
      const cur = c.tag && REG[c.tag] && REG[c.tag].calc ? REG[c.tag] : null;
      body += fld(
        'Calculated tag',
        `<select data-adf="tag"><option value="">Choose a calculated tag…</option>${mine.length ? `<optgroup label="${esc(b.name || 'This equipment')}">${mine.map(opt).join('')}</optgroup>` : ''}${others.length ? `<optgroup label="Other calculated tags">${others.map(opt).join('')}</optgroup>` : ''}</select>`,
      );
      if (cur) body += `<div class="ad-fx"><code>${esc(String(cur.addr || '').replace(/^ƒx\s*/, ''))}</code></div>`;
      body += `<div class="ad-fxb"><button type="button" class="lce-lk" id="adCtNew">＋ New calculated tag for ${esc(b.name || 'this equipment')}</button>${cur ? '<button type="button" class="lce-lk" id="adCtEdit">Edit formula</button>' : ''}</div>`;
      if (!cts.length) body += `<div class="ad-hint">Calculated tags are formulas over any tags of one or several equipment (Data › Calculated tags) — with errors shown as you type.</div>`;
    } else {
      body += `<div class="ad-hint" style="color:#b45309">Older formula (v10.4 preview). New formulas are made as calculated tags — choose "Calculated tag" above to switch.</div>`;
      body += `<div class="ad-vars">${['A', 'B', 'C', 'D'].map(L => `<div class="ad-var"><b>${L}</b><select data-adc="${L}">${adTagOptions(calc[L], b, null).replace('Choose a tag…', L === 'A' ? 'Choose a tag…' : '(not used)')}</select></div>`).join('')}</div>`;
      const cp = calc.expr ? adCompile(calc.expr) : null;
      body += fld('Formula', `<input class="mono" data-adc="expr" value="${esc(calc.expr || '')}" placeholder="e.g. A * 60   or   rate(A, 600)">${cp && cp.err ? `<div class="ad-bad">${esc(cp.err)}</div>` : ''}`, 'Use A–D, numbers, + − × ÷ ^, ( ), min, max, abs, round, if(c, a, b), avg(A, sec), rate(A, sec) = change per hour');
      body += fld('Result unit', `<input data-adf="unit" value="${esc(c.unit || '')}" placeholder="${mode === 'rate' ? 'moulds/h' : mode === 'level' ? '%' : 'rpm'}">`);
    }
    if (mode === 'rate')
      body += `<div class="ad-2">${fld('Capacity (per hour)', num('cap', c.cap, '240'))}${fld('Step time at capacity (s)', num('base', c.base, '5'))}</div><div class="ad-hint">Step time = ${esc(c.base || 5)} s × capacity ÷ actual. 150 % of capacity at most. Leave capacity empty to use 3,600 ÷ rate.</div>`;
    if (mode === 'speed')
      body += `<div class="ad-2">${fld('Rated value (100 %)', num('ref', c.ref, c.tag && REG[c.tag] && REG[c.tag].typ != null ? 'tag normal ' + REG[c.tag].typ : '1450'))}${fld('Stop below (% of rated)', num('minPct', c.minPct, '5'))}</div><div class="ad-hint">Speed = value ÷ rated value, 10–150 %. Use the actual speed, not a setpoint.</div>`;
    if (mode === 'level')
      body += `<div class="ad-row"><span class="ad-lab">Value is</span><div class="lc2-seg ad-lv">${[['pct', 'Level %'], ['weight', 'Weight']].map(([k, l]) => `<button type="button" data-adlv="${k}" aria-pressed="${(c.lvAs || 'pct') === k}">${l}</button>`).join('')}</div></div>${(c.lvAs || 'pct') === 'weight' ? fld('Capacity (same unit as the weight)', num('cap', c.cap, 'e.g. 40')) : `<div class="ad-2">${fld('Empty at', num('lvLo', c.lvLo, '0'))}${fld('Full at', num('lvHi', c.lvHi, '100'))}</div>`}`;
    if (mode === 'onoff') body += `<div class="ad-hint">Running when the value is true, 1, ON or RUN; stands still when false, 0, OFF or STOP.</div>`;
    if (mode === 'colour') {
      const col = (k, v) => `<input type="color" data-adf="${k}" value="${esc(c[k] || v)}">`;
      body += `<div class="ad-bands"><div class="ad-band">${col('c1', '#16a34a')}<span>below</span>${num('b1', c.b1, '60')}</div><div class="ad-band">${col('c2', '#f59e0b')}<span>below</span>${num('b2', c.b2, '80')}</div><div class="ad-band">${col('c3', '#dc2626')}<span>from ${esc(c.b2 != null ? c.b2 : 80)} up</span></div></div>
       <div class="ad-row"><span class="ad-lab">Show as</span><div class="lc2-seg">${[['tint', 'Tint'], ['glow', 'Glow'], ['both', 'Both']].map(([k, l]) => `<button type="button" data-adct="${k}" aria-pressed="${(c.ctgt || 'tint') === k}">${l}</button>`).join('')}</div></div>
       <label class="ad-chk"><input type="checkbox" data-adcb ${c.cblend ? 'checked' : ''}> Blend smoothly between the colours</label>
       <div class="ad-hint">The drawing keeps moving at its own pace; only its colour follows the value. Example: ladle temperature — green below 1,380, amber below 1,420, red above.</div>`;
    }
    if (mode === 'pos')
      body += `<div class="ad-2">${fld('Value at 0 %', num('pLo', c.pLo, '0'))}${fld('Value at 100 %', num('pHi', c.pHi, '100'))}</div><div class="ad-hint">The drawing's own movement is held at that point: 0 % = start of its motion, 100 % = end. Works for valves, gates, dampers, tilting ladles, cylinders — any part that is animated once from one end to the other.</div>`;
    if (mode === 'dir')
      body += `<div class="ad-2">${fld('Forward when value =', num('fwd', c.fwd, '1'))}${fld('Reverse when value =', num('rev', c.rev, '-1'))}</div><div class="ad-hint">Any other value → stands still. The drawing runs backwards for reverse.</div>`;
    if (mode === 'step') body += `<div class="ad-2">${fld('Time of one step (s)', num('base', c.base, '2'))}</div><div class="ad-hint">Each time the counter goes up, the drawing runs its motion once and waits for the next one. A counter that resets (e.g. at midnight) is handled.</div>`;
    if (!['onoff', 'level', 'colour', 'pos'].includes(mode))
      body += `<details class="ad-more"${c.stopTag ? ' open' : ''}><summary>Also stop when…</summary><div class="ad-stop"><select data-adf="stopTag">${adTagOptions(c.stopTag, b, null).replace('Choose a tag…', '(no extra condition)')}</select><select data-adf="stopOp">${['>', '<', '='].map(o => `<option ${c.stopOp === o ? 'selected' : ''}>${o}</option>`).join('')}</select>${num('stopVal', c.stopVal, '120')}</div><div class="ad-hint">Example: seconds since the last pour &gt; 120 → the line stands still at once.</div></details>`;
    body += `<div class="ad-row"><span class="ad-lab">No data</span><div class="lc2-seg ad-nd">${[['fixed', 'Fixed pace'], ['stop', 'Stop'], ['hold', 'Hold last']].map(([k, l]) => `<button type="button" data-adnd="${k}" aria-pressed="${(c.nodata || 'fixed') === k}">${l}</button>`).join('')}</div></div>`;
    body += `<div class="ad-2">${(c.nodata || 'fixed') === 'hold' ? fld('Hold for (min)', num('holdMin', c.holdMin, '5')) : ''}${fld('Data is old after (s)', num('stale', c.stale, '120'))}</div>`;
    body += `<div class="drv-now" id="drvNow">${esc(adText(b))}</div>`;
    const sl = mode === 'rate' ? [0, Math.max(10, (+c.cap || 240) * 1.5)] : mode === 'speed' ? [0, Math.max(1, (+c.ref || (c.tag && REG[c.tag] && REG[c.tag].typ) || 100) * 1.5)] : mode === 'level' ? [(c.lvAs || 'pct') === 'weight' ? 0 : +c.lvLo || 0, (c.lvAs || 'pct') === 'weight' ? +c.cap || 100 : c.lvHi != null && c.lvHi !== '' ? +c.lvHi : 100] : mode === 'colour' ? [0, Math.max(1, (c.b2 != null ? +c.b2 : 80) * 1.4)] : mode === 'pos' ? [c.pLo != null && c.pLo !== '' ? +c.pLo : 0, c.pHi != null && c.pHi !== '' ? +c.pHi : 100] : mode === 'dir' ? [-1, 1] : mode === 'step' ? [0, 50] : [0, 1];
    const tv = AD_TEST[b.id];
    body += `<div class="ad-test"><label><input type="checkbox" id="adTestOn" ${tv != null ? 'checked' : ''}> Test value</label><input type="range" id="adTest" min="${sl[0]}" max="${sl[1]}" step="${mode === 'onoff' || mode === 'dir' || mode === 'step' ? 1 : (sl[1] - sl[0]) / 100}" value="${tv != null ? tv : sl[1] / 1.5}" ${tv == null ? 'disabled' : ''}><span class="mono" id="adTestV">${tv != null ? fmtN(tv, 1) : ''}</span></div>`;
    if (usingType) body += `<p class="lc2-note">Uses the default for every <b>${esc(E.n || b.type)}</b>. Change any field to give this one its own settings.</p>`;
  }
  return `<section class="ix-sec drv ad" id="drvSec"><h4>Animation <span class="ix-sum">${esc(sum)}</span></h4>
   <div class="lc2-seg drv-m ad-modes">${M.map(m => `<button type="button" data-adm="${m}" aria-pressed="${mode === m}" title="${esc(AD_UNIT_HINT[m] || '')}">${AD_MODES[m]}</button>`).join('')}</div>
   ${body}
   <div class="ad-foot">${mode !== 'fixed' && !usingType ? `<button type="button" class="lce-lk" id="adType">Use for every ${esc(E.n || b.type)}</button>` : ''}${ty ? `<button type="button" class="lce-lk" id="adTypeClr">Clear type default</button>` : ''}<button type="button" class="lce-lk" id="anAll">All equipment drivers…</button></div></section>`;
}
drvSection = function (b) {
  return adSection(b);
};
function adEdit(b, fn) {
  pushUndo();
  const ty = adCfgType(b);
  let d = b.props.drive && b.props.drive.v10_4 ? b.props.drive : null;
  if (!d) {
    const lg = adCfgOwn(b);
    d = Object.assign({ src: 'tag' }, ty || {}, lg || {}, { v10_4: 1 });
    if (lg && lg.mode === 'rate' && d.cap == null) d.cap = null;
  }
  fn(d);
  b.props.drive = d;
  delete b.props.driveAuto;
  if (d.mode === 'fixed') b.props.drive = { mode: 'fixed' };
  changed();
  renderProps();
}
{
  const _rp = renderProps;
  renderProps = function () {
    _rp();
    try {
      const b = SEL && SEL.t === 'b' ? B(SEL.id) : null,
        P = document.getElementById('props');
      if (!b || !P || PTAB !== 'eq' || RP || !adAnimatable(b)) return;
      let S = P.querySelector('#drvSec');
      if (S && !S.classList.contains('ad')) S.remove(), (S = null);
      if (!S) {
        const at = P.querySelector('#lc2') || [...P.querySelectorAll('.ix-sec')].find(s => /Readings/.test(s.querySelector('h4')?.textContent || ''));
        at ? at.insertAdjacentHTML('beforebegin', adSection(b)) : P.insertAdjacentHTML('beforeend', adSection(b));
        S = P.querySelector('#drvSec');
      }
      S.querySelectorAll('[data-adm]').forEach(x => (x.onclick = () => adEdit(b, d => {
        d.mode = x.dataset.adm;
        if (d.mode !== 'fixed' && !d.tag && d.src !== 'calc') d.tag = adGuessTag(b, d.mode) || null;
      })));
      S.querySelectorAll('[data-ads]').forEach(x => (x.onclick = () => adEdit(b, d => {
        d.src = x.dataset.ads;
        if (d.src === 'ctag' && d.tag && !(REG[d.tag] && REG[d.tag].calc)) d.tag = null;
        if (d.src === 'ctag') delete d.calc;
      })));
      const ctn = S.querySelector('#adCtNew'),
        cte = S.querySelector('#adCtEdit');
      if (ctn && typeof ctOpen === 'function')
        ctn.onclick = () => {
          window.CT_AFTER = id => adEdit(b, d => ((d.src = 'ctag'), (d.tag = id), delete d.calc));
          ctOpen(null, { equip: [b.id], mode: 'one' });
        };
      if (cte && typeof ctOpen === 'function')
        cte.onclick = () => {
          const c0 = b.props.drive || {};
          window.CT_AFTER = null;
          if (REG[c0.tag]) ctOpen(REG[c0.tag].calc);
        };
      S.querySelectorAll('[data-adnd]').forEach(x => (x.onclick = () => adEdit(b, d => (d.nodata = x.dataset.adnd))));
      S.querySelectorAll('[data-adlv]').forEach(x => (x.onclick = () => adEdit(b, d => (d.lvAs = x.dataset.adlv))));
      S.querySelectorAll('[data-adct]').forEach(x => (x.onclick = () => adEdit(b, d => (d.ctgt = x.dataset.adct))));
      S.querySelectorAll('[data-adcb]').forEach(x => (x.onchange = () => adEdit(b, d => (d.cblend = x.checked))));
      S.querySelectorAll('[data-adf]').forEach(x => (x.onchange = () => adEdit(b, d => {
        const k = x.dataset.adf;
        d[k] = x.type === 'number' ? (x.value === '' ? null : +x.value) : x.value || null;
      })));
      S.querySelectorAll('[data-adc]').forEach(x => (x.onchange = () => adEdit(b, d => {
        d.calc = Object.assign({}, d.calc || {});
        d.calc[x.dataset.adc] = x.value || null;
      })));
      const tOn = S.querySelector('#adTestOn'),
        tR = S.querySelector('#adTest');
      if (tOn)
        tOn.onchange = () => {
          if (tOn.checked) AD_TEST[b.id] = +tR.value;
          else delete AD_TEST[b.id];
          renderProps();
          liveCanvas();
        };
      if (tR)
        tR.oninput = () => {
          AD_TEST[b.id] = +tR.value;
          const v = S.querySelector('#adTestV');
          if (v) v.textContent = fmtN(+tR.value, 1);
          liveCanvas();
          const n = document.getElementById('drvNow');
          if (n) n.textContent = adText(b);
        };
      const ty = S.querySelector('#adType');
      if (ty)
        ty.onclick = () => {
          pushUndo();
          const d = Object.assign({}, b.props.drive);
          delete d.v10_4;
          if (d.src !== 'calc') d.tag = null; // the type default names the kind of tag; each equipment uses its own
          DOC.animTypes = DOC.animTypes || {};
          DOC.animTypes[b.type] = d;
          changed();
          renderProps();
          toast(`Default saved for every ${EQ[b.type].n || b.type}`);
        };
      const tc = S.querySelector('#adTypeClr');
      if (tc)
        tc.onclick = () => {
          pushUndo();
          delete DOC.animTypes[b.type];
          changed();
          renderProps();
        };
      const all = S.querySelector('#anAll');
      if (all) all.onclick = adList;
    } catch (e) {
      console.error(e);
    }
  };
}
/* leaving the equipment ends its test */
setInterval(() => {
  const b = SEL && SEL.t === 'b' ? SEL.id : null;
  for (const id in AD_TEST) if (id !== b) delete AD_TEST[id];
  const n = document.getElementById('drvNow'),
    bb = b && B(b);
  if (n && bb) n.textContent = adText(bb);
}, 1000);

/* ---------- plant animation settings + list of every moving equipment ---------- */
function adPlant() {
  return Object.assign({ motion: 'balanced', lampBlink: 'alarm' }, (DOC.plant && DOC.plant.anim) || {});
}
const AD_DECOR = /valve|beacon|plc|radar|sensor|transmitter|gauge|cyclone|panel|scada|hmi|light|analy[sz]er|meter/i;
function adMotionAllowed(b) {
  const m = adPlant().motion;
  if (m === 'full') return true;
  const c = typeof anClass === 'function' ? anClass(b) : null;
  const driven = !!adCfg(b);
  if (m === 'light') return driven || c === 'mould' || c === 'flow';
  // balanced: vessels (silos, hoppers, bins) show their level as a still picture — the inner sand-flow animation was the
  // most expensive drawing on the plant; decorative motion (valves, beacons, PLC lights …) stands still
  if (adCanLevel(b)) { const k = adCfg(b); return !!(k && k.mode !== 'level'); }
  return driven || !!c || !AD_DECOR.test(b.type + ' ' + (EQ[b.type].n || ''));
}
if (typeof eqAnimApply === 'function') {
  const eqPrev = eqAnimApply;
  eqAnimApply = function () {
    eqPrev();
    document.querySelectorAll('#Lblocks .blk .smw.has-run').forEach(w => {
      const g = w.closest('.blk'),
        b = g && B(g.dataset.b);
      if (b && !adMotionAllowed(b)) w.classList.add('noanim');
    });
  };
}
/* lamps: blink only for red / amber (alarm) colours unless the plant asks for every blink */
if (typeof lampEval === 'function') {
  const lePrev = lampEval;
  lampEval = function (cfg, raw) {
    const r = lePrev(cfg, raw);
    if (r && r.b && adPlant().lampBlink === 'alarm' && !/^#(ef4444|f59e0b|dc2626|d97706|b91c1c|ea580c)$/i.test(r.c || '')) r.b = false;
    return r;
  };
}
/* lamps: exactly 1 / 0 for numbers (2 is not "true"; it falls to the "no rule matched" colour) */
if (typeof lampBool === 'function') {
  lampBool = function (x) {
    if (typeof x === 'number') return x === 1 ? true : x === 0 ? false : null;
    const s = String(x).trim().toLowerCase();
    if (['true', '1', '1.0', 'on', 'yes', 'y', 'run', 'running', 'ok', 'high'].includes(s)) return true;
    if (['false', '0', '0.0', 'off', 'no', 'n', 'stop', 'stopped', 'low'].includes(s)) return false;
    const n = parseFloat(s);
    return n === 1 ? true : n === 0 ? false : null;
  };
}
function adDriverTxt(b) {
  if ((b.props.drive && b.props.drive.mode === 'fixed') || b.props.driveAuto === false) return 'Fixed';
  if (adCfgOwn(b)) return AD_MODES[adCfgOwn(b).mode] + (adCfgOwn(b).src === 'calc' ? ' · calculated' : ' · tag');
  if (adCfgType(b)) return adCfg(b) ? AD_MODES[adCfgType(b).mode] + ' · type default' : 'Type default · no matching tag';
  return 'Fixed';
}
function adList() {
  const rows = DOC.blocks.filter(adAnimatable).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  const P = adPlant();
  const n = { live: 0, fixed: 0, nodata: 0 };
  rows.forEach(b => {
    const S = adCfg(b) ? adDecide(b) : null;
    !S ? n.fixed++ : S.st === 'live' || S.st === 'test' || S.st === 'stoprule' ? n.live++ : n.nodata++;
  });
  const seg = (k, opts) => `<div class="lc2-seg">${opts.map(([v, l]) => `<button type="button" data-adp="${k}:${v}" aria-pressed="${P[k] === v}">${l}</button>`).join('')}</div>`;
  openModal(
    `<h3>Animation drivers</h3><div class="note">Every drawing that moves, and what drives it. Nothing connected = its own fixed pace.</div>
   <div class="ad-plant"><div><b>Motion</b>${seg('motion', [['full', 'Full'], ['balanced', 'Balanced'], ['light', 'Light']])}<span class="ad-hint">Balanced stops decorative motion (valves, beacons, PLC lights). Light moves only data-driven equipment, moulding lines and belts.</span></div>
   <div><b>Lamps blink</b>${seg('lampBlink', [['alarm', 'Alarm colours only'], ['all', 'As set on each lamp']])}</div></div>
   <div class="an-sum"><span><b>${n.live}</b> follow live data</span><span><b>${n.nodata}</b> connected, no data now</span><span><b>${n.fixed}</b> fixed pace</span></div>
   <div class="tbl-wrap" style="max-height:52vh;overflow:auto"><table class="an-t"><thead><tr><th>Equipment</th><th>Drawing</th><th>Driver</th><th>Now</th><th></th></tr></thead><tbody>${rows
     .map(b => `<tr><td><b>${esc(b.name || '')}</b></td><td>${esc(EQ[b.type].n || b.type)}</td><td>${esc(adDriverTxt(b))}</td><td class="an-now" data-anb="${b.id}">${esc(adText(b))}</td><td><button type="button" class="ib" data-ano="${b.id}">Open</button></td></tr>`)
     .join('')}</tbody></table></div>
   <div class="mact"><button class="ib pri" id="anClose">Close</button></div>`,
    'wide',
  );
  $('#anClose').onclick = closeModal;
  $$('#mbox [data-ano]').forEach(x => (x.onclick = () => (closeModal(), select({ t: 'b', id: x.dataset.ano }), (PTAB = 'eq'), renderProps())));
  $$('#mbox [data-adp]').forEach(
    x =>
      (x.onclick = () => {
        const [k, v] = x.dataset.adp.split(':');
        DOC.plant = DOC.plant || {};
        DOC.plant.anim = Object.assign(adPlant(), { [k]: v });
        changed();
        if (typeof eqAnimRank === 'function') eqAnimRank();
        if (typeof renderCanvas === 'function') renderCanvas();
        adList();
      }),
  );
  const tick = setInterval(() => {
    if (!$('#modal').classList.contains('on') || !$('#mbox .an-t')) return clearInterval(tick);
    $$('#mbox [data-anb]').forEach(td => {
      const b = B(td.dataset.anb);
      if (b) td.textContent = adText(b);
    });
  }, 1000);
}
if (typeof anList === 'function') anList = adList;

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
.drv.ad .ad-modes{display:flex;flex-wrap:wrap;gap:0;margin:4px 0 10px}.drv.ad .ad-modes button{flex:1 1 auto;white-space:nowrap;font-size:12px;padding:5px 8px}
.drv.ad .ad-row{display:flex;align-items:center;gap:8px;margin:6px 0}.drv.ad .ad-lab{font:600 12px var(--sans);color:var(--muted);min-width:66px}
.drv.ad .ad-row .lc2-seg{flex:1;display:grid;grid-auto-flow:column;grid-auto-columns:1fr}.drv.ad .ad-row .lc2-seg button{white-space:nowrap;font-size:12px}
.drv.ad .fld{margin:6px 0}.drv.ad .fld label{display:block;font:600 12px var(--sans);color:var(--muted);margin-bottom:3px}
.drv.ad .fld select,.drv.ad .fld input{width:100%;box-sizing:border-box}
.drv.ad .ad-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.drv.ad .ad-hint,.ad-plant .ad-hint{font-size:11.5px;color:var(--muted);line-height:1.35;margin-top:3px}
.drv.ad .ad-bad{font-size:12px;color:#b42318;margin-top:3px}
.drv.ad .ad-fx{margin:2px 0 6px;padding:6px 8px;border-radius:6px;background:#f5f3ff;border:1px solid #ddd6fe;font:12px/1.4 var(--mono);color:#4c1d95;word-break:break-word}.drv.ad .ad-fxb{display:flex;flex-wrap:wrap;gap:4px 14px;margin:2px 0 6px}.drv.ad .ad-fxb .lce-lk{border:0;background:none;color:#6d28d9;font:600 12.5px var(--sans);cursor:pointer;padding:0}
.drv.ad .ad-vars{display:grid;grid-template-columns:1fr;gap:6px;margin:6px 0}.drv.ad .ad-var{display:flex;align-items:center;gap:6px}.drv.ad .ad-var b{font:700 12px var(--mono);width:12px}.drv.ad .ad-var select{flex:1;min-width:0}
.drv.ad .ad-more{margin:6px 0;font-size:12.5px}.drv.ad .ad-more summary{cursor:pointer;color:#1f6feb;font-weight:600}
.drv.ad .ad-stop{display:grid;grid-template-columns:1fr 52px 70px;gap:6px;margin-top:6px}
.drv.ad .drv-now{margin:8px 0 6px;padding:7px 9px;border-radius:6px;background:var(--bg2,#f3f5f8);font:600 12.5px var(--sans);color:var(--text)}
.drv.ad .ad-test{display:flex;align-items:center;gap:8px;font-size:12.5px;margin:4px 0 8px}.drv.ad .ad-test input[type=range]{flex:1}.drv.ad .ad-test .mono{min-width:46px;text-align:right}
.drv.ad .ad-foot{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px}.drv.ad .ad-foot .lce-lk{border:0;background:none;color:#1f6feb;font:600 12.5px var(--sans);cursor:pointer;padding:0}
.ad-plant{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0;padding:10px;border:1px solid var(--line);border-radius:8px}.ad-plant b{display:block;font-size:12.5px;margin-bottom:4px}.ad-plant .lc2-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr}
#cv .slamp.blink .sl-glow{animation:none}
#cv .ad-dot circle{fill:#9aa3ad;stroke:#fff;stroke-width:1.5}
</style>`,
);
