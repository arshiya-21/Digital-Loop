/*! SandMan Process Flowsheet — 11-mass-balance.js
 *  Sand inventory & mass balance
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===================================================================
   Sand inventory & mass balance (green sand system)
   Inventory  = Σ storage (level × capacity) + Σ belts (load × length / speed)
              + Σ hold-ups (mixers, elevators, screens, coolers, shakeouts)
              + sand in molds (molds on line × mold sand mass)
   Balance    = new sand + core sand + bentonite + coal dust
              − dust extraction − spillage/overflow − sand on castings − screen rejects
   =================================================================== */
const MB_ZONES = ['Storage & return', 'Preparation', 'Conveying', 'Molding hoppers', 'In molds', 'Shakeout'];
const MB_ZC = {
  'Storage & return': '#8a6a3d',
  Preparation: '#c0392b',
  Conveying: '#64748b',
  'Molding hoppers': '#c9a063',
  'In molds': '#7a63b0',
  Shakeout: '#ec7a15',
  Additives: '#0f9d8a',
};
const MB_DEF = {
  returnBin: { k: 'level', cap: 60, zone: 'Storage & return' },
  silo: { k: 'level', cap: 80, zone: 'Storage & return' },
  blowerHopper: { k: 'level', cap: 25, zone: 'Storage & return' },
  holdingHopper: { k: 'level', cap: 24, zone: 'Molding hoppers' },
  moldHopper: { k: 'level', cap: 20, zone: 'Molding hoppers' },
  additiveBin: { k: 'level', cap: 40, add: 1 },
  gaugeSilo: { k: 'level', cap: 15, add: 1 },
  addBin: { k: 'level', cap: 5, add: 1 },
  dosingFeeder: { k: 'hold', hold: 0.1, add: 1 },
  mixer: { k: 'batch', batch: 2.5, zone: 'Preparation' },
  sandMixer: { k: 'batch', batch: 3, zone: 'Preparation' },
  contMixer: { k: 'hold', hold: 0.4, zone: 'Preparation' },
  aerator: { k: 'hold', hold: 0.2, zone: 'Preparation' },
  dischargeGate: { k: 'hold', hold: 0.1, zone: 'Preparation' },
  sandLab: { k: 'hold', hold: 0, zone: 'Preparation' },
  belt: { k: 'belt', speed: 1.6, zone: 'Conveying' },
  inclinedBelt: { k: 'belt', speed: 1.4, zone: 'Conveying' },
  elevator: { k: 'hold', hold: 0.8, zone: 'Conveying' },
  feeder: { k: 'hold', hold: 0.4, zone: 'Conveying' },
  screwFeeder: { k: 'hold', hold: 0.05, zone: 'Conveying' },
  screen: { k: 'hold', hold: 0.5, zone: 'Storage & return' },
  magSep: { k: 'hold', hold: 0.3, zone: 'Storage & return' },
  cooler: { k: 'hold', hold: 6, zone: 'Storage & return' },
  polygonSieve: { k: 'hold', hold: 0.8, zone: 'Storage & return' },
  disaMini: { k: 'hold', hold: 0.15, mold: 110, zone: 'In molds' },
  disa: { k: 'hold', hold: 0.2, mold: 110, zone: 'In molds' },
  hmold: { k: 'hold', hold: 0.25, mold: 150, zone: 'In molds' },
  moldLine: { k: 'molds', pitch: 0.25, zone: 'In molds' },
  moldConv: { k: 'molds', pitch: 0.25, zone: 'In molds' },
  coolConv: { k: 'molds', pitch: 0.25, zone: 'In molds' },
  shakeoutUnit: { k: 'hold', hold: 1.5, zone: 'Shakeout' },
  shakeout: { k: 'hold', hold: 3, zone: 'Shakeout' },
};
const MB_CFG_DEF = {
  newPct: 1.5,
  coreTph: 0.8,
  dustPct: 0.8,
  spillPct: 0.3,
  castPct: 0.4,
  pxPerM: 10,
  metalKg: 22,
  moist: 3.5,
};
function mbCfg() {
  if (!DOC.mbCfg) DOC.mbCfg = { ...MB_CFG_DEF };
  return Object.assign({ ...MB_CFG_DEF }, DOC.mbCfg);
}
let MBH = [],
  MBOPEN = false,
  MBVIEW = 'main';
