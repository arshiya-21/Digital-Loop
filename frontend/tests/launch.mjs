/**
 * Opening the studio the only way it can be opened: through SandMan.
 *
 * The suites used to navigate to `?foundry=…&line=…&user=…`. That door is
 * closed — the studio requires a launch ticket minted server-to-server, and
 * refuses one while SandMan is not running. So the tests do what SandMan does:
 * prove themselves with the shared secret, take a ticket, and hand the browser
 * a URL carrying only that.
 *
 * The launch is also the only description of the plant. There is no foundry
 * table, no line table and no account store to set up first — a suite invents a
 * foundry simply by naming one in the payload, and it exists for as long as
 * that session does.
 */

/**
 * The studio comes from the backend, not from a dev server.
 *
 * It has to: the page carries `window.SANDMAN_CONTEXT` — the foundry and its
 * database — written in as the backend serves it. Anything else serving the
 * same files gives a page with no context and no session.
 *
 * The port is overridable so a suite can be pointed at a scratch server on its
 * own database, rather than at the one somebody is using on 5000 — these tests
 * create designs, and the teardown only runs if the suite reaches the end.
 */
const PORT = Number(process.env.DL_API_PORT) || 5000
/** Where the service is mounted. Must match the server's `DL_BASE_PATH`. */
const BASE_PATH = process.env.DL_BASE_PATH ?? '/sandman/digitalloop'
const API = `http://localhost:${PORT}${BASE_PATH}/api/v1`
const STUDIO = `http://localhost:${PORT}${BASE_PATH}/`

/**
 * What the studio sends on every state-changing request.
 *
 * The session is a cookie, which a browser attaches to any request to this
 * origin — including one another site caused — so the server refuses to change
 * anything without a header only this page's script can set. These helpers use
 * a bearer token rather than a cookie, but the guard does not care how the
 * caller is identified: without this, every write a suite makes is a 403 and
 * teardown silently leaves its fixtures behind.
 */
const CSRF = { 'x-requested-with': 'digital-loop' }
/**
 * No fallback: the API refuses to start without a real secret, so a suite that
 * guessed one would fail with a 401 instead of saying what is actually wrong.
 */
const SECRET = process.env.SANDMAN_SECRET
if (!SECRET) {
  console.error(
    'SANDMAN_SECRET is not set in this shell.\n\n' +
    'It is the value the API was started with. On Windows it is a user\n' +
    'environment variable, so a shell opened before it was set will not see it.\n'
  )
  process.exit(2)
}

/**
 * Where SandMan is, as the API understands it.
 *
 * Asked of the API rather than assumed, because it is the API's liveness check
 * that decides whether a ticket may be redeemed — so this has to agree with it
 * or the suites fail on a URL nobody is serving.
 */
async function sandmanUrl() {
  try {
    const response = await fetch(`${API}/session/sandman`)
    return (await response.json()).url || null
  } catch {
    return null
  }
}

/** Is SandMan answering? Nothing can be opened without it. */
export async function sandmanUp() {
  try {
    const response = await fetch(`${API}/session/sandman`)
    return response.ok && (await response.json()).online === true
  } catch {
    return false
  }
}

/**
 * Refuse to run rather than report a wall of failures.
 *
 * Every browser suite needs SandMan; without it the only honest result is
 * "could not start", not twenty assertions about a locked screen.
 */
export async function requireSandMan() {
  if (await sandmanUp()) return
  const where = (await sandmanUrl()) || 'the configured SANDMAN_URL'
  console.error(
    `SandMan is not answering at ${where}.\n\n` +
    'The studio opens only through SandMan, and the API refuses to redeem a\n' +
    'launch while it is unreachable. Start SandMan, or point the API at one:\n\n' +
    '    SANDMAN_URL=http://localhost:8080/sandman/api/su/digital-loop npm start\n'
  )
  process.exit(2)
}

/**
 * The plant the browser suites run in.
 *
 * It matches what the seed files the demo loop under, so a suite that opens the
 * studio sees the seeded Digital Sand Loop on Line 1 — and Line 2 with nothing
 * on it, which is what makes "no design yet" testable.
 */
/**
 * The foundry's database, as SandMan sends it with a launch.
 *
 * Names only: the database, its tables, and each table's columns with their
 * types. No credentials are sent and nothing connects to it — this is the list
 * the studio's table and column dropdowns are built from.
 *
 * A stand-in for the real thing, which for Munjal Kiru is about 239 tables and
 * 5,000 columns. Four tables is enough to drive the dropdowns, and small enough
 * that a suite can assert on what it holds.
 */
export const DATABASE = {
  name: 'munjalkiriu_sandman',
  tables: [
    {
      name: 'preparedsand',
      columns: [
        { name: 'pkey', type: 'int' },
        { name: 'recordtime', type: 'datetime' },
        { name: 'moisture', type: 'float' },
        { name: 'compactability', type: 'float' },
        { name: 'temperature', type: 'float' },
      ],
    },
    {
      name: 'returnsand',
      columns: [
        { name: 'pkey', type: 'int' },
        { name: 'recordtime', type: 'datetime' },
        { name: 'moisture', type: 'float' },
        { name: 'temperature', type: 'float' },
      ],
    },
    {
      name: 'mixercycle',
      columns: [
        { name: 'pkey', type: 'int' },
        { name: 'batchno', type: 'varchar' },
        { name: 'cycletime', type: 'int' },
        { name: 'waterad', type: 'float' },
      ],
    },
    {
      name: 'additive',
      columns: [
        { name: 'pkey', type: 'int' },
        { name: 'bentonite', type: 'float' },
        { name: 'coaldust', type: 'float' },
      ],
    },
  ],
}

