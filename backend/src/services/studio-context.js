/**
 * The customer context the studio reads before it starts.
 *
 * v6.8 of the studio takes who is logged in, and that customer's default
 * database, from `window.SANDMAN_CONTEXT` — read once as the app's first
 * script runs. Our session lives in a cookie, so the server knows all of it at
 * the moment it serves the page: the context is written into the HTML rather
 * than fetched afterwards.
 *
 * That ordering matters. The alternative the studio offers,
 * `SandmanStudio.setCustomerContext()`, reloads the page when the customer id
 * changes — and since nothing would have set the context by the time the
 * reloaded page ran, it would change again, and reload again. Injection is the
 * only way in that does not loop.
 *
 * What goes in it:
 *   customer   the foundry from the session. The studio namespaces its browser
 *              storage by this id, so two foundries on one terminal never see
 *              each other's work.
 *   defaultDb  the foundry's database — the name and, as `schema`, its tables
 *              and columns. Names only. Nothing here is a credential and
 *              nothing opens a connection; it is the list the studio's
 *              Database → Table → Tag flow is built from.
 */

/** Columns the studio should not offer as a reading: it filters on these. */
const TEXTUAL = /^(char|varchar|nchar|nvarchar|text|tinytext|mediumtext|longtext|enum|set|uuid|json|blob|binary)/i
const TEMPORAL = /^(date|datetime|timestamp|time|year)/i
const INTEGRAL = /^(tinyint|smallint|mediumint|int|integer|bigint|bit|serial)/i

/**
 * Our column type → the studio's.
 *
 * It offers a column as a tag only when the type is none of 'datetime',
 * 'varchar' or 'tag', so this decides what a person can actually pick. Getting
 * it wrong in one direction hides a real reading; in the other it offers a
 * timestamp as a measurement.
 */
function columnType(type) {
  const raw = String(type || '').trim()
  if (!raw) return 'float'
  if (TEMPORAL.test(raw)) return 'datetime'
  if (TEXTUAL.test(raw)) return 'varchar'
  if (INTEGRAL.test(raw)) return 'int'
  return 'float'
}

/**
 * The table list, in the shape the studio's catalogue expects:
 * `{ name, key, cols: [{ n, t }] }`.
 *
 * `key` is the row filter — the column that says which machine a row belongs
 * to. The first textual column is the best guess available from names alone,
 * and the studio lets somebody correct it per reading.
 */
function schemaFor(database) {
  return (database?.tables || []).map(table => {
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
}

/** The whole context, from a session. */
export function studioContext(user) {
  const database = user.database
  return {
    customer: { id: String(user.foundry.id), name: user.foundry.name },
    user: { name: user.name || user.sandmanUserId },
    defaultDb: {
      name: database?.name ? `${user.foundry.name} database` : 'No database from SandMan',
      // SandMan's foundry databases are MySQL. The studio only uses this to
      // label the source; it never connects.
      type: 'mysql',
      host: '',
      db: database?.name || '',
      schema: schemaFor(database),
    },
  }
}

/**
 * The context as a `<script>` tag.
 *
 * `<` is escaped so a foundry or table named `</script>` cannot end the tag
 * and start running as markup. JSON has no other way out of a script element.
 */
export function contextScript(user) {
  const json = JSON.stringify(studioContext(user)).replaceAll('<', '\\u003c')
  return `<script>window.SANDMAN_CONTEXT = ${json};</script>`
}
