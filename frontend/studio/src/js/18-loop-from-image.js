/*! SandMan Digital Loop Studio — 18-loop-from-image.js
 *  v3.6 — "Create Loop from Image": upload a sand-loop / process-flow picture (PNG, JPG, WebP, GIF, SVG, PDF),
 *  Claude identifies equipment, labels, sensors, control & IT parts and the connections, every item is mapped to
 *  the Equipment Library (never to new graphics), the user reviews the matches (confidence, alternatives,
 *  "Equipment not found in Library"), and the loop is generated on the canvas — fully editable.
 *  The original picture is kept with the flowsheet for comparison (side by side / overlay).
 *  AI analysis uses the viewer's Claude account through the published app on claude.ai ("sample" capability);
 *  elsewhere the picture can still be used as a tracing reference. */

/* the placeholder type 'unmapped' (Equipment not found in Library) is defined in 01-equipment-library.js so that
   saved flowsheets containing it open again on reload (they are loaded before this file runs) */

const LFI = {
  state: null, // {file, preview, w, h, blob, result, items, conns, filter}
  sample: undefined, // undefined = not checked yet, null = not available
  limits: null,
  ctl: null,
};

/* ---------- AI availability ---------- */
async function lfiAI(force) {
  if (LFI.sample !== undefined && !force) return LFI.sample;
  // remember WHY AI is not available, so the dialog can say exactly what to do
  LFI.why = '';
  try {
    if (!window.claude || typeof window.claude.use !== 'function') {
      LFI.sample = null;
      LFI.why = 'file';
      return null;
    }
    const s = await window.claude.use('sample');
    if (!s) {
      LFI.sample = null;
      LFI.why = 'nosample';
      return null;
    }
    LFI.limits = await s.limits().catch(() => null);
    if (!(LFI.limits && LFI.limits.images)) {
      LFI.sample = null;
      LFI.why = 'noimages';
      return null;
    }
    LFI.sample = s;
  } catch (e) {
    LFI.sample = null;
    LFI.why = 'error';
  }
  return LFI.sample;
}
function lfiWhyText() {
  switch (LFI.why) {
    case 'file':
      return 'AI analysis is not available because this copy of Digital Loop Studio was opened as a file (from your computer or a shared folder). Open the Digital Loop Studio link on claude.ai to analyse images. You can still use the image as a tracing reference here.';
    case 'nosample':
      return 'This claude.ai view does not give the app access to Claude. Make sure you are signed in to claude.ai and open the Digital Loop Studio link directly (not inside another site); if it still does not work, Claude access for apps may be turned off for your account or organization. You can still use the image as a tracing reference.';
    case 'noimages':
      return 'Claude is available here, but this view cannot send images to Claude (for example some app or browser versions). Try the Digital Loop Studio link in Chrome or Edge on claude.ai. You can still use the image as a tracing reference.';
    default:
      return 'AI analysis could not be started. Please reload the page and try again. You can still use the image as a tracing reference.';
  }
}
/* ---------- library catalog sent to Claude: id | name | category ---------- */
const LFI_SKIP = new Set(['label', 'areaBox', 'unmapped', 'title', 'shRect', 'shEllipse', 'shArrow', 'shBlockArrow', 'shCallout']);
function lfiCatalog() {
  return Object.values(EQ)
    .filter(e => e.cat >= 0 && !LFI_SKIP.has(e.type))
    .map(e => `${e.type} | ${e.n} | ${CATS[e.cat] || ''}`)
    .join('\n');
}
const lfiName = t => (EQ[t] ? EQ[t].n : t);

/* ---------- file → preview + image for Claude (SVG and PDF are converted to PNG) ---------- */
function lfiLoadImg(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image'));
    im.src = url;
  });
}
function lfiCanvasBlob(src, w, h, type = 'image/png', q) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(src, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r({ blob: b, url: c.toDataURL(type, q), canvas: c }), type, q));
}
let LFI_PDF = null;
function lfiPdfLib() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (LFI_PDF) return LFI_PDF;
  return (LFI_PDF = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        res(window.pdfjsLib);
      } catch (e) {
        rej(e);
      }
    };
    s.onerror = () => rej(new Error('pdf.js could not be loaded'));
    document.head.appendChild(s);
  }));
}
async function lfiPrepare(file) {
  const name = file.name || 'image';
  const type = (file.type || '').toLowerCase();
  let src, w, h;
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
    const pdfjs = await lfiPdfLib();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const sc = Math.min(3, 2400 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale: sc });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    src = c;
    w = c.width;
    h = c.height;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const im = await lfiLoadImg(url);
      src = im;
      w = im.naturalWidth || 1600;
      h = im.naturalHeight || 1000;
      if (type === 'image/svg+xml' || /\.svg$/i.test(name)) {
        const k = 2400 / Math.max(w, h);
        if (k > 1) {
          w *= k;
          h *= k;
        }
      }
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }
  // image for Claude: PNG, at most ~2400 px on the long side (the platform downsizes further)
  const k = Math.min(1, 2400 / Math.max(w, h));
  const forAI = await lfiCanvasBlob(src, w * k, h * k, 'image/png');
  // stored reference (kept with the flowsheet): JPEG, at most 1400 px
  const k2 = Math.min(1, 1400 / Math.max(w, h));
  const ref = await lfiCanvasBlob(src, w * k2, h * k2, 'image/jpeg', 0.72);
  return { name, w: Math.round(w), h: Math.round(h), blob: forAI.blob, preview: forAI.url, ref: ref.url };
}

