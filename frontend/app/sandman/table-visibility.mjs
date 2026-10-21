/**
 * Which tables a database offers.
 *
 * A plant historian routinely has a hundred and fifty tables and six that
 * anybody links a reading to. The dropdown in *Add reading* listed all of
 * them, in schema order, so finding the right one was a scrolling exercise
 * repeated for every reading on every item.
 *
 * So each database on the Data sources page gets a ☑ button. It opens the list
 * of that database's tables with a tick beside each, and what is ticked is what
 * the reading dropdowns offer. Both kinds of database have one: the foundry's
 * own, which arrives with the launch, and every database somebody registered.
 *
 * **Ticking nothing means every table.** A database nobody has narrowed must
 * behave as it always did, so an empty selection is stored as no selection
 * rather than as a selection of nothing — see routes/tableVisibility.js.
 *
 * A reading already linked to a table that is later hidden keeps working. The
 * link is stored on the reading and read from there; this only decides what a
 * dropdown offers next time, which is the whole of what was asked for.
 *
 * ## Where the names come from
 *
 * Nowhere new. A registered database's tables are the schema the service
 * already reads for the catalogue, and the foundry's own are in
 * `SANDMAN_CONTEXT`, written into the page when it was served. This adds no
 * route that reaches a plant database and no way to ask for one.
 */
import { api } from './api.mjs'
import { peek } from './studio.mjs'

const esc = value =>
  String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** scope → array of table names, or absent for "all of them". */
let chosen = new Map()

/** connectionId → table names, once fetched. */
const tablesByConnection = new Map()

/* ------------------------------------------------------------- the scopes ---*/

const foundryId = () => window.SANDMAN_CONTEXT?.customer?.id || null

/**
 * What this source is called in the filter table.
 *
 * `null` for anything else — the studio's own demo servers do not reach this
 * build, and a source we cannot name is one we must not narrow.
 */
export function scopeOf(source) {
  if (source?.connectionId) return `conn:${source.connectionId}`
  if (source?.id === 'customer') {
    const foundry = foundryId()
    return foundry ? `customer:${foundry}` : null
  }
  return null
}

/* -------------------------------------------------------------- the names ---*/

/** The foundry's own tables, from the context the server wrote into the page. */
const customerTables = () =>
  (window.SANDMAN_CONTEXT?.defaultDb?.schema || []).map(table => table.name).filter(Boolean)

/** A registered database's tables, read once and remembered. */
async function connectionTables(connectionId) {
  if (tablesByConnection.has(connectionId)) return tablesByConnection.get(connectionId)
  try {
    const schema = await api.get(`/connections/${encodeURIComponent(connectionId)}/schema`)
    const names = (schema?.tables || []).map(table => table.name).filter(Boolean)
    tablesByConnection.set(connectionId, names)
  } catch {
    tablesByConnection.set(connectionId, [])
  }
  return tablesByConnection.get(connectionId)
}

const tablesFor = source =>
  source?.connectionId ? connectionTables(source.connectionId) : Promise.resolve(customerTables())

/* --------------------------------------------------------------- the data ---*/

export async function load() {
  try {
    const map = await api.get('/table-visibility')
    chosen = new Map(Object.entries(map && typeof map === 'object' ? map : {}))
  } catch {
    // An operator may read it, but a failure here should leave every dropdown
    // showing every table rather than showing none.
    chosen = new Map()
  }
  return chosen
}

/** The set a scope is narrowed to, or null for "all". */
function allowed(scope) {
  const list = scope ? chosen.get(scope) : null
  return Array.isArray(list) && list.length ? new Set(list) : null
}

async function save(scope, tables) {
  const answer = await api.put(`/table-visibility/${encodeURIComponent(scope)}`, { tables })
  if (Array.isArray(answer?.tables) && answer.tables.length) chosen.set(scope, answer.tables)
  else chosen.delete(scope)
}

/* ----------------------------------------------------------- the filtering ---*/

/**
 * Narrow what `catalog()` offers.
 *
 * Wrapped rather than rewritten, and wrapped last, so it filters whatever the
 * layer below produced — the registered database's real schema from
 * `databases.mjs`, or the studio's own answer for the foundry's database.
 */
function filterCatalog() {
  const original = window.catalog
  if (typeof original !== 'function' || original.__dlTableFilter) return

  const replaced = function catalogNarrowedToChosenTables(source) {
    const groups = original.call(this, source)
    const only = allowed(scopeOf(source))
    if (!only || !Array.isArray(groups)) return groups

    return groups.map(group => ({
      ...group,
      tables: (group.tables || []).filter(table => only.has(table.name)),
    }))
  }

  replaced.__dlTableFilter = true
  replaced.original = original
  window.catalog = replaced
}

/* ----------------------------------------------------------------- the panel ---*/

