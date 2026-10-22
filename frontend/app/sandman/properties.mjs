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
import { watching, blinkOf, paintBlinks } from './live.mjs'
import { searchable } from './table-search.mjs'
import { connectionIdFrom } from './databases.mjs'

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
const drawerState = { open: false, item: null, how: 'dropdowns' }

/**
 * Two ways to say where a reading comes from, chosen after the database.
 *
 * The dropdowns answer it for a plain column: a table, a column in it, which
 * column means "newest" so a chart can be drawn, and which rows if the table
 * holds more than this line's. A statement answers it for everything else — a
 * join, an aggregate, a WHERE nobody can express as one row filter.
 *
 * They are offered as a choice rather than one after the other because they
 * are alternatives, not steps: picking a table is not the first half of
 * writing a query, and somebody who knows SQL should not have to walk through
 * four dropdowns to reach a box they were always going to use.
 *
 * The database comes first either way — a statement has to run somewhere.
 */
/**
 * Running a written statement, and making it a reading.
 *
 * Run goes through `/live/preview`, the same fence every typed statement here
 * uses — administrators only, one SELECT, read-only, capped and timed out,
 * against a database their own foundry registered. Nothing is created by
 * running it; a query that answers with nothing is a query to fix, not a
 * reading to delete afterwards.
 *
 * Adding creates the reading through the studio's own `dbAddTag` so the tag
 * id, the document and the undo stack are all the studio's, then replaces the
 * table-and-column link with the statement. Writing the tag by hand here
 * would be a second way of creating one, and the two would drift.
 */
function wireTheWrittenQuery(drawer, box) {
  const sql = box.querySelector('#dlWrittenSql')
  const says = box.querySelector('#dlWrittenSays')
  const tell = (text, tone = '') => {
    says.textContent = text
    says.className = `note ${tone}`
  }

  const source = () => String(drawer.querySelector('#dbDb')?.value || '').split('|')[0]

  box.querySelector('#dlWrittenRun').onclick = async () => {
    const statement = sql.value.trim()
    if (!statement) { tell('Write a statement first.', 'tx3'); return }
    if (!source()) { tell('Choose a database first.', 'tx3'); return }

    tell('Running…')
    try {
      const answer = await api.post('/live/preview', {
        loopId: watching(), source: source(), sql: statement,
      })
      tell(
        answer.error
          ? `${answer.via || 'The database'} refused it: ${answer.error}`
          : `${answer.via || 'The database'} answered ${JSON.stringify(answer.value)} in ${answer.tookMs} ms.`,
        answer.error ? 'tx3' : ''
      )
    } catch (error) {
      tell(error.message, 'tx3')
    }
  }

  box.querySelector('#dlWrittenAdd').onclick = () => {
    const statement = sql.value.trim()
    if (!statement) { tell('Write a statement first.', 'tx3'); return }
    const chosenSource = source()
    if (!chosenSource) { tell('Choose a database first.', 'tx3'); return }

    /*
     * The studio makes the tag; this says what it reads.
     *
     * `dbAddTag` wants a table and a column, and there are none — so it is
     * given the statement's own name for itself and the link is rewritten
     * immediately afterwards. The reading that results is an ordinary one in
     * every other way: it polls, it charts, it can be renamed.
     */
    const made = window.dbAddTag?.()
    const reg = peek('REG')
    const tag = made && reg ? reg[made] : null
    if (!tag) {
      tell('The studio would not add a reading here — pick a table first, then switch back.', 'tx3')
      return
    }

    tag.link = { src: chosenSource, sql: statement }
    delete tag.link.table
    delete tag.link.col
    persist()
    window.renderProps?.()
    tell('Added. It reads that statement from now on.')
  }
}

function howToPickIt(drawer) {
  const flow = drawer.querySelector('#dbFlow')
  if (!flow) return

  let choice = drawer.querySelector('#dlHow')
  if (!choice) {
    choice = document.createElement('div')
    choice.id = 'dlHow'
    choice.className = 'dl-how'
    choice.innerHTML =
      '<div class="seg" role="group" aria-label="How to find this reading">' +
      '<button type="button" data-how="dropdowns">From the dropdowns</button>' +
      '<button type="button" data-how="query">Write a query</button>' +
      '</div>'
    // After the database, before the table: it is what decides whether a
    // table is asked for at all.
    flow.querySelector('.db-step')?.after(choice)
  }

  let written = drawer.querySelector('#dlWritten')
  if (!written) {
    written = document.createElement('div')
    written.id = 'dlWritten'
    written.className = 'dl-written'
    written.innerHTML =
      '<label class="ix-f">Statement' +
      '<textarea id="dlWrittenSql" class="mono" rows="4" spellcheck="false" ' +
      'placeholder="SELECT value_column, time_column FROM table ORDER BY time_column DESC LIMIT 1">' +
      '</textarea></label>' +
      '<div class="note">The first column is the measurement, the second its time. ' +
      'Run it to see what it answers before it becomes a reading.</div>' +
      '<div class="dl-written-acts">' +
      '<button type="button" class="sb" id="dlWrittenRun">Read now</button>' +
      '<button type="button" class="ib pri" id="dlWrittenAdd">Add this reading</button>' +
      '</div><p class="note" id="dlWrittenSays"></p>'
    choice.after(written)
    wireTheWrittenQuery(drawer, written)
  }

  const show = () => {
    for (const button of choice.querySelectorAll('[data-how]')) {
      button.classList.toggle('on', button.dataset.how === drawerState.how)
    }
    const writing = drawerState.how === 'query'
    /*
     * Hidden by the class, not only by the attribute.
     *
     * `.dl-written` carries `display: flex`, and a display rule beats the
     * `hidden` attribute — the mistake that has now caught three elements in
     * this project. `.dl-hidden` is `display: none !important`, so it wins
     * whatever else is declared, and the attribute stays for anything reading
     * the markup.
     */
    written.hidden = !writing
    written.classList.toggle('dl-hidden', !writing)
    // Everything after the database belongs to the dropdowns.
    for (const step of flow.querySelectorAll('.db-step')) {
      if (step.querySelector('#dbDb')) continue
      step.classList.toggle('dl-hidden', writing)
    }
    /*
     * Step 4 is for the dropdowns, and only once a column has been chosen.
     *
     * Two conditions in one place: a written statement has no step 4 at all,
     * and the dropdowns' step 4 waits for the column it describes — see
     * `follow` in `addNameAndTest`, which applies the second on its own as
     * the table and column change.
     */
    const step4 = drawer.querySelector('#dlStep4')
    if (step4) {
      const waiting = writing || !valueOf(drawer.querySelector('#dbCol'))
      step4.classList.toggle('dl-hidden', waiting)
      step4.classList.toggle('off', waiting)
    }
  }

  show()
}

