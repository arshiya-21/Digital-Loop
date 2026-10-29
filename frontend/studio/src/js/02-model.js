/*! SandMan Process Flowsheet — 02-model.js
 *  Global state, geometry, tags & simulation, alert engine, equipment state, document operations, undo/persistence
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===== State ===== */
let DOC,
  REG,
  SEL = null,
  MODE = 'design',
  LIVE = true,
  PLACE = null,
  SNAP = true,
  SHOWTAGS = true,
  LTAB = 'lib',
  DTAB = 'alerts',
  PTAB = 'gen',
  AFILT = -1,
  PRESENT = false,
  SOUND = true;
const VAL = {},
  ALERTS = {},
  EVENTS = [],
  RULET = {};
let ALV = 0,
  DISTS = [],
  SIMT = 0;
const VIEW = { tx: 40, ty: 30, k: 1 };
let UNDO = [],
  REDO = [];
const LS = 'sandman-flowsheet-v2' + (typeof CUSTOMER_NS === 'string' ? CUSTOMER_NS : ''); // v4.9: per customer
function blankDoc() {
  return { name: 'Sand Handling & Molding Line', blocks: [], streams: [], seq: 1 };
}
const B = id => (id ? DOC.blocks.find(b => b.id === id) : null),
  Sx = id => DOC.streams.find(s => s.id === id);
const byName = n => DOC.blocks.find(b => b.name === n);

/* ===== Geometry: size, rotation, flip ===== */
function dims(b) {
  const E = EQ[b.type];
  let w = b.w || E.w,
    h = b.h || E.h;
  if (E.autoH) h = E.autoH(b);
  const r = (((b.rot || 0) % 360) + 360) % 360,
    sc = b.sc || 1;
  return { w, h, r, sc, W: (r % 180 ? h : w) * sc, H: (r % 180 ? w : h) * sc };
}
function xf(b, x, y) {
  const { w, h, r, sc } = dims(b);
  if (b.flip) x = w - x;
  let p;
  switch (r) {
    case 90:
      p = [h - y, x];
      break;
    case 180:
      p = [w - x, h - y];
      break;
    case 270:
      p = [y, w - x];
      break;
    default:
      p = [x, y];
  }
  return [p[0] * sc, p[1] * sc];
}
const ROTS = { t: 'r', r: 'b', b: 'l', l: 't' };
function xside(b, s) {
  if (b.flip && (s === 'l' || s === 'r')) s = s === 'l' ? 'r' : 'l';
  let n = ((((b.rot || 0) % 360) + 360) % 360) / 90;
  while (n-- > 0) s = ROTS[s];
  return s;
}
function symTf(b) {
  const { w, h, r } = dims(b);
  let t = '';
  if (r === 90) t = `translate(${h},0) rotate(90)`;
  else if (r === 180) t = `translate(${w},${h}) rotate(180)`;
  else if (r === 270) t = `translate(0,${w}) rotate(270)`;
  if (b.flip) t += ` translate(${w},0) scale(-1,1)`;
  const sc = b.sc || 1;
  return (sc !== 1 ? `scale(${sc}) ` : '') + t;
}
/* v1.5 free resize: equipment drawn at a fixed size is drawn at its natural size and stretched to the box the
   user sized; resizable axes (E.resize) are still drawn at the real size. Ports follow the same stretch. */
function drawDims(b) {
  const E = EQ[b.type],
    { w, h } = dims(b),
    rz = E.resize || '';
  const dw = rz.includes('w') ? w : E.w,
    dh = rz.includes('h') || E.autoH ? h : E.h;
  return { dw, dh, sx: w / dw, sy: h / dh };
}
function rawPorts(b) {
  const E = EQ[b.type],
    { w, h } = dims(b);
  const dd = drawDims(b);
  if (dd.sx === 1 && dd.sy === 1) return typeof E.ports === 'function' ? E.ports(w, h) : E.ports;
  const list = typeof E.ports === 'function' ? E.ports(dd.dw, dd.dh) : E.ports;
  return list.map(p => [p[0], p[1], p[2] * dd.sx, p[3] * dd.sy, ...p.slice(4)]);
}
function ports(b) {
  return rawPorts(b).map(p => {
    const [lx, ly] = xf(b, p[2], p[3]);
    return {
      id: p[0],
      side: xside(b, p[1]),
      lx,
      ly,
      x: b.x + lx,
      y: b.y + ly,
      dir: p[4],
      kind: p[5],
      req: p[6],
    };
  });
}
/* v7.1 — every piece of plant equipment has a data / network connection point "◆" on its top edge (for SCADA,
   PLC, gateways …), so data lines never land on a material inlet. Equipment with its own data port uses that. */
