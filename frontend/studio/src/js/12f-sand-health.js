/*! SandMan Digital Loop Studio — 12f-sand-health.js
 *  v9.42 — Sand Health Index (SHI): "is my sand fit to make good castings right now?"
 *    · One score 0–100 per moulding line (DISA-1/2/3 …), built from four parts:
 *        Properties 60 %  — each sand reading against its Min / Optimal / Max (100 at optimal, 60 at a limit, 0 well outside)
 *        Stability  20 %  — how much each reading has varied over the last minutes (steady = healthy)
 *        Balance    10 %  — bentonite dosing actual vs set point
 *        Discipline 10 %  — Process & SOP compliance of the processes that make the sand (live only)
 *      Missing parts are left out and the rest re-weighted. A CRITICAL reading (moisture, compactability, GCS) outside its
 *      limit keeps the score below 60 (59, minus 6 for each further critical reading out), so averages never hide a real problem. Bands: 80+ Good · 60–79 Watch · below 60 Poor.
 *    · Readings are found by role (12e cpRoleOf): line readings (compactability, GCS, active clay) on each moulding line,
 *      shared readings (mixer moisture / compactability, return sand temperature, bentonite dosing) from the loop.
 *    · Works in Traceability too: val() returns the value at the replay time, so badges show the SHI when a mould was made.
 *    · UI: badge on each moulding line (#Lshi), status-bar figure, Process tab › Sand health, Publish bar button,
 *      "Sand health" section in the equipment panel, Sand health panel (score, parts, causes, SOP action, parameters,
 *      8-hour trend), warning alert below 60.
 *  Prototype: the trend uses the app's history generator; in production it reads stored history (SandMan DB). */

const SHI_W = { prop: 0.6, stab: 0.2, bal: 0.1, disc: 0.1 };
const SHI_LINE_ROLES = { compact: [3, 1, 'Compactability'], gcs: [3, 1, 'Green compression strength'], aclay: [2, 0, 'Active clay'], moist: [3, 1, 'Moisture'], perm: [2, 0, 'Permeability'] };
const SHI_SHARED_ROLES = { moist: [3, 1, 'Moisture (mixer)'], compact: [1, 1, 'Compactability (mixer)'], cooltemp: [2, 0, 'Return sand temperature'] };
const SHI_BAND = s => (s == null ? ['No data', 'nd', '#66758c'] : s >= 80 ? ['Good', 'ok', '#15803d'] : s >= 60 ? ['Watch', 'watch', '#a16207'] : ['Poor', 'poor', '#b91c1c']);
let SHI_HIST = {}; // unit id → [{t, s}] live scores (for the trend arrow)
let SHI_SEL = null;

/* ---------- which readings feed the index ---------- */
function shiRoleOf(id) {
  const t = REG[id];
  return t ? (typeof cpRoleOf === 'function' ? cpRoleOf(id, t, '') : t.role || '') : '';
}
function shiUnits() {
  const k = DOC.blocks.length + ':' + Object.keys(REG).length + ':' + DOC.streams.length;
  if (shiUnits.c && shiUnits.k === k) return shiUnits.c;
  const lines = [],
    shared = [],
    seen = new Set();
  let setp = null,
    act = null;
  DOC.blocks.forEach(b => {
    if (!EQ[b.type] || EQ[b.type].widget) return;
    const mixer = (typeof isMixer === 'function' && isMixer(b)) || /muller|mixer/i.test(b.type + ' ' + b.name);
    const own = [];
    b.tags.forEach(x => {
      const t = REG[x.id];
      if (!t || t.text) return;
      if (/SETPOINT/i.test(x.id) && /BENT/i.test(x.id + t.desc)) setp = x.id;
      if (/ACTUAL/i.test(x.id) && /BENT/i.test(x.id + t.desc)) act = x.id;
      const r = shiRoleOf(x.id),
        L = spec(t);
      if (!r || (L.min == null && L.max == null)) return;
      if (!mixer && SHI_LINE_ROLES[r] && r !== 'moist') own.push({ id: x.id, role: r, blk: b.id, w: SHI_LINE_ROLES[r][0], crit: SHI_LINE_ROLES[r][1], name: SHI_LINE_ROLES[r][2] });
      else if ((mixer || r === 'cooltemp') && SHI_SHARED_ROLES[r] && !seen.has(r)) {
        seen.add(r);
        shared.push({ id: x.id, role: r, blk: b.id, w: SHI_SHARED_ROLES[r][0], crit: SHI_SHARED_ROLES[r][1], name: SHI_SHARED_ROLES[r][2] });
      }
    });
    if (own.length) lines.push({ id: b.id, name: b.name, params: own });
  });
  const bal = setp && act ? { setp, act } : null;
  const U = lines.length
    ? lines.map(l => ({ id: l.id, name: l.name, params: l.params.concat(shared), bal }))
    : shared.length
      ? [{ id: '_loop', name: 'Prepared sand', params: shared, bal }]
      : [];
  shiUnits.k = k;
  return (shiUnits.c = U);
}

