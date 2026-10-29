/**
 * Publish view: hide the bottom-bar buttons and give them an alias.
 *
 * The publish-bar across the bottom of the operator screen carries a mix of
 * controls — Main screen, Fit view, Traceability, Fault alarm, Maintenance,
 * Exit publish view, and whatever the loaded modules added. A line that does
 * not use traceability still carries the button, and the names on the
 * buttons are the studio's own ("Main screen", "🔔 Fault alarm") rather than
 * whatever this plant calls them.
 *
 * The per-button overlay is stored on the loop as
 *
 *     DOC.publishView = { buttons: { <id>: { hide?, alias? } } }
 *
 * Only buttons that override the default take an entry, so a loop nobody has
 * touched has none and the saved layout is the same size as before.
 *
 * The empty slot in the View ribbon (next to Maintenance) opens the picker —
 * a "Publish view" button. It hangs off the View panel from here, so no
 * studio-source edit is needed; the overlay reads and writes `DOC` and
 * `save()`, both of which are already on `window` as classic-script globals.
 */
import { peek } from './studio.mjs'

/** Where the overrides live on the saved loop. */
const CONFIG_KEY = 'publishView'

/**
 * The server save, handed in by index.mjs (`saveToServer`).
 *
 * The studio's own `window.save()` is replaced by a no-op in studio.mjs
 * (`captureSaves`) so that nothing is kept in the browser. Calling it from
 * here therefore stored the overlay in memory only. This is the function that
 * actually writes the layout — and `DOC.publishView` with it — to the database.
 */
let persistToServer = null

const docCfg = () => {
  const DOC = peek('DOC')
  if (!DOC) return null
  if (!DOC[CONFIG_KEY]) DOC[CONFIG_KEY] = { buttons: {} }
  if (!DOC[CONFIG_KEY].buttons) DOC[CONFIG_KEY].buttons = {}
  return DOC[CONFIG_KEY]
}

/** The override for one button, or an empty object. */
const overrideOf = id => docCfg()?.buttons?.[id] || {}

/**
 * Set, change or clear one button's overrides.
 *
 * Both are nullable so the dialog can clear each on its own, and the entry
 * is dropped when neither has a value — a loop opened with no overrides
 * saves nothing new.
 */
function setOverride(id, { hide, alias }) {
  const cfg = docCfg()
  if (!cfg) return
  const current = cfg.buttons[id] || {}
  const next = { ...current }

  if (hide === true) next.hide = true
  else if (hide === false) delete next.hide

  const text = alias == null ? current.alias : String(alias).trim()
  if (text) next.alias = text
  else delete next.alias

  if (Object.keys(next).length) cfg.buttons[id] = next
  else delete cfg.buttons[id]
}

/* ---------------------------------- which buttons the publish bar carries ---*/

/*
 * The ones that are always offered. The studio writes them into the template
 * — see index.template.html — and the loaded modules add #pMon (Fault
 * alarm), #pQR (QR cards) and #pMnt (Maintenance). Only the ones actually in
 * the DOM at the time the picker opens are shown; this is a map from id to
 * the label it carries on screen.
 */
const PBAR_SELECTOR = '#pbar > button[id]'

/**
 * Read the publish bar as it stands — only the buttons an operator sees.
 *
 * The bar carries thirteen buttons but six are already hidden by our own
 * stylesheet: #pSHI (Sand health), #pAlarm (the old overlay, now replaced by
 * #pMon), #pDiag (System diagnosis), #pSound (Silence alarm), #pReset (Fault
 * reset) and #pQR (QR cards). Listing those in the picker reads as broken —
 * ticking "Show" on System diagnosis has to lose to the integration's own
 * hide, so the tick does nothing.
 *
 * `getClientRects` is the test, because it answers from the computed layout
 * rather than the stylesheet alone: anything the browser is actually drawing
 * has at least one rect; anything with `display: none` has none, whichever
 * stylesheet put it there and whether it was ours or the overlay's own saved
 * state from a previous session.
 *
 * The overlay's own hides are added back on top, so a button somebody hid
 * through this picker stays in the picker as a hidden row — the only way to
 * see what is hidden, and the only way to unhide it.
 */
