/**
 * The demo layout loaded on first open and by "Load sample".
 *
 * It is a visual reconstruction of a foundry sand loop, not an approved plant
 * P&ID. Every item ships with a data tag so the sample loads without violating
 * the mandatory-tag rule and Publish works straight away.
 */

const STORAGE_TYPES = [
  'raw-hopper',
  'additive-hopper',
  'steel-hopper',
  'silo',
  'twin-silo',
  'dosing',
  'dust',
]

const slug = value =>
  String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/**
 * The metric a data tag should address for an equipment type. Mirrors the
 * branches in `readings()`, so the tag names what the badge actually shows.
 */
function metricFor(type) {
  if (STORAGE_TYPES.includes(type)) return 'level'
  if (/mixer|muller/.test(type)) return 'moisture'
  if (/cooler/.test(type)) return 'sand_temp'
  if (type === 'moulding') return 'mould_positions'
  return 'throughput'
}

/**
 * Layout grid.
 *
 * Spacing is deliberately generous. Each equipment item carries a three-line
 * caption (label, tag, value badge) which needs roughly 58 user units of
 * clearance below it at 100% zoom — and more as the canvas is zoomed out,
 * because caption offsets scale with zoom (see `applyCanvasScale`). At the
 * clamp of 2.5× that is ~145 units, so every row here is pitched well beyond
 * that and nothing collides at any zoom level.
 */
const ROW_TOP = 60      // return-sand path across the top
const ROW_MIXER = 560   // mixer, conveyor and aerator
const ROW_MOULD = 560   // first moulding line
const MOULD_PITCH = 290 // 124 tall + 166 clear between rows

/** Left edge of each column. Gaps are ≥130 units so captions never meet. */
const X = {
  additive: 60,
  newSand: 320,
  storage: 780,
  bucket: 1120,
  cooler: 1340,
  sieve: 1760,
  returnLift: 2010,
  belt: 440,
  aerator: 820,
  mould: 1040,
  shakeout: 1540,
}

/**
 * How large the equipment is drawn, and how far apart.
 *
 * Only the **ratio** between them matters on screen. The view opens fitted to
 * the whole loop, so scaling sizes and positions together changes nothing at
 * all — it zooms out by exactly as much as it zoomed in. Equipment looks
 * bigger only when it occupies more of the drawing.
 *
 * Horizontal and vertical spread are separate because the fit is not square.
 * The stage is much wider than it is tall, so this layout runs out of height
 * long before it runs out of width: shortening it raises the fitted zoom,
 * while widening it is nearly free. `tests/layout-fit.mjs --search` is what
 * these numbers came from — it maximises on-screen equipment size (SIZE ×
 * fitted zoom) and refuses any pair where equipment overlaps.
 *
 * Captions are drawn at a fixed pixel size, so they occupy *fewer* layout
 * units as the fitted zoom rises — tightening the grid buys caption room
 * rather than costing it. `tests/layout-quality.mjs` measures where that
 * stops being true.
 *
 * **These numbers are on the frontier, and the frontier is flat.** Sweeping
 * the whole space with the label held readable puts on-screen equipment size
 * at 0.54–0.57 everywhere: you can trade label pixels for machine pixels one
 * for one, but no pair buys more of both. Maximising machine size alone walks
 * off a cliff — 3.92 / 3.00 / 2.20 is 19% more equipment and a 4.5px label,
 * which is worse at the only thing the size is for. Run
 * `node backend/tests/layout-fit.mjs --search --label=8` before changing them.
 */
const SIZE = 2.02
const SPREAD_X = 1.55
const SPREAD_Y = 1.4

/** Exposed so `tests/layout-fit.mjs` can undo them and try other values. */
export const SAMPLE_SCALE = { SIZE, SPREAD_X, SPREAD_Y }

const s = value => Math.round(value * SIZE)
const px = value => Math.round(value * SPREAD_X)
const py = value => Math.round(value * SPREAD_Y)

/** A blank layout, used for a new loop and for the empty-canvas state. */
export const emptyLayout = (name = 'Untitled sand loop') => ({
  format: 'sandman-loop',
  version: 1,
  name,
  background: '#fbfdff',
  nodes: [],
  edges: [],
})

