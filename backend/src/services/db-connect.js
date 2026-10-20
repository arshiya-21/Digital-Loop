import { createServer } from 'node:net'
import { once } from 'node:events'

import { Client as SshClient } from 'ssh2'
import mysql from 'mysql2/promise'
import mssql from 'mssql'
import pg from 'pg'

import { open as unseal } from './secrets.js'

/**
 * Reaching a plant database that somebody registered.
 *
 * ⚠ This is the one place where Digital Loop opens an outbound database
 * connection. The foundry's own database — the one SandMan describes in the
 * launch — is never connected to; this is for databases an administrator added
 * by hand, which was asked for deliberately.
 *
 * Two rules hold it in:
 *
 *   1. **Metadata only.** Every statement in this file reads
 *      `information_schema`. Nothing selects from a plant table, so a
 *      compromised studio cannot be turned into a query console. When live
 *      values arrive they will come through SandMan, not through here.
 *   2. **Nothing stays open.** A connection is made for one question and
 *      closed in a `finally`, tunnel included. There is no pool: this runs
 *      when somebody presses Test or refreshes a table list, which is rare
 *      enough that holding sockets open to a plant network is not worth it.
 *
 * Timeouts are short on purpose. A wrong host should say so in a few seconds,
 * not leave somebody watching a spinner.
 */

const CONNECT_TIMEOUT_MS = 8000
const QUERY_TIMEOUT_MS = 15000
const SSH_READY_TIMEOUT_MS = 20000

/** Caps, so one enormous schema cannot fill a response or a browser. */
const LIMITS = { tables: 5000, columnsTotal: 200000 }

/**
 * A local port that forwards to the database through the jump box.
 *
 * A plain local port forward rather than handing the driver an SSH stream:
 * mysql2 and tedious each have their own idea of how to accept a socket, and a
 * listener on 127.0.0.1 is something both already know how to dial.
 */
