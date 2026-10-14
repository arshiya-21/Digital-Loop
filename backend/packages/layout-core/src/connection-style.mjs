/** Endpoint symbol id → human label, used by the inspector's symbol picker. */
export const symbols = {
  none: 'None',
  arrow: 'Classic arrow',
  open: 'Open arrow',
  triangle: 'Filled triangle',
  hollow: 'Hollow triangle',
  circle: 'Filled circle',
  ring: 'Hollow circle',
  diamond: 'Filled diamond',
  diamondOpen: 'Hollow diamond',
  bar: 'Bar',
}

const LINE_STYLES = ['solid', 'dashed', 'dotted', 'dashdot']
const ANIMATIONS = ['inherit', 'arrows', 'particles', 'pulses', 'none']

const DASH_PATTERNS = {
  solid: '',
  dashed: '9 6',
  dotted: '1 5',
  dashdot: '10 5 1 5',
}

const MARKER_SHAPES = {
  arrow: '<path d="M1 1L9 5L1 9L3 5Z"/>',
  open: '<path d="M1 1L9 5L1 9" fill="none"/>',
  triangle: '<path d="M1 1L9 5L1 9Z"/>',
  hollow: '<path d="M1 1L9 5L1 9Z" fill="white"/>',
  circle: '<circle cx="5" cy="5" r="3.5"/>',
  ring: '<circle cx="5" cy="5" r="3.5" fill="white"/>',
  diamond: '<path d="M1 5L5 1L9 5L5 9Z"/>',
  diamondOpen: '<path d="M1 5L5 1L9 5L5 9Z" fill="white"/>',
  bar: '<path d="M8 1V9" fill="none"/>',
}

const MIN_WIDTH = 1
const MAX_WIDTH = 10
const MIN_SPEED = 0.25
const MAX_SPEED = 3

/** An edge's appearance with every optional property defaulted. */
export function connectionStyle(edge) {
  return {
    color: edge.color || '',
    lineStyle: edge.lineStyle || 'solid',
    lineWidth: edge.lineWidth ?? 2.4,
    startSymbol: edge.startSymbol || 'none',
    endSymbol: edge.endSymbol || 'none',
    animation: edge.animation || 'inherit',
    speed: edge.speed ?? 1,
  }
}

/** Throw unless an edge's appearance is within range. Used when opening a file. */
export function validateStyle(edge) {
  const style = connectionStyle(edge)
  const invalid =
    (style.color && !/^#[a-fA-F0-9]{6}$/.test(style.color)) ||
    !LINE_STYLES.includes(style.lineStyle) ||
    !Number.isFinite(style.lineWidth) ||
    style.lineWidth < MIN_WIDTH ||
    style.lineWidth > MAX_WIDTH ||
    !Object.hasOwn(symbols, style.startSymbol) ||
    !Object.hasOwn(symbols, style.endSymbol) ||
    !ANIMATIONS.includes(style.animation) ||
    !Number.isFinite(style.speed) ||
    style.speed < MIN_SPEED ||
    style.speed > MAX_SPEED

  if (invalid) throw Error('Invalid connection appearance or animation.')
  return style
}

/** An `<marker>` for one endpoint symbol, or '' for `none`. */
export function marker(id, type, color) {
  if (type === 'none') return ''
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" ` +
    `markerHeight="5" orient="auto-start-reverse">` +
    `<g fill="${color}" stroke="${color}" stroke-width="1.2" stroke-linejoin="round">` +
    `${MARKER_SHAPES[type] || ''}</g></marker>`
}

/** The visible connection line, with its two endpoint markers defined inline. */
export function styledLine(edge, path, color) {
  const style = connectionStyle(edge)
  return `<defs>${marker(`${edge.id}-start`, style.startSymbol, color)}` +
    `${marker(`${edge.id}-end`, style.endSymbol, color)}</defs>` +
    `<path class="edgeLine flowGuide" d="${path}" stroke="${color}" ` +
    `stroke-width="${style.lineWidth}" stroke-dasharray="${DASH_PATTERNS[style.lineStyle]}" ` +
    `marker-start="url(#${edge.id}-start)" marker-end="url(#${edge.id}-end)"/>`
}

/**
 * The thick pipe drawn under a connection during simulation: a grey outer
 * casing, a white lining, then a tint of the flow colour.
 */
export function flowChannel(edge, path, color) {
  const width = connectionStyle(edge).lineWidth
  const layers = [
    [width + 8.6, '#bed1df', 1],
    [width + 5.6, '#ffffff', 1],
    [width + 4.6, color, 0.2],
  ]
  return layers
    .map(
      ([strokeWidth, stroke, opacity]) =>
        `<path class="flowChannel" d="${path}" fill="none" stroke="${stroke}" ` +
        `stroke-opacity="${opacity}" stroke-width="${strokeWidth}" stroke-linejoin="round" ` +
        `stroke-linecap="round" pointer-events="none"/>`
    )
    .join('')
}