/* ---------- the analysis prompt ---------- */
function lfiPrompt() {
  return `You are analysing an uploaded image of a foundry green-sand loop / process flow diagram (an HMI screen, P&ID, flowsheet, drawing or photo of a drawing).
Identify every piece of equipment, every instrument / sensor / data point, every control & IT component (PLC, panel, gateway, SCADA, server, network) and every connection between them.

Then map each item to the closest asset in the EQUIPMENT LIBRARY below. Never invent a library id: use only ids from the list. If nothing in the library reasonably represents the item, use null.
Mapping hints: silo / bin / hopper -> a storage or hopper asset; muller / mixer -> sand muller or intensive mixer; elevator -> bucket elevator; belt -> belt conveyor; screw -> screw feeder / conveyor; cooler -> sand cooler; shakeout / knock-out -> shakeout; moulding / DISA / flaskless -> moulding machine or moulding line; furnace, ladle, pouring; screen, magnetic separator, aerator, dust collector, cyclone, fan, pump, valves; temperature / moisture / level / flow / pressure sensors -> the matching sensor or P&ID instrument; PLC / control cabinet / MCC / operator console / SCADA / gateway -> the Control & IT assets.

Reply with ONLY one JSON object, no other text:
{
 "title": "short name of the loop",
 "equipment": [
  {"id": "E1", "label": "name or tag written on the image, or empty", "detected": "what it is, 2-5 words",
   "role": "process" | "sensor" | "control" | "it",
   "libraryId": "<id from the library or null>", "alternatives": ["<up to 3 other plausible library ids>"],
   "confidence": 0-100, "box": [x, y, width, height], "attachedTo": "<id of the equipment a sensor sits on, or null>"}
 ],
 "connections": [
  {"from": "E1", "to": "E2", "type": "material" | "signal" | "data", "label": "optional"}
 ],
 "notes": "one short sentence about anything unclear"
}
Rules:
- box = position and size of the item in the image, in 0-1000 coordinates of the image width and height.
- connections follow the direction of material flow (arrows, conveyor direction, process order: from -> to). "material" = sand / metal / moulds / castings / additives / water / air; "signal" = sensor and control wiring; "data" = network / IT links (PLC <-> gateway <-> SCADA / server).
- confidence = how sure you are about BOTH the identification and the library match (below 60 = unsure).
- Only list what is really visible. At most 80 equipment items. Use ids E1, E2, ... in reading order.

EQUIPMENT LIBRARY (id | name | category):
${lfiCatalog()}`;
}

/* ---------- normalise Claude's answer ---------- */
function lfiNormalise(r) {
  const eq = Array.isArray(r && r.equipment) ? r.equipment.slice(0, 80) : [];
  const ids = new Set();
  const items = eq
    .map((e, i) => {
      let id = String(e.id || 'E' + (i + 1));
      while (ids.has(id)) id += '_';
      ids.add(id);
      const lib = e.libraryId && EQ[e.libraryId] && EQ[e.libraryId].cat >= 0 ? String(e.libraryId) : null;
      const alts = (Array.isArray(e.alternatives) ? e.alternatives : []).map(String).filter(a => EQ[a] && EQ[a].cat >= 0 && a !== lib).slice(0, 3);
      const conf = Math.max(0, Math.min(100, Math.round(+e.confidence || 0)));
      let box = Array.isArray(e.box) && e.box.length === 4 ? e.box.map(v => Math.max(0, Math.min(1000, +v || 0))) : [((i % 6) + 0.5) * 160, (Math.floor(i / 6) + 0.5) * 160, 80, 80];
      if (box[2] < 4) box[2] = 40;
      if (box[3] < 4) box[3] = 40;
      const status = !lib ? 'notfound' : conf >= 85 ? 'matched' : 'confirm';
      return {
        id,
        label: String(e.label || '').slice(0, 40),
        detected: String(e.detected || 'Unknown equipment').slice(0, 60),
        role: ['process', 'sensor', 'control', 'it'].includes(e.role) ? e.role : 'process',
        lib,
        alts,
        conf,
        box,
        attachedTo: e.attachedTo ? String(e.attachedTo) : null,
        status,
        choice: lib || (alts[0] && conf >= 40 ? alts[0] : ''), // '' = placeholder, 'skip' = leave out
        confirmed: status === 'matched',
      };
    })
    .filter(x => x);
  const conns = (Array.isArray(r && r.connections) ? r.connections : [])
    .map(c => ({ from: String(c.from || ''), to: String(c.to || ''), type: ['material', 'signal', 'data'].includes(c.type) ? c.type : 'material', label: String(c.label || '').slice(0, 30) }))
    .filter(c => ids.has(c.from) && ids.has(c.to) && c.from !== c.to);
  return { title: String((r && r.title) || '').slice(0, 60), notes: String((r && r.notes) || '').slice(0, 240), items, conns };
}
function lfiCounts(items) {
  const c = { all: items.length, matched: 0, confirm: 0, notfound: 0 };
  items.forEach(it => c[lfiStatus(it)]++);
  return c;
}
function lfiStatus(it) {
  if (it.choice === 'skip') return 'matched'; // the user decided
  if (!it.choice) return 'notfound';
  if (it.confirmed) return 'matched';
  return it.status === 'notfound' ? 'confirm' : it.status;
}