async function openTunnel(row) {
  const ssh = new SshClient()
  const privateKey = unseal(row.tunnel_private_key)
  if (!privateKey) {
    throw new Error(
      'This connection is set to use an SSH tunnel but has no private key. ' +
      'Paste the key file, or generate one and install its public half on the tunnel server.'
    )
  }

  await new Promise((resolve, reject) => {
    const fail = error => reject(new Error(`The jump box refused the connection: ${error.message}`))
    ssh.once('ready', resolve)
    ssh.once('error', fail)
    ssh.connect({
      host: row.tunnel_host,
      port: row.tunnel_port || 22,
      username: row.tunnel_user,
      privateKey,
      /*
       * Only when there is one. `ssh2` treats an empty passphrase as an
       * attempt to decrypt, so passing '' for an unencrypted key fails with a
       * message about the key being malformed rather than about the passphrase.
       */
      passphrase: unseal(row.tunnel_passphrase) || undefined,
      /*
       * Longer than the database's own timeout. A jump box across the
       * internet routinely takes several seconds to finish the SSH handshake,
       * and at 8 s a busy moment failed the whole poll with "Timed out while
       * waiting for handshake" — for a reading that answered fine a poll later.
       */
      readyTimeout: SSH_READY_TIMEOUT_MS,
    })
  })

  const server = createServer(socket => {
    ssh.forwardOut('127.0.0.1', 0, row.host, row.port, (error, stream) => {
      if (error) {
        socket.destroy()
        return
      }
      socket.pipe(stream).pipe(socket)
      stream.once('error', () => socket.destroy())
      socket.once('error', () => stream.destroy())
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    host: '127.0.0.1',
    port: server.address().port,
    close() {
      server.close()
      ssh.end()
    },
  }
}

/** Where to dial: the jump box's local end, or the database itself. */
async function route(row) {
  if (row.tunnel_host) return openTunnel(row)
  return { host: row.host, port: row.port, close() {} }
}

/* ------------------------------------------------------------- the engines ---*/

async function askMysql(row, where, question) {
  const connection = await mysql.createConnection({
    host: where.host,
    port: where.port,
    user: row.username,
    password: unseal(row.password) || '',
    database: row.database_name,
    connectTimeout: CONNECT_TIMEOUT_MS,
    // Metadata only, so there is nothing here that needs several statements.
    multipleStatements: false,
    ...(row.use_tls ? { ssl: { rejectUnauthorized: false } } : {}),
  })
  try {
    return await question({
      query: async (sql, values) =>
        (await connection.query({ sql, timeout: QUERY_TIMEOUT_MS, values: values || [] }))[0],
    })
  } finally {
    await connection.end().catch(() => {})
  }
}

async function askSqlServer(row, where, question) {
  const pool = new mssql.ConnectionPool({
    server: where.host,
    port: where.port,
    user: row.username,
    password: unseal(row.password) || '',
    database: row.database_name,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    requestTimeout: QUERY_TIMEOUT_MS,
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
    options: {
      encrypt: !!row.use_tls,
      // A plant historian on a private network routinely has a self-signed
      // certificate. Demanding a public CA would mean nobody could connect;
      // the tunnel is what provides the confidentiality when it matters.
      trustServerCertificate: true,
    },
  })
  await pool.connect()
  try {
    return await question({
      query: async (sql, values) => {
        const request = pool.request()
        // `@p1`, `@p2`… to match `DIALECT.sqlserver.param`.
        ;(values || []).forEach((value, index) => request.input(`p${index + 1}`, value))
        return (await request.query(sql)).recordset
      },
    })
  } finally {
    await pool.close().catch(() => {})
  }
}

async function askPostgres(row, where, question) {
  const client = new pg.Client({
    host: where.host,
    port: where.port,
    user: row.username,
    password: unseal(row.password) || '',
    database: row.database_name,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
    /*
     * Same reasoning as SQL Server: a plant database on a private network
     * usually has a self-signed certificate, and refusing it would mean
     * nobody could connect at all. Where confidentiality actually matters
     * the SSH tunnel is what provides it.
     */
    ...(row.use_tls ? { ssl: { rejectUnauthorized: false } } : {}),
  })
  await client.connect()
  try {
    return await question({ query: async (sql, values) => (await client.query(sql, values || [])).rows })
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * The engines, and what each one is underneath.
 *
 *   mariadb    MySQL's wire protocol — mysql2 speaks to it unchanged
 *   azuresql   SQL Server, reached over the public internet
 *
 * They are separate entries rather than aliases because what somebody has to
 * fill in differs: Azure always needs TLS and a `user@server` login, and
 * MariaDB's default port is MySQL's. Offering the name people actually use is
 * the difference between a setting they recognise and one they have to
 * translate.
 */
const ENGINES = {
  mysql: askMysql,
  mariadb: askMysql,
  postgres: askPostgres,
  sqlserver: askSqlServer,
  azuresql: askSqlServer,
}

/**
 * How each engine spells the three things a value query needs.
 *
 *   quote   an identifier, so a column called `order` or `index` still works
 *   param   a placeholder, so a value is never spliced into SQL
 *   one     "just the newest row", which SQL Server puts at the front
 *
 * Quoting is belt and braces: every name reaching it has already been matched
 * against `information_schema`, so it is one the database has. Both together
 * is the right amount for the only code here that touches a plant table.
 */
const DIALECT = {
  mysql: {
    quote: name => `\`${String(name).replaceAll('`', '``')}\``,
    param: () => '?',
    one: sql => `${sql} LIMIT 1`,
  },
  postgres: {
    quote: name => `"${String(name).replaceAll('"', '""')}"`,
    param: index => `$${index}`,
    one: sql => `${sql} LIMIT 1`,
  },
  sqlserver: {
    quote: name => `[${String(name).replaceAll(']', ']]')}]`,
    param: index => `@p${index}`,
    one: sql => sql.replace(/^SELECT /, 'SELECT TOP 1 '),
  },
}
DIALECT.mariadb = DIALECT.mysql
DIALECT.azuresql = DIALECT.sqlserver

/** Open whatever this row describes, ask one question, and close everything. */
async function ask(row, question) {
  const engine = ENGINES[row.engine]
  if (!engine) throw new Error(`"${row.engine}" is not a database engine this understands.`)

  const where = await route(row)
  try {
    return await engine(row, where, question)
  } finally {
    where.close()
  }
}

/* --------------------------------------------------------------- the asks ---*/

const VERSION_SQL = {
  mysql: 'SELECT VERSION() AS version',
  mariadb: 'SELECT VERSION() AS version',
  postgres: 'SELECT version() AS version',
  sqlserver: 'SELECT @@VERSION AS version',
  azuresql: 'SELECT @@VERSION AS version',
}

/**
 * The newest record of each reading, from a registered database.
 *
 * ⚠ **The only thing in this file that reads a plant table.** Everything else
 * asks `information_schema` and nothing else, which is what kept a compromised
 * studio from becoming a query console. This is the deliberate exception, and
 * it is built so that it cannot become one either:
 *
 *   - `wanted` comes from the **layout stored on the server**, never from a
 *     request. A browser cannot name a table; it can only ask for the loop it
 *     is already allowed to open — see `routes/live.js`.
 *   - Every table and column is checked against the live schema first. A name
 *     that is not in `information_schema` is dropped with a reason, never
 *     interpolated.
 *   - What survives that is quoted for the engine, and the row filter's
 *     **value** is a bound parameter, never text in the statement.
 *   - One row per reading, newest first. There is no way to ask for more.
 *
 * A reading whose table or column has since been dropped is an error against
 * that reading, not a failure of the whole poll: one renamed column must not
 * blank a screen full of good ones.
 */
/**
 * A number as a number, text as text.
 *
 * `DECIMAL`, `NUMERIC` and `BIGINT` arrive from mysql2 and pg as **strings**,
 * because they can hold values a JavaScript number cannot. A plant reading is
 * a measurement, and the studio only accepts a number — so a column typed
 * `DECIMAL(10,2)`, which is how most of them are, produced a reading that
 * stayed blank with nothing saying why.
 *
 * Converted only when the whole string is a number. A batch code of `0012` is
 * text and stays text; so does anything that merely starts with a digit.
 */
function readable(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()

  const text = String(value).trim()
  if (text && Number.isFinite(Number(text))) return Number(text)
  return text
}

/** When a record was taken, in a form every reader agrees on. */
function moment(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
}

export async function latestValues(row, wanted) {
  const out = { values: {}, errors: {} }
  if (!Array.isArray(wanted) || !wanted.length) return out

  const dialect = DIALECT[row.engine]
  if (!dialect) throw new Error(`"${row.engine}" is not a database engine this understands.`)

  // One schema for the whole batch, and usually a remembered one — see
  // `schemaFor`. A poll of twenty readings is one schema read at most.
  const tables = await tablesFor(row, wanted)

  const usable = []
  for (const tag of wanted) {
    const columns = tables.get(tag.table)
    if (!columns) { out.errors[tag.id] = `There is no table "${tag.table}" in this database.`; continue }
    if (!columns.has(tag.column)) { out.errors[tag.id] = `There is no column "${tag.column}" in "${tag.table}".`; continue }
    if (tag.keyColumn && !columns.has(tag.keyColumn)) {
      out.errors[tag.id] = `There is no column "${tag.keyColumn}" in "${tag.table}".`
      continue
    }
    // An ordering column that no longer exists is not fatal: without it the
    // newest row is whatever the database returns first, which is still a
    // reading, and saying so in an error would blank a working one.
    const time = tag.timeColumn && columns.has(tag.timeColumn) ? tag.timeColumn : null
    usable.push({ ...tag, time })
  }
  if (!usable.length) return out

  await ask(row, async ({ query }) => {
    for (const tag of usable) {
      const filtered = !!(tag.keyColumn && tag.keyValue)
      const select = `SELECT ${dialect.quote(tag.column)} AS value` +
        (tag.time ? `, ${dialect.quote(tag.time)} AS at` : '')
      const from = ` FROM ${dialect.quote(tag.table)}`
      const where = filtered ? ` WHERE ${dialect.quote(tag.keyColumn)} = ${dialect.param(1)}` : ''
      const order = tag.time ? ` ORDER BY ${dialect.quote(tag.time)} DESC` : ''

      try {
        const rows = await query(dialect.one(select + from + where + order), filtered ? [tag.keyValue] : [])
        const first = Array.isArray(rows) ? rows[0] : null
        out.values[tag.id] = first
          ? { value: readable(first.value), recordedAt: moment(first.at) }
          : null
        if (!first) {
          // Naming the filter, because a filter matching nothing is by far
          // the likeliest reason a table full of rows answers with none —
          // and "no rows yet" sent people looking at the database instead.
          out.errors[tag.id] = filtered
            ? `No rows where "${tag.keyColumn}" = "${tag.keyValue}".`
            : `"${tag.table}" has no rows.`
        }
      } catch (error) {
        // The driver's message, trimmed. It names the table and column, which
        // is what somebody needs — and never the password, which is not
        // interpolated anywhere above.
        out.errors[tag.id] = String(error?.message || 'That column could not be read.').slice(0, 200)
      }
    }
  })

  return out
}

/** The most a chart is given, however many rows the table holds. */
const MAX_POINTS = 500

/**
 * The recent records of one reading, oldest last, for its chart.
 *
 * The same read as `latestValues` with the limit lifted and the order kept,
 * and fenced the same way: the table and the column come from the stored
 * layout, both are matched against the live schema before they go anywhere
 * near a statement, and the row filter's value is bound rather than written
 * in.
 *
 * Without an ordering column there is no time series to draw — rows in
 * whatever order the database returns them are not a trend — so that is said
 * rather than guessed at.
 */
export async function recentValues(row, tag, points = 200) {
  const dialect = DIALECT[row.engine]
  if (!dialect) throw new Error(`"${row.engine}" is not a database engine this understands.`)

  const columns = (await tablesFor(row, [tag])).get(tag.table)
  if (!columns) throw new Error(`There is no table "${tag.table}" in this database.`)
  if (!columns.has(tag.column)) throw new Error(`There is no column "${tag.column}" in "${tag.table}".`)

  const time = tag.timeColumn && columns.has(tag.timeColumn) ? tag.timeColumn : null
  if (!time) {
    throw new Error(
      `"${tag.table}" has no date or time column, so its records cannot be put in order.`
    )
  }

  const filtered = !!(tag.keyColumn && columns.has(tag.keyColumn) && tag.keyValue)
  const wanted = Math.min(Math.max(Number(points) || 200, 1), MAX_POINTS)

  const select = `SELECT ${dialect.quote(tag.column)} AS value, ${dialect.quote(time)} AS at`
  const from = ` FROM ${dialect.quote(tag.table)}`
  const where = filtered ? ` WHERE ${dialect.quote(tag.keyColumn)} = ${dialect.param(1)}` : ''
  const order = ` ORDER BY ${dialect.quote(time)} DESC`

  /*
   * The limit is a number this function chose, bounded above, and written into
   * the statement — not a parameter. MySQL and SQL Server both refuse a bound
   * parameter in that position, and a clamped integer is not user input by the
   * time it reaches here.
   */
  const limited = row.engine === 'sqlserver' || row.engine === 'azuresql'
    ? `${select} ${from}${where}${order}`.replace(/^SELECT /, `SELECT TOP ${wanted} `)
    : `${select}${from}${where}${order} LIMIT ${wanted}`

  const rows = await ask(row, async ({ query }) => query(limited, filtered ? [tag.keyValue] : []))

  // Newest first out of the database, oldest first onto a chart.
  return (Array.isArray(rows) ? rows : [])
    .map(record => ({ value: readable(record.value), recordedAt: moment(record.at) }))
    .filter(record => typeof record.value === 'number')
    .reverse()
}

/**
 * Can this be reached at all?
 *
 * Never throws: a failed test is an answer, not an error, and the message is
 * what somebody needs to fix their settings. Driver messages can carry the
 * host and user but never the password, which is not interpolated anywhere.
 */
export async function testConnection(row) {
  try {
    const rows = await ask(row, ({ query }) => query(VERSION_SQL[row.engine]))
    return { ok: true, version: String(rows?.[0]?.version || '').split('\n')[0].trim() }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

const SCHEMA_SQL = {
  mysql: `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  sqlserver: `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d
              FROM INFORMATION_SCHEMA.COLUMNS
              ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  /*
   * Postgres keeps every schema in one database, so this is narrowed to the
   * ones a person put there: 'public' and anything else that is not the
   * server's own. Without that, every connection would come back carrying a
   * few thousand catalogue columns nobody wants to scroll past.
   */
  postgres: `SELECT table_name AS t, column_name AS c, data_type AS d
             FROM information_schema.columns
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
             ORDER BY table_name, ordinal_position`,
}
// Same wire protocol, same catalogue.
SCHEMA_SQL.mariadb = SCHEMA_SQL.mysql
SCHEMA_SQL.azuresql = SCHEMA_SQL.sqlserver

/**
 * The tables and columns, in the same shape SandMan sends for the foundry's
 * own database — so the studio's dropdowns cannot tell the two apart and there
 * is only one code path in the browser.
 */
export async function introspect(row) {
  const rows = await ask(row, ({ query }) => query(SCHEMA_SQL[row.engine]))
  const schema = shapeSchema(row, rows)
  schemas.set(schemaKey(row), { at: Date.now(), schema })
  return schema
}

/**
 * The schema the poll checks names against, kept for a few minutes.
 *
 * Every poll used to introspect first, which is a whole connection of its own:
 * on a database across the internet that is several seconds before the one
 * row it wanted was even asked for, so a reading said "no row yet" for the
 * first fifteen seconds of every open. The check is still made on every read —
 * against a schema at most this old.
 *
 * A name that is missing from the remembered schema is looked up again before
 * it is called missing, so a column added a minute ago is not refused for the
 * rest of the window. Editing the connection changes `updated_at`, which is in
 * the key, so a re-pointed connection never answers from the old schema.
 */
const SCHEMA_TTL_MS = 5 * 60_000
const schemas = new Map()

const schemaKey = row => `${row.id}\u0000${row.updated_at || ''}`

async function schemaFor(row, { fresh = false } = {}) {
  const hit = schemas.get(schemaKey(row))
  if (!fresh && hit && Date.now() - hit.at < SCHEMA_TTL_MS) return { schema: hit.schema, cached: true }
  return { schema: await introspect(row), cached: false }
}

/** Every table name → its column names. */
const columnsByTable = schema =>
  new Map((schema.tables || []).map(table => [table.name, new Set((table.columns || []).map(c => c.name))]))

/** Does the schema have every name this reading needs? */
const knows = (tables, tag) => {
  const columns = tables.get(tag.table)
  return !!columns && columns.has(tag.column) && (!tag.keyColumn || columns.has(tag.keyColumn))
}

/** The tables of a schema, re-read once if a remembered copy lacks a name. */
async function tablesFor(row, tags) {
  const first = await schemaFor(row)
  const tables = columnsByTable(first.schema)
  if (!first.cached || tags.every(tag => knows(tables, tag))) return tables
  return columnsByTable((await schemaFor(row, { fresh: true })).schema)
}

function shapeSchema(row, rows) {
  const byTable = new Map()
  let columns = 0
  for (const record of rows) {
    if (columns >= LIMITS.columnsTotal || byTable.size > LIMITS.tables) break
    if (!byTable.has(record.t)) byTable.set(record.t, [])
    byTable.get(record.t).push({ name: String(record.c), type: String(record.d || '') })
    columns += 1
  }

  return {
    name: row.database_name,
    tables: [...byTable].map(([name, cols]) => ({ name, columns: cols })),
  }
}