/*
 * The two buttons are wired once, on the document, not on the buttons.
 *
 * They were bound per button, which is only correct while those buttons are
 * the ones on screen. The panel redraws itself for a dozen reasons — a reading
 * saved, a poll landing, a field losing focus — and each redraw builds a new
 * drawer with new buttons. Anything still holding the old ones (including a
 * click arriving a moment later) then ran `show()` over detached nodes: the
 * mode changed, nothing on screen did, and "From the dropdowns" left the
 * statement box up with no table under it.
 *
 * Delegated from the document there is nothing to go stale. The handler reads
 * the live drawer out of the document each time and re-runs the whole of
 * `howToPickIt` against it, which is idempotent — it creates what is missing
 * and settles what is there.
 */
function wireTheModeButtons() {
  if (wireTheModeButtons.done) return
  wireTheModeButtons.done = true

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#dlHow [data-how]')
    if (!button) return

    drawerState.how = button.dataset.how
    const drawer = document.getElementById('dlAddDrawer')
    if (!drawer) return

    howToPickIt(drawer)
    if (drawerState.how === 'query') {
      drawer.querySelector('#dlWrittenSql')?.focus()
    }
  })
}

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

  /*
   * The studio's tag search is not part of this flow.
   *
   * It offers a list of tag names to attach — `NEW_SAND_LEVEL_PCT`,
   * `MIXER_STATUS` — which is a different question from the one being asked
   * here. Adding a reading means saying where a number comes from: a database,
   * then a table and a column, or a statement. A search over invented tag
   * names at the top of that is a second route to a different place.
   */
  root.querySelector('#ixAdd')?.remove()

  wireTheModeButtons()
  howToPickIt(drawer)

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

  /*
   * Nothing chosen, and the steps arrive as the answers do.
   *
   * The studio fills the Database box in with the foundry's own database
   * before anybody has picked one — `dbsel` defaults to it, marked `auto` —
   * so the flow opened with a database named and its tables listed under it,
   * for a database nobody had chosen.
   *
   * Two other arrangements were tried and are worth recording. Showing that
   * default as selected while forcing the table step shut was the worst of
   * the three: the panel named `aiw_data` and then refused to list its
   * tables, which reads as broken. Recording the default as a real choice
   * fixed the tables and left the first question answered by the panel rather
   * than by the person. So: `Choose a database…`, and the table step opens
   * the moment one is picked.
   */
  if (block && (!picked || picked.auto)) {
    const database = drawer.querySelector('#dbDb')
    if (database) database.value = ''
    for (const step of drawer.querySelectorAll('.db-step')) {
      const number = step.querySelector('i')?.textContent?.trim()
      if (number === '2' || number === '3') step.classList.add('off')
    }
    drawer.querySelector('#dlStep4')?.classList.add('off', 'dl-hidden')
  }

  // And the same search over the flow's own table list — see table-search.mjs.
  const drawerTables = drawer.querySelector('#dbTbl')
  if (drawerTables) searchable(drawerTables)

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
  showTheQuery(connection)
  offerToBlink(connection)
}

/**
 * "Watch this one" — a reading that blinks on the drawing, at its own rate.
 *
 * Under the checkbox that puts a value on the canvas, because it is the same
 * subject: whether this reading is on the drawing, and how hard it is trying
 * to be noticed. See `paintBlinks` in live.mjs for what it does to the label.
 *
 * The interval is in seconds for the whole on-off cycle, and it only appears
 * once blinking is asked for — an input for a number nobody is using is a
 * question with no reason to be on screen.
 */
function offerToBlink(section) {
  const reg = peek('REG')
  if (!reg) return

  for (const card of section.querySelectorAll('.ix-card[data-tid]')) {
    const tag = reg[card.dataset.tid]
    if (!tag) continue

    // The studio's own "On the canvas" group, found by the checkbox in it.
    const canvas = card.querySelector('[data-ix="show"]')?.closest('.ix-grp')
    if (!canvas || canvas.querySelector('.dl-blink-row')) continue

    const seconds = blinkOf(tag)
    const row = document.createElement('div')
    row.className = 'dl-blink-row'
    row.innerHTML =
      '<label class="ix-c"><input type="checkbox" class="dl-blink-on"> Blink this value on the drawing</label>' +
      '<label class="ix-f dl-blink-every">Blink every' +
      '<span class="dl-blink-secs"><input type="number" class="dl-blink-sec" min="0.4" max="60" ' +
      'step="0.1" inputmode="decimal"><small>seconds</small></span></label>'

    const on = row.querySelector('.dl-blink-on')
    const every = row.querySelector('.dl-blink-every')
    const sec = row.querySelector('.dl-blink-sec')

    on.checked = !!seconds
    // Two seconds is a blink somebody notices without the screen flickering.
    sec.value = seconds ?? 2
    every.hidden = !seconds

    const apply = () => {
      if (!on.checked) delete tag.blink
      else {
        const typed = Number(sec.value)
        tag.blink = Number.isFinite(typed) && typed > 0 ? typed : 2
      }
      every.hidden = !on.checked
      persist()
      paintBlinks()
    }

    on.onchange = apply
    sec.onchange = apply
    // While it is being typed, so the rate can be judged against the drawing.
    sec.oninput = apply

    // Under the checkbox, above the Trend / All tag settings / Remove row.
    const actions = canvas.querySelector('.ix-acts')
    if (actions) actions.before(row)
    else canvas.append(row)
  }
}

/* ------------------------------------------- naming it, and checking it first ---*/

/** The three dropdowns' current answer, as the preview endpoint wants it. */
function chosen(drawer) {
  const pair = String(drawer.querySelector('#dbDb')?.value || '')
  const [source, database] = pair.split('|')
  return {
    source,
    database,
    table: valueOf(drawer.querySelector('#dbTbl')),
    column: valueOf(drawer.querySelector('#dbCol')),
  }
}

/**
 * A disabled dropdown has no answer in it, whatever it reads.
 *
 * While the tables are loading the studio renders
 * `<select id="dbTbl" disabled><option>Loading tables…</option></select>`, and
 * an `<option>` with no `value` attribute takes its text as its value — so
 * this returned the string "Loading tables…" and everything downstream
 * believed a table had been chosen. Step 4 opened on it, the statement preview
 * drew `FROM \`Loading tables…\``, and Read now offered to go and read it.
 *
 * The same is true of "Choose a database first" and "Tables could not be
 * loaded": each is a sentence in the position where a name belongs, and each
 * arrives on a select the studio has disabled. That is the thing to test —
 * disabled means there is nothing to answer with yet.
 */
