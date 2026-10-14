/**
 * How big is the equipment, really?
 *
 * The studio opens fitted to the whole loop, so the only thing that decides
 * how large a machine looks is how much of the drawing it occupies. Scaling
 * sizes and positions together changes nothing — it zooms out by exactly as
 * much as it zoomed in. This measures the ratio that does matter, and refuses
 * a layout where equipment or captions overlap.
 *
 *     npm run check:layout                      check the layout as it ships
 *     node backend/tests/layout-fit.mjs --search  sweep the trade-off
 *
 * It is pure arithmetic over the sample document: no browser, no server.
 */
import { sample, SAMPLE_SCALE, CAPTION_SCALE } from '@sandman/layout-core'

/**
 * The same document at a different size/spread trio.
 *
 * `sample()` has the shipped values baked in, so this divides them back out
 * and multiplies the candidate in. Rounding makes that inexact by up to a
 * unit, which is far below anything that decides an overlap.
 */
function rescaled(size, spreadX, spreadY) {
  const doc = sample()
  return {
    ...doc,
    nodes: doc.nodes.map(node => ({
      ...node,
      x: (node.x / SAMPLE_SCALE.SPREAD_X) * spreadX,
      y: (node.y / SAMPLE_SCALE.SPREAD_Y) * spreadY,
      w: (node.w / SAMPLE_SCALE.SIZE) * size,
      h: (node.h / SAMPLE_SCALE.SIZE) * size,
    })),
  }
}

const rect = n => ({ x: n.x, y: n.y, w: n.w, h: n.h, id: n.id, label: n.label })
const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Machines only: instrument bubbles sit deliberately close to what they read. */
const isMachine = node => !/^pid-/.test(node.type) && node.type !== 'text'

/**
 * The band a machine's caption occupies, in layout units.
 *
 * Mirrors `applyCanvasScale` in the renderer: text is drawn at a fixed pixel
 * size, so it covers more layout units the further the view is zoomed out —
 * `factor` is layout-units-per-pixel, clamped exactly as the renderer clamps
 * it. Three lines sit below the machine: label, tag, then the value badge.
 *
 * Whether a caption sits below, above or to the right depends on which ports
 * the connections use, which this does not model. Below is the common case and
 * the one that decides the row pitch, so it is what gets checked.
 */
function captionBand(node, zoom, ceiling = CAPTION_SCALE.max) {
  const factor = Math.max(CAPTION_SCALE.min, Math.min(ceiling, 1 / zoom))
  const width = Math.max(node.w, String(node.label || '').length * 7 * factor)
  return {
    id: node.id,
    label: `${node.label} caption`,
    x: node.x + node.w / 2 - width / 2,
    y: node.y + node.h + 8 * factor,
    w: width,
    // label (21) → tag (36) → value badge (~56), plus its own height.
    h: 68 * factor,
  }
}

function measure(doc, ceiling = CAPTION_SCALE.max) {
  const nodes = doc.nodes.map(rect)
  const machines = doc.nodes.filter(isMachine).map(rect)

  const minX = Math.min(...nodes.map(n => n.x))
  const minY = Math.min(...nodes.map(n => n.y))
  const maxX = Math.max(...nodes.map(n => n.x + n.w))
  const maxY = Math.max(...nodes.map(n => n.y + n.h))
  const boxW = maxX - minX
  const boxH = maxY - minY

  // What a 1536×800 window fits to, which is what a person sees: the stage is
  // what is left after the library and the bars, and `fit()` then keeps 28
  // units clear on three sides and 64 below for the legend. Measured off the
  // real canvas — the previous numbers guessed the height 100px short, which
  // made every sweep optimise against a stage nobody has.
  const byWidth = (1235 - 56) / boxW
  const byHeight = (585 - 92) / boxH
  const zoom = Math.min(byWidth, byHeight)

  // Captions are sized from the zoom, so they can only be measured once the
  // zoom is known — which is why this comes after it.
  const captions = machines.map(node => captionBand(node, zoom, ceiling))

  // What the label actually measures on screen. Below roughly 8px it stops
  // being readable, which is the other half of this trade.
  const labelPx = 13 * Math.max(CAPTION_SCALE.min, Math.min(ceiling, 1 / zoom)) * zoom

  const collisions = []
  const clash = (a, b) => { if (overlaps(a, b)) collisions.push(`${a.label} ↔ ${b.label}`) }

  for (let i = 0; i < machines.length; i++) {
    for (let j = i + 1; j < machines.length; j++) clash(machines[i], machines[j])
    // A caption may not run into another machine, or into another caption.
    for (let j = 0; j < machines.length; j++) {
      if (i !== j) clash(captions[i], machines[j])
      if (j > i) clash(captions[i], captions[j])
    }
  }

  // The share of the drawing its equipment actually covers.
  const ink = machines.reduce((sum, n) => sum + n.w * n.h, 0)
  const coverage = ink / (boxW * boxH)

  return {
    boxW, boxH, coverage, zoom, collisions, labelPx, count: machines.length,
    // Which dimension is holding the zoom down — the one worth shrinking.
    constrainedBy: byWidth < byHeight ? 'width' : 'height',
    slack: Math.abs(byWidth - byHeight) / Math.max(byWidth, byHeight),
  }
}

