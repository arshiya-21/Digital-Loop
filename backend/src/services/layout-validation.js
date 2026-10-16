import { missingTags, layoutTags as coreLayoutTags, badDataSource } from '@sandman/layout-core'
import { db } from '../config/db.js'
import { unprocessable } from '../utils/errors.js'

/**
 * Server-side validation of a design document.
 *
 * The browser validates too, but a client check is a convenience, not a
 * control — anything can POST to this API. This is the authoritative check.
 *
 * **Two document formats live here.**
 *
 *   studio v6.8   `{ DOC: { name, blocks, streams, seq }, REG: { … } }`
 *                 what the current studio saves, and what every new version is.
 *   loop v1       `{ format: 'sandman-loop', version: 1, nodes, edges }`
 *                 what the previous studio saved. Still accepted and still
 *                 served, because designs drawn in it are somebody's work and
 *                 deleting them to simplify a validator is not a trade worth
 *                 making. The current studio cannot open them; the rows stay
 *                 readable and the history stays intact.
 *
 * Which one a document is in is decided by its shape, not by a flag it could
 * get wrong about itself.
 */

/** Loose caps: enough that nothing real is refused, small enough to bound a row. */
const LIMITS = {
  blocks: 5000,
  streams: 10000,
  tags: 20000,
  name: 200,
  /** A node carries at most this many data labels, as the v1 editor allowed. */
  dataLabels: 6,
}

const MAX_NODES = 1000
const MAX_EDGES = 3000
const PORTS = ['left', 'right', 'top', 'bottom']
/** Node types the v1 studio drew itself. They are never in the catalogue. */
const ANNOTATION = new Set(['text', 'shape'])
const FLOWS = ['sand', 'return', 'additive', 'metal', 'signal', 'general']

const num = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

const str = (value, max) => typeof value === 'string' && value.length <= max

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

/** Which format a stored or submitted document is in. */
export function formatOf(layout) {
  if (isObject(layout) && isObject(layout.DOC)) return 'studio-v6'
  if (isObject(layout) && layout.format === 'sandman-loop') return 'loop-v1'
  return null
}

/* ======================================================= studio v6.8 ======= */

/**
 * The current studio's document.
 *
 * Checked for shape and size rather than for every field. The studio owns its
 * own model and adds to it release by release — a validator that enumerated
 * every property would reject next month's drawing for being new, which is a
 * worse failure than storing a field this service does not understand. What it
 * does enforce is that the thing is a document at all, that it cannot grow
 * without bound, and that the tags it claims are tags.
 */
function validateStudioDocument(layout) {
  const doc = layout.DOC

  if (!str(doc.name ?? '', LIMITS.name)) {
    throw unprocessable('layout_invalid', 'DOC.name must be a string of at most 200 characters.')
  }
  if (!Array.isArray(doc.blocks) || !Array.isArray(doc.streams)) {
    throw unprocessable('layout_invalid', 'DOC.blocks and DOC.streams must be lists.')
  }
  if (doc.blocks.length > LIMITS.blocks || doc.streams.length > LIMITS.streams) {
    throw unprocessable(
      'layout_too_large',
      `A loop may hold ${LIMITS.blocks} items and ${LIMITS.streams} lines.`
    )
  }

  const ids = new Set()
  for (const [index, block] of doc.blocks.entries()) {
    const where = `DOC.blocks[${index}]`
    if (!isObject(block) || !str(block.id ?? '', 80) || !block.id) {
      throw unprocessable('layout_invalid', `${where}.id is missing or malformed.`)
    }
    if (ids.has(block.id)) {
      throw unprocessable('layout_invalid', `${where}.id is used twice.`)
    }
    ids.add(block.id)
    if (!str(block.type ?? '', 120)) {
      throw unprocessable('layout_invalid', `${where}.type must be a string.`)
    }
    if (block.tags !== undefined && !Array.isArray(block.tags)) {
      throw unprocessable('layout_invalid', `${where}.tags must be a list.`)
    }
  }

  if (layout.REG !== undefined && !isObject(layout.REG)) {
    throw unprocessable('layout_invalid', 'REG must be an object of tags.')
  }
  const tagCount = Object.keys(layout.REG || {}).length
  if (tagCount > LIMITS.tags) {
    throw unprocessable('layout_too_large', `A loop may hold ${LIMITS.tags} readings.`)
  }

  return layout
}

