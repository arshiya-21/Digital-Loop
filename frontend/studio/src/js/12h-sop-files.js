/*! SandMan Process Flowsheet — 12h-sop-files.js
 *  v9.44 — SOP DOCUMENTS: upload PDF / Word / Excel / CSV files to a process and its equipment.
 *
 *  Metadata  → DOC.cps[i].docs  (travels with the flowsheet):
 *     { id, title, equip:[blockId…], cur:<version no>, created,
 *       versions:[{ n, fid, name, ext, size, at, by, note, replaced? }] }
 *  File data → IndexedDB 'sandman-sop-files' (this browser). PRODUCTION: replace sfPut / sfGet / sfDel with calls to the
 *              SandMan backend (the rest of the module does not change).
 *  Viewing   → PDF inline · CSV / XLSX as tables · DOCX as text + tables · DOC / XLS: download only.
 *  History   → every upload is a version; "Replace" fixes the current version; any version can be restored or downloaded. */

const SFX = {
  ext: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv'],
  max: 25 * 1024 * 1024,
  name: { pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', csv: 'CSV' },
};
const SFACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv';
let SFSEL = null, // selected document id
  SFVER = null, // version number being previewed
  SFUP = null, // upload form state { mode:'new'|'ver'|'replace'|'equip', id }
  SFTOK = 0,
  SFURL = null;
const SFMEM = new Map(); // fallback when IndexedDB is not available

/* ---------- file storage (IndexedDB, with an in-memory fallback) ---------- */
let sfDbP = null;
const sfDb = () =>
  sfDbP ||
  (sfDbP = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('sandman-sop-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('f');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) {
      rej(e);
    }
  }).catch(() => null));
