import { db, now } from '../config/db.js'

/**
 * Alert records — tickets, alert days, engineered-alert history and the email
 * log — in their own tables (see the ALERT RECORDS block in database/schema.sql).
 *
 * The studio keeps them in memory as
 *
 *   DOC.tk   = { list: [ticket], days: {key: [YYYY-MM-DD]}, mins: {key: {...}}, dlog: {key: {...}}, seq, set… }
 *   DOC.eng  = { log: [event], outbox: [mail], teams, rules… }
 *
 * and this file is the only place that knows how those map onto rows. Several
 * screens run the same loop at once, each raising the same alerts, so writing
 * is a merge, never an overwrite:
 *
 *   tickets   the server issues the number (TK-0007); a ticket's history is the
 *             union of every screen's; a new ticket for an alert that already has
 *             an open one becomes that one (returned in `merged`).
 *   days      the days an alert was active are combined from every screen.
 *   events    a second screen's copy of an engineered alert that is already open
 *             is not stored twice (returned in `merged`).
 *   mails     the same subject to the same people within ten minutes is one email.
 *   nothing   is ever deleted by a writer; history older than 120 days is pruned.
 */

const parse = (value, fallback) => {
  try {
    return JSON.parse(value) ?? fallback
  } catch {
    return fallback
  }
}
const text = (value, max) => {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s ? s.slice(0, max) : null
}
const iso = ms => (Number.isFinite(+ms) && +ms > 0 ? new Date(+ms).toISOString() : null)

/** Largest record accepted — far above anything real, a guard against junk. */
const MAX_DOC = 256 * 1024
function ensureSize(record, what) {
  const s = JSON.stringify(record)
  if (s.length > MAX_DOC) {
    const error = new Error(`A ${what} is too large to store.`)
    error.status = 400
    error.code = 'too_large'
    throw error
  }
  return s
}

export const CLOSED = ['resolved', 'closed', 'cancelled']
const KEEP_DAYS = 120

/* ----------------------------------------------------------------- reading */

const ticketOut = row => ({ ...parse(row.doc, {}), id: row.id, no: row.ticket_no, status: row.status, rev: row.rev })

/** Everything for one loop, in the studio's shapes. */
export async function readAlertRecords(designId, runner = db) {
  const since = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString()
  const [tickets, days, events, mails, counter] = await Promise.all([
    runner.prepare('SELECT * FROM alert_ticket WHERE design_id = ? ORDER BY created_at DESC LIMIT 5000').all(designId),
    runner.prepare('SELECT alert_key, doc FROM alert_day WHERE design_id = ?').all(designId),
    runner.prepare('SELECT doc FROM alert_event WHERE design_id = ? AND started_at >= ? ORDER BY started_at DESC LIMIT 500').all(designId, since),
    runner.prepare('SELECT doc FROM alert_mail WHERE design_id = ? AND queued_at >= ? ORDER BY queued_at DESC LIMIT 300').all(designId, since),
    runner.prepare('SELECT ticket_seq FROM alert_counter WHERE design_id = ?').get(designId),
  ])
  return {
    tickets: tickets.map(ticketOut),
    days: Object.fromEntries(days.map(row => [row.alert_key, parse(row.doc, {})])),
    events: events.map(row => parse(row.doc, {})),
    mails: mails.map(row => parse(row.doc, {})),
    seq: counter?.ticket_seq || 0,
  }
}

/* ----------------------------------------------------------------- numbers */

const numberOf = no => {
  const m = /^TK-(\d+)$/.exec(String(no || ''))
  return m ? +m[1] : 0
}

async function bumpCounter(tx, designId, atLeast = 0) {
  await tx.prepare('INSERT IGNORE INTO alert_counter (design_id, ticket_seq) VALUES (?, 0)').run(designId)
  await tx.prepare('UPDATE alert_counter SET ticket_seq = GREATEST(ticket_seq, ?) WHERE design_id = ?').run(atLeast, designId)
}

/** The next ticket number; the row lock serialises two writers. */
async function nextTicketNumber(tx, designId) {
  await bumpCounter(tx, designId)
  await tx.prepare('UPDATE alert_counter SET ticket_seq = ticket_seq + 1 WHERE design_id = ?').run(designId)
  const { ticket_seq: seq } = await tx.prepare('SELECT ticket_seq FROM alert_counter WHERE design_id = ?').get(designId)
  return `TK-${String(seq).padStart(4, '0')}`
}

