import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from '../config/index.js'
import { db, uid, now, audit, transaction } from '../config/db.js'
import { requireAdmin } from '../middleware/auth.js'
import { createRouter } from '../utils/router.js'
import { created, rawReply } from '../utils/respond.js'
import { badRequest, notFound, conflict, unprocessable } from '../utils/errors.js'
import { checkSvg } from '../services/svg-safety.js'

/**
 * API 3 — EQUIPMENT SVG LIBRARY
 *
 * Add, rename, replace and remove the SVG artwork that the equipment catalogue
 * offers. Reads are open to any authenticated user (the studio needs the
 * catalogue to draw a loop); writes are administrator-only.
 *
 * Storage is filesystem plus a database row: the file is written to
 * uploads/equipment/<assetId>.svg and its metadata lives in `asset`. Backing up
 * the database alone is not enough — back up the uploads directory with it.
 */

export const assets = createRouter()

const UPLOAD_DIR = config.paths.uploads
mkdirSync(UPLOAD_DIR, { recursive: true })

const filePath = assetId => resolve(UPLOAD_DIR, `${assetId}.svg`)

/** Slugs become node `type` values in layouts, so keep them URL and id safe. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/

const publicAsset = row => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  category: row.category,
  width: row.width,
  height: row.height,
  bytes: row.bytes,
  revision: row.revision,
  builtin: !!row.builtin,
  fileUrl: `/api/v1/assets/${row.id}/file`,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const assetById = async id => {
  const row = await db.prepare('SELECT * FROM asset WHERE id = ?').get(id)
  if (!row) throw notFound('Equipment asset not found.')
  return row
}

/** Designs whose newest version places this equipment type. */
async function usageOf(slug) {
  const rows = await db
    .prepare(
      `SELECT d.id, d.name, d.status FROM design d
       JOIN design_version v ON v.design_id = d.id
       WHERE v.version = (SELECT MAX(version) FROM design_version WHERE design_id = d.id)
         AND v.layout LIKE ?`
    )
    .all(`%"type":"${slug}"%`)
  return rows.map(row => ({ id: row.id, name: row.name, status: row.status }))
}

// ------------------------------------------------------------------ reads ---

assets.get('', async ({ query }) => {
  const rows = query.category
    ? await db.prepare('SELECT * FROM asset WHERE category = ? ORDER BY category, name').all(query.category)
    : await db.prepare('SELECT * FROM asset ORDER BY category, name').all()
  return rows.map(publicAsset)
})

assets.get('/:assetId', async ({ params }) => {
  const asset = await assetById(params.assetId)
  return { ...publicAsset(asset), usedBy: await usageOf(asset.slug) }
})

