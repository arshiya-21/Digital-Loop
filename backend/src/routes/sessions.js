import { timingSafeEqual } from 'node:crypto'

import { db, uid, now, audit } from '../config/db.js'
import { config } from '../config/index.js'
import { createRouter } from '../utils/router.js'
import { created, rawReply } from '../utils/respond.js'
import { badRequest, unauthorized, forbidden } from '../utils/errors.js'
import { isOnline } from '../services/sandman.js'
import { openSession, closeSession } from '../services/session-store.js'
import { sessionCookie, clearedCookie, tokenFromRequest } from '../middleware/auth.js'
import { launchAllowed } from '../utils/launch-allowlist.js'

/**
 * `/api/v1/session` — arriving from SandMan.
 *
 * The studio is not somewhere you can browse to. SandMan launches it:
 *
 *   1. SandMan calls POST /launch server-to-server, proving itself with the
 *      shared secret, and gets a short-lived single-use ticket.
 *   2. SandMan's page posts that ticket into a full-page iframe as a form:
 *      POST /session/enter, `ticket=…`, urlencoded.
 *   3. /enter redeems it, opens the session, sets an HttpOnly cookie and
 *      redirects the iframe to "/" — but only while SandMan is still running.
 *
 * **The ticket never appears in a URL.** It used to arrive as `?ticket=…`,
 * which put a working credential into the address bar, the browser's history,
 * the iframe's referrer and any log that records a request line. A POST body
 * is in none of those. For the same reason the session token is only ever a
 * cookie: never a URL, never a response body, never anything script can read.
 *
 * The launch body is the whole of what this service knows about the
 * organisation: who is arriving, their role, their foundry and its lines, and
 * — names only — that foundry's database. Nothing is provisioned from it:
 * there is no account here to create, no foundry to mirror and no database to
 * connect to. It lives on the ticket for seconds, then in memory, and is gone
 * when the session expires.
 *
 * The browser never holds the secret and cannot mint a launch. GET /sandman is
 * what the studio polls to notice SandMan going away, at which point it locks
 * itself.
 *
 * These are mounted WITHOUT `authenticate`: they are how a caller becomes
 * authenticated in the first place.
 */

export const session = createRouter()

function requireLaunchOrigin(req) {
  const from = req.socket?.remoteAddress
  if (launchAllowed(from)) return
  // The address, and nothing else: this is the one log line an attacker gets
  // to influence, so it carries no header and no body.
  console.warn(`   !  launch refused from ${from} — not in LAUNCH_ALLOWED_IPS`)
  throw forbidden('Launches are not accepted from this address.')
}

/**
 * Compare the shared secret without leaking its length or contents by timing.
 *
 * `===` on strings returns as soon as two bytes differ, so the time it takes
 * says how much of a guess was right. `timingSafeEqual` does not — but it
 * throws on a length mismatch, which would itself be a signal, so both sides
 * are hashed to a fixed width first.
 */