/* ------------------------------------------------------------------ merging */

/** Two lists of history lines as one, each line once, oldest first. */
function unionBy(a = [], b = [], key) {
  const seen = new Map()
  for (const item of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!item || typeof item !== 'object') continue
    const k = key(item)
    if (!seen.has(k)) seen.set(k, item)
  }
  return [...seen.values()]
}
const histKey = h => `${h.t}|${h.by || ''}|${h.text || ''}`

/** One alert's day record from two screens: days combined, each day's larger count kept. */
export function mergeDays(server = {}, client = {}) {
  const days = [...new Set([...(server.days || []), ...(client.days || [])])].sort().slice(-60)
  const mins = { ...(server.mins || {}) }
  for (const [d, n] of Object.entries(client.mins || {})) mins[d] = Math.max(+mins[d] || 0, +n || 0)
  const dlog = { ...(server.dlog || {}) }
  for (const [d, e] of Object.entries(client.dlog || {})) {
    if (!dlog[d] || (+e?.mins || 0) >= (+dlog[d]?.mins || 0)) dlog[d] = e
  }
  return { days, mins, dlog }
}

/* ----------------------------------------------------------------- writing */

/**
 * Take a screen's records into the tables. Returns what the screen must adopt:
 *
 *   renumbered     { ticketId: 'TK-0007' }   the number the server issued
 *   mergedTickets  { ticketId: ticket }       its ticket became this existing one
 *   mergedEvents   { eventId: eventId }       its alert is already recorded as this one
 *   seq            the ticket counter
 */