function panelMarkup(name, names, only) {
  const rows = names.map((table, index) => `
    <label class="chk dl-tv-row">
      <input type="checkbox" data-tv="${index}" value="${esc(table)}"
             ${!only || only.has(table) ? 'checked' : ''}>
      <span class="mono">${esc(table)}</span>
    </label>`).join('')

  return `<h3>Tables in ${esc(name)}</h3>
    <p class="note">Ticked tables are the ones offered when a reading is linked.
      ${only ? '' : 'All of them are offered at the moment.'}</p>
    <div class="dl-tv-acts">
      <button type="button" class="sb" id="dlTvAll">Select all</button>
      <button type="button" class="sb" id="dlTvNone">Clear</button>
      <input id="dlTvFind" class="dl-tv-find" placeholder="Find a table…" autocomplete="off">
      <span class="note" id="dlTvCount"></span>
    </div>
    <div class="dl-tv-list" id="dlTvList">${
      rows || '<p class="note">This database reported no tables.</p>'
    }</div>
    <div class="mact">
      <button class="ib" id="dlTvBack">Back</button>
      <button class="ib pri" id="dlTvSave">Save</button>
    </div>`
}

async function openPanel(source, back) {
  const scope = scopeOf(source)
  if (!scope) return

  window.openModal?.('<h3>Tables</h3><p class="note">Reading the table list…</p>')
  const names = await tablesFor(source)

  window.openModal?.(panelMarkup(source.name || source.db || 'this database', names, allowed(scope)))

  const box = document.getElementById('mbox')
  if (!box) return
  const boxes = () => [...box.querySelectorAll('[data-tv]')]
  const count = box.querySelector('#dlTvCount')

  const retally = () => {
    const ticked = boxes().filter(input => input.checked).length
    if (count) {
      count.textContent = ticked === names.length
        ? `all ${names.length}`
        : `${ticked} of ${names.length}`
    }
  }
  retally()
  box.querySelector('#dlTvList')?.addEventListener('change', retally)

  // While a search is showing, Select all and Clear act on what it shows.
  const shown = () => boxes().filter(input => !input.closest('.dl-tv-row')?.hidden)
  box.querySelector('#dlTvAll').onclick = () => {
    for (const input of shown()) input.checked = true
    retally()
  }
  box.querySelector('#dlTvNone').onclick = () => {
    for (const input of shown()) input.checked = false
    retally()
  }

  // Hiding rather than re-rendering, so ticks already made survive a search.
  const find = box.querySelector('#dlTvFind')
  if (find) {
    find.oninput = () => {
      const needle = find.value.trim().toLowerCase()
      for (const input of boxes()) {
        const row = input.closest('.dl-tv-row')
        if (row) row.hidden = !!needle && !input.value.toLowerCase().includes(needle)
      }
    }
  }

  box.querySelector('#dlTvBack').onclick = () => window.sourcesForm?.(back)

  box.querySelector('#dlTvSave').onclick = async () => {
    const ticked = boxes().filter(input => input.checked).map(input => input.value)
    /*
     * Everything ticked is the same as nothing ticked: both mean "offer them
     * all", and storing a list that happens to be complete would quietly
     * freeze the dropdown against a database that later grows a table.
     */
    const tables = ticked.length === names.length ? [] : ticked
    try {
      await save(scope, tables)
      window.toast?.(
        tables.length
          ? `${tables.length} table${tables.length === 1 ? '' : 's'} offered from ${source.name || 'this database'}`
          : `All tables offered from ${source.name || 'this database'}`
      )
      window.renderProps?.()
      window.sourcesForm?.(back)
    } catch (error) {
      window.toast?.(error?.message || 'That could not be saved')
    }
  }
}

/* --------------------------------------------------- straight from the Data tab ---*/

/** Every database a reading can be linked to: the foundry's, then the rest. */
function databases() {
  const foundry = window.SANDMAN_CONTEXT?.defaultDb?.db
  const list = foundry ? [{ id: 'customer', name: foundry, foundry: true }] : []
  for (const source of window.sources?.() || []) {
    if (source?.connectionId) list.push({ id: source.id, name: source.name, connectionId: source.connectionId })
  }
  return list
}

/**
 * Pick a database, then its tables.
 *
 * The per-database ☑ button lives on the Data sources page, which is where a
 * database is configured — but it is not where somebody goes looking for
 * "which tables do I want offered". They go to the Data tab. So this is the
 * same checklist reached in one step from there.
 */
function openChooser() {
  const list = databases()
  if (!list.length) {
    window.toast?.('No databases yet — add one under Data sources')
    return
  }

  const rows = list.map((item, index) => {
    const only = allowed(scopeOf(item))
    return `<button type="button" class="src dl-tv-pick" data-pick="${index}">
      <b>${esc(item.name)}</b>
      <span class="note">${item.foundry ? 'The foundry database' : 'Registered database'} · ${
        only ? `${only.size} table${only.size === 1 ? '' : 's'} offered` : 'all tables offered'
      }</span>
    </button>`
  }).join('')

  window.openModal?.(`<h3>Tables offered when linking a reading</h3>
    <p class="note">Choose a database, then tick the tables worth offering.
      A database nobody has narrowed offers all of them.</p>
    <div class="src-g">${rows}</div>
    <div class="mact"><button class="ib pri" id="dlTvDone">Close</button></div>`)

  const box = document.getElementById('mbox')
  if (!box) return
  box.querySelector('#dlTvDone').onclick = () => window.closeModal?.()
  for (const button of box.querySelectorAll('[data-pick]')) {
    button.onclick = () => openPanel(list[Number(button.dataset.pick)], openChooser)
  }
}

