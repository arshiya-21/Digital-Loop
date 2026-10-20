/**
 * One data connection in Properties, not two.
 *
 * The studio's equipment panel ships two separate places to connect a reading
 * to data, and a third section listing the readings themselves:
 *
 *   Data connection   "Tags from a database"  — Database → Table → Column
 *                     "Live source for the whole equipment" — pick a source,
 *                     type a data tag, press *Map readings*
 *   Readings          ＋ Add reading, then a card per reading
 *
 * Two of those do the same job by different means, and the second one — typing
 * an address and mapping every reading onto it at once — belongs to a world
 * where a gateway resolves the address. Here a reading is linked to a column
 * in a named database, which is exactly what the first flow does.
 *
 * So this leaves one section: **Database connection**, with *＋ Add reading*
 * under it, the Database → Table → Column flow revealed when that is pressed,
 * and the readings listed underneath.
 *
 * ## Why it is done to the DOM
 *
 * The markup belongs to `15-inspector.js`, which is vendored and replaced
 * wholesale on every drop — v9.40 rewrote it. Overriding `eqInspector` would
 * mean owning a copy of several hundred lines of somebody else's markup and
 * re-copying it every release. Moving the rendered nodes instead keeps the
 * studio's own handlers attached (they are bound to the elements, so a node
 * that moves takes its wiring with it) and leaves us with a dozen lines that
 * fail visibly rather than silently if the panel is restructured again.
 *
 * Two other things about readings live here, because they concern the same
 * panel: a reading added from a column arrives with no invented numbers in it,
 * and renaming an item renames its readings with it.
 */
import { peek } from './studio.mjs'
import { api } from './api.mjs'
import { watching } from './live.mjs'

/**
 * A database somebody registered here, rather than the foundry's own.
 *
 * The two want different defaults for the row filter. SandMan's schema keeps
 * many machines' rows in one table and names the machine in a column, so
 * filtering by the item's name is right there and the studio fills it in. A
 * plant historian somebody added is any shape at all — usually one table per
 * thing, with no machine column — so guessing a filter there produces
 * `WHERE mode_name = 'BEN-BIN'`, which matches nothing, and a reading that
 * says "No record" beside a table full of rows.
 */
const registered = source => /^conn_/.test(String(source || ''))

/* ------------------------------------------------------- keeping the link ---*/

/**
 * How a change in this panel reaches the server.
 *
 * The studio's own `save()` does not: `captureSaves` intercepts it and throws
 * it away, so that a version is written only when somebody presses Save. That
 * is right for dragging a block about — it is wrong for linking a reading to
 * a column, which is a deliberate act whose whole point is that the service
 * then reads it.
 *
 * Linking used to call `saveNow`, which is that discarded save. The link lived
 * in the browser, the studio's badge said "Saved", the stored layout had none,
 * and `/live/values` answered "no linked readings" — correctly, and for a
 * document nobody could see.
 */
let persistToServer = null

let pending = null
/**
 * Store the layout, shortly.
 *
 * Exported because linking is not only done here: the studio's own wizard,
 * the one that opens after placing equipment, writes links too, and a link
 * that does not reach the server is a reading that reads nothing after the
 * next reload — see `databases.mjs`.
 */
export function persist() {
  if (!persistToServer) return
  clearTimeout(pending)
  // A few seconds, so picking a table and then its column is one version
  // rather than two.
  pending = setTimeout(() => { persistToServer?.() }, 1500)
}

/**
 * Whether the Add reading flow is showing, and on which item.
 *
 * `renderProps` rebuilds the panel from scratch, and choosing a database is a
 * change — so the studio re-rendered, the drawer was built closed again, and
 * the flow vanished the instant it was used. Step 1 appeared to send you back
 * to the ＋ Add reading button instead of on to step 2.
 *
 * So the open state outlives a render. It is remembered against the item it
 * was opened on, because leaving it open while clicking through a flowsheet
 * would put a half-finished flow on every item in turn.
 */
const drawerState = { open: false, item: null }

/** The section whose heading starts with this text. */
function sectionTitled(root, text) {
  for (const section of root.querySelectorAll('section.ix-sec')) {
    const heading = section.querySelector('h4')
    if (heading && heading.textContent.trim().startsWith(text)) return section
  }
  return null
}

/**
 * Everything from a sub-heading to the end of its section.
 *
 * The panel is flat — `<h5>` then the fields that belong to it, as siblings —
 * so a sub-section is "this heading and everything after it", which is what
 * removing one means.
 */
