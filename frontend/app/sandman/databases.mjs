import { api } from './api.mjs'
import { peek } from './studio.mjs'

/**
 * Which databases a reading may be linked to.
 *
 * Two kinds, and they arrive by completely different routes:
 *
 *   the foundry's own   named in SandMan's launch, with its tables and
 *                       columns. Never connected to by this service — SandMan
 *                       reads it. Shown as "★ Customer default".
 *   ones somebody added an administrator registered it in Digital Loop, which
 *                       holds its host, account and password and dials out
 *                       itself, through an SSH tunnel where one is set.
 *
 * The studio's own list is neither. It ships three invented servers — a PLC
 * gateway, a SQL box and a LIMS — with a hardcoded schema behind them, so the
 * editor can be demonstrated on its own. Those are the ones that had to go:
 * `sources()` wrote them into every saved document, and a reading linked to
 * one got the same green chip as a reading from the plant.
 *
 * **Emptying that list took the real ones with it** — a database somebody
 * registered had no way to appear either — so this puts both back. The demo
 * servers stay, because they are what makes the editor demonstrable before a
 * plant has registered anything; the registered databases join them, with
 * their real tables and columns rather than the hardcoded schema.
 *
 * What a reading is actually getting a number from is then said plainly on its
 * chip, in `live.mjs`: Live from the foundry's database, Demo from one of the
 * shipped servers, or not read yet from a registered one.
 */

/** Our engines, in the studio's vocabulary. It groups MySQL and MariaDB. */
const STUDIO_TYPE = {
  mysql: 'mysql',
  mariadb: 'mysql',
  postgres: 'postgres',
  sqlserver: 'mssql',
  azuresql: 'mssql',
}

/** `conn_<id>` — a source id that cannot collide with the studio's own. */
export const sourceIdFor = connection => `conn_${connection.id}`
export const connectionIdFrom = sourceId =>
  (typeof sourceId === 'string' && sourceId.startsWith('conn_') ? sourceId.slice(5) : null)

/** The registered databases, as the studio's source list wants them. */
let registered = []

/** connectionId → tables, once fetched. `null` while the fetch is in flight. */
const schemas = new Map()

const studioSource = connection => ({
  id: sourceIdFor(connection),
  name: connection.label,
  type: STUDIO_TYPE[connection.engine] || 'mysql',
  host: connection.host,
  port: connection.port,
  db: connection.database,
  user: connection.username,
  poll: 5,
  timeout: 10,
  /** Ours, not one of the studio's demo servers. Used by `catalog()` below. */
  digitalLoop: true,
  engine: connection.engine,
  connectionId: connection.id,
})

/**
 * Load the list once, at boot.
 *
 * Only an administrator may list them — the labels are harmless but the
 * endpoint is theirs — so for an operator this stays empty, which is right:
 * an operator picks nothing. What they see is decided by the stored layout.
 */
export async function load() {
  try {
    const list = await api.get('/connections')
    registered = (Array.isArray(list) ? list : []).map(studioSource)
  } catch {
    // An operator gets 403, and a failure here should leave the studio usable
    // with the foundry's own database rather than refusing to open.
    registered = []
  }
  return registered
}

/** The tables of one registered database, fetched the first time it is asked for. */
function schemaOf(source, onLoaded) {
  const id = source.connectionId
  if (schemas.has(id)) return schemas.get(id)

  schemas.set(id, null)
  api.get(`/connections/${encodeURIComponent(id)}/schema`)
    .then(answer => {
      /*
       * Into the shape the studio's catalogue uses: `{ name, key, cols }`,
       * where `key` is the row filter — the column that says which machine a
       * row belongs to. The first text column is the only guess available
       * from names alone, which is the same guess the foundry's own schema
       * gets, and the studio lets somebody correct it per reading.
       */
      const tables = (answer.tables || []).map(table => {
        const cols = (table.columns || []).map(column => ({
          n: column.name,
          t: columnType(column.type),
        }))
        return {
          name: table.name,
          key: cols.find(column => column.t === 'varchar')?.n || '',
          cols,
        }
      })
      schemas.set(id, tables)
      onLoaded?.()
    })
    .catch(() => {
      schemas.set(id, [])
      onLoaded?.()
    })

  return null
}