function valueOf(select) {
  return select && !select.disabled ? select.value || '' : ''
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
/**
 * What the new reading will be ordered by, filtered to, and will run.
 *
 * Refilled whenever the table changes, because every one of these is a list of
 * that table's columns. The answers are kept on `drawerState` rather than on a
 * tag, because there is no tag yet — `dbAddTag` applies them the moment it
 * makes one.
 */
function fillTheNewReadingsChoices(drawer, step) {
  const newest = step.querySelector('#dlNewNewest')
  const key = step.querySelector('#dlNewKey')
  const op = step.querySelector('#dlNewOp')
  const value = step.querySelector('#dlNewKeyVal')
  const shown = step.querySelector('.dl-new-sql')

  const option = (v, label, selected) =>
    `<option value="${String(v).replaceAll('"', '&quot;')}"${selected ? ' selected' : ''}>${label}</option>`

  const refill = () => {
    const pick = chosen(drawer)
    const table = tableInTheFlow(drawer, pick.table)
    const columns = table?.cols || []

    const choices = orderingChoices(table)
    newest.innerHTML = choices.map((column, at) =>
      option(column.n, column.n, at === 0)).join('') ||
      option('', 'Whatever the database returns first', true)

    key.innerHTML = option('', 'every row', true) +
      columns.map(column => option(column.n, column.n)).join('')

    say()
  }

  const say = () => {
    const pick = chosen(drawer)
    if (!pick.table || !pick.column) { shown.textContent = ''; return }

    const filtered = !!(key.value && value.value.trim())
    shown.textContent =
      `SELECT \`${pick.column}\`` +
      (newest.value ? `, \`${newest.value}\`` : '') +
      ` FROM \`${pick.table}\`` +
      (filtered ? ` WHERE \`${key.value}\` ${op.value} '${value.value.trim()}'` : '') +
      (newest.value ? ` ORDER BY \`${newest.value}\` DESC` : '') +
      ' LIMIT 1'

    drawerState.newest = newest.value || null
    drawerState.filter = filtered
      ? { col: key.value, op: op.value, val: value.value.trim() }
      : null
  }

  for (const control of [newest, key, op]) control.onchange = say
  value.oninput = say
  drawer.querySelector('#dbTbl')?.addEventListener('change', refill)
  drawer.querySelector('#dbCol')?.addEventListener('change', say)
  refill()
}

/** The chosen table's catalogue entry, for its columns. */
function tableInTheFlow(drawer, name) {
  if (!name) return null
  const resolve = peek('SRC')
  const sourceId = String(drawer.querySelector('#dbDb')?.value || '').split('|')[0]
  try {
    const source = typeof resolve === 'function' ? resolve(sourceId) : null
    const groups = source ? window.catalog?.(source) : null
    const group = Array.isArray(groups) ? groups[0] : null
    return group?.tables?.find(entry => entry.name === name) || null
  } catch {
    return null
  }
}

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
      /*
       * The two things a chart needs, asked for before the reading exists.
       *
       * They used to be on the reading's own card, which meant adding a
       * reading, finding it in the list, opening it and setting them — for
       * every reading, when the answer is the same for all of them on one
       * table. Asked here they are part of saying what the reading is.
       */
      '<label class="ix-f">Newest by, for the chart' +
        '<select id="dlNewNewest"></select>' +
      '</label>' +
      '<label class="ix-f">Only rows where' +
        '<span class="dl-link-where">' +
          '<select id="dlNewKey"></select>' +
          '<select id="dlNewOp">' +
          ['=', '!=', '>', '<', '>=', '<='].map(op => `<option>${op}</option>`).join('') +
          '</select>' +
          '<input id="dlNewKeyVal" class="mono" placeholder="value" spellcheck="false">' +
        '</span>' +
      '</label>' +
      '<code class="dl-new-sql"></code>' +
      '<div class="dl-step4-acts">' +
        '<button type="button" class="sb" id="dlTestRead">Read now</button>' +
        '<span class="note" id="dlTestSays"></span>' +
      '</div>' +
    '</div>'

  const flow = drawer.querySelector('#dbFlow')
  if (flow) flow.append(step)
  else drawer.prepend(step)

  fillTheNewReadingsChoices(drawer, step)

  const says = step.querySelector('#dlTestSays')
  const tell = (text, tone = '') => { says.innerHTML = `<span class="${tone}">${escapeText(text)}</span>` }

  /*
   * Step 4 waits for the column.
   *
   * Naming a reading, ordering it and filtering it are all questions about one
   * column, and the statement preview cannot be written without it — a preview
   * of `SELECT ? FROM RTC Data` is three dropdowns and a blank. So it stays
   * out of the way until there is something to describe.
   */
  const follow = () => {
    const waiting = !chosen(drawer).column
    // `.off` hides a step inside the drawer and greys its number elsewhere;
    // `.dl-hidden` is the one that cannot be overruled by a display rule.
    step.classList.toggle('off', waiting)
    step.classList.toggle('dl-hidden', waiting)
  }
  follow()
  drawer.querySelector('#dbTbl')?.addEventListener('change', follow)
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
      // How long it took, because "is this quick enough to poll?" is the
      // other half of "is anything there?".
      const took = Number.isFinite(answer?.tookMs) ? ` · ${answer.tookMs} ms` : ''
      if (answer?.value && answer.value.value !== null && answer.value.value !== undefined) {
        const when = answer.value.recordedAt || answer.value.date || ''
        tell(`Latest value ${answer.value.value}${when ? ` · ${when}` : ''}${took}`, 'tx0')
      } else {
        tell(`${answer?.error || 'No record for that column yet'}${took}`, 'tx2')
      }
    } catch (error) {
      tell(error?.message || 'That could not be read', 'tx3')
    }
  }
}

const escapeText = value =>
  String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/* ------------------------------------- the query, and reading it right now ---*/

/**
 * How each engine quotes a name. Mirrors `DIALECT` in `db-connect.js`.
 *
 * A copy, deliberately: this draws the statement before anybody has run
 * anything, so it cannot come from the server. What it draws is replaced by
 * the server's own text the moment Read now is pressed, which is the one that
 * actually ran — so a drift between the two shows itself immediately rather
 * than hiding.
 */
