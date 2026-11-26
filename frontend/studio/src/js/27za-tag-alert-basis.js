/*! SandMan Digital Loop Studio — 27za-tag-alert-basis.js
 *  v10.4 — "Alert on" for every parameter: tick what makes an alert for this tag.
 *    ☑ Limits      — the configured LL / L / H / HH (on by default)
 *    ☐ Nelson rules — control-chart rules (Western Electric 1, 2, 5, 6) on its recent readings
 *    ☐ Drift       — EWMA: slow, small shift away from its normal level
 *    ☐ Forecast    — the trend will reach its L or H limit within 30 min
 *    ☐ Stuck       — the value has not changed / no new data for 15 min (sensor or data link)
 *  Set in the tag's Alarm limits (Properties › Readings › Edit) and in Alerts setup › Tag alerts.
 *  Stored on the tag: REG[id].aon = { lim, spc, drift, fc, stuck }. Alerts raised: 'st:<tag>:<kind>' — emailed,
 *  routed and turned into tickets exactly like limit alarms, using the same per-parameter email / ticket settings. */

const AON = [
  ['lim', 'Limits', 'the configured L / H and LL / HH'],
  ['spc', 'Nelson rules', 'control-chart rules: beyond 3σ, 2 of 3 beyond 2σ, 4 of 5 beyond 1σ, 8 on one side'],
  ['drift', 'Drift', 'EWMA — a slow, small shift from its normal level'],
  ['fc', 'Forecast', 'the trend reaches L or H within 30 min'],
  ['stuck', 'Stuck / no data', 'no change or no new reading for 15 min'],
];
/* one basis per parameter: t.aon = { mode: 'lim' | 'spc' | 'drift' | 'fc' | 'stuck' | 'off' } (older ticks → first ticked) */
function aonMode(t) {
  return 'lim'; // v10.4 final: tags alert on their limits only; statistics belong to engineered alerts
  const a = (t && t.aon) || {};
  if (a.mode) return a.mode;
  const old = ['spc', 'drift', 'fc', 'stuck'].find(k => a[k]);
  if (a.lim === false) return old || 'off';
  return 'lim';
}
function aonOf(t) {
  const m = aonMode(t);
  return { lim: m === 'lim', spc: m === 'spc', drift: m === 'drift', fc: m === 'fc', stuck: m === 'stuck' };
}
function aonHTML(t) {
  return '';
  const a = aonOf(t);
  const m = aonMode(t);
  return `<div class="aon"><div class="aon-h">Alert on (one)</div>${[...AON, ['off', 'No alert', 'this parameter never raises an alert']].map(([k, l, h]) => `<label title="${esc(h)}"><input type="radio" name="aon-${esc(t.id)}" data-aon="${esc(t.id)}|${k}" ${m === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>`;
}
document.addEventListener(
  'change',
  e => {
    const i = e.target;
    if (!i.matches || !i.matches('[data-aon]')) return;
    const [id, k] = i.dataset.aon.split('|');
    const t = REG[id];
    if (!t) return;
    pushUndo();
    t.aon = { mode: k };
    /* clear alerts of the other bases */
    Object.keys(ALERTS).filter(x => (x === 'lim:' + id && k !== 'lim') || (x.startsWith(`st:${id}:`) && x !== `st:${id}:${k}`)).forEach(x => raise(x, 0, {}));
    save();
    if (typeof changed === 'function') changed();
    e.stopPropagation();
    if ($('#asBody') && typeof AS !== 'undefined' && AS.tab === 3) asRender();
  },
  true,
);
/* limits switched off → no limit alarm for this tag */
{
  const prev = raise;
  raise = function (key, sev, info) {
    if (sev > 0 && key.startsWith('lim:')) {
      const t = REG[key.slice(4)];
      if (t && aonMode(t) !== 'lim') sev = 0;
    }
    return prev.call(this, key, sev, info);
  };
}
/* the statistical checks, every 2 s while live */
const AON_ST = {};
function aonTick() {
  if (MODE !== 'monitor' || RP) return;
  const now = Date.now();
  for (const b of DOC.blocks) {
    if (!b.tags || (b.props && b.props.oos)) continue;
    for (const bt of b.tags) {
      const t = REG[bt.id];
      if (!t || !t.aon || tagIsText(t)) continue;
      const a = aonOf(t);
      if (!a.spc && !a.drift && !a.fc && !a.stuck) continue;
      const v = val(t.id),
        R = { id: 'tag:' + t.id },
        buf = engBuf(R, 'A', t.id, v, now),
        nm = t.short || t.desc || t.id,
        where = b.name;
      const fire = (k, on, msg, sev = 2) => raise(`st:${t.id}:${k}`, on ? sev : 0, { where, msg: `${nm} — ${msg}`, blk: b.id, tagId: t.id, val: v });
      if (a.spc) {
        const c = (AON_ST[t.id + 'spc'] = AON_ST[t.id + 'spc'] || { op: 'spc', v: 1, v2: 300 });
        const r = engStatTest(c, buf, v);
        fire('spc', r === true, `out of control (Nelson rule ${(c._st && c._st.rule) || ''})`);
      }
      if (a.drift) {
        const c = (AON_ST[t.id + 'ew'] = AON_ST[t.id + 'ew'] || { op: 'ewma', v: 0.2, v2: 300 });
        const r = engStatTest(c, buf, v);
        fire('drift', r === true, `drifting from its normal level (EWMA ${c._st && c._st.e != null ? fmtN(c._st.e, t.d) : ''})`);
      }
      if (a.fc) {
        let hit = null;
        for (const [lim, side] of [[t.hi, 'H'], [t.lo, 'L']]) {
          if (lim == null) continue;
          const c = (AON_ST[t.id + 'fc' + side] = AON_ST[t.id + 'fc' + side] || { op: 'predict', v: lim, v2: 30, v3: 60 });
          c.v = lim;
          if (engStatTest(c, buf, v) === true) hit = { side, lim, eta: c._st && c._st.eta };
        }
        fire('fc', !!hit, hit ? `will reach ${hit.side === 'H' ? 'high' : 'low'} limit ${fmtN(hit.lim, t.d)} in ~${Math.max(1, Math.round(hit.eta || 0))} min` : 'forecast', 1);
      }
      if (a.stuck) {
        const s = (AON_ST[t.id + 'st'] = AON_ST[t.id + 'st'] || { v, ts: VAL[t.id] && VAL[t.id].ts, since: now });
        const ts = VAL[t.id] && VAL[t.id].ts;
        if (v !== s.v) Object.assign(s, { v, ts, since: now });
        const mins = (now - s.since) / 60000;
        fire('stuck', mins > 15, `not changing / no new data for ${Math.round(mins)} min — check the sensor or data link`, 1);
      }
    }
  }
}
setInterval(() => {
  try {
    aonTick();
  } catch (e) {
    console.warn('alert basis', e);
  }
}, 2000);
/* routing, email on/off, tickets: an 'st:' alert belongs to its parameter */
{
  const infoPrev = rtInfo;
  rtInfo = function (key) {
    if (!key.startsWith('st:')) return infoPrev(key);
    const m = /^st:(.+):(\w+)$/.exec(key),
      id = m ? m[1] : '',
      i = infoPrev('lim:' + id);
    return Object.assign(i, { key, name: (REG[id] ? REG[id].short || REG[id].desc || id : id) + ' — ' + ({ spc: 'out of control', drift: 'drifting', fc: 'heading to limit', stuck: 'stuck / no data' }[m && m[2]] || '') });
  };
  const mPrev = rtMatch;
  rtMatch = function (info, sev) {
    const m = mPrev(info, sev),
      R = rtDoc();
    const id = /^st:(.+):\w+$/.exec(info.key);
    if (id && R.mute && R.mute['lim:' + id[1]]) return Object.assign({}, m, { emails: [] });
    return m;
  };
  if (typeof tkwKeyOf === 'function') {
    const kPrev = tkwKeyOf;
    tkwKeyOf = function (key) {
      const m = /^st:(.+):\w+$/.exec(key);
      return m ? 'lim:' + m[1] : kPrev(key);
    };
  }
}
setInterval(() => {
  try {
    if (MODE !== 'monitor' || RP) return;
    for (const k in ALERTS) {
      const a = ALERTS[k];
      if (!k.startsWith('st:') || !a.active || a.sev < 1) continue;
      const id = /^st:(.+):\w+$/.exec(k)[1];
      tkHit(k, a.msg, a.blk, Math.max(2, a.sev), { [REG[id] ? REG[id].short || REG[id].desc || id : id]: val(id) });
    }
  } catch (e) {}
}, 5000);
document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="aonCss">
.aon{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;margin:8px 0;font-size:12.5px}.aon-h{font-weight:700;font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;width:100%}
.aon label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.as-aon{display:flex;flex-wrap:wrap;gap:4px}.as-aon label{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:12px;padding:2px 9px;font-size:12px;cursor:pointer}.as-aon label.on{background:#1f6feb;border-color:#1f6feb;color:#fff}.as-aon label.off.on{background:#64748b;border-color:#64748b}.as-aon input{display:none}
</style>`,
);