function discoverButtons() {
  const bar = document.getElementById('pbar')
  if (!bar) return []

  const over = docCfg()?.buttons || {}

  // Measure as the publish view would draw it. Synchronous: layout is
  // forced by getClientRects, but nothing is painted before we revert.
  const body = document.body
  const wasPresent = body.classList.contains('present')
  let measured
  try {
    if (!wasPresent) body.classList.add('present')
    measured = [...bar.querySelectorAll('button[id]')].map(button => ({
      button,
      visible: button.getClientRects().length > 0,
    }))
  } finally {
    if (!wasPresent) body.classList.remove('present')
  }

  const seen = new Set()
  const out = []
  for (const { button, visible } of measured) {
    if (seen.has(button.id)) continue
    const hiddenByUs = !!over[button.id]?.hide
    if (!visible && !hiddenByUs) continue
    seen.add(button.id)
    out.push({
      id: button.id,
      label: (button.textContent || button.getAttribute('aria-label') || button.id)
        .replace(/\s+/g, ' ').trim(),
    })
  }
  return out
}

/* -------------------------------------------- the buttons, in publish view ---*/

/**
 * The CSS that hides overridden buttons and nowhere else.
 *
 * Rules are rewritten whenever the overlay changes. A stylesheet handles the
 * churn: the loaded modules keep rewriting their own buttons on every tick,
 * and setting `display: none` on the element would be clobbered — the rule
 * applies to whatever the next redraw puts on screen.
 *
 * Not scoped under `body.present`, because the publish bar is only visible in
 * the publish view in the first place. Scoping it there costs nothing but
 * reads as superstition rather than intent.
 */
const STYLE_ID = 'dlPublishViewRules'

function cssId(id) {
  // ids may hold punctuation; CSS.escape handles each.
  return typeof CSS?.escape === 'function'
    ? CSS.escape(id)
    : String(id).replace(/[^A-Za-z0-9_-]/g, '\\$&')
}

/** The ids of buttons the overlay is deliberately not allowed to hide. */
const UNHIDEABLE = new Set([
  'pExit',    // Exit publish view — the way out of this screen.
  'pExit2',   // The sized-view exit shown alongside it.
])

export function paintPublishView() {
  let sheet = document.getElementById(STYLE_ID)
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = STYLE_ID
    document.head.append(sheet)
  }

  const over = docCfg()?.buttons || {}
  const rules = []
  for (const [id, got] of Object.entries(over)) {
    if (!got.hide || UNHIDEABLE.has(id)) continue
    const safe = cssId(id)
    rules.push(`#pbar > #${safe} { display: none !important; }`)
  }
  sheet.textContent = rules.join('\n')
}

/**
 * Buttons renamed by the overlay, swapped on screen.
 *
 * The loaded modules keep rewriting their buttons on every tick — the Fault
 * alarm panel updates its count, Maintenance updates its icon — so the alias
 * is painted after each one. Not idempotent for free, so an explicit guard
 * stops a run of ticks from thrashing the DOM.
 */
export function paintAliases() {
  const over = docCfg()?.buttons || {}
  for (const [id, got] of Object.entries(over)) {
    if (!got.alias) continue
    const button = document.getElementById(id)
    if (!button) continue
    paintOne(button, got.alias)
  }
}

/**
 * Replace a button's visible text with the alias, keeping any icon.
 *
 * Buttons here come in two shapes: plain text (`<button>⌂ Main screen</button>`)
 * and icon-plus-label (`<button><svg…/><span class="rl">Fault alarm</span></button>`).
 * The second's `span.rl` is the one to swap; the first has only text nodes
 * and the whole label becomes the alias.
 */
