import { db, uid, now, audit } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { created } from '../utils/respond.js'
import { loopToView } from '../utils/loop-access.js'
import { badRequest, notFound } from '../utils/errors.js'

/**
 * API 8 — ALARM HISTORY
 *
 * What went out of limit, when, and who knew about it.
 *
 * The studio keeps a live alarm list, rebuilt from the readings every tick.
 * That answers "what is wrong now" and nothing else: it does not survive a
 * reload, a shift change or a browser being closed. The questions asked
 * afterwards — how often does this mixer go over, was anybody told, how long
 * did it stay out — need a record, and this is it.
 *
 * **One row per episode, not per tick.** A reading sitting above its limit for
 * an hour is one alarm that lasted an hour, not three thousand six hundred
 * alarms. The studio reports the moment it is raised; `returned_at` is filled
 * in when it clears, and acknowledging it records who.
 *
 * Nothing here is invented. An alarm can only exist for a reading with a real
 * value behind it — which, until a reading is linked to a column, is none of
 * them. That is correct: a simulated number must never produce a plant alarm,
 * and before this the live list could.
 */

export const alarms = createRouter()

/** The studio's scale: 1 advisory, 2 warning, 3 critical. */
const SEVERITY = [1, 2, 3]

const publicShape = row => ({
  id: row.id,
  loopId: row.design_id,
  lineId: row.line_id,
  tag: row.tag_id,
  equipment: row.equipment,
  severity: row.severity,
  message: row.message,
  value: row.value,
  unit: row.unit,
  raisedAt: row.raised_at,
  returnedAt: row.returned_at,
  ackedAt: row.acked_at,
  ackedBy: row.acked_by,
  /** Still out of limit, as far as this record knows. */
  active: !row.returned_at,
})

const text = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

/* --------------------------------------------------------------- reading ---*/

/**
 * The history for a loop, newest first.
 *
 * `active=1` narrows it to what has not come back, which is what a dashboard
 * asks for; without it this is the record somebody reads after a bad shift.
 */
alarms.get('', async ({ user, query }) => {
  const loop = await loopToView(user, query.loopId)

  const limit = Math.min(Number(query.limit) || 200, 1000)
  const filters = ['design_id = ?']
  const args = [loop.id]
  if (query.active === '1') filters.push('returned_at IS NULL')
  if (query.tag) { filters.push('tag_id = ?'); args.push(String(query.tag)) }
  if (/^\d{4}-\d{2}-\d{2}/.test(query.from || '')) {
    filters.push('raised_at >= ?')
    args.push(query.from)
  }

  const rows = await db
    .prepare(
      `SELECT * FROM alarm_event WHERE ${filters.join(' AND ')}
       ORDER BY raised_at DESC LIMIT ?`
    )
    .all(...args, limit)

  return { loopId: loop.id, count: rows.length, alarms: rows.map(publicShape) }
})

/* --------------------------------------------------------------- writing ---*/

/**
 * Record an alarm being raised.
 *
 * Anybody who may *view* the loop may record one — an operator watching the
 * published screen is exactly who is present when something goes out of limit,
 * and refusing their report because they cannot edit the design would lose the
 * event. What they cannot do is invent one for a loop they cannot see.
 *
 * The foundry and the line come from the loop, never from the request.
 */
alarms.post('', async ({ user, body }) => {
  const loop = await loopToView(user, body.loopId)

  const tag = text(body.tag, 120)
  if (!tag) throw badRequest('invalid_field', '"tag" is required.')

  const severity = Number(body.severity)
  if (!SEVERITY.includes(severity)) {
    throw badRequest('invalid_field', '"severity" must be 1, 2 or 3.')
  }

  const value = Number(body.value)
  const id = uid('alm')

  await db.prepare(
    `INSERT INTO alarm_event
       (id, design_id, foundry_id, line_id, tag_id, equipment, severity, message,
        value, unit, raised_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, loop.id, loop.foundry_id, loop.line_id, tag,
    text(body.equipment, 160), severity, text(body.message, 500),
    Number.isFinite(value) ? value : null, text(body.unit, 40),
    text(body.raisedAt, 40) || now()
  )

  return created(publicShape(await db.prepare('SELECT * FROM alarm_event WHERE id = ?').get(id)))
})

const mustExist = async id => {
  const row = await db.prepare('SELECT * FROM alarm_event WHERE id = ?').get(id)
  if (!row) throw notFound('No such alarm.')
  return row
}

/** It came back inside its limits. */
alarms.post('/:id/returned', async ({ user, params, body }) => {
  const row = await mustExist(params.id)
  await loopToView(user, row.design_id)

  await db.prepare('UPDATE alarm_event SET returned_at = ? WHERE id = ? AND returned_at IS NULL')
    .run(text(body.at, 40) || now(), row.id)

  return publicShape(await mustExist(row.id))
})

/**
 * Somebody saw it.
 *
 * Recorded against their SandMan username, because "who knew about this" is
 * the question asked after a bad casting, and "the control room" is not an
 * answer. Acknowledging twice does not overwrite the first person.
 */
alarms.post('/:id/ack', async ({ user, params }) => {
  const row = await mustExist(params.id)
  await loopToView(user, row.design_id)

  await db.prepare('UPDATE alarm_event SET acked_at = ?, acked_by = ? WHERE id = ? AND acked_at IS NULL')
    .run(now(), user.id, row.id)

  await audit(user.id, 'alarm.ack', 'alarm_event', row.id, { tag: row.tag_id })
  return publicShape(await mustExist(row.id))
})