const QUOTE = {
  mysql: name => `\`${String(name).replaceAll('`', '``')}\``,
  mariadb: name => `\`${String(name).replaceAll('`', '``')}\``,
  postgres: name => `"${String(name).replaceAll('"', '""')}"`,
  sqlserver: name => `[${String(name).replaceAll(']', ']]')}]`,
  azuresql: name => `[${String(name).replaceAll(']', ']]')}]`,
}

/** The studio's own words for a database type, in our engine names. */
const ENGINE_OF = { mysql: 'mysql', mssql: 'sqlserver', postgres: 'postgres' }

/**
 * Columns that time something a tool did, not something the plant did.
 *
 * `_watermark_ts` is a replication watermark: when a row was copied into this
 * database, not when the pour happened. It sorts almost the same almost all
 * the time, which is what makes it the wrong answer — it is right until a
 * backfill or a replay puts the rows in a different order from the events.
 * Picked last, never first, and the reading says which column it is using so
 * it can be changed.
 */
const BOOKKEEPING = /^_|watermark|sync|etl|ingest|inserted|created_?at$|load_?ts/i

/**
 * Which column makes "the newest row" mean something.
 *
 * The link carries one when the reading was made through a flow that found
 * it. Where it does not — an older link, or a table catalogued without a
 * timestamp — the table's own columns are asked: a date or time column the
 * plant writes first, then an id, then whatever is left including the
 * bookkeeping ones.
 */
function newestBy(link, table) {
  // A combined date and time shows as the one entry it was chosen from.
  if (link.tcol && link.tcol2) return `${link.tcol} + ${link.tcol2}`
  if (link.tcol) return link.tcol
  return orderingChoices(table)[0]?.n || null
}

/**
 * Every column this table could be ordered by, best first.
 *
 * Timestamps the plant writes, then ids, then the bookkeeping columns — and
 * the whole list, because the only person who knows which column means "most
 * recent" in their own schema is the one looking at this panel.
 */
/**
 * The catalogue entry for the table a link points at, or null.
 *
 * `catalog()` is the one place that knows a table's columns and their types,
 * for the foundry's database as well as for one registered here. Everything
 * here is best-effort: a database whose tables have not been fetched yet
 * simply gives nothing back, and the caller leaves what it found alone.
 */
function tableOf(link) {
  const resolve = peek('SRC')
  if (!link?.src || !link?.table || typeof window.catalog !== 'function') return null

  try {
    const source = typeof resolve === 'function' ? resolve(link.src) : null
    if (!source) return null
    const groups = window.catalog(source)
    const group = Array.isArray(groups) ? groups[0] : null
    return group?.tables?.find(entry => entry.name === link.table) || null
  } catch {
    return null
  }
}

/** Text columns a plant keeps its date and its time of day in. */
const DATEISH = /(^|_)date($|_)|^d$/i
const TIMEISH = /(^|_)time($|_)|^t$/i

/**
 * A date column and a time column, where the table has them as text.
 *
 * Not every plant table has a `datetime`. `pouring_data` keeps `10-22-2026`
 * in `Date` and `13:35:35` in `Time`, both text, and its only real timestamps
 * are a copying tool's. Those two together are the moment a pour happened,
 * and offering them as one choice is how somebody says so.
 */
function datePair(table) {
  const columns = table?.cols || []
  /*
   * The date half may be a `datetime`, not only text.
   *
   * `RTC Data` keeps `Det` as a `datetime` that is always midnight, with the
   * real time of day in a `Time` text column beside it. Requiring both halves
   * to be text left that table — the one that most needs the combination —
   * unable to have it.
   */
  /*
   * A `datetime` column needs no name test; a text one does.
   *
   * The date half was matched on its name containing "date", which ruled out
   * `Det` — the `datetime` column on `RTC Data` that holds the day — so the
   * one table that most needed the combination never offered it. A column the
   * database already calls a date does not have to be called one as well;
   * only a text column has to prove itself by its name.
   */
  const date = columns.find(column => column.t === 'datetime' && !BOOKKEEPING.test(column.n)) ||
    columns.find(column => column.t === 'varchar' && DATEISH.test(column.n))
  const time = columns.find(column => column.t === 'varchar' && TIMEISH.test(column.n))
  return date && time ? { date: date.n, time: time.n } : null
}

/** `Date + Time`, as one value for the dropdown. */
const PAIR_JOIN = ' + '
export const pairValue = pair => `${pair.date}${PAIR_JOIN}${pair.time}`
const pairFrom = value =>
  (String(value).includes(PAIR_JOIN)
    ? { date: value.split(PAIR_JOIN)[0], time: value.split(PAIR_JOIN)[1] }
    : null)

function orderingChoices(table) {
  const columns = (table?.cols || []).filter(column =>
    column.t === 'datetime' || /(^|_)id$/i.test(column.n) || column.t === 'int')

  const rank = column =>
    (BOOKKEEPING.test(column.n) ? 2 : 0) + (column.t === 'datetime' ? 0 : 1)

  const listed = columns
    .map((column, order) => ({ ...column, order }))
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order)

  /*
   * The combined pair first, where there is one.
   *
   * It is the plant's own moment, and the alternative on a table like that is
   * a replication watermark — so it leads, and the rest follow in the order
   * they always did.
   */
  /*
   * The merged pair is offered, not forced.
   *
   * Whether a `datetime` column actually carries a time of day is a question
   * about the data, not the schema — `Det` is a `datetime` whose every value
   * is midnight — and the panel has only the schema. So the entry is listed
   * and somebody chooses it; the server, which can see the rows, uses the
   * merge automatically only where the `datetime` has no clock in it. See
   * `stampFromParts`.
   */
  const pair = datePair(table)
  return pair
    ? [{ n: pairValue(pair), t: 'datetime', pair }, ...listed]
    : listed
}

/**
 * The statement behind a reading, as text.
 *
 * Written out in full — database, table, column, the ordering that makes
 * "newest" mean something, the row filter if there is one — because that is
 * the thing somebody checks against their own database when a reading says
 * "no record".
 *
 * For a database registered here it is the statement this service runs, and
 * `Read now` replaces it with the server's own text, which is authoritative.
 * For the foundry's own database SandMan runs the read and this is the query
 * that read amounts to: the same database, table, column and ordering, said
 * in SQL rather than in prose. It is labelled as such by the caller.
 */
