/*! SandMan Digital Loop Studio — 27-tag-cards.js
 *  v9.69 — Data label card styles. Instead of one box per reading, all readings of a machine can be shown
 *  as one card that moves as one piece:
 *    classic  — today's separate boxes (default, nothing changes for existing layouts)
 *    table    — compact table card: name left, value right, unit grey, out-of-limit row red
 *    group    — grouped sections (Batch · Sand & water · Drives · Other), made from the reading names
 *    hmi      — dark control-room card
 *  v9.73 — four more styles from the Tag Label Styles preview:
 *    tile     — each reading as a tile with a big number (2 columns), for shop-floor screens
 *    bars     — readings with limits get a bar: green band = limits, marker = live value
 *    kpi      — the first two readings big at the top, the rest with a 2-minute trend line
 *    status   — state badge + a strip that shows how many readings are inside their limits; alarm rows marked red
 *  Style for the whole layout: DOC.lblStyle. Style for one machine: b.props.lblStyle (wins over the layout).
 *  "Signals in the card" (b.props.lblChips, default on for cards): status lamps whose tag belongs to the same
 *  machine (same tag prefix, e.g. MX-1.…) are shown as on / off chips inside the card and hidden on the canvas.
 *  The card is drawn in SVG, so publish view, replay, export image and printouts show it the same way. */

const LBL_STY = [
  ['classic', 'Classic'],
  ['table', 'Table'],
  ['group', 'Grouped'],
  ['hmi', 'Dark HMI'],
  ['tile', 'Tiles'],
  ['bars', 'Bars vs limits'],
  ['kpi', 'Key numbers + trend'],
  ['status', 'Status card']
];
const LBL_GROUPS = [
  ['Batch', /cycle|batch|count|today|preset|mode|recipe/i],
  ['Sand & water', /sand|water|compact|moist|bento|clay|scale|temp|gcs|press|level/i],
  ['Drives', /current|power|motor|rotor|speed|kw|amp|torque|freq/i]
];
const lblStyle = b => (b && b.props && b.props.lblStyle) || DOC.lblStyle || 'classic';
const lblIsCard = b => lblStyle(b) !== 'classic' && !EQ[b.type].inst && !EQ[b.type].widget;
const lblPrefix = id => String(id).split('.')[0];

/* status lamps that belong to a machine: their tag starts with the same prefix as the machine's readings */
let LBL_LAMPS = new Map(); // lamp block id → machine block id
function lblLampsOf(b) {
  const pre = new Set((b.tags || []).map(t => lblPrefix(t.id)));
  if (!pre.size) return [];
  return DOC.blocks.filter(x => x.type === 'statusLamp' && x.tags && x.tags[0] && pre.has(lblPrefix(x.tags[0].id)));
}
function lblIndexLamps() {
  LBL_LAMPS = new Map();
  if (!SHOWTAGS) return;
  DOC.blocks.forEach(b => {
    if (!EQ[b.type] || !lblIsCard(b) || b.props.lblChips === false) return;
    lblLampsOf(b).forEach(l => LBL_LAMPS.set(l.id, b.id));
  });
}
const lblLampName = l => {
  const t = REG[l.tags[0].id];
  return (l.props && l.props.lamp && l.props.lamp.label) || (t && t.short) || l.name || (t && t.desc) || l.tags[0].id;
};
const lblLampOn = l => {
  try {
    return lampBool(lampRaw(l)) === true;
  } catch (e) {
    return false;
  }
};
function lblGroupOf(name) {
  for (const [g, rx] of LBL_GROUPS) if (rx.test(name)) return g;
  return 'Other';
}

/* the card of one machine, in SVG */
/* free size: the card can be resized from any edge or corner (b.props.lblSize[key] = {w, h}).
   Width gives more room between names and values; height spreads the rows out, or shrinks the text when made smaller. */
let LBL_KEY = null; // card being drawn (for its own design)
const lblCD = b => (LBL_KEY && (b.props.lblCardD || {})[LBL_KEY]) || {};
const lcH = body => +((body || '').match(/class="lc-bg" x="0" y="0" width="[\d.]+" height="([\d.]+)"/) || [0, 0])[1];
/* ---------- v9.83 Item 1 — rotate parameters ----------
   A card with more readings than its page size shows, in Simulate / Publish: the pinned readings (always), readings in
   alarm (until back in limits, if set), and the rest a page at a time. The page comes from the clock, so the TV and
   every user see the same page. Settings per card (lblCardD[key].rot / .pin) with a plant-wide default (DOC.rotDef). */
const ROT0 = { on: false, n: 3, sec: 5, alarms: true, pause: true };
const ROT_OFF = {}, // manual ‹ › steps per card
  ROT_HOLD = {}; // page held while the pointer is over the card
function lblRot(b, key) {
  const cd = ((b.props.lblCardD || {})[key]) || {};
  return Object.assign({}, ROT0, DOC.rotDef || {}, cd.rot || {}, { pin: cd.pin || [] });
}
const cd0Show = (b, key) => (((b.props.lblCardD || {})[key]) || {}).show || 'group';
function lblRotPage(b, key, list) {
  if (!key || !list || list.length < 2) return null; // v9.84: rotates in Design too
  const R = lblRot(b, key);
  if (cd0Show(b, key) === 'single') Object.assign(R, { on: true, alarms: false, pin: [] }); // one tag at a time
  if (!R.on) return null;
  const n = cd0Show(b, key) === 'single' ? 1 : Math.max(1, +R.n || 3);
  const pin = list.filter(t => R.pin.includes(t.id)),
    al = R.alarms ? list.filter(t => !R.pin.includes(t.id) && tagSev(t.id) >= 2) : [],
    rest = list.filter(t => !pin.includes(t) && !al.includes(t)),
    slots = Math.max(1, n - pin.length - al.length);
  if (rest.length <= slots) return null;
  const pages = Math.ceil(rest.length / slots),
    k = b.id + '|' + key,
    sec = Math.max(2, +R.sec || 5);
  const page = ROT_HOLD[k] != null ? ROT_HOLD[k] % pages : (((Math.floor(Date.now() / (sec * 1000)) + (ROT_OFF[k] || 0)) % pages) + pages) % pages;
  const sl = rest.slice(page * slots, page * slots + slots),
    keep = new Set([...pin, ...al, ...sl]);
  return { rows: list.filter(t => keep.has(t)), pad: slots - sl.length, page, pages, key: k };
}
function lblCardSVG(b, list, title, lamps, sz, key) {
  LBL_KEY = key || null;
  const rot = lblRotPage(b, key, list);
  if (rot) list = rot.rows;
  /* v9.84 — Design shows every reading (to edit them) with a footer saying the card rotates in Simulate / Publish */
  const rotHint = null;
  if (!sz || (!sz.w && !sz.h)) return lblCardCore(b, list, title, lamps, { rot, rotHint });
  const o = { w: sz.w, rot, rotHint };
  let body = lblCardCore(b, list, title, lamps, o);
  if (sz.h) {
    const h0 = lcH(body);
    if (sz.h < h0 - 1) body = lblCardCore(b, list, title, lamps, { w: sz.w, k: Math.max(0.55, sz.h / h0), fit: sz.h, rot, rotHint });
    else if (sz.h > h0 + 1) body = lblCardCore(b, list, title, lamps, { w: sz.w, fit: sz.h, grow: sz.h - h0, rot, rotHint });
  }
  return body;
}
function lblCardCore(b, list, title, lamps, O) {
  const E = EQ[b.type];
  if (!list.length && !lamps.length) return '';
  /* v9.85 — "Show as" (lblCardD[key].show): tag · group · single · score */
  const SHOW = lblCD(b).show || 'group';
  const sty = SHOW === 'tag' ? 'tagline' : SHOW === 'score' ? 'score' : lblCD(b).sty || lblStyle(b),
    dark = sty === 'hmi',
    live = MODE === 'monitor';
  const D = Object.assign({}, DOC.lblDesign || {}, b.props.lblDesign || {}, lblCD(b));
  const C0 = dark
    ? { bg: '#16222c', bd: '#2c3b47', hd: '#0f1a22', hdt: '#ffffff', k: '#8ea6b5', v: '#7fe0ff', u: '#6b8394', sep: '#24333e', al: 'rgba(255,90,90,.16)', alv: '#ff7a7a', gt: '#57d68a' }
    : { bg: '#ffffff', bd: '#cfd8e0', hd: sty === 'group' ? '#1f3b63' : '#f3f6f9', hdt: sty === 'group' ? '#ffffff' : '#16212b', k: '#5f6e7a', v: '#16212b', u: '#8a98a5', sep: '#eef2f5', al: '#fdeeee', alv: '#d23b3b', gt: '#1f3b63' };
  const C = Object.assign({}, C0);
  if (D.hd) {
    C.hd = D.hd;
    C.hdt = lblInk(D.hd);
    if (!dark) C.gt = D.hd === '#f3f6f9' || lblInk(D.hd) === '#16212b' ? '#1f3b63' : D.hd;
  }
  if (D.bg && !dark) C.bg = D.bg;
  if (D.bd) C.bd = D.bd;
  if (D.v) C.v = D.v;
  const FS = { s: 0.9, m: 1, l: 1.18 }[D.fs || 'm'] * (O.k || 1);
  const nRows0 = Math.max(1, list.length + (lamps.length ? 1 : 0));
  const W = O.w || { s: 196, m: 236, l: 290 }[D.w || 'm'] * (FS > 1 ? 1.08 : 1),
    RH = 15 * FS + (O.grow ? O.grow / nRows0 : 0),
    HH = 24 * FS,
    PX = 9;
  const st = live ? bState(b) : '',
    stTxt = st ? String(st).toUpperCase() : live ? 'LIVE' : 'DESIGN';
  const row = bt => {
    const t = REG[bt.id],
      k = (t.short || bt.id.split('.').pop()).replace(/_/g, ' '),
      sev = live ? tagSev(t.id) : 0;
    const v = tagTxt(t.id); // v9.92 — Design shows the demo value too (was '–')
    return { bt, t, k, v, sev };
  };
  const R = list.map(row);
  if ((lblCD(b).type === 'single' || SHOW === 'single') && R.length === 1) return lblSingleSVG(b, R[0], title, C, FS, O, live, dark);
  let y = 0,
    s = '';
  /* header (v9.74: can be switched off — D.noHead) */
  const NOH = !!D.noHead || sty === 'tagline';
  const RXs = D.rx == null ? 6 : +D.rx;
  if (!NOH) {
  s += `<rect x="0" y="0" width="${W}" height="${HH}" rx="6" fill="${C.hd}"/><rect x="0" y="${HH - 6}" width="${W}" height="6" fill="${C.hd}"/>`;
  s += `<text x="${PX}" y="${16 * FS}" class="lc-h" fill="${C.hdt}">${esc(title)}</text>`;
  if (sty === 'status') {
    const bw2 = stTxt.length * 6.2 * FS + 12;
    s += `<rect x="${W - PX - bw2}" y="${5 * FS}" width="${bw2}" height="${14 * FS}" rx="3" fill="${live && st ? STC[st] || '#2e9e4f' : '#8a98a5'}"/><text x="${W - PX - bw2 / 2}" y="${15.5 * FS}" class="lc-st" text-anchor="middle" fill="#ffffff">${esc(stTxt)}</text>`;
  } else s += `<text x="${W - PX}" y="${16 * FS}" class="lc-st" text-anchor="end" fill="${live && st ? STC[st] || C.gt : C.u}">● ${esc(stTxt)}</text>`;
  }
  y = NOH ? 6 : HH + 4;
  const line = (o, x0, x1) => {
    let r = '';
    if (o.sev > 0) r += `<rect x="${x0 - 4}" y="${y - 1}" width="${x1 - x0 + 8}" height="${RH}" fill="${C.al}"/>`;
    r += `<text x="${x0}" y="${y + 10.5 * FS}" class="lc-k" fill="${C.k}">${esc(o.k)}</text><text x="${x1}" y="${y + 10.5 * FS}" class="lc-v" text-anchor="end" fill="${o.sev > 0 ? C.alv : C.v}">${esc(o.v)}</text>`;
    const pk = LBL_CROW.has(o.bt.id) && LBL_CSEL && LBL_CSEL.b === b.id && LBL_CSEL.key === LBL_KEY;
    return `<g class="lc-row${pk ? ' lc-pk' : ''}" data-row="${esc(o.bt.id)}"><rect class="lc-hit" x="${x0 - 4}" y="${y - 1}" width="${x1 - x0 + 8}" height="${RH}" rx="2" fill="${pk ? 'rgba(46,158,79,.16)' : 'transparent'}" stroke="${pk ? '#2e9e4f' : 'none'}"/>${r}</g>`;
  };
  const num = o => (live ? val(o.t.id) : null);
  const vParts = o => {
    const m = String(o.v).match(/^(-?[\d.,]+)\s*(.*)$/);
    return m ? [m[1], m[2]] : [String(o.v), ''];
  };
  if (sty === 'tagline') {
    /* Tag: compact one-line labels — state bar, name, value */
    R.forEach(o => {
      const bc = !live ? '#94a3b8' : o.sev >= 3 ? '#d23b3b' : o.sev === 2 ? '#ec7a15' : o.sev === 1 ? '#c99a00' : '#2e9e4f';
      s += `<rect x="${PX - 5}" y="${y}" width="3" height="${RH - 2}" rx="1.5" fill="${bc}"/>` + line(o, PX + 2, W - PX);
      y += RH;
    });
    y += 2;
  } else if (sty === 'score') {
    /* Score card: one tile per tag — icon, name, big value + unit, status pill (only when the tag has limits) */
    const IC = typeof kpiIcons === 'function' ? kpiIcons() : {},
      th = 38 * FS + (O.grow ? O.grow / Math.max(1, R.length) : 0),
      trx = Math.min(RXs, 10);
    R.forEach(o => {
      const k2 = typeof scIconFor === 'function' ? scIconFor(o.t.id) : 'bars',
        I = IC[k2] || IC.bars,
        al = live && o.sev >= 2,
        lim = ['hh', 'hi', 'lo', 'll'].some(q => o.t[q] != null),
        pill = !live || !lim ? null : o.sev >= 3 ? ['Alarm', '#d93636'] : o.sev === 2 ? ['Warning', '#c27803'] : ['On target', '#1f9d55'];
      const [n, u] = vParts(o);
      const pk = LBL_CROW.has(o.bt.id) && LBL_CSEL && LBL_CSEL.b === b.id && LBL_CSEL.key === LBL_KEY;
      s += `<g class="lc-row${pk ? ' lc-pk' : ''}" data-row="${esc(o.bt.id)}"><rect class="lc-hit" x="${PX - 4}" y="${y}" width="${W - 2 * PX + 8}" height="${th}" rx="${trx}" fill="${al ? C.al : dark ? '#1d2b36' : '#f7f9fb'}" stroke="${al ? '#f2c4c4' : pk ? '#2e9e4f' : dark ? '#2c3b47' : '#e3e8ec'}"/>`;
      if (I) s += `<g transform="translate(${PX + 2} ${y + th / 2 - 11 * FS}) scale(${(22 * FS) / 24})" style="color:${I[0]}">${I[1]}</g>`;
      s += `<text x="${PX + 30 * FS}" y="${y + 13 * FS}" class="lc-tk" fill="${C.k}">${esc(o.k)}</text>`;
      s += `<text x="${PX + 30 * FS}" y="${y + 31 * FS}" style="font:800 ${(16 * FS).toFixed(1)}px var(--sans)" fill="${al ? C.alv : C.v}">${esc(n)}<tspan class="lc-tu" fill="${C.u}" dx="3">${esc(u)}</tspan></text>`;
      if (pill) {
        const pw = pill[0].length * 5 * FS + 12;
        s += `<rect x="${W - PX - pw}" y="${y + 19 * FS}" width="${pw}" height="${14 * FS}" rx="${7 * FS}" fill="${pill[1]}"/><text x="${W - PX - pw / 2}" y="${y + 29 * FS}" text-anchor="middle" style="font:700 ${(8.4 * FS).toFixed(1)}px var(--sans)" fill="#fff">${pill[0]}</text>`;
      }
      s += `</g>`;
      y += th + 5;
    });
    y += 1;
  } else if (sty === 'tile') {
    const cols = W >= 300 ? 3 : 2,
      gap = 5,
      tw = (W - 2 * PX - gap * (cols - 1)) / cols,
      th = 34 * FS + (O.grow ? O.grow / Math.ceil(R.length / cols) : 0);
    R.forEach((o, i) => {
      const cx = PX + (i % cols) * (tw + gap);
      if (i % cols === 0 && i) y += th + gap;
      const [n, u] = vParts(o),
        al = o.sev > 0;
      const pk = LBL_CROW.has(o.bt.id) && LBL_CSEL && LBL_CSEL.b === b.id && LBL_CSEL.key === LBL_KEY;
      s += `<g class="lc-row${pk ? ' lc-pk' : ''}" data-row="${esc(o.bt.id)}"><rect class="lc-hit" x="${cx}" y="${y}" width="${tw}" height="${th}" rx="4" fill="${al ? C.al : pk ? 'rgba(46,158,79,.16)' : dark ? '#1d2b36' : '#f7f9fb'}" stroke="${al ? '#f2c4c4' : pk ? '#2e9e4f' : dark ? '#2c3b47' : '#e3e8ec'}"/>`;
      s += `<text x="${cx + 6}" y="${y + 11 * FS}" class="lc-tk" fill="${C.k}">${esc(o.k.toUpperCase())}</text>`;
      s += `<text x="${cx + 6}" y="${y + 28 * FS}" class="lc-tv" fill="${al ? C.alv : C.v}">${esc(n)}<tspan class="lc-tu" fill="${C.u}"> ${esc(u)}</tspan></text></g>`;
    });
    if (R.length) y += th + 6;
  } else if (sty === 'bars') {
    const bx = PX + Math.round(W * 0.36),
      vx = W - PX,
      bw = W - PX - bx - Math.round(W * 0.25);
    const lim = R.filter(o => o.t.lo != null && o.t.hi != null),
      other = R.filter(o => !(o.t.lo != null && o.t.hi != null));
    lim.forEach(o => {
      const lo = o.t.lo,
        hi = o.t.hi,
        mn = lo - (hi - lo) * 0.4,
        mx = hi + (hi - lo) * 0.4,
        pc = v => Math.max(0, Math.min(1, (v - mn) / (mx - mn))),
        v = num(o);
      const mc = Math.max(4, Math.floor((bx - PX - 8) / (6.4 * FS)));
      s += line(o.k.length > mc ? Object.assign({}, o, { k: o.k.slice(0, mc - 1) + '…' }) : o, PX, vx);
      const by = y + 5 * FS;
      s += `<rect x="${bx}" y="${by}" width="${bw}" height="${5 * FS}" rx="${2.5 * FS}" fill="${dark ? '#24333e' : '#edf1f4'}"/><rect x="${bx + pc(lo) * bw}" y="${by}" width="${(pc(hi) - pc(lo)) * bw}" height="${5 * FS}" fill="${dark ? 'rgba(61,220,132,.28)' : '#cdebd6'}"/>`;
      if (v != null) s += `<rect x="${bx + pc(v) * bw - 1.5}" y="${by - 2.5 * FS}" width="3" height="${10 * FS}" rx="1.5" fill="${o.sev > 0 ? C.alv : dark ? '#7fe0ff' : '#1f3b63'}"/>`;
      y += RH + 2;
    });
    if (lim.length && other.length) {
      y += 2;
      s += `<line x1="${PX}" x2="${W - PX}" y1="${y}" y2="${y}" stroke="${C.sep}" stroke-dasharray="3 3"/><text x="${PX}" y="${y + 10}" class="lc-g" fill="${C.k}">OTHER READINGS</text>`;
      y += 14 * FS;
    }
    other.forEach(o => {
      s += line(o, PX, W - PX);
      y += RH;
    });
    y += 4;
  } else if (sty === 'kpi') {
    const top = R.slice(0, 2),
      rest = R.slice(2),
      kw = (W - 2 * PX) / Math.max(1, top.length),
      kh = 38 * FS;
    top.forEach((o, i) => {
      const x0 = PX + i * kw,
        [n, u] = vParts(o);
      if (i) s += `<line x1="${x0}" x2="${x0}" y1="${y}" y2="${y + kh}" stroke="${C.sep}"/>`;
      s += `<g class="lc-row" data-row="${esc(o.bt.id)}"><rect class="lc-hit" x="${x0}" y="${y}" width="${kw}" height="${kh}" fill="transparent"/><text x="${x0 + (i ? 8 : 0)}" y="${y + 11 * FS}" class="lc-tk" fill="${C.k}">${esc(o.k.toUpperCase())}</text><text x="${x0 + (i ? 8 : 0)}" y="${y + 32 * FS}" class="lc-kv" fill="${o.sev > 0 ? C.alv : C.v}">${esc(n)}<tspan class="lc-tu" fill="${C.u}"> ${esc(u)}</tspan></text></g>`;
    });
    if (top.length) {
      y += kh + 3;
      s += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${C.sep}"/>`;
      y += 4;
    }
    const sx = PX + Math.round(W * 0.47),
      sw2 = Math.round(W * 0.22);
    rest.forEach(o => {
      s += line(o, PX, W - PX);
      const H = (live && VAL[o.t.id] && VAL[o.t.id].h) || [];
      if (H.length > 2) {
        const pts = H.slice(-120),
          vs = pts.map(p => p.v);
        let lo = Math.min(...vs),
          hi = Math.max(...vs);
        const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.01 || 1;
        lo -= pad;
        hi += pad;
        const py = v => y + 1 + (RH - 3) * (1 - (v - lo) / (hi - lo));
        s += `<polyline points="${pts.map((p, i) => `${(sx + (i / (pts.length - 1)) * sw2).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${o.sev > 0 ? C.alv : dark ? '#7fe0ff' : '#1f3b63'}" stroke-width="1.1" stroke-linejoin="round"/>`;
      }
      y += RH;
    });
    y += 4;
  } else if (sty === 'status') {
    const n = R.length,
      bad = R.filter(o => o.sev > 0).length;
    // in-limit strip just under the header
    const sy = NOH ? 0 : HH - 1;
    if (NOH) y += 3;
    if (n) {
      const gw = (W * (n - bad)) / n;
      s += `<rect x="0" y="${sy}" width="${gw}" height="4" fill="#2e9e4f"/><rect x="${gw}" y="${sy}" width="${W - gw}" height="4" fill="${bad ? '#d23b3b' : '#2e9e4f'}"/>`;
    }
    y += 3;
    s += `<text x="${PX}" y="${y + 9 * FS}" class="lc-g" fill="${C.k}">${n - bad}/${n} IN LIMIT${bad ? ` · ${bad} OUT` : ''}</text>`;
    y += 14 * FS;
    R.forEach(o => {
      if (o.sev > 0) s += `<rect x="0" y="${y - 1}" width="3" height="${RH}" fill="#d23b3b"/>`;
      s += line(o, PX, W - PX);
      y += RH;
    });
    y += 4;
  } else if (sty === 'group' && (b.props.lblSplit || 'none') === 'none') {
    const G = new Map();
    R.forEach(o => {
      const g = lblGroupOf(o.k + ' ' + o.bt.id);
      (G.get(g) || G.set(g, []).get(g)).push(o);
    });
    [...LBL_GROUPS.map(g => g[0]), 'Other'].forEach(g => {
      const rows = G.get(g);
      if (!rows) return;
      s += `<text x="${PX}" y="${y + 9}" class="lc-g" fill="${C.gt}">${esc(g.toUpperCase())}</text>`;
      y += 13 * FS;
      const two = g === 'Drives' && rows.length >= 4;
      if (two) {
        for (let i = 0; i < rows.length; i += 2) {
          s += line(rows[i], PX, W / 2 - 6);
          if (rows[i + 1]) s += line(rows[i + 1], W / 2 + 6, W - PX);
          y += RH;
        }
      } else
        rows.forEach(o => {
          s += line(o, PX, W - PX);
          y += RH;
        });
      y += 3;
      s += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${C.sep}"/>`;
      y += 4;
    });
  } else {
    R.forEach((o, i) => {
      if (!dark && i % 2) s += `<rect x="1" y="${y - 1}" width="${W - 2}" height="${RH}" fill="#fafbfc"/>`;
      s += line(o, PX, W - PX);
      y += RH;
    });
    y += 4;
  }
  /* v9.83 — a short last page keeps the card's height */
  if (O.rot && O.rot.pad > 0) y += O.rot.pad * RH;
  /* signals as chips */
  if (lamps.length) {
    let x = PX;
    y += 2;
    lamps.forEach(l => {
      const on = live && lblLampOn(l),
        n = lblLampName(l),
        cw = Math.round(n.length * 5.6 + 22);
      if (x + cw > W - PX && x > PX) {
        x = PX;
        y += 19;
      }
      const fill = dark ? (on ? 'rgba(61,220,132,.16)' : '#1d2b36') : on ? '#effaf2' : '#ffffff',
        str = dark ? (on ? '#3ddc84' : '#2c3b47') : on ? '#bfe3c9' : '#d4dce3',
        tc = dark ? (on ? '#d9f7e6' : '#8ea6b5') : on ? '#1d6d36' : '#5f6e7a',
        dc = on ? (dark ? '#3ddc84' : '#2e9e4f') : dark ? '#3a4955' : '#c3ccd4';
      s += `<g class="lc-chip"><rect x="${x}" y="${y}" width="${cw}" height="16" rx="8" fill="${fill}" stroke="${str}"/><circle cx="${x + 9}" cy="${y + 8}" r="3.5" fill="${dc}"/><text x="${x + 17}" y="${y + 11.5}" class="lc-c" fill="${tc}">${esc(n)}</text><title>${esc(l.tags[0].id)}</title></g>`;
      x += cw + 5;
    });
    y += 22;
  }
  /* v9.86 — no footer on the card (asked for): an invisible marker keeps the page number for "pause on pointer" */
  if (O.rot) s += `<g class="lc-rot" data-rk="${esc(O.rot.key)}" data-pg="${O.rot.page}" data-pn="${O.rot.pages}"></g>`;
  if (O.rotHint) {
    s += `<g class="lc-roth"><line x1="${PX}" x2="${W - PX}" y1="${y}" y2="${y}" stroke="${C.sep}"/><text x="${W / 2}" y="${y + 10.5}" text-anchor="middle" fill="#1f6feb" style="font:600 ${(7.6 * FS).toFixed(1)}px var(--sans)">${esc(O.rotHint)}</text></g>`;
    y += 14;
  }
  const H = O.fit ? Math.max(O.fit, y + 2) : y + 2,
    RX = D.rx == null ? 6 : D.rx;
  s = s.replace(/rx="6" fill="([^"]+)"\/><rect x="0" y="\d+(\.\d+)?" width="[\d.]+" height="6"/, (m0, f) => m0.replace('rx="6"', `rx="${RX}"`));
  return `<g style="font-size:${FS}em"><rect class="lc-bg" x="0" y="0" width="${W}" height="${H}" rx="${RX}" fill="${C.bg}" stroke="${C.bd}" stroke-width="${D.bw || 1}"/>${s}</g><title>${esc(b.name)} — drag to move the card · right-click for label options</title>`;
}


