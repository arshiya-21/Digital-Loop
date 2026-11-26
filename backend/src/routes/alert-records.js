import { transaction, audit } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { loopToView } from '../utils/loop-access.js'
import { readAlertRecords, writeAlertRecords } from '../services/alert-store.js'
import { badRequest } from '../utils/errors.js'
import { serverChecking } from '../services/alert-checker.js'

/**
 * ALERT RECORDS — tickets, alert history and the email log of a loop.
 *
 * **Access follows the loop to view it, not to design it**, as maintenance
 * does: tickets are worked from the Publish view by operators who cannot save
 * the drawing. What stops anybody writing is what stops them reading — the loop
 * must be one their session may open.
 *
 * Writing is a merge (services/alert-store.js): several screens run the same
 * loop, and none of them may wipe another's history.
 */
export const alertRecords = createRouter()

alertRecords.get('', async ({ user, query }) => {
  const loop = await loopToView(user, query.loopId)
  // serverChecks: the backend is checking alerts and sending emails itself, so screens leave emailing to it
  return { loopId: loop.id, serverChecks: serverChecking(), ...(await readAlertRecords(loop.id)) }
})

alertRecords.put('/:loopId', async ({ user, params, body }) => {
  const loop = await loopToView(user, params.loopId)
  for (const field of ['tickets', 'events', 'mails']) {
    if (body[field] !== undefined && !Array.isArray(body[field])) throw badRequest('invalid_field', `"${field}" must be a list.`)
  }
  if (body.days !== undefined && (typeof body.days !== 'object' || Array.isArray(body.days))) {
    throw badRequest('invalid_field', '"days" must be an object.')
  }
  const count = (body.tickets?.length || 0) + (body.events?.length || 0) + (body.mails?.length || 0) + Object.keys(body.days || {}).length
  if (count > 3000) throw badRequest('invalid_field', 'Send the records in smaller parts.')

  const result = await transaction(async tx => {
    const done = await writeAlertRecords(tx, loop.id, body)
    if (body.first === true) {
      await audit(user.id, 'alerts.upload', 'design', loop.id, { tickets: body.tickets?.length ?? 0, events: body.events?.length ?? 0 }, tx)
    }
    return done
  })
  return { loopId: loop.id, ...result }
})
