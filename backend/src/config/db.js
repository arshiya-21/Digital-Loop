import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import mysql from 'mysql2/promise'

import { config } from './index.js'

/**
 * The database connection, and the helpers every write needs.
 *
 * MySQL, through a small pool. The schema itself is `database/schema.sql`,
 * applied at startup — SQL belongs in a .sql file, where it can be read,
 * diffed and handed to a DBA without going through JavaScript.
 *
 * **This used to be SQLite**, which needed no service and no native build, and
 * whose driver was synchronous. MySQL's is not, so everything that touches the
 * database is `await`ed: `db.prepare(sql).get(...)` kept its shape so the call
 * sites read the same, but every one of them is now asynchronous.
 *
 * Two things follow from that and are worth knowing:
 *
 *   - `init()` must finish before the server listens. Nothing may query before
 *     the schema is there.
 *   - A transaction gets its own connection. Queries made on the pool while a
 *     transaction is open are *not* in it — so `transaction()` hands its block
 *     a connection-scoped `tx` and the block must use that, not `db`.
 */

/** Set by `init()`. Nothing may query before then. */
let pool = null

const ready = () => {
  if (!pool) {
    throw new Error('The database is not connected yet — await init() before querying.')
  }
  return pool
}

/**
 * One row, every row, or the effect of a write.
 *
 * `execute` rather than `query`: it uses the prepared-statement protocol, so
 * values are sent separately from the SQL and cannot be read as SQL. `query`
 * is kept for statements MySQL will not prepare — DDL, and the schema file.
 */
function statements(runner) {
  return {
    prepare: sql => ({
      get: async (...params) => {
        const [rows] = await runner.execute(sql, params)
        return rows[0]
      },
      all: async (...params) => {
        const [rows] = await runner.execute(sql, params)
        return rows
      },
      run: async (...params) => {
        const [result] = await runner.execute(sql, params)
        return { changes: result.affectedRows, insertId: result.insertId }
      },
    }),
    /** For DDL and anything the prepared protocol refuses. */
    exec: async sql => {
      await runner.query(sql)
    },
  }
}

/** The pool-backed surface. Every call is a promise. */
export const db = {
  prepare: sql => statements(ready()).prepare(sql),
  exec: sql => statements(ready()).exec(sql),
}

export const now = () => new Date().toISOString()
export const uid = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`

/**
 * Connect, create the database if it is not there, and apply the schema.
 *
 * The database is created rather than assumed: a fresh machine should need one
 * MySQL account and nothing else. Creating it needs no rights beyond what
 * writing to it already needs.
 */
export async function init() {
  const { host, port, user, password, name } = config.database

  // A first connection without a database, purely to make sure it exists.
  const bootstrap = await mysql.createConnection({ host, port, user, password })
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${name}\` ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    )
  } finally {
    await bootstrap.end()
  }

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database: name,
    waitForConnections: true,
    // Small on purpose: this is a studio for a handful of people, and a large
    // pool only makes a stuck query harder to notice.
    connectionLimit: 8,
    /*
     * Layouts are large JSON documents — tens of kilobytes for a real line,
     * and a v6.8 studio document more again. That is well inside MySQL 8's
     * default `max_allowed_packet` of 64MB, which is a server setting rather
     * than a client one: a deployment that has lowered it is the one that has
     * to raise it again.
     */
    // Dates and decimals come back as strings rather than being reinterpreted:
    // every timestamp here is an ISO string we wrote ourselves.
    dateStrings: true,
  })

  const schemaPath = resolve(config.paths.root, 'database', 'schema.sql')
  await applySchema(readFileSync(schemaPath, 'utf8'))
  await migrate()

  return pool
}

/**
 * Changes `CREATE TABLE IF NOT EXISTS` cannot make.
 *
 * The schema file describes a database being created from nothing. A database
 * that already exists keeps whatever it was created with, so anything that
 * *removes* or *alters* has to be said separately — and said in a way that is
 * safe to run on every boot, because it does.
 *
 * Each step therefore asks first and acts only if it has to. Nothing here
 * swallows an error: a migration that fails quietly is a schema nobody can
 * reason about afterwards.
 */
async function migrate() {
  /*
   * `db_connection.engine` used to carry a CHECK listing the engines, so
   * adding MariaDB, PostgreSQL or Azure SQL meant editing the schema as well
   * as the route that validates them. The list now lives only in
   * `routes/connections.js`; this takes the old constraint off databases
   * created before that.
   */
  const [found] = await pool.query(
    `SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'db_connection'
       AND CONSTRAINT_TYPE = 'CHECK' AND CONSTRAINT_NAME = 'connection_engine'`
  )
  if (found.length) {
    await pool.query('ALTER TABLE db_connection DROP CHECK connection_engine')
    console.log('   ·  db_connection.engine: list of engines moved out of the schema')
  }

  /*
   * An SSH key may be generated here or supplied by whoever already has one,
   * and a supplied key is often protected by a passphrase. Databases created
   * before that was supported have no column for it.
   */
  const [passphrase] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'db_connection'
       AND COLUMN_NAME = 'tunnel_passphrase'`
  )
  if (!passphrase.length) {
    await pool.query('ALTER TABLE db_connection ADD COLUMN tunnel_passphrase TEXT NULL AFTER tunnel_public_key')
    console.log('   ·  db_connection.tunnel_passphrase: added')
  }
}

/**
 * Apply the schema, one statement at a time.
 *
 * The driver will not take several statements in one call unless multiple
 * statements are enabled, and enabling that for the life of the pool to save a
 * loop here would widen what a future injection could do.
 */
async function applySchema(sql) {
  const withoutComments = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  for (const statement of withoutComments.split(';')) {
    if (statement.trim()) await pool.query(statement)
  }
}

/** Close the pool — used by tests and a clean shutdown. */
export async function close() {
  if (pool) await pool.end()
  pool = null
}

/**
 * Append an audit entry. Every write endpoint calls this.
 *
 * Called from inside a `transaction()` block it must be handed that block's
 * `tx`, or the entry takes its own connection from the pool: it would commit
 * on its own and a rolled-back write would still be recorded as having
 * happened.
 */
export async function audit(actorId, action, entity, entityId, detail, runner = db) {
  await runner.prepare(
    `INSERT INTO audit_log (id, actor_id, action, entity, entity_id, detail, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid('aud'),
    actorId ?? null,
    action,
    entity,
    entityId ?? null,
    detail ? JSON.stringify(detail) : null,
    now()
  )
}

/**
 * Run `fn` inside a transaction, rolling back if it throws.
 *
 * `fn` is given a connection-scoped `tx` with the same `prepare`/`exec` shape,
 * and **must use it**. A query made through the module-level `db` while this
 * is open takes a different connection from the pool and is therefore outside
 * the transaction — it would commit on its own and survive a rollback.
 */
export async function transaction(fn) {
  const connection = await ready().getConnection()
  const tx = statements(connection)

  await connection.beginTransaction()
  try {
    const result = await fn(tx)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
