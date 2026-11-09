import { db, now } from '../config/db.js'

/**
 * Maintenance, in its own tables — see the block comment in
 * database/schema.sql for why it is no longer a detail of the drawing.
 *
 * The studio's in-memory model is `DOC.maint`:
 *
 *   { plans[], log[], team[], meters{}, assets{}, parts[], cfg{}, seq }
 *
 * and this file is the only place that knows how that maps onto rows. It reads
 * a loop's maintenance back into exactly that shape, and writes one in. Each
 * record's full form is kept in `doc` next to the columns that get filtered
 * and totalled, so a field the studio gains tomorrow round-trips today.
 *
 * Every function that writes takes a `runner` — the `tx` of a transaction or
 * the pool — and must be given the transaction's own `tx` when it is inside
 * one, or it would commit outside it.
 */

/* ------------------------------------------------------------- small utils */

const parse = (text, fallback) => {
  try {
    const value = JSON.parse(text)
    return value ?? fallback
  } catch {
    return fallback
  }
}
const json = value => JSON.stringify(value ?? null)

/** A finite number or null — `''`, `undefined` and `NaN` all mean "not given". */
export const num = value => {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Trimmed text cut to a column's width, or null when there is none. */
export const text = (value, max) => {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s ? s.slice(0, max) : null
}

const bool = value => (value ? 1 : 0)

/**
 * The studio's PIN lock, byte for byte (`mntHash` in 22-maintenance.js).
 *
 * It is a convenience lock and not a login — SandMan accounts are the real
 * identity — and it is kept exactly so a team set up before these tables
 * existed carries on working. Failed attempts are counted so the phone page
 * cannot be used to walk the four-digit space.
 */
export function pinHash(pin) {
  let h = 0x811c9dc5
  for (const c of 'fountrix-mnt|' + String(pin)) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

/** Local `YYYY-MM-DDTHH:MM`, which is how the studio writes every date. */
export function localIso(d = new Date()) {
  const z = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`
}

export const DEFAULT_CFG = {
  warnDays: 3, warnHours: 24, desktop: false, emails: '', wa: '', rate: 350, budget: 0, opHours: 20,
}

/** Largest record accepted — generous against anything real, a guard on junk. */
const MAX_DOC = 64 * 1024

const ensureSize = (record, what) => {
  const s = JSON.stringify(record)
  if (s.length > MAX_DOC) {
    const error = new Error(`A ${what} is too large to store.`)
    error.status = 400
    error.code = 'too_large'
    throw error
  }
  return s
}

/* ----------------------------------------------------------------- reading */

/**
 * Everything the studio keeps in `DOC.maint`, for one loop.
 *
 * The columns win over the copy in `doc` wherever they exist: they are what a
 * phone or a concurrent studio may have moved since `doc` was written, and
 * what the server enforces (the later "last done", the server's stock).
 */
export async function readMaintenance(designId, runner = db) {
  const [plans, work, members, parts, assets, setting] = await Promise.all([
    runner.prepare('SELECT * FROM mnt_plan WHERE design_id = ? ORDER BY equip_key, task').all(designId),
    runner.prepare('SELECT * FROM mnt_work WHERE design_id = ? ORDER BY done_at, created_at').all(designId),
    runner.prepare('SELECT * FROM mnt_member WHERE design_id = ? ORDER BY name').all(designId),
    runner.prepare('SELECT * FROM mnt_part WHERE design_id = ? ORDER BY name').all(designId),
    runner.prepare('SELECT * FROM mnt_asset WHERE design_id = ?').all(designId),
    runner.prepare('SELECT * FROM mnt_setting WHERE design_id = ?').get(designId),
  ])

  return {
    plans: plans.map(planOut),
    log: work.map(workOut),
    team: members.map(memberOut),
    parts: parts.map(partOut),
    assets: Object.fromEntries(assets.map(row => [row.equip_key, parse(row.doc, {})])),
    meters: parse(setting?.meters, {}),
    cfg: { ...DEFAULT_CFG, ...parse(setting?.cfg, {}) },
    seq: setting?.wo_seq || 0,
  }
}

export const planOut = row => ({
  ...parse(row.doc, {}),
  id: row.id,
  blk: row.equip_key,
  last: row.last_done,
  lastH: row.last_hours,
})

export const workOut = row => ({
  ...parse(row.doc, {}),
  id: row.id,
  blk: row.equip_key,
  no: row.wo_no,
  status: row.status,
  rev: row.rev,
  origin: row.origin,
})

const memberOut = row => ({
  ...parse(row.doc, {}),
  id: row.id,
  name: row.name,
  pin: row.pin_hash,
})

export const partOut = row => ({
  ...parse(row.doc, {}),
  id: row.id,
  stock: row.stock,
  rev: row.rev,
})

/* ----------------------------------------------------------------- numbers */

/**
 * The next work-order number for a loop.
 *
 * The counter row is updated first and read back inside the same transaction,
 * so the row lock is what serialises two writers (a desktop and a phone) —
 * they cannot be handed the same number.
 */
export async function nextWorkNumber(tx, designId, dateText) {
  await tx.prepare(
    `INSERT IGNORE INTO mnt_setting (design_id, cfg, meters, wo_seq, updated_at)
     VALUES (?, ?, '{}', 0, ?)`
  ).run(designId, json(DEFAULT_CFG), now())
  await tx.prepare('UPDATE mnt_setting SET wo_seq = wo_seq + 1 WHERE design_id = ?').run(designId)
  const { wo_seq: seq } = await tx.prepare('SELECT wo_seq FROM mnt_setting WHERE design_id = ?').get(designId)
  const year = /^\d{4}/.test(dateText || '') ? dateText.slice(0, 4) : String(new Date().getFullYear())
  return `WO-${year}-${String(seq).padStart(4, '0')}`
}

/* ----------------------------------------------------------------- writing */

/**
 * Take a studio's maintenance into the tables.
 *
 * What it will and will not do is deliberate, because a studio may have been
 * open for hours while somebody logged work from the shop floor:
 *
 *   work log   only ever added to or updated, never deleted, and a cancelled
 *              entry is never un-cancelled or edited again. A work order whose
 *              number is already taken by another entry is renumbered, and the
 *              new number is returned so the studio can adopt it.
 *   plans      "last done" only moves forward — an older copy cannot wind back
 *              a task that was done since.
 *   parts      stock is taken from the studio only when it has seen the
 *              server's latest (`rev`); otherwise the server's figure stands.
 *   the rest   plans, parts, team and assets that the studio no longer has are
 *              removed — but only when it says `replace`, which it does only
 *              after it has first read what the server holds.
 *
 * Returns `{ renumbered, seq }`.
 */
export async function writeMaintenance(tx, designId, body, { replace = false, actor = null } = {}) {
  const stamp = now()
  const renumbered = {}

  /* settings and meters */
  await tx.prepare(
    `INSERT IGNORE INTO mnt_setting (design_id, cfg, meters, wo_seq, updated_at)
     VALUES (?, ?, '{}', 0, ?)`
  ).run(designId, json(DEFAULT_CFG), stamp)
  // Settings and meters are only touched when they are sent: a sync that is
  // about something else must not put the labour rate back to its default.
  if (body.cfg && typeof body.cfg === 'object') {
    const cfg = { ...DEFAULT_CFG, ...body.cfg }
    await tx.prepare('UPDATE mnt_setting SET cfg = ?, updated_at = ? WHERE design_id = ?')
      .run(ensureSize(cfg, 'setting'), stamp, designId)
  }
  if (body.meters && typeof body.meters === 'object') {
    await tx.prepare('UPDATE mnt_setting SET meters = ?, updated_at = ? WHERE design_id = ?')
      .run(ensureSize(body.meters, 'meter list'), stamp, designId)
  }
  await tx.prepare('UPDATE mnt_setting SET wo_seq = GREATEST(wo_seq, ?) WHERE design_id = ?')
    .run(Math.max(0, Math.floor(num(body.seq) || 0)), designId)

  /* asset register */
  const assets = body.assets && typeof body.assets === 'object' ? body.assets : {}
  for (const [key, a] of Object.entries(assets)) {
    if (!a || typeof a !== 'object') continue
    await tx.prepare(
      `INSERT INTO mnt_asset
         (design_id, equip_key, make, model, serial_no, installed_on, power_kw, criticality,
          supplier, phone, location, warranty_to, doc, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE make=VALUES(make), model=VALUES(model), serial_no=VALUES(serial_no),
         installed_on=VALUES(installed_on), power_kw=VALUES(power_kw), criticality=VALUES(criticality),
         supplier=VALUES(supplier), phone=VALUES(phone), location=VALUES(location),
         warranty_to=VALUES(warranty_to), doc=VALUES(doc), updated_by=VALUES(updated_by),
         updated_at=VALUES(updated_at)`
    ).run(
      designId, text(key, 80), text(a.make, 160), text(a.model, 160), text(a.serial, 160),
      text(a.inst, 40), num(a.power), text(a.crit, 4), text(a.supplier, 200), text(a.phone, 60),
      text(a.loc, 200), text(a.warranty, 40), ensureSize(a, 'machine record'), actor, stamp
    )
  }
  if (replace) await deleteMissing(tx, 'mnt_asset', 'equip_key', designId, Object.keys(assets))

  /* plans */
  const plans = Array.isArray(body.plans) ? body.plans : []
  for (const p of plans) {
    if (!p?.id || !p.blk || !p.task) continue
    await tx.prepare(
      `INSERT INTO mnt_plan
         (id, design_id, equip_key, task, kind, every_days, every_hours, safety_critical, paused,
          responsible, last_done, last_hours, doc, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE equip_key=VALUES(equip_key), task=VALUES(task), kind=VALUES(kind),
         every_days=VALUES(every_days), every_hours=VALUES(every_hours),
         safety_critical=VALUES(safety_critical), paused=VALUES(paused),
         responsible=VALUES(responsible), doc=VALUES(doc), updated_at=VALUES(updated_at),
         last_hours = IF(VALUES(last_done) IS NOT NULL AND (last_done IS NULL OR VALUES(last_done) >= last_done),
                         VALUES(last_hours), last_hours),
         last_done  = IF(VALUES(last_done) IS NOT NULL AND (last_done IS NULL OR VALUES(last_done) >= last_done),
                         VALUES(last_done), last_done)`
    ).run(
      text(p.id, 40), designId, text(p.blk, 80), text(p.task, 300), text(p.kind, 12) || 'pm',
      num(p.days), num(p.hours), bool(p.crit), bool(p.paused), text(p.who, 160),
      text(p.last, 40), num(p.lastH), ensureSize(p, 'task'), stamp
    )
  }
  if (replace) await deleteMissing(tx, 'mnt_plan', 'id', designId, plans.map(p => p?.id))

  /* spare parts */
  const parts = Array.isArray(body.parts) ? body.parts : []
  for (const q of parts) {
    if (!q?.id || !q.name) continue
    const have = await tx.prepare('SELECT rev, stock FROM mnt_part WHERE design_id = ? AND id = ?').get(designId, q.id)
    const sent = Math.max(0, Math.floor(num(q.rev) || 0))
    // The studio has seen the server's latest, or the part is new: take its stock.
    const stockFromStudio = !have || sent >= have.rev
    const stock = stockFromStudio ? num(q.stock) ?? 0 : have.stock
    if (!have) {
      await tx.prepare(
        `INSERT INTO mnt_part (id, design_id, part_no, name, unit, unit_cost, stock, min_stock,
                               for_machines, doc, rev, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`
      ).run(text(q.id, 40), designId, text(q.no, 80), text(q.name, 200), text(q.unit, 20),
        num(q.cost), stock, num(q.min), text(q.for, 300), ensureSize(q, 'part'), stamp)
    } else {
      const moved = stockFromStudio && stock !== have.stock
      await tx.prepare(
        `UPDATE mnt_part SET part_no=?, name=?, unit=?, unit_cost=?, stock=?, min_stock=?,
                             for_machines=?, doc=?, rev = rev + ?, updated_at=?
         WHERE design_id = ? AND id = ?`
      ).run(text(q.no, 80), text(q.name, 200), text(q.unit, 20), num(q.cost), stock, num(q.min),
        text(q.for, 300), ensureSize(q, 'part'), moved ? 1 : 0, stamp, designId, q.id)
    }
  }
  if (replace) await deleteMissing(tx, 'mnt_part', 'id', designId, parts.map(q => q?.id))

  /* the team */
  const team = Array.isArray(body.team) ? body.team : []
  for (const m of team) {
    if (!m?.id || !m.name) continue
    const have = await tx.prepare('SELECT pin_hash FROM mnt_member WHERE design_id = ? AND id = ?').get(designId, m.id)
    const pin = text(m.pin, 64)
    const doc = { ...m }
    delete doc.pin
    await tx.prepare(
      `INSERT INTO mnt_member (id, design_id, name, role, rank_key, phone, email, pin_hash, doc, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), rank_key=VALUES(rank_key),
         phone=VALUES(phone), email=VALUES(email), pin_hash=VALUES(pin_hash), doc=VALUES(doc),
         updated_at=VALUES(updated_at),
         failed_pins = IF(pin_hash <=> VALUES(pin_hash), failed_pins, 0),
         locked_until = IF(pin_hash <=> VALUES(pin_hash), locked_until, NULL)`
    ).run(text(m.id, 40), designId, text(m.name, 160), text(m.role, 160), text(m.rk, 20),
      text(m.phone, 60), text(m.email, 200), pin ?? have?.pin_hash ?? null, ensureSize(doc, 'team member'), stamp)
  }
  if (replace) await deleteMissing(tx, 'mnt_member', 'id', designId, team.map(m => m?.id))

  /* the work log — added to and updated, never deleted */
  const log = Array.isArray(body.log) ? body.log : []
  for (const entry of log) {
    if (!entry?.id || !entry.blk) continue
    const result = await saveWork(tx, designId, entry, 'studio', stamp)
    if (result.renumbered) renumbered[entry.id] = result.renumbered
  }

  const { wo_seq: seq } = await tx.prepare('SELECT wo_seq FROM mnt_setting WHERE design_id = ?').get(designId)
  return { renumbered, seq }
}

/** Remove the rows of a loop that the writer no longer has. */
async function deleteMissing(tx, table, column, designId, keep) {
  const ids = keep.filter(Boolean).map(String)
  if (!ids.length) {
    await tx.prepare(`DELETE FROM ${table} WHERE design_id = ?`).run(designId)
    return
  }
  const holes = ids.map(() => '?').join(',')
  await tx.prepare(`DELETE FROM ${table} WHERE design_id = ? AND ${column} NOT IN (${holes})`).run(designId, ...ids)
}

/**
 * Insert or update one work-log entry.
 *
 * Returns `{ renumbered }` when the entry's work-order number had to change.
 */
export async function saveWork(tx, designId, entry, origin, stamp = now()) {
  const id = text(entry.id, 40)
  const have = await tx.prepare('SELECT status, wo_no, rev FROM mnt_work WHERE design_id = ? AND id = ?').get(designId, id)

  // A cancelled entry is final: it stays as it was written, with its reason.
  if (have?.status === 'cancelled') return {}

  let woNo = text(entry.no, 40)
  let renumbered
  if (woNo) {
    const clash = await tx.prepare('SELECT id FROM mnt_work WHERE design_id = ? AND wo_no = ? AND id <> ?')
      .get(designId, woNo, id)
    if (clash) {
      woNo = await nextWorkNumber(tx, designId, entry.date)
      renumbered = woNo
    }
  } else if (have?.wo_no) {
    woNo = have.wo_no
  } else {
    woNo = await nextWorkNumber(tx, designId, entry.date)
    renumbered = woNo
  }

  const doc = { ...entry, id, no: woNo }
  const row = [
    text(entry.blk, 80), woNo, text(entry.kind, 12) || 'pm', text(entry.task, 500) || '',
    text(entry.date, 40) || localIso(), text(entry.by, 160), text(entry.status, 12) || 'done',
    text(entry.prio, 4), text(entry.assign, 160), bool(entry.stop), num(entry.hours), num(entry.down),
    num(entry.labHrs), num(entry.cost), text(entry.plan, 40), text(entry.wo, 40),
    text(entry.cxAt, 40), text(entry.cxBy, 160), text(entry.cxWhy, 500), ensureSize(doc, 'work entry'),
  ]

  if (!have) {
    await tx.prepare(
      `INSERT INTO mnt_work
         (design_id, id, equip_key, wo_no, kind, task, done_at, done_by, status, priority, assigned_to,
          stops_line, running_hours, downtime_min, labour_hours, total_cost, plan_id, closes_id,
          cancelled_at, cancelled_by, cancel_reason, doc, origin, rev, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`
    ).run(designId, id, ...row, origin, stamp, stamp)
  } else {
    await tx.prepare(
      `UPDATE mnt_work SET equip_key=?, wo_no=?, kind=?, task=?, done_at=?, done_by=?, status=?,
         priority=?, assigned_to=?, stops_line=?, running_hours=?, downtime_min=?, labour_hours=?,
         total_cost=?, plan_id=?, closes_id=?, cancelled_at=?, cancelled_by=?, cancel_reason=?,
         doc=?, rev = rev + 1, updated_at=?
       WHERE design_id = ? AND id = ?`
    ).run(...row, stamp, designId, id)
  }
  return { renumbered }
}
