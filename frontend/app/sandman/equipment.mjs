/**
 * The equipment designer, opened by group.
 *
 * The studio's New / Edit equipment dialog starts with one "Start from"
 * dropdown holding every drawing in the library — several hundred entries,
 * each labelled with its category in brackets. Finding the mixer you meant
 * means scrolling a list that mixes bins, conveyors and instruments together,
 * and nothing in it says whether you are about to add something new or change
 * something that exists.
 *
 * So this puts two dropdowns in its place:
 *
 *   Group       the category — Sand Preparation, Molding, Melting & Pouring…
 *   Equipment   what is in that group
 *
 * Each carries the way to add to it — ＋ Add group and ＋ Add equipment, above
 * it on the right — so the lists hold only what exists. The dialog says which
 * of adding and updating it is doing.
 *
 * The preview on the right appears when there is a drawing to show: the
 * library's own for an equipment picked from the list, the uploaded file for a
 * new one. A blank new equipment gets no preview, because the studio would
 * fill it with a default box that is not this equipment's drawing.
 *
 * It also moves the drawing upload out from behind the Shape select. Uploading
 * a picture is the usual reason to open this dialog, and it was reachable only
 * by first knowing to set Shape to "Image". One field now takes an SVG, a PNG
 * or a JPG, sets the shape to match, and offers Replace and Remove afterwards.
 *
 * ## Why it is done to the DOM
 *
 * `dzRender` in `07-reuse.js` is four hundred lines of vendored markup that a
 * drop rewrites. Overriding it would mean owning a copy and re-copying it every
 * release. Rearranging what it rendered keeps the studio's own handlers — they
 * are bound to the elements, so a node that moves takes its wiring with it —
 * and leaves this file small enough to fail visibly if the dialog is ever
 * restructured again.
 *
 * `openDesigner`, `dzRender` and `dzPreview` are top-level function
 * declarations and so already on `window`. `DZ`, `EQ` and `CATS` are `const`
 * and `let`, which are not — `peek` reaches them through the global lexical
 * environment. `DZ` is only ever *mutated* here, never reassigned, because a
 * module cannot assign to another script's `let`; reassigning it is left to
 * `openDesigner`, which is what it is for.
 */
import { peek } from './studio.mjs'

/** Re-applied after every render, so it has to be safe to run repeatedly. */
const DONE = 'dlEquipmentByGroup'

/** Matches the studio's own cap, which rejects anything larger with a toast. */
const MAX_BYTES = 400 * 1024

const esc = value =>
  String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/**
 * What the designer is currently pointed at.
 *
 * Kept here rather than read back from the dialog because `dzRender` rebuilds
 * the markup from scratch — on every field change, every port added, every
 * re-open — and the two dropdowns have to come back selected where the user
 * left them.
 */
const chosen = { group: null, type: '' }

/**
 * Groups somebody made that nothing is in yet.
 *
 * The group list is worked out from the equipment that exists, so a brand new
 * group would vanish the moment it was created — there is nothing in it to
 * derive it from. These are remembered until something is saved into them, at
 * which point the library reports them on its own.
 */
const extraGroups = new Set()

/* ------------------------------------------------------------- the library ---*/

/**
 * The group an item belongs to, as a name.
 *
 * `cat` is an index into `CATS` for the built-in library and a plain string for
 * anything custom or generated, so both forms are resolved to the label that
 * the user actually sees.
 */
function groupOf(item, cats) {
  const cat = item?.cat
  if (typeof cat === 'number') return cats?.[cat] || 'Other'
  const name = String(cat ?? '').trim()
  return name || 'Other'
}

/**
 * Every placeable drawing, by group.
 *
 * Widgets and hidden entries are left out for the same reason the studio leaves
 * them out of its own pickers: they are not equipment, and an HMI toggle button
 * in a list of mixers is a wrong turn waiting to happen.
 */
function library() {
  const EQ = peek('EQ')
  const cats = peek('CATS')
  if (!EQ) return new Map()

  const groups = new Map()
  for (const [type, item] of Object.entries(EQ)) {
    if (!item || item.widget || item.hidden || !item.n) continue
    const group = groupOf(item, cats)
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push({ type, name: item.n })
  }

  // A group just created has nothing in it yet, so it is added empty.
  for (const name of extraGroups) if (!groups.has(name)) groups.set(name, [])

  for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}

