/**
 * The legend lists what the loop actually uses.
 *
 * It used to print the same twelve entries on every drawing — eight
 * instrument symbols and four line types — whatever was on the canvas. On a
 * loop with no valves and no air line that is four entries explaining symbols
 * nobody can find, and the two line colours that *are* drawn have to be
 * hunted for among them.
 *
 * A legend is read as the key to the drawing, so every entry that is not on
 * the drawing is a thing somebody goes looking for. Wrong is worse than
 * absent.
 *
 * `inUse` is lifted out of the shipped equipment library and run against
 * made-up documents, so what is tested is the code that runs rather than a
 * copy of it that can drift.
 *
 *     node tests/legend-items.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, '..', 'studio', 'src', 'js', '01-equipment-library.js')

let passed = 0
let failed = 0

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}`)
    return
  }
  failed += 1
  console.log(`  FAIL  ${label}`)
  console.log(`        got  ${JSON.stringify(got)}`)
  console.log(`        want ${JSON.stringify(want)}`)
}

const src = readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n')
const from = src.indexOf('      const SYMBOL = {')
const to = src.indexOf('      // v9.0 — a legend can carry')
if (from < 0 || to < 0) throw new Error('the legend derivation is not in the library any more')

/** The ten line kinds, in the order `KIND` declares them. */
const KIND = {
  sand: {}, add: {}, water: {}, air: {}, ret: {},
  metal: {}, mold: {}, cast: {}, data: {}, any: {},
}

const inUse = new Function('DOC', 'KIND', `${src.slice(from, to)} return inUse();`)
const keys = doc => inUse(doc, KIND).map(entry => entry[0])

check('instruments placed on the drawing, and the lines drawn',
  keys({
    blocks: [{ type: 'motor' }, { type: 'levelTx' }, { type: 'mixer' }],
    streams: [{ kind: 'sand' }, { kind: 'ret' }],
  }),
  ['M', 'LT', 'sand', 'ret'])

/*
 * Order is the legend's own, not the drawing's: instruments in the order the
 * legend has always listed them, lines in `KIND`'s order. A legend that
 * reshuffles itself when somebody moves a pump is a legend people stop
 * trusting.
 */
check('the order is the legend\'s, whatever order the loop was drawn in',
  keys({
    blocks: [{ type: 'speedMon' }, { type: 'analyzer' }, { type: 'valve' }],
    streams: [{ kind: 'ret' }, { kind: 'sand' }],
  }),
  ['A', 'V', 'RPM', 'sand', 'ret'])

check('a line type drawn twenty times is one entry',
  keys({ blocks: [], streams: [{ kind: 'sand' }, { kind: 'sand' }, { kind: 'sand' }] }),
  ['sand'])

check('a loop with no instruments lists only its lines',
  keys({ blocks: [{ type: 'mixer' }], streams: [{ kind: 'air' }] }),
  ['air'])

check('a loop with no lines lists only its instruments',
  keys({ blocks: [{ type: 'flowTx' }], streams: [] }),
  ['FT'])

check('every instrument, when every one is placed',
  keys({
    blocks: ['analyzer', 'motor', 'valve', 'ctrlValve', 'flowTx', 'levelTx', 'tempSensor', 'speedMon']
      .map(type => ({ type })),
    streams: [],
  }),
  ['A', 'M', 'V', 'CV', 'FT', 'LT', 'TE', 'RPM'])

/*
 * An empty canvas derives nothing, and the caller falls back to the standard
 * list — a blank strip under a drawing reads as broken rather than as empty.
 */
check('an empty canvas derives nothing, so the caller can fall back',
  keys({ blocks: [], streams: [] }),
  [])

/*
 * A stream with no kind, and a kind that is not a line type, are both things
 * a hand-edited layout can carry. Neither may reach the legend.
 */
check('a stream with no kind is not an entry',
  keys({ blocks: [], streams: [{ kind: '' }, {}, { kind: 'sand' }] }),
  ['sand'])

check('a kind that is not a line type is not an entry',
  keys({ blocks: [], streams: [{ kind: 'bananas' }, { kind: 'add' }] }),
  ['add'])

/*
 * `DOC` does not exist while the module is first evaluated — the palette
 * draws its icons before a document is open — and a legend must not throw
 * there.
 */
check('no document yet is not a crash',
  inUse(undefined, KIND).map(entry => entry[0]),
  [])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
