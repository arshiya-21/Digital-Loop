import { db } from '../config/db.js'
import { canDesign } from '../middleware/auth.js'
import { notFound } from '../utils/errors.js'

/**
 * Which readings a caller may ask SandMan for, and where they point.
 *
 * **The browser sends a loop id and, for a chart, a tag id. Nothing else.**
 * Not the foundry, not the line, not the database, table or column. Those are
 * taken from the session and from the layout stored on the server, so a caller
 * cannot point a reading at a table they were never given — which is the whole
 * of the access control here, and the reason this lives in one file rather
 * than in each handler.
 *
 * Three narrowings, in order:
 *
 *   1. **The loop.** `loopToView` already refuses a loop outside the session's
 *      foundry or lines, and refuses an unpublished one to anybody who is not
 *      an administrator.
 *   2. **The version.** An operator reads the published version's tags; an
 *      administrator reads the latest, which is what they are looking at.
 *      Reading the draft's tags as an operator would leak a design that has
 *      deliberately not been published.
 *   3. **The database.** Only links into the foundry's own database — the one
 *      SandMan named in the launch. A layout may carry links to other sources
 *      (a historian, an OPC server, a database somebody registered); those are
 *      not SandMan's to answer for, so they are ignored rather than refused.
 */

/** The studio's name for "the foundry's own database, from the launch". */
const CUSTOMER = 'customer'

/** SandMan accepts at most this many tags in one call. */
export const MAX_TAGS = 200

/**
 * The version of a loop this caller is looking at.
 *
 * Returns the parsed layout, or throws if there is nothing to look at. The
 * choice mirrors `GET /loops/:loopId` exactly — if the two ever disagreed, a
 * reading would be served for a version that is not on screen.
 */
export async function visibleLayout(user, loop) {
  const row = canDesign(user)
    ? await db
      .prepare('SELECT layout FROM design_version WHERE design_id = ? ORDER BY version DESC LIMIT 1')
      .get(loop.id)
    : await db.prepare('SELECT layout FROM design_version WHERE id = ?')
      .get(loop.published_version_id)

  if (!row) throw notFound('This digital loop has no version yet.')
  try {
    return JSON.parse(row.layout)
  } catch {
    // A layout that will not parse is a broken row, not a missing one — but
    // there is nothing to read from it either way.
    throw notFound('This version of the loop could not be read.')
  }
}

/**
 * Every reading in a layout that points at the foundry's own database.
 *
 * A reading is a `REG` entry; the ones that matter here are those whose `link`
 * says `src: 'customer'`, which is how the studio records "the database
 * SandMan sent with the launch". `link.db` is checked against the session's
 * database name as well: a layout saved for one foundry and somehow opened
 * under another must not read that other foundry's tables.
 *
 * `keyColumn`/`keyValue` are the row filter — which machine on the line a row
 * belongs to — and are passed on only when the layout set them.
 */
export function linkedTags(layout, databaseName) {
  const readings = layout?.REG
  if (!readings || typeof readings !== 'object' || !databaseName) return []

  const out = []
  for (const [id, reading] of Object.entries(readings)) {
    const link = reading?.link
    if (!link || link.src !== CUSTOMER) continue
    if (String(link.db || '') !== String(databaseName)) continue
    if (!link.table || !link.col) continue

    const tag = { id, table: String(link.table), column: String(link.col) }
    if (link.keyCol) tag.keyColumn = String(link.keyCol)
    if (link.keyVal) tag.keyValue = String(link.keyVal)
    // How it compares: =, <>, >, <, >= or <=. Checked against a list server
    // side, never interpolated — see `comparison` in db-connect.js.
    if (link.keyOp) tag.keyOp = String(link.keyOp)
    out.push(tag)
  }

  /*
   * Capped, and in a stable order.
   *
   * SandMan refuses more than 200, and a loop with more readings than that
   * should still show the ones it can rather than failing outright. Sorting by
   * id makes "the first 200" the same 200 on every poll, so a reading does not
   * flicker between live and demo as the object's key order changes.
   */
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out.slice(0, MAX_TAGS)
}

/** The studio's name for a database somebody registered here: `conn_<id>`. */
const REGISTERED = /^conn_([A-Za-z0-9_-]{1,120})$/

/**
 * Every reading in a layout that points at a database registered here.
 *
 * The counterpart to `linkedTags`: those are SandMan's to answer for, these
 * are ours. Grouped by connection, because reading them means opening that
 * database once and asking for all of its readings together rather than once
 * per reading.
 *
 * Same discipline as above — the table, the column and the row filter come
 * from the stored layout, and a reading missing either half of its address is
 * skipped rather than guessed at.
 */
export function externalTags(layout) {
  const readings = layout?.REG
  if (!readings || typeof readings !== 'object') return new Map()

  const byConnection = new Map()
  let taken = 0

  for (const [id, reading] of Object.entries(readings)) {
    if (taken >= MAX_TAGS) break
    const link = reading?.link
    /*
     * Either a table and a column, or a statement of its own.
     *
     * A reading on a registered database may carry `sql` instead: a join, a
     * WHERE nobody can express as one row filter, an aggregate. The engine
     * runs it as written and reads the first column of the first row — see
     * `latestValues`. Everything else about the reading is unchanged.
     */
    const written = typeof link?.sql === 'string' ? link.sql.trim() : ''
    if (!link || (!written && (!link.table || !link.col))) continue

    const named = REGISTERED.exec(String(link.src || ''))
    if (!named) continue

    const tag = written
      ? { id, sql: written.slice(0, 4000) }
      : { id, table: String(link.table), column: String(link.col) }
    if (!written) {
      if (link.keyCol) tag.keyColumn = String(link.keyCol)
      if (link.keyVal) tag.keyValue = String(link.keyVal)
      // How the filter compares. Checked against a list server side, never
      // interpolated — see `comparison` in db-connect.js.
      if (link.keyOp) tag.keyOp = String(link.keyOp)
      if (link.tcol) tag.timeColumn = String(link.tcol)
      /*
       * The second half of a combined date and time.
       *
       * Plenty of plant tables keep the date and the time of day in two text
       * columns rather than one `datetime` — so "Newest by" can name both,
       * and the pair is read as one moment. Only meaningful beside `tcol`.
       */
      if (link.tcol && link.tcol2) tag.timeColumn2 = String(link.tcol2)
    }

    const connectionId = named[1]
    if (!byConnection.has(connectionId)) byConnection.set(connectionId, [])
    byConnection.get(connectionId).push(tag)
    taken += 1
  }

  for (const tags of byConnection.values()) {
    tags.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  return byConnection
}