function hasDataPort(b) {
  return !!b && rawPorts(b).some(p => p[5] === 'data');
}
function dataPort(b) {
  const E = b && EQ[b.type];
  // v9.5: SandMan library drawings (notag) are plant equipment too — they get the ◆ data point like built-in equipment
  if (!E || E.widget || E.inst || b.type === 'junction' || (E.notag && !E.smlib) || hasDataPort(b) || CATS[E.cat] === 'Control & IT') return null;
  const { w } = dims(b),
    [lx, ly] = xf(b, Math.round(w * 0.82), 0);
  return { id: '@data', side: xside(b, 't'), lx, ly, x: b.x + lx, y: b.y + ly, dir: 'io', kind: 'data', req: 0, virt: true };
}
const portOf = (b, pid) => (b ? (pid === '@data' ? dataPort(b) : ports(b).find(p => p.id === pid)) : null);

/* ===== Tags & simulation ===== */
function mkTag(id, o) {
  REG[id] = Object.assign(
    {
      id,
      desc: '',
      unit: '',
      src: 'SandMan Gateway',
      addr: '',
      typ: 0,
      ll: null,
      lo: null,
      hi: null,
      hh: null,
      noise: 0,
      role: '',
      d: 1,
      lab: 0,
      cyc: null,
    },
    o,
  );
  ensureVal(id, true);
  return REG[id];
}
/* v9.39 — one display text for any tag: Text tags show their text, Status-list tags their label, numbers value + unit */
function tagTxt(id) {
  const t = REG[id];
  if (!t) return '—';
  if (t.txt != null && t.txt !== '') return t.txt;
  if (t.states) {
    const s = t.states[Math.round(val(id))];
    if (s != null) return s;
  }
  return `${fmtN(val(id), t.d)} ${t.unit || ''}`.trim();
}
/* v9.39 — gateway / back-end hook for text values (e.g. a database varchar column such as prev_pattern):
   setTagText('DISA-1.PREV_PATTERN', 'PT-0988 Hub') updates the tag everywhere it is shown */
