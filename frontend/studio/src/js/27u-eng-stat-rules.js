/*! SandMan Digital Loop Studio — 27u-eng-stat-rules.js
 *  v10.4 — statistical conditions for Engineered alerts (27g), next to the fixed limits (below / above / outside):
 *   · 'sig'   out of control — the value is outside mean ± k·σ of its last N readings (default 3σ, 60 readings)
 *   · 'trend' trend / drift — N readings in a row each higher (or each lower) than the one before (default 6)
 *   · 'roc'   rate of change — moves more than X per minute, measured over the last W seconds (default 60 s)
 *  Readings are sampled once a second per rule and variable (A–D and the calculation X); a tag's own history is used to
 *  start, so 3σ works straight away. A statistical condition stays "not yet" (no alert) until it has enough readings.
 *  Data-science rules (v10.4, same place) — "normal" is learned from a rolling window of the latest readings:
 *   · 'spc'     control-chart rules: Western Electric (1, 2, 5, 6) or all 8 Nelson rules on the variable
 *   · 'ewma'    EWMA — exponentially weighted average outside its control limits (small, slow shifts)
 *   · 'cusum'   CUSUM — accumulated drift away from the mean beyond h·σ (small, persistent shifts)
 *   · 'predict' predicted limit breach — straight-line fit of the recent readings reaches a limit within N minutes
 *   · 'rel'     relationship broken — the variable no longer follows another one as it did (regression residual)
 *   · 't2'      multivariate anomaly — Hotelling T² of all variables A–D together (each may look normal alone)
 *  A reading is taken when the tag's value is new (its timestamp changed), at most once a second; lab tags therefore
 *  count each test once. Stored in the rule's conds: { l, op, v, v2, v3, l2 }. */

