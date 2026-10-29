/*! SandMan Digital Loop Studio — 21-machine-cards.js
 *  v9.51 — Machine cards with QR codes (live machine information on the shop floor)
 *  · Every machine gets a phone page: <loop address>#card=<equipment tag> — live readings with limits and a small
 *    trend, the machine's active alarms, and the SOP steps of its process area. It refreshes every second.
 *  · "Machine QR" (View ribbon) / "▦ QR cards" (Publish bar) prints one QR sticker per machine; scanning the sticker on
 *    the real equipment opens its card. The address the phones open is set in the sticker sheet and can be saved with
 *    the loop (DOC.plant.cardBase) — it must be an address the phones can reach (the published SandMan address).
 *  qrcode-generator 1.4.4 (MIT) is bundled in src/vendor/. */

const MC_SKIP = new Set(['areaBox', 'label', 'title', 'legend', 'notice', 'junction']);
function mcEquip() {
  return DOC.blocks.filter(b => EQ[b.type] && !EQ[b.type].widget && !MC_SKIP.has(b.type));
}

/* ================= Machine cards (AR on the shop floor via QR) ================= */
function mcBase() {
  return (DOC.plant && DOC.plant.cardBase) || location.href.split('#')[0];
}
function mcUrl(b, base) {
  return (base || mcBase()) + '#card=' + encodeURIComponent(b.name) + mcInfoParam(b);
}
/* v9.52 — the machine's identity travels inside the QR (&i=…), so any phone shows it even before it can reach the
 * plant data: description, make / model, serial, installed, power, criticality, supplier contact. Live readings and
 * maintenance status come from the loop data when the phone can open it. */
