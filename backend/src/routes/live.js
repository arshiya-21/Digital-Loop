import { createRouter } from '../utils/router.js'
import { loopToView } from '../utils/loop-access.js'
import { requireLineScope, requireAdmin } from '../middleware/auth.js'
import { visibleLayout, linkedTags, externalTags } from '../services/live-tags.js'
import { cachedValues } from '../services/live-cache.js'
import { readValues, readChart } from '../services/sandman.js'
import { latestValues, recentValues, readStatement } from '../services/db-connect.js'
import { db } from '../config/db.js'
import { badRequest, notFound, unprocessable } from '../utils/errors.js'

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
  return {
    loop,
    tags: linkedTags(layout, user.database?.name),
    /** connectionId → readings, for databases registered here. */
    external: externalTags(layout),
  }
}

/**
 * Read the readings that point at databases registered here.
 *
 * SandMan answers for the foundry's own database; this answers for the ones an
 * administrator added. Both end up in the same map, keyed by tag id, because
 * to everything downstream a reading is a reading — the browser does not know
 * or care which side of this a number came from.
 *
 * Not cached: `latestValues` opens the database, asks, and closes, and a poll
 * is thirty seconds apart. A second cache in front of that would mostly add a
 * way for the two halves of one screen to disagree about the time.
 *
 * A connection that cannot be opened at all marks its own readings and leaves
 * the rest alone. One unplugged historian must not blank a loop.
 */
/**
 * A registered database this session may read.
 *
 * Scoped to the foundry that registered it: a layout can name any connection
 * id it likes, and only this plant's own — or one registered before databases
 * belonged to a plant at all — may be opened. Without this, a loop could be
 * saved pointing at another foundry's historian and would read from it.
 */
async function connectionFor(user, connectionId) {
  const row = await db.prepare('SELECT * FROM db_connection WHERE id = ?').get(connectionId)
  if (!row) return null
  if (row.foundry_id && String(row.foundry_id) !== String(user.foundry?.id)) return null
  return row
}

async function readRegistered(user, byConnection) {
  const values = {}
  const errors = {}

  for (const [connectionId, tags] of byConnection) {
    const row = await connectionFor(user, connectionId)
    if (!row) {
      for (const tag of tags) errors[tag.id] = 'That database is no longer registered.'
      continue
    }

    try {
      const answer = await latestValues(row, tags)
      Object.assign(values, answer.values)
      Object.assign(errors, answer.errors)
    } catch (error) {
      // The host and the driver's complaint, never the password — it is not
      // interpolated into anything `latestValues` builds.
      const why = String(error?.message || 'could not be reached').slice(0, 200)
      for (const tag of tags) errors[tag.id] = `${row.label}: ${why}`
    }
  }

  return { values, errors }
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
  const { loop, tags, external } = await scope(user, query.loopId)

  const registeredCount = [...external.values()].reduce((total, list) => total + list.length, 0)

  if (!tags.length && !registeredCount) {
    req.logNote = 'no linked readings'
    return { loopId: loop.id, lineId: loop.line_id, tagCount: 0, values: {}, errors: {}, stale: false }
  }

  /*
   * Both halves at once.
   *
   * SandMan's readings and the registered databases' are independent, and a
   * slow historian should not hold up the foundry's own numbers — so they are
   * asked for together rather than one after the other.
   */
  const [fromSandMan, fromRegistered] = await Promise.all([
    tags.length
      ? cachedValues(
          String(user.foundry.id), String(loop.line_id), tags,
          () => readValues({ foundry: String(user.foundry.id), line: String(loop.line_id), tags })
        )
      : Promise.resolve({ values: {}, errors: {} }),
    registeredCount ? readRegistered(user, external) : Promise.resolve({ values: {}, errors: {} }),
  ])

  // Counts and freshness only — never a reading, never a table name.
  req.logNote = `${tags.length}+${registeredCount} tags` +
    (fromSandMan.stale ? ', stale' : fromSandMan.cached ? ', cached' : ', read')

  return {
    loopId: loop.id,
    lineId: loop.line_id,
    tagCount: tags.length + registeredCount,
    /** `{ "<tagId>": { value, date, time, shift, recordedAt } | null }` */
    values: { ...(fromSandMan.values || {}), ...fromRegistered.values },
    /** Per-tag reasons — "unknown column" and the like. Never a value. */
    errors: { ...(fromSandMan.errors || {}), ...fromRegistered.errors },
    /** True when SandMan could not be reached and this is the last good read. */
    stale: !!fromSandMan.stale,
    ...(fromSandMan.since ? { since: fromSandMan.since } : {}),
    cached: !!fromSandMan.cached,
  }
})

