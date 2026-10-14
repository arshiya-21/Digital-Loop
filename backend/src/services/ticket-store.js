import { db, now } from '../config/db.js'

/**
 * Launch tickets, and making sure they do not linger.
 *
 * A ticket is the only thing in this database that holds personal data: the
 * whole launch payload — a name, an email, the plant, its lines, and the names
 * of every table in its database. It exists for the seconds between SandMan
 * minting it and the browser posting it back.
 *
 * So it is deleted on redemption rather than marked used, and anything an
 * abandoned launch or a crash left behind is swept away on a timer. "Deleted
 * when it expires" and "marked redeemed and kept" look similar in a schema and
 * are completely different on a disk somebody later copies.
 *
 * **On SQLite this needed more care than it does here.** A deleted row's bytes
 * stayed in free pages of the file until something overwrote them, so the
 * clear had to `VACUUM` and truncate the write-ahead log as well — payloads
 * were found still readable in a four-megabyte `-wal` file after the rows had
 * gone. InnoDB reuses freed space inside its own tablespace, which is not the
 * same guarantee but is also not a file somebody copies off a disk: the
 * database is reached through an account, and the rows are gone from it.
 *
 * `OPTIMIZE TABLE` is what is left of that — it rebuilds the table and returns
 * the space. It is run once, not on every sweep, because it locks the table
 * for the rebuild and the sweep runs every minute.
 */

/** How often to sweep. Cheap: an indexed delete over a table of a few rows. */
const SWEEP_MS = 60_000

/** Remove every ticket whose moment has passed. Returns how many went. */
export async function purgeExpiredTickets() {
  const result = await db.prepare('DELETE FROM launch_ticket WHERE expires_at < ?').run(now())
  return { removed: result.changes }
}

/**
 * The one-time clear, at startup.
 *
 * Anything still here when the service starts is unusable — redeemed or
 * expired, all of it — and all of it is personal data, so it goes, and the
 * table is rebuilt so the space is actually returned rather than merely freed
 * for reuse.
 */
export async function purgeTicketsOnce() {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM launch_ticket').get()
  const before = Number(row?.n || 0)
  if (!before) return { removed: 0, rebuilt: false }

  await db.prepare('DELETE FROM launch_ticket').run()
  // Not inside a transaction: OPTIMIZE TABLE commits implicitly.
  await db.exec('OPTIMIZE TABLE launch_ticket')

  return { removed: before, rebuilt: true }
}

/** Sweep on a timer. Returns the interval so a shutdown can clear it. */
export function startTicketSweeper() {
  const timer = setInterval(() => {
    purgeExpiredTickets().catch(error => {
      // A failed sweep is not a reason to take the server down; the next one
      // is a minute away. The message only — never a row.
      console.error(`   !  ticket sweep failed  ${error.message}`)
    })
  }, SWEEP_MS)

  // Nothing should be held open by this.
  timer.unref?.()
  return timer
}