/* ---------------------------------------------------------------- the form ---*/

function groupAndItemFields(groups) {
  const names = [...groups.keys()]
  // Falls back to the group the current design says it is in, so re-opening
  // the dialog on an existing item lands on that item's own group.
  const group = names.includes(chosen.group) ? chosen.group : names[0] || ''
  const items = groups.get(group) || []

  /*
   * The label on the left, the way to add one on the right.
   *
   * Above the dropdown rather than beside it: the dropdown is full width, and
   * a button next to it would either shorten it or wrap on a narrow dialog.
   */
  const field = (label, button, select) => `
    <div class="fld">
      <div class="dl-eq-head"><label>${label}</label>${button}</div>
      ${select}
    </div>`

  return `
    ${field('Group',
      '<button type="button" class="sb" id="dlEqAddGroup">＋ Add group</button>',
      `<select id="dlEqGroup">${
        names.map(name =>
          `<option value="${esc(name)}" ${name === group ? 'selected' : ''}>${esc(name)}</option>`
        ).join('')
      }</select>`)}
    ${field('Equipment',
      '<button type="button" class="sb" id="dlEqAddItem">＋ Add equipment</button>',
      /*
       * Only real equipment in the list.
       *
       * It used to carry "＋ New equipment in <group>" as its first entry,
       * which is the same instruction as the button directly above it. Two
       * ways to do one thing, and the one inside the list also made "nothing
       * is selected" indistinguishable from "add a new one".
       *
       * So adding is the button, and the list is what exists. While nothing is
       * selected a disabled placeholder holds the position, because a select
       * with no selection shows its first option instead and would look as
       * though that equipment had been chosen.
       */
      `<select id="dlEqItem">
        ${chosen.type ? '' : '<option value="" selected disabled>Select equipment</option>'}
        ${items.map(item =>
          `<option value="${esc(item.type)}" ${item.type === chosen.type ? 'selected' : ''}>${esc(item.name)}</option>`
        ).join('')}
        ${items.length ? '' : '<option value="" disabled>Nothing in this group yet</option>'}
      </select>`)}
    <p class="note" id="dlEqMode" style="margin:-2px 0 8px"></p>`
}

/**
 * The drawing, with Replace and Remove.
 *
 * SVG is read as text and an image as a data URL, because that is what the
 * studio's two shapes expect: `shape:'svg'` renders the markup inline and
 * `shape:'img'` puts the URL in an `<img>`. Choosing the shape from the file
 * rather than asking for it first is the whole point of the field.
 */
function artworkField(dz) {
  const uploaded = !!(dz.img || dz.svg)
  const kind = dz.svg ? 'SVG drawing' : 'Image'

  /*
   * Three states, because there are three.
   *
   *   nothing yet        a file picker, and the formats it takes
   *   a library drawing  what it is using, and a way to replace it
   *   something uploaded what was uploaded, Replace and Remove
   *
   * The middle one is the one that was missing: an equipment picked from the
   * library has its drawing behind `shape:'base'` rather than in `img` or
   * `svg`, so it read as having no drawing at all and offered no way to change
   * it — when replacing exactly that is the usual reason to open it.
   */
  const body = uploaded
    ? `<div class="dl-eq-have">
         <span class="note">${esc(kind)} uploaded</span>
         <button type="button" class="sb" id="dlEqReplace">Replace</button>
         <button type="button" class="lb" id="dlEqRemove" style="color:var(--crit)">Remove</button>
       </div>`
    : chosen.type
      ? `<div class="dl-eq-have">
           <span class="note">Using this equipment's own drawing</span>
           <button type="button" class="sb" id="dlEqReplace">Replace</button>
         </div>`
      : '<span class="note">SVG, PNG or JPG — up to 400 KB.</span>'

  return `<div class="fld" id="dlEqArt">
    <label>Drawing</label>
    <input type="file" id="dlEqFile" accept=".svg,image/svg+xml,image/png,image/jpeg"
           ${uploaded || chosen.type ? 'hidden' : ''}>
    ${body}
  </div>`
}

