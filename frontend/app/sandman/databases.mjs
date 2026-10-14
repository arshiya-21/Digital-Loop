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

/** Wrap once, then load. Safe to call again. */
export async function install() {
  replaceSources()
  replaceCatalog()
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
