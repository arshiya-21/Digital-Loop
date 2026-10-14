import { autoRoute } from './router.mjs'
import { roundedRoute } from './path.mjs'

/**
 * Layout geometry: connection ports, connection paths and document bounds.
 *
 * Validation lives in `validate.mjs` and the demo document in `sample.mjs`.
 */

/** Flow type → colour. The keys are the allowed values of `edge.flow`. */
export const flowColors = {
  sand: '#087cf0',
  return: '#26a341',
  additive: '#ed8a13',
  metal: '#e74545',
  signal: '#9554e8',
  general: '#6e869d',
}

/** Vertical clearance reserved below equipment for its three caption lines. */
const CAPTION_CLEARANCE = 62

/** Bounds used when the document is empty, so the canvas still has a viewport. */
const EMPTY_BOUNDS = { x: 0, y: 0, w: 1200, h: 750 }

export const uid = () => `n${crypto.randomUUID().replaceAll('-', '')}`

/** Canvas position of one of a node's four connection ports, honouring rotation. */
export function port(node, side) {
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const dx = side === 'left' ? -node.w / 2 : side === 'right' ? node.w / 2 : 0
  const dy = side === 'top' ? -node.h / 2 : side === 'bottom' ? node.h / 2 : 0
  const angle = ((node.rotation || 0) * Math.PI) / 180
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  }
}

/**
 * The SVG path for a connection, by routing mode:
 *
 * - `auto`     A* around equipment (see router.mjs)
 * - `straight` a direct line
 * - `curve`    a bezier with horizontal control points
 * - `ortho`    a manual Z-elbow whose midpoint `edge.offset` shifts
 */
export function route(edge, nodes) {
  const from = nodes.find(n => n.id === edge.from)
  const to = nodes.find(n => n.id === edge.to)
  if (!from || !to) return ''

  const p = port(from, edge.fromPort)
  const q = port(to, edge.toPort)

  if (edge.routing === 'auto') return autoRoute(p, q, from, to, nodes, edge)
  if (edge.routing === 'straight') return `M${p.x} ${p.y}L${q.x} ${q.y}`
  if (edge.routing === 'curve') {
    const reach = Math.max(50, Math.abs(q.x - p.x) * 0.5)
    return `M${p.x} ${p.y}C${p.x + reach} ${p.y} ${q.x - reach} ${q.y} ${q.x} ${q.y}`
  }

  const offset = edge.offset || 0
  const vertical = ['top', 'bottom'].includes(edge.fromPort)
  if (vertical) {
    const mid = (p.y + q.y) / 2 + offset
    return roundedRoute([p, { x: p.x, y: mid }, { x: q.x, y: mid }, q])
  }
  const mid = (p.x + q.x) / 2 + offset
  return roundedRoute([p, { x: mid, y: p.y }, { x: mid, y: q.y }, q])
}

/**
 * Bounding box of every node, accounting for rotation and leaving room for
 * captions below. Used by Fit and by SVG export.
 */
export function bounds(nodes) {
  if (!nodes.length) return { ...EMPTY_BOUNDS }

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const node of nodes) {
    const cx = node.x + node.w / 2
    const cy = node.y + node.h / 2
    const angle = ((node.rotation || 0) * Math.PI) / 180
    const w = Math.abs(node.w * Math.cos(angle)) + Math.abs(node.h * Math.sin(angle))
    const h = Math.abs(node.w * Math.sin(angle)) + Math.abs(node.h * Math.cos(angle))

    left = Math.min(left, cx - w / 2)
    top = Math.min(top, cy - h / 2)
    right = Math.max(right, cx + w / 2)
    bottom = Math.max(bottom, cy + h / 2 + CAPTION_CLEARANCE)
  }

  return { x: left, y: top, w: right - left, h: bottom - top }
}