function statementFor(source, link, table, tagId) {
  const engine = source?.engine || ENGINE_OF[source?.type]
  const quote = QUOTE[engine]
  if (!quote || !link?.table || !link?.col) return null

  /*
   * The table on its own, not `database`.`table`.
   *
   * This used to write the database in front, and the server's statement does
   * not — the connection is already open on that database, so there is nothing
   * to qualify. The result was two statements for one reading in one box:
   * `FROM \`aiw_data\`.\`RTC Data\`` before Read now and `FROM \`RTC Data\``
   * after it, which reads as the button having changed the query.
   *
   * Qualifying the server's side instead would not travel: `db.table` means
   * schema.table on SQL Server and is not addressable at all on Postgres. The
   * database is named on the card above either way.
   */
  const where = quote(link.table)
  const filtered = !!(link.keyCol && link.keyVal)

  /*
   * The same two columns, under the same two names, as the chart's statement.
   *
   * This said `SELECT \`C10\` AS value, \`Det\` AS at` while the chart said
   * `AS \`BENTONITE_LEVEL_PCT\`, … AS \`datetime\`` — two statements for one
   * reading, disagreeing about what they select. A merged date and time shows
   * as the pair it is, since that is what "Newest by" was set to.
   */
  const named = quote(String(tagId || link.col))
  /*
   * The date column alone, even where "Newest by" names a merged pair.
   *
   * This statement finds one row — the latest value — and the date is
   * enough to order by for that. Merging the time in is what the chart
   * needs, to place points through a window. Showing the merge here while
   * Read now reported the plain column was the same reading described two
   * ways, which is the thing to avoid.
   */
  const moment = link.tcol ? quote(link.tcol) : null

  const whole = `SELECT ${quote(link.col)} AS ${named}` +
    (moment ? `, ${moment} AS ${quote('datetime')}` : '') +
    ` FROM ${where}` +
    // With the comparison that was chosen, and the value written in rather
    // than left as `?` — this is read, not run, and `?` tells nobody anything.
    (filtered ? ` WHERE ${quote(link.keyCol)} ${link.keyOp || '='} '${String(link.keyVal).replaceAll("'", "''")}'` : '') +
    (moment ? ` ORDER BY ${quote('datetime')} DESC` : '')

  return /^(sqlserver|azuresql)$/.test(engine)
    ? whole.replace(/^SELECT /, 'SELECT TOP 1 ')
    : `${whole} LIMIT 1`
}

/**
 * What this reading asks the database, and two ways to ask it.
 *
 *   From the dropdowns   the statement the table and column above produce,
 *                        shown as it is and run with Read now: one row,
 *                        through the server, by the same code the poll uses.
 *   Write your own       the same statement, editable. Change the limit, add
 *                        a WHERE, look at the whole table — whatever answers
 *                        "is there anything in there?".
 *
 * The second only exists for a database registered here. The foundry's own is
 * read by SandMan, which answers for a table and a column and has no way to
 * run a statement, so that tab says so rather than offering something that
 * cannot work.
 *
 * Neither touches the reading: nothing here stores anything or changes a link.
 */