function fromSubheadingToEnd(section, text) {
  const heading = [...section.querySelectorAll('h5.ix-sub')]
    .find(node => node.textContent.trim().startsWith(text))
  if (!heading) return []

  const out = [heading]
  let next = heading.nextElementSibling
  while (next) {
    out.push(next)
    next = next.nextElementSibling
  }
  return out
}

function restructure() {
  const root = document.getElementById('props')
  if (!root) return

  const connection = sectionTitled(root, 'Data connection')
  const readings = sectionTitled(root, 'Readings')
  if (!connection) return

  /*
   * The second way of connecting goes.
   *
   * "Map readings" fills every reading's data tag from one address and links
   * them all to a source — which, now that a reading means a column in a named
   * database, would produce a panel full of readings linked to nothing
   * resolvable. The Database → Table → Column flow is the one that works.
   */
  for (const node of fromSubheadingToEnd(connection, 'Live source for the whole equipment')) {
    node.remove()
  }

  // With one flow left, its sub-heading says nothing the section's own does not.
  for (const node of connection.querySelectorAll('h5.ix-sub')) {
    if (node.textContent.trim().startsWith('Tags from a database')) node.remove()
  }

  const heading = connection.querySelector('h4')
  if (heading) heading.childNodes[0].nodeValue = 'Database connection '

  /*
   * The flow itself is put away until somebody asks for a reading.
   *
   * It is three dropdowns and a button, and on an item that already has its
   * readings it is the first thing in the way. `#dbFlow` is the studio's own
   * container for it; `#ixAdd` is its search-and-create box, which is the
   * other way to add one and belongs in the same place rather than in a
   * section of its own.
   */
  /*
   * Which item this panel is showing, and whether this is a moment for adding
   * readings at all.
   *
   * It used to ask the panel for `#ixName`. That field only exists while
   * designing — outside Design the panel renders without it — so the answer
   * was `null` on every render, the "different item" test never fired, and a
   * drawer opened once stayed open on every item afterwards, including in
   * Simulate where nothing in it can be used.
   *
   * The selection is the honest identity, and it is there in every mode.
   */
  const selected = peek('SEL')
  const item = selected?.t === 'b' ? String(selected.id) : null
  const designing = peek('MODE') === 'design'

  if (item !== drawerState.item || !designing) {
    drawerState.item = item
    drawerState.open = false
  }

  let drawer = connection.querySelector('#dlAddDrawer')
  if (!drawer) {
    drawer = document.createElement('div')
    drawer.id = 'dlAddDrawer'
    drawer.className = 'dl-add-drawer'
  }
  drawer.hidden = !drawerState.open

  const flow = root.querySelector('#dbFlow')
  if (flow && flow.parentElement !== drawer) drawer.append(flow)

  const search = root.querySelector('#ixAdd')
  if (search && search.parentElement !== drawer) {
    // The studio hides this until its own button is pressed. The drawer is
    // what hides things now, so inside it this is always shown.
    search.hidden = false
    drawer.append(search)
  }

  /*
   * The button moves to the one section, and opens the drawer rather than the
   * studio's search box. Its own handler is replaced rather than removed: the
   * studio set `.onclick` directly, so assigning over it is the whole of it.
   */
  let button = root.querySelector('#ixAddBtn')
  if (button) {
    button.textContent = drawerState.open ? '✕ Close' : '＋ Add reading'
    button.onclick = () => {
      drawerState.open = !drawerState.open
      drawer.hidden = !drawerState.open
      button.textContent = drawerState.open ? '✕ Close' : '＋ Add reading'
      if (drawerState.open) drawer.querySelector('select, input')?.focus()
    }
  }
  if (button && heading && button.parentElement !== heading) heading.append(button)

  /*
   * One step at a time, from nothing chosen.
   *
   * The studio fills the Database box in with the foundry's own database
   * before anybody has picked one — `dbsel` defaults to it, marked `auto` —
   * so opening the flow showed Database *and* Table at once, and the Table box
   * belonged to a database the user had not chosen. The steps are meant to
   * arrive one after another, so while the selection is still that default
   * the box shows step 1 and nothing else.
   *
   * Picking a database clears `auto` on the studio's side, and from then on
   * this does nothing.
   */
  /*
   * `B` is lexical in the studio — `const B = id => …` — so it is not on
   * `window`, and reading it from there returns undefined. That is not
   * harmless here: no block looks exactly like "no database chosen", which
   * would pin the flow to step 1 for good.
   */
  const blockById = peek('B')
  const block = item && typeof blockById === 'function' ? blockById(item) : null
  const picked = block?.props?.dbsel

  if (block && (!picked || picked.auto)) {
    const database = drawer.querySelector('#dbDb')
    if (database) database.value = ''
    for (const step of drawer.querySelectorAll('.db-step')) {
      const number = step.querySelector('i')?.textContent?.trim()
      if (number === '2' || number === '3') step.classList.add('off')
    }
  }

  /*
   * The readings themselves, into the same section — which is the whole point:
   * what an item reads and where it reads it from are one subject, and having
   * them in two sections meant scrolling between them to answer one question.
   */
  if (readings) {
    for (const card of readings.querySelectorAll('.ix-card')) connection.append(card)
    for (const hint of readings.querySelectorAll('p.ix-hint')) connection.append(hint)
    readings.remove()
  }

  /*
   * The drawer sits directly under the heading and its button, not at the
   * foot of the section.
   *
   * Pressing ＋ Add reading has to put the next thing to do where the eye
   * already is. Appending it below the readings meant the dropdown opened off
   * the bottom of a panel with a dozen cards in it — the button appeared to do
   * nothing at all unless you thought to scroll.
   */
  if (heading) heading.after(drawer)
  else connection.prepend(drawer)

  addNameAndTest(drawer)
  addSaveToReadings(connection)
  linkByDropdown(connection)
}