export const PLANT = {
  foundry: process.env.SEED_FOUNDRY_ID || 'FND-MUNJAL-KIRU',
  foundryName: process.env.SEED_FOUNDRY_NAME || 'Munjal Kiru',
  lines: [
    { id: process.env.SEED_LINE_ID || 'LINE-1', name: process.env.SEED_LINE_NAME || 'Line 1' },
    { id: 'LINE-2', name: 'Line 2' },
  ],
  database: DATABASE,
}

/**
 * Mint a launch and enter with it, as SandMan's page does. Returns a session
 * token, taken out of the cookie the server set.
 *
 * The ticket is posted, never put in a URL — so these helpers post it too,
 * rather than testing a route that no longer exists.
 */
async function sessionToken(launch) {
  const ticket = await mintTicket(launch)

  const entered = await fetch(`${API}/session/enter`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ticket }).toString(),
    redirect: 'manual',
  })
  const cookie = entered.headers.get('set-cookie') || ''
  const token = /(?:^|[,;\s])dl_session=([^;]*)/.exec(cookie)?.[1]
  if (!token) throw new Error(`Entry refused (${entered.status}) with no session cookie`)
  return decodeURIComponent(token)
}

/** Just the ticket, for suites that drive the entry form themselves. */
export async function mintTicket(launch) {
  const minted = await fetch(`${API}/session/launch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sandman-secret': SECRET },
    body: JSON.stringify(launch),
  })
  const body = await minted.json().catch(() => null)
  if (minted.status !== 201) {
    throw new Error(`Launch refused (${minted.status}): ${body?.message || 'unknown'}`)
  }
  return body.ticket
}

/**
 * Call the API as an administrator of the demo plant.
 *
 * Suites use it to build fixtures and, more importantly, to take them away
 * again: what a test leaves behind is what somebody sees next time they open
 * the studio, and a plant full of "Pouring Loop x8yf" is not a demo.
 *
 * The token is cached for the run — each call minting its own launch would burn
 * a ticket per request for no reason.
 */
let adminToken = null

export async function admin(method, path, body, plant = PLANT) {
  if (!adminToken) {
    adminToken = await sessionToken({
      user: 'admin@mpminfosoft', name: 'Plant administrator', role: 'admin', ...plant,
    })
  }
  const response = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...CSRF,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

/** Call the API as an administrator of some other plant. Used for fixtures. */
export async function adminOf(plant, method, path, body) {
  const token = await sessionToken({
    user: `admin.${plant.foundry}`, name: 'Fixture admin', role: 'admin', ...plant,
  })
  const response = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...CSRF,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

/** Remove loops this run created, by name. Never throws: teardown is best effort. */
export async function removeLoops(...names) {
  try {
    const loops = (await admin('GET', '/loops')).body || []
    for (const loop of loops.filter(item => names.includes(item.name))) {
      await admin('DELETE', `/loops/${loop.id}`)
    }
  } catch { /* the run already reported its result; this is tidying */ }
}

/**
 * Remove every design in a plant this run invented.
 *
 * There is no foundry row to delete — a foundry is only an id in a launch — so
 * tearing one down means deleting what was put on its lines.
 */
export async function removeFoundry(plant) {
  try {
    if (!plant?.foundry) return
    const loops = (await adminOf(plant, 'GET', '/loops')).body || []
    for (const loop of loops) await adminOf(plant, 'DELETE', `/loops/${loop.id}`)
  } catch { /* as above */ }
}

/**
 * Mint a launch, as SandMan does. Returns the studio URL to navigate to.
 *
 * `foundry` and `line` are accepted as bare ids for the suites that only care
 * who is arriving; anything omitted falls back to the demo plant.
 */
export async function enterAs({
  user, role, name, foundry, foundryName, lines, line, plant, database,
}) {
  const base = plant || PLANT
  const ticket = await mintTicket({
    user,
    name: name || user,
    role: role || (String(user).startsWith('admin') ? 'admin' : 'viewer'),
    foundry: foundry ?? base.foundry,
    foundryName: foundryName ?? base.foundryName,
    lines: lines ?? base.lines,
    line: line ?? null,
    // Optional, as it is for SandMan: a launch without one opens a studio
    // whose tags are typed rather than chosen. Pass `database: null` to test
    // exactly that.
    database: database === undefined ? (base.database ?? null) : database,
  })

  return {
    /** Navigate here first; any page on the origin will do. */
    origin: STUDIO,
    ticket,
    /**
     * Evaluate this in the page to enter, exactly as SandMan's page does: a
     * hidden form, posted, which the server answers with a cookie and a
     * redirect to "/".
     */
    submit: `(() => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = ${JSON.stringify(`${API}/session/enter`)};
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = 'ticket';
      field.value = ${JSON.stringify(ticket)};
      form.append(field);
      document.body.append(form);
      form.submit();
    })()`,
  }
}

/**
 * The old entry point, kept only to say what replaced it.
 *
 * It returned `/?ticket=…`, and there is no longer such a thing: a ticket in a
 * URL is a credential in the address bar, the history and every log in
 * between. A suite enters by posting instead — see `enterAs`.
 */
export function launchUrl() {
  throw new Error(
    'launchUrl() is gone: the ticket is never in a URL any more. ' +
    'Use enterAs({...}), navigate to its `origin`, then evaluate its `submit`.'
  )
}
