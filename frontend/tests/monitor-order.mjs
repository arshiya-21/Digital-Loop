/**
 * The live panel lists what went wrong today first, and is alphabetical under it.
 *
 * An operator walking up to the Fault alarm panel has one question — what
 * needs me — and the answer has to be the top line rather than something to
 * scan for. So the worst alert raised on a reading *today* decides where it
 * sits, and readings nothing has happened to sit below in name order.
 *
 * Two decisions in here are easy to get wrong in a way nobody notices:
 *
 *   **"today", not "still active".** A bentonite level that went critical at
 *   nine and was brought back by ten is the thing that mattered on this line
 *   this morning. Ordering by what is in alarm *right now* would drop it back
 *   among the readings that behaved, and the shift would end without anyone
 *   seeing it.
 *
 *   **One rule, not two.** Severity first and the hand-picked order as the
 *   tie-break was tried, and it rearranges the quiet end of the list the
 *   moment anything goes wrong — the reading somebody knows is fourth from
 *   the bottom moves while they are looking away from it. The name as the
 *   tie-break keeps the quiet part still.
 *
 * `mpTags` and `mpWorstToday` are lifted out of the shipped studio file and
 * run against stubs, so what is tested is the code that runs rather than a
 * copy of it that can drift from it.
 *
 *     node tests/monitor-order.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, '..', 'studio', 'src', 'js', '20-live-monitor.js')

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

/**
 * One function, from its `function` line to the next top-level declaration.
 *
 * Sliced rather than brace-counted, because braces inside strings and regular
 * expressions make a counter disagree with the parser.
 */
function lift(name) {
  const at = src.indexOf(`\nfunction ${name}(`)
  if (at < 0) throw new Error(`${name} is not in ${SOURCE} any more`)
  const rest = src.slice(at + 1)
  const end = rest.search(/\n(?:function |const |var |\/\*)/)
  return rest.slice(0, end > 0 ? end : rest.length)
}

/*
 * The stubs are built inside the generated function so they close over the
 * same `REG` and `ALERTS` the lifted code reads. Passing them in from out
 * here gives each stub a different `REG`, which stays empty — and then every
 * case "passes" by returning nothing at all.
 */
const order = new Function(`
  return function (REG, ALERTS, picked) {
    const chosen = picked || Object.keys(REG);
    const mpCfg = () => ({ tags: chosen });
    const mpSuggested = () => chosen;
    ${lift('mpWorstToday')}
    ${lift('mpTags')}
    return mpTags();
  }`)()

/**
 * `mpSuggested` on its own, for the set the panel opens on when nobody has
 * chosen one. `answers` lists the readings the plant is giving a number for.
 */
const suggest = new Function(`
  return function (REG, DOC, answers) {
    const val = id => (answers.includes(id) ? 1 : null);
    const mpOwner = () => 'EQ';
    ${lift('mpSuggested')}
    return mpSuggested();
  }`)()

const READINGS = {
  COAL: { desc: 'Coal dust actual' },
  BEN: { desc: 'Bentonite bin level' },
  GCS: { desc: 'GCS' },
  MOIST: { desc: 'Moisture percentage' },
}

const today = hour => {
  const at = new Date()
  at.setHours(hour, 0, 0, 0)
  return at
}
const yesterday = hour => {
  const at = new Date()
  at.setDate(at.getDate() - 1)
  at.setHours(hour, 0, 0, 0)
  return at
}

check('a quiet day is alphabetical, by the name on screen',
  order(READINGS, {}),
  ['BEN', 'COAL', 'GCS', 'MOIST'])

check('a critical today puts that reading first',
  order(READINGS, { k: { tagId: 'BEN', sev: 3, t: today(9), active: true } }),
  ['BEN', 'COAL', 'GCS', 'MOIST'])

check('critical, then warning, then advisory, then the quiet ones',
  order(READINGS, {
    a: { tagId: 'GCS', sev: 1, t: today(8) },
    b: { tagId: 'MOIST', sev: 2, t: today(8) },
    c: { tagId: 'COAL', sev: 3, t: today(8) },
  }),
  ['COAL', 'MOIST', 'GCS', 'BEN'])

check("yesterday's alert belongs to yesterday's shift",
  order(READINGS, { k: { tagId: 'GCS', sev: 3, t: yesterday(23) } }),
  ['BEN', 'COAL', 'GCS', 'MOIST'])