/**
 * A button on the Data tab, beside Test connections.
 *
 * Injected rather than asked for: the ribbon is vendored markup, and this is
 * one `<button>` in the column that already holds the other two small Data
 * actions. If a drop ever renames that column the button simply does not
 * appear, which is the right way for this to fail.
 */
function addRibbonButton() {
  const panel = document.querySelector('.rpanel[data-rp="data"]')
  const column = panel?.querySelector('.rcol')
  if (!column || column.querySelector('#dlTvRibbon')) return

  const button = document.createElement('button')
  button.className = 'ib rsm'
  button.id = 'dlTvRibbon'
  button.title = 'Choose which tables are offered when a reading is linked'
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 5h18M3 12h18M3 19h18"/><path d="M8 5v14"/></svg>' +
    '<span class="rl">Tables shown</span>'
  button.onclick = openChooser

  column.append(button)
}

/* ------------------------------------------------------------- the button ---*/

/**
 * A ☑ on every database card, ours and the foundry's.
 *
 * Put in the card's own action row so it sits with Test and Edit rather than
 * somewhere of its own invention, and added after the studio has drawn the
 * page for the same reason the counts are — the markup is vendored.
 */
function addButtons(back) {
  const box = document.getElementById('mbox')
  if (!box) return

  for (const card of box.querySelectorAll('.src')) {
    const actions = card.querySelector('.src-a')
    if (!actions || actions.querySelector('.dl-tv-btn')) continue

    // Which database this card is. The studio marks every button with the
    // source id; the foundry's card uses the literal "customer".
    const id = card.querySelector('[data-st]')?.dataset.st
    if (!id) continue
    const source = id === 'customer'
      ? { id: 'customer', name: 'the foundry database' }
      : (window.sources?.() || []).find(item => item.id === id)
    if (!scopeOf(source)) continue

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sb dl-tv-btn'
    button.title = 'Choose which tables are offered when linking a reading'
    const only = allowed(scopeOf(source))
    button.innerHTML = `☑ Tables${only ? ` <span class="note">(${only.size})</span>` : ''}`
    button.onclick = () => openPanel(source, back)

    // Before Delete, which the studio puts last with a left margin.
    const remove = actions.querySelector('[data-sd]')
    if (remove) actions.insertBefore(button, remove)
    else actions.append(button)
  }
}

/* ------------------------------------------------------------------ styles ---*/

function styles() {
  if (document.getElementById('dlTableVisibilityStyles')) return
  const style = document.createElement('style')
  style.id = 'dlTableVisibilityStyles'
  style.textContent = `
    .dl-tv-acts { display: flex; align-items: center; gap: 8px; margin: 6px 0 8px }
    .dl-tv-find { flex: 1; min-width: 120px; padding: 5px 8px;
                  border: 1px solid var(--line, #cfd8e3); border-radius: 7px; font: inherit }
    /* Tall enough to scan, short enough to leave Save on screen. */
    .dl-tv-list { max-height: 46vh; overflow: auto; border: 1px solid var(--line, #cfd8e3);
                  border-radius: 8px; padding: 6px 10px }
    .dl-tv-row { display: flex; align-items: center; gap: 8px; padding: 2px 0 }
    /* The search hides rows with the attribute; the rule above would undo it. */
    .dl-tv-row[hidden] { display: none }
    .dl-tv-btn { white-space: nowrap }

    /* Picking a database from the Data tab, before its tables. */
    .dl-tv-pick { display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
                  width: 100%; text-align: left; cursor: pointer; font: inherit }
    .dl-tv-pick b { font-size: 14px }
  `
  document.head.append(style)
}

/* ----------------------------------------------------------------- install ---*/

export async function install() {
  styles()
  filterCatalog()
  addRibbonButton()

  if (typeof window.sourcesForm === 'function' && !window.sourcesForm.__dlTableFilter) {
    const original = window.sourcesForm
    const replaced = function sourcesFormWithTableButtons(back, ...rest) {
      const result = original.call(this, back, ...rest)
      try {
        addButtons(back)
      } catch (error) {
        console.error('Adding the table buttons failed:', error)
      }
      return result
    }
    replaced.__dlTableFilter = true
    replaced.original = original
    window.sourcesForm = replaced
  }

  await load()
  window.renderProps?.()
}

/** What is narrowed, for the tests and for looking at this from a console. */
export const status = () => ({
  foundry: foundryId(),
  scopes: [...chosen.entries()].map(([scope, tables]) => ({ scope, tables })),
})