export function sample() {
  const nodes = []
  const edges = []

  /** Add one equipment item, deriving its data tag from its equipment tag. */
  function node(id, type, label, tag, x, y, w, h, extra = {}) {
    nodes.push({
      id,
      type,
      label,
      tag,
      dataTag: `plant.${slug(tag || id)}.${metricFor(type)}`,
      // Applied here, in one place, so every caller keeps writing plain grid
      // units and the geometry above stays readable.
      x: px(x), y: py(y), w: s(w), h: s(h),
      rotation: 0,
      state: 'running',
      ...extra,
    })
    return id
  }

  /** Add one connection. Signal lines are thin and dashed with no motion. */
  function edge(from, fromPort, to, toPort, flow = 'sand', extra = {}) {
    const signal = flow === 'signal'
    edges.push({
      id: `default-edge-${edges.length}`,
      from, fromPort, to, toPort, flow,
      label: '',
      offset: 0,
      routing: 'auto',
      animation: signal ? 'none' : 'pulses',
      lineWidth: signal ? 1.5 : 3,
      lineStyle: signal ? 'dashed' : 'solid',
      ...extra,
    })
  }

  /** Add a P&ID instrument and its signal line back to the equipment it reads. */
  function instrument(id, type, label, tag, x, y, unit, value, to, portName = 'top') {
    node(id, type, label, tag, x, y, 50, 50, {
      unit,
      value,
      setpoint: value,
      controlMode: 'auto',
      dataTag: `demo.${id}`,
    })
    const fromPort = portName === 'bottom' ? 'top' : portName === 'right' ? 'left' : 'bottom'
    edge(id, fromPort, to, portName, 'signal', { routing: 'straight' })
  }

  // --- Sand preparation ---------------------------------------------------
  node('additive', 'additive-hopper', 'Additive hopper', 'BN-01', X.additive, ROW_TOP, 105, 150)
  node('new-sand', 'silo', 'New sand silo', 'SL-01', X.newSand, ROW_TOP, 100, 165)
  node('middle', 'twin-silo', 'Return sand storage', 'SL-02 / SL-03', X.storage, ROW_TOP, 175, 180)
  node('storage-elevator', 'elevator', 'Bucket elevator', 'BE-02', X.bucket, ROW_TOP, 80, 240)
  node('cooler', 'import-sand-cooler-orange-animated', 'Sand cooler', 'CO-01', X.cooler, ROW_TOP + 40, 280, 120)
  node('sieve', 'sieve', 'Polygon sieve', 'SIE-01', X.sieve, ROW_TOP + 20, 120, 80)
  node('return-elevator', 'elevator', 'Return elevator', 'BE-01', X.returnLift, ROW_TOP, 95, 325)

  node('mixer', 'import-disa-mixer-blue-animated', 'Intensive mixer', 'MIX-01', X.additive + 60, ROW_MIXER, 175, 240)
  node('prepared-belt', 'belt', 'Prepared sand conveyor', 'BC-01', X.belt, ROW_MIXER + 80, 240, 80)
  node('aerator', 'aerator', 'Aerator', 'AER-01', X.aerator, ROW_MIXER + 74, 75, 92)

  // Feed into the mixer, then out along the prepared sand line.
  edge('additive', 'bottom', 'mixer', 'left', 'additive')
  edge('new-sand', 'bottom', 'mixer', 'top', 'additive')
  // Out of the storage silo's side, not its bottom: its top port already
  // receives the bucket elevator, and a machine with connections on BOTH top
  // and bottom leaves its caption nowhere clear to sit.
  edge('middle', 'left', 'mixer', 'right', 'return')
  edge('mixer', 'right', 'prepared-belt', 'top')
  edge('prepared-belt', 'right', 'aerator', 'left')

  // Return sand: elevator → sieve → cooler → elevator → storage.
  edge('return-elevator', 'top', 'sieve', 'top', 'return')
  edge('sieve', 'left', 'cooler', 'top', 'return')
  edge('cooler', 'left', 'storage-elevator', 'right', 'return')
  edge('storage-elevator', 'top', 'middle', 'top', 'return')

  // --- Three identical moulding lines with their shakeouts -----------------
  for (let i = 0; i < 3; i++) {
    const y = ROW_MOULD + i * MOULD_PITCH
    const line = `moulding-${i + 1}`
    const shakeout = `shakeout-${i + 1}`
    node(
      line, 'import-disa-moulding-line-blue-animated',
      `DISA moulding line ${i + 1}`, `ML-0${i + 1}`, X.mould, y, 380, 124
    )
    // Vertically centred on its moulding line: (124 - 72) / 2.
    node(shakeout, 'shakeout', `Shakeout ${i + 1}`, `SH-0${i + 1}`, X.shakeout, y + 26, 110, 72)
    edge('aerator', 'right', line, 'left')
    edge(line, 'right', shakeout, 'left', 'return')
    // Up into the elevator's foot. The shakeouts sit well below it, so a
    // bottom entry is both the shortest path and the one that keeps all three
    // lines clear of the elevator's caption.
    edge(shakeout, 'right', 'return-elevator', 'bottom', 'return')
  }

  // --- Instrumentation ----------------------------------------------------
  // Each instrument sits clear of its equipment's caption block; their own
  // labels read to the right of the bubble.
  instrument('sand-level', 'pid-lt', 'Sand level', 'LT-101',
    X.newSand + 150, ROW_TOP + 35, '%', 68, 'new-sand', 'right')
  // On the mixer's left, keeping its bottom free so the caption stays below.
  instrument('mixer-pressure', 'pid-pt', 'Air pressure', 'PT-301',
    X.additive - 210, ROW_MIXER + 90, 'bar', 4, 'mixer', 'left')
  instrument('prepared-flow', 'pid-ft', 'Prepared sand flow', 'FT-401',
    X.belt + 90, ROW_MIXER - 140, 't/h', 58, 'prepared-belt', 'top')

  return {
    format: 'sandman-loop',
    version: 1,
    name: 'Foundry sand loop',
    background: '#fbfdff',
    nodes,
    edges,
  }
}