/**
 * Every [ownerId, tag] pair in a v6.8 document, for the `design_tag` index.
 *
 * A reading is a `REG` entry; the ones worth indexing are those linked to a
 * database, because that is what a gateway subscribes to. The tag recorded is
 * the address it resolves to — `database.table.column` — so the index means
 * the same thing it did for the previous format.
 *
 * The owner is the block carrying the reading, so a row still answers "which
 * equipment is this number for". A reading no block claims is indexed against
 * its own id rather than dropped: it is still a subscription.
 */
function studioTags(layout) {
  const owner = new Map()
  for (const block of layout.DOC.blocks || []) {
    for (const tag of block.tags || []) {
      const id = typeof tag === 'string' ? tag : tag?.id
      if (id && !owner.has(id)) owner.set(id, block.id)
    }
  }

  const pairs = []
  for (const [id, reading] of Object.entries(layout.REG || {})) {
    const link = reading?.link
    if (!isObject(link)) continue
    const address = [link.db, link.table, link.col].filter(Boolean).join('.')
    if (!address) continue
    pairs.push([String(owner.get(id) || id).slice(0, 80), address.slice(0, 160)])
  }
  return pairs
}

/* ========================================================== loop v1 ======== */

/** Equipment types the catalogue currently offers, from the asset table. */
async function knownTypes() {
  const rows = await db.prepare('SELECT slug FROM asset').all()
  return new Set(rows.map(row => row.slug))
}

/**
 * The data labels on a piece of equipment (v1).
 *
 * These are where a tag lived in that studio — a node could carry several,
 * each with its own tag, and each may say which table and column it came from.
 */
function validateDataLabels(node, where) {
  if (node.dataLabels === undefined) return

  if (!Array.isArray(node.dataLabels) || node.dataLabels.length > LIMITS.dataLabels) {
    throw unprocessable(
      'layout_invalid',
      `${where}.dataLabels must be a list of at most ${LIMITS.dataLabels} data labels.`
    )
  }

  for (const [index, label] of node.dataLabels.entries()) {
    const at = `${where}.dataLabels[${index}]`
    if (!label || typeof label !== 'object' || !str(label.tag ?? '', 160)) {
      throw unprocessable('layout_invalid', `${at} is malformed or its data tag is too long.`)
    }
    if (label.dataSource !== undefined && badDataSource(label.dataSource)) {
      throw unprocessable(
        'layout_invalid',
        `${at}.dataSource must name a table and a column in the foundry's database.`
      )
    }
  }
}

async function validateLoopV1(layout) {
  const shapeValid =
    layout.version === 1 && Array.isArray(layout.nodes) && Array.isArray(layout.edges)
  if (!shapeValid) {
    throw unprocessable('layout_invalid', 'Body must be a sandman-loop version 1 layout.')
  }

  if (!str(layout.name, 120)) {
    throw unprocessable('layout_invalid', 'layout.name must be a string of at most 120 characters.')
  }
  if (layout.background !== undefined && !/^#[0-9a-fA-F]{6}$/.test(layout.background)) {
    throw unprocessable('layout_invalid', 'layout.background must be a six-digit hex colour.')
  }
  if (layout.nodes.length > MAX_NODES || layout.edges.length > MAX_EDGES) {
    throw unprocessable('layout_too_large', 'Layout exceeds 1,000 items or 3,000 connections.')
  }

  const types = await knownTypes()
  const ids = new Set()

  for (const [index, node] of layout.nodes.entries()) {
    const where = `nodes[${index}]`
    if (!str(node.id, 80) || !/^[a-zA-Z0-9_-]+$/.test(node.id) || ids.has(node.id)) {
      throw unprocessable('layout_invalid', `${where}.id is missing, malformed or duplicated.`)
    }
    ids.add(node.id)

    if (!str(node.type, 80)) {
      throw unprocessable('layout_invalid', `${where}.type must be a string.`)
    }
    // 'text' and 'shape' are drawn annotations — a caption and a box — not
    // catalogue equipment, so they have no artwork and never will.
    if (!ANNOTATION.has(node.type) && types.size && !types.has(node.type)) {
      throw unprocessable(
        'unknown_equipment_type',
        `${where}.type "${node.type}" is not in the equipment catalogue.`
      )
    }

    const geometryValid =
      num(node.x, -10000, 20000) &&
      num(node.y, -10000, 20000) &&
      num(node.w, 20, 3000) &&
      num(node.h, 20, 3000) &&
      num(node.rotation ?? 0, -360, 360) &&
      str(node.label ?? '', 120) &&
      str(node.tag ?? '', 80) &&
      str(node.dataTag ?? '', 160)
    if (!geometryValid) {
      throw unprocessable('layout_invalid', `${where} has invalid geometry or labels.`)
    }

    if (node.dataSource !== undefined && badDataSource(node.dataSource)) {
      throw unprocessable(
        'layout_invalid',
        `${where}.dataSource must name a table and a column in the foundry's database.`
      )
    }
    validateDataLabels(node, where)
  }

  for (const [index, edge] of layout.edges.entries()) {
    const where = `edges[${index}]`
    const edgeValid =
      str(edge.id, 80) &&
      ids.has(edge.from) &&
      ids.has(edge.to) &&
      edge.from !== edge.to &&
      PORTS.includes(edge.fromPort) &&
      PORTS.includes(edge.toPort) &&
      FLOWS.includes(edge.flow) &&
      str(edge.label ?? '', 120) &&
      num(edge.offset ?? 0, -3000, 3000)
    if (!edgeValid) {
      throw unprocessable('layout_invalid', `${where} is invalid or references a missing node.`)
    }
  }

  return layout
}

