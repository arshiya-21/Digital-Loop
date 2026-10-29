import { db, now, audit } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { loopToView, loopToDesign } from '../utils/loop-access.js'
import { badRequest } from '../utils/errors.js'

/**
 * `/api/v1/monitor` — the readings chosen for a loop's live panel.
 *
 * Belongs to the loop and follows its access: anybody who may open the loop
 * may read the selection, only somebody who may design it may change it.
 *
 * **No row is not the same as an empty list.** No row: nobody has chosen, so
 * the panel offers its suggested set. `[]`: somebody chose nothing, and the
 * panel stays empty.
 */
export const monitor = createRouter()

const MAX_TAGS = 200
const TAG = /^[\w$.:\- ]{1,200}$/

monitor.get('/:loopId', async ({ user, params }) => {
  const loop = await loopToView(user, params.loopId)
  const row = await db.prepare('SELECT * FROM design_monitor WHERE design_id = ?').get(loop.id)
  if (!row) return { loopId: loop.id, chosen: false, tags: null }
  let tags
  try { tags = JSON.parse(row.tags) } catch { tags = null }
  if (!Array.isArray(tags)) return { loopId: loop.id, chosen: false, tags: null }
  return { loopId: loop.id, chosen: true, tags, updatedAt: row.updated_at }
})

monitor.put('/:loopId', async ({ user, params, body }) => {
  const loop = await loopToDesign(user, params.loopId)
  if (!Array.isArray(body?.tags)) {
    throw badRequest('invalid_field', '"tags" must be an array of tag ids.')
  }
  if (body.tags.length > MAX_TAGS) {
    throw badRequest('invalid_field', `No more than ${MAX_TAGS} parameters.`)
  }
  // Trimmed and de-duplicated, order kept: the order is the person's.
  const tags = [...new Set(body.tags.map(t => String(t).trim()).filter(Boolean))]
  for (const t of tags) {
    if (!TAG.test(t)) throw badRequest('invalid_field', `"${t}" is not a tag id.`)
  }

  await db.prepare(
    `INSERT INTO design_monitor (design_id, tags, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE tags = VALUES(tags), updated_by = VALUES(updated_by),
                             updated_at = VALUES(updated_at)`
  ).run(loop.id, JSON.stringify(tags), user.id, now())

  await audit(user.id, 'monitor.choose', 'design', loop.id, { count: tags.length })
  return { loopId: loop.id, chosen: true, tags }
})
