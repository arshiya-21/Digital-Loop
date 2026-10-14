import { db, uid, now, audit, transaction } from '../config/db.js'
import { requireLineScope } from '../middleware/auth.js'
import { createRouter } from '../utils/router.js'
import { created, noContent } from '../utils/respond.js'
import { badRequest, notFound, forbidden, conflict } from '../utils/errors.js'
import { validateLayout, layoutTags } from '../services/layout-validation.js'
import {
  canDesign, loopToDesign, loopToView, designOnLine, publicLoop, required,
} from '../utils/loop-access.js'

/**
 * Digital loops.
 *
 * One collection, two views of it. An administrator sees every loop on their
 * lines, drafts included, and can change them. Everyone else sees the
 * published ones and can only open them. The URL is the same either way — see
 * `utils/loop-access.js`.
 *
 * Every query is bounded by the session: the foundry it names and the lines it
 * lists. Nothing widens that, so a loop belonging to another plant cannot be
 * reached by id, by filter, or by guessing a URL.
 */

export const loops = createRouter()

/** The lines this session may see, as SQL placeholders and arguments. */
const lineScope = user => ({
  sql: 'd.line_id IN (' + (user.lines.map(() => '?').join(',') || "''") + ')',
  args: user.lines.map(line => String(line.id)),
})

/** Every loop the caller can reach. `?lineId=` narrows it to one line. */
loops.get('/', async ({ user, query }) => {
  if (canDesign(user)) {
    const scope = lineScope(user)
    const filters = ['d.foundry_id = ?', scope.sql]
    const args = [String(user.foundry.id), ...scope.args]
    if (query.lineId) { filters.push('d.line_id = ?'); args.push(String(query.lineId)) }
    if (query.status) { filters.push('d.status = ?'); args.push(query.status) }

    // Parenthesised: `await x.all().map(f)` reads `.map` off the promise.
    return (await db
      .prepare(
        `SELECT d.*,
                (SELECT MAX(version) FROM design_version v WHERE v.design_id = d.id) AS latest_version,
                pv.version AS published_version
         FROM design d
         LEFT JOIN design_version pv ON pv.id = d.published_version_id
         WHERE ${filters.join(' AND ')}
         ORDER BY d.line_name`
      )
      .all(...args))
      .map(row => ({
        ...publicLoop(row),
        // What this caller may do with this loop, said by the loop itself.
        // The studio should not have to infer it from a separate /me call —
        // and if the two ever disagreed, this is the one that decided.
        access: 'design',
        latestVersion: row.latest_version,
        // What the rest of the foundry is looking at, which is not necessarily
        // what the administrator has saved. The card says so when they differ.
        publishedVersion: row.published_version ?? null,
      }))
  }

  // Being in the foundry is the access control. Publishing is what decides a
  // design is ready to be seen; there is nothing else to be granted.
  const scope = lineScope(user)
  const filters = ['d.foundry_id = ?', scope.sql, "d.status = 'published'"]
  const args = [String(user.foundry.id), ...scope.args]
  if (query.lineId) { filters.push('d.line_id = ?'); args.push(String(query.lineId)) }

  // Parenthesised, same as above.
  return (await db
    .prepare(
      `SELECT d.id, d.name, d.updated_at, d.foundry_id, d.foundry_name,
              d.line_id, d.line_name,
              v.version, v.created_at AS published_at
       FROM design d
       JOIN design_version v ON v.id = d.published_version_id
       WHERE ${filters.join(' AND ')}
       ORDER BY d.line_name`
    )
    .all(...args))
    .map(row => ({
      id: row.id,
      name: row.name,
      access: 'view',
      status: 'published',
      version: row.version,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      lineId: row.line_id,
      foundryId: row.foundry_id,
      foundry: { id: row.foundry_id, name: row.foundry_name },
      line: { id: row.line_id, name: row.line_name },
    }))
})

/**
 * One loop, with the layout the caller is entitled to.
 *
 * A designer gets the newest draft and the version history — that is what they
 * are editing. Everyone else gets the published version and nothing else: no
 * history, no drafts, not even their existence.
 */
loops.get('/:loopId', async ({ user, params }) => {
  const loop = await loopToView(user, params.loopId)

  if (!canDesign(user)) {
    const version = await db
      .prepare('SELECT * FROM design_version WHERE id = ?')
      .get(loop.published_version_id)
    return {
      id: loop.id,
      name: loop.name,
      access: 'view',
      status: 'published',
      version: version.version,
      publishedAt: version.created_at,
      foundryId: loop.foundry_id,
      lineId: loop.line_id,
      layout: JSON.parse(version.layout),
    }
  }

  const latest = await db
    .prepare('SELECT * FROM design_version WHERE design_id = ? ORDER BY version DESC LIMIT 1')
    .get(loop.id)
  const versions = await db
    .prepare(
      `SELECT v.id, v.version, v.note, v.created_at, v.created_by AS author
       FROM design_version v WHERE v.design_id = ? ORDER BY v.version DESC`
    )
    .all(loop.id)

  // `publishedVersion` is what everyone else in the foundry is seeing right
  // now, which is not the same as the draft being edited — and knowing the
  // difference is the point of keeping them apart.
  const published = loop.published_version_id
    ? await db.prepare('SELECT version FROM design_version WHERE id = ?').get(loop.published_version_id)
    : null

  return {
    ...publicLoop(loop),
    access: 'design',
    latestVersion: latest ? latest.version : null,
    publishedVersion: published?.version ?? null,
    layout: latest ? JSON.parse(latest.layout) : null,
    versions: versions.map(v => ({
      id: v.id, version: v.version, note: v.note, createdAt: v.created_at, author: v.author,
    })),
  }
})

