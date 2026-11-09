import { db, now } from '../config/db.js'
import { notFound } from '../utils/errors.js'
import { DEFAULT_CFG, planOut, workOut, num } from './maintenance-store.js'

/**
 * What a phone shows when somebody scans a machine's QR code.
 *
 * Assembled on the server from three places, because the phone has no session
 * and cannot open the whole loop:
 *
 *   the drawing   the machine's name, readings and their limits, and which
 *                 process it belongs to (from the published version, or the
 *                 latest when nothing is published yet)
 *   the tables    maintenance, open requests, active alarms, the written SOP
 *   the cache     the last real value read for each of its readings
 *
 * Nothing here invents a reading. A value is shown only if a live read once
 * stored one, with the time it was read.
 */

/** The card for a QR token, with the loop it belongs to. */
export async function cardForToken(token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(token || ''))) throw notFound('This QR code is not recognised.')
  const card = await db.prepare('SELECT * FROM equipment_card WHERE qr_token = ?').get(String(token))
  if (!card) throw notFound('This QR code is not recognised.')
  const design = await db.prepare('SELECT * FROM design WHERE id = ?').get(card.design_id)
  if (!design) throw notFound('This QR code is not recognised.')
  return { card, design }
}

/** The version a phone should read: what the plant sees, else the newest. */
async function layoutOf(design) {
  const row = design.published_version_id
    ? await db.prepare('SELECT layout FROM design_version WHERE id = ?').get(design.published_version_id)
    : await db.prepare('SELECT layout FROM design_version WHERE design_id = ? ORDER BY version DESC LIMIT 1').get(design.id)
  try {
    return JSON.parse(row?.layout || '{}')
  } catch {
    return {}
  }
}

/** Same rule as the studio's `sevAt`: 3 critical, 2 warning, 1 advisory, 0 normal. */
export function severity(t, v) {
  if (!t || v === null || v === undefined || !Number.isFinite(v)) return 0
  const typ = Number.isFinite(t.typ) ? t.typ : 0
  const { hh, hi, lo, ll } = t
  if ((hh != null && v >= hh) || (ll != null && v <= ll)) return 3
  if ((hi != null && v >= hi) || (lo != null && v <= lo)) return 2
  if ((hi != null && v >= typ + (hi - typ) * 0.75) || (lo != null && v <= typ - (typ - lo) * 0.75)) return 1
  return 0
}

const DAY = 864e5
const asDate = s => (s ? new Date(String(s).length <= 10 ? `${s}T00:00` : s) : null)

/** The running hours of a machine: the PLC hour-meter's last value, else the latest logged reading. */
function runningHours(equipKey, meters, readings, work) {
  const tag = meters?.[equipKey]?.tag
  const live = tag && readings.get(tag)
  if (live && Number.isFinite(live.num_value)) return { v: live.num_value, src: `PLC tag ${tag}`, live: true }
  let best = null
  for (const e of work) {
    if (e.status === 'cancelled' || e.running_hours === null || e.running_hours === undefined) continue
    if (!best || asDate(e.done_at) > asDate(best.done_at)) best = e
  }
  return best ? { v: best.running_hours, src: `reading on ${best.done_at.slice(0, 10)}`, live: false } : null
}

/** Mirror of the studio's `mntState`: is a planned task OK, due soon or overdue. */
export function planState(p, cfg, hoursNow) {
  const t = Date.now()
  let dl = null
  let hl = null
  if (p.days && p.last) dl = (asDate(p.last).getTime() + p.days * DAY - t) / DAY
  if (p.hours && p.lastH != null && hoursNow) hl = +p.lastH + p.hours - hoursNow.v

  let st
  if (p.paused) st = 'paused'
  else if (!p.last && (p.lastH == null || p.lastH === '')) st = 'new'
  else if ((dl != null && dl < 0) || (hl != null && hl < 0)) st = 'over'
  else if ((dl != null && dl <= Math.min(cfg.warnDays, p.days / 3)) || (hl != null && hl <= Math.min(cfg.warnHours, p.hours / 3))) st = 'soon'
  else st = 'ok'

  const bits = []
  if (dl != null) {
    bits.push(dl < 0 ? `${Math.ceil(-dl)} day${Math.ceil(-dl) > 1 ? 's' : ''} overdue`
      : dl < 1 ? 'due today' : `due in ${Math.floor(dl)} day${Math.floor(dl) > 1 ? 's' : ''}`)
  }
  if (hl != null) bits.push(hl < 0 ? `${Math.round(-hl)} h over` : `${Math.round(hl)} h left`)
  const textOut = st === 'paused' ? 'Paused' : st === 'new' ? 'No record yet' : bits.join(' · ')
  const score = st === 'paused' ? 1e9 : st === 'new' ? -0.5 : Math.min(dl != null ? dl : 1e6, hl != null ? hl / 16 : 1e6)
  return { st, text: textOut, score, dl, hl }
}

