/**
 * What a chart read asks the database, on each shape of plant table.
 *
 * `recentValues` has three cases and they are easy to break from one another:
 *
 *   a real `datetime`      windowed on the column itself
 *   `DATE` + `TIME`        joined, and the join is proved by the column types
 *   text `Date` + `Time`   joined, and the format is proved by reading the data
 *
 * The middle one is the fast path added after measuring: two typed columns
 * settle both questions the probe scans for — which date order, and whether
 * the date half already carries a time of day — so the scan is skipped. That
 * shortcut must not reach the text case, where only the data knows, and a
 * mistake there is silent: the wrong date order parses some rows and leaves
 * the rest null, which reads as a sparse chart rather than as an error.
 *
 * Speed is the other half, and it is why the statements are asserted rather
 * than just the values. Measured on 200,000 rows before this: 1,764 ms for the
 * first chart and ~800 ms for each one after, nearly all of it spent reading
 * every row of the table to answer questions about two of them.
 *
 *     DL_DB_USER=… DL_DB_PASSWORD=… node tests/chart-reads.mjs
 */
import mysql from 'mysql2/promise'
import { seal, sealingAvailable } from '../src/services/secrets.js'
import { recentValues, readStatement } from '../src/services/db-connect.js'

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
    return
  }
  failed += 1
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
}

if (!process.env.DL_DB_USER) {
  console.error('This test needs a MySQL account: set DL_DB_USER and DL_DB_PASSWORD.')
  process.exit(1)
}
if (!sealingAvailable()) {
  console.error('This test needs DL_SECRET_KEY, which is how a stored password is sealed.')
  process.exit(1)
}

const cfg = {
  host: process.env.DL_DB_HOST || '127.0.0.1',
  port: Number(process.env.DL_DB_PORT) || 3306,
  user: process.env.DL_DB_USER,
  password: process.env.DL_DB_PASSWORD || '',
  database: process.env.DL_DB_NAME || 'digital_loop',
}

const db = await mysql.createConnection(cfg)

// Named to sort first: the catalogue is capped and stops where it stops.
const TYPED = 'aaa_chart_typed'
const TEXT = 'aaa_chart_text'
const STAMPED = 'aaa_chart_stamped'

const drop = async () => {
  for (const table of [TYPED, TEXT, STAMPED, 'aaa_chart_spans']) await db.query(`DROP TABLE IF EXISTS ${table}`)
}

await drop()

/** `additive`'s shape: a `DATE` and a `TIME`, with `datetime`s beside them. */
await db.query(`CREATE TABLE ${TYPED} (
  pkey INT AUTO_INCREMENT PRIMARY KEY, reading DOUBLE,
  \`date\` DATE, \`time\` TIME, created_on DATETIME, INDEX idx_date (\`date\`))`)

/** `pouring_data`'s shape: the day and the clock as text, American order. */
await db.query(`CREATE TABLE ${TEXT} (
  pkey INT AUTO_INCREMENT PRIMARY KEY, reading DOUBLE,
  \`Date\` VARCHAR(16), \`Time\` VARCHAR(16), _watermark_ts DATETIME)`)

/** The simple shape: one column that is already the moment. */
await db.query(`CREATE TABLE ${STAMPED} (
  pkey INT AUTO_INCREMENT PRIMARY KEY, reading DOUBLE, taken_on DATETIME)`)

const two = n => String(n).padStart(2, '0')
const MINUTES = 90

for (let i = MINUTES - 1; i >= 0; i -= 1) {
  const at = new Date(Date.now() - i * 60_000)
  const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  const clock = `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
  const value = 10 + i / 10

  await db.query(
    `INSERT INTO ${TYPED} (reading, \`date\`, \`time\`, created_on) VALUES (?,?,?,?)`,
    [value, day, clock, `${day} ${clock}`])
  await db.query(
    `INSERT INTO ${TEXT} (reading, \`Date\`, \`Time\`, _watermark_ts) VALUES (?,?,?,?)`,
    // Month first, which only a scan of the data can tell from day first.
    [value, `${two(at.getMonth() + 1)}-${two(at.getDate())}-${at.getFullYear()}`, clock, `${day} ${clock}`])
  await db.query(
    `INSERT INTO ${STAMPED} (reading, taken_on) VALUES (?,?)`, [value, `${day} ${clock}`])
}

const connection = {
  id: 'chart-reads',
  engine: 'mysql',
  host: cfg.host,
  port: cfg.port,
  username: cfg.user,
  password: seal(cfg.password),
  database_name: cfg.database,
  tunnel_host: null,
  label: 'chart-reads',
}

const read = (table, seconds = 7200) =>
  recentValues(connection, { id: 'R', table, column: 'reading' }, 200, seconds)

/* ------------------------------------------------- a DATE and a TIME ---*/

