import { roundedRoute } from './path.mjs'

/**
 * Equipment-aware orthogonal routing.
 *
 * Connections set to "Avoid equipment" are routed with A* over a grid built
 * from the edges of nearby equipment, so lines go around machines rather than
 * through them.
 */

/**
 * Clearance kept around equipment.
 *
 * The bottom is much larger because every item carries a three-line caption
 * below it — label, tag and live value badge. Those scale with zoom, reaching
 * roughly 105 user units tall at the zoom-out clamp, so routing reserves more
 * than that. Routing is cached per geometry and must stay zoom-independent, so
 * it reserves the worst case: lines bow slightly wider than necessary when
 * zoomed in, rather than cutting through a label when zoomed out.
 */
const PAD = 14
const PAD_BOTTOM = 120
/** Grid lines are offset this far outside each obstacle. */
const GRID_OFFSET = 3
/** Cost added for each 90° turn, which biases the search towards straight runs. */
const TURN_COST = 24
/** Caps so a pathological layout cannot hang the canvas. */
const MAX_OBSTACLES = 70
const MAX_STEPS = 28000
const CACHE_LIMIT = 500
/** Tolerance for floating-point coordinate comparisons. */
const EPS = 0.01

/**
 * Approximate width of one caption character at the zoom-out clamp.
 * Captions are frequently wider than the machine they name, so routing has to
 * account for them or a line slips down the side of a machine and straight
 * through its label.
 */
const CAPTION_CHAR = 18

/**
 * The keep-out rectangle for a node: its body, rotated, plus the footprint of
 * the caption block beneath it.
 */
export function obstacleRect(node) {
  const angle = ((node.rotation || 0) * Math.PI) / 180
  const w = Math.abs(node.w * Math.cos(angle)) + Math.abs(node.h * Math.sin(angle))
  const h = Math.abs(node.h * Math.cos(angle)) + Math.abs(node.w * Math.sin(angle))
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2

  const chars = Math.max(String(node.label || '').length, String(node.tag || '').length)
  const captionHalf = node.type === 'text' ? 0 : (chars * CAPTION_CHAR) / 2
  const halfWidth = Math.max(w / 2 + PAD, captionHalf)

  return {
    l: cx - halfWidth,
    r: cx + halfWidth,
    t: cy - h / 2 - PAD,
    b: cy + h / 2 + PAD_BOTTOM,
  }
}

/** Does the axis-aligned segment a→b cross rectangle `rect`? */
export function intersects(a, b, rect) {
  if (Math.abs(a.y - b.y) < EPS) {
    return (
      a.y > rect.t + EPS &&
      a.y < rect.b - EPS &&
      Math.max(a.x, b.x) > rect.l + EPS &&
      Math.min(a.x, b.x) < rect.r - EPS
    )
  }
  if (Math.abs(a.x - b.x) < EPS) {
    return (
      a.x > rect.l + EPS &&
      a.x < rect.r - EPS &&
      Math.max(a.y, b.y) > rect.t + EPS &&
      Math.min(a.y, b.y) < rect.b - EPS
    )
  }
  return false
}

const inside = (p, rect) =>
  p.x > rect.l + EPS && p.x < rect.r - EPS && p.y > rect.t + EPS && p.y < rect.b - EPS

/** Minimal binary min-heap keyed on `f`, the A* priority queue. */
class Heap {
  constructor() {
    this.items = []
  }

  push(value) {
    let i = this.items.length
    this.items.push(value)
    while (i) {
      const parent = (i - 1) >> 1
      if (this.items[parent].f <= value.f) break
      this.items[i] = this.items[parent]
      i = parent
    }
    this.items[i] = value
  }

  pop() {
    const top = this.items[0]
    const last = this.items.pop()
    if (this.items.length) {
      let i = 0
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1
        if (child + 1 < this.items.length && this.items[child + 1].f < this.items[child].f) child++
        if (this.items[child].f >= last.f) break
        this.items[i] = this.items[child]
        i = child
      }
      this.items[i] = last
    }
    return top
  }

  get length() {
    return this.items.length
  }
}

/** Outward unit vector for a port side, rotated with its equipment. */
function sideNormal(side, node) {
  const angle = ((node.rotation || 0) * Math.PI) / 180
  const x = side === 'right' ? 1 : side === 'left' ? -1 : 0
  const y = side === 'bottom' ? 1 : side === 'top' ? -1 : 0
  return {
    x: x * Math.cos(angle) - y * Math.sin(angle),
    y: x * Math.sin(angle) + y * Math.cos(angle),
  }
}

/**
 * Step away from a port far enough to clear other equipment, trying
 * progressively shorter stubs.
 *
 * A downward stub has to clear the machine's own three-line caption before it
 * can turn, otherwise the connection is drawn straight through its own label.
 * Hence the much longer first candidates for downward ports.
 */
function escapePoint(from, normal, owner, nodes) {
  // A caption is usually wider than its machine. A sideways stub has to clear
  // that overhang, or the route begins inside the machine's own keep-out
  // rectangle — which routing then has to ignore, letting the line cut back
  // across the label.
  const chars = Math.max(String(owner.label || '').length, String(owner.tag || '').length)
  const overhang = Math.max(34, (chars * CAPTION_CHAR) / 2 - owner.w / 2 + 20)

  let lengths
  if (normal.y > 0.5) lengths = [135, 95, 60, 24, 12, 5, 1]
  else if (normal.y < -0.5) lengths = [34, 24, 12, 5, 1]
  else lengths = [overhang, 34, 24, 12, 5, 1]
  for (const length of lengths) {
    const out = { x: from.x + normal.x * length, y: from.y + normal.y * length }
    const blocked = nodes.some(
      other =>
        other.id !== owner.id &&
        other.type !== 'text' &&
        intersects(from, out, obstacleRect(other))
    )
    if (!blocked) return out
  }
  return { x: from.x + normal.x, y: from.y + normal.y }
}

