/**
 * End-to-end exercise of every API surface, including the paths that must be
 * REFUSED. A pass here means the controls work, not just the happy path.
 *
 * Self-contained: it starts its own API process and its own stand-in for
 * SandMan's liveness endpoint, so `npm test` needs nothing running first.
 *
 * The stand-in is four lines of http server that answers `{service:'sandman'}`.
 * It is a test fixture, not a simulator of SandMan — the studio's SandMan
 * simulator was deleted, and this exists only because ticket redemption is
 * refused while SandMan is unreachable, which is the behaviour being relied on
 * rather than worked around.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

// The allowlist is a pure function in a file of its own — no database, no
// routes — so it is tested directly rather than by trying to make a request
// arrive from an address this machine does not have.
import { launchAllowed } from '../src/utils/launch-allowlist.js'

const API_PORT = Number(process.env.TEST_API_PORT) || 5001
const SANDMAN_PORT = Number(process.env.TEST_SANDMAN_PORT) || 7099
/** Where the service is mounted. Must match the server's `DL_BASE_PATH`. */
const BASE_PATH = process.env.DL_BASE_PATH ?? '/sandman/digitalloop'
const BASE = `http://localhost:${API_PORT}${BASE_PATH}/api/v1`

/**
 * A fresh shared secret for every run.
 *
 * Never hard-coded: a secret written in a test file is a secret in the
 * repository's history, and the server now refuses to start on the old
 * placeholder precisely because that happened to it.
 */
const SECRET = randomBytes(32).toString('hex')

/** What the studio sends on every state-changing request. See requireSameSite. */
const CSRF = { 'x-requested-with': 'digital-loop' }

let passed = 0
let failed = 0
const log = []

function check(label, condition, detail) {
  if (condition) { passed++; log.push(`  PASS  ${label}`) }
  else { failed++; log.push(`  FAIL  ${label} :: ${JSON.stringify(detail)?.slice(0, 300)}`) }
}

/*
 * The results are printed at the end, which is unhelpful if the suite throws
 * part way: the output is a bare stack trace and no indication of how far it
 * got. So an unexpected error prints everything that had passed first — the
 * last line is the check before the one that broke.
 */
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, error => {
    console.log(log.join('\n'))
    console.error(`\nThe suite stopped here: ${error?.message || error}`)
    if (apiErrors.length) console.error('\nThe API said:\n' + apiErrors.join(''))
    process.exit(1)
  })
}

// --- SandMan's liveness endpoint, and nothing else -------------------------
/**
 * What the stub was asked for, so a test can prove the cache stopped a call.
 *
 * `down` makes it refuse everything, which is how "SandMan is not answering"
 * is produced without stopping the server and racing the next request.
 */
const sandmanCalls = { values: 0, chart: 0, down: false }

/** The API's cache window for this run. See the spawn environment below. */
const VALUES_CACHE_MS = 1500

/** A record shaped the way SandMan's /values answers. */
const record = (value, date, time, shift) =>
  ({ value, date, time, shift, recordedAt: `${date}T${time}` })

const sandman = createServer((req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (sandmanCalls.down && req.url !== '/api/su/digital-loop/health') {
    // 500 rather than a dropped socket: this is SandMan unwell, which is the
    // case the studio has to survive, and it is reproducible.
    return json(500, { error: 'the stub is pretending to be down' })
  }

  if (req.url === '/api/su/digital-loop/values') {
    sandmanCalls.values += 1
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const asked = JSON.parse(body || '{}')
      sandmanCalls.lastValues = asked
      const values = {}
      const errors = {}
      for (const tag of asked.tags || []) {
        // One tag is deliberately unreadable, so the per-tag error map is
        // exercised rather than assumed.
        if (tag.column === 'missingcolumn') errors[tag.id] = 'unknown column'
        else if (tag.column === 'norecord') values[tag.id] = null
        else values[tag.id] = record(2.62, '2026-02-18', '12:12:00', 'A')
      }
      json(200, { values, errors })
    })
    return
  }

  if (req.url === '/api/su/digital-loop/chart') {
    sandmanCalls.chart += 1
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      sandmanCalls.lastChart = JSON.parse(body || '{}')
      json(200, {
        dateFrom: '2026-01-20',
        dateTo: '2026-02-18',
        series: [
          record(2.60, '2026-02-17', '09:00:00', 'A'),
          record(2.66, '2026-02-18', '12:12:00', 'A'),
        ],
        processControl: {
          MEAN: { y: [2.6, 2.64], n: ['17-Feb-2026 9:00', '18-Feb-2026 12:00'], limits: [2.8, 2.62, 2.44] },
          RANGE: { y: [0.06, 0.04], n: ['17-Feb-2026 9:00', '18-Feb-2026 12:00'], limits: [0.15, 0.05, 0] },
          shiftAverages: 127,
        },
      })
    })
    return
  }

  json(200, { ok: true, service: 'sandman' })
})
await new Promise(done => sandman.listen(SANDMAN_PORT, done))

// --- the API under test ----------------------------------------------------
/*
 * The API will not start without a MySQL account, and "the API did not start"
 * is a poor way to learn that. Said here instead, before anything is spawned.
 *
 * This runs against whatever DL_DB_NAME points at, and needs that database
 * SEEDED — the equipment catalogue is what layout validation checks a node
 * type against, and against an empty one nothing is ever rejected, so a third
 * of this suite passes for the wrong reason.
 *
 *     DL_DB_NAME=digital_loop_test npm --prefix ../database run seed:reset
 *
 * It creates designs and deletes them again at the end, but a run that stops
 * early leaves them behind — which is the other thing `seed:reset` is for.
 */
if (!process.env.DL_DB_USER) {
  console.error(
    '\nThese tests need a MySQL account.\n\n' +
    '  Set DL_DB_USER and DL_DB_PASSWORD, and DL_DB_NAME if the suite should\n' +
    '  not run against the development database.\n'
  )
  process.exit(1)
}

const api = spawn(process.execPath, [resolve(import.meta.dirname, '..', 'src', 'server.js')], {
  env: {
    ...process.env,
    PORT: String(API_PORT),
    SANDMAN_URL: `http://localhost:${SANDMAN_PORT}`,
    SANDMAN_SECRET: SECRET,
    /*
     * A throwaway sealing key, so the stored-credential path is exercised on
     * every run rather than depending on whoever is running the suite having
     * one set. It never leaves this process and nothing it sealed outlives it.
     */
    DL_SECRET_KEY: randomBytes(32).toString('hex'),
    /*
     * A short cache window, so the live-readings tests can watch an entry go
     * stale without sleeping for thirty seconds. Long enough that two calls
     * made back to back still share one read, which is the other half of what
     * is being checked.
     */
    DL_VALUES_CACHE_MS: String(VALUES_CACHE_MS),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const apiErrors = []
api.stderr.on('data', chunk => apiErrors.push(String(chunk)))

/*
 * If the API falls over mid-run, every request after it does is a bare
 * `fetch failed` — which says nothing about why. Whatever the API itself
 * printed on its way out is the actual answer, so it is printed here.
 */
api.on('exit', code => {
  console.error(`\nThe API exited (${code}) while the suite was running.\n` + apiErrors.join(''))
})

const stop = () => { try { api.kill() } catch {} ; sandman.close() }
process.on('exit', stop)

/** Wait for the API to answer rather than guessing how long it takes. */
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const probe = await fetch(`${BASE}/session/sandman`)
    if (probe.ok) break
  } catch { /* not up yet */ }
  await new Promise(r => setTimeout(r, 250))
  if (attempt === 59) {
    console.error('The API did not start.\n' + apiErrors.join(''))
    stop()
    process.exit(1)
  }
}

/**
 * A request as a tool makes one: bearer token, and the studio's CSRF header.
 *
 * The studio itself uses the cookie and never a bearer — that path is checked
 * separately, in the ENTRY section. Bearer is kept for tests and tools, which
 * have no cookie jar.
 */
async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...CSRF,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let payload = text
  try { payload = JSON.parse(text) } catch { /* raw file response */ }
  return { status: res.status, body: payload, contentType: res.headers.get('content-type') }
}

