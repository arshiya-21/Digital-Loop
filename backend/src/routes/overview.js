import { db } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { notFound, forbidden } from '../utils/errors.js'

/**
 * API 4 — OVERVIEW
 *
 * What is live, across everything the caller can reach.
 *
 * The admin and viewer APIs both answer "show me this loop". This one answers
 * "what is the state of the plant" — how many lines have a published loop, how
 * many are still drafts, which line has none at all. That is a different
 * question with a different shape, which is why it is a separate surface
 * rather than another filter on `/admin/designs`.
 *
 * It is read-only and scope-aware: the lines are the ones SandMan listed in
 * the launch, and an operator sees only what has been published. Nothing here
 * returns a layout — it reports on loops, it does not open them.
 */

export const overview = createRouter()

const isAdmin = user => user.role === 'admin'

/**
 * Every line the caller can reach, whether or not it has a loop.
 *
 * Straight from the session. There is no line table here — SandMan's launch is
 * the list, which is why a line with nothing on it still appears: "this line
 * has no digital loop yet" is exactly the thing worth seeing.
 */
const linesInScope = user =>
  user.lines.map(line => ({
    id: String(line.id),
    name: line.name,
    sandman_line_id: String(line.id),
    foundry_id: String(user.foundry.id),
    foundry_name: user.foundry.name,
    sandman_foundry_id: String(user.foundry.id),
  }))

/**
 * The design on a line, seen through the caller's eyes.
 *
 * An administrator sees it whatever state it is in; everyone else in the
 * foundry sees it once it is published, and not before. Being in the foundry
 * is the access control — the caller's lines were already narrowed to their
 * scope by `linesInScope`.
 *
 * Returns a list because the shape reads better that way, but a line has at
 * most one design.
 */
async function loopsOnLine(user, lineId) {
  const rows = await db
    .prepare(
      `SELECT d.id, d.name, d.status, d.updated_at,
              (SELECT MAX(version) FROM design_version v WHERE v.design_id = d.id) AS version,
              pv.created_at AS published_at
       FROM design d
       LEFT JOIN design_version pv ON pv.id = d.published_version_id
       WHERE d.foundry_id = ? AND d.line_id = ?${isAdmin(user) ? '' : " AND d.status = 'published'"}
       ORDER BY d.name`
    )
    .all(String(user.foundry.id), String(lineId))

  /*
   * One query per design for the tag count, run together.
   *
   * `map` with an `await` inside would produce promises rather than values, so
   * the counts are gathered with `Promise.all` and zipped back on. A line has
   * at most one design, so this is a handful of queries at most.
   */
  const tagCounts = await Promise.all(rows.map(row =>
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM design_tag t
         JOIN design_version v ON v.id = t.version_id
         WHERE v.design_id = ?
           AND v.version = (SELECT MAX(version) FROM design_version w WHERE w.design_id = ?)`
      )
      .get(row.id, row.id)
  ))

  return rows.map((row, index) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    version: row.version,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    /** How many data tags the live version carries — what a gateway subscribes to. */
    tagCount: tagCounts[index]?.n ?? 0,
  }))
}

const summarise = loops => ({
  total: loops.length,
  published: loops.filter(loop => loop.status === 'published').length,
  draft: loops.filter(loop => loop.status !== 'published').length,
  tags: loops.reduce((sum, loop) => sum + loop.tagCount, 0),
})

/**
 * The whole picture, grouped foundry → line → loops.
 *
 * This is what a plant dashboard renders: every line the caller can reach,
 * including the ones with nothing on them, because "line 3 has no digital loop
 * yet" is exactly the thing worth seeing.
 */
overview.get('/', async ({ user }) => {
  const foundries = new Map()

  for (const line of linesInScope(user)) {
    if (!foundries.has(line.foundry_id)) {
      foundries.set(line.foundry_id, {
        id: line.foundry_id,
        sandmanFoundryId: line.sandman_foundry_id,
        name: line.foundry_name,
        lines: [],
      })
    }
    const loops = await loopsOnLine(user, line.id)
    foundries.get(line.foundry_id).lines.push({
      id: line.id,
      sandmanLineId: line.sandman_line_id,
      name: line.name,
      summary: summarise(loops),
      loops,
    })
  }

  const all = [...foundries.values()]
  const everyLoop = all.flatMap(f => f.lines.flatMap(l => l.loops))

  return {
    role: user.role,
    generatedAt: new Date().toISOString(),
    totals: {
      foundries: all.length,
      lines: all.reduce((sum, f) => sum + f.lines.length, 0),
      linesWithoutLoop: all.reduce(
        (sum, f) => sum + f.lines.filter(l => l.summary.total === 0).length, 0),
      ...summarise(everyLoop),
    },
    foundries: all,
  }
})

/**
 * Just what is live, as a flat list.
 *
 * The grouped view answers "how is the plant doing"; this answers "what is
 * running right now" and is the one worth polling.
 */
overview.get('/published', async ({ user }) => {
  const rows = []
  for (const line of linesInScope(user)) {
    for (const loop of await loopsOnLine(user, line.id)) {
      if (loop.status !== 'published') continue
      rows.push({
        ...loop,
        foundry: { id: line.foundry_id, name: line.foundry_name },
        line: { id: line.id, name: line.name },
      })
    }
  }
  rows.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
  return { count: rows.length, generatedAt: new Date().toISOString(), loops: rows }
})

/** One line in detail — what the studio's line dropdown is a view of. */
overview.get('/lines/:lineId', async ({ user, params }) => {
  const line = linesInScope(user).find(row => row.id === String(params.lineId))
  if (!line) {
    // Every line this service knows about is one SandMan named in the launch,
    // so a line that is not in scope is a line that does not exist here.
    throw notFound('Line not found.')
  }

  const loops = await loopsOnLine(user, line.id)
  return {
    foundry: { id: line.foundry_id, name: line.foundry_name },
    line: { id: line.id, name: line.name, sandmanLineId: line.sandman_line_id },
    summary: summarise(loops),
    loops,
  }
})
