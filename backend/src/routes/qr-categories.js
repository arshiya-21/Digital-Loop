import { randomBytes } from 'node:crypto'
import { db, now, uid, transaction } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { loopToView, loopToDesign } from '../utils/loop-access.js'
import { badRequest } from '../utils/errors.js'
import { config } from '../config/index.js'

/**
 * CATEGORY QR STICKERS — the register, as `routes/equipment.js` is for machines.
 *
 * The studio mints a token when a category is made (so its QR exists at once);
 * the server confirms it when the loop is saved and never changes it. Reading
 * the register follows the loop to view it; changing it, to design it.
 */
export const qrCategories = createRouter()

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/
const mint = () => randomBytes(16).toString('base64url')

const shape = row => ({ key: row.cat_key, name: row.name, token: row.qr_token, retired: !!row.retired_at })

qrCategories.get('', async ({ user, query }) => {
  const loop = await loopToView(user, query.loopId)
  const rows = await db.prepare('SELECT * FROM category_card WHERE design_id = ? ORDER BY name').all(loop.id)
  return { loopId: loop.id, cards: rows.map(shape), publicUrl: config.publicUrl || null }
})

/** Body: `{ items: [{ key, name, color, desc, tags: [reading ids], token }] }`. Returns the confirmed tokens. */
qrCategories.put('/:loopId', async ({ user, params, body }) => {
  const loop = await loopToDesign(user, params.loopId)
  const items = Array.isArray(body.items) ? body.items : null
  if (!items) throw badRequest('invalid_field', '"items" must be a list.')
  if (items.length > 500) throw badRequest('invalid_field', 'Too many process parameters.')

  const stamp = now()
  return transaction(async tx => {
    const seen = new Set()
    const cards = []
    for (const item of items) {
      const key = String(item?.key ?? '').slice(0, 80)
      const name = String(item?.name ?? '').trim().slice(0, 160) || 'Untitled'
      if (!key || seen.has(key)) continue
      seen.add(key)
      const tags = JSON.stringify((Array.isArray(item.tags) ? item.tags : []).map(String).filter(Boolean).slice(0, 300))
      const color = /^#[0-9a-f]{3,8}$/i.test(String(item.color || '')) ? String(item.color) : null
      const desc = String(item.desc ?? '').trim().slice(0, 300) || null
      const have = await tx.prepare('SELECT * FROM category_card WHERE design_id = ? AND cat_key = ?').get(loop.id, key)
      if (have) {
        await tx.prepare('UPDATE category_card SET name = ?, color = ?, description = ?, tags = ?, retired_at = NULL, updated_at = ? WHERE id = ?')
          .run(name, color, desc, tags, stamp, have.id)
        cards.push(shape({ ...have, name, retired_at: null }))
        continue
      }
      let token = TOKEN.test(String(item.token || '')) ? String(item.token) : mint()
      while (await tx.prepare('SELECT 1 AS x FROM category_card WHERE qr_token = ?').get(token)) token = mint()
      await tx.prepare(
        `INSERT INTO category_card (id, design_id, cat_key, name, color, description, tags, qr_token, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(uid('qcc'), loop.id, key, name, color, desc, tags, token, stamp, stamp)
      cards.push(shape({ cat_key: key, name, qr_token: token }))
    }
    // A category deleted in the studio: its sticker stops working (says so), the token is never reused.
    const live = await tx.prepare('SELECT id, cat_key FROM category_card WHERE design_id = ? AND retired_at IS NULL').all(loop.id)
    let retired = 0
    for (const row of live) {
      if (seen.has(row.cat_key)) continue
      await tx.prepare('UPDATE category_card SET retired_at = ?, updated_at = ? WHERE id = ?').run(stamp, stamp, row.id)
      retired += 1
    }
    return { loopId: loop.id, cards, retired }
  })
})
