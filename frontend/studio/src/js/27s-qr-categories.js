/*! SandMan Digital Loop Studio — 27s-qr-categories.js
 *  v10.4 — Category QR codes, next to the machine QR codes (21-machine-cards.js).
 *  · QR cards dialog has two tabs: Machine QR (the existing sheet, unchanged) and Category QR.
 *  · A category (Sand lab, Melting, Pouring, Sand preparation …) is a named list of tags from any equipment, with a
 *    colour and a short description. Create it by hand (pick tags, grouped by equipment, searchable) or start from the
 *    process areas of the loop. Each category has its own QR: <loop address>#cat=<id>.
 *  · Scan page: one page with two tabs — Machine (the existing machine card, or a list to pick a machine) and Category
 *    (the category's tags with live value, limits, status and trend; switch category with the chips at the top).
 *  Data: DOC.qrcat = [{ id, name, color, desc, tags: [tag ids] }] (saved with the loop). */

const QC_COLORS = ['#0e7490', '#b45309', '#b91c1c', '#7c3aed', '#15803d', '#1d4ed8', '#be185d', '#475569'];
function qcDoc() {
  return (DOC.qrcat = Array.isArray(DOC.qrcat) ? DOC.qrcat.filter(c => c && c.id) : []);
}
function qcUrl(c, base) {
  return (base || mcBase()) + '#cat=' + encodeURIComponent(c.id) + '&n=' + encodeURIComponent(c.name || '');
}
function qcTagOwner(id) {
  return DOC.blocks.find(b => (b.tags || []).some(t => t.id === id)) || null;
}