/* ---------- scoring ---------- */
function shiParamScore(v, L) {
  if (v == null || !isFinite(v)) return null;
  const opt = L.opt ?? (L.min != null && L.max != null ? (L.min + L.max) / 2 : L.max ?? L.min),
    half = L.min != null && L.max != null ? (L.max - L.min) / 2 : Math.abs((L.max ?? L.min) - opt) || 1;
  if (L.max != null && v > L.max) return { s: Math.max(0, 60 - (60 * (v - L.max)) / half), out: 'high' };
  if (L.min != null && v < L.min) return { s: Math.max(0, 60 - (60 * (L.min - v)) / half), out: 'low' };
  const side = v >= opt ? (L.max != null ? L.max - opt : half) : L.min != null ? opt - L.min : half;
  const d = side > 0 ? Math.abs(v - opt) / side : 0;
  return { s: 100 - 40 * Math.min(1, d) * Math.min(1, d), out: null, dir: v >= opt ? 'high' : 'low' };
}
function shiSamples(id, T) {
  if (!RP && T == null && VAL[id] && VAL[id].h && VAL[id].h.length >= 5) return VAL[id].h.slice(-60).map(x => x.v);
  const t0 = T ?? Date.now(),
    out = [];
  for (let k = 0; k < 10; k++) out.push(histVal(id, t0 - k * 60e3));
  return out.filter(v => v != null);
}
function shiCompute(U, T) {
  const at = id => (T != null ? histVal(id, T) : val(id));
  const rows = U.params.map(p => {
    const t = REG[p.id],
      L = spec(t),
      v = at(p.id),
      sc = shiParamScore(v, L),
      xs = shiSamples(p.id, T),
      half = L.min != null && L.max != null ? (L.max - L.min) / 2 : Math.abs((L.max ?? L.min) - L.opt) || 1;
    let stab = null;
    if (xs.length >= 5) {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length,
        sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
      stab = Math.max(0, Math.min(100, 100 - (250 * sd) / half));
    }
    return Object.assign({}, p, { v, L, sc: sc ? sc.s : null, out: sc ? sc.out : null, dir: sc ? sc.dir : null, stab, unit: t.unit || '', d: t.d });
  });
  const wavg = (arr, f) => {
    let a = 0,
      w = 0;
    arr.forEach(r => {
      const x = f(r);
      if (x != null) {
        a += x * r.w;
        w += r.w;
      }
    });
    return w ? a / w : null;
  };
  const parts = { prop: wavg(rows, r => r.sc), stab: wavg(rows, r => r.stab), bal: null, disc: null };
  if (U.bal) {
    const s = at(U.bal.setp),
      a = at(U.bal.act);
    if (s > 0 && a != null) {
      parts.balDev = ((a - s) / s) * 100;
      parts.bal = Math.max(0, 100 - (100 * Math.abs(parts.balDev)) / 15);
    }
  }
  if (T == null && !RP && DOC.cps) {
    const P = new Set();
    U.params.forEach(p => {
      const q = cpProcOf(B(p.blk) || {});
      if (q) P.add(q);
    });
    if (U.id !== '_loop') {
      const q = cpProcOf(B(U.id) || {});
      if (q) P.add(q);
    }
    if (P.size) {
      let ok = 0,
        n = 0;
      P.forEach(q => {
        const s = cpProcStats(q);
        ok += s.ok;
        n += s.n - s.nodata;
      });
      parts.disc = n ? (100 * ok) / n : null;
      parts.procs = [...P];
    }
  }
  let a = 0,
    w = 0;
  ['prop', 'stab', 'bal', 'disc'].forEach(k => {
    if (parts[k] != null) {
      a += parts[k] * SHI_W[k];
      w += SHI_W[k];
    }
  });
  let score = w ? a / w : null;
  const critOut = rows.filter(r => r.crit && r.out);
  if (score != null && critOut.length) score = Math.min(score, 59 - 6 * (critOut.length - 1)); // a critical reading out → never above 59 (Poor); more of them → lower
  return { unit: U, score: score == null ? null : Math.round(score), parts, rows, critOut, t: T ?? (RP ? RP.T : Date.now()) };
}
function shiAll(T) {
  return shiUnits().map(U => shiCompute(U, T));
}

