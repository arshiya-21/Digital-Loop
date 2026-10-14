import { db, uid, now, audit } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { created, noContent } from '../utils/respond.js'
import { badRequest, notFound, unprocessable } from '../utils/errors.js'
import { requireAdmin } from '../middleware/auth.js'
import { seal, sealingAvailable } from '../services/secrets.js'
import { generateTunnelKeyPair } from '../services/ssh-keys.js'
import { testConnection, introspect } from '../services/db-connect.js'

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

async function mustExist(id) {
  const row = await rowById(id)
  if (!row) throw notFound('No such database connection.')
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
        tunnel_private_key: null, tunnel_public_key: null,
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
  // Parenthesised: `await x.all().map(f)` reads `.map` off the promise.
  return (await db.prepare('SELECT * FROM db_connection ORDER BY label').all())
    .map(publicShape)
})

connections.get('/:id', async ({ user, params }) => {
  requireAdmin(user)
  return publicShape(await mustExist(params.id))
})

/* --------------------------------------------------------------- writing ---*/

connections.post('/', async ({ user, body }) => {
  requireAdmin(user)

  const fields = readBody(body, false)
  if (fields.port === undefined) fields.port = DEFAULT_PORT[fields.engine]

  if (await db.prepare('SELECT 1 FROM db_connection WHERE label = ?').get(fields.label)) {
    throw badRequest('label_taken', `A connection called "${fields.label}" already exists.`)
  }

  const id = uid('con')
  const row = {
    id,
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
    tunnel_private_key: null,
    tunnel_public_key: null,
    created_by: user.id,
    created_at: now(),
    updated_at: now(),
  }

  await db.prepare(
    `INSERT INTO db_connection
       (id, label, engine, host, port, database_name, username, password, use_tls,
        tunnel_host, tunnel_port, tunnel_user, tunnel_private_key, tunnel_public_key,
        created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.label, row.engine, row.host, row.port, row.database_name, row.username,
    row.password, row.use_tls, row.tunnel_host, row.tunnel_port, row.tunnel_user,
    row.tunnel_private_key, row.tunnel_public_key, row.created_by, row.created_at, row.updated_at
  )

  // The host and the user, never the password — an audit log is read often.
  await audit(user.id, 'connection.create', 'connection', id, {
    label: row.label, engine: row.engine, host: row.host, tunnelled: !!row.tunnel_host,
  })
  return created(publicShape(await rowById(id)))
})

connections.patch('/:id', async ({ user, params, body }) => {
  requireAdmin(user)
  const existing = await mustExist(params.id)

  const fields = readBody(body, true)
  if (!Object.keys(fields).length) return publicShape(existing)

  const columns = Object.keys(fields)
  await db.prepare(
    `UPDATE db_connection SET ${columns.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...columns.map(c => fields[c]), now(), existing.id)

  await audit(user.id, 'connection.update', 'connection', existing.id, {
    // Which fields changed, never their values: `password` here means a
    // password was replaced, not what it was replaced with.
    changed: columns,
  })
  return publicShape(await rowById(existing.id))
})

connections.delete('/:id', async ({ user, params }) => {
  requireAdmin(user)
  const existing = await mustExist(params.id)

  await db.prepare('DELETE FROM db_connection WHERE id = ?').run(existing.id)
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
  const existing = await mustExist(params.id)

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

/** Can it be reached? The answer is recorded so the panel can show it later. */
connections.post('/:id/test', async ({ user, params }) => {
  requireAdmin(user)
  const existing = await mustExist(params.id)

  const result = await testConnection(existing)
  await db.prepare(
    'UPDATE db_connection SET last_tested_at = ?, last_test_ok = ?, last_test_error = ? WHERE id = ?'
  ).run(now(), result.ok ? 1 : 0, result.ok ? null : String(result.error).slice(0, 500), existing.id)

  await audit(user.id, 'connection.test', 'connection', existing.id, { ok: result.ok })
  return result
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
  const existing = await mustExist(params.id)

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
