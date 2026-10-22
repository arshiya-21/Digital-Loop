/*! SandMan Process Flowsheet — 12-tag-spec-charts.js
 *  Tag specification (Min/Optimal/Max/σ), bulk limits editor, CSV, σ-zone control chart
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===================================================================
   Tag specification: Min · Optimal · Max · σ  (+ alarm limits)
   and a control chart with ±1σ / ±2σ / ±3σ colour zones
   =================================================================== */
const ZC = {
  c: 'rgba(31,157,85,.16)',
  b: 'rgba(234,179,8,.18)',
  a: 'rgba(236,122,21,.18)',
  out: 'rgba(217,54,54,.08)',
  l1: '#1f9d55',
  l2: '#c99a00',
  l3: '#d93636',
  spec: '#3b3fb6',
};
function spec(t) {
  const opt = t.typ;
  let min = t.min ?? null,
    max = t.max ?? null;
  if (min == null) min = t.lo ?? t.ll ?? null;
  if (max == null) max = t.hi ?? t.hh ?? null;
  let sd = t.sd;
  if (!(sd > 0)) {
    sd =
      min != null && max != null
        ? (max - min) / 6
        : max != null
          ? (max - opt) / 3
          : min != null
            ? (opt - min) / 3
            : Math.max(Math.abs(opt) * 0.02, (t.noise || 0) * 2, 1e-3);
  }
  return { min, max, opt, sd: Math.max(sd, 1e-9), cfg: !!t.cfg };
}
function specIssues(t) {
  const s = spec(t),
    out = [];
  if (s.min != null && s.max != null && s.min >= s.max) out.push('Min must be below Max');
  if (s.min != null && s.opt < s.min) out.push('Optimal is below Min');
  if (s.max != null && s.opt > s.max) out.push('Optimal is above Max');
  if (!(t.sd > 0) && t.cfg) out.push('Enter a standard deviation');
  const LM = [t.ll, t.lo, t.hi, t.hh].filter(x => x != null);
  if (LM.some((x, i) => i && x <= LM[i - 1])) out.push('Alarm limits must rise: LL < L < H < HH');
  if (t.lo != null && t.typ <= t.lo) out.push('Optimal must be above the Low limit');
  if (t.hi != null && t.typ >= t.hi) out.push('Optimal must be below the High limit');
  return out;
}
function renameTag(old, nw) {
  nw = String(nw || '').trim();
  if (!nw || nw === old) return false;
  if (REG[nw]) {
    toast(`Tag ${nw} already exists`);
    return false;
  }
  if (/\s/.test(nw)) {
    toast('Tag IDs cannot contain spaces');
    return false;
  }
  REG[nw] = { ...REG[old], id: nw };
  delete REG[old];
  if (VAL[old]) {
    VAL[nw] = VAL[old];
    delete VAL[old];
  }
  DOC.blocks.forEach(b => {
    b.tags.forEach(x => {
      if (x.id === old) x.id = nw;
    });
    (b.rules || []).forEach(r => {
      if (r.tag === old) r.tag = nw;
    });
  });
  DOC.streams.forEach(s => {
    if (s.tag === old) s.tag = nw;
  });
  if (trendTag === old) trendTag = nw;
  try {
    TRC.clear();
  } catch (e) {}
  Object.keys(ALERTS).forEach(k => {
    if (ALERTS[k].tagId === old) delete ALERTS[k];
  });
  logEv(`Tag renamed ${old} → ${nw}`);
  return true;
}
function sigmaStrip(t) {
  const s = spec(t),
    d = t.d,
    f = v => fmtN(v, d);
  const cells = [
    [-3, -2, ZC.a],
    [-2, -1, ZC.b],
    [-1, 1, ZC.c],
    [1, 2, ZC.b],
    [2, 3, ZC.a],
  ];
  return `<div class="sgs"><div class="sgs-bar">${cells.map(([a, b, c]) => `<i style="flex:${b - a};background:${c.replace(/\.1\d\)/, '.55)')}"></i>`).join('')}</div>
 <div class="sgs-lab">${[-3, -2, -1, 0, 1, 2, 3].map(k => `<span style="left:${((k + 3) / 6) * 100}%"><b>${k ? (k > 0 ? '+' : '−') + Math.abs(k) + 'σ' : 'Opt'}</b>${f(s.opt + k * s.sd)}</span>`).join('')}</div>
 <div class="note" style="margin-top:20px">${s.min != null || s.max != null ? `Spec Min ${s.min != null ? f(s.min) : '—'} · Max ${s.max != null ? f(s.max) : '—'}` : 'No Min / Max set'}${s.cfg ? '' : ' · <span class="tx2">defaults — please confirm</span>'}</div></div>`;
}
function tagSpecFields(t, attr) {
  const s = spec(t),
    v = k => t[k] ?? '';
  return `<div class="spec-h">Process specification <span class="note">used for the control chart</span></div>
 <div class="row4"><div class="fld"><label>Min</label><input type="number" step="any" ${attr}="min" value="${v('min')}" placeholder="${s.min ?? ''}"></div><div class="fld"><label>Optimal</label><input type="number" step="any" ${attr}="typ" value="${t.typ}"></div><div class="fld"><label>Max</label><input type="number" step="any" ${attr}="max" value="${v('max')}" placeholder="${s.max ?? ''}"></div><div class="fld"><label>Std dev (σ)</label><input type="number" step="any" min="0" ${attr}="sd" value="${v('sd')}" placeholder="${fmtN(s.sd, (t.d || 0) + 2)}"></div></div>`;
}
/* ---------- Properties → Tags editor (replaces the old limits editor) ---------- */
let OPENTAG = null;
function tagEditorHtml(t) {
  const iss = specIssues(t);
  return `<div class="row2"><div class="fld"><label>Tag ID</label><input data-lim="id" class="mono" value="${esc(t.id)}"></div><div class="fld"><label>Description</label><input data-lim="desc" value="${esc(t.desc)}"></div></div>
 ${tagSpecFields(t, 'data-lim')}${sigmaStrip(t)}
 <div class="row2"><div class="fld"><label>Unit</label><input data-lim="unit" value="${esc(t.unit)}"></div><div class="fld"><label>Decimals</label><input type="number" min="0" max="4" data-lim="d" value="${t.d ?? 1}"></div></div>
 <details class="alm"><summary>Alarm limits (LL / L / H / HH)</summary><div class="row4"><div class="fld"><label>LL</label><input type="number" step="any" data-lim="ll" value="${t.ll ?? ''}"></div><div class="fld"><label>L</label><input type="number" step="any" data-lim="lo" value="${t.lo ?? ''}"></div><div class="fld"><label>H</label><input type="number" step="any" data-lim="hi" value="${t.hi ?? ''}"></div><div class="fld"><label>HH</label><input type="number" step="any" data-lim="hh" value="${t.hh ?? ''}"></div></div><button class="sb" data-alm2s="1">Set from σ: L/H = ±2σ, LL/HH = ±3σ</button></details>
 ${iss.length ? `<div class="note tx3">${iss.map(esc).join(' · ')}</div>` : ''}<div class="row2" style="margin-top:6px"><button class="ib" data-trend="1">Open control chart</button>${t.cfg ? '<span class="chip sv0" style="align-self:center;justify-self:end">Limits confirmed</span>' : '<button class="ib pri" data-confirm="1">Confirm limits</button>'}</div>
 <div class="note">Address: <span class="mono">${esc(t.addr || '—')}</span></div>`;
}
function applyTagEdit(t, k, el) {
  if (k === 'id') {
    const nw = el.value.trim();
    if (renameTag(t.id, nw)) {
      OPENTAG = nw;
      return true;
    }
    el.value = t.id;
    return false;
  }
  if (k === 'desc' || k === 'unit') {
    t[k] = el.value;
    return true;
  }
  const v = parseFloat(el.value);
  if (k === 'typ') {
    if (isFinite(v)) {
      t.typ = v;
      t.cfg = true;
    }
    return true;
  }
  if (k === 'd') {
    t.d = clamp(parseInt(el.value) || 0, 0, 4);
    return true;
  }
  if (['min', 'max', 'sd'].includes(k)) {
    if (isFinite(v) && (k !== 'sd' || v > 0)) t[k] = v;
    else delete t[k];
    t.cfg = true;
    return true;
  }
  t[k] = isFinite(v) ? v : null;
  return true;
}
function bindTagEditors(root) {
  root.querySelectorAll('.trow').forEach(r => {
    const id = r.dataset.tid;
    r.querySelectorAll('[data-lim]').forEach(
      inp =>
        (inp.onchange = () => {
          const t = REG[id];
          if (!t) return;
          pushUndo();
          if (applyTagEdit(t, inp.dataset.lim, inp)) {
            logEv(`Tag settings changed on ${OPENTAG || id}`);
            save();
            renderProps();
            renderCanvas();
            renderDock(true);
          }
        }),
    );
    const a = r.querySelector('[data-alm2s]');
    if (a)
      a.onclick = () => {
        const t = REG[id],
          s = spec(t);
        pushUndo();
        t.lo = +(s.opt - 2 * s.sd).toFixed(4);
        t.hi = +(s.opt + 2 * s.sd).toFixed(4);
        t.ll = +(s.opt - 3 * s.sd).toFixed(4);
        t.hh = +(s.opt + 3 * s.sd).toFixed(4);
        save();
        renderProps();
        toast('Alarm limits set from σ');
      };
    const c = r.querySelector('[data-confirm]');
    if (c)
      c.onclick = () => {
        const t = REG[id],
          s = spec(t);
        pushUndo();
        if (t.min == null && s.min != null) t.min = s.min;
        if (t.max == null && s.max != null) t.max = s.max;
        if (!(t.sd > 0)) t.sd = +s.sd.toPrecision(3);
        t.cfg = true;
        save();
        renderProps();
        renderDock(true);
        toast(`${t.id} limits confirmed`);
      };
    const tr = r.querySelector('[data-trend]');
    if (tr) tr.onclick = () => openTrend(id);
  });
}
/* ---------- Bulk editor ---------- */
function tagLimitsForm(blockId) {
  const ids = blockId
    ? B(blockId)
        .tags.map(x => x.id)
        .filter(id => REG[id])
    : Object.keys(REG).sort();
  let q = '',
    onlyOpen = false;
  const draw = () => {
    const L = ids.filter(id => {
      const t = REG[id];
      return (
        t && (!q || id.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)) && (!onlyOpen || !t.cfg)
      );
    });
    const nOpen = ids.filter(id => REG[id] && !REG[id].cfg).length;
    openModal(
      `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Tag limits${blockId ? ` — ${esc(B(blockId).name)}` : ''}</h3><span class="note">${ids.length} tags · ${nOpen} still on defaults</span></div>
  <div style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="search" id="tlQ" placeholder="Filter by tag or description" value="${esc(q)}" style="flex:1;height:30px;border:1px solid var(--line);border-radius:6px;padding:0 8px;background:var(--panel)"><label class="chk"><input type="checkbox" id="tlOpen" ${onlyOpen ? 'checked' : ''}> Only unconfirmed</label><button class="sb" id="tlFill">Fill blanks with suggested values</button></div>
  <div class="tbl-wrap" style="max-height:56vh;overflow:auto"><table class="dz-t tl-t"><thead><tr><th>Tag ID</th><th>Description</th><th>Unit</th><th>Min</th><th>Optimal</th><th>Max</th><th>σ</th><th>±3σ range</th><th>Status</th></tr></thead><tbody>${
    L.map(id => {
      const t = REG[id],
        s = spec(t),
        iss = specIssues(t);
      return `<tr data-tl="${esc(id)}">
   <td><input data-k="id" class="mono" value="${esc(id)}" style="width:150px"></td><td><input data-k="desc" value="${esc(t.desc)}" style="width:170px"></td><td><input data-k="unit" value="${esc(t.unit)}" style="width:60px"></td>
   ${['min', 'typ', 'max', 'sd'].map(k => `<td><input data-k="${k}" type="number" step="any" value="${k === 'typ' ? t.typ : (t[k] ?? '')}" placeholder="${k === 'sd' ? fmtN(s.sd, (t.d || 0) + 2) : k === 'typ' ? '' : (s[k] ?? '')}" style="width:76px"></td>`).join('')}
   <td class="mono note">${fmtN(s.opt - 3 * s.sd, t.d)} – ${fmtN(s.opt + 3 * s.sd, t.d)}</td><td>${iss.length ? `<span class="chip sv3" title="${esc(iss.join(', '))}">Check</span>` : t.cfg ? '<span class="chip sv0">Confirmed</span>' : '<span class="chip sv1">Default</span>'}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="note">No tags match.</td></tr>'
  }</tbody></table></div>
  <div class="note" style="margin-top:6px">Blank Min / Max / σ use the suggested values shown in grey (from alarm limits). Saving a row marks it confirmed.</div>
  <div class="mact"><button class="ib" id="tlClose">Close</button><button class="ib pri" id="tlAll" ${nOpen ? '' : 'disabled'}>Confirm all ${nOpen ? nOpen + ' ' : ''}shown</button></div>`,
      'xl',
    );
    $('#tlClose').onclick = closeModal;
    const qq = $('#tlQ');
    qq.oninput = () => {
      q = qq.value.toLowerCase();
      const p = qq.selectionStart;
      draw();
      const n = $('#tlQ');
      n.focus();
      n.setSelectionRange(p, p);
    };
    $('#tlOpen').onchange = e => {
      onlyOpen = e.target.checked;
      draw();
    };
    $$('#mbox [data-tl] input').forEach(
      inp =>
        (inp.onchange = () => {
          const id = inp.closest('tr').dataset.tl,
            t = REG[id];
          if (!t) return;
          pushUndo();
          const k = inp.dataset.k;
          if (applyTagEdit(t, k === 'typ' ? 'typ' : k, inp)) {
            if (k === 'id') {
              const i2 = ids.indexOf(id);
              if (i2 >= 0) ids[i2] = OPENTAG;
            }
            save();
            renderDock(true);
            draw();
          }
        }),
    );
    $('#tlFill').onclick = () => {
      pushUndo();
      let n = 0;
      L.forEach(id => {
        const t = REG[id],
          s = spec(t);
        if (t.min == null && s.min != null) {
          t.min = s.min;
          n++;
        }
        if (t.max == null && s.max != null) {
          t.max = s.max;
          n++;
        }
        if (!(t.sd > 0)) {
          t.sd = +s.sd.toPrecision(3);
          n++;
        }
      });
      save();
      draw();
      toast(`${n} values filled — review, then confirm`);
    };
    $('#tlAll').onclick = () => {
      pushUndo();
      let n = 0;
      L.forEach(id => {
        const t = REG[id],
          s = spec(t);
        if (t.cfg) return;
        if (t.min == null && s.min != null) t.min = s.min;
        if (t.max == null && s.max != null) t.max = s.max;
        if (!(t.sd > 0)) t.sd = +s.sd.toPrecision(3);
        t.cfg = true;
        n++;
      });
      save();
      renderProps();
      renderDock(true);
      draw();
      toast(`${n} tag(s) confirmed`);
    };
  };
  draw();
}
/* ---------- Tag form (create / edit) ---------- */
function tagForm(id, b) {
  const t = id ? REG[id] : { id: '', desc: '', unit: '', typ: '', src: 'SandMan Gateway', addr: '', d: 1 },
    pre = b ? b.name + '.' : '';
  openModal(`<h3>${id ? 'Edit tag' : 'Create tag'}</h3><div class="note" style="margin-bottom:10px">${id ? 'Changes apply everywhere this tag is used.' : `Values are simulated in this preview.${b ? ` The tag will be bound to ${esc(b.name)}.` : ''}`}</div>
 <div class="row2"><div class="fld"><label>Tag ID *</label><input id="fId" value="${esc(id || pre)}" class="mono"></div><div class="fld"><label>Description *</label><input id="fDesc" value="${esc(t.desc)}"></div></div>
 <div class="row3"><div class="fld"><label>Unit</label><input id="fUnit" value="${esc(t.unit)}"></div><div class="fld"><label>Decimals</label><input id="fD" type="number" min="0" max="4" value="${t.d ?? 1}"></div><div class="fld"><label>Source</label><select id="fSrc">${['SandMan Gateway', 'SandMan Lab', 'OPC UA', 'Modbus TCP', 'MQTT', 'Manual entry'].map(s => `<option ${t.src === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
 <div class="fld"><label>Address / node ID</label><input id="fAddr" class="mono" value="${esc(t.addr)}" placeholder="ns=2;s=Line1.Mixer.Moisture"></div>
 <div class="row2"><div class="fld"><label>Value type</label><select id="fKind"><option value="num">Number (measured value)</option><option value="text">Text (e.g. mould pattern name)</option><option value="states">Status list (number shown as a word)</option></select></div><div class="fld" id="fKindHelp"><label>&nbsp;</label><div class="note" id="fKindNote"></div></div></div>
 <div id="fTxtBox" hidden><div class="fld"><label>Text *</label><input id="fTxt" value="${esc(t.txt || '')}" placeholder="e.g. PT-1042 Brake Disc"></div></div>
 <div id="fStBox" hidden><div class="row2"><div class="fld"><label>Values (number = text) *</label><input id="fStates" class="mono" value="${esc(t.states ? Object.entries(t.states).map(([k, v]) => k + '=' + v).join(', ') : '')}" placeholder="0=STOPPED, 1=RUNNING"></div><div class="fld"><label>Current value</label><input id="fCur" type="number" step="1" value="${t.states ? t.typ ?? '' : ''}" placeholder="e.g. 1"></div></div></div>
 <div id="fNumBox">
 <div class="spec-h">Process specification *</div>
 <div class="row4"><div class="fld"><label>Min</label><input id="fMin" type="number" step="any" value="${t.min ?? ''}"></div><div class="fld"><label>Optimal *</label><input id="fTyp" type="number" step="any" value="${t.typ}"></div><div class="fld"><label>Max</label><input id="fMax" type="number" step="any" value="${t.max ?? ''}"></div><div class="fld"><label>Std dev (σ) *</label><input id="fSd" type="number" step="any" min="0" value="${t.sd ?? ''}"></div></div>
 <div id="fPrev"></div>
 <details class="alm" ${id && (t.lo != null || t.hi != null) ? 'open' : ''}><summary>Alarm limits (LL / L / H / HH)</summary><div class="row4"><div class="fld"><label>LL</label><input id="fLL" type="number" step="any" value="${t.ll ?? ''}"></div><div class="fld"><label>L</label><input id="fL" type="number" step="any" value="${t.lo ?? ''}"></div><div class="fld"><label>H</label><input id="fH" type="number" step="any" value="${t.hi ?? ''}"></div><div class="fld"><label>HH</label><input id="fHH" type="number" step="any" value="${t.hh ?? ''}"></div></div><button class="sb" id="fAlm">Set from σ: L/H = ±2σ, LL/HH = ±3σ</button></details></div>
 <div class="mact"><button class="ib" id="fCancel">Cancel</button><button class="ib pri" id="fSave">${id ? 'Save tag' : 'Create tag'}</button></div>`);
  const num = s2 => {
    const v = parseFloat($(s2).value);
    return isFinite(v) ? v : null;
  };
  const prev = () => {
    const o = {
      typ: num('#fTyp') ?? 0,
      min: num('#fMin'),
      max: num('#fMax'),
      sd: num('#fSd'),
      d: parseInt($('#fD').value) || 0,
      lo: num('#fL'),
      hi: num('#fH'),
      ll: num('#fLL'),
      hh: num('#fHH'),
      cfg: true,
    };
    $('#fPrev').innerHTML = num('#fTyp') != null ? sigmaStrip(o) : '';
  };
  // v9.39 — value type: Number / Text / Status list
  const kindNote = { num: 'Measured number with a specification and alarm limits.', text: 'Shows the text as it is — no limits or alarms.', states: 'A number from the PLC shown as a word, e.g. 1 → RUNNING.' };
  const showKind = () => {
    const k = $('#fKind').value;
    $('#fNumBox').hidden = k !== 'num';
    $('#fTxtBox').hidden = k !== 'text';
    $('#fStBox').hidden = k !== 'states';
    $('#fKindNote').textContent = kindNote[k];
    $('#fUnit').disabled = $('#fD').disabled = k !== 'num';
  };
  $('#fKind').value = t.txt != null && t.txt !== '' ? 'text' : t.states ? 'states' : 'num';
  $('#fKind').onchange = showKind;
  showKind();
  $$('#mbox input').forEach(i => i.addEventListener('input', prev));
  prev();
  $('#fAlm').onclick = () => {
    const o = num('#fTyp'),
      sd = num('#fSd');
    if (o == null || !(sd > 0)) {
      toast('Enter Optimal and σ first');
      return;
    }
    $('#fL').value = +(o - 2 * sd).toFixed(4);
    $('#fH').value = +(o + 2 * sd).toFixed(4);
    $('#fLL').value = +(o - 3 * sd).toFixed(4);
    $('#fHH').value = +(o + 3 * sd).toFixed(4);
  };
  $('#fCancel').onclick = closeModal;
  $('#fSave').onclick = () => {
    const nid = $('#fId').value.trim(),
      typ = num('#fTyp'),
      sd = num('#fSd'),
      mn = num('#fMin'),
      mx = num('#fMax');
    if (!nid || nid.endsWith('.')) {
      toast('Enter a tag ID');
      return;
    }
    if (!$('#fDesc').value.trim()) {
      toast('Enter a description');
      return;
    }
    const kind = $('#fKind').value;
    if (kind !== 'num') {
      // v9.39 — Text / Status-list tags: no specification or alarm limits
      if ((!id || nid !== id) && REG[nid]) {
        toast('Tag ' + nid + ' already exists');
        return;
      }
      const o = { desc: $('#fDesc').value.trim(), src: $('#fSrc').value, addr: $('#fAddr').value.trim(), unit: '', d: 0, noise: 0, sd: null,
        ll: null, lo: null, hi: null, hh: null, cfg: true, lab: $('#fSrc').value === 'SandMan Lab' ? 1 : 0 };
      if (kind === 'text') {
        const tx = $('#fTxt').value.trim();
        if (!tx) {
          toast('Enter the text');
          return;
        }
        Object.assign(o, { txt: tx, typ: 0 });
      } else {
        const st = {};
        $('#fStates').value.split(/[\n,;]+/).forEach(p => {
          const m = p.split('=');
          if (m.length >= 2 && m[0].trim() !== '' && isFinite(+m[0]) && m.slice(1).join('=').trim()) st[+m[0]] = m.slice(1).join('=').trim();
        });
        if (!Object.keys(st).length) {
          toast('Enter at least one value, e.g. 0=STOPPED, 1=RUNNING');
          return;
        }
        const cur = parseInt($('#fCur').value);
        Object.assign(o, { states: st, typ: isFinite(cur) ? cur : +Object.keys(st)[0] });
      }
      pushUndo();
      if (id) {
        if (nid !== id) renameTag(id, nid);
        Object.assign(REG[nid], o);
        if (kind === 'text') delete REG[nid].states;
        else delete REG[nid].txt;
        delete REG[nid].min;
        delete REG[nid].max;
      } else {
        mkTag(nid, o);
        seedHist();
        if (b) b.tags.push({ id: nid, show: true });
      }
      ensureVal(nid, true);
      logEv(`${id ? 'Updated' : 'Created'} ${kind === 'text' ? 'text' : 'status-list'} tag ${nid}`);
      closeModal();
      changed();
      toast(id ? 'Tag saved' : 'Tag created');
      return;
    }
    if (typ == null) {
      toast('Enter the optimal value');
      return;
    }
    if (!(sd > 0)) {
      toast('Enter a standard deviation greater than 0');
      return;
    }
    if (mn != null && mx != null && mn >= mx) {
      toast('Min must be below Max');
      return;
    }
    if ((mn != null && typ < mn) || (mx != null && typ > mx)) {
      toast('Optimal must lie between Min and Max');
      return;
    }
    if ((!id || nid !== id) && REG[nid]) {
      toast('Tag ' + nid + ' already exists');
      return;
    }
    pushUndo();
    const o = {
      desc: $('#fDesc').value.trim(),
      src: $('#fSrc').value,
      addr: $('#fAddr').value.trim(),
      unit: $('#fUnit').value.trim(),
      typ,
      min: mn,
      max: mx,
      sd,
      ll: num('#fLL'),
      lo: num('#fL'),
      hi: num('#fH'),
      hh: num('#fHH'),
      d: clamp(parseInt($('#fD').value) || 0, 0, 4),
      cfg: true,
      lab: $('#fSrc').value === 'SandMan Lab' ? 1 : 0,
    };
    if (id) {
      if (nid !== id) renameTag(id, nid);
      Object.assign(REG[nid], o);
      if (o.min == null) delete REG[nid].min;
      if (o.max == null) delete REG[nid].max;
      delete REG[nid].txt; // v9.39 — back to a number tag
      delete REG[nid].states;
    } else {
      o.noise = Math.max(sd * 0.5, Math.abs(typ) * 0.002);
      mkTag(nid, o);
      seedHist();
      if (b) b.tags.push({ id: nid, show: true });
    }
    logEv(`${id ? 'Updated' : 'Created'} tag ${nid}`);
    closeModal();
    changed();
    toast(id ? 'Tag saved' : 'Tag created');
  };
}
/* ---------- CSV (header-based) ---------- */
const CSV_COLS = [
  'tag',
  'description',
  'unit',
  'source',
  'address',
  'optimal',
  'min',
  'max',
  'sd',
  'LL',
  'L',
  'H',
  'HH',
];
function csvExportForm() {
  const rows = [CSV_COLS].concat(
    Object.values(REG)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(t => [
        t.id,
        t.desc,
        t.unit,
        t.src,
        t.addr,
        t.typ,
        t.min ?? '',
        t.max ?? '',
        t.sd ?? '',
        t.ll ?? '',
        t.lo ?? '',
        t.hi ?? '',
        t.hh ?? '',
      ]),
  );
  const csv = rows
    .map(r =>
      r
        .map(v => {
          v = String(v ?? '');
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(','),
    )
    .join('\n');
  openModal(
    `<h3>Export tags (CSV)</h3><div class="note">Columns: ${CSV_COLS.join(', ')}. Edit in Excel, then Import CSV. ${Object.keys(REG).length} tags.</div><textarea readonly style="margin-top:8px">${esc(csv)}</textarea><div class="mact"><button class="ib" id="cxC">Close</button><button class="ib pri" id="cxK">Copy CSV</button></div>`,
    true,
  );
  $('#cxC').onclick = closeModal;
  $('#cxK').onclick = () => copyText(csv, 'Tag CSV copied');
}
function parseCsvLine(l) {
  const out = [];
  let cur = '',
    q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) {
      if (c === '"' && l[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}
function csvForm() {
  openModal(
    `<h3>Import tags (CSV)</h3><div class="note">First row must be a header. Recognised columns: <span class="mono">${CSV_COLS.join(', ')}</span> (“typical” is accepted for optimal). Existing tags with the same ID are updated; rows with optimal and sd are marked confirmed.</div>
 <textarea id="csvT" style="margin-top:8px">${CSV_COLS.join(',')}
L1.SM1.TEMP,Mixed sand temperature,°C,OPC UA,ns=2;s=L1.SM1.Temp,38,30,45,2.2,,,45,50
L1.DISA1.CYC,Molding cycle time,s,OPC UA,ns=2;s=L1.DISA1.Cycle,9.5,8.5,10.5,0.3,,,10.5,11.5</textarea>
 <div class="mact"><button class="ib" id="cCancel">Cancel</button><button class="ib pri" id="cGo">Import tags</button></div>`,
    true,
  );
  $('#cCancel').onclick = closeModal;
  $('#cGo').onclick = () => {
    const L = $('#csvT')
      .value.split(/\r?\n/)
      .filter(l => l.trim());
    if (L.length < 2) {
      toast('Paste a header row and at least one tag');
      return;
    }
    const H = parseCsvLine(L[0]).map(h => h.toLowerCase()),
      ix = n => {
        const a = { optimal: ['optimal', 'typical', 'target'], sd: ['sd', 'sigma', 'σ', 'std', 'stddev'] }[
          n
        ] || [n.toLowerCase()];
        return H.findIndex(h => a.includes(h));
      };
    if (ix('tag') < 0) {
      toast('Header needs a “tag” column');
      return;
    }
    let n = 0,
      bad = 0;
    pushUndo();
    L.slice(1).forEach(l => {
      const c = parseCsvLine(l),
        g = k => {
          const i = ix(k);
          return i >= 0 ? c[i] : '';
        },
        f = k => {
          const v = parseFloat(g(k));
          return isFinite(v) ? v : null;
        };
      const id = g('tag'),
        typ = f('optimal');
      if (!id || typ == null) {
        bad++;
        return;
      }
      const o = {
        desc: g('description') || id,
        unit: g('unit'),
        src: g('source') || 'SandMan Gateway',
        addr: g('address'),
        typ,
        min: f('min'),
        max: f('max'),
        sd: f('sd'),
        ll: f('LL'),
        lo: f('L'),
        hi: f('H'),
        hh: f('HH'),
      };
      o.cfg = o.sd > 0;
      const dec = String(g('optimal')).includes('.') ? String(g('optimal')).split('.')[1].length : 0;
      if (REG[id]) {
        Object.keys(o).forEach(k => {
          if (o[k] == null && ['min', 'max', 'sd'].includes(k)) delete REG[id][k];
          else REG[id][k] = o[k];
        });
      } else mkTag(id, { ...o, d: dec, noise: Math.max((o.sd || Math.abs(typ) * 0.01) * 0.5, 1e-4) });
      n++;
    });
    seedHist();
    logEv(`Imported ${n} tags from CSV`);
    closeModal();
    DTAB = 'tags';
    setDockTab();
    changed();
    toast(`Imported ${n} tag${n !== 1 ? 's' : ''}${bad ? `, skipped ${bad} without tag or optimal` : ''}`);
  };
}
/* ---------- Control chart with σ zones ---------- */
TR.sig = 'cfg';
TR.basis = 'typ';
TR.alm = false;
/* The σ bands — zones, lines and labels — are on until somebody turns them off. */
TR.bands = true;
function ccStats(pts, t) {
  const vs = pts.map(p => p.v),
    n = vs.length,
    mean = n ? vs.reduce((a, b) => a + b, 0) / n : t.typ,
    mr = [];
  for (let i = 1; i < n; i++) mr.push(Math.abs(vs[i] - vs[i - 1]));
  const mrb = mr.length ? mr.reduce((a, b) => a + b, 0) / mr.length : 0,
    sdw = n > 1 ? Math.sqrt(vs.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0,
    sp = spec(t);
  /*
   * σ from the data, and the configured σ when the data has none.
   *
   * A run of identical readings — a column parked on one value, a line that
   * has not moved — has a standard deviation of nought, and a nought σ is not
   * a control chart: all six band lines land on the centre line and the chart
   * loses the one thing it is for. The configured σ (or the one suggested from
   * the alarm limits) stands in, so the bands are drawn where the limits say
   * they should be and the flat run is visible against them.
   *
   * Nothing is hidden by this: the stats row below reports "σ used" and "σ of
   * data" separately, so a nought spread still says so.
   */
  const asked = TR.sig === 'cfg' ? sp.sd : TR.sig === 'sd' ? sdw : mrb / 1.128;
  const spread = asked > 0 ? asked : sp.sd > 0 ? sp.sd : Math.abs(t.typ) * 0.02;
  const sigma = Math.max(spread, Math.abs(t.typ) * 1e-6, 1e-9),
    cl = TR.basis === 'typ' ? t.typ : mean;
  return {
    vs,
    n,
    mean,
    cl,
    sigma,
    sdw,
    sp,
    ucl: cl + 3 * sigma,
    lcl: cl - 3 * sigma,
    mr,
    mrb,
    uclr: 3.267 * mrb,
    min: n ? Math.min(...vs) : null,
    max: n ? Math.max(...vs) : null,
  };
}
function zoneOf(v, S) {
  const z = Math.abs(v - S.cl) / S.sigma;
  return z <= 1 ? 0 : z <= 2 ? 1 : z <= 3 ? 2 : 3;
}
const PTC = ['#1f6feb', '#c99a00', '#ec7a15', '#d93636'];
function openTrend(id) {
  const t = REG[id];
  if (!t) return;
  trendTag = id;
  TR.hover = null;
  const o = tagOwner(id),
    sp = spec(t),
    f = v => (v == null ? '—' : fmtN(v, t.d));
  const sw = (bg, l, bd) =>
    `<span><i style="background:${bg};${bd ? `border:1px dashed ${bd}` : ''}"></i>${l}</span>`;
  openModal(
    `<div class="cc-h"><div style="min-width:0"><h3 class="mono" style="margin:0">${esc(id)}</h3><div class="note">${esc(t.desc)} · ${esc(t.unit || 'no unit')} · ${esc(t.src)}${o ? ` · ${esc(o.b ? o.b.name : o.s.name)}` : ''}</div></div>
  <div class="cc-now"><span id="trV">—</span><small>${esc(t.unit)}</small><span class="chip" id="trS"></span></div></div>
 <div class="cc-spec"><span>Min <b>${f(sp.min)}</b></span><span>Optimal <b>${f(sp.opt)}</b></span><span>Max <b>${f(sp.max)}</b></span><span>σ <b>${fmtN(sp.sd, (t.d || 0) + 2)}</b></span>${sp.cfg ? '<span class="chip sv0">Configured</span>' : '<span class="chip sv1" title="Min / Max / σ are suggested from alarm limits">Default limits</span>'}<button class="sb" id="trEdit">Edit limits</button></div>
 <div class="cc-ctl"><span class="note">Window</span><div class="seg" id="trWin">${[
   [120, '2 min'],
   [300, '5 min'],
   [900, '15 min'],
 ]
   .map(([v, l]) => `<button data-w="${v}" class="${TR.win === v ? 'on' : ''}">${l}</button>`)
   .join('')}</div>
  <span class="note">Centre</span><select id="trBasis"><option value="typ" ${TR.basis === 'typ' ? 'selected' : ''}>Optimal (${f(sp.opt)})</option><option value="win" ${TR.basis === 'win' ? 'selected' : ''}>Process mean (window)</option></select>
  <span class="note">σ</span><select id="trSig"><option value="cfg" ${TR.sig === 'cfg' ? 'selected' : ''}>Configured (${fmtN(sp.sd, (t.d || 0) + 2)})</option><option value="mr" ${TR.sig === 'mr' ? 'selected' : ''}>From data — moving range</option><option value="sd" ${TR.sig === 'sd' ? 'selected' : ''}>From data — std. deviation</option></select>
  <label class="chk"><input type="checkbox" id="trSpec" ${TR.spec ? 'checked' : ''}> Min / Max</label><label class="chk"><input type="checkbox" id="trBands" ${TR.bands !== false ? 'checked' : ''}> σ bands</label><label class="chk"><input type="checkbox" id="trAlm" ${TR.alm ? 'checked' : ''}> Alarm limits</label></div>
 <div class="cc-leg">${sw(ZC.c, 'Within ±1σ')}${sw(ZC.b, '±1σ to ±2σ')}${sw(ZC.a, '±2σ to ±3σ')}${sw(ZC.out, 'Beyond ±3σ', '#d93636')}<span><i style="border-top:2px dashed ${ZC.spec}"></i>Min / Max</span><span><i style="border-top:2px solid #1f9d55"></i>Optimal / centre</span><span><i class="dot" style="background:#d93636"></i>Rule violation</span></div>
 <div class="cc-title">Individuals chart — ${esc(t.desc)}</div><canvas id="trC" class="cc-cv" style="height:290px"></canvas>
 <div class="cc-title">Moving range chart</div><canvas id="trM" class="cc-cv" style="height:110px"></canvas>
 <div class="cc-stats" id="trStats"></div><div class="cc-dist" id="trDist"></div><div id="trRules" class="cc-rules"></div>
 <div class="mact"><button class="ib" id="trCsv">Copy data (CSV)</button><button class="ib pri" id="trClose">Close</button></div>`,
    'xl',
  );
  $('#trClose').onclick = closeModal;
  $('#trEdit').onclick = () => {
    closeModal();
    const ow = tagOwner(id);
    if (ow && ow.b) {
      select({ t: 'b', id: ow.b.id });
      PTAB = 'tags';
      OPENTAG = id;
      renderProps();
      openRight();
    } else tagForm(id, null);
  };
  $$('#trWin button').forEach(
    b =>
      (b.onclick = () => {
        TR.win = +b.dataset.w;
        $$('#trWin button').forEach(x => x.classList.toggle('on', x === b));
        drawTrend();
      }),
  );
  $('#trBasis').onchange = e => {
    TR.basis = e.target.value;
    drawTrend();
  };
  $('#trSig').onchange = e => {
    TR.sig = e.target.value;
    drawTrend();
  };
  $('#trSpec').onchange = e => {
    TR.spec = e.target.checked;
    drawTrend();
  };
  $('#trBands').onchange = e => {
    TR.bands = e.target.checked;
    drawTrend();
  };
  $('#trAlm').onchange = e => {
    TR.alm = e.target.checked;
    drawTrend();
  };
  $('#trCsv').onclick = () => {
    const pts = ccData();
    copyText(
      'time,value\n' + pts.map(p => `${new Date(p.t).toISOString()},${p.v.toFixed(4)}`).join('\n'),
      'Chart data copied',
    );
  };
  [$('#trC'), $('#trM')].forEach(c => {
    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect(),
        G = c._g;
      if (!G) return;
      const i = Math.round((e.clientX - r.left - G.pl) / G.dx);
      TR.hover = i >= 0 && i < G.n ? i : null;
      drawTrend();
    });
    c.addEventListener('mouseleave', () => {
      TR.hover = null;
      drawTrend();
    });
  });
  requestAnimationFrame(() => requestAnimationFrame(drawTrend));
}
function drawTrend() {
  if (!trendTag || !$('#trC')) return;
  const id = trendTag,
    t = REG[id];
  if (!t) return;
  const pts = ccData(),
    S = ccStats(pts, t),
    F = ccRules(S),
    sv = tagSev(id, RP ? histVal(id, RP.T) : val(id));
  $('#trV').textContent = fmtN(RP ? histVal(id, RP.T) : val(id), t.d);
  const ch = $('#trS');
  ch.className = 'chip sv' + sv;
  ch.textContent = SEVN[sv];
  const dec = t.d,
    fmt = v => fmtN(v, dec),
    fs = v => fmtN(v, dec + 1),
    dark = css('--text'),
    mut = css('--muted'),
    grid = css('--line');
  const extra = [];
  if (TR.spec) {
    if (S.sp.min != null) extra.push([S.sp.min, 'Min', ZC.spec, [8, 4], 2]);
    if (S.sp.max != null) extra.push([S.sp.max, 'Max', ZC.spec, [8, 4], 2]);
  }
  if (TR.alm)
    [
      [t.ll, 'LL'],
      [t.lo, 'L'],
      [t.hi, 'H'],
      [t.hh, 'HH'],
    ].forEach(([v, l]) => {
      if (v != null) extra.push([v, l, '#7f1d1d', [2, 3], 1.2]);
    });
  const A = ccCanvas($('#trC'));
  if (A) {
    const { c, W, H } = A,
      pl = 70,
      pr = 96,
      pt = 14,
      pb = 40;
    c.clearRect(0, 0, W, H);
    c.font = '11px IBM Plex Mono,monospace';
    if (S.n < 2) {
      c.fillStyle = mut;
      c.fillText('Collecting data…', pl, H / 2);
    } else {
      /*
       * The axis reaches as far as what is being drawn, and no further.
       *
       * ±3.4σ is in the range only while the bands are on screen. With them
       * turned off that reach was still stretching the axis to make room for
       * lines nobody was drawing, which flattened the readings into a band
       * across the middle.
       */
      const reach = TR.bands !== false ? [S.cl - 3.4 * S.sigma, S.cl + 3.4 * S.sigma] : [S.cl];
      let lo = Math.min(S.min, ...reach, ...extra.map(x => x[0])),
        hi = Math.max(S.max, ...reach, ...extra.map(x => x[0]));
      const sp = hi - lo || 1;
      lo -= sp * 0.04;
      hi += sp * 0.04;
      const n = S.n,
        dx = (W - pl - pr) / Math.max(1, n - 1),
        X = i => pl + i * dx,
        Y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
      $('#trC')._g = { pl, dx, n };
      const band = (a, b, col) => {
        const y1 = Y(Math.min(hi, a)),
          y2 = Y(Math.max(lo, b));
        if (y2 > y1) {
          c.fillStyle = col;
          c.fillRect(pl, y1, W - pl - pr, y2 - y1);
        }
      };
      /*
       * The zones are the chart's background and stay whatever the tick says.
       *
       * The σ tick above the chart takes away the six dashed lines; it used to
       * take the coloured wash with them, which left a white rectangle with a
       * trend in it — not a control chart at all. The wash is the scale: it is
       * how a point is read as "inside ±1σ" without measuring anything.
       */
      band(hi, S.cl + 3 * S.sigma, ZC.out);
      band(S.cl - 3 * S.sigma, lo, ZC.out);
      band(S.cl + 3 * S.sigma, S.cl + 2 * S.sigma, ZC.a);
      band(S.cl - 2 * S.sigma, S.cl - 3 * S.sigma, ZC.a);
      band(S.cl + 2 * S.sigma, S.cl + S.sigma, ZC.b);
      band(S.cl - S.sigma, S.cl - 2 * S.sigma, ZC.b);
      band(S.cl + S.sigma, S.cl - S.sigma, ZC.c);
      c.strokeStyle = grid;
      c.fillStyle = mut;
      c.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const v = lo + ((hi - lo) * i) / 5,
          y = Y(v);
        c.globalAlpha = 0.6;
        c.beginPath();
        c.moveTo(pl, y);
        c.lineTo(W - pr, y);
        c.stroke();
        c.globalAlpha = 1;
        c.textAlign = 'right';
        c.fillText(fmt(v), pl - 8, y + 4);
      }
      c.textAlign = 'center';
      const nt = Math.min(6, n);
      for (let i = 0; i < nt; i++) {
        const k = Math.round((i * (n - 1)) / Math.max(1, nt - 1));
        c.fillText(tfmt(pts[k].t), X(k), H - pb + 16);
      }
      c.fillStyle = dark;
      c.font = '600 11px IBM Plex Sans,sans-serif';
      c.fillText('Time', pl + (W - pl - pr) / 2, H - 4);
      c.save();
      c.translate(14, pt + (H - pt - pb) / 2);
      c.rotate(-Math.PI / 2);
      c.fillText(`${t.desc}${t.unit ? ` (${t.unit})` : ''}`, 0, 0);
      c.restore();
      const LY = [];
      const hline = (v, col, dash, lab, w = 1.3, bold) => {
        if (v < lo || v > hi) return;
        const y = Y(v);
        c.strokeStyle = col;
        c.lineWidth = w;
        c.setLineDash(dash);
        c.beginPath();
        c.moveTo(pl, y);
        c.lineTo(W - pr, y);
        c.stroke();
        c.setLineDash([]);
        /*
         * A line without a label is a line, and that is often the right one.
         *
         * Callers pass no label for the σ lines. Six of them inside a spread
         * of a quarter of a unit, on an axis eighteen units tall, put seven
         * numbers in a stack down the right-hand gutter with leader lines
         * fanning back to a single pixel row — and every one of those numbers
         * is already in the stats underneath, under "σ used". The zones say
         * where ±1σ is; the gutter is for the handful of values somebody
         * reads off the axis: the centre line, Min, Max and the alarm limits.
         *
         * Those few are nudged apart when they collide, and stay level with
         * their own line whenever they can — a label printed above a gridline
         * it does not belong to is a chart contradicting itself.
         */
        if (!lab) return;

        const home = y + 3.5;
        let ly = home;
        for (let k = 1; k < 40 && LY.some(q => Math.abs(q - ly) < 11); k++) {
          ly = home + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 11;
        }
        ly = Math.max(pt + 8, Math.min(H - pb - 2, ly));
        LY.push(ly);

        c.fillStyle = col;
        c.font = `${bold ? 700 : 600} 10.5px IBM Plex Mono,monospace`;
        c.textAlign = 'left';
        c.fillText(`${lab} ${fmt(v)}`, W - pr + 8, ly);
      };
      hline(S.cl, '#1f9d55', [], TR.basis === 'typ' ? 'Opt' : 'CL', 2, 1);
      extra.forEach(([v, l, col, ds, w]) => hline(v, col, ds, l, w, 1));
      /*
       * All three σ bands, unless there is no spread at all.
       *
       * They crowd together when σ is small against the axis — the axis is
       * stretched by Min and Max, and σ may be a fraction of that range — but
       * crowded is not the same as absent, and a control chart with its ±1σ
       * and ±2σ bands missing is not the chart anybody came to read. Only a σ
       * of nought is dropped, where all six lines would be drawn on CL.
       *
       * To see them apart, turn off the Min / Max tick above the chart: the
       * axis then scales to the data and its bands rather than being
       * stretched to reach the specification.
       */
      const sigmaGap = Math.abs(Y(S.cl) - Y(S.cl + S.sigma));
      const bands =
        TR.bands === false || sigmaGap < 1
          ? []
          : [
              [3, ZC.l3, '+3σ'],
              [2, ZC.l2, '+2σ'],
              [1, ZC.l1, '+1σ'],
            ];
      // Drawn, not labelled — see `hline`. The legend names the zones and the
      // stats row gives the σ they are measured with.
      bands.forEach(([k, col]) => {
        hline(S.cl + k * S.sigma, col, [5, 4], null, k === 3 ? 1.6 : 1.1);
        hline(S.cl - k * S.sigma, col, [5, 4], null, k === 3 ? 1.6 : 1.1);
      });
      c.strokeStyle = '#1f6feb';
      c.lineWidth = 1.5;
      c.beginPath();
      S.vs.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
      c.stroke();
      S.vs.forEach((v, i) => {
        const z = zoneOf(v, S),
          r = F[i] ? 4.2 : dx > 3 ? 2.2 : z ? 1.8 : 0;
        if (!r) return;
        c.fillStyle = F[i] ? '#d93636' : PTC[z];
        c.beginPath();
        c.arc(X(i), Y(v), r, 0, 7);
        c.fill();
        if (F[i]) {
          c.strokeStyle = '#fff';
          c.lineWidth = 1;
          c.stroke();
        }
      });
      if (TR.hover != null && TR.hover < n) {
        const i = TR.hover,
          x = X(i),
          y = Y(S.vs[i]),
          zv = (S.vs[i] - S.cl) / S.sigma;
        c.strokeStyle = mut;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(x, pt);
        c.lineTo(x, H - pb);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#1f6feb';
        c.beginPath();
        c.arc(x, y, 4.5, 0, 7);
        c.fill();
        const txt = [
          tfmt(pts[i].t),
          `${fmt(S.vs[i])} ${t.unit}`,
          `${zv >= 0 ? '+' : ''}${zv.toFixed(2)} σ from ${TR.basis === 'typ' ? 'optimal' : 'mean'}`,
          F[i] ? `Rule ${F[i]}: ${RULEN[F[i]]}` : '',
        ].filter(Boolean);
        c.font = '11px IBM Plex Sans,sans-serif';
        const bw = Math.max(...txt.map(s => c.measureText(s).width)) + 16,
          bx = x + bw + 12 > W - pr ? x - bw - 10 : x + 10,
          by = Math.max(pt, Math.min(y - 30, H - pb - txt.length * 15 - 8));
        c.fillStyle = 'rgba(11,31,58,.93)';
        c.fillRect(bx, by, bw, txt.length * 15 + 8);
        c.fillStyle = '#fff';
        c.textAlign = 'left';
        txt.forEach((s, k) => c.fillText(s, bx + 8, by + 16 + k * 15));
      }
    }
  }
  const M = ccCanvas($('#trM'));
  if (M && S.n > 2) {
    const { c, W, H } = M,
      pl = 70,
      pr = 96,
      pt = 8,
      pb = 22,
      mr = S.mr,
      hi2 = Math.max(S.uclr, ...mr) * 1.1 || 1,
      dx = (W - pl - pr) / Math.max(1, S.n - 1),
      X = i => pl + (i + 1) * dx,
      Y = v => pt + (1 - v / hi2) * (H - pt - pb);
    $('#trM')._g = { pl, dx, n: S.n };
    c.clearRect(0, 0, W, H);
    c.font = '11px IBM Plex Mono,monospace';
    c.strokeStyle = grid;
    c.fillStyle = mut;
    for (let i = 0; i <= 2; i++) {
      const v = (hi2 * i) / 2,
        y = Y(v);
      c.beginPath();
      c.moveTo(pl, y);
      c.lineTo(W - pr, y);
      c.stroke();
      c.textAlign = 'right';
      c.fillText(fs(v), pl - 8, y + 4);
    }
    const hl = (v, col, dash, lab) => {
      const y = Y(v);
      c.strokeStyle = col;
      c.setLineDash(dash);
      c.lineWidth = 1.3;
      c.beginPath();
      c.moveTo(pl, y);
      c.lineTo(W - pr, y);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = col;
      c.textAlign = 'left';
      c.font = '600 10.5px IBM Plex Mono,monospace';
      c.fillText(`${lab} ${fs(v)}`, W - pr + 6, y + 4);
    };
    hl(S.uclr, '#d93636', [6, 4], 'UCL');
    hl(S.mrb, '#1f9d55', [], 'MR̄');
    c.strokeStyle = '#7b5ab8';
    c.lineWidth = 1.3;
    c.beginPath();
    mr.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.stroke();
    mr.forEach((v, i) => {
      if (v > S.uclr) {
        c.fillStyle = '#d93636';
        c.beginPath();
        c.arc(X(i), Y(v), 3.3, 0, 7);
        c.fill();
      }
    });
  } else if (M) M.c.clearRect(0, 0, M.W, M.H);
  const sp = S.sp,
    sdD = S.sdw || S.sigma,
    cp = sp.min != null && sp.max != null ? (sp.max - sp.min) / (6 * sdD) : null,
    cpk =
      sp.min != null || sp.max != null
        ? Math.min(
            sp.max != null ? (sp.max - S.mean) / (3 * sdD) : Infinity,
            sp.min != null ? (S.mean - sp.min) / (3 * sdD) : Infinity,
          )
        : null;
  const oos = S.n
      ? (S.vs.filter(v => (sp.min != null && v < sp.min) || (sp.max != null && v > sp.max)).length / S.n) *
        100
      : 0,
    ooc = F.filter(Boolean).length;
  const cell = (l, v, cls = '') => `<div><span>${l}</span><b class="${cls}">${v}</b></div>`;
  $('#trStats').innerHTML =
    cell('Points', S.n) +
    cell('Mean', fmt(S.mean)) +
    cell('σ used', fs(S.sigma)) +
    cell('σ of data', fs(S.sdw)) +
    cell('Min / Max seen', S.n ? `${fmt(S.min)} / ${fmt(S.max)}` : '—') +
    cell('Mean vs optimal', `${S.mean - sp.opt >= 0 ? '+' : ''}${fs(S.mean - sp.opt)}`) +
    cell(
      'Cp',
      cp == null ? '—' : cp.toFixed(2),
      cp != null && cp < 1 ? 'tx3' : cp != null && cp < 1.33 ? 'tx2' : 'tx0',
    ) +
    cell(
      'Cpk',
      cpk == null || !isFinite(cpk) ? '—' : cpk.toFixed(2),
      cpk != null && cpk < 1 ? 'tx3' : cpk != null && cpk < 1.33 ? 'tx2' : 'tx0',
    ) +
    cell('Outside Min/Max', `${oos.toFixed(1)}%`, oos > 0 ? 'tx2' : '') +
    cell('Rule violations', ooc, ooc ? 'tx3' : 'tx0');
  if (S.n) {
    const zc = [0, 0, 0, 0];
    S.vs.forEach(v => zc[zoneOf(v, S)]++);
    const cum = [zc[0], zc[0] + zc[1], zc[0] + zc[1] + zc[2]].map(x => (x / S.n) * 100),
      exp = [68.3, 95.4, 99.7];
    $('#trDist').innerHTML =
      [
        ['±1σ', ZC.c, cum[0], exp[0]],
        ['±2σ', ZC.b, cum[1], exp[1]],
        ['±3σ', ZC.a, cum[2], exp[2]],
      ]
        .map(
          ([l, col, v, e]) =>
            `<div><span><i style="background:${col.replace(/\.1\d\)/, '.6)')}"></i>Within ${l}</span><b>${v.toFixed(1)}%</b><em class="${v < e - 8 ? 'tx2' : 'tx0'}">expected ${e}%</em></div>`,
        )
        .join('') +
      `<div><span><i style="background:#d93636"></i>Beyond ±3σ</span><b class="${zc[3] ? 'tx3' : ''}">${((zc[3] / S.n) * 100).toFixed(1)}%</b><em>expected 0.3%</em></div>`;
  }
  const cnt = {};
  F.forEach((r, i) => {
    if (r) {
      cnt[r] = cnt[r] || { n: 0, last: 0 };
      cnt[r].n++;
      cnt[r].last = pts[i].t;
    }
  });
  $('#trRules').innerHTML = Object.keys(cnt).length
    ? Object.entries(cnt)
        .map(
          ([r, o]) =>
            `<div><span class="chip sv3">Rule ${r}</span> ${RULEN[r]} — ${o.n} point${o.n > 1 ? 's' : ''}, last at ${tfmt(o.last)}</div>`,
        )
        .join('')
    : `<div><span class="chip sv0">In control</span> No rule violations in this window.</div>`;
}