/* ---------- plain-language causes and the SOP action ---------- */
function shiCauses(R) {
  const C = [];
  R.rows
    .filter(r => r.sc != null && r.sc < 75)
    .sort((a, b) => a.sc - b.sc)
    .forEach(r => {
      const where = B(r.blk)?.name || '',
        v = `${fmtN(r.v, r.d)} ${r.unit}`.trim(),
        lim = cpSpecTxt({ num: true, min: r.L.min, max: r.L.max, d: r.d }) + (r.unit ? ' ' + r.unit : '');
      C.push({
        sev: r.out ? 2 : 1,
        role: r.role,
        blk: r.blk,
        text: r.out ? `${r.name} ${r.out} at ${where}: ${v} (limit ${lim})` : `${r.name} drifting ${r.dir} at ${where}: ${v} (limit ${lim})`,
      });
    });
  R.rows
    .filter(r => r.stab != null && r.stab < 60)
    .forEach(r => C.push({ sev: 1, role: r.role, blk: r.blk, text: `${r.name} unstable at ${B(r.blk)?.name || ''} — varying more than usual` }));
  if (R.parts.bal != null && R.parts.bal < 70)
    C.push({ sev: 1, role: 'bent', text: `Bentonite dosing ${R.parts.balDev > 0 ? 'above' : 'below'} set point by ${Math.abs(R.parts.balDev).toFixed(1)} %` });
  if (R.parts.disc != null && R.parts.disc < 85)
    C.push({ sev: 1, role: 'disc', text: `Sand checks behind: ${Math.round(R.parts.disc)} % of Process & SOP checks OK` });
  return C;
}
const SHI_REACT_RX = { moist: /moist|water/i, compact: /compact/i, gcs: /gcs|strength|bentonite|bond/i, aclay: /clay|bentonite|mb/i, cooltemp: /temp|hot|cool/i, bent: /bentonite|dosing|prescription/i, perm: /perm/i };
function shiAction(R) {
  const C = shiCauses(R);
  if (!C.length || !DOC.cps) return null;
  const c = C[0],
    q = (c.blk && cpProcOf(B(c.blk) || {})) || DOC.cps.find(p => p.key === 'mix') || null;
  if (!q) return null;
  const s = typeof sopUpgrade === 'function' ? sopUpgrade(q) : q.sop || {};
  const L = (Array.isArray(s.reaction) ? s.reaction : s.reaction ? [s.reaction] : []).map(x =>
    Array.isArray(x) ? { cond: x[0], action: x[1], esc: x[2] } : typeof x === 'string' ? { cond: '', action: x, esc: '' } : x,
  );
  const rx = SHI_REACT_RX[c.role];
  const exact = rx && L.find(x => rx.test(x.cond || ''));
  const hit = exact || (rx && L.find(x => rx.test((x.cond || '') + ' ' + (x.action || '')))) || L[0];
  return hit
    ? { proc: q, sop: s, cond: hit.cond || '', action: hit.action || '', esc: hit.esc || '', exact: !!exact, cause: c.text }
    : { proc: q, sop: s, cond: '', action: '', esc: '', exact: false, cause: c.text };
}

