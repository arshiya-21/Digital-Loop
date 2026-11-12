/*! SandMan Digital Loop Studio — 01b-status-lamp.js (v9.54)
 *  Status lamp (LED dot): one data tag → a colour, set by rules in the Properties panel.
 *  Rules are checked from the top, the first match wins:
 *    bool  — the value is TRUE / FALSE (1/0, on/off, yes/no, run/stop are understood)
 *    text  — the value equals a text (capitals ignored), e.g. Yes → green, No → blue
 *    range — a number from v up to (not including) v2, e.g. 85…999 °C → red
 *  plus a colour when no rule matches and one when there is no data. Each rule may blink and show its own text. */
const LAMP_PAL = [
  ['Green', '#22c55e'],
  ['Red', '#ef4444'],
  ['Amber', '#f59e0b'],
  ['Blue', '#3b82f6'],
  ['White', '#f1f5f9'],
  ['Purple', '#a855f7'],
  ['Cyan', '#06b6d4'],
  ['Grey', '#6b7280'],
];
const LAMP_PRE = {
  bool: { n: 'True / False', rules: [{ t: 'bool', v: 'true', c: '#22c55e', l: 'Running' }, { t: 'bool', v: 'false', c: '#ef4444', l: 'Stopped' }] },
  yn: { n: 'Yes / No', rules: [{ t: 'text', v: 'Yes', c: '#22c55e', l: 'Yes' }, { t: 'text', v: 'No', c: '#3b82f6', l: 'No' }] },
  mode: {
    n: 'Auto / Manual / Off',
    rules: [{ t: 'text', v: 'Auto', c: '#22c55e', l: 'Auto' }, { t: 'text', v: 'Manual', c: '#f59e0b', l: 'Manual' }, { t: 'text', v: 'Off', c: '#6b7280', l: 'Off' }],
  },
  range: {
    n: 'Number ranges',
    rules: [
      { t: 'range', v: '0', v2: '70', c: '#22c55e', l: 'Normal' },
      { t: 'range', v: '70', v2: '85', c: '#f59e0b', l: 'Warm' },
      { t: 'range', v: '85', v2: '9999', c: '#ef4444', l: 'Too hot', b: true },
    ],
  },
};
const LAMP_TRY = {}; // block id → test value typed in the panel (not saved)
const lampCfg = b => {
  if (!b.props.lamp) b.props.lamp = { rules: JSON.parse(JSON.stringify(LAMP_PRE.bool.rules)), def: '#f59e0b', none: '#6b7280', txt: true };
  return b.props.lamp;
};
const lampCName = c => (LAMP_PAL.find(p => p[1] === c) || [c])[0];
function lampBool(x) {
  if (typeof x === 'number') return x >= 0.5;
  const s = String(x).trim().toLowerCase();
  if (['true', '1', 'on', 'yes', 'y', 'run', 'running', 'ok', 'high'].includes(s)) return true;
  if (['false', '0', 'off', 'no', 'n', 'stop', 'stopped', 'low'].includes(s)) return false;
  const n = parseFloat(s);
  return isNaN(n) ? null : n >= 0.5;
}
/* the raw value of the lamp's tag: its text (text tags), its label (status-list tags) or its number */
function lampRaw(b) {
  if (b && LAMP_TRY[b.id] != null) return LAMP_TRY[b.id];
  const bt = b && b.tags && b.tags[0],
    t = bt && typeof REG !== 'undefined' && REG[bt.id];
  if (!t) return b && String(b.id).startsWith('pal_') ? 1 : null;
  if (t.txt != null && t.txt !== '') return t.txt;
  const v = val(t.id);
  if (v == null) return null;
  if (t.states) {
    const s = t.states[Math.round(v)];
    if (s != null) return s;
  }
  return v;
}
function lampEval(cfg, raw) {
  if (raw == null || String(raw).trim() === '') return { c: cfg.none, l: 'No data', off: true, k: -2 };
  for (let i = 0; i < cfg.rules.length; i++) {
    const r = cfg.rules[i];
    let ok = false;
    if (r.t === 'bool') {
      const x = lampBool(raw);
      ok = x !== null && x === (r.v === 'true');
    } else if (r.t === 'text') {
      // a status-list number can still match a text rule when the text is that number
      ok = String(raw).trim().toLowerCase() === String(r.v == null ? '' : r.v).trim().toLowerCase();
    } else if (r.t === 'range') {
      const n = typeof raw === 'number' ? raw : parseFloat(raw),
        lo = parseFloat(r.v),
        hi = parseFloat(r.v2);
      ok = !isNaN(n) && (isNaN(lo) || n >= lo) && (isNaN(hi) || n < hi);
    }
    if (ok) return { c: r.c, l: r.l || '', b: !!r.b, k: i };
  }
  return { c: cfg.def, l: '', k: -1 };
}
function lampSvg(w, h, res, uid, showTxt) {
  const cx = w / 2,
    R = Math.min(w, h - (showTxt ? 12 : 0)) / 2 - 1,
    cy = R + 1,
    g = 'lmp' + String(uid).replace(/[^\w-]/g, ''),
    c = res.c,
    ph = res.b ? `style="animation-delay:-${((Date.now() % 1000) / 1000).toFixed(2)}s"` : '';
  return `<defs><radialGradient id="${g}l" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".25" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".78"/></radialGradient>
<radialGradient id="${g}h" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${c}" stop-opacity=".75"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
<linearGradient id="${g}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3e8ed"/><stop offset=".5" stop-color="#9aa4ae"/><stop offset="1" stop-color="#5d6670"/></linearGradient></defs>
<g class="slamp${res.b ? ' blink' : ''}${res.off ? ' off' : ''}">
${res.off ? '' : `<circle class="sl-glow" cx="${cx}" cy="${cy}" r="${R * 1.55}" fill="url(#${g}h)" ${ph}/>`}
<circle cx="${cx}" cy="${cy}" r="${R}" fill="#11161b" stroke="url(#${g}s)" stroke-width="${Math.max(1.5, R * 0.14)}"/>
<circle class="sl-lit" cx="${cx}" cy="${cy}" r="${R * 0.74}" fill="url(#${g}l)" ${ph}/>
<ellipse cx="${cx - R * 0.26}" cy="${cy - R * 0.26}" rx="${R * 0.26}" ry="${R * 0.17}" fill="#fff" opacity=".6"/>
${showTxt && res.l ? `<text x="${cx}" y="${h - 1}" text-anchor="middle" class="sl-txt" style="font-size:${Math.max(8, Math.round(w * 0.15))}px">${esc(res.l)}</text>` : ''}</g>`;
}
EQ.statusLamp = {
  type: 'statusLamp',
  cat: 8,
  n: 'Status lamp',
  pre: 'SL',
  w: 34, // original size, like all other equipment; drag its handles to enlarge
  h: 46,
  resize: 'wh',
  inst: 1,
  noflip: 1,
  noTagShow: 1,
  ports: [],
  props: { lamp: { rules: LAMP_PRE.bool.rules, def: '#f59e0b', none: '#6b7280', txt: true } },
  tags: [['ST', 'Status', '', 1, null, null, null, null, 0, 'lamp', 0]],
  draw: () => '',
  dyn: (w, h, s, b) => {
    const cfg = b && b.props ? lampCfg(b) : { rules: LAMP_PRE.bool.rules, def: '#f59e0b', none: '#6b7280', txt: true };
    // a transparent pad over everything the lamp draws (glow, rim, text) so a click on its edge still grabs the lamp, not the area behind it
    return `<rect class="slpad" x="${-12}" y="${-10}" width="${w + 24}" height="${h + 20}" fill="transparent"/>` + lampSvg(w, h, lampEval(cfg, lampRaw(b)), (b && b.id) || 'x', cfg.txt !== false);
  },
};