const typed = await read(TYPED)
check('a DATE and a TIME are read as one moment',
  /STR_TO_DATE\(CONCAT\(DATE\(`date`\), ' ', `time`\)/.test(typed.statement), typed.statement)
check('and the points carry a time of day, not midnight',
  /T\d\d:\d\d:\d\d/.test(String(typed.at(-1)?.recordedAt)) &&
  !/T00:00:00/.test(String(typed.at(-1)?.recordedAt)), typed.at(-1)?.recordedAt)
/*
 * The term an index can answer, beside the one that is exact.
 *
 * Without it the column sits inside `STR_TO_DATE(CONCAT(…))` and every row in
 * the table is converted before any is ruled out — two hours of a year-long
 * table costing as much as reading the year.
 */
check('with a plain date bound the index can use',
  /WHERE `date` >= '\d{4}-\d{2}-\d{2}'/.test(typed.statement), typed.statement)
check('and no row limit, because the window is the bound',
  !/\bLIMIT\b/i.test(typed.statement), typed.statement)
check('ninety minutes of records fit inside a two-hour window',
  typed.length === MINUTES, typed.length)
check('and they are the readings themselves, oldest first',
  Math.abs(typed[0].value - (10 + (MINUTES - 1) / 10)) < 1e-9 &&
  Math.abs(typed.at(-1).value - 10) < 1e-9,
  { first: typed[0]?.value, last: typed.at(-1)?.value })

/* ------------------------------------------- text, where only data knows ---*/

const text = await read(TEXT)
check('a text date and time are still read as one moment',
  /STR_TO_DATE\(CONCAT\(`Date`, ' ', `Time`\)/.test(text.statement), text.statement)
/*
 * Month-first here, and nothing but the data says so — `10-11-2026` is valid
 * read either way. The fast path above must never reach this case.
 */
check('and the date order is the one that parses every row',
  /'%m-%d-%Y %H:%i:%s'/.test(text.statement), text.statement)
check('so its records are the readings too',
  text.length === MINUTES && Math.abs(text.at(-1).value - 10) < 1e-9,
  { points: text.length, last: text.at(-1)?.value })
/*
 * The pre-filter belongs to a real date column. `Date` here is text, so
 * comparing it against `'2026-10-23'` would compare strings — and on a
 * month-first table that is not even the same ordering.
 */
check('a text date gets no plain date bound',
  !/`Date` >= '/.test(text.statement), text.statement)
/*
 * And it is genuinely windowed, not falling back to the whole table.
 *
 * The assertion above passed for a while because the statement had no WHERE
 * at all: the pre-filter was being added to a text column, `'10-23-2026' >=
 * '2026-10-23'` compared two strings and was false, the windowed read found
 * nothing, and the fallback reported an unwindowed statement with a LIMIT on
 * it. Both halves have to be checked or neither means anything.
 */
check('and is windowed on the parsed expression, not on the whole table',
  /WHERE STR_TO_DATE\(CONCAT\(`Date`/.test(text.statement) &&
  !/\bLIMIT\b/i.test(text.statement), text.statement)

/* --------------------------------------------- one column that is the moment ---*/

const stamped = await read(STAMPED)
check('a real datetime is windowed on itself, with nothing joined',
  /`taken_on` AS `datetime`/.test(stamped.statement) &&
  !/STR_TO_DATE/.test(stamped.statement), stamped.statement)
check('and it holds the same ninety readings', stamped.length === MINUTES, stamped.length)

/* ----------------------------------------- a text date is not a sortable one ---*/

/*
 * `10-23-2026` is a later day than `12-01-2025` and a smaller string.
 *
 * Finding the newest moment by comparing the date column is what makes a
 * chart read fast, and it is only sound where the database knows the column
 * is a date. On month-first text, `MAX` and `ORDER BY` both answer with
 * whatever December the table holds — and the window then starts in a year
 * with no rows after it, so the chart comes back empty on a table full of
 * records. One attempt at this optimisation had exactly that bug, and the
 * fixture above did not catch it: ninety minutes of rows all fall in one
 * month, where string order and date order agree.
 *
 * So this one spans a December that is older than the newest row.
 */
const SPANS = 'aaa_chart_spans'
await db.query(`DROP TABLE IF EXISTS ${SPANS}`)
await db.query(`CREATE TABLE ${SPANS} (
  pkey INT AUTO_INCREMENT PRIMARY KEY, reading DOUBLE,
  \`Date\` VARCHAR(16), \`Time\` VARCHAR(16))`)

// An older December, which sorts above everything as a string.
await db.query(`INSERT INTO ${SPANS} (reading, \`Date\`, \`Time\`) VALUES (?,?,?)`,
  [999, '12-01-2025', '23:59:59'])
// And the real newest rows, within the window.
for (let i = 2; i >= 0; i -= 1) {
  const at = new Date(Date.now() - i * 60_000)
  await db.query(`INSERT INTO ${SPANS} (reading, \`Date\`, \`Time\`) VALUES (?,?,?)`, [
    50 + i,
    `${two(at.getMonth() + 1)}-${two(at.getDate())}-${at.getFullYear()}`,
    `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`,
  ])
}

const spans = await read(SPANS)
check('a month-first text date is not compared as a string',
  spans.length === 3 && Math.abs(spans.at(-1).value - 50) < 1e-9,
  { points: spans.length, values: spans.map(p => p.value) })
check('so an older December does not become the newest moment',
  !spans.some(point => Math.abs(point.value - 999) < 1e-9), spans.map(p => p.value))

/* ------------------------------------------------------ the window moves ---*/

/* ------------------------------- a line that stopped days ago ---*/

/*
 * The window is measured from the newest record, never from the clock.
 *
 * This plant's tables are written by a transfer rather than live: at midnight
 * the day's rows land, and until then the newest record can be hours or days
 * behind the wall clock. `NOW() - 2 hours` against that is an empty chart on
 * a table full of readings — and worse on this plant, where the database
 * session reported 09:55 UTC while the newest row said 15:16 in local time,
 * so "the last two hours" returned seven and a half.
 *
 * Anchored to `MAX(stamp)` there is nothing to get wrong: on a line that is
 * producing it is the last two hours and it moves as rows arrive; on one that
 * stopped on Friday it is the last two hours of Friday, which is the more
 * useful of the two answers anyway.
 */
const STOPPED = 'aaa_chart_stopped'
await db.query(`DROP TABLE IF EXISTS ${STOPPED}`)
await db.query(`CREATE TABLE ${STOPPED} (
  pkey INT AUTO_INCREMENT PRIMARY KEY, reading DOUBLE, taken_on DATETIME, INDEX i (taken_on))`)

/* Twenty-four hours of records a minute apart, ending three days ago. */
const stoppedAt = new Date(Date.now() - 3 * 24 * 3600_000)
stoppedAt.setHours(3, 0, 0, 0)
for (let i = 24 * 60 - 1; i >= 0; i -= 1) {
  const at = new Date(stoppedAt.getTime() - i * 60_000)
  await db.query(`INSERT INTO ${STOPPED} (reading, taken_on) VALUES (?,?)`, [
    10 + i / 100,
    `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ` +
    `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`,
  ])
}

/** The hours between the first and last point of a series. */
const spanHours = series => series.length > 1
  ? (Date.parse(series.at(-1).recordedAt) - Date.parse(series[0].recordedAt)) / 3600_000
  : 0

const windows = [['2 h', 7200, 2], ['4 h', 14400, 4], ['8 h', 28800, 8], ['1 day', 86400, 24]]
for (const [label, seconds, hours] of windows) {
  const series = await read(STOPPED, seconds)
  const span = spanHours(series)
  check(`${label} of a line that stopped three days ago is ${label} of its own last records`,
    series.length > 1 && Math.abs(span - hours) < 0.05,
    { points: series.length, span: span.toFixed(2), from: series[0]?.recordedAt, to: series.at(-1)?.recordedAt })
}

const stoppedRead = await read(STOPPED, 7200)
check('and the bound in the statement is the newest record, not the clock',
  new RegExp(`\`taken_on\` >= '${stoppedAt.getFullYear()}-`).test(stoppedRead.statement) &&
  !/NOW\(\)/.test(stoppedRead.statement), stoppedRead.statement)

await db.query(`DROP TABLE IF EXISTS ${STOPPED}`)

/* ------------------- the statement shown beside the reading ---*/

/*
 * `readStatement` is what Read now runs and what the card shows. It had no
 * test, which is how it came to join a date and a time with `+`.
 *
 * In MySQL `` `date` + `time` `` is arithmetic: both sides are coerced to
 * numbers and summed, so `2026-10-28` plus `23:59:23` is a number that is
 * neither a date nor an error. Ordering by it orders by nonsense — and the
 * reading answered `19 · recorded 2026-10-28T00:00:00` beside a chart drawn
 * from the real newest moment.
 */
const paired = readStatement('mysql', {
  id: 'BEN.ACTUAL',
  table: 'additive',
  column: 'bentonite_actual',
  timeColumn: 'date',
  timeColumn2: 'time',
})

check('a date and a time are joined, never added',
  !/`date`\s*\+\s*`time`/.test(paired.sql) &&
  /CONCAT\(DATE\(`date`\), ' ', `time`\)/.test(paired.sql), paired.sql)

check('and the ordering uses both halves, newest day then newest time',
  /ORDER BY `date` DESC, `time` DESC/.test(paired.sql), paired.sql)

const single = readStatement('mysql', {
  id: 'R', table: 't', column: 'c', timeColumn: 'taken_on',
})
check('one timestamp column is ordered on as it always was',
  /`taken_on` AS `datetime`/.test(single.sql) &&
  /ORDER BY `datetime` DESC/.test(single.sql), single.sql)

const noClock = readStatement('mysql', { id: 'R', table: 't', column: 'c' })
check('and a table with no clock gets no ORDER BY at all',
  !/ORDER BY/.test(noClock.sql), noClock.sql)

const narrow = await read(TYPED, 1800)
check('a narrower window asks for less and gets less',
  narrow.length > 0 && narrow.length < typed.length,
  { narrow: narrow.length, wide: typed.length })

await drop()
await db.end()

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
