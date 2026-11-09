import { db, now, uid, transaction, audit } from '../config/db.js'
import { config } from '../config/index.js'
import { createRouter } from '../utils/router.js'
import { created } from '../utils/respond.js'
import { rateLimit } from '../utils/rate-limit.js'
import { badRequest, conflict, forbidden, notFound, unauthorized, HttpError } from '../utils/errors.js'
import { readSession } from '../services/session-store.js'
import { tokenFromRequest } from '../middleware/auth.js'
import { buildCard, cardForToken, hoursFor } from '../services/machine-card.js'
import { DEFAULT_CFG, localIso, num, pinHash, saveWork, text } from '../services/maintenance-store.js'

/**
 * THE MACHINE PAGE — what a QR code on the shop floor opens
 *
 * `GET /api/v1/m/:token` is mounted **without** `authenticate`: somebody
 * standing at a machine with a phone has no SandMan session and should not
 * need one to see the machine's readings, what is due and how to report a
 * fault. The token on the sticker is the credential — 128 random bits, unique
 * to one machine — and it can be turned off altogether with
 * `DL_CARD_REQUIRE_LOGIN=1`, in which case a valid session is required too.
 *
 * What the token allows is deliberately narrow:
 *
 *   read    this one machine's card. Never another machine, never the loop,
 *           never a credential or a plant database.
 *   report  a service request. Anybody at the machine may say something is
 *           wrong; it lands in the control room's list as an open work order.
 *   log     work done. Needs a maintenance-team member's PIN, as it does in
 *           the studio, and PIN attempts are counted and locked out.
 *
 * Every endpoint is rate-limited per address, because there is no login to
 * hang a quota on.
 */

export const machine = createRouter()

const readLimit = rateLimit({ windowMs: 60_000, max: 120 })
const writeLimit = rateLimit({ windowMs: 60_000, max: 20 })

/** With login required, a phone must carry a valid session as well as the token. */
function gate(req) {
  if (!config.machineCards.requireLogin) return
  if (!readSession(tokenFromRequest(req))) {
    throw unauthorized('Sign in through SandMan to open this machine.')
  }
}

const PIN_TRIES = 5
const LOCK_MINUTES = 10

/**
 * Check a team member's PIN. Runs on its own connection, before the write's
 * transaction, so a wrong guess is counted even though the request then fails.
 */
async function verifyMember(designId, memberId, pin) {
  const member = await db.prepare('SELECT * FROM mnt_member WHERE design_id = ? AND id = ?').get(designId, String(memberId || ''))
  if (!member || !/^\d{3,8}$/.test(String(pin ?? ''))) {
    throw forbidden('That name and PIN do not match.')
  }
  if (member.locked_until && member.locked_until > now()) {
    throw new HttpError(423, 'pin_locked', 'Too many wrong PINs — try again in a few minutes, or ask the control room.')
  }
  if (!member.pin_hash || pinHash(pin) !== member.pin_hash) {
    const failed = member.failed_pins + 1
    if (failed >= PIN_TRIES) {
      const until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
      await db.prepare('UPDATE mnt_member SET failed_pins = 0, locked_until = ? WHERE design_id = ? AND id = ?').run(until, designId, member.id)
    } else {
      await db.prepare('UPDATE mnt_member SET failed_pins = ? WHERE design_id = ? AND id = ?').run(failed, designId, member.id)
    }
    throw forbidden('That name and PIN do not match.')
  }
  if (member.failed_pins || member.locked_until) {
    await db.prepare('UPDATE mnt_member SET failed_pins = 0, locked_until = NULL WHERE design_id = ? AND id = ?').run(designId, member.id)
  }
  return member
}

const widen = (card, design) => {
  if (card.retired_at) throw new HttpError(410, 'retired', `${card.tag} has been removed from ${design.name}.`)
}

const mustBeNumber = (value, label, max = 1e7) => {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > max) throw badRequest('invalid_field', `"${label}" must be a number from 0 to ${max}.`)
  return n
}

const when = value => {
  if (value === undefined || value === null || value === '') return localIso()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value))) throw badRequest('invalid_field', '"date" must be YYYY-MM-DDTHH:MM.')
  // A phone's clock and this server's may sit in different time zones: a day of slack, no more.
  if (new Date(value).getTime() > Date.now() + 36 * 3600_000) throw badRequest('invalid_field', 'The time cannot be in the future.')
  return String(value)
}