/* ------------------------------------------- naming it, and checking it first ---*/

/** The three dropdowns' current answer, as the preview endpoint wants it. */
function chosen(drawer) {
  const pair = String(drawer.querySelector('#dbDb')?.value || '')
  const [source, database] = pair.split('|')
  return {
    source,
    database,
    table: drawer.querySelector('#dbTbl')?.value || '',
    column: drawer.querySelector('#dbCol')?.value || '',
  }
}

/**
 * Step 4: what to call it, and a way to check the data is there.
 *
 * The studio's flow ends at the column with a `Tag ＋` button, and what you
 * get is named after the column — `BENTONITE_SET_KGS`. That is the database's
 * name for it, not the plant's, and renaming it afterwards means finding the
 * reading again in the list below.
 *
 * **Test** is the other half: it asks the server for that one value before
 * anything is created, so "is data actually coming from this column" is
 * answered while the question is still being asked rather than by adding a
 * reading and watching it say "No record".
 */
function addNameAndTest(drawer) {
  if (drawer.querySelector('#dlStep4')) return

  const step = document.createElement('div')
  step.id = 'dlStep4'
  step.className = 'db-step dl-step4'
  step.innerHTML =
    '<i>4</i>' +
    '<div class="dl-step4-body">' +
      '<label class="ix-f">Name this reading' +
        '<input id="dlReadingName" placeholder="Bentonite bin level" autocomplete="off">' +
      '</label>' +
      '<div class="dl-step4-acts">' +
        '<button type="button" class="sb" id="dlTestRead">Test</button>' +
        '<span class="note" id="dlTestSays"></span>' +
      '</div>' +
    '</div>'

  const flow = drawer.querySelector('#dbFlow')
  if (flow) flow.append(step)
  else drawer.prepend(step)

  const says = step.querySelector('#dlTestSays')
  const tell = (text, tone = '') => { says.innerHTML = `<span class="${tone}">${escapeText(text)}</span>` }

  // Step 4 belongs with step 3: there is nothing to name or test until a
  // column has been picked.
  const follow = () => step.classList.toggle('off', !chosen(drawer).column)
  follow()
  drawer.querySelector('#dbCol')?.addEventListener('change', follow)

  step.querySelector('#dlTestRead').onclick = async () => {
    const pick = chosen(drawer)
    if (!pick.table || !pick.column) { tell('Choose a table and a column first', 'tx3'); return }
    const openLoop = watching()
    if (!openLoop) { tell('Open a loop first', 'tx3'); return }

    tell('Reading…', 'tx1')
    try {
      const answer = await api.post('/live/preview', {
        loopId: openLoop,
        source: pick.source,
        table: pick.table,
        column: pick.column,
      })
      if (answer?.value && answer.value.value !== null && answer.value.value !== undefined) {
        const when = answer.value.recordedAt || answer.value.date || ''
        tell(`Latest value ${answer.value.value}${when ? ` · ${when}` : ''}`, 'tx0')
      } else {
        tell(answer?.error || 'No record for that column yet', 'tx2')
      }
    } catch (error) {
      tell(error?.message || 'That could not be read', 'tx3')
    }
  }
}

