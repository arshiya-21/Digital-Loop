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

/*
 * One tunnel per connection, kept alive between queries.
 *
 * Every `ask` used to open an SSH tunnel and tear it down again. Opening one
 * chart is five or six asks — the readings, the chart, a preview, the schema,
 * and the date-format probes — so a single click paid for five or six SSH
 * handshakes against the same jump box, in parallel. Measured on the plant's
 * own: twenty to twenty-four seconds a request, and the jump box answering
 * "Timed out while waiting for handshake" because several were racing it at
 * once.
 *
 * So the tunnel is opened once and shared. The handshake is paid for by
 * whoever arrives first; everyone after reuses the forward, which is a local
 * socket. It closes itself after a spell of disuse rather than being held
 * open all night, and a tunnel that falls over is dropped so the next caller
 * opens a fresh one.
 */
const tunnels = new Map()

/** How long an unused tunnel is kept before it is closed. */
const TUNNEL_IDLE_MS = 5 * 60_000

/** The settings that decide whether two callers can share one tunnel. */
const tunnelKey = row => [
  row.id, row.tunnel_host, row.tunnel_port, row.tunnel_user, row.host, row.port,
  row.updated_at || '',
].join('\u0000')

function retire(key) {
  const held = tunnels.get(key)
  if (!held) return
  tunnels.delete(key)
  clearTimeout(held.idle)
  try { held.forward.close() } catch { /* already gone */ }
}

/** Where to dial: the jump box's local end, or the database itself. */
async function route(row) {
  if (!row.tunnel_host) return { host: row.host, port: row.port, release() {} }

  const key = tunnelKey(row)
  const held = tunnels.get(key)
  if (held) return lend(key, held)

  /*
   * The promise is cached, not the result.
   *
   * Three requests arriving together is the normal case — values, chart and
   * preview all fire as a trend opens — and caching only the finished tunnel
   * would have all three open their own while the first was still shaking
   * hands, which is the problem this exists to solve.
   */
  const opening = openTunnel(row).then(
    forward => {
      const entry = { forward, lent: 0, idle: null }
      tunnels.set(key, entry)
      return entry
    },
    error => {
      tunnels.delete(key)
      throw error
    }
  )
  tunnels.set(key, opening)

  const entry = await opening
  return lend(key, entry)
}

/**
 * Hand the shared forward to one caller.
 *
 * `release` is what `ask` calls in its `finally`. It does not close anything
 * while another caller still holds it, and starts the idle clock when the
 * last one lets go.
 */
function lend(key, entryOrPromise) {
  return Promise.resolve(entryOrPromise).then(entry => {
    entry.lent += 1
    clearTimeout(entry.idle)
    entry.idle = null

    return {
      host: entry.forward.host,
      port: entry.forward.port,
      release() {
        entry.lent = Math.max(0, entry.lent - 1)
        if (entry.lent > 0) return
        entry.idle = setTimeout(() => retire(key), TUNNEL_IDLE_MS)
        // Node should not be held awake by a tunnel nobody is using.
        entry.idle.unref?.()
      },
      /** A broken tunnel is not worth lending to the next caller. */
      drop() { retire(key) },
    }
  })
}

/* ------------------------------------------------------------- the engines ---*/

/**
 * One pool of MySQL connections per registered database, kept open.
 *
 * Every read used to open a connection and close it again. Beside the server
 * that is a millisecond; through an SSH tunnel to a plant it is a TCP connect
 * and a multi-step handshake — greeting, authentication, acknowledgement —
 * before a single byte of the query is sent, and then the whole thing is torn
 * down so the next read can do it again. At a 40 ms round trip that is a
 * fifth of a second of pure introduction on every poll and every chart.
 *
 * A pool holds the connections open and hands one out, so the handshake
 * happens once and the reads that follow are the query and nothing else. It
 * also queues: two reads arriving together get a connection each rather than
 * fighting over one, which a single kept-alive connection could not do.
 *
 * Keyed on everything that decides where it connects and as whom, with
 * `updated_at` in it — so editing a connection is answered by a new pool
 * rather than by the old one still pointing at the old host.
 */
const pools = new Map()

const poolKey = row => [
  row.id, row.username, row.database_name, row.use_tls ? 'tls' : '', row.updated_at || '',
].join('\u0000')

/** The pools are closed when a connection is edited or removed. */
export async function forgetPools(id = null) {
  for (const [key, pool] of [...pools]) {
    if (id && !key.startsWith(`${id}\u0000`)) continue
    pools.delete(key)
    await pool.end().catch(() => {})
  }
}

function poolFor(row, where) {
  /*
   * The tunnel's local port is in the key as well.
   *
   * A tunnel that drops and is reopened comes back on a different local port,
   * and a pool still pointing at the old one would hand out connections to a
   * port nothing is listening on. Keying on it means a new tunnel is a new
   * pool, and the old one is closed below.
   */
  const key = `${poolKey(row)}\u0000${where.host}:${where.port}`
  const held = pools.get(key)
  if (held) return held

  // A re-pointed connection leaves its old pool behind; close it.
  for (const [old, pool] of [...pools]) {
    if (old.startsWith(`${row.id}\u0000`)) {
      pools.delete(old)
      pool.end().catch(() => {})
    }
  }

  const pool = mysql.createPool({
    host: where.host,
    port: where.port,
    user: row.username,
    password: unseal(row.password) || '',
    database: row.database_name,
    connectTimeout: CONNECT_TIMEOUT_MS,
    /*
     * Small on purpose. These are a plant's own database connections and this
     * service is one of several things using it; four is enough for a poll
     * and a chart at the same time without holding a handful open per loop.
     */
    connectionLimit: 4,
    maxIdle: 2,
    idleTimeout: 60_000,
    waitForConnections: true,
    queueLimit: 32,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    dateStrings: true,
    multipleStatements: false,
    ...(row.use_tls ? { ssl: { rejectUnauthorized: false } } : {}),
  })
  pools.set(key, pool)
  return pool
}