const entryId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/* ----------------------------------------------------------------- reading */

machine.get('/:token', async ({ req, params }) => {
  readLimit(req, 'read')
  gate(req)
  const { card, design } = await cardForToken(params.token)
  return buildCard(card, design)
})

/* ------------------------------------------------------------ report a fault */

machine.post('/:token/request', async ({ req, params, body }) => {
  writeLimit(req, 'write')
  gate(req)
  const { card, design } = await cardForToken(params.token)
  widen(card, design)

  const task = text(body.task, 500)
  if (!task) throw badRequest('invalid_field', 'Say what is wrong.')
  const prio = ['P1', 'P2', 'P3', 'P4'].includes(body.priority) ? body.priority : 'P3'

  // A team member who gives their PIN is named; anybody else gives a name.
  let by = text(body.reportedBy, 80)
  if (body.memberId) by = (await verifyMember(design.id, body.memberId, body.pin)).name
  if (!by) throw badRequest('invalid_field', 'Enter your name.')

  const openCount = await db.prepare(
    `SELECT COUNT(*) AS n FROM mnt_work WHERE design_id = ? AND equip_key = ? AND kind = 'breakdown' AND status NOT IN ('closed','cancelled')`
  ).get(design.id, card.equip_key)
  if (Number(openCount.n) >= 25) throw conflict('too_many_open', 'This machine already has many open requests — tell the control room.')

  const date = localIso()
  const entry = {
    id: entryId(), blk: card.equip_key, kind: 'breakdown', task, date, by,
    notes: text(body.notes, 1000) || '', status: 'open', stop: !!body.stop, prio, assign: '',
    hist: [{ t: date, by, st: 'open', assign: '', note: 'Reported from the shop floor (QR)' }],
  }

  const saved = await transaction(async tx => {
    const result = await saveWork(tx, design.id, entry, 'phone')
    await audit(`qr:${card.tag}`, 'maintenance.request', 'mnt_work', entry.id, { by, prio, stop: entry.stop }, tx)
    return result
  })

  return created({ id: entry.id, no: saved.renumbered, task, priority: prio, status: 'open' })
})

/* ----------------------------------------------------------------- log work */

