import { randomBytes } from 'node:crypto'
import { db, now, uid, transaction, audit } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { loopToView, loopToDesign } from '../utils/loop-access.js'
import { badRequest } from '../utils/errors.js'
import { config } from '../config/index.js'

/**
 * EQUIPMENT AND ITS QR CODE
 *
 * Every piece of equipment on a loop has one row here, made the moment the
 * equipment exists, and with it the token its QR code carries. The sticker on
 * the machine opens `/m/<token>` — a phone page that needs no SandMan session,
 * which is why the token is long, random and never reused.
 *
 * The studio proposes a token when the equipment is drawn (so the QR can be
 * shown and printed straight away, before anything is saved) and the server
 * confirms it. It is kept if it is well-formed and unused, and replaced if it
 * is not — the reply says which token is real, and that is the one to print.
 *
 * Equipment taken off the drawing is *retired*, not deleted: its sticker is
 * still on a wall somewhere and should say the machine was removed rather than
 * open nothing.
 */

export const equipment = createRouter()

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/
const mint = () => randomBytes(16).toString('base64url')

const shape = row => ({
  key: row.equip_key,
  tag: row.tag,
  type: row.equip_type,
  description: row.description || '',
  token: row.qr_token,
  retired: !!row.retired_at,
})

/** Every machine on a loop with its QR token. */
equipment.get('', async ({ user, query }) => {
  const loop = await loopToView(user, query.loopId)
  const rows = await db.prepare('SELECT * FROM equipment_card WHERE design_id = ? ORDER BY tag').all(loop.id)
  return { loopId: loop.id, count: rows.length, cards: rows.map(shape), publicUrl: config.publicUrl || null }
})

/**
 * Make the equipment on the drawing match the register.
 *
 * Body: `{ items: [{ key, name, type, desc, token }] }` — one per piece of
 * equipment. Returns the confirmed token for each.
 */
equipment.put('/:loopId', async ({ user, params, body }) => {
  const loop = await loopToDesign(user, params.loopId)
  const items = Array.isArray(body.items) ? body.items : null
  if (!items) throw badRequest('invalid_field', '"items" must be a list.')
  if (items.length > 5000) throw badRequest('invalid_field', 'Too many items.')

  const stamp = now()
  const result = await transaction(async tx => {
    const seen = new Set()
    const out = []
    for (const item of items) {
      const key = String(item?.key ?? '').slice(0, 80)
      const tag = String(item?.name ?? '').trim().slice(0, 160)
      const type = String(item?.type ?? '').trim().slice(0, 80)
      if (!key || !tag || !type || seen.has(key)) continue
      seen.add(key)
      const description = String(item.desc ?? '').trim().slice(0, 300) || null

      const have = await tx.prepare('SELECT * FROM equipment_card WHERE design_id = ? AND equip_key = ?').get(loop.id, key)
      if (have) {
        await tx.prepare(
          `UPDATE equipment_card SET tag = ?, equip_type = ?, description = ?, retired_at = NULL, updated_at = ?
           WHERE id = ?`
        ).run(tag, type, description, stamp, have.id)
        out.push({ ...shape({ ...have, tag, equip_type: type, description, retired_at: null }) })
        continue
      }

      // A new machine: keep the studio's token if it can be, otherwise issue one.
      let token = TOKEN.test(String(item.token || '')) ? String(item.token) : mint()
      while (await tx.prepare('SELECT 1 AS x FROM equipment_card WHERE qr_token = ?').get(token)) token = mint()
      const id = uid('eqc')
      await tx.prepare(
        `INSERT INTO equipment_card (id, design_id, equip_key, tag, equip_type, description, qr_token, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(id, loop.id, key, tag, type, description, token, stamp, stamp)
      out.push(shape({ equip_key: key, tag, equip_type: type, description, qr_token: token, retired_at: null }))
    }

    // Anything on the register that is no longer on the drawing is retired.
    let retired = 0
    const live = await tx.prepare('SELECT id, equip_key FROM equipment_card WHERE design_id = ? AND retired_at IS NULL').all(loop.id)
    for (const row of live) {
      if (seen.has(row.equip_key)) continue
      await tx.prepare('UPDATE equipment_card SET retired_at = ?, updated_at = ? WHERE id = ?').run(stamp, stamp, row.id)
      retired += 1
    }
    return { cards: out, retired }
  })

  return { loopId: loop.id, ...result }
})