/** A database type, in the studio's three categories. Mirrors studio-context.js. */
const TEXTUAL = /^(char|varchar|nchar|nvarchar|text|tinytext|mediumtext|longtext|enum|set|uuid|json|blob|binary|bytea|character)/i
const TEMPORAL = /^(date|datetime|timestamp|time|year|interval)/i
const INTEGRAL = /^(tinyint|smallint|mediumint|int|integer|bigint|bit|serial|numeric|decimal)/i

function columnType(type) {
  const raw = String(type || '').trim()
  if (!raw) return 'float'
  if (TEMPORAL.test(raw)) return 'datetime'
  if (TEXTUAL.test(raw)) return 'varchar'
  if (INTEGRAL.test(raw)) return 'int'
  return 'float'
}

/* ------------------------------------------------------------ the wiring ---*/

/**
 * `sources()` — the studio's demo servers, plus the databases that exist.
 *
 * The demo servers stay: they are what makes the editor demonstrable before a
 * plant has registered anything, and a loop can be drawn and shown with them.
 * What they must not do is look like the plant — a reading linked to one is
 * marked Demo, in `live.mjs`, rather than getting the same green pill as a
 * real one.
 *
 * `DEF_SOURCES` is read directly rather than by calling the original, because
 * the original's first act is to copy that list into `DOC.sources` — which is
 * how three fictional servers ended up saved inside real plants' designs. This
 * returns a fresh array each time and seeds nothing.
 */
function replaceSources() {
  const original = window.sources
  if (typeof original !== 'function' || original.__dlDatabases) return

  const replaced = function sourcesWithRegisteredDatabases() {
    /*
     * The shipped demo servers are not returned at all.
     *
     * They exist to demonstrate the editor on its own, and here they are the
     * thing that makes a plant screen untrustworthy: a reading linked to one
     * shows an invented number that looks exactly like a measured one. The
     * foundry's database — added by `dbList()` from the launch — and anything
     * an administrator registered are the only places a reading can come from.
     */
    return registered
  }
  replaced.__dlDatabases = true
  replaced.original = original
  window.sources = replaced
}

/**
 * `catalog()` — real tables for a registered database.
 *
 * The studio's own version answers from a hardcoded schema for anything it
 * does not recognise as the customer's. That is fine for a demo server and
 * wrong for a database somebody actually registered, so ours is asked first
 * and the original is left to handle everything else.
 */
function replaceCatalog() {
  const original = window.catalog
  if (typeof original !== 'function' || original.__dlDatabases) return

  const replaced = function catalogForRegisteredDatabases(source) {
    if (!source?.digitalLoop) return original.call(this, source)

    const tables = schemaOf(source, () => window.renderProps?.())
    return [{
      name: source.db,
      label: 'Database',
      // Null while the tables are still being read. An empty list is what the
      // studio shows as "this database has no tables", which would be a lie
      // for a database that simply has not answered yet.
      tables: (tables || []).map(table => ({ ...table, label: 'Table' })),
      loading: tables === null,
    }]
  }
  replaced.__dlDatabases = true
  replaced.original = original
  window.catalog = replaced
}

/* ------------------------------------------- the link wizard's first step ---*/

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/**
 * `dbList()` — the Add reading flow's Database menu: the data sources, only.
 *
 * The studio writes "★ Customer default · <db>" into that menu itself, from
 * `CUSTOMER.defaultDb`, ahead of everything `sources()` offers. It is there
 * whether or not the plant reads from that database, and it could not be taken
 * off the Data sources page because it was never on it — which left the two
 * lists disagreeing: the page offers the databases somebody registered, and
 * the menu offered those plus one more that nothing on the page mentions. Two
 * answers to "where can this reading come from?" is one too many, and the
 * extra one is the one nobody can configure.
 *
 * So the menu is the registered data sources and nothing else — no exception,
 * including for a reading already linked to the foundry's database. That
 * reading goes on reading: `linkedTags` on the server works from the stored
 * link, which this does not touch, and the reading's own Source box still
 * names it (see `hideSourceManagement` in live.mjs, which keeps the entry
 * exactly where it is the one selected). What changes is only what a *new*
 * reading may be pointed at.
 */
