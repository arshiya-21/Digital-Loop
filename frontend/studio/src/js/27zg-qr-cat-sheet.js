/*! SandMan Digital Loop Studio — 27zg-qr-cat-sheet.js
 *  v10.4 — Category QR tab opens like Machine QR: only the stickers (QR + category name + description).
 *  Creating / editing categories moves behind a "Manage categories" button; the editor has "‹ QR stickers" to go back. */
{
  const edRender = qcRender,
    tabPrev = qcTab;
  qcTab = function (t) {
    if (t === 'category' && !QCD.dirty) QCD.mode = 'sheet';
    return tabPrev.apply(this, arguments);
  };
  qcRender = function () {
    const box = $('#qcC');
    if (!box) return;
    if (QCD.mode === 'edit') {
      edRender();
      const s = box.querySelector('.qc-side');
      if (s && !box.querySelector('#qcBack')) s.insertAdjacentHTML('afterbegin', '<button type="button" class="lk qc-back" id="qcBack">‹ QR stickers</button>');
      const b = $('#qcBack');
      if (b) b.onclick = () => (QCD.dirty ? toast('Save or close first — there are unsaved changes') : ((QCD.mode = 'sheet'), qcRender()));
      return;
    }
    const C = qcDoc(),
      base = ($('#mcBase') && $('#mcBase').value.trim()) || mcBase();
    box.innerHTML = `<div class="note">One sticker per category (${C.length}). Scanning it opens only that category's live readings.</div>
     ${C.length ? `<div class="mc-grid">${C.map(c => `<div class="mc-q qc-sq" style="--c:${esc(c.color)}"><div class="mc-qr">${mcQr(qcUrl(c, base), 4)}</div><div class="mc-qn">${esc(c.name)}</div><div class="mc-qd">${esc(c.desc || '')}</div><div class="mc-qs">Scan: ${c.tags.length} live reading${c.tags.length === 1 ? '' : 's'}</div></div>`).join('')}</div>` : '<div class="qc-empty"><b>No categories yet</b><p>Click Manage categories to create one (e.g. Sand lab, Pouring).</p></div>'}
     <div class="mact"><button class="ib" id="qcClose2">Close</button><button class="ib" id="qcMng">Manage categories</button>${C.length ? `<button class="ib pri" id="qcPrintAll2">Print stickers</button>` : ''}</div>`;
    $('#qcClose2').onclick = closeModal;
    $('#qcMng').onclick = () => {
      QCD.mode = 'edit';
      QCD.draft = null;
      qcRender();
    };
    if ($('#qcPrintAll2')) $('#qcPrintAll2').onclick = () => qcPrint(qcDoc());
  };
}
document.head.insertAdjacentHTML('beforeend', '<style>.qc-sq{border-top:4px solid var(--c)}.qc-back{display:block;margin:0 0 8px;font-weight:700}</style>');
