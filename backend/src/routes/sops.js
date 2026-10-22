import { db, uid, now, audit, transaction } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { created, noContent } from '../utils/respond.js'
import { loopToView, loopToDesign } from '../utils/loop-access.js'
import { badRequest, notFound } from '../utils/errors.js'

/**
 * API 8 — THE WRITTEN PROCEDURE
 *
 * The words of a process's SOP: its number, owner and approver, the revision
 * it is at, the pre-start checklist, the numbered steps with their key points,
 * the reaction plan, the PPE line and its own change history.
 *
 * Not the uploaded PDF — that is `sopFiles`, and the two are deliberately
 * separate: a plant may have the procedure written here and a signed scan
 * attached beside it, or either one on its own.
 *
 * **Why this is not left in the layout.** It worked: the studio copies its
 * process templates into `DOC.cps[].sop` and the whole document is stored as
 * `design_version.layout`, so the words reached the database. What they could
 * not do there is be *found*. A 78 KB JSON blob per version answers "draw this
 * loop" and refuses every other question — which processes are still on
 * version 1.0, whose procedures name an owner who has left, what the reaction
 * plan is for compactability out of limit. It is also rewritten wholesale
 * every time somebody moves a conveyor, which is a strange thing to do to a
 * controlled document.
 *
 * **Access follows the loop**, as everything about a loop does: anybody who
 * may open the design may read its procedures, and only somebody who may
 * design it may write one. There is no separate sharing model, because a
 * procedure belongs to the loop it describes.
 */

export const sops = createRouter()

/** `process_id` is the studio's own id for a process — `cp_sp`, `cp_mld`. */
const PROCESS_ID = /^[A-Za-z0-9_.:-]{1,80}$/

/**
 * How much procedure one process may hold.
 *
 * Generous against anything real — the longest shipped procedure is eight
 * steps of about 90 characters — and there so that a runaway or malformed
 * payload is refused with a clear message rather than stored.
 */
const LIMITS = { rows: 200, line: 2000, text: 8000, field: 255, list: 100 }