function mbAddSet() {
  const k = DOC.blocks.length + ':' + DOC.streams.length;
  if (mbAddSet.k === k) return mbAddSet.s;
  const set = new Set();
  DOC.streams.forEach(s => {
    const tb = B(s.to.b);
    if (!tb || !isMixer(tb)) return;
    const port = portOf(tb, s.to.p);
    if (!(s.kind === 'add' || (port && (port.kind === 'add' || /^add/.test(port.id))))) return;
    const q = [B(s.from.b)];
    while (q.length) {
      const x = q.pop();
      if (!x || set.has(x.id) || isMixer(x)) continue;
      set.add(x.id);
      srcBlocks(x).forEach(y => q.push(y));
    }
  });
  let grew = true;
  while (grew) {
    grew = false;
    DOC.blocks.forEach(b => {
      if (set.has(b.id) || EQ[b.type].widget) return;
      const d = dstBlocks(b);
      if (d.length && d.every(x => set.has(x.id))) {
        set.add(b.id);
        grew = true;
      }
    });
  }
  mbAddSet.k = k;
  mbAddSet.s = set;
  return set;
}
function mbConf(b) {
  const E = EQ[b.type],
    base = MB_DEF[b.type] || (E.custom && E.def && E.def.shape === 'base' ? MB_DEF[E.def.base] : null),
    inv = b.props.inv || {};
  let d = base
    ? { ...base }
    : {
        k: b.tags.some(t => REG[t.id]?.role === 'level') ? 'level' : 'hold',
        cap: 10,
        hold: 0,
        zone: 'Storage & return',
        none: 1,
      };
  const count = inv.count || (base ? (base.add || mbAddSet().has(b.id) ? 'add' : 'sand') : 'none');
  return Object.assign(d, inv, { count });
}
function valAt(id, t) {
  return t != null && RP ? histVal(id, t) : val(id);
}
function runAt(b, t) {
  return t != null && RP ? !stoppedAt(b, t) : !b.props.oos;
}
function moldKgFor(b) {
  if (MB_DEF[b.type]?.mold) return mbConf(b).mold;
  const m = upFind(b, x => moldingMachines().includes(x));
  return m ? mbConf(m).mold || 110 : 110;
}
function massOf(b, t) {
  const c = mbConf(b);
  if (c.count === 'none') return null;
  const C = mbCfg();
  let m = 0,
    basis = '';
  const d = dims(b);
  if (c.k === 'level') {
    const lt = b.tags.find(x => REG[x.id]?.role === 'level');
    const lv = lt ? clamp(valAt(lt.id, t), 0, 100) : 50;
    m = (c.cap * lv) / 100;
    basis = `${Math.round(lv)}% of ${fmtN(c.cap, 0)} t`;
  } else if (c.k === 'batch') {
    m = runAt(b, t) ? c.batch * 0.9 : 0;
    basis = `batch ${fmtN(c.batch, 1)} t`;
  } else if (c.k === 'belt') {
    const lt = tagRole(b, 'load', 'LOAD'),
      load = lt && b.tags.some(x => x.id === lt) ? Math.max(0, valAt(lt, t)) : 80,
      len = c.len || (b.type === 'inclinedBelt' ? Math.hypot(d.W, d.H) : Math.max(d.W, d.H)) / C.pxPerM;
    m = ((load / 3600) * len) / c.speed;
    basis = `${fmtN(load, 0)} t/h · ${fmtN(len, 1)} m @ ${fmtN(c.speed, 1)} m/s`;
  } else if (c.k === 'molds') {
    let n;
    const ct = b.tags.find(x => x.id.endsWith('.CNT')),
      tt = b.tags.find(x => REG[x.id]?.role === 'ctime');
    const kg = moldKgFor(b),
      len = Math.max(d.W, d.H) / C.pxPerM;
    if (ct) n = Math.max(0, valAt(ct.id, t));
    else if (tt) {
      const mm = upFind(b, x => moldingMachines().includes(x));
      const mph = mm ? mphOf(mm) : 300;
      n = (valAt(tt.id, t) * mph) / 60;
    } else n = len / c.pitch;
    m = (n * kg) / 1000;
    basis = `${Math.round(n)} molds × ${kg} kg`;
  } else {
    m = (c.hold || 0) * (runAt(b, t) ? 1 : 0.6);
    basis = `hold-up ${fmtN(c.hold || 0, 2)} t`;
  }
  return {
    b,
    mass: m,
    basis,
    zone: c.count === 'add' ? 'Additives' : c.zone || 'Storage & return',
    add: c.count === 'add',
  };
}
function inventory(t) {
  const zones = {},
    items = [];
  let sand = 0,
    add = 0;
  DOC.blocks.forEach(b => {
    if (EQ[b.type].widget || EQ[b.type].inst) return;
    const r = massOf(b, t);
    if (!r) return;
    items.push(r);
    if (r.add) add += r.mass;
    else {
      sand += r.mass;
      zones[r.zone] = (zones[r.zone] || 0) + r.mass;
    }
  });
  const mx = DOC.blocks.find(b => isMixer(b) && !mbAddSet().has(b.id)),
    mt = tagRole(mx || null, 'moist'),
    moist = mt ? valAt(mt, t) : mbCfg().moist;
  return { t: t ?? Date.now(), sand, add, zones, items, moist, dry: sand * (1 - moist / 100) };
}
function flows(t) {
  const C = mbCfg(),
    mm = moldingMachines();
  let Q = 0,
    molds = 0;
  mm.forEach(m => {
    if (!runAt(m, t)) return;
    const mt = tagRole(m, 'mph', 'MPH'),
      mph = mt ? valAt(mt, t) : mphOf(m);
    molds += mph;
    Q += (mph * mbConf(m).mold) / 1000;
  });
  const mx = DOC.blocks.filter(b => isMixer(b) && !mbAddSet().has(b.id));
  let bent = 0,
    coal = 0,
    water = 0;
  mx.forEach(x => {
    if (!runAt(x, t)) return;
    const bt = tagRole(x, 'btime', 'BT'),
      bph = 3600 / Math.max(30, bt ? valAt(bt, t) : 90);
    const bn = x.tags.find(y => REG[y.id]?.role === 'bent'),
      cn = x.tags.find(y => REG[y.id]?.role === 'coal');
    if (bn) bent += (valAt(bn.id, t) * bph) / 1000;
    if (cn) coal += (valAt(cn.id, t) * bph) / 1000;
  });
  DOC.blocks.forEach(b =>
    b.tags.forEach(x => {
      const T = REG[x.id];
      if (!T || T.role !== 'water' || EQ[b.type].inst) return;
      const v = valAt(x.id, t);
      water += /min/.test(T.unit) ? (v * 60) / 1000 : /batch/.test(T.unit) ? (v * 30) / 1000 : v;
    }),
  );
  const lumps = DOC.blocks.reduce((a, b) => {
    const l = b.tags.find(x => REG[x.id]?.role === 'lumps');
    return a + (l ? valAt(l.id, t) / 1000 : 0);
  }, 0);
  const ins = [
    ['New sand', (Q * C.newPct) / 100, `${C.newPct}% of molding sand`],
    ['Core sand (from cores)', C.coreTph, 'set in settings'],
    ['Bentonite', bent, 'from mixer dosing tags'],
    ['Coal dust', coal, 'from mixer dosing tags'],
  ];
  const outs = [
    ['Dust extraction (fines)', (Q * C.dustPct) / 100, `${C.dustPct}% of molding sand`],
    ['Spillage & overflow', (Q * C.spillPct) / 100, `${C.spillPct}%`],
    ['Sand leaving on castings', (Q * C.castPct) / 100, `${C.castPct}%`],
    ['Screen rejects (lumps)', lumps, 'from screen tag'],
  ];
  const tin = ins.reduce((a, x) => a + x[1], 0),
    tout = outs.reduce((a, x) => a + x[1], 0);
  return { Q, molds, metal: (molds * C.metalKg) / 1000, ins, outs, tin, tout, net: tin - tout, water };
}
function invAvg(t) {
  let v = 0,
    d = 0,
    n = 0;
  for (let k = -6; k <= 6; k++) {
    const o = inventory(t + k * 47e3);
    v += o.sand;
    d += o.dry;
    n++;
  }
  return { v: v / n, d: d / n };
}
function invSeries() {
  if (RP) {
    if (RP.mbS && RP.mbS.k === RP.t1) return RP.mbS.s;
    const n = 64,
      out = [];
    for (let i = 0; i < n; i++) {
      const t = RP.t0 + ((RP.t1 - RP.t0) * i) / (n - 1);
      out.push({ t, ...invAvg(t) });
    }
    RP.mbS = { k: RP.t1, s: out };
    return out;
  }
  const W = 10 * 60e3;
  return MBH.map((p, i) => {
    const w = MBH.filter(q => Math.abs(q.t - p.t) <= W / 2);
    return {
      t: p.t,
      v: w.reduce((a, q) => a + q.v, 0) / w.length,
      d: w.reduce((a, q) => a + q.d, 0) / w.length,
    };
  });
}
function measuredRate() {
  let h;
  if (RP) {
    const t1 = RP.T,
      t0 = Math.max(RP.t0, t1 - 30 * 60e3);
    if (t1 - t0 < 10 * 60e3) return null;
    h = [];
    for (let i = 0; i < 7; i++) {
      const t = t0 + ((t1 - t0) * i) / 6;
      h.push({ t, v: invAvg(t).v });
    }
  } else {
    h = MBH.filter(p => p.t >= Date.now() - 30 * 60e3);
    if (h.length < 20) return null;
  }
  const n = h.length,
    mx = h.reduce((a, p) => a + p.t, 0) / n,
    my = h.reduce((a, p) => a + p.v, 0) / n;
  let sxy = 0,
    sxx = 0;
  h.forEach(p => {
    sxy += (p.t - mx) * (p.v - my);
    sxx += (p.t - mx) ** 2;
  });
  return sxx ? (sxy / sxx) * HOUR : null;
}
/* ---------- UI ---------- */
function openMB() {
  MBOPEN = true;
  MBVIEW = 'main';
  mbRender();
}
function mbRender() {
  if (!MBOPEN) return;
  if (MBVIEW === 'set') return mbSettings();
  const T = RP ? RP.T : null,
    I = inventory(T),
    F = flows(T),
    meas = measuredRate(),
    C = mbCfg();
  const cyc = F.Q ? (I.sand / F.Q) * 60 : null,
    ratio = F.metal ? F.Q / F.metal : null,
    renew = F.Q ? ((F.ins[0][1] + F.ins[1][1]) / F.Q) * 100 : null,
    unacc = meas != null ? meas - F.net : null;
  const zoneRows = MB_ZONES.filter(z => I.zones[z]).map(z => [z, I.zones[z]]);
  const scroll = $('#mbox').scrollTop,
    isOpen = $('#modal').classList.contains('on') && $('#mbBody');
  const html = `<div id="mbBody"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Sand inventory &amp; mass balance</h3><span class="note">${RP ? `<span class="rp-badge">TRACEABILITY</span> at ${fmtHM(RP.T)}` : 'Live'} · updated ${hms(new Date(I.t))}</span>
  <label class="chk" style="margin-left:auto"><input type="checkbox" id="mbOv" ${PREF.mbOverlay ? 'checked' : ''}> Show tonnes on flowsheet</label><button class="sb" id="mbSet">Settings</button></div>
 <div class="mb-hero"><div><span>Sand in the system</span><b>${fmtN(I.sand, 1)} t</b><small>${fmtN(I.dry, 1)} t dry · moisture ${fmtN(I.moist, 2)}%</small></div>
  <div><span>Molding sand use</span><b>${fmtN(F.Q, 1)} t/h</b><small>${Math.round(F.molds)} molds/h</small></div>
  <div><span>Sand cycle time</span><b>${cyc ? fmtN(cyc, 0) + ' min' : '—'}</b><small>${cyc ? fmtN(480 / cyc, 1) + ' turns per shift' : ''}</small></div>
  <div><span>Sand : metal</span><b>${ratio ? fmtN(ratio, 1) + ' : 1' : '—'}</b><small>${fmtN(F.metal, 1)} t/h metal poured</small></div>
  <div><span>Renewal (new + core)</span><b>${renew != null ? fmtN(renew, 1) + '%' : '—'}</b><small>of sand used</small></div>
  <div><span>Additives stored</span><b>${fmtN(I.add, 1)} t</b><small>bond, bentonite, coal dust</small></div></div>
 <div class="mb-bar">${zoneRows.map(([z, v]) => `<i style="flex:${v};background:${MB_ZC[z]}" title="${z}: ${fmtN(v, 1)} t"></i>`).join('')}</div>
 <div class="mb-leg">${zoneRows.map(([z, v]) => `<span><i style="background:${MB_ZC[z]}"></i>${z} <b>${fmtN(v, 1)} t</b> <em>${fmtN((v / I.sand) * 100, 0)}%</em></span>`).join('')}</div>
 <div class="mb-g">
  <div class="mb-card"><h5>Balance (dry, t/h)</h5><div class="mb-flow"><div><div class="note">In</div>${F.ins.map(x => `<div class="kv"><span title="${esc(x[2])}">${x[0]}</span><b>${fmtN(x[1], 2)}</b></div>`).join('')}<div class="kv"><span><b>Total in</b></span><b>${fmtN(F.tin, 2)}</b></div></div>
   <div><div class="note">Out</div>${F.outs.map(x => `<div class="kv"><span title="${esc(x[2])}">${x[0]}</span><b>${fmtN(x[1], 2)}</b></div>`).join('')}<div class="kv"><span><b>Total out</b></span><b>${fmtN(F.tout, 2)}</b></div></div></div>
   <div class="mb-net"><div class="kv"><span>Expected change (in − out)</span><b class="${F.net > 0 ? 'tx2' : ''}">${F.net >= 0 ? '+' : ''}${fmtN(F.net, 2)} t/h</b></div>
   <div class="kv"><span>Measured change (30-min trend)</span><b>${meas == null ? 'collecting…' : (meas >= 0 ? '+' : '') + fmtN(meas, 1) + ' t/h'}</b></div>
   <div class="kv"><span>Unaccounted</span><b class="${unacc != null && Math.abs(unacc) > 3 ? 'tx2' : ''}">${unacc == null ? '—' : (unacc >= 0 ? '+' : '') + fmtN(unacc, 1) + ' t/h'}</b></div>
   <div class="note" style="margin-top:6px">${F.net > 0.05 ? `The system gains about ${fmtN(F.net * 8, 1)} t per shift — that much must be discarded or overflow will build up.` : F.net < -0.05 ? `The system loses about ${fmtN(-F.net * 8, 1)} t per shift — raise new sand addition or the bins will run down.` : 'Inputs and losses are in balance.'} Water added: ${fmtN(F.water, 2)} t/h, evaporated again at the cooler and shakeout.${unacc != null && Math.abs(unacc) > 3 ? ' A large unaccounted figure usually means a level sensor or belt scale needs checking, or a bin capacity in Properties is wrong.' : ''}</div></div></div>
  <div class="mb-card"><h5>Sand in system over time <span class="note">${RP ? 'this shift' : 'since this page opened'}</span></h5><canvas id="mbTr" style="width:100%;height:180px;display:block"></canvas></div></div>
 <div class="mb-card" style="margin-top:12px"><h5>By equipment <span class="note">click a row to select it · edit capacities in Properties → General</span></h5><div class="tbl-wrap" style="max-height:260px;overflow:auto"><table><thead><tr><th>Equipment</th><th>Zone</th><th>Basis</th><th class="num">Sand (t)</th><th class="num">Share</th></tr></thead><tbody>${I.items
   .slice()
   .sort((a, b) => b.mass - a.mass)
   .map(
     r =>
       `<tr class="rp-row" data-mbb="${r.b.id}"><td><b>${esc(r.b.name)}</b> <span class="note">${esc(EQ[r.b.type].n)}</span></td><td><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${MB_ZC[r.zone]};margin-right:5px"></i>${r.zone}</td><td class="note">${esc(r.basis)}</td><td class="num mono">${fmtN(r.mass, 2)}</td><td class="num mono">${r.add ? '—' : fmtN((r.mass / I.sand) * 100, 1) + '%'}</td></tr>`,
   )
   .join('')}</tbody></table></div></div>
 <div class="mact"><button class="ib" id="mbCopy">Copy as CSV</button><button class="ib pri" id="mbClose">Close</button></div></div>`;
  if (isOpen) {
    $('#mbBody').outerHTML = html;
    $('#mbox').scrollTop = scroll;
  } else openModal(html, 'xl');
  mbBind(I);
  mbTrend();
}
function mbBind(I) {
  $('#mbClose').onclick = closeModal;
  $('#mbSet').onclick = () => {
    MBVIEW = 'set';
    mbSettings();
  };
  $('#mbOv').onchange = e => {
    PREF.mbOverlay = e.target.checked;
    savePref();
    mbOverlay();
    $('#bTons')?.classList.toggle('on', !!PREF.mbOverlay);
  };
  $$('#mbox [data-mbb]').forEach(
    r =>
      (r.onclick = () => {
        const b = B(r.dataset.mbb);
        closeModal();
        if (b) {
          select({ t: 'b', id: b.id });
          center(b);
          PTAB = 'gen';
          renderProps();
        }
      }),
  );
  $('#mbCopy').onclick = () =>
    copyText(
      'equipment,zone,basis,sand_t\n' +
        I.items.map(r => `${r.b.name},${r.zone},"${r.basis}",${r.mass.toFixed(3)}`).join('\n') +
        `\nTOTAL SAND,,,${I.sand.toFixed(3)}`,
      'Inventory copied',
    );
}
function mbTrend() {
  const c = $('#mbTr');
  if (!c) return;
  const r = c.getBoundingClientRect();
  if (r.width < 20) return requestAnimationFrame(mbTrend);
  const d = devicePixelRatio || 1;
  c.width = r.width * d;
  c.height = r.height * d;
  const x = c.getContext && c.getContext('2d');
  if (!x) return;
  x.setTransform(d, 0, 0, d, 0, 0);
  const S = invSeries(),
    W = r.width,
    H = r.height,
    pl = 46,
    pb = 20,
    pt = 8;
  x.clearRect(0, 0, W, H);
  x.font = '10px IBM Plex Mono,monospace';
  x.fillStyle = css('--muted');
  if (S.length < 2) {
    x.fillText('Collecting data…', pl, H / 2);
    return;
  }
  let lo = Math.min(...S.map(p => p.d)),
    hi = Math.max(...S.map(p => p.v));
  const sp = hi - lo || 1;
  lo -= sp * 0.15;
  hi += sp * 0.15;
  const t0 = S[0].t,
    t1 = S[S.length - 1].t,
    X = t => pl + ((t - t0) / (t1 - t0 || 1)) * (W - pl - 8),
    Y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  x.strokeStyle = css('--line');
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    x.beginPath();
    x.moveTo(pl, Y(v));
    x.lineTo(W - 8, Y(v));
    x.stroke();
    x.textAlign = 'right';
    x.fillText(fmtN(v, 0) + ' t', pl - 5, Y(v) + 3);
  }
  x.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((t1 - t0) * i) / 4;
    x.fillText(fmtHM(t), X(t), H - 5);
  }
  [
    ['v', '#8a6a3d'],
    ['d', '#c9a063'],
  ].forEach(([k, col]) => {
    x.strokeStyle = col;
    x.lineWidth = k === 'v' ? 2 : 1.4;
    x.setLineDash(k === 'd' ? [4, 3] : []);
    x.beginPath();
    S.forEach((p, i) => (i ? x.lineTo(X(p.t), Y(p[k])) : x.moveTo(X(p.t), Y(p[k]))));
    x.stroke();
  });
  x.setLineDash([]);
  if (RP) {
    x.strokeStyle = '#7c3aed';
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(X(RP.T), pt);
    x.lineTo(X(RP.T), H - pb);
    x.stroke();
  }
  x.fillStyle = css('--muted');
  x.textAlign = 'left';
  x.fillText('— wet   - - dry', pl + 4, pt + 10);
}
function mbSettings() {
  const C = mbCfg();
  const f = (k, l, u, st = 0.1) =>
    `<div class="fld"><label>${l}</label><div style="display:flex;gap:6px;align-items:center"><input type="number" step="${st}" data-mc="${k}" value="${C[k]}" style="width:110px"><span class="note">${u}</span></div></div>`;
  openModal(
    `<h3>Mass balance settings</h3><div class="note" style="margin-bottom:10px">Plant figures used where no tag measures the flow. Typical green sand values are filled in.</div>
 <div class="row2">${f('newPct', 'New sand addition', '% of molding sand')}${f('coreTph', 'Core sand entering the system', 't/h')}${f('dustPct', 'Dust extraction (fines)', '% of molding sand')}${f('spillPct', 'Spillage & overflow', '% of molding sand')}${f('castPct', 'Sand leaving on castings', '% of molding sand')}${f('metalKg', 'Metal poured per mold', 'kg', 1)}${f('moist', 'Moisture if no mixer tag', '%')}${f('pxPerM', 'Drawing scale for conveyors', 'px per metre', 1)}</div>
 <div class="note">Capacities, belt lengths and speeds, hold-ups and mold sand mass are set per item in Properties → General → Sand inventory.</div>
 <div class="mact"><button class="ib" id="mcR">Restore typical values</button><button class="ib" id="mcB">Back</button><button class="ib pri" id="mcS">Save</button></div>`,
    true,
  );
  $('#mcB').onclick = () => {
    MBVIEW = 'main';
    mbRender();
  };
  $('#mcR').onclick = () => {
    DOC.mbCfg = { ...MB_CFG_DEF };
    save();
    mbSettings();
  };
  $('#mcS').onclick = () => {
    const o = {};
    $$('#mbox [data-mc]').forEach(i => {
      const v = parseFloat(i.value);
      o[i.dataset.mc] = isFinite(v) ? v : MB_CFG_DEF[i.dataset.mc];
    });
    pushUndo();
    DOC.mbCfg = o;
    save();
    MBVIEW = 'main';
    toast('Mass balance settings saved');
    mbRender();
  };
}
function mbOverlay() {
  const L = $('#Lmass');
  if (!L) return;
  if (!PREF.mbOverlay) {
    L.innerHTML = '';
    return;
  }
  const T = RP ? RP.T : null;
  L.innerHTML = DOC.blocks
    .map(b => {
      if (EQ[b.type].widget || EQ[b.type].inst) return '';
      const r = massOf(b, T);
      if (!r || r.mass < 0.05) return '';
      const d = dims(b),
        txt = `${fmtN(r.mass, r.mass < 10 ? 1 : 0)} t`,
        w = txt.length * 6 + 10;
      // v9.36 — small pill at the top-right corner of the equipment, clear of the name above it and of area titles
      return `<g class="mb-pill" transform="translate(${b.x + d.W - w + 6},${b.y - 7})" pointer-events="none"><rect width="${w}" height="14" rx="7" fill="${r.add ? '#0f9d8a' : MB_ZC[r.zone]}" opacity=".9" stroke="#fff" stroke-width="1"/><text x="${w / 2}" y="10.2" text-anchor="middle" style="font:700 9.5px var(--mono);fill:#fff">${txt}</text></g>`;
    })
    .join('');
}
function mbPropsHtml(b) {
  const E = EQ[b.type];
  if (E.widget || E.inst || b.type === 'junction') return '';
  const c = mbConf(b),
    r = massOf(b, RP ? RP.T : null),
    inv = b.props.inv || {};
  const num = (k, l, u, v, st = 0.1) =>
    `<div class="fld"><label>${l}</label><div style="display:flex;gap:6px;align-items:center"><input type="number" step="${st}" min="0" data-inv="${k}" value="${inv[k] ?? v}" style="width:100%"><span class="note">${u}</span></div></div>`;
  const d = dims(b),
    autoLen = fmtN(
      (b.type === 'inclinedBelt' ? Math.hypot(d.W, d.H) : Math.max(d.W, d.H)) / mbCfg().pxPerM,
      1,
    );
  return `<div class="sec"><h5>Sand inventory <span class="r note">${r ? `<b class="mono">${fmtN(r.mass, 2)} t</b> now` : 'not counted'}</span></h5>
 <div class="row2"><div class="fld"><label>Counts as</label><select data-inv="count"><option value="sand" ${c.count === 'sand' ? 'selected' : ''}>System sand</option><option value="add" ${c.count === 'add' ? 'selected' : ''}>Additives / bond</option><option value="none" ${c.count === 'none' ? 'selected' : ''}>Not counted</option></select></div>
 ${c.count === 'sand' ? `<div class="fld"><label>Zone</label><select data-inv="zone">${MB_ZONES.map(z => `<option ${c.zone === z ? 'selected' : ''}>${z}</option>`).join('')}</select></div>` : '<div></div>'}</div>
 ${
   c.count !== 'none'
     ? `<div class="row2"><div class="fld"><label>Method</label><select data-inv="k"><option value="level" ${c.k === 'level' ? 'selected' : ''}>Level × capacity</option><option value="belt" ${c.k === 'belt' ? 'selected' : ''}>Belt: load × length ÷ speed</option><option value="molds" ${c.k === 'molds' ? 'selected' : ''}>Molds on line × mold sand</option><option value="batch" ${c.k === 'batch' ? 'selected' : ''}>Batch in mixer</option><option value="hold" ${c.k === 'hold' ? 'selected' : ''}>Fixed hold-up</option></select></div><div></div></div>
 <div class="row2">${c.k === 'level' ? num('cap', 'Capacity at 100%', 't', c.cap, 1) : ''}${c.k === 'belt' ? num('len', 'Length (blank = from drawing)', 'm', '', 0.5).replace(`value=""`, `value="${inv.len ?? ''}" placeholder="${autoLen}"`) + num('speed', 'Belt speed', 'm/s', c.speed) : ''}${c.k === 'batch' ? num('batch', 'Batch size', 't', c.batch) : ''}${c.k === 'hold' ? num('hold', 'Hold-up', 't', c.hold || 0, 0.05) : ''}${c.k === 'molds' ? num('pitch', 'Mold thickness (if no count tag)', 'm', c.pitch, 0.01) : ''}${MB_DEF[b.type]?.mold != null ? num('mold', 'Sand per mold', 'kg', c.mold, 1) : ''}</div>
 ${r ? `<div class="note">${esc(r.basis)}</div>` : ''}`
     : ''
 }</div>`;
}
function bindMbProps(b) {
  $$('#ptab [data-inv]').forEach(
    el =>
      (el.onchange = () => {
        pushUndo();
        b.props.inv = b.props.inv || {};
        const k = el.dataset.inv;
        if (el.tagName === 'SELECT') b.props.inv[k] = el.value;
        else {
          const v = parseFloat(el.value);
          if (isFinite(v)) b.props.inv[k] = v;
          else delete b.props.inv[k];
        }
        save();
        renderProps();
        mbOverlay();
        if (MBOPEN) mbRender();
      }),
  );
}
$('#bMB').onclick = openMB;
const _closeModal = closeModal;
closeModal = function () {
  MBOPEN = false;
  MBVIEW = 'main';
  _closeModal();
};
setInterval(() => {
  if (RP) return;
  MBH.push({ t: Date.now(), ...(o => ({ v: o.sand, d: o.dry }))(inventory(null)) });
  if (MBH.length > 720) MBH.shift();
  if (MBOPEN && MBVIEW === 'main' && !$('#mbox').matches(':hover')) mbRender();
  mbOverlay();
}, 3000);
