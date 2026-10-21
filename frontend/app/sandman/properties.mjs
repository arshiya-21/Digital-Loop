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
  showTheQuery(connection)
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
function orderingChoices(table) {
  const columns = (table?.cols || []).filter(column =>
    column.t === 'datetime' || /(^|_)id$/i.test(column.n) || column.t === 'int')

  const rank = column =>
    (BOOKKEEPING.test(column.n) ? 2 : 0) + (column.t === 'datetime' ? 0 : 1)

  return columns
    .map((column, order) => ({ ...column, order }))
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order)
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
function statementFor(source, link, table) {
  const engine = source?.engine || ENGINE_OF[source?.type]
  const quote = QUOTE[engine]
  if (!quote || !link?.table || !link?.col) return null

  const where = source?.db ? `${quote(source.db)}.${quote(link.table)}` : quote(link.table)
  const order = newestBy(link, table)
  const filtered = !!(link.keyCol && link.keyVal)

  const whole = `SELECT ${quote(link.col)}` +
    (order ? `, ${quote(order)}` : '') +
    ` FROM ${where}` +
    (filtered ? ` WHERE ${quote(link.keyCol)} = ?` : '') +
    (order ? ` ORDER BY ${quote(order)} DESC` : '')

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

    const statement = statementFor(source, link, table)

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
          (link.keyCol && link.keyVal ? `    — with ? = ${link.keyVal}` : '') +
          (connection ? '' : '\n-- SandMan runs the read; this is what it comes to.')
        : `SandMan reads the newest ${link.table}.${link.col} for this line.`

    const tell = (text, tone = '') => {
      says.textContent = text
      says.className = `note dl-query-says ${tone}`
    }

    const show = mode => {
      box.dataset.mode = mode
      for (const tab of box.querySelectorAll('[data-q]')) {
        tab.classList.toggle('on', tab.dataset.q === mode)
      }
      shown.hidden = mode !== 'auto'
      editor.hidden = mode !== 'own'
      go.textContent = mode === 'auto' ? 'Read now' : 'Run'
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

    shown.textContent = fromDropdowns
    show(box.dataset.mode || 'auto')

    for (const tab of box.querySelectorAll('[data-q]')) {
      tab.onclick = () => show(tab.dataset.q)
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
          ...(driven
            ? { sql: link.sql }
            : {
                table: link.table,
                column: link.col,
                ...(link.keyCol && link.keyVal ? { keyColumn: link.keyCol, keyValue: link.keyVal } : {}),
                ...(link.tcol ? { timeColumn: link.tcol } : {}),
              }),
        })

        // The statement the server actually ran, in place of ours.
        if (answer?.query) {
          shown.textContent = answer.query +
            (answer.params?.length ? `    — with ? = ${answer.params.join(', ')}` : '')
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

    go.onclick = () => (box.dataset.mode === 'own' ? runOwn() : readNow())
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
      '<label class="ix-f dl-link-orderf">Newest by<select class="dl-link-order"></select></label>'

    const tableSelect = row.querySelector('.dl-link-table')
    const columnSelect = row.querySelector('.dl-link-col')
    const columnField = row.querySelector('.dl-link-colf')
    const orderSelect = row.querySelector('.dl-link-order')
    const orderField = row.querySelector('.dl-link-orderf')

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
    }
    fillColumns()

    orderSelect.onchange = () => {
      const link = tag.link
      if (!link) return
      if (orderSelect.value) link.tcol = orderSelect.value
      else delete link.tcol
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

      if (table.key && !registered(link.src)) {
        link.keyCol = table.key
        link.keyVal = had.keyVal || document.querySelector('#props #ixName')?.value || ''
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
