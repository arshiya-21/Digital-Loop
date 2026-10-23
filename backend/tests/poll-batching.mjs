/**
 * The poll reads a table once, not once per reading — and reads it correctly.
 *
 * `latestValues` used to ask for each reading on its own, in a loop over one
 * connection: a loop with 128 readings sent 128 statements and waited for each
 * before sending the next. Beside the server that is milliseconds; through an
 * SSH tunnel to a plant at 40 ms round trip it is five seconds of every poll,
 * and the canvas fills a reading at a time while somebody watches.
 *
 * Readings that agree on table, ordering and row filter are now one statement
 * selecting many columns. That is a real saving and a real risk: a grouping
 * mistake hands readings each other's values, silently, and a chart of the
 * wrong column still looks like a chart. So this checks both halves — how many
 * statements went out, and that every reading got its own number.
 *
 * Needs a MySQL to write a fixture into, which `api-test.mjs` deliberately does
 * not use, so it lives in its own file. Without credentials it says so and
 * stops rather than passing silently.
 *
 *     DL_DB_USER=… DL_DB_PASSWORD=… node tests/poll-batching.mjs
 */
import mysql from 'mysql2/promise'
import { seal, sealingAvailable } from '../src/services/secrets.js'
import { latestValues } from '../src/services/db-connect.js'

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

/*
 * Named to sort first. The catalogue is capped at a few thousand columns and
 * stops where it stops, so a fixture late in the alphabet on a database with
 * a hundred tables is a fixture the schema read never reaches.
 */
const WIDE = 'aaa_poll_wide'
const NARROW = 'aaa_poll_narrow'
const COLUMNS = 20

const drop = async () => {
  await db.query(`DROP TABLE IF EXISTS ${WIDE}`)
  await db.query(`DROP TABLE IF EXISTS ${NARROW}`)
}

await drop()
await db.query(
  `CREATE TABLE ${WIDE} (pkey INT AUTO_INCREMENT PRIMARY KEY, ts DATETIME, line VARCHAR(8), ` +
  Array.from({ length: COLUMNS }, (_, i) => `c${i} DOUBLE`).join(', ') + ')')
await db.query(`CREATE TABLE ${NARROW} (pkey INT AUTO_INCREMENT PRIMARY KEY, ts DATETIME, gcs DOUBLE)`)

/*
 * Two lines of rows, five each, with values far apart.
 *
 * The row filter is the part most likely to be got wrong by grouping — a
 * reading filtered to L2 joining the unfiltered group would answer with L1's
 * number and look perfectly reasonable. Nine hundred apart, it would not.
 */
for (const [line, base] of [['L1', 100], ['L2', 900]]) {
  for (let r = 0; r < 5; r += 1) {
    await db.query(
      `INSERT INTO ${WIDE} (ts, line, ` +
      Array.from({ length: COLUMNS }, (_, i) => `c${i}`).join(', ') +
      `) VALUES (DATE_ADD(NOW(), INTERVAL ${r} SECOND), ?, ` +
      Array.from({ length: COLUMNS }, () => '?').join(', ') + ')',
      [line, ...Array.from({ length: COLUMNS }, (_, i) => base + i + r)])
  }
}
await db.query(`INSERT INTO ${NARROW} (ts, gcs) VALUES (NOW(), 7.77)`)

const connection = {
  id: 'poll-batching',
  engine: 'mysql',
  host: cfg.host,
  port: cfg.port,
  username: cfg.user,
  password: seal(cfg.password),
  database_name: cfg.database,
  tunnel_host: null,
  label: 'poll-batching',
}

const readings = [
  // Twenty on one table, newest row, no filter: the group this exists for.
  ...Array.from({ length: COLUMNS }, (_, i) =>
    ({ id: `T${i}`, table: WIDE, column: `c${i}`, timeColumn: 'ts' })),
  // The same table, filtered to the other line — a group of its own.
  { id: 'F0', table: WIDE, column: 'c0', timeColumn: 'ts', keyColumn: 'line', keyOp: '=', keyValue: 'L2' },
  { id: 'F1', table: WIDE, column: 'c1', timeColumn: 'ts', keyColumn: 'line', keyOp: '=', keyValue: 'L2' },
  // A second table.
  { id: 'G', table: NARROW, column: 'gcs', timeColumn: 'ts' },
  // A written statement, which answers for itself and nothing else.
  { id: 'Q', sql: `SELECT gcs, ts FROM ${NARROW} ORDER BY ts DESC LIMIT 1` },
  // The same column as T0, under a second reading: the aliases must not clash.
  { id: 'D1', table: WIDE, column: 'c0', timeColumn: 'ts' },
]

/** The newest row is the fifth, so every value carries `+ 4`. */
const expected = { G: 7.77, Q: 7.77, F0: 904, F1: 905, D1: 104 }
for (let i = 0; i < COLUMNS; i += 1) expected[`T${i}`] = 100 + i + 4

const statements = async () => {
  const [[status]] = await db.query("SHOW GLOBAL STATUS LIKE 'Com_select'")
  return Number(status.Value)
}

// Once to warm the schema cache, which is a read of its own and not the
// subject — see `schemaFor`.
await latestValues(connection, readings)

const before = await statements()
const answer = await latestValues(connection, readings)
// Less the `SHOW GLOBAL STATUS` this very line runs.
const sent = (await statements()) - before - 1

const wrong = Object.entries(expected).filter(([id, want]) =>
  Math.abs(Number(answer.values[id]?.value) - want) > 1e-9)

check('every reading gets its own value', wrong.length === 0,
  wrong.map(([id, want]) => ({ id, want, got: answer.values[id]?.value })))
check('and none of them reports an error', Object.keys(answer.errors).length === 0, answer.errors)

/*
 * Four statements for twenty-five readings: the unfiltered twenty-one on the
 * wide table, the two filtered to L2, the narrow table's one, and the written
 * one. Asserted as an upper bound — a future grouping may do better, and the
 * point is that it never goes back to one per reading.
 */
check(`twenty-five readings cost four statements, not twenty-five (sent ${sent})`,
  sent > 0 && sent <= 4, sent)

/*
 * A row filter is never grouped away.
 *
 * Checked separately from the values above because this is the mistake that
 * would be invisible on a plant: L2's readings answering with L1's numbers is
 * a chart of the wrong line, drawn confidently.
 */
check('a filtered reading keeps its own filter',
  Number(answer.values.F0?.value) === 904 && Number(answer.values.F1?.value) === 905,
  { F0: answer.values.F0?.value, F1: answer.values.F1?.value })

await drop()
await db.end()

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