/* ---------- canvas badges ---------- */
function shiDrawBadges() {
  const L = $('#Lshi');
  if (!L) return;
  if (PREF.shibadge === false) {
    L.innerHTML = '';
    return;
  }
  L.innerHTML = shiAll()
    .filter(R => R.unit.id !== '_loop' && B(R.unit.id))
    .map(R => {
      const b = B(R.unit.id),
        d = dims(b),
        [, , col] = SHI_BAND(R.score),
        lab = `Sand ${R.score ?? '—'}`,
        tw = Math.round(lab.length * 7 + 26);
      let x = b.x + d.W - tw,
        y = b.y - 26;
      // keep clear of an area box's title strip (process badge, area name)
      const hit = (typeof afZones === 'function' ? afZones() : []).some(z => {
        const r = afRect(z);
        return y < r.y + 30 && y + 20 > r.y - 2 && x < r.x + r.w && x + tw > r.x;
      });
      if (hit) y = b.y + 4;
      return `<g class="shibadge" data-u="${R.unit.id}" transform="translate(${x},${y})"><title>Sand health ${R.score ?? '—'} · ${SHI_BAND(R.score)[0]} — ${esc(R.unit.name)}</title><rect width="${tw}" height="20" rx="10" fill="${col}"/><circle cx="11" cy="10" r="3.5" fill="#fff"/><text x="19" y="14" style="font:700 11px var(--sans);fill:#fff">${lab}</text></g>`;
    })
    .join('');
}
$('#Lshi').addEventListener(
  'pointerdown',
  e => {
    const g = e.target.closest && e.target.closest('.shibadge');
    if (!g) return;
    e.stopPropagation();
    e.preventDefault();
    shiOpen(g.dataset.u);
  },
  true,
);

/* ---------- status bar ---------- */
function shiStatus() {
  const el = $('#shiStat');
  if (!el) return;
  const A = shiAll().filter(R => R.score != null);
  if (!A.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const worst = A.reduce((a, b) => (b.score < a.score ? b : a)),
    avg = Math.round(A.reduce((a, b) => a + b.score, 0) / A.length);
  el.textContent = A.length > 1 ? `Sand health ${worst.score} · ${worst.unit.name}` : `Sand health ${worst.score}`;
  el.title = `Sand health — lowest line ${worst.unit.name} ${worst.score}, average ${avg}. Open the sand health index`;
  el.className = 'shistat b-' + SHI_BAND(worst.score)[1];
}

/* ---------- alerts (live only) ---------- */
function shiAlerts() {
  if (RP) return;
  shiAll().forEach(R => {
    const c = shiCauses(R)[0];
    raise('shi:' + R.unit.id, R.score != null && R.score < 60 ? 2 : 0, {
      blk: R.unit.id === '_loop' ? R.unit.params[0]?.blk : R.unit.id,
      where: R.unit.name,
      msg: `Sand health low: ${R.score}${c ? ' — ' + c.text : ''}`,
    });
  });
}

/* ---------- 8-hour trend (prototype history) ---------- */
function shiTrend(U, hours) {
  const now = RP ? RP.T : Date.now(),
    step = 15 * 60e3,
    n = Math.round((hours * 3600e3) / step),
    P = [];
  for (let i = n; i >= 1; i--) P.push({ t: now - i * step, s: shiCompute(U, now - i * step).score });
  return P;
}
function shiSpark(P, live) {
  const W = 560,
    H = 120,
    pts = P.concat(live != null ? [{ t: RP ? RP.T : Date.now(), s: live }] : []).filter(p => p.s != null);
  if (pts.length < 2) return '';
  const t0 = pts[0].t,
    t1 = pts[pts.length - 1].t,
    X = t => 36 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 46),
    Y = s => 8 + ((100 - s) / 100) * (H - 26);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.s).toFixed(1)}`).join(' ');
  const hh = t => fmtHM(t).slice(0, 5);
  return `<svg class="shi-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sand health over the last 8 hours">