function paintOne(button, alias) {
  const label = button.querySelector('.rl, .p10t')
  if (label) {
    if (label.textContent !== ' ' + alias && label.textContent !== alias) {
      label.textContent = label.textContent.startsWith(' ') ? ' ' + alias : alias
    }
    return
  }
  // Plain text buttons — keep a leading icon if there is one.
  if (!button.__dlOriginal) button.__dlOriginal = button.textContent
  const original = button.__dlOriginal
  // The studio sometimes prefixes a glyph (⌂, 🔔, ●); keep it.
  const match = /^(\s*(?:[^\p{L}\p{N}\s]+\s+))?(.*)$/u.exec(original)
  const prefix = match?.[1] || ''
  const target = prefix + alias
  if (button.textContent !== target) button.textContent = target
}

/* -------------------------------------------------- the button and the dialog ---*/

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * Open the picker. One table, one row per button on the publish bar.
 *
 * Discovered live rather than listed here — so a module that adds a button
 * later is editable on the next open without this file changing.
 */
function openPicker() {
  const buttons = discoverButtons()
  if (!buttons.length) {
    window.toast?.('The publish bar has nothing to configure yet. Open the Publish view once first.')
    return
  }

  const rows = buttons.map(button => {
    const over = overrideOf(button.id)
    const locked = UNHIDEABLE.has(button.id)
    const showCell = locked
      ? '<td><span class="dlpv-locked" title="This button is the way out of the publish view and may not be hidden.">Always on</span></td>'
      : `<td><label class="dlpv-chk"><input type="checkbox" data-k="show" ${over.hide ? '' : 'checked'}>Show</label></td>`
    return `<tr data-i="${esc(button.id)}">
      ${showCell}
      <td>${esc(button.label)}</td>
      <td><input type="text" class="dlpv-alias" data-k="alias" value="${esc(over.alias || '')}" placeholder="${esc(button.label)}" aria-label="Alias for ${esc(button.label)}"></td>
    </tr>`
  }).join('')

  window.openModal?.(
    `<div class="dlpv-dlg">
      <h3>Publish view — show, hide and rename the control buttons</h3>
      <p class="note">These apply to the publish view's bottom bar only. Clear the alias to go back to the standard label.</p>
      <div class="dlpv-tools">
        <span class="dlpv-count" id="dlpvCount"></span>
      </div>
      <div class="dlpv-tbl"><table>
        <thead><tr><th style="width:95px">Visible</th><th>Button</th><th style="width:40%">Alias (shown instead)</th></tr></thead>
        <tbody id="dlpvRows">${rows}</tbody>
      </table></div>
      <div class="mact">
        <button class="ib" type="button" id="dlpvClear">Reset all</button>
        <span style="flex:1"></span>
        <button class="ib" type="button" id="dlpvCancel">Cancel</button>
        <button class="ib pri" type="button" id="dlpvSave">Save</button>
      </div>
    </div>`, 'lg')

  const working = new Map(buttons.map(b => [b.id, { ...overrideOf(b.id) }]))

  const refreshCount = () => {
    const total = buttons.length
    const hidden = [...working.values()].filter(o => o.hide).length
    const aliased = [...working.values()].filter(o => o.alias).length
    document.getElementById('dlpvCount').textContent =
      `${total} button${total === 1 ? '' : 's'}` +
      (hidden ? ` · ${hidden} hidden` : '') +
      (aliased ? ` · ${aliased} renamed` : '')
  }
  refreshCount()

  document.getElementById('dlpvRows').addEventListener('change', e => {
    const row = e.target.closest('tr[data-i]')
    if (!row) return
    const got = working.get(row.dataset.i) || {}
    if (e.target.dataset.k === 'show') got.hide = !e.target.checked
    working.set(row.dataset.i, got)
    refreshCount()
  })

  document.getElementById('dlpvRows').addEventListener('input', e => {
    if (e.target.dataset.k !== 'alias') return
    const row = e.target.closest('tr[data-i]')
    if (!row) return
    const got = working.get(row.dataset.i) || {}
    got.alias = e.target.value
    working.set(row.dataset.i, got)
    refreshCount()
  })

  document.getElementById('dlpvClear').onclick = () => {
    if (!window.confirm?.('Clear every hide and alias on this loop\'s publish bar?')) return
    for (const [id, got] of working) {
      got.hide = false
      got.alias = ''
      working.set(id, got)
    }
    for (const tr of document.querySelectorAll('#dlpvRows tr[data-i]')) {
      const chk = tr.querySelector('[data-k="show"]')
      if (chk) chk.checked = true
      tr.querySelector('[data-k="alias"]').value = ''
    }
    refreshCount()
  }

  document.getElementById('dlpvCancel').onclick = () => window.closeModal?.()
  document.getElementById('dlpvSave').onclick = async () => {
    const saveButton = document.getElementById('dlpvSave')
    for (const [id, got] of working) {
      setOverride(id, { hide: !!got.hide, alias: got.alias ?? '' })
    }

    // Straight to the database. Not the studio's save(), which is discarded.
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…' }
    try {
      if (!persistToServer) throw new Error('The server save is not connected.')
      await persistToServer()
    } catch (e) {
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save' }
      window.toast?.('Could not save the publish view: ' + (e?.message || e))
      return // keep the dialog open so nothing typed is lost
    }

    paintPublishView()
    paintAliases()
    window.closeModal?.()
  }
}

