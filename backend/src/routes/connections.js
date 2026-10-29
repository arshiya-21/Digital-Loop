import { db, uid, now, audit } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { created, noContent } from '../utils/respond.js'
import { badRequest, notFound, unprocessable } from '../utils/errors.js'
import { requireAdmin } from '../middleware/auth.js'
import { seal, sealingAvailable } from '../services/secrets.js'
import { generateTunnelKeyPair } from '../services/ssh-keys.js'
import { testConnection, introspect, runQuery, forgetPools } from '../services/db-connect.js'

/**
 * `/api/v1/connections` — plant databases somebody registered.
 *
 * ⚠ The only credentials this service holds. The foundry's own database
 * arrives with the launch described but unreachable, and is never connected
 * to. A connection here is the opposite: an administrator gave Digital Loop a
 * host and a password, and it dials out itself.
 *
 * Four rules, all enforced below rather than by convention:
 *
 *   - **Administrators only**, every verb including the reads. There is
 *     nothing here an operator has any use for.
 *   - **No endpoint returns a secret.** `publicShape` is the only thing that
 *     ever reaches a response, and the password and private key are not in it.
 *     A password can be set and replaced; it cannot be read back.
 *   - **The private key never leaves.** It is generated here, sealed, and used
 *     only inside `db-connect.js`. The public half is returned, because that is
 *     the half somebody installs on the jump box.
 *   - **Nothing is stored unsealed.** Without `DL_SECRET_KEY` the endpoints
 *     that would write a credential refuse, rather than quietly storing a
 *     password in plain text.
 */

export const connections = createRouter()

/**
 * The database engines a connection may name, and what each one needs.
 *
 * `label` is what the studio shows; `port` is filled in when nobody says
 * otherwise; `tls` of `required` means the connection is refused without it,
 * which is the case for Azure SQL — it is reached over the public internet
 * and an unencrypted connection to it is a password sent in clear.
 *
 * MariaDB and MySQL share a wire protocol, and Azure SQL is SQL Server; they
 * are separate entries because what somebody has to fill in differs, and
 * because offering the name people actually use is the difference between a
 * setting they recognise and one they have to translate.
 */
export const ENGINE_CATALOGUE = [
  { id: 'mysql', label: 'MySQL', port: 3306, tls: 'optional' },
  { id: 'mariadb', label: 'MariaDB', port: 3306, tls: 'optional' },
  { id: 'postgres', label: 'PostgreSQL', port: 5432, tls: 'optional' },
  { id: 'sqlserver', label: 'SQL Server', port: 1433, tls: 'optional' },
  {
    id: 'azuresql',
    label: 'Azure SQL',
    port: 1433,
    tls: 'required',
    /** Azure wants the server's full name and often `user@server` as the login. */
    hint: 'Host looks like <server>.database.windows.net. Encryption is always on.',
  },
]

const ENGINES = ENGINE_CATALOGUE.map(engine => engine.id)
const DEFAULT_PORT = Object.fromEntries(ENGINE_CATALOGUE.map(e => [e.id, e.port]))
const REQUIRES_TLS = new Set(ENGINE_CATALOGUE.filter(e => e.tls === 'required').map(e => e.id))