/**
 * The data tags a loop's live version needs.
 *
 * This is what a data gateway subscribes to for a line: the exact tag list,
 * without having to parse the layout. Values are not served here — see README,
 * "Data and persistence".
 */
loops.get('/:loopId/tags', async ({ user, params }) => {
  const loop = await loopToView(user, params.loopId)
  // Parenthesised: `await x.get()?.id` would read `.id` off the promise.
  const versionId = loop.published_version_id ||
    (await db
      .prepare('SELECT id FROM design_version WHERE design_id = ? ORDER BY version DESC LIMIT 1')
      .get(loop.id))?.id
  if (!versionId) throw notFound('This digital loop has no version yet.')

  return {
    loopId: loop.id,
    lineId: loop.line_id,
    tags: (await db
      .prepare('SELECT node_id, data_tag FROM design_tag WHERE version_id = ? ORDER BY node_id')
      .all(versionId))
      .map(row => ({ nodeId: row.node_id, dataTag: row.data_tag })),
  }
})

// ------------------------------------------------------------ design access ---

/**
 * Create the design for a line. An initial layout may be supplied.
 *
 * **A line has one design.** That is the model: a production line is a real
 * thing with one arrangement of equipment, and the studio offers lines rather
 * than a list of loops because choosing a line is choosing its design. A
 * second one on the same line is refused rather than quietly allowed.
 */
loops.post('/', async ({ user, body }) => {
  if (!canDesign(user)) {
    throw forbidden('Creating a digital loop requires an administrator account.')
  }
  const name = required(body, 'name', 120)
  const lineId = required(body, 'lineId', 80)

  // The lines are the ones SandMan listed in the launch. There is no line
  // table to look in, and nothing outside that list may be designed on.
  requireLineScope(user, lineId)
  const line = user.lines.find(entry => String(entry.id) === String(lineId))

  const already = await designOnLine(user.foundry.id, lineId)
  if (already) {
    throw conflict('line_has_design',
      `${line.name} already has a digital loop, "${already.name}". ` +
      'A line has one design — open it and edit, or delete it first.')
  }

  const layout = body.layout ?? {
    format: 'sandman-loop', version: 1, name, background: '#fbfdff', nodes: [], edges: [],
  }
  await validateLayout(layout)

  const loopId = uid('dsg')
  const versionId = uid('ver')
  // `tx`, not `db`: a query on the pool while this is open takes a different
  // connection and would commit on its own, outside the rollback.
  await transaction(async tx => {
    await tx.prepare(
      `INSERT INTO design (id, foundry_id, foundry_name, line_id, line_name,
                           name, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
    ).run(loopId, String(user.foundry.id), user.foundry.name, String(lineId), line.name,
          name, user.id, now(), now())

    await tx.prepare(
      `INSERT INTO design_version (id, design_id, version, layout, note, created_by, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`
    ).run(versionId, loopId, JSON.stringify(layout), 'Initial version', user.id, now())

    for (const [nodeId, dataTag] of layoutTags(layout)) {
      await tx.prepare('INSERT INTO design_tag (version_id, node_id, data_tag) VALUES (?, ?, ?)')
        .run(versionId, nodeId, dataTag)
    }
    await audit(user.id, 'loop.create', 'design', loopId, { name, lineId }, tx)
  })

  return created({
    ...publicLoop(await db.prepare('SELECT * FROM design WHERE id = ?').get(loopId)),
    latestVersion: 1,
  })
})

loops.patch('/:loopId', async ({ user, params, body }) => {
  const loop = await loopToDesign(user, params.loopId)

  const name = body.name === undefined ? loop.name : required(body, 'name', 120)
  let status = loop.status
  if (body.status !== undefined) {
    if (!['draft', 'archived'].includes(body.status)) {
      throw badRequest('invalid_field',
        'status may only be set to "draft" or "archived" here. Use /publish.')
    }
    status = body.status
  }

  await db.prepare('UPDATE design SET name = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(name, status, now(), loop.id)
  await audit(user.id, 'loop.update', 'design', loop.id, { name, status })
  return publicLoop(await db.prepare('SELECT * FROM design WHERE id = ?').get(loop.id))
})

loops.delete('/:loopId', async ({ user, params }) => {
  const loop = await loopToDesign(user, params.loopId)
  await db.prepare('DELETE FROM design WHERE id = ?').run(loop.id)
  await audit(user.id, 'loop.delete', 'design', loop.id, { name: loop.name })
  return noContent()
})
