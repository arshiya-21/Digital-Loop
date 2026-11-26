/*! SandMan Digital Loop Studio — 27k-anim-auto.js
 *  v10.0 — Data-driven animation for any plant, without setting every machine by hand.
 *  1. Each equipment type says what moves: belts and feeders (flow), muller / motors / fans (rotation), moulding lines
 *     (mould steps), sieves / shakeouts / coolers (motion).
 *  2. Readings are recognised by kind from their name and unit: moulds per hour, mould counter, speed (rpm, m/s),
 *     load (t/h), current (A), running status.
 *  3. Each machine automatically uses its best reading for its type, in this order:
 *       moulding line  → moulds per hour · mould counter (turned into a rate) · running status
 *       belt / feeder  → speed · load · current · running status
 *       muller / motor → speed · current · running status
 *       sieve / cooler → speed · current · running status
 *     speed = reading ÷ its normal value (the tag's typical value, else the median of its history).
 *  4. Fallbacks: a machine with no suitable reading stops when every machine feeding it has stopped; otherwise it keeps
 *     today's fixed animation. Missing data never stops a drawing; only a real 0 / "stopped" does.
 *  A drive set by hand in Properties › Animation always wins; "Fixed" switches the automatic drive off for that machine.
 *  Animation › "All equipment…" lists every machine with its driver, so a new plant is checked in one place. */