async function askMysql(row, where, question) {
  const pool = poolFor(row, where)
  const connection = await pool.getConnection()

  /*
   * A connection that may be in an odd state is thrown away, not handed on.
   *
   * This matters only because the connection is now reused. A read that
   * failed part-way, or a `ROLLBACK` that did not land, leaves a connection
   * that may still be inside a transaction — and the next caller would
   * inherit it silently, which is the one thing pooling must not cost. One
   * handshake is cheaper than a reader seeing another reader's transaction.
   */
  let spoiled = false
  try {
    return await question({
      query: async (sql, values) =>
        (await connection.query({ sql, timeout: QUERY_TIMEOUT_MS, values: values || [] }))[0],
      discard: () => { spoiled = true },
    })
  } catch (error) {
    spoiled = true
    throw error
  } finally {
    if (spoiled) connection.destroy()
    else connection.release()
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
    /** This many seconds ago, by the database's own clock — never by ours. */
    ago: seconds => `NOW() - INTERVAL ${seconds} SECOND`,
  },
  postgres: {
    quote: name => `"${String(name).replaceAll('"', '""')}"`,
    param: index => `${index}`,
    one: sql => `${sql} LIMIT 1`,
    ago: seconds => `NOW() - INTERVAL '${seconds} seconds'`,
  },
  sqlserver: {
    quote: name => `[${String(name).replaceAll(']', ']]')}]`,
    param: index => `@p${index}`,
    one: sql => sql.replace(/^SELECT /, 'SELECT TOP 1 '),
    ago: seconds => `DATEADD(second, -${seconds}, SYSDATETIME())`,
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
  } catch (error) {
    /*
     * A tunnel that just failed a query is not one to hand to the next
     * caller. Dropping it costs one handshake; keeping a dead forward alive
     * costs every request for the next five minutes.
     */
    where.drop?.()
    throw error
  } finally {
    where.release()
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

  /*
   * An empty cell is no value, not an empty piece of text.
   *
   * Returning `''` made the studio decide the reading was textual — the first
   * record it sees is what settles that — so a numeric column whose newest row
   * happened to be blank became a text reading for good: no chart, no limits,
   * and "This reading is text, so it has no chart" on a column of numbers.
   * `null` is what "the line has no record for this column yet" already means
   * everywhere else, and it is what a blank cell is.
   */
  return text || null
}

/**
 * How a row filter compares, and the only comparisons allowed.
 *
 * The operator comes from the browser, so it is never interpolated into the
 * statement — it is looked up here, and anything not on this list becomes
 * equality. A filter used to be equality only, which answers "this line" and
 * cannot answer "above this batch number" or "anything but the trial line".
 */
const OPERATORS = {
  '=': '=', '!=': '<>', '<>': '<>', '>': '>', '<': '<', '>=': '>=', '<=': '<=',
}
const two = number => String(number).padStart(2, '0')
const comparison = operator => OPERATORS[String(operator || '=').trim()] || '='

/**
 * When a record was taken, in a form every reader agrees on — or nothing.
 *
 * The column this reads is the one the reading is ordered by, and ordering a
 * table newest-first is very often done on its primary key. `ORDER BY id DESC`
 * is a correct way to find the newest row and `id` is not a time, so the value
 * that comes back is an integer.
 *
 * `new Date("19052")` is not an error. JavaScript reads a bare number as a
 * **year**, so the row came back stamped 31 December 19052 — seventeen thousand
 * years from now. The value on the badge was right; the chart was empty,
 * because every point sat outside any window anybody could choose, and the
 * panel said the reading was last recorded in the year 19052.
 *
 * So a moment is only a moment when it lands in a range a plant record can be
 * in: this side of 1970, and no further ahead than a year — enough slack for a
 * clock that is wrong, not enough for a primary key. Anything else is not a
 * time and is reported as not having one, and `momentOf` in the studio then
 * charts the record at the moment it was read, which is the truth about it.
 */
const EARLIEST = Date.UTC(1970, 0, 1)
const LATEST_AHEAD = 366 * 24 * 60 * 60 * 1000

/** `2026-10-22 00:00:00` — a moment with no timezone attached to it. */
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/

function moment(value) {
  if (!value) return null

  /*
   * A naive timestamp is passed through as one.
   *
   * It used to be turned into an ISO instant, which meant deciding what
   * timezone the plant meant — and deciding wrong: `2026-10-22 00:00:00`
   * became `2026-10-21T18:30:00.000Z`, the right instant under a rule nobody
   * had stated and the wrong day beside the same row in Workbench. The column
   * says nothing about zones, so neither does this. The browser reads it as
   * local time, which is the clock the plant floor is on.
   */
  const text = String(value)
  const parts = NAIVE.exec(text)
  if (parts) {
    const year = Number(parts[1])
    if (year < 1970 || year > new Date().getFullYear() + 1) return null
    return `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6] || '00'}`
  }

  const when = value instanceof Date ? value.getTime() : Date.parse(text)
  if (!Number.isFinite(when)) return null
  if (when < EARLIEST || when > Date.now() + LATEST_AHEAD) return null

  return new Date(when).toISOString()
}

/**
 * Run one SELECT against a registered database and give back its rows.
 *
 * This is the one place a statement somebody typed reaches a plant database,
 * so the fence is explicit:
 *
 *   - **administrators only**, and only against a database their own foundry
 *     registered — the route checks both before calling this;
 *   - **one statement.** A semicolon inside is refused outright, and MySQL is
 *     connected with `multipleStatements: false` besides;
 *   - **SELECT or WITH.** Nothing else is run at all, so there is no UPDATE,
 *     no DELETE and no DDL to roll back;
 *   - **inside a read-only transaction** on MySQL and PostgreSQL, rolled back
 *     whatever happens. SQL Server has no read-only transaction to ask for,
 *     so there the first three rules are the fence;
 *   - **capped and timed out.** At most `limit` rows come back, and the
 *     engine's own query timeout still applies.
 *
 * The account is whatever was registered. A connection given write permission
 * is a connection that can write, which is a decision made when it is
 * registered rather than here — this neither widens it nor pretends to.
 */
/**
 * Why this statement may not be run, or null.
 *
 * One place, so the query box, the preview and every poll of a reading that
 * carries its own statement are held to the same rule. Not a cleaner: it
 * refuses rather than rewrites, because quietly changing somebody's SQL and
 * running something else is worse than saying no.
 */
export function safeToRun(sql) {
  const statement = String(sql || '').trim().replace(/;+\s*$/, '')
  if (!statement) return 'There is nothing to run.'
  if (statement.includes(';')) return 'One statement at a time — take out the semicolon.'
  if (!/^(select|with)\b/i.test(statement)) {
    return 'Only SELECT may be run here. This reads the plant\'s data; it does not change it.'
  }
  return null
}

/** The first column of a row as the value, the second as its time. */
function positional(record) {
  const values = Object.values(record || {})
  return {
    value: values[0],
    /*
     * The last column, not the second.
     *
     * A written query selects two — the measurement and its time — and so did
     * the built one until a date and a time of day had to be selected as
     * themselves as well. The moment is always what the statement ends with,
     * which is true of both and does not need the caller to say which it is.
     */
    at: values.length > 1 ? values[values.length - 1] : null,
  }
}

export async function runQuery(row, sql, limit = 200) {
  const statement = String(sql || '').trim().replace(/;+\s*$/, '')
  const refusal = safeToRun(statement)
  if (refusal) throw new Error(refusal)

  const cap = Math.max(1, Math.min(1000, Number(limit) || 200))
  const readOnly = {
    mysql: 'START TRANSACTION READ ONLY',
    mariadb: 'START TRANSACTION READ ONLY',
    postgres: 'BEGIN READ ONLY',
  }[row.engine]

  return await ask(row, async ({ query, discard }) => {
    if (readOnly) await query(readOnly, [])
    try {
      const rows = await query(statement, [])
      const list = Array.isArray(rows) ? rows : []
      const kept = list.slice(0, cap)
      return {
        // From the first row, because that is what every driver here gives
        // back: rows as objects keyed by column name.
        columns: kept.length ? Object.keys(kept[0]) : [],
        rows: kept.map(record => Object.values(record).map(readable)),
        rowCount: list.length,
        truncated: list.length > kept.length,
      }
    } finally {
      /*
       * A rollback that did not land leaves the connection in a transaction,
       * and the connection is reused now — so it is discarded rather than
       * returned to the pool. The read itself has already answered; this is
       * only about what the next caller is handed.
       */
      if (readOnly) await query('ROLLBACK', []).catch(() => discard?.())
    }
  })
}

/**
 * The statement a reading runs, as text, for somebody to look at.
 *
 * Built from the same pieces `latestValues` builds it from — same quoting,
 * same ordering, same one-row wrapper — so what is shown is what runs rather
 * than a second description that can drift from it. The row filter stays a
 * bound parameter here too: it is listed beside the statement rather than
 * pasted into it, because that is how it reaches the database.
 */
export function readStatement(engine, tag) {
  const dialect = DIALECT[engine]
  // A reading with a statement of its own: that statement is the answer.
  if (tag?.sql) return { sql: String(tag.sql), params: [] }
  if (!dialect || !tag?.table || !tag?.column) return null

  /*
   * The same two names the chart's statement uses.
   *
   * This said `AS value, AS at` while `recentValues` said
   * `AS \`BENTONITE_LEVEL_PCT\`, … AS \`datetime\``, so the card showed one
   * statement before Read now and a different one after it — for the same
   * reading, against the same table. Two statements that disagree about what
   * they select is worse than either of them alone.
   */
  const filtered = !!(tag.keyColumn && tag.keyValue)
  const named = dialect.quote(String(tag.named || tag.id || tag.column))

  /*
   * A date and a time read as one moment, not added together.
   *
   * This wrote `` `date` + `time` ``, which in MySQL is arithmetic: both
   * sides are coerced to numbers and summed, so `2026-10-28` + `23:59:23`
   * is a number that is not a date and not an error either. Ordering by it
   * is ordering by nonsense.
   *
   * `CONCAT` joins them the way the chart does — see `stampFromParts` — and
   * the ordering is on the two columns themselves, which an index can
   * answer and which does not depend on the join parsing.
   */
  const pair = tag.timeColumn && tag.timeColumn2
  const moment = pair
    ? (engine === 'postgres'
      ? `${dialect.quote(tag.timeColumn)} || ' ' || ${dialect.quote(tag.timeColumn2)}`
      : `CONCAT(DATE(${dialect.quote(tag.timeColumn)}), ' ', ${dialect.quote(tag.timeColumn2)})`)
    : (tag.timeColumn ? dialect.quote(tag.timeColumn) : null)

  const select = `SELECT ${dialect.quote(tag.column)} AS ${named}` +
    (moment ? `, ${moment} AS ${dialect.quote('datetime')}` : '')
  const from = ` FROM ${dialect.quote(tag.table)}`
  const where = filtered ? ` WHERE ${dialect.quote(tag.keyColumn)} ${comparison(tag.keyOp)} ${dialect.param(1)}` : ''
  const order = pair
    ? ` ORDER BY ${dialect.quote(tag.timeColumn)} DESC, ${dialect.quote(tag.timeColumn2)} DESC`
    : (moment ? ` ORDER BY ${dialect.quote('datetime')} DESC` : '')

  return {
    sql: dialect.one(select + from + where + order),
    params: filtered ? [String(tag.keyValue)] : [],
  }
}

export async function latestValues(row, wanted) {
  const out = { values: {}, errors: {} }
  if (!Array.isArray(wanted) || !wanted.length) return out

  const dialect = DIALECT[row.engine]
  if (!dialect) throw new Error(`"${row.engine}" is not a database engine this understands.`)

  // One schema for the whole batch, and usually a remembered one — see
  // `schemaFor`. A poll of twenty readings is one schema read at most.
  const tables = await tablesFor(row, wanted)
  // The same schema read, by type — for deciding whether a "Newest by" pair
  // is two columns the database can compare as dates. See `paired` below.
  const types = typesByTable((await schemaFor(row)).schema)

  const usable = []
  for (const tag of wanted) {
    /*
     * A reading that carries its own statement.
     *
     * There is no table or column to check against the schema — the whole
     * point of writing one is that the answer comes from somewhere a single
     * table and column cannot say, a join or an aggregate. `safeToRun` is
     * the check instead: one statement, SELECT or WITH, nothing else.
     */
    if (tag.sql) {
      const refusal = safeToRun(tag.sql)
      if (refusal) { out.errors[tag.id] = refusal; continue }
      usable.push({ ...tag, time: null })
      continue
    }

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

    /*
     * The second half of a date-and-time pair, so the badge and the chart
     * agree about which row is newest.
     *
     * "Newest by" can name a merged date and time — `date + time` on the
     * `additive` table — and this read used only the first half. `ORDER BY
     * \`date\` DESC LIMIT 1` finds the newest *day* and then whichever row of
     * that day the engine feels like, while the chart orders by the two read
     * as one moment and finds the actual newest. Two different rows for one
     * reading: the chart drew thirty-nine records and the value beside it was
     * blank, because the row the badge landed on had nothing in that column.
     *
     * Only where the database compares the halves as dates. On text columns
     * `'10-23-2026' < '12-01-2025'` as strings, so ordering by them is worse
     * than ordering by neither — the same trap as `MAX` on a text date, and
     * there the merged expression is the chart's job rather than this one's.
     */
    const second = tag.timeColumn2 && columns.has(tag.timeColumn2) ? tag.timeColumn2 : null
    const typeOf = name => (types.get(tag.table) || []).find(c => c.name === name)?.type || ''
    const paired = time && second && TEMPORAL.test(typeOf(time)) ? second : null

    usable.push({ ...tag, time, paired })
  }
  if (!usable.length) return out

  /*
   * Readings on the same table are read together, in one statement.
   *
   * This asked for each reading on its own, in a loop, over one connection —
   * so a loop with 128 readings sent 128 statements and waited for each
   * before sending the next. Measured here: twenty readings on one table were
   * twenty SELECTs on the wire. On a database beside the server that is a
   * few milliseconds; through an SSH tunnel to a plant at 40 ms it is five
   * seconds of a thirty-second poll spent on round trips, and the canvas
   * fills a reading at a time while somebody watches.
   *
   * A reading is a column, a table, an ordering and an optional row filter.
   * Everything but the column is shared by most of them — `additive` holds a
   * dozen — so the ones that agree on the rest are one statement selecting a
   * dozen columns, and the answer is pulled apart by alias afterwards.
   *
   * Grouped by exactly what the statement is made of, so a group cannot
   * change the meaning of any reading in it: a different filter, a different
   * ordering or a different table is a different group.
   */
  /**
   * What "newest" means for a reading, as SQL.
   *
   * One column, or two read as one moment where "Newest by" named a pair —
   * see `paired`. Both halves are ordered on, so it is the newest day and
   * then the newest time within it, which is the row the chart calls newest
   * too. The two disagreeing is what left a full chart beside a blank value.
   */
  const newestBy = tag => {
    if (!tag.time) return ''
    const first = `${dialect.quote(tag.time)} DESC`
    return tag.paired ? `${first}, ${dialect.quote(tag.paired)} DESC` : first
  }

  /**
   * The moment reported beside the value.
   *
   * A date half on its own is midnight, so a reading ordered by a pair would
   * say "Recorded 00:00" beside a value taken at ten to midnight. The halves
   * are joined for the answer exactly as the chart joins them.
   */
  const momentOf = tag => {
    if (!tag.time) return ''
    if (!tag.paired) return `, ${dialect.quote(tag.time)} AS at`
    const joined = row.engine === 'postgres'
      ? `${dialect.quote(tag.time)} || ' ' || ${dialect.quote(tag.paired)}`
      : `CONCAT(DATE(${dialect.quote(tag.time)}), ' ', ${dialect.quote(tag.paired)})`
    return `, ${joined} AS at`
  }

  const groupKey = tag => [
    tag.table, tag.keyColumn || '', tag.keyOp || '=', tag.keyValue ?? '',
    tag.time || '', tag.paired || '',
  ].join('\u0000')

  /* A statement names its columns, and a wide table could hold hundreds of
     readings. Kept to a size no database objects to. */
  const BATCH = 100

  await ask(row, async ({ query }) => {
    /** One reading, on its own — the path a written statement always takes. */
    const readOne = async tag => {
      const filtered = !tag.sql && !!(tag.keyColumn && tag.keyValue)
      const select = tag.sql ? null : `SELECT ${dialect.quote(tag.column)} AS value` + momentOf(tag)
      const from = tag.sql ? '' : ` FROM ${dialect.quote(tag.table)}`
      const where = filtered ? ` WHERE ${dialect.quote(tag.keyColumn)} ${comparison(tag.keyOp)} ${dialect.param(1)}` : ''
      const order = tag.time ? ` ORDER BY ${newestBy(tag)}` : ''

      try {
        /*
         * The statement as written, or the one built from the table and
         * column. A written one is read positionally — first column the
         * value, second the time if there is one — because the names in
         * somebody's own SELECT are theirs to choose.
         */
        const rows = tag.sql
          ? await query(tag.sql, [])
          : await query(dialect.one(select + from + where + order), filtered ? [tag.keyValue] : [])
        const row_ = Array.isArray(rows) ? rows[0] : null
        const first = tag.sql && row_ ? positional(row_) : row_
        out.values[tag.id] = first
          ? { value: readable(first.value), recordedAt: moment(first.at) }
          : null
        if (!first) {
          // Naming the filter, because a filter matching nothing is by far
          // the likeliest reason a table full of rows answers with none —
          // and "no rows yet" sent people looking at the database instead.
          out.errors[tag.id] = tag.sql
            ? 'That query returned no rows.'
            : filtered
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

    /**
     * Several readings off one table, in one statement.
     *
     * Each column is aliased by its position in the group rather than by its
     * own name, because two readings may point at the same column and a
     * column may be called `at` — both of which would make the row ambiguous
     * to pull apart.
     */
    const readTogether = async group => {
      const first = group[0]
      const filtered = !!(first.keyColumn && first.keyValue)
      const select = 'SELECT ' +
        group.map((tag, at) => `${dialect.quote(tag.column)} AS v${at}`).join(', ') +
        momentOf(first)
      const from = ` FROM ${dialect.quote(first.table)}`
      const where = filtered
        ? ` WHERE ${dialect.quote(first.keyColumn)} ${comparison(first.keyOp)} ${dialect.param(1)}`
        : ''
      const order = first.time ? ` ORDER BY ${newestBy(first)}` : ''

      const rows = await query(
        dialect.one(select + from + where + order), filtered ? [first.keyValue] : [])
      const record = Array.isArray(rows) ? rows[0] : null

      group.forEach((tag, at) => {
        out.values[tag.id] = record
          ? { value: readable(record[`v${at}`]), recordedAt: moment(record.at) }
          : null
        if (!record) {
          out.errors[tag.id] = filtered
            ? `No rows where "${tag.keyColumn}" = "${tag.keyValue}".`
            : `"${tag.table}" has no rows.`
        }
      })
    }

    const groups = new Map()
    for (const tag of usable) {
      // A written statement answers for itself and nothing else.
      if (tag.sql) { await readOne(tag); continue }
      const key = groupKey(tag)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(tag)
    }

    for (const group of groups.values()) {
      for (let at = 0; at < group.length; at += BATCH) {
        const slice = group.slice(at, at + BATCH)
        if (slice.length === 1) { await readOne(slice[0]); continue }
        try {
          await readTogether(slice)
        } catch {
          /*
           * One statement for a dozen readings fails as a dozen, so a single
           * unreadable column would blank every reading beside it. Falling
           * back to one at a time costs the round trips this exists to save,
           * on the rare table where something is wrong — and each reading
           * then gets its own answer or its own error, as before.
           */
          for (const tag of slice) await readOne(tag)
        }
      }
    }
  })

  return out
}

/**
 * The most a chart is given where nothing else bounds the read.
 *
 * A windowed statement carries no limit at all — the window is the bound, and
 * it is the one on the buttons above the chart. This is for the reads that
 * have no window: a table with no clock, the fallback that runs when a window
 * turns out to be empty, and the trend window's own read.
 *
 * The trend asks for the newest two thousand records and cuts its 2 h / 4 h /
 * 8 h / 1 day out of them in the browser, so one read serves all four buttons
 * instead of a round trip to the plant for each. Two thousand is what makes a
 * day's worth reachable on a reading written every half-minute; a slower
 * reading simply reaches further back, and each button still cuts an exact
 * span out of whatever came.
 */
const MAX_POINTS = 2000

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
export async function recentValues(row, tag, points = 200, windowSeconds = null) {
  const dialect = DIALECT[row.engine]
  if (!dialect) throw new Error(`"${row.engine}" is not a database engine this understands.`)

  /*
   * A reading with a statement of its own is charted from that statement.
   *
   * It is run as written — not widened, not re-limited — so a query ending
   * in `LIMIT 1` charts one point, which is the honest answer to what was
   * asked for rather than a different query nobody wrote. Columns are read
   * positionally: value first, time second. Without a second column there is
   * nothing to put a point on a time axis with, and that is said plainly.
   */
  if (tag.sql) {
    const refusal = safeToRun(tag.sql)
    if (refusal) throw new Error(refusal)

    const rows = await ask(row, async ({ query }) => query(String(tag.sql), []))
    const list = (Array.isArray(rows) ? rows : []).slice(0, MAX_POINTS)
    if (list.length && Object.keys(list[0]).length < 2) {
      throw new Error(
        'This reading\'s query returns one column, so there is no time to chart it against. ' +
        'Add the timestamp column as the second one.'
      )
    }

    const charted = list
      .map(record => positional(record))
      .map(record => ({ value: readable(record.value), recordedAt: moment(record.at) }))
      .filter(record => typeof record.value === 'number' && record.recordedAt)

    /*
     * Rows came back, and none of them could be put on a chart.
     *
     * A written query names its own two columns, so there is no table to ask
     * for a better one the way the branch below does — what comes second is
     * whatever was asked for. If none of it reads as a time, or none of the
     * first column reads as a number, every row is dropped by the filter
     * above and the chart is empty for a query that plainly returned data.
     *
     * Which of the two it was is worth saying, because they are different
     * mistakes: the wrong column second, or a column of text first.
     */
    if (list.length && !charted.length) {
      const sample = positional(list[0])
      const numbers = typeof readable(sample.value) === 'number'
      throw new Error(
        numbers
          ? 'This query\'s second column is not a date or time, so its rows cannot be ' +
            'placed on a chart. Select a timestamp as the second column.'
          : 'This query\'s first column is not a number, so there is nothing to chart. ' +
            'Select the measurement as the first column and its timestamp as the second.'
      )
    }

    // Newest first out of most such queries, oldest first onto a chart.
    const ordered = charted.slice().sort((a, b) =>
      String(a.recordedAt).localeCompare(String(b.recordedAt)))
    return withStatement(
      ordered.slice(-Math.min(Math.max(Number(points) || 200, 1), MAX_POINTS)), String(tag.sql))
  }

  const columns = (await tablesFor(row, [tag])).get(tag.table)
  if (!columns) throw new Error(`There is no table "${tag.table}" in this database.`)
  if (!columns.has(tag.column)) throw new Error(`There is no column "${tag.column}" in "${tag.table}".`)

  /*
   * Ordered by the best column there is, which is not always a time.
   *
   * This used to refuse outright when a table had no date or time column —
   * which is correct about the x-axis and wrong about the chart. An
   * individuals chart is a run of observations in the order they were taken;
   * the clock is how that order is usually expressed, not what makes it a
   * chart. A table keyed by `id` and nothing else still has an order, and a
   * reading pointed at it still has a run of values worth looking at.
   *
   * So it falls back to whatever the reading is ordered by. Those points come
   * back with no `recordedAt` — `moment` refuses to read an id as a date —
   * and the studio draws them by position instead, which is honest about what
   * the axis means.
   */
  const known = typesByTable((await schemaFor(row)).schema).get(tag.table) || []
  const typeOf = name => known.find(column => column.name === name)?.type || ''

  /*
   * A date column and a time column beat a copying tool's stamp.
   *
   * `timeColumnFor` prefers a plant's own `datetime` and falls back to
   * `_watermark_ts` when that is all there is — which on `pouring_data` means
   * charting when rows were copied rather than when pours happened. That
   * table's real timestamp is its `Date` and `Time` text columns, and reading
   * them as one is better than the bookkeeping column by every measure.
   *
   * A real `datetime` the plant writes still wins over both.
   */
  /*
   * A combined date and time is used when the reading asks for one, and
   * otherwise only where the chosen column is not a time at all.
   */
  const chosen = await timeColumnFor(row, tag, columns)

  /*
   * The pair is used when it is chosen, or when nothing is.
   *
   * It used to step in whenever the chosen column was not a time, which is
   * the same overruling as above wearing a different hat: "Newest by" said
   * `id` and the statement said `STR_TO_DATE(CONCAT(Date, ' ', Time), …)`.
   * The dropdown offers the pair as its own entry; choosing it is how it gets
   * used, and leaving it unchosen is how it does not.
   */
  /*
   * The merge is tried when it could add something, and only then.
   *
   * That is: when it was asked for outright, when nothing has been chosen, or
   * when what was chosen is a date with no time of day. A chosen column that
   * is not a time at all — an `id` — is left exactly as chosen, because
   * "newest by id" is a decision about order and not about the clock.
   */
  /*
   * Ordering and the time axis are two questions, not one.
   *
   * "Newest by" answers the first: which column puts the rows in order. It
   * was being used for the second as well, so a reading ordered by `id` had
   * no time to window against — and the chart fell back to the newest two
   * hundred rows whatever window was chosen. The table's timestamp is a fact
   * about the table, not about that choice, so it is found either way.
   */
  const pair = await stampFromParts(row, tag, known)

  const time = chosen
  if (!time && !pair) {
    throw new Error(
      `"${tag.table}" has no column to put its rows in order by. ` +
      'Set this reading\'s "Newest by" to a timestamp or an id.'
    )
  }

  const filtered = !!(tag.keyColumn && columns.has(tag.keyColumn) && tag.keyValue)
  const wanted = Math.min(Math.max(Number(points) || 200, 1), MAX_POINTS)

  /*
   * The window the chart is showing, asked for in the statement.
   *
   * It used to fetch the newest two hundred rows whatever window was chosen
   * and let the studio cut them down — which reads two hundred rows over an
   * SSH tunnel to draw twelve, and makes the statement in Preview data
   * disagree with the chart above it. Asking the database for the window is
   * both the smaller read and the honest statement.
   *
   * Only where the ordering column is a time. Where it is an `id` there is no
   * window to express, and the rows come back in order instead — see above.
   */
  /*
   * What the window is measured against, and what the chart is placed by.
   *
   * A pair of text columns read as one timestamp (see `stampFromParts`) is as
   * good a clock as a `datetime` and is used the same way — in the WHERE, in
   * the ORDER BY, and as the second thing selected.
   */
  /*
   * The best clock the table has, whatever the rows are ordered by.
   *
   * A merged date and time first, then the chosen column if it is itself a
   * time, then any timestamp the plant writes. Only when the table has none
   * of those is there no window to apply — and then the chart is a run of
   * readings in order, which is what it says.
   */
  const plantsClock = known.find(column =>
    TEMPORAL.test(column.type) && !BOOKKEEPING.test(column.name))?.name || null

  const clock = pair ? null
    : TEMPORAL.test(typeOf(time)) ? time
      : plantsClock

  /*
   * Whether the pair's date half is a column the database compares as a date.
   *
   * Everything below that compares that column directly — the subquery for
   * the newest moment, and the pre-filter on the window — is sound only when
   * it is. On text, `'10-23-2026' >= '2026-10-23'` is a comparison of two
   * strings and is false, and `MAX('12-01-2025')` is December. A text pair is
   * read through the parsed expression and nothing else.
   */
  const pairIsDated = !!pair && TEMPORAL.test(typeOf(pair.date))

  const stamp = pair ? pair.sql : (clock ? dialect.quote(clock) : dialect.quote(time))
  const temporal = !!pair || !!clock
  const window_ = Number(windowSeconds)
  const windowed = temporal && Number.isFinite(window_) && window_ > 0

  /*
   * The columns under their own names, not under `value` and `at`.
   *
   * They used to be aliased, which made the statement in Preview data read
   * `SELECT \`C10\` AS value, \`Det\` AS at` and the rows underneath come back
   * headed `recordedAt,value` — two names that appear nowhere in the plant's
   * database. Pasted into Workbench it was a different-looking query, and the
   * columns somebody was trying to match against their own schema had been
   * renamed on the way past.
   *
   * The two are read by position instead, exactly as a written query already
   * is — see `positional`. First column the measurement, second its time.
   */
  /*
   * Two columns: the reading, under its own name, and `datetime`.
   *
   * The aliases earlier in this file's history were `value` and `at` — words
   * that mean nothing to anybody reading the statement beside their own
   * schema. These two do: the reading is called what the loop calls it, and
   * the moment is called what it is, however the table happened to store it.
   * A date and a time kept in two text columns are joined here and are
   * `datetime` from that point on, exactly as a table with a real one is.
   *
   * **The WHERE repeats the expression rather than using the alias**, because
   * SQL will not have it otherwise: a column alias is not in scope in a WHERE
   * clause — the rows are chosen before the SELECT list is worked out. ORDER
   * BY comes after, so there the alias is used. Putting the whole thing in a
   * subquery would let the WHERE say `datetime`, at the cost of the index on
   * the real column, which is the one thing making this fast.
   */
  const named = dialect.quote(String(tag.id || tag.column))

  /*
   * `datetime` only where it is one.
   *
   * Calling an `id` "datetime" is the same invented label as `value` and `at`
   * were, and a worse one: it states something about the column that is not
   * true. Where the ordering column is not a time it keeps its own name, and
   * the statement then says plainly that this chart is a run of readings in
   * order rather than a history — which is exactly what it is.
   */
  const when = temporal ? dialect.quote('datetime') : (pair ? dialect.quote('datetime') : null)
  const select = when
    ? `SELECT ${dialect.quote(tag.column)} AS ${named}, ${stamp} AS ${when}`
    : `SELECT ${dialect.quote(tag.column)} AS ${named}, ${stamp}`
  const from = ` FROM ${dialect.quote(tag.table)}`
  const terms = []
  const args = []
  if (filtered) {
    terms.push(`${dialect.quote(tag.keyColumn)} ${comparison(tag.keyOp)} ${dialect.param(args.length + 1)}`)
    args.push(tag.keyValue)
  }
  /*
   * The window is measured by the database's own clock, not by ours.
   *
   * It used to be a literal built here — `>= '2026-10-22 05:56:45'` — and that
   * is only right when three clocks agree: this server's, the database
   * server's, and whatever timezone the column is written in. On the plant's
   * own data none of them do. `NOW()` reads `02:32` UTC while `_watermark_ts`
   * on the newest row says `07:13`, because that column is written in local
   * time and read back as if it were UTC. Our literal was then five and a half
   * hours away from the rows it was meant to select.
   *
   * `NOW() - INTERVAL n SECOND` has none of that to get wrong: both sides of
   * the comparison come from the same clock, in the same timezone, inside the
   * database. The number is an integer this function clamped, so it is written
   * into the statement rather than bound — and it is the same statement
   * somebody reads in Preview data, which now says what it means.
   */
  /*
   * The window is measured against the data's own clock, not the server's.
   *
   * `NOW()` is the database session's idea of now, and that is not the clock
   * the rows are written in. Measured on the plant's own: the session is UTC
   * and says `09:55`, while the newest row says `15:16` — the rows carry IST
   * wall-clock with no timezone on them. `NOW() - 2 hours` then meant 07:55
   * UTC compared against IST values, and "the last two hours" returned seven
   * and a half.
   *
   * Nothing here can know which zone a column was written in, and guessing
   * one would be the same mistake with an extra step. The newest row *is* now
   * in whatever frame the data uses, so the window is measured back from it.
   * On a line that is producing, that is the last two hours and it moves as
   * rows arrive; on one that has stopped it is the last two hours of what
   * there is, which is the more useful of the two answers anyway.
   */
  /*
   * The window's start is looked up once, then written in.
   *
   * It was a subquery — `>= (SELECT MAX(…) FROM table) - INTERVAL n SECOND` —
   * which meant the whole `STR_TO_DATE(CONCAT(…))` expression appeared three
   * times in one statement, and nobody could read it. Asking for the newest
   * moment first and putting the answer in as a literal says the same thing
   * in one line, runs as its own small query, and leaves a statement somebody
   * can paste into Workbench and follow.
   */
  let since = null
  if (windowed) {
    /*
     * The newest moment, found by the index rather than by reading the table.
     *
     * `MAX(STR_TO_DATE(CONCAT(DATE(date), ' ', time), …))` has to build that
     * expression for every row in the table before it can take a maximum —
     * no index can help, because the thing being maximised is not a column.
     * Measured on 200,000 rows: that one line was most of a second, every
     * time a chart opened and every time a window button was pressed.
     *
     * The same answer comes from the newest row, and the newest row is what
     * an index on the date column is for. The expression is then built once,
     * for that row, instead of two hundred thousand times.
     */
    /*
     * The same maximum, taken over one day instead of over the table.
     *
     * The newest moment is on the newest date — that much the date column can
     * answer from its index, in a subquery, without reading a row of the rest.
     * The expression is then evaluated over that one day's rows, which is a
     * few hundred rather than a few hundred thousand.
     *
     * Measured on 200,000 rows: `MAX(STR_TO_DATE(CONCAT(…)))` over the table
     * is 410 ms, the same thing over the newest day is 3 ms.
     *
     * Ordering by the two columns and taking the first was tried in between —
     * 130 ms, and wrong on a text date. `MAX('12-01-2025') > MAX('10-23-2026')`
     * because a month-first string sorts by month, so the "newest" row on
     * `pouring_data` would have been whatever December it holds. Only a column
     * the database knows is a date may be compared as one, which is what the
     * `dateIsTemporal` test below is for; a text pair keeps the whole-table
     * maximum, which is slower and right.
     */
    const newestSql = pairIsDated
      ? `SELECT MAX(${stamp}) AS newest FROM ${dialect.quote(tag.table)} ` +
        `WHERE ${dialect.quote(pair.date)} = ` +
        `(SELECT MAX(${dialect.quote(pair.date)}) FROM ${dialect.quote(tag.table)})`
      : `SELECT MAX(${stamp}) AS newest FROM ${dialect.quote(tag.table)}`

    const [newest] = await ask(row, async ({ query }) => query(newestSql, []))

    const latest = moment(newest?.newest)
    if (latest) {
      const started = new Date(Date.parse(latest) - window_ * 1000)
      since = `${started.getFullYear()}-${two(started.getMonth() + 1)}-${two(started.getDate())} ` +
        `${two(started.getHours())}:${two(started.getMinutes())}:${two(started.getSeconds())}`

      /*
       * A term the index can use, beside the one that is exact.
       *
       * `STR_TO_DATE(CONCAT(DATE(date), ' ', time), …) >= '2026-10-23 09:30'`
       * is the right condition and an unusable one: the column is inside a
       * function, so every row in the table is read and converted before any
       * of them are ruled out. Two hours of a table holding a year took as
       * long as reading the year.
       *
       * `date >= '2026-10-23'` says less and says it in a form an index on
       * that column can answer. It never excludes a row the exact term would
       * keep — a moment on or after 09:30 on the 23rd is on a date on or
       * after the 23rd — so the pair is the exact condition with the scan
       * taken out of it: the index narrows to a day or two, and the exact
       * term chooses within them.
       */
      if (pairIsDated) terms.push(`${dialect.quote(pair.date)} >= '${since.slice(0, 10)}'`)
      terms.push(`${stamp} >= '${since}'`)
    }
  }

  const where = terms.length ? ` WHERE ${terms.join(' AND ')}` : ''

  /*
   * Newest first, and by id where two rows claim the same moment.
   *
   * `Det` on the RTC table is a date with no time of day, so two hundred
   * readings taken through one day are all "the same instant" to an ORDER BY
   * — and which two hundred come back is then whatever the engine felt like.
   * The reading's own ordering column breaks the tie, which is what it was
   * chosen for in the first place.
   */
  const tiebreak = tag.timeColumn && columns.has(tag.timeColumn) && tag.timeColumn !== time &&
    tag.timeColumn !== pair?.date && tag.timeColumn !== pair?.time
    ? `, ${dialect.quote(tag.timeColumn)} DESC`
    : ''
  // The alias is in scope here, which is why it reads as it does — and
  // where there is no alias, the column itself.
  const order = ` ORDER BY ${when || stamp} DESC${tiebreak}`

  /*
   * The limit is a number this function chose, bounded above, and written into
   * the statement — not a parameter. MySQL and SQL Server both refuse a bound
   * parameter in that position, and a clamped integer is not user input by the
   * time it reaches here.
   */
  /*
   * No LIMIT where the window is doing the limiting.
   *
   * A row count and a time window are two different answers to "how much",
   * and having both meant the smaller one silently won: ask for a day and get
   * the newest two hundred rows of it, with nothing on screen saying the rest
   * had been cut. The window is the one somebody chose — it is on the buttons
   * above the chart — so it decides, and the statement says so.
   *
   * Capping a windowed read at a high ceiling instead was tried and taken out
   * again: `LIMIT 2000` on the end of a statement under a chart labelled two
   * hours is a number nobody asked for, in the one box whose whole purpose is
   * to say exactly what the chart ran.
   *
   * The cap stays where there is no window, because then nothing else bounds
   * the read at all.
   */
  const capped = sql => (row.engine === 'sqlserver' || row.engine === 'azuresql'
    ? sql.replace(/^SELECT /, `SELECT TOP ${wanted} `)
    : `${sql} LIMIT ${wanted}`)

  const limited = windowed
    ? `${select}${from}${where}${order}`
    : capped(`${select}${from}${where}${order}`)

  /*
   * The window, and the whole run if the window is empty.
   *
   * A sand line goes quiet: a shift ends, a shutdown, a reading taken once a
   * batch. Asking for the last two hours then returns nothing, and an empty
   * chart reads as "this reading is broken" rather than "nothing since
   * lunchtime". So a windowed query that finds nothing is asked again without
   * the window, and what comes back is the newest records there are.
   *
   * The statement reported is the one whose rows are being shown, so Preview
   * data never shows a query that returned something other than the chart.
   */
  /*
   * Two versions of the same statement: one to run, one to read.
   *
   * It runs with bound parameters, which is what keeps a row filter somebody
   * typed out of the SQL. What Preview data shows has those values written in
   * as literals, because a statement full of `?` cannot be run by the person
   * reading it — and being able to run it, edit it and run it again is the
   * whole point of showing it.
   */
  const shown = (sql, values = args) => {
    let index = 0
    return sql.replace(/\?|\$\d+|@p\d+/g, () => {
      const value = values[index++]
      return value === undefined ? '?' : `'${String(value).replaceAll("'", "''")}'`
    })
  }

  let statement = shown(limited)
  let rows = await ask(row, async ({ query }) => query(limited, args))

  if (windowed && !(Array.isArray(rows) && rows.length)) {
    const whole = filtered
      ? ` WHERE ${dialect.quote(tag.keyColumn)} ${comparison(tag.keyOp)} ${dialect.param(1)}`
      : ''
    // The fallback has no window, so the cap is the only thing bounding it.
    const plain = capped(`${select}${from}${whole}${order}`)
    rows = await ask(row, async ({ query }) => query(plain, filtered ? [tag.keyValue] : []))
    // Reported with its row filter written in, for the same reason as above.
    statement = filtered ? shown(plain, [tag.keyValue]) : plain
  }

  // Newest first out of the database, oldest first onto a chart.
  const read = (Array.isArray(rows) ? rows : [])
    .map(record => positional(record))
    .map(record => ({ value: readable(record.value), recordedAt: moment(record.at) }))
  const charted = read.filter(record => typeof record.value === 'number').reverse()

  /*
   * Rows came back and not one of them held a number.
   *
   * A column of blanks, or of text, charts as nothing — and "0 records" over
   * a table with two hundred rows in it reads as a fault in the reading when
   * it is a fact about the column. `aiw_data.pouring_data._col46` is exactly
   * this: two hundred rows read, every cell empty.
   *
   * Said rather than returned empty, because the fix is to point the reading
   * at a column that holds measurements and nothing here can guess which.
   */
  if (read.length && !charted.length) {
    const blank = read.every(record => record.value === null)
    const refused = new Error(
      `"${tag.column}" holds ${blank ? 'no values' : 'text'}, not measurements, ` +
      `so there is nothing to chart. ${read.length} row(s) were read from "${tag.table}".`
    )
    // The statement travels with the refusal: this is precisely the moment
    // somebody wants to see what was run and edit it.
    refused.statement = statement
    throw refused
  }

  /*
   * Ordered by that column, and not always placed in time by it.
   *
   * `ORDER BY id DESC` finds the newest row perfectly well — plenty of
   * readings are set up that way — and says nothing about when. Those records
   * come back with no `recordedAt`, because `moment` will not read an id as a
   * year, and the studio draws them by position: an individuals chart is a run
   * of observations in order, and the order here is the one the rows are in.
   *
   * This used to throw instead, which refused a chart over records that were
   * sitting right there. Where the column genuinely holds nothing chartable
   * the message above says so; a missing timestamp is not that.
   */

  return withStatement(charted, statement, [String(tag.id || tag.column), when ? 'datetime' : time])
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

/** Every table name → its columns' names and types, for choosing a time column. */
const typesByTable = schema =>
  new Map((schema.tables || []).map(table =>
    [table.name, (table.columns || []).map(c => ({ name: c.name, type: String(c.type || '') }))]))

/**
 * The records, carrying the statement they came from.
 *
 * Set on the array rather than wrapped in an object, because every caller
 * wants the points and only one wants the statement — and that one is the
 * trend window's Preview data, which exists so an administrator can see what
 * the chart actually ran and change it. It used to be shown the single-value
 * query instead (`… LIMIT 1`), which answers a different question entirely
 * and left somebody editing a statement that was never the one failing.
 *
 * Not enumerable, so it does not turn up in `JSON.stringify` or in a spread.
 */
function withStatement(points, sql, columns = null) {
  Object.defineProperty(points, 'statement', { value: sql, enumerable: false })
  /** The names the statement gives its two columns, in order. */
  Object.defineProperty(points, 'columns', { value: columns, enumerable: false })
  return points
}

/* -------------------------------------- which column puts a chart in time ---*/

/** Column types that hold a moment. A bare `time` has no day and is no use. */
const TEMPORAL = /^(datetime2|datetimeoffset|smalldatetime|datetime|timestamp|date)\b/i

/**
 * A type that holds a time of day and nothing else — MySQL's `TIME`.
 *
 * Deliberately not part of `TEMPORAL`, which answers "can this column place a
 * row in history". A bare clock cannot: `14:39:12` with no day is the same
 * instant every afternoon, so a chart ordered by it interleaves a fortnight.
 * It has exactly one use, as the second half of a date-and-time pair, and
 * this is how `stampFromParts` finds it without it leaking into the ordering
 * and windowing decisions that `TEMPORAL` governs.
 */
const CLOCK_ONLY = /^time\b/i

/**
 * A type that holds a day and no time of day — MySQL's `DATE`.
 *
 * `\b` is what keeps `datetime` out of this: there is no word boundary
 * between "date" and "time", so only the bare type matches.
 */
const DATE_ONLY = /^date\b/i
/** Columns a copying tool writes: real, but about the copy, not about the plant. */
const BOOKKEEPING = /^_|_(ts|at)$|watermark|synced|etl|ingest/i

/**
 * The column a reading's records are placed in time by.
 *
 * Not the same question as "newest first". Ordering a table by its primary key
 * is a perfectly good way to find the latest row, and plenty of readings are
 * set up exactly that way — so `ORDER BY id DESC` is a right answer to one
 * question and no answer at all to the other. The reading's own `timeColumn`
 * is the first choice and is taken whenever it holds a date or a time.
 *
 * When it does not — an `id`, a counter, a shift number — the table is asked
 * for a column that does, preferring one the plant writes over one a copying
 * tool writes: `_watermark_ts` is when the row reached this database, which
 * on a backfill is every row at once, and `Det` is when the measurement was
 * taken. The reading goes on reading from whatever it was ordered by; only the
 * chart's x-axis comes from here.
 *
 * Null when the table has no such column at all, which the caller reports.
 */
async function timeColumnFor(row, tag, columns) {
  const asked = tag.timeColumn && columns.has(tag.timeColumn) ? tag.timeColumn : null

  const schema = (await schemaFor(row)).schema
  const known = typesByTable(schema).get(tag.table) || []
  const typeOf = name => known.find(column => column.name === name)?.type || ''

  /*
   * What "Newest by" says, and nothing else.
   *
   * This had two goes at being clever and both were wrong. It overruled the
   * choice whenever that column was not itself a timestamp — so a reading set
   * to `id` was charted against `_watermark_ts`, a copying tool's column
   * nobody picked. Narrowing that to "never a bookkeeping column" only moved
   * the problem: `id` then became `Det`, which is a better column and still
   * not the one on screen. A dropdown that says `id` while the statement
   * underneath says `Det` is the panel disagreeing with itself, and the
   * person reading it has no way to tell which is in force.
   *
   * So the selection wins, always. Where it names something that is not a
   * time there is no window to express — the rows come back in that column's
   * order and the chart draws them by position, which the statement shows.
   * Choosing a timestamp in the dropdown is what turns the window on, and
   * that is a decision with one place to make it.
   */
  if (asked) return asked

  // Nothing chosen yet: the plant's own timestamp, never a bookkeeping one.
  const plants = known.filter(column =>
    TEMPORAL.test(column.type) && !BOOKKEEPING.test(column.name))
  return plants[0]?.name || null
}

/* ------------------------------------------- a date and a time, as columns --*/

/** Columns a plant keeps its date and its time of day in, as text. */
const DATEISH = /(^|_)date($|_)|^d$/i
const TIMEISH = /(^|_)time($|_)|^t$/i
const TEXTUAL = /^(char|varchar|nchar|nvarchar|text|tinytext|mediumtext|longtext)\b/i

/**
 * The orders a plant writes a date in. First one that parses every row wins.
 *
 * Ambiguous on its own — `10-11-2026` is valid under two of these — and not
 * ambiguous across a table, because any month of real data contains a day past
 * the twelfth, which only the right order parses. That is why the test below
 * is "every row", not "this row".
 */
const DATE_ORDERS = [
  '%m-%d-%Y', '%d-%m-%Y', '%Y-%m-%d',
  '%m/%d/%Y', '%d/%m/%Y', '%Y/%m/%d',
  '%d-%b-%Y', '%d %b %Y',
]
const TIME_ORDER = '%H:%i:%s'

/** connection + table → the pair and the format that parses it, once found. */
const stamps = new Map()

/**
 * A timestamp built from a date column and a time column.
 *
 * Plenty of plant tables have no `datetime` at all: the date and the time of
 * day are two text columns, written by whatever wrote the row. `pouring_data`
 * is one — `Date` holds `10-22-2026` and `Time` holds `13:35:35` — and its
 * only real timestamps are `_watermark_ts` and `_synced_at`, which are when a
 * copying tool touched the row rather than when the pour happened. Charting
 * against those is charting the copy, and on a backfill they are all the same
 * afternoon.
 *
 * So the two text columns are read as the timestamp they are. The format is
 * not guessed: each candidate is tried against the whole table and only one
 * that leaves nothing unparsed is used, which is both the test and the proof.
 * A table it cannot read falls through to whatever the chooser above picked.
 *
 * MySQL and MariaDB only. `STR_TO_DATE` is theirs; the equivalents elsewhere
 * are different enough that claiming support without a plant to test it on
 * would be claiming a check that is not happening.
 */
async function stampFromParts(row, tag, known) {
  if (row.engine !== 'mysql' && row.engine !== 'mariadb') return null

  /*
   * The date half may be a `datetime` column, not only text.
   *
   * `RTC Data` keeps `Det` as a `datetime` whose time of day is always
   * midnight, and the actual time in a `Time` text column beside it. Requiring
   * both halves to be text ruled that pair out — so the one table where the
   * combination was most needed was the one table that could not have it, and
   * its chart fell back to no window at all.
   */
  const dateColumns = known.filter(column =>
    TEXTUAL.test(column.type) || TEMPORAL.test(column.type))

  /*
   * The pair the reading asked for, or the pair this table obviously has.
   *
   * `timeColumn` and `timeColumn2` are what the "Newest by" dropdown stores
   * when somebody picks a combined date and time — their choice, and used
   * without argument. The name match below is only for a reading that has
   * chosen nothing yet.
   */
  const named = tag.timeColumn && tag.timeColumn2
  /*
   * A `datetime` column needs no name test; a text one does — see the same
   * rule in `datePair` on the panel side. `Det` holds the day on `RTC Data`
   * and is called nothing like "date".
   */
  /*
   * The chosen column is the date half, when there is one.
   *
   * Choosing `Det` and being given `Det + Time` is not this overruling the
   * dropdown — it is the same column with the clock it was missing. The time
   * half is found beside it, and if `Det` turns out to carry a time of day
   * after all, the check further down abandons the merge entirely.
   */
  const preferred = tag.timeColumn
    ? dateColumns.find(column =>
      column.name === tag.timeColumn && !BOOKKEEPING.test(column.name))
    : null

  /*
   * A column the plant calls `date` is the date half, ahead of any other.
   *
   * `additive` has `created_on`, `last_updated_on` and `timestamp` — all
   * `datetime` — beside a `date` column and a `time` column that are what the
   * plant actually writes the reading's moment into. Taking the first
   * non-bookkeeping `datetime` picked `created_on`, found no `time` to pair
   * with it (see below), and gave up on the merge for the one table that
   * needed it.
   */
  const date = named
    ? dateColumns.find(column => column.name === tag.timeColumn)
    : preferred ||
      dateColumns.find(column => DATEISH.test(column.name)) ||
      dateColumns.find(column =>
        TEMPORAL.test(column.type) && !BOOKKEEPING.test(column.name))

  /*
   * The time half may be a `time` column, not only text.
   *
   * Both halves had to be text, which ruled out a database that stores the
   * time of day in the type made for it. `CONCAT` renders a `TIME` as
   * `14:39:12`, which is exactly what `%H:%i:%s` reads, so a real `time`
   * column joins the same way a text one does — and a plant that typed its
   * columns properly is the last one that should be refused.
   *
   * Never the column already standing as the date half: `Det + Det` is not a
   * timestamp, and on a table whose one temporal column is called `time` that
   * is what the two searches would otherwise both land on.
   */
  const timeCandidates = known.filter(column =>
    TEXTUAL.test(column.type) || TEMPORAL.test(column.type) || CLOCK_ONLY.test(column.type))
  const time = named
    ? timeCandidates.find(column => column.name === tag.timeColumn2)
    : timeCandidates.find(column =>
      TIMEISH.test(column.name) && column.name !== date?.name)

  const key = `${schemaKey(row)}\u0000${tag.table}\u0000${date?.name}\u0000${time?.name}`
  if (stamps.has(key)) return stamps.get(key)

  if (!date || !time) {
    stamps.set(key, null)
    return null
  }

  const dialect = DIALECT[row.engine]

  /*
   * A `datetime` date half is taken down to its date before joining.
   *
   * `Det` is midnight on the day, so `CONCAT(Det, ' ', Time)` would read
   * `2026-10-22 00:00:00 14:39` — not a timestamp in any format. `DATE()`
   * leaves `2026-10-22`, which the time column then completes, and the format
   * for that half is known rather than guessed.
   */
  const dateIsTemporal = TEMPORAL.test(date.type)
  const datePart = dateIsTemporal
    ? `DATE(${dialect.quote(date.name)})`
    : dialect.quote(date.name)

  const joined = format =>
    `STR_TO_DATE(CONCAT(${datePart}, ' ', ${dialect.quote(time.name)}), ` +
    `'${format} ${TIME_ORDER}')`

  /*
   * Two typed columns need no proving, so they are not read at all.
   *
   * The scan below exists because a *text* date can be written eight ways and
   * only the data says which. A `DATE` column cannot: `DATE(col)` renders
   * `2026-10-23` and nothing else, a `TIME` renders `14:39:12`, and the
   * question the scan answers is already settled by the schema. It also
   * cannot be carrying a time of day in its date half — a `DATE` has no time
   * to carry — which is the other thing the scan checks.
   *
   * Measured on 200,000 rows: that proof was most of a second the first time
   * any chart on the table opened, to establish something the column type had
   * already stated.
   */
  if (DATE_ONLY.test(date.type) && CLOCK_ONLY.test(time.type)) {
    const certain = { sql: joined('%Y-%m-%d'), date: date.name, time: time.name, order: '%Y-%m-%d' }
    stamps.set(key, certain)
    return certain
  }

  /*
   * Every candidate in one question, not one question each.
   *
   * Eight formats meant eight round trips to the plant's database, over an
   * SSH tunnel, before a chart could even be built. They are independent
   * counts over the same rows, so they are counted together: one scan, one
   * answer, and the first format with nothing unparsed wins.
   */
  const orders = dateIsTemporal ? ['%Y-%m-%d'] : DATE_ORDERS
  const counts = orders
    .map((order, index) =>
      `SUM(CASE WHEN ${joined(order)} IS NULL THEN 1 ELSE 0 END) AS bad${index}`)
    .join(', ')

  /*
   * Does the `datetime` half already carry a time of day?
   *
   * If it does, there is nothing to merge — it is the moment, and joining a
   * separate time column to it would be inventing one. `Det` on `RTC Data`
   * does not: every row is midnight, with the real time in a `Time` column
   * beside it, and that is the case this merging exists for.
   *
   * Asked of the data rather than the schema, because the type says
   * `datetime` either way. Counted in the same scan as the formats above.
   */
  /*
   * Counted in seconds, not compared as a string.
   *
   * `TIME(col) <> '00:00:00'` looks right and is not: a `datetime` with
   * fractional seconds gives `00:00:00.000`, which is not equal to
   * `'00:00:00'`, so every midnight row counted as having a clock. Measured
   * on `RTC Data`: that test said all 15,914 rows carried a time of day and
   * the arithmetic below says none of them do.
   */
  const clock = column =>
    `HOUR(${column})*3600 + MINUTE(${column})*60 + SECOND(${column})`
  const hasTimeOfDay = dateIsTemporal
    ? `, SUM(CASE WHEN ${clock(dialect.quote(date.name))} <> 0 THEN 1 ELSE 0 END) AS withTime`
    : ''

  try {
    const [checked] = await ask(row, async ({ query }) => query(
      `SELECT COUNT(*) AS seen, ${counts}${hasTimeOfDay} FROM ${dialect.quote(tag.table)}`, []
    ))

    /*
     * A `datetime` that already has the time of day needs no second half.
     *
     * Merging would take the day from one column and the clock from another
     * when the first column has both — at best the same answer, at worst a
     * different one, and either way a longer statement saying less.
     */
    if (dateIsTemporal && Number(checked?.withTime || 0) > 0) {
      stamps.set(key, null)
      return null
    }

    const seen = Number(checked?.seen || 0)
    if (seen > 0) {
      const index = orders.findIndex((_, at) => Number(checked?.[`bad${at}`] ?? 1) === 0)
      if (index >= 0) {
        const order = orders[index]
        const found = { sql: joined(order), date: date.name, time: time.name, order }
        stamps.set(key, found)
        return found
      }
    }
  } catch {
    // A table this cannot be asked about is one to leave alone.
  }

  stamps.set(key, null)
  return null
}

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