function setTagText(id, text) {
  if (!REG[id]) return false;
  REG[id].txt = text == null ? '' : String(text);
  if (typeof renderAll === 'function') renderAll();
  return true;
}
const tagIsText = t => !!t && ((t.txt != null && t.txt !== '') || !!t.states);
function ensureVal(id, reset) {
  const t = REG[id];
  if (!t) return;
  if (!VAL[id] || reset) {
    const x = t.cyc ? t.cyc[0] + Math.random() * (t.cyc[1] - t.cyc[0]) : t.hold != null ? t.hold : t.typ;
    VAL[id] = { x, v: x, dft: 0, h: [], dir: Math.random() < 0.5 ? 1 : -1 };
  }
}
let RP = null;
function val(id) {
  if (RP && REG[id]) return histVal(id, RP.T);
  return VAL[id] ? VAL[id].v : null;
}
function distFx(role) {
  let o = 0;
  for (const d of DISTS) {
    const r = clamp((SIMT - d.t0) / 25, 0, 1);
    o += (d.fx[role] || 0) * r;
  }
  return o;
}
function applyPresc(b) {
  const p = PRESC[b.props.group] || PRESC['Brake Disc'];
  b.tags.forEach(bt => {
    const t = REG[bt.id];
    if (!t) return;
    if (t.role === 'bent' || t.role === 'coal') {
      const v = p[t.role];
      t.typ = v;
      t.lo = +(v * 0.92).toFixed(2);
      t.hi = +(v * 1.08).toFixed(2);
      t.ll = +(v * 0.85).toFixed(2);
      t.hh = +(v * 1.15).toFixed(2);
    }
  });
}
function isRun(b) {
  return b && !b.props.oos && !IDLE[b.id];
}
function srcBlocks(b) {
  const out = [];
  DOC.streams.forEach(s => {
    if (s.to.b === b.id && s.kind !== 'ret') {
      let u = B(s.from.b);
      if (u && u.type === 'junction') {
        DOC.streams.forEach(s2 => {
          if (s2.to.b === u.id) out.push(B(s2.from.b));
        });
      } else out.push(u);
    }
  });
  return out.filter(Boolean);
}
function dstBlocks(b) {
  const out = [];
  DOC.streams.forEach(s => {
    if (s.from.b === b.id && s.kind !== 'ret') {
      let u = B(s.to.b);
      if (u && u.type === 'junction') {
        DOC.streams.forEach(s2 => {
          if (s2.from.b === u.id) out.push(B(s2.to.b));
        });
      } else out.push(u);
    }
  });
  return out.filter(Boolean);
}
let OWNER = {};
function buildOwner() {
  OWNER = {};
  DOC.blocks.forEach(b =>
    b.tags.forEach(t => {
      if (!OWNER[t.id]) OWNER[t.id] = b;
    }),
  );
}
function simTick() {
  SIMT++;
  const now = Date.now();
  buildOwner();
  for (const id in REG) {
    const t = REG[id];
    ensureVal(id);
    const V = VAL[id],
      b = OWNER[id];
    if (b && b.props.oos) {
      if (t.role === 'vpos' || t.role === 'cvpos') {
        V.x += (0 - V.x) * 0.3;
        V.v = V.x;
      }
      V.h.push({ t: now, v: V.v });
      if (V.h.length > 900) V.h.shift();
      continue;
    }
    if (V.live) {
      // v9.44 — value comes from the plant: do not simulate, only keep the trend history
      V.h.push({ t: now, v: V.v });
      if (V.h.length > 900) V.h.shift();
      continue;
    }
    if (t.cyc) {
      const [mn, mx, P] = t.cyc;
      const ups = b ? srcBlocks(b) : [],
        dns = b ? dstBlocks(b) : [];
      const upStop = ups.length && ups.every(u => !isRun(u)),
        dnStop = dns.length && dns.every(u => !isRun(u));
      let dir = V.dir;
      if (upStop) dir = -1;
      else if (dnStop) dir = 1;
      const rate = (mx - mn) / (P * (dir > 0 ? 0.4 : 0.6));
      V.x = clamp(V.x + dir * rate + distFx(t.role) * 0.02, 0, 100);
      if (!upStop && !dnStop) {
        if (V.x >= mx) V.dir = -1;
        if (V.x <= mn) V.dir = 1;
      }
      V.fill = dir > 0;
      V.v = clamp(V.x + gauss() * t.noise * 0.3, 0, 100);
    } else {
      const tgt = (t.hold != null ? t.hold : t.typ) + distFx(t.role); // v9.18: demo hold value (REG[id].hold) — e.g. a dummy alarm
      V.x += (tgt - V.x) * 0.07;
      V.dft = V.dft * 0.94 + gauss() * t.noise * 0.12;
      if (t.lab) {
        if (SIMT % 30 === 1 || !V.h.length) V.v = V.x + V.dft + gauss() * t.noise;
      } else V.v = V.x + V.dft + gauss() * t.noise * 0.5;
    }
    V.h.push({ t: now, v: V.v });
    if (V.h.length > 900) V.h.shift();
  }
}
function seedHist() {
  const now = Date.now();
  for (const id in REG) {
    const t = REG[id];
    ensureVal(id);
    const V = VAL[id];
    if (V.h.length) continue;
    let d = 0,
      x = V.x;
    for (let i = 300; i > 0; i--) {
      d = d * 0.94 + gauss() * t.noise * 0.12;
      V.h.push({ t: now - i * 1000, v: (t.cyc ? x : t.hold != null ? t.hold : t.typ) + d + gauss() * t.noise * 0.5 });
    }
    V.v = V.h[V.h.length - 1].v;
    if (!t.cyc) V.x = t.hold != null ? t.hold : t.typ;
  }
}
/* v9.44 — severity of a value against the tag limits. db = deadband (fraction): every limit is moved toward the
   optimal value by db × (distance limit ↔ optimal). db = 0 is the plain limit check; the alarm engine uses
   db > 0 only to decide when an ALREADY ACTIVE alarm may clear (hysteresis). */
