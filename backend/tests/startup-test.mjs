/**
 * The two things that happen before a request is ever served: refusing to
 * start without a usable secret or a database account, and not leaving launch
 * payloads behind.
 *
 * Everything here runs against a database of its own — `digital_loop_test`,
 * created on first use — so nothing can touch the designs somebody is working
 * on. The MySQL account comes from `DL_DB_USER` / `DL_DB_PASSWORD`, the same
 * ones the server uses; only the database name differs.
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const SERVER = resolve(import.meta.dirname, '..', 'src', 'server.js')

/** Its own database. The name, not the account, is what keeps this separate. */
const DL_DB_NAME = process.env.DL_TEST_DB_NAME || 'digital_loop_test'
const DATABASE_ENV = {
  DL_DB_HOST: process.env.DL_DB_HOST || '127.0.0.1',
  DL_DB_PORT: process.env.DL_DB_PORT || '3306',
  DL_DB_USER: process.env.DL_DB_USER || '',
  DL_DB_PASSWORD: process.env.DL_DB_PASSWORD || '',
  DL_DB_NAME,
}

if (!DATABASE_ENV.DL_DB_USER) {
  console.error(
    '\nThese tests need a MySQL account.\n\n' +
    '  Set DL_DB_USER and DL_DB_PASSWORD. They are used against ' +
    `"${DL_DB_NAME}", not the real database.\n`
  )
  process.exit(1)
}

let passed = 0
let failed = 0
const log = []
const check = (label, condition, detail) => {
  if (condition) { passed += 1; log.push(`  PASS  ${label}`) }
  else { failed += 1; log.push(`  FAIL  ${label} :: ${JSON.stringify(detail)?.slice(0, 300)}`) }
}

