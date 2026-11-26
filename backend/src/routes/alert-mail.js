import { createRouter } from '../utils/router.js'
import { badRequest } from '../utils/errors.js'
import { rateLimit } from '../utils/rate-limit.js'
import { sendMail } from '../services/sandman.js'

/**
 * `/api/v1/alerts/email` — alert and ticket emails, sent through SandMan.
 *
 * The studio works out who is told (Administration › Teams & emails, Who gets
 * emails) and queues one email per alert in the loop's outbox. Each queued
 * email is posted here and handed to SandMan, which sends it with its own mail
 * server — this service holds no mail settings and no mail password.
 *
 * What may be sent is fenced on both sides:
 *   - the foundry is the session's, never the caller's; the line must be one
 *     of the session's lines;
 *   - SandMan mails only addresses of its own enabled users of that foundry,
 *     and caps a foundry's emails per hour;
 *   - here: at most 50 addresses, a short subject and text, 30 emails a minute
 *     per caller.
 *
 * Several screens on one line each queue the same alert email. The first one
 * is sent; the same subject to the same people from the same line within ten
 * minutes is answered as a duplicate and not sent again.
 */
export const alertMail = createRouter()

const limit = rateLimit({ windowMs: 60_000, max: 30 })
const RECENT_MS = 10 * 60_000
const recent = new Map() // dedupe key → time sent
setInterval(() => {
  const cutoff = Date.now() - RECENT_MS
  for (const [key, at] of recent) if (at < cutoff) recent.delete(key)
}, 60_000).unref()

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

alertMail.post('/email', async ({ user, body, req }) => {
  limit(req, 'alert-mail:' + user.sandmanUserId)

  const to = Array.isArray(body?.to)
    ? [...new Set(body.to.map(e => String(e ?? '').trim().toLowerCase()).filter(Boolean))]
    : []
  if (!to.length || to.length > 50 || !to.every(e => EMAIL.test(e) && e.length <= 255)) {
    throw badRequest('invalid_field', '"to" must list 1–50 email addresses.')
  }
  const subject = String(body?.subject ?? '').replace(/[\r\n]+/g, ' ').trim()
  const text = String(body?.text ?? '')
  if (!subject || subject.length > 200) throw badRequest('invalid_field', '"subject" is required (at most 200 characters).')
  if (!text.trim() || text.length > 10_000) throw badRequest('invalid_field', '"text" is required (at most 10 000 characters).')

  const line = String(body?.line ?? user.lineId ?? '')
  if (!user.lines.some(l => l.id === line)) throw badRequest('invalid_field', '"line" is not one of your lines.')

  const key = [user.foundry.id, line, subject, [...to].sort().join(',')].join('|')
  if (Date.now() - (recent.get(key) || 0) < RECENT_MS) return { sent: [], refused: {}, duplicate: true }
  recent.set(key, Date.now())

  try {
    const answer = await sendMail({ foundry: user.foundry.id, line, to, subject, text })
    return {
      sent: Array.isArray(answer.sent) ? answer.sent : [],
      refused: answer.refused && typeof answer.refused === 'object' ? answer.refused : {},
    }
  } catch (error) {
    recent.delete(key) // not sent: let the next try go through
    throw error
  }
})