<rect x="36" y="${Y(100)}" width="${W - 46}" height="${Y(80) - Y(100)}" fill="#15803d" opacity=".07"/><rect x="36" y="${Y(80)}" width="${W - 46}" height="${Y(60) - Y(80)}" fill="#a16207" opacity=".08"/><rect x="36" y="${Y(60)}" width="${W - 46}" height="${Y(0) - Y(60)}" fill="#b91c1c" opacity=".06"/>
<g style="font:10px var(--mono);fill:var(--muted)"><text x="4" y="${Y(80) + 3}">80</text><text x="4" y="${Y(60) + 3}">60</text><text x="36" y="${H - 2}">${hh(t0)}</text><text x="${W - 10}" y="${H - 2}" text-anchor="end">${RP ? hh(t1) : 'now'}</text></g>
<path d="${line}" fill="none" stroke="#5b3fc4" stroke-width="2"/><circle cx="${X(t1)}" cy="${Y(pts[pts.length - 1].s)}" r="4" fill="#5b3fc4"/></svg>`;
}

/* ---------- Sand health panel ---------- */
function shiTrendArrow(R) {
  const H = SHI_HIST[R.unit.id] || [],
    old = H.find(x => x.t >= Date.now() - 16 * 60e3);
  if (RP || !old || R.score == null) return '';
  const d = R.score - old.s;
  return Math.abs(d) < 3 ? '<span class="shi-ar">→ steady</span>' : d > 0 ? `<span class="shi-ar up">↑ ${d} in 15 min</span>` : `<span class="shi-ar dn">↓ ${-d} in 15 min</span>`;
}
function shiPartBar(k, lab, v, note) {
  return `<div class="shi-part"><span>${lab} <small>${Math.round(SHI_W[k] * 100)} %</small></span><div class="shi-pb"><i style="width:${v == null ? 0 : Math.round(v)}%;background:${SHI_BAND(v)[2]}"></i></div><b>${v == null ? '—' : Math.round(v)}</b>${note ? `<small class="shi-pn">${note}</small>` : ''}</div>`;
}
function shiOpen(uid) {
  const A = shiAll();
  if (!A.length) {
    toast('No sand readings with limits on this loop yet');
    return;
  }
  if (uid) SHI_SEL = uid;
  if (!SHI_SEL || !A.some(R => R.unit.id === SHI_SEL)) SHI_SEL = A.slice().sort((a, b) => (a.score ?? 999) - (b.score ?? 999))[0].unit.id;
  const R = A.find(x => x.unit.id === SHI_SEL),
    [bl, bk, bc] = SHI_BAND(R.score),
    C = shiCauses(R),
    act = shiAction(R),
    P = RP ? shiTrend(R.unit, 8) : (SHI_HIST[R.unit.id] || []).slice(0, -1);
  const tabs = A.map(
    x => `<button class="shi-u ${x.unit.id === SHI_SEL ? 'on' : ''}" data-shiu="${x.unit.id}"><span>${esc(x.unit.name)}</span><b style="color:${SHI_BAND(x.score)[2]}">${x.score ?? '—'}</b><small>${SHI_BAND(x.score)[0]}</small></button>`,
  ).join('');
  const rows = R.rows
    .map(
      r =>
        `<tr><td><b>${esc(r.name)}</b></td><td class="mono">${esc(B(r.blk)?.name || '')}</td><td class="mono">${r.v == null ? '—' : fmtN(r.v, r.d) + ' ' + esc(r.unit)}</td><td class="mono">${cpSpecTxt({ num: true, min: r.L.min, max: r.L.max, d: r.d })}</td><td><span class="shi-sc" style="color:${SHI_BAND(r.sc)[2]}">${r.sc == null ? '—' : Math.round(r.sc)}</span>${r.crit ? ' <span class="cp-crit">critical</span>' : ''}</td><td class="mono">${r.stab == null ? '—' : Math.round(r.stab)}</td><td><button class="sb" data-shitr="${esc(r.id)}">Trend</button></td></tr>`,
    )
    .join('');
  openModal(
    `<div class="shi"><div class="shi-h"><div><h3>Sand health index</h3><div class="note">${RP ? `<span class="rp-badge">TRACEABILITY</span> at ${fmtHM(RP.T)} · ` : 'Live · '}is the sand fit to make good castings?</div></div></div>