/* v9.74 — Single card: one tag, name on top, big value, coloured state bar on the left */
function lblSingleSVG(b, o, title, C, FS, O, live, dark) {
  const W = O.w || Math.max(118, Math.min(200, (title || o.k).length * 6.4 + 30)) * FS,
    H0 = (D0 => (D0.noHead ? 34 : 50))(Object.assign({}, DOC.lblDesign || {}, b.props.lblDesign || {}, lblCD(b))) * FS,
    H = O.fit ? Math.max(O.fit, H0) : H0;
  const m = String(o.v).match(/^(-?[\d.,]+)\s*(.*)$/),
    n = m ? m[1] : String(o.v),
    u = m ? m[2] : '';
  const bar = !live ? '#94a3b8' : o.sev >= 3 ? '#d23b3b' : o.sev === 2 ? '#ec7a15' : o.sev === 1 ? '#c99a00' : '#2e9e4f';
  const D = Object.assign({}, DOC.lblDesign || {}, b.props.lblDesign || {}, lblCD(b)),
    RX = D.rx == null ? 6 : D.rx;
  const pk = LBL_CROW.has(o.bt.id) && LBL_CSEL && LBL_CSEL.b === b.id && LBL_CSEL.key === LBL_KEY;
  return `<g style="font-size:${FS}em"><rect class="lc-bg" x="0" y="0" width="${W}" height="${H}" rx="${RX}" fill="${o.sev > 0 && live ? C.al : C.bg}" stroke="${o.sev > 0 && live ? '#f2c4c4' : C.bd}" stroke-width="${D.bw || 1}"/><rect x="0" y="0" width="4" height="${H}" rx="2" fill="${bar}"/>
<g class="lc-row${pk ? ' lc-pk' : ''}" data-row="${esc(o.bt.id)}"><rect class="lc-hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
${D.noHead ? '' : `<text x="11" y="${14 * FS}" class="lc-tk" fill="${C.k}">${esc(String(title || o.k).toUpperCase())}</text>`}
<text x="11" y="${(D.noHead ? 24 : 38) * FS}" class="lc-kv" fill="${o.sev > 0 && live ? C.alv : C.v}">${esc(n)}<tspan class="lc-tu" fill="${C.u}"> ${esc(u)}</tspan></text></g></g><title>${esc(b.name)} · ${esc(o.t.id)} — drag to move the card</title>`;
}
/* how the readings of a machine are split into cards:
   lblSplit 'none' — one card · 'group' — one card per group (Batch, Sand & water, Drives, Other) · 'manual' — the card
   number chosen per reading (bt.card = 1…4). Signals go in the first card. Card titles can be renamed (props.lblTitles). */
function lblCards(b) {
  const list = (b.tags || []).filter(t => t.show && REG[t.id]),
    split = b.props.lblSplit || 'none',
    T = b.props.lblTitles || {};
  const lamps = b.props.lblChips === false ? [] : lblLampsOf(b);
  const nm = (REG[list[0]?.id] && (REG[list[0].id].short || '')) || '';
  const base = b.name + (EQ[b.type].name ? ' · ' + EQ[b.type].name : '');
  let cards;
  if (split === 'group') {
    const G = new Map();
    list.forEach(bt => {
      const t = REG[bt.id],
        g = lblGroupOf((t.short || bt.id) + ' ' + bt.id);
      (G.get(g) || G.set(g, []).get(g)).push(bt);
    });
    cards = [...LBL_GROUPS.map(g => g[0]), 'Other'].filter(g => G.has(g)).map(g => ({ key: g, rows: G.get(g), title: T[g] || `${b.name} · ${g}` }));
  } else if (split === 'manual') {
    const G = new Map();
    list.filter(bt => bt.card !== 0).forEach(bt => {
      const k = String(bt.card || 1);
      (G.get(k) || G.set(k, []).get(k)).push(bt);
    });
    const X = b.props.lblExtra || {};
    Object.keys(X).forEach(k => {
      if (!/^c[\d.]+$/.test(k)) return;
      const g = G.get(k.slice(1)) || G.set(k.slice(1), []).get(k.slice(1));
      X[k].filter(id => REG[id] && !g.some(r => r.id === id)).forEach(id => g.push(b.tags.find(t => t.id === id && t.show) || { id, show: true, ext: true }));
    });
    /* the tags of this machine keep the order of its tag list (drag ⋮⋮ in the card editor); borrowed ones go last */
    const at = id => {
      const i = b.tags.findIndex(t => t.id === id);
      return i < 0 ? 1e6 : i;
    };
    G.forEach(rows => rows.sort((p, q) => at(p.id) - at(q.id)));
    const CD0 = b.props.lblCardD || {};
    cards = [...G.keys()].sort((a, c) => a - c).map((k, i) => {
      const rows = G.get(k),
        one = (CD0['c' + k] || {}).type === 'single' && rows.length === 1;
      return { key: 'c' + k, rows, title: T['c' + k] || (one ? ((REG[rows[0].id] && REG[rows[0].id].short) || rows[0].id.split('.').pop()).replace(/_/g, ' ') : `${b.name} · card ${i + 1}`) };
    });
  } else cards = [{ key: 'all', rows: list, title: T.all || base }];
  if (!cards.length) return [];
  if (cards[0]) cards[0].lamps = lamps;
  cards.slice(1).forEach(c => (c.lamps = []));
  return cards;
}
/* in Grouped style with one card, rows are still grouped inside the card; in split cards each card is one group */
/* readable text colour on a header colour */
function lblInk(hex) {
  const h = String(hex).replace('#', '');
  if (h.length < 6) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#16212b' : '#ffffff';
}
const LBL_CROW = new Set(); // readings picked inside the selected card
let LBL_CSEL = null; // selected card {b, key}
const LBL_SELT = new Set(); // selected normal labels "blockId|tagId"
/* draw: cards for machines with a card style; classic boxes for the rest */
{
  const _tagsSVG = tagsSVG;
  const plain = b => {
    const away = (b.tags || []).filter(t => t.cardOf && t.show);
    away.forEach(t => (t.show = false));
    try {
      return _tagsSVG(b);
    } finally {
      away.forEach(t => (t.show = true));
    }
  };
  tagsSVG = function (b) {
    if (!SHOWTAGS || !EQ[b.type] || !lblIsCard(b)) return plain(b);
    const A = tagAnchor(b),
      sel = SEL && SEL.t === 'b' && SEL.id === b.id && MODE === 'design';
    const cards = lblCards(b),
      pos = b.props.lblPos || {};
    let s = '',
      autoY = 0;
    const placed = [];
    const loose = (b.props.lblSplit === 'manual' ? b.tags : []).filter(t => t.card === 0 && t.show);
    if (loose.length) {
      /* readings that are not in a card keep their normal labels */
      const hide = b.tags.filter(t => (t.card !== 0 || t.cardOf) && t.show);
      hide.forEach(t => (t.show = false));
      try {
        s += _tagsSVG(b);
      } finally {
        hide.forEach(t => (t.show = true));
      }
    }
    cards.forEach((c, i) => {
      const body = lblCardSVG(b, c.rows, c.title, c.lamps, (b.props.lblSize || {})[c.key], c.key);
      if (!body) return;
      const h = lcH(body) || 120,
        cw = +(body.match(/class="lc-bg" x="0" y="0" width="([\d.]+)"/) || [0, 236])[1];
      /* v9.77 — a card that was never moved starts where its readings' labels were (not at the top of the
         label area, which on some equipment is far above it); cards that would overlap stack downwards */
      let p = pos[c.key];
      if (!p) {
        const lp = c.rows.map(r => r.pos).filter(Boolean);
        p = lp.length ? { x: Math.min(...lp.map(q => q.x)), y: Math.min(...lp.map(q => q.y)) } : { x: 0, y: autoY };
        for (let k = 0; k < 40; k++) {
          const hit = placed.find(q => p.x < q.x + q.w + 6 && p.x + cw + 6 > q.x && p.y < q.y + q.h + 6 && p.y + h + 6 > q.y);
          if (!hit) break;
          p = { x: p.x, y: hit.y + hit.h + 8 };
        }
        autoY = Math.max(autoY, p.y + h + 8);
        /* remember it, so a card never jumps when other cards are made, restyled or removed */
        if (b.props.lblSplit === 'manual') (b.props.lblPos = b.props.lblPos || {})[c.key] = { x: Math.round(p.x), y: Math.round(p.y) };
      }
      placed.push({ x: p.x, y: p.y, w: cw, h });
      const cs = LBL_CSEL && LBL_CSEL.b === b.id && LBL_CSEL.key === c.key;
      let hs = '';
      if (cs && MODE === 'design') {
        const W = +(body.match(/class="lc-bg" x="0" y="0" width="([\d.]+)"/) || [0, 236])[1],
          H = lcH(body),
          q = 7;
        const pts = { nw: [0, 0], n: [W / 2, 0], ne: [W, 0], e: [W, H / 2], se: [W, H], s: [W / 2, H], sw: [0, H], w: [0, H / 2] };
        hs = Object.entries(pts).map(([k, [hx, hy]]) => `<rect class="lc-rs lc-rs-${k}" data-rs="${k}" x="${hx - q / 2}" y="${hy - q / 2}" width="${q}" height="${q}" rx="1.5"/>`).join('');
      }
      s += `<g class="tagg lcard${sel ? ' lsel' : ''}${cs ? ' lcsel' : ''}" data-tg="${b.id}" data-lc="${esc(c.key)}" transform="translate(${A.x + p.x},${A.y + p.y})" filter="url(#lcShadow)">${body}${hs}</g>`;
    });
    return s;
  };
  const _blockSVG = blockSVG;
  blockSVG = function (b) {
    if (b.type === 'statusLamp' && LBL_LAMPS.has(b.id)) return '';
    return _blockSVG(b);
  };
  const _renderCanvas = renderCanvas;
  renderCanvas = function () {
    lblIndexLamps();
    _renderCanvas();
    const defs = document.querySelector('#cv defs');
    if (defs && !document.getElementById('lcShadow')) defs.insertAdjacentHTML('beforeend', '<filter id="lcShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#10212b" flood-opacity=".14"/></filter>');
  };
}

/* put a card beside (right / left), above or below its machine; cards on the same side stack up */
function lblCardH(b, c) {
  const body = lblCardSVG(b, c.rows, c.title, c.lamps, (b.props.lblSize || {})[c.key], c.key);
  return lcH(body) || 120;
}
function lblPlace(b, key, side) {
  const A = tagAnchor(b),
    { W, H } = dims(b),
    x0 = b.x - A.x,
    y0 = b.y - A.y,
    CW = 236,
    G = 10;
  const cards = lblCards(b),
    c = cards.find(k => k.key === key);
  if (!c) return;
  const P = (b.props.lblPos = b.props.lblPos || {}),
    S = (b.props.lblSide = b.props.lblSide || {});
  S[key] = side;
  /* lay out every card on this side again, in card order */
  let off = 0;
  cards
    .filter(k => S[k.key] === side)
    .forEach(k => {
      const h = lblCardH(b, k);
      if (side === 'below') P[k.key] = { x: x0 + off, y: y0 + H + 6 };
      if (side === 'above') P[k.key] = { x: x0 + off, y: y0 - h - G };
      if (side === 'right') P[k.key] = { x: x0 + W + G, y: y0 + off };
      if (side === 'left') P[k.key] = { x: x0 - CW - G, y: y0 + off };
      off += side === 'below' || side === 'above' ? CW + G : h + G;
    });
}
/* drag one card on its own (design mode); the whole machine's cards move with Shift */
document.addEventListener(
  'pointerdown',
  e => {
    const g = e.target.closest && e.target.closest('#cv .lcard');
    if (!g || MODE !== 'design' || e.button !== 0 || e.shiftKey || e.target.closest('[data-rs]')) return;
    const nav = e.target.closest('[data-rotnav]');
    if (nav) {
      e.stopPropagation();
      e.preventDefault();
      if (typeof rotStep === 'function') rotStep(g, +nav.dataset.rotnav);
      return;
    }
    const row = e.target.closest('[data-row]');
    if (row && (e.ctrlKey || e.metaKey)) {
      /* click a reading inside the selected card (Ctrl/⌘ for more) */
      e.stopPropagation();
      e.preventDefault();
      const id = row.dataset.row;
      if (!(LBL_CSEL && LBL_CSEL.b === g.dataset.tg && LBL_CSEL.key === g.dataset.lc)) LBL_CROW.clear();
      LBL_CSEL = { b: g.dataset.tg, key: g.dataset.lc };
      if (e.ctrlKey || e.metaKey) LBL_CROW.has(id) ? LBL_CROW.delete(id) : LBL_CROW.add(id);
      else if (LBL_CROW.size === 1 && LBL_CROW.has(id)) LBL_CROW.clear();
      else (LBL_CROW.clear(), LBL_CROW.add(id));
      lblSyncPick(g.dataset.tg);
      SEL = { t: 'b', id: g.dataset.tg };
      PTAB = 'cards';
      renderCanvas();
      renderProps();
      return;
    }
    const rowId = row ? row.dataset.row : null;
    if (!(LBL_CSEL && LBL_CSEL.b === g.dataset.tg && LBL_CSEL.key === g.dataset.lc)) LBL_CROW.clear();
    const b = B(g.dataset.tg);
    if (!b) return;
    e.stopPropagation();
    e.preventDefault();
    const key = g.dataset.lc;
    const sc = () => {
      const m = g.getScreenCTM();
      return m ? m.a : 1;
    };
    const s0 = sc(),
      x0 = e.clientX,
      y0 = e.clientY;
    /* freeze every card at its current place first, so moving one never shifts the others */
    const A = tagAnchor(b);
    b.props.lblPos = b.props.lblPos || {};
    document.querySelectorAll(`#cv .lcard[data-tg="${b.id}"]`).forEach(c => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(c.getAttribute('transform'));
      if (m && !b.props.lblPos[c.dataset.lc]) b.props.lblPos[c.dataset.lc] = { x: Math.round(+m[1] - A.x), y: Math.round(+m[2] - A.y) };
    });
    const p0 = { ...b.props.lblPos[key] };
    let moved = false;
    const mv = ev => {
      const dx = (ev.clientX - x0) / s0,
        dy = (ev.clientY - y0) / s0;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      if (!moved) {
        pushUndo();
        moved = true;
      }
      b.props.lblPos[key] = { x: Math.round(p0.x + dx), y: Math.round(p0.y + dy) };
      if (b.props.lblSide) delete b.props.lblSide[key];
      g.setAttribute('transform', `translate(${A.x + b.props.lblPos[key].x},${A.y + b.props.lblPos[key].y})`);
    };
    const up = () => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
      if (moved) changed();
      else {
        /* v9.80 — a click on a reading picks it (ticked in Properties too); a double-click opens its trend */
        if (rowId) {
          const now = performance.now(), L = lblRowClick;
          lblRowClick = { id: rowId, t: now };
          if (L && L.id === rowId && now - L.t < 450) {
            lblRowClick = null;
            openTrend(rowId);
            return;
          }
        }
        SEL = { t: 'b', id: b.id };
        PTAB = 'cards';
        LBL_SELT.clear();
        if (!(LBL_CSEL && LBL_CSEL.b === b.id && LBL_CSEL.key === key)) LBL_CROW.clear();
        LBL_CSEL = { b: b.id, key };
        if (rowId) {
          if (LBL_CROW.size === 1 && LBL_CROW.has(rowId)) LBL_CROW.clear();
          else (LBL_CROW.clear(), LBL_CROW.add(rowId));
          lblSyncPick(b.id);
        }
        renderCanvas();
        renderProps();
        lblBar();
      }
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  },
  true
);
/* the card numbers in use (plus none when all readings are on card 1) and their titles */
function lblCardNums(b) {
  return [...new Set((b.tags || []).filter(t => t.show && REG[t.id]).map(t => t.card || 1))].sort((a, c) => a - c);
}
function lblCardTitle(b, n) {
  const T = b.props.lblTitles || {};
  return T['c' + n] || (n === 1 ? 'Card 1' : 'Card ' + n);
}
const LBL_HD = ['#1f3b63', '#37474f', '#2e7d32', '#5e9e2a', '#00796b', '#1565c0', '#6a1b9a', '#c62828', '#d48a00', '#f3f6f9'];
const LBL_BG = [['#ffffff', 'White'], ['#f8fafc', 'Light grey'], ['#fffdf5', 'Warm'], ['#f1f8ff', 'Light blue']];
function lblDesignUI(b) {
  const D = Object.assign({}, DOC.lblDesign || {}, b.props.lblDesign || {});
  const sw = (k, list, cur) => list.map(c => `<button type="button" class="lc-sw" data-lcd="${k}|${c}" style="background:${c}" aria-pressed="${cur === c}" title="${c}"></button>`).join('');
  const seg = (k, opts, cur) => `<span class="lc-seg">${opts.map(([v, t]) => `<button type="button" data-lcd="${k}|${v}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join('')}</span>`;
  return `<div class="lc-des"><div class="lc-dh">Card design</div>
   <div class="lc-row"><span class="lc-l">Header</span>${seg('noHead', [['', 'Show'], ['1', 'Hide']], D.noHead ? '1' : '')}</div>
   <div class="lc-row"><span class="lc-l">Header colour</span><span class="lc-sws">${sw('hd', LBL_HD, D.hd)}<input type="color" data-lcc2="hd" value="${D.hd || '#1f3b63'}" title="Any colour"></span></div>
   <div class="lc-row"><span class="lc-l">Card colour</span><span class="lc-sws">${LBL_BG.map(([c, t]) => `<button type="button" class="lc-sw" data-lcd="bg|${c}" style="background:${c}" aria-pressed="${(D.bg || '#ffffff') === c}" title="${t}"></button>`).join('')}</span></div>
   <div class="lc-row"><span class="lc-l">Value colour</span><span class="lc-sws">${sw('v', ['#16212b', '#1f3b63', '#1565c0', '#2e7d32'], D.v || '#16212b')}</span></div>
   <div class="lc-row"><span class="lc-l">Text size</span>${seg('fs', [['s', 'S'], ['m', 'M'], ['l', 'L']], D.fs || 'm')}</div>
   <div class="lc-row"><span class="lc-l">Width</span>${seg('w', [['s', 'Narrow'], ['m', 'Normal'], ['l', 'Wide']], D.w || 'm')}</div>
   <div class="lc-row"><span class="lc-l">Corners</span>${seg('rx', [[0, 'Square'], [6, 'Round'], [12, 'Rounder']], D.rx == null ? 6 : D.rx)}</div>
   <div class="lc-row"><span class="lc-l">Border</span>${seg('bw', [[0.5, 'Thin'], [1, 'Normal'], [2, 'Bold']], D.bw || 1)}</div>
   <div class="lc-row" style="gap:6px;flex-wrap:wrap"><button type="button" class="ib" id="lcDAll">Use this design for all cards</button><button type="button" class="ib" id="lcDReset">Default design</button></div></div>`;
}
/* style picker: View → layout style; equipment properties → style for this machine */
function lblSetLayout(sty) {
  pushUndo();
  DOC.lblStyle = sty;
  changed();
  renderCanvas();
  toast(`Data labels: ${LBL_STY.find(x => x[0] === sty)[1]} for the whole layout${DOC.blocks.some(b => b.props && b.props.lblStyle) ? ' — machines with their own style keep it' : ''}`);
}
/* ===================== v9.74 — Data label cards: side panel =====================
   Two card types, freely mixed on one equipment:
     Group card  — several chosen tags together in one card (any card style)
     Single card — one tag in its own compact card (big value, state bar)
   Stored as manual split: bt.card = card number (0 = not in a card → normal label), card type and style in
   b.props.lblCardD['c' + n] = {type: 'single' | undefined (group), sty}. Titles in b.props.lblTitles. */
