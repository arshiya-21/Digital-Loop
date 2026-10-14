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
    throw new Error('This connection is set to use a jump box but has no key. Generate one first.')
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
      readyTimeout: CONNECT_TIMEOUT_MS,
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
      query: async sql => (await connection.query({ sql, timeout: QUERY_TIMEOUT_MS }))[0],
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
    return await question({ query: async sql => (await pool.request().query(sql)).recordset })
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
    return await question({ query: async sql => (await client.query(sql)).rows })
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