/* ---------- overlay UI (own layer, below #modal so the equipment designer can open on top) ---------- */
function lfiShell(inner) {
  let ov = document.getElementById('lfi');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'lfi';
    ov.className = 'lfi';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Create Loop from Image');
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="lfi-box"><div class="lfi-hd"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#6b4fd6" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v14H4z" fill="#6b4fd6" fill-opacity=".14" stroke="none"/><path d="M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17"/><path d="M15.5 8.5h.01"/></svg><b>Create Loop from Image</b><span class="lfi-steps" id="lfiSteps"></span><button class="ib lfi-x" id="lfiClose" aria-label="Close">✕</button></div>${inner}</div>`;
  ov.classList.add('on');
  document.getElementById('lfiClose').onclick = lfiClose;
  return ov;
}
function lfiClose() {
  if (LFI.ctl) LFI.ctl.abort();
  const ov = document.getElementById('lfi');
  if (ov) ov.classList.remove('on');
}
function lfiSteps(n) {
  const el = document.getElementById('lfiSteps');
  if (el) el.innerHTML = ['Upload', 'AI analysis', 'Review matches', 'Generate'].map((t, i) => `<i class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}">${i + 1}. ${t}</i>`).join('');
}

/* step 1 — upload */
async function openLoopFromImage() {
  if (typeof RP !== 'undefined' && RP) {
    toast('Leave traceability (Back to live) first');
    return;
  }
  if (MODE !== 'design' && typeof setMode === 'function') setMode('design');
  LFI.state = null;
  lfiShell(`<div class="lfi-body lfi-up">
   <label class="lfi-drop" id="lfiDrop" tabindex="0"><input type="file" id="lfiFile" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.svg,.pdf" hidden>
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#1f6feb" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
    <b>Drop your sand loop / process flow image here</b><span>or click to choose · PNG, JPG, WebP, GIF, SVG or PDF (first page)</span></label>
   <div class="lfi-prev" id="lfiPrev" hidden></div>
   <div class="lfi-opts" id="lfiOpts" hidden>
    <label><input type="radio" name="lfiMode" value="replace" ${DOC.blocks.length ? '' : 'checked'}> Replace the current flowsheet</label>
    <label><input type="radio" name="lfiMode" value="add" ${DOC.blocks.length ? 'checked' : ''}> Add next to the current flowsheet</label>
   </div>
   <p class="lfi-ai" id="lfiAI">Checking AI availability…</p>
   <details class="lfi-chat" id="lfiChat" hidden><summary>Analyse with Claude chat instead (works everywhere)</summary>
    <ol>
     <li><button class="ib sm" id="lfiCopy">Copy the analysis instructions</button> <span class="lfi-copied" id="lfiCopied"></span></li>
     <li>Open a new chat on <b>claude.ai</b>, attach <b id="lfiFname">your image</b>, paste the instructions and send.</li>
     <li>Paste Claude's whole answer here:<textarea id="lfiPaste" rows="5" placeholder='{"title": "...", "equipment": [ ... ], "connections": [ ... ]}'></textarea></li>
    </ol>
    <div class="lfi-chatft"><span class="lfi-perr" id="lfiPerr"></span><button class="ib pri sm" id="lfiUsePaste">Use this analysis</button></div>
    <textarea id="lfiPromptBox" class="lfi-promptbox" readonly hidden></textarea>
   </details>
  </div>
  <div class="lfi-ft"><button class="ib" id="lfiCancel">Cancel</button><span class="grow"></span><button class="ib" id="lfiRefOnly" hidden>Use as tracing reference only</button><button class="ib pri" id="lfiGo" disabled>Analyse image</button></div>`);
  lfiSteps(1);
  document.getElementById('lfiCancel').onclick = lfiClose;
  const fileIn = document.getElementById('lfiFile'),
    drop = document.getElementById('lfiDrop');
  const take = async f => {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      toast('That file is larger than 25 MB — please use a smaller image');
      return;
    }
    document.getElementById('lfiPrev').hidden = false;
    document.getElementById('lfiPrev').innerHTML = '<div class="lfi-wait">Reading the file…</div>';
    try {
      const p = await lfiPrepare(f);
      LFI.state = { file: f.name, ...p };
      document.getElementById('lfiPrev').innerHTML = `<img src="${p.preview}" alt="Uploaded sand loop image"><span>${esc(p.name)} · ${p.w} × ${p.h} px</span>`;
      document.getElementById('lfiOpts').hidden = false;
      document.getElementById('lfiChat').hidden = false;
      document.getElementById('lfiFname').textContent = p.name;
      drop.classList.add('small');
      const ai = await lfiAI();
      document.getElementById('lfiGo').disabled = !ai;
      document.getElementById('lfiRefOnly').hidden = false;
    } catch (e) {
      document.getElementById('lfiPrev').innerHTML = `<div class="lfi-err">This file could not be read${/pdf/i.test(String(e && e.message)) ? ' (PDF support needs an internet connection)' : ''}. Try a PNG or JPG.</div>`;
    }
  };
  fileIn.onchange = () => take(fileIn.files[0]);
  drop.addEventListener('dragover', e => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    take(e.dataTransfer.files[0]);
  });
  drop.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && fileIn.click());
  document.getElementById('lfiGo').onclick = () => lfiAnalyse();
  document.getElementById('lfiCopy').onclick = async () => {
    const txt = lfiPrompt() + '\n\n(The image is attached to this message.)';
    const box = document.getElementById('lfiPromptBox'),
      lab = document.getElementById('lfiCopied');
    let done = false;
    try {
      await navigator.clipboard.writeText(txt);
      done = true;
    } catch (e) {}
    if (!done) {
      // clipboard blocked: show the text, selected, so Ctrl+C copies it
      box.hidden = false;
      box.value = txt;
      box.focus();
      box.select();
      try {
        done = document.execCommand('copy');
      } catch (e) {}
    }
    lab.textContent = done ? '✓ Copied' : 'Select the text below and press Ctrl+C';
  };
  document.getElementById('lfiUsePaste').onclick = () => {
    const raw = document.getElementById('lfiPaste').value,
      err = document.getElementById('lfiPerr');
    const a = raw.indexOf('{'),
      z = raw.lastIndexOf('}');
    let r = null;
    try {
      r = a >= 0 && z > a ? JSON.parse(raw.slice(a, z + 1)) : null;
    } catch (e) {
      r = null;
    }
    if (!LFI.state) {
      err.textContent = 'Choose the image first.';
      return;
    }
    if (!r || !Array.isArray(r.equipment)) {
      err.textContent = 'That does not look like the analysis — paste Claude\'s whole answer (it starts with { and ends with }).';
      return;
    }
    const res = lfiNormalise(r);
    if (!res.items.length) {
      err.textContent = 'The analysis lists no equipment.';
      return;
    }
    LFI.state.mode = (document.querySelector('input[name="lfiMode"]:checked') || {}).value || 'replace';
    Object.assign(LFI.state, res);
    LFI.state.filter = 'all';
    lfiReview();
  };
  document.getElementById('lfiRefOnly').onclick = () => {
    if (!LFI.state) return;
    lfiPlaceReference(null);
    lfiClose();
    toast('Image placed as a tracing reference — build the loop over it (Reference image bar, top-left)');
  };
  const show = async force => {
    const msg = document.getElementById('lfiAI');
    if (msg) msg.innerHTML = '<span class="no">●</span> Checking AI availability…';
    const ai = await lfiAI(force);
    const m = document.getElementById('lfiAI');
    if (!m) return;
    m.innerHTML = ai
      ? '<span class="ok">●</span> AI analysis is available. It uses your Claude account; you may be asked to allow it the first time.'
      : `<span class="no">●</span> ${esc(lfiWhyText())} <button class="lnk" id="lfiRecheck">Check again</button>`;
    const go = document.getElementById('lfiGo');
    if (go) go.disabled = !ai || !LFI.state;
    const ch = document.getElementById('lfiChat');
    if (ch && !ai) ch.open = true;
    const rc = document.getElementById('lfiRecheck');
    if (rc) rc.onclick = () => show(true);
  };
  show(false);
}