/* ----------------------------------------------- the ribbon button and hooks ---*/

/**
 * Hang the "Publish view" button on the empty slot in the View ribbon.
 *
 * The maintenance module put itself in a "Shop floor" group next to Machine
 * QR; this goes in that same group so the two live-plant controls sit
 * together. Idempotent: the button is only inserted when nothing with that
 * id is already there.
 */
function installButton() {
  if (document.getElementById('vPV')) return true
  const vp = document.querySelector('.rpanel[data-rp="view"]')
  if (!vp) return false

  const existing = vp.querySelector('#vMnt')?.closest('.grp') || vp.lastElementChild
  const html = `<button class="ib rbig" id="vPV" title="Hide items and give them an alias in the published view"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><span class="rl">Publish view</span></button>`

  if (existing?.querySelector('.gi')) {
    existing.querySelector('.gi').insertAdjacentHTML('beforeend', html)
  } else {
    vp.insertAdjacentHTML('beforeend',
      `<div class="grp" role="group" aria-label="Publish"><div class="gi">${html}</div><span class="gl">Publish</span></div>`)
  }

  document.getElementById('vPV').onclick = openPicker
  return true
}

/**
 * Keep aliases on the buttons as the loaded modules redraw their own labels.
 *
 * `#pMon` is rewritten on every `renderHeader` to carry the alarm count, and
 * the maintenance and QR modules rewrite theirs on an interval. Repainting
 * once a second covers all three without having to hook each one.
 */
function keepAliasesOnScreen() {
  if (keepAliasesOnScreen.timer) return
  keepAliasesOnScreen.timer = setInterval(() => {
    try { paintAliases() } catch { /* ignore; the next tick tries again */ }
  }, 1000)
}

/**
 * Wake up the overlay when a loop is loaded.
 *
 * Exported so the integration's own boot calls it once the studio is ready.
 * Idempotent and cheap: fine to call again on every reload.
 */
export function installPublishView({ save } = {}) {
  persistToServer = typeof save === 'function' ? save : null
  // Button first — the ribbon is already in the DOM.
  if (!installButton()) {
    // Panels are added later in some boot orders; try once more.
    setTimeout(installButton, 300)
  }
  keepAliasesOnScreen()
  paintPublishView()
  paintAliases()

  // Repaint on entering publish, so the alias is correct straight away rather
  // than a second later when the interval fires.
  new MutationObserver(() => {
    paintPublishView()
    paintAliases()
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] })
}