/** The machine's running hours right now, for stamping a job with the meter reading. */
export async function hoursFor(designId, equipKey, runner = db) {
  const setting = await runner.prepare('SELECT meters FROM mnt_setting WHERE design_id = ?').get(designId)
  let meters = {}
  try { meters = JSON.parse(setting?.meters || '{}') } catch { /* none */ }
  const tag = meters?.[equipKey]?.tag
  const readings = new Map()
  if (tag) {
    const r = await runner.prepare('SELECT * FROM tag_reading WHERE design_id = ? AND tag_id = ?').get(designId, tag)
    if (r) readings.set(tag, r)
  }
  const work = await runner.prepare(
    `SELECT done_at, status, running_hours FROM mnt_work
     WHERE design_id = ? AND equip_key = ? AND running_hours IS NOT NULL AND status <> 'cancelled'
     ORDER BY done_at DESC LIMIT 1`
  ).all(designId, equipKey)
  return runningHours(equipKey, meters, readings, work)
}

const every = p => {
  const a = []
  if (p.days === 1) a.push('day')
  else if (p.days) a.push(p.days % 365 === 0 ? `${p.days / 365} yr` : p.days % 30 === 0 && p.days >= 60 ? `${p.days / 30} months` : `${p.days} days`)
  if (p.hours) a.push(`${p.hours} h`)
  return a.length ? `Every ${a.join(' or ')}` : ''
}

/** The written procedure for the process this machine belongs to. */
async function procedureFor(design, layout, equipKey) {
  const area = (layout?.DOC?.cps || []).find(c => (c.blocks || []).includes(equipKey))
  if (!area) return null
  const row = await db.prepare('SELECT * FROM sop WHERE design_id = ? AND process_id = ?').get(design.id, String(area.id))
  if (row) {
    const steps = await db.prepare('SELECT * FROM sop_step WHERE sop_id = ? ORDER BY ordinal').all(row.id)
    return { no: row.no || '', title: row.title || area.name || '', area: area.name || '', steps: steps.map(s => ({ t: s.text, key: s.key_point || '' })) }
  }
  const sop = area.sop
  if (sop?.steps?.length) return { no: sop.no || '', title: sop.title || area.name || '', area: area.name || '', steps: sop.steps.map(s => ({ t: s.t, key: s.key || '' })) }
  return null
}