export async function writeAlertRecords(tx, designId, body) {
  const stamp = now()
  const renumbered = {}
  const mergedTickets = {}
  const mergedEvents = {}

  /* tickets */
  for (const t of Array.isArray(body.tickets) ? body.tickets : []) {
    const id = text(t?.id, 40)
    if (!id) continue
    const have = await tx.prepare('SELECT * FROM alert_ticket WHERE design_id = ? AND id = ?').get(designId, id)
    const status = text(t.status, 16) || 'new'

    if (!have) {
      // A second screen opening a ticket for an alert that already has an open one: that one it is.
      const key = text(t.key, 200)
      if (key && t.source !== 'manual') {
        const open = await tx.prepare(
          `SELECT * FROM alert_ticket WHERE design_id = ? AND alert_key = ?
             AND status NOT IN (${CLOSED.map(() => '?').join(',')}) ORDER BY created_at LIMIT 1`
        ).get(designId, key, ...CLOSED)
        if (open) {
          mergedTickets[id] = ticketOut(open)
          continue
        }
      }
      // Keep the screen's number when it is free (a loop's tickets uploaded the first time), else issue one.
      let no = text(t.no, 40)
      const taken = no && (await tx.prepare('SELECT id FROM alert_ticket WHERE design_id = ? AND ticket_no = ?').get(designId, no))
      if (!no || taken || !numberOf(no)) {
        no = await nextTicketNumber(tx, designId)
        renumbered[id] = no
      } else {
        await bumpCounter(tx, designId, numberOf(no))
      }
      const doc = { ...t, id, no }
      await tx.prepare(
        `INSERT INTO alert_ticket (design_id, id, ticket_no, alert_key, status, equip_key, owner, doc, rev, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,1,?,?)`
      ).run(designId, id, no, text(t.key, 200), status, text(t.equip, 80), text(t.owner, 160),
        ensureSize(doc, 'ticket'), iso(t.created) || stamp, stamp)
      continue
    }

    // An existing ticket: the screen's fields, with every screen's history kept.
    const old = parse(have.doc, {})
    const doc = {
      ...old,
      ...t,
      id,
      no: have.ticket_no,
      hist: unionBy(old.hist, t.hist, histKey).sort((a, b) => (+a.t || 0) - (+b.t || 0)),
      trig: unionBy(t.trig, old.trig, x => String(x.t)).slice(0, 60),
    }
    delete doc.rev
    await tx.prepare(
      `UPDATE alert_ticket SET status = ?, alert_key = ?, equip_key = ?, owner = ?, doc = ?, rev = rev + 1, updated_at = ?
       WHERE design_id = ? AND id = ?`
    ).run(status, text(doc.key, 200), text(doc.equip, 80), text(doc.owner, 160), ensureSize(doc, 'ticket'), stamp, designId, id)
  }

  /* days */
  const days = body.days && typeof body.days === 'object' ? body.days : {}
  for (const [key, rec] of Object.entries(days)) {
    if (!key || !rec || typeof rec !== 'object') continue
    const have = await tx.prepare('SELECT doc FROM alert_day WHERE design_id = ? AND alert_key = ?').get(designId, key.slice(0, 200))
    const merged = mergeDays(have ? parse(have.doc, {}) : {}, rec)
    await tx.prepare(
      `INSERT INTO alert_day (design_id, alert_key, doc, updated_at) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE doc = VALUES(doc), updated_at = VALUES(updated_at)`
    ).run(designId, key.slice(0, 200), ensureSize(merged, 'alert day record'), stamp)
  }

  /* engineered-alert history */
  for (const e of Array.isArray(body.events) ? body.events : []) {
    const id = text(e?.id, 80)
    const rule = text(e?.rule, 80)
    if (!id || !rule) continue
    const have = await tx.prepare('SELECT doc FROM alert_event WHERE design_id = ? AND id = ?').get(designId, id)
    if (!have) {
      const open = await tx.prepare(
        'SELECT id FROM alert_event WHERE design_id = ? AND rule_id = ? AND cleared_at IS NULL AND id <> ? LIMIT 1'
      ).get(designId, rule, id)
      if (open) {
        mergedEvents[id] = open.id
        continue
      }
      await tx.prepare(
        `INSERT INTO alert_event (design_id, id, rule_id, started_at, cleared_at, doc, updated_at) VALUES (?,?,?,?,?,?,?)`
      ).run(designId, id, rule, iso(e.start) || stamp, iso(e.cleared), ensureSize(e, 'alert event'), stamp)
      continue
    }
    const old = parse(have.doc, {})
    // Once cleared or closed, it stays so: an older copy cannot reopen it.
    const doc = { ...old, ...e, cleared: old.cleared || e.cleared || null, closed: old.closed || e.closed || null }
    await tx.prepare('UPDATE alert_event SET cleared_at = ?, doc = ?, updated_at = ? WHERE design_id = ? AND id = ?')
      .run(iso(doc.cleared), ensureSize(doc, 'alert event'), stamp, designId, id)
  }

  /* emails */
  for (const m of Array.isArray(body.mails) ? body.mails : []) {
    const id = text(m?.id, 60)
    if (!id) continue
    const have = await tx.prepare('SELECT id FROM alert_mail WHERE design_id = ? AND id = ?').get(designId, id)
    if (!have && m.ch === 'email') {
      const queued = iso(m.t) || stamp
      const ten = new Date(new Date(queued).getTime() - 10 * 60000).toISOString()
      const same = await tx.prepare(
        'SELECT id, doc FROM alert_mail WHERE design_id = ? AND subject = ? AND queued_at >= ? AND id <> ?'
      ).all(designId, text(m.subject, 300) || '', ten, id)
      const to = JSON.stringify([...(m.to || [])].sort())
      if (same.some(row => JSON.stringify([...(parse(row.doc, {}).to || [])].sort()) === to)) continue
    }
    await tx.prepare(
      `INSERT INTO alert_mail (design_id, id, alert_key, subject, status, queued_at, doc, updated_at) VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), doc = VALUES(doc), updated_at = VALUES(updated_at)`
    ).run(designId, id, text(m.inst, 200), text(m.subject, 300), text(m.status, 200), iso(m.t) || stamp,
      ensureSize(m, 'email record'), stamp)
  }

  /* history older than 120 days goes; tickets are kept */
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString()
  await tx.prepare('DELETE FROM alert_event WHERE design_id = ? AND started_at < ?').run(designId, cutoff)
  await tx.prepare('DELETE FROM alert_mail WHERE design_id = ? AND queued_at < ?').run(designId, cutoff)

  await bumpCounter(tx, designId)
  const { ticket_seq: seq } = await tx.prepare('SELECT ticket_seq FROM alert_counter WHERE design_id = ?').get(designId)
  return { renumbered, mergedTickets, mergedEvents, seq }
}