/* ---------------- Properties panel: "Status lamp" section ---------------- */
function lampInspHTML(b, ed) {
  const cfg = lampCfg(b),
    raw = lampRaw(b),
    res = lampEval(cfg, raw),
    sw = (cur, attr) =>
      `<div class="sl-sw">${LAMP_PAL.map(([n, c]) => `<button type="button" title="${n}" ${attr}="${c}" class="${c === cur ? 'on' : ''}" style="background:${c}" ${ed}></button>`).join('')}</div>`;
  return `<section class="ix-sec sl-sec"><h4>Status lamp <span class="ix-sum">${cfg.rules.length} rule${cfg.rules.length === 1 ? '' : 's'}</span></h4>
 <div class="sl-now"><svg viewBox="0 0 34 46" width="40" height="54">${lampSvg(34, 46, res, 'insp' + b.id, false)}</svg>
  <div>Value now <b>${raw == null ? '—' : esc(String(raw))}</b><br>→ <b style="color:${res.c}">${esc(lampCName(res.c))}</b>${res.l ? ` · “${esc(res.l)}”` : ''}${res.b ? ' · blinking' : ''}
  <br><span class="sl-why">${res.k >= 0 ? `Rule ${res.k + 1} matched` : res.k === -1 ? 'No rule matched — default colour' : 'No data from the tag'}</span></div></div>
 <label class="ix-f">Quick start<select id="slPre" ${ed}><option value="">Choose a ready setup…</option>${Object.entries(LAMP_PRE).map(([k, p]) => `<option value="${k}">${p.n}</option>`).join('')}</select></label>
 <p class="ix-hint">Rules are checked from the top — the first one that matches sets the colour.</p>
 ${cfg.rules
   .map(
     (r, i) => `<div class="sl-rule" data-i="${i}"><div class="sl-top"><b>Rule ${i + 1}</b>
  <label class="ix-c"><input type="checkbox" data-f="b" ${r.b ? 'checked' : ''} ${ed}> Blink</label>
  <button type="button" class="sl-mv" data-mv="-1" title="Move up" ${ed || (i ? '' : 'disabled')}>↑</button><button type="button" class="sl-mv" data-mv="1" title="Move down" ${ed || (i < cfg.rules.length - 1 ? '' : 'disabled')}>↓</button><button type="button" class="sl-x" title="Delete rule" ${ed}>✕</button></div>
  <div class="ix-2"><label class="ix-f">When the value<select data-f="t" ${ed}><option value="bool" ${r.t === 'bool' ? 'selected' : ''}>is true / false</option><option value="text" ${r.t === 'text' ? 'selected' : ''}>equals text</option><option value="range" ${r.t === 'range' ? 'selected' : ''}>is in number range</option></select></label>
  ${
    r.t === 'bool'
      ? `<label class="ix-f">&nbsp;<select data-f="v" ${ed}><option value="true" ${r.v === 'true' ? 'selected' : ''}>TRUE</option><option value="false" ${r.v === 'false' ? 'selected' : ''}>FALSE</option></select></label>`
      : r.t === 'text'
        ? `<label class="ix-f">Text<input data-f="v" value="${esc(r.v || '')}" placeholder="e.g. Yes" ${ed}></label>`
        : `<label class="ix-f">From … below<span class="sl-rg"><input data-f="v" type="number" value="${esc(r.v || '')}" ${ed}><input data-f="v2" type="number" value="${esc(r.v2 || '')}" ${ed}></span></label>`
  }</div>
  <label class="ix-f">Text to show<input data-f="l" value="${esc(r.l || '')}" placeholder="e.g. Running" ${ed}></label>
  ${sw(r.c, 'data-c')}</div>`,
   )
   .join('')}
 <button type="button" class="ib sl-add" id="slAdd" ${ed}>＋ Add rule</button>
 <label class="ix-f" style="margin-top:10px">When no rule matches</label>${sw(cfg.def, 'data-def')}
 <label class="ix-f" style="margin-top:8px">When there is no data</label>${sw(cfg.none, 'data-none')}
 <label class="ix-c" style="margin-top:8px"><input type="checkbox" id="slTxt" ${cfg.txt !== false ? 'checked' : ''} ${ed}> Show the rule’s text under the lamp</label>
 <label class="ix-f" style="margin-top:6px">Try a value (test only, not saved)<span class="sl-rg"><input id="slTry" value="${LAMP_TRY[b.id] != null ? esc(String(LAMP_TRY[b.id])) : ''}" placeholder="e.g. Yes, No, 1, 0, 92"><button type="button" class="ib" id="slTryX">Clear</button></span></label>
 <p class="ix-hint">Link the lamp’s <b>Status</b> reading to a PLC or database tag below. Text values (Yes / No, Auto / Manual) and true / false (1 / 0) both work.</p>
</section>`;
}
function lampWire(root, b, edit) {
  const sec = root.querySelector('.sl-sec');
  if (!sec) return;
  const cfg = lampCfg(b),
    redo = fn => {
      edit(fn);
      renderProps();
    };
  const pre = sec.querySelector('#slPre');
  if (pre) pre.onchange = e => e.target.value && redo(() => (cfg.rules = JSON.parse(JSON.stringify(LAMP_PRE[e.target.value].rules))));
  sec.querySelectorAll('.sl-rule').forEach(row => {
    const i = +row.dataset.i,
      r = cfg.rules[i];
    row.querySelectorAll('[data-f]').forEach(el => {
      el.onchange = () => {
        const f = el.dataset.f;
        redo(() => {
          if (f === 'b') r.b = el.checked;
          else if (f === 't') {
            r.t = el.value;
            r.v = r.t === 'bool' ? 'true' : '';
            r.v2 = '';
          } else r[f] = el.value;
        });
      };
    });
    row.querySelectorAll('[data-c]').forEach(el => (el.onclick = () => redo(() => (r.c = el.dataset.c))));
    row.querySelectorAll('[data-mv]').forEach(
      el =>
        (el.onclick = () =>
          redo(() => {
            const j = i + +el.dataset.mv;
            [cfg.rules[i], cfg.rules[j]] = [cfg.rules[j], cfg.rules[i]];
          })),
    );
    const x = row.querySelector('.sl-x');
    if (x) x.onclick = () => redo(() => cfg.rules.splice(i, 1));
  });
  sec.querySelectorAll('[data-def]').forEach(el => (el.onclick = () => redo(() => (cfg.def = el.dataset.def))));
  sec.querySelectorAll('[data-none]').forEach(el => (el.onclick = () => redo(() => (cfg.none = el.dataset.none))));
  const add = sec.querySelector('#slAdd');
  if (add) add.onclick = () => redo(() => cfg.rules.push({ t: 'text', v: '', c: '#3b82f6', l: '' }));
  const txt = sec.querySelector('#slTxt');
  if (txt) txt.onchange = () => redo(() => (cfg.txt = txt.checked));
  const tr = sec.querySelector('#slTry'),
    trx = sec.querySelector('#slTryX'),
    apply = () => {
      if (typeof liveCanvas === 'function') liveCanvas();
      renderProps();
      const n = document.querySelector('#slTry');
      if (n) {
        n.focus();
        n.setSelectionRange(n.value.length, n.value.length);
      }
    };
  if (tr)
    tr.onchange = () => {
      if (tr.value.trim() === '') delete LAMP_TRY[b.id];
      else LAMP_TRY[b.id] = tr.value;
      apply();
    };
  if (trx)
    trx.onclick = () => {
      delete LAMP_TRY[b.id];
      apply();
    };
}