/** The whole card, as the phone page draws it. */
export async function buildCard(card, design) {
  const layout = await layoutOf(design)
  const DOC = layout?.DOC || {}
  const REG = layout?.REG || {}
  const block = (DOC.blocks || []).find(b => String(b.id) === card.equip_key)

  // Readings: the drawing says which and with what limits, the cache what they last were.
  const tagIds = (block?.tags || []).map(t => t.id).filter(id => REG[id])
  const stored = new Map()
  if (tagIds.length) {
    const holes = tagIds.map(() => '?').join(',')
    const rows = await db.prepare(`SELECT * FROM tag_reading WHERE design_id = ? AND tag_id IN (${holes})`).all(design.id, ...tagIds)
    for (const r of rows) stored.set(r.tag_id, r)
  }
  const readings = tagIds.map(id => {
    const t = REG[id]
    const r = stored.get(id)
    const value = r && Number.isFinite(r.num_value) ? r.num_value : null
    return {
      id,
      label: t.desc || id,
      unit: t.unit || '',
      decimals: Number.isInteger(t.d) ? t.d : null,
      value,
      text: r?.text_value ?? null,
      readAt: r?.read_at ?? null,
      linked: !!t.link,
      limits: { ll: t.ll ?? null, lo: t.lo ?? null, hi: t.hi ?? null, hh: t.hh ?? null },
      severity: severity(t, value),
    }
  })

  const [alarmRows, setting, planRows, workRows, memberRows, assetRow] = await Promise.all([
    db.prepare(
      `SELECT * FROM alarm_event WHERE design_id = ? AND equipment = ? AND returned_at IS NULL ORDER BY severity DESC, raised_at DESC LIMIT 20`
    ).all(design.id, card.tag),
    db.prepare('SELECT * FROM mnt_setting WHERE design_id = ?').get(design.id),
    db.prepare('SELECT * FROM mnt_plan WHERE design_id = ? AND equip_key = ?').all(design.id, card.equip_key),
    db.prepare('SELECT * FROM mnt_work WHERE design_id = ? AND equip_key = ? ORDER BY done_at DESC LIMIT 200').all(design.id, card.equip_key),
    db.prepare('SELECT id, name, role FROM mnt_member WHERE design_id = ? ORDER BY name').all(design.id),
    db.prepare('SELECT * FROM mnt_asset WHERE design_id = ? AND equip_key = ?').get(design.id, card.equip_key),
  ])

  let cfg = DEFAULT_CFG
  let meters = {}
  try { cfg = { ...DEFAULT_CFG, ...JSON.parse(setting?.cfg || '{}') } } catch { /* defaults */ }
  try { meters = JSON.parse(setting?.meters || '{}') } catch { /* none */ }

  // The hour meter may be a reading on another machine's tag, so look it up directly.
  const meterTag = meters?.[card.equip_key]?.tag
  const meterRows = new Map(stored)
  if (meterTag && !meterRows.has(meterTag)) {
    const r = await db.prepare('SELECT * FROM tag_reading WHERE design_id = ? AND tag_id = ?').get(design.id, meterTag)
    if (r) meterRows.set(meterTag, r)
  }
  const hours = runningHours(card.equip_key, meters, meterRows, workRows)

  const plans = planRows.map(planOut)
    .map(p => ({ p, s: planState(p, cfg, hours) }))
    .sort((a, b) => a.s.score - b.s.score)
    .map(({ p, s }) => ({
      id: p.id, task: p.task, kind: p.kind, every: every(p), state: s.st, text: s.text,
      critical: !!p.crit, who: p.who || '', steps: Array.isArray(p.steps) ? p.steps : [],
    }))

  const work = workRows.map(workOut)
  const open = work.filter(e => e.kind === 'breakdown' && e.status !== 'closed' && e.status !== 'cancelled')
  const last = work.filter(e => e.kind !== 'breakdown' && e.status !== 'cancelled').slice(0, 5)

  const worst = Math.max(0, ...readings.map(r => r.severity), ...alarmRows.map(a => a.severity))
  const asset = assetRow ? JSON.parse(assetRow.doc || '{}') : {}

  return {
    asOf: now(),
    machine: {
      tag: card.tag,
      description: block?.props?.desc || card.description || '',
      type: card.equip_type,
      retired: !!card.retired_at,
      // Registered, but the saved version of the loop does not contain it yet.
      saved: !!block,
      status: worst >= 3 ? 'alarm' : worst >= 2 ? 'warning' : readings.some(r => r.value !== null) ? 'ok' : 'unknown',
    },
    loop: { name: design.name, line: design.line_name, foundry: design.foundry_name },
    asset: {
      make: asset.make || '', model: asset.model || '', serial: asset.serial || '', installed: asset.inst || asset.year || '',
      power: asset.power || '', criticality: asset.crit || '', location: asset.loc || '',
      supplier: asset.supplier || '', phone: asset.phone || '', warranty: asset.warranty || '', notes: asset.notes || '',
    },
    readings,
    alarms: alarmRows.map(a => ({ id: a.id, severity: a.severity, message: a.message || '', raisedAt: a.raised_at, acked: !!a.acked_at })),
    maintenance: {
      hours: hours ? { value: hours.v, source: hours.src, live: hours.live } : null,
      plans,
      open: open.map(e => ({ id: e.id, no: e.no, task: e.task, status: e.status, priority: e.prio || '', date: e.date, by: e.by || '', stop: !!e.stop })),
      last: last.map(e => ({ id: e.id, no: e.no, kind: e.kind, task: e.task, date: e.date, by: e.by || '' })),
    },
    sop: await procedureFor(design, layout, card.equip_key),
    team: memberRows.map(m => ({ id: m.id, name: m.name, role: m.role || '' })),
  }
}

export { num }