/* ------------------------------------------------------------ the rewiring ---*/

function onFileChosen(file) {
  const dz = peek('DZ')
  if (!dz || !file) return

  if (file.size > MAX_BYTES) {
    window.toast?.('Drawing is larger than 400 KB — please compress it')
    return
  }

  const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
  const reader = new FileReader()
  reader.onload = () => {
    if (svg) {
      dz.shape = 'svg'
      dz.svg = String(reader.result)
      delete dz.img
    } else {
      dz.shape = 'img'
      dz.img = String(reader.result)
      delete dz.svg
    }
    window.dzRender?.()
  }
  reader.onerror = () => window.toast?.('That file could not be read')

  if (svg) reader.readAsText(file)
  else reader.readAsDataURL(file)
}

function removeArtwork() {
  const dz = peek('DZ')
  if (!dz) return
  delete dz.img
  delete dz.svg
  // Back to a drawn box: leaving `shape` as 'img' with no image renders an
  // empty frame that looks like a failure rather than a cleared field.
  dz.shape = 'machine'
  window.dzRender?.()
}

/**
 * Open the designer on a library item, or on a blank one in this group.
 *
 * `openDesigner` is the studio's own entry point and the only thing that can
 * reassign `DZ`, so both paths go through it. A new item then has its category
 * set to the chosen group — otherwise everything added here lands in
 * "My equipment" regardless of which group it was added from.
 */
function choose(group, type) {
  chosen.group = group
  chosen.type = type

  window.openDesigner?.(type || undefined)

  if (!type) {
    const dz = peek('DZ')
    if (dz && dz.cat !== group) {
      dz.cat = group
      window.dzRender?.()
    }
  }
}

/* --------------------------------------------------------------- the panel ---*/

