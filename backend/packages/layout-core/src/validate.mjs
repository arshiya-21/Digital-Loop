import { flowColors } from './geometry.mjs'
import { validateStyle } from './connection-style.mjs'
import { instrumentFor } from './instruments.mjs'
import { badDataSource, cleanDataSource } from './data-source.mjs'

/**
 * Validate and normalise a layout document read from a file.
 *
 * Every field is checked before anything is rendered, because the file came
 * from outside the app. The return value is a fresh document with unknown
 * properties dropped and every optional field defaulted, so the rest of the
 * studio never has to re-check them.
 *
 * Note that a missing `dataTag` is NOT rejected here. Older layouts predate the
 * mandatory-tag rule, so they load and are flagged in the UI instead; blocking
 * the import would strand existing work. See ui/modes.mjs.
 */

const MAX_NODES = 1000
const MAX_EDGES = 3000
const PORTS = ['left', 'right', 'top', 'bottom']
const ROUTINGS = ['auto', 'ortho', 'straight', 'curve']
const DEFAULT_BACKGROUND = '#fbfdff'

const num = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

const str = (value, max) => typeof value === 'string' && value.length <= max

function validateNodes(doc, ids, knownTypes) {
  for (const node of doc.nodes) {
    if (!str(node.id, 80) || !/^[a-zA-Z0-9_-]+$/.test(node.id) || ids.has(node.id)) {
      throw Error('Invalid or duplicate equipment ID.')
    }
    ids.add(node.id)

    // `knownTypes` is supplied by the caller: the studio passes its bundled
    // catalogue, the API passes the equipment slugs in its asset table. Both
    // answer the same question from their own source of truth.
    if (node.type !== 'text' && knownTypes && !knownTypes.has(node.type)) {
      throw Error(`Unknown equipment type "${node.type}".`)
    }

    const geometryValid =
      num(node.x, -10000, 20000) &&
      num(node.y, -10000, 20000) &&
      num(node.w, 20, 3000) &&
      num(node.h, 20, 3000) &&
      num(node.rotation ?? 0, -360, 360) &&
      str(node.label, 120) &&
      str(node.tag ?? '', 80) &&
      str(node.dataTag ?? '', 160)
    if (!geometryValid) throw Error('Invalid equipment properties.')

    if (
      node.mouldCount !== undefined &&
      (!Number.isInteger(node.mouldCount) || node.mouldCount < 11 || node.mouldCount > 15)
    ) {
      throw Error('Mould count must be between 11 and 15.')
    }
    if (node.pouring !== undefined && typeof node.pouring !== 'boolean') {
      throw Error('Invalid pouring setting.')
    }

    if (instrumentFor(node.type)) {
      const instrumentInvalid =
        (node.unit !== undefined && !str(node.unit, 20)) ||
        (node.value !== undefined && !num(node.value, -1000000, 1000000)) ||
        (node.setpoint !== undefined && !num(node.setpoint, -1000000, 1000000)) ||
        (node.controlMode !== undefined && !['auto', 'manual'].includes(node.controlMode))
      if (instrumentInvalid) throw Error('Invalid instrument settings.')
    }

    if (
      node.groupId !== undefined &&
      (typeof node.groupId !== 'string' || !/^[-a-zA-Z0-9_]{1,80}$/.test(node.groupId))
    ) {
      throw Error('Invalid group ID.')
    }
    if (node.state && !['running', 'stopped'].includes(node.state)) {
      throw Error('Invalid equipment state.')
    }

    // Where the reading comes from, when the tag was chosen from the foundry's
    // database rather than typed. Optional: a layout drawn before this existed
    // has a tag and no source, and is still perfectly valid.
    if (node.dataSource !== undefined && badDataSource(node.dataSource)) {
      throw Error('Invalid data source on equipment.')
    }
  }
}

function validateEdges(doc, ids) {
  const edgeIds = new Set()
  for (const edge of doc.edges) {
    const invalid =
      !str(edge.id, 80) ||
      !/^[a-zA-Z0-9_-]+$/.test(edge.id) ||
      edgeIds.has(edge.id) ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      edge.from === edge.to ||
      !PORTS.includes(edge.fromPort) ||
      !PORTS.includes(edge.toPort) ||
      !Object.keys(flowColors).includes(edge.flow) ||
      !str(edge.label ?? '', 120) ||
      !num(edge.offset ?? 0, -3000, 3000)
    if (invalid) throw Error('Invalid connection.')
    validateStyle(edge)
    edgeIds.add(edge.id)
  }
}

/** Normalise one node, defaulting every optional field. */
function normaliseNode(node) {
  const instrument = instrumentFor(node.type)
  return {
    ...(instrument
      ? {
          unit: node.unit ?? instrument.unit,
          value: node.value ?? instrument.value,
          setpoint: node.setpoint ?? instrument.value,
          controlMode: node.controlMode || 'auto',
        }
      : {}),
    ...(node.groupId ? { groupId: node.groupId } : {}),
    ...(node.dataSource ? { dataSource: cleanDataSource(node.dataSource) } : {}),
    id: node.id,
    type: node.type,
    label: node.label,
    tag: node.tag || '',
    dataTag: node.dataTag || '',
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    rotation: node.rotation || 0,
    state: node.state || 'running',
    ...(node.type === 'moulding'
      ? { mouldCount: node.mouldCount || 15, pouring: node.pouring !== false }
      : {}),
  }
}

const normaliseEdge = edge => ({
  ...validateStyle(edge),
  id: edge.id,
  from: edge.from,
  to: edge.to,
  fromPort: edge.fromPort,
  toPort: edge.toPort,
  flow: edge.flow,
  label: edge.label || '',
  offset: edge.offset || 0,
  routing: ROUTINGS.includes(edge.routing) ? edge.routing : 'ortho',
})

/**
 * Validate and normalise a layout document.
 *
 * @param doc         the parsed document
 * @param knownTypes  Set of accepted equipment types, or null to skip the check
 */
export function validate(doc, knownTypes = null) {
  const shapeValid =
    doc &&
    doc.format === 'sandman-loop' &&
    doc.version === 1 &&
    Array.isArray(doc.nodes) &&
    Array.isArray(doc.edges)
  if (!shapeValid) throw Error('Choose a SandMan layout JSON file.')

  if (doc.nodes.length > MAX_NODES || doc.edges.length > MAX_EDGES) {
    throw Error('This layout exceeds 1,000 items or 3,000 connections.')
  }

  const ids = new Set()
  validateNodes(doc, ids, knownTypes)
  validateEdges(doc, ids)

  if (!str(doc.name, 120)) throw Error('Invalid layout name.')
  if (doc.background !== undefined && !/^#[0-9a-fA-F]{6}$/.test(doc.background)) {
    throw Error('Invalid canvas background colour.')
  }

  return {
    format: 'sandman-loop',
    version: 1,
    name: doc.name,
    background: doc.background || DEFAULT_BACKGROUND,
    nodes: doc.nodes.map(normaliseNode),
    edges: doc.edges.map(normaliseEdge),
  }
}