function secretMatches(offered) {
  if (typeof offered !== 'string' || !offered) return false
  const a = Buffer.from(offered)
  const b = Buffer.from(config.sandman.secret)
  if (a.length !== b.length) {
    // Still do the work, so a wrong length is not the fastest answer.
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}

// Deliberately not async: it only compares a header, and an async guard whose
// throw somebody forgot to await is a rejected promise rather than a 401.
const requireSandMan = req => {
  if (!secretMatches(req.get('x-sandman-secret'))) {
    throw unauthorized('This endpoint is for SandMan, and the shared secret did not match.')
  }
}

/** Is SandMan running? The studio locks the canvas when this turns false. */
session.get('/sandman', async () => ({
  online: await isOnline(),
  /**
   * Where "Back" goes. SandMan's own pages, not the machine-to-machine
   * endpoint this service polls — sending somebody there is a 404, which is
   * what the back link used to do.
   */
  url: config.sandman.url + config.sandman.homePath,
}))

const text = value => (typeof value === 'string' ? value.trim() : '')

/**
 * How big a database description may be.
 *
 * Munjal Kiru's is about 239 tables and 5,000 columns — roughly 250 KB of
 * JSON — so these are far above anything real and exist only so a malformed or
 * runaway payload is refused with a clear message rather than sat on in memory
 * for twelve hours. The request body limit (8 MB) is the outer bound.
 */
const DATABASE_LIMITS = {
  name: 128,
  tables: 5000,
  columnsPerTable: 4096,
  columnsTotal: 200000,
  identifier: 128,
  type: 64,
}

/**
 * The foundry's database, as SandMan describes it.
 *
 * Names only: the database name, its tables, and each table's columns with
 * their types. **No credentials are sent and none would be accepted.** Digital
 * Loop never connects to this database — the description exists so that
 * tagging a piece of equipment is choosing from a list rather than typing a
 * string and hoping it matches something.
 *
 * Optional. A launch without one still opens the studio; the data-source
 * dropdowns simply fall back to a plain tag field, which is how every design
 * drawn before this worked.
 */
function readDatabase(raw) {
  if (raw === undefined || raw === null) return null

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('invalid_field', '"database" must be an object, or be left out.')
  }

  const name = text(raw.name)
  if (!name || name.length > DATABASE_LIMITS.name) {
    throw badRequest('invalid_field', '"database.name" is required and must be a short string.')
  }

  const rawTables = raw.tables === undefined ? [] : raw.tables
  if (!Array.isArray(rawTables)) {
    throw badRequest('invalid_field', '"database.tables" must be a list.')
  }
  if (rawTables.length > DATABASE_LIMITS.tables) {
    throw badRequest('invalid_field', `"database.tables" exceeds ${DATABASE_LIMITS.tables} tables.`)
  }

  let columnsTotal = 0
  const tables = rawTables.map((table, index) => {
    const where = `"database.tables[${index}]"`
    if (!table || typeof table !== 'object') {
      throw badRequest('invalid_field', `${where} must be an object with a name and columns.`)
    }

    const tableName = text(table.name)
    if (!tableName || tableName.length > DATABASE_LIMITS.identifier) {
      throw badRequest('invalid_field', `${where}.name is required.`)
    }

    const rawColumns = table.columns === undefined ? [] : table.columns
    if (!Array.isArray(rawColumns) || rawColumns.length > DATABASE_LIMITS.columnsPerTable) {
      throw badRequest(
        'invalid_field',
        `${where}.columns must be a list of at most ${DATABASE_LIMITS.columnsPerTable} columns.`
      )
    }

    columnsTotal += rawColumns.length
    if (columnsTotal > DATABASE_LIMITS.columnsTotal) {
      throw badRequest(
        'invalid_field',
        `"database" describes more than ${DATABASE_LIMITS.columnsTotal} columns.`
      )
    }

    const columns = rawColumns.map((column, at) => {
      if (!column || typeof column !== 'object') {
        throw badRequest('invalid_field', `${where}.columns[${at}] must be an object.`)
      }
      const columnName = text(column.name)
      if (!columnName || columnName.length > DATABASE_LIMITS.identifier) {
        throw badRequest('invalid_field', `${where}.columns[${at}].name is required.`)
      }
      return { name: columnName, type: text(column.type).slice(0, DATABASE_LIMITS.type) }
    })

    return { name: tableName, columns }
  })

  return { name, tables }
}

/**
 * Check the launch describes a real plant, and normalise it.
 *
 * A launch missing its foundry or its lines would open a studio with nothing
 * in it and no way to say why, so it is refused here rather than puzzled over
 * later. SandMan is the only caller, and a clear 400 tells whoever is wiring it
 * up exactly what they left out.
 *
 * Ids arrive from SandMan as numbers as often as strings — they are database
 * primary keys over there. Normalising to strings once here means every later
 * comparison is a plain string comparison rather than a `==` waiting to go
 * wrong.
 */
