import { loopApi, ApiError } from './api.mjs'
import { session, isAdmin } from './session.mjs'

/**
 * The designs in this plant.
 *
 * A line may hold several loops — pressing New and saving starts another — but
 * only the latest is shown. The older ones stay on the server as history
 * rather than as a list to choose from, and one loop is published at a time:
 * that is the one the plant sees.
 *
 * Nothing here caches for longer than a single interaction — the server is the
 * record, and the browser holding its own copy is how two people editing the
 * same plant end up disagreeing about it.
 */

/** Every design in the plant, as the server scopes it to this session. */
let designs = []

export const allDesigns = () => designs

/**
 * The design currently open, if any.
 *
 * Only this module may set it: an imported binding is read-only, so a caller
 * assigning `designs.current = null` throws — which is exactly how standing on
 * an empty line silently did nothing until `close()` existed.
 */
export let current = null

/** Nothing is open — the caller has moved to a line with no design on it. */
export function close() {
  current = null
}

export async function reload() {
  designs = await loopApi.list()
  return designs
}

/** Which line a design is on, whichever shape the listing returned it in. */
export const lineIdOf = design => String(design.lineId ?? design.line?.id ?? '')

/** Every loop on a line, newest first. */
export const designsOnLine = lineId =>
  designs
    .filter(design => lineIdOf(design) === String(lineId))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))

/**
 * The loop a line shows: the published one, else the latest.
 *
 * A line may hold several — pressing New and saving starts another — but only
 * one is shown when the line opens. The others stay on the server and are
 * reached with Open.
 *
 * **The published loop wins, for everyone.** It used to be the most recently
 * saved one for an administrator, so saving any other loop on the line — a
 * draft, an old demo — meant the next time the studio opened it landed on that
 * one instead: no linked readings, no values, on a line whose published loop
 * was reading perfectly well. A line with nothing published opens on its
 * newest loop, as before.
 *
 * For anyone who cannot design, it is the published one or nothing: a draft is
 * not theirs to see, and the server refuses it anyway.
 */
export const designOnLine = lineId => {
  const onLine = designsOnLine(lineId)
  const published = onLine.find(design => design.status === 'published') || null
  if (!isAdmin()) return published
  return published || onLine[0] || null
}

/**
 * Open a design and return its layout.
 *
 * An administrator gets the newest draft, which is what they are editing.
 * Everyone else gets the published version and nothing else — no history, no
 * drafts, not even their existence. That decision is the server's; this only
 * reads what it sent.
 */
export async function open(designId) {
  const loop = await loopApi.get(designId)
  current = {
    id: loop.id,
    name: loop.name,
    status: loop.status || 'published',
    lineId: String(loop.lineId ?? ''),
    lineName: loop.lineName || lineNameFor(loop.lineId),
    foundryName: loop.foundryName || session.foundry?.name || '',
    version: loop.version ?? loop.latestVersion ?? 1,
    publishedVersion: loop.publishedVersion ?? null,
    latestVersion: loop.latestVersion ?? loop.version ?? 1,
  }
  return loop.layout
}

/** Which line we land on: the one SandMan named, else the first with a design. */
export function landingDesign() {
  const named = session.lineId && designOnLine(session.lineId)
  if (named) return named
  for (const line of session.lines) {
    const design = designOnLine(line.id)
    if (design) return design
  }
  return designs[0] || null
}

export const lineNameFor = lineId =>
  session.lines.find(line => String(line.id) === String(lineId))?.name || ''

/**
 * Save the open design as a new version. Returns the version number.
 *
 * One at a time. The Save button and the save that follows linking a reading
 * can fire together, and three saves of one loop in the same instant were
 * three versions racing for one number. Each save now waits for the one
 * before it; a failure does not hold up the next.
 */
let saving = Promise.resolve()

export function save(layout, note) {
  const next = saving.catch(() => {}).then(async () => {
    if (!current) throw new Error('No design is open, so there is nothing to save to.')
    const saved = await loopApi.saveVersion(current.id, layout, note)
    current.latestVersion = saved.version
    current.version = saved.version
    return saved.version
  })
  saving = next
  return next
}

/** Create the design for a line, with the canvas as its first version. */
export async function create(name, lineId, layout) {
  const made = await loopApi.create(name, String(lineId), layout)
  await reload()
  return made
}

export async function publish() {
  if (!current) throw new Error('No design is open.')
  const result = await loopApi.publish(current.id)
  current.status = 'published'
  current.publishedVersion = result.publishedVersion ?? current.latestVersion
  await reload()
  return result
}

export async function unpublish() {
  if (!current) throw new Error('No design is open.')
  await loopApi.unpublish(current.id)
  current.status = 'draft'
  current.publishedVersion = null
  await reload()
}

export async function rename(name) {
  if (!current) throw new Error('No design is open.')
  await loopApi.rename(current.id, name)
  current.name = name
  await reload()
}

/**
 * The header caption: which version you are on.
 *
 * It does not repeat the plant or the line — the strip beside it already says
 * both, and saying them twice cost the caption the room it needed to finish
 * the sentence that matters: what the plant is actually looking at.
 */
export function caption() {
  if (!current) return 'No design on this line yet'
  // The loop's name, because a line may have held an earlier one.
  const which = designsOnLine(current.lineId).length > 1 ? `${current.name} · ` : ''
  if (!isAdmin()) return `${which}v${current.version} · published`

  const ahead =
    current.status === 'published' &&
    current.publishedVersion > 0 &&
    current.latestVersion > current.publishedVersion
  return ahead
    ? `${which}Editing v${current.latestVersion} · the plant sees v${current.publishedVersion}`
    : `${which}v${current.latestVersion} · ${current.status}`
}

export { ApiError }