/* ================= QR cards dialog: Machine QR | Category QR ================= */
const QCD = { tab: 'machine', sel: null, q: '' };
{
  const sheetPrev = mcQrSheet;
  mcQrSheet = function (tab) {
    QCD.draft = null;
    QCD.dirty = false;
    sheetPrev();
    const box = $('#mbox');
    if (!box) return;
    const kids = [...box.children];
    const M = document.createElement('div');
    M.id = 'qcM';
    kids.forEach(k => M.appendChild(k));
    box.innerHTML = `<div class="qc-head"><h3>QR codes</h3><div class="lc2-seg qc-tabs"><button type="button" data-qct="machine">▦ Machine QR</button><button type="button" data-qct="category">▤ Process Parameter QR</button></div></div>`;
    box.appendChild(M);
    const h = M.querySelector('h3');
    if (h) h.remove();
    box.insertAdjacentHTML('beforeend', '<div id="qcC" hidden></div>');
    $$('#mbox [data-qct]').forEach(b => (b.onclick = () => qcTab(b.dataset.qct)));
    qcTab(tab || QCD.tab);
  };
}
function qcTab(t) {
  QCD.tab = t;
  $$('#mbox [data-qct]').forEach(b => b.setAttribute('aria-pressed', b.dataset.qct === t));
  $('#qcM').hidden = t !== 'machine';
  $('#qcC').hidden = t !== 'category';
  if (t === 'category') qcRender();
}
/* edits go to a draft; nothing changes in the loop until Save */
function qcEd() {
  if (!QCD.draft) QCD.draft = JSON.parse(JSON.stringify(qcDoc()));
  return QCD.draft;
}
function qcDirty() {
  QCD.dirty = true;
  const b = $('#qcSave'),
    t = $('#qcSt');
  if (b) b.disabled = false;
  if (t) (t.textContent = 'Unsaved changes'), t.classList.add('on');
}
function qcSave() {
  const D = qcEd().map(c => ({ ...c, name: (c.name || '').trim() || 'Untitled' }));
  pushUndo();
  DOC.qrcat = JSON.parse(JSON.stringify(D));
  QCD.draft = null;
  QCD.dirty = false;
  save();
  if (typeof changed === 'function') changed();
  toast('Process parameters saved');
  qcRender();
}
function qcRender() {
  const C = qcEd(),
    box = $('#qcC');
  if (!box) return;
  if (QCD.sel && !C.find(c => c.id === QCD.sel)) QCD.sel = null;
  if (!QCD.sel && C.length) QCD.sel = C[0].id;
  const c = C.find(x => x.id === QCD.sel);
  const base = ($('#mcBase') && $('#mcBase').value.trim()) || mcBase();
  const list = C.map(
    x => `<button type="button" class="qc-li${x.id === QCD.sel ? ' on' : ''}" data-qcs="${x.id}"><i style="background:${esc(x.color)}"></i><span><b>${esc(x.name || 'Untitled')}</b><small>${x.tags.length} tag${x.tags.length === 1 ? '' : 's'}</small></span></button>`,
  ).join('');
  let ed = '';
  if (c) {
    const q = QCD.q.trim().toLowerCase();
    const groups = DOC.blocks
      .filter(b => b.name && (b.tags || []).some(t => REG[t.id]))
      .map(b => ({ b, ids: b.tags.map(t => t.id).filter(id => REG[id] && (!q || `${b.name} ${REG[id].desc || ''} ${REG[id].short || ''} ${id}`.toLowerCase().includes(q))) }))
      .filter(g => g.ids.length)
      .sort((a, z) => a.b.name.localeCompare(z.b.name, undefined, { numeric: true }));
    const picked = new Set(c.tags);
    const tagRow = id => `<label class="qc-tg"><input type="checkbox" data-qtag="${esc(id)}" ${picked.has(id) ? 'checked' : ''}><span>${esc(REG[id].desc || REG[id].short || id)}</span><small class="mono">${esc(id)}</small><b>${esc(tagTxt(id))}</b></label>`;
    ed = `<div class="qc-ed">
      <div class="qc-f"><div class="fld"><label>Process parameter name</label><input id="qcName" value="${esc(c.name)}" placeholder="e.g. Sand lab"></div>
       <div class="fld"><label>Colour</label><div class="qc-sw">${QC_COLORS.map(k => `<button type="button" data-qcc="${k}" class="${c.color === k ? 'on' : ''}" style="background:${k}" aria-label="Colour"></button>`).join('')}</div></div></div>
      <div class="fld"><label>Description <span class="note">shown on the scan page and the sticker</span></label><input id="qcDesc" value="${esc(c.desc || '')}" placeholder="e.g. Green sand properties tested every 2 hours"></div>
      <div class="qc-tsh"><b>Tags in this process parameter <span class="qc-n">${c.tags.length}</span></b><input id="qcQ" class="ct-in" placeholder="Search tags or equipment…" value="${esc(QCD.q)}"></div>
      <div class="qc-tl">${groups.map(g => {
        const all = g.ids.every(id => picked.has(id));
        return `<div class="qc-g"><div class="qc-gh"><b>${esc(g.b.name)}</b><small>${esc(EQ[g.b.type].n || '')}</small><button type="button" class="lk" data-qall="${g.b.id}">${all ? 'Clear' : 'Select all'}</button></div>${g.ids.map(tagRow).join('')}</div>`;
      }).join('') || '<p class="note" style="padding:10px">No tags match.</p>'}</div>
     </div>
     <div class="qc-pv"><div class="qc-card" style="--c:${esc(c.color)}"><div class="qc-ch">PROCESS PARAMETER · SCAN ME</div><div class="qc-qr">${mcQr(qcUrl(c, base), 4)}</div><div class="qc-cn">${esc(c.name || 'Untitled')}</div><div class="qc-cd">${esc(c.desc || '')}</div><div class="qc-cf">${c.tags.length} live readings · ${esc(DOC.name || '')}</div></div>
      <div class="qc-pa"><button class="ib pri" id="qcPrint1">Print this sticker</button><button class="ib" id="qcOpen">Preview scan page</button><button class="ib" id="qcDel" style="color:#b42318">Delete process parameter</button></div>
      <div class="note mono qc-url">${esc(qcUrl(c, base))}</div></div>`;
  } else
    ed = `<div class="qc-empty"><b>No process parameters yet</b><p>A process parameter groups tags from any equipment under one QR — for example <i>Sand lab</i> with moisture, compactability, GCS and permeability from every line. Stick it at the lab, the furnace platform or the pouring station.</p><div><button class="ib pri" id="qcNew2">＋ New process parameter</button> <button class="ib" id="qcAreas2">Start from the process areas</button></div></div>`;
  box.innerHTML = `<div class="note">Process parameters group tags from any equipment under one QR code. Scanning it opens the same page as a machine sticker, on its <b>Process Parameter</b> tab.</div>
   <div class="qc-grid"><div class="qc-side">${list}<button type="button" class="qc-add" id="qcNew">＋ New process parameter</button><button type="button" class="lk qc-areas" id="qcAreas">Start from the process areas…</button></div><div class="qc-main">${ed}</div></div>
   <div class="mact"><span class="qc-st${QCD.dirty ? ' on' : ''}" id="qcSt">${QCD.dirty ? 'Unsaved changes' : 'All changes saved'}</span><button class="ib" id="qcClose">Close</button><button class="ib pri" id="qcSave" ${QCD.dirty ? '' : 'disabled'}>💾 Save</button>${C.length ? `<button class="ib pri" id="qcPrintAll" style="background:#fff;color:#1f6feb">Print all process parameter stickers (${C.length})</button>` : ''}</div>`;
  qcBind(c);
}
function qcNew(name, tags, color) {
  const C = qcEd();
  const c = { id: 'cat' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || 'New process parameter', color: color || QC_COLORS[C.length % QC_COLORS.length], desc: '', tags: tags || [] };
  C.push(c);
  return c;
}
function qcBind(c) {
  const on = (s, f) => $(s) && ($(s).onclick = f);
  on('#qcClose', () => {
    if (QCD.dirty && !confirm('You have unsaved process parameter changes. Close without saving?')) return;
    QCD.draft = null;
    QCD.dirty = false;
    closeModal();
  });
  on('#qcSave', qcSave);
  const mk = () => {
    
    const n = qcNew();
    QCD.sel = n.id;
    qcDirty();
    qcRender();
    setTimeout(() => $('#qcName') && ($('#qcName').select(), $('#qcName').focus()), 30);
  };
  on('#qcNew', mk);
  on('#qcNew2', mk);
  const areas = () => {
    const A = (DOC.cps || []).filter(a => (a.blocks || []).length);
    if (!A.length) return toast('This loop has no process areas');
    
    let n = 0;
    A.forEach(a => {
      const name = String(a.name || '').replace(/^[A-Z]\s*·\s*/, '').trim() || 'Area';
      if (qcEd().some(c => c.name.toLowerCase() === name.toLowerCase())) return;
      const tags = (a.blocks || []).map(B).filter(Boolean).flatMap(b => (b.tags || []).map(t => t.id)).filter(id => REG[id]);
      if (!tags.length) return;
      qcNew(name.charAt(0) + name.slice(1).toLowerCase(), [...new Set(tags)]);
      n++;
    });
    qcDirty();
    QCD.sel = qcEd()[qcEd().length - n] ? qcEd()[qcEd().length - n].id : QCD.sel;
    toast(n ? `${n} process parameter${n === 1 ? '' : 's'} made from the process areas — remove the tags you do not need` : 'Every process area already has a process parameter');
    qcRender();
  };
  on('#qcAreas', areas);
  on('#qcAreas2', areas);
  $$('#qcC [data-qcs]').forEach(b => (b.onclick = () => ((QCD.sel = b.dataset.qcs), (QCD.q = ''), qcRender())));
  on('#qcPrintAll', () => (QCD.dirty ? toast('Save the process parameters before printing') : qcPrint(qcEd())));
  if (!c) return;
  const nm = $('#qcName');
  nm.oninput = () => {
    c.name = nm.value.slice(0, 60);
    const li = $(`#qcC [data-qcs="${c.id}"] b`);
    if (li) li.textContent = c.name || 'Untitled';
    const cn = $('#qcC .qc-cn');
    if (cn) cn.textContent = c.name || 'Untitled';
  };
  nm.onchange = () => (qcDirty(), qcRender());
  const ds = $('#qcDesc');
  ds.oninput = () => {
    c.desc = ds.value.slice(0, 160);
    const cd = $('#qcC .qc-cd');
    if (cd) cd.textContent = c.desc;
  };
  ds.onchange = () => qcDirty();
  $$('#qcC [data-qcc]').forEach(b => (b.onclick = () => ((c.color = b.dataset.qcc), qcDirty(), qcRender())));
  const q = $('#qcQ');
  q.oninput = () => {
    QCD.q = q.value;
    const p = q.selectionStart;
    qcRender();
    const n = $('#qcQ');
    n.focus();
    n.setSelectionRange(p, p);
  };
  $$('#qcC [data-qtag]').forEach(i => (i.onchange = () => {
    const id = i.dataset.qtag;
    c.tags = i.checked ? [...new Set([...c.tags, id])] : c.tags.filter(x => x !== id);
    qcDirty();
    const n = $('#qcC .qc-n');
    if (n) n.textContent = c.tags.length;
    const li = $(`#qcC [data-qcs="${c.id}"] small`);
    if (li) li.textContent = `${c.tags.length} tag${c.tags.length === 1 ? '' : 's'}`;
  }));
  $$('#qcC [data-qall]').forEach(b => (b.onclick = () => {
    const ids = (B(b.dataset.qall).tags || []).map(t => t.id).filter(id => REG[id]);
    const all = ids.every(id => c.tags.includes(id));
    c.tags = all ? c.tags.filter(x => !ids.includes(x)) : [...new Set([...c.tags, ...ids])];
    qcDirty();
    qcRender();
  }));
  on('#qcPrint1', () => (QCD.dirty ? toast('Save before printing — the sticker must match the saved process parameter') : qcPrint([c])));
  on('#qcOpen', () => QCD.dirty ? toast('Save first to preview the scan page') : (closeModal(), qrShell({ tab: 'category', cat: c.id, lock: c.id, machine: null })));
  on('#qcDel', () => {
    if (!confirm(`Delete the process parameter “${c.name}”? Printed stickers for it will stop working.`)) return;
    
    QCD.draft = qcEd().filter(x => x.id !== c.id);
    QCD.sel = null;
    qcDirty();
    qcRender();
  });
}
function qcPrint(list) {
  const base = ($('#mcBase') && $('#mcBase').value.trim()) || mcBase();
  const st = list
    .map(c => `<div class="s" style="--c:${esc(c.color)}"><div class="k">PROCESS PARAMETER · SCAN ME</div><div class="q">${mcQr(qcUrl(c, base), 4)}</div><div class="n">${esc(c.name)}</div>${c.desc ? `<div class="d">${esc(c.desc)}</div>` : ''}<div class="a">${c.tags.length} live readings · ${esc(DOC.name || '')}</div></div>`)
    .join('');
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print the stickers');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Process Parameter QR stickers — ${esc(DOC.name || '')}</title><style>@page{size:A4;margin:10mm}body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}
  .s{border:2.5px solid var(--c);border-radius:4mm;padding:4mm;text-align:center;break-inside:avoid}.k{font-weight:800;font-size:8.5pt;letter-spacing:.12em;color:var(--c)}.q svg{width:46mm;height:46mm}.n{font-weight:800;font-size:16pt;color:#0f172a}.d{font-size:9pt;color:#334155;margin-top:1mm}.a{font-size:8pt;color:#64748b;margin-top:1.5mm}</style><div class="g">${st}</div><script>onload=()=>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}

/* ================= scan page: one page, two tabs — Machine | Category ================= */
const QS = { tab: 'machine', machine: null, cat: null, t: null, q: '' };
function qrShell(o) {
  Object.assign(QS, o || {});
  document.body.classList.add('mc-on', 'qr-tabbed');
  if (MODE !== 'monitor' && typeof setMode === 'function') setMode('monitor', true);
  let tb = $('#qrTabs');
  if (!tb) {
    document.body.insertAdjacentHTML('beforeend', '<div id="qrTabs"></div><div id="qrCat" class="qr-pane"></div>');
    tb = $('#qrTabs');
  }
  tb.innerHTML = `<div class="qr-in"><div class="qr-brand"><b>ORBIX</b><span>${esc(DOC.name || 'Digital Loop')}</span></div><div class="qr-tabs" role="tablist"><button role="tab" data-qrt="machine" aria-selected="${QS.tab === 'machine'}">Machine</button><button role="tab" data-qrt="category" aria-selected="${QS.tab === 'category'}">Process Parameter</button></div></div>`;
  $$('#qrTabs [data-qrt]').forEach(b => (b.onclick = () => qrShell({ tab: b.dataset.qrt })));
  clearInterval(QS.t);
  const mc = $('#mcard'),
    pane = $('#qrCat');
  if (QS.tab === 'machine' && QS.machine) {
    pane.hidden = true;
    if (!mc) mcOpenPrev(QS.machine, QS.info || null);
    else mc.hidden = false;
    qrMachineBar();
    return;
  }
  if (mc) mc.hidden = true;
  pane.hidden = false;
  const draw = () => (pane.innerHTML = QS.tab === 'machine' ? qrPickHtml() : qrCatHtml());
  draw();
  qrPaneBind();
  if (QS.tab === 'category') QS.t = setInterval(() => {
    if (document.hidden) return;
    const y = pane.scrollTop;
    draw();
    qrPaneBind();
    pane.scrollTop = y;
  }, 1000);
}
/* a "Change machine" link on the machine card (the card itself is the existing one) */
function qrMachineBar() {
  const tb = $('#qrTabs .qr-in');
  if (!tb || tb.querySelector('.qr-chg')) return;
  tb.querySelector('.qr-brand').insertAdjacentHTML('beforeend', '<button class="qr-chg" type="button">‹ All machines</button>');
  tb.querySelector('.qr-chg').onclick = () => {
    QS.machine = null;
    mcClosePrev(true);
    qrShell({ tab: 'machine' });
  };
}
function qrPickHtml() {
  const q = QS.q.trim().toLowerCase();
  const eq = mcEquip().filter(b => b.name && (!q || `${b.name} ${b.props.desc || ''} ${EQ[b.type].n || ''}`.toLowerCase().includes(q)));
  const by = {};
  eq.forEach(b => {
    const a = mcArea(b);
    (by[(a && a.name) || 'Other'] = by[(a && a.name) || 'Other'] || []).push(b);
  });
  const al = typeof mpAlarmList === 'function' ? mpAlarmList().filter(a => a.active) : [];
  return `<div class="mc-wrap"><div class="qr-h1">Machines</div><input class="qr-q" id="qrQ" placeholder="Search machine…" value="${esc(QS.q)}">${Object.entries(by)
    .map(([g, L]) => `<div class="mc-sec">${esc(g)}</div>${L.sort((a, z) => a.name.localeCompare(z.name, undefined, { numeric: true }))
      .map(b => {
        const n = al.filter(a => a.blk === b.id),
          s = n.length ? Math.max(...n.map(a => a.sev || 2)) : 0;
        return `<button class="qr-mi mcs${s >= 3 ? 3 : s ? 2 : 0}" data-qrm="${esc(b.name)}"><span><b>${esc(b.name)}</b><small>${esc(b.props.desc || EQ[b.type].n || '')}</small></span>${n.length ? `<em>${n.length} alarm${n.length > 1 ? 's' : ''}</em>` : '<i>›</i>'}</button>`;
      })
      .join('')}`)
    .join('') || '<p class="mc-none">No machine matches.</p>'}<div class="mc-foot">ORBIX Digital Loop · ${esc(DOC.name || '')}</div></div>`;
}
function qrCatHtml() {
  /* only the related categories: a category sticker shows just its own category; a machine sticker shows the
     categories that contain that machine's tags */
  const all = qcDoc(),
    mb = !QS.lock && QS.machine ? DOC.blocks.find(x => x.name === QS.machine) : null,
    mids = mb ? new Set((mb.tags || []).map(t => t.id)) : null;
  const C = QS.lock ? all.filter(x => x.id === QS.lock || (QS.catName && x.name.toLowerCase() === String(QS.catName).toLowerCase())).slice(0, 1) : mids ? all.filter(x => x.tags.some(id => mids.has(id))) : all;
  if (!C.length)
    return `<div class="mc-wrap"><div class="qr-h1">Process Parameter</div><p class="mc-none">${QS.lock ? 'This process parameter is no longer set up in the loop. Check the QR sticker.' : mb ? `${esc(mb.name)} is not in any process parameter.` : 'No process parameters are set up for this loop yet. They are made in QR cards › Process Parameter QR.'}</p></div>`;
  let c = C.find(x => x.id === QS.cat);
  if (!c && QS.catName) c = C.find(x => x.name.toLowerCase() === String(QS.catName).toLowerCase());
  if (!c) c = C[0];
  QS.cat = c.id;
  const rows = c.tags.filter(id => REG[id]).map(id => {
    const t = REG[id],
      s = tagSev(id),
      b = qcTagOwner(id),
      lim = [t.lo, t.hi].some(x => x != null) ? `Limits ${t.lo ?? '—'} – ${t.hi ?? '—'} ${esc(t.unit || '')}` : 'No limits set';
    return { s, h: `<div class="mc-r mcs${s}"><div class="mc-r1"><b>${esc(t.desc || t.short || id)}</b><span class="mc-v">${esc(tagTxt(id))}</span></div><div class="mc-r2"><span class="mc-lim">${b ? `<span class="qr-eq">${esc(b.name)}</span> · ` : ''}${lim}</span>${mcSpark(id)}</div></div>` };
  });
  const cnt = [3, 2, 1, 0].map(k => rows.filter(r => (k === 0 ? r.s === 0 : r.s === k)).length);
  rows.sort((a, z) => z.s - a.s);
  const missing = c.tags.length - rows.length;
  return `<div class="mc-wrap">${C.length < 2 ? '' : `<div class="qr-chips">${C.map(x => `<button data-qrc="${x.id}" class="${x.id === c.id ? 'on' : ''}" style="--c:${esc(x.color)}">${esc(x.name)}</button>`).join('')}</div>`}
   <div class="qr-ch" style="--c:${esc(c.color)}"><div><div class="qr-cn">${esc(c.name)}</div>${c.desc ? `<div class="qr-cd">${esc(c.desc)}</div>` : ''}</div><div class="qr-sum">${cnt[0] ? `<span class="s3">${cnt[0]} alarm</span>` : ''}${cnt[1] ? `<span class="s2">${cnt[1]} warning</span>` : ''}${cnt[2] ? `<span class="s1">${cnt[2]} near limit</span>` : ''}<span class="s0">${cnt[3]} in limits</span></div></div>
   <div class="mc-sec">Live readings · ${rows.length}</div>${rows.map(r => r.h).join('') || '<div class="mc-none">No readings in this process parameter yet.</div>'}${missing > 0 ? `<p class="mc-none">${missing} tag${missing > 1 ? 's are' : ' is'} no longer in the loop.</p>` : ''}
   <div class="mc-foot">ORBIX Digital Loop · ${esc(DOC.name || '')} · updated ${new Date().toLocaleTimeString('en-GB')}</div></div>`;
}
function qrPaneBind() {
  $$('#qrCat [data-qrc]').forEach(b => (b.onclick = () => qrShell({ tab: 'category', cat: b.dataset.qrc })));
  $$('#qrCat [data-qrm]').forEach(b => (b.onclick = () => qrShell({ tab: 'machine', machine: b.dataset.qrm, info: null })));
  const q = $('#qrQ');
  if (q)
    q.oninput = () => {
      QS.q = q.value;
      const p = q.selectionStart;
      $('#qrCat').innerHTML = qrPickHtml();
      qrPaneBind();
      const n = $('#qrQ');
      n.focus();
      n.setSelectionRange(p, p);
    };
}
/* the existing machine card runs inside this page */
const mcOpenPrev = mcOpen,
  mcClosePrev = function (keepShell) {
    clearInterval(MC);
    MC_PAUSE = false;
    MC = null;
    const ov = $('#mcard');
    if (ov) ov.remove();
    if (!keepShell) qrCloseAll();
  };
mcOpen = function (name, info) {
  QS.machine = name;
  QS.info = info || null;
  QS.tab = 'machine';
  const ov = $('#mcard');
  if (ov) ov.remove();
  mcOpenPrev(name, info);
  qrShell({ tab: 'machine', machine: name, info });
};
function qrCloseAll() {
  QS.lock = QS.catName = QS.machine = null;
  clearInterval(QS.t);
  document.body.classList.remove('mc-on', 'qr-tabbed');
  ['#qrTabs', '#qrCat', '#mcard'].forEach(s => $(s) && $(s).remove());
  if (/^#(card|cat)=/.test(location.hash)) history.replaceState(null, '', location.href.split('#')[0]);
}
mcClose = function () {
  mcClosePrev(false);
};
/* links: #card=<machine> (existing) and #cat=<category id>&n=<name> */
{
  const routePrev = mcRoute;
  mcRoute = function () {
    const m = location.hash.match(/^#cat=([^&]+)(?:&n=([^&]+))?/);
    if (m) return qrShell({ tab: 'category', lock: decodeURIComponent(m[1]), cat: decodeURIComponent(m[1]), catName: m[2] ? decodeURIComponent(m[2]) : null, machine: null });
    if (/^#card=/.test(location.hash)) QS.lock = null;
    routePrev();
  };
  window.addEventListener('hashchange', () => /^#cat=/.test(location.hash) && mcRoute());
  setTimeout(() => /^#cat=/.test(location.hash) && mcRoute(), 400);
}
/* buttons that called the old sheet now open the two-tab dialog */
setTimeout(() => {
  ['#pQR', '#vQR'].forEach(s => $(s) && ($(s).onclick = () => mcQrSheet('machine')));
  /* a separate Category QR button right after Machine QR in the ribbon */
  const v = $('#vQR');
  if (v && !$('#vCQR')) {
    v.insertAdjacentHTML('afterend', `<button class="ib rbig" id="vCQR" title="Process Parameter QR — one sticker per process parameter (Sand lab, Melting, Pouring …); scanning it shows its tags"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><path d="M5.5 5.5h2v2h-2z"/><path d="M14 4h7M14 7.5h5M3 14h18M3 17.5h18M3 21h12"/></svg><span class="rl">Process Parameter QR</span></button>`);
    $('#vCQR').onclick = () => mcQrSheet('category');
  }
  const p = $('#pQR');
  if (p) p.title = 'QR codes — one per machine, and one per process parameter (Sand lab, Melting, Pouring …)';
}, 0);

document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="qcCss">
.qc-head{display:flex;align-items:center;gap:16px;margin-bottom:6px}.qc-head h3{margin:0}.qc-tabs{display:inline-grid;grid-auto-flow:column}.qc-tabs button{padding:6px 14px;font-size:13px}
.qc-grid{display:grid;grid-template-columns:220px minmax(0,1fr);gap:14px;margin-top:10px;min-height:420px}
.qc-side{display:flex;flex-direction:column;gap:4px;border-right:1px solid var(--line);padding-right:12px}
.qc-li{display:flex;gap:9px;align-items:center;border:1px solid transparent;background:none;border-radius:8px;padding:7px 9px;text-align:left;cursor:pointer;font:13px var(--sans);color:var(--text)}.qc-li:hover{background:var(--bg2,#f3f5f8)}.qc-li.on{background:#eef4ff;border-color:#bfd3fb}
.qc-li i{width:12px;height:12px;border-radius:3px;flex:none}.qc-li small{display:block;color:var(--muted);font-size:11.5px}
.qc-add{margin-top:6px;border:1px dashed #94a3b8;background:none;border-radius:8px;padding:8px;font:600 13px var(--sans);color:#1f6feb;cursor:pointer}.qc-areas{margin-top:4px;font-size:12.5px;text-align:left}
.qc-main{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:16px;min-width:0}
.qc-f{display:grid;grid-template-columns:1fr auto;gap:12px}.qc-sw{display:flex;gap:5px;padding-top:4px}.qc-sw button{width:22px;height:22px;border-radius:6px;border:2px solid transparent;cursor:pointer}.qc-sw button.on{border-color:#0f172a;box-shadow:0 0 0 2px #fff inset}
.qc-ed .fld{margin:0 0 10px}.qc-ed .fld input{width:100%;box-sizing:border-box}
.qc-tsh{display:flex;align-items:center;gap:10px;margin:4px 0 6px}.qc-tsh input{flex:1}.qc-n{display:inline-block;min-width:20px;text-align:center;background:#1f6feb;color:#fff;border-radius:9px;font-size:11.5px;padding:0 6px;margin-left:4px}
.qc-tl{border:1px solid var(--line);border-radius:9px;max-height:330px;overflow:auto}
.qc-g+.qc-g{border-top:1px solid var(--line)}.qc-gh{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg2,#f8fafc);position:sticky;top:0}.qc-gh small{color:var(--muted)}.qc-gh .lk{margin-left:auto;font-size:12px}
.qc-tg{display:grid;grid-template-columns:18px minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:4px 10px 4px 14px;font-size:13px;cursor:pointer}.qc-tg:hover{background:#f5f8fd}.qc-tg small{color:var(--muted);font-size:11px}.qc-tg b{font:600 12px var(--mono);color:#0f766e;white-space:nowrap}
.qc-pv{display:flex;flex-direction:column;gap:10px}
.qc-card{border:2.5px solid var(--c);border-radius:12px;padding:12px;text-align:center;background:#fff}.qc-ch{font:800 10.5px var(--sans);letter-spacing:.12em;color:var(--c)}.qc-qr svg{width:170px;height:170px}.qc-cn{font:800 20px var(--sans);color:#0f172a}.qc-cd{font-size:12px;color:#475569;margin-top:2px}.qc-cf{font-size:11.5px;color:#64748b;margin-top:6px}
.qc-st{margin-right:auto;align-self:center;color:#15803d;font-size:12.5px}.qc-st.on{color:#b45309;font-weight:600}#qcC .mact{display:flex;gap:8px;align-items:center}#qcSave:disabled{opacity:.5;cursor:default}
.qc-pa{display:flex;flex-direction:column;gap:6px}.qc-url{word-break:break-all;font-size:10.5px}
.qc-empty{border:1px dashed #94a3b8;border-radius:12px;padding:30px;text-align:center;color:#475569;grid-column:1/-1;align-self:start}.qc-empty b{font-size:16px;color:#0f172a}
/* scan page */
html body.mc-on > #qrTabs:not(#_),html body.mc-on > #qrCat:not(#_){display:block!important}
html body.mc-on > #qrCat[hidden]:not(#_){display:none!important}
#qrTabs{position:fixed;left:0;right:0;top:0;z-index:9600;background:#0e2d5c;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.qr-in{max-width:560px;margin:0 auto;padding:8px 14px 0;display:flex;flex-direction:column;gap:6px}
.qr-brand{display:flex;gap:8px;align-items:baseline;font-size:13px}.qr-brand b{letter-spacing:.12em}.qr-brand span{opacity:.75}
.qr-tabs{display:grid;grid-template-columns:1fr 1fr}.qr-tabs button{border:0;background:none;color:#c7d4ea;font:700 15px var(--ui,Inter,system-ui,sans-serif);padding:9px 0 10px;border-bottom:3px solid transparent;cursor:pointer}.qr-tabs button[aria-selected=true]{color:#fff;border-bottom-color:#5eead4}
body.qr-tabbed #mcard,#qrCat{top:84px}
#qrCat{position:fixed;left:0;right:0;bottom:0;overflow:auto;background:#f3f6fa;z-index:9500;font-size:14px;line-height:1.4;font-family:var(--ui,Inter,system-ui,sans-serif);color:#152238}
#mcard[hidden]{display:none!important}
.qr-chg{margin-left:auto;border:0;background:none;color:#9fe3d9;font:600 13px var(--ui,Inter,sans-serif);padding:0;cursor:pointer}
.qr-h1{font-size:20px;font-weight:800;margin:4px 0 10px}
.qr-q{width:100%;box-sizing:border-box;border:1px solid #d5dce7;border-radius:10px;padding:10px 12px;font-size:15px;margin-bottom:6px}
.qr-mi{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid #d5dce7;border-left:5px solid #1f9d55;background:#fff;border-radius:9px;padding:10px 12px;margin-bottom:6px;cursor:pointer;font:14px var(--ui,Inter,sans-serif);color:#152238}.qr-mi small{display:block;color:#5a6a82;font-size:12.5px}.qr-mi span{flex:1}.qr-mi i{font-style:normal;color:#94a3b8;font-size:20px}.qr-mi em{font-style:normal;font-weight:700;font-size:12px;color:#d93636}
.qr-mi.mcs2{border-left-color:#ec7a15}.qr-mi.mcs3{border-left-color:#d93636}
.qr-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:6px}.qr-chips button{flex:none;border:1.5px solid var(--c);color:var(--c);background:#fff;border-radius:16px;padding:5px 12px;font:700 13px var(--ui,Inter,sans-serif);cursor:pointer}.qr-chips button.on{background:var(--c);color:#fff}
.qr-ch{border-radius:12px;background:#fff;border:1px solid #d5dce7;border-top:5px solid var(--c);padding:12px 14px;display:flex;flex-direction:column;gap:8px}.qr-cn{font-size:22px;font-weight:800;color:#0e2d5c}.qr-cd{color:#5a6a82;font-size:13px}
.qr-sum{display:flex;flex-wrap:wrap;gap:6px}.qr-sum span{font:700 12px var(--ui,Inter,sans-serif);border-radius:10px;padding:2px 9px}.qr-sum .s3{background:#fde2e2;color:#b91c1c}.qr-sum .s2{background:#ffedd5;color:#c2410c}.qr-sum .s1{background:#fef9c3;color:#a16207}.qr-sum .s0{background:#dcfce7;color:#15803d}
.qr-eq{font-weight:700;color:#334155}
</style>`,
);