/* step 2 — analysis */
async function lfiAnalyse() {
  const st = LFI.state;
  const sample = await lfiAI();
  if (!st || !sample) return;
  st.mode = (document.querySelector('input[name="lfiMode"]:checked') || {}).value || 'replace';
  lfiShell(`<div class="lfi-body lfi-run"><img src="${st.preview}" alt="Uploaded image" class="lfi-runimg"><div class="lfi-runinfo"><div class="lfi-spin" aria-hidden="true"></div><b id="lfiPhase">Analysing the image…</b><span id="lfiSub">Identifying equipment, labels, sensors, control &amp; IT parts and connections, then matching them to the Equipment Library. This usually takes 30–90 seconds.</span><code id="lfiLive"></code></div></div>
  <div class="lfi-ft"><button class="ib" id="lfiStop">Stop</button></div>`);
  lfiSteps(2);
  LFI.ctl = new AbortController();
  document.getElementById('lfiStop').onclick = () => LFI.ctl && LFI.ctl.abort();
  let got = 0;
  try {
    const r = await sample.json(lfiPrompt(), {
      images: [st.blob],
      modelTier: 'complex',
      signal: LFI.ctl.signal,
      onText: ({ text }) => {
        const n = (text.match(/"libraryId"/g) || []).length;
        if (n !== got) {
          got = n;
          const ph = document.getElementById('lfiPhase');
          if (ph) ph.textContent = `Identified ${n} item${n === 1 ? '' : 's'} so far…`;
        }
      },
    });
    LFI.ctl = null;
    const res = lfiNormalise(r);
    if (!res.items.length) {
      lfiError('No equipment could be identified in this image. Try a sharper or larger image of the loop.');
      return;
    }
    Object.assign(st, res);
    st.filter = 'all';
    lfiReview();
  } catch (e) {
    LFI.ctl = null;
    const code = e && e.code;
    if (code === 'cancelled') return openLoopFromImage();
    const msg =
      code === 'not_granted' || code === 'sampling_disabled'
        ? 'AI analysis was not allowed for this app. You can still use the image as a tracing reference.'
        : code === 'rate_limited'
          ? 'Too many requests right now — please try again in a little while.'
          : code === 'image_rejected'
            ? 'The image was not accepted. Try a PNG or JPG under 20 MB.'
            : code === 'invalid_json'
              ? 'The analysis came back incomplete. Please try again.'
              : 'The analysis could not be completed. Please try again.';
    lfiError(msg);
  }
}
function lfiError(msg) {
  lfiShell(`<div class="lfi-body"><div class="lfi-err big">${esc(msg)}</div></div><div class="lfi-ft"><button class="ib" id="lfiBack">Back</button><span class="grow"></span><button class="ib" id="lfiRef2">Use as tracing reference</button><button class="ib pri" id="lfiRetry">Try again</button></div>`);
  lfiSteps(2);
  document.getElementById('lfiBack').onclick = openLoopFromImage;
  document.getElementById('lfiRetry').onclick = lfiAnalyse;
  document.getElementById('lfiRef2').onclick = () => {
    lfiPlaceReference(null);
    lfiClose();
  };
}

