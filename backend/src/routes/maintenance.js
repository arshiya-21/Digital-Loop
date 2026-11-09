import { db, transaction, audit } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { loopToView } from '../utils/loop-access.js'
import { readMaintenance, writeMaintenance } from '../services/maintenance-store.js'
import { badRequest } from '../utils/errors.js'

/**
 * MAINTENANCE — the record
 *
 * Plans, the work log, the asset register, spare parts and the team for a loop,
 * in tables of their own (see database/schema.sql) rather than as a detail of
 * the drawing. The phone page writes to the same tables through
 * `routes/machine.js`.
 *
 * **Access follows the loop to view it, not to design it.** The people who log
 * work are the maintenance team, and most of them are not administrators — an
 * operator opening the published loop must be able to record a repair. What
 * stops anybody writing is the same thing that stops them reading: the loop
 * must be one their session may open. The team's PINs are the studio's own
 * lock on who is logging, exactly as before.
 */

export const maintenance = createRouter()

/** The whole record, in the shape the studio keeps as `DOC.maint`. */
maintenance.get('', async ({ user, query }) => {
  const loop = await loopToView(user, query.loopId)
  const maint = await readMaintenance(loop.id)
  return { loopId: loop.id, ...maint }
})

/**
 * Store the studio's maintenance.
 *
 * `replace: true` lets a record the studio no longer has be removed. The
 * studio sends it only after it has read what the server holds, so a studio
 * that never managed to read cannot wipe anything by saving an empty list.
 */
maintenance.put('/:loopId', async ({ user, params, body }) => {
  const loop = await loopToView(user, params.loopId)

  for (const field of ['plans', 'log', 'team', 'parts']) {
    if (body[field] !== undefined && !Array.isArray(body[field])) {
      throw badRequest('invalid_field', `"${field}" must be a list.`)
    }
  }
  if ((body.log?.length || 0) > 2000) throw badRequest('invalid_field', 'Send the work log in smaller parts.')

  const result = await transaction(async tx => {
    const done = await writeMaintenance(tx, loop.id, body, { replace: body.replace === true, actor: user.id })
    if (body.replace === true) {
      await audit(user.id, 'maintenance.sync', 'design', loop.id, {
        plans: body.plans?.length ?? 0, parts: body.parts?.length ?? 0, team: body.team?.length ?? 0,
      }, tx)
    }
    return done
  })

  return { loopId: loop.id, ...result }
})