const LBL_PSEL = new Set(); // tags ticked in the side panel
let LBL_PSEL_B = null;
const lblShown = b => (b.tags || []).filter(t => t.show && REG[t.id]);
const lblAll = b => (b.tags || []).filter(t => REG[t.id]);
const lblType = (b, n) => (((b.props.lblCardD || {})['c' + n] || {}).type === 'single' ? 'single' : 'group');
/* v9.90 — one tag can be in several cards: its home card is t.card, every further card lists it in
   b.props.lblExtra['c' + n] (the same list that holds tags borrowed from other equipment) */
const lblXk = b => Object.keys(b.props.lblExtra || {}).filter(k => /^c[\d.]+$/.test(k));
const lblNums = b => {
  const X = b.props.lblExtra || {};
  return [...new Set([...lblShown(b).map(t => t.card || 0), ...lblXk(b).filter(k => X[k].some(id => REG[id])).map(k => +k.slice(1))])].filter(n => n > 0).sort((a, c) => a - c);
};
function lblUnX(b, id, n) {
  const X = b.props.lblExtra;
  if (!X || !X['c' + n]) return;
  X['c' + n] = X['c' + n].filter(z => z !== id);
  if (!X['c' + n].length) delete X['c' + n];
}
/* put tag t into card n (keeps it in the cards it is already in) */
function lblJoin(b, t, n) {
  if (!t.show || !t.card || t.card === n) {
    t.show = true;
    t.card = n;
    lblUnX(b, t.id, n);
    return;
  }
  const X = (b.props.lblExtra = b.props.lblExtra || {});
  if (!(X['c' + n] || []).includes(t.id)) (X['c' + n] = X['c' + n] || []).push(t.id);
}
/* take tag t out of card n only; if it is still in other cards, the first of them becomes its home */
function lblLeave(b, t, n) {
  if (t.card !== n) return lblUnX(b, t.id, n);
  const X = b.props.lblExtra || {};
  const m = lblXk(b).filter(k => X[k].includes(t.id)).map(k => +k.slice(1)).sort((a, c) => a - c)[0];
  t.card = m || 0;
  if (m) lblUnX(b, t.id, m);
}
function lblLeaveAll(b, t) {
  t.card = 0;
  lblXk(b).forEach(k => lblUnX(b, t.id, +k.slice(1)));
}
const lblCardsOf = (b, t) => {
  const X = b.props.lblExtra || {};
  return [...new Set([...(t.show && t.card ? [t.card] : []), ...lblXk(b).filter(k => X[k].includes(t.id)).map(k => +k.slice(1))])];
};
/* renumber cards 1…n in their current order (also turns 2.5-style inserts into whole numbers) */
function lblRenumber(b) {
  const order = lblNums(b);
  const map = new Map(order.map((n, i) => [n, i + 1])),
    move = o => {
      const r = {};
      Object.entries(o || {}).forEach(([k, v]) => {
        const m = /^c([\d.]+)$/.exec(k);
        if (!m) r[k] = v;
        else if (map.has(+m[1])) r['c' + map.get(+m[1])] = v;
      });
      return r;
    };
  ['lblTitles', 'lblCardD', 'lblSide', 'lblPos', 'lblSize', 'lblExtra'].forEach(p => b.props[p] && (b.props[p] = move(b.props[p])));
  lblAll(b).forEach(t => t.card && (t.card = map.get(t.card) || 0));
}
const lblNm = t => (REG[t.id] && REG[t.id].short ? REG[t.id].short : t.id.split('.').pop()).replace(/_/g, ' ');
function lblPreview(b, c) {
  const body = lblCardSVG(b, c.rows, c.title, c.lamps, null, c.key);
  if (!body) return '';
  const w = +(body.match(/class="lc-bg" x="0" y="0" width="([\d.]+)"/) || [0, 236])[1],
    h = lcH(body) || 60;
  return `<svg class="lc2-pv" viewBox="-2 -2 ${w + 4} ${h + 4}" style="width:${Math.min(100, ((w + 4) / 244) * 100).toFixed(1)}%">${body}</svg>`;
}
function lblSection(b) {
  if (LBL_PSEL_B !== b.id) {
    LBL_PSEL.clear();
    LBL_PSEL_B = b.id;
  }
  const on = lblIsCard(b) && b.props.lblSplit === 'manual';
  const all = lblAll(b),
    nums = on ? lblNums(b) : [];
  const nG = nums.filter(n => lblType(b, n) === 'group').length,
    nS = nums.length - nG;
  const STY = LBL_STY.filter(([k]) => k !== 'classic');
  const icon = k => `<svg viewBox="0 0 42 28" width="30" height="20" aria-hidden="true">${LBL_ICO[k]}</svg>`;
  const live = MODE === 'monitor';
  /* v9.85 — a selected card opens its editor here (one place for everything about the card) */
  if (on && LBL_CSEL && LBL_CSEL.b === b.id && lblCards(b).some(c => c.key === LBL_CSEL.key))
    return `<section class="ix-sec lc2 lce" id="lc2">${lblCardEditor(b, LBL_CSEL.key)}</section>`;
  let h = `<section class="ix-sec lc2" id="lc2">
  <h4>Data label cards <span class="ix-sum">${all.length} tag${all.length === 1 ? '' : 's'}</span></h4>
  <div class="lc2-sw" role="radiogroup" aria-label="Show tags as"><button type="button" role="radio" data-lm="labels" aria-checked="${!on}">Labels only</button><button type="button" role="radio" data-lm="cards" aria-checked="${on}">Cards</button></div>`;
  if (!on) {
    h += `<p class="lc2-note">Each tag is shown as its own small label beside the equipment.<br>Switch to <b>Cards</b> to put tags together in cards — shown as tags, a group or score cards, with rotation.</p>`;
    return h + lblFoot() + '</section>';
  }
  /* ---- tags ---- */
  const cardOf = t => (t.show ? t.card || 0 : -1);
  const where = t => {
    const ns = lblCardsOf(b, t).sort((a, c) => a - c);
    if (!ns.length) return cardOf(t) < 0 ? '<span class="lc2-b lc2-b-off">Hidden</span>' : '<span class="lc2-b lc2-b-lbl">Label</span>';
    return `<span class="lc2-bs">${ns
      .map(n => {
        const i = nums.indexOf(n) + 1;
        return `<span class="lc2-b lc2-b-g" title="In card ${i}">Card ${i}</span>`;
      })
      .join('')}</span>`;
  };
  const nsel = [...LBL_PSEL].filter(id => all.some(t => t.id === id)).length;
  h += `<div class="lc2-h">Tags <span class="lc2-hint">tick tags, then choose what to do</span><button type="button" class="lc2-lk" data-psall="1">${nsel === all.length ? 'Clear' : 'Select all'}</button></div>
  <div class="lc2-tags">${all
    .map(t => {
      const v = live && t.show ? esc(tagTxt(t.id)) : '';
      return `<label class="lc2-tag${LBL_PSEL.has(t.id) ? ' on' : ''}" title="${esc(t.id)}"><input type="checkbox" data-pst="${esc(t.id)}" ${LBL_PSEL.has(t.id) ? 'checked' : ''}><span class="lc2-tn">${esc(lblNm(t))}</span>${v ? `<span class="lc2-tv">${v}</span>` : ''}${where(t)}</label>`;
    })
    .join('')}</div>
  ${nsel ? `<div class="lc2-act"><div class="lc2-acn">${nsel} selected <button type="button" class="lc2-lk" data-psclr>Clear</button></div>
    <div class="lc2-acb"><button type="button" class="pri${nsel > 1 ? '' : ' full'}" data-pa="group" title="Put the ticked tags together in one new card">＋ New card</button>
    ${nsel > 1 ? `<button type="button" data-pa="single" title="One new card for each ticked tag">＋ One card per tag</button>` : ''}
    ${nums.length ? `<select data-pa="to" aria-label="Add the ticked tags to a card"><option value="">Add to card…</option>${nums
      .map((n, i) => `<option value="${n}">${i + 1} · ${esc(lblCards(b).find(c => c.key === 'c' + n)?.title || 'Card ' + n)}</option>`)
      .join('')}</select>` : ''}
    <button type="button" data-pa="label" title="Take out of cards — show as normal labels">As labels</button>
    <button type="button" data-pa="hide" title="Do not show these tags">Hide</button></div></div>` : ''}`;
  /* ---- cards (v9.85: a compact list; click one to edit it) ---- */
  const CS = lblCards(b);
  h += `<div class="lc2-h">Cards <span class="lc2-hint">click a card to edit it</span></div>`;
  if (!nums.length) h += `<div class="lc2-empty">No cards yet. Tick tags above and press <b>＋ New card</b>. A tag can be in more than one card.</div>`;
  h += `<div class="lc2-list">${nums
    .map((n, i) => {
      const key = 'c' + n,
        c = CS.find(k => k.key === key) || { rows: [], title: '' },
        sh = lblShowOf(b, key),
        R = lblRot(b, key),
        rt = sh === 'single' && c.rows.length > 1 ? `1 at a time, ${R.sec} s` : R.on && c.rows.length > R.n ? `${R.n} at a time, ${R.sec} s` : 'all shown';
      return `<button type="button" class="lc2-li" data-copen="${key}"><span class="lc2-num">${i + 1}</span><span class="lc2-lin"><b>${esc(c.title)}</b><small>${LBL_SHOWN[sh]} · ${c.rows.length} tag${c.rows.length === 1 ? '' : 's'} · ${rt}</small></span><span class="lc2-chev" aria-hidden="true">›</span></button>`;
    })
    .join('')}</div>`;
  h += `<div class="lc2-h">${nums.length ? 'Rearrange' : 'Or start with'}</div><div class="lc2-quick2"><button type="button" data-qk="one">All in one card</button><button type="button" data-qk="each">One card per tag</button><button type="button" data-qk="type">Cards by type</button>${nums.length ? '<button type="button" id="lcReset" title="Put every card back beside its equipment">Re-place cards</button>' : ''}</div>`;
  /* ---- live preview ---- */

  const nl = lblLampsOf(b).length;
  if (nl) h += `<label class="lc2-check"><input type="checkbox" id="lcChips" ${b.props.lblChips === false ? '' : 'checked'}> Show the ${nl} on/off signal${nl > 1 ? 's' : ''} as chips in the first card</label>`;
  return h + lblFoot() + '</section>';
}
const LBL_SHOWN = { tag: 'Tag', group: 'Group', single: 'Group · Big value', score: 'Score card' };
function lblShowOf(b, key) {
  const cd = ((b.props.lblCardD || {})[key]) || {};
  return cd.show || (cd.type === 'single' ? 'single' : 'group');
}
const LCE_OPEN = { design: false, place: false };
let LCE_ADD = false; // card editor: list of tags that can be added is open
const LCE_SHOW_ICO = {
  tag: '<rect x="1" y="3" width="40" height="22" rx="3" fill="#fff" stroke="#9aa"/><rect x="4" y="7" width="2.5" height="5" rx="1" fill="#2e9e4f"/><path d="M9 9.5h14" stroke="#9aa" stroke-width="1.6"/><path d="M29 9.5h9" stroke="#16212b" stroke-width="2"/><rect x="4" y="16" width="2.5" height="5" rx="1" fill="#2e9e4f"/><path d="M9 18.5h14" stroke="#9aa" stroke-width="1.6"/><path d="M29 18.5h9" stroke="#16212b" stroke-width="2"/>',
  group: '<rect x="1" y="1" width="40" height="26" rx="3" fill="#fff" stroke="#9aa"/><rect x="1" y="1" width="40" height="6" rx="3" fill="#1f3b63"/><path d="M4 12h18M4 17h18M4 22h18" stroke="#9aa"/><path d="M30 12h8M30 17h8M30 22h8" stroke="#16212b" stroke-width="1.6"/>',
  single: '<rect x="1" y="1" width="40" height="26" rx="3" fill="#fff" stroke="#9aa"/><rect x="1" y="1" width="3" height="26" rx="1.5" fill="#2e9e4f"/><path d="M8 7h16" stroke="#9aa" stroke-width="1.6"/><path d="M8 18h20" stroke="#16212b" stroke-width="5"/>',
  score: '<rect x="1" y="1" width="40" height="26" rx="5" fill="#fff" stroke="#9aa"/><circle cx="9" cy="14" r="5" fill="#1f6feb"/><path d="M17 9h12" stroke="#9aa" stroke-width="1.6"/><path d="M17 18h12" stroke="#16212b" stroke-width="4"/><rect x="31" y="15" width="8" height="5" rx="2.5" fill="#1f9d55"/>',
};
const lceIco = (svg) => `<svg viewBox="0 0 42 28" width="46" height="31" aria-hidden="true">${svg}</svg>`;
function lblCardEditor(b, key) {
  const c = lblCards(b).find(k => k.key === key),
    n = +key.slice(1),
    nums = lblNums(b),
    idx = nums.indexOf(n),
    CD = ((b.props.lblCardD || {})[key]) || {},
    D = Object.assign({}, DOC.lblDesign || {}, b.props.lblDesign || {}, CD),
    sh = lblShowOf(b, key),
    gsty = CD.sty && CD.sty !== 'classic' ? CD.sty : lblStyle(b) === 'classic' ? 'table' : lblStyle(b),
    side = (b.props.lblSide || {})[key],
    sz = (b.props.lblSize || {})[key] || {},
    pins = CD.pin || [];
  const nm = t => esc((REG[t.id] && REG[t.id].short) || t.id.split('.').pop());
  const others = lblAll(b).filter(t => !c.rows.some(r => r.id === t.id));
  const seg = (k, opts, cur) => `<span class="lce-seg">${opts.map(([v, t]) => `<button type="button" data-cd="${k}|${v}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join('')}</span>`;
  const sw = (k, list, cur) => `<span class="lce-sws">${list.map(([c2, t]) => `<button type="button" class="lc-sw" data-cd="${k}|${c2}" style="background:${c2}" aria-pressed="${cur === c2}" title="${t || c2}"></button>`).join('')}</span>`;
  const row = (label, body) => `<div class="lce-r"><span class="lce-l">${label}</span><div class="lce-v">${body}</div></div>`;
  const big = sh === 'single',
    shB = big ? 'group' : sh;
  const SHOWS = [
    ['tag', 'Tag', 'One line per tag: name and value'],
    ['group', 'Group', 'Several tags in one card, in the layout you choose'],
    ['score', 'Score card', 'A score tile per tag: icon, big value, status'],
  ];
  let h = `<div class="lce-top"><button type="button" class="lce-back" data-cback>‹ All cards</button><span class="lce-of">Card ${idx + 1} of ${nums.length} · ${esc(b.name)}</span></div>
  <input class="lce-name" data-lct="${key}" value="${esc(c.title)}" aria-label="Card name">`;
  /* 1 — tags: a plain tick list (ticked = in this card), drag ⋮⋮ to order; chart / score card only on the picked tag */
  const inCard = c.rows,
    rest = lblAll(b).filter(t => !inCard.some(r => r.id === t.id));
  const trow = (t, on) => {
    const pk = on && LBL_CROW.has(t.id),
      cs = lblCardsOf(b, t).filter(m => m !== n).map(m => nums.indexOf(m) + 1).filter(i => i > 0).sort((a, z) => a - z),
      where = cs.length ? `<small>${on ? 'also ' : ''}in card ${cs.join(', ')}</small>` : '';
    return `<div class="lce-t${on ? '' : ' off'}${pk ? ' picked' : ''}" ${on ? `draggable="true" data-tdrag="${esc(t.id)}"` : ''} title="${esc(t.id)}">${on ? '<span class="lce-grip" aria-hidden="true">⋮⋮</span>' : '<span class="lce-grip"></span>'}<label><input type="checkbox" data-ctin="${esc(t.id)}" ${on ? 'checked' : ''}><span>${nm(t)}</span></label>${where}${pk ? `<span class="lce-pa"><button type="button" data-cplot="${esc(t.id)}">Chart</button><button type="button" data-cscore="${esc(t.id)}">Score card</button></span>` : ''}</div>`;
  };
  h += `<div class="lce-g"><div class="lce-gh">Tags <small>${inCard.length} in this card</small></div><div class="lce-tags">${inCard.map(t => trow(t, true)).join('')}${rest.length ? `<button type="button" class="lce-addt" data-caddt aria-expanded="${LCE_ADD || !inCard.length}">${LCE_ADD || !inCard.length ? '−' : '＋'} Add tags <small>${rest.length} more of ${esc(b.name)}</small></button>${LCE_ADD || !inCard.length ? rest.map(t => trow(t, false)).join('') : ''}` : ''}</div><p class="lce-note">Untick to remove · drag ⋮⋮ to reorder · a tag can be in more than one card</p></div>`;
  /* 2 — show as (Tag · Group · Score card); Group then picks its layout, "Big value" is one of them */
  h += `<div class="lce-g"><div class="lce-gh">Show as</div><div class="lce-pick lce-pick3">${SHOWS.map(([v, t, d]) => `<button type="button" class="lce-pi" data-cshow="${key}|${v}" aria-pressed="${shB === v}" title="${esc(d)}">${lceIco(LCE_SHOW_ICO[v])}<span>${t}</span></button>`).join('')}</div>`;
  if (shB === 'group')
    h += `<div class="lce-l lce-lt">Group layout</div><div class="lce-pick">${[['table', 'Table'], ['group', 'Grouped'], ['hmi', 'Dark'], ['tile', 'Tiles'], ['bars', 'Bars'], ['kpi', 'Key + trend'], ['status', 'Status'], ['single', 'Big value']]
      .map(([v, t]) => (v === 'single' ? `<button type="button" class="lce-pi" data-cshow="${key}|single" aria-pressed="${big}" title="One tag at a time with a big value">${lceIco(LCE_SHOW_ICO.single)}<span>${t}</span></button>` : `<button type="button" class="lce-pi" data-cd="sty|${v}" aria-pressed="${!big && gsty === v}">${lceIco(LBL_ICO[v])}<span>${t}</span></button>`))
      .join('')}</div>`;
  if (sh !== 'tag') h += `<div class="lce-hdr">${row('Card header', `<span class="lce-seg"><button type="button" ${CD.noHead ? `data-chd="${n}"` : ''} aria-pressed="${!CD.noHead}">Show</button><button type="button" ${CD.noHead ? '' : `data-chd="${n}"`} aria-pressed="${!!CD.noHead}">Hide</button></span>`)}</div>`;
  h += `</div>`;
  /* 3 — rotation: tags at a time, seconds */
  h += `<div class="lce-g"><div class="lce-gh">Rotation</div>${lblRotUI(b, key, c.rows.length, big, nm, pins)}</div>`;
  /* 4 — card design */
  h += `<details class="lce-g lce-fold" data-fold="design" ${LCE_OPEN.design ? 'open' : ''}><summary class="lce-gh">Card design</summary><div class="lce-dz">`;
  h += row('Corners', seg('rx', [[0, 'Square'], [6, 'Round'], [12, 'Rounder']], D.rx == null ? 6 : D.rx));
  h += row('Border', seg('bw', [[0.5, 'Thin'], [1, 'Normal'], [2, 'Bold']], D.bw || 1));
  h += row('Text size', seg('fs', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']], D.fs || 'm'));
  h += `<div class="lce-l lce-lt">Colours</div>`;
  if (sh !== 'tag') h += row('Header', sw('hd', [['#1f3b63', 'Navy'], ['#37474f', 'Slate'], ['#2e7d32', 'Green'], ['#00796b', 'Teal'], ['#1565c0', 'Blue'], ['#c62828', 'Red'], ['#d48a00', 'Amber'], ['#f3f6f9', 'Light']], D.hd || (gsty === 'group' ? '#1f3b63' : '#f3f6f9')));
  if (gsty !== 'hmi' || sh !== 'group') h += row('Card', sw('bg', [['#ffffff', 'White'], ['#f8fafc', 'Light grey'], ['#fffdf5', 'Warm'], ['#f1f8ff', 'Light blue'], ['#f3fbf5', 'Light green']], D.bg || '#ffffff'));
  h += row('Value', sw('v', [['#16212b', 'Dark'], ['#1f3b63', 'Navy'], ['#1565c0', 'Blue'], ['#2e7d32', 'Green'], ['#7fe0ff', 'Cyan']], D.v || '#16212b'));
  h += `</div><div class="lce-acts lce-acts2"><button type="button" data-cd="copyall">Apply to all cards</button><button type="button" data-cd="reset">Reset</button></div></details>`;
  /* 5 — size and place */
  h += `<details class="lce-g lce-fold" data-fold="place" ${LCE_OPEN.place ? 'open' : ''}><summary class="lce-gh">Size and place</summary>${row('Size', `<input type="number" min="60" max="900" step="10" data-csz="${key}|w" value="${sz.w || ''}" placeholder="auto" aria-label="Width"> × <input type="number" min="30" max="900" step="10" data-csz="${key}|h" value="${sz.h || ''}" placeholder="auto" aria-label="Height">${sz.w || sz.h ? ` <button type="button" class="lce-lk" data-csz0="${key}">Auto</button>` : ''}`)}
   ${row('Place', `<span class="lce-seg">${[['above', '↑', 'Above the equipment'], ['left', '←', 'Left of the equipment'], ['right', '→', 'Right of the equipment'], ['below', '↓', 'Below the equipment']].map(([s2, t, d]) => `<button type="button" data-lcp="${key}|${s2}" aria-pressed="${side === s2}" title="${d}" aria-label="${d}">${t}</button>`).join('')}</span>`)}
   ${row('', `<button type="button" class="lce-lk" data-cd="free">Move to a free spot</button>`)}
   <p class="lce-note">Or drag the card on the drawing; drag its edges to resize.</p></details>
  <div class="lce-end"><button type="button" class="lce-del" data-cdel="${n}">Delete this card</button></div>`;
  return h;
}
function lblRotUI(b, key, n, big, nm, pins) {
  /* v9.90 — two plain rows: how many tags at a time, and how often to turn the page */
  const row = (label, body) => `<div class="lce-r"><span class="lce-l">${label}</span><div class="lce-v">${body}</div></div>`;
  if (n < 2) return '<p class="lce-note">One tag in this card — nothing to rotate.</p>';
  const cd = ((b.props.lblCardD || {})[key]) || {},
    own = cd.rot && cd.rot.on != null,
    R = lblRot(b, key),
    D0 = Object.assign({}, ROT0, DOC.rotDef || {}),
    cur = !own ? (D0.on && D0.n < n ? 'def' : 'all') : !cd.rot.on || +cd.rot.n >= n ? 'all' : String(cd.rot.n),
    defTxt = D0.on && D0.n < n ? `${D0.n} · ${D0.sec} s` : `all ${n}`;
  const per = big ? 1 : R.on && n > R.n ? +R.n : n,
    rotating = per < n;
  /* pages as they really run: pinned tags and (if set) tags in alarm stay, the rest share the free rows */
  const ids = (lblCards(b).find(c => c.key === key) || { rows: [] }).rows.map(t => t.id),
    pin = big ? [] : R.pin,
    nAl = !big && R.alarms ? ids.filter(id => !pin.includes(id) && tagSev(id) >= 2).length : 0,
    free = Math.max(1, per - pin.length - nAl),
    pages = Math.ceil(Math.max(0, n - pin.length - nAl) / free);
  const secs = `<select data-crots="${key}" aria-label="Seconds per page">${[3, 5, 10, 15, 20, 30].map(x => `<option value="${x}" ${+R.sec === x ? 'selected' : ''}>${x} seconds</option>`).join('')}</select>`;
  let h = row(
    'Tags at a time',
    big
      ? `<span class="lce-fix">1 <small>(Big value)</small></span>`
      : `<select data-crotn="${key}" aria-label="Tags shown at a time"><option value="all" ${cur === 'all' ? 'selected' : ''}>All ${n} — no rotation</option>${Array.from({ length: n - 1 }, (_, i) => i + 1)
          .map(i => `<option value="${i}" ${cur === String(i) ? 'selected' : ''}>${i}</option>`)
          .join('')}<option value="def" ${cur === 'def' ? 'selected' : ''}>Plant default (${defTxt})</option></select>`
  );
  if (rotating) {
    h += row('Next page every', secs);
    h += `<p class="lce-rn">${n} tags → ${pages} page${pages === 1 ? '' : 's'}${pin.length ? ` · ${pin.length} always shown` : ''}${nAl ? ` · ${nAl} in alarm kept on screen` : !big && R.alarms ? ' · tags in alarm stay on screen' : ''}</p>`;
    if (!big) h += row('Always show', `<select data-cpinsel="${key}"><option value="">None</option>${ids.map(id => `<option value="${esc(id)}" ${pin.includes(id) ? 'selected' : ''}>${nm({ id })}</option>`).join('')}</select>`);
  } else h += `<p class="lce-rn">All ${n} tags are shown together.</p>`;
  return h;
}
function lblRotDefUI() {
  const R = Object.assign({}, ROT0, DOC.rotDef || {});
  const o = (k, list) => `<select data-rotd="${k}">${list.map(x => `<option value="${x}" ${+R[k] === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  return `<div class="lc2-foot lc2-rotd"><span>Rotation — plant default</span><label><input type="checkbox" data-rotd="on" ${R.on ? 'checked' : ''}> On</label>${o('n', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])}<em>per page</em>${o('sec', [3, 5, 10, 15, 20, 30])}<em>s</em>
   <label><input type="checkbox" data-rotd="alarms" ${R.alarms ? 'checked' : ''}> Alarms stay on screen</label><label><input type="checkbox" data-rotd="pause" ${R.pause ? 'checked' : ''}> Pause on pointer / touch</label></div>`;
}
function lblFoot() {
  /* v9.91 — plant-wide card settings live in their own dialog, not on the machine panel */
  return `<div class="lc2-plant"><button type="button" class="lc2-lk" data-plantcards>Plant card settings…</button><span>rotation default · style for new equipment</span></div>`;
}
function lblPlantDlg() {
  const R = Object.assign({}, ROT0, DOC.rotDef || {});
  const o = (k, list, unit) => `<select data-rotd="${k}">${list.map(x => `<option value="${x}" ${+R[k] === x ? 'selected' : ''}>${x}${unit || ''}</option>`).join('')}</select>`;
  const row = (l, v) => `<div class="pcs-r"><span>${l}</span><div>${v}</div></div>`;
  openModal(`<h3>Plant card settings</h3><div class="note">These apply to the whole plant. Each card can still choose its own rotation in its editor.</div>
   <div class="pcs"><h5>Rotation default</h5>
   ${row('Rotate cards', `<label class="pcs-c"><input type="checkbox" data-rotd="on" ${R.on ? 'checked' : ''}> On</label>`)}
   ${row('Tags at a time', o('n', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))}
   ${row('Next page every', o('sec', [3, 5, 10, 15, 20, 30], ' seconds'))}
   ${row('', `<label class="pcs-c"><input type="checkbox" data-rotd="alarms" ${R.alarms ? 'checked' : ''}> Tags in alarm stay on screen</label>`)}
   ${row('', `<label class="pcs-c"><input type="checkbox" data-rotd="pause" ${R.pause ? 'checked' : ''}> Pause while the pointer is on a card</label>`)}
   <h5>New equipment</h5>
   ${row('Show tags as', `<select id="lcAll">${LBL_STY.map(([k, n]) => `<option value="${k}" ${(DOC.lblStyle || 'classic') === k ? 'selected' : ''}>${k === 'classic' ? 'Labels' : 'Cards · ' + esc(n)}</option>`).join('')}</select>`)}</div>
   <div class="mact"><button class="ib pri" id="pcsOk">Done</button></div>`);
  const M = $('#mbox');
  M.querySelectorAll('[data-rotd]').forEach(x =>
    (x.onchange = () => {
      pushUndo();
      const k = x.dataset.rotd;
      DOC.rotDef = Object.assign({}, ROT0, DOC.rotDef || {}, { [k]: x.type === 'checkbox' ? x.checked : +x.value });
      changed();
      renderCanvas();
      renderProps();
    })
  );
  M.querySelector('#lcAll').onchange = e => (lblSetLayout(e.target.value), renderProps());
  M.querySelector('#pcsOk').onclick = closeModal;
}
const LBL_ICO = {
  table: '<rect x="1" y="1" width="40" height="26" rx="3" fill="#fff" stroke="#9aa"/><rect x="1" y="1" width="40" height="6" fill="#e8eef5"/><path d="M4 12h18M4 17h18M4 22h18" stroke="#9aa"/><path d="M30 12h8M30 17h8M30 22h8" stroke="#16212b"/>',
  group: '<rect x="1" y="1" width="40" height="26" rx="3" fill="#fff" stroke="#9aa"/><rect x="1" y="1" width="40" height="6" fill="#1f3b63"/><path d="M4 11h10" stroke="#1f3b63" stroke-width="2"/><path d="M4 15h30M4 19h30" stroke="#9aa"/><path d="M4 23h10" stroke="#1f3b63" stroke-width="2"/>',
  hmi: '<rect x="1" y="1" width="40" height="26" rx="3" fill="#16222c"/><path d="M4 9h16M4 15h16M4 21h16" stroke="#5c7384"/><path d="M28 9h10M28 15h10M28 21h10" stroke="#7fe0ff" stroke-width="2"/>',
  tile: '<rect x="1" y="1" width="40" height="26" rx="3" fill="#fff" stroke="#9aa"/><rect x="4" y="5" width="16" height="9" rx="2" fill="#f4f7fa" stroke="#9aa"/><rect x="22" y="5" width="16" height="9" rx="2" fill="#fdeeee" stroke="#e0a0a0"/><rect x="4" y="16" width="16" height="9" rx="2" fill="#f4f7fa" stroke="#9aa"/><rect x="22" y="16" width="16" height="9" rx="2" fill="#f4f7fa" stroke="#9aa"/>',
  bars: '<rect x="1" y="1" width="40" height="26" rx="3" fill="#fff" stroke="#9aa"/><rect x="4" y="7" width="34" height="4" rx="2" fill="#edf1f4"/><rect x="14" y="7" width="14" height="4" fill="#bfe3c9"/><rect x="20" y="5" width="2" height="8" fill="#1f3b63"/><rect x="4" y="17" width="34" height="4" rx="2" fill="#edf1f4"/><rect x="12" y="17" width="14" height="4" fill="#bfe3c9"/><rect x="31" y="15" width="2" height="8" fill="#d23b3b"/>',
  kpi: '<rect x="1" y="1" width="40" height="26" rx="3" fill="#fff" stroke="#9aa"/><path d="M5 10h10M24 10h10" stroke="#16212b" stroke-width="3"/><path d="M21 3v11" stroke="#d4dce3"/><path d="M4 18h12M4 23h12" stroke="#9aa"/><path d="M20 19l3-2 3 3 3-3 3 2 3-1" stroke="#1f3b63" fill="none"/><path d="M20 24l3-1 3 2 3-2 3 1 3-2" stroke="#1f3b63" fill="none"/>',
  status: '<rect x="1" y="1" width="40" height="26" rx="3" fill="#fff" stroke="#9aa"/><rect x="4" y="4" width="7" height="6" rx="1.5" fill="#e8eef5"/><rect x="28" y="5" width="10" height="4" rx="1" fill="#2e9e4f"/><rect x="1" y="12" width="30" height="2" fill="#2e9e4f"/><rect x="31" y="12" width="10" height="2" fill="#d23b3b"/><path d="M5 18h30M5 23h30" stroke="#9aa"/><rect x="1" y="21" width="2" height="5" fill="#d23b3b"/>'
};
let LBL_MORE_OPEN = false;
{
  const _renderProps = renderProps;
  renderProps = function () {
    _renderProps();
    try {
      const b = SEL && SEL.t === 'b' ? B(SEL.id) : null;
      if (!b || PTAB !== 'cards' || RP || !EQ[b.type] || EQ[b.type].widget || EQ[b.type].inst || b.type === 'statusLamp' || !b.tags || !b.tags.length) return;
      const P = $('#props'),
        anchor = [...P.querySelectorAll('.ix-sec')].find(s => /Readings/.test(s.querySelector('h4')?.textContent || ''));
      const scrollY = P.scrollTop;
      const html = lblSection(b);
      if (anchor) anchor.insertAdjacentHTML('beforebegin', html);
      else P.insertAdjacentHTML('beforeend', html);
      P.scrollTop = scrollY;
      const S = P.querySelector('#lc2');
      const more = S.querySelector('.lc2-more');
      if (more) {
        more.open = LBL_MORE_OPEN;
        more.ontoggle = () => (LBL_MORE_OPEN = more.open);
      }
      const done = () => {
        lblRenumber(b);
        changed();
        renderCanvas();
        renderProps();
      };
      const D = () => (b.props.lblCardD = b.props.lblCardD || {});
      const T = () => (b.props.lblTitles = b.props.lblTitles || {});
      const groupSty = () => {
        const s = lblStyle(b);
        return s === 'classic' ? (DOC.lblStyle && DOC.lblStyle !== 'classic' ? DOC.lblStyle : 'table') : s;
      };
      const nextN = () => Math.max(0, ...lblAll(b).map(t => t.card || 0), ...lblNums(b)) + 1;
      const tagsOf = ids => ids.map(id => b.tags.find(t => t.id === id)).filter(Boolean);
      const selected = () => tagsOf(lblAll(b).map(t => t.id).filter(id => LBL_PSEL.has(id)));
      const clearPlaces = () => {
        delete b.props.lblPos;
        delete b.props.lblSide;
      };
      const ensureCards = () => {
        if (!lblIsCard(b)) b.props.lblStyle = groupSty();
        if (b.props.lblSplit !== 'manual') {
          b.props.lblSplit = 'manual';
          lblAll(b).forEach(t => (t.card = 0));
        }
      };
      const addSingles = (list, at) => {
        list.forEach((t, i) => {
          const n = at != null ? at + (i + 1) / (list.length + 1) : nextN();
          lblJoin(b, t, n);
          D()['c' + n] = { type: 'single' };
        });
      };
      /* Labels only / Cards */
      S.querySelectorAll('[data-lm]').forEach(x =>
        (x.onclick = () => {
          pushUndo();
          if (x.dataset.lm === 'labels') b.props.lblStyle = 'classic';
          else {
            const had = b.props.lblSplit === 'manual' && lblNums(b).length;
            b.props.lblStyle = groupSty();
            if (!had) {
              b.props.lblSplit = 'manual';
              lblShown(b).forEach(t => (t.card = 1));
            }
          }
          clearPlaces();
          done();
        })
      );
      /* tick tags */
      S.querySelectorAll('[data-pst]').forEach(c =>
        (c.onchange = () => {
          c.checked ? LBL_PSEL.add(c.dataset.pst) : LBL_PSEL.delete(c.dataset.pst);
          renderProps();
        })
      );
      const sa = S.querySelector('[data-psall]');
      if (sa)
        sa.onclick = () => {
          const ids = lblAll(b).map(t => t.id);
          if (ids.every(id => LBL_PSEL.has(id))) LBL_PSEL.clear();
          else ids.forEach(id => LBL_PSEL.add(id));
          renderProps();
        };
      /* actions on the ticked tags */
      S.querySelectorAll('[data-pa]').forEach(x => {
        const act = () => {
          const sel = selected();
          if (!sel.length) return;
          const a = x.dataset.pa;
          if (a === 'chart') return cardPlot(sel.map(t => t.id));
          if (a === 'score') return scOpen(sel[0].id);
          if (a === 'to' && !x.value) return;
          pushUndo();
          ensureCards();
          if (a === 'group') {
            const n = nextN();
            sel.forEach(t => lblJoin(b, t, n));
            D()['c' + n] = { sty: groupSty() };
          } else if (a === 'single') addSingles(sel);
          else if (a === 'to') sel.forEach(t => lblJoin(b, t, +x.value));
          else if (a === 'label') sel.forEach(t => (lblLeaveAll(b, t), (t.show = true)));
          else if (a === 'hide') sel.forEach(t => (lblLeaveAll(b, t), (t.show = false)));
          LBL_PSEL.clear();
          done();
        };
        if (x.tagName === 'SELECT') x.onchange = act;
        else x.onclick = act;
      });
      /* card: type, style, rename, reorder, delete, place */
      S.querySelectorAll('[data-cty]').forEach(x =>
        (x.onclick = () => {
          const [ns, ty] = x.dataset.cty.split('|'),
            n = +ns;
          if (lblType(b, n) === ty) return;
          pushUndo();
          const rows = lblShown(b).filter(t => (t.card || 0) === n);
          if (ty === 'group') delete D()['c' + n].type;
          else {
            D()['c' + n] = Object.assign(D()['c' + n] || {}, { type: 'single' });
            addSingles(rows.slice(1), n);
            delete T()['c' + n];
          }
          done();
        })
      );
      /* v9.83 rotation settings */
      S.querySelectorAll('[data-crotn]').forEach(x =>
        (x.onchange = () => {
          const key = x.dataset.crotn,
            v = x.value;
          pushUndo();
          const d = (D()[key] = D()[key] || {});
          if (v === 'def') delete d.rot;
          else if (v === 'all') d.rot = Object.assign({}, d.rot || {}, { on: false });
          else d.rot = { on: true, n: +v, sec: (d.rot && d.rot.sec) || lblRot(b, key).sec || 5 };
          done();

        })
      );
      S.querySelectorAll('[data-crots]').forEach(x =>
        (x.onchange = () => {
          const key = x.dataset.crots;
          pushUndo();
          const d = (D()[key] = D()[key] || {});
          d.rot = Object.assign({ on: true, n: lblRot(b, key).n }, d.rot || {}, { sec: +x.value });
          done();
        })
      );
      S.querySelectorAll('[data-cpin]').forEach(x =>
        (x.onclick = e => {
          e.stopPropagation();
          const [key, id] = [x.dataset.cpin.slice(0, x.dataset.cpin.indexOf('|')), x.dataset.cpin.slice(x.dataset.cpin.indexOf('|') + 1)];
          pushUndo();
          const d = (D()[key] = D()[key] || {}),
            p = (d.pin = d.pin || []);
          p.includes(id) ? p.splice(p.indexOf(id), 1) : p.push(id);
          if (!p.length) delete d.pin;
          done();
        })
      );
      S.querySelectorAll('[data-rotd]').forEach(x =>
        (x.onchange = () => {
          pushUndo();
          const k = x.dataset.rotd;
          DOC.rotDef = Object.assign({}, ROT0, DOC.rotDef || {}, { [k]: x.type === 'checkbox' ? x.checked : +x.value });
          done();
        })
      );
      S.querySelectorAll('[data-chd]').forEach(x =>
        (x.onclick = () => {
          const n = x.dataset.chd;
          pushUndo();
          const d = (D()['c' + n] = D()['c' + n] || {});
          if (d.noHead) delete d.noHead;
          else d.noHead = true;
          done();
        })
      );
      S.querySelectorAll('[data-cst]').forEach(x =>
        (x.onclick = () => {
          const [n, k] = x.dataset.cst.split('|');
          pushUndo();
          (D()['c' + n] = D()['c' + n] || {}).sty = k;
          done();
        })
      );
      S.querySelectorAll('[data-lct]').forEach(i =>
        (i.onchange = () => {
          pushUndo();
          const v = i.value.trim();
          if (v) T()[i.dataset.lct] = v;
          else delete T()[i.dataset.lct];
          changed();
          renderCanvas();
          renderProps();
        })
      );
      S.querySelectorAll('[data-cmv]').forEach(x =>
        (x.onclick = () => {
          const [ns, d] = x.dataset.cmv.split('|').map(Number),
            nums = lblNums(b),
            j = nums.indexOf(ns),
            m = nums[j + d];
          if (m == null) return;
          pushUndo();
          /* swap the two card numbers and everything stored under them */
          lblAll(b).forEach(t => (t.card === ns ? (t.card = m) : t.card === m ? (t.card = ns) : 0));
          ['lblTitles', 'lblCardD', 'lblSide', 'lblPos', 'lblSize'].forEach(p => {
            const o = b.props[p];
            if (!o) return;
            const a = o['c' + ns],
              c = o['c' + m];
            delete o['c' + ns];
            delete o['c' + m];
            if (a !== undefined) o['c' + m] = a;
            if (c !== undefined) o['c' + ns] = c;
          });
          done();
        })
      );
      S.querySelectorAll('[data-cdel]').forEach(x =>
        (x.onclick = () => {
          const n = +x.dataset.cdel;
          pushUndo();
          lblAll(b).forEach(t => (t.card || 0) === n && lblLeave(b, t, n));
          ['lblTitles', 'lblCardD', 'lblSide', 'lblPos', 'lblSize', 'lblExtra'].forEach(p => b.props[p] && delete b.props[p]['c' + n]);
          done();
        })
      );
      S.querySelectorAll('[data-csz]').forEach(i =>
        (i.onchange = () => {
          const [k, d] = i.dataset.csz.split('|'),
            v = Math.round(+i.value);
          pushUndo();
          const Z = (b.props.lblSize = b.props.lblSize || {}),
            z = (Z[k] = Z[k] || {});
          if (v > 0) z[d] = Math.max(d === 'w' ? 60 : 30, Math.min(900, v));
          else delete z[d];
          if (!z.w && !z.h) delete Z[k];
          changed();
          renderCanvas();
          renderProps();
        })
      );
      S.querySelectorAll('[data-csz0]').forEach(x =>
        (x.onclick = () => {
          pushUndo();
          if (b.props.lblSize) delete b.props.lblSize[x.dataset.csz0];
          changed();
          renderCanvas();
          renderProps();
        })
      );
      S.querySelectorAll('[data-lcp]').forEach(btn =>
        (btn.onclick = () => {
          const [k, s] = btn.dataset.lcp.split('|');
          pushUndo();
          lblPlace(b, k, s);
          changed();
          renderCanvas();
          renderProps();
        })
      );
      /* drag a tag chip to another card */
      const moveTo = (tid, dest) => {
        const t = b.tags.find(x => x.id === tid);
        if (!t) return;
        pushUndo();
        const n = +dest;
        if (lblType(b, n) === 'single' && lblShown(b).some(x => x.card === n && x !== t)) delete D()['c' + n].type; // a second tag makes it a group card
        t.show = true;
        t.card = n;
        done();
      };
      S.querySelectorAll('[data-cout]').forEach(x => (x.onclick = e => (e.preventDefault(), moveTo(x.dataset.cout, 0))));
      S.querySelectorAll('.lc2-chip[draggable]').forEach(c => {
        c.ondragstart = e => {
          e.dataTransfer.setData('text/plain', c.dataset.tid);
          S.classList.add('lc2-dragging');
        };
        c.ondragend = () => S.classList.remove('lc2-dragging');
      });
      S.querySelectorAll('[data-drop]').forEach(z => {
        z.ondragover = e => (e.preventDefault(), z.classList.add('lc2-over'));
        z.ondragleave = () => z.classList.remove('lc2-over');
        z.ondrop = e => {
          e.preventDefault();
          z.classList.remove('lc2-over');
          const tid = e.dataTransfer.getData('text/plain');
          if (tid) moveTo(tid, z.dataset.drop);
        };
      });
      /* quick starts */
      S.querySelectorAll('[data-qk]').forEach(x =>
        (x.onclick = () => {
          pushUndo();
          ensureCards();
          const list = lblShown(b);
          b.props.lblCardD = {};
          b.props.lblTitles = {};
          clearPlaces();
          if (x.dataset.qk === 'one') {
            list.forEach(t => (t.card = 1));
            D().c1 = { sty: groupSty() };
          } else if (x.dataset.qk === 'each') {
            list.forEach(t => (t.card = 0));
            addSingles(list);
          } else {
            const G = [...LBL_GROUPS.map(g => g[0]), 'Other'],
              gOf = t => lblGroupOf((REG[t.id].short || t.id) + ' ' + t.id),
              used = G.filter(g => list.some(t => gOf(t) === g));
            list.forEach(t => (t.card = used.indexOf(gOf(t)) + 1));
            used.forEach((g, i) => (T()['c' + (i + 1)] = `${b.name} · ${g}`));
          }
          done();
        })
      );
      const rs = S.querySelector('#lcReset');
      if (rs)
        rs.onclick = () => {
          pushUndo();
          clearPlaces();
          done();
        };
      const ch = S.querySelector('#lcChips');
      if (ch)
        ch.onchange = () => {
          pushUndo();
          b.props.lblChips = ch.checked;
          done();
        };
      const setD = (k, v) => {
        pushUndo();
        b.props.lblDesign = b.props.lblDesign || {};
        if (k === 'noHead') {
          if (v === '1') b.props.lblDesign.noHead = true;
          else {
            delete b.props.lblDesign.noHead;
            Object.values(b.props.lblCardD || {}).forEach(d => delete d.noHead);
          }
        } else b.props.lblDesign[k] = ['rx', 'bw'].includes(k) ? +v : v;
        done();
      };
      S.querySelectorAll('[data-lcd]').forEach(btn => (btn.onclick = () => setD(...btn.dataset.lcd.split('|'))));
      S.querySelectorAll('[data-lcc2]').forEach(inp => (inp.onchange = () => setD(inp.dataset.lcc2, inp.value)));
      const dall = S.querySelector('#lcDAll');
      if (dall)
        dall.onclick = () => {
          pushUndo();
          DOC.lblDesign = Object.assign({}, DOC.lblDesign || {}, b.props.lblDesign || {});
          DOC.blocks.forEach(x => x.props && delete x.props.lblDesign);
          done();
          toast('Card look applied to every card in the layout');
        };
      const dres = S.querySelector('#lcDReset');
      if (dres)
        dres.onclick = () => {
          pushUndo();
          delete b.props.lblDesign;
          done();
        };
      S.querySelectorAll('[data-plantcards]').forEach(x => (x.onclick = lblPlantDlg));
      S.querySelectorAll('[data-caddt]').forEach(x => (x.onclick = () => ((LCE_ADD = !LCE_ADD), renderProps())));
      S.querySelectorAll('[data-psclr]').forEach(x => (x.onclick = () => (LBL_PSEL.clear(), renderProps())));
      /* v9.85 — card list and card editor */
      const reopen = () => {
        renderCanvas();
        renderProps();
        const s2 = document.getElementById('lc2');
        if (s2) s2.scrollIntoView({ block: 'start' });
      };
      S.querySelectorAll('[data-copen]').forEach(x => (x.onclick = () => ((LBL_CSEL = { b: b.id, key: x.dataset.copen }), LBL_CROW.clear(), (LCE_ADD = false), reopen())));
      S.querySelectorAll('[data-cback]').forEach(x => (x.onclick = () => ((LBL_CSEL = null), LBL_CROW.clear(), reopen())));
      S.querySelectorAll('[data-cshow]').forEach(x =>
        (x.onclick = () => {
          const [key, v] = x.dataset.cshow.split('|');
          pushUndo();
          const d = (D()[key] = D()[key] || {});
          d.show = v;
          if (v !== 'single' && d.type === 'single') delete d.type;
          done();
        })
      );
      S.querySelectorAll('[data-cplot]').forEach(x => (x.onclick = () => openTrend(x.dataset.cplot)));
      S.querySelectorAll('details[data-fold]').forEach(d => (d.ontoggle = () => (LCE_OPEN[d.dataset.fold] = d.open)));
      S.querySelectorAll('[data-ctin]').forEach(x =>
        (x.onchange = () => {
          const id = x.dataset.ctin;
          if (x.checked) {
            const t = b.tags.find(q => q.id === id);
            if (t) t.show = true;
            lblCardOp('add', id);
          }
          else lblCardOp('remove', id);
          renderProps();
        })
      );
      S.querySelectorAll('[data-cpinsel]').forEach(x =>
        (x.onchange = () => {
          pushUndo();
          const d = (D()[x.dataset.cpinsel] = D()[x.dataset.cpinsel] || {});
          if (x.value) d.pin = [x.value];
          else delete d.pin;
          done();
        })
      );
      {
        let drag = null;
        S.querySelectorAll('[data-tdrag]').forEach(r => {
          r.ondragstart = e => ((drag = r.dataset.tdrag), e.dataTransfer.setData('text/plain', drag), r.classList.add('dragging'));
          r.ondragend = () => r.classList.remove('dragging');
          r.ondragover = e => (e.preventDefault(), r.classList.add('over'));
          r.ondragleave = () => r.classList.remove('over');
          r.ondrop = e => {
            e.preventDefault();
            r.classList.remove('over');
            const to = r.dataset.tdrag;
            if (!drag || drag === to) return;
            const a1 = b.tags.findIndex(q => q.id === drag);
            if (a1 < 0 || !b.tags.some(q => q.id === to)) return;
            pushUndo();
            const [t] = b.tags.splice(a1, 1);
            b.tags.splice(b.tags.findIndex(q => q.id === to), 0, t);
            done();
          };
        });
      }
      S.querySelectorAll('[data-cscore]').forEach(x => (x.onclick = () => scOpen(x.dataset.cscore)));
      S.querySelectorAll('[data-cord]').forEach(x =>
        (x.onclick = () => {
          const i0 = x.dataset.cord.lastIndexOf('|'),
            id = x.dataset.cord.slice(0, i0),
            dir = +x.dataset.cord.slice(i0 + 1),
            t = b.tags.find(q => q.id === id);
          if (!t) return;
          const same = b.tags.filter(q => q.show && q.card === t.card),
            j = same.indexOf(t),
            o = same[j + dir];
          if (!o) return;
          pushUndo();
          const a1 = b.tags.indexOf(t),
            a2 = b.tags.indexOf(o);
          [b.tags[a1], b.tags[a2]] = [b.tags[a2], b.tags[a1]];
          done();
        })
      );
      if (S.classList.contains('lce') && LBL_CSEL) lblWirePanel(S, b, LBL_CSEL.key);
    } catch (e) {
      console.warn('label card panel', e);
    }
  };
}
/* styles */
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="lcCss">
#cv .lcard{font-size:12px}#cv .lcard text{font-family:Inter,'Segoe UI',system-ui,sans-serif}
#cv .lcard .lc-h{font-size:1em;font-weight:800}
#cv .lcard .lc-st{font-size:.79em;font-weight:800;letter-spacing:.04em}
#cv .lcard .lc-k{font-size:.875em}
#cv .lcard .lc-v{font-size:.875em;font-weight:700;font-family:'JetBrains Mono',Consolas,monospace}
#cv .lcard .lc-g{font-size:.73em;font-weight:800;letter-spacing:.08em}
#cv .lcard .lc-c{font-size:.79em;font-weight:600}
#lc2 h4{margin-bottom:8px}
.lc2-sw{display:grid;grid-template-columns:1fr 1fr;background:var(--panel2,#f1f5f9);border:1px solid var(--line,#dbe2ec);border-radius:9px;padding:3px;gap:3px}
.lc2-sw button{border:0;border-radius:7px;padding:7px 4px;background:transparent;font:700 12.5px inherit;color:#64748b;cursor:pointer}
.lc2-sw button[aria-checked="true"]{background:var(--panel,#fff);color:var(--text,#152238);box-shadow:0 1px 3px rgba(15,23,42,.14)}
.lc2-note{font-size:11.5px;color:var(--muted,#64748b);margin:9px 0 4px;line-height:1.5}
.lc2-h{display:flex;align-items:baseline;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#475569;margin:13px 0 6px}.lc2-hint{font-weight:500;letter-spacing:0;text-transform:none;color:#94a3b8;font-size:11px;flex:1}
.lc2-lk{border:0;background:none;color:var(--accent,#1f6feb);font:600 11.5px inherit;cursor:pointer;padding:0;text-transform:none;letter-spacing:0}
.lc2-tags{display:flex;flex-direction:column;border:1px solid var(--line,#dbe2ec);border-radius:9px;max-height:236px;overflow:auto;background:var(--panel,#fff)}
.lc2-tag{display:flex;align-items:center;gap:8px;padding:6px 9px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--line,#eef2f6);margin:0}.lc2-tag:last-child{border-bottom:0}
.lc2-tag:hover{background:var(--panel2,#f8fafc)}.lc2-tag.on{background:#eef5ff}
.lc2-tag input{width:auto;margin:0;flex:none}
.lc2-tn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.lc2-tv{font:600 11px var(--mono,monospace);color:#475569;white-space:nowrap}
.lc2-b{flex:none;min-width:34px;text-align:center;font-size:10px;font-weight:800;border-radius:5px;padding:2px 5px}
.lc2-b-g{background:#e7eefb;color:#1f3b63}.lc2-b-s{background:#e8f5ec;color:#1d6d36}.lc2-b-lbl{background:#f1f5f9;color:#64748b}.lc2-b-off{background:transparent;color:#a0aec0;border:1px dashed #cbd5e1}
.lc2-act{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:7px;padding:7px;border-radius:9px;background:#1f3b63}
.lc2-act.off{background:var(--panel2,#f1f5f9)}
.lc2-acn{flex-basis:100%;font-size:11px;font-weight:700;color:#fff}.lc2-act.off .lc2-acn{color:#94a3b8;font-weight:500}
.lc2-act button,.lc2-act select{border:0;border-radius:6px;padding:5px 9px;background:#fff;color:#1f3b63;font:700 11.5px inherit;cursor:pointer}
.lc2-act button[data-pa="group"],.lc2-act button[data-pa="single"]{background:#2e9e4f;color:#fff}
.lc2-act button:disabled,.lc2-act select:disabled{opacity:.45;cursor:default}
.lc2-act.off button,.lc2-act.off select{background:#fff;color:#94a3b8;border:1px solid var(--line,#dbe2ec)}
.lc2-empty{font-size:11.5px;color:#64748b;border:1px dashed #cbd5e1;border-radius:9px;padding:12px;text-align:center;line-height:1.5}
.lc2-board{display:flex;flex-direction:column;gap:7px}
.lc2-card{border:1px solid var(--line,#dbe2ec);border-left:4px solid #1f3b63;border-radius:9px;padding:7px 7px 6px;background:var(--panel,#fff)}
.lc2-card.lc2-single{border-left-color:#2e9e4f}
.lc2-ch{display:flex;align-items:center;gap:6px}
.lc2-num{flex:none;min-width:26px;height:20px;border-radius:5px;background:#1f3b63;color:#fff;font:800 10.5px/20px inherit;text-align:center}.lc2-single .lc2-num{background:#2e9e4f}
.lc2-tin{flex:1;min-width:0;font:600 12px inherit;padding:4px 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit}.lc2-tin:hover{border-color:var(--line,#dbe2ec)}.lc2-tin:focus{border-color:var(--accent,#1f6feb);background:var(--panel,#fff);outline:0}
.lc2-ord{display:inline-flex}.lc2-ord button{width:20px;height:22px;border:0;background:transparent;color:#64748b;cursor:pointer;font-size:9px;border-radius:4px}.lc2-ord button:hover:not(:disabled){background:#eef2f6}.lc2-ord button:disabled{opacity:.3;cursor:default}
.lc2-x{flex:none;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:#94a3b8;cursor:pointer}.lc2-x:hover{background:#fdeeee;color:#d23b3b}
.lc2-cr{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0 4px}
.lc2-seg{display:inline-flex;border:1px solid var(--line,#dbe2ec);border-radius:6px;overflow:hidden;flex:none}.lc2-seg button{border:0;background:var(--panel,#fff);padding:3px 9px;font:700 11px inherit;cursor:pointer;color:#64748b}.lc2-seg button+button{border-left:1px solid var(--line,#dbe2ec)}.lc2-seg button[aria-pressed="true"]{background:#1f3b63;color:#fff}.lc2-single .lc2-seg button[aria-pressed="true"]{background:#2e9e4f}
.lc2-hd{border:1px solid var(--line,#dbe2ec);border-radius:6px;background:var(--panel,#fff);padding:3px 7px;font:600 11px inherit;color:#334155;cursor:pointer}.lc2-hd[aria-pressed="false"]{color:#94a3b8;background:var(--panel2,#f8fafc)}
.lc2-cs{display:inline-flex;gap:1px;flex-wrap:wrap}.lc2-cs button{padding:1px;border:1px solid transparent;border-radius:5px;background:transparent;cursor:pointer;line-height:0}.lc2-cs button svg{width:24px;height:16px}.lc2-cs button:hover{border-color:#cbd5e1}.lc2-cs button[aria-pressed="true"]{border-color:#2e9e4f;background:#effaf2}
.lc2-chips{display:flex;flex-wrap:wrap;gap:4px;min-height:24px;padding:2px;border-radius:7px}
.lc2-chips em{font-size:11px;color:#94a3b8;font-style:normal;padding:3px}
.lc2-chip{display:inline-flex;align-items:center;gap:2px;padding:2px 3px 2px 8px;border:1px solid #cbd5e1;border-radius:999px;background:var(--panel2,#f8fafc);font-size:11px;font-weight:600;cursor:grab;user-select:none}
.lc2-chip button{border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:10px;padding:0 4px}.lc2-chip button:hover{color:#d23b3b}
.lc2-dragging [data-drop]{outline:1px dashed #94a3b8;outline-offset:1px}
[data-drop].lc2-over{outline:2px solid #2e9e4f!important;background:#effaf2}
.lc2-size{display:flex;align-items:center;gap:4px;margin-top:4px;font-size:10.5px;color:#94a3b8}.lc2-size span{margin-right:2px}.lc2-size b{font-weight:500}.lc2-size input{width:56px;padding:2px 5px;border:1px solid var(--line,#dbe2ec);border-radius:5px;font:600 11px inherit;background:var(--panel,#fff);color:inherit}.lc2-size button{border:1px solid var(--line,#dbe2ec);border-radius:5px;background:var(--panel,#fff);font:600 10.5px inherit;padding:2px 7px;cursor:pointer;color:#334155}.lc2-size em{font-style:normal}
.lc2-pos{display:flex;align-items:center;gap:3px;margin-top:4px;font-size:10.5px;color:#94a3b8}.lc2-pos span{margin-right:2px}
.lc2-pos button{width:22px;height:20px;border:1px solid var(--line,#dbe2ec);border-radius:5px;background:var(--panel,#fff);cursor:pointer;font-size:11px;line-height:1;color:inherit;padding:0}.lc2-pos button[aria-pressed="true"]{background:#2e9e4f;border-color:#2e9e4f;color:#fff}
.lc2-quick{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:8px;font-size:11px;color:#94a3b8}
.lc2-quick button:not(.lc2-lk){border:1px solid var(--line,#dbe2ec);border-radius:6px;background:var(--panel,#fff);padding:4px 8px;font:600 11px inherit;color:#334155;cursor:pointer}.lc2-quick button:not(.lc2-lk):hover{border-color:#2e9e4f}
.lc2-prev{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;padding:10px;border-radius:9px;background:repeating-linear-gradient(0deg,transparent 0 15px,#e9eef4 15px 16px),repeating-linear-gradient(90deg,#f7f9fc 0 15px,#e9eef4 15px 16px);border:1px solid var(--line,#dbe2ec)}
.lc2-pi{display:contents}.lc2-pv{height:auto;max-width:100%;filter:drop-shadow(0 1px 2px rgba(16,33,43,.14))}
.lc2-pv{font-size:12px}.lc2-pv text{font-family:Inter,'Segoe UI',system-ui,sans-serif}
.lc2-pv .lc-h{font-size:1em;font-weight:800}.lc2-pv .lc-st{font-size:.79em;font-weight:800;letter-spacing:.04em}.lc2-pv .lc-k{font-size:.875em}
.lc2-pv .lc-v{font-size:.875em;font-weight:700;font-family:'JetBrains Mono',Consolas,monospace}.lc2-pv .lc-g{font-size:.73em;font-weight:800;letter-spacing:.08em}.lc2-pv .lc-c{font-size:.79em;font-weight:600}
.lc2-pv .lc-tk{font-size:.66em;font-weight:700;letter-spacing:.05em}.lc2-pv .lc-tv{font-size:1.3em;font-weight:700;font-family:'JetBrains Mono',Consolas,monospace}.lc2-pv .lc-kv{font-size:1.6em;font-weight:700;font-family:'JetBrains Mono',Consolas,monospace}.lc2-pv .lc-tu{font-size:.6em;font-weight:500}
.lc2-check{display:flex;align-items:center;gap:7px;font-size:12px;margin:10px 0 2px}.lc2-check input{width:auto}
.lc2-more{margin-top:10px;border-top:1px solid var(--line,#e2e8f0);padding-top:6px}.lc2-more summary{cursor:pointer;font-size:12px;font-weight:700;color:#334155;padding:3px 0}
.lc2-more .lc-des{border-top:0;margin-top:2px;padding-top:0}.lc2-more .lc-dh{display:none}
.lc2-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid var(--line,#e2e8f0);font-size:11.5px;color:#64748b}
#cv .lcard .lc-tk{font-size:.66em;font-weight:700;letter-spacing:.05em}
#cv .lcard .lc-tv{font-size:1.3em;font-weight:700;font-family:'JetBrains Mono',Consolas,monospace}
#cv .lcard .lc-kv{font-size:1.6em;font-weight:700;font-family:'JetBrains Mono',Consolas,monospace}
#cv .lcard .lc-tu{font-size:.6em;font-weight:500;font-family:Inter,'Segoe UI',system-ui,sans-serif}
#cv.design .lcard{cursor:move}
#cv .lcard.lsel .lc-bg{stroke:#2e9e4f;stroke-width:2;stroke-dasharray:5 3}
.lc-pick{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:4px 0 8px}
.lc-opt{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;border:1px solid var(--line,#d4dce3);border-radius:7px;background:#fff;font:600 11px inherit;cursor:pointer;color:inherit}
.lc-opt[aria-pressed="true"]{border-color:#2e9e4f;background:#effaf2;box-shadow:0 0 0 2px rgba(46,158,79,.22)}
.lc-row{display:flex;align-items:center;gap:7px;font-size:12px;margin:4px 0}.lc-row input{width:auto}
.lc-man,.lc-titles{display:flex;flex-direction:column;gap:3px;margin:4px 0;max-height:260px;overflow:auto}.lc-mr{display:flex;align-items:center;gap:6px;font-size:11.5px}.lc-mr span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-side{display:inline-flex;gap:2px;flex:none}.lc-sb{width:24px;height:24px;border:1px solid var(--line,#d4dce3);border-radius:5px;background:#fff;cursor:pointer;font-size:13px;line-height:1;color:inherit}.lc-sb[aria-pressed="true"]{background:#2e9e4f;border-color:#2e9e4f;color:#fff}
.lc-des{border-top:1px dashed var(--line,#d4dce3);margin-top:8px;padding-top:6px}.lc-dh{font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin-bottom:4px}
.lc-l{width:92px;flex:none;color:#475569}.lc-sws{display:flex;flex-wrap:wrap;gap:4px;align-items:center}.lc-sw{width:18px;height:18px;border-radius:4px;border:1px solid rgba(0,0,0,.18);cursor:pointer;padding:0}.lc-sw[aria-pressed="true"]{outline:2px solid #2e9e4f;outline-offset:1px}
.lc-sws input[type=color]{width:24px;height:20px;padding:0;border:1px solid #d4dce3;border-radius:4px;background:#fff;cursor:pointer}
.lc-seg{display:inline-flex;border:1px solid var(--line,#d4dce3);border-radius:6px;overflow:hidden}.lc-seg button{border:0;background:#fff;padding:3px 8px;font:600 11px inherit;cursor:pointer;color:inherit}.lc-seg button+button{border-left:1px solid var(--line,#d4dce3)}.lc-seg button[aria-pressed="true"]{background:#1f3b63;color:#fff}
.lc-sel{font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--line,#d4dce3);border-radius:6px;background:#fff;color:inherit}
</style>`
);

/* ===================== make cards straight on the canvas =====================
   · click a reading label (Ctrl/⌘-click for more) → toolbar: Make card · Add to card
   · click a card → toolbar: style, header colour, rename, add / remove readings, split by group, back to labels */
const lblKey = (b, t) => b + '|' + t;
function lblSelTags() {
  return [...LBL_SELT].map(k => k.split('|')).filter(([bid, tid]) => B(bid) && B(bid).tags.some(t => t.id === tid));
}
/* make sure a machine works in "I choose" mode, keeping every reading where it is */
function lblManual(b) {
  if (b.props.lblSplit === 'manual') return;
  const wasCard = lblIsCard(b);
  b.props.lblSplit = 'manual';
  b.tags.forEach(t => (t.card = wasCard ? t.card || 1 : 0));
  if (lblStyle(b) === 'classic') b.props.lblStyle = 'table';
}
function lblNextCard(b) {
  return Math.max(0, ...b.tags.map(t => t.card || 0)) + 1;
}
function lblMakeCard() {
  const sel = lblSelTags();
  if (!sel.length) return;
  const bid = sel[0][0];
  const b = B(bid);
  pushUndo();
  const wasClassic = !lblIsCard(b);
  /* where the first picked label is now → the card goes there */
  const el = document.querySelector(`#Ltags .tagb[data-tb="${bid}"][data-tag="${CSS.escape(sel[0][1])}"]`);
  let at = null;
  if (el) {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.getAttribute('transform') || '');
    const pm = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.parentNode.getAttribute('transform') || '');
    if (m && pm) {
      const A = tagAnchor(b);
      at = { x: Math.round(+pm[1] + +m[1] - A.x), y: Math.round(+pm[2] + +m[2] - A.y) };
    }
  }
  lblManual(b);
  if (wasClassic) b.tags.forEach(t => (t.card = 0));
  const n = lblNextCard(b);
  sel.forEach(([obid, tid]) => {
    if (obid === bid) b.tags.find(t => t.id === tid).card = n;
    else {
      /* a reading of another machine: it moves into this card and leaves its own machine's labels */
      const ot = B(obid).tags.find(t => t.id === tid);
      ot.cardOf = bid + ':' + n;
      const X = (b.props.lblExtra = b.props.lblExtra || {});
      (X['c' + n] = X['c' + n] || []).includes(tid) || X['c' + n].push(tid);
    }
  });
  const groups = [...new Set(sel.map(([, tid]) => lblGroupOf((REG[tid].short || tid) + ' ' + tid)))];
  (b.props.lblTitles = b.props.lblTitles || {})['c' + n] = groups.length === 1 && groups[0] !== 'Other' ? `${b.name} · ${groups[0]}` : `${b.name} · card ${n}`;
  if (at) (b.props.lblPos = b.props.lblPos || {})['c' + n] = at;
  LBL_SELT.clear();
  LBL_CSEL = { b: bid, key: 'c' + n };
  changed();
  renderCanvas();
  lblBar();
  toast(`Card made from ${sel.length} reading${sel.length > 1 ? 's' : ''} — drag it anywhere`);
}
function lblAddToCard(n) {
  const sel = lblSelTags();
  if (!sel.length) return;
  const b = B(sel[0][0]);
  pushUndo();
  lblManual(b);
  sel.forEach(([obid, tid]) => {
    if (obid === b.id) b.tags.find(t => t.id === tid).card = n;
    else {
      B(obid).tags.find(t => t.id === tid).cardOf = b.id + ':' + n;
      const X = (b.props.lblExtra = b.props.lblExtra || {});
      (X['c' + n] = X['c' + n] || []).includes(tid) || X['c' + n].push(tid);
    }
  });
  LBL_SELT.clear();
  LBL_CSEL = { b: b.id, key: 'c' + n };
  changed();
  renderCanvas();
  lblBar();
}
function lblCardOp(op, arg) {
  if (!LBL_CSEL) return;
  const b = B(LBL_CSEL.b);
  if (!b) return;
  pushUndo();
  lblManual(b);
  const key = LBL_CSEL.key,
    n = +String(key).replace(/^c/, '') || 1;
  const inCard = t => (t.card || 0) === n;
  const cd = () => ((b.props.lblCardD = b.props.lblCardD || {})[key] = (b.props.lblCardD || {})[key] || {});
  if (op === 'style') cd().sty = arg;
  if (op === 'hd') cd().hd = arg;
  if (op === 'add') {
    const t = b.tags.find(q => q.id === arg);
    if (t) lblJoin(b, t, n);
  }
  const freeExt = id => {
    const X = b.props.lblExtra || {};
    if (X['c' + n]) X['c' + n] = X['c' + n].filter(z => z !== id);
    DOC.blocks.forEach(o => (o.tags || []).forEach(t => t.id === id && t.cardOf === b.id + ':' + n && delete t.cardOf));
  };
  if (op === 'remove') {
    const own = b.tags.find(t => t.id === arg);
    if (own) lblLeave(b, own, n);
    else freeExt(arg);
  }
  if (op === 'title') (b.props.lblTitles = b.props.lblTitles || {})['c' + n] = arg;
  if (op === 'ungroup') {
    b.tags.filter(inCard).forEach(t => lblLeave(b, t, n));
    ((b.props.lblExtra || {})['c' + n] || []).slice().forEach(freeExt);
    LBL_CSEL = null;
  }
  if (op === 'split') {
    const rows = b.tags.filter(inCard);
    const G = new Map();
    rows.forEach(t => {
      const g = lblGroupOf((REG[t.id]?.short || t.id) + ' ' + t.id);
      (G.get(g) || G.set(g, []).get(g)).push(t);
    });
    let first = true;
    [...G.entries()].forEach(([g, ts]) => {
      const m = first ? n : lblNextCard(b);
      ts.forEach(t => (t.card = m));
      (b.props.lblTitles = b.props.lblTitles || {})['c' + m] = `${b.name} · ${g}`;
      first = false;
    });
    delete b.props.lblPos;
  }
  if (op === 'all') b.tags.forEach(t => (t.card = n));
  if (op === 'autosize' && b.props.lblSize) delete b.props.lblSize[key];
  changed();
  renderCanvas();
  renderProps();
  lblBar();
}
/* act on readings picked inside a card */
function lblRows(op, to) {
  const b = B(LBL_CSEL.b);
  if (!b) return;
  pushUndo();
  lblManual(b);
  const from = +String(LBL_CSEL.key).replace(/^c/, '') || 1;
  const n = op === 'new' ? lblNextCard(b) : op === 'to' ? to : 0;
  [...LBL_CROW].forEach(id => {
    const own = b.tags.find(t => t.id === id);
    if (own) {
      lblLeave(b, own, from);
      if (n) lblJoin(b, own, n);
    } else {
      const X = (b.props.lblExtra = b.props.lblExtra || {});
      X['c' + from] = (X['c' + from] || []).filter(z => z !== id);
      if (n) (X['c' + n] = X['c' + n] || []).push(id);
      else DOC.blocks.forEach(o => (o.tags || []).forEach(t => t.id === id && delete t.cardOf));
    }
  });
  if (op === 'new') {
    (b.props.lblTitles = b.props.lblTitles || {})['c' + n] = `${b.name} · card ${n}`;
    const p = (b.props.lblPos || {})['c' + from];
    if (p) b.props.lblPos['c' + n] = { x: p.x + 250, y: p.y };
  }
  LBL_CROW.clear();
  LBL_CSEL = n ? { b: b.id, key: 'c' + n } : null;
  changed();
  renderCanvas();
  renderProps();
  lblBar();
}
/* floating toolbar */
function lblBar() {
  let bar = document.getElementById('lcBar');
  if (!bar) {
    document.body.insertAdjacentHTML('beforeend', '<div id="lcBar" class="lc-bar" role="toolbar" aria-label="Data label card" hidden></div>');
    bar = document.getElementById('lcBar');
    bar.addEventListener('pointerdown', e => e.stopPropagation());
  }
  const hide = () => (bar.hidden = true);
  /* v9.77 — cards are controlled only from Properties › Data label cards (no floating toolbar on the canvas) */
  return hide();
  const selT = lblSelTags();
  let target = null,
    html = '';
  if (selT.length) {
    const b = B(selT[0][0]);
    target = document.querySelector(`#Ltags .tagb[data-tb="${selT[0][0]}"][data-tag="${CSS.escape(selT[0][1])}"]`);
    const cards = lblIsCard(b) ? lblCards(b).filter(c => /^c\d+$/.test(c.key)) : [];
    html = `<span class="lc-bt">${selT.length} reading${selT.length > 1 ? 's' : ''} selected</span>
      <button type="button" class="lc-bb pri" data-lb="make">▣ Make card</button>
      ${cards.length ? `<select class="lc-bs" data-lb="addto" aria-label="Add to card"><option value="">Add to card…</option>${cards.map(c => `<option value="${c.key.slice(1)}">${esc(c.title)}</option>`).join('')}</select>` : ''}
      <span class="lc-bt note">Ctrl/⌘-click to pick more</span>
      <button type="button" class="lc-bx" data-lb="clr" aria-label="Clear selection">✕</button>`;
  } else if (LBL_CSEL && B(LBL_CSEL.b) && LBL_CROW.size) {
    const b = B(LBL_CSEL.b);
    target = document.querySelector(`#Ltags .lcard[data-tg="${b.id}"][data-lc="${CSS.escape(LBL_CSEL.key)}"]`);
    const cards = lblCards(b).filter(c => /^c\d+$/.test(c.key) && c.key !== LBL_CSEL.key);
    html = `<span class="lc-bt">${LBL_CROW.size} reading${LBL_CROW.size > 1 ? 's' : ''} picked in the card</span>
      <button type="button" class="lc-bb pri" data-lb="rnew">▣ Move to a new card</button>
      ${cards.length ? `<select class="lc-bs" data-lb="rto" aria-label="Move to card"><option value="">Move to card…</option>${cards.map(c => `<option value="${c.key.slice(1)}">${esc(c.title)}</option>`).join('')}</select>` : ''}
      <button type="button" class="lc-bb" data-lb="rlab">Back to labels</button>
      ${LBL_CROW.size === 1 ? '<button type="button" class="lc-bb" data-lb="rtrend">Trend</button>' : ''}
      <span class="lc-bt note">Ctrl/⌘-click to pick more</span>
      <button type="button" class="lc-bx" data-lb="rclr" aria-label="Clear">✕</button>`;
  } else if (LBL_CSEL && B(LBL_CSEL.b)) {
    const b = B(LBL_CSEL.b);
    target = document.querySelector(`#Ltags .lcard[data-tg="${b.id}"][data-lc="${CSS.escape(LBL_CSEL.key)}"]`);
    if (!target) return hide();
    const c = lblCards(b).find(k => k.key === LBL_CSEL.key) || { rows: [], title: '' },
      n = +String(LBL_CSEL.key).replace(/^c/, '') || 1;
    const others = b.tags.filter(t => t.show && REG[t.id] && !c.rows.includes(t));
    const CD = (b.props.lblCardD || {})[LBL_CSEL.key] || {};
    const D = Object.assign({}, DOC.lblDesign || {}, b.props.lblDesign || {}, CD);
    const hd = D.hd || (CD.sty || lblStyle(b)) === 'group' ? D.hd || '#1f3b63' : '#f3f6f9';
    const ic = { table: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2" width="13" height="12" rx="2" fill="none" stroke="currentColor"/><path d="M1.5 5.5h13M4 8.5h5M4 11h5M11 8.5h1.5M11 11h1.5" stroke="currentColor"/></svg>', group: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2" width="13" height="12" rx="2" fill="none" stroke="currentColor"/><path d="M1.5 5.5h13" stroke="currentColor"/><path d="M4 8h3M4 11.5h3" stroke="currentColor" stroke-width="1.8"/></svg>', hmi: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2" width="13" height="12" rx="2" fill="currentColor"/><path d="M4 7h4M4 10h4" stroke="#7fe0ff"/></svg>' };
    html = `<input class="lc-bi" data-lb="title" value="${esc(c.title)}" aria-label="Card title" title="Card title — type to rename">
      <i class="lc-dv"></i>
      <span class="lc-seg" role="group" aria-label="Style">${[['table', 'Table'], ['group', 'Grouped'], ['hmi', 'Dark']].map(([k, t]) => `<button type="button" data-lb="style|${k}" aria-pressed="${(CD.sty || lblStyle(b)) === k}" title="${t}">${ic[k]}<span>${t}</span></button>`).join('')}</span>
      <i class="lc-dv"></i>
      <span class="lc-cw"><button type="button" class="lc-cb" id="lcCB" title="Header colour" aria-haspopup="true"><i style="background:${hd}"></i>Colour ▾</button>
       <span class="lc-pop" id="lcPop" hidden>${['#1f3b63', '#37474f', '#2e7d32', '#5e9e2a', '#00796b', '#1565c0', '#6a1b9a', '#c62828', '#d48a00', '#f3f6f9'].map(h => `<button type="button" class="lc-sw" data-lb="hd|${h}" style="background:${h}" aria-pressed="${D.hd === h}" title="${h}"></button>`).join('')}<label class="lc-any" title="Any colour"><input type="color" id="lcAny" value="${D.hd || '#1f3b63'}">Any</label></span></span>
      ${others.length ? `<i class="lc-dv"></i><select class="lc-bs" data-lb="add" aria-label="Add reading"><option value="">＋ Add reading</option>${others.map(t => `<option value="${esc(t.id)}">${esc(REG[t.id].short || t.id.split('.').pop())}</option>`).join('')}</select>` : ''}
      <button type="button" class="lc-bx" data-lb="close" aria-label="Close" title="Close">✕</button>`;
  }
  if (!target || !html) return hide();
  bar.innerHTML = html;
  bar.hidden = false;
  const r = target.getBoundingClientRect(),
    bw = bar.offsetWidth;
  bar.style.left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left)) + 'px';
  bar.style.top = Math.max(8, r.top - bar.offsetHeight - 8) + 'px';
  const cb = bar.querySelector('#lcCB'),
    pop = bar.querySelector('#lcPop');
  if (cb) cb.onclick = () => (pop.hidden = !pop.hidden);
  const any = bar.querySelector('#lcAny');
  if (any) any.onchange = () => lblCardOp('hd', any.value);
  bar.querySelectorAll('[data-lb]').forEach(el => {
    const [k, v] = el.dataset.lb.split('|');
    if (el.tagName === 'SELECT')
      el.onchange = () => {
        if (!el.value) return;
        if (k === 'addto') lblAddToCard(+el.value);
        else if (k === 'rto') lblRows('to', +el.value);
        else lblCardOp(k, el.value);
      };
    else if (el.tagName === 'INPUT') el.onchange = () => lblCardOp('title', el.value.trim());
    else
      el.onclick = () => {
        if (k === 'make') lblMakeCard();
        else if (k === 'rnew') lblRows('new');
        else if (k === 'rlab') lblRows('label');
        else if (k === 'rtrend') openTrend([...LBL_CROW][0]);
        else if (k === 'rclr') (LBL_CROW.clear(), renderCanvas(), lblBar());
        else if (k === 'clr') (LBL_SELT.clear(), lblMark(), lblBar());
        else if (k === 'close') ((LBL_CSEL = null), renderCanvas(), lblBar());
        else lblCardOp(k, v);
      };
  });
}
/* show which normal labels are picked */
function lblMark() {
  document.querySelectorAll('#Ltags .tagb.lpick').forEach(e => e.classList.remove('lpick'));
  LBL_SELT.forEach(k => {
    const [bid, tid] = k.split('|');
    const e = document.querySelector(`#Ltags .tagb[data-tb="${bid}"][data-tag="${CSS.escape(tid)}"]`);
    if (e) e.classList.add('lpick');
  });
}
document.addEventListener(
  'pointerdown',
  e => {
    if (MODE !== 'design' || e.button !== 0) return;
    const tb = e.target.closest && e.target.closest('#cv .tagb');
    if (tb) {
      const k = lblKey(tb.dataset.tb, tb.dataset.tag);
      LBL_CSEL = null;
      if (e.ctrlKey || e.metaKey) {
        e.stopPropagation();
        e.preventDefault();
        LBL_SELT.has(k) ? LBL_SELT.delete(k) : LBL_SELT.add(k);
      } else if (!LBL_SELT.has(k)) {
        LBL_SELT.clear();
        LBL_SELT.add(k);
      }
      setTimeout(() => (lblMark(), lblBar()), 0);
      return;
    }
    if (!e.target.closest || e.target.closest('#cv .lcard') || e.target.closest('#lcBar')) return;
    if (e.target.closest('#cv') && (LBL_SELT.size || LBL_CSEL)) {
      LBL_SELT.clear();
      const had = LBL_CSEL;
      LBL_CSEL = null;
      setTimeout(() => {
        if (had) renderCanvas();
        lblMark();
        lblBar();
      }, 0);
    }
  },
  true
);
{
  const _ap = applyView;
  applyView = function () {
    _ap.apply(this, arguments);
    const bar = document.getElementById('lcBar');
    if (bar && !bar.hidden) requestAnimationFrame(lblBar);
  };
  const _rc = renderCanvas;
  renderCanvas = function () {
    _rc.apply(this, arguments);
    lblMark();
  };
}
/* hint in the Readings list: how to make a card */
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="lcBarCss">
.lc-bar{position:fixed;z-index:9000;display:flex;align-items:center;gap:6px;flex-wrap:wrap;max-width:min(760px,calc(100vw - 16px));background:#fff;border:1px solid #cfd8e0;border-radius:10px;padding:6px 8px;box-shadow:0 10px 28px rgba(16,33,43,.22);font:500 12px Inter,'Segoe UI',system-ui,sans-serif;color:#16212b}
.lc-bar[hidden]{display:none}.lc-bt{font-weight:700;white-space:nowrap}.lc-bt.note{font-weight:400;color:#64748b}
.lc-bb{border:1px solid #cfd8e0;background:#fff;border-radius:7px;padding:5px 10px;font:600 12px inherit;cursor:pointer;color:inherit;white-space:nowrap}.lc-bb.pri{background:#2e9e4f;border-color:#2e9e4f;color:#fff}
.lc-bb:hover{background:#f3f6f9}.lc-bb.pri:hover{background:#278a44}
.lc-bs{color-scheme:light;border:1px solid #cfd8e0;border-radius:7px;padding:4px 6px;font:500 12px inherit;background:#fff;color:inherit;max-width:170px}
.lc-bi{background:#fff;border:1px solid #cfd8e0;border-radius:7px;padding:4px 8px;font:600 12px inherit;width:170px;color:inherit}
.lc-bx{border:0;background:none;font-size:14px;cursor:pointer;color:#64748b;padding:2px 6px}
#cv .tagb.lpick rect.bg{stroke:#2e9e4f;stroke-width:2.2}#cv .tagb.lpick{filter:drop-shadow(0 0 4px rgba(46,158,79,.55))}
#cv.design .lcard.lcsel .lc-row{cursor:pointer}#cv.design .lcard.lcsel .lc-row:hover .lc-hit{fill:rgba(31,59,99,.07)}
#cv .lcard.lcsel .lc-bg{stroke:#2e9e4f;stroke-width:2.5}#cv .lcard.lcsel{filter:drop-shadow(0 0 6px rgba(46,158,79,.5))}
</style>`
);

/* resize a card from any edge or corner */
document.addEventListener(
  'pointerdown',
  e => {
    const h = e.target.closest && e.target.closest('#cv .lcard [data-rs]');
    if (!h || MODE !== 'design' || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const g = h.closest('.lcard'),
      b = B(g.dataset.tg),
      key = g.dataset.lc,
      dir = h.dataset.rs;
    const bg = g.querySelector('.lc-bg'),
      W0 = +bg.getAttribute('width'),
      H0 = +bg.getAttribute('height');
    const A = tagAnchor(b);
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform'));
    const P0 = { x: +m[1] - A.x, y: +m[2] - A.y };
    const sc = (g.getScreenCTM() || { a: 1 }).a,
      x0 = e.clientX,
      y0 = e.clientY;
    let moved = false,
      raf = 0;
    const mv = ev => {
      const dx = (ev.clientX - x0) / sc,
        dy = (ev.clientY - y0) / sc;
      if (!moved && Math.hypot(dx, dy) < 2) return;
      if (!moved) {
        pushUndo();
        moved = true;
      }
      let w = W0,
        hh = H0,
        px = P0.x,
        py = P0.y;
      if (dir.includes('e')) w = W0 + dx;
      if (dir.includes('w')) (w = W0 - dx), (px = P0.x + dx);
      if (dir.includes('s')) hh = H0 + dy;
      if (dir.includes('n')) (hh = H0 - dy), (py = P0.y + dy);
      w = Math.max(140, Math.round(w));
      hh = Math.max(50, Math.round(hh));
      if (dir.includes('w')) px = P0.x + (W0 - w);
      if (dir.includes('n')) py = P0.y + (H0 - hh);
      (b.props.lblSize = b.props.lblSize || {})[key] = { w, h: dir === 'e' || dir === 'w' ? (b.props.lblSize[key] || {}).h || null : hh };
      if (dir === 'e' || dir === 'w') b.props.lblSize[key].h = (b.props.lblSize[key] && b.props.lblSize[key].h) || null;
      (b.props.lblPos = b.props.lblPos || {})[key] = { x: Math.round(px), y: Math.round(py) };
      if (b.props.lblSide) delete b.props.lblSide[key];
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => tagSoon(b));
    };
    const up = () => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
      if (moved) {
        changed();
        renderCanvas();
        lblBar();
      }
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  },
  true
);
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="lcRsCss">#cv .lcard .lc-rs{fill:#fff;stroke:#2e9e4f;stroke-width:1.5}
#cv .lcard .lc-rs-n,#cv .lcard .lc-rs-s{cursor:ns-resize}#cv .lcard .lc-rs-e,#cv .lcard .lc-rs-w{cursor:ew-resize}
#cv .lcard .lc-rs-nw,#cv .lcard .lc-rs-se{cursor:nwse-resize}#cv .lcard .lc-rs-ne,#cv .lcard .lc-rs-sw{cursor:nesw-resize}</style>`
);

/* ===================== v9.70 — easier card handling =====================
   · right-click menu on any label or card (Make card, Move, Back to labels, Style, Colour, Size, Delete card…)
   · toolbar trimmed to one line; the rest lives in the ⋯ menu
   · new cards go to the nearest free spot next to the machine
   · Undo button on every card change · one-time hint · names taken from the readings */
function lblUndoToast(msg) {
  let t = document.getElementById('lcToast');
  if (!t) {
    document.body.insertAdjacentHTML('beforeend', '<div id="lcToast" class="lc-toast" role="status"></div>');
    t = document.getElementById('lcToast');
  }
  t.innerHTML = `<span>${esc(msg)}</span><button type="button">Undo</button>`;
  t.classList.add('on');
  t.querySelector('button').onclick = () => {
    undo();
    LBL_CSEL = null;
    LBL_CROW.clear();
    LBL_SELT.clear();
    renderCanvas();
    renderProps();
    lblBar();
    t.classList.remove('on');
  };
  clearTimeout(lblUndoToast.h);
  lblUndoToast.h = setTimeout(() => t.classList.remove('on'), 6000);
}
/* the name of a card from what is in it */
function lblAutoTitle(b, ids) {
  const gs = [...new Set(ids.map(id => lblGroupOf(((REG[id] && REG[id].short) || id) + ' ' + id)))];
  if (gs.length === 1 && gs[0] !== 'Other') return `${b.name} · ${gs[0]}`;
  if (ids.length === 1) return `${b.name} · ${(REG[ids[0]] && REG[ids[0]].short) || ids[0].split('.').pop()}`;
  return `${b.name} · ${gs.filter(g => g !== 'Other').join(' & ') || 'Readings'}`;
}
/* a free spot for a new card: right, below, left, above the machine, then further out */
function lblFreeSpot(b, key) {
  const A = tagAnchor(b),
    { W, H } = dims(b);
  const c = lblCards(b).find(k => k.key === key);
  if (!c) return null;
  const body = lblCardSVG(b, c.rows, c.title, c.lamps, (b.props.lblSize || {})[key], key);
  const cw = +(body.match(/class="lc-bg" x="0" y="0" width="([\d.]+)"/) || [0, 236])[1],
    ch = lcH(body);
  const taken = [];
  document.querySelectorAll('#Ltags .lcard, #Ltags .tagg:not(.lcard), #Lblocks .blk').forEach(g => {
    if (g.dataset.lc === key && g.dataset.tg === b.id) return;
    try {
      const bb = g.getBBox(),
        m = g.getCTM(),
        root = document.getElementById('cv').getCTM ? g.ownerSVGElement.getScreenCTM().inverse().multiply(g.getScreenCTM()) : m;
      const x = root.e + bb.x * root.a,
        y = root.f + bb.y * root.d;
      taken.push([x - 6, y - 6, x + bb.width * root.a + 6, y + bb.height * root.d + 6]);
    } catch (e) {}
  });
  /* world → canvas-layer coordinates: tags layer shares the world transform, so compare in that space */
  const layer = document.getElementById('Ltags'),
    LM = layer && layer.getCTM && layer.ownerSVGElement.getScreenCTM().inverse().multiply(layer.getScreenCTM());
  const toL = (x, y) => (LM ? [LM.e + x * LM.a, LM.f + y * LM.d] : [x, y]);
  const k = LM ? LM.a : 1;
  const hit = (x, y) => {
    const [sx, sy] = toL(x, y),
      r = [sx, sy, sx + cw * k, sy + ch * k];
    return taken.some(t => !(r[2] < t[0] || r[0] > t[2] || r[3] < t[1] || r[1] > t[3]));
  };
  const G = 12;
  for (let ring = 0; ring < 6; ring++) {
    const d = ring * (ch + G);
    const cand = [
      [b.x + W + G + ring * (cw + G), b.y],
      [b.x, b.y + H + G + d],
      [b.x - cw - G - ring * (cw + G), b.y],
      [b.x, b.y - ch - G - d],
      [b.x + W + G + ring * (cw + G), b.y + H / 2],
      [b.x - cw - G - ring * (cw + G), b.y + H / 2]
    ];
    for (const [x, y] of cand) if (!hit(x, y)) return { x: Math.round(x - A.x), y: Math.round(y - A.y) };
  }
  return null;
}
{
  /* auto names and free spots for new cards; Undo after every change */
  const _make = lblMakeCard;
  lblMakeCard = function () {
    const before = lblSelTags();
    _make();
    if (!LBL_CSEL || !before.length) return;
    const b = B(LBL_CSEL.b),
      n = LBL_CSEL.key.slice(1);
    (b.props.lblTitles = b.props.lblTitles || {})['c' + n] = lblAutoTitle(b, before.map(s => s[1]));
    renderCanvas();
    const p = lblFreeSpot(b, LBL_CSEL.key);
    if (p) (b.props.lblPos = b.props.lblPos || {})[LBL_CSEL.key] = p;
    renderCanvas();
    lblBar();
    lblUndoToast(`Card “${b.props.lblTitles['c' + n]}” made`);
  };
  const _rows = lblRows;
  lblRows = function (op, to) {
    const ids = [...LBL_CROW],
      b = B(LBL_CSEL.b);
    _rows(op, to);
    if (op === 'new' && LBL_CSEL) {
      const n = LBL_CSEL.key.slice(1);
      b.props.lblTitles['c' + n] = lblAutoTitle(b, ids);
      if (b.props.lblPos) delete b.props.lblPos['c' + n];
      renderCanvas();
      const p = lblFreeSpot(b, LBL_CSEL.key);
      if (p) (b.props.lblPos = b.props.lblPos || {})[LBL_CSEL.key] = p;
      renderCanvas();
      lblBar();
    }
    lblUndoToast(op === 'new' ? 'Moved to a new card' : op === 'to' ? 'Moved to the card' : 'Back to labels');
  };
  const _op = lblCardOp;
  lblCardOp = function (op, arg) {
    _op(op, arg);
    const msg = { ungroup: 'Card turned back into labels', split: 'Card split by group', remove: 'Reading taken out of the card', add: 'Reading added', autosize: 'Card back to its own size' }[op];
    if (msg) lblUndoToast(msg);
  };
}
/* one-line toolbar for a card: title · style · colour · ⋯ (everything else is in the menu) */
{
  const _bar = lblBar;
  lblBar = function () {
    _bar();
    const bar = document.getElementById('lcBar');
    if (!bar || bar.hidden || !LBL_CSEL || LBL_CROW.size || LBL_SELT.size) return;
    bar.querySelectorAll('[data-lb="remove"],[data-lb="split"],[data-lb="autosize"],[data-lb="ungroup"]').forEach(e => e.remove());
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'lc-bb';
    more.textContent = '⋯';
    more.title = 'More options (also on right-click)';
    more.className = 'lc-bb lc-ic';
    more.onclick = ev => {
      const r = more.getBoundingClientRect();
      lblMenu(r.left, r.bottom + 4, { card: LBL_CSEL });
    };
    bar.insertBefore(more, bar.querySelector('.lc-bx'));

  };
}
/* right-click menu */
function lblMenu(x, y, ctx) {
  let m = document.getElementById('lcMenu');
  if (!m) {
    document.body.insertAdjacentHTML('beforeend', '<div id="lcMenu" class="lc-menu" role="menu" hidden></div>');
    m = document.getElementById('lcMenu');
    m.addEventListener('pointerdown', e => e.stopPropagation());
    document.addEventListener('pointerdown', () => (m.hidden = true));
    document.addEventListener('keydown', e => e.key === 'Escape' && (m.hidden = true));
  }
  const it = [];
  const sep = () => it.push('<div class="lc-ms"></div>');
  const add = (t, f, dis) => it.push({ t, f, dis });
  if (ctx.tags) {
    const sel = lblSelTags();
    const b = B(sel[0][0]);
    const cards = lblIsCard(b) ? lblCards(b).filter(c => /^c\d+$/.test(c.key)) : [];
    add(`▣ Make card from ${sel.length} reading${sel.length > 1 ? 's' : ''}`, () => lblMakeCard());
    cards.forEach(c => add(`Add to “${c.title}”`, () => (lblAddToCard(+c.key.slice(1)), lblUndoToast('Added to the card'))));
    sep();
    add('Pick all readings of this machine', () => {
      b.tags.filter(t => t.show && REG[t.id] && !(lblIsCard(b) && t.card !== 0)).forEach(t => LBL_SELT.add(lblKey(b.id, t.id)));
      lblMark();
      lblBar();
    });
    if (sel.length === 1) add('Open trend', () => openTrend(sel[0][1]));
  } else if (ctx.rows) {
    const b = B(LBL_CSEL.b),
      cards = lblCards(b).filter(c => /^c\d+$/.test(c.key) && c.key !== LBL_CSEL.key);
    add(`▣ Move ${LBL_CROW.size} to a new card`, () => lblRows('new'));
    cards.forEach(c => add(`Move to “${c.title}”`, () => lblRows('to', +c.key.slice(1))));
    add('Back to labels', () => lblRows('label'));
    if (LBL_CROW.size === 1) (sep(), add('Open trend', () => openTrend([...LBL_CROW][0])));
  } else if (ctx.card) {
    const b = B(ctx.card.b),
      key = ctx.card.key,
      CD = (b.props.lblCardD || {})[key] || {};
    const c = lblCards(b).find(k => k.key === key) || { rows: [] };
    add('Rename…', () => {
      lblBar();
      const i = document.querySelector('#lcBar .lc-bi');
      if (i) (i.focus(), i.select());
    });
    sep();
    [['table', 'Table'], ['group', 'Grouped'], ['hmi', 'Dark']].forEach(([k, t]) => add(`${(CD.sty || lblStyle(b)) === k ? '● ' : ''}Style: ${t}`, () => lblCardOp('style', k)));
    sep();
    if (c.rows.length > 3) add('Split by group', () => lblCardOp('split'));
    if ((b.props.lblSize || {})[key]) add('Auto size', () => lblCardOp('autosize'));
    add('Move to a free spot', () => {
      pushUndo();
      if (b.props.lblPos) delete b.props.lblPos[key];
      renderCanvas();
      const p = lblFreeSpot(b, key);
      if (p) (b.props.lblPos = b.props.lblPos || {})[key] = p;
      changed();
      renderCanvas();
      lblBar();
      lblUndoToast('Card moved to a free spot');
    });
    add('Copy this design to all cards', () => {
      pushUndo();
      const D = (b.props.lblCardD || {})[key] || {};
      DOC.blocks.forEach(o => o.props && o.props.lblCardD && Object.keys(o.props.lblCardD).forEach(k => Object.assign(o.props.lblCardD[k], D)));
      DOC.lblDesign = Object.assign({}, DOC.lblDesign || {}, D);
      changed();
      renderCanvas();
      lblUndoToast('Design copied to every card');
    });
    sep();
    add('Back to labels', () => lblCardOp('ungroup'));
  }
  if (!it.length) return;
  m.innerHTML = it.map((o, i) => (typeof o === 'string' ? o : `<button type="button" role="menuitem" data-mi="${i}" ${o.dis ? 'disabled' : ''}>${esc(o.t)}</button>`)).join('');
  m.querySelectorAll('[data-mi]').forEach(btn => (btn.onclick = () => ((m.hidden = true), it[+btn.dataset.mi].f())));
  m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
}
document.addEventListener(
  'contextmenu',
  e => {
    if (MODE !== 'design' || !e.target.closest) return;
    const g = e.target.closest('#cv .lcard'),
      tb = e.target.closest('#cv .tagb');
    if (!g && !tb) return;
    e.preventDefault();
    e.stopPropagation();
    /* v9.77 — no menu on the canvas: right-click opens the card settings in Properties */
    return lblOpenProps(tb ? tb.dataset.tb : g.dataset.tg, tb ? null : g.dataset.lc);
    if (tb) {
      const k = lblKey(tb.dataset.tb, tb.dataset.tag);
      if (!LBL_SELT.has(k)) (LBL_SELT.clear(), LBL_SELT.add(k));
      LBL_CSEL = null;
      lblMark();
      lblBar();
      return lblMenu(e.clientX, e.clientY, { tags: true });
    }
    const row = e.target.closest('[data-row]');
    const same = LBL_CSEL && LBL_CSEL.b === g.dataset.tg && LBL_CSEL.key === g.dataset.lc;
    if (!same) LBL_CROW.clear();
    LBL_CSEL = { b: g.dataset.tg, key: g.dataset.lc };
    LBL_SELT.clear();
    if (row && same) {
      if (!LBL_CROW.has(row.dataset.row)) (LBL_CROW.clear(), LBL_CROW.add(row.dataset.row));
      renderCanvas();
      lblBar();
      return lblMenu(e.clientX, e.clientY, { rows: true });
    }
    renderCanvas();
    lblBar();
    lblMenu(e.clientX, e.clientY, { card: LBL_CSEL });
  },
  true
);
/* one-time hint the first time a label is clicked in Design mode */
document.addEventListener(
  'pointerdown',
  e => {
    if (MODE !== 'design' || !e.target.closest || !e.target.closest('#cv .tagb, #cv .lcard')) return;
    let seen = false;
    try {
      seen = localStorage.getItem('lcHint') === '1';
    } catch (er) {}
    if (seen) return;
    try {
      localStorage.setItem('lcHint', '1');
    } catch (er) {}
    setTimeout(() => toast('Tip: set up data label cards in Properties › Card design'), 300);
  },
  true
);
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="lcV70">
.lc-bar{flex-wrap:nowrap;overflow-x:auto}.lc-bar .lc-sws{flex-wrap:nowrap}.lc-bar .lc-sw{width:16px;height:16px;flex:none}.lc-bar .lc-bi{width:150px}
.lc-menu{position:fixed;z-index:9100;min-width:220px;background:#fff;border:1px solid #cfd8e0;border-radius:9px;box-shadow:0 12px 30px rgba(16,33,43,.22);padding:5px;font:500 12.5px Inter,'Segoe UI',system-ui,sans-serif;color:#16212b;color-scheme:light}
.lc-menu[hidden]{display:none}.lc-menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:6px 10px;border-radius:6px;font:inherit;color:inherit;cursor:pointer}
.lc-menu button:hover{background:#eef3f8}.lc-menu button:disabled{opacity:.45}.lc-ms{height:1px;background:#e3e8ec;margin:4px 6px}
.lc-toast{position:fixed;left:50%;bottom:56px;transform:translate(-50%,20px);opacity:0;pointer-events:none;z-index:9200;display:flex;gap:14px;align-items:center;background:#16212b;color:#fff;border-radius:9px;padding:9px 12px 9px 16px;font:500 13px Inter,'Segoe UI',system-ui,sans-serif;box-shadow:0 10px 26px rgba(0,0,0,.3);transition:.18s}
.lc-toast.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}.lc-toast button{border:0;background:#2e9e4f;color:#fff;font:700 12.5px inherit;border-radius:6px;padding:5px 12px;cursor:pointer}
</style>`
);

document.head.insertAdjacentHTML('beforeend', `<style id="lcPolish">
.lc-bar{gap:4px;padding:5px;border-radius:12px;border-color:#d9e1e8;box-shadow:0 8px 24px rgba(16,33,43,.16),0 1px 2px rgba(16,33,43,.08);overflow:visible;flex-wrap:nowrap;align-items:center}
.lc-bar .lc-dv{width:1px;height:22px;background:#e3e8ec;margin:0 3px;flex:none}
.lc-bar .lc-bi{height:30px;border:1px solid transparent;border-radius:8px;padding:0 9px;font:700 12.5px Inter,'Segoe UI',system-ui,sans-serif;width:170px;background:#f4f6f8;color:#16212b}
.lc-bar .lc-bi:hover{border-color:#d9e1e8}.lc-bar .lc-bi:focus{outline:none;border-color:#2e9e4f;background:#fff;box-shadow:0 0 0 3px rgba(46,158,79,.15)}
.lc-bar .lc-seg{height:30px;border:0;background:#f4f6f8;border-radius:8px;padding:2px;gap:2px}
.lc-bar .lc-seg button{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:0!important;border-radius:6px;background:transparent;font:600 12px Inter,'Segoe UI',system-ui,sans-serif;color:#475569}
.lc-bar .lc-seg button:hover{color:#16212b}.lc-bar .lc-seg button[aria-pressed="true"]{background:#fff;color:#16212b;box-shadow:0 1px 3px rgba(16,33,43,.15)}
.lc-bar .lc-cw{position:relative}
.lc-bar .lc-cb{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:0;border-radius:8px;background:#f4f6f8;font:600 12px Inter,'Segoe UI',system-ui,sans-serif;color:#475569;cursor:pointer}
.lc-bar .lc-cb:hover{background:#eaeef2}.lc-bar .lc-cb i{width:14px;height:14px;border-radius:4px;border:1px solid rgba(0,0,0,.15)}
.lc-bar .lc-pop{position:absolute;top:36px;left:0;display:grid;grid-template-columns:repeat(5,22px);gap:6px;padding:8px;background:#fff;border:1px solid #d9e1e8;border-radius:10px;box-shadow:0 10px 24px rgba(16,33,43,.18);z-index:2}
.lc-bar .lc-pop[hidden]{display:none}.lc-bar .lc-pop .lc-sw{width:22px;height:22px;border-radius:6px}
.lc-bar .lc-any{grid-column:1/-1;display:flex;align-items:center;gap:6px;font:600 11.5px Inter,sans-serif;color:#475569;cursor:pointer}.lc-bar .lc-any input{width:24px;height:22px;padding:0;border:1px solid #d9e1e8;border-radius:5px}
.lc-bar .lc-bs{height:30px;border:0;border-radius:8px;background:#f4f6f8;font:600 12px Inter,'Segoe UI',system-ui,sans-serif;color:#475569;padding:0 8px;cursor:pointer}
.lc-bar .lc-bb{height:30px;border:0;border-radius:8px;background:#f4f6f8;font:600 12px Inter,'Segoe UI',system-ui,sans-serif;color:#334155;padding:0 11px}
.lc-bar .lc-bb:hover{background:#eaeef2}.lc-bar .lc-bb.pri{background:#2e9e4f;color:#fff}.lc-bar .lc-bb.pri:hover{background:#278a44}
.lc-bar .lc-ic{width:30px;padding:0;font-size:16px;line-height:1}
.lc-bar .lc-bx{width:28px;height:28px;border-radius:8px;color:#94a3b8}.lc-bar .lc-bx:hover{background:#f4f6f8;color:#16212b}
.lc-bar .lc-bt{font:700 12px Inter,sans-serif;padding:0 6px;color:#16212b}.lc-bar .lc-bt.note{font-weight:500;color:#94a3b8}
/* card look */
#cv .lcard .lc-bg{stroke:#dbe2e8}
#cv .lcard .lc-row .lc-hit{transition:fill .12s}
#cv .lcard.lsel .lc-bg{stroke-dasharray:none;stroke:#9fb4c8}
#cv .lcard.lcsel .lc-bg{stroke:#2e9e4f;stroke-width:2}
#cv .lcard .lc-rs{fill:#fff;stroke:#2e9e4f;stroke-width:1.4;rx:2}
</style>`);

/* ===================== v9.71 — Card design section =====================
   Select a card → the right-hand panel opens a "Card design" section for THAT card only:
   name, readings in the card, style, colours, text size, width, corners, border, size and place.
   The floating toolbar keeps just the name, style and a button to this section. */
function lblCardPanel(b, key) {
  const c = lblCards(b).find(k => k.key === key);
  if (!c) return '';
  const CD = (b.props.lblCardD || {})[key] || {};
  const D = Object.assign({}, DOC.lblDesign || {}, b.props.lblDesign || {}, CD);
  const sty = CD.sty || lblStyle(b);
  const sw = (k, list, cur) => list.map(([c2, t]) => `<button type="button" class="lc-sw" data-cd="${k}|${c2}" style="background:${c2}" aria-pressed="${cur === c2}" title="${t || c2}"></button>`).join('');
  const seg = (k, opts, cur) => `<span class="lc-seg2">${opts.map(([v, t]) => `<button type="button" data-cd="${k}|${v}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join('')}</span>`;
  const others = b.tags.filter(t => t.show && REG[t.id] && !c.rows.includes(t));
  const nm = t => esc((REG[t.id] && REG[t.id].short) || t.id.split('.').pop());
  const side = (b.props.lblSide || {})[key];
  return `<section class="lcp" id="lcPanel">
  <div class="lcp-h"><span class="lcp-ic"></span><div><b>Card design</b><small>${esc(b.name)} · ${c.rows.length} reading${c.rows.length === 1 ? '' : 's'} · only this card</small></div><button type="button" class="lcp-x" data-cd="close" title="Close">✕</button></div>
  <div class="lcp-s"><label class="lcp-l" for="lcpName">Name</label><input id="lcpName" class="lcp-in" value="${esc(c.title)}"></div>
  <div class="lcp-s"><div class="lcp-l">Readings in this card</div>
    <div class="lcp-rows">${c.rows.map(t => `<div class="lcp-r"><span>${nm(t)}</span><small>${esc(t.id)}</small><button type="button" data-cd="remove|${esc(t.id)}" title="Take out of the card (back to a label)">✕</button></div>`).join('')}</div>
    ${others.length ? `<select class="lcp-in" data-cdsel="add"><option value="">＋ Add a reading of ${esc(b.name)}</option>${others.map(t => `<option value="${esc(t.id)}">${nm(t)}</option>`).join('')}</select>` : ''}</div>
  <div class="lcp-s"><div class="lcp-l">Style</div>${seg('sty', [['table', 'Table'], ['group', 'Grouped'], ['hmi', 'Dark'], ['tile', 'Tiles'], ['bars', 'Bars'], ['kpi', 'Key + trend'], ['status', 'Status']], sty)}</div>
  <div class="lcp-s"><div class="lcp-l">Header colour</div><div class="lcp-sws">${sw('hd', [['#1f3b63'], ['#37474f'], ['#2e7d32'], ['#5e9e2a'], ['#00796b'], ['#1565c0'], ['#6a1b9a'], ['#c62828'], ['#d48a00'], ['#f3f6f9', 'Light']], D.hd)}<label class="lcp-any"><input type="color" data-cdcol="hd" value="${D.hd || '#1f3b63'}"> Any</label></div></div>
  ${sty === 'hmi' ? '' : `<div class="lcp-s"><div class="lcp-l">Card colour</div><div class="lcp-sws">${sw('bg', [['#ffffff', 'White'], ['#f8fafc', 'Light grey'], ['#fffdf5', 'Warm'], ['#f1f8ff', 'Light blue'], ['#f3fbf5', 'Light green']], D.bg || '#ffffff')}</div></div>`}
  <div class="lcp-s"><div class="lcp-l">Value colour</div><div class="lcp-sws">${sw('v', [['#16212b', 'Dark'], ['#1f3b63', 'Navy'], ['#1565c0', 'Blue'], ['#2e7d32', 'Green'], ['#7fe0ff', 'Cyan']], D.v || (sty === 'hmi' ? '#7fe0ff' : '#16212b'))}</div></div>
  <div class="lcp-g">
   <div><div class="lcp-l">Text size</div>${seg('fs', [['s', 'S'], ['m', 'M'], ['l', 'L']], D.fs || 'm')}</div>
   <div><div class="lcp-l">Width</div>${seg('w', [['s', 'Narrow'], ['m', 'Normal'], ['l', 'Wide']], D.w || 'm')}</div>
   <div><div class="lcp-l">Corners</div>${seg('rx', [[0, 'Square'], [6, 'Round'], [12, 'Rounder']], D.rx == null ? 6 : D.rx)}</div>
   <div><div class="lcp-l">Border</div>${seg('bw', [[0.5, 'Thin'], [1, 'Normal'], [2, 'Bold']], D.bw || 1)}</div>
  </div>
  <div class="lcp-s"><div class="lcp-l">Place next to ${esc(b.name)}</div><span class="lc-seg2">${[['above', '↑ Above'], ['right', '→ Right'], ['below', '↓ Below'], ['left', '← Left']].map(([s, t]) => `<button type="button" data-cd="side|${s}" aria-pressed="${side === s}">${t}</button>`).join('')}</span>
   <div class="lcp-note">Or drag the card anywhere · drag its edges to resize</div></div>
  <div class="lcp-act"><button type="button" class="lcp-b" data-cd="free">Move to a free spot</button>${(b.props.lblSize || {})[key] ? '<button type="button" class="lcp-b" data-cd="autosize">Auto size</button>' : ''}<button type="button" class="lcp-b" data-cd="copyall">Copy design to all cards</button><button type="button" class="lcp-b" data-cd="reset">Default design</button><button type="button" class="lcp-b warn" data-cd="ungroup">Back to labels</button></div>
 </section>`;
}
function lblWirePanel(P, b, key) {
  const set = (k, v) => {
    pushUndo();
    const cd = ((b.props.lblCardD = b.props.lblCardD || {})[key] = (b.props.lblCardD || {})[key] || {});
    cd[k] = ['rx', 'bw'].includes(k) ? +v : v;
    if (k === 'sty' && cd.show === 'single') (cd.show = 'group'), delete cd.type; // a group layout replaces "Big value"
    changed();
    renderCanvas();
    renderProps();
    lblBar();
  };
  P.querySelectorAll('[data-cd]').forEach(el => {
    const [k, v] = el.dataset.cd.split('|');
    el.onclick = () => {
      if (['sty', 'hd', 'bg', 'v', 'fs', 'w', 'rx', 'bw'].includes(k)) return set(k, v);
      if (k === 'close') return (LBL_CSEL = null), renderCanvas(), renderProps(), lblBar();
      if (k === 'remove') return lblCardOp('remove', v);
      if (k === 'side') return pushUndo(), lblPlace(b, key, v), changed(), renderCanvas(), renderProps(), lblBar();
      if (k === 'free') return lblMenuAct(b, key, 'free');
      if (k === 'autosize') return lblCardOp('autosize');
      if (k === 'ungroup') return lblCardOp('ungroup'), renderProps();
      if (k === 'reset') {
        pushUndo();
        if (b.props.lblCardD) delete b.props.lblCardD[key];
        changed();
        renderCanvas();
        renderProps();
        return lblUndoToast('Card back to the default design');
      }
      if (k === 'copyall') {
        pushUndo();
        const Dx = (b.props.lblCardD || {})[key] || {};
        DOC.blocks.forEach(o => o.props && o.props.lblCardD && Object.keys(o.props.lblCardD).forEach(kk => Object.assign(o.props.lblCardD[kk], Dx)));
        DOC.lblDesign = Object.assign({}, DOC.lblDesign || {}, Dx);
        changed();
        renderCanvas();
        return lblUndoToast('Design copied to every card');
      }
    };
  });
  P.querySelectorAll('[data-cdcol]').forEach(i => (i.onchange = () => set(i.dataset.cdcol, i.value)));
  const sa = P.querySelector('[data-cdsel="add"]');
  if (sa) sa.onchange = () => sa.value && (lblCardOp('add', sa.value), renderProps());
  const nmI = P.querySelector('#lcpName');
  if (nmI) nmI.onchange = () => (lblCardOp('title', nmI.value.trim()), renderProps());
}
function lblMenuAct(b, key, what) {
  if (what === 'free') {
    pushUndo();
    if (b.props.lblPos) delete b.props.lblPos[key];
    renderCanvas();
    const p = lblFreeSpot(b, key);
    if (p) (b.props.lblPos = b.props.lblPos || {})[key] = p;
    changed();
    renderCanvas();
    lblBar();
    lblUndoToast('Card moved to a free spot');
  }
}
{
  /* the panel replaces the machine panel while a card is selected */
  const _rp = renderProps;
  renderProps = function () {
    _rp();
    return; // v9.85 — the card editor lives in Properties › Data label cards (no separate panel on top)
    const b = B(LBL_CSEL.b);
    if (!b) return;
    const P = $('#props');
    if (!P) return;
    P.querySelector('#lcPanel')?.remove();
    P.insertAdjacentHTML('afterbegin', lblCardPanel(b, LBL_CSEL.key));
    P.scrollTop = 0;
    lblWirePanel(P, b, LBL_CSEL.key);
  };
  /* toolbar: name · style · "Card design" · ⋯ */
  const _bar = lblBar;
  lblBar = function () {
    _bar();
    const bar = document.getElementById('lcBar');
    if (!bar || bar.hidden || !LBL_CSEL || LBL_CROW.size || LBL_SELT.size) return;
    bar.querySelector('.lc-cw')?.remove();
    bar.querySelectorAll('.lc-dv').forEach((d, i) => i > 1 && d.remove());
    bar.querySelector('[data-lb="add"]')?.remove();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lc-bb pri';
    btn.textContent = '🎨 Card design';
    btn.title = 'Colours, size, readings and place of this card';
    btn.onclick = () => {
      renderProps();
      const p = document.getElementById('lcPanel');
      if (p) (p.scrollIntoView({ block: 'start' }), p.classList.add('flash'), setTimeout(() => p.classList.remove('flash'), 700));
    };
    bar.insertBefore(btn, bar.querySelector('.lc-ic') || bar.querySelector('.lc-bx'));
  };
}
document.head.insertAdjacentHTML('beforeend', `<style id="lcPanelCss">
.lcp{margin:8px;border:1px solid #d9e1e8;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(16,33,43,.06);font:500 12.5px Inter,'Segoe UI',system-ui,sans-serif;color:#16212b;transition:box-shadow .3s}
.lcp.flash{box-shadow:0 0 0 3px rgba(46,158,79,.35)}
.lcp-h{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #eef2f5}.lcp-h b{display:block;font-size:13.5px}.lcp-h small{color:#64748b;font-size:11.5px}
.lcp-ic{width:28px;height:28px;border-radius:8px;background:#e9f6ee;flex:none;position:relative}.lcp-ic:after{content:"";position:absolute;inset:7px 6px;border:2px solid #2e9e4f;border-radius:3px;border-top-width:5px}
.lcp-x{margin-left:auto;border:0;background:none;color:#94a3b8;font-size:14px;cursor:pointer;width:26px;height:26px;border-radius:6px}.lcp-x:hover{background:#f4f6f8;color:#16212b}
.lcp-s{padding:9px 12px;border-bottom:1px solid #f1f4f6}.lcp-l{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:6px;display:block}
.lcp-in{width:100%;box-sizing:border-box;height:32px;border:1px solid #d9e1e8;border-radius:8px;padding:0 9px;font:600 12.5px inherit;background:#fff;color:#16212b;color-scheme:light}.lcp-in:focus{outline:none;border-color:#2e9e4f;box-shadow:0 0 0 3px rgba(46,158,79,.15)}
.lcp-rows{display:flex;flex-direction:column;gap:4px;margin-bottom:6px}
.lcp-r{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;column-gap:6px;align-items:center;background:#f6f8fa;border-radius:7px;padding:5px 6px 5px 9px}
.lcp-r span{font-weight:600}.lcp-r small{grid-row:2;color:#94a3b8;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lcp-r button{grid-row:1/3;grid-column:2;border:0;background:none;color:#94a3b8;cursor:pointer;width:24px;height:24px;border-radius:6px}.lcp-r button:hover{background:#fdeeee;color:#c62828}
.lcp-sws{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.lcp-sws .lc-sw{width:22px;height:22px;border-radius:6px;border:1px solid rgba(0,0,0,.14);cursor:pointer;padding:0}.lcp-sws .lc-sw[aria-pressed="true"]{outline:2px solid #2e9e4f;outline-offset:2px}
.lcp-any{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#475569;cursor:pointer}.lcp-any input{width:26px;height:22px;padding:0;border:1px solid #d9e1e8;border-radius:5px;background:#fff}
.lc-seg2{display:inline-flex;flex-wrap:wrap;background:#f4f6f8;border-radius:8px;padding:2px;gap:2px}.lc-seg2 button{border:0;background:transparent;border-radius:6px;padding:5px 9px;font:600 11.5px inherit;color:#475569;cursor:pointer}
.lc-seg2 button:hover{color:#16212b}.lc-seg2 button[aria-pressed="true"]{background:#fff;color:#16212b;box-shadow:0 1px 3px rgba(16,33,43,.15)}
.lcp-g{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;padding:9px 12px;border-bottom:1px solid #f1f4f6}
.lcp-note{font-size:11px;color:#94a3b8;margin-top:6px}
.lcp-act{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px}.lcp-b{border:0;background:#f4f6f8;border-radius:8px;padding:7px 10px;font:600 11.5px inherit;color:#334155;cursor:pointer}.lcp-b:hover{background:#eaeef2}.lcp-b.warn{color:#c62828}
</style>`);

/* v9.72 — card editing only in the side panel: no floating toolbar for a selected card */
{
  const _bar = lblBar;
  lblBar = function () {
    _bar();
    const bar = document.getElementById('lcBar');
    if (bar && LBL_CSEL && !LBL_SELT.size) bar.hidden = true;
    if (LBL_CSEL) {
      const P = document.getElementById('lcPanel');
      if (!P || P.dataset.k !== LBL_CSEL.b + '|' + LBL_CSEL.key + '|' + [...LBL_CROW].join(',')) renderProps();
    }
  };
  const _panel = lblCardPanel;
  lblCardPanel = function (b, key) {
    let h = _panel(b, key);
    const k = b.id + '|' + key + '|' + [...LBL_CROW].join(',');
    h = h.replace('<section class="lcp" id="lcPanel">', `<section class="lcp" id="lcPanel" data-k="${esc(k)}">`);
    /* picked rows → actions here */
    const picked = [...LBL_CROW];
    const others = lblCards(b).filter(c => /^c\d+$/.test(c.key) && c.key !== key);
    const box = picked.length
      ? `<div class="lcp-pick"><b>${picked.length} reading${picked.length > 1 ? 's' : ''} picked</b><div class="lcp-act" style="padding:6px 0 0"><button type="button" class="lcp-b pri" data-cr="new">Move to a new card</button>${others.map(c => `<button type="button" class="lcp-b" data-cr="to|${c.key.slice(1)}">Move to “${esc(c.title)}”</button>`).join('')}<button type="button" class="lcp-b" data-cr="label">Back to labels</button><button type="button" class="lcp-b" data-cr="clr">Clear</button></div></div>`
      : `<div class="lcp-note" style="margin:0 0 6px">Tip: click rows in the card (Ctrl for more) to move them to another card.</div>`;
    h = h.replace('<div class="lcp-rows">', box + '<div class="lcp-rows">');
    /* rows in the list are pickable too */
    picked.forEach(id => (h = h.replace(`<div class="lcp-r"><span>${esc((REG[id] && REG[id].short) || id.split('.').pop())}</span><small>${esc(id)}</small>`, `<div class="lcp-r on"><span>${esc((REG[id] && REG[id].short) || id.split('.').pop())}</span><small>${esc(id)}</small>`)));
    return h;
  };
  const _wire = lblWirePanel;
  lblWirePanel = function (P, b, key) {
    _wire(P, b, key);
    P.querySelectorAll('[data-cr]').forEach(el => {
      const [k, v] = el.dataset.cr.split('|');
      el.onclick = () => {
        if (k === 'clr') return LBL_CROW.clear(), renderCanvas(), renderProps();
        lblRows(k === 'to' ? 'to' : k, +v);
        renderProps();
      };
    });
    P.querySelectorAll('.lcp-r').forEach(r => {
      const id = r.querySelector('small').textContent;
      r.querySelector('span').onclick = r.querySelector('small').onclick = ev => {
        if (ev.ctrlKey || ev.metaKey) LBL_CROW.has(id) ? LBL_CROW.delete(id) : LBL_CROW.add(id);
        else if (LBL_CROW.size === 1 && LBL_CROW.has(id)) LBL_CROW.clear();
        else (LBL_CROW.clear(), LBL_CROW.add(id));
        renderCanvas();
        renderProps();
      };
    });
  };
}
document.head.insertAdjacentHTML('beforeend', `<style id="lcV72">
.lcp-r span,.lcp-r small{cursor:pointer}.lcp-r.on{background:#e9f6ee;box-shadow:inset 0 0 0 1.5px #2e9e4f}
.lcp-pick{background:#f3fbf5;border:1px solid #cfe9d8;border-radius:8px;padding:8px;margin-bottom:8px}.lcp-pick b{font-size:12px}
.lcp-b.pri{background:#2e9e4f;color:#fff}.lcp-b.pri:hover{background:#278a44}
</style>`);

/* v9.77 — select the equipment and bring its Data label cards section into view */
let lblRowClick = null;
/* v9.80 — readings picked on the canvas are the ticked tags in Properties (one selection, two places) */
function lblSyncPick(bid) {
  LBL_PSEL_B = bid;
  LBL_PSEL.clear();
  LBL_CROW.forEach(id => LBL_PSEL.add(id));
}
function lblOpenProps(bid, key, keepRows) {
  const b = B(bid);
  if (!b) return;
  LBL_SELT.clear();
  if (!keepRows) LBL_CROW.clear();
  /* a clicked card stays selected, so its resize handles show (drag any edge or corner to size it) */
  LBL_CSEL = key ? { b: b.id, key } : null;
  SEL = { t: 'b', id: b.id };
  try {
    PTAB = 'cards';
  } catch (e) {}
  renderCanvas();
  renderProps();
  setTimeout(() => {
    const S = document.getElementById('lc2');
    if (S) {
      S.scrollIntoView({ block: 'start', behavior: 'smooth' });
      S.classList.add('lc2-flash');
      setTimeout(() => S.classList.remove('lc2-flash'), 1200);
    }
  }, 30);
}
/* a plain click on a label or card (no drag) also opens the settings */
{
  let down = null;
  document.addEventListener('pointerdown', e => {
    const t = MODE === 'design' && e.button === 0 && e.target.closest && e.target.closest('#cv .tagb, #cv .lcard');
    down = t ? { x: e.clientX, y: e.clientY, bid: t.dataset.tb || t.dataset.tg, key: t.classList.contains('lcard') ? t.dataset.lc : null, row: !!e.target.closest('.lcard [data-row]') } : null;
  }, true);
  document.addEventListener('pointerup', e => {
    if (!down) return;
    const d = down;
    down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) setTimeout(() => (d.row && !lblRowClick ? null : lblOpenProps(d.bid, d.key, d.row)), 0);
  }, true);
}
document.head.insertAdjacentHTML('beforeend', '<style>#lc2.lc2-flash{animation:lc2fl 1.2s}@keyframes lc2fl{0%,40%{box-shadow:0 0 0 3px rgba(46,158,79,.45);border-radius:8px}100%{box-shadow:none}}#lcBar{display:none!important}</style>');
