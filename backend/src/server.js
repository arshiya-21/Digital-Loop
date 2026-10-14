import { createApp } from './app.js'
import { config, assertSecret, assertDatabase } from './config/index.js'
import { init, close } from './config/db.js'
import { startTicketSweeper, purgeTicketsOnce } from './services/ticket-store.js'

/*
 * Checked before anything is listening.
 *
 * A shared secret with a default is not a secret, and a database account that
 * ships in the source is an account anybody can use — so neither has one, and
 * this refuses to start without them. Failing here is loud and in front of
 * whoever is deploying; failing later is a 401, or a 500, that somebody else
 * has to diagnose.
 */
try {
  assertSecret()
  assertDatabase()
} catch (error) {
  console.error(`\nDigital Loop will not start.\n\n${error.message}`)
  process.exit(1)
}

/*
 * Connect, create the database if it is missing, apply the schema.
 *
 * Everything that follows queries, so nothing may start before this resolves —
 * which is why the whole startup is now a sequence rather than a file of
 * top-level statements. MySQL's driver is asynchronous; SQLite's was not.
 */
try {
  await init()
} catch (error) {
  const { host, port, name, user } = config.database
  console.error(
    `\nDigital Loop will not start: MySQL at ${host}:${port} could not be used.\n\n` +
    `  database  ${name}\n  account   ${user}\n  reason    ${error.message}\n\n` +
    'Check the server is running and that DL_DB_USER / DL_DB_PASSWORD are right.\n'
  )
  process.exit(1)
}

/*
 * Launch payloads do not survive.
 *
 * A ticket carries the whole of what SandMan said about a person — their name,
 * their email, their plant and its tables. It is deleted the moment it is
 * redeemed, and anything left behind by a crash or an abandoned launch goes
 * here and every minute after.
 */
const wiped = await purgeTicketsOnce()
// The count only — never the contents.
const scrubbed = wiped.removed ? `${wiped.removed} stale ticket(s) cleared` : ''
const sweeper = startTicketSweeper()

const app = createApp()

/**
 * One line: where it is.
 *
 * The banner used to list the SandMan address, the allowed launch addresses,
 * the database and the auth mode on every start. All of it is true and almost
 * none of it is what somebody wants at that moment — they want to know it came
 * up and where to point a browser. Six lines of scenery before every run also
 * pushes the request log, which is the part worth reading, off the screen.
 *
 * The detail is still available, because it is genuinely useful when something
 * is misconfigured — a wrong database or a missing SandMan has been found that
 * way more than once. It is behind `DL_VERBOSE=1` rather than gone.
 */
const server = app.listen(config.port, () => {
  console.log(`\nDigital Loop  http://localhost:${config.port}${config.basePath}\n`)

  if (!process.env.DL_VERBOSE) return

  const line = (label, value) => console.log(`  ${label.padEnd(14)}${value}`)
  const { host, port, name, user } = config.database
  line('studio + API', `${config.basePath || ''}/  and  ${config.basePath}/api/v1`)
  line('sandman', config.sandman.url)
  line('launches from', config.launchAllowedIps.join(', '))
  line('database', `mysql://${user}@${host}:${port}/${name}`)
  if (scrubbed) line('startup', scrubbed)
  line('auth', 'STUB — shared secret, not a signature. Not for production.')
  console.log('')
})

// Finish in-flight requests before exiting, and give the pool back, so a
// restart never truncates a response or leaves a connection half-used.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, closing.`)
    clearInterval(sweeper)
    server.close(async () => {
      await close().catch(() => {})
      process.exit(0)
    })
  })
}