function mcInfoOf(b) {
  const a = (DOC.maint && DOC.maint.assets && DOC.maint.assets[b.id]) || {};
  const o = { d: b.props.desc || (EQ[b.type] || {}).n || '', m: [a.make, a.model].filter(Boolean).join(' '), s: a.serial, y: a.inst ? mntFmtD(a.inst) : a.year, p: a.power, c: a.crit, v: a.supplier, t: a.phone, l: a.loc };
  Object.keys(o).forEach(k => !o[k] && delete o[k]);
  return o;
}
function mcInfoParam(b) {
  const o = mcInfoOf(b);
  if (Object.keys(o).length <= 1) return '';
  try {
    return '&i=' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) {
    return '';
  }
}
function mcInfoDecode(t) {
  try {
    t = t.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(t + '==='.slice((t.length + 3) % 4)))));
  } catch (e) {
    return null;
  }
}
function mcInfoHtml(o) {
  if (!o) return '';
  const row = (l, v) => (v ? `<div><span>${l}</span><b>${esc(v)}</b></div>` : '');
  const crit = { A: 'A — stops the whole line', B: 'B — stops one line', C: 'C — no production loss' };
  const h = [row('Make / model', o.m), row('Serial no.', o.s), row('Installed', o.y), row('Power', o.p && o.p + ' kW'), row('Criticality', o.c && (crit[o.c] || o.c)), row('Location', o.l), row('Service contact', [o.v, o.t].filter(Boolean).join(' · '))].join('');
  return h ? `<div class="mc-sec">Machine information</div><div class="mc-info">${h}${o.t ? `<a class="x3-b mc-call" href="tel:${esc(String(o.t).replace(/[^\d+]/g, ''))}">📞 Call service</a>` : ''}</div>` : '';
}
function mcArea(b) {
  return (DOC.cps || []).find(c => (c.blocks || []).includes(b.id));
}
function mcSpark(id) {
  const h = (VAL[id] && VAL[id].h) || [];
  const v = h.slice(-40).map(x => (typeof x === 'number' ? x : x && x.v)).filter(x => x != null);
  if (v.length < 2) return '';
  const lo = Math.min(...v),
    hi = Math.max(...v),
    r = hi - lo || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * 100).toFixed(1)},${(28 - ((y - lo) / r) * 24).toFixed(1)}`).join(' ');
  return `<svg class="mc-sp" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
}
function mcBody(b, compact) {
  const E = EQ[b.type] || {};
  const run = typeof effRun === 'function' ? effRun(b) : true;
  const tags = b.tags.filter(t => REG[t.id]);
  const lim = t => {
    const a = [t.lo, t.hi].some(x => x != null) ? `${t.lo ?? '—'} – ${t.hi ?? '—'}` : '';
    return a ? `<span class="mc-lim">Limits ${a}${t.hh != null || t.ll != null ? ` · alarm ${t.ll ?? '—'} / ${t.hh ?? '—'}` : ''} ${esc(t.unit || '')}</span>` : '<span class="mc-lim">No limits set</span>';
  };
  const rows = tags
    .map(bt => {
      const t = REG[bt.id],
        s = tagSev(bt.id);
      return `<div class="mc-r mcs${s}"><div class="mc-r1"><b>${esc(t.desc || bt.id)}</b><span class="mc-v">${esc(tagTxt(bt.id))}</span></div><div class="mc-r2">${lim(t)}${compact ? '' : mcSpark(bt.id)}</div><div class="mc-id mono">${esc(bt.id)}${t.link ? ' · linked' : ' · demo value'}</div></div>`;
    })
    .join('');
  const al = (typeof mpAlarmList === 'function' ? mpAlarmList() : []).filter(a => a.blk === b.id && a.active);
  const area = mcArea(b);
  const sop = area && area.sop && area.sop.steps ? area.sop.steps.slice(0, compact ? 4 : 12) : [];
  return `<div class="mc-h"><span class="mc-dot ${run ? 'on' : ''}"></span><div><div class="mc-n">${esc(b.name)}</div><div class="mc-t">${esc(b.props.desc || E.n || '')}</div></div><span class="mc-st ${run ? 'on' : ''}">${run ? 'RUNNING' : 'STOPPED'}</span></div>
 ${al.length ? `<div class="mc-al">${al.map(a => `<div><b>${a.sev >= 3 ? 'ALARM' : 'WARNING'}</b> ${esc(a.msg || a.text || '')}</div>`).join('')}</div>` : ''}
 ${compact ? '' : mcInfoHtml(Object.assign({}, MC_INFO || {}, mcInfoOf(b)))}
 <div class="mc-sec">Live readings</div>${rows || '<div class="mc-none">No readings on this machine yet.</div>'}
 ${!compact && typeof mntCardHtml === 'function' ? mntCardHtml(b) : ''}
 ${sop.length ? `<div class="mc-sec">SOP · ${esc(area.sop.no || '')} ${esc(area.name || '')}</div><ol class="mc-sop">${sop.map(s => `<li>${esc(s.t)}${s.key ? ` <span>${esc(s.key)}</span>` : ''}</li>`).join('')}</ol>` : ''}`;
}
/* phone page: <loop address>#card=<equipment tag> */
let MC_INFO = null,
  MC = null,
  MC_PAUSE = false; // v9.52 — paused while a maintenance form is open on the phone