/* step 3 — review matches */
function lfiOptions(it) {
  const pick = new Set([it.lib, ...it.alts].filter(Boolean));
  const top = [...pick].map(t => `<option value="${t}" ${it.choice === t ? 'selected' : ''}>★ ${esc(lfiName(t))}</option>`).join('');
  const groups = {};
  Object.values(EQ)
    .filter(e => e.cat >= 0 && !LFI_SKIP.has(e.type) && !pick.has(e.type))
    .forEach(e => (groups[CATS[e.cat]] = groups[CATS[e.cat]] || []).push(e));
  const rest = Object.entries(groups)
    .map(([c, es]) => `<optgroup label="${esc(c)}">${es.map(e => `<option value="${e.type}" ${it.choice === e.type ? 'selected' : ''}>${esc(e.n)}</option>`).join('')}</optgroup>`)
    .join('');
  return `${top ? `<optgroup label="Suggested">${top}</optgroup>` : ''}<option value="" ${!it.choice ? 'selected' : ''}>⚠ Equipment not found in Library (placeholder)</option><option value="skip" ${it.choice === 'skip' ? 'selected' : ''}>Leave out</option>${rest}`;
}
function lfiReview() {
  const st = LFI.state;
  const c = lfiCounts(st.items);
  const rows = st.items
    .map((it, i) => ({ it, i, s: lfiStatus(it) }))
    .filter(r => st.filter === 'all' || r.s !== 'matched');
  const box = it => `left:${it.box[0] / 10}%;top:${it.box[1] / 10}%;width:${it.box[2] / 10}%;height:${it.box[3] / 10}%`;
  lfiShell(`<div class="lfi-sum">
    <div><b>${c.all}</b><span>Detected equipment</span></div>
    <div class="ok"><b>${c.matched}</b><span>Matched from Library</span></div>
    <div class="cf"><b>${c.confirm}</b><span>Needs confirmation</span></div>
    <div class="nf"><b>${c.notfound}</b><span>Not found</span></div>
    <div><b>${st.conns.length}</b><span>Connections</span></div>
   </div>
   <div class="lfi-body lfi-rev">
    <div class="lfi-img"><div class="lfi-imgin"><img src="${st.preview}" alt="Uploaded image">${st.items.map((it, i) => `<button class="lfi-bb s-${lfiStatus(it)}" data-i="${i}" style="${box(it)}" title="${esc(it.detected)} · ${it.conf}%"><i>${i + 1}</i></button>`).join('')}</div>
     ${st.notes ? `<p class="lfi-note">${esc(st.notes)}</p>` : ''}</div>
    <div class="lfi-list"><div class="lfi-lhd"><b>${st.filter === 'all' ? 'All detected equipment' : 'Needs your attention'}</b><span class="grow"></span><button class="ib sm" id="lfiFilter">${st.filter === 'all' ? 'Show only items to review' : 'Show all'}</button></div>
     <table class="lfi-t"><thead><tr><th>#</th><th>Detected</th><th>Name on canvas</th><th>Library asset</th><th>Match</th></tr></thead><tbody>
     ${rows.length ? rows
       .map(
         ({ it, i, s }) => `<tr class="s-${s}" data-row="${i}"><td><button class="lfi-n" data-go="${i}">${i + 1}</button></td>
        <td><b>${esc(it.detected)}</b><small>${esc(it.role === 'it' ? 'Control & IT' : it.role === 'control' ? 'Control' : it.role === 'sensor' ? 'Sensor / data point' : 'Process equipment')}</small></td>
        <td><input class="lfi-lbl" data-i="${i}" value="${esc(it.label)}" placeholder="${esc(it.label || 'auto')}" aria-label="Name for item ${i + 1}"></td>
        <td><select class="lfi-sel" data-i="${i}" aria-label="Library asset for item ${i + 1}">${lfiOptions(it)}</select>${s === 'notfound' ? '<div class="lfi-nf">Equipment not found in Library — choose an alternative, <button class="lnk" data-new="' + i + '">add a new equipment asset</button>, or keep the placeholder.</div>' : ''}</td>
        <td><div class="lfi-conf"><span style="width:${it.conf}%" class="${it.conf >= 85 ? 'hi' : it.conf >= 60 ? 'md' : 'lo'}"></span></div><small>${it.conf}% ${s === 'matched' ? (it.confirmed && it.status !== 'matched' ? '· confirmed' : '· match') : ''}</small>${s === 'confirm' ? `<button class="ib sm lfi-ok" data-ok="${i}">✓ Confirm</button>` : ''}</td></tr>`,
       )
       .join('') : '<tr><td colspan="5" class="lfi-empty">Nothing left to review — every item is matched or decided.</td></tr>'}
     </tbody></table></div>
   </div>
   <div class="lfi-ft"><button class="ib" id="lfiCancel2">Cancel</button><span class="grow"></span><span class="lfi-hint">${c.confirm ? `${c.confirm} item${c.confirm > 1 ? 's' : ''} still need confirmation — you can confirm them or generate anyway.` : 'Ready to generate.'}</span><button class="ib" id="lfiReviewBtn">Review Matches</button><button class="ib pri" id="lfiGen">Generate Loop</button></div>`);
  lfiSteps(3);
  const ov = document.getElementById('lfi');
  ov.querySelector('#lfiCancel2').onclick = lfiClose;
  ov.querySelector('#lfiFilter').onclick = () => {
    st.filter = st.filter === 'all' ? 'attention' : 'all';
    lfiReview();
  };
  ov.querySelector('#lfiReviewBtn').onclick = () => {
    st.filter = 'attention';
    lfiReview();
  };
  ov.querySelectorAll('.lfi-sel').forEach(
    s =>
      (s.onchange = () => {
        const it = st.items[+s.dataset.i];
        it.choice = s.value;
        it.confirmed = !!s.value && s.value !== 'skip';
        lfiReview();
      }),
  );
  ov.querySelectorAll('.lfi-lbl').forEach(inp => (inp.onchange = () => (st.items[+inp.dataset.i].label = inp.value.trim().slice(0, 40))));
  ov.querySelectorAll('[data-ok]').forEach(
    b =>
      (b.onclick = () => {
        st.items[+b.dataset.ok].confirmed = true;
        lfiReview();
      }),
  );
  ov.querySelectorAll('[data-new]').forEach(
    b =>
      (b.onclick = () => {
        const it = st.items[+b.dataset.new];
        const before = new Set(Object.keys(EQ));
        openDesigner(null);
        const nm = document.querySelector('#modal input');
        if (nm) nm.value = it.detected;
        // when the designer has saved a new asset, select it for this item
        const t = setInterval(() => {
          if (document.getElementById('modal').classList.contains('on')) return;
          clearInterval(t);
          const fresh = Object.keys(EQ).filter(k => !before.has(k));
          if (fresh.length) {
            it.choice = fresh[0];
            it.confirmed = true;
            toast(`“${lfiName(fresh[0])}” added to the library and used for item ${+b.dataset.new + 1}`);
          }
          if (LFI.state === st && document.getElementById('lfi')?.classList.contains('on')) lfiReview();
        }, 400);
      }),
  );
  const hi = i => {
    ov.querySelectorAll('.lfi-bb').forEach(x => x.classList.toggle('hl', +x.dataset.i === i));
    ov.querySelectorAll('tr[data-row]').forEach(x => x.classList.toggle('hl', +x.dataset.row === i));
  };
  ov.querySelectorAll('.lfi-bb').forEach(
    b =>
      (b.onclick = () => {
        const i = +b.dataset.i;
        hi(i);
        const row = ov.querySelector(`tr[data-row="${i}"]`);
        if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }),
  );
  ov.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => hi(+b.dataset.go)));
  ov.querySelector('#lfiGen').onclick = () => lfiGenerate();
}