/** Start the server with a given environment and report how it ended. */
function startWith(env, { expectListening = false } = {}) {
  return new Promise(done => {
    const child = spawn(process.execPath, [SERVER], {
      /*
       * The detail the banner used to print on every start is now behind
       * DL_VERBOSE — it is still what these checks are about, so they ask for
       * it rather than asserting on a line that is deliberately quiet.
       */
      env: { ...process.env, PORT: '5099', DL_VERBOSE: '1', ...DATABASE_ENV, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })

    const settle = code => {
      clearTimeout(timer)
      try { child.kill() } catch { /* already gone */ }
      done({ code, out })
    }
    child.on('exit', settle)

    /*
     * A server that was supposed to start is given a moment and then stopped:
     * the question is whether it refused, not how long it runs.
     *
     * Generous, because this is a cold Node start — importing the app, opening
     * a connection, applying the schema. Two and a half seconds was enough when
     * this ran alone and not when it ran after another suite, which is the
     * kind of flake that gets a real failure dismissed later.
     */
    const timer = setTimeout(() => settle(expectListening ? 'listening' : 'still-running'), 15000)
  })
}

log.push('STARTUP — the shared secret has no default')

const missing = await startWith({ SANDMAN_SECRET: '' })
check('refuses to start with no secret',
  missing.code === 1 && /SANDMAN_SECRET is not set/.test(missing.out), missing.out.slice(0, 200))

const short = await startWith({ SANDMAN_SECRET: 'too-short' })
check('refuses to start with a short secret',
  short.code === 1 && /at least 32/.test(short.out), short.out.slice(0, 200))

const placeholder = await startWith({ SANDMAN_SECRET: 'dev-sandman-shared-secret' })
check('refuses to start on the old development placeholder',
  placeholder.code === 1 && /placeholder/.test(placeholder.out), placeholder.out.slice(0, 200))

check('and none of those messages prints a secret',
  ![missing, short, placeholder].some(r => r.out.includes('dev-sandman-shared-secret') &&
    !/placeholder/.test(r.out)))

log.push('STARTUP — the database account has no default either')

const secret = randomBytes(32).toString('hex')

const noAccount = await startWith({ SANDMAN_SECRET: secret, DL_DB_USER: '' })
check('refuses to start with no database account',
  noAccount.code === 1 && /DL_DB_USER is not set/.test(noAccount.out), noAccount.out.slice(0, 200))

const wrongPort = await startWith({ SANDMAN_SECRET: secret, DL_DB_PORT: '3399' })
check('says plainly when MySQL cannot be reached',
  wrongPort.code === 1 && /MySQL at .*:3399 could not be used/.test(wrongPort.out),
  wrongPort.out.slice(0, 300))

/*
 * Checked by shape, not by searching for the password in the output.
 *
 * "the password is not in this string" is a test that passes for the wrong
 * reason the moment the password happens to be a substring of something else
 * — `root` as a password matches the `root@` in the connection line. So the
 * assertion is that the line says the account and nothing more.
 */
const accountLine = /^\s*account\s+(.*)$/m.exec(wrongPort.out)
check('and names the account alone, with no password beside it',
  accountLine?.[1].trim() === DATABASE_ENV.DL_DB_USER, accountLine?.[1])

const good = await startWith({ SANDMAN_SECRET: secret }, { expectListening: true })
check('starts with a proper secret and a reachable database',
  good.code === 'listening', good.out.slice(0, 400))
check('and says which addresses may mint a launch',
  /launches from/.test(good.out), good.out.slice(0, 400))
// Exact, for the same reason as above: a password added to this line would
// make it something other than user@host:port/name.
const bannerLine = /^\s*database\s+(\S+)\s*$/m.exec(good.out)
const { DL_DB_HOST, DL_DB_PORT, DL_DB_USER } = DATABASE_ENV
check('and names the database as account@host:port/name, with no password in it',
  bannerLine?.[1] === `mysql://${DL_DB_USER}@${DL_DB_HOST}:${DL_DB_PORT}/${DL_DB_NAME}`,
  bannerLine?.[1])

// ------------------------------------------------------------- the tickets ---
log.push('TICKETS — launch payloads do not linger')

Object.assign(process.env, DATABASE_ENV, { SANDMAN_SECRET: secret })
const { db, now, uid, init, close } = await import('../src/config/db.js')
await init()
const { purgeExpiredTickets, purgeTicketsOnce } =
  await import('../src/services/ticket-store.js')

const addTicket = async (secondsFromNow, who) => {
  const id = uid('tkt')
  await db
    .prepare('INSERT INTO launch_ticket (id, payload, issued_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, JSON.stringify({ user: who, email: `${who}@example.test` }), now(),
      new Date(Date.now() + secondsFromNow * 1000).toISOString())
  return id
}

await db.prepare('DELETE FROM launch_ticket').run()
await addTicket(-60, 'long.gone')
await addTicket(-1, 'just.expired')
const live = await addTicket(120, 'still.valid')

const swept = await purgeExpiredTickets()
check('expired tickets are deleted', swept.removed === 2, swept)
const left = await db.prepare('SELECT id FROM launch_ticket').all()
check('an unexpired one is left alone', left.length === 1 && left[0].id === live, left)

const wiped = await purgeTicketsOnce()
check('the one-time clear removes every ticket', wiped.removed === 1 && wiped.rebuilt === true, wiped)
check('and leaves none behind',
  (await db.prepare('SELECT COUNT(*) AS n FROM launch_ticket').get()).n === 0)
check('a clear with nothing to do does not rebuild the table for no reason',
  (await purgeTicketsOnce()).rebuilt === false)

/*
 * The point of deleting rather than marking: the payload is a name, an email
 * and the plant's table names, and once purged none of it is still in the
 * table.
 *
 * On SQLite this went further and read the raw file, because a deleted row's
 * bytes stayed in free pages until something overwrote them — payloads were
 * found readable in a four-megabyte `-wal` long after the rows had gone. There
 * is no file to read here: the database is reached through an account, and
 * InnoDB's freed space is inside its own tablespace. `OPTIMIZE TABLE` in the
 * clear rebuilds the table so that space is returned rather than merely freed
 * for reuse, which is as far as this can be checked from outside.
 */
await addTicket(-5, 'leak.check')
await purgeExpiredTickets()
await purgeTicketsOnce()
const anyLeft = await db
  .prepare("SELECT COUNT(*) AS n FROM launch_ticket WHERE payload LIKE '%leak.check%'")
  .get()
check('no purged payload is still in the table', anyLeft.n === 0, anyLeft)

console.log(log.join('\n'))
console.log(`\n${passed} passed, ${failed} failed`)

await close()
process.exit(failed ? 1 : 0)