function sevAt(t, v, db = 0) {
  if (!t || v == null || !isFinite(v)) return 0;
  const hiL = L => (L == null ? null : L - db * Math.abs(L - t.typ)),
    loL = L => (L == null ? null : L + db * Math.abs(t.typ - L));
  const hh = hiL(t.hh), hi = hiL(t.hi), lo = loL(t.lo), ll = loL(t.ll);
  if ((hh != null && v >= hh) || (ll != null && v <= ll)) return 3;
  if ((hi != null && v >= hi) || (lo != null && v <= lo)) return 2;
  if ((hi != null && v >= t.typ + (hi - t.typ) * 0.75) || (lo != null && v <= t.typ - (t.typ - lo) * 0.75)) return 1;
  return 0;
}
function tagSev(id, v = val(id)) {
  return sevAt(REG[id], v, 0);
}

/* v9.44 — alarm timing settings (milliseconds / fraction), changeable from the console or the embedding page */
/* limitAlarms: false (default) = the Fault alarm list comes ONLY from the custom rules (Alerts tab: tag · condition ·
   value · severity · persist · message). true = tag limits (LL / L / H / HH) raise alarms too. The embedding page may
   set window.SANDMAN_ALARM_MODE = 'rules' | 'limits' | 'both' before the Studio loads. */
const ALCFG = {
  onDelay: 3000,
  deadband: 0.03,
  staleMs: 15000,
  limitAlarms: ['limits', 'both'].includes(window.SANDMAN_ALARM_MODE),
};
const ALST = {}; // per-alarm pending state { since }
/* Alarm severity with ON-DELAY (a new / higher severity must hold for onDelay ms) and DEADBAND (an active alarm
   only drops after the value is back inside the limit by the deadband) — stops flicker and one-sample spikes. */
function alarmSev(k, t, v) {
  const raw = sevAt(t, v, 0),
    A = ALERTS[k],
    cur = A && A.active ? A.sev : 0,
    st = ALST[k] || (ALST[k] = { since: 0 });
  let s = raw;
  if (cur > raw) s = Math.max(raw, Math.min(cur, sevAt(t, v, ALCFG.deadband)));
  if (s > cur) {
    if (!st.since) st.since = Date.now();
    if (Date.now() - st.since < ALCFG.onDelay) s = cur;
  } else st.since = 0;
  return s;
}
/* Signal health: a missing / non-numeric value, a quality of Bad or Stale, or a live value that stopped arriving
   is a SIGNAL FAULT — never shown as "normal". */
function sigBad(id) {
  const t = REG[id],
    V = VAL[id];
  if (!t || tagIsText(t)) return false;
  if (!V || V.v == null || !isFinite(V.v)) return true;
  if (V.q === 'Bad' || V.q === 'Stale') return true;
  if (V.live && Date.now() - V.lt > ALCFG.staleMs) return true;
  return false;
}
/* Live values: the SandMan Gateway / backend (or the embedding page) pushes real readings here.
   setTagValue('MULLER_MOISTURE_PCT', 3.4, 'Good')  — quality: 'Good' (default) | 'Stale' | 'Bad'
   A tag that receives a value is "live": the simulator no longer moves it. */
function setTagValue(id, value, quality, ts) {
  const t = REG[id];
  if (!t) return false;
  ensureVal(id);
  const V = VAL[id],
    q = quality || 'Good',
    n = +value;
  V.live = true;
  V.lt = Date.now();
  V.ts = ts || V.lt;
  V.q = q;
  if (q === 'Good' && value != null && value !== '' && isFinite(n)) {
    V.x = V.v = n;
    V.h.push({ t: V.lt, v: n });
    if (V.h.length > 900) V.h.shift();
  } else if (q === 'Good') V.q = 'Bad'; // a "good" reading with no number is not good
  return true;
}
function setTagValues(list) {
  // list: [{id, v, q, ts}] or { id: value }
  const a = Array.isArray(list) ? list : Object.entries(list || {}).map(([id, v]) => ({ id, v }));
  let n = 0;
  a.forEach(x => setTagValue(x.id, x.v, x.q, x.ts) && n++);
  evalAlerts();
  return n;
}
function releaseLive(id) {
  if (VAL[id]) {
    delete VAL[id].live;
    delete VAL[id].q;
  }
}
function tagOwner(id) {
  for (const b of DOC.blocks) if (b.tags.some(t => t.id === id)) return { b };
  for (const s of DOC.streams) if (s.tag === id) return { s };
  return null;
}

