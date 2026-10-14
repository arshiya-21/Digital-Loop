/**
 * SVG path construction for connections.
 *
 * Kept in the shared package because routing depends on it and routing is pure
 * geometry — nothing here touches the DOM.
 */

/**
 * Convert a list of corner points into a path with rounded elbows.
 *
 * Each corner becomes a quadratic curve whose radius is capped at half the
 * shorter adjoining segment, so short segments do not produce overshoot.
 */
export function roundedRoute(points, radius = 18) {
  const ps = points.filter(
    (p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y
  )
  if (!ps.length) return ''

  let d = `M${ps[0].x} ${ps[0].y}`
  for (let i = 1; i < ps.length - 1; i++) {
    const a = ps[i - 1]
    const b = ps[i]
    const c = ps[i + 1]
    const ab = Math.hypot(b.x - a.x, b.y - a.y)
    const bc = Math.hypot(c.x - b.x, c.y - b.y)
    const r = Math.min(radius, ab / 2, bc / 2)
    if (!r) continue

    const from = { x: b.x - ((b.x - a.x) / ab) * r, y: b.y - ((b.y - a.y) / ab) * r }
    const to = { x: b.x + ((c.x - b.x) / bc) * r, y: b.y + ((c.y - b.y) / bc) * r }
    d += `L${from.x} ${from.y}Q${b.x} ${b.y} ${to.x} ${to.y}`
  }

  const end = ps.at(-1)
  return `${d}L${end.x} ${end.y}`
}
