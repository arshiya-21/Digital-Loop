import { db, now } from '../config/db.js'
import { config } from '../config/index.js'
import { createRouter } from '../utils/router.js'
import { rateLimit } from '../utils/rate-limit.js'
import { notFound, unauthorized, HttpError } from '../utils/errors.js'
import { readSession } from '../services/session-store.js'
import { tokenFromRequest } from '../middleware/auth.js'
import { severity } from '../services/machine-card.js'

/**
 * THE CATEGORY PAGE — what a category QR sticker opens (`/c/<token>`).
 *
 * Mounted **without** `authenticate`, exactly as the machine page: the person
 * at the sand lab or the furnace platform has no SandMan session. The token on
 * the sticker is the credential — 128 random bits, one category — and
 * `DL_CARD_REQUIRE_LOGIN=1` requires a session as well, as for machines.
 *
 * Read only, and narrow: this one category's readings (name, value, limits,
 * status, when read). Never the loop, another category, a machine's
 * maintenance, a credential or a plant database. Rate-limited per address.
 */
export const category = createRouter()

const readLimit = rateLimit({ windowMs: 60_000, max: 120 })

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

category.get('/:token', async ({ req, params }) => {
  readLimit(req, 'read')
  if (config.machineCards.requireLogin && !readSession(tokenFromRequest(req))) {
    throw unauthorized('Sign in through SandMan to open this process parameter.')
  }
  const token = String(params.token || '')
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound('This QR code is not recognised.')
  const card = await db.prepare('SELECT * FROM category_card WHERE qr_token = ?').get(token)
  if (!card) throw notFound('This QR code is not recognised.')
  const design = await db.prepare('SELECT * FROM design WHERE id = ?').get(card.design_id)
  if (!design) throw notFound('This QR code is not recognised.')
  if (card.retired_at) throw new HttpError(410, 'retired', `The process parameter “${card.name}” has been removed from ${design.name}.`)

  const layout = await layoutOf(design)
  const REG = layout.REG || {}
  const blocks = layout.DOC?.blocks || []
  const ownerOf = id => blocks.find(b => (b.tags || []).some(t => t.id === id))
  let ids = []
  try { ids = JSON.parse(card.tags || '[]') } catch { ids = [] }
  ids = ids.filter(id => REG[id])

  const stored = new Map()
  if (ids.length) {
    const rows = await db.prepare(`SELECT * FROM tag_reading WHERE design_id = ? AND tag_id IN (${ids.map(() => '?').join(',')})`).all(design.id, ...ids)
    for (const r of rows) stored.set(r.tag_id, r)
  }
  const readings = ids.map(id => {
    const t = REG[id]
    const r = stored.get(id)
    const value = r && Number.isFinite(r.num_value) ? r.num_value : null
    const b = ownerOf(id)
    return {
      id,
      label: String(t.short || t.desc || id).replace(/^ƒx\s*/, ''),
      equipment: b ? b.name : t.calc ? 'Calculated' : '',
      calc: !!t.calc,
      unit: t.unit || '',
      decimals: Number.isInteger(t.d) ? t.d : null,
      value,
      text: r?.text_value ?? null,
      readAt: r?.read_at ?? null,
      limits: { ll: t.ll ?? null, lo: t.lo ?? null, hi: t.hi ?? null, hh: t.hh ?? null },
      severity: severity(t, value),
    }
  })
  const count = s => readings.filter(r => r.value !== null && r.severity === s).length
  return {
    asOf: now(),
    category: { name: card.name, color: card.color || '#1d4ed8', description: card.description || '' },
    loop: { name: design.name, line: design.line_name, foundry: design.foundry_name },
    counts: { critical: count(3), warning: count(2), near: count(1), ok: count(0), noData: readings.filter(r => r.value === null && r.text === null).length },
    readings,
  }
})
