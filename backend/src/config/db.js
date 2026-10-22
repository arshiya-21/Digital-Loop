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

  /*
   * A line used to hold exactly one loop, enforced by a unique key. It now
   * holds as many as somebody draws — the one the plant is running, a rebuild
   * beside it, a trial — with one of them published at a time. Databases
   * created under the old rule still carry the key, which would refuse the
   * second loop with a duplicate-key error rather than the clear answer.
   */
  const [onePerLine] = await pool.query(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design'
       AND INDEX_NAME = 'design_one_per_line'
     LIMIT 1`
  )
  if (onePerLine.length) {
    await pool.query('ALTER TABLE design DROP INDEX design_one_per_line')
    console.log('   ·  design: a line may now hold more than one loop')
  }

  /*
   * A registered database belongs to the plant that registered it.
   *
   * They used to be global: every foundry saw every connection, which is one
   * plant's host and account on another plant's screen. The column is added
   * null for rows registered before this, and those stay visible to everyone
   * — vanishing from a loop that already reads them would be worse than being
   * over-shared, and claiming one for a foundry is a deliberate act rather
   * than a migration's guess.
   *
   * The label went with it: unique across the whole table, so two plants
   * could not each have a "Plant historian".
   */
  const [scoped] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'db_connection'
       AND COLUMN_NAME = 'foundry_id'`
  )
  if (!scoped.length) {
    await pool.query('ALTER TABLE db_connection ADD COLUMN foundry_id VARCHAR(80) NULL AFTER id')
    await pool.query('ALTER TABLE db_connection ADD KEY connection_by_foundry (foundry_id)')
    console.log('   ·  db_connection.foundry_id: added — databases belong to a plant')
  }

  const [globalLabel] = await pool.query(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'db_connection'
       AND INDEX_NAME = 'connection_label'
     LIMIT 1`
  )
  if (globalLabel.length) {
    await pool.query('ALTER TABLE db_connection DROP INDEX connection_label')
    await pool.query(
      'ALTER TABLE db_connection ADD UNIQUE KEY connection_label_per_foundry (foundry_id, label)'
    )
    console.log('   ·  db_connection: names are unique within a plant, not across all of them')
  }

  await adoptProceduresFromLayouts()
}

/**
 * Lift the written procedures out of the drawings they were stored inside.
 *
 * Every loop already has its SOPs: the studio copies its process templates
 * into `DOC.cps[].sop` and the whole document is stored as
 * `design_version.layout`, so the words reached the database — inside a 78 KB
 * JSON blob, one per version, that answers "draw this loop" and no other
 * question. `sop` and `sop_step` are where they belong; this is how the loops
 * that predate those tables get there.
 *
 * Only loops with no procedure rows at all are touched, and only their newest
 * version is read. A loop somebody has since edited through the API is left
 * exactly as it is: this fills a gap, it does not reconcile.
 */
async function adoptProceduresFromLayouts() {
  const [designs] = await pool.query(
    `SELECT d.id FROM design d
      WHERE NOT EXISTS (SELECT 1 FROM sop s WHERE s.design_id = d.id)`
  )
  if (!designs.length) return

  let written = 0
  for (const design of designs) {
    const [[version]] = await pool.query(
      'SELECT layout FROM design_version WHERE design_id = ? ORDER BY version DESC LIMIT 1',
      [design.id]
    )
    if (!version) continue

    let processes
    try {
      const layout = JSON.parse(version.layout)
      processes = layout?.DOC?.cps
    } catch {
      // A layout that will not parse is a broken row, not a missing procedure.
      continue
    }
    if (!Array.isArray(processes)) continue

    for (const process of processes) {
      const sop = process?.sop
      if (!process?.id || !sop) continue

      const id = uid('sop')
      const list = value => JSON.stringify(Array.isArray(value) ? value : [])
      const months = Number(sop.reviewMonths)

      await pool.query(
        `INSERT IGNORE INTO sop (id, design_id, process_id, process_name, no, title,
           version, status, owner, approver, effective_on, review_months, purpose,
           scope, roles, ppe, prestart, refs, revisions, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, design.id, String(process.id), String(process.name || ''),
          String(sop.no || ''), String(sop.title || ''), String(sop.version || '1.0'),
          /*
           * Kept at whatever the stored procedure says, defaulting to
           * Approved — that is what the panel has shown all along, and
           * calling them drafts now would change what every screen says
           * about procedures nobody has touched.
           */
          String(sop.status || 'Approved'), String(sop.owner || ''),
          String(sop.approver || ''),
          sop.effective ? String(sop.effective) : null,
          Number.isFinite(months) ? months : null,
          sop.purpose ? String(sop.purpose) : null,
          sop.scope ? String(sop.scope) : null,
          list(sop.roles), list(sop.ppe), list(sop.prestart),
          list(sop.refs), list(sop.revisions),
          'adopted from the loop', new Date().toISOString(),
        ]
      )

      const steps = Array.isArray(sop.steps) ? sop.steps : []
      for (const [index, step] of steps.entries()) {
        // A step is `{ t, key, crit, param }`; older ones are a bare string.
        const line = typeof step === 'string' ? { t: step } : step || {}
        if (!line.t) continue
        await pool.query(
          `INSERT IGNORE INTO sop_step (sop_id, ordinal, text, key_point, critical, param)
           VALUES (?,?,?,?,?,?)`,
          [id, index + 1, String(line.t), String(line.key || ''),
            line.crit ? 1 : 0, line.param ? String(line.param) : null]
        )
      }

      const reaction = Array.isArray(sop.reaction) ? sop.reaction : []
      for (const [index, row] of reaction.entries()) {
        const plan = typeof row === 'string' ? { action: row } : row || {}
        if (!plan.cond && !plan.action) continue
        await pool.query(
          'INSERT IGNORE INTO sop_reaction (sop_id, ordinal, cond, action, escalate) VALUES (?,?,?,?,?)',
          [id, index + 1, String(plan.cond || ''), String(plan.action || ''),
            String(plan.esc || '')]
        )
      }
      written += 1
    }
  }

  if (written) console.log(`   ·  sop: ${written} procedure(s) adopted out of stored layouts`)
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
