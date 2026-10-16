import { db, now, audit } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { requireAdmin } from '../middleware/auth.js'
import { badRequest } from '../utils/errors.js'

/**
 * `/api/v1/table-visibility` — which tables a database offers.
 *
 * A plant database has far more tables than anybody links readings to, and the
 * *Add reading* dropdown was showing all of them. This is where somebody says
 * which ones are worth offering, per database.
 *
 * Two shapes of scope, and nothing else is accepted:
 *
 *   customer:<foundryId>   the foundry's own database, which differs per plant
 *   conn:<connectionId>    one somebody registered, shared across plants
 *
 * **No row means every table.** That is the difference between "nobody has
 * narrowed this" and "somebody narrowed it to nothing", and conflating the two
 * would turn a database nobody has configured into one with no tables at all.
 * Saving an empty selection therefore deletes the row rather than storing `[]`.
 *
 * Reading is open to any authenticated user because the dropdowns are built
 * from it; writing is administrator-only, like the connections themselves.
 * Nothing here reaches a database — these are names the browser already has.
 */

export const tableVisibility = createRouter()

/** Names only, and bounded: this is written straight into a dropdown. */
const MAX_TABLES = 500
const NAME = /^[\w$ .-]{1,128}$/

/**
 * `customer:<foundry>` or `conn:<id>`.
 *
 * Validated rather than accepted, because the scope is the primary key: an
 * unchecked string would let one caller write a row that another reads under a
 * name it never set.
 */
const SCOPE = /^(customer:[\w.-]{1,120}|conn:[\w-]{1,120})$/

function readScope(raw) {
  const scope = String(raw || '').trim()
  if (!SCOPE.test(scope)) {
    throw badRequest(
      'invalid_scope',
      'A scope is "customer:<foundry>" or "conn:<connectionId>".'
    )
  }
  return scope
}

const parse = row => {
  try {
    const list = JSON.parse(row.tables)
    return Array.isArray(list) ? list : []
  } catch {
    // A row that cannot be parsed is a row that cannot be honoured; showing
    // every table is the safe reading of it.
    return []
  }
}

/**
 * Everything set, as a map.
 *
 * One request rather than one per database: the browser needs all of them to
 * build the panel, and a plant with eight registered databases would otherwise
 * open nine connections to answer a question about names.
 */
tableVisibility.get('/', async () => {
  const rows = await db.prepare('SELECT * FROM table_filter').all()
  const out = {}
  for (const row of rows) out[row.scope] = parse(row)
  return out
})

/**
 * Narrow a database to these tables, or widen it again.
 *
 * An empty list removes the row — see the note above about what "no row" means.
 */
tableVisibility.put('/:scope', async ({ user, params, body }) => {
  requireAdmin(user)
  const scope = readScope(params.scope)

  if (!Array.isArray(body?.tables)) {
    throw badRequest('invalid_field', '"tables" must be an array of table names.')
  }
  if (body.tables.length > MAX_TABLES) {
    throw badRequest('invalid_field', `No more than ${MAX_TABLES} tables.`)
  }

  // Trimmed, de-duplicated, and each one a plausible table name.
  const tables = [...new Set(body.tables.map(name => String(name).trim()).filter(Boolean))]
  for (const name of tables) {
    if (!NAME.test(name)) throw badRequest('invalid_field', `"${name}" is not a table name.`)
  }

  if (!tables.length) {
    await db.prepare('DELETE FROM table_filter WHERE scope = ?').run(scope)
    await audit(user.id, 'tables.show_all', 'database', scope, {})
    return { scope, tables: null }
  }

  await db.prepare(
    `INSERT INTO table_filter (scope, tables, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE tables = VALUES(tables), updated_by = VALUES(updated_by),
                             updated_at = VALUES(updated_at)`
  ).run(scope, JSON.stringify(tables), user.id, now())

  // How many, not which: a list of a plant's table names in every audit row
  // would drown the log it is meant to make readable.
  await audit(user.id, 'tables.narrow', 'database', scope, { count: tables.length })
  return { scope, tables }
})