async function sfPut(id, rec) {
  const db = await sfDb();
  if (!db) return void SFMEM.set(id, rec);
  return new Promise((res, rej) => {
    const tx = db.transaction('f', 'readwrite');
    tx.objectStore('f').put(rec, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function sfGet(id) {
  const db = await sfDb();
  if (!db) return SFMEM.get(id) || null;
  return new Promise((res, rej) => {
    const r = db.transaction('f').objectStore('f').get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function sfDel(id) {
  const db = await sfDb();
  if (!db) return void SFMEM.delete(id);
  return new Promise(res => {
    const tx = db.transaction('f', 'readwrite');
    tx.objectStore('f').delete(id);
    tx.oncomplete = tx.onerror = () => res();
  });
}

/* ---------- helpers ---------- */
const sfExt = n => (String(n).match(/\.([A-Za-z0-9]+)$/) || [, ''])[1].toLowerCase();
const sfSize = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const sfWhen = t => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const sfBy = () => {
  try {
    return localStorage.getItem('sandman-sop-by') || '';
  } catch (e) {
    return '';
  }
};
const sfSetBy = v => {
  try {
    localStorage.setItem('sandman-sop-by', v);
  } catch (e) {}
};
const sfDocs = p => p.docs || (p.docs = []);
const sfCur = d => d.versions.find(v => v.n === d.cur) || d.versions[d.versions.length - 1];
function sfCheck(file) {
  if (!file) return 'Choose a file first';
  const e = sfExt(file.name);
  if (!SFX.ext.includes(e)) return `“.${e || '?'}” is not supported — use PDF, Word (DOC / DOCX), Excel (XLS / XLSX) or CSV`;
  if (file.size > SFX.max) return `File is ${sfSize(file.size)} — the limit is ${sfSize(SFX.max)}`;
  if (!file.size) return 'The file is empty';
  return '';
}
const sfFid = () => 'sf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function sfAfter(msg) {
  save();
  if (msg) logEv(msg);
  if ($('#cpBody')) cpRender();
  if (typeof renderProps === 'function' && SEL && SEL.t === 'b') {
    try {
      renderProps();
    } catch (e) {}
  }
}

/* ---------- operations ---------- */
async function sfAdd(p, file, o = {}) {
  const bad = sfCheck(file);
  if (bad) return toast(bad), null;
  const fid = sfFid(),
    ext = sfExt(file.name);
  await sfPut(fid, { blob: file, name: file.name, type: file.type });
  const d = {
    id: 'sd_' + Date.now().toString(36),
    title: (o.title || file.name.replace(/\.[^.]+$/, '')).trim(),
    equip: (o.equip || p.blocks).filter(id => B(id)),
    cur: 1,
    created: Date.now(),
    versions: [{ n: 1, fid, name: file.name, ext, size: file.size, at: Date.now(), by: o.by || '', note: o.note || 'First upload' }],
  };
  sfDocs(p).push(d);
  SFSEL = d.id;
  SFVER = 1;
  sfAfter(`SOP document uploaded: ${d.title} (${p.name})`);
  toast('SOP document uploaded');
  return d;
}
async function sfNewVersion(p, d, file, o = {}) {
  const bad = sfCheck(file);
  if (bad) return toast(bad), null;
  const fid = sfFid(),
    n = Math.max(...d.versions.map(v => v.n)) + 1;
  await sfPut(fid, { blob: file, name: file.name, type: file.type });
  d.versions.push({ n, fid, name: file.name, ext: sfExt(file.name), size: file.size, at: Date.now(), by: o.by || '', note: o.note || 'New version' });
  d.cur = n;
  SFVER = n;
  sfAfter(`SOP document new version v${n}: ${d.title}`);
  toast(`Version ${n} is now current`);
  return d;
}
async function sfReplace(p, d, file, o = {}) {
  const bad = sfCheck(file);
  if (bad) return toast(bad), null;
  const v = sfCur(d),
    fid = sfFid();
  await sfPut(fid, { blob: file, name: file.name, type: file.type });
  await sfDel(v.fid);
  Object.assign(v, { fid, name: file.name, ext: sfExt(file.name), size: file.size, at: Date.now(), by: o.by || v.by, note: o.note || 'File replaced', replaced: (v.replaced || 0) + 1 });
  SFVER = v.n;
  sfAfter(`SOP document file replaced (v${v.n}): ${d.title}`);
  toast(`Version ${v.n} file replaced`);
  return d;
}
async function sfRestore(p, d, n) {
  const src = d.versions.find(v => v.n === n);
  if (!src) return;
  const rec = await sfGet(src.fid);
  if (!rec) return toast('That file is not available in this browser');
  const fid = sfFid(),
    nn = Math.max(...d.versions.map(v => v.n)) + 1;
  await sfPut(fid, rec);
  d.versions.push({ ...src, n: nn, fid, at: Date.now(), by: sfBy(), note: `Restored from v${n}`, replaced: 0 });
  d.cur = nn;
  SFVER = nn;
  sfAfter(`SOP document v${n} restored as v${nn}: ${d.title}`);
  toast(`v${n} restored as v${nn}`);
}
async function sfRemove(p, d) {
  for (const v of d.versions) await sfDel(v.fid);
  p.docs = sfDocs(p).filter(x => x.id !== d.id);
  if (SFSEL === d.id) SFSEL = null;
  sfAfter(`SOP document deleted: ${d.title}`);
  toast('SOP document deleted');
}
async function sfDownload(v) {
  const rec = await sfGet(v.fid);
  if (!rec) return toast('This file is not stored in this browser (it was uploaded on another computer)');
  const u = URL.createObjectURL(rec.blob),
    a = document.createElement('a');
  a.href = u;
  a.download = v.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
const sfDocsOfBlock = (p, b) => sfDocs(p).filter(d => !d.equip.length || d.equip.includes(b.id));

/* ---------- reading Office files (ZIP + XML, no libraries) ---------- */
async function sfZip(buf) {
  const u = new Uint8Array(buf),
    dv = new DataView(buf);
  let e = u.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a valid Office file');
  const n = dv.getUint16(e + 10, true),
    files = {};
  let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
    const nl = dv.getUint16(p + 28, true),
      el = dv.getUint16(p + 30, true),
      cl = dv.getUint16(p + 32, true);
    files[new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl))] = { m: dv.getUint16(p + 10, true), cs: dv.getUint32(p + 20, true), lh: dv.getUint32(p + 42, true) };
    p += 46 + nl + el + cl;
  }
  return {
    has: n => !!files[n],
    async text(name) {
      const f = files[name];
      if (!f) return null;
      const s = f.lh + 30 + dv.getUint16(f.lh + 26, true) + dv.getUint16(f.lh + 28, true),
        data = u.subarray(s, s + f.cs);
      if (f.m === 0) return new TextDecoder().decode(data);
      const ds = new DecompressionStream('deflate-raw'),
        w = ds.writable.getWriter();
      w.write(data);
      w.close();
      return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
    },
  };
}
const sfXml = s => new DOMParser().parseFromString(s, 'application/xml');
const sfKids = (el, name) => [...el.children].filter(c => c.localName === name);
const sfAll = (el, name) => [...el.getElementsByTagName('*')].filter(c => c.localName === name);
const sfTable = (rows, cap) => {
  if (!rows.length) return '<div class="note">This file is empty.</div>';
  const w = Math.max(...rows.map(r => r.length)),
    R = rows.slice(0, 400),
    row = (r, tag) => `<tr>${Array.from({ length: w }, (_, i) => `<${tag}>${esc(r[i] ?? '')}</${tag}>`).join('')}</tr>`;
  return `<div class="sf-tw"><table class="sf-t"><thead>${row(R[0], 'th')}</thead><tbody>${R.slice(1).map(r => row(r, 'td')).join('')}</tbody></table></div>${rows.length > 400 ? `<div class="note">Showing the first 400 of ${rows.length} rows — download the file for the rest.</div>` : ''}${cap || ''}`;
};
function sfCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '',
    dl = [',', ';', '\t'].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0],
    rows = [];
  let row = [],
    cell = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') (text[i + 1] === '"' ? ((cell += '"'), i++) : (q = false));
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === dl) (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows.filter(r => r.some(x => x !== ''));
}
async function sfXlsx(buf) {
  const z = await sfZip(buf),
    wb = sfXml(await z.text('xl/workbook.xml')),
    rels = sfXml((await z.text('xl/_rels/workbook.xml.rels')) || '<r/>'),
    ss = z.has('xl/sharedStrings.xml') ? sfAll(sfXml(await z.text('xl/sharedStrings.xml')), 'si').map(si => sfAll(si, 't').map(t => t.textContent).join('')) : [],
    target = {};
  sfAll(rels, 'Relationship').forEach(r => (target[r.getAttribute('Id')] = r.getAttribute('Target')));
  const out = [];
  for (const sh of sfAll(wb, 'sheet').slice(0, 8)) {
    let t = target[sh.getAttribute('r:id')] || '';
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    const xml = z.has(t) ? sfXml(await z.text(t)) : null,
      rows = [];
    if (xml)
      sfAll(xml, 'row').slice(0, 1000).forEach(r => {
        const arr = [];
        sfKids(r, 'c').forEach(c => {
          const ref = c.getAttribute('r') || '',
            col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1,
            ty = c.getAttribute('t'),
            v = sfKids(c, 'v')[0]?.textContent ?? '';
          arr[col >= 0 ? col : arr.length] = ty === 's' ? ss[+v] ?? '' : ty === 'inlineStr' ? sfAll(c, 't').map(x => x.textContent).join('') : ty === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
        });
        rows.push(Array.from(arr, x => x ?? ''));
      });
    out.push({ name: sh.getAttribute('name') || 'Sheet', rows: rows.filter(r => r.some(x => x !== '')) });
  }
  return out;
}
async function sfDocx(buf) {
  const z = await sfZip(buf),
    xml = sfXml(await z.text('word/document.xml')),
    body = sfAll(xml, 'body')[0];
  const para = p => {
    let s = '';
    [...p.getElementsByTagName('*')].forEach(n => {
      if (n.localName === 't') s += n.textContent;
      else if (n.localName === 'tab') s += '    ';
      else if (n.localName === 'br') s += '\n';
    });
    return s;
  };
  const html = [];
  [...body.children].forEach(n => {
    if (n.localName === 'p') {
      const st = sfAll(n, 'pStyle')[0]?.getAttribute('w:val') || '',
        t = para(n);
      if (!t.trim()) return;
      const li = sfAll(n, 'numPr').length ? '• ' : '';
      if (/^(Title|Heading ?1)$/i.test(st)) html.push(`<h3>${esc(t)}</h3>`);
      else if (/^Heading/i.test(st)) html.push(`<h4>${esc(t)}</h4>`);
      else html.push(`<p>${li}${esc(t).replace(/\n/g, '<br>')}</p>`);
    } else if (n.localName === 'tbl')
      html.push(sfTable(sfKids(n, 'tr').map(tr => sfKids(tr, 'tc').map(tc => sfKids(tc, 'p').map(para).join('\n')))));
  });
  return html.join('') || '<div class="note">No readable text in this document.</div>';
}

/* ---------- preview ---------- */
async function sfPreview(v) {
  const box = $('#sfView');
  if (!box) return;
  const tok = ++SFTOK,
    set = h => tok === SFTOK && $('#sfView') && ($('#sfView').innerHTML = h);
  if (SFURL) (URL.revokeObjectURL(SFURL), (SFURL = null));
  set('<div class="note sf-load">Loading preview…</div>');
  let rec;
  try {
    rec = await sfGet(v.fid);
  } catch (e) {}
  if (!rec) return set('<div class="sf-none">This file is not stored in this browser — it was uploaded on another computer or the browser data was cleared. Upload it again with “Replace file”.</div>');
  try {
    if (v.ext === 'pdf') {
      SFURL = URL.createObjectURL(new Blob([rec.blob], { type: 'application/pdf' }));
      return set(`<iframe class="sf-frame" src="${SFURL}" title="${esc(v.name)}"></iframe><div class="note">If the PDF does not show here, use Download.</div>`);
    }
    if (v.ext === 'csv') return set(sfTable(sfCsv(await rec.blob.text())));
    if (v.ext === 'xlsx') {
      const sheets = await sfXlsx(await rec.blob.arrayBuffer());
      const show = i => {
        set(`<div class="sf-tabs">${sheets.map((s, j) => `<button class="sf-tab ${i === j ? 'on' : ''}" data-sfsh="${j}">${esc(s.name)}</button>`).join('')}</div>${sfTable(sheets[i].rows)}`);
        $$('#sfView [data-sfsh]').forEach(b => (b.onclick = () => show(+b.dataset.sfsh)));
      };
      return show(0);
    }
    if (v.ext === 'docx') return set(`<div class="sf-docx">${await sfDocx(await rec.blob.arrayBuffer())}</div>`);
    return set(`<div class="sf-none">Preview is not available for older .${esc(v.ext)} files. Use <b>Download</b> to open it, or save it as ${v.ext === 'doc' ? 'DOCX' : 'XLSX'} and upload that version.</div>`);
  } catch (e) {
    set(`<div class="sf-none">This file could not be previewed (${esc(e.message || e)}). Use <b>Download</b> to open it.</div>`);
  }
}

/* ---------- screens ---------- */
function sfIcon(ext) {
  const c = { pdf: '#d93636', doc: '#1f6feb', docx: '#1f6feb', xls: '#1f9d55', xlsx: '#1f9d55', csv: '#66758c' }[ext] || '#66758c';
  return `<span class="sf-ic" style="background:${c}">${esc((ext || '?').toUpperCase())}</span>`;
}
function sfEquipChips(p, d) {
  const L = (d.equip.length ? d.equip : p.blocks).map(id => B(id)).filter(Boolean);
  return L.map(b => `<button class="cp-eqc" data-cploc="${b.id}" title="Locate ${esc(b.name)}">${esc(b.name)}</button>`).join('') || '<span class="note">no equipment</span>';
}
function sfFormHtml(p) {
  const f = SFUP,
    d = f.id && sfDocs(p).find(x => x.id === f.id),
    eq = p.blocks.map(id => B(id)).filter(Boolean),
    title = { new: 'Upload SOP document', ver: `Upload new version of “${d && d.title}”`, replace: `Replace the file of v${d ? d.cur : ''}`, equip: 'Equipment linked to this document' }[f.mode];
  const equipBox = `<div class="fld"><label>Equipment this SOP applies to</label><div class="sf-eq">${
    eq.map(b => `<label class="sf-eqi"><input type="checkbox" data-sfeq="${b.id}" ${!d || !d.equip.length || d.equip.includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('') || '<span class="note">This process has no equipment yet — use Define process.</span>'
  }</div></div>`;
  return `<div class="sf-form"><h4>${title}</h4>
   ${f.mode === 'equip' ? '' : `<div class="fld"><label>File — PDF, Word (DOC / DOCX), Excel (XLS / XLSX) or CSV · max ${sfSize(SFX.max)}</label><label class="sf-drop" id="sfDrop"><input type="file" id="sfFile" accept="${SFACCEPT}"><span id="sfFileName">Click to choose a file, or drop it here</span></label></div>`}
   ${f.mode === 'new' ? `<div class="fld"><label>Document title</label><input id="sfTitle" placeholder="e.g. Muller operating instruction"></div>` : ''}
   ${f.mode === 'new' || f.mode === 'equip' ? equipBox : ''}
   ${f.mode === 'equip' ? '' : `<div class="row2"><div class="fld"><label>Uploaded by</label><input id="sfBy" value="${esc(sfBy())}" placeholder="Your name"></div><div class="fld"><label>${f.mode === 'ver' ? 'What changed in this version?' : 'Note (optional)'}</label><input id="sfNote" placeholder="${f.mode === 'ver' ? 'e.g. Added reaction plan for low moisture' : ''}"></div></div>`}
   <div class="sf-fa"><button class="ib" id="sfCancel">Cancel</button><button class="ib pri" id="sfGo">${f.mode === 'equip' ? 'Save' : 'Upload'}</button></div></div>`;
}
function sopFilesHtml(p) {
  const docs = sfDocs(p);
  if (!SFSEL || !docs.some(d => d.id === SFSEL)) SFSEL = docs[0]?.id || null;
  const d = docs.find(x => x.id === SFSEL),
    v = d && (d.versions.find(x => x.n === SFVER) || sfCur(d));
  if (d && v) SFVER = v.n;
  const list = docs.length
    ? docs.map(x => {
        const c = sfCur(x);
        return `<button class="sf-card ${x.id === SFSEL ? 'on' : ''}" data-sfdoc="${x.id}">${sfIcon(c.ext)}<span class="sf-cm"><b>${esc(x.title)}</b><small>v${c.n}${x.versions.length > 1 ? ` · ${x.versions.length} versions` : ''} · ${esc(sfWhen(c.at))}${c.by ? ' · ' + esc(c.by) : ''}</small></span></button>`;
      }).join('')
    : `<div class="sf-empty"><b>No SOP documents yet</b><p>Upload the SOP file for this process (PDF, Word, Excel or CSV). It is linked to the process and its equipment.</p></div>`;
  const detail = d
    ? `<div class="sf-dh"><div><h4>${esc(d.title)}</h4><div class="sf-eqs"><span class="note">Equipment:</span>${sfEquipChips(p, d)}<button class="sb" id="sfEq" title="Change which equipment this SOP applies to">edit</button></div></div>
        <div class="sf-acts"><button class="ib pri" id="sfNew">⬆ Upload new version</button><button class="ib" id="sfRep" title="Swap the file of the current version without making a new version">Replace file</button><button class="ib" id="sfDl">⬇ Download</button><button class="ib tx3" id="sfRm">Delete</button></div></div>
       <div class="sf-vh">${sfIcon(v.ext)}<b>${esc(v.name)}</b><span class="note">v${v.n}${v.n === d.cur ? ' · current' : ' · older version'} · ${sfSize(v.size)} · ${esc(sfWhen(v.at))}${v.by ? ' · ' + esc(v.by) : ''}</span></div>
       <div class="sf-view" id="sfView"></div>
       <h5 class="sf-h5">Version history</h5><table class="sop-t sf-hist"><thead><tr><th>Ver</th><th>File</th><th>Size</th><th>Date</th><th>By</th><th>Note</th><th></th></tr></thead><tbody>${d.versions.slice().reverse().map(x => `<tr class="${x.n === v.n ? 'sf-on' : ''}"><td class="mono">v${x.n}${x.n === d.cur ? ' <span class="chip sv0">current</span>' : ''}</td><td>${esc(x.name)}</td><td class="mono">${sfSize(x.size)}</td><td class="mono">${esc(sfWhen(x.at))}</td><td>${esc(x.by || '—')}</td><td>${esc(x.note || '')}${x.replaced ? ` <span class="note">(file replaced ${x.replaced}×)</span>` : ''}</td><td class="sf-ra"><button class="sb" data-sfv="${x.n}">View</button><button class="sb" data-sfd="${x.n}">Download</button>${x.n !== d.cur ? `<button class="sb" data-sfr="${x.n}">Make current</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : `<div class="sf-empty big"><b>Select or upload a document</b></div>`;
  return `<div class="sf-wrap"><div class="sop-bar"><button class="ib" id="sfBack">← ${esc(p.name)}</button><span style="flex:1"></span><button class="ib pri" id="sfUp">⬆ Upload SOP document</button></div>
   <div class="sf-title"><h4>SOP documents · ${esc(p.name)}</h4><span class="note">${docs.length} document${docs.length === 1 ? '' : 's'} · stored in this browser</span></div>
   ${SFUP ? sfFormHtml(p) : ''}
   <div class="sf-g"><div class="sf-list">${list}</div><div class="sf-d">${detail}</div></div></div>`;
}
function sfDefHtml() {
  const f = DEF && DEF.file;
  return `<div class="sf-def"><b>④ SOP document</b> <span class="note">(optional — PDF, Word, Excel or CSV; linked to the equipment selected above)</span>
   <label class="sf-drop sm"><input type="file" id="dfFile" accept="${SFACCEPT}"><span>${f ? esc(f.name) + ' · ' + sfSize(f.size) : 'Choose the SOP file'}</span></label></div>`;
}
function sfIxHtml(p, b) {
  const L = sfDocsOfBlock(p, b);
  if (!L.length) return '';
  return `<div class="cp-ixh">SOP documents (${L.length})</div>${L.slice(0, 4).map(d => { const c = sfCur(d); return `<div class="cp-ixr sf-ixr"><span>${sfIcon(c.ext)}</span><span><b>${esc(d.title)}</b><small>v${c.n} · ${esc(sfWhen(c.at))}</small></span><button class="sb" data-sfix="${d.id}">Open</button></div>`; }).join('')}`;
}
function sfIxBind(T, p) {
  T.querySelectorAll('[data-sfix]').forEach(x => (x.onclick = () => { SFSEL = x.dataset.sfix; SFVER = null; SFUP = null; openCP(p.id, 'docs'); }));
}

/* ---------- events ---------- */
function sopFilesBind(p) {
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  const d = sfDocs(p).find(x => x.id === SFSEL),
    v = d && (d.versions.find(x => x.n === SFVER) || sfCur(d));
  on('#sfBack', () => { SFUP = null; CPVIEW = 'checks'; cpRender(); });
  on('#sfUp', () => { SFUP = { mode: 'new' }; cpRender(); });
  on('#sfCancel', () => { SFUP = null; cpRender(); });
  on('#sfNew', () => { SFUP = { mode: 'ver', id: d.id }; cpRender(); });
  on('#sfRep', () => { SFUP = { mode: 'replace', id: d.id }; cpRender(); });
  on('#sfEq', () => { SFUP = { mode: 'equip', id: d.id }; cpRender(); });
  on('#sfDl', () => v && sfDownload(v));
  on('#sfRm', () => {
    if (confirm(`Delete “${d.title}” and all ${d.versions.length} version(s)? This cannot be undone.`)) sfRemove(p, d);
  });
  $$('#mbox [data-sfdoc]').forEach(x => (x.onclick = () => { SFSEL = x.dataset.sfdoc; SFVER = null; SFUP = null; cpRender(); }));
  $$('#mbox [data-sfv]').forEach(x => (x.onclick = () => { SFVER = +x.dataset.sfv; cpRender(); }));
  $$('#mbox [data-sfd]').forEach(x => (x.onclick = () => sfDownload(d.versions.find(y => y.n === +x.dataset.sfd))));
  $$('#mbox [data-sfr]').forEach(x => (x.onclick = () => sfRestore(p, d, +x.dataset.sfr)));
  const fi = $('#sfFile');
  if (fi) {
    const pick = f => {
      const bad = f && sfCheck(f);
      $('#sfFileName').textContent = f ? (bad ? '⚠ ' + bad : f.name + ' · ' + sfSize(f.size)) : 'Click to choose a file, or drop it here';
      if (f && !bad && $('#sfTitle') && !$('#sfTitle').value) $('#sfTitle').value = f.name.replace(/\.[^.]+$/, '');
    };
    fi.onchange = () => pick(fi.files[0]);
    const dr = $('#sfDrop');
    ['dragover', 'dragenter'].forEach(ev => dr.addEventListener(ev, e => { e.preventDefault(); dr.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dr.addEventListener(ev, () => dr.classList.remove('over')));
    dr.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) { fi.files = e.dataTransfer.files; pick(fi.files[0]); } });
  }
  on('#sfGo', async () => {
    const f = SFUP,
      file = $('#sfFile')?.files[0],
      by = ($('#sfBy')?.value || '').trim(),
      note = ($('#sfNote')?.value || '').trim(),
      equip = $$('#mbox [data-sfeq]').filter(x => x.checked).map(x => x.dataset.sfeq);
    if (by) sfSetBy(by);
    if (f.mode === 'equip') {
      d.equip = equip;
      SFUP = null;
      return sfAfter(`SOP document equipment updated: ${d.title}`);
    }
    if (f.mode === 'new' && !equip.length && p.blocks.length && !confirm('No equipment ticked — the document will apply to the whole process. Continue?')) return;
    const bad = sfCheck(file);
    if (bad) return toast(bad);
    const r = f.mode === 'new' ? await sfAdd(p, file, { title: $('#sfTitle').value, equip: equip.length ? equip : p.blocks.slice(), by, note }) : f.mode === 'ver' ? await sfNewVersion(p, d, file, { by, note }) : await sfReplace(p, d, file, { by, note });
    if (r) { SFUP = null; cpRender(); }
  });
  if (v && !SFUP) sfPreview(v);
}
/* process-definition screen: remember the chosen file (the screen re-draws when equipment is ticked) */
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'dfFile' && typeof DEF !== 'undefined' && DEF) {
    const f = e.target.files[0],
      bad = f && sfCheck(f);
    if (bad) { e.target.value = ''; DEF.file = null; return toast(bad); }
    DEF.file = f || null;
    e.target.nextElementSibling.textContent = f ? f.name + ' · ' + sfSize(f.size) : 'Choose the SOP file';
  }
});