const AN_CLS = [
  ['mould', /disa|mould|mold|pouring/i],
  ['flow', /belt|conveyor|screw|feeder|elevator|plough|disc/i],
  ['rotate', /muller|mixer|motor|fan|aerator|pump|rotor/i],
  ['motion', /sieve|screen|shake|cooler|vibrat|separator|cyclone/i],
];
const AN_CLS_TXT = { mould: 'Moulding line', flow: 'Belt / feeder', rotate: 'Muller / motor / fan', motion: 'Sieve / shakeout / cooler' };
const AN_ROLES = { mould: ['rate', 'counter', 'running'], flow: ['speed', 'load', 'current', 'running'], rotate: ['speed', 'current', 'running'], motion: ['speed', 'current', 'running'] };
const AN_ROLE_TXT = { rate: 'moulds per hour', counter: 'mould counter', speed: 'speed', load: 'load', current: 'motor current', running: 'running status' };
function anClass(b) {
  const E = b && EQ[b.type];
  if (!E || E.widget) return null;
  const s = b.type + ' ' + (E.n || '');
  const m = AN_CLS.find(([, r]) => r.test(s));
  return m ? m[0] : null;
}
/* what kind of reading a tag is, from its name and unit */
function anRole(id) {
  const t = REG[id];
  if (!t) return null;
  const s = (id + ' ' + (t.short || '') + ' ' + (t.desc || '')).toUpperCase(),
    u = String(t.unit || '').toLowerCase();
  if (tagIsText(t)) return /STATUS|RUN|STATE|\bON\b/.test(s) ? 'running' : null;
  if (/MOULD|MOLD/.test(s) && (/\/H|PER.?HOUR|RATE/.test(s) || u.includes('/h'))) return 'rate';
  if (/MOULD|MOLD/.test(s) && /COUNT|TOTAL/.test(s)) return 'counter';
  if (/SPEED|RPM/.test(s) || ['rpm', 'm/s', 'm/min'].includes(u)) return /SET\b|_SET/.test(s) ? null : 'speed';
  if (/\bLOAD\b|_LOAD/.test(s) || u === 't/h') return 'load';
  if (/CURRENT|AMP/.test(s) || u === 'a') return 'current';
  return null;
}
function anAuto(b) {
  if (!b || !b.props || b.props.driveAuto === false) return null;
  const c = anClass(b);
  if (!c) return null;
  const order = AN_ROLES[c];
  const cand = (b.tags || [])
    .map(t => t.id)
    .filter(id => REG[id])
    .map(id => ({ id, role: anRole(id) }))
    .filter(x => x.role && order.includes(x.role))
    .sort((x, y) => order.indexOf(x.role) - order.indexOf(y.role));
  const x = cand[0];
  if (!x) return { auto: true, cls: c, mode: 'upstream' };
  return { auto: true, cls: c, tag: x.id, role: x.role, mode: { rate: 'rate', counter: 'counter', running: 'run' }[x.role] || 'speed' };
}
/* normal value of a speed / load / current reading */
function anRef(id) {
  const t = REG[id];
  if (t.typ > 0) return t.typ;
  const h = (VAL[id] && VAL[id].h) || [];
  if (h.length < 20) return null;
  const s = h.map(p => p.v).filter(v => v > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}
/* a counter turned into a rate per hour (needs at least 10 minutes of history) */
function anCounterRate(id) {
  const h = (VAL[id] && VAL[id].h) || [];
  if (h.length < 2) return null;
  const a = h[0],
    z = h[h.length - 1],
    hrs = (z.t - a.t) / 3600000;
  return hrs < 1 / 6 ? null : (z.v - a.v) / hrs;
}
const drvOfManual = drvOf,
  drvKeyManual = drvKey,
  drvTextManual = drvText;
/* key from the machine's own reading (manual drive first) */
function anKeyOwn(b) {
  if (drvOfManual(b)) return drvKeyManual(b);
  const a = anAuto(b);
  if (!a || !a.tag) return '';
  const v = val(a.tag);
  if (a.mode === 'run') {
    const s = String(tagTxt(a.tag)).toUpperCase();
    return /STOP|OFF|FALSE|FAULT/.test(s) || v === 0 ? 'stop' : '';
  }
  if (v == null || !isFinite(v)) return ''; // no data: keep the fixed animation
  if (a.mode === 'rate' || a.mode === 'counter') {
    const r = a.mode === 'rate' ? v : anCounterRate(a.tag);
    if (r == null) return '';
    if (r <= 0) return 'stop';
    const c = clamp(3600 / r, 0.5, 900);
    return 'c' + (c < 10 ? Math.round(c * 10) / 10 : Math.round(c));
  }
  if (v <= 0) return 'stop';
  const ref = anRef(a.tag);
  if (!ref) return '';
  return 's' + Math.round(clamp(v / ref, 0.25, 3) * 4) / 4; // steps of 25 % so the drawing is not redrawn for noise
}
/* nearest machines upstream that have a reading of their own (passes through belts without one, up to 6 steps) */
function anUpReaders(b) {
  if (typeof srcBlocks !== 'function') return [];
  const out = [],
    seen = new Set([b.id]);
  let front = [b];
  for (let d = 0; d < 6 && front.length; d++) {
    const nx = [];
    front.forEach(x =>
      srcBlocks(x).forEach(u => {
        if (!u || seen.has(u.id)) return;
        seen.add(u.id);
        if (drvOf(u)) out.push(u);
        /* pass through junctions and machines without a reading, but not through silos / bins (they buffer sand) */
        else if (u.type === 'junction' || (anClass(u) && !/silo|bin|hopper|tank/i.test(u.type + ' ' + (EQ[u.type].n || '')))) nx.push(u);
      }),
    );
    front = nx;
  }
  return out;
}
drvOf = function (b) {
  const m = drvOfManual(b);
  if (m) return m;
  const a = anAuto(b);
  return a && a.tag ? a : null;
};
drvKey = function (b) {
  if (MODE !== 'monitor' || !b) return '';
  if (drvOfManual(b)) return drvKeyManual(b);
  const a = anAuto(b);
  if (!a) return '';
  if (a.mode !== 'upstream') return anKeyOwn(b);
  /* no reading of its own: stop when every machine feeding it (that has a reading) has stopped */
  const src = anUpReaders(b);
  return src.length && src.every(u => anKeyOwn(u) === 'stop') ? 'stop' : '';
};
drvText = function (b) {
  if (drvOfManual(b)) return drvTextManual(b);
  const a = anAuto(b);
  if (!a) return '';
  if (MODE !== 'monitor') return 'Takes effect in Simulate / Publish';
  const k = drvKey(b);
  if (a.mode === 'upstream') return k === 'stop' ? 'Stopped: every machine feeding it has stopped' : 'Fixed pace; stops when every machine feeding it stops';
  const t = REG[a.tag],
    nm = (typeof plNice === 'function' ? plNice : x => x)(t.short || t.desc || a.tag.split('.').pop()),
    v = val(a.tag),
    vt = v == null ? 'no data' : tagTxt(a.tag);
  if (k === 'stop') return `${nm} is ${vt} — the drawing stands still`;
  if (k[0] === 'c') return `${nm} ${vt} → one mould every ${k.slice(1)} s`;
  if (k[0] === 's') return `${nm} ${vt} → ${Math.round(+k.slice(1) * 100)} % of normal speed`;
  return a.mode === 'run' ? `${nm} ${vt} → moves at normal pace` : `${nm}: ${vt} — fixed pace until there is data`;
};
const anDriverTxt = b => {
  if (drvOfManual(b)) return 'Set by hand';
  if (b.props && b.props.driveAuto === false) return 'Fixed';
  const a = anAuto(b);
  return !a ? '—' : a.mode === 'upstream' ? 'Follows the machines feeding it' : 'Automatic · ' + AN_ROLE_TXT[a.role];
};
/* Properties › Animation: Automatic (default) · Fixed · Moulds/hour · From a reading */
drvSection = function (b) {
  const E = EQ[b.type],
    d = (b.props && b.props.drive) || {},
    man = !!(d.mode && d.mode !== 'fixed'),
    mode = man ? d.mode : b.props.driveAuto === false ? 'fixed' : 'auto',
    isMould = anClass(b) === 'mould' || /disa|mould|mold|pouring/i.test(b.type + ' ' + (E.n || '')),
    a = anAuto(Object.assign({}, b, { props: Object.assign({}, b.props, { driveAuto: true }) }));
  const tags = b.tags.map(t => t.id).filter(id => REG[id] && !tagIsText(REG[id]));
  const all = Object.keys(REG).filter(id => !tagIsText(REG[id]) && !tags.includes(id));
  const opt = id => `<option value="${esc(id)}" ${d.tag === id ? 'selected' : ''}>${esc(REG[id].short || REG[id].desc || id)} — ${esc(id)}</option>`;
  const M = [['auto', 'Automatic'], ['fixed', 'Fixed'], ...(isMould || mode === 'rate' ? [['rate', 'Moulds/h']] : []), ['speed', 'From a reading']];
  let body;
  if (mode === 'auto')
    body = `<div class="drv-now" id="drvNow">${esc(drvText(b))}</div>
     <p class="lc2-note">${a && a.tag ? `Uses <b>${esc(plNice(REG[a.tag].short || a.tag.split(".").pop()))}</b> (${AN_ROLE_TXT[a.role]}), the best reading this ${esc(AN_CLS_TXT[a.cls].toLowerCase())} has.` : `No speed, load, current, rate or running reading is bound, so it follows the machines feeding it.`} Bind a better reading or choose one by hand to change it.</p>`;
  else if (mode === 'fixed') body = `<p class="lc2-note">The drawing moves at its own fixed pace while the equipment runs, and stops when it stops.</p>`;
  else
    body = `<div class="fld"><label>${mode === 'rate' ? 'Moulds-per-hour tag' : 'Reading that sets the speed'}</label><select id="drvTag"><option value="">Choose…</option>${tags.length ? `<optgroup label="${esc(b.name)}">${tags.map(opt).join('')}</optgroup>` : ''}<optgroup label="Other tags">${all.map(opt).join('')}</optgroup></select></div>
     ${mode === 'speed' ? `<div class="fld"><label>Normal value (= normal speed)</label><input id="drvRef" type="number" step="any" value="${d.ref != null ? esc(d.ref) : ''}" placeholder="${d.tag && REG[d.tag] && REG[d.tag].typ != null ? 'tag typical: ' + REG[d.tag].typ : 'e.g. 120'}"></div>` : ''}
     <div class="drv-now" id="drvNow">${d.tag ? esc(drvText(b)) : 'Choose the tag'}</div>`;
  return `<section class="ix-sec drv" id="drvSec"><h4>Animation <span class="ix-sum">${{ auto: 'automatic', fixed: 'fixed', rate: 'moulds per hour', speed: 'follows a reading' }[mode]}</span></h4>
   <div class="lc2-seg drv-m">${M.map(([m, l]) => `<button type="button" data-anm="${m}" aria-pressed="${mode === m}">${l}</button>`).join('')}</div>
   ${body}
   <p class="lc2-note">No data never stops a drawing; a real 0 or "stopped" does. Equipment in alarm shows its alarm colour.</p>
   <button type="button" class="lce-lk drv-all" id="anAll">All equipment drivers…</button></section>`;
};
{
  const _rp = renderProps;
  renderProps = function () {
    _rp();
    try {
      const S = document.getElementById('drvSec'),
        b = SEL && SEL.t === 'b' ? B(SEL.id) : null;
      if (!S || !b) return;
      S.querySelectorAll('[data-anm]').forEach(
        x =>
          (x.onclick = () => {
            pushUndo();
            const m = x.dataset.anm;
            if (m === 'auto') (delete b.props.drive, delete b.props.driveAuto);
            else if (m === 'fixed') (delete b.props.drive, (b.props.driveAuto = false));
            else (b.props.drive = Object.assign({}, b.props.drive || {}, { mode: m })), delete b.props.driveAuto;
            changed();
            renderProps();
          }),
      );
      const all = S.querySelector('#anAll');
      if (all) all.onclick = anList;
    } catch (e) {}
  };
}
/* every machine that moves, with its driver: the place to check a new plant */
function anList() {
  const rows = DOC.blocks
    .filter(b => anClass(b) && ((EQ[b.type].def && EQ[b.type].def.anim2) || b.type === 'belt'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const n = { auto: 0, up: 0, man: 0, fix: 0 };
  rows.forEach(b => {
    const t = anDriverTxt(b);
    t.startsWith('Automatic') ? n.auto++ : t.startsWith('Follows') ? n.up++ : t === 'Set by hand' ? n.man++ : n.fix++;
  });
  openModal(
    `<h3>Animation drivers</h3><div class="note">Every machine that moves, and what drives its animation. Values update in Simulate / Publish.</div>
   <div class="an-sum"><span><b>${n.auto}</b> automatic from a reading</span><span><b>${n.up}</b> follow the machines feeding them</span><span><b>${n.man}</b> set by hand</span><span><b>${n.fix}</b> fixed</span></div>
   <div class="tbl-wrap" style="max-height:56vh;overflow:auto"><table class="an-t"><thead><tr><th>Equipment</th><th>Type</th><th>Driver</th><th>Now</th><th></th></tr></thead><tbody>${rows
     .map(b => `<tr><td><b>${esc(b.name)}</b></td><td>${esc(AN_CLS_TXT[anClass(b)])}</td><td>${esc(anDriverTxt(b))}</td><td class="an-now" data-anb="${b.id}">${esc(drvText(b) || 'Fixed pace')}</td><td><button type="button" class="ib" data-ano="${b.id}">Open</button></td></tr>`)
     .join('')}</tbody></table></div>
   <div class="mact"><button class="ib pri" id="anClose">Close</button></div>`,
    'wide',
  );
  $('#anClose').onclick = closeModal;
  $$('#mbox [data-ano]').forEach(x => (x.onclick = () => (closeModal(), select({ t: 'b', id: x.dataset.ano }), (PTAB = 'eq'), renderProps())));
  const tick = setInterval(() => {
    if (!$('#modal').classList.contains('on') || !$('#mbox .an-t')) return clearInterval(tick);
    $$('#mbox [data-anb]').forEach(td => {
      const b = B(td.dataset.anb);
      if (b) td.textContent = drvText(b) || 'Fixed pace';
    });
  }, 1000);
}
document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
.drv .drv-all{margin-top:4px;border:0;background:none;color:#1f6feb;font:600 12.5px var(--sans);cursor:pointer;padding:0}
.an-sum{display:flex;flex-wrap:wrap;gap:8px 18px;margin:10px 0;font-size:13px;color:var(--muted)}.an-sum b{color:var(--text);font:600 15px var(--mono)}
.an-t{width:100%;border-collapse:collapse;font-size:13px}.an-t th,.an-t td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
.an-t td.an-now{color:var(--muted);font-size:12.5px}
</style>`,
);
