import { db } from '../config/db.js'
import { canDesign, requireFoundryScope, requireLineScope } from '../middleware/auth.js'
import { badRequest, notFound, forbidden } from '../utils/errors.js'

/**
 * Access to a digital loop.
 *
 * There is one resource here — the loop — and two levels of access to it:
 *
 *   design   create it, save versions, publish it   (administrator)
 *   view     open the published version             (everyone in the foundry)
 *
 * They are not two APIs. `/api/v1/loops` is the same resource either way; what
 * differs is which loops you can see and what you may do to them. Keeping that
 * decision in these two functions is what stops it being re-implemented, and
 * subtly differently, in each handler.
 *
 * **Publishing is the whole of visibility.** A published loop is visible to
 * everyone whose session names its foundry — there is no per-person allocation
 * on top. The launch is what gives access to the plant; publishing is what
 * says a design is ready to be seen.
 *
 * Both checks are against the session, which came from SandMan. A loop on a
 * line the launch did not list is refused even inside the right foundry, so
 * typing another design's id or URL gets nothing.
 */

export { canDesign }

/**
 * A loop the caller may design: it must exist and be in one of their foundries.
 *
 * Throws 403 for an operator rather than 404, because the loop is not a secret
 * — they may well be able to view it. What they cannot do is change it.
 */
export async function loopToDesign(user, id) {
  const loop = await db.prepare('SELECT * FROM design WHERE id = ?').get(id)
  if (!loop) throw notFound('Digital loop not found.')
  if (!canDesign(user)) {
    throw forbidden('Designing a digital loop requires an administrator account.')
  }
  requireFoundryScope(user, loop.foundry_id)
  requireLineScope(user, loop.line_id)
  return loop
}

/**
 * A loop the caller may open.
 *
 * An administrator may open anything in their foundries, draft included — that
 * is what designing means. Everyone else in the foundry gets it once it is
 * published, and not before.
 */
export async function loopToView(user, id) {
  const loop = await db.prepare('SELECT * FROM design WHERE id = ?').get(id)
  if (!loop) throw notFound('Digital loop not found.')

  requireFoundryScope(user, loop.foundry_id)
  requireLineScope(user, loop.line_id)
  if (canDesign(user)) return loop

  if (loop.status !== 'published' || !loop.published_version_id) {
    throw notFound('This digital loop has not been published yet.')
  }
  return loop
}

/**
 * The loops on a line.
 *
 * A line used to hold exactly one. It now holds as many as somebody draws —
 * the one the plant is running, a rebuild beside it, a trial — and one of them
 * is published at a time. That published one is what the publish view and the
 * live readings follow, which is why `publishedOnLine` exists separately.
 */
export const designsOnLine = async (foundryId, lineId) =>
  await db.prepare('SELECT * FROM design WHERE foundry_id = ? AND line_id = ? ORDER BY updated_at DESC')
    .all(String(foundryId), String(lineId))

/** The one the plant is seeing on this line, if any. */
export const publishedOnLine = async (foundryId, lineId) =>
  (await db.prepare(
    `SELECT * FROM design
     WHERE foundry_id = ? AND line_id = ? AND status = 'published'
       AND published_version_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`
  ).get(String(foundryId), String(lineId))) || null

/** A loop on this line already called that, if any. Names are how they differ. */
export const designNamedOnLine = async (foundryId, lineId, name) =>
  (await db.prepare('SELECT * FROM design WHERE foundry_id = ? AND line_id = ? AND name = ?')
    .get(String(foundryId), String(lineId), String(name))) || null

// ------------------------------------------------------------- formatting ---

export const publicLoop = row => ({
  id: row.id,
  foundryId: row.foundry_id,
  foundryName: row.foundry_name,
  lineId: row.line_id,
  lineName: row.line_name,
  name: row.name,
  status: row.status,
  publishedVersionId: row.published_version_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const str = (value, max) => typeof value === 'string' && value.trim() && value.length <= max

export const required = (body, field, max = 200) => {
  if (!str(body[field], max)) throw badRequest('invalid_field', `"${field}" is required.`)
  return body[field].trim()
}
