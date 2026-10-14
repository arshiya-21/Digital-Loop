import { randomBytes } from 'node:crypto'

import { config } from '../config/index.js'

/**
 * Who is signed in, and what they may see.
 *
 * Held in memory on purpose. This application has no account store and no copy
 * of SandMan's organisation: everything it knows about a person — their name,
 * their role, their foundry and its lines — arrives with the launch SandMan
 * minted for them and is forgotten when the session expires or the process
 * restarts. There is nothing to leak and nothing to drift out of date.
 *
 * A restart signs everybody out, which is the honest consequence: the studio
 * opens *through* SandMan, so being sent back there to open it again costs one
 * click and keeps this service free of a second identity system.
 *
 * The token is 32 random bytes, not a username. The old stub took the bearer
 * token as a user id, which meant anyone could claim to be anyone; a session
 * token can only come from a ticket, and a ticket only from SandMan.
 */

const sessions = new Map()

/** Drop everything that has expired. Cheap, and keeps the map from growing. */
function sweep() {
  const cutoff = Date.now()
  for (const [token, session] of sessions) {
    if (session.expiresAt <= cutoff) sessions.delete(token)
  }
}

/**
 * Open a session from a redeemed launch.
 *
 * The payload has already been validated by `/session/launch`, so this stores
 * it as the record of what the caller may reach for the next twelve hours.
 */
export function openSession(launch) {
  sweep()

  const token = randomBytes(32).toString('hex')
  const session = {
    token,
    user: {
      sandmanUserId: launch.user,
      name: launch.name || launch.user,
      email: launch.email || null,
      role: launch.role,
    },
    foundry: { id: launch.foundry, name: launch.foundryName },
    lines: launch.lines,
    /** The line SandMan opened on, when it named one. */
    lineId: launch.line || null,
    /**
     * The foundry's database as SandMan described it — its name, its tables and
     * their columns. Names only, and held for the life of the session like
     * everything else here. There are no credentials in it and nothing opens a
     * connection from it; it is the list the data-source dropdowns are built
     * from. Null when the launch did not include one.
     */
    database: launch.database || null,
    openedAt: Date.now(),
    expiresAt: Date.now() + config.session.hours * 3600 * 1000,
  }

  sessions.set(token, session)
  return session
}

/** The session behind a bearer token, or null. Expiry is checked on every read. */
export function readSession(token) {
  if (!token) return null

  const session = sessions.get(token)
  if (!session) return null

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }

  return session
}

/** End one session — used when the studio signs out. */
export function closeSession(token) {
  return sessions.delete(token)
}

/** How many sessions are open. Exposed for tests and diagnostics only. */
export const sessionCount = () => {
  sweep()
  return sessions.size
}