<div class="shi-us">${tabs}</div>
<div class="shi-g">
 <section class="shi-score b-${bk}"><div class="shi-big">${R.score ?? '—'}</div><div class="shi-bl">${bl}</div>${shiTrendArrow(R)}<div class="note">${esc(R.unit.name)}${R.critOut.length ? ' · capped: a critical reading is outside its limit' : ''}</div></section>
 <section class="shi-parts">${shiPartBar('prop', 'Sand properties', R.parts.prop, 'against Min / Optimal / Max')}${shiPartBar('stab', 'Stability', R.parts.stab, 'variation over the last minutes')}${shiPartBar('bal', 'Balance', R.parts.bal, R.parts.balDev != null ? `bentonite ${R.parts.balDev >= 0 ? '+' : ''}${R.parts.balDev.toFixed(1)} % vs set point` : 'no dosing readings')}${shiPartBar('disc', 'Discipline', R.parts.disc, R.parts.disc != null ? 'Process & SOP checks OK' : RP ? 'not used in traceability' : 'no process checks')}</section>
</div>
<div class="shi-g2">
 <section><h4>What is pulling it down</h4>${C.length ? `<ul class="shi-c">${C.slice(0, 5).map(c => `<li class="s${c.sev}">${esc(c.text)}</li>`).join('')}</ul>` : '<div class="note">Nothing — all sand readings are close to optimal and steady.</div>'}
 ${act && C.length ? `<div class="shi-act"><div class="note">Reaction plan · ${esc(act.sop.no || '')} ${esc(act.proc.name)}${act.exact ? '' : ' · closest step in the SOP'}</div><b>${esc(act.exact ? act.cond : 'For: ' + act.cause)}</b><div>${esc(act.action)}${act.esc ? ` <span class="note">· inform ${esc(act.esc)}</span>` : ''}</div><div class="shi-ab"><button class="ib" id="shiSop" data-pid="${act.proc.id}">Open SOP</button>${RP ? '' : `<button class="ib pri" id="shiRun" data-pid="${act.proc.id}">Start guided run</button>`}</div></div>` : ''}</section>
 <section><h4>${RP ? 'The 8 hours before ' + fmtHM(RP.T).slice(0, 5) : 'Since this screen opened'}</h4>${shiSpark(P, R.score) || '<div class="note shi-col">Collecting — the trend appears after a few minutes.</div>'}<div class="note">Bands: 80+ Good · 60–79 Watch · below 60 Poor${RP ? '' : ' · the full shift history comes from the plant database once connected'}</div></section>