/** What a connection looks like from outside. No secrets, ever. */
const publicShape = row => ({
  id: row.id,
  label: row.label,
  engine: row.engine,
  host: row.host,
  port: row.port,
  database: row.database_name,
  username: row.username,
  useTls: !!row.use_tls,
  /** Whether a password is set — never what it is. */
  hasPassword: !!row.password,
  tunnel: row.tunnel_host
    ? {
        host: row.tunnel_host,
        port: row.tunnel_port,
        user: row.tunnel_user,
        /** Public by definition: this is what goes in authorized_keys. */
        publicKey: row.tunnel_public_key,
        hasKey: !!row.tunnel_private_key,
        /** Whether the key is protected — never by what. */
        hasPassphrase: !!row.tunnel_passphrase,
      }
    : null,
  lastTest: row.last_tested_at
    ? { at: row.last_tested_at, ok: !!row.last_test_ok, error: row.last_test_error }
    : null,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const rowById = async id => await db.prepare('SELECT * FROM db_connection WHERE id = ?').get(id)

/**
 * Whether this session may see a registered database.
 *
 * A connection belongs to the foundry that registered it. It holds that
 * plant's host, account and password, and the tables it reads are that
 * plant's own — so another foundry has no business listing it, testing it or
 * linking a reading to it.
 *
 * `foundry_id` is null on connections registered before this existed. Those
 * stay visible to everyone rather than vanishing from loops that already read
 * them; claiming one for a foundry is a deliberate act, not a migration's
 * guess at which plant it belonged to.
 */
const belongsTo = (row, user) =>
  !row.foundry_id || String(row.foundry_id) === String(user.foundry?.id)

/**
 * The connection, or a 404.
 *
 * 404 rather than 403 for another plant's: whether they have a database
 * called that is not this caller's business either.
 */
async function mustExist(user, id) {
  const row = await rowById(id)
  if (!row || !belongsTo(row, user)) throw notFound('No such database connection.')
  return row
}

/** Storing a credential without a key would be storing it in plain text. */
function requireSealing() {
  if (sealingAvailable()) return
  throw unprocessable(
    'no_secret_key',
    'DL_SECRET_KEY is not set, so a database password cannot be stored safely. ' +
    'Set it in the environment and restart.'
  )
}

const text = value => (typeof value === 'string' ? value.trim() : '')

/**
 * Read the body of a create or an update.
 *
 * `partial` is what tells the two apart: creating demands a host and a
 * database, updating changes only what was sent. A password that is not
 * mentioned is left alone, and an empty string clears it — which is different
 * from not mentioning it, and is the only way to remove one.
 */
function readBody(body, partial) {
  const out = {}

  const label = text(body.label)
  if (label) out.label = label.slice(0, 120)
  else if (!partial) throw badRequest('invalid_field', '"label" is required.')

  if (body.engine !== undefined || !partial) {
    const engine = text(body.engine)
    if (!ENGINES.includes(engine)) {
      throw badRequest('invalid_field', `"engine" must be one of: ${ENGINES.join(', ')}.`)
    }
    out.engine = engine
  }

  if (body.host !== undefined || !partial) {
    const host = text(body.host)
    if (!host) throw badRequest('invalid_field', '"host" is required.')
    out.host = host.slice(0, 255)
  }

  if (body.port !== undefined) {
    const port = Number(body.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw badRequest('invalid_field', '"port" must be a port number.')
    }
    out.port = port
  }

  if (body.database !== undefined || !partial) {
    const database = text(body.database)
    if (!database) throw badRequest('invalid_field', '"database" is required.')
    out.database_name = database.slice(0, 128)
  }

  if (body.username !== undefined || !partial) {
    const username = text(body.username)
    if (!username) throw badRequest('invalid_field', '"username" is required.')
    out.username = username.slice(0, 128)
  }

  if (body.useTls !== undefined) out.use_tls = body.useTls ? 1 : 0

  // Absent means "leave it"; empty string means "remove it".
  if (body.password !== undefined) {
    requireSealing()
    out.password = body.password === '' ? null : seal(String(body.password))
  }

  /*
   * The jump box. `tunnel: null` turns it off and takes the key with it —
   * leaving a private key behind for a tunnel nobody uses is a credential
   * kept for no reason.
   */
  if (body.tunnel !== undefined) {
    if (body.tunnel === null) {
      Object.assign(out, {
        tunnel_host: null, tunnel_port: null, tunnel_user: null,
        tunnel_private_key: null, tunnel_public_key: null, tunnel_passphrase: null,
      })
    } else {
      const host = text(body.tunnel.host)
      const user = text(body.tunnel.user)
      if (!host || !user) {
        throw badRequest('invalid_field', '"tunnel" needs a host and a user, or must be null.')
      }
      const port = body.tunnel.port === undefined ? 22 : Number(body.tunnel.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw badRequest('invalid_field', '"tunnel.port" must be a port number.')
      }
      out.tunnel_host = host.slice(0, 255)
      out.tunnel_port = port
      out.tunnel_user = user.slice(0, 128)

      /*
       * A key somebody already has, rather than one generated here.
       *
       * The gateway this mirrors points `sshtunnel` at a key file on disk; the
       * equivalent here is pasting that file's contents once, after which it is
       * sealed and never readable again. `/keypair` remains for the other case
       * — no key yet, and a public half to install on the jump box.
       *
       * Absent means "leave it", empty string means "remove it", the same rule
       * the password follows.
       */
      if (body.tunnel.privateKey !== undefined) {
        const key = String(body.tunnel.privateKey)
        if (key.trim()) {
          if (!/BEGIN [A-Z ]*PRIVATE KEY/.test(key)) {
            throw badRequest(
              'invalid_field',
              '"tunnel.privateKey" does not look like a private key file. Paste the whole file, ' +
              'including the BEGIN and END lines.'
            )
          }
          requireSealing()
          out.tunnel_private_key = seal(key)
          // A supplied key has no public half here; whoever owns it has it.
          out.tunnel_public_key = null
        } else {
          out.tunnel_private_key = null
        }
      }

      if (body.tunnel.passphrase !== undefined) {
        const phrase = String(body.tunnel.passphrase)
        if (phrase) requireSealing()
        out.tunnel_passphrase = phrase ? seal(phrase) : null
      }
    }
  }

  /*
   * Azure SQL is reached across the public internet, so an unencrypted
   * connection to it is a password in clear on somebody else's network.
   * Forced rather than merely defaulted: a setting that can be turned off is
   * a setting that will be, on the machine where it matters most.
   */
  if (REQUIRES_TLS.has(out.engine)) out.use_tls = 1

  return out
}

/* --------------------------------------------------------------- reading ---*/

/**
 * What a connection may be, and what each engine needs filled in.
 *
 * The studio builds its "add a database" form from this, so the list of
 * engines lives in one place rather than being written out again in the
 * browser and drifting.
 */
connections.get('/engines', async ({ user }) => {
  requireAdmin(user)
  return { engines: ENGINE_CATALOGUE }
})

connections.get('/', async ({ user }) => {
  requireAdmin(user)
  // This plant's own, and the ones registered before they were scoped to a
  // plant at all — see `belongsTo`.
  // Parenthesised: `await x.all().map(f)` reads `.map` off the promise.
  return (await db.prepare(
    `SELECT * FROM db_connection
     WHERE foundry_id = ? OR foundry_id IS NULL
     ORDER BY label`
  ).all(String(user.foundry.id))).map(publicShape)
})

connections.get('/:id', async ({ user, params }) => {
  requireAdmin(user)
  return publicShape(await mustExist(user, params.id))
})

/* --------------------------------------------------------------- writing ---*/

connections.post('/', async ({ user, body }) => {
  requireAdmin(user)

  const fields = readBody(body, false)
  if (fields.port === undefined) fields.port = DEFAULT_PORT[fields.engine]

  // Within this plant. Another foundry calling one of its own databases
  // "Plant historian" is not this one's concern, and is not visible here.
  const taken = await db.prepare(
    `SELECT 1 FROM db_connection
     WHERE label = ? AND (foundry_id = ? OR foundry_id IS NULL)`
  ).get(fields.label, String(user.foundry.id))
  if (taken) {
    throw badRequest('label_taken', `A connection called "${fields.label}" already exists.`)
  }

  const id = uid('con')
  const row = {
    id,
    /** The plant that registered it, and the only one that may read it. */
    foundry_id: String(user.foundry.id),
    label: fields.label,
    engine: fields.engine,
    host: fields.host,
    port: fields.port,
    database_name: fields.database_name,
    username: fields.username,
    password: fields.password ?? null,
    use_tls: fields.use_tls ?? 0,
    tunnel_host: fields.tunnel_host ?? null,
    tunnel_port: fields.tunnel_port ?? null,
    tunnel_user: fields.tunnel_user ?? null,
    /*
     * The key as it was sent, sealed.
     *
     * These were hard-coded null, from when the only way to have a key was to
     * generate one here with `/keypair`. Pasting an existing key came later
     * and this did not move with it: a connection registered with a tunnel was
     * stored with its host, port and user and without the key — so the form
     * insisted on a key, said it had saved, and the tunnel could never
     * authenticate. Nothing said so until the first read failed.
     */
    tunnel_private_key: fields.tunnel_private_key ?? null,
    tunnel_public_key: fields.tunnel_public_key ?? null,
    tunnel_passphrase: fields.tunnel_passphrase ?? null,
    created_by: user.id,
    created_at: now(),
    updated_at: now(),
  }

  await db.prepare(
    `INSERT INTO db_connection
       (id, foundry_id, label, engine, host, port, database_name, username, password, use_tls,
        tunnel_host, tunnel_port, tunnel_user, tunnel_private_key, tunnel_public_key,
        tunnel_passphrase, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.foundry_id, row.label, row.engine, row.host, row.port, row.database_name,
    row.username, row.password, row.use_tls, row.tunnel_host, row.tunnel_port, row.tunnel_user,
    row.tunnel_private_key, row.tunnel_public_key, row.tunnel_passphrase,
    row.created_by, row.created_at, row.updated_at
  )

  // The host and the user, never the password — an audit log is read often.
  await audit(user.id, 'connection.create', 'connection', id, {
    label: row.label, engine: row.engine, host: row.host, tunnelled: !!row.tunnel_host,
  })
  return created(publicShape(await rowById(id)))
})

connections.patch('/:id', async ({ user, params, body }) => {
  requireAdmin(user)
  const existing = await mustExist(user, params.id)

  const fields = readBody(body, true)
  if (!Object.keys(fields).length) return publicShape(existing)

  const columns = Object.keys(fields)
  await db.prepare(
    `UPDATE db_connection SET ${columns.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...columns.map(c => fields[c]), now(), existing.id)

  /*
   * The kept-open connections to the old settings are closed.
   *
   * Reads are served from a pool now — see `poolFor` — so a connection
   * re-pointed at another host, or given a new password, would otherwise go
   * on being read through connections opened under the old ones until they
   * timed out. The next read opens a pool against what was just saved.
   */
  await forgetPools(existing.id)

  await audit(user.id, 'connection.update', 'connection', existing.id, {
    // Which fields changed, never their values: `password` here means a
    // password was replaced, not what it was replaced with.
    changed: columns,
  })
  return publicShape(await rowById(existing.id))
})

connections.delete('/:id', async ({ user, params }) => {
  requireAdmin(user)
  const existing = await mustExist(user, params.id)

  await db.prepare('DELETE FROM db_connection WHERE id = ?').run(existing.id)
  /*
   * And the list of tables somebody chose to show for it.
   *
   * A filter outlives its database otherwise: a row keyed `conn:<id>` for a
   * connection nobody can see, kept until the table is read by hand.
   */
  await db.prepare('DELETE FROM table_filter WHERE scope = ?').run(`conn:${existing.id}`)
  // And the connections held open to it, which nothing will read again.
  await forgetPools(existing.id)
  await audit(user.id, 'connection.delete', 'connection', existing.id, { label: existing.label })
  return noContent()
})

/* ------------------------------------------------------------- the tunnel ---*/

/**
 * Make a keypair for this connection's jump box.
 *
 * Generated here rather than pasted in, so the private key never exists in a
 * browser, a clipboard or a chat message. The public half comes back to be
 * installed in `authorized_keys`; the private half is sealed and is not
 * readable through any endpoint.
 *
 * Calling this again replaces the pair, which breaks the connection until the
 * new public key is installed. That is said plainly in the response rather
 * than discovered later.
 */
connections.post('/:id/keypair', async ({ user, params }) => {
  requireAdmin(user)
  requireSealing()
  const existing = await mustExist(user, params.id)

  const { privateKey, publicKey } = generateTunnelKeyPair(`digital-loop-${existing.label}`)
  await db.prepare(
    'UPDATE db_connection SET tunnel_private_key = ?, tunnel_public_key = ?, updated_at = ? WHERE id = ?'
  ).run(seal(privateKey), publicKey, now(), existing.id)

  await audit(user.id, 'connection.keypair', 'connection', existing.id, { replaced: !!existing.tunnel_public_key })
  return {
    publicKey,
    replaced: !!existing.tunnel_public_key,
    install: `Add this line to ~/.ssh/authorized_keys for ${existing.tunnel_user || 'the tunnel user'} ` +
      `on ${existing.tunnel_host || 'the jump box'}.`,
  }
})

/* -------------------------------------------------------- using the thing ---*/

/**
 * Can these settings be reached? Nothing is stored, and nothing is changed.
 *
 * Pressing Test used to mean saving first, because the only test there was
 * tested a stored row. That is the wrong way round: somebody checking a host
 * and a password has not decided to keep them, and a failed test would leave a
 * half-right connection behind for them to find and delete.
 *
 * So this takes the form's contents, seals the secrets in memory, tries them,
 * and lets all of it fall out of scope. The sealing is not ceremony: every
 * engine below reads its password through `unseal`, so a row shaped like a
 * stored one is what makes this the same code path rather than a second one
 * that could drift.
 *
 * A reply never echoes anything that was sent.
 */
connections.post('/test', async ({ user, body }) => {
  requireAdmin(user)

  // A name is for the list, not for connecting — testing before naming it is
  // the normal order, so one is stood in rather than demanded.
  const fields = readBody({ ...body, label: text(body.label) || 'Untitled' }, false)
  const row = {
    engine: fields.engine,
    host: fields.host,
    port: fields.port ?? DEFAULT_PORT[fields.engine],
    database_name: fields.database_name,
    username: fields.username,
    password: fields.password ?? null,
    use_tls: fields.use_tls ?? 0,
    tunnel_host: fields.tunnel_host ?? null,
    tunnel_port: fields.tunnel_port ?? null,
    tunnel_user: fields.tunnel_user ?? null,
    tunnel_private_key: fields.tunnel_private_key ?? null,
    tunnel_passphrase: fields.tunnel_passphrase ?? null,
  }

  /*
   * An existing connection being edited may be tested without its password
   * being typed again — the form leaves the field blank to keep what is
   * stored. `use` names that row, and only its secrets are borrowed.
   */
  const borrowFrom = text(body.use)
  if (borrowFrom) {
    const stored = await mustExist(user, borrowFrom)
    if (row.password === null) row.password = stored.password
    if (row.tunnel_private_key === null) row.tunnel_private_key = stored.tunnel_private_key
    if (row.tunnel_passphrase === null) row.tunnel_passphrase = stored.tunnel_passphrase
  }

  const result = await testConnection(row)

  /*
   * How many tables are in it, while the settings are in hand.
   *
   * Without this the browser would have to save in order to count, which is
   * the thing this endpoint exists to avoid. A database that answers but whose
   * tables cannot be listed is still reachable, so the count is omitted rather
   * than turning the whole test into a failure.
   */
  let tableCount = null
  if (result.ok) {
    try {
      tableCount = (await introspect(row)).tables.length
    } catch { /* reachable, not readable — said by the absent count */ }
  }

  await audit(user.id, 'connection.try', 'connection', borrowFrom || null, {
    engine: row.engine, host: row.host, ok: result.ok, stored: false,
  })
  return { ...result, tableCount }
})

/** Can it be reached? The answer is recorded so the panel can show it later. */
connections.post('/:id/test', async ({ user, params }) => {
  requireAdmin(user)
  const existing = await mustExist(user, params.id)

  const result = await testConnection(existing)
  await db.prepare(
    'UPDATE db_connection SET last_tested_at = ?, last_test_ok = ?, last_test_error = ? WHERE id = ?'
  ).run(now(), result.ok ? 1 : 0, result.ok ? null : String(result.error).slice(0, 500), existing.id)

  await audit(user.id, 'connection.test', 'connection', existing.id, { ok: result.ok })
  return result
})

/**
 * POST /api/v1/connections/:id/query — run one SELECT and show the rows.
 *
 * Picking a table and a column answers "link this reading to that"; it does
 * not answer "is there anything in there, and what does it look like?". That
 * question is asked in SQL, and asking it anywhere else means leaving the
 * studio, finding a client, and finding the credentials — which are here and
 * deliberately unreadable.
 *
 * So: one SELECT, against one registered database, by an administrator of the
 * foundry that registered it. `runQuery` holds the fence — one statement,
 * SELECT or WITH only, a read-only transaction that is rolled back, a row cap
 * and the engine's query timeout. Nothing is stored and no reading changes.
 *
 * The statement is audited without its text: what was asked of a plant
 * database is between the administrator and that database, and an audit log
 * is read often and by more people.
 */
connections.post('/:id/query', async ({ user, params, body }) => {
  requireAdmin(user)
  const existing = await mustExist(user, params.id)

  const started = Date.now()
  let answer
  try {
    answer = await runQuery(existing, body?.sql, body?.limit)
  } catch (error) {
    /*
     * The database's own words, trimmed — "Unknown column 'x' in field list"
     * is the whole point of pressing Run, and it names nothing secret. A
     * refusal from `runQuery` arrives the same way.
     */
    throw unprocessable('query_failed', String(error?.message || 'That query could not be run.').slice(0, 400))
  }

  await audit(user.id, 'connection.query', 'connection', existing.id, {
    label: existing.label, rows: answer.rowCount, ms: Date.now() - started,
  })

  return { ...answer, via: existing.label, tookMs: Date.now() - started }
})

/**
 * The tables and columns, in the same shape the foundry's own database comes
 * in — so the studio's dropdowns cannot tell the two apart.
 *
 * Read live rather than cached: a schema that changed is the reason somebody
 * presses this.
 */
connections.get('/:id/schema', async ({ user, params }) => {
  requireAdmin(user)
  const existing = await mustExist(user, params.id)

  const schema = await introspect(existing)
  return {
    connectionId: existing.id,
    label: existing.label,
    name: schema.name,
    tableCount: schema.tables.length,
    columnCount: schema.tables.reduce((total, table) => total + table.columns.length, 0),
    tables: schema.tables,
  }
})
