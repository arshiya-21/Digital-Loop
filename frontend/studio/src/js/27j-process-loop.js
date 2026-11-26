/*! SandMan Digital Loop Studio — 27j-process-loop.js
 *  v9.95 — Parameters monitoring (design H). Opened from the Publish bar button next to Maintenance, the top-bar
 *  Parameters chip and the area badges on the drawing.
 *  · Top: what needs attention (alarm / warning / near limit) with the value and how far it is from its limit.
 *  · The six areas of the loop in sand-loop order (1 → 2 → 3, then 4 → 5 → 6, back to 1). Each shows 12 value tiles at a
 *    time and pages through ALL its tags every 10 s; tags in alarm / warning / near limit stay on every page.
 *  · Each tile: name, value + unit, trend arrow (last 5 min), equipment and limits. Click a tile for its control chart.
 *  · "View all" opens one area with every tag, a status filter and search.
 *  Values refresh every second while the screen is open. */

const PL = { on: false, t: null, view: null, filter: 'all', q: '', t0: 0, cap: 12, cols: 4, lay: 'loop' };
/* v10.1 — two layouts: 'loop' (snake 1 2 3 / 6 5 4) and 'cols' (one column per process, left to right) */
/* Parameters monitoring always opens in Loop; Columns is one click away (it is no longer remembered between opens) */
const plTH = () => (PL.lay === 'cols' ? 44 : innerHeight < 900 ? 58 : PL_TH);
const PL_PER = 12,
  PL_SEC = 10,
  PL_TH = 70, // tile height (px)
  PL_ROT = 4, // seconds per alarm when a process has several
  PL_MAX = 6, // processes on screen at once (Loop and Columns)
  PL_GSEC = 20, // seconds per group of processes when there are more than PL_MAX
  PL_SLIDE = 700, // ms for one slide from one group to the next
  PL_CAR_AW = 22, // px between two columns of the moving strip (the arrow)
  PL_CAR_SEC = 8; // seconds for one column to move past (slow, steady)