const escapeText = value =>
  String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/* -------------------------------------------- linking an existing reading ---*/

/**
 * Table and Column, in place of the typed data tag.
 *
 * A reading card offers one free-text box — "Data tag", `e.g.
 * SandMan_Prod.MixerLog` — and `setTagLink` splits whatever is typed on dots
 * to work out the database, table and column. Type two dots in the wrong place
 * and the reading links to a table that does not exist; type a column name
 * that is nearly right and it links to nothing. Neither says so.
 *
 * The Add reading flow has had Database → Table → Column from the start. This
 * gives the same thing to a reading that already exists, built from the same
 * catalogue, so the only names on offer are names the database has.
 *
 * The typed box stays in the DOM, hidden, and is what the change is written
 * through: `setTagLink` is the studio's own, it is bound to that input, and
 * driving it is what keeps the link in exactly the shape the rest of the
 * studio expects.
 */
function linkByDropdown(section) {
  const reg = peek('REG')
  const resolve = peek('SRC')
  if (!reg || typeof window.catalog !== 'function') return

  for (const card of section.querySelectorAll('.ix-card')) {
    const typed = card.querySelector('[data-ix="addr"]')
    const tag = reg[card.dataset.tid]
    if (!typed || !tag || card.querySelector('.dl-link-row')) continue

    // Which source this reading reads from. `__eq` means "whatever the
    // equipment reads from", which the studio has already resolved into the
    // link by the time the card is drawn.
    const chosen = card.querySelector('[data-ix="src"]')?.value
    const sourceId = (chosen && chosen !== '__eq' && chosen !== '__manage')
      ? chosen
      : tag.link?.src
    if (!sourceId) continue

    const source = typeof resolve === 'function' ? resolve(sourceId) : null
    if (!source) continue

    let groups
    try {
      groups = window.catalog(source)
    } catch {
      continue
    }
    const group = Array.isArray(groups) ? groups[0] : null
    if (!group || !Array.isArray(group.tables) || !group.tables.length) continue

    /*
     * One under the other, and the column only once a table is chosen.
     *
     * Side by side invited picking a column before a table, which is the one
     * order that cannot work — the columns on offer depend on the table. The
     * Add reading flow asks the same two questions in the same order; this
     * matches it rather than inventing a second shape for the same answer.
     */
    const row = document.createElement('div')
    row.className = 'dl-link-row'
    row.innerHTML =
      '<label class="ix-f">Table<select class="dl-link-table"></select></label>' +
      '<label class="ix-f dl-link-colf">Column<select class="dl-link-col"></select></label>'

    const tableSelect = row.querySelector('.dl-link-table')
    const columnSelect = row.querySelector('.dl-link-col')
    const columnField = row.querySelector('.dl-link-colf')

    const option = (value, label, selected) =>
      `<option value="${value.replaceAll('"', '&quot;')}"${selected ? ' selected' : ''}>${label}</option>`

    tableSelect.innerHTML = option('', 'Choose a table…', !tag.link?.table) +
      group.tables.map(table =>
        option(table.name, table.name, table.name === tag.link?.table)).join('')

    const fillColumns = () => {
      const table = group.tables.find(entry => entry.name === tableSelect.value)
      const columns = table?.cols || []
      // No table chosen, nothing to choose a column from — so no column box.
      columnField.hidden = !tableSelect.value
      columnSelect.innerHTML = option('', 'Choose a column…', !tag.link?.col) +
        columns.map(column => option(column.n, column.n, column.n === tag.link?.col)).join('')
    }
    fillColumns()

    /*
     * Written through the studio's own input.
     *
     * `db.table.column` is the address `setTagLink` parses, and dispatching
     * the change is what runs it — so the link, the saved document and the
     * "Live from…" line all come out of the studio's code rather than a second
     * copy of it here.
     */
    const apply = () => {
      if (!tableSelect.value || !columnSelect.value) return
      const had = { ...(tag.link || {}) }

      typed.value = `${group.name}.${tableSelect.value}.${columnSelect.value}`
      typed.dispatchEvent(new Event('change', { bubbles: true }))

      /*
       * The rest of the link, which `setTagLink` does not know about.
       *
       * It builds `{src, db, table, col}` from the address and nothing else,
       * so going through it silently dropped the row filter — which machine
       * on the line a row belongs to — and the timestamp column. A reading
       * relinked this way would then read some other machine's rows.
       *
       * They are put back the way a new reading gets them: from the table's
       * own catalogue entry, keeping whatever the row filter already said.
       */
      const link = tag.link
      const table = group.tables.find(entry => entry.name === tableSelect.value)
      if (!link || !table) return

      if (table.key && !registered(link.src)) {
        link.keyCol = table.key
        link.keyVal = had.keyVal || document.querySelector('#props #ixName')?.value || ''
      } else {
        delete link.keyCol
        delete link.keyVal
      }

      const stamp = table.cols?.find(column => column.t === 'datetime')?.n
      if (stamp) link.tcol = stamp

      persist()
    }

    tableSelect.onchange = () => { fillColumns(); apply() }
    columnSelect.onchange = apply

    typed.hidden = true
    const label = typed.closest('.ix-f')
    if (label) label.hidden = true
    typed.closest('.ix-grp')?.insertBefore(row, label?.nextSibling || null)
  }
}