const ENG_STAT = {
  sig: { name: 'out of control (±σ)', v: 3, v2: 60 },
  trend: { name: 'trending (rising / falling)', v: 6 },
  roc: { name: 'changing faster than', v: 1, v2: 60 },
  spc: { name: 'control-chart rules (SPC)', v: 1, v2: 300 },
  ewma: { name: 'EWMA drift', v: 0.2, v2: 300 },
  cusum: { name: 'CUSUM shift', v: 5, v2: 300 },
  predict: { name: 'will cross a limit', v: null, v2: 30, v3: 60 },
  rel: { name: 'relationship broken', v: 3, v2: 300 },
  t2: { name: 'multivariate anomaly (T²)', v: null, v2: 300 },
};
Object.assign(ENG_STAT, {
  avgabove: { name: 'average of last N min above', v: null, v2: 15 },
  avgbelow: { name: 'average of last N min below', v: null, v2: 15 },
  maxabove: { name: 'highest in last N min above', v: null, v2: 15 },
  minbelow: { name: 'lowest in last N min below', v: null, v2: 15 },
  delta: { name: 'changed by more than', v: null, v2: 15 },
  count: { name: 'above X more than K times in N min', v: null, v2: 60, v3: 3 },
  stuck: { name: 'not changing for', v: 10 },
  nodata: { name: 'no new data for', v: 10 },
});
const ENG_MAX = 3600;
const ENG_BUF = {}; // 'rule|var' → [{t, v}]
function engBuf(r, k, id, v, now) {
  const key = r.id + '|' + k;
  let b = ENG_BUF[key];
  if (!b) {
    b = ENG_BUF[key] = [];
    const h = id && VAL[id] && VAL[id].h;
    if (h && h.length) h.slice(-300).forEach(p => p && p.v != null && isFinite(p.v) && b.push({ t: p.t, v: +p.v }));
  }
  const last = b[b.length - 1],
    ts = id && VAL[id] && VAL[id].ts;
  const fresh = ts ? b._ts !== ts : true;
  if (v != null && isFinite(v) && fresh && (!last || now - last.t >= 950)) {
    b._ts = ts;
    b.push({ t: now, v });
    if (b.length > ENG_MAX) b.splice(0, b.length - ENG_MAX);
  }
  return b;
}
function engStatTest(c, b, v) {
  if (v == null || !isFinite(v)) return null;
  if (c.op === 'sig') {
    const n = Math.max(10, Math.min(ENG_MAX, +c.v2 || 60)),
      k = +c.v || 3,
      w = b.slice(-n - 1, -1);
    if (w.length < 10) return false; // not enough readings yet
    const m = w.reduce((s, p) => s + p.v, 0) / w.length,
      sd = Math.sqrt(w.reduce((s, p) => s + (p.v - m) ** 2, 0) / (w.length - 1));
    if (!(sd > 0)) return false;
    c._st = { m, sd };
    return Math.abs(v - m) > k * sd;
  }
  if (c.op === 'trend') {
    const n = Math.max(3, Math.min(50, +c.v || 6));
    const s = [];
    for (let i = b.length - 1; i >= 0 && s.length < n; i--) if (!s.length || b[i].v !== s[s.length - 1]) s.push(b[i].v); // readings that changed
    if (s.length < n) return false;
    let up = true,
      dn = true;
    for (let i = 0; i < n - 1; i++) {
      if (!(s[i] > s[i + 1])) up = false;
      if (!(s[i] < s[i + 1])) dn = false;
    }
    c._st = { dir: up ? 'rising' : dn ? 'falling' : '' };
    return up || dn;
  }
  if (c.op === 'roc') {
    const win = Math.max(10, Math.min(3600, +c.v2 || 60)) * 1000,
      now = b.length ? b[b.length - 1].t : Date.now(),
      old = b.find(p => p.t >= now - win);
    if (!old || now - old.t < win * 0.5) return false;
    const rate = ((v - old.v) / (now - old.t)) * 60000;
    c._st = { rate };
    return Math.abs(rate) > Math.abs(+c.v || 0);
  }
  /* over a time window (minutes) */
  const now = Date.now();
  const inWin = m => b.filter(p => now - p.t <= m * 60000);
  if (['avgabove', 'avgbelow', 'maxabove', 'minbelow'].includes(c.op)) {
    if (c.v == null || c.v === '') return (c._st = { wait: 'set the value' }), false;
    const w = inWin(+c.v2 > 0 ? +c.v2 : 15).map(p => p.v);
    if (!w.length) return (c._st = { wait: 'no readings in the window yet' }), false;
    const a = c.op.startsWith('avg') ? w.reduce((x, y) => x + y, 0) / w.length : c.op === 'maxabove' ? Math.max(...w) : Math.min(...w);
    c._st = { agg: a, n: w.length };
    return c.op === 'avgabove' || c.op === 'maxabove' ? a > +c.v : a < +c.v;
  }
  if (c.op === 'delta') {
    if (c.v == null || c.v === '') return (c._st = { wait: 'set the change' }), false;
    const m = +c.v2 > 0 ? +c.v2 : 15,
      old = b.find(p => now - p.t <= m * 60000);
    if (!old || now - old.t < m * 60000 * 0.5) return (c._st = { wait: 'collecting the window' }), false;
    c._st = { d: v - old.v };
    return Math.abs(v - old.v) > Math.abs(+c.v);
  }
  if (c.op === 'count') {
    if (c.v == null || c.v === '') return (c._st = { wait: 'set the value' }), false;
    const w = inWin(+c.v2 > 0 ? +c.v2 : 60);
    let n = 0;
    for (let i = 0; i < w.length; i++) if (w[i].v > +c.v && (i === 0 || w[i - 1].v <= +c.v)) n++; // separate excursions
    c._st = { cnt: n };
    return n > (+c.v3 >= 0 ? +c.v3 : 3);
  }
  if (c.op === 'stuck') {
    const m = +c.v > 0 ? +c.v : 10,
      w = b.filter(p => now - p.t <= m * 60000);
    const span = b.length ? now - b[0].t : 0;
    if (span < m * 60000) return (c._st = { wait: 'watching for ' + m + ' min' }), false;
    const same = w.every(p => p.v === v);
    c._st = { same };
    return same;
  }
  if (c.op === 'spc' || c.op === 'ewma' || c.op === 'cusum') {
    const keep = c.op === 'spc' ? 15 : c.op === 'ewma' ? 50 : 100;
    const n = Math.max(30, Math.min(ENG_MAX, +c.v2 || 300));
    const base = b.slice(-(n + keep), -keep);
    if (base.length < 30) return (c._st = { wait: `learning ${base.length}/30` }), false;
    const { m, sd } = engMS(base.map(p => p.v));
    if (!(sd > 0)) return (c._st = { wait: 'no variation' }), false;
    const xs = b.slice(-keep).map(p => p.v),
      z = xs.map(x => (x - m) / sd);
    if (c.op === 'spc') {
      const hit = engNelson(z, +c.v === 2);
      c._st = { m, sd, rule: hit };
      return !!hit;
    }
    if (c.op === 'ewma') {
      const lam = clamp(+c.v || 0.2, 0.05, 1);
      let e = m;
      xs.forEach(x => (e = lam * x + (1 - lam) * e));
      const lim = 3 * sd * Math.sqrt(lam / (2 - lam));
      c._st = { m, sd, e, lim };
      return Math.abs(e - m) > lim;
    }
    const h = +c.v > 0 ? +c.v : 5;
    let hi = 0,
      lo = 0;
    z.forEach(q => ((hi = Math.max(0, hi + q - 0.5)), (lo = Math.max(0, lo - q - 0.5))));
    c._st = { m, sd, hi, lo };
    return hi > h || lo > h;
  }
  if (c.op === 'predict') {
    const n = Math.max(10, Math.min(ENG_MAX, +c.v3 || 60)),
      w = b.slice(-n);
    if (w.length < 10 || c.v == null || c.v === '') return (c._st = { wait: c.v == null || c.v === '' ? 'set the limit' : `learning ${w.length}/10` }), false;
    const t0 = w[0].t,
      X = w.map(p => (p.t - t0) / 60000),
      Y = w.map(p => p.v);
    const f = engFit(X, Y);
    if (!f) return false;
    const L = +c.v,
      nowX = X[X.length - 1],
      cur = f.a + f.b * nowX;
    const eta = f.b !== 0 ? (L - cur) / f.b : Infinity; // minutes from now
    const already = (f.b > 0 && cur >= L) || (f.b < 0 && cur <= L);
    c._st = { slope: f.b, r2: f.r2, eta: eta > 0 ? eta : null };
    return f.r2 >= 0.5 && !already && eta > 0 && eta <= (+c.v2 > 0 ? +c.v2 : 30);
  }
  return null;
}
/* ---------- maths ---------- */
function engMS(a) {
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return { m, sd: Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)) };
}
function engFit(X, Y) {
  const n = X.length,
    mx = X.reduce((s, x) => s + x, 0) / n,
    my = Y.reduce((s, y) => s + y, 0) / n;
  let sxx = 0,
    sxy = 0,
    syy = 0;
  for (let i = 0; i < n; i++) (sxx += (X[i] - mx) ** 2), (sxy += (X[i] - mx) * (Y[i] - my)), (syy += (Y[i] - my) ** 2);
  if (!(sxx > 0)) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 0, r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0 };
}
/* Nelson rules on z-scores (oldest first). Western Electric = rules 1, 2 (here 8 in a row as WE), 5, 6. */
function engNelson(z, all) {
  const N = z.length,
    last = k => z.slice(-k);
  const side = a => a.every(q => q > 0) || a.every(q => q < 0);
  if (Math.abs(z[N - 1]) > 3) return '1 · beyond 3σ';
  if (N >= 9 && side(last(9))) return '2 · 9 on one side of the mean';
  if (!all && N >= 8 && side(last(8))) return '2 · 8 on one side of the mean';
  const nOf = (k, need, lim) => {
    const a = last(k);
    return a.filter(q => q > lim).length >= need || a.filter(q => q < -lim).length >= need;
  };
  if (N >= 3 && nOf(3, 2, 2)) return '5 · 2 of 3 beyond 2σ';
  if (N >= 5 && nOf(5, 4, 1)) return '6 · 4 of 5 beyond 1σ';
  if (!all) return '';
  if (N >= 6) {
    const a = last(6);
    let up = true,
      dn = true;
    for (let i = 1; i < 6; i++) (up = up && a[i] > a[i - 1]), (dn = dn && a[i] < a[i - 1]);
    if (up || dn) return '3 · 6 rising or falling';
  }
  if (N >= 14) {
    const a = last(14);
    let alt = true;
    for (let i = 2; i < 14; i++) alt = alt && (a[i] - a[i - 1]) * (a[i - 1] - a[i - 2]) < 0;
    if (alt) return '4 · 14 alternating up and down';
  }
  if (N >= 15 && last(15).every(q => Math.abs(q) < 1)) return '7 · 15 within 1σ (too steady — check the sensor)';
  if (N >= 8 && last(8).every(q => Math.abs(q) > 1)) return '8 · 8 beyond 1σ on both sides';
  return '';
}
/* joint readings of several variables (relationship, T²) */
const ENG_JB = {};
const ENG_ST0 = {};
function engJoint(r, key, ks, V, now) {
  const b = (ENG_JB[r.id + '|' + key] = ENG_JB[r.id + '|' + key] || []);
  const vals = ks.map(k => V[k]);
  if (vals.some(x => x == null || !isFinite(x))) return b;
  const stamp = ks.map(k => (r.vars && r.vars[k] && VAL[r.vars[k]] && VAL[r.vars[k]].ts) || '').join('|');
  const last = b[b.length - 1];
  if ((!stamp.replace(/\|/g, '') || b._ts !== stamp) && (!last || now - last.t >= 950)) {
    b._ts = stamp;
    b.push({ t: now, x: vals });
    if (b.length > ENG_MAX) b.splice(0, b.length - ENG_MAX);
  }
  return b;
}
function engInv(M) {
  const n = M.length,
    A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    const d = A[i][i];
    if (Math.abs(d) < 1e-12) return null;
    for (let j = 0; j < 2 * n; j++) A[i][j] /= d;
    for (let k = 0; k < n; k++)
      if (k !== i) {
        const f = A[k][i];
        for (let j = 0; j < 2 * n; j++) A[k][j] -= f * A[i][j];
      }
  }
  return A.map(row => row.slice(n));
}
const ENG_CHI99 = { 2: 9.21, 3: 11.34, 4: 13.28, 5: 15.09 };
function engJointTest(r, c, V, now) {
  if (c.op === 'rel') {
    const y = c.l,
      x = c.l2;
    if (!x || x === y) return (c._st = { wait: 'choose the other variable' }), false;
    const b = engJoint(r, 'rel:' + y + ':' + x, [x, y], V, now);
    const n = Math.max(30, Math.min(ENG_MAX, +c.v2 || 300)),
      base = b.slice(-(n + 30), -30);
    if (base.length < 30) return (c._st = { wait: `learning ${base.length}/30` }), false;
    const f = engFit(base.map(p => p.x[0]), base.map(p => p.x[1]));
    if (!f || Math.abs(f.r) < 0.3) return (c._st = { wait: `no clear link learned (r = ${f ? f.r.toFixed(2) : '—'})`, r: f && f.r }), false;
    const res = base.map(p => p.x[1] - (f.a + f.b * p.x[0])),
      sd = engMS(res).sd;
    const cur = b.slice(-3),
      z = cur.map(p => (p.x[1] - (f.a + f.b * p.x[0])) / (sd || 1));
    const k = +c.v > 0 ? +c.v : 3;
    c._st = { r: f.r, z: z[z.length - 1], exp: f.a + f.b * V[x] };
    return sd > 0 && z.length === 3 && z.every(q => Math.abs(q) > k); // 3 readings in a row off the learned line
  }
  if (c.op === 't2') {
    const ks = ['A', 'B', 'C', 'D'].filter(k => r.vars && r.vars[k] && REG[r.vars[k]]);
    if (ks.length < 2) return (c._st = { wait: 'needs 2 or more variables (A–D)' }), false;
    const b = engJoint(r, 't2', ks, V, now);
    const n = Math.max(30, Math.min(ENG_MAX, +c.v2 || 300)),
      base = b.slice(-(n + 30), -30),
      p = ks.length;
    if (base.length < Math.max(30, p * 10)) return (c._st = { wait: `learning ${base.length}/${Math.max(30, p * 10)}` }), false;
    const mu = ks.map((_, i) => base.reduce((s, q) => s + q.x[i], 0) / base.length);
    const S = ks.map((_, i) => ks.map((_, j) => base.reduce((s, q) => s + (q.x[i] - mu[i]) * (q.x[j] - mu[j]), 0) / (base.length - 1)));
    S.forEach((row, i) => (row[i] += 1e-9 + Math.abs(row[i]) * 1e-6)); // keep it invertible
    const Si = engInv(S);
    if (!Si) return (c._st = { wait: 'variables move exactly together' }), false;
    const d = ks.map((k, i) => V[k] - mu[i]);
    let t2 = 0;
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) t2 += d[i] * Si[i][j] * d[j];
    const lim = +c.v > 0 ? +c.v : ENG_CHI99[p] || 13.28;
    const zs = ks.map((k, i) => Math.abs(d[i]) / Math.sqrt(S[i][i] || 1));
    const top = ks[zs.indexOf(Math.max(...zs))];
    c._st = { t2, lim, top };
    return t2 > lim;
  }
  return null;
}
engEval = function (r) {
  const V = {},
    now = Date.now();
  ENG_VARS.forEach(k => {
    const id = r.vars && r.vars[k];
    V[k] = id && REG[id] ? val(id) : null;
  });
  V.X = engCalc(r, V);
  const test = c => {
    const v = V[c.l];
    if (c.op === 'rel' || c.op === 't2') return engJointTest(r, c, V, now);
    if (c.op === 'nodata') {
      const id = c.l !== 'X' && r.vars && r.vars[c.l],
        ts = id && VAL[id] && VAL[id].ts,
        st = (ENG_ST0[r.id + '|' + c.l] = ENG_ST0[r.id + '|' + c.l] || { since: now, v: undefined });
      if (v !== st.v || (ts && ts !== st.ts)) (st.v = v), (st.ts = ts), (st.since = ts || now);
      const age = (now - st.since) / 60000;
      c._st = { age };
      return age > (+c.v > 0 ? +c.v : 10);
    }
    if (c.op === 'in') return v == null || !isFinite(v) ? null : v >= +c.v && v <= +c.v2;
    if (c.op === '!=') return v == null || !isFinite(v) ? null : Math.abs(v - +c.v) >= 1e-9;
    if (ENG_STAT[c.op]) return engStatTest(c, engBuf(r, c.l, c.l === 'X' ? null : r.vars && r.vars[c.l], v, now), v);
    if (v == null || !isFinite(v)) return null;
    const t = +c.v;
    return c.op === '<' ? v < t : c.op === '<=' ? v <= t : c.op === '>' ? v > t : c.op === '>=' ? v >= t : c.op === '=' ? Math.abs(v - t) < 1e-9 : c.op === 'out' ? v < t || v > +c.v2 : null;
  };
  const rs = (r.conds || []).map(test);
  let ok = rs.length ? (r.join === 'or' ? rs.some(x => x === true) : rs.every(x => x === true)) : false;
  const b = r.equip && B(r.equip);
  const running = !b || (typeof effRun === 'function' ? effRun(b) : isRun(b));
  if (r.runOnly && !running) ok = false;
  return { V, ok, running, missing: rs.some(x => x === null) };
};
/* readable condition text (alert messages, rule list, tickets) */
{
  const prev = engCondText;
  engCondText = function (r) {
    if (!(r.conds || []).some(c => ENG_STAT[c.op] || c.op === 'in' || c.op === '!=')) return prev(r);
    const nm = k => (k === 'X' ? (r.calc && r.calc.name) || 'Calc' : (r.vars[k] && REG[r.vars[k]] && (REG[r.vars[k]].short || REG[r.vars[k]].desc)) || k);
    const one = c =>
      c.op === 'sig'
        ? `${nm(c.l)} outside mean ± ${c.v || 3}σ of last ${c.v2 || 60} readings`
        : c.op === 'trend'
          ? `${nm(c.l)} ${(c._st && c._st.dir) || 'rising/falling'} ${c.v || 6} readings in a row`
          : c.op === 'roc'
            ? `${nm(c.l)} changing faster than ${c.v} per min (over ${c.v2 || 60} s)`
            : c.op === 'spc'
              ? `${nm(c.l)} breaks a control-chart rule${c._st && c._st.rule ? ' (' + c._st.rule + ')' : ''} — ${+c.v === 2 ? 'Nelson 1–8' : 'Western Electric'}`
              : c.op === 'ewma'
                ? `${nm(c.l)} EWMA (λ ${c.v || 0.2}) outside its limits`
                : c.op === 'cusum'
                  ? `${nm(c.l)} CUSUM shift beyond ${c.v || 5}σ`
                  : c.op === 'predict'
                    ? `${nm(c.l)} will reach ${c.v} within ${c.v2 || 30} min${c._st && c._st.eta ? ' (in ~' + Math.round(c._st.eta) + ' min)' : ''}`
                    : c.op === 'rel'
                      ? `${nm(c.l)} no longer follows ${nm(c.l2)}`
                      : c.op === 't2'
                        ? `unusual combination of A–D (T²)${c._st && c._st.top ? ' — mostly ' + nm(c._st.top) : ''}`
                        : c.op === 'avgabove' || c.op === 'avgbelow'
                          ? `${nm(c.l)} average of last ${c.v2 || 15} min ${c.op === 'avgabove' ? 'above' : 'below'} ${c.v}`
                          : c.op === 'maxabove'
                            ? `${nm(c.l)} highest in last ${c.v2 || 15} min above ${c.v}`
                            : c.op === 'minbelow'
                              ? `${nm(c.l)} lowest in last ${c.v2 || 15} min below ${c.v}`
                              : c.op === 'delta'
                                ? `${nm(c.l)} changed by more than ${c.v} in ${c.v2 || 15} min`
                                : c.op === 'count'
                                  ? `${nm(c.l)} above ${c.v} more than ${c.v3 ?? 3} times in ${c.v2 || 60} min`
                                  : c.op === 'stuck'
                                    ? `${nm(c.l)} not changing for ${c.v || 10} min`
                                    : c.op === 'nodata'
                                      ? `${nm(c.l)} no new data for ${c.v || 10} min`
                                      : c.op === 'in'
                                        ? `${nm(c.l)} between ${c.v}–${c.v2}`
                                        : `${nm(c.l)} ${c.op === 'out' ? `outside ${c.v}–${c.v2}` : c.op === '!=' ? '≠ ' + c.v : c.op + ' ' + c.v}`;
    return (r.conds || []).map(one).join(r.join === 'or' ? ' OR ' : ' AND ') + (r.runOnly ? ' (while running)' : '') + (r.dur ? ` for ${r.dur >= 60 ? r.dur / 60 + ' min' : r.dur + ' s'}` : '');
  };
}
/* rule editor: the condition rows get the statistical choices */
{
  const prev = emEdit;
  emEdit = function (E) {
    let h = prev(E);
    const r = EM.edit;
    if (!r) return h;
    let i = -1;
    return h.replace(/<div class="em-cond">([\s\S]*?)<button class="lb" data-ecx="(\d+)"[^>]*>✕<\/button><\/div>/g, (all, inner, n) => {
      i = +n;
      const c = r.conds[i];
      if (!c) return all;
      const left = (inner.match(/<select data-ecl="\d+">[\s\S]*?<\/select>/) || [''])[0];
      const G = [
        ['Value now', [['<', 'below'], ['<=', 'at or below'], ['>', 'above'], ['>=', 'at or above'], ['=', 'equal to'], ['!=', 'not equal to'], ['in', 'between'], ['out', 'outside']]],
        ['Over time', [['avgabove', 'average of last N min above'], ['avgbelow', 'average of last N min below'], ['maxabove', 'highest in last N min above'], ['minbelow', 'lowest in last N min below'], ['delta', 'changed by more than (vs N min ago)'], ['roc', 'changing faster than (per min)'], ['count', 'goes above X more than K times'], ['stuck', 'not changing for (sensor stuck)'], ['nodata', 'no new data for']]],
        ['Statistical', [['sig', 'out of control (±σ)'], ['trend', 'trending (rising / falling)'], ['spc', 'control-chart rules (SPC)'], ['ewma', 'EWMA drift'], ['cusum', 'CUSUM shift']]],
        ['Data science', [['predict', 'will cross a limit (forecast)'], ['rel', 'relationship broken'], ['t2', 'multivariate anomaly (T²)']]],
      ];
      /* simple by default: value now + averages; the statistical ones only when "Advanced" is ticked (or already used) */
      const adv = EM_ADV || (r.conds || []).some(x => ['sig', 'trend', 'spc', 'ewma', 'cusum', 'predict', 'rel', 't2', 'count', 'stuck', 'nodata', 'delta', 'roc', 'maxabove', 'minbelow', '=', '!='].includes(x.op));
      const SIMPLE = { '<': 'below', '>': 'above', in: 'between', out: 'outside', avgabove: 'average of last N min above', avgbelow: 'average of last N min below' };
      const G2 = adv ? G : [['', Object.entries(SIMPLE)]];
      const sel = `<select data-eco="${i}">${G2.map(([g, L]) => `${g ? `<optgroup label="${g}">` : ''}${L.map(([o, l]) => `<option value="${o}" ${c.op === o ? 'selected' : ''}>${l}</option>`).join('')}${g ? '</optgroup>' : ''}`).join('')}</select>`;
      const num = (k, w, ph) => `<input type="number" step="any" data-ecv${k === 'v2' ? '2' : ''}="${i}" value="${esc(c[k] ?? '')}" placeholder="${ph}" style="width:${w}px">`;
      let rest;
      if (c.op === 'sig') rest = `<span>mean ±</span>${num('v', 54, '3')}<span>σ of last</span>${num('v2', 60, '60')}<span>readings</span>`;
      else if (c.op === 'trend') rest = `${num('v', 54, '6')}<span>readings in a row</span>`;
      else if (c.op === 'roc') rest = `${num('v', 66, '1')}<span>per min, over</span>${num('v2', 56, '60')}<span>s</span>`;
      else if (c.op === 'spc') rest = `<select data-ecv="${i}"><option value="1" ${+c.v !== 2 ? 'selected' : ''}>Western Electric (rules 1, 2, 5, 6)</option><option value="2" ${+c.v === 2 ? 'selected' : ''}>All 8 Nelson rules</option></select><span>normal = last</span>${num('v2', 66, '300')}<span>readings</span>`;
      else if (c.op === 'ewma') rest = `<span>λ</span>${num('v', 54, '0.2')}<span>normal = last</span>${num('v2', 66, '300')}<span>readings</span>`;
      else if (c.op === 'cusum') rest = `<span>h</span>${num('v', 54, '5')}<span>σ · normal = last</span>${num('v2', 66, '300')}<span>readings</span>`;
      else if (c.op === 'predict') rest = `${num('v', 80, 'limit')}<span>within</span>${num('v2', 54, '30')}<span>min · trend of last</span><input type="number" step="1" data-ecv3="${i}" value="${esc(c.v3 ?? '')}" placeholder="60" style="width:56px"><span>readings</span>`;
      else if (c.op === 'rel') rest = `<span>vs</span><select data-ecl2="${i}"><option value="">choose…</option>${['A', 'B', 'C', 'D', 'X'].filter(k => k !== c.l && (k === 'X' ? r.calc : r.vars && r.vars[k])).map(k => `<option value="${k}" ${c.l2 === k ? 'selected' : ''}>${k} — ${esc(k === 'X' ? (r.calc && r.calc.name) || 'Calc' : (REG[r.vars[k]] && (REG[r.vars[k]].short || REG[r.vars[k]].desc)) || k)}</option>`).join('')}</select><span>off by</span>${num('v', 48, '3')}<span>σ · learned from</span>${num('v2', 66, '300')}<span>readings</span>`;
      else if (c.op === 't2') rest = `<span>A–D together · limit</span>${num('v', 60, 'auto')}<span>· normal = last</span>${num('v2', 66, '300')}<span>readings</span>`;
      else if (['avgabove', 'avgbelow', 'maxabove', 'minbelow'].includes(c.op)) rest = `<span>last</span>${num('v2', 54, '15')}<span>min ${c.op.endsWith('above') ? 'above' : 'below'}</span>${num('v', 80, 'value')}`;
      else if (c.op === 'delta') rest = `${num('v', 70, 'change')}<span>compared with</span>${num('v2', 54, '15')}<span>min ago</span>`;
      else if (c.op === 'count') rest = `<span>above</span>${num('v', 70, 'value')}<span>more than</span><input type="number" step="1" data-ecv3="${i}" value="${esc(c.v3 ?? '')}" placeholder="3" style="width:50px"><span>times in</span>${num('v2', 54, '60')}<span>min</span>`;
      else if (c.op === 'stuck' || c.op === 'nodata') rest = `${num('v', 54, '10')}<span>min</span>`;
      else rest = num('v', 80, '') + (c.op === 'out' || c.op === 'in' ? `<span>–</span>${num('v2', 80, '')}` : '');
      const st = c._st;
      const now =
        st && st.wait ? `<span class="em-stn em-wait">${esc(st.wait)}</span>` :
        c.op === 'spc' && st ? `<span class="em-stn">mean ${fmtN(st.m, 2)} · σ ${fmtN(st.sd, 3)}${st.rule ? ' · rule ' + esc(st.rule) : ' · in control'}</span>` :
        c.op === 'ewma' && st ? `<span class="em-stn">EWMA ${fmtN(st.e, 3)} · limits ${fmtN(st.m - st.lim, 3)}–${fmtN(st.m + st.lim, 3)}</span>` :
        c.op === 'cusum' && st ? `<span class="em-stn">C+ ${fmtN(st.hi, 2)} · C− ${fmtN(st.lo, 2)}</span>` :
        c.op === 'predict' && st ? `<span class="em-stn">${st.eta ? '~' + Math.round(st.eta) + ' min to limit' : 'not heading to the limit'} · R² ${fmtN(st.r2, 2)}</span>` :
        c.op === 'rel' && st ? `<span class="em-stn">link r ${fmtN(st.r, 2)} · now ${fmtN(st.z, 1)}σ off</span>` :
        c.op === 't2' && st ? `<span class="em-stn">T² ${fmtN(st.t2, 1)} / limit ${fmtN(st.lim, 1)}</span>` :
        ['avgabove', 'avgbelow', 'maxabove', 'minbelow'].includes(c.op) && st ? `<span class="em-stn">now ${fmtN(st.agg, 2)} (${st.n} readings)</span>` :
        c.op === 'delta' && st ? `<span class="em-stn">change ${fmtN(st.d, 2)}</span>` :
        c.op === 'count' && st ? `<span class="em-stn">${st.cnt} times</span>` :
        c.op === 'nodata' && st ? `<span class="em-stn">last new value ${fmtN(st.age, 1)} min ago</span>` :
        c.op === 'stuck' && st ? `<span class="em-stn">${st.same ? 'not changing' : 'changing'}</span>` :
        c.op === 'sig' && st ? `<span class="em-stn">mean ${fmtN(st.m, 2)} · σ ${fmtN(st.sd, 3)}</span>` : c.op === 'roc' && st ? `<span class="em-stn">now ${fmtN(st.rate, 2)}/min</span>` : c.op === 'trend' && st && st.dir ? `<span class="em-stn">${st.dir}</span>` : '';
      return `<div class="em-cond${ENG_STAT[c.op] ? ' em-cst' : ''}">${left}${sel}${rest}${now}<button class="lb" data-ecx="${i}" title="Remove">✕</button></div>`;
    });
  };
}
let EM_ADV = false;
{
  const prev2 = emEdit;
  emEdit = function (E) {
    const h = prev2(E);
    if (!EM.edit) return h;
    return h.replace(/(<button class="sb" id="emCondAdd">＋ Condition<\/button>)/, `$1<label class="em-adv"><input type="checkbox" id="emAdv" ${EM_ADV ? 'checked' : ''}> Advanced conditions (statistics, forecast…)</label>`);
  };
}
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'emAdv') {
    EM_ADV = e.target.checked;
    const bd = $('#emBody');
    if (bd) bd._h = null;
    emRender();
  }
});
/* picking a statistical choice fills its usual settings */
document.addEventListener(
  'change',
  e => {
    const s = e.target;
    if (!s.matches || !s.matches('select[data-eco]') || !EM.edit) return;
    const c = EM.edit.conds[+s.dataset.eco],
      d = ENG_STAT[s.value];
    if (!c || !d || c.op === s.value) return;
    c.v = d.v;
    c.v2 = d.v2 != null ? d.v2 : undefined;
    c.v3 = d.v3 != null ? d.v3 : undefined;
    delete c._st;
  },
  true,
);

/* extra fields of the data-science rows */
document.addEventListener('change', e => {
  const s = e.target;
  if (!s.matches || !EM.edit) return;
  let c;
  if (s.matches('[data-ecv3]')) (c = EM.edit.conds[+s.dataset.ecv3]) && (c.v3 = s.value === '' ? undefined : +s.value);
  else if (s.matches('[data-ecl2]')) (c = EM.edit.conds[+s.dataset.ecl2]) && (c.l2 = s.value || undefined);
  else return;
  const bd = $('#emBody');
  if (bd) bd._h = null;
  emRender();
});
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="engStatCss">
.em-cond{flex-wrap:wrap}.em-cond span{font-size:12.5px;color:var(--muted)}
.em-cst{background:#f5f3ff;border-radius:6px;padding:4px 6px}.em-cond select:first-child{flex:1 1 200px;min-width:180px}
.em-stn{font:600 11.5px var(--mono)!important;color:#6d28d9!important;margin-left:4px}.em-wait{color:#b45309!important}.em-adv{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);margin-left:10px}
</style>`,
);