PL.cx = 0; // how far the moving strip has travelled (px)
/* the moving Columns strip: steady and slow, every frame; pauses while pointed at, while a chart is open or the tab is hidden */
function plCarTick(ts) {
  if (!PL.on) return void (PL.raf = 0);
  const dt = PL.lastTs ? Math.min(100, ts - PL.lastTs) : 0;
  PL.lastTs = ts;
  const t = document.getElementById('plTrack');
  if (t) {
    const L = +t.dataset.l,
      step = +t.dataset.step;
    if (!PL.hold && !document.hidden && !$('#modal').classList.contains('on')) PL.cx += (dt * step) / (PL_CAR_SEC * 1000);
    if (L > 0) t.style.transform = `translateX(${-(((PL.cx % L) + L) % L).toFixed(1)}px)`;
  }
  PL.raf = requestAnimationFrame(plCarTick);
}
PL.g0 = Date.now();
PL.gLast = null;
const PL_ORDER = [/prep|bento|new sand/i, /mull|mix/i, /mould|mold|disa/i, /pour|melt/i, /shake|knock|cast/i, /return|cool/i];
function plNice(s) {
  s = String(s || '').replace(/_/g, ' ').trim();
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\bpct\b/g, '%').replace(/^./, c => c.toUpperCase());
  return s.replace(/\b(gcs|plc)\b/gi, m => m.toUpperCase());
}
const plAreaName = z => plNice(afName(z).replace(/^[A-Z]\s*[·.\-:]\s*/, '')).replace(/^./, c => c.toUpperCase());
/* status of one reading: a alarm · w warning · n near limit · k in limits · x no limit set · d no data */
function plSt(id) {
  const t = REG[id],
    v = val(id);
  if (v == null || !isFinite(v)) return 'd';
  const lim = ['hh', 'hi', 'lo', 'll'].some(k => t[k] != null) || (typeof alBand === 'function' && !!alBand(t));
  if (!lim) return 'x';
  const s = tagSev(id);
  return s >= 3 ? 'a' : s === 2 ? 'w' : s === 1 ? 'n' : 'k';
}
const PL_RANK = { a: 0, w: 1, n: 2, k: 3, x: 4, d: 5 };
function plSteps() {
  /* every area box drawn on the loop is a process step (one with no readings yet shows "0 parameters"), so the count and
     the "Step n of N" match the loop as drawn — e.g. 7 areas → 7 steps, 6 → 7 → back to 1 */
  const Z = afZones();
  const rank = z => {
    const i = PL_ORDER.findIndex(r => r.test(afName(z)));
    return i < 0 ? 99 : i;
  };
  return Z.slice()
    .sort((a, b) => rank(a) - rank(b))
    .map((z, i) => {
      const seen = new Set(),
        rows = [];
      afMembers(z).forEach(b => {
        const E = EQ[b.type];
        if (!E || E.widget || !b.tags) return;
        b.tags.forEach(bt => {
          const t = REG[bt.id];
          if (!t || seen.has(bt.id) || tagIsText(t)) return;
          seen.add(bt.id);
          rows.push({ id: bt.id, eq: b.name, nm: plNice(t.short || t.desc || bt.id.split('.').pop()), t, st: plSt(bt.id) });
        });
      });
      const c = { a: 0, w: 0, n: 0, k: 0, x: 0, d: 0 };
      rows.forEach(r => c[r.st]++);
      return { z, i, name: plAreaName(z), rows, c, st: c.a ? 'a' : c.w ? 'w' : c.n ? 'n' : c.k ? 'k' : 'x' };
    });
}
/* distance to the nearer limit as a share of the band (smaller = closer) */
function plProx(r) {
  const t = r.t,
    v = val(r.id),
    lo = t.lo != null ? t.lo : t.ll,
    hi = t.hi != null ? t.hi : t.hh,
    sp = lo != null && hi != null ? hi - lo : Math.abs(hi != null ? hi : lo) || 1;
  return Math.min(hi != null ? (hi - v) / sp : 9, lo != null ? (v - lo) / sp : 9);
}
/* trend over the last 5 minutes of history: u rising · d falling · r steady */
function plTrend(r) {
  const V = VAL[r.id],
    t = r.t;
  if (!V || !V.h || V.h.length < 10) return 'r';
  const h = V.h,
    now = h[h.length - 1],
    old = h.find(p => p.t >= now.t - 300000) || h[0],
    lo = t.lo != null ? t.lo : t.ll,
    hi = t.hi != null ? t.hi : t.hh,
    sp = lo != null && hi != null ? hi - lo : Math.abs(now.v) || 1,
    d = now.v - old.v;
  return d > sp * 0.04 ? 'u' : d < -sp * 0.04 ? 'd' : 'r';
}
const PL_AR = { u: 'M8 13V3M4 7l4-4 4 4', d: 'M8 3v10M4 9l4 4 4-4', r: 'M3 8h10M9 4l4 4-4 4' };
function plLim(r) {
  const t = r.t,
    lo = t.lo != null ? t.lo : t.ll,
    hi = t.hi != null ? t.hi : t.hh;
  if (r.st === 'x') return 'no limit';
  const sp = lo != null && hi != null ? hi - lo : Math.abs(hi != null ? hi : lo || 0),
    d = Math.min(t.d == null ? 1 : t.d, sp >= 10 ? 0 : sp >= 1 ? 1 : 2),
    f = x => fmtN(x, d);
  if (lo != null && hi != null) return `${f(lo)}–${f(hi)}`;
  return hi != null ? `≤ ${f(hi)}` : lo != null ? `≥ ${f(lo)}` : '';
}
function plTile(r) {
  const t = r.t,
    v = val(r.id),
    tr = plTrend(r),
    hot = ['a', 'w', 'n'].includes(r.st);
  return `<button type="button" class="plh-t s-${r.st}" data-plt="${esc(r.id)}" title="${esc(r.id)} — open the control chart">
   <span class="nm">${esc(r.nm)}</span>
   <span class="vr"><span class="v">${r.st === 'd' ? '—' : esc(fmtN(v, t.d))}</span><span class="u">${esc(t.unit || '')}</span><svg class="ar${hot && tr !== 'r' ? ' on' : ''}" viewBox="0 0 16 16" aria-hidden="true"><path d="${PL_AR[tr]}"/></svg></span>
   <span class="lm"><span class="eq">${esc(r.eq)}</span><span>${esc(plLim(r))}</span></span></button>`;
}
const PL_PILL = { a: n => `Alarm · ${n.a}`, w: n => `Warning · ${n.w}`, n: n => `Near limit · ${n.n}`, k: () => 'All in limits', x: () => 'No limits set' };
function plBar(c) {
  const tot = c.a + c.w + c.n + c.k + c.x + c.d || 1;
  return `<span class="plh-sb">${[['a', 'var(--crit)'], ['w', 'var(--warn)'], ['n', 'var(--adv)'], ['k', 'var(--ok)'], ['x', '#c9d3df'], ['d', '#e2e8f0']]
    .map(([k, col]) => (c[k] ? `<i style="width:${((c[k] / tot) * 100).toFixed(2)}%;background:${col}"></i>` : ''))
    .join('')}</span>`;
}
function plPanel(p) {
  const hot = p.rows.filter(r => ['a', 'w', 'n'].includes(r.st)).sort((a, b) => PL_RANK[a.st] - PL_RANK[b.st]);
  const rest = p.rows.filter(r => !hot.includes(r)).sort((a, b) => PL_RANK[a.st] - PL_RANK[b.st] || (a.st === 'k' ? plProx(a) - plProx(b) : 0));
  const CAP = Math.max(2, PL.cap || PL_PER),
    per = Math.max(1, CAP - Math.min(hot.length, CAP - 1)),
    pages = Math.max(1, Math.ceil(rest.length / per)),
    pg = Math.floor(Date.now() / (PL_SEC * 1000)) % pages,
    /* every page is full: the last page wraps round to the first tags */
    pageRows = rest.length > per ? Array.from({ length: per }, (_, k) => rest[(pg * per + k) % rest.length]) : rest,
    show = [...hot.slice(0, CAP - 1), ...pageRows].slice(0, CAP),
    rowsUsed = Math.max(1, Math.ceil(show.length / Math.max(1, PL.cols || 4))),
    left = PL_SEC - (Math.floor(Date.now() / 1000) % PL_SEC),
    lim = p.c.a + p.c.w + p.c.n + p.c.k;
  return `<section class="plh-pn">
   <div class="ph"><span class="no">${p.i + 1}</span><h3>${esc(p.name)}</h3><span class="pill s-${p.st}"><i></i>${PL_PILL[p.st](p.c)}</span></div>
   <div class="ps"><span>${p.rows.length} parameters · ${lim} with limits</span>${plBar(p.c)}</div>
   <div class="tiles${rowsUsed <= 2 && show.length <= (PL.cols || 4) * 2 ? ' big' : ''}" style="--rows:${rowsUsed}">${show.map(plTile).join('')}</div>
   <div class="pf">${pages > 1 ? `<span class="dots">${Array.from({ length: Math.min(pages, 12) }, (_, k) => `<i class="${k === pg ? 'on' : ''}"></i>`).join('')}</span><span class="pt">Page ${pg + 1} of ${pages} · all ${p.rows.length} tags · next in ${left} s</span>` : `<span class="pt">All ${p.rows.length} tags shown</span>`}
    <button type="button" class="lk" data-plview="${p.i}">View all →</button></div></section>`;
}
function plDev(r) {
  const t = r.t,
    v = val(r.id),
    hi = t.hi != null ? t.hi : t.hh,
    lo = t.lo != null ? t.lo : t.ll,
    u = t.unit ? ' ' + t.unit : '';
  if (hi != null && v > hi) return `<b>+${fmtN(v - hi, t.d)}${u}</b> above high limit ${fmtN(hi, t.d)}`;
  if (lo != null && v < lo) return `<b>−${fmtN(lo - v, t.d)}${u}</b> below low limit ${fmtN(lo, t.d)}`;
  const sp = lo != null && hi != null ? hi - lo : Math.abs(hi != null ? hi : lo) || 1;
  if (hi != null && (lo == null || hi - v < v - lo)) return `<b>${Math.round((v / hi) * 100)}%</b> of high limit ${fmtN(hi, t.d)}`;
  return lo != null ? `close to low limit ${fmtN(lo, t.d)}` : `limit band ${fmtN(sp, t.d)}`;
}
/* v9.96 — no header of its own: the screen sits inside the Digital Loop view, under the app's own bars */
const plHeader = () => '';
function plOverview(S) {
  /* v10.2 — one attention card per process, all the same size; several alarms in a process rotate every PL_ROT s */
  const SVL = { a: 'Alarm', w: 'Warning', n: 'Near limit' },
    sec = Math.floor(Date.now() / 1000),
    fresh = sec % PL_ROT === 0;
  let h = plHeader(S);
  const sw = `<div class="plh-lay" role="group" aria-label="Layout">${[
    ['loop', 'Loop', '<path d="M3 4h4v4H3zM10 4h4v4h-4zM17 4h4v4h-4zM3 14h4v4H3zM10 14h4v4h-4zM17 14h4v4h-4z"/>'],
    ['cols', 'Columns', '<path d="M3 3h4v18H3zM10 3h4v18h-4zM17 3h4v18h-4z"/>'],
  ]
    .map(([k, l, d]) => `<button type="button" data-pllay="${k}" aria-pressed="${PL.lay === k}"><svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>${l}</button>`)
    .join('')}</div>`;
  /* limit band: the in-limit zone, the zones beyond, and a marker at the value */
  const band = r => {
    const t = r.t,
      v = val(r.id),
      lo = t.lo != null ? t.lo : t.ll,
      hi = t.hi != null ? t.hi : t.hh;
    if (v == null || (lo == null && hi == null)) return '';
    const sp = lo != null && hi != null ? hi - lo : Math.abs(hi != null ? hi : lo) * 0.5 || 1,
      a0 = lo != null ? lo - sp * 0.4 : Math.min(0, v),
      a1 = hi != null ? hi + sp * 0.4 : lo + sp * 1.8,
      pc = x => Math.max(0, Math.min(100, ((x - a0) / (a1 - a0)) * 100)),
      L = lo != null ? pc(lo) : 0,
      H = hi != null ? pc(hi) : 100,
      f = x => fmtN(x, Math.min(t.d == null ? 1 : t.d, sp >= 10 ? 0 : 1));
    return `<span class="bd"><span class="bl">${lo != null ? f(lo) : ''}</span><span class="lb"><i class="z" style="left:${L}%;width:${H - L}%"></i><i class="m" style="left:${pc(v)}%"></i></span><span class="bl">${hi != null ? f(hi) : ''}</span></span>`;
  };
  const card = p => {
    const hot = p.rows.filter(r => ['a', 'w', 'n'].includes(r.st)).sort((x, y) => PL_RANK[x.st] - PL_RANK[y.st] || plProx(x) - plProx(y));
    const hd = `<span class="pr"><span class="no">${p.i + 1}</span><span class="tx">${esc(p.name)}</span></span>`,
      lim = p.c.a + p.c.w + p.c.n + p.c.k;
    if (!hot.length)
      return `<div class="sc s-k calm"><span class="hd"><span class="st"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>OK</span>${hd}</span>
        <span class="bo"><span class="nm">${p.rows.length ? 'All in limits' : 'No readings'}</span><span class="cnt"><b>${p.rows.length}</b> parameters<br><b>${lim}</b> with limits</span></span>
        <span class="bd"><span class="lb ok"></span></span></div>`;
    const k = Math.floor(sec / PL_ROT) % hot.length,
      r = hot[k];
    return `<button type="button" class="sc s-${r.st}${fresh && hot.length > 1 ? ' fresh' : ''}" data-plt="${esc(r.id)}" title="${esc(r.id)} — open the control chart"><span class="hd"><span class="st">${SVL[r.st]}</span>${hd}${
      hot.length > 1 ? `<span class="rc">${hot.slice(0, 6).map((_, j) => `<i class="${j === k ? 'on' : ''}"></i>`).join('')}<b>${k + 1}/${hot.length}</b></span>` : ''
    }</span><span class="bo"><span class="nt"><span class="eq">${esc(r.eq)}</span><span class="nm">${esc(r.nm)}</span><span class="d">${plDev(r)}</span></span><span class="v">${esc(fmtN(val(r.id), r.t.d))}<u>${esc(r.t.unit || '')}</u></span></span>${band(r)}</button>`;
  };
  /* more than six processes: six at a time in both layouts, moving on by itself every PL_GSEC s (no vertical scroll).
     Pages are full: the last one ends at the last process (7 processes → 1–6, then 2–7). */
  /* Columns with more than six: one continuous strip moving slowly to the left, 1 → … → last → 1 (see plCarTick).
     Loop with seven or eight: all of them in one snake, 1 2 3 (4) on top and the rest back along the bottom. */
  const carousel = PL.lay === 'cols' && S.length > PL_MAX && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    loopAll = PL.lay === 'loop' && S.length > PL_MAX && S.length <= 8,
    noPage = carousel || loopAll;
  const ALL = S,
    np = noPage ? 1 : Math.max(1, Math.ceil(ALL.length / PL_MAX)),
    gp = np > 1 ? Math.floor((Date.now() - PL.g0) / (PL_GSEC * 1000)) % np : 0,
    g0 = Math.min(gp * PL_MAX, Math.max(0, ALL.length - PL_MAX)),
    last = g0 + PL_MAX >= ALL.length,
    nextP = ALL[g0 + PL_MAX] || null,
    turned = np > 1 && PL.gLast !== gp && PL.gLast != null;
  if (turned) PL.gAt = Date.now();
  PL.gLast = gp;
  /* plRender may draw twice in one go (tile re-measure); both draws keep the slide */
  const flip = Date.now() - (PL.gAt || 0) < 80;
  S = noPage ? ALL : ALL.slice(g0, g0 + PL_MAX);
  const gLeft = PL_GSEC - (Math.floor((Date.now() - PL.g0) / 1000) % PL_GSEC),
    pg =
      np > 1
        ? `<span class="plg"><span class="dots">${Array.from({ length: np }, (_, k) => `<button type="button" data-plg="${k}" class="${k === gp ? 'on' : ''}" aria-label="Show page ${k + 1}"></button>`).join('')}</span><span>Steps ${g0 + 1}–${g0 + S.length} of ${ALL.length} · next in ${gLeft} s</span></span>`
        : '';
  h = `<div class="plh-pg${flip ? ' flip' : ''}">` + h;
  const cards = S.map(card);
  const P = S.map(plPanel),
    arr = (d, lbl) => `<div class="arw ${d === 0 ? 'r' : d === 180 ? 'l' : d === 90 ? 'dn' : 'up'}" title="${lbl || 'Sand flows to the next step'}"><span class="plt"></span><span class="bd"><svg viewBox="0 0 24 24" style="transform:rotate(${d}deg)"><path d="M6 12h12M13 7l5 5-5 5"/></svg></span></div>`;
  if (carousel) {
    /* each item = the process's status card above its column; the sequence is drawn twice so the strip loops without a
       seam; its position comes from PL.cx (moved every frame by plCarTick, kept across the once-a-second redraw) */
    const n = S.length,
      cw = Math.max(200, Math.round(((PL.vw || 1500) - 5 * PL_CAR_AW) / 6)),
      step = cw + PL_CAR_AW,
      L = n * step,
      x = ((PL.cx % L) + L) % L;
    const items = [];
    for (let r = 0; r < 2; r++)
      S.forEach((p, k) =>
        items.push(
          `<div class="ci" style="width:${cw}px"><div class="plh-att2" style="--n:1">${cards[k]}</div>${P[k]}</div><div class="ca">${arr(0, k === n - 1 ? 'Return sand goes back to step 1' : '')}</div>`,
        ),
      );
    h += `<div class="plh-cols plh-car" id="plCar"><div class="plh-track" id="plTrack" data-l="${L}" data-step="${step}" style="transform:translateX(${-x}px)">${items.join('')}</div></div></div>`;
    h += `<div class="plh-ret" title="Return sand goes back to sand preparation"><span class="ed">↑</span><span class="plt"></span><span class="rl">Return sand back to step 1 · ${esc(ALL[0].name)}</span><span class="end"></span><span class="plg"><span>${n} steps · moving · point at it to pause</span></span>${sw}</div>`;
    return h;
  }
  if (PL.lay === 'cols') h += `<div class="plh-att2 cols" style="--n:${S.length}">${cards.map((c, i) => (i ? '<div></div>' : '') + c).join('')}</div>`;
  else if (S.length <= 6 && S.length > 3) {
    /* Loop: two cards above each loop column, edges in line with the panels below */
    const per = Math.ceil(S.length / 3),
      grp = [0, 1, 2].map(g => `<div class="pair" style="--k:${per}">${cards.slice(g * per, g * per + per).join('')}</div>`);
    h += `<div class="plh-att2 loopg">${grp.join('<div></div>')}</div>`;
  } else h += `<div class="plh-att2" style="--n:${S.length}">${cards.join('')}</div>`;
  /* the same footer row in both layouts: Columns → return-sand line + switch; Loop → colour key + switch */
  const key = `<span class="key">${[['a', 'Alarm'], ['w', 'Warning'], ['n', 'Near limit'], ['k', 'In limits']].map(([k, l]) => `<span class="s-${k}"><i></i>${l}</span>`).join('')}<span class="nx">Values refresh every second · pages change every ${PL_SEC} s</span></span>`;
  if (loopAll) {
    /* seven or eight in one snake, four columns:
         7: [↱] → 1 → 2 → 3        8: 1 → 2 → 3 → 4
             ↑            ↓           ↑            ↓
             7 ← 6 ← 5 ← 4            8 ← 7 ← 6 ← 5       */
    const n = S.length,
      top = Math.floor(n / 2),
      E = '<div></div>',
      cor = `<div class="rtrk cor" title="Return sand goes back to sand preparation"><span class="plt h"></span><span class="plt v"></span></div>`;
    const topCells = top < 4 ? [cor, ...P.slice(0, top)] : P.slice(0, 4),
      bot = P.slice(top).reverse(); // left → right: last … first of the bottom row
    let g = topCells.map((c, i) => (i ? arr(0) : '') + c).join('');
    g += `<div class="ret">${arr(-90, 'Return sand goes back to sand preparation')}<span class="rl">Return sand back to step 1</span></div>${E}${E}${E}${E}${E}${arr(90)}`;
    g += bot.map((c, i) => (i ? arr(180) : '') + c).join('');
    h = h.replace(/<div class="plh-att2 loopg">[\s\S]*$/, '');
    h += `<div class="plh-loop l4">${g}</div></div><div class="plh-ret nol">${key}${sw}</div>`;
    return h;
  }
  /* columns: 1 → 2 → 3 → … left to right, return sand runs back underneath */
  if (PL.lay === 'cols') {
    const g = P.map((x, k) => (k ? arr(0) : '') + x).join('');
    h += `<div class="plh-cols" style="--n:${S.length}">${g}</div>`;
    if (S.length > 2 && last) h += `</div><div class="plh-ret" title="Return sand goes back to sand preparation"><span class="ed">↑</span><span class="plt"></span><span class="rl">Return sand back to step 1 · ${esc(ALL[0].name)}</span><span class="end"></span>${pg}${sw}</div>`;
    else h += `</div><div class="plh-ret nol">${nextP ? `<span class="nxp">Then step ${nextP.i + 1} · ${esc(nextP.name)} →</span>` : key}${pg}${sw}</div>`;
    return h;
  }
  /* snake: 1 2 3 / 6 5 4 — up to six areas; more areas fall back to rows of three */
  if (S.length <= 6) {
    const E = '<div></div>',
      cell = k => P[k] || E,
      a = (k, d) => (P[k] ? arr(d) : E);
    let g = cell(0) + a(1, 0) + cell(1) + a(2, 0) + cell(2);
    if (S.length > 3) {
      /* fewer than six processes: the empty places on the bottom row carry the return-sand track, so the last process
         flows left into it and up to step 1 (was: an empty space with the return arrow starting from nothing) */
      const n = S.length,
        trk = end => `<div class="rtrk${end ? ' end' : ''}" title="Return sand goes back to sand preparation"><span class="plt h"></span>${end ? '<span class="plt v"></span>' : ''}</div>`;
      const bc = k => (P[k] ? P[k] : trk(k === 5)), // bottom cell k (5 = leftmost)
        ba = k => (P[k] ? arr(180) : n === k ? arr(180) : trk(false)); // arrow into cell k-1 from cell k
      /* not the last page: step 6 here flows on to the next page's first step, not back to step 1 */
      const ret = last
        ? `<div class="ret">${arr(-90, 'Return sand goes back to sand preparation')}<span class="rl">Return sand back to step 1</span></div>`
        : `<div class="ret nx"><span class="rl">Then step ${nextP.i + 1} · ${esc(nextP.name)} →</span></div>`;
      g += `${ret}${E}${E}${E}${arr(90)}` + bc(5) + ba(5) + bc(4) + ba(4) + cell(3);
    }
    h += `<div class="plh-loop${S.length <= 3 ? ' one' : ''}">${g}</div></div>`;
    h += `<div class="plh-ret nol">${key}${pg}${sw}</div>`;
  } else h += `<div class="plh-loop wide">${P.join('')}</div></div><div class="plh-ret nol">${key}${pg}${sw}</div>`;
  return h;
}
function plDetail(S, i) {
  const p = S[i];
  if (!p) return plOverview(S);
  const F = [['all', 'All', p.rows.length], ['a', 'Alarm', p.c.a], ['w', 'Warning', p.c.w], ['n', 'Near limit', p.c.n], ['k', 'In limits', p.c.k], ['x', 'No limits', p.c.x + p.c.d]];
  const q = PL.q.trim().toLowerCase();
  const rows = p.rows
    .filter(r => PL.filter === 'all' || r.st === PL.filter || (PL.filter === 'x' && r.st === 'd'))
    .filter(r => !q || (r.eq + ' ' + r.nm + ' ' + r.id).toLowerCase().includes(q))
    .sort((a, b) => PL_RANK[a.st] - PL_RANK[b.st] || a.eq.localeCompare(b.eq, undefined, { numeric: true }) || a.nm.localeCompare(b.nm));
  let h = '';
  h += `<div class="plh-dt"><div class="crumb"><button type="button" class="lk" data-plback>← Process loop</button><span>Step ${i + 1} of ${S.length}</span></div><div class="ph"><span class="no">${i + 1}</span><h3>${esc(p.name)}</h3><span class="pill s-${p.st}"><i></i>${PL_PILL[p.st](p.c)}</span>${plBar(p.c)}
    <span class="nav"><button type="button" class="lk" data-plview="${(i + S.length - 1) % S.length}">‹ ${esc(S[(i + S.length - 1) % S.length].name)}</button><button type="button" class="lk" data-plview="${(i + 1) % S.length}">${esc(S[(i + 1) % S.length].name)} ›</button></span></div>
   <div class="flt">${F.map(([k, l, n]) => `<button type="button" data-plf="${k}" aria-pressed="${PL.filter === k}">${l}<b>${n}</b></button>`).join('')}<input type="search" id="plQ" placeholder="Search name or tag…" value="${esc(PL.q)}" aria-label="Search parameters"></div>
   <div class="grid">${rows.map(plTile).join('') || '<div class="empty">No parameters match.</div>'}</div></div>`;
  return h;
}
function plRender() {
  const B = $('#plBox');
  if (!B) return;
  const S = plSteps(),
    focus = document.activeElement && document.activeElement.id === 'plQ',
    caret = focus ? document.activeElement.selectionStart : 0,
    top = B.scrollTop,
    /* the group on screen now, kept so it can slide out to the left when the next group slides in */
    _vw = (PL.vw = Math.max(600, B.clientWidth - 32)), // the moving strip sizes six columns to this width
    oldPg = B.querySelector('.plh-pg'),
    oldBox = oldPg && { t: oldPg.offsetTop, l: oldPg.offsetLeft, w: oldPg.offsetWidth, h: oldPg.offsetHeight };
  B.innerHTML = PL.view == null ? plOverview(S) : plDetail(S, PL.view);
  if (PL.view == null) {
    const T = B.querySelector('.plh-pn .tiles');
    if (T) {
      const cols = getComputedStyle(T).gridTemplateColumns.split(' ').filter(Boolean).length || 1,
        gap = PL.lay === 'cols' ? 4 : 7,
        rows = Math.max(1, Math.floor((T.clientHeight + gap) / (plTH() + gap))),
        cap = Math.max(2, Math.min(PL.lay === 'cols' ? 40 : 24, cols * rows));
      if (cap !== PL.cap || cols !== PL.cols) {
        PL.cap = cap;
        PL.cols = cols;
        B.innerHTML = plOverview(S);
      }
    }
  }
  B.scrollTop = top;
  /* slider: the new group comes in from the right (.flip), the old one leaves to the left */
  const newPg = B.querySelector('.plh-pg.flip');
  if (newPg && oldPg && oldBox && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    oldPg.classList.remove('flip');
    oldPg.classList.add('out');
    oldPg.removeAttribute('id');
    oldPg.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
    Object.assign(oldPg.style, { top: oldBox.t + 'px', left: oldBox.l + 'px', width: oldBox.w + 'px', height: oldBox.h + 'px' });
    B.appendChild(oldPg);
    PL.slideEnd = Date.now() + PL_SLIDE;
    setTimeout(() => oldPg.remove(), PL_SLIDE);
  }
  B.querySelectorAll('[data-plt]').forEach(x => (x.onclick = () => openTrend(x.dataset.plt)));
  B.querySelectorAll('[data-plview]').forEach(x => (x.onclick = () => ((PL.view = +x.dataset.plview), (PL.filter = 'all'), (PL.q = ''), plRender(), (B.scrollTop = 0))));
  B.querySelectorAll('[data-plback]').forEach(x => (x.onclick = () => ((PL.view = null), plRender())));
  B.querySelectorAll('[data-pllay]').forEach(
    x =>
      (x.onclick = () => {
        PL.lay = x.dataset.pllay;
        try {
          localStorage.setItem('sm.plLay', PL.lay);
        } catch (e) {}
        plRender();
      }),
  );
  /* the moving strip pauses while the pointer is on it (to read or click a value) */
  const car = B.querySelector('#plCar');
  if (car) {
    car.onpointerenter = () => (PL.hold = true);
    car.onpointerleave = () => (PL.hold = false);
    if (!car.matches(':hover')) PL.hold = false;
  } else PL.hold = false;
  /* a page dot jumps to that group of processes and restarts its time */
  B.querySelectorAll('[data-plg]').forEach(x => (x.onclick = () => ((PL.g0 = Date.now() - +x.dataset.plg * PL_GSEC * 1000), plRender())));
  B.querySelectorAll('[data-plf]').forEach(x => (x.onclick = () => ((PL.filter = x.dataset.plf), plRender())));
  const q = $('#plQ');
  if (q) {
    q.oninput = () => ((PL.q = q.value), plRender());
    if (focus) (q.focus(), q.setSelectionRange(caret, caret));
  }
}
function plOpen() {
  let O = $('#plOv');
  const host = $('#cwrap') || document.body;
  if (!O) {
    host.insertAdjacentHTML('beforeend', '<div id="plOv" class="plh-ov" role="region" aria-label="Parameters monitoring"><div id="plBox" class="plh-box"></div></div>');
    O = $('#plOv');
  }
  PL.on = true;
  PL.view = null;
  PL.lay = 'loop'; // opens in Loop by default
  O.classList.add('on');
  /* the screen is redrawn every second: while a mouse button is down on it, wait — otherwise a click that spans a redraw
     (press on the old "View all", release on the new one) is lost and "View all" looked like it did nothing */
  if (!O._pdown) {
    O._pdown = true;
    O.addEventListener('pointerdown', () => (PL.pdown = Date.now()), true);
    const up = () => setTimeout(() => (PL.pdown = 0), 80);
    O.addEventListener('pointerup', up, true);
    O.addEventListener('pointercancel', up, true);
  }
  document.body.classList.add('pl-on'); // the loop drawing is covered: stop painting it (see #plCss)
  const bt = $('#pLoop');
  if (bt) bt.setAttribute('aria-pressed', 'true');
  plRender();
  clearInterval(PL.t);
  cancelAnimationFrame(PL.raf);
  PL.lastTs = 0;
  PL.raf = requestAnimationFrame(plCarTick);
  /* no redraw while a slide is running, so it is not cut off half way */
  PL.t = setInterval(() => PL.on && !document.hidden && !$('#modal').classList.contains('on') && Date.now() > (PL.slideEnd || 0) && !(PL.pdown && Date.now() - PL.pdown < 3000) && plRender(), 1000);
}
function plClose() {
  PL.on = false;
  clearInterval(PL.t);
  cancelAnimationFrame(PL.raf);
  PL.raf = 0;
  const O = $('#plOv');
  if (O) O.classList.remove('on');
  document.body.classList.remove('pl-on');
  const bt = $('#pLoop');
  if (bt) bt.setAttribute('aria-pressed', 'false');
}
const plToggle = () => (PL.on ? plClose() : plOpen());
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !PL.on || $('#modal').classList.contains('on')) return;
  if (PL.view != null) (PL.view = null), plRender();
  else plClose();
});
/* the chip, the area badges and the Publish bar all open Parameters monitoring */
pmOpen = plOpen;
{
  const c = $('#pmChip');
  if (c) c.onclick = plToggle;
  /* Main screen, leaving Publish or changing mode go back to the loop */
  const pm = $('#pMain');
  if (pm) pm.addEventListener('click', () => PL.on && plClose());
  const _sp = setPresent;
  setPresent = function (on) {
    if (!on && PL.on) plClose();
    return _sp.apply(this, arguments);
  };
  /* v9.94 — the Publish bar button sits right after Maintenance */
  const anchor = $('#pMnt') || $('#pMain');
  if (anchor && !$('#pLoop')) {
    anchor.insertAdjacentHTML('afterend', '<button class="p10 p-loop" id="pLoop" title="Parameters monitoring — every process with its parameters and status" aria-label="Parameters monitoring">◎<span class="p10t"> Parameters monitoring</span></button>');
    $('#pLoop').onclick = plToggle;
  }
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="plCss">
.plh-ov{position:absolute;inset:0;z-index:40;display:none;background:#eef2f7}
.plh-ov.on{display:block}
.plh-box{--crit:#d93636;--warn:#d9690b;--adv:#b98a00;--ok:#1f9d55;--navy:#0e2d5c;--ln:#dbe2ec;--mu:#55657d;--fa:#7a889c;--pb:#fff;
 height:100%;overflow:auto;background:#eef2f7;padding:12px 16px 14px;color:#152238;font:14px/1.4 var(--sans);font-variant-numeric:tabular-nums;display:flex;flex-direction:column;gap:12px}
.plh-box .s-a{--c:var(--crit);--cb:#fdecec}.plh-box .s-w{--c:var(--warn);--cb:#fff2e5}.plh-box .s-n{--c:var(--adv);--cb:#fff8dc}.plh-box .s-k{--c:var(--ok);--cb:#e7f5ed}.plh-box .s-x,.plh-box .s-d{--c:#7a889c;--cb:#f1f4f8}
.plh-box button{font:inherit;color:inherit}
.plh-box .lk{border:0;background:none;color:#1f6feb;font-weight:600;cursor:pointer;padding:0}
.plh-hd{display:flex;align-items:center;gap:20px}
.plh-hd h2{margin:0;font:600 24px var(--sans);color:var(--navy)}
.plh-hd h2 .back{font-size:20px;color:var(--navy)}
.plh-hd .sub{color:var(--mu);font-size:13px}
.plh-hd .hr{margin-left:auto;display:flex;align-items:center;gap:18px;color:var(--mu);font-size:13.5px}
.plh-hd .hr b{color:#152238;font:600 15px var(--mono)}
.plh-hd .live{display:inline-flex;align-items:center;gap:7px;font-weight:600;color:var(--ok);font-family:var(--mono)}
.plh-hd .live i{width:8px;height:8px;border-radius:50%;background:var(--ok)}
.plh-hd .x0{width:36px;height:36px;border-radius:9px;border:1px solid var(--ln);background:#fff;cursor:pointer;font-size:15px}
.plh-att{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.plh-att .ac{text-align:left;background:#fff;border:1px solid var(--ln);border-radius:12px;padding:10px 16px;display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:14px;align-items:center;cursor:pointer}
.plh-att .ac.ok{grid-column:1/-1;cursor:default;color:var(--ok)}
.plh-att .ac .k{grid-column:1/-1;display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--mu)}
.plh-att .ac .st{font:600 11px var(--sans);letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--c);border-radius:4px;padding:2px 7px}
.plh-att .ac .nm{font:600 16px var(--sans);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plh-att .ac .nm span{font:500 12px var(--mono);color:var(--fa);margin-right:7px}
.plh-att .ac .v{grid-row:2/4;grid-column:2;font:600 34px var(--mono);color:var(--c);line-height:1}
.plh-att .ac .v u{text-decoration:none;font-size:15px;margin-left:3px}
.plh-att .ac .d{font-size:12.5px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plh-att .ac .d b{color:var(--c)}
.plh-att .more{background:#fff;border:1px solid var(--ln);border-radius:12px;padding:10px 16px;display:flex;flex-direction:column;justify-content:center;color:var(--mu);font-size:13px}
.plh-att .more b{font:600 26px var(--mono);color:#152238}
.plh-loop{flex:1;min-height:420px;display:grid;grid-template-columns:minmax(0,1fr) 46px minmax(0,1fr) 46px minmax(0,1fr);grid-template-rows:minmax(0,1fr) 40px minmax(0,1fr)}
.plh-loop.one{grid-template-rows:minmax(0,1fr)}
.plh-loop.wide{grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:none;gap:14px}
.plh-loop .arw{position:relative;display:grid;place-items:center;min-width:0;min-height:0}
.plh-loop .arw .plt{position:absolute;border-radius:4px;background-color:#e8dcc4;background-image:repeating-linear-gradient(90deg,#b9894a 0 7px,transparent 7px 16px);animation:plfR 1.1s linear infinite}
.plh-loop .arw.r .plt,.plh-loop .arw.l .plt{left:-2px;right:-2px;top:50%;height:8px;margin-top:-4px}
.plh-loop .arw.l .plt{animation-name:plfL}
.plh-loop .arw.dn .plt,.plh-loop .arw.up .plt{top:-2px;bottom:-2px;left:50%;width:8px;margin-left:-4px;background-image:repeating-linear-gradient(180deg,#b9894a 0 7px,transparent 7px 16px);animation-name:plfD}
.plh-loop .arw.up .plt{animation-name:plfU}
@keyframes plfR{to{background-position:16px 0}}@keyframes plfL{to{background-position:-16px 0}}@keyframes plfD{to{background-position:0 16px}}@keyframes plfU{to{background-position:0 -16px}}
@media (prefers-reduced-motion:reduce){.plh-loop .arw .plt{animation:none}}
.plh-loop .arw .bd{position:relative;width:32px;height:32px;border-radius:50%;background:var(--navy);display:grid;place-items:center;box-shadow:0 0 0 4px #eef2f7,0 2px 6px rgba(14,45,92,.25)}
.plh-loop .arw svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.plh-loop .rtrk{position:relative;min-width:0;min-height:0}
.plh-loop .rtrk .plt{position:absolute;border-radius:4px;background-color:#e8dcc4;background-image:repeating-linear-gradient(90deg,#b9894a 0 7px,transparent 7px 16px);animation:plfL 1.1s linear infinite;left:-2px;right:-2px;top:50%;height:8px;margin-top:-4px}
.plh-loop .rtrk.end .plt.h{left:calc(50% - 4px)}
.plh-loop .rtrk.end .plt.v{left:50%;right:auto;width:8px;margin-left:-4px;top:-2px;height:calc(50% + 6px);margin-top:0;background-image:repeating-linear-gradient(180deg,#b9894a 0 7px,transparent 7px 16px);animation-name:plfU}
@media (prefers-reduced-motion:reduce){.plh-loop .rtrk .plt{animation:none}}
.plh-loop .ret{position:relative;display:flex;align-items:center}
.plh-loop .ret .arw{width:46px;height:100%;margin-left:calc(50% - 23px)}
.plh-loop .ret .rl{position:absolute;left:calc(50% + 26px);white-space:nowrap;font:600 12.5px var(--sans);color:#8a6a3a;background:#f6efe2;border-radius:999px;padding:3px 10px}
.plh-pn{min-height:0;min-width:0;background:#fff;border:1px solid var(--ln);border-radius:12px;display:flex;flex-direction:column;padding:10px 12px}
.plh-box .ph{display:flex;align-items:center;gap:10px}
.plh-box .ph .no{width:26px;height:26px;border-radius:50%;background:var(--navy);color:#fff;display:grid;place-items:center;font:600 13px var(--sans);flex:none}
.plh-box .ph h3{margin:0;font:600 18px var(--sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plh-box .pill{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding:3px 11px;border-radius:999px;background:var(--cb);color:var(--c);font:600 12.5px var(--sans);white-space:nowrap}
.plh-box .pill i{width:7px;height:7px;border-radius:50%;background:var(--c)}
.plh-pn .ps{display:flex;align-items:center;gap:12px;margin-top:6px;color:var(--mu);font-size:12.5px;white-space:nowrap}
.plh-sb{flex:1;display:flex;height:6px;border-radius:3px;overflow:hidden;background:#e8eef5;min-width:60px}
.plh-sb i{height:100%}
.plh-pn .tiles{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-template-rows:repeat(var(--rows,3),minmax(0,1fr));gap:7px;margin-top:10px;overflow:hidden}
.plh-t{min-width:0;min-height:0;text-align:left;border:1px solid var(--ln);border-radius:8px;background:#fff;padding:6px 9px 5px;display:flex;flex-direction:column;cursor:pointer}
.plh-t:hover{border-color:#1f6feb}
.plh-t .nm{font:500 13px var(--sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plh-t .vr{display:flex;align-items:baseline;gap:4px}
.plh-t .v{font:600 22px var(--mono);line-height:1.15;letter-spacing:-.02em}
.plh-t .u{font:500 12px var(--sans);color:var(--fa);flex:none}
.plh-t .vr{min-width:0;overflow:hidden}
.plh-t .ar{flex:none;width:22px;height:22px;padding:3px;margin-left:auto;align-self:center;border-radius:6px;background:#e3eaf3;fill:none;stroke:#1f3b63;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.plh-t .ar.on{background:var(--c);stroke:#fff}
.plh-t.s-a .ar,.plh-t.s-w .ar,.plh-t.s-n .ar{background:rgba(255,255,255,.7);stroke:var(--c)}
.plh-t.s-a .ar.on,.plh-t.s-w .ar.on,.plh-t.s-n .ar.on{background:var(--c);stroke:#fff}
.plh-t .lm{display:flex;justify-content:space-between;gap:6px;margin-top:auto;padding-top:3px;border-top:1px solid #edf1f6;font:500 11px var(--mono);color:var(--mu);white-space:nowrap}
.plh-t .lm .eq{color:var(--fa);overflow:hidden;text-overflow:ellipsis;min-width:0}
.plh-t.s-a,.plh-t.s-w,.plh-t.s-n{background:var(--cb);border-color:transparent}
.plh-t.s-a .v,.plh-t.s-w .v,.plh-t.s-n .v{color:var(--c)}
.plh-t.s-a .lm,.plh-t.s-w .lm,.plh-t.s-n .lm{border-top-color:rgba(0,0,0,.06)}
.plh-t.s-x .v,.plh-t.s-d .v{color:var(--mu)}
.plh-pn .pf{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--mu);white-space:nowrap}
.plh-pn .pf .pt{margin-right:auto;overflow:hidden;text-overflow:ellipsis}
.plh-pn .dots{display:inline-flex;gap:4px}.plh-pn .dots i{width:6px;height:6px;border-radius:50%;background:#c9d3df}.plh-pn .dots i.on{background:var(--navy)}
.plh-dt{background:#fff;border:1px solid var(--ln);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.plh-dt .ph .plh-sb{max-width:260px}
.plh-dt .crumb{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--mu)}
.plh-dt .nav{display:flex;gap:16px;margin-left:16px}
.plh-dt .flt{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.plh-dt .flt button{border:1px solid var(--ln);background:#fff;border-radius:8px;padding:5px 12px;cursor:pointer;font-weight:600;font-size:13px;color:var(--mu);display:inline-flex;gap:7px;align-items:center}
.plh-dt .flt button b{font:600 12px var(--mono);color:#152238}
.plh-dt .flt button[aria-pressed="true"]{background:var(--navy);border-color:var(--navy);color:#fff}.plh-dt .flt button[aria-pressed="true"] b{color:#fff}
.plh-dt .flt input{margin-left:auto;width:260px;height:32px;border:1px solid var(--ln);border-radius:8px;padding:0 10px;font:inherit}
.plh-dt .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));grid-auto-rows:78px;gap:8px}
.plh-dt .empty{padding:20px;color:var(--mu)}
@media (max-width:1500px){.plh-pn .tiles{grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}.plh-t .v{font-size:20px}.plh-loop{grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr) 20px minmax(0,1fr)}}
@media (max-width:900px){.plh-loop{display:flex;flex-direction:column;gap:12px;min-height:0}.plh-loop .arw,.plh-loop .ret,.plh-loop .rtrk,.plh-loop>div:empty{display:none}.plh-pn .tiles{height:310px;flex:none}}
.p-loop[aria-pressed="true"]{box-shadow:inset 0 0 0 2px #fff,0 0 0 2px #0e2d5c}
.plh-pn .tiles.big .v{font-size:28px}.plh-pn .tiles.big .nm{font-size:14px}
.plh-pn .tiles .plh-t{justify-content:flex-start}
.plh-top{display:flex;gap:12px;align-items:stretch}
.plh-top .plh-att{flex:1;min-width:0}
.plh-lay{flex:none;align-self:flex-start;display:flex;background:#fff;border:1px solid var(--ln);border-radius:10px;padding:3px;gap:2px}
.plh-lay button{border:0;background:none;border-radius:7px;padding:6px 11px;cursor:pointer;font:600 13px var(--sans);color:var(--mu);display:inline-flex;align-items:center;gap:6px}
.plh-lay svg{width:15px;height:15px;fill:currentColor}
.plh-lay button[aria-pressed="true"]{background:var(--navy);color:#fff}
.plh-cols{flex:1;min-height:420px;display:grid;grid-template-columns:minmax(0,1fr) repeat(calc(var(--n) - 1),22px minmax(0,1fr));grid-template-rows:minmax(0,1fr)}
.plh-cols .arw{position:relative;display:block;min-width:0}
.plh-cols .arw .plt{position:absolute;left:-2px;right:-2px;top:22px;height:6px;border-radius:3px;background-color:#e8dcc4;background-image:repeating-linear-gradient(90deg,#b9894a 0 7px,transparent 7px 16px);animation:plfR 1.1s linear infinite}
.plh-cols .arw .bd{position:absolute;left:50%;top:25px;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;background:var(--navy);display:grid;place-items:center;box-shadow:0 0 0 3px #eef2f7}
.plh-cols .arw svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.plh-cols .plh-pn{padding:9px 9px 8px}
.plh-cols .ph{gap:4px 7px;flex-wrap:wrap}.plh-cols .ph .pill{margin-left:29px}.plh-cols .ph h3{flex:1 1 auto;min-width:0}.plh-cols .ph h3{font-size:15.5px}.plh-cols .ph .no{width:22px;height:22px;font-size:12px}
.plh-cols .pill{padding:2px 8px;font-size:11.5px}
.plh-cols .ps{flex-direction:column;align-items:stretch;gap:5px;font-size:11.5px}
.plh-cols .plh-sb{flex:none;width:100%}
.plh-cols .tiles,.plh-cols .tiles.big{grid-template-columns:1fr;grid-template-rows:repeat(var(--rows,3),minmax(0,50px));align-content:start;gap:4px;margin-top:8px}
.plh-cols .plh-t{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:8px;align-content:center;padding:3px 8px;border-radius:7px}
.plh-cols .plh-t .nm{grid-column:1/3;grid-row:1;font-size:12.5px;line-height:1.2}
.plh-cols .plh-t .lm{grid-column:1;grid-row:2;align-self:center;margin:0;padding:0;border:0;font-size:10.5px;justify-content:flex-start;gap:7px;min-width:0;overflow:hidden}.plh-cols .plh-t .lm>span:last-child{flex:none}
.plh-cols .plh-t .vr{grid-column:2;grid-row:2;align-self:center;align-items:center;overflow:visible}
.plh-cols .plh-t .v,.plh-cols .tiles.big .v{font-size:18px;line-height:1.1}
.plh-cols .plh-t .ar{width:18px;height:18px;padding:2px;margin-left:4px}
.plh-cols .pf{flex-wrap:wrap;row-gap:3px;font-size:11px}
.plh-cols .pf .pt{flex:1 1 100%;order:2}
.plh-ret{position:relative;flex:none;height:30px;display:flex;align-items:center;margin:-4px 0 0}
.plh-ret .plt{position:relative;flex:1;margin:0 -2px;height:6px;border-radius:3px;background-color:#e8dcc4;background-image:repeating-linear-gradient(90deg,#b9894a 0 7px,transparent 7px 16px);animation:plfL 1.1s linear infinite}
.plh-ret .ed{position:relative;z-index:1;width:26px;height:26px;border-radius:50%;background:var(--navy);color:#fff;display:grid;place-items:center;font:700 14px var(--sans);box-shadow:0 0 0 3px #eef2f7}
.plh-ret .end{position:relative;z-index:1;flex:none;width:12px;height:12px;border-radius:50%;background:var(--navy);box-shadow:0 0 0 3px #eef2f7}
.plh-ret .rl{position:absolute;left:50%;transform:translateX(-50%);z-index:1;white-space:nowrap;font:600 12.5px var(--sans);color:#8a6a3a;background:#f6efe2;border-radius:999px;padding:3px 12px;box-shadow:0 0 0 3px #eef2f7}
@media (prefers-reduced-motion:reduce){.plh-cols .arw .plt,.plh-ret .plt{animation:none}}
@media (max-width:1100px){.plh-cols{overflow-x:auto;grid-template-columns:220px repeat(calc(var(--n) - 1),22px 220px)}}
.plh-att2{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:12px}
.plh-att2.cols{grid-template-columns:minmax(0,1fr) repeat(calc(var(--n) - 1),22px minmax(0,1fr));gap:0}
.plh-att2 .sc{min-width:0;text-align:left;background:#fff;border:1px solid var(--ln);border-radius:12px;padding:0;display:flex;flex-direction:column;overflow:hidden;cursor:pointer;height:112px;box-sizing:border-box;box-shadow:0 1px 2px rgba(14,45,92,.05)}
.plh-att2 .sc:hover{border-color:var(--c)}
.plh-att2 .sc.calm{cursor:default}
.plh-att2 .sc.fresh .bo,.plh-att2 .sc.fresh .bd{animation:plIn .45s ease-out}
@keyframes plIn{from{opacity:.2;transform:translateY(5px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.plh-att2 .sc.fresh .bo,.plh-att2 .sc.fresh .bd{animation:none}}
.plh-att2 .hd{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--cb);border-bottom:1px solid rgba(0,0,0,.04);min-width:0}
.plh-att2 .st{flex:none;display:inline-flex;align-items:center;gap:3px;font:700 10.5px var(--sans);letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--c);border-radius:4px;padding:2px 7px}
.plh-att2 .st svg{width:11px;height:11px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.plh-att2 .pr{display:flex;align-items:center;gap:6px;min-width:0;font:600 12.5px var(--sans);color:#1d2d47;white-space:nowrap}
.plh-att2 .pr .tx{overflow:hidden;text-overflow:ellipsis}
.plh-att2 .pr .no{flex:none;width:18px;height:18px;border-radius:50%;background:var(--navy);color:#fff;display:grid;place-items:center;font:600 10.5px var(--sans)}
.plh-att2 .rc{margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:3px}
.plh-att2 .rc i{width:6px;height:6px;border-radius:50%;background:rgba(0,0,0,.15)}.plh-att2 .rc i.on{background:var(--c);width:14px;border-radius:3px}
.plh-att2 .rc b{font:600 11px var(--mono);color:var(--c);margin-left:4px}
.plh-att2 .bo{flex:1;min-height:0;display:flex;align-items:center;gap:10px;padding:6px 12px 2px}
.plh-att2 .nt{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.plh-att2 .nt .eq{font:500 11px var(--mono);color:var(--fa)}
.plh-att2 .nt .nm,.plh-att2 .calm .nm{font:600 15px var(--sans);color:#152238;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plh-att2 .nt .d{font-size:11.5px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plh-att2 .nt .d b{color:var(--c)}
.plh-att2 .v{flex:none;font:600 30px var(--mono);color:var(--c);line-height:1;letter-spacing:-.03em;white-space:nowrap}
.plh-att2 .v u{text-decoration:none;font:500 13px var(--sans);margin-left:3px;letter-spacing:0;color:var(--c);opacity:.8}
.plh-att2 .calm .nm{flex:1;color:var(--ok);font-size:16px}
.plh-att2 .calm .cnt{flex:none;text-align:right;font-size:11.5px;color:var(--mu);line-height:1.35}
.plh-att2 .calm .cnt b{font:600 12.5px var(--mono);color:#152238}
.plh-att2 .bd{display:flex;align-items:center;gap:7px;padding:2px 12px 9px;font:500 10.5px var(--mono);color:var(--fa)}
.plh-att2 .bd .bl{flex:none;min-width:0}
.plh-att2 .lb{position:relative;flex:1;height:6px;border-radius:3px;background:color-mix(in srgb,var(--crit) 22%,#fff)}
.plh-att2 .lb .z{position:absolute;top:0;bottom:0;background:#cfe9d9;border-left:2px solid #fff;border-right:2px solid #fff}
.plh-att2 .lb .m{position:absolute;top:-4px;width:4px;height:14px;margin-left:-2px;border-radius:2px;background:var(--c);box-shadow:0 0 0 2px #fff}
.plh-att2 .lb.ok{background:#cfe9d9}
@media (max-width:1500px){.plh-att2.cols .pr .tx{display:none}.plh-att2 .v{font-size:22px}.plh-att2 .nt .nm{font-size:13.5px}.plh-att2 .rc i{display:none}.plh-att2 .calm .cnt{display:none}.plh-att2 .nt .d{display:none}.plh-att2 .sc{height:100px}}
@media (max-width:1100px){.plh-att2.cols{overflow-x:auto;grid-template-columns:220px repeat(calc(var(--n) - 1),22px 220px)}.plh-att2{grid-template-columns:repeat(3,minmax(0,1fr))}}
.plh-att2.loopg{grid-template-columns:minmax(0,1fr) 46px minmax(0,1fr) 46px minmax(0,1fr);gap:0}
.plh-att2 .pair{display:grid;grid-template-columns:repeat(var(--k),minmax(0,1fr));gap:10px;min-width:0}
.plh-ret.nol{justify-content:space-between;height:30px;margin:-4px 0 0}
.plh-ret .key{display:flex;align-items:center;gap:16px;font-size:12px;color:var(--mu);white-space:nowrap;overflow:hidden}
.plh-ret .key>span{display:inline-flex;align-items:center;gap:6px}
.plh-ret .key i{width:10px;height:10px;border-radius:3px;background:var(--c)}
.plh-ret .key .nx{color:var(--fa);margin-left:8px}
@media (max-width:1500px){.plh-att2.loopg{grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr) 20px minmax(0,1fr)}.plh-att2 .pair{gap:8px}.plh-ret .key .nx{display:none}}
@media (max-height:900px){.plh-box{gap:9px;padding-top:9px}.plh-att2 .sc{height:84px}.plh-att2 .hd{padding:4px 10px}.plh-att2 .nt .eq{display:none}.plh-att2 .bo{padding:3px 12px 0}.plh-att2 .bd{padding:1px 12px 6px}
 .plh-loop .plh-t{padding:4px 8px 3px}.plh-loop .plh-t .v,.plh-pn .tiles.big .v{font-size:20px}.plh-loop .plh-t .nm{font-size:12.5px}.plh-loop .plh-t .lm{padding-top:2px;font-size:10.5px}.plh-pn .tiles.big .nm{font-size:13px}
 .plh-loop .plh-pn{padding:8px 10px}.plh-loop .ph h3{font-size:16px}.plh-pn .ps{margin-top:4px}.plh-pn .tiles{margin-top:7px}.plh-pn .pf{margin-top:5px}.plh-ret.nol{height:24px}}
.plh-pg{flex:1;min-height:0;display:flex;flex-direction:column;gap:inherit}
.plh-box{position:relative;overflow-x:hidden}
/* performance: while Parameters monitoring covers the loop, the drawing underneath (moving pictures, lines, lamps) is not
   painted at all */
body.pl-on #cv{visibility:hidden}
.plh-cols.plh-car{display:block;position:relative;overflow:hidden;min-height:420px}
.plh-car .plh-track{display:flex;height:100%;will-change:transform}
.plh-car .ci{flex:none;display:flex;flex-direction:column;gap:12px;min-height:0;height:100%}
.plh-car .ci .plh-att2{display:block}
.plh-car .ci .plh-pn{flex:1;min-height:0}
.plh-car .ca{flex:none;width:22px;position:relative;padding-top:124px;box-sizing:border-box}
.plh-car .ca .arw{height:100%}
@media (max-width:1500px){.plh-car .ca{padding-top:112px}}
@media (max-height:900px){.plh-car .ca{padding-top:93px}}
.plh-loop.l4{grid-template-columns:minmax(0,1fr) 46px minmax(0,1fr) 46px minmax(0,1fr) 46px minmax(0,1fr)}
@media (max-width:1500px){.plh-loop.l4{grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr) 20px minmax(0,1fr) 20px minmax(0,1fr)}}
.plh-loop .rtrk.cor .plt.h{left:calc(50% - 4px)}
.plh-loop .rtrk.cor .plt.v{left:50%;right:auto;width:8px;margin-left:-4px;top:calc(50% - 4px);bottom:-2px;height:auto;margin-top:0;background-image:repeating-linear-gradient(180deg,#b9894a 0 7px,transparent 7px 16px);animation-name:plfU}
.plh-pg.flip{animation:plPgIn .7s cubic-bezier(.45,0,.2,1)}
.plh-pg.out{position:absolute;margin:0;pointer-events:none;animation:plPgOut .7s cubic-bezier(.45,0,.2,1) forwards}
@keyframes plPgIn{from{transform:translateX(calc(100% + 24px))}to{transform:none}}
@keyframes plPgOut{from{transform:none}to{transform:translateX(calc(-100% - 24px))}}
@media (prefers-reduced-motion:reduce){.plh-pg.flip,.plh-pg.out{animation:none}.plh-pg.out{display:none}}
.plh-ret .plg{position:relative;z-index:1;flex:none;display:inline-flex;align-items:center;gap:8px;margin-left:10px;padding:2px 10px;border-radius:999px;background:#fff;border:1px solid var(--ln);font-size:12px;color:var(--mu);white-space:nowrap}
.plh-ret .plg .dots{display:inline-flex;gap:4px}
.plh-ret .plg .dots button{width:8px;height:8px;padding:0;border:0;border-radius:50%;background:#c9d3df;cursor:pointer}
.plh-ret .plg .dots button.on{background:var(--navy);width:18px;border-radius:4px}
.plh-ret .nxp,.plh-loop .ret.nx .rl{font:600 12.5px var(--sans);color:#8a6a3a;background:#f6efe2;border-radius:999px;padding:3px 12px;white-space:nowrap}
.plh-ret.nol .plg{margin-left:auto}
.plh-ret .plh-lay{position:relative;z-index:1;margin-left:10px;align-self:center;padding:2px}
.plh-ret .plh-lay button{padding:3px 9px;font-size:12px}
</style>`,
);
