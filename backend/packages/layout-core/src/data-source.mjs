/**
 * Where a reading comes from: a table and a column in the foundry's database.
 *
 * SandMan sends the launching user's foundry database with the launch — its
 * name and every table and column in it, names only. Tagging a piece of
 * equipment is then choosing from that list rather than typing a string and
 * hoping, and what gets stored on the label is both the tag it produces
 * ("preparedsand.moisture") and the source it came from, so a design can still
 * say where a number was meant to come from long after the session is gone.
 *
 * **No credentials are involved and nothing here opens a connection.** This is
 * a description of a database, not access to one: Digital Loop never connects
 * to SandMan's MySQL, and the browser never connects to anything but this API.
 *
 * The caps exist because this ends up inside a layout document that is stored
 * and served back. A design carrying a megabyte of table names in one field
 * would be nobody's intention.
 */

export const DATA_SOURCE_LIMITS = {
  database: 128,
  table: 128,
  column: 128,
  type: 64,
}

const str = (value, max) => typeof value === 'string' && value.length <= max

/**
 * Is this not a usable data source? True when it is unusable — the shape the
 * validators want, so they read `if (badDataSource(x)) throw`.
 *
 * `table` and `column` are required: a source naming neither is not a source,
 * it is an empty object somebody left behind. `database` and `type` are what
 * the catalogue said at the time and are allowed to be missing, because a
 * design may outlive the schema it was drawn against.
 */
export function badDataSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return true

  const required =
    str(source.table, DATA_SOURCE_LIMITS.table) && source.table.trim() !== '' &&
    str(source.column, DATA_SOURCE_LIMITS.column) && source.column.trim() !== ''
  if (!required) return true

  const optional =
    (source.database === undefined || str(source.database, DATA_SOURCE_LIMITS.database)) &&
    (source.type === undefined || str(source.type, DATA_SOURCE_LIMITS.type))
  return !optional
}

/** The data tag a source produces: "<table>.<column>". Empty when there is none. */
export const dataSourceTag = source =>
  source && source.table && source.column ? `${source.table}.${source.column}` : ''

/** Keep only the four fields, trimmed and capped. Null when unusable. */
export function cleanDataSource(source) {
  if (badDataSource(source)) return null
  const cut = (value, max) => String(value).trim().slice(0, max)
  return {
    ...(source.database ? { database: cut(source.database, DATA_SOURCE_LIMITS.database) } : {}),
    table: cut(source.table, DATA_SOURCE_LIMITS.table),
    column: cut(source.column, DATA_SOURCE_LIMITS.column),
    ...(source.type ? { type: cut(source.type, DATA_SOURCE_LIMITS.type) } : {}),
  }
}