function readLaunch(body) {
  const user = text(body.user)
  if (!user) throw badRequest('invalid_field', '"user" is required.')

  const role = text(body.role)
  if (role !== 'admin' && role !== 'viewer') {
    throw badRequest('invalid_field', '"role" must be "admin" or "viewer".')
  }

  const foundry = text(String(body.foundry ?? ''))
  if (!foundry) throw badRequest('invalid_field', '"foundry" is required.')

  const foundryName = text(body.foundryName)
  if (!foundryName) throw badRequest('invalid_field', '"foundryName" is required.')

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw badRequest('invalid_field', '"lines" must list at least one production line.')
  }

  const lines = body.lines.map((line, index) => {
    const id = text(String(line?.id ?? ''))
    const name = text(line?.name)
    if (!id || !name) {
      throw badRequest('invalid_field', `"lines[${index}]" needs both an id and a name.`)
    }
    return { id, name }
  })

  const line = text(String(body.line ?? ''))
  if (line && !lines.some(entry => entry.id === line)) {
    throw badRequest('invalid_field', '"line" is not one of the lines in "lines".')
  }

  return {
    user,
    name: text(body.name) || user,
    email: text(body.email) || null,
    role,
    foundry,
    foundryName,
    lines,
    line: line || null,
    /** The foundry's own database, described but never connected to. */
    database: readDatabase(body.database),
  }
}

/** Mint a launch ticket. SandMan's server only, and from its address only. */
session.post('/launch', async ({ body, req }) => {
  // The address first, then the secret: an attacker who cannot reach the
  // endpoint never gets to make guesses at the secret at all.
  requireLaunchOrigin(req)
  requireSandMan(req)

  const launch = readLaunch(body)
  const id = uid('tkt')
  const expires = new Date(Date.now() + config.sandman.ticketSeconds * 1000).toISOString()

  await db.prepare(
    'INSERT INTO launch_ticket (id, payload, issued_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(id, JSON.stringify(launch), now(), expires)

  await audit(launch.user, 'session.launch', 'session', id, {
    foundry: launch.foundry,
    lines: launch.lines.length,
    // The name and the size, never the content: the audit log is read often and
    // a quarter of a megabyte of table names in every launch row would drown it.
    database: launch.database?.name || null,
    tables: launch.database?.tables.length ?? 0,
  })
  return created({ ticket: id, expiresAt: expires })
})

/**
 * Turn a posted ticket into a session. **The only way in.**
 *
 * SandMan's page submits a hidden form into a full-page iframe:
 *
 *     POST /api/v1/session/enter      ticket=<ticket>    (urlencoded)
 *
 * and this answers `303 See Other` to "/", so the iframe lands on the studio
 * with a cookie and a clean URL. The ticket was in a request body, so it is
 * not in the address bar, the history, the referrer or any access log.
 *
 * Three things happen together or not at all: the ticket is checked, the
 * session is opened in memory, and the ticket **row is deleted**. Deleting
 * rather than marking it used is the point — the row holds a name, an email
 * and the plant's table names, and the shortest time it can exist for is the
 * right one.
 *
 * Failure sets no cookie and still redirects to "/", where the studio shows
 * its locked screen. The reason is deliberately not put in the URL: it would
 * say, to anybody who could read it, whether a ticket was real.
 */
session.post('/enter', async ({ req }) => {
  const landing = { location: `${config.basePath}/`, 'cache-control': 'no-store' }

  const refuse = () => rawReply(303, landing, '')

  if (!(await isOnline())) return refuse()

  const offered = typeof req.body?.ticket === 'string' ? req.body.ticket.trim() : ''
  if (!offered) return refuse()

  const ticket = await db.prepare('SELECT * FROM launch_ticket WHERE id = ?').get(offered)
  if (!ticket) return refuse()

  // Gone either way: a ticket that is being refused for age is still a ticket
  // whose payload has no reason to survive the request.
  await db.prepare('DELETE FROM launch_ticket WHERE id = ?').run(ticket.id)
  if (new Date(ticket.expires_at) < new Date()) return refuse()

  const opened = openSession(JSON.parse(ticket.payload))
  // The username and the ticket id. Never the payload, the email or the tables.
  await audit(opened.user.sandmanUserId, 'session.enter', 'session', ticket.id, {})

  return rawReply(303, { ...landing, 'set-cookie': sessionCookie(opened.token) }, '')
})

/** Give the session up, and take the cookie with it. */
session.post('/end', async ({ req }) => {
  const token = tokenFromRequest(req)
  const ended = closeSession(token)
  return rawReply(200, { 'set-cookie': clearedCookie() }, JSON.stringify({ ended }))
})