function restructure() {
  const box = document.getElementById('mbox')
  const from = box?.querySelector('#dzFrom')
  if (!box || !from) return

  const dz = peek('DZ')
  if (!dz) return

  const groups = library()
  if (!groups.size) return

  // Where the designer currently is, so the dropdowns come back in step with
  // it after a re-render we did not start.
  const cats = peek('CATS')
  if (!chosen.group) chosen.group = groupOf(dz, cats)

  /* ---- group and equipment, in place of "Start from" ---- */

  const field = from.closest('.fld') || from.parentElement
  if (!field.dataset[DONE]) {
    field.dataset[DONE] = '1'
    field.insertAdjacentHTML('beforebegin', groupAndItemFields(groups))
    // The studio's own select stays, hidden: `dzSave` and the dialog's other
    // handlers do not read it, but a drop that starts to would find it there.
    field.hidden = true
  }

  const groupSelect = box.querySelector('#dlEqGroup')
  const itemSelect = box.querySelector('#dlEqItem')
  const mode = box.querySelector('#dlEqMode')

  if (groupSelect && !groupSelect.dataset[DONE]) {
    groupSelect.dataset[DONE] = '1'
    groupSelect.onchange = () => choose(groupSelect.value, '')
  }
  if (itemSelect && !itemSelect.dataset[DONE]) {
    itemSelect.dataset[DONE] = '1'
    itemSelect.onchange = () => {
      // The placeholder is disabled and so cannot normally be picked; a
      // browser that lets it through must not be read as "add a new one".
      if (!itemSelect.value) return
      choose(groupSelect?.value || chosen.group, itemSelect.value)
    }
  }

  /*
   * ＋ Add group — a name, then an empty group selected and ready.
   *
   * A plain prompt rather than a second dialog: this one is already a modal,
   * and stacking another over it to collect one short string is more machinery
   * than the question deserves.
   */
  const addGroup = box.querySelector('#dlEqAddGroup')
  if (addGroup) {
    addGroup.onclick = () => {
      const field = groupSelect?.closest('.fld')
      if (!field || field.querySelector('.dl-eq-new')) return

      /*
       * Named in the field itself, not in a browser prompt.
       *
       * A `window.prompt` over a modal is the operating system's dialog, in
       * its own style, with no sight of the group list it is adding to — and
       * on a kiosk browser it may not appear at all. This puts the box where
       * the dropdown is, which is where the answer goes.
       */
      const row = document.createElement('div')
      row.className = 'dl-eq-new'
      row.innerHTML =
        '<input id="dlEqNewGroup" placeholder="Name for the new group" autocomplete="off" spellcheck="false">' +
        '<button type="button" class="sb" id="dlEqNewOk">Add</button>' +
        '<button type="button" class="lb" id="dlEqNewCancel">Cancel</button>'

      groupSelect.hidden = true
      field.append(row)
      const input = row.querySelector('#dlEqNewGroup')
      input.focus()

      const close = () => { row.remove(); groupSelect.hidden = false }
      const commit = () => {
        const name = input.value.trim()
        if (!name) { close(); return }
        if (groups.has(name)) window.toast?.(`"${name}" already exists — selecting it`)
        else extraGroups.add(name)
        close()
        choose(name, '')
      }

      row.querySelector('#dlEqNewOk').onclick = commit
      row.querySelector('#dlEqNewCancel').onclick = close
      input.onkeydown = event => {
        if (event.key === 'Enter') { event.preventDefault(); commit() }
        if (event.key === 'Escape') { event.preventDefault(); close() }
      }
    }
  }

  // ＋ Add equipment — a blank one in the group now showing.
  const addItem = box.querySelector('#dlEqAddItem')
  if (addItem) {
    addItem.onclick = () => choose(groupSelect?.value || chosen.group, '')
  }
  /*
   * Say which of the two this is, because the studio's answer is not the
   * obvious one: picking a *built-in* copies it into a new custom item rather
   * than editing it in place, and only something already in the custom library
   * is updated. `DZnew` is the designer's own word for that distinction, so it
   * is the one reported rather than a guess from whether a type was picked.
   *
   * textContent, so the name is inert — no escaping, and none needed.
   */
  if (mode) {
    const name = dz.n || 'this equipment'
    mode.textContent = !chosen.type
      ? 'Adding new equipment to this group.'
      : peek('DZnew')
        ? `Based on ${name} — saving adds a new equipment to the library.`
        : `Updating ${name} — saving replaces it in the library.`
  }

  /* ---- the drawing ---- */

  if (!box.querySelector('#dlEqArt')) {
    const anchor = box.querySelector('#dlEqMode') || field
    anchor.insertAdjacentHTML('afterend', artworkField(dz))
  }

  const file = box.querySelector('#dlEqFile')
  if (file && !file.dataset[DONE]) {
    file.dataset[DONE] = '1'
    file.onchange = () => onFileChosen(file.files?.[0])
  }
  /*
   * `onclick`, not `addEventListener`. The dialog is rebuilt on every render,
   * so these are fresh elements each time and assigning is idempotent — and a
   * one-shot listener would leave Replace dead after the file picker was
   * opened and cancelled, which is a normal thing to do.
   */
  const replace = box.querySelector('#dlEqReplace')
  if (replace) {
    replace.onclick = () => {
      const picker = document.createElement('input')
      picker.type = 'file'
      picker.accept = '.svg,image/svg+xml,image/png,image/jpeg'
      picker.onchange = () => onFileChosen(picker.files?.[0])
      picker.click()
    }
  }
  const remove = box.querySelector('#dlEqRemove')
  if (remove) remove.onclick = removeArtwork

  // The studio's own file input does the same job for images only, and having
  // both is the "two ways to do one thing" this dialog already suffered from.
  const theirs = box.querySelector('#dzImg')?.closest('.fld')
  if (theirs) theirs.hidden = true

  /*
   * The pasted-markup box goes too.
   *
   * It is the third way to supply the same drawing, and once a file has been
   * uploaded it fills with that file's source — which for anything exported by
   * Illustrator or Figma is a screenful of base64 C2PA metadata before the
   * first path. Nobody reads it, and it pushed the rest of the form off the
   * dialog.
   *
   * "Stretch to fill" lives in the same field and is a real setting, so it
   * stays: only the label and the textarea are hidden.
   */
  const markup = box.querySelector('textarea[data-f="svg"]')
  if (markup) {
    markup.hidden = true
    const label = markup.closest('.fld')?.querySelector('label:not(.chk)')
    if (label) label.hidden = true
  }

  /*
   * "Text inside" goes too.
   *
   * It writes a caption over the middle of the drawing — a label the studio
   * draws on top of the shape. On a drawing that is a photograph of a real
   * machine, which is what everything here is, it lands across the picture.
   * The equipment's own name is already shown beside it on the canvas, so the
   * field offers a second, competing label and nothing else.
   */
  const inside = box.querySelector('textarea[data-f="label"]')
  if (inside) {
    const field = inside.closest('.fld')
    if (field) field.hidden = true
    else inside.hidden = true
  }

  /* ---- the preview ---- */

  /*
   * Shown when there is a real drawing to show, and not otherwise.
   *
   * Two cases qualify: something was uploaded, or an equipment was picked from
   * the library and the drawing is its own. A blank new equipment does not —
   * the studio would fill the panel with its default rotor box, which is not
   * this equipment's drawing and reads as though one had already been chosen.
   */
  const panel = box.querySelector('.dz')
  const preview = box.querySelector('.dz-r')
  if (panel && preview) {
    const show = !!(dz.img || dz.svg || chosen.type)
    preview.hidden = !show
    panel.classList.toggle('dl-eq-noprev', !show)
  }
}

