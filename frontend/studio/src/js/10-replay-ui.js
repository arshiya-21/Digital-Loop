/*! SandMan Process Flowsheet — 10-replay-ui.js
 *  Replay workspace UI: timeline, insights panel, casting follow mode
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===================================================================
   Replay workspace (redesigned): shift picker, multi-lane timeline,
   insights panel, casting follow mode
   =================================================================== */
let RPT = 'sum',
  RPF = { inc: true, alm: true, grp: true, spike: true, stop: true },
  RPC = { def: false, q: '' },
  TSTEP = null;
const pad2 = n => String(n).padStart(2, '0');
function dstr(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function shiftsFor(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return SHIFTS.map(([L, h]) => shiftOf(new Date(y, m - 1, d, h, 0, 1).getTime()));
}
function lastDoneShift() {
  return shiftOf(shiftOf(Date.now()).t0 - 1);
}
const fmtHM = t =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDur = ms => {
  const m = Math.round(ms / 60e3);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
function enterReplay(sh, T) {
  sh = sh || lastDoneShift();
  const now = Date.now();
  if (sh.t0 > now) {
    toast('That shift has not started yet');
    return;
  }
  const fresh = !RP;
  if (MODE !== 'monitor') setMode('monitor', true);
  if (fresh) RPsave = { oos: Object.fromEntries(DOC.blocks.map(b => [b.id, !!b.props.oos])), live: LIVE };
  RP = {
    sh,
    t0: sh.t0,
    t1: Math.min(sh.t1, now),
    T: T ?? sh.t0,
    play: false,
    speed: 60,
    ev: [],
    bins: [],
    v0: sh.t0,
    v1: sh.t1,
    tick: 0,
  };
  RP.T = clamp(RP.T, RP.t0, RP.t1);
  if (!PREF.right) {
    PREF.right = true;
    savePref();
  }
  buildReplayIndex();
  document.body.classList.add('replay');
  $('#bReplay').classList.add('on');
  $('#mDesign').disabled = true;
  if (fresh) {
    SEL = null;
    SELM.clear();
    RPT = 'sum';
    TSTEP = null;
    TPATH.clear();
  }
  rpApply();
  applyPrefs(true);
  renderAll();
  rpHeader();
  requestAnimationFrame(() => {
    fit('page');
    rpDraw();
  });
  if (fresh) toast(`Traceability · ${sh.label} — Space plays, ← → step one minute`);
}
function exitReplay() {
  if (!RP) return;
  DOC.blocks.forEach(b => {
    if (RPsave && b.id in RPsave.oos) b.props.oos = RPsave.oos[b.id];
  });
  LIVE = RPsave ? RPsave.live : true;
  RP = null;
  RPsave = null;
  TSTEP = null;
  TPATH.clear();
  document.body.classList.remove('replay');
  $('#bReplay').classList.remove('on');
  $('#mDesign').disabled = false;
  SEL = null;
  applyPrefs(true);
  renderAll();
  requestAnimationFrame(() => fit());
  toast('Back to live');
}
function buildReplayIndex() {
  TRC.clear();
  chainFor.c = {};
  const { t0, t1, sh } = RP,
    mm = moldingMachines(),
    ev = [],
    now = t1;
  RP.mm = mm;
  RP.M = {};
  mm.forEach(m => {
    const int = 3600e3 / mphOf(m),
      n = Math.floor(SHIFT_MS / int),
      arr = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const t = sh.t0 + i * int;
      arr[i] = t <= now ? moldAt(m, sh, i) : null;
    }
    RP.M[m.id] = { int, arr };
  });
  INCIDENTS.forEach(i => {
    const a = sh.t0 + i.from * SHIFT_MS,
      b = sh.t0 + i.to * SHIFT_MS;
    if (a >= now) return;
    if (i.stopIdx != null) {
      const m = mm[i.stopIdx];
      if (!m) return;
      ev.push({
        t: a,
        t2: Math.min(b, now),
        kind: 'stop',
        sev: 2,
        where: m.name,
        blk: m.id,
        msg: `${m.name} stopped — pattern change`,
      });
    } else ev.push({ t: a, t2: Math.min(b, now), kind: 'inc', sev: 2, where: 'Process', msg: i.n, inc: i });
  });
  RP.grp = GROUPS.map(([f, n], k) => ({
    a: sh.t0 + f * SHIFT_MS,
    b: sh.t0 + (GROUPS[k + 1] ? GROUPS[k + 1][0] : 1) * SHIFT_MS,
    n,
  }));
  RP.grp.slice(1).forEach(g => {
    if (g.a < now)
      ev.push({
        t: g.a,
        kind: 'grp',
        sev: 0,
        where: 'Sandmix',
        msg: `Product changed to ${g.n} — prescription applied`,
      });
  });
  const tags = [];
  DOC.blocks.forEach(b => {
    if (EQ[b.type].widget) return;
    b.tags.forEach(x => {
      const T = REG[x.id];
      if (T && !T.cyc && (T.hi != null || T.lo != null)) tags.push({ id: x.id, b });
    });
  });
  RP.almOn = [];
  tags.forEach(({ id, b }) => {
    let prev = 0,
      start = 0;
    for (let t = t0; t <= now; t += 60e3) {
      const v = histVal(id, t),
        s = tagSev(id, v);
      if (s >= 2 && s > prev)
        ev.push({
          t,
          kind: 'alm',
          sev: s,
          where: b.name,
          tag: id,
          blk: b.id,
          msg: `${REG[id].desc} ${v > REG[id].typ ? 'high' : 'low'} — ${fmtN(v, REG[id].d)} ${REG[id].unit}`,
        });
      if (s >= 2 && prev < 2) start = t;
      if (s < 2 && prev >= 2) RP.almOn.push({ id, blk: b.id, a: start, b: t, sev: 2 });
      prev = s;
    }
    if (prev >= 2) RP.almOn.push({ id, blk: b.id, a: start, b: now, sev: prev });
  });
  const N = 96,
    bw = SHIFT_MS / N;
  RP.bw = bw;
  RP.bins = [];
  let tn = 0,
    td = 0,
    bn = 0,
    bd = 0;
  const inInc = a =>
    INCIDENTS.some(
      i =>
        i.fx && a >= sh.t0 + i.from * SHIFT_MS - DELAY.sand && a <= sh.t0 + i.to * SHIFT_MS + DELAY.sand * 2,
    );
  for (let k = 0; k < N; k++) {
    const a = t0 + k * bw;
    if (a >= now) break;
    let n = 0,
      d = 0;
    const cz = {};
    mm.forEach(m =>
      moldsIn(m, a, Math.min(a + bw, now)).forEach(x => {
        n++;
        if (x.defect) {
          d++;
          cz[x.cause] = (cz[x.cause] || 0) + 1;
        }
      }),
    );
    RP.bins.push({ a, n, d, rate: n ? d / n : 0, cz });
    tn += n;
    td += d;
    if (!inInc(a)) {
      bn += n;
      bd += d;
    }
  }
  RP.tot = { n: tn, d: td, rate: tn ? td / tn : 0, base: bn ? bd / bn : 0 };
  let run = null;
  const thr = Math.max(0.05, RP.tot.base * 2.5);
  RP.bins.forEach((b, k) => {
    if (b.rate > thr && b.n > 5) {
      if (!run) run = { a: b.a, n: 0, d: 0, cz: {} };
      run.n += b.n;
      run.d += b.d;
      Object.entries(b.cz).forEach(([c, v]) => (run.cz[c] = (run.cz[c] || 0) + v));
      run.b = b.a + bw;
    } else if (run) {
      pushSpike(run);
      run = null;
    }
  });
  if (run) pushSpike(run);
  function pushSpike(r) {
    const top = Object.entries(r.cz).sort((a, b) => b[1] - a[1])[0];
    ev.push({
      t: r.a,
      t2: r.b,
      kind: 'spike',
      sev: 3,
      where: 'Castings',
      msg: `Defect rate ${((r.d / r.n) * 100).toFixed(1)}% (${r.d} of ${r.n})${top ? ' — mostly ' + top[0].toLowerCase() : ''}`,
      cause: top && top[0],
    });
  }
  RP.stops = mm.map(m => {
    const iv = [];
    let s0 = null;
    for (let t = t0; t <= now; t += 60e3) {
      const st = stoppedAt(m, t);
      if (st && s0 == null) s0 = t;
      if (!st && s0 != null) {
        iv.push([s0, t]);
        s0 = null;
      }
    }
    if (s0 != null) iv.push([s0, now]);
    return { m, iv };
  });
  ev.sort((a, b) => a.t - b.t);
  RP.ev = ev;
  RP.find = [];
  ev.filter(e => e.kind === 'inc').forEach(e => {
    const a = e.t + DELAY.sand * 0.5,
      b = e.t2 + DELAY.sand * 1.5;
    let n = 0,
      d = 0;
    const cz = {};
    mm.forEach(m =>
      moldsIn(m, a, Math.min(b, now)).forEach(x => {
        n++;
        if (x.defect) {
          d++;
          cz[x.cause] = (cz[x.cause] || 0) + 1;
        }
      }),
    );
    const top = Object.entries(cz).sort((x, y) => y[1] - x[1])[0];
    RP.find.push({
      kind: 'inc',
      e,
      t: e.t,
      title: e.msg,
      range: `${fmtHM(e.t)}–${fmtHM(e.t2)}`,
      detail: n
        ? `Castings molded in its wake: <b class="${d / n > 0.05 ? 'tx3' : 'tx2'}">${((d / n) * 100).toFixed(1)}% defective</b> (${d} of ${n}) vs ${(RP.tot.base * 100).toFixed(1)}% normally${top ? ` — mostly ${esc(top[0].toLowerCase())}` : ''}.`
        : 'No castings affected yet.',
      cause: top && top[0],
      win: [a, b],
    });
  });
  RP.stops.forEach(o =>
    o.iv.forEach(([a, b]) =>
      RP.find.push({
        kind: 'stop',
        t: a,
        title: `${o.m.name} stopped (pattern change)`,
        range: `${fmtHM(a)}–${fmtHM(b)}`,
        detail: `Down ${fmtDur(b - a)} — about ${Math.round((mphOf(o.m) * (b - a)) / HOUR)} castings not made.`,
        blk: o.m.id,
      }),
    ),
  );
  RP.find.sort((a, b) => a.t - b.t);
}
function rpApply() {
  if (!RP) return;
  DOC.blocks.forEach(b => {
    if (!EQ[b.type].widget) b.props.oos = stoppedAt(b, RP.T);
  });
  LIVE = RP.play && RP.speed <= 60;
}
let rpPanelT = 0;
function rpSet(T, src) {
  if (!RP) return;
  RP.T = clamp(T, RP.t0, RP.t1);
  rpApply();
  $('#cv').classList.toggle('live', RP.play && RP.speed <= 60);
  liveCanvas();
  liveText();
  liveTree();
  rpDraw();
  rpHeader();
  if (trendTag) drawTrend();
  const now = performance.now();
  if (MBOPEN && MBVIEW === 'main' && (!RP.play || now - (rpSet.mb || 0) > 1500)) {
    rpSet.mb = now;
    mbRender();
  }
  if (
    src === 'panel' ||
    (!RP.play && now - rpPanelT > 150) ||
    (RP.play && now - rpPanelT > 2000 && !$('#right').matches(':hover'))
  ) {
    rpPanelT = now;
    rpPanelLive(src);
  }
}
function rpHeader() {
  if (!RP) return;
  $('#rpTime').textContent = new Date(RP.T).toLocaleTimeString('en-GB', { hour12: false });
  $('#rpDay').textContent = new Date(RP.T).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
  const k = Math.floor((RP.T - RP.t0) / RP.bw),
    bin = RP.bins[Math.min(k, RP.bins.length - 1)],
    al = RP.almOn.filter(a => a.a <= RP.T && a.b > RP.T).length;
  $('#rpSub').innerHTML =
    `${esc(groupAt(RP.T))} · ${bin && bin.n ? `<span class="${bin.rate > 0.05 ? 'tx3' : bin.rate > 0.03 ? 'tx2' : 'tx0'}">${(bin.rate * 100).toFixed(1)}% defects</span>` : '—'} · ${al ? `<span class="tx2">${al} alarm${al > 1 ? 's' : ''} active</span>` : 'no alarms'}`;
  $('#rpPlay').innerHTML = RP.play ? '⏸' : '▶';
  $('#rpPlay').title = RP.play ? 'Pause (Space)' : 'Play (Space)';
  $$('#rpSpeeds button').forEach(b => b.classList.toggle('on', +b.dataset.sp === RP.speed));
  const ds = dstr(RP.sh.t0);
  $('#rpDate').value = ds;
  $('#rpDate').max = dstr(Date.now());
  $$('#rpShifts button').forEach((b, i) => {
    const s = shiftsFor(ds)[i];
    b.disabled = s.t0 > Date.now();
    b.classList.toggle('on', s.t0 === RP.sh.t0);
    b.title = s.label + (s.t1 > Date.now() ? ' (in progress)' : '');
  });
  const f = $('#rpFollow');
  if (TSTEP) {
    const s = TSTEP.steps[TSTEP.i];
    f.style.display = 'flex';
    f.innerHTML = `<b class="mono">${esc(TSTEP.md.id)}</b><span>Step ${TSTEP.i + 1}/${TSTEP.steps.length} · ${esc(s.n)}${s.b ? ' — ' + esc(s.b.name) : ''} · ${fmtHM(s.t)}</span><button class="ib" id="tfPrev" ${TSTEP.i ? '' : 'disabled'}>◀</button><button class="ib" id="tfNext" ${TSTEP.i < TSTEP.steps.length - 1 ? '' : 'disabled'}>▶</button><button class="ib" id="tfOpen">Details</button><button class="ib" id="tfX" title="Stop following">✕</button>`;
    $('#tfPrev').onclick = () => followStep(TSTEP.i - 1);
    $('#tfNext').onclick = () => followStep(TSTEP.i + 1);
    $('#tfOpen').onclick = () => openGenealogy(TSTEP.md);
    $('#tfX').onclick = () => {
      TSTEP = null;
      TPATH.clear();
      renderCanvas();
      rpHeader();
    };
  } else f.style.display = 'none';
}
/* ---------- timeline ---------- */
const LANE = { axis: 20, ev: 26, def: 46, stop: 14, grp: 18, gut: 92 };
function rpGeom() {
  const sm = innerHeight < 760;
  Object.assign(
    LANE,
    sm ? { axis: 18, ev: 20, def: 28, stop: 10, grp: 14 } : { axis: 20, ev: 26, def: 46, stop: 14, grp: 18 },
  );
  const c = $('#rpTl'),
    r = c.getBoundingClientRect(),
    mm = RP.stops.length,
    H = LANE.axis + LANE.ev + LANE.def + LANE.stop * mm + LANE.grp + 8;
  return { c, r, H, W: r.width, mm };
}
function tX(t, W) {
  return LANE.gut + ((t - RP.v0) / (RP.v1 - RP.v0)) * (W - LANE.gut - 8);
}
function xT(x, W) {
  return RP.v0 + ((x - LANE.gut) / (W - LANE.gut - 8)) * (RP.v1 - RP.v0);
}
function rpDraw() {
  if (!RP) return;
  const G = rpGeom();
  if (G.W < 50) return;
  const c = G.c;
  if (Math.abs(c.getBoundingClientRect().height - G.H) > 1) c.style.height = G.H + 'px';
  const d = devicePixelRatio || 1;
  c.width = G.W * d;
  c.height = G.H * d;
  const x = c.getContext && c.getContext('2d');
  if (!x) return;
  x.setTransform(d, 0, 0, d, 0, 0);
  const W = G.W,
    H = G.H,
    X = t => tX(t, W),
    mut = css('--muted'),
    txt = css('--text'),
    line = css('--line'),
    p2 = css('--panel2');
  x.clearRect(0, 0, W, H);
  x.font = '10.5px IBM Plex Sans,Arial';
  const lanes = [];
  let y = LANE.axis;
  lanes.push(['Events', y, LANE.ev]);
  y += LANE.ev;
  lanes.push(['Defect rate', y, LANE.def]);
  y += LANE.def;
  RP.stops.forEach(o => {
    lanes.push([o.m.name, y, LANE.stop]);
    y += LANE.stop;
  });
  lanes.push(['Product', y, LANE.grp]);
  lanes.forEach(([n, ly, lh], i) => {
    x.fillStyle = i % 2 ? p2 : css('--panel');
    x.fillRect(0, ly, W, lh);
    x.fillStyle = mut;
    x.textAlign = 'right';
    x.fillText(n, LANE.gut - 8, ly + lh / 2 + 4);
  });
  x.strokeStyle = line;
  x.beginPath();
  x.moveTo(LANE.gut, 0);
  x.lineTo(LANE.gut, H);
  x.stroke();
  x.save();
  x.beginPath();
  x.rect(LANE.gut, 0, W - LANE.gut, H);
  x.clip();
  if (RP.t1 < RP.sh.t1) {
    x.fillStyle = 'rgba(148,163,184,.18)';
    x.fillRect(X(RP.t1), LANE.axis, W, H);
  }
  const span = RP.v1 - RP.v0,
    step = span > 4 * HOUR ? HOUR : span > HOUR ? 15 * 60e3 : 5 * 60e3;
  x.textAlign = 'center';
  for (let t = Math.ceil(RP.v0 / step) * step; t <= RP.v1; t += step) {
    const px = X(t);
    x.strokeStyle = line;
    x.beginPath();
    x.moveTo(px, LANE.axis - 4);
    x.lineTo(px, H);
    x.stroke();
    x.fillStyle = mut;
    x.fillText(fmtHM(t), px, 13);
  }
  const [, ey, eh] = lanes[0];
  RP.ev.forEach(e => {
    if (e.t2 && (e.kind === 'inc' || e.kind === 'spike')) {
      x.fillStyle = e.kind === 'inc' ? 'rgba(236,122,21,.28)' : 'rgba(217,54,54,.22)';
      const a = X(e.t),
        b = X(e.t2);
      x.fillRect(a, ey + 3, Math.max(3, b - a), eh - 6);
      if (b - a > 70 && e.kind === 'inc') {
        x.fillStyle = '#9a3412';
        x.textAlign = 'left';
        x.font = '600 10px IBM Plex Sans,Arial';
        x.fillText(e.msg, a + 4, ey + eh / 2 + 4);
        x.font = '10.5px IBM Plex Sans,Arial';
      }
    }
  });
  RP.ev.forEach(e => {
    if (e.kind === 'alm') {
      x.fillStyle = sevC(e.sev);
      x.fillRect(X(e.t) - 1, ey + 2, 2.5, 8);
    } else if (e.kind === 'grp') {
      const px = X(e.t);
      x.fillStyle = '#1f6feb';
      x.beginPath();
      x.moveTo(px, ey + eh - 12);
      x.lineTo(px + 5, ey + eh - 7);
      x.lineTo(px, ey + eh - 2);
      x.lineTo(px - 5, ey + eh - 7);
      x.fill();
    }
  });
  const [, dy, dh] = lanes[1],
    mx = Math.max(0.08, ...RP.bins.map(b => b.rate));
  x.strokeStyle = 'rgba(217,54,54,.35)';
  x.setLineDash([3, 3]);
  const by = dy + dh - (RP.tot.base / mx) * (dh - 6);
  x.beginPath();
  x.moveTo(LANE.gut, by);
  x.lineTo(W, by);
  x.stroke();
  x.setLineDash([]);
  RP.bins.forEach(b => {
    const a = X(b.a),
      w = Math.max(1, X(b.a + RP.bw) - a - 1),
      h = (b.rate / mx) * (dh - 6);
    x.fillStyle = b.rate > 0.05 ? '#d93636' : b.rate > 0.03 ? '#ec7a15' : '#94a3b8';
    x.fillRect(a, dy + dh - h - 1, w, h);
  });
  RP.stops.forEach((o, i) => {
    const [, sy, sh2] = lanes[2 + i];
    x.fillStyle = 'rgba(31,157,85,.55)';
    x.fillRect(X(RP.t0), sy + 3, X(RP.t1) - X(RP.t0), sh2 - 6);
    x.fillStyle = '#7b8794';
    o.iv.forEach(([a, b]) => x.fillRect(X(a), sy + 2, Math.max(2, X(b) - X(a)), sh2 - 4));
  });
  const [, gy, gh] = lanes[lanes.length - 1],
    gc = ['#c7d7f5', '#d9ccf3', '#c6ead7'];
  RP.grp.forEach((g, i) => {
    const a = X(g.a),
      b = X(Math.min(g.b, RP.t1));
    if (b <= a) return;
    x.fillStyle = gc[i % 3];
    x.fillRect(a, gy + 2, b - a - 1, gh - 4);
    if (b - a > 60) {
      x.fillStyle = '#152238';
      x.textAlign = 'left';
      x.fillText(g.n, a + 5, gy + gh / 2 + 4);
    }
  });
  if (TSTEP)
    TSTEP.steps.forEach((s, i) => {
      const px = X(s.t);
      x.fillStyle = '#7c3aed';
      x.beginPath();
      x.arc(px, LANE.axis + 5, 6, 0, 7);
      x.fill();
      x.fillStyle = '#fff';
      x.font = '700 8px Arial';
      x.textAlign = 'center';
      x.fillText(i + 1, px, LANE.axis + 8);
      x.font = '10.5px IBM Plex Sans,Arial';
    });
  const cx = X(RP.T);
  x.strokeStyle = '#7c3aed';
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(cx, LANE.axis - 2);
  x.lineTo(cx, H);
  x.stroke();
  x.lineWidth = 1;
  const lab = new Date(RP.T).toLocaleTimeString('en-GB', { hour12: false });
  x.font = '700 10.5px IBM Plex Mono,monospace';
  const lw = x.measureText(lab).width + 10;
  x.fillStyle = '#7c3aed';
  x.fillRect(cx - lw / 2, 0, lw, 15);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.fillText(lab, cx, 11);
  x.restore();
  $('#rpZoomLbl').textContent = span >= SHIFT_MS - 1 ? 'Whole shift' : fmtDur(span);
}
function rpZoom(f, at) {
  const span = clamp((RP.v1 - RP.v0) * f, 10 * 60e3, SHIFT_MS);
  at = at ?? RP.T;
  const r = (at - RP.v0) / (RP.v1 - RP.v0);
  RP.v0 = at - span * r;
  RP.v1 = RP.v0 + span;
  if (RP.v0 < RP.sh.t0) {
    RP.v0 = RP.sh.t0;
    RP.v1 = RP.v0 + span;
  }
  if (RP.v1 > RP.sh.t1) {
    RP.v1 = RP.sh.t1;
    RP.v0 = RP.v1 - span;
  }
  rpDraw();
}
function rpNear(t, px) {
  const W = rpGeom().W,
    tol = ((RP.v1 - RP.v0) / (W - LANE.gut)) * (px || 5);
  return RP.ev.find(e => (e.t2 ? t >= e.t - tol && t <= e.t2 + tol : Math.abs(e.t - t) < tol));
}
/* ---------- insights panel ---------- */
const KCHIP = {
  inc: ['Incident', 'sv2'],
  alm: ['Alarm', ''],
  grp: ['Change', 'info'],
  spike: ['Defects', 'sv3'],
  stop: ['Downtime', 'grey'],
};
function evChip(e) {
  const k = KCHIP[e.kind];
  if (e.kind === 'alm') return `<span class="chip sv${e.sev}">${SEVN[e.sev]}</span>`;
  return `<span class="chip ${k[1]}" ${k[1] === 'info' ? 'style="background:#1f6feb"' : k[1] === 'grey' ? 'style="background:#7b8794"' : ''}>${k[0]}</span>`;
}
function rpPanel() {
  const b = SEL && SEL.t === 'b' ? B(SEL.id) : null;
  const tabs = [
    ['sum', 'Summary'],
    ['ev', `Events (${RP.ev.length})`],
    ['cast', 'Castings'],
  ];
  if (b) tabs.push(['eq', b.name]);
  if (!tabs.some(t => t[0] === RPT)) RPT = 'sum';
  return `<div class="ph"><div style="display:flex;align-items:center;gap:8px"><span class="rp-badge">TRACEABILITY</span><b style="font-size:14px">${esc(RP.sh.label)}</b></div><small>Read-only view of what happened. Select equipment on the flowsheet for its history.</small></div>
 <div class="ptabs rp-tabs">${tabs.map(([k, n]) => `<button data-rpt="${k}" class="${RPT === k ? 'on' : ''}">${esc(n)}</button>`).join('')}</div><div id="rpPane" class="rp-pane">${rpPane(b)}</div>`;
}
function rpPane(b) {
  const T = RP.T;
  if (RPT === 'sum') {
    const al = RP.almOn.filter(a => a.a <= T && a.b > T),
      inc = RP.ev.filter(e => (e.kind === 'inc' || e.kind === 'stop') && e.t <= T && e.t2 > T),
      down = RP.stops.reduce((s, o) => s + o.iv.reduce((a, [x, y]) => a + (y - x), 0), 0),
      nal = RP.ev.filter(e => e.kind === 'alm').length;
    return `<div class="sec"><div class="row2"><div class="tile2"><span>Castings made</span><b>${RP.tot.n.toLocaleString()}</b></div><div class="tile2"><span>Defect rate</span><b class="${RP.tot.rate > 0.04 ? 'tx3' : RP.tot.rate > 0.025 ? 'tx2' : 'tx0'}">${(RP.tot.rate * 100).toFixed(1)}%</b></div><div class="tile2"><span>Alarms raised</span><b>${nal}</b></div><div class="tile2"><span>Molding downtime</span><b>${fmtDur(down)}</b></div></div></div>
  <div class="sec rp-now-box"><h5>At ${fmtHM(T)} <span class="note" style="font-weight:400">· ${esc(groupAt(T))}</span></h5>${inc.length ? inc.map(e => `<div class="kv"><span>${evChip(e)} ${esc(e.msg)}</span></div>`).join('') : ''}
   ${
     al.length
       ? al
           .slice(0, 8)
           .map(
             a =>
               `<div class="kv"><span><span class="chip sv${a.sev}">${SEVN[a.sev]}</span> ${esc(B(a.blk)?.name || '')} · ${esc(REG[a.id]?.desc || a.id)}</span><b><span class="mono">${fmtN(histVal(a.id, T), REG[a.id]?.d)}</span> <button class="lb" data-loc="${a.blk}">Locate</button></b></div>`,
           )
           .join('')
       : inc.length
         ? ''
         : '<div class="note">Nothing abnormal at this moment.</div>'
   }</div>
  <div class="sec"><h5>What happened this shift</h5>${RP.find.length ? RP.find.map(f => `<div class="fnd ${f.kind}"><div class="fnd-h"><b>${esc(f.title)}</b><span class="mono note">${f.range}</span></div><div class="note" style="color:var(--text)">${f.detail}</div><div class="fnd-a"><button class="sb" data-jt="${f.t}">Jump to start</button>${f.cause ? `<button class="sb" data-tw="${f.win[0]}|${f.win[1]}|${esc(f.cause)}">Trace a ${esc(f.cause.toLowerCase())} casting</button>` : ''}${f.blk ? `<button class="sb" data-loc="${f.blk}" data-jt2="${f.t}">Show</button>` : ''}</div></div>`).join('') : '<div class="note">A quiet shift — no incidents or downtime.</div>'}</div>`;
  }
  if (RPT === 'ev') {
    const L = RP.ev.filter(e => RPF[e.kind]);
    const cur = [...L].reverse().find(e => e.t <= T);
    return `<div class="sec" style="padding-bottom:6px"><div class="rp-filt">${Object.entries({
      inc: 'Incidents',
      stop: 'Downtime',
      spike: 'Defect spikes',
      alm: 'Alarms',
      grp: 'Changes',
    })
      .map(
        ([k, n]) =>
          `<button class="fchip ${RPF[k] ? 'on' : ''}" data-rf="${k}">${n} ${RP.ev.filter(e => e.kind === k).length}</button>`,
      )
      .join('')}</div></div>
  <div class="rp-evl">${L.map(e => `<button class="rp-ev ${e.t > T ? 'fut' : ''} ${e === cur ? 'cur' : ''}" data-jt="${e.t}" ${e.blk ? `data-sb="${e.blk}"` : ''}><span class="mono">${fmtHM(e.t)}</span>${evChip(e)}<span class="rp-evt"><b>${esc(e.where)}</b> ${esc(e.msg)}</span></button>`).join('') || '<div class="note" style="padding:12px">No events match the filters.</div>'}</div>`;
  }
  if (RPT === 'cast') {
    const mm = moldingMachines();
    let L = [];
    mm.forEach(m => (L = L.concat(moldsIn(m, T - 10 * 60e3, T))));
    L.sort((a, b) => b.t - a.t);
    if (RPC.def) L = L.filter(x => x.defect);
    return `<div class="sec"><div class="fld"><label>Find a casting by ID</label><input id="rpcQ" class="mono" placeholder="${esc(L[0]?.id || 'DISA-1-' + RP.sh.code + '-00001')}" value="${esc(RPC.q)}"></div><label class="chk"><input type="checkbox" id="rpcDef" ${RPC.def ? 'checked' : ''}> Defective only</label><div class="note">Castings molded in the 10 minutes before ${fmtHM(T)} on all lines (${L.length}).</div></div>
  <div class="tbl-wrap" style="padding:0 6px"><table><thead><tr><th>Casting ID</th><th>Molded</th><th>Result</th></tr></thead><tbody>${
    L.slice(0, 120)
      .map(
        x =>
          `<tr data-mold="${x.id}" class="rp-row"><td class="mono">${x.id}</td><td class="mono">${fmtHM(x.t)}</td><td>${x.defect ? `<span class="chip sv3">${esc(x.cause)}</span>` : '<span class="chip sv0">OK</span>'}</td></tr>`,
      )
      .join('') || '<tr><td colspan="3" class="note">No castings in this window.</td></tr>'
  }</tbody></table></div>`;
  }
  if (RPT === 'eq' && b) {
    const st = bState(b),
      tags = b.tags.map(x => REG[x.id]).filter(Boolean);
    return `<div class="sec"><div style="display:flex;align-items:center;gap:8px"><span class="st-pill" style="background:${STC[st] || '#7b8794'}">${st || '—'}</span><span class="note">at ${fmtHM(T)} · ${esc(EQ[b.type].n)}</span><button class="lb" data-loc="${b.id}" style="margin-left:auto">Centre</button></div></div>
  <div class="sec"><h5>Shift history <span class="r note">click a chart to jump</span></h5>${tags.map(t => spark(t)).join('') || '<div class="note">No tags on this item.</div>'}</div>${traceKind(b) ? traceTab(b) : ''}`;
  }
  return '';
}
function spark(t) {
  const n = 96,
    W = 250,
    H = 34,
    pts = [];
  for (let i = 0; i < n; i++) {
    const tt = RP.t0 + ((RP.t1 - RP.t0) * i) / (n - 1);
    pts.push([tt, histVal(t.id, tt)]);
  }
  const vs = pts.map(p => p[1]).concat([t.lo, t.hi].filter(v => v != null));
  let lo = Math.min(...vs),
    hi = Math.max(...vs);
  const sp = hi - lo || 1;
  lo -= sp * 0.1;
  hi += sp * 0.1;
  const X = tt => ((tt - RP.sh.t0) / SHIFT_MS) * W,
    Y = v => H - ((v - lo) / (hi - lo)) * H,
    cur = histVal(t.id, RP.T),
    sv = tagSev(t.id, cur);
  const band =
    t.lo != null || t.hi != null
      ? `<rect x="0" y="${Y(t.hi ?? hi)}" width="${W}" height="${Math.max(0, Y(t.lo ?? lo) - Y(t.hi ?? hi))}" fill="rgba(31,157,85,.08)"/>`
      : '';
  return `<div class="spk" data-spk="${esc(t.id)}"><div class="spk-h"><span>${esc(t.desc)}</span><b class="mono tx${sv}">${fmtN(cur, t.d)} ${esc(t.unit)}</b></div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${band}<polyline points="${pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="#1f6feb" stroke-width="1.4" vector-effect="non-scaling-stroke"/><line x1="${X(RP.T)}" x2="${X(RP.T)}" y1="0" y2="${H}" stroke="#7c3aed" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>`;
}
function bindRpPanel() {
  const P = $('#props');
  P.querySelectorAll('[data-rpt]').forEach(
    x =>
      (x.onclick = () => {
        RPT = x.dataset.rpt;
        renderProps();
      }),
  );
  P.querySelectorAll('[data-jt]').forEach(
    x =>
      (x.onclick = () => {
        rpSet(+x.dataset.jt, 'panel');
        if (x.dataset.sb) {
          const b = B(x.dataset.sb);
          if (b) {
            SEL = { t: 'b', id: b.id };
            renderCanvas();
            center(b);
          }
        }
      }),
  );
  P.querySelectorAll('[data-loc]').forEach(
    x =>
      (x.onclick = () => {
        if (x.dataset.jt2) rpSet(+x.dataset.jt2, 'panel');
        const b = B(x.dataset.loc);
        if (b) {
          SEL = { t: 'b', id: b.id };
          RPT = 'eq';
          renderCanvas();
          renderProps();
          center(b);
        }
      }),
  );
  P.querySelectorAll('[data-rf]').forEach(
    x =>
      (x.onclick = () => {
        RPF[x.dataset.rf] = !RPF[x.dataset.rf];
        renderProps();
      }),
  );
  P.querySelectorAll('[data-tw]').forEach(
    x =>
      (x.onclick = () => {
        const [a, b, c] = x.dataset.tw.split('|');
        let md = null;
        for (const m of moldingMachines()) {
          const L = moldsIn(m, +a, +b).filter(z => z.defect && z.cause === c);
          if (L.length) {
            md = L[Math.floor(L.length / 2)];
            break;
          }
        }
        if (md) openGenealogy(md);
        else toast('No matching casting found');
      }),
  );
  P.querySelectorAll('[data-mold]').forEach(
    x =>
      (x.onclick = () => {
        const m = parseMold(x.dataset.mold);
        if (m) openGenealogy(m);
      }),
  );
  P.querySelectorAll('[data-spk]').forEach(
    x =>
      (x.onclick = e => {
        const r = x.querySelector('svg').getBoundingClientRect();
        rpSet(RP.sh.t0 + ((e.clientX - r.left) / r.width) * SHIFT_MS, 'panel');
      }),
  );
  const q = $('#rpcQ');
  if (q)
    q.onkeydown = e => {
      if (e.key === 'Enter') {
        RPC.q = q.value;
        const m = parseMold(q.value);
        if (m) openGenealogy(m);
        else toast('Casting not found — format MACHINE-YYMMDDshift-00001');
      }
    };
  const dfc = $('#rpcDef');
  if (dfc)
    dfc.onchange = e => {
      RPC.def = e.target.checked;
      renderProps();
    };
  const ev = P.querySelector('.rp-ev.cur');
  if (ev && RPT === 'ev') ev.scrollIntoView({ block: 'nearest' });
  bindTraceTab && RPT === 'eq' && SEL && bindTraceTab(B(SEL.id));
}
function rpPanelLive(src) {
  if (!RP) return;
  if (src === 'panel' && RPT === 'sum') {
    renderProps();
    return;
  }
  const pane = $('#rpPane');
  if (!pane) return renderProps();
  const st = pane.scrollTop;
  renderProps();
  const p2 = $('#rpPane');
  if (p2 && RPT !== 'ev') p2.scrollTop = st;
}
/* ---------- casting genealogy & follow mode ---------- */
function stepsOf(md) {
  const C = md.C;
  return [
    { n: 'Sand mixing', b: C.mixer, t: md.sandT },
    { n: 'Holding hopper', b: C.hopper, t: md.sandT + 8 * 60e3 },
    { n: 'Molding', b: md.m, t: md.t },
    { n: 'Pouring', b: C.ladle, t: md.pourT },
    { n: 'Cooling & shakeout', b: C.so, t: md.soT },
  ];
}
function followCasting(md, i = 0) {
  const sh = shiftOf(md.t);
  TSTEP = { md, steps: stepsOf(md), i: 0 };
  TPATH = new Set(
    TSTEP.steps
      .map(s => s.b)
      .filter(Boolean)
      .map(b => b.id),
  );
  closeModal();
  if (!RP || RP.sh.t0 !== sh.t0) {
    const keep = TSTEP;
    enterReplay(sh, md.t);
    TSTEP = keep;
    TPATH = new Set(
      keep.steps
        .map(s => s.b)
        .filter(Boolean)
        .map(b => b.id),
    );
  }
  followStep(i);
}
function followStep(i) {
  if (!TSTEP) return;
  TSTEP.i = clamp(i, 0, TSTEP.steps.length - 1);
  const s = TSTEP.steps[TSTEP.i];
  const sh = RP.sh;
  if (s.t > RP.t1 || s.t < RP.t0) {
    toast(`${s.n} happened outside this shift (${fmtHM(s.t)})`);
  }
  rpSet(clamp(s.t, RP.t0, RP.t1), 'panel');
  if (s.b) {
    SEL = { t: 'b', id: s.b.id };
    RPT = 'eq';
    renderCanvas();
    renderProps();
    center(s.b);
  }
  rpHeader();
}
function drawTrace() {
  const L = $('#Ltrace');
  if (!L) return;
  if (!TSTEP || !RP) {
    L.innerHTML = '';
    return;
  }
  const pts = TSTEP.steps
    .map((s, i) => {
      if (!s.b) return null;
      const d = dims(s.b);
      return { x: s.b.x + d.W / 2, y: s.b.y + d.H / 2, top: s.b.y - 4, lx: s.b.x - 6, i };
    })
    .filter(Boolean);
  L.innerHTML =
    `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#7c3aed" stroke-width="3" stroke-dasharray="8 6" opacity=".7"/>` +
    pts
      .map(
        p =>
          `<g transform="translate(${p.lx},${p.top})"><circle r="13" fill="${p.i === TSTEP.i ? '#7c3aed' : '#fff'}" stroke="#7c3aed" stroke-width="3"/><text y="5" text-anchor="middle" style="font:700 13px var(--sans);fill:${p.i === TSTEP.i ? '#fff' : '#7c3aed'}">${p.i + 1}</text></g>`,
      )
      .join('');
}
function openGenealogy(md) {
  const f = o => (o ? `${fmtN(o.v, o.t.d)} ${o.t.unit}` : '—'),
    cls = o => {
      if (!o) return '';
      const s = tagSev(o.id, o.v);
      return s ? 'tx' + s : 'tx0';
    };
  const C = md.C;
  const rows = [
    [
      ['Sand batch', md.batch],
      ['Moisture', f(md.F.moist), cls(md.F.moist)],
      ['Compactability', f(md.F.comp), cls(md.F.comp)],
      [
        'Bentonite',
        md.F.bent ? `${f(md.F.bent)} (prescribed ${fmtN(md.F.bent.t.typ, 1)})` : '—',
        cls(md.F.bent),
      ],
      ['GCS', f(md.F.gcs), cls(md.F.gcs)],
      ['Product', md.group],
    ],
    [['Transit', `~${Math.round(DELAY.sand / 60e3)} min mixer → mold`]],
    [
      ['Mold ID', md.id],
      ['Squeeze pressure', f(md.F.sqz), cls(md.F.sqz)],
      ['Mold hardness', f(md.F.hard), cls(md.F.hard)],
    ],
    [
      ['Heat', md.heat],
      ['Pouring temperature', f(md.F.pour), cls(md.F.pour)],
    ],
    [
      ['Cooling time', `${Math.round(DELAY.cool / 60e3)} min`],
      ['Sand temp at shakeout', f(md.F.stmp), cls(md.F.stmp)],
    ],
  ];
  const steps = stepsOf(md);
  let cause = '';
  if (md.defect) {
    const d = md.drv[md.cause],
      F = d && md.F[d.f];
    if (!d || !F || md.c[md.cause] < 0.3)
      cause = `<div class="gn-cause"><b>Most likely cause: ${esc(md.cause)}.</b> No process value on this casting's route was near its limit — check pattern, core and inspection records.</div>`;
    else {
      const lim = d.dir > 0 ? F.t.hi : F.t.lo,
        when = d.f === 'pour' ? md.pourT : ['sqz', 'hard'].includes(d.f) ? md.t : md.sandT;
      cause = `<div class="gn-cause"><b>Most likely cause: ${esc(md.cause)}.</b> ${esc(d.lab)} was <b>${fmtN(F.v, F.t.d)} ${esc(F.t.unit)}</b> (${d.dir > 0 ? 'high limit' : 'low limit'} ${fmtN(lim, F.t.d)}) at ${hms(new Date(when))} — ${esc(d.why)}.</div>`;
    }
  }
  openModal(
    `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div><h3 class="mono" style="margin:0">${md.id}</h3><div class="note">${esc(md.group)} · molded ${new Date(md.t).toLocaleString('en-GB', { hour12: false })}</div></div><span class="chip ${md.defect ? 'sv3' : 'sv0'}" style="margin-left:auto;font-size:12px;padding:4px 10px">${md.defect ? esc(md.cause) : 'OK — no defect recorded'}</span></div>${cause}
 <div class="gn">${steps.map((s, i) => `<div class="gn-s"><div class="gn-dot">${i + 1}</div><div class="gn-b"><div class="gn-h"><b>${s.n}</b><span class="note">${s.b ? esc(s.b.name) : 'not on flowsheet'} · ${hms(new Date(s.t))}</span>${s.b ? `<button class="sb" data-fs="${i}">Show on flowsheet</button>` : ''}</div>${rows[i].map(r => `<div class="kv"><span>${r[0]}</span><b class="${r[2] || ''}">${esc(r[1])}</b></div>`).join('')}</div></div>`).join('')}</div>
 <div class="mact"><button class="ib" id="gnCopy">Copy trace (JSON)</button><button class="ib pri" id="gnFollow">Follow this casting on the flowsheet</button></div>`,
    'xl',
  );
  $('#gnFollow').onclick = () => followCasting(md, 0);
  $$('#mbox [data-fs]').forEach(x => (x.onclick = () => followCasting(md, +x.dataset.fs)));
  $('#gnCopy').onclick = () =>
    copyText(
      JSON.stringify(
        {
          casting: md.id,
          product: md.group,
          result: md.defect ? md.cause : 'OK',
          batch: md.batch,
          heat: md.heat,
          steps: steps.map((s, i) => ({
            stage: s.n,
            equipment: s.b?.name,
            time: new Date(s.t).toISOString(),
            values: Object.fromEntries(rows[i].map(r => [r[0], r[1]])),
          })),
        },
        null,
        1,
      ),
      'Trace copied',
    );
}
/* ---------- wiring ---------- */
const _ccData = ccData;
ccData = function () {
  if (!RP) return _ccData();
  const t = REG[trendTag];
  if (!t) return [];
  const n = 300,
    step = (TR.win * 1000) / n,
    out = [];
  for (let i = n - 1; i >= 0; i--) {
    const tt = RP.T - i * step;
    out.push({ t: tt, v: histVal(trendTag, tt) });
  }
  return t.lab ? out.filter((p, i) => i === 0 || p.v !== out[i - 1].v) : out;
};
setInterval(() => {
  if (!RP || !RP.play) return;
  const T = RP.T + 200 * RP.speed;
  if (T >= RP.t1) {
    RP.play = false;
    rpSet(RP.t1);
    toast('End of the shift');
    return;
  }
  if (T > RP.v1 || T < RP.v0) {
    const s = RP.v1 - RP.v0;
    RP.v0 = T - s * 0.1;
    RP.v1 = RP.v0 + s;
    rpZoom(1, T);
  }
  rpSet(T);
}, 200);
$('#bReplay').onclick = () => {
  if (RP) exitReplay();
  else enterReplay();
};
$('#rpExit').onclick = exitReplay;
$('#rpPlay').onclick = () => {
  if (!RP) return;
  if (RP.T >= RP.t1) RP.T = RP.t0;
  RP.play = !RP.play;
  rpSet(RP.T);
  renderStatus();
};
$$('#rpSpeeds button').forEach(
  b =>
    (b.onclick = () => {
      if (RP) {
        RP.speed = +b.dataset.sp;
        rpHeader();
      }
    }),
);
$$('#rbar [data-step]').forEach(
  b =>
    (b.onclick = () => {
      if (RP) rpSet(RP.T + +b.dataset.step * 60e3);
    }),
);
function rpJumpEv(dir) {
  if (!RP) return;
  const L = RP.ev.filter(e => e.kind !== 'alm' || RPF.alm);
  const e = dir < 0 ? [...L].reverse().find(x => x.t < RP.T - 1000) : L.find(x => x.t > RP.T + 1000);
  if (e) {
    rpSet(e.t, 'panel');
    toast(`${fmtHM(e.t)} · ${e.where}: ${e.msg}`);
  } else toast(dir < 0 ? 'No earlier event' : 'No later event');
}
$('#rpPrev').onclick = () => rpJumpEv(-1);
$('#rpNext').onclick = () => rpJumpEv(1);
$$('#rpShifts button').forEach(
  (b, i) =>
    (b.onclick = () => {
      const s = shiftsFor($('#rpDate').value || dstr(Date.now()))[i];
      if (s.t0 > Date.now()) return;
      enterReplay(s, s.t0);
    }),
);
$('#rpDate').onchange = e => {
  const L = shiftsFor(e.target.value).filter(s => s.t0 <= Date.now());
  if (!L.length) {
    toast('Choose a date that has already happened');
    return;
  }
  const keep = RP ? SHIFTS.findIndex(x => x[0] === RP.sh.L) : 0;
  const s = L[Math.min(keep, L.length - 1)];
  enterReplay(s, s.t0);
};
$$('#rbar [data-zm]').forEach(
  b =>
    (b.onclick = () => {
      if (!RP) return;
      const z = b.dataset.zm;
      if (z === 'all') {
        RP.v0 = RP.sh.t0;
        RP.v1 = RP.sh.t1;
        rpDraw();
      } else rpZoom(z === 'in' ? 0.5 : 2);
    }),
);
(() => {
  const c = $('#rpTl'),
    tipE = $('#rpTip');
  let on = false;
  const tAt = e => {
    const r = c.getBoundingClientRect();
    return clamp(xT(e.clientX - r.left, r.width), RP.t0, RP.t1);
  };
  c.addEventListener('pointerdown', e => {
    if (!RP) return;
    const r = c.getBoundingClientRect();
    if (e.clientX - r.left < LANE.gut) return;
    on = true;
    c.setPointerCapture(e.pointerId);
    rpSet(tAt(e));
  });
  c.addEventListener('pointermove', e => {
    if (!RP) return;
    if (on) {
      rpSet(tAt(e));
      return;
    }
    const r = c.getBoundingClientRect();
    if (e.clientX - r.left < LANE.gut) {
      tipE.style.display = 'none';
      return;
    }
    const t = tAt(e),
      ev = rpNear(t, 6),
      k = Math.floor((t - RP.t0) / RP.bw),
      bin = RP.bins[k];
    tipE.innerHTML = `<b>${fmtHM(t)}</b>${bin && bin.n ? ` · ${(bin.rate * 100).toFixed(1)}% defects (${bin.d}/${bin.n})` : ''}${ev ? `<br>${esc(ev.where)}: ${esc(ev.msg)}` : ''}`;
    tipE.style.display = 'block';
    tipE.style.left = Math.min(r.width - 220, Math.max(0, e.clientX - r.left + 12)) + 'px';
  });
  c.addEventListener('pointerup', () => {
    if (on) {
      on = false;
      rpPanelLive('panel');
    }
  });
  c.addEventListener('pointerleave', () => (tipE.style.display = 'none'));
  c.addEventListener(
    'wheel',
    e => {
      if (!RP) return;
      e.preventDefault();
      const r = c.getBoundingClientRect();
      rpZoom(e.deltaY < 0 ? 0.8 : 1.25, xT(e.clientX - r.left, r.width));
    },
    { passive: false },
  );
  c.addEventListener('dblclick', () => {
    if (RP) {
      RP.v0 = RP.sh.t0;
      RP.v1 = RP.sh.t1;
      rpDraw();
    }
  });
  new ResizeObserver(() => rpDraw()).observe(c);
})();
document.addEventListener(
  'keydown',
  e => {
    if (!RP || $('#modal').classList.contains('on')) return;
    const tg = e.target.tagName;
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
    if (e.key === ' ') {
      e.preventDefault();
      $('#rpPlay').click();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopImmediatePropagation();
      rpSet(RP.T + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1) * 60e3, 'panel');
    } else if (e.key === ',' || e.key === '.') {
      e.preventDefault();
      e.stopImmediatePropagation();
      rpJumpEv(e.key === ',' ? -1 : 1);
    } else if (e.key === 'Escape' && TSTEP) {
      e.stopImmediatePropagation();
      TSTEP = null;
      TPATH.clear();
      renderCanvas();
      rpHeader();
    }
  },
  true,
);