/* step 4 — generate the loop */
function lfiBestPorts(a, b) {
  const pa = ports(a),
    pb = ports(b);
  if (!pa.length || !pb.length) return null;
  const okA = pa.filter(p => p.dir !== 'in'),
    okB = pb.filter(p => p.dir !== 'out');
  const A = okA.length ? okA : pa,
    Bp = okB.length ? okB : pb;
  let best = null;
  for (const p of A)
    for (const q of Bp) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.d) best = { d, a: p.id, b: q.id };
    }
  return best;
}
function lfiGenerate() {
  const st = LFI.state;
  if (!st) return;
  pushUndo();
  if (st.mode === 'replace') {
    DOC = blankDoc();
    REG = {};
  }
  DOC.name = st.mode === 'replace' ? st.title || 'Loop from image' : DOC.name;
  // world frame: the image mapped to ~2400 units wide, to the right of existing content when adding
  const W = 2400,
    H = Math.round((W * st.h) / st.w);
  let ox = 60,
    oy = 60;
  if (st.mode === 'add' && DOC.blocks.length) {
    const xs = DOC.blocks.map(b => b.x + dims(b).W);
    ox = Math.max(...xs) + 200;
    oy = Math.min(...DOC.blocks.map(b => b.y));
  }
  const map = {};
  const placed = [];
  const taken = new Set(DOC.blocks.map(b => b.name));
  // spread factor: keep enough room between items whose library drawings are larger than on the image
  const use = st.items.filter(it => it.choice !== 'skip');
  const cx = it => ((it.box[0] + it.box[2] / 2) / 1000) * W,
    cy = it => ((it.box[1] + it.box[3] / 2) / 1000) * H;
  let spread = 1;
  if (use.length > 1) {
    const nn = use.map(a => Math.min(...use.filter(b => b !== a).map(b => Math.hypot(cx(a) - cx(b), cy(a) - cy(b))))).sort((a, b) => a - b);
    const med = nn[Math.floor(nn.length / 2)] || 1;
    const sz = use.map(it => {
      const E = EQ[it.choice] || EQ.unmapped;
      return Math.max(E.w, E.h);
    });
    const avg = sz.reduce((a, b) => a + b, 0) / sz.length;
    spread = Math.min(3, Math.max(1, (avg * 1.25) / med));
  }
  for (const it of use) {
    const type = it.choice && EQ[it.choice] ? it.choice : 'unmapped';
    const E = EQ[type];
    let name = (it.label || '').trim();
    if (name) {
      if (taken.has(name)) name = uniqueName(name, taken);
    } else name = undefined;
    const x = ox + cx(it) * spread - E.w / 2,
      y = oy + cy(it) * spread - E.h / 2;
    const b = addBlock(type, Math.round(x / 10) * 10, Math.round(y / 10) * 10, name ? { name } : {});
    if (name) taken.add(b.name);
    else taken.add(b.name);
    if (type === 'unmapped') b.props.text = it.detected.slice(0, 26);
    b.props.desc = b.props.desc || it.detected;
    b.props.lfi = { conf: it.conf, detected: it.detected, src: 'image' };
    map[it.id] = b;
    placed.push(b);
  }
  // remove overlaps (keep the image's arrangement, push apart where library drawings are bigger)
  const pad = 30;
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i],
          b = placed[j],
          da = dims(a),
          db = dims(b);
        const ox2 = Math.min(a.x + da.W + pad, b.x + db.W + pad) - Math.max(a.x, b.x),
          oy2 = Math.min(a.y + da.H + pad, b.y + db.H + pad) - Math.max(a.y, b.y);
        if (ox2 > 0 && oy2 > 0) {
          moved = true;
          if (ox2 < oy2) {
            const s = a.x + da.W / 2 < b.x + db.W / 2 ? -1 : 1;
            a.x += (s * ox2) / 2;
            b.x -= (s * ox2) / 2;
          } else {
            const s = a.y + da.H / 2 < b.y + db.H / 2 ? -1 : 1;
            a.y += (s * oy2) / 2;
            b.y -= (s * oy2) / 2;
          }
        }
      }
    if (!moved) break;
  }
  placed.forEach(b => {
    b.x = Math.round(b.x / 10) * 10;
    b.y = Math.round(b.y / 10) * 10;
  });
  // sensors next to the equipment they belong to
  for (const it of use)
    if (it.role === 'sensor' && it.attachedTo && map[it.attachedTo] && map[it.id]) {
      const host = map[it.attachedTo],
        s = map[it.id],
        dh = dims(host);
      const dx = s.x - host.x,
        dy = s.y - host.y;
      if (Math.hypot(dx, dy) > Math.max(dh.W, dh.H) * 1.6) {
        s.x = Math.round((host.x + dh.W + 16) / 10) * 10;
        s.y = Math.round((host.y + 8) / 10) * 10;
      }
    }
  // connections: material lines follow the flow; signal / data lines are dashed
  let made = 0,
    skipped = 0;
  for (const c of st.conns) {
    const a = map[c.from],
      b = map[c.to];
    if (!a || !b) {
      skipped++;
      continue;
    }
    const pp = lfiBestPorts(a, b);
    if (!pp) {
      skipped++;
      continue;
    }
    try {
      const s = connect(a.id, pp.a, b.id, pp.b, c.type === 'material' ? undefined : c.type === 'data' ? 'data' : 'any');
      if (c.type === 'signal') {
        s.dash = 'dashed';
        s.color = '#1f6feb';
        s.width = 1.6;
      }
      if (c.label) s.name = c.label;
      made++;
    } catch (e) {
      skipped++;
    }
  }
  // keep the original picture for comparison, framed over the generated area
  const bx = placed.length ? Math.min(...placed.map(b => b.x)) : ox,
    by = placed.length ? Math.min(...placed.map(b => b.y)) : oy;
  lfiPlaceReference({ x: ox, y: oy, w: W * spread, h: H * spread, keepUndo: true, bx, by });
  SEL = null;
  SELM.clear();
  logEv(`Loop generated from image “${st.file}”: ${placed.length} items, ${made} connections`);
  changed();
  lfiClose();
  lfiSyncBar();
  requestAnimationFrame(() => requestAnimationFrame(lfiFitBeside));
  const nf = placed.filter(b => b.type === 'unmapped').length;
  toast(`Loop generated: ${placed.length} items, ${made} connections${nf ? ` · ${nf} placeholder${nf > 1 ? 's' : ''} to replace` : ''}${skipped ? ` · ${skipped} connection${skipped > 1 ? 's' : ''} could not be drawn` : ''} — Ctrl+Z undoes`);
  lfiSyncBar();
}