function narrowTheFlowsDatabases() {
  const original = window.dbList
  if (typeof original !== 'function' || original.__dlNoFixedCustomer) return

  const replaced = function dbListWithoutTheFixedEntry() {
    const list = original.apply(this, arguments)
    return Array.isArray(list) ? list.filter(entry => !entry?.cust) : list
  }

  replaced.__dlNoFixedCustomer = true
  replaced.original = original
  window.dbList = replaced
}

/**
 * The foundry's own database, in the wizard that opens after placing
 * equipment.
 *
 * "Where does this equipment's data live?" lists `sources()`, which is the
 * registered databases and nothing else — the foundry's own is not in that
 * list anywhere in the studio. It has its own card on the Data sources page,
 * its own entry in the inspector's dropdown and its own branch in `catalog()`,
 * but in this wizard it simply was not offered: a plant that had registered
 * nothing saw an empty box and no way forward except "Add or manage data
 * sources", for a database it had already been given.
 *
 * The studio understands the source id `customer` everywhere else — `SRC()`
 * resolves it through `customerSource()` — so the card added here is the one
 * the wizard would have drawn if the list had included it.
 */
function offerTheFoundryDatabase() {
  const original = window.lwRender
  if (typeof original !== 'function' || original.__dlCustomer) return

  const replaced = function lwRenderWithTheFoundryDatabase() {
    const answer = original.apply(this, arguments)
    try {
      addFoundryCard()
      storeWhatItLinks()
    } catch (error) {
      // The wizard is drawn either way; without the card it is what it was.
      console.error('Offering the foundry database failed:', error)
    }
    return answer
  }

  replaced.__dlCustomer = true
  replaced.original = original
  window.lwRender = replaced
}

function addFoundryCard() {
  const wizard = peek('LW')
  if (!wizard || wizard.step !== 1) return

  const grid = document.querySelector('#mbox .src-g')
  if (!grid || grid.querySelector('[data-dl-foundry]')) return

  const source = window.customerSource?.()
  if (!source) return

  const chosen = wizard.src === 'customer'
  const card = document.createElement('label')
  card.className = `src pick ${chosen ? 'on' : ''}`
  card.dataset.dlFoundry = '1'
  card.innerHTML =
    `<input type="radio" name="lwS" value="customer"${chosen ? ' checked' : ''}>` +
    '<div class="src-h"><span class="src-i">★</span><div style="min-width:0">' +
    `<b>${escapeHtml(source.name)}</b>` +
    '<div class="note mono" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
    `${escapeHtml(source.host)} · ${escapeHtml(source.db)}</div></div></div>`

  // First, because it is the one most readings come from.
  grid.prepend(card)

  card.querySelector('input').onchange = () => {
    Object.assign(wizard, { src: 'customer', db: null, table: null, keyCol: '' })
    window.lwRender?.()
  }
}

/**
 * Save links means save links.
 *
 * The wizard's last step writes `link` onto each reading and calls `changed()`
 * — the studio's own save, which is deliberately discarded here because
 * designs live on the server. Linking is the one change that has to reach it
 * anyway: the stored layout is the only thing `/live/values` reads, so a link
 * made here and not stored is a reading that shows nothing after a reload.
 */
function storeWhatItLinks() {
  const save = document.getElementById('lwSave')
  if (!save || save.dataset.dlStores) return
  save.dataset.dlStores = '1'

  const studioHandler = save.onclick
  save.onclick = event => {
    const answer = studioHandler?.call(save, event)
    linked?.()
    return answer
  }
}

/** Told when the wizard has linked readings, so they can be stored. */
let linked = null

/** Wrap once, then load. Safe to call again. */
export async function install({ onLinked } = {}) {
  if (typeof onLinked === 'function') linked = onLinked
  replaceSources()
  replaceCatalog()
  narrowTheFlowsDatabases()
  offerTheFoundryDatabase()
  await load()
  // The properties panel may already be open on an equipment item.
  window.renderProps?.()
}

/** What is on offer, for the tests and for looking at this from a console. */
export const status = () => ({
  registered: registered.map(source => ({
    id: source.id, name: source.name, engine: source.engine, db: source.db,
  })),
  schemasLoaded: [...schemas.entries()]
    .filter(([, tables]) => tables)
    .map(([id, tables]) => ({ id, tables: tables.length })),
  customerDb: peek('CUSTOMER')?.defaultDb?.db || null,
})
