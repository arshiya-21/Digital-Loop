/*! SandMan Digital Loop Studio — 27n-calc-tags.js
 *  v10.4 — Calculated tags (like Tableau calculated fields / Power BI measures).
 *  A calculated tag is a formula over existing tags of one or several equipment. It becomes a tag of its own: shown on
 *  the drawing (ƒx label), in Parameters monitoring, charts, replay, as an animation driver and in Engineered alerts.
 *
 *  Formula language (no script is ever run — parsed and evaluated here):
 *    [Equipment].[Tag]      a tag of a selected equipment, e.g. [DISA-1].[Moisture]  (Tag = its short name, description
 *                           or ID suffix)        [this].[Tag]  = the equipment the tag is made for ("each equipment")
 *                           [*].[Tag]  = that tag on every selected equipment (a group, for AVGOF / MAXOF / COUNTIF …)
 *    LET name = expr;       named steps, used further down        // comment to the end of the line
 *    + - * / ^ %  ( )  < > <= >= = <>  AND OR NOT  numbers  time windows 30s 5m 1h 1d
 *    Maths    ABS SQRT EXP LN LOG10 LOG(x,b) POW(x,y) ROUND(x,n) CLAMP(x,lo,hi) SIGN SIN COS TAN ASIN ACOS ATAN ATAN2
 *             PI E SIGMA_SB (Stefan–Boltzmann 5.670374e-8)   MIN(a,b,…) MAX(a,b,…) IF(c,a,b)
 *    Time     AVG(X,5m) SD(X,1h) MIN(X,5m) MAX(X,5m) SUM(X,1h) COUNT(X,1h) RATE(X,10m) (change per hour) PREV(X)
 *             SINCE(condition) (seconds since it was last true)
 *    Groups   AVGOF(G) SUMOF(G) MINOF(G) MAXOF(G) COUNTOF(G) COUNTIF(G > 3.3) — G = [*].[Tag] or a list (a, b, c)
 *  Errors are shown with line and column while typing, with a one-click fix where one is clear.
 *  Data: DOC.calc = [{ id, name, unit, d, equip:[block ids], mode:'one'|'several'|'each', expr, lo, opt, hi, show }]
 *  'each' makes one tag per selected equipment: <equipment>.<ID>.  Values are recalculated every second. */

const CT_FUNCS = {
  maths: ['ABS', 'SQRT', 'EXP', 'LN', 'LOG10', 'LOG', 'POW', 'ROUND', 'CLAMP', 'SIGN', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'ATAN2', 'MIN', 'MAX', 'IF'],
  time: ['AVG', 'SD', 'SUM', 'COUNT', 'RATE', 'PREV', 'SINCE'],
  group: ['AVGOF', 'SUMOF', 'MINOF', 'MAXOF', 'COUNTOF', 'COUNTIF'],
};
const CT_ALL = new Set([...CT_FUNCS.maths, ...CT_FUNCS.time, ...CT_FUNCS.group]);
const CT_CONST = { PI: Math.PI, E: Math.E, SIGMA_SB: 5.670374e-8 };
const CT_HELP = {
  ABS: ['ABS(x)', 'absolute value'], SQRT: ['SQRT(x)', 'square root'], EXP: ['EXP(x)', 'e to the power x'], LN: ['LN(x)', 'natural log'],
  LOG10: ['LOG10(x)', 'log base 10'], LOG: ['LOG(x, base)', 'log to a base'], POW: ['POW(x, y)', 'x to the power y (also x ^ y)'],
  ROUND: ['ROUND(x, n)', 'round to n decimals'], CLAMP: ['CLAMP(x, lo, hi)', 'keep x between lo and hi'], SIGN: ['SIGN(x)', '−1, 0 or 1'],
  SIN: ['SIN(rad)', 'sine'], COS: ['COS(rad)', 'cosine'], TAN: ['TAN(rad)', 'tangent'], ASIN: ['ASIN(x)', 'arc sine'], ACOS: ['ACOS(x)', 'arc cosine'],
  ATAN: ['ATAN(x)', 'arc tangent'], ATAN2: ['ATAN2(y, x)', 'angle of (x, y)'], MIN: ['MIN(a, b, …) · MIN(X, 5m)', 'smallest value · lowest in a window'],
  MAX: ['MAX(a, b, …) · MAX(X, 5m)', 'largest value · highest in a window'], IF: ['IF(condition, a, b)', 'a when the condition is true, else b'],
  AVG: ['AVG(X, 5m)', 'average over the last 5 minutes'], SD: ['SD(X, 1h)', 'standard deviation (σ) in a window'], SUM: ['SUM(X, 1h)', 'total of the readings in a window'],
  COUNT: ['COUNT(X, 1h)', 'number of readings in a window'], RATE: ['RATE(X, 10m)', 'change per hour over the window'], PREV: ['PREV(X)', 'the previous value'],
  SINCE: ['SINCE(condition)', 'seconds since the condition was last true'], AVGOF: ['AVGOF([*].[Tag])', 'average across the selected equipment'],
  SUMOF: ['SUMOF([*].[Tag])', 'total across equipment'], MINOF: ['MINOF([*].[Tag])', 'lowest across equipment'], MAXOF: ['MAXOF([*].[Tag])', 'highest across equipment'],
  COUNTOF: ['COUNTOF([*].[Tag])', 'how many equipment have a value'], COUNTIF: ['COUNTIF([*].[Tag] > 3.3)', 'how many equipment meet a condition'],
};
const CT_EXAMPLES = [
  ['Cooler ΔT (5-min averages)', 'AVG([CD-1].[Inlet temp], 5m) - AVG([CD-1].[Outlet temp], 5m)'],
  ['LMTD of a counter-flow cooler', '// log-mean temperature difference\nLET dT1 = [CD-1].[Inlet temp] - [CD-1].[Water out];\nLET dT2 = [CD-1].[Outlet temp] - [CD-1].[Water in];\nIF(ABS(dT1 - dT2) < 0.01, dT1, (dT1 - dT2) / LN(dT1 / dT2))'],
  ['Heat removed (kW)', '// Q = m · Cp · ΔT, sand Cp ≈ 0.84 kJ/kg·K, flow in t/h\nLET m = [P-10].[Belt load] * 1000 / 3600;\nm * 0.84 * ([CD-1].[Inlet temp] - [CD-1].[Outlet temp])'],
  ['Moisture spread across lines', 'MAXOF([*].[Moisture]) - MINOF([*].[Moisture])'],
  ['Line vs average of all lines', 'AVG([this].[Moisture], 5m) - AVGOF([*].[Moisture])'],
  ['Lines above moisture limit', 'COUNTIF([*].[Moisture] > 3.3)'],
  ['Energy per tonne', 'SUM([MX-1].[Rotor power], 1h) / 3600 / MAX(SUM([P-10].[Belt load], 1h) / 3600, 0.001)'],
];

/* ---------- tokens (with positions for line / column errors) ---------- */
function ctLex(src) {
  const T = [];
  let i = 0;
  const s = String(src || '');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    const st = i;
    if (c === '[') {
      // [Equip].[Tag]  or  [Tag]
      const a = s.indexOf(']', i);
      if (a < 0) throw ctErr('missing ] — a tag name must end with ]', st, s.length - st, s);
      const p1 = s.slice(i + 1, a).trim();
      i = a + 1;
      if (s[i] === '.' && s[i + 1] === '[') {
        const b = s.indexOf(']', i + 2);
        if (b < 0) throw ctErr('missing ] after the tag name', i, s.length - i, s);
        const p2 = s.slice(i + 2, b).trim();
        i = b + 1;
        T.push({ k: 'ref', eq: p1, tag: p2, p: st, e: i });
      } else T.push({ k: 'ref', eq: null, tag: p1, p: st, e: i });
      continue;
    }
    const num = /^(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)(ms|s|m|h|d)?(?![\w])/i.exec(s.slice(i));
    if (num) {
      const u = (num[2] || '').toLowerCase();
      const v = +num[1] * ({ ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 }[u] || 1);
      T.push({ k: 'num', v, time: !!u, p: st, e: i + num[0].length });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_]\w*/.exec(s.slice(i));
    if (id) {
      const w = id[0],
        W = w.toUpperCase();
      i += w.length;
      if (W === 'AND' || W === 'OR' || W === 'NOT') T.push({ k: 'op', v: W === 'AND' ? '&&' : W === 'OR' ? '||' : '!', p: st, e: i });
      else if (W === 'LET') T.push({ k: 'let', p: st, e: i });
      else if (W === 'TRUE' || W === 'FALSE') T.push({ k: 'num', v: W === 'TRUE' ? 1 : 0, p: st, e: i });
      else T.push({ k: 'id', v: w, p: st, e: i });
      continue;
    }
    const op = /^(<=|>=|<>|!=|==|&&|\|\||[-+*/^%(),;=<>!])/.exec(s.slice(i));
    if (op) {
      let v = op[0];
      if (v === '!=' ) v = '<>';
      if (v === '==') v = '=';
      T.push({ k: 'op', v, p: st, e: i + op[0].length });
      i += op[0].length;
      continue;
    }
    throw ctErr(`"${c}" is not understood here`, st, 1, s);
  }
  return T;
}
function ctLC(s, p) {
  const a = String(s).slice(0, p).split('\n');
  return { line: a.length, col: a[a.length - 1].length + 1 };
}
function ctErr(msg, p, len, src, fix) {
  const e = new Error(msg);
  Object.assign(e, ctLC(src, p), { p, len: Math.max(1, len || 1), fix });
  return e;
}