/* ------------------------------------------------------------------ styles ---*/

function styles() {
  if (document.getElementById('dlEquipmentStyles')) return
  const style = document.createElement('style')
  style.id = 'dlEquipmentStyles'
  style.textContent = `
    /* The label on the left of the row, the ＋ button hard right above the
       dropdown it adds to — with room between the two, so the button reads as
       belonging to the field rather than sitting on top of the select. */
    .dl-eq-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; margin-bottom: 6px;
    }
    .dl-eq-head label { margin: 0 }
    .dl-eq-head .sb { flex: none; padding: 2px 10px; font-size: 12px; line-height: 1.6 }
    .dl-eq-have { display: flex; align-items: center; gap: 10px; flex-wrap: wrap }

    /* With no preview the form takes the width rather than leaving a gap. */
    .dz.dl-eq-noprev { grid-template-columns: 1fr !important }

    /*
     * The preview takes the height it is given.
     *
     * It was a fixed 250px box at the top of a column as tall as the form
     * beside it, so most of the right-hand side of the dialog was empty while
     * the drawing was shown in a stamp. The column becomes a flex column and
     * the preview grows into it; the caption underneath keeps its own height.
     */
    /* Clear of the close button, which floats over the dialog's top right. */
    .dz > .dz-r { display: flex; flex-direction: column; gap: 6px; align-self: stretch;
                  padding-right: 34px; padding-top: 6px }
    .dz > .dz-r > .dz-prev { height: auto; flex: 1 1 auto; min-height: 260px }

    /* Naming a new group, in place of the dropdown. */
    .dl-eq-new { display: flex; align-items: center; gap: 8px }
    .dl-eq-new input { flex: 1; min-width: 0; padding: 6px 8px;
                       border: 1px solid var(--line, #cfd8e3); border-radius: 7px; font: inherit }

    /*
     * The hidden attribute has to win inside this dialog.
     *
     * It works through the browser's own rule, which any class rule outranks —
     * and the dialog sets display on its labels and fields. So an element
     * hidden above stayed on screen with no sign of why.
     */
    .dz [hidden], #mbox .fld [hidden] { display: none !important }
  `
  document.head.append(style)
}

/* ----------------------------------------------------------------- install ---*/

/**
 * Run after every designer render.
 *
 * `dzRender` rebuilds the dialog on each field change, each port added and each
 * item picked, so this has to run every time rather than once.
 */
export function install() {
  const original = window.dzRender
  if (typeof original !== 'function' || original.__dlEquipment) return

  styles()

  const replaced = function dzRenderByGroup(...args) {
    const result = original.apply(this, args)
    try {
      restructure()
    } catch (error) {
      // A dialog that failed to restructure is still the studio's own working
      // dialog. Losing the tidying is not a reason to lose the designer.
      console.error('Rearranging the equipment designer failed:', error)
    }
    return result
  }

  replaced.__dlEquipment = true
  replaced.original = original
  window.dzRender = replaced
}