/**
 * POST /api/v1/live/preview
 *
 * One value from a table and column somebody is **in the middle of choosing**,
 * so the Add reading flow can say whether data is coming before a reading is
 * made out of it.
 *
 * This is the one endpoint where the table and the column come from the
 * request rather than from a stored layout, which is why it is fenced:
 *
 *   - **Administrators only.** An operator has no use for it and no way in.
 *   - One source: the foundry's own database, or one registered here. Nothing
 *     else is accepted.
 *   - One row. The same read the poll does, through the same code.
 *   - The loop is checked first, so the line is one the caller's launch named.
 *
 * It stores nothing and changes nothing.
 */
live.post('/preview', async ({ user, body }) => {
  requireAdmin(user)

  const { loop } = await scope(user, body?.loopId)
  const source = String(body?.source || '')
  const table = String(body?.table || '').trim()
  const column = String(body?.column || '').trim()

  /*
   * A statement of its own, tried before it becomes the reading.
   *
   * The same read the poll will do — `latestValues` runs it, fenced the same
   * way — so "will this work as a reading?" is answered by doing it rather
   * than by promising.
   */
  const written = typeof body?.sql === 'string' ? body.sql.trim() : ''
  if (!written && (!table || !column)) {
    throw badRequest('invalid_field', 'A table and a column, or a query, are required.')
  }

  /*
   *  is how the answer is keyed, not what the statement calls it.
   *
   * The reported SQL aliases the column by the tag id, and using the
   * internal key gave the card  before Read now and the real
   * name after — the same statement disagreeing with itself.
   */
  const callItWhat = String(body?.tagId || 'preview').slice(0, 120)
  const tag = written
    ? { id: 'preview', named: callItWhat, sql: written }
    : { id: 'preview', named: callItWhat, table, column }
  if (!written) {
    if (body?.keyColumn && body?.keyValue) {
      tag.keyColumn = String(body.keyColumn)
      tag.keyValue = String(body.keyValue)
      // Checked against a list in db-connect.js, never interpolated.
      if (body.keyOp) tag.keyOp = String(body.keyOp)
    }
    if (body?.timeColumn) tag.timeColumn = String(body.timeColumn)
    /*
     * Both halves of a "Newest by" pair, or the statement is not the one the
     * reading runs.
     *
     * Only the first half was passed, so a reading set to `date + time` was
     * previewed with `ORDER BY \`date\` DESC LIMIT 1` — the newest day, and
     * whichever row of it the engine returned. On the plant that answered
     * `19 · recorded 2026-10-28T00:00:00` beside a chart drawn from the
     * actual newest moment.
     */
    if (body?.timeColumn2) tag.timeColumn2 = String(body.timeColumn2)
  }

  // SandMan reads a table and a column. A statement is ours to run, against a
  // database registered here, and there is no way to hand it one.
  if (written && source === 'customer') {
    throw badRequest('invalid_field',
      'SandMan reads the foundry\'s own database a column at a time — a query can only be run ' +
      'against a database registered here.')
  }

  /*
   * What was run, and how long it took.
   *
   * "Is anything coming out of this column?" is answered by a value, and
   * "why not?" is answered by the statement — the table it really reads, the
   * ordering column it really sorts by, the row filter it really applies.
   * Both come back here so the studio can show them side by side instead of
   * describing a query it cannot see.
   */
  const started = Date.now()

  if (source === 'customer') {
    const answer = await readValues({
      foundry: String(user.foundry.id), line: String(loop.line_id), tags: [tag],
    })
    return {
      value: answer?.values?.preview ?? null,
      error: answer?.errors?.preview ?? null,
      tookMs: Date.now() - started,
      via: 'SandMan',
      /*
       * SandMan builds its own statement against the foundry's database, so
       * there is none to show here. What it was asked for is said instead —
       * claiming to show SQL this service never wrote would be a guess
       * dressed as a fact.
       */
      query: null,
      asked: { table: tag.table, column: tag.column, line: String(loop.line_id) },
    }
  }

  const named = /^conn_([A-Za-z0-9_-]{1,120})$/.exec(source)
  if (!named) throw badRequest('invalid_field', 'That is not a database this service reads.')

  const row = await connectionFor(user, named[1])
  if (!row) throw notFound('No such database connection.')

  const answer = await latestValues(row, [tag])
  const statement = readStatement(row.engine, tag)
  return {
    value: answer.values.preview ?? null,
    error: answer.errors.preview ?? null,
    tookMs: Date.now() - started,
    via: row.label,
    query: statement?.sql ?? null,
    /** The row filter, bound rather than pasted into the statement. */
    params: statement?.params ?? [],
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
  const { loop, tags, external } = await scope(user, query.loopId)

  /*
   * A reading on a database registered here is charted from that database.
   *
   * SandMan answers for its own, and this endpoint used to assume every
   * chartable reading was one of those — so opening the trend on a reading
   * from a plant historian answered 404, and the window said "Could not be
   * loaded" beside a value it was already showing.
   *
   * `processControl` is null for these: it is SandMan's own calculation, with
   * its subgroup rules and its limits. Working out something similar here and
   * labelling it the same would be two different charts under one name.
   */
  const wantedTag = String(query.tag || '')
  for (const [connectionId, list] of external) {
    const mine = list.find(entry => entry.id === wantedTag)
    if (!mine) continue

    const connection = await connectionFor(user, connectionId)
    if (!connection) throw notFound('That database is no longer registered.')

    const points = Number(query.points)
    let series
    try {
      /* The window the chart is showing, so the database is asked for that
         rather than for two hundred rows the studio then throws away. */
      const seconds = Number(query.windowSeconds)
      series = await recentValues(
        connection, mine,
        Number.isFinite(points) && points >= 1 ? Math.round(points) : 200,
        Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 31 * 24 * 3600) : null
      )
    } catch (error) {
      /*
       * A dropped column, a renamed table, a table with no timestamp: each is
       * something somebody can fix, and each used to arrive as a bare
       * `internal_error` that said nothing. The driver's own words are the
       * useful ones, and nothing in them is a credential — the password is
       * not interpolated into any statement `recentValues` builds.
       */
      throw unprocessable(
        'chart_unreadable',
        String(error?.message || 'Those records could not be read.').slice(0, 300),
        // What was run, so Preview data can open on it and be edited.
        error?.statement ? { query: String(error.statement) } : undefined
      )
    }

    return {
      tag: mine.id,
      loopId: loop.id,
      dateFrom: series[0]?.recordedAt ?? null,
      dateTo: series.at(-1)?.recordedAt ?? null,
      series: series.map(record => ({ value: record.value, recordedAt: record.recordedAt })),
      processControl: null,
      source: connection.label,
      /** The statement these records came from — see `withStatement`. */
      query: series.statement || null,
      /** Its two columns, named by the statement that was actually run. */
      columns: series.columns || null,
    }
  }

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
    ...(tag.keyOp ? { keyOp: tag.keyOp } : {}),
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