</div>
<h4>Sand readings in the index</h4>
<div class="tbl-wrap"><table class="shi-t"><thead><tr><th>Reading</th><th>Where</th><th>Now</th><th>Limit</th><th>Score</th><th>Stability</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
<details class="shi-how"><summary>How the index is worked out</summary><p>Each reading scores 100 at its optimal value, 60 at a limit and falls to 0 well outside. Sand properties count 60 %, stability 20 %, bentonite balance 10 % and Process &amp; SOP checks 10 %; parts without data are left out. If a critical reading (moisture, compactability, GCS) is outside its limit, the index stays below 60 (Poor), and lower again for each further critical reading out, so an average can never hide it. Limits come from each reading's Min / Max — change them in the equipment panel.</p></details>
<div class="mact"><button class="ib pri" id="shiX">Close</button></div></div>`,
    'xl',
  );
  $$('#mbox [data-shiu]').forEach(b => (b.onclick = () => shiOpen(b.dataset.shiu)));
  $$('#mbox [data-shitr]').forEach(b => (b.onclick = () => openTrend(b.dataset.shitr)));
  if ($('#shiSop')) $('#shiSop').onclick = () => openCP($('#shiSop').dataset.pid, 'sop');
  if ($('#shiRun')) $('#shiRun').onclick = () => cpStartRun($('#shiRun').dataset.pid);
  $('#shiX').onclick = () => closeModal(true);
}

/* ---------- equipment panel section ---------- */
function shiIxInsert(T, b) {
  const A = shiAll();
  let R = A.find(x => x.unit.id === b.id),
    fed = null;
  if (!R) {
    fed = A.filter(x => x.unit.params.some(p => p.blk === b.id));
    if (!fed.length) return;
  }
  const show = R ? [R] : fed;
  const h = `<section class="ix-sec shi-ix"><h4>Sand health ${R ? `<span class="ix-sum" style="color:${SHI_BAND(R.score)[2]}">${R.score ?? '—'} · ${SHI_BAND(R.score)[0]}</span>` : ''}</h4>
 ${R ? '' : `<p class="ix-hint">${esc(b.name)}'s readings feed the sand health of ${fed.map(x => esc(x.unit.name)).join(', ')}.</p>`}
 ${show.map(x => `<div class="shi-ixr"><b>${esc(x.unit.name)}</b><span class="shi-pill b-${SHI_BAND(x.score)[1]}">${x.score ?? '—'}</span><small>${esc(shiCauses(x)[0]?.text || 'All sand readings close to optimal')}</small></div>`).join('')}
 <div class="ix-acts"><button class="ib" id="shiIxOpen">Open sand health</button></div></section>`;
  const anchor = T.querySelector('.cp-ix') || T.querySelector('.ix-more');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', h);
  else (T.querySelector('.ix') || T).insertAdjacentHTML('beforeend', h);
  const o = T.querySelector('#shiIxOpen');
  if (o) o.onclick = () => shiOpen((R || fed[0]).unit.id);
}

/* ---------- wiring ---------- */
(() => {
  const on = (id, fn) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  };
  on('bSHI', () => shiOpen());
  on('shiStat', () => shiOpen());
  on('pSHI', () => shiOpen());
  const cb = $('#shiBadges');
  if (cb) {
    cb.checked = PREF.shibadge !== false;
    cb.onchange = () => {
      PREF.shibadge = cb.checked;
      savePref();
      shiDrawBadges();
    };
  }
})();
let shiTick = 0;
setInterval(() => {
  try {
    shiDrawBadges();
    shiStatus();
    if (!RP && shiTick++ % 10 === 0) {
      const now = Date.now();
      shiAll().forEach(R => {
        if (R.score == null) return;
        const H = (SHI_HIST[R.unit.id] = SHI_HIST[R.unit.id] || []);
        H.push({ t: now, s: R.score });
        while (H.length && H[0].t < now - 8 * 3600e3) H.shift();
      });
      shiAlerts();
    }
  } catch (e) {}
}, 1500);