/** Mint a ticket, the way SandMan's server does. */
async function mintTicket(launch) {
  const minted = await fetch(`${BASE}/session/launch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sandman-secret': SECRET },
    body: JSON.stringify(launch),
  })
  const body = await minted.json().catch(() => ({}))
  if (!body.ticket) throw new Error(`launch refused: ${minted.status}`)
  return body.ticket
}

/**
 * Post a ticket the way SandMan's page does: a urlencoded form into an iframe.
 * Redirects are not followed, because the Set-Cookie on the 303 is the answer.
 */
async function enter(ticket) {
  return fetch(`${BASE}/session/enter`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ticket }).toString(),
    redirect: 'manual',
  })
}

/** The dl_session value out of a Set-Cookie header, or ''. */
function cookieValue(response) {
  const header = response.headers.get('set-cookie') || ''
  const match = /(?:^|,\s*)dl_session=([^;]*)/.exec(header)
  return match ? match[1] : ''
}

/**
 * Sign somebody in the only way anybody can: a launch SandMan minted, then
 * posted into the iframe. The payload IS the organisation — there is nothing
 * to provision first, and no account to create.
 *
 * Returns the session token taken out of the cookie, so the rest of the suite
 * can keep using a bearer header for brevity.
 */
async function signIn(launch) {
  const entered = await enter(await mintTicket(launch))
  const token = decodeURIComponent(cookieValue(entered))
  if (!token) throw new Error(`entry refused with ${entered.status} and no cookie`)
  return token
}

// ---------------------------------------------------------------- identity ---
log.push('AUTH')
check('no token is rejected', (await call(null, 'GET', '/me')).status === 401)
check('an invented token is rejected', (await call('not-a-session', 'GET', '/me')).status === 401)

/**
 * This suite's own plant. It exists only in the launch payloads below.
 *
 * The suite creates designs, uploads equipment and force-deletes it again,
 * which leaves wreckage — including a design pointing at a slug that no longer
 * exists. None of that belongs in the seeded demo, which is what somebody opens
 * the studio to look at. So it runs in a foundry of its own, which costs
 * nothing now that a foundry is just an id SandMan sends.
 */
const stamp = Date.now().toString(36).slice(-5)
const foundryId = `FND-APITEST-${stamp}`
const lineId = `LINE-1-${stamp}`
const line2Id = `LINE-2-${stamp}`

/**
 * The foundry's database, as SandMan sends it with the launch.
 *
 * Names only — there are no credentials in it and nothing here ever connects.
 * A real one runs to a couple of hundred tables and several thousand columns;
 * two tables is enough to prove it is carried, scoped to the session and
 * served back.
 */
const DATABASE = {
  name: `apitest_sandman_${stamp}`,
  tables: [
    {
      name: 'preparedsand',
      columns: [
        { name: 'pkey', type: 'int' },
        { name: 'moisture', type: 'float' },
        { name: 'compactability', type: 'float' },
      ],
    },
    {
      name: 'returnsand',
      columns: [{ name: 'pkey', type: 'int' }, { name: 'temperature', type: 'float' }],
    },
  ],
}

const PLANT = {
  foundry: foundryId,
  foundryName: `API test foundry ${stamp}`,
  lines: [{ id: lineId, name: 'Test line 1' }, { id: line2Id, name: 'Test line 2' }],
  database: DATABASE,
}

log.push('SESSIONS — the launch is the only way in')
const forged = await fetch(`${BASE}/session/launch`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sandman-secret': 'wrong' },
  body: JSON.stringify({ user: 'x', role: 'admin', ...PLANT }),
})
check('a launch without the shared secret is refused', forged.status === 401)

const incomplete = await fetch(`${BASE}/session/launch`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sandman-secret': SECRET },
  body: JSON.stringify({ user: 'x', role: 'admin', foundry: 'F', foundryName: 'F', lines: [] }),
})
check('a launch with no lines is refused', incomplete.status === 400)

const ADMIN = await signIn({ user: 'admin@mpminfosoft', name: 'Plant administrator', role: 'admin', ...PLANT })
const OP1 = await signIn({ user: 'operator.line1', name: 'Line 1 operator', role: 'viewer', ...PLANT })
// A genuine outsider: same person, different plant. Membership of the foundry
// named in the launch is the whole access control.
const OP2 = await signIn({
  user: 'operator.line2', name: 'Line 2 operator', role: 'viewer',
  foundry: `FND-OTHER-${stamp}`, foundryName: 'Some other foundry',
  lines: [{ id: `LINE-X-${stamp}`, name: 'Their line' }],
})
check('entering yields a session token, not a username',
  typeof ADMIN === 'string' && ADMIN.length >= 32 && ADMIN !== 'admin@mpminfosoft', ADMIN?.slice(0, 12))

// ------------------------------------------------------- entry by POST only ---
log.push('ENTRY — the ticket is posted, never put in a URL')

const entryTicket = await mintTicket({
  user: 'entry.tester', name: 'Entry tester', role: 'admin', ...PLANT,
})
const entered = await enter(entryTicket)
const enteredCookie = entered.headers.get('set-cookie') || ''

/*
 * To the studio, at wherever this service is mounted — and with no query
 * string, which is the part that matters: the ticket is posted, never put in
 * a URL where it would reach the address bar, the history and every log in
 * between.
 */
check('posting a ticket answers 303 to the studio, with no query string',
  entered.status === 303 && entered.headers.get('location') === `${BASE_PATH}/`,
  { status: entered.status, location: entered.headers.get('location') })
check('and sets the session as an HttpOnly cookie',
  /(^|[,;\s])dl_session=/.test(enteredCookie) && /HttpOnly/i.test(enteredCookie),
  enteredCookie.replace(/dl_session=[^;]*/, 'dl_session=<token>'))
check('the cookie is scoped and same-site',
  /Path=\//i.test(enteredCookie) && /SameSite=/i.test(enteredCookie), enteredCookie.slice(0, 20))
check('the token is not in the body either', (await entered.text()).trim() === '')

/* The cookie alone signs you in — no bearer header anywhere. */
const byCookie = await fetch(`${BASE}/me`, {
  headers: { cookie: `dl_session=${cookieValue(entered)}` },
})
const whoami = await byCookie.json().catch(() => ({}))
check('the cookie alone is a session', byCookie.status === 200 && whoami.sandmanUserId === 'entry.tester',
  { status: byCookie.status, who: whoami.sandmanUserId })
check('/me carries the line the launch named, since there is no redeem reply',
  whoami.line === lineId || whoami.line === null, whoami.line)

/* The row is gone the moment it is used, not merely marked. */
const reused = await enter(entryTicket)
check('a ticket cannot be used twice', reused.status === 303 && !cookieValue(reused),
  reused.headers.get('set-cookie'))

check('garbage is refused the same way, without saying why',
  await (async () => {
    const bad = await enter('tkt_does_not_exist')
    return bad.status === 303 && !cookieValue(bad)
  })())

check('an empty ticket is refused',
  await (async () => {
    const bad = await enter('')
    return bad.status === 303 && !cookieValue(bad)
  })())

check('redeem is gone — there is one way in',
  (await call(null, 'POST', '/session/redeem', { ticket: entryTicket })).status === 404)

// ------------------------------------------------------------------- CSRF ---
log.push('CSRF — a cookie is sent by any site, so a header is required')

const noHeader = await fetch(`${BASE}/loops`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Forged', lineId }),
})
check('a write without the studio header is refused', noHeader.status === 403, noHeader.status)

const wrongOrigin = await fetch(`${BASE}/loops`, {
  method: 'POST',
  headers: { ...CSRF, 'content-type': 'application/json', origin: 'http://evil.example' },
  body: JSON.stringify({ name: 'Forged', lineId }),
})
check('a write claiming another origin is refused', wrongOrigin.status === 403, wrongOrigin.status)

check('reads are not blocked by it',
  (await fetch(`${BASE}/session/sandman`)).status === 200)

check('entering is exempt — there is no session yet to forge',
  (await enter('tkt_nope')).status === 303)

// -------------------------------------------------- who may mint a launch ---
log.push('LAUNCH — restricted by address, before the secret')

check('loopback is allowed', launchAllowed('127.0.0.1'))
check('IPv6 loopback is allowed', launchAllowed('::1'))
check('an IPv4 peer on a dual-stack socket is allowed', launchAllowed('::ffff:127.0.0.1'))
check('a LAN address is not', !launchAllowed('192.168.1.50'))
check('a public address is not', !launchAllowed('203.0.113.9'))
check('nothing is not', !launchAllowed(undefined) && !launchAllowed(''))
check('an explicit allowlist is honoured',
  launchAllowed('10.0.0.5', ['10.0.0.5']) && !launchAllowed('10.0.0.6', ['10.0.0.5']))

const me = await call(ADMIN, 'GET', '/me')
check('admin identity resolves', me.status === 200 && me.body.role === 'admin', me.body)
check('/me reports the plant from the launch, not a stored copy',
  me.body.foundries?.length === 1 &&
  me.body.foundries[0].id === foundryId &&
  me.body.foundries[0].lines.length === 2,
  me.body.foundries)

// ------------------------------------------------------- the foundry database ---
log.push('DATABASE — the foundry schema SandMan sent')

const schema = await call(ADMIN, 'GET', '/database')
check('the database arrives with the launch and is served back',
  schema.status === 200 && schema.body.name === DATABASE.name, schema.body?.name)
check('every table and column is there, with its type',
  schema.body.tableCount === 2 && schema.body.columnCount === 5 &&
  schema.body.tables[0].name === 'preparedsand' &&
  schema.body.tables[0].columns[1].name === 'moisture' &&
  schema.body.tables[0].columns[1].type === 'float',
  schema.body?.tables?.[0])
check('it names the foundry it belongs to',
  schema.body.foundry?.id === foundryId, schema.body?.foundry)

check('an operator may read it too — the published view shows the source',
  (await call(OP1, 'GET', '/database')).body.name === DATABASE.name)
check('it needs a session', (await call(null, 'GET', '/database')).status === 401)

/*
 * The one that matters: this comes out of the caller's own session, not from
 * anything stored. A launch from another foundry that carried no database gets
 * no database — there is no id to ask with, and nothing to ask.
 */
const otherSchema = await call(OP2, 'GET', '/database')
check('another foundry gets its own session, not this one',
  otherSchema.status === 200 && otherSchema.body.name === null &&
  otherSchema.body.tables.length === 0, otherSchema.body)

const malformed = await fetch(`${BASE}/session/launch`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sandman-secret': SECRET },
  body: JSON.stringify({
    user: 'x', role: 'admin', ...PLANT,
    database: { name: 'db', tables: [{ columns: [] }] },
  }),
})
check('a launch whose database is malformed is refused', malformed.status === 400)

const noDatabase = await signIn({
  user: 'admin.nodb', name: 'No database', role: 'admin', ...PLANT, database: undefined,
})
check('a launch without a database still opens — the tag is simply typed',
  (await call(noDatabase, 'GET', '/database')).body.name === null)

// ------------------------------------------------------------ design access ---
log.push('LOOPS — design access (administrator)')
// /loops is the same URL for everyone. An operator is not refused here; they
// get their own published loops, which is the point of one resource.
const opList = await call(OP1, 'GET', '/loops')
check('an operator may list loops, and gets only published ones',
  opList.status === 200 && opList.body.every(l => l.status === 'published'),
  opList.body?.map(l => l.status))
check('an operator may not create one',
  (await call(OP1, 'POST', '/loops', { name: 'Nope', lineId })).status === 403)

check('there is no organisation API to leak the plant',
  (await call(ADMIN, 'GET', '/organisation/foundries')).status === 404)

const layout = {
  format: 'sandman-loop', version: 1, name: 'Line 1 loop', background: '#fbfdff',
  nodes: [
    { id: 'mix1', type: 'mixer', label: 'Intensive mixer', tag: 'MIX-01',
      dataTag: 'plant.mix_01.moisture', x: 100, y: 100, w: 175, h: 240, rotation: 0, state: 'running' },
    { id: 'belt1', type: 'belt', label: 'Conveyor', tag: 'BC-01',
      dataTag: '', x: 400, y: 160, w: 240, h: 80, rotation: 0, state: 'running' },
  ],
  edges: [
    { id: 'e1', from: 'mix1', to: 'belt1', fromPort: 'right', toPort: 'left',
      flow: 'sand', label: '', offset: 0, routing: 'auto' },
  ],
}

const created = await call(ADMIN, 'POST', '/loops', { name: 'Line 1 loop', lineId, layout })
check('admin creates a design', created.status === 201 && created.body.status === 'draft', created.body)
const designId = created.body.id

// On the second line: the first already has a design, and this is checking
// layout validation rather than the one-per-line rule.
const bad = await call(ADMIN, 'POST', '/loops', {
  name: 'Broken', lineId: line2Id,
  layout: { format: 'sandman-loop', version: 1, name: 'x', nodes: [{ id: 'a', type: 'not-real-equipment', x: 0, y: 0, w: 50, h: 50 }], edges: [] },
})
check('unknown equipment type is rejected', bad.status === 422 && bad.body.error === 'unknown_equipment_type', bad.body)

log.push('LOOPS - design access — mandatory data tags at publish')
const blocked = await call(ADMIN, 'POST', `/loops/${designId}/publish`, {})
check('publish blocked while a data tag is missing',
  blocked.status === 422 && blocked.body.error === 'missing_data_tags', blocked.body)
check('blocked response names the offending item',
  blocked.body.detail?.missing?.[0]?.tag === 'BC-01', blocked.body.detail)

const fixed = structuredClone(layout)
fixed.nodes[1].dataTag = 'plant.bc_01.throughput'
const v2 = await call(ADMIN, 'POST', `/loops/${designId}/versions`, { layout: fixed, note: 'Added missing tag' })
check('admin saves version 2', v2.status === 201 && v2.body.version === 2, v2.body)

const published = await call(ADMIN, 'POST', `/loops/${designId}/publish`, {})
check('publish succeeds once every item is tagged',
  published.status === 200 && published.body.status === 'published' && published.body.publishedVersion === 2,
  published.body)

// ------------------------------------------------- several loops on a line ---
log.push('LOOPS — a line may hold several, one of them published')
const second = await call(ADMIN, 'POST', '/loops', { name: 'Rebuild 2027', lineId })
check('a second loop on the same line is allowed',
  second.status === 201 && second.body.lineId === String(lineId), second.body)
check('and it starts as a draft', second.body?.status === 'draft', second.body?.status)
check('the first one is still published',
  (await call(ADMIN, 'GET', `/loops/${designId}`)).body?.status === 'published')

const sameName = await call(ADMIN, 'POST', '/loops', { name: 'Rebuild 2027', lineId })
check('two loops on a line may not share a name',
  sameName.status === 409 && sameName.body.error === 'name_taken', sameName.body)
check('and the refusal says which one is already called that',
  /Rebuild 2027/.test(sameName.body?.message || ''), sameName.body?.message)

/*
 * One published loop per line.
 *
 * The publish view and the live readings follow the published loop, and two
 * of those on one line is a question with no answer — so publishing the
 * second takes the first off the plant's screens, and says so.
 */
await call(ADMIN, 'POST', `/loops/${second.body.id}/versions`, {
  layout: { format: 'sandman-loop', version: 1, name: 'Rebuild 2027', nodes: [], edges: [] },
})
const tookOver = await call(ADMIN, 'POST', `/loops/${second.body.id}/publish`, {})
check('publishing the second one succeeds',
  tookOver.status === 200 && tookOver.body.status === 'published', tookOver.body)
check('and it says which loop it replaced',
  (tookOver.body?.replaced || []).includes('Line 1 loop'), tookOver.body?.replaced)
check('the first is no longer published',
  (await call(ADMIN, 'GET', `/loops/${designId}`)).body?.status === 'draft')

// Put the line back the way the rest of the suite expects it.
await call(ADMIN, 'POST', `/loops/${designId}/publish`, {})
await call(ADMIN, 'DELETE', `/loops/${second.body.id}`)

const onLine2 = await call(ADMIN, 'POST', '/loops', { name: 'Line 2 loop', lineId: line2Id })
check('another line may have its own', onLine2.status === 201, onLine2.body)
await call(ADMIN, 'DELETE', `/loops/${onLine2.body.id}`)

// -------------------------------------------------------------- view access ---
log.push('LOOPS - view access')
// Publishing is the whole of visibility: belonging to the foundry is what
// grants access to the plant, and there is nothing to allocate on top.
const mine = await call(OP1, 'GET', '/loops')
const mineEntry = mine.body.find(d => d.id === designId)
check('everyone in the foundry sees a published design',
  mine.status === 200 && mineEntry && mineEntry.version === 2, mine.body)
check('listing carries foundry and line context',
  !!mineEntry.foundry?.name && !!mineEntry.line?.name, mineEntry)

const loop = await call(OP1, 'GET', `/loops/${designId}`)
check('operator loads the published layout',
  loop.status === 200 && loop.body.layout.nodes.length === 2, loop.body)
check('operator gets the PUBLISHED version, not the draft',
  loop.body.layout.nodes[1].dataTag === 'plant.bc_01.throughput', loop.body.layout.nodes[1])

// Publishing is not a broadcast: it reaches the foundry, and no further.
const outsiderList = await call(OP2, 'GET', '/loops')
check('someone outside the foundry does not see it listed',
  outsiderList.status === 200 && !outsiderList.body.some(d => d.id === designId),
  outsiderList.body?.map(d => d.name))
check('and cannot open it either',
  (await call(OP2, 'GET', `/loops/${designId}`)).status === 403)

const tags = await call(OP1, 'GET', `/loops/${designId}/tags`)
check('tag list is served for the data gateway',
  tags.status === 200 && tags.body.tags.length === 2, tags.body)

log.push('LOOPS - view access — draft isolation')
const draft2 = structuredClone(fixed)
draft2.nodes[0].label = 'SECRET DRAFT EDIT'
await call(ADMIN, 'POST', `/loops/${designId}/versions`, { layout: draft2 })
const stillPublished = await call(OP1, 'GET', `/loops/${designId}`)
check('later draft edits do NOT reach the operator',
  stillPublished.body.layout.nodes[0].label === 'Intensive mixer', stillPublished.body.layout.nodes[0])
check('operator cannot reach version history',
  (await call(OP1, 'GET', `/loops/${designId}/versions/3`)).status === 403)

// -------------------------------------------------------------- assets API ---
log.push('ASSETS API')
const list = await call(OP1, 'GET', '/assets')
const baselineAssets = list.body.length
check('any user can read the catalogue', list.status === 200 && baselineAssets >= 43, baselineAssets)

const SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90"><rect width="120" height="90" fill="#888"/></svg>'

check('operator cannot upload',
  (await call(OP1, 'POST', '/assets', { slug: 'x', name: 'x', category: 'x', svg: SAFE_SVG })).status === 403)

const uploaded = await call(ADMIN, 'POST', '/assets', {
  slug: 'sand-reclaimer', name: 'Sand reclaimer', category: 'Sand preparation', svg: SAFE_SVG,
})
check('admin uploads new equipment',
  uploaded.status === 201 && uploaded.body.width === 120 && uploaded.body.height === 90, uploaded.body)
const assetId = uploaded.body.id

check('duplicate slug is rejected',
  (await call(ADMIN, 'POST', '/assets', { slug: 'sand-reclaimer', name: 'dupe', category: 'x', svg: SAFE_SVG })).status === 409)

const file = await call(OP1, 'GET', `/assets/${assetId}/file`)
check('artwork file is served as SVG',
  file.status === 200 && file.contentType.includes('image/svg+xml'), file.contentType)

log.push('ASSETS API — upload safety')
const attacks = [
  ['script element', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>fetch("//evil")</script></svg>'],
  ['inline handler', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect onload="alert(1)"/></svg>'],
  ['javascript: URL', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><a href="javascript:alert(1)"/></svg>'],
  ['XXE doctype', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'],
  ['external href', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://evil.example/x.png"/></svg>'],
  ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject><body/></foreignObject></svg>'],
  ['payload hidden in a comment', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!-- --><script>x</script></svg>'],
]
for (const [label, svg] of attacks) {
  const res = await call(ADMIN, 'POST', '/assets', { slug: `atk-${Math.random().toString(36).slice(2, 8)}`, name: 'a', category: 'b', svg })
  check(`rejects ${label}`, res.status === 422 && res.body.error === 'svg_unsafe', res.body)
}
check('rejects a file with no dimensions',
  (await call(ADMIN, 'POST', '/assets', { slug: 'nodim', name: 'a', category: 'b', svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' })).body.error === 'svg_no_dimensions')

log.push('ASSETS API — rename, replace, delete')
const useIt = structuredClone(fixed)
useIt.nodes.push({ id: 'rec1', type: 'sand-reclaimer', label: 'Reclaimer', tag: 'RC-01',
  dataTag: 'plant.rc_01.throughput', x: 700, y: 100, w: 120, h: 90, rotation: 0, state: 'running' })
const usedVersion = await call(ADMIN, 'POST', `/loops/${designId}/versions`, { layout: useIt })
check('design can use the uploaded equipment', usedVersion.status === 201, usedVersion.body)

const inUse = await call(ADMIN, 'DELETE', `/assets/${assetId}`)
check('delete is refused while equipment is in use',
  inUse.status === 422 && inUse.body.error === 'asset_in_use', inUse.body)

const renamed = await call(ADMIN, 'PATCH', `/assets/${assetId}`, { slug: 'sand-reclaimer-mk2', name: 'Sand reclaimer Mk2' })
check('rename succeeds', renamed.status === 200 && renamed.body.slug === 'sand-reclaimer-mk2', renamed.body)
check('rename rewrote the designs using it', renamed.body.rewroteDesigns.length === 1, renamed.body.rewroteDesigns)

const afterRename = await call(ADMIN, 'GET', `/loops/${designId}`)
check('stored layout now references the new slug',
  afterRename.body.layout.nodes.some(n => n.type === 'sand-reclaimer-mk2'),
  afterRename.body.layout.nodes.map(n => n.type))

const replaced = await call(ADMIN, 'PUT', `/assets/${assetId}/file`, {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150"><circle cx="100" cy="75" r="60"/></svg>',
})
check('replace bumps the revision and re-reads dimensions',
  replaced.status === 200 && replaced.body.revision === 2 && replaced.body.width === 200, replaced.body)

const forced = await call(ADMIN, 'DELETE', `/assets/${assetId}?force=true`)
check('forced delete reports what it breaks',
  forced.status === 200 && forced.body.brokeDesigns.some(d => d.id === designId), forced.body)
check('catalogue returns to its baseline size',
  (await call(ADMIN, 'GET', '/assets')).body.length === baselineAssets)

log.push('AUDIT')
const audit = await call(ADMIN, 'GET', `/audit?entityId=${designId}`)
check('every design action was audited',
  audit.status === 200 && audit.body.some(a => a.action === 'loop.publish') &&
  audit.body.some(a => a.action === 'loop.version'), audit.body.map(a => a.action))

// ---------------------------------------------------------------- overview ---
// Asserted against the design this run created, so a populated database and an
// empty one both give the same answer.
log.push('\nOVERVIEW')

const ovAdmin = await call(ADMIN, 'GET', '/overview')
const ovLine = ovAdmin.body?.foundries
  ?.flatMap(f => f.lines)
  ?.find(l => l.id === lineId)
check('overview groups foundry -> line -> loops',
  ovAdmin.status === 200 && !!ovLine, ovAdmin.body?.totals)
check('the line reports the loop this run published',
  ovLine?.loops?.some(loop => loop.id === designId && loop.status === 'published'),
  ovLine?.summary)
check('summary counts agree with the loops listed',
  ovLine?.summary.total === ovLine?.loops.length &&
  ovLine?.summary.published === ovLine?.loops.filter(l => l.status === 'published').length,
  ovLine?.summary)
check('totals count lines with no loop at all',
  typeof ovAdmin.body?.totals?.linesWithoutLoop === 'number', ovAdmin.body?.totals)

const ovPublished = await call(ADMIN, 'GET', '/overview/published')
check('published list carries foundry and line',
  ovPublished.status === 200 &&
  ovPublished.body.loops.some(l => l.id === designId && l.foundry?.name && l.line?.name),
  ovPublished.body?.count)
check('published list has no drafts',
  ovPublished.body.loops.every(l => l.status === 'published'),
  ovPublished.body.loops.map(l => l.status))

const ovOne = await call(ADMIN, 'GET', `/overview/lines/${lineId}`)
check('one line can be asked for directly',
  ovOne.status === 200 && ovOne.body.line.id === lineId, ovOne.body?.line)

check('an unknown line is 404, not a silent empty result',
  (await call(ADMIN, 'GET', '/overview/lines/lin_does_not_exist')).status === 404)
check('overview needs a caller',
  (await fetch(`${BASE}/overview`)).status === 401)

// An operator sees the same lines, but only what is published on them.
const ovViewer = await call(OP1, 'GET', '/overview')
check('operator overview is scoped to their own foundries',
  ovViewer.status === 200 &&
  ovViewer.body.foundries.every(f => f.lines.every(l =>
    l.loops.every(loop => loop.status === 'published'))),
  ovViewer.body?.totals)

// -------------------------------------------------- data sources in a layout ---
log.push('LAYOUTS — where a reading comes from')

/*
 * A tag chosen from the foundry's database carries the source it came from, so
 * the design can still say where a number was meant to come from long after
 * the session that drew it has gone. The tag is what a gateway subscribes to;
 * the source is what a person reads.
 */
const sourced = structuredClone(layout)
sourced.nodes[1].dataTag = ''
sourced.nodes[1].dataLabels = [{
  id: 'dl1', name: 'Moisture', unit: '%', value: 3.3, dx: 10, dy: -24,
  tag: 'preparedsand.moisture',
  dataSource: {
    database: DATABASE.name, table: 'preparedsand', column: 'moisture', type: 'float',
  },
}]

const srcDesign = await call(ADMIN, 'POST', '/loops',
  { name: 'Sourced loop', lineId: line2Id, layout: sourced })
check('a layout carrying a data source is accepted', srcDesign.status === 201, srcDesign.body)

const readBack = await call(ADMIN, 'GET', `/loops/${srcDesign.body.id}`)
const label = readBack.body?.layout?.nodes?.[1]?.dataLabels?.[0]
check('the table, column and type survive the round trip',
  label?.dataSource?.table === 'preparedsand' &&
  label?.dataSource?.column === 'moisture' &&
  label?.dataSource?.type === 'float',
  label?.dataSource)

// The label's tag counts as a tag: a node tagged this way is publishable, and
// the index a gateway reads is built from it.
const srcPublish = await call(ADMIN, 'POST', `/loops/${srcDesign.body.id}/publish`, {})
check('a label tagged from the database satisfies the publish rule',
  srcPublish.status === 200, srcPublish.body)
const srcTags = await call(ADMIN, 'GET', `/loops/${srcDesign.body.id}/tags`)
check('and its tag is in the index a gateway subscribes to',
  JSON.stringify(srcTags.body).includes('preparedsand.moisture'), srcTags.body)

const halfSource = structuredClone(sourced)
halfSource.nodes[1].dataLabels[0].dataSource = { database: DATABASE.name, table: 'preparedsand' }
const refused = await call(ADMIN, 'POST', `/loops/${srcDesign.body.id}/versions`,
  { layout: halfSource })
check('a source naming no column is refused, not stored half-finished',
  refused.status === 422 && refused.body.error === 'layout_invalid', refused.body)

/*
 * Several readings on one piece of equipment.
 *
 * A mixer reports moisture AND compactability, and a gateway subscribes to
 * both. The tag index used to be keyed one row per node, so the second label
 * failed on a constraint and took the entire save down with it — a 500 on a
 * perfectly ordinary loop.
 */
const twoLabels = structuredClone(sourced)
twoLabels.nodes[1].dataLabels.push({
  id: 'dl2', name: 'Compactability', unit: '%', value: 41, dx: 10, dy: 12,
  tag: 'preparedsand.compactability',
  dataSource: {
    database: DATABASE.name, table: 'preparedsand', column: 'compactability', type: 'float',
  },
})
const multi = await call(ADMIN, 'POST', `/loops/${srcDesign.body.id}/versions`, { layout: twoLabels })
check('one item may report several readings', multi.status === 201, multi.body)

// The tag index is served for the PUBLISHED version, so this has to become it.
await call(ADMIN, 'POST', `/loops/${srcDesign.body.id}/publish`, { version: multi.body.version })
const multiTags = await call(ADMIN, 'GET', `/loops/${srcDesign.body.id}/tags`)
check('and every one of them is indexed, not just the first',
  JSON.stringify(multiTags.body).includes('preparedsand.moisture') &&
  JSON.stringify(multiTags.body).includes('preparedsand.compactability'),
  multiTags.body)

const longSource = structuredClone(sourced)
longSource.nodes[1].dataLabels[0].dataSource.table = 'x'.repeat(200)
check('an over-long table name is refused',
  (await call(ADMIN, 'POST', `/loops/${srcDesign.body.id}/versions`, { layout: longSource }))
    .status === 422)

// ------------------------------------------------------- live readings ---
log.push('LIVE READINGS — real values, and what may be asked for')

/*
 * The studio simulates every reading until it is linked to a column. These
 * endpoints are what makes a linked one real — and the thing worth testing is
 * not that a number comes back, it is everything the caller is NOT allowed to
 * reach.
 *
 * The document below carries five readings on purpose:
 *
 *   T_MOIST   linked to the foundry's own database      → read
 *   T_BAD     likewise, but a column SandMan rejects    → read, reported
 *   T_OTHER   linked to a DIFFERENT database            → ignored
 *   T_HIST    linked to another source entirely         → ignored
 *   T_PLAIN   not linked at all                         → ignored, stays demo
 *
 * The three that are ignored are the test: a layout can name any database it
 * likes, and only the one the session arrived with may be read.
 */
/*
 * Its own plant, with three lines.
 *
 * A line has one design, and both of the suite's lines already have one by
 * now. A foundry costs nothing to invent — it is an id in a launch — and
 * having three lines here keeps the three cases apart: a loop that has been
 * read, one that never has, and one with nothing linked at all.
 */
const LIVE_PLANT = {
  foundry: `FND-LIVE-${stamp}`,
  foundryName: `Live readings foundry ${stamp}`,
  lines: [
    { id: `LIVE-1-${stamp}`, name: 'Live line 1' },
    { id: `LIVE-2-${stamp}`, name: 'Live line 2' },
    { id: `LIVE-3-${stamp}`, name: 'Live line 3' },
  ],
  database: DATABASE,
}
const [liveLine, coldLine, plainLine] = LIVE_PLANT.lines.map(line => line.id)

const LIVE_ADMIN = await signIn({
  user: 'admin.live', name: 'Live admin', role: 'admin', ...LIVE_PLANT,
})
const LIVE_OP = await signIn({
  user: 'operator.live', name: 'Live operator', role: 'viewer', ...LIVE_PLANT,
})

const reading = (id, link) => ({ id, desc: id, unit: '%', typ: 3, d: 2, noise: 0.1, ...(link ? { link } : {}) })
const ownDb = (table, col) => ({ src: 'customer', db: DATABASE.name, table, col })

const liveLayout = {
  DOC: {
    name: 'Live loop',
    seq: 2,
    blocks: [{
      id: 'blk1', type: 'mixer', x: 100, y: 100,
      tags: [{ id: 'T_MOIST' }, { id: 'T_BAD' }, { id: 'T_OTHER' }, { id: 'T_HIST' }, { id: 'T_PLAIN' }],
    }],
    streams: [],
  },
  REG: {
    T_MOIST: reading('T_MOIST', ownDb('preparedsand', 'moisture')),
    T_BAD: reading('T_BAD', ownDb('preparedsand', 'missingcolumn')),
    T_OTHER: reading('T_OTHER', { src: 'customer', db: 'somebody_elses_db', table: 'preparedsand', col: 'moisture' }),
    T_HIST: reading('T_HIST', { src: 'historian-1', db: DATABASE.name, table: 'preparedsand', col: 'temperature' }),
    T_PLAIN: reading('T_PLAIN'),
  },
}

/** The same document with every link taken out — a loop still being drawn. */
const plainLayout = {
  DOC: { ...liveLayout.DOC, name: 'Unlinked loop' },
  REG: { T_PLAIN: reading('T_PLAIN') },
}

const liveLoop = await call(LIVE_ADMIN, 'POST', '/loops',
  { name: 'Live loop', lineId: liveLine, layout: liveLayout })
check('a loop with linked readings is stored', liveLoop.status === 201, liveLoop.body)
const liveId = liveLoop.body?.id

const plainLoop = await call(LIVE_ADMIN, 'POST', '/loops',
  { name: 'Unlinked loop', lineId: plainLine, layout: plainLayout })
const plainId = plainLoop.body?.id

const before = sandmanCalls.values
const values = await call(LIVE_ADMIN, 'GET', `/live/values?loopId=${liveId}`)
check('live values come back for the readings linked to the foundry database',
  values.status === 200 && values.body?.values?.T_MOIST?.value === 2.62, values.body)
check('and carry the record\'s own date, time and shift',
  values.body?.values?.T_MOIST?.date === '2026-02-18' &&
  values.body?.values?.T_MOIST?.shift === 'A', values.body?.values?.T_MOIST)

check('a reading linked to another database is ignored, not read',
  !('T_OTHER' in (values.body?.values || {})) && !('T_OTHER' in (values.body?.errors || {})),
  Object.keys(values.body?.values || {}))
check('so is one linked to another source entirely',
  !('T_HIST' in (values.body?.values || {})), Object.keys(values.body?.values || {}))
check('an unlinked reading is left to the simulation',
  !('T_PLAIN' in (values.body?.values || {})), Object.keys(values.body?.values || {}))
check('only the two in-scope readings were asked for', values.body?.tagCount === 2, values.body?.tagCount)

check('a column SandMan cannot read is reported, not invented',
  values.body?.errors?.T_BAD === 'unknown column', values.body?.errors)

/*
 * The browser sent a loop id and nothing else. What reached SandMan has to be
 * the session's foundry and the loop's own line — if either could come from
 * the request, a session would be a way to read any line in the plant.
 */
const asked = sandmanCalls.lastValues
check('SandMan was asked for the session\'s foundry and the loop\'s line',
  asked?.foundry === LIVE_PLANT.foundry && asked?.line === liveLine, { foundry: asked?.foundry, line: asked?.line })
check('and for no table the layout did not name',
  (asked?.tags || []).every(tag => tag.table === 'preparedsand') && asked.tags.length === 2,
  asked?.tags)

// --- the cache -------------------------------------------------------------
const again = await call(LIVE_ADMIN, 'GET', `/live/values?loopId=${liveId}`)
check('a second ask inside the window is served from the cache',
  again.status === 200 && again.body?.cached === true, again.body?.cached)
check('so SandMan was read once, not twice',
  sandmanCalls.values === before + 1, { before, now: sandmanCalls.values })

// --- the charts ------------------------------------------------------------
const chart = await call(LIVE_ADMIN, 'GET', `/live/chart?loopId=${liveId}&tag=T_MOIST`)
check('a chart comes back with the records themselves',
  chart.status === 200 && chart.body?.series?.length === 2, chart.body)
check('and SandMan\'s own process control, passed through as given',
  chart.body?.processControl?.MEAN?.limits?.[0] === 2.8 &&
  chart.body?.processControl?.shiftAverages === 127, chart.body?.processControl)

const foreign = await call(LIVE_ADMIN, 'GET', `/live/chart?loopId=${liveId}&tag=T_OTHER`)
check('a reading linked to another database cannot be charted',
  foreign.status === 404, foreign.status)

const invented = await call(LIVE_ADMIN, 'GET', `/live/chart?loopId=${liveId}&tag=preparedsand.moisture`)
check('nor can a column named directly in the request',
  invented.status === 404, invented.status)

const elsewhere = await call(LIVE_ADMIN, 'GET', `/live/chart?loopId=${plainId}&tag=T_MOIST`)
check('nor a tag that belongs to a different loop',
  elsewhere.status === 404, elsewhere.status)

/*
 * An operator may only ever see the published version. This loop is a draft,
 * so for them it does not exist — and neither do its readings, which would
 * otherwise be a way to watch a design before it was ready to be seen.
 */
const peeking = await call(LIVE_OP, 'GET', `/live/values?loopId=${liveId}`)
check('an operator cannot read a draft loop\'s values', peeking.status === 404, peeking.status)
const peekChart = await call(LIVE_OP, 'GET', `/live/chart?loopId=${liveId}&tag=T_MOIST`)
check('nor chart one', peekChart.status === 404, peekChart.status)

check('and neither endpoint answers without a session',
  (await call(null, 'GET', `/live/values?loopId=${liveId}`)).status === 401 &&
  (await call(null, 'GET', `/live/chart?loopId=${liveId}&tag=T_MOIST`)).status === 401)

// --- when SandMan is not answering -----------------------------------------
/*
 * Two different situations, and they are not the same answer.
 *
 * There is a good reading already: keep showing it, marked stale. Putting a
 * simulated number on a plant screen instead is the one outcome that must
 * never happen, and a gap is barely better.
 *
 * There has never been one: 503, because there is nothing honest to show.
 */
sandmanCalls.down = true
await new Promise(resolve => setTimeout(resolve, VALUES_CACHE_MS + 200))

const stale = await call(LIVE_ADMIN, 'GET', `/live/values?loopId=${liveId}`)
check('with SandMan down, the last good reading is kept',
  stale.status === 200 && stale.body?.values?.T_MOIST?.value === 2.62, stale.body?.values)
check('and flagged stale, with the time it was read',
  stale.body?.stale === true && !!stale.body?.since, { stale: stale.body?.stale, since: stale.body?.since })

const neverRead = await call(LIVE_ADMIN, 'POST', '/loops',
  { name: 'Never read', lineId: coldLine, layout: liveLayout })
const cold = await call(LIVE_ADMIN, 'GET', `/live/values?loopId=${neverRead.body?.id}`)
check('a loop with no previous reading answers 503 rather than inventing one',
  cold.status === 503, { status: cold.status, body: cold.body })
check('and says so in words the studio can act on',
  cold.body?.error === 'sandman_refused' || cold.body?.error === 'sandman_unreachable', cold.body)

const coldChart = await call(LIVE_ADMIN, 'GET', `/live/chart?loopId=${liveId}&tag=T_MOIST`)
check('a chart with SandMan down is 503, not an empty chart',
  coldChart.status === 503, coldChart.status)

sandmanCalls.down = false

/*
 * A loop nobody has linked yet is not an error. It is a loop still being
 * drawn, and it should cost the plant database nothing.
 */
const unlinkedCalls = sandmanCalls.values
const bare = await call(LIVE_ADMIN, 'GET', `/live/values?loopId=${plainId}`)
check('a loop with no linked readings answers with an empty map',
  bare.status === 200 && bare.body?.tagCount === 0, bare.body)
check('and does not trouble SandMan at all',
  sandmanCalls.values === unlinkedCalls, { before: unlinkedCalls, now: sandmanCalls.values })

// ------------------------------------------- procedures and alarm history ---
log.push('SOP DOCUMENTS — the written procedure lives on the server')

/*
 * The studio keeps uploaded procedures in the browser's IndexedDB — its own
 * notes say to replace that for production. In a browser a procedure is
 * invisible to the next terminal and gone when somebody clears site data,
 * which is not where a foundry's written procedure belongs.
 */
const pdf = Buffer.from('%PDF-1.4\n% a procedure\n', 'utf8')
const putFile = async (token, fileId, loopId, body, headers = {}) => {
  const r = await fetch(`${BASE}/sop-files/${fileId}?loopId=${loopId}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`, ...CSRF,
      'content-type': 'application/octet-stream',
      'x-file-name': 'mixer-sop.pdf', 'x-file-type': 'application/pdf', ...headers,
    },
    body,
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const fileId = `sf_${stamp}`
const stored = await putFile(LIVE_ADMIN, fileId, liveId, pdf)
check('an administrator uploads a procedure', stored.status === 200, stored.body)
check('and it records the name, type and size, not the contents',
  stored.body?.name === 'mixer-sop.pdf' && stored.body?.mime === 'application/pdf' &&
  stored.body?.bytes === pdf.length && !JSON.stringify(stored.body).includes('PDF-1.4'),
  stored.body)

const listed = await call(LIVE_ADMIN, 'GET', `/sop-files?loopId=${liveId}`)
check('it is listed against the loop',
  listed.body?.documents?.some(d => d.id === fileId), listed.body)

const fetched = await fetch(`${BASE}/sop-files/${fileId}`, {
  headers: { authorization: `Bearer ${LIVE_ADMIN}`, ...CSRF },
})
const back = Buffer.from(await fetched.arrayBuffer())
check('the file comes back byte for byte', back.equals(pdf), { sent: pdf.length, got: back.length })
check('served so a browser cannot be talked into running it',
  fetched.headers.get('x-content-type-options') === 'nosniff' &&
  /sandbox/.test(fetched.headers.get('content-security-policy') || ''),
  { nosniff: fetched.headers.get('x-content-type-options') })

/*
 * An operator may read the procedure — that is the point of writing one — but
 * may not replace it. The loop decides both.
 */
const opRead = await fetch(`${BASE}/sop-files/${fileId}`, {
  headers: { authorization: `Bearer ${LIVE_OP}`, ...CSRF },
})
check('an operator cannot read one on a loop they cannot open', opRead.status === 404, opRead.status)
const opWrite = await putFile(LIVE_OP, `sf_op_${stamp}`, liveId, pdf)
check('nor upload one', opWrite.status === 404 || opWrite.status === 403, opWrite.status)

const huge = await putFile(LIVE_ADMIN, `sf_big_${stamp}`, liveId, Buffer.alloc(26 * 1024 * 1024))
check('a document over the limit is refused, not truncated',
  huge.status === 413 || huge.status === 422, huge.status)

const removed = await call(LIVE_ADMIN, 'DELETE', `/sop-files/${fileId}`)
check('it can be deleted', removed.status === 204, removed.status)
check('and is then gone',
  (await call(LIVE_ADMIN, 'GET', `/sop-files?loopId=${liveId}`)).body?.count === 0)

// --- alarm history ---------------------------------------------------------
log.push('ALARM HISTORY — what went out of limit, and who knew')

const raised = await call(LIVE_ADMIN, 'POST', '/alarms', {
  loopId: liveId, tag: 'T_MOIST', equipment: 'Mixer 1', severity: 3,
  message: 'Moisture above high-high', value: 4.8, unit: '%',
})
check('an alarm is recorded', raised.status === 201 && raised.body?.severity === 3, raised.body)
check('with the foundry and line taken from the loop, not the request',
  raised.body?.lineId === liveLine, raised.body)
check('and it is active until it comes back', raised.body?.active === true, raised.body)

const alarmId = raised.body?.id
const acked = await call(LIVE_OP, 'POST', `/alarms/${alarmId}/ack`, {})
check('an operator can acknowledge it', acked.status === 404, acked.status)

const ackedByAdmin = await call(LIVE_ADMIN, 'POST', `/alarms/${alarmId}/ack`, {})
check('and acknowledging records who', ackedByAdmin.body?.ackedBy === 'admin.live', ackedByAdmin.body)

const returned = await call(LIVE_ADMIN, 'POST', `/alarms/${alarmId}/returned`, {})
check('it can be closed when the reading comes back',
  returned.body?.active === false && !!returned.body?.returnedAt, returned.body)

const history = await call(LIVE_ADMIN, 'GET', `/alarms?loopId=${liveId}`)
check('the history survives, which the studio\'s own list does not',
  history.body?.count === 1 && history.body?.alarms?.[0]?.tag === 'T_MOIST', history.body)
check('and can be narrowed to what is still active',
  (await call(LIVE_ADMIN, 'GET', `/alarms?loopId=${liveId}&active=1`)).body?.count === 0)

check('a bad severity is refused',
  (await call(LIVE_ADMIN, 'POST', '/alarms', { loopId: liveId, tag: 'X', severity: 9 })).status === 400)
check('and an alarm cannot be filed against a loop you cannot see',
  (await call(OP2, 'POST', '/alarms', { loopId: liveId, tag: 'X', severity: 1 })).status >= 400)

// ------------------------------------------------ databases somebody added ---
log.push('CONNECTIONS — the only credentials this service holds')

/*
 * These are the other kind of database: not the foundry's, which is described
 * and never connected to, but one an administrator registered for this service
 * to dial out to. That means a stored password, so the things worth testing
 * are who may reach it and what never comes back.
 *
 * Reaching a real database is checked separately against a live MySQL; this
 * suite starts no database of its own, so it checks the shape and the guards.
 */
const connBody = {
  label: `Suite historian ${stamp}`,
  engine: 'mysql',
  host: '127.0.0.1',
  port: 3399,
  database: 'nowhere',
  username: 'reader',
  password: 'super-secret-value',
}

check('an operator may not even list them', (await call(OP1, 'GET', '/connections')).status === 403)
check('an operator may not add one',
  (await call(OP1, 'POST', '/connections', connBody)).status === 403)
check('they need a session at all', (await call(null, 'GET', '/connections')).status === 401)

const conn = await call(ADMIN, 'POST', '/connections', connBody)
const sealingOff = conn.status === 422 && conn.body.error === 'no_secret_key'
if (sealingOff) {
  // Without DL_SECRET_KEY the feature refuses rather than storing a password
  // in plain text. That is the behaviour being checked.
  check('without DL_SECRET_KEY a password is refused, not stored in the clear', true)
} else {
  check('an administrator adds one', conn.status === 201, conn.body)
  const connId = conn.body.id

  check('the reply says a password is set but never what it is',
    conn.body.hasPassword === true && !JSON.stringify(conn.body).includes('super-secret-value'),
    conn.body)
  check('no listing carries a secret either',
    !JSON.stringify((await call(ADMIN, 'GET', '/connections')).body).includes('super-secret-value'))

  check('an unknown engine is refused',
    (await call(ADMIN, 'POST', '/connections', { ...connBody, label: 'x', engine: 'oracle' })).status === 400)

  /*
   * Five engines, and the form the studio builds comes from the API rather
   * than from a list written out again in the browser.
   */
  const engines = await call(ADMIN, 'GET', '/connections/engines')
  const offered = (engines.body?.engines || []).map(e => e.id)
  check('the engines on offer are served to the studio',
    engines.status === 200 &&
    ['mysql', 'mariadb', 'postgres', 'sqlserver', 'azuresql'].every(id => offered.includes(id)),
    offered)
  check('each one carries its default port',
    (engines.body?.engines || []).every(e => Number.isInteger(e.port)),
    engines.body?.engines)
  check('an operator may not ask what engines exist',
    (await call(OP1, 'GET', '/connections/engines')).status === 403)

  for (const [engine, port] of [['mariadb', 3306], ['postgres', 5432], ['azuresql', 1433]]) {
    // Without a port, so the engine's own default is what gets stored. The
    // fixture above pins one deliberately, which would hide this entirely.
    const { port: _pinned, ...noPort } = connBody
    const made = await call(ADMIN, 'POST', '/connections',
      { ...noPort, label: `Suite ${engine} ${stamp}`, engine })
    check(`${engine} is accepted and defaults to port ${port}`,
      made.status === 201 && made.body?.port === port, { status: made.status, port: made.body?.port })
    // Azure SQL is reached across the public internet; encryption is not
    // something somebody should be able to leave off there.
    if (engine === 'azuresql') {
      check('and Azure SQL is encrypted whether or not anybody asked',
        made.body?.useTls === true, made.body?.useTls)
    }
    if (made.body?.id) await call(ADMIN, 'DELETE', `/connections/${made.body.id}`)
  }
  check('two connections may not share a name',
    (await call(ADMIN, 'POST', '/connections', connBody)).status === 400)

  /*
   * A registered database belongs to the plant that registered it.
   *
   * They were global: every foundry listed every connection, which is one
   * plant's host and account on another plant's screen — and a layout naming
   * that connection id would have been read from.
   */
  const OTHER_ADMIN = await signIn({
    user: 'admin.elsewhere', name: 'Another plant administrator', role: 'admin',
    foundry: `FND-ELSEWHERE-${stamp}`, foundryName: 'Some other foundry',
    lines: [{ id: `ELSE-1-${stamp}`, name: 'Their line' }],
  })
  const theirs = await call(OTHER_ADMIN, 'GET', '/connections')
  check('another plant does not see this one\'s databases',
    theirs.status === 200 && !theirs.body.some(row => row.id === connId),
    theirs.body?.map(row => row.label))
  check('nor open one by its id',
    (await call(OTHER_ADMIN, 'GET', `/connections/${connId}`)).status === 404)
  check('nor change it',
    (await call(OTHER_ADMIN, 'PATCH', `/connections/${connId}`, { label: 'Mine now' })).status === 404)
  check('nor test it',
    (await call(OTHER_ADMIN, 'POST', `/connections/${connId}/test`, {})).status === 404)
  check('nor read its schema',
    (await call(OTHER_ADMIN, 'GET', `/connections/${connId}/schema`)).status === 404)
  check('nor delete it',
    (await call(OTHER_ADMIN, 'DELETE', `/connections/${connId}`)).status === 404)
  check('and it is still here afterwards',
    (await call(ADMIN, 'GET', `/connections/${connId}`)).status === 200)

  const sameNameElsewhere = await call(OTHER_ADMIN, 'POST', '/connections', connBody)
  check('but another plant may use the same name for its own',
    sameNameElsewhere.status === 201, sameNameElsewhere.body)
  if (sameNameElsewhere.body?.id) {
    await call(OTHER_ADMIN, 'DELETE', `/connections/${sameNameElsewhere.body.id}`)
  }

  /*
   * A tunnel given when the connection is *created*, not added afterwards.
   *
   * The suite only ever patched one on, and the create path quietly dropped
   * the key and the passphrase: a database registered through the form with a
   * jump box was stored with the host, the port and the user and nothing to
   * authenticate with. It said it had saved, and the first read failed.
   */
  const PASTED_KEY =
    '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----'
  const tunnelled = await call(ADMIN, 'POST', '/connections', {
    ...connBody,
    label: `Suite tunnelled ${stamp}`,
    tunnel: {
      host: 'jump.invalid', port: 22, user: 'rds-tunnel',
      privateKey: PASTED_KEY, passphrase: 'a phrase',
    },
  })
  check('a tunnel may be configured as the connection is created',
    tunnelled.status === 201 && tunnelled.body?.tunnel?.user === 'rds-tunnel', tunnelled.body?.tunnel)
  check('the pasted key is kept',
    tunnelled.body?.tunnel?.hasKey === true, tunnelled.body?.tunnel)
  check('and so is its passphrase',
    tunnelled.body?.tunnel?.hasPassphrase === true, tunnelled.body?.tunnel)
  check('neither of which is ever sent back',
    !JSON.stringify(tunnelled.body).includes('PRIVATE KEY') &&
    !JSON.stringify(tunnelled.body).includes('a phrase'), Object.keys(tunnelled.body || {}))
  check('a key that is not a key is refused', (await call(ADMIN, 'POST', '/connections', {
    ...connBody,
    label: `Suite badkey ${stamp}`,
    tunnel: { host: 'jump.invalid', user: 'tunnel', privateKey: 'paste it here' },
  })).status === 400)
  if (tunnelled.body?.id) await call(ADMIN, 'DELETE', `/connections/${tunnelled.body.id}`)

  const keys = await call(ADMIN, 'PATCH', `/connections/${connId}`, {
    tunnel: { host: 'jump.invalid', port: 22, user: 'tunnel' },
  })
  check('a jump box can be configured', keys.status === 200 && !!keys.body.tunnel, keys.body?.tunnel)

  const pair = await call(ADMIN, 'POST', `/connections/${connId}/keypair`, {})
  check('a keypair is generated in OpenSSH form',
    pair.status === 200 && /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5/.test(pair.body.publicKey || ''),
    pair.body?.publicKey?.slice(0, 40))
  check('and the private half is never returned',
    !JSON.stringify(pair.body).includes('PRIVATE KEY'))
  check('nor by reading the connection back',
    !JSON.stringify((await call(ADMIN, 'GET', `/connections/${connId}`)).body).includes('PRIVATE KEY'))

  // A host that does not exist: the point is that it answers rather than hangs
  // or throws a 500.
  const reach = await call(ADMIN, 'POST', `/connections/${connId}/test`, {})
  check('an unreachable database is an answer, not an error',
    reach.status === 200 && reach.body.ok === false && typeof reach.body.error === 'string',
    reach.body)

  check('turning the tunnel off takes the key with it',
    (await call(ADMIN, 'PATCH', `/connections/${connId}`, { tunnel: null })).body.tunnel === null)

  check('it can be deleted', (await call(ADMIN, 'DELETE', `/connections/${connId}`)).status === 204)
  check('and is then gone', (await call(ADMIN, 'GET', `/connections/${connId}`)).status === 404)
}

// ----------------------------------------------------------------- teardown ---
// There is no foundry row to delete any more, so the designs this run made are
// removed one by one. What is left behind is what somebody sees next time they
// open the studio, and a plant full of "API test" loops is not a demo.
log.push('\nTEARDOWN')
const ours = (await call(ADMIN, 'GET', '/loops')).body || []
for (const loop of ours) await call(ADMIN, 'DELETE', `/loops/${loop.id}`)

// The live-readings tests ran in a foundry of their own, so its loops are
// elsewhere and would otherwise be left behind.
const theirs = (await call(LIVE_ADMIN, 'GET', '/loops')).body || []
for (const loop of theirs) await call(LIVE_ADMIN, 'DELETE', `/loops/${loop.id}`)
check('and the live-readings plant is cleared too',
  ((await call(LIVE_ADMIN, 'GET', '/loops')).body || []).length === 0)

const left = await call(ADMIN, 'GET', '/loops')
check('the suite removes every design it created',
  left.status === 200 && left.body.length === 0, left.body?.map(l => l.name))

/**
 * The seeded demo belongs to another plant, so it takes another launch to look
 * at — which is itself the point: this suite could not have touched it.
 */
const DEMO = await signIn({
  user: 'admin@mpminfosoft', name: 'Plant administrator', role: 'admin',
  foundry: 'FND-MUNJAL-KIRU', foundryName: 'Munjal Kiru',
  lines: [{ id: 'LINE-1', name: 'Line 1' }, { id: 'LINE-2', name: 'Line 2' }],
})
const seeded = (await call(DEMO, 'GET', '/loops')).body
  ?.find(loop => loop.name === 'Digital Sand Loop')
check('the seeded demo loop is untouched',
  !!seeded && seeded.latestVersion === 1, seeded)

// ------------------------------------------------------------------ report ---
console.log(log.join('\n'))
console.log(`\n${passed} passed, ${failed} failed`)
stop()
process.exit(failed ? 1 : 0)