/**
 * A Save on each reading.
 *
 * Every field in a reading card already writes as it is changed — the studio
 * saves on a three hundred millisecond timer — so nothing here was ever lost.
 * But a panel of limits with no Save button does not look like it has kept
 * anything, and somebody typing an alarm limit wants to be told it is stored
 * rather than to infer it. This writes immediately and says so.
 */
function addSaveToReadings(section) {
  for (const card of section.querySelectorAll('.ix-card')) {
    const body = card.querySelector('.ix-body')
    if (!body || body.querySelector('.dl-save-row')) continue

    const row = document.createElement('div')
    row.className = 'dl-save-row'
    row.innerHTML = '<button type="button" class="ib pri dl-save">Save reading</button>' +
      '<span class="note dl-saved" hidden>Saved</span>'

    const button = row.querySelector('.dl-save')
    const said = row.querySelector('.dl-saved')
    button.onclick = async () => {
      said.hidden = false
      said.textContent = 'Saving…'
      try {
        // To the server, not the studio's discarded save — see `persist`.
        clearTimeout(pending)
        await persistToServer?.()
        said.textContent = 'Saved'
        setTimeout(() => { said.hidden = true }, 2000)
      } catch (error) {
        said.textContent = error?.message || 'Could not save'
      }
    }

    body.append(row)
  }
}

/* ------------------------------------------------ a reading with no numbers ---*/

/**
 * A reading added from a column arrives with nothing invented in it.
 *
 * `dbAddTag` fills a new reading in from two tables of guesses: `DB_TYP` gives
 * it a typical value, defaulting to **50** for any column it does not
 * recognise, `noise` is derived from that, and a text column is given a sample
 * string — "PT-1042 Brake Disc", or "Text from the database". They are there to
 * make the editor demonstrable with no plant behind it.
 *
 * On a plant screen they are the same problem as a simulated value: an optimal
 * of 50 on a moisture reading is a number somebody will believe, and it drives
 * the control chart's centre line. So they are cleared the moment the reading
 * is made. The description and the unit stay — those are read from the column's
 * own name, and a name is not a measurement.
 */
function scrubInventedValues() {
  const original = window.dbAddTag
  if (typeof original !== 'function' || original.__dlNoGuesses) return

  const replaced = function dbAddTagWithoutGuesses(...args) {
    const id = original.apply(this, args)
    const REG = peek('REG')
    const tag = id && REG ? REG[id] : null
    if (tag) {
      tag.typ = null
      tag.noise = 0
      // A text reading's sample string. Blank until the plant sends one.
      if (tag.txt !== undefined) tag.txt = ''

      // And no invented row filter on a registered database — see `registered`.
      if (tag.link && registered(tag.link.src)) {
        delete tag.link.keyCol
        delete tag.link.keyVal
      }

      /*
       * The name typed in step 4, if there was one.
       *
       * The studio names a new reading after its column — `BENTONITE_SET_KGS`
       * — which is the database's name for it and not the plant's. `desc` is
       * what every list, card and label shows, so that is what is set; the id
       * stays as the studio made it, because the document and the server index
       * are keyed on it.
       */
      const typed = document.querySelector('#dlReadingName')?.value.trim()
      if (typed) tag.desc = typed
    }

    /*
     * And the flow puts itself away.
     *
     * A reading has just been added; the next thing anybody looks at is the
     * reading, which is directly below. Leaving three dropdowns open over it
     * meant scrolling past a finished form to see what it produced.
     */
    if (id) {
      drawerState.open = false
      const name = document.querySelector('#dlReadingName')
      if (name) name.value = ''
      // And it reaches the server, for the same reason a relink does.
      persist()
    }
    return id
  }

  replaced.__dlNoGuesses = true
  replaced.original = original
  window.dbAddTag = replaced
}