const report = (label, m) => {
  console.log(`${label}`)
  console.log(`  bounding box   ${Math.round(m.boxW)} × ${Math.round(m.boxH)}`)
  console.log(`  fitted zoom    ${(m.zoom * 100).toFixed(0)}%`)
  console.log(`  equipment ink  ${(m.coverage * 100).toFixed(1)}% of the drawing`)
  console.log(`  limited by     ${m.constrainedBy} (${(m.slack * 100).toFixed(0)}% slack in the other)`)
  console.log(`  overlaps       ${m.collisions.length}`)
  for (const c of m.collisions.slice(0, 8)) console.log(`     ${c}`)
}

if (process.argv.includes('--search')) {
  /**
   * What a machine actually measures on screen: its layout size times the
   * zoom the view fits to. Maximising this is the whole question — "make the
   * equipment bigger" means this number, not SIZE on its own.
   */
  const onScreen = m => m.size * m.zoom

  /**
   * The caption ceiling is the other half of the trade, so sweep it too.
   *
   * A lower ceiling shrinks captions, which tightens the drawing and grows the
   * machines — but it also shrinks the label on screen. Both numbers are
   * printed so the choice is made with eyes open rather than by optimising one
   * of them into the ground.
   */
  /**
   * The label has to stay readable, or the bigger equipment is pointless.
   *
   * Maximising `SIZE × zoom` on its own walks straight off a cliff: it spreads
   * the drawing out to make room for larger machines, which lowers the fitted
   * zoom, which shrinks the captions — 19% more equipment for a label of
   * 4.5px. "I cannot identify it" is a complaint about the label as much as the
   * picture, so the sweep is held to a floor and maximises within it.
   */
  const LABEL_FLOOR = Number(
    (process.argv.find(a => a.startsWith('--label=')) || '--label=8').split('=')[1]
  )

  console.log(`Largest equipment per caption ceiling, with the label held at ${LABEL_FLOOR}px or better:\n`)
  console.log('  ceiling   SIZE  SPREAD_X  SPREAD_Y   zoom   on-screen   label')

  for (const ceiling of [2.5, 2.2, 2.0, 1.8, 1.6, 1.4]) {
    const results = []
    // The upper bounds matter: an earlier sweep stopped SPREAD_X at 1.55 and
    // every winning row sat exactly on it, so the search was reporting its own
    // fence as the optimum. Widening the drawing costs nothing while the fit is
    // held back by height, and it buys room for larger equipment.
    for (let spreadX = 0.9; spreadX <= 3.00001; spreadX += 0.05) {
      for (let spreadY = 0.6; spreadY <= 2.60001; spreadY += 0.05) {
        // Largest equipment that still fits at this spread.
        for (let size = 5.0; size >= 0.8; size -= 0.02) {
          const m = measure(rescaled(size, spreadX, spreadY), ceiling)
          if (m.collisions.length) continue
          results.push({ size, spreadX, spreadY, ...m })
          break
        }
      }
    }
    const readable = results.filter(r => r.labelPx >= LABEL_FLOOR)
    if (!readable.length) {
      console.log(`  ${ceiling.toFixed(2)}      — no layout reaches ${LABEL_FLOOR}px at this ceiling`)
      continue
    }
    readable.sort((a, b) => onScreen(b) - onScreen(a))
    const r = readable[0]
    console.log(
      `  ${ceiling.toFixed(2)}      ${r.size.toFixed(2)}    ${r.spreadX.toFixed(2)}      ` +
      `${r.spreadY.toFixed(2)}    ${(r.zoom * 100).toFixed(0)}%     ` +
      `${onScreen(r).toFixed(3)}     ${r.labelPx.toFixed(1)}px`
    )
  }

  const now = measure(sample())
  console.log(
    `\nAs it ships: on-screen ${(SAMPLE_SCALE.SIZE * now.zoom).toFixed(3)}, ` +
    `label ${now.labelPx.toFixed(1)}px, zoom ${(now.zoom * 100).toFixed(0)}%`
  )
  process.exit(0)
}

const current = measure(sample())
report('Sample layout as it ships:', current)

if (current.collisions.length) {
  console.error('\nEquipment overlaps. Lower SIZE or raise SPREAD in sample.mjs.')
  process.exit(1)
}

console.log('\nNo equipment overlaps.')