/* ============================================================ the surface == */

/**
 * Structural validation. Throws 422 with a field path on the first problem.
 *
 * Asynchronous because a v1 layout is checked against the equipment catalogue,
 * which is a table. A v6.8 document needs no query, but the one surface is
 * easier to hold to than two.
 */
export async function validateLayout(layout) {
  const format = formatOf(layout)
  if (format === 'studio-v6') return validateStudioDocument(layout)
  if (format === 'loop-v1') return await validateLoopV1(layout)
  throw unprocessable(
    'layout_invalid',
    'Body must be a studio document ({ DOC, REG }) or a sandman-loop version 1 layout.'
  )
}

/**
 * Every [ownerId, dataTag] pair in a design, whichever format it is in.
 *
 * **Each pair once.** `design_tag` is keyed on exactly that pair, and two
 * readings on the same item may legitimately point at the same column — one
 * shown on the canvas and one driving an alarm, or the same measurement under
 * two names. Letting the repeat through meant the insert hit the primary key
 * and the whole save came back as `internal_error`, naming nothing a person
 * could act on.
 *
 * De-duplicated here rather than in either format's own reader, so both are
 * covered and a third format would be too. The index is a subscription list,
 * and a repeated subscription is one subscription; nothing downstream counts
 * these rows.
 */
export function layoutTags(layout) {
  const pairs = formatOf(layout) === 'studio-v6' ? studioTags(layout) : coreLayoutTags(layout)

  const seen = new Set()
  return pairs.filter(([ownerId, tag]) => {
    const key = `${ownerId}\u0000${tag}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Enforce the mandatory data-tag rule. Called on publish, never on save, so a
 * half-finished draft can still be stored.
 *
 * **The two formats can be held to different standards, and are.**
 *
 * For a v1 layout the rule is per item: every piece of equipment must carry a
 * tag, which the server can check because it knows which types are equipment
 * and which are annotation.
 *
 * For a v6.8 document it cannot. Whether a block is a machine or a drawn
 * decoration is decided by the studio's equipment library — four megabytes of
 * it, in the browser — and this service has no copy. Claiming to enforce the
 * per-item rule here would be claiming a check that is not happening, so what
 * is enforced is the part that can be: a loop with no readings at all cannot
 * be published. The studio applies the per-item rule in the UI.
 */
export function requireDataTags(layout) {
  if (formatOf(layout) === 'studio-v6') {
    if (!studioTags(layout).length) {
      throw unprocessable(
        'missing_data_tags',
        'Nothing in this loop is linked to a database yet, so there would be ' +
        'nothing for the plant to read. Add at least one reading before publishing.'
      )
    }
    return
  }

  const missing = missingTags(layout.nodes)
    .map(node => ({ id: node.id, label: node.label, tag: node.tag }))

  if (missing.length) {
    throw unprocessable(
      'missing_data_tags',
      `${missing.length} equipment item${missing.length > 1 ? 's' : ''} ` +
      'must have a data tag before this design can be published.',
      { missing }
    )
  }
}