/* ---------- uploaded documents inside the SOP side panel and the Full SOP page ---------- */
function sfLinkHtml(p, full) {
  const L = sfDocs(p),
    rows = L.map(d => {
      const c = sfCur(d);
      return `<div class="sf-lk">${sfIcon(c.ext)}<span class="sf-cm"><b>${esc(d.title)}</b><small>v${c.n} · ${esc(sfWhen(c.at))}${c.by ? ' · ' + esc(c.by) : ''}</small></span><button class="sb" data-sflink="${d.id}">View</button><button class="sb" data-sflinkdl="${d.id}" title="Download">⬇</button></div>`;
    }).join('');
  return `<div class="sf-link ${full ? 'full' : ''}"><div class="sf-link-h"><b>📎 SOP documents</b><span class="note">${L.length}</span><button class="sb" id="sfLinkUp">＋ Upload</button></div>${rows || '<div class="note">No uploaded SOP file yet.</div>'}</div>`;
}
const _sfPanel = cpSopHtml;
cpSopHtml = function (p) {
  return _sfPanel(p).replace(/(<div class="sop-pan-a">.*?<\/div>)/, (m, a) => a + sfLinkHtml(p, false));
};
const _sfFull = sopDocHtml;
sopDocHtml = function (p) {
  return _sfFull(p).replace(/(<div class="sop-bar">.*?<\/div>)/, (m, a) => a + sfLinkHtml(p, true));
};
function sfLinkBind(p) {
  const open = (id, up) => { SFSEL = id || SFSEL; SFVER = null; SFUP = up ? { mode: 'new' } : null; CPVIEW = 'docs'; cpRender(); };
  $$('#mbox [data-sflink]').forEach(x => (x.onclick = () => open(x.dataset.sflink)));
  $$('#mbox [data-sflinkdl]').forEach(x => (x.onclick = () => { const d = sfDocs(p).find(y => y.id === x.dataset.sflinkdl); if (d) sfDownload(sfCur(d)); }));
  const u = $('#sfLinkUp');
  if (u) u.onclick = () => open(null, true);
}