/* ---------- reference image: kept with the flowsheet, compare side by side or as an overlay ---------- */
function lfiPlaceReference(frame) {
  const st = LFI.state;
  if (!st) return;
  if (!frame || !frame.keepUndo) pushUndo();
  let f = frame;
  if (!f) {
    // tracing: put the image where the view is
    const W = 2400,
      H = Math.round((W * st.h) / st.w);
    const xs = DOC.blocks.map(b => b.x + dims(b).W);
    f = { x: DOC.blocks.length ? Math.max(...xs) + 200 : 60, y: 60, w: W, h: H };
  }
  DOC.refImg = { src: st.ref, x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h), name: st.file, mode: frame ? 'side' : 'overlay', op: 0.45 };
  if (!frame) {
    changed();
    requestAnimationFrame(() => fit());
  }
  lfiSyncBar();
}
/* side by side: fit the generated loop into the free area right of the original-image panel */
function lfiFitBeside() {
  const side = document.getElementById('refSide'),
    wrap = document.getElementById('cwrap');
  if (!side || side.hidden || !wrap || !DOC.blocks.length) return;
  const W = wrap.clientWidth,
    H = wrap.clientHeight,
    pw = side.getBoundingClientRect().right - wrap.getBoundingClientRect().left + 16;
  const xs = DOC.blocks.map(b => b.x),
    ys = DOC.blocks.map(b => b.y),
    xe = DOC.blocks.map(b => b.x + dims(b).W),
    ye = DOC.blocks.map(b => b.y + dims(b).H);
  const x0 = Math.min(...xs) - 30,
    y0 = Math.min(...ys) - 40,
    bw = Math.max(...xe) + 30 - x0,
    bh = Math.max(...ye) + 30 - y0;
  const k = Math.min(1, (W - pw - 20) / bw, (H - 120) / bh);
  VIEW.k = k;
  VIEW.tx = pw + (W - pw - bw * k) / 2 - x0 * k;
  VIEW.ty = 60 + (H - 120 - bh * k) / 2 - y0 * k;
  applyView();
}
function lfiRenderRef() {
  const L = document.getElementById('Lref');
  const r = DOC && DOC.refImg;
  const show = r && r.mode === 'overlay' && !PRESENT;
  if (!L) return;
  const key = show ? `${r.x},${r.y},${r.w},${r.h},${r.op},${r.src.length}` : '';
  if (L.dataset.k === key) return;
  L.dataset.k = key;
  L.innerHTML = show ? `<image href="${r.src}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" opacity="${r.op}" preserveAspectRatio="none" pointer-events="none"/>` : '';
}
function lfiSyncBar() {
  const bar = document.getElementById('refBar'),
    side = document.getElementById('refSide');
  const r = DOC && DOC.refImg;
  if (!bar) return;
  const show = !!r && !PRESENT;
  bar.hidden = !show;
  if (side) {
    side.hidden = !(show && r.mode === 'side');
    if (!side.hidden && side.dataset.k !== String(r.src.length)) {
      side.dataset.k = String(r.src.length);
      side.querySelector('img').src = r.src;
    }
  }
  if (show) {
    bar.querySelectorAll('[data-rm]').forEach(x => x.classList.toggle('on', x.dataset.rm === r.mode));
    const op = bar.querySelector('#refOp');
    if (op) {
      op.hidden = r.mode !== 'overlay';
      if (+op.value !== Math.round(r.op * 100)) op.value = Math.round(r.op * 100);
    }
  }
  lfiRenderRef();
}
(() => {
  // markup for the compare bar and the side-by-side panel
  const wrap = document.getElementById('cwrap');
  if (wrap && !document.getElementById('refBar')) {
    wrap.insertAdjacentHTML(
      'beforeend',
      `<div class="refbar" id="refBar" hidden role="group" aria-label="Reference image"><b>Original image</b>
        <button class="ib sm" data-rm="off" title="Hide the original image">Hide</button><button class="ib sm" data-rm="side" title="Original image | Generated digital twin">Side by side</button><button class="ib sm" data-rm="overlay" title="Show the original image under the loop">Overlay</button>
        <input type="range" id="refOp" min="10" max="90" step="5" value="45" aria-label="Overlay opacity" title="Overlay opacity"><button class="ib sm" id="refDel" title="Remove the original image from this flowsheet" aria-label="Remove the original image">✕</button></div>
       <div class="refside" id="refSide" hidden><div class="refside-hd"><b>Original image</b><span>| Generated digital twin →</span></div><img alt="Original sand loop image"></div>`,
    );
  }
  const vp = document.getElementById('vp');
  if (vp && !document.getElementById('Lref')) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'Lref';
    const after = document.getElementById('gridbg');
    vp.insertBefore(g, after ? after.nextSibling : vp.firstChild);
  }
  const bar = document.getElementById('refBar');
  if (bar) {
    bar.querySelectorAll('[data-rm]').forEach(
      b =>
        (b.onclick = () => {
          if (!DOC.refImg) return;
          DOC.refImg.mode = b.dataset.rm;
          changed();
          lfiSyncBar();
          if (b.dataset.rm === 'side') requestAnimationFrame(lfiFitBeside);
          else requestAnimationFrame(() => fit());
        }),
    );
    bar.querySelector('#refOp').oninput = e => {
      if (!DOC.refImg) return;
      DOC.refImg.op = +e.target.value / 100;
      lfiRenderRef();
    };
    bar.querySelector('#refOp').onchange = () => changed();
    bar.querySelector('#refDel').onclick = () => {
      if (!DOC.refImg) return;
      pushUndo();
      delete DOC.refImg;
      changed();
      lfiSyncBar();
      toast('Original image removed — Ctrl+Z brings it back');
    };
  }
  setInterval(lfiSyncBar, 500);
  // entry points
  const go = document.getElementById('bLoopImg');
  if (go) go.onclick = () => openLoopFromImage();
  const fe = document.getElementById('feImg');
  if (fe) fe.onclick = () => openLoopFromImage();
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('lfi')?.classList.contains('on') && !document.getElementById('modal').classList.contains('on')) lfiClose();
  });
})();
