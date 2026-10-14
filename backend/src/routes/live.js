import { createRouter } from '../utils/router.js'
import { loopToView } from '../utils/loop-access.js'
import { requireLineScope } from '../middleware/auth.js'
import { visibleLayout, linkedTags } from '../services/live-tags.js'
import { cachedValues } from '../services/live-cache.js'
import { readValues, readChart } from '../services/sandman.js'
import { badRequest, notFound } from '../utils/errors.js'

/**
 * API 6 — LIVE READINGS
 *
 * What the plant is actually doing, for the readings a loop is linked to.
 *
 * The studio draws the loop and simulates every reading until it is linked to
 * a column. These two endpoints are what turn a linked reading into a real
 * one: the last record, and a chart of the recent ones. The drawing does not
 * change — only where the number comes from.
 *
 * **Everything is decided here, not by the caller.** A request carries a loop
 * id and, for a chart, a tag id; the foundry, the line, the database, the
 * table and the column all come from the session and from the layout stored on
 * the server. There is deliberately no way to ask this API to read an
 * arbitrary table, because then an operator's session would be a query console
 * onto the foundry's database.
 *
 * SandMan does the reading. This service holds no connection to the plant's
 * database and never has — see `services/sandman.js`.
 */

export const live = createRouter()

/**
 * The loop, the line and the readings the caller may ask about.
 *
 * Shared by both endpoints so the two cannot drift: a tag chartable through
 * one must be readable through the other, and both must refuse the same
 * things.
 */
async function scope(user, loopId) {
  if (!loopId) throw badRequest('loop_required', 'A loopId is required.')

  const loop = await loopToView(user, loopId)
  // `loopToView` has checked this already. Repeated because this endpoint
  // sends the line to SandMan, and a line sent there must be one the launch
  // named — a guard is worth more next to the thing it guards.
  requireLineScope(user, loop.line_id)

  const layout = await visibleLayout(user, loop)
  return { loop, tags: linkedTags(layout, user.database?.name) }
}

/**
 * GET /api/v1/live/values?loopId=…
 *
 * The last record of every linked reading in the loop, keyed by tag id.
 *
 * A loop with no linked readings is not an error — it is a loop still being
 * drawn, and the honest answer is an empty map rather than a 404. SandMan is
 * not called at all in that case, which also means an unlinked loop costs the
 * plant database nothing.
 */
live.get('/values', async ({ user, query, req }) => {
  const { loop, tags } = await scope(user, query.loopId)

  if (!tags.length) {
    req.logNote = 'no linked readings'
    return { loopId: loop.id, lineId: loop.line_id, tagCount: 0, values: {}, errors: {}, stale: false }
  }

  const answer = await cachedValues(
    String(user.foundry.id), String(loop.line_id), tags,
    () => readValues({ foundry: String(user.foundry.id), line: String(loop.line_id), tags })
  )

  // Counts and freshness only — never a reading, never a table name.
  req.logNote = `${tags.length} tags` +
    (answer.stale ? ', stale' : answer.cached ? ', cached' : ', from SandMan')

  return {
    loopId: loop.id,
    lineId: loop.line_id,
    tagCount: tags.length,
    /** `{ "<tagId>": { value, date, time, shift, recordedAt } | null }` */
    values: answer.values || {},
    /** Per-tag reasons — "unknown column" and the like. Never a value. */
    errors: answer.errors || {},
    /** True when SandMan could not be reached and this is the last good read. */
    stale: !!answer.stale,
    ...(answer.since ? { since: answer.since } : {}),
    cached: !!answer.cached,
  }
})

/** Only these reach SandMan; anything else the caller adds is dropped. */
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/v1/live/chart?loopId=…&tag=…[&dateFrom&dateTo&points]
 *
 * The recent records for one reading, and SandMan's own process control chart.
 *
 * The tag must be one of the loop's own linked readings — that is what stops a
 * caller charting a column by naming it, and what makes another loop's tag a
 * 404 rather than a reading.
 *
 * The answer is passed through as SandMan gave it. `processControl` in
 * particular is SandMan's calculation, with its own subgroup rules and limits;
 * recomputing it here would mean two charts that are meant to be the same
 * drifting apart silently.
 */
live.get('/chart', async ({ user, query }) => {
  const { loop, tags } = await scope(user, query.loopId)

  const wanted = String(query.tag || '')
  if (!wanted) throw badRequest('tag_required', 'A tag is required.')

  const tag = tags.find(entry => entry.id === wanted)
  if (!tag) {
    // Deliberately 404 rather than 403: whether some other loop has this tag
    // is not this caller's business either.
    throw notFound('That reading is not part of this loop, or is not linked to the foundry database.')
  }

  const points = Number(query.points)
  const request = {
    foundry: String(user.foundry.id),
    line: String(loop.line_id),
    table: tag.table,
    column: tag.column,
    ...(tag.keyColumn ? { keyColumn: tag.keyColumn } : {}),
    ...(tag.keyValue ? { keyValue: tag.keyValue } : {}),
    ...(DATE.test(query.dateFrom || '') ? { dateFrom: query.dateFrom } : {}),
    ...(DATE.test(query.dateTo || '') ? { dateTo: query.dateTo } : {}),
    ...(Number.isFinite(points) && points >= 1 && points <= 2000
      ? { points: Math.round(points) }
      : {}),
  }

  /*
   * Not cached.
   *
   * A chart is opened by one person looking at one reading, not polled by
   * every screen in the plant, so there is nothing here for a shared cache to
   * save — and the person who just opened it wants today's records, not the
   * ones from half a minute ago.
   */
  const answer = await readChart(request)

  return {
    tag: tag.id,
    loopId: loop.id,
    dateFrom: answer.dateFrom ?? null,
    dateTo: answer.dateTo ?? null,
    series: Array.isArray(answer.series) ? answer.series : [],
    /** SandMan's Process Control Chart, or null when it has too little data. */
    processControl: answer.processControl ?? null,
  }
})