/* ===== Alerts ===== */
function logEv(msg, sev = 0) {
  EVENTS.unshift({ t: new Date(), msg, sev });
  if (EVENTS.length > 400) EVENTS.length = 400;
}
function raise(key, sev, info) {
  let a = ALERTS[key];
  if (sev > 0) {
    if (!a || !a.active) {
      ALERTS[key] = a = Object.assign({ key, sev, t: new Date(), acked: false, active: true }, info);
      logEv(`${SEVN[sev]}: ${info.where} — ${info.msg}`, sev);
      ALV++;
    } else if (sev > a.sev) {
      a.sev = sev;
      a.acked = false;
      a.msg = info.msg;
      a.t = new Date();
      logEv(`Escalated to ${SEVN[sev]}: ${info.where} — ${info.msg}`, sev);
      ALV++;
    } else if (sev !== a.sev) {
      a.sev = sev;
      a.msg = info.msg;
      ALV++;
    }
    a.val = info.val;
  } else if (a && a.active) {
    a.active = false;
    a.cleared = new Date();
    logEv(`Returned to normal: ${a.where} — ${a.tagId || ''}`);
    if (a.acked) delete ALERTS[key];
    ALV++;
  }
}
function evalAlerts() {
  const seen = new Set();
  DOC.blocks.forEach(b => {
    if (b.props.oos) return;
    b.tags.forEach(bt => {
      if (!ALCFG.limitAlarms) return; // v9.44: rules-only mode — limits do not raise Fault alarms
      const t = REG[bt.id];
      if (!t) return;
      const k = 'lim:' + t.id;
      if (seen.has(k)) return;
      const v = val(t.id);
      seen.add(k);
      // v9.44 — signal fault (bad / stale / missing value) replaces the limit check for this tag
      const kb = 'bad:' + t.id,
        bad = !RP && sigBad(t.id);
      seen.add(kb);
      raise(kb, bad ? 2 : 0, { tagId: t.id, blk: b.id, where: b.name, msg: `${t.desc} — signal fault (bad quality / no data)`, val: null });
      const s = bad ? 0 : alarmSev(k, t, v);
      const pres = t.role === 'bent' || t.role === 'coal',
        hi = v > t.typ,
        lim = s >= 3 ? (hi ? t.hh : t.ll) : s === 2 ? (hi ? t.hi : t.lo) : null;
      const msg =
        s === 1
          ? `${t.desc} approaching ${hi ? 'high' : 'low'} limit`
          : pres
            ? `${t.desc} ${fmtN(((v - t.typ) / t.typ) * 100, 1)}% vs prescription (${b.props.group})`
            : `${t.desc} ${hi ? 'high' : 'low'} — limit ${fmtN(lim, t.d)} ${t.unit}`;
      raise(k, s, { tagId: t.id, blk: b.id, where: b.name, msg, val: v });
    });
    (b.rules || []).forEach(r => {
      const t = REG[r.tag];
      if (!t) return;
      const v = val(r.tag),
        on = ALERTS['rule:' + r.id] && ALERTS['rule:' + r.id].active,
        db = on ? ALCFG.deadband * Math.abs(r.val) : 0, // v9.44: an active rule clears only after the deadband
        c = r.op === '>' ? v > r.val - db : v < r.val + db;
      const kb = 'bad:' + r.tag;
      if (!seen.has(kb)) {
        seen.add(kb);
        const bad = !RP && sigBad(r.tag);
        raise(kb, bad ? 2 : 0, { tagId: r.tag, blk: b.id, where: b.name, msg: `${t.desc} — signal fault (bad quality / no data)`, val: null });
      }
      RULET[r.id] = c ? RULET[r.id] || Date.now() : 0; // v9.44: time the condition started (delay is in SECONDS)
      const k = 'rule:' + r.id;
      seen.add(k);
      raise(k, c && Date.now() - RULET[r.id] >= (r.delay || 0) * 1000 && !sigBad(r.tag) ? r.sev : 0, {
        tagId: r.tag,
        blk: b.id,
        where: b.name,
        msg: r.msg || `${t.desc} ${r.op} ${r.val} ${t.unit}`,
        val: v,
      });
    });
  });
  DOC.streams.forEach(s => {
    if (!ALCFG.limitAlarms || !s.tag || !REG[s.tag]) return;
    const k = 'lim:' + s.tag;
    if (seen.has(k)) return;
    seen.add(k);
    const t = REG[s.tag],
      v = val(s.tag),
      kb = 'bad:' + s.tag,
      bad = !RP && sigBad(s.tag);
    seen.add(kb);
    raise(kb, bad ? 2 : 0, { tagId: s.tag, str: s.id, where: s.name, msg: `${t.desc} — signal fault (bad quality / no data)`, val: null });
    raise(k, bad ? 0 : alarmSev(k, t, v), {
      tagId: s.tag,
      str: s.id,
      where: s.name,
      msg: `${t.desc} ${v > t.typ ? 'high' : 'low'}`,
      val: v,
    });
  });
  Object.keys(ALERTS).forEach(k => {
    if (!seen.has(k)) {
      delete ALERTS[k];
      ALV++;
    }
  });
}
function blkSev(b) {
  if (RP) {
    let s = 0;
    b.tags.forEach(t => {
      if (REG[t.id]) s = Math.max(s, tagSev(t.id));
    });
    return s >= 2 ? s : 0;
  }
  let s = 0;
  for (const k in ALERTS) {
    const a = ALERTS[k];
    if (a.blk === b.id && a.active) s = Math.max(s, a.sev);
  }
  return s;
}
function ack(k) {
  const a = ALERTS[k];
  if (!a) return;
  a.acked = true;
  logEv(`Acknowledged: ${a.where} — ${a.msg}`);
  if (typeof ackNotice === 'function') ackNotice('Alarm acknowledged — ' + a.where);
  if (!a.active) delete ALERTS[k];
  ALV++;
  renderDock(true);
  renderHeader();
}
function ackAll() {
  Object.keys(ALERTS).forEach(k => {
    ALERTS[k].acked = true;
    if (!ALERTS[k].active) delete ALERTS[k];
  });
  logEv('All alerts acknowledged');
  if (typeof ackNotice === 'function') ackNotice('All alarms acknowledged');
  ALV++;
  renderDock(true);
  renderHeader();
}