function showTheQuery(section) {
  const reg = peek('REG')
  const resolve = peek('SRC')
  if (!reg) return

  for (const card of section.querySelectorAll('.ix-card[data-tid]')) {
    const tag = reg[card.dataset.tid]
    const link = tag?.link
    // A reading is either a table and a column, or a statement of its own.
    if (!link || (!link.sql && (!link.table || !link.col))) continue

    const source = typeof resolve === 'function' ? resolve(link.src) : null
    const connection = connectionIdFrom(link.src)

    /*
     * The table's own columns, so the statement can order by something real.
     * The catalogue is what the dropdowns above were filled from, so this is
     * the same list — no second question to anybody.
     */
    let table = null
    try {
      const groups = window.catalog?.(source)
      const group = Array.isArray(groups)
        ? groups.find(entry => entry.name === link.db) || groups[0]
        : null
      table = group?.tables?.find(entry => entry.name === link.table) || null
    } catch { /* no catalogue — the statement simply has no ORDER BY */ }

    // The tag id is the alias the chart uses, so it is passed in too.
    const statement = statementFor(source, link, table, card.dataset.tid)

    let box = card.querySelector('.dl-query')
    if (!box) {
      box = document.createElement('div')
      box.className = 'dl-query'
      box.innerHTML =
        '<div class="dl-query-head">' +
        '<div class="seg dl-query-tabs">' +
        '<button type="button" data-q="auto" class="on">From the dropdowns</button>' +
        '<button type="button" data-q="own">Write your own</button>' +
        '</div>' +
        /*
         * One box, and a choice of which statement is in it.
         *
         * A reading runs two: one row for the value beside it on the canvas,
         * and a window of rows for the chart. Both were appearing in this box
         * — the latest-value one drawn here, then whatever the last read
         * reported — so the statement changed under somebody who had not
         * touched anything, and neither text said which of the two it was.
         *
         * Now the dropdown says, and Read now reads that one.
         */
        '<select class="dl-query-what">' +
        '<option value="latest">Latest value</option>' +
        '<option value="chart">For the chart</option>' +
        '</select>' +
        '<button type="button" class="sb dl-query-go"></button>' +
        '</div>' +
        '<code class="dl-query-sql"></code>' +
        '<textarea class="dl-sql-text mono" rows="3" spellcheck="false" hidden></textarea>' +
        /*
         * And the one that makes it the reading.
         *
         * Running a query answers "is it there?"; this answers "then read it
         * from now on" — the poll runs this statement every thirty seconds
         * instead of building one from the table and column.
         */
        '<div class="dl-query-acts" hidden>' +
        '<button type="button" class="sb dl-query-adopt">Use for this reading</button>' +
        '<button type="button" class="sb dl-query-drop" hidden>Go back to Table and Column</button>' +
        '</div>' +
        '<p class="note dl-query-says"></p>' +
        '<div class="dl-sql-rows"></div>'
      const row = card.querySelector('.dl-link-row')
      if (row) row.after(box)
      else card.querySelector('.ix-grp')?.append(box)
    }

    const shown = box.querySelector('.dl-query-sql')
    const editor = box.querySelector('.dl-sql-text')
    const says = box.querySelector('.dl-query-says')
    const rows = box.querySelector('.dl-sql-rows')
    const go = box.querySelector('.dl-query-go')
    const what = box.querySelector('.dl-query-what')
    const acts = box.querySelector('.dl-query-acts')
    const adopt = box.querySelector('.dl-query-adopt')
    const drop = box.querySelector('.dl-query-drop')

    /** Whether this reading is driven by a statement rather than by the picks. */
    const driven = typeof link.sql === 'string' && !!link.sql.trim()

    /**
     * The statement from the dropdowns, with the row filter beside it — and,
     * where SandMan does the reading, a line saying whose statement it is.
     *
     * SandMan builds its own against the foundry's database, so this is the
     * query that read amounts to rather than the text it sends. Saying which
     * is the difference between showing somebody the query and inventing one.
     */
    const fromDropdowns = driven
      ? link.sql + '\n-- this reading runs your query, every poll.'
      : statement
        ? statement +

          (connection ? '' : '\n-- SandMan runs the read; this is what it comes to.')
        : `SandMan reads the newest ${link.table}.${link.col} for this line.`

    const tell = (text, tone = '') => {
      says.textContent = text
      says.className = `note dl-query-says ${tone}`
    }

    /*
     * The chart's statement is the server's, never one drawn here.
     *
     * It is built in `recentValues` out of things only that end knows — which
     * column the table's clock really is, whether a date and a time have to be
     * read as one, where the window starts in the data's own frame. Drawing an
     * approximation of it here is how this box came to show two statements in
     * the first place, so it shows nothing until the chart has been read and
     * then shows exactly what ran.
     */
    const kept = { latest: null, chart: null }

    const show = mode => {
      box.dataset.mode = mode
      for (const tab of box.querySelectorAll('[data-q]')) {
        tab.classList.toggle('on', tab.dataset.q === mode)
      }
      shown.hidden = mode !== 'auto'
      what.hidden = mode !== 'auto'
      editor.hidden = mode !== 'own'
      go.textContent = mode === 'auto' ? 'Read now' : 'Run'
      if (mode === 'auto') {
        shown.textContent = what.value === 'chart'
          ? kept.chart || 'Press Read now for the statement the chart runs over its window.'
          : kept.latest || fromDropdowns
      }
      rows.innerHTML = ''
      says.textContent = ''

      // Adopting is for the tab where a statement is written; going back is
      // offered wherever a statement is already driving the reading.
      acts.hidden = !connection || (mode !== 'own' && !driven)
      adopt.hidden = mode !== 'own'
      drop.hidden = !driven

      if (mode === 'own' && !connection) {
        go.hidden = true
        editor.hidden = true
        tell('SandMan reads the foundry\'s own database a column at a time. ' +
          'There is no statement to write against it from here — use the dropdowns above.')
        return
      }
      go.hidden = false
      if (mode === 'own' && !editor.value) {
        /*
         * Opened on whatever this reading runs today: its own statement if it
         * has one, otherwise the one the dropdowns make. Editing that is what
         * "write your own" usually means — widen it, drop the filter, join.
         */
        editor.value = link.sql || statement || `SELECT * FROM ${link.table}`
        editor.placeholder = `SELECT * FROM ${link.table || 'a_table'}`
      }
    }

    show(box.dataset.mode || 'auto')

    for (const tab of box.querySelectorAll('[data-q]')) {
      tab.onclick = () => show(tab.dataset.q)
    }
    what.onchange = () => show(box.dataset.mode || 'auto')

    /**
     * The window the chart reads, so the statement shown is the chart's own.
     *
     * Two hours, which is what a trend opens on — see DEFAULT_WINDOW in
     * live.mjs. Asking for a different span here would report a statement with
     * a different WHERE from the one the chart runs, which is the whole thing
     * this box exists to stop.
     */
    const readTheChart = async () => {
      const loop = watching()
      if (!loop) { tell('Open a loop first.'); return }

      tell('Reading…')
      try {
        const answer = await api.get(
          `/live/chart?loopId=${encodeURIComponent(loop)}` +
          `&tag=${encodeURIComponent(card.dataset.tid)}&windowSeconds=7200`)

        kept.chart = answer?.query || null
        if (kept.chart) shown.textContent = kept.chart

        const count = answer?.series?.length || 0
        tell(count
          ? `${count} record${count === 1 ? '' : 's'}` +
            `${answer.dateFrom ? ` · ${answer.dateFrom} → ${answer.dateTo}` : ''}`
          : 'That window held no records', count ? 'tx0' : 'tx2')
      } catch (error) {
        // A refusal carries the statement it refused on, which is the one
        // somebody opened this box to see.
        kept.chart = error?.detail?.query || kept.chart
        if (kept.chart) shown.textContent = kept.chart
        tell(error?.message || 'That chart could not be read', 'tx3')
      }
    }

    /** One row, through the reading's own path. */
    const readNow = async () => {
      const loop = watching()
      if (!loop) { tell('Open a loop first.'); return }

      tell('Reading…')
      try {
        const answer = await api.post('/live/preview', {
          loopId: loop,
          source: link.src,
          // So the statement it reports is aliased like the one shown above it.
          tagId: card.dataset.tid,
          ...(driven
            ? { sql: link.sql }
            : {
                table: link.table,
                column: link.col,
                ...(link.keyCol && link.keyVal
                  ? { keyColumn: link.keyCol, keyValue: link.keyVal, keyOp: link.keyOp || '=' }
                  : {}),
                ...(link.tcol ? { timeColumn: link.tcol } : {}),
              }),
        })

        // The statement the server actually ran, in place of ours.
        if (answer?.query) {
          kept.latest = answer.query +
            (answer.params?.length ? `    — with ? = ${answer.params.join(', ')}` : '')
          shown.textContent = kept.latest
        }

        const took = Number.isFinite(answer?.tookMs) ? ` · ${answer.tookMs} ms` : ''
        const where = answer?.via ? ` from ${answer.via}` : ''
        const record = answer?.value
        if (record && record.value !== null && record.value !== undefined) {
          const when = record.recordedAt || [record.date, record.time].filter(Boolean).join(' ')
          tell(`${record.value}${when ? ` · recorded ${when}` : ''}${where}${took}`, 'tx0')
        } else {
          tell(`${answer?.error || 'No record for that column yet'}${took}`, 'tx2')
        }
      } catch (error) {
        tell(error?.message || 'That could not be read', 'tx3')
      }
    }

    /** Whatever is in the box, against the database it is registered with. */
    const runOwn = async () => {
      const sql = editor.value.trim()
      if (!sql) { tell('Type a query first.'); return }

      tell('Running…')
      rows.innerHTML = ''
      try {
        const answer = await api.post(
          `/connections/${encodeURIComponent(connection)}/query`, { sql, limit: 50 })

        const count = answer.rows?.length || 0
        tell(count
          ? `${answer.rowCount} row${answer.rowCount === 1 ? '' : 's'}` +
            `${answer.truncated ? `, showing ${count}` : ''} · ${answer.tookMs} ms · ${answer.via}`
          : `No rows · ${answer.tookMs} ms · ${answer.via}`, count ? 'tx0' : 'tx2')

        if (!count) return
        rows.innerHTML =
          '<table class="dl-sql-table"><thead><tr>' +
          (answer.columns || []).map(name => `<th>${escapeText(name)}</th>`).join('') +
          '</tr></thead><tbody>' +
          answer.rows.map(record =>
            `<tr>${record.map(cell =>
              `<td>${cell === null ? '<span class="note">null</span>' : escapeText(cell)}</td>`
            ).join('')}</tr>`).join('') +
          '</tbody></table>'
      } catch (error) {
        // The database's own complaint — an unknown column, a table that is
        // not there — which is the useful half of pressing Run.
        tell(error?.message || 'That query could not be run', 'tx3')
        rows.innerHTML = ''
      }
    }

    /**
     * Make this statement the reading.
     *
     * Checked by running it first: a statement that answers with nothing is
     * not something to leave a reading pointed at. The first column is the
     * value and the second is its time — said here rather than discovered
     * when the trend turns out to have nothing to plot against.
     */
    adopt.onclick = async () => {
      const sql = editor.value.trim()
      if (!sql) { tell('Type a query first.'); return }

      const loop = watching()
      if (!loop) { tell('Open a loop first.'); return }

      tell('Checking it…')
      try {
        const answer = await api.post('/live/preview', { loopId: loop, source: link.src, sql })
        const record = answer?.value
        if (!record || record.value === null || record.value === undefined) {
          tell(`${answer?.error || 'That query returned nothing'} — the reading is unchanged`, 'tx3')
          return
        }

        link.sql = sql
        persist()
        tell(`This reading now runs your query. Latest value ${record.value}.`, 'tx0')
        window.renderProps?.()
      } catch (error) {
        tell(`${error?.message || 'That query could not be used'} — the reading is unchanged`, 'tx3')
      }
    }

    /** Back to the dropdowns: the statement is dropped, the picks are kept. */
    drop.onclick = () => {
      delete link.sql
      persist()
      window.renderProps?.()
    }

    go.onclick = () =>
      box.dataset.mode === 'own' ? runOwn() : what.value === 'chart' ? readTheChart() : readNow()
    editor.onkeydown = event => {
      // Enter runs it; Shift+Enter is a new line, as in every query box.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        runOwn()
      }
    }
  }
}

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
      '<label class="ix-f dl-link-colf">Column<select class="dl-link-col"></select></label>' +
      /*
       * Which column means "the newest row".
       *
       * It was picked silently, and the first timestamp in a table is often
       * `_watermark_ts` — when a row was copied in, not when the pour
       * happened. That is right until a backfill puts the rows in a different
       * order from the events, and nothing on screen said which column was
       * being trusted. Now it says, and it can be changed.
       */
      '<label class="ix-f dl-link-orderf">Newest by<select class="dl-link-order"></select></label>' +
      /*
       * Which rows, where a table holds more than this line's.
       *
       * One table commonly carries every line in the plant — `foundry_line_id`,
       * `line_no`, `machine` — so a reading on it charts three lines' readings
       * interleaved and calls the result a trend. The column and the value are
       * both chosen, never guessed: a filter invented from a table's first
       * text column is how `created_by = 'BEN-BIN'` got written into a loop
       * and matched nothing at all.
       *
       * Left empty, there is no WHERE and the reading sees the whole table,
       * which is right for a table that only holds one line.
       */
      '<label class="ix-f dl-link-wheref">Only rows where' +
      '<span class="dl-link-where"><select class="dl-link-key"></select>' +
      // Equality answers "this line"; the rest answer "above this batch",
      // "anything but the trial line", and the other half of the questions.
      '<select class="dl-link-op">' +
      ['=', '!=', '>', '<', '>=', '<='].map(op => `<option>${op}</option>`).join('') +
      '</select>' +
      '<input class="dl-link-keyval mono" placeholder="value" spellcheck="false"></span></label>'

    const tableSelect = row.querySelector('.dl-link-table')
    const columnSelect = row.querySelector('.dl-link-col')
    const columnField = row.querySelector('.dl-link-colf')
    const orderSelect = row.querySelector('.dl-link-order')
    const orderField = row.querySelector('.dl-link-orderf')
    const keySelect = row.querySelector('.dl-link-key')
    const keyOp = row.querySelector('.dl-link-op')
    const keyValue = row.querySelector('.dl-link-keyval')
    const keyField = row.querySelector('.dl-link-wheref')

    /*
     * A reading driven by its own statement has no use for these: the query
     * says which table, which column and what "newest" means. They are put
     * away rather than left to describe something that is not being read —
     * "Go back to Table and Column" under the query brings them back.
     */
    if (typeof tag.link?.sql === 'string' && tag.link.sql.trim()) {
      row.classList.add('dl-hidden')
    }

    const option = (value, label, selected) =>
      `<option value="${value.replaceAll('"', '&quot;')}"${selected ? ' selected' : ''}>${label}</option>`

    tableSelect.innerHTML = option('', 'Choose a table…', !tag.link?.table) +
      group.tables.map(table =>
        option(table.name, table.name, table.name === tag.link?.table)).join('')

    // Two hundred tables is not a list anybody scrolls — see table-search.mjs.
    searchable(tableSelect)

    const fillColumns = () => {
      const table = group.tables.find(entry => entry.name === tableSelect.value)
      const columns = table?.cols || []
      // No table chosen, nothing to choose a column from — so no column box.
      columnField.hidden = !tableSelect.value
      columnSelect.innerHTML = option('', 'Choose a column…', !tag.link?.col) +
        columns.map(column => option(column.n, column.n, column.n === tag.link?.col)).join('')

      /*
       * And what "newest" is measured by. Ordered best first — a timestamp
       * the plant writes, then an id, then the bookkeeping columns — with
       * the one in use selected, whatever it is.
       */
      const choices = orderingChoices(table)
      const using = newestBy(tag.link || {}, table)
      orderField.hidden = !tableSelect.value || !choices.length
      orderSelect.innerHTML = choices
        .map(column => option(column.n, column.n, column.n === using)).join('') +
        option('', 'Whatever the database returns first', !using)

      /*
       * And which rows, if the table holds more than this line's.
       *
       * Every column is offered rather than a guessed shortlist — a plant
       * calls it `foundry_line_id`, `line_no`, `machine` or something only it
       * knows — with "every row" first, because that is the right answer for
       * a table that holds one line and is the answer nobody should have to
       * go looking for.
       */
      const chosen = tag.link?.keyCol || ''
      keyField.hidden = !tableSelect.value
      keySelect.innerHTML = option('', 'every row', !chosen) +
        columns.map(column => option(column.n, column.n, column.n === chosen)).join('')
      keyOp.hidden = !chosen
      keyOp.value = tag.link?.keyOp || '='
      keyValue.hidden = !chosen
      keyValue.value = tag.link?.keyVal || ''
    }
    fillColumns()

    const applyFilter = () => {
      const link = tag.link
      if (!link) return
      const column = keySelect.value
      const value = keyValue.value.trim()
      keyOp.hidden = !column
      keyValue.hidden = !column

      // Both halves or neither: a column with no value matches nothing, which
      // is the failure this control exists to stop somebody walking into.
      if (column && value) {
        link.keyCol = column
        link.keyVal = value
        link.keyOp = keyOp.value || '='
      } else {
        delete link.keyCol
        delete link.keyVal
        delete link.keyOp
      }
      persist()
    }

    /*
     * Choosing the column shows the box to type the value in — and nothing
     * more until both are there.
     *
     * Redrawing the panel here was wrong twice over: `applyFilter` only
     * stores a filter when it has both halves, so a column chosen with no
     * value yet was never stored, and the redraw then read it back as "every
     * row" and hid the box again. Choosing a column looked like it did
     * nothing at all.
     */
    keySelect.onchange = () => {
      keyOp.hidden = !keySelect.value
      keyValue.hidden = !keySelect.value
      applyFilter()
      if (keySelect.value) keyValue.focus()
    }
    keyOp.onchange = applyFilter

    /*
     * Stored as it is typed, not when the box loses focus.
     *
     * `onchange` on a text input fires on blur — so a filter typed and then
     * read straight off the statement below showed no WHERE at all, because
     * nothing had been stored yet. It looked exactly like the filter being
     * ignored, which is the one thing it must not look like.
     */
    /*
     * Stored a moment after the typing stops, not on every keystroke.
     *
     * `onchange` alone was too late — it fires on blur, so a filter typed and
     * then read off the statement below showed no WHERE and looked ignored.
     * Storing on every keystroke was too eager the other way: each one saved,
     * which redrew the panel, which took the caret and the scroll position
     * with it. Half a second of quiet is the difference.
     */
    let settling = null
    keyValue.oninput = () => {
      keyField.classList.toggle('dl-needs-value', !!keySelect.value && !keyValue.value.trim())
      clearTimeout(settling)
      settling = setTimeout(applyFilter, 500)
    }
    keyValue.onblur = () => {
      clearTimeout(settling)
      applyFilter()
    }

    orderSelect.onchange = () => {
      const link = tag.link
      if (!link) return

      /*
       * One column, or a date and a time read as one moment.
       *
       * The pair is stored as both halves rather than as the joined label,
       * so the server never has to take a string apart to find out what was
       * meant — see `timeColumn2` in live-tags.js.
       */
      const pair = pairFrom(orderSelect.value)
      if (pair) {
        link.tcol = pair.date
        link.tcol2 = pair.time
      } else if (orderSelect.value) {
        link.tcol = orderSelect.value
        delete link.tcol2
      } else {
        delete link.tcol
        delete link.tcol2
      }
      persist()
      window.renderProps?.()
    }

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

      /*
       * No row filter is invented here, and one that was chosen survives.
       *
       * The studio fills one in from the table's first text column and the
       * equipment's name: `created_by = 'BEN-BIN'` on a table whose
       * `created_by` holds user names. It matches nothing, so the reading
       * says "no record" while the column it points at is full.
       *
       * What somebody chose in "Only rows where" is a different thing and is
       * kept — unless the table itself changed, because a filter naming a
       * column that table does not have would quietly match nothing.
       */
      const sameTable = had.table === tableSelect.value
      const chosenFilter = sameTable && had.keyCol && had.keyVal &&
        table.cols?.some(column => column.n === had.keyCol)

      if (chosenFilter) {
        link.keyCol = had.keyCol
        link.keyVal = had.keyVal
      } else {
        delete link.keyCol
        delete link.keyVal
      }

      /*
       * A timestamp the plant writes, in preference to one a copying tool
       * writes — `orderingChoices` puts `_watermark_ts` and its kind last.
       * It is only the starting answer: the "Newest by" box above says which
       * column is in use and changes it.
       */
      const stamp = orderingChoices(table)[0]?.n
      if (stamp) {
        const picked = orderingChoices(table)[0]
        if (picked?.pair) { link.tcol = picked.pair.date; link.tcol2 = picked.pair.time }
        else { link.tcol = stamp; delete link.tcol2 }
      }

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

      /*
       * And no invented row filter, on any database.
       *
       * `dbAddTag` sets `keyCol` to the table's first text column and
       * `keyVal` to the equipment's name — `created_by = 'BEN-BIN'` on a
       * column that holds user names. The reading then says "no record" over
       * a column that is full, which is the hardest kind of wrong to find:
       * everything about the link looks right.
       */
      if (tag.link) {
        delete tag.link.keyCol
        delete tag.link.keyVal

        /*
         * And ordered by something that is a time, where the table has one.
         *
         * The flow leaves `tcol` on whatever the studio picked, which on a
         * table whose first candidate is `id` means the reading is ordered by
         * its primary key. That finds the newest row correctly and gives the
         * trend nothing to plot against — `id` is not a moment — so the chart
         * came up empty beside a badge showing a perfectly good value.
         *
         * `orderingChoices` already ranks a real timestamp above an id and a
         * plant column above a copying tool's, which is the same answer the
         * Table and Column dropdowns give when a reading is relinked there.
         */
        const choices = orderingChoices(tableOf(tag.link))

        /*
         * What was chosen in the flow, or the best guess if nothing was.
         *
         * "Newest by, for the chart" and "Only rows where" are answered while
         * the reading is being added, so they are applied here — the one
         * moment the tag exists and nothing has read it yet.
         */
        const asked = drawerState.newest
          ? choices.find(column => column.n === drawerState.newest) || null
          : choices[0] || null

        if (asked?.pair) {
          tag.link.tcol = asked.pair.date
          tag.link.tcol2 = asked.pair.time
        } else if (asked) {
          tag.link.tcol = asked.n
          delete tag.link.tcol2
        }

        if (drawerState.filter) {
          tag.link.keyCol = drawerState.filter.col
          tag.link.keyVal = drawerState.filter.val
          tag.link.keyOp = drawerState.filter.op || '='
        }
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
      // Used once: the next reading answers these for itself.
      drawerState.newest = null
      drawerState.filter = null

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