/*
 * The one that would be missed by ordering on "active".
 */
check('an alert that came back to normal today still orders the list',
  order(READINGS, {
    k: { tagId: 'MOIST', sev: 3, t: today(7), active: false, cleared: today(8) },
  }),
  ['MOIST', 'BEN', 'COAL', 'GCS'])

check('the worst alert on a reading is the one that counts',
  order(READINGS, {
    a: { tagId: 'GCS', sev: 1, t: today(8) },
    b: { tagId: 'GCS', sev: 3, t: today(9) },
    c: { tagId: 'COAL', sev: 2, t: today(10) },
  }),
  ['GCS', 'COAL', 'BEN', 'MOIST'])

/*
 * The quiet end of the list holds still while the top of it changes.
 */
check('an alert on one reading does not reorder the rest',
  order(READINGS, { k: { tagId: 'GCS', sev: 2, t: today(9) } }),
  ['GCS', 'BEN', 'COAL', 'MOIST'])

check('a reading with no description sorts under its id',
  order({ ZEBRA: {}, alpha: { desc: 'alpha' } }, {}),
  ['alpha', 'ZEBRA'])

/*
 * The case the first build got wrong on the plant's own screen.
 *
 * Bentonite went to warning and the panel showed twelve squeeze pressures and
 * compactabilities with no bentonite anywhere, because the suggested set had
 * filled up before reaching it. Sorting a list the reading is not in cannot
 * put it first — so what is in alarm joins the list.
 */
const PICKED = { A: { desc: 'A pressure' }, B: { desc: 'B pressure' } }
const WITH_BEN = { ...PICKED, BEN: { desc: 'Bentonite bin level' } }

check('a reading in alarm today joins the panel even if it was not picked',
  // The loop holds three readings; only two were picked for the panel.
  order(WITH_BEN, { k: { tagId: 'BEN', sev: 2, t: today(9), active: true } }, ['A', 'B']),
  ['BEN', 'A', 'B'])

check('but a quiet reading that was not picked stays off it',
  order(WITH_BEN, {}, ['A', 'B']),
  ['A', 'B'])

check("and yesterday's alarm does not drag it back on",
  order(WITH_BEN, { k: { tagId: 'BEN', sev: 3, t: yesterday(22) } }, ['A', 'B']),
  ['A', 'B'])

check('an alarm on a reading that is not in the loop is ignored',
  order(PICKED, { k: { tagId: 'GHOST', sev: 3, t: today(9), active: true } }, ['A', 'B']),
  ['A', 'B'])

/*
 * A timestamp the browser cannot read is not evidence about today either way,
 * and must not throw on the way past.
 */
check('an unreadable timestamp is ignored rather than thrown on',
  order(READINGS, { k: { tagId: 'BEN', sev: 3, t: 'not a date' } }),
  ['BEN', 'COAL', 'GCS', 'MOIST'])

/* ------------------------------- the set the panel opens on ---*/

/*
 * A panel of dashes is a panel of nothing.
 *
 * The twelve are taken in order of importance, and on this plant most of the
 * important ones are not linked to a database at all — so the panel opened on
 * twelve rows every one of which read "—". Putting the answering ones first
 * was not enough: there are only a handful, so the rest of the twelve filled
 * with dashes underneath. A row that will never carry a number is not a row.
 *
 * `val` returns null for a reading with no record, which is what stops the
 * studio drawing its own simulation as though it were the plant, and that is
 * the whole test.
 */
const SUGGEST_REG = { A: {}, B: {}, C: {}, D: {} }
const SUGGEST_DOC = {
  cps: [],
  blocks: [{ tags: [{ id: 'A', show: true }, { id: 'B', show: true }, { id: 'C', show: true }, { id: 'D', show: true }] }],
}

check('only the readings the plant answers for are offered',
  suggest(SUGGEST_REG, SUGGEST_DOC, ['C', 'D']),
  ['C', 'D'])

check('and importance still decides the order among them',
  suggest(SUGGEST_REG, SUGGEST_DOC, ['D', 'B']),
  ['B', 'D'])

/*
 * An empty panel is the honest answer on a loop where nothing is linked yet.
 * It used to fill with twelve rows of dashes instead, which reads as a panel
 * that is broken rather than a loop that is not wired up.
 */
check('a plant answering for nothing offers no rows at all',
  suggest(SUGGEST_REG, SUGGEST_DOC, []),
  [])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