/* --------------------------------------------------- renaming, all the way ---*/

/**
 * Renaming an item renames its readings with it.
 *
 * A reading added to an item is called `<item>.SUFFIX` — `Mixer 1.MOISTURE`.
 * `renameBlock` changes the item's name and nothing else, so after renaming
 * Mixer 1 to Muller 1 every reading on it still said `Mixer 1.MOISTURE`. The
 * rename had saved; it just did not look like it had, because the list of
 * readings underneath was unchanged.
 *
 * So the readings follow. Their ids move in `REG`, on the item, and on any
 * stream showing one — and the row filter, which `dbAddTag` prefills with the
 * item's name, follows too when it still holds the old one.
 */
function renameReadingsWithTheItem() {
  const original = window.renameBlock
  if (typeof original !== 'function' || original.__dlRenamesReadings) return

  const replaced = function renameBlockAndItsReadings(block, next) {
    const name = typeof next === 'string' ? next.trim() : ''
    const DOC = peek('DOC')
    const clash = !!name && !!DOC?.blocks?.some(other => other !== block && other.name === name)

    /*
     * Anything that is not a rename goes to the studio: an empty name, the
     * same name, or one already taken. Each has an answer there — a re-render,
     * or the message saying which item has it — and none of them touches a
     * reading.
     */
    if (!block || !name || name === block.name || clash) return original.call(this, block, next)

    /*
     * The rename itself, in the studio's own four steps, with the readings
     * moved in the middle.
     *
     * It cannot be done by calling through and tidying up afterwards. The
     * studio's version renders as its last act, and a reading still called
     * `<old name>.SUFFIX` makes `tagAnchor` look for an item that no longer
     * exists — it throws inside `renderCanvas`, before anything after the call
     * could run. The readings therefore have to move while the item still
     * answers to its old name.
     *
     * One `pushUndo`, taken before any of it, so Ctrl+Z puts the name and the
     * readings back together.
     */
    const before = block.name
    window.pushUndo?.()
    window.logEv?.(`Renamed ${before} to ${name}`)
    moveReadings(block, before, name)
    block.name = name
    window.changed?.()
    return undefined
  }

  replaced.__dlRenamesReadings = true
  replaced.original = original
  window.renameBlock = replaced
}

function moveReadings(block, before, after) {
  const REG = peek('REG')
  const DOC = peek('DOC')
  if (!REG || !Array.isArray(block.tags)) return

  const prefix = `${before}.`
  for (const entry of block.tags) {
    const id = entry?.id
    if (typeof id !== 'string' || !id.startsWith(prefix)) continue

    const moved = `${after}.${id.slice(prefix.length)}`
    // Never over the top of one that exists: two readings sharing an id would
    // leave one of them unreachable.
    if (REG[moved]) continue

    const tag = REG[id]
    if (tag) {
      tag.id = moved
      REG[moved] = tag
      delete REG[id]
      // The row filter was prefilled with the item's name; if nobody has
      // changed it since, it means the item and should move with it.
      if (tag.link && tag.link.keyVal === before) tag.link.keyVal = after
    }
    entry.id = moved

    // A stream may be showing this reading on the line.
    for (const stream of DOC?.streams || []) {
      if (stream.tag === id) stream.tag = moved
    }
  }
}

/* ----------------------------------------------------------------- install ---*/

/**
 * Run after every properties render.
 *
 * `renderProps` rebuilds the panel from scratch — on selection, on a change,
 * and when the database's tables arrive — so this has to run each time rather
 * than once.
 */
export function install({ save } = {}) {
  // How a link reaches the server. Without it, linking a reading changes only
  // the browser's copy — see `persist`.
  if (typeof save === 'function') persistToServer = save

  scrubInventedValues()
  renameReadingsWithTheItem()

  const original = window.renderProps
  if (typeof original !== 'function' || original.__dlOneConnection) return

  const replaced = function renderPropsWithOneConnection(...args) {
    const result = original.apply(this, args)
    try {
      restructure()
    } catch (error) {
      // A panel that failed to restructure is still the studio's own working
      // panel. Losing the tidying is not a reason to lose Properties.
      console.error('Rearranging the properties panel failed:', error)
    }
    return result
  }

  replaced.__dlOneConnection = true
  replaced.original = original
  window.renderProps = replaced
}