function mcOpen(name, info) {
  MC_INFO = info || null;
  const b = DOC.blocks.find(x => x.name === name);
  let ov = $('#mcard');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'mcard';
    document.body.appendChild(ov);
  }
  document.body.classList.add('mc-on');
  if (MODE !== 'monitor' && typeof setMode === 'function') setMode('monitor', true);
  const draw = () => {
    if (MC_PAUSE) return;
    const bb = DOC.blocks.find(x => x.name === name);
    ov.innerHTML = bb
      ? `<div class="mc-wrap">${mcBody(bb, false)}<div class="mc-acts"><button class="x3-b" id="mcLoop">Open the whole loop</button></div><div class="mc-foot">Fountrix Digital Loop · ${esc(DOC.name || '')} · updated ${new Date().toLocaleTimeString()}</div></div>`
      : MC_INFO
        ? `<div class="mc-wrap"><div class="mc-h"><span class="mc-dot"></span><div><div class="mc-n">${esc(name)}</div><div class="mc-t">${esc(MC_INFO.d || '')}</div></div></div>${mcInfoHtml(MC_INFO)}<p class="mc-none">Live readings and maintenance appear when this phone can open the plant's Fountrix loop.</p><div class="mc-acts"><button class="x3-b" id="mcLoop">Open the whole loop</button></div></div>`
        : `<div class="mc-wrap"><div class="mc-n">Machine “${esc(name)}” not found</div><p class="mc-none">This loop has no equipment with that tag. Check the QR sticker or open the whole loop.</p><div class="mc-acts"><button class="x3-b" id="mcLoop">Open the whole loop</button></div></div>`;
    const lp = $('#mcLoop');
    if (lp) lp.onclick = mcClose;
    const lw = $('#mcLogW'),
      rp = $('#mcRep');
    if (lw) lw.onclick = () => mntCardSheet(bb, 'pm');
    if (rp) rp.onclick = () => mntCardSheet(bb, 'breakdown');
  };
  draw();
  clearInterval(MC);
  MC = setInterval(draw, 1000);
  if (!b) clearInterval(MC);
  if (!b && MC_INFO) MC = null;
}
function mcClose() {
  clearInterval(MC);
  MC_PAUSE = false;
  MC = null;
  document.body.classList.remove('mc-on');
  const ov = $('#mcard');
  if (ov) ov.remove();
  if (location.hash.startsWith('#card=')) history.replaceState(null, '', location.href.split('#')[0]);
}
function mcRoute() {
  const m = location.hash.match(/^#card=([^&]+)(?:&i=([^&]+))?/);
  if (m) mcOpen(decodeURIComponent(m[1]), m[2] ? mcInfoDecode(m[2]) : null);
}
/* printable QR sticker sheet */
function mcQr(text, px) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: px || 4, margin: 2, scalable: true });
}
function mcQrSheet() {
  const eq = mcEquip();
  const base = mcBase();
  const render = () => {
    const b0 = $('#mcBase').value.trim() || base;
    $('#mcGrid').innerHTML = eq
      .map(b => {
        const u = mcUrl(b, b0);
        return `<div class="mc-q"><div class="mc-qr">${mcQr(u, 4)}</div><div class="mc-qn">${esc(b.name)}</div><div class="mc-qd">${esc(b.props.desc || EQ[b.type].n)}</div><div class="mc-qs">Scan: live readings · alarms · maintenance</div></div>`;
      })
      .join('');
  };
  openModal(
    `<h3>Machine QR stickers</h3><div class="note">One sticker per machine (${eq.length}). Stick it on the real equipment — scanning it with a phone opens that machine's live card: readings, limits, alarms and the SOP steps. The phones must be able to open the loop's address, so use the published SandMan address, not a file on this computer.</div>
 <div class="fld" style="margin-top:10px"><label>Address the phones open</label><input id="mcBase" class="mono" value="${esc(base)}" spellcheck="false"></div>
 <div class="mc-grid" id="mcGrid"></div>
 <div class="mact"><button class="ib" id="mcCancel">Close</button><button class="ib" id="mcSave">Save address with the loop</button><button class="ib pri" id="mcPrint">Print stickers</button></div>`,
    'xl',
  );
  render();
  $('#mcBase').oninput = render;
  $('#mcCancel').onclick = closeModal;
  $('#mcSave').onclick = () => {
    DOC.plant = DOC.plant || {};
    DOC.plant.cardBase = $('#mcBase').value.trim();
    save();
    toast('Address saved with the loop');
  };
  // v9.52 — stickers carry the tag, description, make / model / serial and criticality (maintenance asset register)
  $('#mcPrint').onclick = () => mntPrintStickers(eq, $('#mcBase').value.trim() || base);
}

/* ---------- wiring ---------- */
(() => {
  // Publish bar: QR cards
  const lp = $('#pMon') || $('#pAlarm');
  if (lp && !$('#pQR')) {
    lp.insertAdjacentHTML('afterend', '<button class="p10" id="pQR" title="Print one QR sticker per machine — scanning it opens the machine\'s live card" aria-label="QR cards">▦<span class="p10t"> QR cards</span></button>');
    $('#pQR').onclick = mcQrSheet;
  }
  // View ribbon: Shop floor group
  const vp = document.querySelector('.rpanel[data-rp="view"]');
  if (vp && !$('#vQR')) {
    vp.insertAdjacentHTML(
      'beforeend',
      `<div class="grp" role="group" aria-label="Shop floor"><div class="gi"><button class="ib rbig" id="vQR" title="Print one QR sticker per machine — scanning it opens the machine's live card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg><span class="rl">Machine QR</span></button></div><span class="gl">Shop floor</span></div>`,
    );
    $('#vQR').onclick = mcQrSheet;
  }
  window.addEventListener('hashchange', mcRoute);
  setTimeout(mcRoute, 300);
})();