machine.post('/:token/work', async ({ req, params, body }) => {
  writeLimit(req, 'write')
  gate(req)
  const { card, design } = await cardForToken(params.token)
  widen(card, design)

  const member = await verifyMember(design.id, body.memberId, body.pin)

  const planRow = body.planId
    ? await db.prepare('SELECT * FROM mnt_plan WHERE design_id = ? AND id = ? AND equip_key = ?').get(design.id, String(body.planId), card.equip_key)
    : null
  if (body.planId && !planRow) throw notFound('That planned task is not on this machine.')

  const woRow = body.woId
    ? await db.prepare('SELECT * FROM mnt_work WHERE design_id = ? AND id = ? AND equip_key = ?').get(design.id, String(body.woId), card.equip_key)
    : null
  if (body.woId && (!woRow || woRow.kind !== 'breakdown' || ['closed', 'cancelled'].includes(woRow.status))) {
    throw conflict('not_open', 'That service request is not open any more.')
  }

  const kind = planRow ? planRow.kind : woRow ? 'repair' : String(body.kind || '')
  if (!['pm', 'insp', 'ovh', 'repair'].includes(kind)) throw badRequest('invalid_field', '"kind" must be pm, insp, ovh or repair.')
  const task = planRow ? planRow.task : text(body.task, 500)
  if (!task) throw badRequest('invalid_field', 'Enter the work done.')

  const date = when(body.date)
  const hoursNow = body.hours === undefined || body.hours === '' ? null : mustBeNumber(body.hours, 'hours', 1e9)
  const down = mustBeNumber(body.downMin, 'downMin', 1e6)
  const labHrs = mustBeNumber(body.labHrs, 'labHrs', 1e4)
  const other = mustBeNumber(body.other, 'other', 1e9)

  const result = await transaction(async tx => {
    const setting = await tx.prepare('SELECT cfg FROM mnt_setting WHERE design_id = ?').get(design.id)
    let cfg = DEFAULT_CFG
    try { cfg = { ...DEFAULT_CFG, ...JSON.parse(setting?.cfg || '{}') } } catch { /* defaults */ }

    // Parts leave the store, priced as they were when used.
    const used = []
    for (const u of Array.isArray(body.partsUsed) ? body.partsUsed.slice(0, 30) : []) {
      const qty = mustBeNumber(u?.qty, 'qty', 1e6)
      if (!qty) continue
      const part = await tx.prepare('SELECT * FROM mnt_part WHERE design_id = ? AND id = ?').get(design.id, String(u.id || ''))
      if (!part) throw notFound('A spare part you picked is no longer in the store.')
      used.push({ id: part.id, qty, cost: part.unit_cost ?? 0, name: part.name })
      await tx.prepare('UPDATE mnt_part SET stock = ROUND(stock - ?, 3), rev = rev + 1, updated_at = ? WHERE design_id = ? AND id = ?')
        .run(qty, now(), design.id, part.id)
    }

    const rate = Number(cfg.rate) || 0
    const total = Math.round((labHrs || 0) * rate + used.reduce((a, u) => a + u.qty * u.cost, 0) + (other || 0))

    const entry = {
      id: entryId(), blk: card.equip_key, kind, task, date, by: member.name,
      notes: text(body.notes, 1000) || '', status: 'done', hours: hoursNow, down: down || 0,
      parts: text(body.partsText, 300) || '', labHrs: labHrs || 0, rate, pused: used, other: other || 0, cost: total,
    }
    if (kind === 'repair' && body.fail && typeof body.fail === 'object') {
      const fail = { p: text(body.fail.p, 80) || '', c: text(body.fail.c, 80) || '', a: text(body.fail.a, 80) || '' }
      if (fail.p || fail.c || fail.a) entry.fail = fail
    }
    if (Array.isArray(body.checks)) {
      entry.checks = body.checks.slice(0, 40).map(c => ({ t: String(c?.t ?? '').slice(0, 300), ok: !!c?.ok }))
    }

    if (planRow) {
      entry.plan = planRow.id
      // Was it late? Days first, then hours, as the studio reckons it.
      let dl = null
      if (planRow.every_days && planRow.last_done) {
        const dueAt = new Date(planRow.last_done.length <= 10 ? `${planRow.last_done}T00:00` : planRow.last_done).getTime() + planRow.every_days * 864e5
        dl = (dueAt - new Date(date).getTime()) / 864e5
      }
      const meter = hoursNow ?? (await hoursFor(design.id, card.equip_key, tx))?.v ?? null
      const hl = planRow.every_hours && planRow.last_hours != null && meter != null ? planRow.last_hours + planRow.every_hours - meter : null
      if ((dl != null && dl < 0) || (hl != null && hl < 0)) entry.late = Math.max(1, Math.ceil(-(dl != null ? dl : hl / 16)))
      await tx.prepare(
        `UPDATE mnt_plan SET
           last_hours = IF(? >= IFNULL(last_done, ''), ?, last_hours),
           last_done  = IF(? >= IFNULL(last_done, ''), ?, last_done),
           updated_at = ?
         WHERE design_id = ? AND id = ?`
      ).run(date.slice(0, 10), planRow.every_hours ? (hoursNow ?? (meter != null ? Math.round(meter) : null)) : planRow.last_hours,
        date.slice(0, 10), date.slice(0, 10), now(), design.id, planRow.id)
    }

    if (woRow) {
      entry.wo = woRow.id
    }

    const saved = await saveWork(tx, design.id, entry, 'phone')

    if (woRow) {
      // The repair closes the service request that asked for it.
      const doc = JSON.parse(woRow.doc || '{}')
      doc.status = 'closed'
      doc.closed = date
      doc.closedBy = entry.id
      doc.hist = [...(Array.isArray(doc.hist) ? doc.hist : []), { t: localIso(), by: member.name, st: 'closed', note: `${saved.renumbered || ''} ${task}`.trim() }]
      await saveWork(tx, design.id, { ...doc, id: woRow.id, blk: woRow.equip_key, no: woRow.wo_no, kind: 'breakdown', task: woRow.task, date: woRow.done_at, by: woRow.done_by }, 'phone')
    }

    await audit(`member:${member.id}`, 'maintenance.work', 'mnt_work', entry.id, { tag: card.tag, kind, task }, tx)
    return { id: entry.id, no: saved.renumbered, kind, task, cost: total }
  })

  return created(result)
})