/** Serve the artwork itself. Returned as a file, not embedded in JSON. */
assets.get('/:assetId/file', async ({ params }) => {
  const asset = await assetById(params.assetId)
  const path = filePath(asset.id)
  if (!existsSync(path)) throw notFound('Artwork file is missing from storage.')
  // Not sniffable, not scriptable: the file came from an admin but is still
  // served defensively, in case artwork is ever opened in its own tab.
  return rawReply(
    200,
    {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-disposition': `inline; filename="${asset.slug}.svg"`,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
    readFileSync(path)
  )
})

// ----------------------------------------------------------------- writes ---

/** Add new equipment artwork to the catalogue. */
assets.post('', async ({ user, body }) => {
  requireAdmin(user)

  const slug = String(body.slug || '').trim().toLowerCase()
  if (!SLUG.test(slug)) {
    throw badRequest(
      'invalid_slug',
      '"slug" must be lower-case letters, digits and hyphens, 2-80 characters.'
    )
  }
  if (await db.prepare('SELECT 1 FROM asset WHERE slug = ?').get(slug)) {
    throw conflict('slug_exists', `Equipment "${slug}" already exists. Use PUT .../file to replace its artwork.`)
  }

  const name = String(body.name || '').trim()
  const category = String(body.category || '').trim()
  if (!name || name.length > 160) throw badRequest('invalid_field', '"name" is required.')
  if (!category || category.length > 80) throw badRequest('invalid_field', '"category" is required.')

  const checked = checkSvg(body.svg)
  const width = Number(body.width) || checked.width
  const height = Number(body.height) || checked.height

  const id = uid('ast')
  writeFileSync(filePath(id), checked.svg, 'utf8')
  try {
    await db.prepare(
      `INSERT INTO asset (id, slug, name, category, width, height, bytes, revision, builtin,
                          uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`
    ).run(id, slug, name, category, width, height, checked.bytes, user.id, now(), now())
  } catch (error) {
    // Never leave an orphan file behind if the row fails to insert.
    unlinkSync(filePath(id))
    throw error
  }
  await audit(user.id, 'asset.create', 'asset', id, { slug, name, category })

  return created(publicAsset(await assetById(id)))
})

/**
 * Rename or recategorise. Changing the slug rewrites the node `type` of every
 * design that uses it, in one transaction, so nothing is left dangling.
 */
assets.patch('/:assetId', async ({ user, params, body }) => {
  requireAdmin(user)
  const asset = await assetById(params.assetId)

  const name = body.name === undefined ? asset.name : String(body.name).trim()
  const category = body.category === undefined ? asset.category : String(body.category).trim()
  if (!name || name.length > 160) throw badRequest('invalid_field', '"name" cannot be empty.')
  if (!category || category.length > 80) throw badRequest('invalid_field', '"category" cannot be empty.')

  let slug = asset.slug
  if (body.slug !== undefined && body.slug !== asset.slug) {
    slug = String(body.slug).trim().toLowerCase()
    if (!SLUG.test(slug)) throw badRequest('invalid_slug', 'Invalid slug format.')
    if (await db.prepare('SELECT 1 FROM asset WHERE slug = ?').get(slug)) {
      throw conflict('slug_exists', `Equipment "${slug}" already exists.`)
    }
  }

  const renamed = slug !== asset.slug
  const affected = renamed ? await usageOf(asset.slug) : []

  // `tx`, not `db`: a query on the pool while this is open takes a different
  // connection and would commit on its own, outside the rollback.
  await transaction(async tx => {
    await tx.prepare('UPDATE asset SET slug = ?, name = ?, category = ?, updated_at = ? WHERE id = ?')
      .run(slug, name, category, now(), asset.id)

    if (renamed) {
      // Rewrite stored layouts so existing designs keep rendering.
      const versions = await tx
        .prepare('SELECT id, layout FROM design_version WHERE layout LIKE ?')
        .all(`%"type":"${asset.slug}"%`)
      for (const version of versions) {
        const layout = JSON.parse(version.layout)
        for (const node of layout.nodes) {
          if (node.type === asset.slug) node.type = slug
        }
        await tx.prepare('UPDATE design_version SET layout = ? WHERE id = ?')
          .run(JSON.stringify(layout), version.id)
      }
    }
    await audit(user.id, 'asset.update', 'asset', asset.id, { slug, name, category, renamed }, tx)
  })

  return { ...publicAsset(await assetById(asset.id)), rewroteDesigns: affected }
})

/**
 * Replace the artwork, keeping the slug. Every design using this equipment
 * picks up the new drawing; the revision counter bumps so caches can be busted.
 */
assets.put('/:assetId/file', async ({ user, params, body }) => {
  requireAdmin(user)
  const asset = await assetById(params.assetId)
  const checked = checkSvg(body.svg)

  const width = Number(body.width) || checked.width
  const height = Number(body.height) || checked.height

  writeFileSync(filePath(asset.id), checked.svg, 'utf8')
  await db.prepare(
    `UPDATE asset SET width = ?, height = ?, bytes = ?, revision = revision + 1, updated_at = ?
     WHERE id = ?`
  ).run(width, height, checked.bytes, now(), asset.id)
  await audit(user.id, 'asset.replace', 'asset', asset.id, { revision: asset.revision + 1 })

  return { ...publicAsset(await assetById(asset.id)), usedBy: await usageOf(asset.slug) }
})

/**
 * Remove equipment from the catalogue.
 *
 * Refused while any design still places it, because deleting would leave those
 * layouts referencing a type that no longer validates. `?force=true` overrides
 * and names what will break.
 */
assets.delete('/:assetId', async ({ user, params, query }) => {
  requireAdmin(user)
  const asset = await assetById(params.assetId)
  const usedBy = await usageOf(asset.slug)

  if (usedBy.length && query.force !== 'true') {
    throw unprocessable(
      'asset_in_use',
      `"${asset.slug}" is used by ${usedBy.length} design${usedBy.length > 1 ? 's' : ''}. ` +
      'Replace the artwork instead, or repeat with ?force=true.',
      { usedBy }
    )
  }

  await db.prepare('DELETE FROM asset WHERE id = ?').run(asset.id)
  if (existsSync(filePath(asset.id))) unlinkSync(filePath(asset.id))
  await audit(user.id, 'asset.delete', 'asset', asset.id, { slug: asset.slug, forced: usedBy.length > 0 })

  return { deleted: asset.id, slug: asset.slug, brokeDesigns: usedBy }
})
