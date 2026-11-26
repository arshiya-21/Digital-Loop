/**
 * Alert and ticket emails, sent through SandMan.
 *
 * The studio decides who is told (Administration › Teams & emails and Who gets
 * emails; the Critical-only rule; the repeat minutes) and queues one email per
 * alert in the loop's outbox — `engDoc().outbox`, entries `{ ch: 'email', to,
 * subject, text, status: 'queued for the server' }`. This picks those up and
 * posts each to `/api/v1/alerts/email`; the server hands it to SandMan, whose
 * own mail server sends it. No mail settings or passwords are anywhere in
 * Digital Loop.
 *
 * Only in the Publish view. In Simulate, tags that are not linked to the plant
 * still run on invented values, and an invented value must never become a real
 * email. Only emails queued since this page opened are sent: an old entry
 * saved in the loop file is history, not a message waiting to go out.
 *
 * The outcome is written back on the entry, so Administration › Sent log shows
 * "sent by SandMan", "not sent: …" per address.
 */
import { api } from './api.mjs'
import { peek } from './studio.mjs'
import { serverIsChecking, LEFT } from './alert-records.mjs'

const QUEUED = 'queued for the server'
const startedAt = Date.now()
let busy = false

async function sendQueued(lineOf) {
  if (busy) return
  if (!document.body.classList.contains('present')) return
  const engDoc = peek('engDoc')
  if (typeof engDoc !== 'function') return
  const outbox = engDoc().outbox || []
  const due = outbox.filter(o => o && o.ch === 'email' && o.status === QUEUED && +o.t >= startedAt - 5000)
  if (!due.length) return
  // The backend checks alerts and emails itself: this screen does not send a second copy.
  if (serverIsChecking()) {
    due.forEach(o => { o.status = LEFT })
    return
  }
  const line = lineOf()
  if (!line) return

  busy = true
  try {
    for (const o of due.slice(0, 10)) {
      o.status = 'sending…'
      try {
        const answer = await api.post('/alerts/email', {
          line,
          to: Array.isArray(o.to) ? o.to : [],
          subject: o.subject || '',
          text: o.text || '',
        })
        const refused = Object.entries(answer.refused || {})
        o.status = answer.duplicate
          ? 'already sent from another screen'
          : answer.sent.length
            ? `sent by SandMan to ${answer.sent.length}${refused.length ? ` · not to ${refused.length}` : ''}`
            : 'not sent'
        o.sent = answer.sent
        if (refused.length) o.refused = Object.fromEntries(refused)
        o.sentAt = Date.now()
      } catch (error) {
        // Back in the queue only when it may work later (SandMan down, too many
        // at once); a refused request will not get better by retrying.
        const retry = error.status === 0 || error.status === 429 || error.status >= 500
        o.status = retry ? QUEUED : `not sent: ${error.message}`
        if (retry) break
      }
    }
  } finally {
    busy = false
  }
}

/** Start sending. `lineOf` returns the line the open loop belongs to. */
export function installAlertMail({ lineOf }) {
  setInterval(() => {
    sendQueued(lineOf).catch(() => { busy = false })
  }, 5000)
}