/** Drop duplicate and collinear points so the path has the fewest corners. */
function simplify(points) {
  const out = []
  for (const p of points) {
    if (out.length && Math.hypot(p.x - out.at(-1).x, p.y - out.at(-1).y) < EPS) continue
    while (out.length > 1) {
      const a = out.at(-2)
      const b = out.at(-1)
      const crossProduct = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)
      const dotProduct = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y)
      // Keep b unless a→b→p is a straight line continuing in the same direction.
      if (Math.abs(crossProduct) > EPS || dotProduct < 0) break
      out.pop()
    }
    out.push(p)
  }
  return out
}

/** Corner points of a route from port `p` to port `q` that avoids equipment. */
export function autoPoints(p, q, source, target, nodes, fromSide, toSide) {
  const start = escapePoint(p, sideNormal(fromSide, source), source, nodes)
  const end = escapePoint(q, sideNormal(toSide, target), target, nodes)

  // Equipment containing either endpoint cannot be avoided, so it is excluded.
  const allRects = nodes.filter(n => n.type !== 'text').map(obstacleRect)
  const boxes = allRects.filter(r => !inside(start, r) && !inside(end, r))
  const clear = (a, b) => !boxes.some(r => intersects(a, b, r))

  // Fast path: a single elbow, which handles most connections.
  const elbows = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ]
  for (const candidate of elbows) {
    if (candidate.slice(1).every((v, i) => clear(candidate[i], v))) {
      return simplify([p, ...candidate, q])
    }
  }

  // Build a grid from the edges of the obstacles nearest the midpoint.
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  const distance = r => Math.abs((r.l + r.r) / 2 - midX) + Math.abs((r.t + r.b) / 2 - midY)
  const near = boxes
    .slice()
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, MAX_OBSTACLES)

  const xs = [
    ...new Set([start.x, end.x, ...near.flatMap(r => [r.l - GRID_OFFSET, r.r + GRID_OFFSET])]),
  ].sort((a, b) => a - b)
  const ys = [
    ...new Set([start.y, end.y, ...near.flatMap(r => [r.t - GRID_OFFSET, r.b + GRID_OFFSET])]),
  ].sort((a, b) => a - b)

  const nx = xs.length
  const sx = xs.indexOf(start.x)
  const sy = ys.indexOf(start.y)
  const tx = xs.indexOf(end.x)
  const ty = ys.indexOf(end.y)

  // State is (cell, direction) so that turns can be charged a cost.
  const key = (x, y, direction) => (y * nx + x) * 2 + direction
  const heap = new Heap()
  const best = new Map()
  const prev = new Map()
  const states = new Map()
  const segmentClear = new Map()

  for (const direction of [0, 1]) {
    const k = key(sx, sy, direction)
    const node = { x: sx, y: sy, d: direction, g: 0, f: 0, k }
    best.set(k, 0)
    states.set(k, node)
    heap.push(node)
  }

  let goal = null
  let steps = 0
  while (heap.length && steps++ < MAX_STEPS) {
    const current = heap.pop()
    if (current.g !== best.get(current.k)) continue
    if (current.x === tx && current.y === ty) {
      goal = current
      break
    }

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx
      const y = current.y + dy
      if (x < 0 || x >= nx || y < 0 || y >= ys.length) continue

      const a = { x: xs[current.x], y: ys[current.y] }
      const b = { x: xs[x], y: ys[y] }
      const segment = [
        Math.min(current.y * nx + current.x, y * nx + x),
        Math.max(current.y * nx + current.x, y * nx + x),
      ].join(':')
      if (!segmentClear.has(segment)) segmentClear.set(segment, clear(a, b))
      if (!segmentClear.get(segment)) continue

      const direction = dx ? 0 : 1
      const k = key(x, y, direction)
      const g =
        current.g +
        Math.abs(b.x - a.x) +
        Math.abs(b.y - a.y) +
        (direction !== current.d ? TURN_COST : 0)
      if (g >= (best.get(k) ?? Infinity)) continue

      const node = {
        x, y, d: direction, g,
        f: g + Math.abs(b.x - end.x) + Math.abs(b.y - end.y),
        k,
      }
      best.set(k, g)
      prev.set(k, current.k)
      states.set(k, node)
      heap.push(node)
    }
  }

  if (goal) {
    const path = []
    let k = goal.k
    while (k !== undefined) {
      const node = states.get(k)
      path.push({ x: xs[node.x], y: ys[node.y] })
      k = prev.get(k)
    }
    return simplify([p, ...path.reverse(), q])
  }

  // A bounded fallback retains attached endpoints when a fully clear route is
  // unavailable: run over the top of everything in the way.
  const rail = Math.min(start.y, end.y, ...boxes.map(r => r.t)) - 30
  return simplify([p, start, { x: start.x, y: rail }, { x: end.x, y: rail }, end, q])
}

/**
 * Routes are cached on the geometry that produced them. Dragging one item
 * re-routes every auto edge on every frame, and without this the A* search
 * would run thousands of times a second.
 */
const cache = new Map()

export function autoRoute(p, q, source, target, nodes, edge) {
  const key = [
    edge.from, edge.to, edge.fromPort, edge.toPort,
    ...nodes.map(n => [n.id, n.x, n.y, n.w, n.h, n.rotation].join(',')),
  ].join('|')

  if (cache.has(key)) return cache.get(key)

  const path = roundedRoute(autoPoints(p, q, source, target, nodes, edge.fromPort, edge.toPort), 10)
  if (cache.size > CACHE_LIMIT) cache.clear()
  cache.set(key, path)
  return path
}
