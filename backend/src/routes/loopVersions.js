import { db, uid, now, audit, transaction } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { created } from '../utils/respond.js'
import { notFound } from '../utils/errors.js'
import { validateLayout, requireDataTags, layoutTags } from '../services/layout-validation.js'
import { loopToDesign, publicLoop } from '../utils/loop-access.js'

/**
 * Saving and publishing.
 *
 * Saving stores an immutable version and changes nothing an operator sees.
 * Publishing points the loop at one of those versions, and only then does it
 * reach everyone else in the foundry. That separation is why editing a loop
 * cannot disturb a running line.
 */

export const loopVersions = createRouter()

/** Save: store a new version. What operators see does not change. */
loopVersions.post('/:loopId/versions', async ({ user, params, body }) => {
  const loop = await loopToDesign(user, params.loopId)

  const layout = await validateLayout(body.layout)
  // Parenthesised: `await x.get().max` would await the property of a promise.
  const previous = (await db
    .prepare('SELECT MAX(version) AS max FROM design_version WHERE design_id = ?')
    .get(loop.id)).max || 0
  const version = previous + 1
  const versionId = uid('ver')

  // `tx`, not `db`: a query on the pool while this is open takes a different
  // connection and would commit on its own, outside the rollback.
  await transaction(async tx => {
    await tx.prepare(
      `INSERT INTO design_version (id, design_id, version, layout, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(versionId, loop.id, version, JSON.stringify(layout), body.note ?? null, user.id, now())

    for (const [nodeId, dataTag] of layoutTags(layout)) {
      await tx.prepare('INSERT INTO design_tag (version_id, node_id, data_tag) VALUES (?, ?, ?)')
        .run(versionId, nodeId, dataTag)
    }
    await tx.prepare('UPDATE design SET updated_at = ? WHERE id = ?').run(now(), loop.id)
    await audit(user.id, 'loop.version', 'design', loop.id, { version }, tx)
  })

  return created({ id: versionId, loopId: loop.id, version, createdAt: now() })
})

loopVersions.get('/:loopId/versions/:version', async ({ user, params }) => {
  const loop = await loopToDesign(user, params.loopId)
  const row = await db
    .prepare('SELECT * FROM design_version WHERE design_id = ? AND version = ?')
    .get(loop.id, Number(params.version))
  if (!row) throw notFound('Version not found.')
  return {
    id: row.id, loopId: loop.id, version: row.version,
    note: row.note, createdAt: row.created_at, layout: JSON.parse(row.layout),
  }
})

/**
 * Publish a version to everyone in the foundry.
 *
 * Refuses while any equipment is missing a data tag. The studio blocks it in
 * the UI too, but this is the check that cannot be bypassed.
 */
loopVersions.post('/:loopId/publish', async ({ user, params, body }) => {
  const loop = await loopToDesign(user, params.loopId)

  const target = body.version
    ? await db.prepare('SELECT * FROM design_version WHERE design_id = ? AND version = ?')
        .get(loop.id, Number(body.version))
    : await db.prepare('SELECT * FROM design_version WHERE design_id = ? ORDER BY version DESC LIMIT 1')
        .get(loop.id)
  if (!target) throw notFound('No such version to publish.')

  const layout = JSON.parse(target.layout)
  requireDataTags(layout)

  /*
   * One published loop per line.
   *
   * A line may hold several — the one the plant is running, a rebuild being
   * drawn beside it — but the publish view and the live readings follow the
   * published one, and two of those on a line is a question with no answer.
   * So publishing one takes the other off the plant's screens, which is said
   * in the reply rather than discovered on the floor.
   */
  const replaced = await db.prepare(
    `SELECT id, name FROM design
     WHERE foundry_id = ? AND line_id = ? AND status = 'published' AND id <> ?`
  ).all(loop.foundry_id, loop.line_id, loop.id)

  for (const other of replaced) {
    await db.prepare(
      "UPDATE design SET status = 'draft', published_version_id = NULL, updated_at = ? WHERE id = ?"
    ).run(now(), other.id)
    await audit(user.id, 'loop.unpublish', 'design', other.id,
      { because: 'another loop on this line was published', instead: loop.name })
  }

  await db.prepare("UPDATE design SET status = 'published', published_version_id = ?, updated_at = ? WHERE id = ?")
    .run(target.id, now(), loop.id)
  await audit(user.id, 'loop.publish', 'design', loop.id, { version: target.version })

  return {
    ...publicLoop(await db.prepare('SELECT * FROM design WHERE id = ?').get(loop.id)),
    publishedVersion: target.version,
    /** What this took off the plant's screens, if anything. */
    replaced: replaced.map(other => other.name),
  }
})

loopVersions.post('/:loopId/unpublish', async ({ user, params }) => {
  const loop = await loopToDesign(user, params.loopId)
  await db.prepare("UPDATE design SET status = 'draft', published_version_id = NULL, updated_at = ? WHERE id = ?")
    .run(now(), loop.id)
  await audit(user.id, 'loop.unpublish', 'design', loop.id, {})
  return publicLoop(await db.prepare('SELECT * FROM design WHERE id = ?').get(loop.id))
})