/* ---------- parser → tree ---------- */
function ctParse(src) {
  const T = ctLex(src);
  let i = 0;
  const pk = () => T[i],
    isop = v => T[i] && T[i].k === 'op' && T[i].v === v,
    end = () => (T.length ? T[T.length - 1].e : 0);
  const need = (v, what, open) => {
    if (isop(v)) return T[i++];
    const at = T[i] ? T[i].p : end();
    throw ctErr(`missing ${v}${what ? ' ' + what : ''}`, at, 1, src, v === ')' && open ? { kind: 'insert', at, text: ')' } : null);
  };
  const LV = [['||'], ['&&'], ['=', '<>'], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
  function prim() {
    const t = T[i];
    if (!t) throw ctErr('the formula ends too early', end(), 1, src);
    i++;
    if (t.k === 'num') return { n: t.v, time: t.time, p: t.p, e: t.e };
    if (t.k === 'ref') return { ref: t, p: t.p, e: t.e };
    if (t.k === 'op' && t.v === '(') {
      const first = expr(0);
      if (isop(',')) {
        const items = [first];
        while (isop(',')) i++, items.push(expr(0));
        need(')', '', t);
        return { list: items, p: t.p, e: T[i - 1].e };
      }
      need(')', `for the ( at line ${ctLC(src, t.p).line}, col ${ctLC(src, t.p).col}`, t);
      return first;
    }
    if (t.k === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) {
      const a = unary();
      return t.v === '+' ? a : { u: t.v, a, p: t.p, e: a.e };
    }
    if (t.k === 'id') {
      const W = t.v.toUpperCase();
      if (isop('(')) {
        if (!CT_ALL.has(W)) {
          const sug = ctNear(W, [...CT_ALL]);
          throw ctErr(`unknown function ${t.v}${sug ? ` — did you mean ${sug}?` : ''}`, t.p, t.v.length, src, sug ? { kind: 'replace', p: t.p, len: t.v.length, text: sug } : null);
        }
        const o = T[i++];
        const args = [];
        if (!isop(')')) {
          do args.push(expr(0));
          while (isop(',') && ++i);
        }
        need(')', `to close ${W}(`, o);
        return { f: W, args, p: t.p, e: T[i - 1].e };
      }
      if (W in CT_CONST) return { n: CT_CONST[W], p: t.p, e: t.e };
      return { v: t.v, p: t.p, e: t.e };
    }
    throw ctErr(`"${t.v || t.k}" is not expected here`, t.p, (t.e || t.p + 1) - t.p, src);
  }
  function unary() {
    let a = prim();
    while (isop('^')) {
      i++;
      const b = unary();
      a = { b: '^', a, c: b, p: a.p, e: b.e };
    }
    return a;
  }
  function expr(lv) {
    if (lv >= LV.length) return unary();
    let a = expr(lv + 1);
    while (T[i] && T[i].k === 'op' && LV[lv].includes(T[i].v)) {
      const op = T[i++].v;
      const c = expr(lv + 1);
      a = { b: op, a, c, p: a.p, e: c.e };
    }
    return a;
  }
  const lets = [];
  while (T[i] && T[i].k === 'let') {
    const L = T[i++];
    const nm = T[i];
    if (!nm || nm.k !== 'id') throw ctErr('LET needs a name, e.g. LET dT1 = …', L.e, 1, src);
    i++;
    if (!isop('=')) throw ctErr(`missing = after LET ${nm.v}`, T[i] ? T[i].p : end(), 1, src);
    i++;
    const ex = expr(0);
    if (!isop(';')) throw ctErr(`missing ; at the end of LET ${nm.v}`, ex.e, 1, src, { kind: 'insert', at: ex.e, text: ';' });
    i++;
    lets.push({ name: nm.v, ex, p: nm.p });
  }
  if (!T[i]) throw ctErr(lets.length ? 'after the LET steps, write the result, e.g. dT1 - dT2' : 'write a formula', end(), 1, src);
  const out = expr(0);
  if (T[i]) {
    const t = T[i];
    throw ctErr(t.k === 'op' && t.v === ')' ? 'one ) too many' : `"${t.v || t.k}" is not expected here — missing an operator?`, t.p, (t.e || t.p + 1) - t.p, src, t.k === 'op' && t.v === ')' ? { kind: 'replace', p: t.p, len: 1, text: '' } : null);
  }
  return { lets, out };
}
function ctNear(w, list) {
  const lev = (a, b) => {
    a = a.toLowerCase();
    b = b.toLowerCase();
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best = null,
    bd = 1e9;
  for (const x of list) {
    const d = lev(w, x);
    if (d < bd) (bd = d), (best = x);
  }
  return best && bd <= Math.max(2, Math.round(w.length / 3)) ? best : null;
}

/* ---------- tags of equipment ---------- */
function ctTagName(id) {
  const t = REG[id];
  return (t && (t.short || t.desc)) || id.split('.').slice(1).join('.') || id;
}
function ctEquipTags(b) {
  return (b && b.tags ? b.tags.map(t => t.id) : []).filter(id => REG[id] && !(REG[id].calc && REG[id].calcOf === b.id && false));
}
function ctFindTag(b, name) {
  const ids = ctEquipTags(b),
    n = String(name).trim().toLowerCase();
  return (
    ids.find(id => id.toLowerCase() === n) ||
    ids.find(id => id.split('.').slice(1).join('.').toLowerCase() === n) ||
    ids.find(id => (REG[id].short || '').toLowerCase() === n) ||
    ids.find(id => (REG[id].desc || '').toLowerCase() === n) ||
    null
  );
}
function ctBlockByName(n) {
  n = String(n).trim().toLowerCase();
  return DOC.blocks.find(b => (b.name || '').toLowerCase() === n) || null;
}
/* resolve every [..].[..] of a tree for one calc (and "this" equipment); collects reference errors */
function ctResolve(tree, C, thisB, src, errs) {
  const sel = (C.equip || []).map(B).filter(Boolean);
  const walk = n => {
    if (!n || typeof n !== 'object') return;
    if (n.ref) {
      const r = n.ref;
      const eqs = r.eq === '*' ? sel : r.eq == null ? (thisB ? [thisB] : sel) : r.eq.toLowerCase() === 'this' ? (thisB ? [thisB] : []) : [ctBlockByName(r.eq)].filter(Boolean);
      if (r.eq && r.eq !== '*' && r.eq.toLowerCase() !== 'this' && !eqs.length) {
        const sug = ctNear(r.eq, sel.map(b => b.name));
        errs.push(ctErr(`[${r.eq}] is not one of the selected equipment`, r.p + 1, r.eq.length, src, sug ? { kind: 'replace', p: r.p + 1, len: r.eq.length, text: sug } : null));
        return;
      }
      if (r.eq && r.eq !== '*' && r.eq.toLowerCase() !== 'this' && !sel.includes(eqs[0])) {
        errs.push(ctErr(`[${r.eq}] is not selected in Equipment — add it there first`, r.p + 1, r.eq.length, src, { kind: 'addEquip', id: eqs[0].id }));
      }
      if (r.eq && r.eq.toLowerCase() === 'this' && C.mode !== 'each') errs.push(ctErr('[this] works only with "Each equipment of a type"', r.p + 1, 4, src));
      const ids = [];
      for (const b of eqs) {
        const id = ctFindTag(b, r.tag);
        if (id) ids.push(id);
        else if (r.eq !== '*') {
          const sug = ctNear(r.tag, ctEquipTags(b).map(ctTagName));
          errs.push(ctErr(`${b.name} has no tag [${r.tag}]`, r.e - r.tag.length - 1, r.tag.length, src, sug ? { kind: 'replace', p: r.e - r.tag.length - 1, len: r.tag.length, text: sug } : null));
        }
      }
      if (r.eq === '*') {
        if (!ids.length) errs.push(ctErr(`none of the selected equipment has a tag [${r.tag}]`, r.e - r.tag.length - 1, r.tag.length, src));
        n.ids = ids;
        n.group = true;
      } else n.id = ids[0] || null;
      return;
    }
    for (const k of ['a', 'c', 'ex', 'out']) if (n[k]) walk(n[k]);
    if (n.args) n.args.forEach(walk);
    if (n.list) n.list.forEach(walk);
  };
  walk(tree.out);
  tree.lets.forEach(l => walk(l.ex));
  /* names used must be LET names; functions get their argument checks */
  const names = new Set();
  const chk = (n, scope) => {
    if (!n || typeof n !== 'object') return;
    if (n.v != null && !n.f) {
      if (!scope.has(n.v)) {
        const sug = ctNear(n.v, [...scope, ...Object.keys(CT_CONST)]);
        errs.push(ctErr(`"${n.v}" is not defined — use [Equipment].[Tag] for a tag, or LET ${n.v} = … first`, n.p, n.v.length, src, sug ? { kind: 'replace', p: n.p, len: n.v.length, text: sug } : null));
      }
    }
    if (n.f) {
      const A = n.args,
        timed = A[1] && A[1].time;
      const W = n.f;
      const argErr = m => errs.push(ctErr(`${W}: ${m}`, n.p, W.length, src));
      if (['AVG', 'SD', 'SUM', 'COUNT', 'RATE'].includes(W)) {
        if (A.length !== 2) argErr(`needs a tag and a time window, e.g. ${CT_HELP[W][0]}`);
        else if (!A[1].time) argErr('the window needs a unit — 30s, 5m, 1h …');
      }
      if ((W === 'MIN' || W === 'MAX') && A.length < 1) argErr('needs at least one value');
      if ((W === 'MIN' || W === 'MAX') && A.length === 2 && A[1].time) n.win = true;
      if (W === 'IF' && A.length !== 3) argErr('needs 3 parts: IF(condition, value when true, value when false)');
      if (['ABS', 'SQRT', 'EXP', 'LN', 'LOG10', 'SIGN', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'PREV', 'SINCE'].includes(W) && A.length !== 1) argErr('needs exactly one value');
      if (['POW', 'ATAN2', 'LOG'].includes(W) && A.length !== 2) argErr('needs two values');
      if (W === 'CLAMP' && A.length !== 3) argErr('needs 3 values: CLAMP(x, lo, hi)');
      if (CT_FUNCS.group.includes(W) && A.length !== 1) argErr(`needs one group, e.g. ${CT_HELP[W][0]}`);
      if (W === 'PREV' && A[0] && !A[0].ref) argErr('works on a tag, e.g. PREV([MX-1].[Total water])');
      if (timed && !['AVG', 'SD', 'SUM', 'COUNT', 'RATE', 'MIN', 'MAX'].includes(W)) argErr('a time window is not used here');
    }
    for (const k of ['a', 'c']) if (n[k]) chk(n[k], scope);
    if (n.args) n.args.forEach(a => chk(a, scope));
    if (n.list) n.list.forEach(a => chk(a, scope));
  };
  tree.lets.forEach(l => {
    chk(l.ex, names);
    names.add(l.name);
  });
  chk(tree.out, names);
}

/* ---------- evaluation (values are numbers, or arrays for groups) ---------- */
const CT_STATE = {}; // per calc instance: { buf: {nodeKey: [{t,v}]}, since: {}, steps: [] }
/* v10.4 — history mode: the formula is worked out at a past time t from the inputs' history (27w) */
let CT_AT = null; // { t, hist: { id: [{t, v}] sorted } }
function ctV(id) {
  if (!CT_AT) return val(id);
  const h = CT_AT.hist[id];
  if (!h || !h.length) return null;
  let lo = 0, hi = h.length - 1, k = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (h[m].t <= CT_AT.t) (k = m), (lo = m + 1);
    else hi = m - 1;
  }
  return k < 0 || CT_AT.t - h[k].t > (CT_AT.stale || 600000) ? null : h[k].v;
}
function ctHist(id, sec) {
  if (CT_AT) {
    const h = CT_AT.hist[id] || [];
    return h.filter(x => x.t <= CT_AT.t && CT_AT.t - x.t <= sec * 1000 && x.v != null && isFinite(x.v));
  }
  const V = VAL[id],
    now = Date.now();
  if (!V) return [];
  const h = (V.h || []).filter(x => now - x.t <= sec * 1000 && x.v != null && isFinite(x.v));
  return h.length ? h : V.v != null && isFinite(V.v) ? [{ t: now, v: V.v }] : [];
}
function ctWin(fn, pts, sec) {
  const vs = pts.map(x => x.v);
  if (!vs.length) return null;
  if (fn === 'AVG') return vs.reduce((a, b) => a + b, 0) / vs.length;
  if (fn === 'SUM') return vs.reduce((a, b) => a + b, 0);
  if (fn === 'COUNT') return vs.length;
  if (fn === 'MIN') return Math.min(...vs);
  if (fn === 'MAX') return Math.max(...vs);
  if (fn === 'SD') {
    if (vs.length < 2) return 0;
    const m = vs.reduce((a, b) => a + b, 0) / vs.length;
    return Math.sqrt(vs.reduce((a, b) => a + (b - m) * (b - m), 0) / (vs.length - 1));
  }
  if (fn === 'RATE') {
    if (pts.length < 2) return null;
    const dt = (pts[pts.length - 1].t - pts[0].t) / 3600000;
    return dt > 0 ? (pts[pts.length - 1].v - pts[0].v) / dt : null;
  }
  return null;
}
function ctEval(n, env) {
  const ev = x => ctEval(x, env);
  const map2 = (a, c, f) => {
    if (a == null || c == null) return null;
    if (Array.isArray(a) || Array.isArray(c)) {
      const L = Math.max(Array.isArray(a) ? a.length : 1, Array.isArray(c) ? c.length : 1);
      return Array.from({ length: L }, (_, i) => {
        const x = Array.isArray(a) ? a[i] : a,
          y = Array.isArray(c) ? c[i] : c;
        return x == null || y == null ? null : f(x, y);
      });
    }
    return f(a, c);
  };
  const map1 = (a, f) => (a == null ? null : Array.isArray(a) ? a.map(x => (x == null ? null : f(x))) : f(a));
  if ('n' in n) return n.n;
  if (n.ref) {
    if (n.group) return n.ids.map(id => (ctV(id) != null && isFinite(ctV(id)) ? ctV(id) : null));
    if (!n.id) return null;
    const v = ctV(n.id);
    return v != null && isFinite(v) ? v : null;
  }
  if (n.v != null) return env.vars[n.v] ?? null;
  if (n.list) return n.list.map(ev).flat();
  if (n.u) {
    const a = ev(n.a);
    return map1(a, x => (n.u === '-' ? -x : x ? 0 : 1));
  }
  if (n.b) {
    if (n.b === '&&' || n.b === '||') {
      const a = ev(n.a),
        c = ev(n.c);
      return map2(a, c, (x, y) => (n.b === '&&' ? (x && y ? 1 : 0) : x || y ? 1 : 0));
    }
    const a = ev(n.a),
      c = ev(n.c);
    return map2(a, c, (x, y) => {
      switch (n.b) {
        case '+': return x + y;
        case '-': return x - y;
        case '*': return x * y;
        case '/':
          if (y === 0) return env.warn(n, 'division by zero'), null;
          return x / y;
        case '%': return y === 0 ? null : x % y;
        case '^': return Math.pow(x, y);
        case '<': return x < y ? 1 : 0;
        case '>': return x > y ? 1 : 0;
        case '<=': return x <= y ? 1 : 0;
        case '>=': return x >= y ? 1 : 0;
        case '=': return Math.abs(x - y) < 1e-9 ? 1 : 0;
        case '<>': return Math.abs(x - y) >= 1e-9 ? 1 : 0;
      }
      return null;
    });
  }
  if (n.f) {
    const F = n.f,
      A = n.args;
    /* time-window functions */
    if (['AVG', 'SD', 'SUM', 'COUNT', 'RATE'].includes(F) || ((F === 'MIN' || F === 'MAX') && n.win)) {
      const sec = A[1].n;
      const x = A[0];
      if (x.ref) return x.group ? x.ids.map(id => ctWin(F, ctHist(id, sec), sec)) : x.id ? ctWin(F, ctHist(x.id, sec), sec) : null;
      // window over an expression: keep its own samples
      const key = 'b' + n.p;
      const buf = (env.st.buf[key] = env.st.buf[key] || []),
        now = CT_AT ? CT_AT.t : Date.now(),
        v = ev(x);
      if (v != null && !Array.isArray(v) && (!buf.length || now - buf[buf.length - 1].t >= 900)) buf.push({ t: now, v });
      while (buf.length && now - buf[0].t > Math.max(sec, 3600) * 1000) buf.shift();
      return ctWin(F, buf.filter(p => now - p.t <= sec * 1000), sec);
    }
    if (F === 'PREV') {
      const x = A[0];
      if (!x.id) return null;
      const h = (VAL[x.id] && VAL[x.id].h) || [];
      return h.length > 1 ? h[h.length - 2].v : null;
    }
    if (F === 'SINCE') {
      const key = 's' + n.p,
        c = ev(A[0]),
        now = Date.now();
      if (c) env.st.since[key] = now;
      const t = env.st.since[key];
      return t ? (now - t) / 1000 : null;
    }
    if (F === 'IF') {
      const c = ev(A[0]);
      if (c == null) return null;
      if (Array.isArray(c)) {
        const a = ev(A[1]),
          b = ev(A[2]);
        return c.map((x, i) => (x == null ? null : x ? (Array.isArray(a) ? a[i] : a) : Array.isArray(b) ? b[i] : b));
      }
      return c ? ev(A[1]) : ev(A[2]);
    }
    const xs = A.map(ev);
    if (CT_FUNCS.group.includes(F)) {
      const g = (Array.isArray(xs[0]) ? xs[0] : [xs[0]]).filter(v => v != null);
      if (F === 'COUNTOF') return g.length;
      if (F === 'COUNTIF') return g.filter(v => v).length;
      if (!g.length) return null;
      if (F === 'AVGOF') return g.reduce((a, b) => a + b, 0) / g.length;
      if (F === 'SUMOF') return g.reduce((a, b) => a + b, 0);
      if (F === 'MINOF') return Math.min(...g);
      if (F === 'MAXOF') return Math.max(...g);
    }
    if (F === 'MIN' || F === 'MAX') {
      const all = xs.flat().filter(v => v != null);
      return all.length ? (F === 'MIN' ? Math.min(...all) : Math.max(...all)) : null;
    }
    if (xs.some(v => v == null)) return null;
    const [a, b, c] = xs;
    const one = f => map1(a, f);
    switch (F) {
      case 'ABS': return one(Math.abs);
      case 'SQRT': return one(x => (x < 0 ? (env.warn(n, 'SQRT of a negative number'), null) : Math.sqrt(x)));
      case 'EXP': return one(Math.exp);
      case 'LN': return one(x => (x <= 0 ? (env.warn(n, `LN of ${fmtN(x, 3)} (0 or negative) — check the inputs, e.g. ΔT ≤ 0`), null) : Math.log(x)));
      case 'LOG10': return one(x => (x <= 0 ? (env.warn(n, 'LOG10 of 0 or a negative number'), null) : Math.log10(x)));
      case 'LOG': return map2(a, b, (x, y) => (x <= 0 || y <= 0 || y === 1 ? (env.warn(n, 'LOG needs positive values and a base other than 1'), null) : Math.log(x) / Math.log(y)));
      case 'POW': return map2(a, b, Math.pow);
      case 'ROUND': return map2(a, b ?? 0, (x, y) => Math.round(x * Math.pow(10, y)) / Math.pow(10, y));
      case 'CLAMP': return map1(a, x => Math.min(Math.max(x, b), c));
      case 'SIGN': return one(Math.sign);
      case 'SIN': return one(Math.sin);
      case 'COS': return one(Math.cos);
      case 'TAN': return one(Math.tan);
      case 'ASIN': return one(Math.asin);
      case 'ACOS': return one(Math.acos);
      case 'ATAN': return one(Math.atan);
      case 'ATAN2': return map2(a, b, Math.atan2);
    }
  }
  return null;
}
/* compile one formula for one instance: { tree, errs[] } (cached by text + equipment + mode) */
const CT_COMP = new Map();
function ctCompile(C, thisB) {
  const key = [C.expr, (C.equip || []).join(','), C.mode, thisB ? thisB.id : '', DOC.blocks.length, Object.keys(REG).length].join('|');
  if (CT_COMP.has(key)) return CT_COMP.get(key);
  let r;
  try {
    const tree = ctParse(C.expr || '');
    const errs = [];
    ctResolve(tree, C, thisB, C.expr || '', errs);
    r = { tree, errs };
  } catch (e) {
    r = { tree: null, errs: [e] };
  }
  if (CT_COMP.size > 200) CT_COMP.clear();
  CT_COMP.set(key, r);
  return r;
}
function ctRun(C, thisB, stKey) {
  const cp = ctCompile(C, thisB);
  if (!cp.tree || cp.errs.length) return { v: null, errs: cp.errs, steps: [], warns: [] };
  const st = (CT_STATE[stKey] = CT_STATE[stKey] || { buf: {}, since: {} });
  const warns = [];
  const env = { vars: {}, st, warn: (n, m) => warns.push(ctErr(m, n.p, (n.e || n.p + 1) - n.p, C.expr)) };
  const steps = [];
  for (const L of cp.tree.lets) {
    const v = ctEval(L.ex, env);
    env.vars[L.name] = v;
    steps.push([L.name, v]);
  }
  let v = ctEval(cp.tree.out, env);
  if (Array.isArray(v)) {
    warns.push(ctErr('the result is a group — wrap it in AVGOF / MAXOF / SUMOF …', cp.tree.out.p, 1, C.expr));
    v = null;
  }
  return { v: v != null && isFinite(v) ? v : null, errs: [], steps, warns };
}

/* ---------- registering calculated tags as normal tags ---------- */
function ctDoc() {
  return (DOC.calc = Array.isArray(DOC.calc) ? DOC.calc : []);
}
function ctInstances(C) {
  if (C.mode === 'each') return (C.equip || []).map(B).filter(Boolean).map(b => ({ id: `${b.name}.${C.id}`, b }));
  return [{ id: C.tagId || C.id, b: null }];
}
function ctRegister(C) {
  for (const I of ctInstances(C)) {
    const t = REG[I.id] || mkTag(I.id, {});
    Object.assign(t, {
      desc: (I.b ? I.b.name + ' · ' : '') + C.name,
      short: 'ƒx ' + C.name,
      unit: C.unit || '',
      src: 'Calculated',
      addr: 'ƒx ' + String(C.expr || '').replace(/\s+/g, ' ').slice(0, 120),
      typ: null,
      noise: 0,
      d: C.d != null ? +C.d : 2,
      lo: C.lo != null && C.lo !== '' ? +C.lo : null,
      hi: C.hi != null && C.hi !== '' ? +C.hi : null,
      ll: C.ll != null && C.ll !== '' ? +C.ll : ctAutoCrit(C).ll,
      hh: C.hh != null && C.hh !== '' ? +C.hh : ctAutoCrit(C).hh,
      critAuto: (C.ll == null || C.ll === '') || (C.hh == null || C.hh === ''),
      opt: C.opt != null && C.opt !== '' ? +C.opt : null,
      calc: C.id,
    });
    ensureVal(I.id);
    /* show next to its equipment */
    const host = I.b || (C.show && C.equip && C.equip.length ? B(C.equip[0]) : null);
    if (host && C.show !== false) {
      host.tags = host.tags || [];
      // listed with the equipment (Parameters monitoring, cards) but drawn as its own ƒx label below the drawing
      const ex = host.tags.find(x => x.id === I.id);
      if (ex) Object.assign(ex, { show: false, ct: 1 });
      else host.tags.push({ id: I.id, show: false, own: false, ct: 1 });
    }
  }
}
function ctUnregister(C) {
  const ids = new Set(ctInstances(C).map(i => i.id));
  DOC.blocks.forEach(b => b.tags && (b.tags = b.tags.filter(t => !ids.has(t.id))));
  ids.forEach(id => {
    delete REG[id];
    delete VAL[id];
  });
}
/* every second: recalculate (and register anything a loaded file brought) */
const CT_LAST = {}; // per tag: { v, errs, steps, warns }
function ctTick() {
  if (!DOC || !Array.isArray(DOC.calc) || !DOC.calc.length) return;
  const now = Date.now();
  for (const C of DOC.calc) {
    for (const I of ctInstances(C)) {
      if (!REG[I.id]) ctRegister(C);
      const r = ctRun(C, I.b, I.id);
      CT_LAST[I.id] = r;
      const V = VAL[I.id] || (ensureVal(I.id), VAL[I.id]);
      V.v = V.x = r.v;
      V.ts = now; // the demo never moves a calculated value
      V.h = V.h || [];
      if (r.v == null || !isFinite(r.v) || (!V.h.length && r.v === 0)) continue;
      V.h.push({ t: now, v: r.v });
      if (V.h.length > 900) V.h.shift();
      /* long history for the trend: one reading every 30 s, 8 hours */
      V.hl = V.hl || [];
      const lp = V.hl[V.hl.length - 1];
      if (!lp || now - lp.t >= 30000) V.hl.push({ t: now, v: r.v });
      if (V.hl.length > 960) V.hl.shift();
    }
  }
}
setInterval(() => {
  try {
    if (!RP) ctTick();
  } catch (e) {
    console.error(e);
  }
}, 1000);

/* ---------- ƒx labels on the drawing (own layer above the equipment; drag to move in Design) ---------- */
function ctLayer() {
  let L = document.getElementById('Lct');
  if (!L) {
    const t = document.getElementById('Ltags');
    if (!t) return null;
    t.insertAdjacentHTML('afterend', '<g id="Lct"></g>');
    L = document.getElementById('Lct');
  }
  return L;
}
function ctLabelsAll() {
  const L = ctLayer();
  if (!L || !DOC) return;
  let html = '';
  for (const b of DOC.blocks) {
    const ents = (b.tags || []).filter(t => t.ct && REG[t.id] && REG[t.id].calc);
    if (!ents.length) continue;
    const { W, H } = dims(b);
    ents.forEach((e, i) => {
      const t = REG[e.id],
        v = VAL[e.id] ? VAL[e.id].v : null,
        bad = v != null && ((t.lo != null && v < t.lo) || (t.hi != null && v > t.hi)),
        name = String(t.short || '').replace(/^ƒx\s*/, ''),
        txt = v == null ? '—' : fmtN(v, t.d) + (t.unit ? ' ' + t.unit : '');
      const w = Math.round(Math.max(96, Math.min(240, 32 + Math.max(name.length * 5.6, txt.length * 7.6 + 6))));
      const p = e.cpos || { x: W + 8, y: i * 32 };
      html += `<g class="ct-lab${bad ? ' bad' : ''}${v == null ? ' nd' : ''}" transform="translate(${b.x + p.x},${b.y + p.y})" data-ctid="${esc(e.id)}" data-cb="${b.id}"><title>${esc(t.desc)} — ${esc(t.addr || '')}</title><rect class="ct-lb" width="${w}" height="28" rx="5"/><rect class="ct-lf" width="20" height="28" rx="5"/><rect class="ct-lf" x="10" width="10" height="28"/><text class="ct-lx" x="10" y="18" text-anchor="middle">ƒx</text><text class="ct-ln2" x="26" y="11">${esc(name)}</text><text class="ct-lv" x="26" y="24">${esc(txt)}</text></g>`;
    });
  }
  if (L.dataset.h !== html) {
    L.dataset.h = html;
    L.innerHTML = html;
  }
}
setInterval(() => {
  try {
    ctLabelsAll();
  } catch (e) {}
}, 500);
/* drag in Design, click to open (Design: edit · Simulate / Publish: trend) */
let CT_DRAG = null;
document.addEventListener(
  'pointerdown',
  e => {
    const l = e.target.closest && e.target.closest('#Lct .ct-lab');
    if (!l) return;
    e.stopPropagation();
    e.preventDefault();
    const b = B(l.dataset.cb),
      ent = b && (b.tags || []).find(t => t.id === l.dataset.ctid);
    if (!ent) return;
    const { W } = dims(b),
      i = b.tags.filter(t => t.ct).indexOf(ent);
    CT_DRAG = { l, b, ent, x0: e.clientX, y0: e.clientY, p0: Object.assign({}, ent.cpos || { x: W + 8, y: i * 32 }), moved: false };
  },
  true,
);
document.addEventListener('pointermove', e => {
  const D = CT_DRAG;
  if (!D || MODE === 'monitor') return;
  const k = (VIEW && VIEW.k) || 1,
    dx = (e.clientX - D.x0) / k,
    dy = (e.clientY - D.y0) / k;
  if (!D.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
  if (!D.moved) pushUndo();
  D.moved = true;
  D.ent.cpos = { x: Math.round(D.p0.x + dx), y: Math.round(D.p0.y + dy) };
  D.l.setAttribute('transform', `translate(${D.b.x + D.ent.cpos.x},${D.b.y + D.ent.cpos.y})`);
});
document.addEventListener('pointerup', () => {
  const D = CT_DRAG;
  CT_DRAG = null;
  if (!D) return;
  if (D.moved) {
    changed();
    ctLabelsAll();
    return;
  }
  const id = D.ent.id,
    C = ctDoc().find(c => c.id === (REG[id] && REG[id].calc));
  if (MODE !== 'monitor' && C) ctOpen(C.id);
  else if (typeof openTrend === 'function') openTrend(id);
});

/* ---------- editor ---------- */
let CTE = null; // the calc being edited (a copy)
function ctHighlight(src, errs) {
  const marks = [];
  (errs || []).forEach(e => e.p != null && marks.push([e.p, e.p + e.len]));
  let out = '',
    i = 0;
  const s = String(src || '');
  const inErr = p => marks.some(([a, b]) => p >= a && p < b);
  const span = (cls, txt, p) => {
    let h = '';
    for (let k = 0; k < txt.length; k++) {
      const e = inErr(p + k);
      h += (e ? '<u class="ct-e">' : '') + esc(txt[k]) + (e ? '</u>' : '');
    }
    return cls ? `<span class="${cls}">${h}</span>` : h;
  };
  while (i < s.length) {
    const r = s.slice(i);
    let m;
    if ((m = /^\/\/[^\n]*/.exec(r))) (out += span('ct-cm', m[0], i)), (i += m[0].length);
    else if ((m = /^\[[^\]\n]*\](?:\.\[[^\]\n]*\])?/.exec(r))) (out += span('ct-tg', m[0], i)), (i += m[0].length);
    else if ((m = /^\d+(?:\.\d+)?(?:e[+-]?\d+)?(ms|s|m|h|d)?\b/i.exec(r))) (out += span(m[1] ? 'ct-tm' : 'ct-nu', m[0], i)), (i += m[0].length);
    else if ((m = /^[A-Za-z_]\w*/.exec(r))) {
      const W = m[0].toUpperCase();
      out += span(CT_ALL.has(W) ? 'ct-fn' : /^(LET|AND|OR|NOT|TRUE|FALSE)$/.test(W) ? 'ct-kw' : W in CT_CONST ? 'ct-nu' : 'ct-va', m[0], i);
      i += m[0].length;
    } else (out += span('', s[i], i)), i++;
  }
  return out + '\n';
}
function ctEquipGroups() {
  const area = b => {
    try {
      const a = typeof mcArea === 'function' ? mcArea(b) : null;
      return (a && (a.name || a.title)) || EQ[b.type].n || 'Other';
    } catch (e) {
      return 'Other';
    }
  };
  const G = {};
  DOC.blocks
    .filter(b => b.name && b.tags && b.tags.some(t => REG[t.id] && !REG[t.id].calc) && EQ[b.type] && !EQ[b.type].widget)
    .forEach(b => (G[area(b)] = G[area(b)] || []).push(b));
  Object.values(G).forEach(a => a.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true })));
  return G;
}
function ctOpen(id, preset) {
  const src = id ? ctDoc().find(c => c.id === id) : null;
  CTE = src
    ? JSON.parse(JSON.stringify(src))
    : { id: 'CALC_' + Date.now().toString(36).toUpperCase(), name: '', tagId: '', unit: '', d: 2, equip: SEL && SEL.t === 'b' && B(SEL.id) && B(SEL.id).name ? [SEL.id] : [], mode: 'several', expr: '', ll: '', lo: '', opt: '', hi: '', hh: '', show: true, isNew: true };
  if (!src && preset) Object.assign(CTE, preset);
  ctRender();
}
function ctRender() {
  const C = CTE;
  const sel = (C.equip || []).map(B).filter(Boolean);
  const num = (k, ph) => `<input class="ct-in" type="number" step="any" data-ctf="${k}" value="${C[k] != null ? esc(C[k]) : ''}" placeholder="${ph}">`;
  openModal(
    `<div class="ct-h"><span class="ct-chip">CALCULATED TAG</span><h3>${C.isNew ? 'New calculated tag' : esc(C.name || 'Calculated tag')}</h3></div>
<div class="ct-grid"><div class="ct-l">
 <div class="ct-row"><label>Name</label><input class="ct-in" data-ctf="name" value="${esc(C.name)}" placeholder="e.g. Cooler ΔT"></div>
 <div class="ct-row"><label>Tag ID / unit</label><div class="ct-2"><input class="ct-in mono" data-ctf="tagId" value="${esc(C.tagId || '')}" placeholder="${C.mode === 'each' ? '&lt;equipment&gt;.NAME (one per equipment)' : C.mode === 'one' ? '&lt;equipment&gt;.NAME (automatic)' : 'CALC.NAME (automatic)'}"><input class="ct-in" data-ctf="unit" value="${esc(C.unit)}" placeholder="unit"></div></div>
 <div class="ct-row"><label>Applies to</label><div class="lc2-seg ct-seg">${[['one', 'One equipment'], ['several', 'Several equipment (one result)'], ['each', 'Each selected equipment']].map(([k, l]) => `<button type="button" data-ctm="${k}" aria-pressed="${C.mode === k}">${l}</button>`).join('')}</div></div>
 <div class="ct-row"><label>Equipment</label><div class="ct-ms" id="ctMs">${sel.map(b => `<span class="ct-ch">${esc(b.name)}<i data-ctx="${b.id}" title="Remove">✕</i></span>`).join('')}<input id="ctEqQ" placeholder="${sel.length ? 'Add equipment…' : 'Choose equipment…'}" autocomplete="off"><div class="ct-dd" id="ctDd" hidden></div></div></div>
 <div class="ct-row ct-top"><label>Formula</label><div>
  <div class="ct-box" id="ctBox"><div class="ct-bt"><b>Formula</b><span>Type [ for a tag · Ctrl+Space for functions · // for a comment</span></div>
   <div class="ct-ed"><pre class="ct-ln" id="ctLn"></pre><div class="ct-wrap"><pre class="ct-hl" id="ctHl" aria-hidden="true"></pre><textarea id="ctTx" spellcheck="false" placeholder="e.g. AVG([CD-1].[Inlet temp], 5m) - AVG([CD-1].[Outlet temp], 5m)">${esc(C.expr)}</textarea></div><div class="ct-ac" id="ctAc" hidden></div></div>
   <div class="ct-msg" id="ctMsg"></div></div>
  <div class="ct-steps" id="ctSteps"></div></div></div>
 <div class="ct-row"><label>Limits</label><div class="ct-3 ct-5">${num('ll', ctAutoCrit(C).ll != null ? 'LL auto ' + ctAutoCrit(C).ll : 'LL · critical')}${num('lo', 'L · min')}${num('opt', 'Optimal')}${num('hi', 'H · max')}${num('hh', ctAutoCrit(C).hh != null ? 'HH auto ' + ctAutoCrit(C).hh : 'HH · critical')}</div></div><div class="ct-row"><label></label><div class="ct-hint">Same as a tag: outside L / H → Warning (screen only) · outside LL / HH → Critical → email to the zone team. Empty LL / HH = automatic: 25 % of the L–H band beyond L / H.</div></div>
 <div class="ct-row"><label>Decimals / show</label><div class="ct-2b">${num('d', '2')}<label class="ct-cb"><input type="checkbox" id="ctShow" ${C.show !== false ? 'checked' : ''}> Show on the drawing next to ${C.mode === 'each' ? 'each equipment' : 'the first equipment'}</label></div></div>
</div>
<div class="ct-r"><div class="ct-tabs" id="ctTabs">${['Tags', 'Functions', 'Examples'].map((t, i) => `<button type="button" data-ctt="${t}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div><div class="ct-pane" id="ctPane"></div></div></div>
<div class="mact"><button class="ib" id="ctCancel">Cancel</button>${C.isNew ? '' : '<button class="ib" id="ctDel" style="color:#b42318">Delete</button>'}<button class="ib pri" id="ctSave">Save tag</button></div>`,
    'xl',
  );
  ctBind();
  ctPane('Tags');
  ctCheck();
}
function ctPane(tab) {
  const P = $('#ctPane'),
    C = CTE;
  $$('#ctTabs [data-ctt]').forEach(b => b.classList.toggle('on', b.dataset.ctt === tab));
  if (tab === 'Tags') {
    const sel = (C.equip || []).map(B).filter(Boolean);
    const same = {};
    sel.forEach(b => ctEquipTags(b).forEach(id => {
      const n = ctTagName(id);
      same[n] = (same[n] || 0) + 1;
    }));
    const common = Object.entries(same).filter(([, c]) => c > 1);
    P.innerHTML = `<input class="ct-in" id="ctTq" placeholder="Search tags…"><div class="ct-tl" id="ctTl">${
      sel.length
        ? sel
            .map(b => `<div class="ct-eq" data-eqn="${esc(b.name)}">${esc(b.name)} <small>${esc(EQ[b.type].n || '')}</small></div>${ctEquipTags(b)
              .filter(id => !REG[id].calc)
              .map(id => `<div class="ct-ti" data-ins="${esc(`[${C.mode === 'each' ? 'this' : b.name}].[${ctTagName(id)}]`)}" data-q="${esc((b.name + ' ' + ctTagName(id) + ' ' + id).toLowerCase())}"><span>[${esc(ctTagName(id))}]</span><b>${esc(tagTxt(id))}</b></div>`)
              .join('')}`)
            .join('') +
          (common.length ? `<div class="ct-eq">All selected · same tag <small>a group for AVGOF, MAXOF, COUNTIF …</small></div>${common.map(([n, c]) => `<div class="ct-ti" data-ins="${esc(`[*].[${n}]`)}" data-q="${esc(n.toLowerCase())}"><span>[*].[${esc(n)}]</span><b>${c} equipment</b></div>`).join('')}` : '')
        : '<p class="note">Choose equipment first — their tags are listed here.</p>'
    }</div>`;
    const q = $('#ctTq');
    q.oninput = () => $$('#ctTl .ct-ti').forEach(r => (r.hidden = !r.dataset.q.includes(q.value.trim().toLowerCase())));
  } else if (tab === 'Functions') {
    const grp = (t, list) => `<div class="ct-eq">${t}</div>${list.map(f => `<div class="ct-fi" data-ins="${esc(CT_HELP[f][0].split(' · ')[0].replace(/\(.*$/, '('))}"><code>${esc(CT_HELP[f][0])}</code><small>${esc(CT_HELP[f][1])}</small></div>`).join('')}`;
    P.innerHTML = `<div class="ct-tl">${grp('Maths', CT_FUNCS.maths)}${grp('Over time (window 30s · 5m · 1h · 1d)', CT_FUNCS.time)}${grp('Across equipment', CT_FUNCS.group)}<div class="ct-eq">Constants & steps</div><div class="ct-fi" data-ins="PI"><code>PI · E · SIGMA_SB</code><small>π, e, Stefan–Boltzmann constant</small></div><div class="ct-fi" data-ins="LET x = ;\n"><code>LET name = … ;</code><small>a named step used further down</small></div><div class="ct-fi" data-ins="IF(, , )"><code>AND · OR · NOT · = · &lt;&gt;</code><small>conditions</small></div></div>`;
  } else {
    P.innerHTML = `<div class="ct-tl">${CT_EXAMPLES.map(([t, f], i) => `<div class="ct-ex" data-exi="${i}"><b>${esc(t)}</b><pre>${esc(f)}</pre></div>`).join('')}<p class="note">Examples use equipment names from a typical loop — after inserting, change them to yours; errors show which ones.</p></div>`;
  }
  $$('#ctPane [data-ins]').forEach(x => (x.onclick = () => ctInsert(x.dataset.ins)));
  $$('#ctPane [data-exi]').forEach(x => (x.onclick = () => {
    const tx = $('#ctTx');
    tx.value = CT_EXAMPLES[+x.dataset.exi][1];
    CTE.expr = tx.value;
    if (!CTE.name) {
      CTE.name = CT_EXAMPLES[+x.dataset.exi][0];
      const n = $('[data-ctf="name"]');
      if (n) n.value = CTE.name;
    }
    ctCheck();
  }));
}
function ctInsert(text) {
  const tx = $('#ctTx');
  const a = tx.selectionStart,
    b = tx.selectionEnd;
  tx.value = tx.value.slice(0, a) + text + tx.value.slice(b);
  const p = a + text.length - (text.endsWith('(') || text.endsWith('( , )') ? 0 : 0);
  tx.focus();
  tx.setSelectionRange(p, p);
  CTE.expr = tx.value;
  ctCheck();
}
function ctApplyFix(e) {
  const tx = $('#ctTx'),
    f = e.fix;
  if (!f) return;
  if (f.kind === 'addEquip') {
    CTE.equip = [...new Set([...(CTE.equip || []), f.id])];
    return ctRender();
  }
  const s = tx.value;
  if (f.kind === 'insert') tx.value = s.slice(0, f.at) + f.text + s.slice(f.at);
  if (f.kind === 'replace') tx.value = s.slice(0, f.p) + f.text + s.slice(f.p + f.len);
  CTE.expr = tx.value;
  ctCheck();
}
let CT_ERRS = [];
function ctCheck() {
  const C = CTE,
    tx = $('#ctTx');
  if (!tx || !C) return;
  C.expr = tx.value;
  const sel = (C.equip || []).map(B).filter(Boolean);
  const thisB = C.mode === 'each' ? sel[0] || null : null;
  let r = { errs: [], steps: [], v: null, warns: [] };
  if (C.expr.trim()) r = ctRun(C, thisB, 'edit:' + C.id);
  CT_ERRS = r.errs.concat(r.warns);
  if (!sel.length && C.expr.trim()) CT_ERRS.unshift(Object.assign(new Error('choose at least one equipment'), { line: 0, col: 0 }));
  $('#ctHl').innerHTML = ctHighlight(C.expr, r.errs.concat(r.warns));
  ctGutter();
  const box = $('#ctBox'),
    msg = $('#ctMsg');
  const bad = r.errs.length || (!sel.length && C.expr.trim());
  box.classList.toggle('bad', !!bad);
  box.classList.toggle('ok', !bad && !!C.expr.trim() && r.v != null);
  let mh;
  if (!C.expr.trim()) mh = '<span class="note">Write a formula — the result and any errors show here as you type.</span>';
  else if (bad)
    mh = `<b>✕ ${CT_ERRS.length} error${CT_ERRS.length > 1 ? 's' : ''}</b>${CT_ERRS.map((e, i) => `<div>${e.line ? `Line ${e.line}, col ${e.col}: ` : ''}${esc(e.message)}${e.fix ? ` <button type="button" class="ct-fix" data-fx="${i}">${e.fix.kind === 'addEquip' ? '→ Add it' : e.fix.text ? `→ ${esc(e.fix.text === '' ? 'Remove' : e.fix.kind === 'insert' ? 'Add ' + e.fix.text : 'Use ' + e.fix.text)}` : '→ Remove'}</button>` : ''}</div>`).join('')}`;
  else {
    const u = C.unit ? ' ' + esc(C.unit) : '';
    mh = `${r.warns.length ? `<div class="ct-w">⚠ ${r.warns.map(w => `Line ${w.line}, col ${w.col}: ${esc(w.message)}`).join('<br>')}</div>` : ''}<span class="ct-okt">✓ Formula is valid</span> · Result now <b>${r.v == null ? (r.warns.length ? '— (see the warning above)' : '— (no data yet)') : fmtN(r.v, C.d != null && C.d !== '' ? +C.d : 2) + u}</b>${C.mode === 'each' && sel[0] ? ` <span class="note">for ${esc(sel[0].name)} (each selected equipment gets its own)</span>` : ''}`;
  }
  if (msg.dataset.h !== mh) {
    msg.dataset.h = mh;
    msg.innerHTML = mh;
  }
  const st = $('#ctSteps');
  const sh = !bad && r.steps.length ? r.steps.map(([n, v]) => `<span><code>${esc(n)}</code> = <b>${Array.isArray(v) ? '[' + v.map(x => (x == null ? '—' : fmtN(x, 3))).join(', ') + ']' : v == null ? '—' : fmtN(v, 3)}</b></span>`).join('') : '';
  $$('#ctMsg [data-fx]').forEach(b => (b.onclick = () => ctApplyFix(CT_ERRS[+b.dataset.fx])));
}
/* line numbers that follow wrapped lines: measure each line in a hidden copy of the editor */
function ctGutter() {
  const tx = $('#ctTx'),
    ln = $('#ctLn');
  if (!tx || !ln) return;
  let m = document.getElementById('ctMeasure');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ctMeasure';
    m.className = 'ct-measure';
    document.body.appendChild(m);
  }
  m.style.width = tx.clientWidth + 'px';
  const lines = (tx.value || '').split('\n');
  m.innerHTML = lines.map(l => `<div>${esc(l) || '&#8203;'}</div>`).join('');
  ln.innerHTML = [...m.children].map((d, i) => `<div style="height:${d.offsetHeight}px">${i + 1}</div>`).join('');
}
/* autocomplete: [Equip].[  → that equipment's tags · [  → equipment · letters → functions */
function ctAuto(force) {
  const tx = $('#ctTx'),
    ac = $('#ctAc'),
    C = CTE;
  const p = tx.selectionStart,
    before = tx.value.slice(0, p);
  const sel = (C.equip || []).map(B).filter(Boolean);
  let items = [],
    from = p,
    title = '';
  let m;
  if ((m = /\[([^\]\[\n]*)\]\.\[([^\]\[\n]*)$/.exec(before))) {
    const eqn = m[1].toLowerCase();
    const eqs = eqn === '*' ? sel : eqn === 'this' ? sel.slice(0, 1) : sel.filter(b => b.name.toLowerCase() === eqn);
    const q = m[2].toLowerCase();
    from = p - m[2].length;
    const seen = new Set();
    eqs.forEach(b => ctEquipTags(b).filter(id => !REG[id].calc).forEach(id => {
      const n = ctTagName(id);
      if (seen.has(n) || (q && !n.toLowerCase().includes(q))) return;
      seen.add(n);
      items.push({ t: n + ']', l: n, r: eqn === '*' ? '' : tagTxt(id) });
    }));
    title = eqn === '*' ? 'TAGS ON ALL SELECTED' : (eqs[0] ? eqs[0].name : m[1]) + ' · ' + items.length + ' TAGS';
  } else if ((m = /\[([^\]\[\n]*)$/.exec(before))) {
    const q = m[1].toLowerCase();
    from = p - m[1].length;
    items = [...(C.mode === 'each' ? [{ t: 'this].[', l: 'this', r: 'the equipment itself' }] : []), ...sel.map(b => ({ t: b.name + '].[', l: b.name, r: EQ[b.type].n || '' })), { t: '*].[', l: '*', r: 'all selected (group)' }].filter(x => !q || x.l.toLowerCase().includes(q));
    title = 'EQUIPMENT';
  } else if ((m = /(?:^|[^\w\].])([A-Za-z_][\w%/]*(?: [\w%/]+)*)$/.exec(before)) || force) {
    const raw = m ? m[1] : '',
      q = raw.toUpperCase();
    from = p - raw.length;
    const fn = q.length >= 1 ? [...CT_ALL].filter(f => f.startsWith(q.split(' ')[0]) && !q.includes(' ')).map(f => ({ t: f + '(', l: CT_HELP[f][0], r: CT_HELP[f][1], k: 'fn' })) : [];
    const tg = raw.length >= 2 ? ctTagSearch(raw, sel) : [];
    items = [...tg.slice(0, 25), ...fn];
    title = tg.length && fn.length ? 'TAGS · FUNCTIONS' : tg.length ? 'TAGS' : 'FUNCTIONS';
    if (!force && !tg.length && fn.length === 1 && fn[0].t.slice(0, -1) === q) items = [];
  }
  if (!items.length) return (ac.hidden = true);
  ac.innerHTML = `<div class="ct-ah">${esc(title)}</div>${items.slice(0, 40).map((x, i) => `<div class="ct-ai${i === 0 ? ' on' : ''}${x.k === 'tag' ? ' ct-at' : ''}" data-i="${i}">${x.k === 'tag' ? `<span><b>${x.hl}</b><em>${esc(x.eq)}</em></span><small>${esc(x.r || '')}</small>` : `<span>${esc(x.l)}</span><small>${esc(x.r || '')}</small>`}</div>`).join('')}`;
  ac.hidden = false;
  /* place under the caret: approximate by line / column */
  const mm = document.getElementById('ctMeasure') || (ctGutter(), document.getElementById('ctMeasure'));
  mm.style.width = tx.clientWidth + 'px';
  mm.innerHTML = `<div>${esc(before)}<span id="ctCaret">&#8203;</span></div>`;
  const c = document.getElementById('ctCaret'),
    mr = mm.getBoundingClientRect(),
    cr = c.getBoundingClientRect();
  const x = cr.left - mr.left + 38,
    y = cr.top - mr.top + 8 + 21 - tx.scrollTop;
  const W = tx.clientWidth + 38;
  ac.style.top = Math.max(8, Math.min(y, tx.clientHeight - 30)) + 'px';
  ac.style.left = Math.max(40, Math.min(x, W - 336)) + 'px';
  ctGutter();
  ac._items = items;
  ac._from = from;
  $$('#ctAc .ct-ai').forEach(d => (d.onmousedown = e => (e.preventDefault(), ctPick(+d.dataset.i))));
}
/* tag search for plain typing: "cyc" → Cycle no on MX-1. Word-start matches first, selected equipment first. */
let CT_TIX = null;
function ctTagIndex() {
  if (CT_TIX && CT_TIX.n === Object.keys(REG).length) return CT_TIX.list;
  const list = [];
  DOC.blocks.forEach(b => b.name && ctEquipTags(b).forEach(id => !REG[id].calc && list.push({ id, b, n: ctTagName(id), s: (ctTagName(id) + ' ' + (REG[id].desc || '') + ' ' + id).toLowerCase() })));
  CT_TIX = { n: Object.keys(REG).length, list };
  return list;
}
function ctTagSearch(raw, sel) {
  const q = raw.toLowerCase().trim(),
    words = q.split(/\s+/),
    selIds = new Set(sel.map(b => b.id)),
    out = [];
  for (const x of ctTagIndex()) {
    if (!words.every(w => x.s.includes(w))) continue;
    const nl = x.n.toLowerCase();
    const score = (selIds.has(x.b.id) ? 0 : 100) + (nl.startsWith(q) ? 0 : new RegExp('(^|[^a-z0-9])' + words[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(nl) ? 10 : 30) + nl.length / 100;
    const i = nl.indexOf(words[0]);
    const hl = i < 0 ? esc(x.n) : esc(x.n.slice(0, i)) + '<u>' + esc(x.n.slice(i, i + words[0].length)) + '</u>' + esc(x.n.slice(i + words[0].length));
    out.push({ score, t: `[${x.b.name}].[${x.n}]`, l: x.n, hl, eq: x.b.name, r: tagTxt(x.id), k: 'tag', add: selIds.has(x.b.id) ? null : x.b.id });
  }
  return out.sort((a, z) => a.score - z.score);
}
function ctPick(i) {
  const tx = $('#ctTx'),
    ac = $('#ctAc'),
    x = ac._items && ac._items[i];
  if (!x) return;
  const p = tx.selectionStart;
  tx.value = tx.value.slice(0, ac._from) + x.t + tx.value.slice(p);
  const np = ac._from + x.t.length;
  tx.setSelectionRange(np, np);
  ac.hidden = true;
  CTE.expr = tx.value;
  if (x.add && !(CTE.equip || []).includes(x.add)) {
    if (CTE.mode === 'one' && (CTE.equip || []).length) CTE.mode = 'multi';
    CTE.equip = [...(CTE.equip || []), x.add];
    const keep = tx.value, cp = np;
    ctRender();
    const t2 = $('#ctTx');
    t2.value = keep;
    t2.focus();
    t2.setSelectionRange(cp, cp);
    CTE.expr = keep;
    toast(`${B(x.add).name} added to the equipment`);
  }
  ctCheck();
  if (x.t.endsWith('[')) ctAuto();
}
function ctBind() {
  const C = CTE,
    tx = $('#ctTx'),
    hl = $('#ctHl'),
    ln = $('#ctLn'),
    ac = $('#ctAc');
  $$('[data-ctf]').forEach(x => (x.oninput = () => {
    const k = x.dataset.ctf;
    C[k] = x.type === 'number' ? (x.value === '' ? '' : +x.value) : x.value;
    if (k === 'unit' || k === 'd') ctCheck();
  }));
  $$('[data-ctm]').forEach(b => (b.onclick = () => {
    C.mode = b.dataset.ctm;
    if (C.mode === 'one' && C.equip.length > 1) C.equip = C.equip.slice(0, 1);
    ctRender();
  }));
  $$('[data-ctx]').forEach(i => (i.onclick = () => ((C.equip = C.equip.filter(x => x !== i.dataset.ctx)), ctRender())));
  $$('#ctTabs [data-ctt]').forEach(b => (b.onclick = () => ctPane(b.dataset.ctt)));
  /* equipment picker */
  const q = $('#ctEqQ'),
    dd = $('#ctDd');
  const showDd = () => {
    const G = ctEquipGroups(),
      s = q.value.trim().toLowerCase();
    let h = '';
    for (const [g, list] of Object.entries(G)) {
      const L = list.filter(b => !s || b.name.toLowerCase().includes(s) || (EQ[b.type].n || '').toLowerCase().includes(s));
      if (!L.length) continue;
      h += `<div class="ct-dg">${esc(g)}</div>` + L.map(b => `<div class="ct-do" data-eid="${b.id}"><span class="ct-cbx${C.equip.includes(b.id) ? ' on' : ''}">${C.equip.includes(b.id) ? '✓' : ''}</span>${esc(b.name)}<small>${esc(EQ[b.type].n || '')} · ${ctEquipTags(b).length} tags</small></div>`).join('');
    }
    const types = {};
    DOC.blocks.forEach(b => b.name && b.tags && b.tags.length && (types[b.type] = (types[b.type] || 0) + 1));
    const multi = Object.entries(types).filter(([t, n]) => n > 1 && (!s || (EQ[t].n || '').toLowerCase().includes(s)));
    dd.innerHTML = (h || '<div class="ct-do">No equipment found</div>') + (multi.length ? `<div class="ct-df">${multi.slice(0, 4).map(([t, n]) => `<button type="button" data-ety="${t}">Select all ${n} ${esc(EQ[t].n || t)}</button>`).join('')}<button type="button" id="ctDdOk">Done</button></div>` : '<div class="ct-df"><button type="button" id="ctDdOk">Done</button></div>');
    dd.hidden = false;
    $$('#ctDd [data-eid]').forEach(o => (o.onmousedown = e => {
      e.preventDefault();
      const id = o.dataset.eid;
      C.equip = C.mode === 'one' ? [id] : C.equip.includes(id) ? C.equip.filter(x => x !== id) : [...C.equip, id];
      if (C.mode === 'one') return ctRender();
      showDd();
      ctChips();
    }));
    $$('#ctDd [data-ety]').forEach(o => (o.onmousedown = e => {
      e.preventDefault();
      if (C.mode === 'one') C.mode = 'several';
      C.equip = [...new Set([...C.equip, ...DOC.blocks.filter(b => b.type === o.dataset.ety && b.name).map(b => b.id)])];
      ctRender();
    }));
    const ok = $('#ctDdOk');
    if (ok) ok.onmousedown = e => (e.preventDefault(), ctRender());
  };
  q.onfocus = showDd;
  q.oninput = showDd;
  q.onblur = () => setTimeout(() => {
    if (document.activeElement !== q && dd && !dd.matches(':hover')) {
      dd.hidden = true;
      ctRender();
    }
  }, 150);
  /* formula editor */
  const sync = () => {
    hl.scrollTop = tx.scrollTop;
    hl.scrollLeft = tx.scrollLeft;
    ln.scrollTop = tx.scrollTop;
  };
  tx.onscroll = sync;
  tx.oninput = () => {
    ctCheck();
    ctAuto();
    sync();
  };
  tx.onclick = () => (ac.hidden = true);
  tx.onblur = () => setTimeout(() => (ac.hidden = true), 150);
  tx.onkeydown = e => {
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      return ctAuto(true);
    }
    if (!ac.hidden) {
      const it = $$('#ctAc .ct-ai'),
        cur = it.findIndex(x => x.classList.contains('on'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = (cur + (e.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length;
        it.forEach((x, i) => x.classList.toggle('on', i === n));
        it[n].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        return ctPick(cur < 0 ? 0 : cur);
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        return (ac.hidden = true);
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      ctInsert('  ');
    }
  };
  $('#ctShow').onchange = e => (C.show = e.target.checked);
  $('#ctCancel').onclick = () => ((CTE = null), closeModal());
  const del = $('#ctDel');
  if (del)
    del.onclick = () => {
      const o = ctDoc().find(c => c.id === C.id);
      if (!o) return;
      pushUndo();
      ctUnregister(o);
      DOC.calc = ctDoc().filter(c => c.id !== C.id);
      changed();
      renderCanvas();
      closeModal();
      toast(`Calculated tag “${o.name}” deleted`);
      ctList();
    };
  $('#ctSave').onclick = ctSave;
  /* live result while the editor is open */
  clearInterval(ctBind.t);
  ctBind.t = setInterval(() => {
    if (!$('#ctTx')) return clearInterval(ctBind.t);
    if (document.activeElement !== $('#ctTx') || $('#ctAc').hidden) ctCheck();
  }, 1000);
}
function ctChips() {
  const ms = $('#ctMs'),
    q = $('#ctEqQ');
  if (!ms) return;
  ms.querySelectorAll('.ct-ch').forEach(x => x.remove());
  (CTE.equip || []).map(B).filter(Boolean).forEach(b => q.insertAdjacentHTML('beforebegin', `<span class="ct-ch">${esc(b.name)}<i data-ctx="${b.id}" title="Remove">✕</i></span>`));
  $$('[data-ctx]').forEach(i => (i.onmousedown = e => (e.preventDefault(), (CTE.equip = CTE.equip.filter(x => x !== i.dataset.ctx)), ctRender())));
}
function ctSave() {
  const C = CTE;
  C.name = String(C.name || '').trim().slice(0, 80);
  if (!C.name) return toast('Give the tag a name');
  if (!(C.equip || []).length) return toast('Choose at least one equipment');
  ctCheck();
  if (CT_ERRS.some(e => !/division by zero|LN of|LOG|SQRT|group/.test(e.message))) return toast('Fix the formula errors first');
  const slug = C.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'CALC';
  const first = B(C.equip[0]);
  let tid = String(C.tagId || '').trim().toUpperCase().replace(/[^A-Z0-9_.\-]/g, '_');
  if (!tid && C.mode !== 'each') {
    tid = (C.mode === 'one' && first ? first.name + '.' : 'CALC.') + slug;
    for (let k = 2; REG[tid] && REG[tid].calc !== C.id; k++) tid = tid.replace(/_\d+$/, '') + '_' + k;
  }
  if (!tid && C.mode === 'each') tid = slug;
  if (tid && C.mode !== 'each') {
    const clash = REG[tid] && REG[tid].calc !== C.id;
    if (clash) return toast(`Tag ID ${tid} is already used`);
    C.tagId = tid;
  } else if (C.mode === 'each') {
    C.tagId = '';
    if (tid) C.id = tid.replace(/\./g, '_');
  }
  pushUndo();
  const old = ctDoc().find(c => c.id === C.id || (CTE.isNew === undefined && c.id === C.id));
  if (old) ctUnregister(old);
  const clean = { id: C.id, name: C.name, tagId: C.tagId || '', unit: String(C.unit || '').slice(0, 16), d: C.d === '' ? 2 : +C.d, equip: C.equip.slice(0, 60), mode: C.mode, expr: String(C.expr || '').slice(0, 4000), ll: C.ll, lo: C.lo, opt: C.opt, hi: C.hi, hh: C.hh, show: C.show !== false };
  DOC.calc = ctDoc().filter(c => c.id !== C.id).concat([clean]);
  ctRegister(clean);
  CT_COMP.clear();
  ctTick();
  changed();
  renderCanvas();
  closeModal();
  CTE = null;
  if (typeof window.CT_AFTER === 'function') {
    const inst = ctInstances(clean),
      f = window.CT_AFTER;
    window.CT_AFTER = null;
    try {
      f((inst.find(i => i.b && clean.equip[0] === i.b.id) || inst[0]).id);
    } catch (e) {}
  }
  toast(`Calculated tag “${clean.name}” saved — ${ctInstances(clean).length > 1 ? ctInstances(clean).length + ' tags' : ctInstances(clean)[0].id}`);
}

/* ---------- list of calculated tags ---------- */
function ctList() {
  const L = ctDoc();
  const row = C =>
    ctInstances(C)
      .map((I, k) => {
        const t = REG[I.id],
          r = CT_LAST[I.id] || {},
          v = VAL[I.id] ? VAL[I.id].v : null;
        const st = r.errs && r.errs.length ? '<span class="chip sv3">Formula error</span>' : v == null ? '<span class="chip">No data</span>' : t && ((t.lo != null && v < t.lo) || (t.hi != null && v > t.hi)) ? '<span class="chip sv3">Out of limits</span>' : '<span class="chip sv0">OK</span>';
        return `<tr><td>${k ? '' : `<b>${esc(C.name)}</b>`}<div class="mono note">${esc(I.id)}</div></td><td>${k ? '' : esc(C.mode === 'each' ? 'Each equipment' : C.mode === 'one' ? 'One equipment' : 'Several equipment')}</td><td class="mono">${v == null ? '—' : esc(fmtN(v, C.d)) + ' ' + esc(C.unit || '')}</td><td>${st}</td><td>${k ? '' : `<button class="ib" data-cte="${C.id}">Edit</button>`}</td></tr>`;
      })
      .join('');
  openModal(
    `<h3>Calculated tags</h3><div class="note">Formulas over existing tags — like calculated fields. Each one is a tag: on the drawing (ƒx), in Parameters monitoring, charts, Engineered alerts and as an animation driver.</div>
   <div class="tbl-wrap" style="max-height:56vh;overflow:auto;margin-top:10px">${L.length ? `<table class="an-t"><thead><tr><th>Tag</th><th>Applies to</th><th>Now</th><th>Status</th><th></th></tr></thead><tbody>${L.map(row).join('')}</tbody></table>` : '<p class="note" style="padding:14px">No calculated tags yet.</p>'}</div>
   <div class="mact"><button class="ib" id="ctLClose">Close</button><button class="ib pri" id="ctLNew">+ New calculated tag</button></div>`,
    'wide',
  );
  $('#ctLClose').onclick = closeModal;
  $('#ctLNew').onclick = () => ctOpen(null);
  $$('#mbox [data-cte]').forEach(b => (b.onclick = () => ctOpen(b.dataset.cte)));
}

/* ---------- entry points: Data ribbon button + tag label badge ---------- */
(function ctButton() {
  const add = () => {
    const P = document.querySelector('.rpanel[data-rp="data"] .grp .gi');
    if (!P || document.getElementById('bCalc')) return;
    P.insertAdjacentHTML(
      'beforeend',
      `<button class="ib rbig xb" id="bCalc" title="Calculated tags — formulas over existing tags (like calculated fields)"><svg class="dt" viewBox="0 0 24 24" style="--c:#6d28d9" aria-hidden="true"><path class="f" d="M4 4h16v16H4z"/><path class="s" d="M4 4h16v16H4z"/><path class="s" d="M14 7h-2.2a1.8 1.8 0 0 0-1.8 1.8V17"/><path class="s" d="M8.5 11.5h5"/><path class="s" d="M14 13l3 4M17 13l-3 4"/></svg><span class="rl">Calculated<br>tags</span></button>`,
    );
    document.getElementById('bCalc').onclick = ctList;
  };
  add();
  setTimeout(add, 1500);
})();
document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
.ct-h{display:flex;align-items:center;gap:10px;margin-bottom:8px}.ct-h h3{margin:0}.ct-chip{font:700 10.5px var(--sans);letter-spacing:.06em;padding:3px 8px;border-radius:10px;background:#ede9fe;color:#5b21b6}
.ct-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px}
.ct-row{display:grid;grid-template-columns:112px minmax(0,1fr);gap:10px;align-items:center;margin:8px 0}.ct-row.ct-top{align-items:start}.ct-row>label{font:600 12px var(--sans);color:var(--muted)}.ct-top>label{padding-top:8px}
.ct-in{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:7px;padding:7px 9px;font:13px var(--sans);background:var(--panel);color:var(--text)}
.ct-2{display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:center}.ct-2b{display:grid;grid-template-columns:90px 1fr;gap:12px;align-items:center}.ct-3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.ct-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr}.ct-seg button{font-size:12px;white-space:nowrap}
.ct-cb{font-size:12.5px;display:flex;gap:6px;align-items:center;color:var(--text)}
.ct-ms{position:relative;display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1.5px solid #2563eb;border-radius:8px;padding:5px 6px;min-height:38px;background:var(--panel)}
.ct-ms input{border:0;outline:0;flex:1;min-width:140px;font:13px var(--sans);background:transparent;color:var(--text)}
.ct-ch{background:#e0e7ff;color:#1e3a8a;border-radius:6px;padding:3px 8px;font:700 12.5px var(--sans)}.ct-ch i{font-style:normal;margin-left:6px;color:#64748b;cursor:pointer}
.ct-dd{position:absolute;left:0;top:calc(100% + 4px);width:min(460px,100%);max-height:320px;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:9px;box-shadow:0 12px 30px rgba(0,0,0,.18);z-index:30}
.ct-dg{padding:5px 10px;font:700 11px var(--sans);letter-spacing:.06em;color:var(--muted);background:var(--bg2,#f8fafc);text-transform:uppercase}
.ct-do{display:flex;gap:8px;align-items:center;padding:6px 10px;cursor:pointer;font-size:13px}.ct-do:hover{background:#eef2ff}.ct-do small{margin-left:auto;color:var(--muted);font-size:11.5px}
.ct-cbx{width:15px;height:15px;border:1.5px solid #94a3b8;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex:none}.ct-cbx.on{background:#2563eb;border-color:#2563eb;color:#fff}
.ct-df{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:space-between;padding:7px 10px;border-top:1px solid var(--line);background:var(--panel)}.ct-df button{border:0;background:none;color:#1f6feb;font:700 12px var(--sans);cursor:pointer}
.ct-box{border:1.5px solid #6366f1;border-radius:9px;overflow:hidden;background:var(--panel)}.ct-box.bad{border-color:#dc2626}.ct-box.ok{border-color:#16a34a}
.ct-bt{display:flex;justify-content:space-between;padding:6px 10px;background:var(--bg2,#f8fafc);border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)}.ct-bt b{color:var(--text)}
.ct-ed{position:relative;display:grid;grid-template-columns:38px minmax(0,1fr);height:230px}
.ct-ln{margin:0;padding:8px 6px 8px 0;text-align:right;color:#94a3b8;background:var(--bg2,#f8fafc);border-right:1px solid var(--line);font:14px/21px var(--mono);overflow:hidden;user-select:none}
.ct-wrap{position:relative;overflow:hidden}
.ct-hl,.ct-wrap textarea,.ct-measure>div{margin:0;padding:0 10px;font:14px/21px var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2;border:0;box-sizing:border-box}
.ct-hl,.ct-wrap textarea{position:absolute;inset:0;padding:8px 10px;overflow-y:auto;overflow-x:hidden}
.ct-measure{position:absolute;left:-9999px;top:0;visibility:hidden;box-sizing:border-box}
.ct-ln div{padding-right:2px}
.ct-hl{color:var(--text);pointer-events:none}.ct-wrap textarea{background:transparent;color:transparent;caret-color:var(--text);resize:none;outline:0}
.ct-fn{color:#7c3aed;font-weight:700}.ct-tg{color:#0369a1;font-weight:700}.ct-nu{color:#b45309}.ct-tm{color:#b45309;font-weight:700}.ct-cm{color:#94a3b8}.ct-kw{color:#be185d;font-weight:700}.ct-va{color:#0f766e}
u.ct-e{text-decoration:underline wavy #dc2626;text-underline-offset:4px;text-decoration-skip-ink:none}
.ct-msg{border-top:1px solid var(--line);padding:8px 12px;font-size:12.5px;min-height:34px}.ct-box.bad .ct-msg{background:#fef2f2;color:#991b1b}.ct-box.bad .ct-msg b{color:#b91c1c}
.ct-fix{border:0;background:none;color:#1f6feb;font:700 12px var(--sans);cursor:pointer;padding:0 4px}
.ct-okt{color:#15803d;font-weight:700}.ct-w{color:#b45309;margin-bottom:4px}
.ct-steps{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;font-size:12.5px}.ct-steps code{font:700 12.5px var(--mono);color:#0f766e}
.ct-at span{display:flex;flex-direction:column}.ct-at b{font-weight:600}.ct-at u{text-decoration:none;background:#fde68a;border-radius:2px}.ct-at em{font-style:normal;font-size:11px;color:var(--muted)}
.ct-ac{position:absolute;z-index:20;width:360px;max-height:240px;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 24px rgba(0,0,0,.16);font-size:12.5px}
.ct-ah{padding:5px 10px;font:700 11px var(--sans);letter-spacing:.06em;color:var(--muted);background:var(--bg2,#f8fafc)}
.ct-ai{display:flex;justify-content:space-between;gap:10px;padding:5px 10px;cursor:pointer}.ct-ai.on,.ct-ai:hover{background:#eef2ff}.ct-ai small{color:var(--muted)}
.ct-r{border:1px solid var(--line);border-radius:9px;overflow:hidden;display:flex;flex-direction:column;max-height:620px}
.ct-tabs{display:flex;border-bottom:1px solid var(--line)}.ct-tabs button{flex:1;border:0;background:none;padding:8px;font:700 12px var(--sans);color:var(--muted);cursor:pointer}.ct-tabs button.on{color:#1f6feb;box-shadow:inset 0 -2px #1f6feb}
.ct-pane{padding:8px;overflow:auto}.ct-tl{margin-top:6px}
.ct-eq{padding:6px 6px 4px;font:700 12px var(--sans);color:var(--text);border-top:1px solid var(--line);margin-top:4px}.ct-eq small{font-weight:400;color:var(--muted)}
.ct-ti{display:flex;justify-content:space-between;gap:8px;padding:3px 6px 3px 14px;cursor:pointer;font:12.5px var(--mono);color:#0369a1;border-radius:5px}.ct-ti:hover,.ct-fi:hover,.ct-ex:hover{background:#eef2ff}.ct-ti b{font:700 11.5px var(--sans);color:#0f766e;white-space:nowrap}
.ct-fi{padding:4px 6px 4px 14px;cursor:pointer;border-radius:5px}.ct-fi code{display:block;font:700 12px var(--mono);color:#7c3aed}.ct-fi small{color:var(--muted)}
.ct-labs{cursor:pointer}.ct-lb{fill:#fff;stroke:#c4b5fd;stroke-width:1}.ct-lf{fill:#6d28d9}.ct-lx{fill:#fff;font:700 12px var(--mono)}
.ct-ln2{fill:#64748b;font:600 9.5px var(--sans)}.ct-lv{fill:#0f172a;font:700 12.5px var(--mono)}
.ct-lab.bad .ct-lb{stroke:#fca5a5}.ct-lab.bad .ct-lf{fill:#b91c1c}.ct-lab.bad .ct-lv{fill:#b91c1c}.ct-lab.nd .ct-lv{fill:#94a3b8}
.ct-ex{border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-bottom:6px;cursor:pointer}.ct-ex pre{margin:3px 0 0;font:11.5px var(--mono);white-space:pre-wrap;color:var(--muted)}
</style>`,
);

/* v10.4 — calculated fields without LL / HH still reach Critical (and email):
   an empty LL / HH is set automatically 25 % of the L–H band beyond L / H (one-sided: 10 % of |limit|). */
function ctAutoCrit(C) {
  const n = x => (x != null && x !== '' && isFinite(+x) ? +x : null);
  const lo = n(C.lo),
    hi = n(C.hi),
    r = v => +(+v).toPrecision(4);
  const band = lo != null && hi != null && hi > lo ? hi - lo : null;
  return {
    ll: lo == null ? null : r(lo - (band != null ? band * 0.25 : Math.abs(lo) * 0.1 || 1)),
    hh: hi == null ? null : r(hi + (band != null ? band * 0.25 : Math.abs(hi) * 0.1 || 1)),
  };
}