/** A JSON column, back as the list it was. Never throws on a bad row. */
const listFrom = value => {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const publicShape = (row, steps, reactions) => ({
  id: row.id,
  loopId: row.design_id,
  processId: row.process_id,
  processName: row.process_name,
  no: row.no,
  title: row.title,
  version: row.version,
  status: row.status,
  owner: row.owner,
  approver: row.approver,
  effective: row.effective_on,
  reviewMonths: row.review_months,
  purpose: row.purpose || '',
  scope: row.scope || '',
  roles: listFrom(row.roles),
  ppe: listFrom(row.ppe),
  prestart: listFrom(row.prestart),
  refs: listFrom(row.refs),
  revisions: listFrom(row.revisions),
  steps: steps.map(step => ({
    t: step.text,
    key: step.key_point || '',
    crit: step.critical ? 1 : 0,
    param: step.param,
  })),
  reaction: reactions.map(row_ => ({
    cond: row_.cond, action: row_.action, esc: row_.escalate,
  })),
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
})

/** The children of several procedures at once, so a listing stays three queries. */
async function childrenFor(ids) {
  const empty = { steps: new Map(), reactions: new Map() }
  if (!ids.length) return empty

  const holes = ids.map(() => '?').join(',')
  const [steps, reactions] = await Promise.all([
    db.prepare(`SELECT * FROM sop_step WHERE sop_id IN (${holes}) ORDER BY sop_id, ordinal`).all(...ids),
    db.prepare(`SELECT * FROM sop_reaction WHERE sop_id IN (${holes}) ORDER BY sop_id, ordinal`).all(...ids),
  ])

  for (const id of ids) {
    empty.steps.set(id, [])
    empty.reactions.set(id, [])
  }
  for (const row of steps) empty.steps.get(row.sop_id)?.push(row)
  for (const row of reactions) empty.reactions.get(row.sop_id)?.push(row)
  return empty
}

/* --------------------------------------------------------------- reading ---*/

/** Every procedure written for a loop. */
sops.get('', async ({ user, query }) => {
  const loop = await loopToView(user, query.loopId)
  const rows = await db
    .prepare('SELECT * FROM sop WHERE design_id = ? ORDER BY process_id')
    .all(loop.id)

  const ids = rows.map(row => row.id)
  const { steps, reactions } = await childrenFor(ids)
  return {
    loopId: loop.id,
    count: rows.length,
    sops: rows.map(row => publicShape(row, steps.get(row.id) || [], reactions.get(row.id) || [])),
  }
})

/** One process's procedure. */
sops.get('/:loopId/:processId', async ({ user, params }) => {
  const loop = await loopToView(user, params.loopId)
  const row = await db
    .prepare('SELECT * FROM sop WHERE design_id = ? AND process_id = ?')
    .get(loop.id, String(params.processId))
  if (!row) throw notFound('No procedure has been written for that process yet.')

  const { steps, reactions } = await childrenFor([row.id])
  return publicShape(row, steps.get(row.id) || [], reactions.get(row.id) || [])
})

/* --------------------------------------------------------------- writing ---*/

const text = (value, max) => {
  if (value === null || value === undefined) return ''
  const trimmed = String(value).trim()
  if (trimmed.length > max) {
    throw badRequest('too_long', `That is longer than ${max} characters.`)
  }
  return trimmed
}

/** A list the caller sent, or null for "leave what is stored alone". */
function listGiven(body, field, { of = 'lines' } = {}) {
  const given = body?.[field]
  if (given === undefined) return null
  if (!Array.isArray(given)) {
    throw badRequest('invalid_list', `${field} must be a list of ${of}.`)
  }
  if (given.length > LIMITS.list) {
    throw badRequest('too_long', `${field} may have at most ${LIMITS.list} entries.`)
  }
  return given
}

/**
 * The steps, as rows.
 *
 * A step may be given as a bare string — which is what "just the words" looks
 * like — or as the object the studio uses, with its key point, its criticality
 * and the reading it is about. Both arrive here as the same row.
 */
function stepsFrom(body) {
  const given = listGiven(body, 'steps', { of: 'steps' })
  if (given === null) return null
  if (given.length > LIMITS.rows) {
    throw badRequest('too_many_steps', `A procedure may have at most ${LIMITS.rows} steps.`)
  }

  return given
    .map(step => (typeof step === 'string' ? { t: step } : step || {}))
    .map(step => ({
      text: text(step.t ?? step.text, LIMITS.line),
      key_point: text(step.key ?? step.keyPoint, LIMITS.field),
      critical: step.crit || step.critical ? 1 : 0,
      param: text(step.param, LIMITS.field) || null,
    }))
    // A numbered list with a blank line in it reads as a step somebody forgot.
    .filter(step => step.text)
}

/** The reaction plan, as rows. */
function reactionFrom(body) {
  const given = listGiven(body, 'reaction', { of: 'reaction rows' })
  if (given === null) return null

  return given
    .map(row => (typeof row === 'string' ? { action: row } : row || {}))
    .map(row => ({
      cond: text(row.cond ?? row.condition, LIMITS.line),
      action: text(row.action, LIMITS.line),
      escalate: text(row.esc ?? row.escalate, LIMITS.field),
    }))
    .filter(row => row.cond || row.action)
}

/** A list stored as JSON, trimmed and bounded. */
function jsonList(body, field) {
  const given = listGiven(body, field)
  if (given === null) return undefined
  return JSON.stringify(given.slice(0, LIMITS.list))
}

/**
 * Write one process's procedure, creating it if this is the first time.
 *
 * An upsert rather than POST-then-PUT because the caller does not know and
 * should not have to: it has a loop, a process and the words, and "is there a
 * row yet" is this service's question to answer.
 *
 * Every list is replaced as a set when it is sent, and left alone when it is
 * not — so changing the version does not mean sending the whole procedure back
 * and risking losing a step on the way.
 */
sops.put('/:loopId/:processId', async ({ user, params, body }) => {
  const loop = await loopToDesign(user, params.loopId)
  const processId = String(params.processId)
  if (!PROCESS_ID.test(processId)) {
    throw badRequest('invalid_process', 'That is not a usable process id.')
  }

  const steps = stepsFrom(body)
  const reaction = reactionFrom(body)
  const months = body?.reviewMonths
  const fields = {
    process_name: text(body?.processName, LIMITS.field),
    no: text(body?.no, LIMITS.field),
    title: text(body?.title, LIMITS.field),
    version: text(body?.version, 40) || '1.0',
    status: text(body?.status, 40) || 'Draft',
    owner: text(body?.owner, LIMITS.field),
    approver: text(body?.approver, LIMITS.field),
    effective_on: text(body?.effective, 40) || null,
    review_months: Number.isFinite(Number(months)) && months !== null && months !== ''
      ? Math.max(0, Math.min(600, Math.round(Number(months))))
      : null,
    purpose: text(body?.purpose, LIMITS.text) || null,
    scope: text(body?.scope, LIMITS.text) || null,
    roles: jsonList(body, 'roles'),
    ppe: jsonList(body, 'ppe'),
    prestart: jsonList(body, 'prestart'),
    refs: jsonList(body, 'refs'),
    revisions: jsonList(body, 'revisions'),
  }

  const existing = await db
    .prepare('SELECT id FROM sop WHERE design_id = ? AND process_id = ?')
    .get(loop.id, processId)

  const id = existing?.id || uid('sop')
  const stamp = now()
  const by = user.name || user.id

  await transaction(async tx => {
    if (existing) {
      /*
       * Only the columns this request actually carried.
       *
       * A JSON list left out means "leave it alone", and writing `undefined`
       * as null would quietly empty the PPE line of a procedure somebody was
       * only renaming.
       */
      const set = []
      const values = []
      for (const [column, value] of Object.entries(fields)) {
        if (value === undefined) continue
        set.push(`${column} = ?`)
        values.push(value)
      }
      set.push('updated_by = ?', 'updated_at = ?')
      values.push(by, stamp, id)
      await tx.prepare(`UPDATE sop SET ${set.join(', ')} WHERE id = ?`).run(...values)
    } else {
      await tx
        .prepare(
          `INSERT INTO sop (id, design_id, process_id, process_name, no, title, version,
             status, owner, approver, effective_on, review_months, purpose, scope,
             roles, ppe, prestart, refs, revisions, updated_by, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id, loop.id, processId, fields.process_name, fields.no, fields.title,
          fields.version, fields.status, fields.owner, fields.approver,
          fields.effective_on, fields.review_months, fields.purpose, fields.scope,
          fields.roles ?? null, fields.ppe ?? null, fields.prestart ?? null,
          fields.refs ?? null, fields.revisions ?? null, by, stamp
        )
    }

    if (steps) {
      await tx.prepare('DELETE FROM sop_step WHERE sop_id = ?').run(id)
      for (const [index, step] of steps.entries()) {
        await tx
          .prepare(
            `INSERT INTO sop_step (sop_id, ordinal, text, key_point, critical, param)
             VALUES (?,?,?,?,?,?)`
          )
          .run(id, index + 1, step.text, step.key_point, step.critical, step.param)
      }
    }

    if (reaction) {
      await tx.prepare('DELETE FROM sop_reaction WHERE sop_id = ?').run(id)
      for (const [index, row] of reaction.entries()) {
        await tx
          .prepare(
            'INSERT INTO sop_reaction (sop_id, ordinal, cond, action, escalate) VALUES (?,?,?,?,?)'
          )
          .run(id, index + 1, row.cond, row.action, row.escalate)
      }
    }

    // The number and the version, never the procedure itself: an audit row
    // records that something changed, not a second copy of what it says.
    await audit(user.id, existing ? 'sop.update' : 'sop.create', 'sop', id, {
      loopId: loop.id, processId, no: fields.no, version: fields.version,
    }, tx)
  })

  const written = await db.prepare('SELECT * FROM sop WHERE id = ?').get(id)
  const { steps: stored, reactions } = await childrenFor([id])
  const shape = publicShape(written, stored.get(id) || [], reactions.get(id) || [])
  return existing ? shape : created(shape)
})

/** Take a procedure away. The uploaded documents beside it are untouched. */
sops.delete('/:loopId/:processId', async ({ user, params }) => {
  const loop = await loopToDesign(user, params.loopId)
  const row = await db
    .prepare('SELECT id FROM sop WHERE design_id = ? AND process_id = ?')
    .get(loop.id, String(params.processId))
  if (!row) throw notFound('No procedure has been written for that process yet.')

  await transaction(async tx => {
    await tx.prepare('DELETE FROM sop WHERE id = ?').run(row.id)
    await audit(user.id, 'sop.delete', 'sop', row.id,
      { loopId: loop.id, processId: String(params.processId) }, tx)
  })
  return noContent()
})