/* ===== Equipment state ===== */
function phase(b) {
  const bt = b.tags.find(t => REG[t.id]?.role === 'btime');
  const T = Math.max(30, bt ? val(bt.id) : 90);
  const off = [...b.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const p = ((SIMT + off) % Math.round(T)) / T;
  return p < 0.2 ? 'LOADING' : p < 0.82 ? 'MIXING' : 'DISCHARGING';
}
function bState(b) {
  const E = EQ[b.type];
  if (E.widget || (E.notag && b.type !== 'truck')) return null;
  if (b.type === 'truck') return null;
  if (b.props.oos) return 'STOPPED';
  if (blkSev(b) >= 3) return 'FAULT';
  if (IDLE[b.id]) return 'IDLE'; // v6.1: waiting for its feed
  if (E.batch) return phase(b);
  return 'RUNNING';
}
const STC = {
  RUNNING: '#1f9d55',
  MIXING: '#1f9d55',
  LOADING: '#2b7de9',
  DISCHARGING: '#0f9d8a',
  STOPPED: '#7b8794',
  IDLE: '#94a3b8',
  FAULT: '#d93636',
};
function symState(b) {
  const lv = b.tags.find(
    t =>
      REG[t.id]?.role === 'level' ||
      (EQ[b.type].tags[0] && EQ[b.type].tags[0][9] === 'level' && t === b.tags[0]),
  );
  const first = b.tags[0] && REG[b.tags[0].id];
  return {
    level: lv && REG[lv.id] ? clamp(val(lv.id) / 100, 0, 1) : null,
    sev: first ? tagSev(first.id) : 0,
    pos:
      first && (first.role === 'vpos' || first.role === 'cvpos')
        ? val(first.id)
        : first
          ? val(first.id)
          : null,
  };
}
function rowOn(row) {
  const t = (row.targets || []).map(B).filter(Boolean);
  return t.length ? t.every(isRun) : !!row.on;
}
function hopperOf(m) {
  return srcBlocks(m)
    .map(u => (u.type === 'belt' ? srcBlocks(u)[0] : u))
    .find(u => u && u.tags.some(t => REG[t.id]?.cyc));
}
function shakeoutOf(m) {
  let q = [m],
    seen = new Set();
  for (let d = 0; d < 4 && q.length; d++) {
    const nx = [];
    for (const x of q) {
      for (const y of dstBlocks(x)) {
        if (seen.has(y.id)) continue;
        seen.add(y.id);
        if (y.type === 'shakeoutUnit' || y.type === 'shakeout') return y;
        nx.push(y);
      }
    }
    q = nx;
  }
  return null;
}
function matrixState(m) {
  const h = hopperOf(m),
    lt = h && h.tags.find(t => REG[t.id]?.cyc),
    req = lt ? !!VAL[lt.id]?.fill : false,
    so = shakeoutOf(m),
    st = bState(m);
  return [
    req,
    st && st !== 'STOPPED' && st !== 'FAULT',
    st === 'FAULT' || st === 'STOPPED',
    so ? !isRun(so) : false,
    so ? isRun(so) : false,
    !m.props.manual,
  ];
}

/* ===== Doc ops ===== */
function autoName(type) {
  const p = EQ[type].pre;
  let i = 1;
  while (DOC.blocks.some(b => b.name === `${p}-${i}`)) i++;
  return `${p}-${i}`;
}
function addBlock(type, x, y, o = {}) {
  const E = EQ[type],
    id = 'b' + DOC.seq++,
    name = o.name || autoName(type);
  const b = {
    id,
    type,
    name,
    x: Math.round(x),
    y: Math.round(y),
    flip: !!o.flip,
    rot: o.rot || 0,
    tags: [],
    tagOff: { x: (o.off || [0, 0])[0], y: (o.off || [0, 0])[1] },
    props: Object.assign({ desc: '', oos: false }, JSON.parse(JSON.stringify(E.props || {})), o.props || {}),
    rules: [],
  };
  if (o.w) b.w = o.w;
  if (o.h) b.h = o.h;
  if (o.bind) {
    o.bind.forEach(t => b.tags.push({ id: t, show: o.showBind !== false }));
  } else
    E.tags.forEach((t, i) => {
      const tid = `${name}.${t[0]}`,
        ov = (o.tagset || {})[t[0]] || {};
      if (!REG[tid])
        mkTag(
          tid,
          Object.assign(
            {
              desc: t[1],
              unit: t[2],
              typ: t[3],
              ll: t[4],
              lo: t[5],
              hi: t[6],
              hh: t[7],
              noise: t[8],
              role: t[9],
              d: t[10],
              lab: t[11] || 0,
              cyc: t[12] || null,
              src: t[11] ? 'SandMan Lab' : 'SandMan Gateway',
              addr: `ns=2;s=${name}.${t[0]}`,
            },
            ov,
          ),
        );
      {
        const sp = E.tagSpec && E.tagSpec[t[0]];
        if (sp && REG[tid] && REG[tid].min == null && !REG[tid].cfg) {
          Object.keys(sp).forEach(k => {
            if (sp[k] != null) REG[tid][k] = sp[k];
          });
          if (sp.sd > 0) REG[tid].cfg = true;
        }
      }
      b.tags.push({
        id: tid,
        show: o.show ? o.show.includes(t[0]) : E.inst ? true : i < 1 && t[9] !== 'level',
      });
    });
  if (b.tags.some(t => REG[t.id]?.role === 'bent')) applyPresc(b);
  if (type === 'areaBox') DOC.blocks.unshift(b);
  else DOC.blocks.push(b);
  return b;
}
function portLinks(bid, pid) {
  return DOC.streams.filter(
    s => (s.from.b === bid && s.from.p === pid) || (s.to.b === bid && s.to.p === pid),
  );
}
function canConnect(a, ap, b, bp) {
  const A = portOf(B(a), ap),
    Bp = portOf(B(b), bp);
  if (!A || !Bp) return 'Port not found';
  if (a === b) return 'Cannot connect equipment to itself';
  if (A.dir === Bp.dir && A.dir !== 'io') return 'Connect an outlet to an inlet';
  const ok = (k1, k2) =>
    k1 === k2 || k1 === 'any' || k2 === 'any' || (k1 !== 'metal' && k2 !== 'metal' && k1 !== 'data' && k2 !== 'data');
  if (!ok(A.kind, Bp.kind)) return `${KIND[A.kind].n} cannot connect to ${KIND[Bp.kind].n.toLowerCase()}`;
  if (
    DOC.streams.some(
      s =>
        (s.from.b === a && s.from.p === ap && s.to.b === b && s.to.p === bp) ||
        (s.from.b === b && s.from.p === bp && s.to.b === a && s.to.p === ap),
    )
  )
    return 'These ports are already connected';
  return null;
}
function streamKind(s) {
  const o = portOf(B(s.from.b), s.from.p),
    i = portOf(B(s.to.b), s.to.p);
  if (o && o.kind !== 'any') return o.kind;
  if (i && i.kind !== 'any') return i.kind;
  const up = DOC.streams.find(x => x.to.b === s.from.b && x !== s);
  return up ? up.kind : 'sand';
}
function connect(a, ap, b, bp, kind) {
  const A = portOf(B(a), ap),
    Bp = portOf(B(b), bp);
  let from = { b: a, p: ap },
    to = { b, p: bp };
  if (A.dir === 'in' || (A.dir === 'io' && Bp.dir === 'out')) [from, to] = [to, from];
  let n = 1;
  while (DOC.streams.some(s => s.name === 'S' + n)) n++;
  const s = { id: 's' + DOC.seq++, name: 'S' + n, from, to, kind: 'sand', tag: null, mid: null };
  DOC.streams.push(s);
  s.kind = kind || streamKind(s);
  return s;
}
function delBlock(id) {
  const b = B(id);
  DOC.streams = DOC.streams.filter(s => s.from.b !== id && s.to.b !== id);
  DOC.blocks = DOC.blocks.filter(x => x.id !== id);
  b.tags.forEach(t => {
    if (t.id.startsWith(b.name + '.') && !tagOwner(t.id)) delete REG[t.id];
  });
  DOC.blocks.forEach(o => {
    if (o.props.rows)
      o.props.rows.forEach(r => {
        if (r.targets) r.targets = r.targets.filter(x => x !== id);
        if (r.target === id) r.target = null;
      });
    if (o.props.cols) o.props.cols = o.props.cols.filter(x => x !== id);
    if (o.props.target === id) o.props.target = null;
  });
}
function dupBlock(b) {
  const nb = addBlock(b.type, b.x + 30, b.y + 30, {
    flip: b.flip,
    rot: b.rot,
    w: b.w,
    h: b.h,
    props: JSON.parse(JSON.stringify(b.props)),
  });
  nb.tagOff = { ...b.tagOff };
  return nb;
}

/* ===== Undo & persistence ===== */
function snap() {
  try {
    syncDocCustom();
  } catch (e) {}
  // v6.0: in the publish view "Fill screen" the layout is spread temporarily — snapshots always keep the original
  return typeof spreadSuspend === 'function' ? spreadSuspend(() => JSON.stringify({ DOC, REG })) : JSON.stringify({ DOC, REG });
}
function pushUndo() {
  UNDO.push(snap());
  if (UNDO.length > 60) UNDO.shift();
  REDO = [];
}
function restore(sn) {
  const o = JSON.parse(sn);
  registerDocCustom(o.DOC);
  DOC = o.DOC;
  REG = o.REG;
  for (const id in REG) ensureVal(id);
  if (SEL && !(SEL.t === 'b' ? B(SEL.id) : Sx(SEL.id))) SEL = null;
}
function undo() {
  if (!UNDO.length) return;
  REDO.push(snap());
  restore(UNDO.pop());
  changed();
  toast('Undone');
}
function redo() {
  if (!REDO.length) return;
  UNDO.push(snap());
  restore(REDO.pop());
  changed();
  toast('Redone');
}
let saveT;
function saveNow() {
  clearTimeout(saveT);
  saveT = 0;
  try {
    localStorage.setItem(LS, snap());
    save.failed = false;
  } catch (e) {
    // v6.2: never lose work silently — tell the user once when the browser refuses to store the flowsheet
    if (!save.failed) {
      save.failed = true;
      try {
        toast('Could not save in this browser (storage full). Use Save › Export to keep a copy of this flowsheet.');
        logEv('Autosave failed: browser storage is full', 2);
      } catch (e2) {}
    }
  }
}
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 300);
}
// v6.2: write a pending change at once when the page is closed, reloaded or hidden (no lost last edit)
['pagehide', 'beforeunload'].forEach(ev => addEventListener(ev, () => saveT && saveNow()));
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveT && saveNow());
function changed() {
  try {
    TRC.clear();
    chainFor.c = {};
  } catch (e) {}
  save();
  renderAll();
}
