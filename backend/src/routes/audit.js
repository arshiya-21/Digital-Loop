import { db } from '../config/db.js'
import { requireAdmin } from '../middleware/auth.js'
import { createRouter } from '../utils/router.js'

/**
 * Who changed what, and when.
 *
 * Every write in the admin API records a row. This is the read side, kept on
 * its own because it answers a different question from the rest of the API:
 * not "what is the loop" but "how did it get like this".
 */

export const auditLog = createRouter()

auditLog.get('/', async ({ user, query }) => {
  requireAdmin(user)
  const limit = Math.min(Number(query.limit) || 50, 200)
  const rows = query.entityId
    ? await db.prepare('SELECT * FROM audit_log WHERE entity_id = ? ORDER BY at DESC LIMIT ?')
        .all(query.entityId, limit)
    : await db.prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?').all(limit)

  return rows.map(row => ({
    id: row.id, actorId: row.actor_id, action: row.action,
    entity: row.entity, entityId: row.entity_id,
    detail: row.detail ? JSON.parse(row.detail) : null, at: row.at,
  }))
})
