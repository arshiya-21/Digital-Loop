import mysql from 'mysql2/promise'

import { config, assertDatabase } from '../backend/src/config/index.js'

/**
 * Look inside the database without installing anything.
 *
 * `mysql2` is already a dependency, so this needs no GUI and no client:
 *
 *     npm run db                      every table and how many rows
 *     npm run db design               one table, as rows
 *     npm run db -- "SELECT ..."      any read-only query
 *
 * Reads only. Anything that is not a SELECT is refused — this is for looking,
 * and a typo here should not be able to damage the plant's designs. The refusal
 * is the only guard: it connects with whatever account `DL_DB_USER` names, and
 * that account can write. If you want this to be unable to do damage at all,
 * point it at a read-only MySQL account.
 *
 * `multipleStatements` is off (the driver's default), so a query cannot carry a
 * second statement after a semicolon.
 */

const { host, port, name } = config.database

try {
  assertDatabase()
} catch (error) {
  console.error(`\n${error.message}\n`)
  process.exit(1)
}

const connection = await mysql.createConnection({
  host,
  port,
  user: config.database.user,
  password: config.database.password,
  database: name,
}).catch(error => {
  console.error(`\nCould not reach MySQL at ${host}:${port}/${name}.\n\n  ${error.message}\n`)
  process.exit(1)
})

const argument = process.argv.slice(2).join(' ').trim()

const query = async (sql, params = []) => {
  const [rows] = await connection.query(sql, params)
  return rows
}

/** Every table in our schema, in name order. */
const tables = async () =>
  (await query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
    [name]
  )).map(row => row.name)

/** The columns of one table, in the order they were declared. */
const columnsOf = async table =>
  (await query(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
    [name, table]
  )).map(row => row.name)

/** Values printed in a table cell: short, and never a whole layout document. */
function cell(value) {
  if (value === null || value === undefined) return '—'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > 48 ? text.slice(0, 45) + '…' : text
}

function printRows(rows) {
  if (!rows.length) {
    console.log('  (no rows)')
    return
  }
  const columns = Object.keys(rows[0])
  const width = Object.fromEntries(columns.map(column => [
    column,
    Math.max(column.length, ...rows.map(row => cell(row[column]).length)),
  ]))

  const line = cells => '  ' + columns.map(c => cells(c).padEnd(width[c])).join('  ')
  console.log(line(c => c))
  console.log('  ' + columns.map(c => '─'.repeat(width[c])).join('  '))
  for (const row of rows) console.log(line(c => cell(row[c])))
  console.log(`\n  ${rows.length} row${rows.length === 1 ? '' : 's'}`)
}

console.log(`\nmysql://${host}:${port}/${name}\n`)

if (!argument) {
  // The shape of the whole database, which is the usual question.
  const names = await tables()
  const widest = Math.max(...names.map(n => n.length))
  for (const table of names) {
    // A real count, not information_schema's estimate — InnoDB's TABLE_ROWS is
    // a guess and can be out by a lot on a small table.
    const [{ n }] = await query(`SELECT COUNT(*) AS n FROM \`${table}\``)
    const columns = await columnsOf(table)
    console.log(`  ${table.padEnd(widest)}  ${String(n).padStart(5)} rows   ${columns.join(', ')}`)
  }
  console.log('\n  npm run db <table>            the rows in one table')
  console.log('  npm run db -- "SELECT ..."    any read-only query\n')
} else if (/^\s*select\b/i.test(argument)) {
  printRows(await query(argument))
} else if ((await tables()).includes(argument)) {
  // Layouts are megabytes of JSON; nobody wants them in a terminal table.
  const columns = (await columnsOf(argument))
    .filter(column => column !== 'layout')
    .map(column => `\`${column}\``)
    .join(', ')
  printRows(await query(`SELECT ${columns} FROM \`${argument}\` LIMIT 200`))
} else {
  console.error(`  "${argument}" is neither a table here nor a SELECT.`)
  console.error(`  Tables: ${(await tables()).join(', ')}\n`)
  process.exitCode = 1
}

await connection.end()
