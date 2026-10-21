import { resolve } from 'node:path'

/** The backend workspace, two levels above backend/src/config. */
const BACKEND = resolve(import.meta.dirname, '..', '..')

/** Repo root, one level above that — only the frontend's assets live there. */
const ROOT = resolve(BACKEND, '..')

export const config = {
  port: Number(process.env.PORT) || 5000,

  /** Origin allowed to call this API from a browser. */
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:8000',

  /**
   * 'stub' trusts the bearer token as a SandMan user id so the API can be
   * developed before SSO exists. Any other value makes the server refuse to
   * start until real verification is implemented — see middleware/auth.js.
   */
  authMode: process.env.AUTH_MODE || 'stub',

  /**
   * The key that seals stored database credentials.
   *
   * Required only by the "add a database" feature — nothing else here keeps a
   * secret at rest. Deliberately has no default: a key that ships with the
   * code protects nothing, and failing to add a connection is better than
   * believing a password is encrypted when anybody with the source can read
   * it. 64 hex characters, or a long passphrase.
   *
   *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   */
  secretKey: process.env.DL_SECRET_KEY || '',

  /**
   * MySQL — where designs, the equipment catalogue and the audit log live.
   *
   * Host, port and database name have sensible defaults because they are not
   * secrets and a wrong one fails loudly. **The account has none**: a username
   * and password that ship in the source are an account anybody can use, and
   * this database now holds every design in the plant. The server refuses to
   * start without them — see `assertDatabase`.
   */
  database: {
    host: process.env.DL_DB_HOST || '127.0.0.1',
    port: Number(process.env.DL_DB_PORT) || 3306,
    name: process.env.DL_DB_NAME || 'digital_loop',
    user: process.env.DL_DB_USER || '',
    password: process.env.DL_DB_PASSWORD || '',
  },

  /**
   * Where this service lives inside its host's URL space.
   *
   * SandMan opens the studio at `/sandman/user/digitalloop`, and everything
   * Digital Loop serves — the page, its scripts, its API — is expected under
   * the same prefix rather than at the root of a second host. That keeps one
   * address for the whole thing: no second origin to configure, no CORS, and a
   * session cookie scoped to this application instead of to everything else on
   * the domain.
   *
   * Normalised to either `''` (the root) or `/a/path` with no trailing slash,
   * because every use below concatenates and a stray slash is a 404 nobody
   * enjoys finding.
   */
  basePath: (() => {
    const raw = process.env.DL_BASE_PATH ?? '/sandman/digitalloop'
    const trimmed = String(raw).trim().replace(/\/+$/, '')
    if (!trimmed || trimmed === '/') return ''
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  })(),

  paths: {
    root: ROOT,
    /**
     * The uploaded artwork — the backend's own state, so it lives inside the
     * backend workspace rather than at the repo root.
     *
     * Back this up with the database: a design references artwork by slug, and
     * either half on its own is a drawing with holes in it.
     *
     * The retired SQLite file is still at `backend/data/digital-loop.db` and is
     * deliberately not a setting here: nothing reads it, and a path in the
     * config is a path somebody will assume something opens.
     */
    uploads: resolve(BACKEND, 'uploads', 'equipment'),
    /**
     * The studio, served by this same server at `/`.
     *
     * Plain ES modules and artwork — there is no build step, so this is the
     * source directory rather than a bundle.
     */
    studio: resolve(ROOT, 'frontend', 'app'),
    /** Bundled equipment SVGs, imported by the seed. */
    seedEquipment: resolve(ROOT, 'frontend', 'app', 'equipment'),
  },

  limits: {
    /** Largest request body, sized for a big layout document. */
    bodyBytes: 8 * 1024 * 1024,
    /** Largest uploaded SVG. */
    svgBytes: 512 * 1024,
    /**
     * Largest SOP document.
     *
     * The studio offers 25 MB, so this matches it: a smaller limit here would
     * mean the browser accepting a file and this refusing it, which is the
     * worst place to find out. Scanned procedures are genuinely this big.
     */
    sopFileBytes: 25 * 1024 * 1024,
  },

  /**
   * SandMan — the system the studio is opened from.
   *
   * The studio is not a place you can browse to. SandMan launches it, and a
   * launch is only honoured while SandMan is actually running: the backend
   * checks liveness before it will redeem a ticket. Stop SandMan and the canvas
   * locks.
   *
   * **One address, not several.** `url` is SandMan itself — its context path,
   * nothing deeper — and the two things this service needs from it hang off
   * that. Configuring the health endpoint separately meant the back link
   * inherited it and sent people to a machine-to-machine URL that answers 404.
   *
   *   health  {url}/api/su/digital-loop/health   liveness, no login needed
   *   home    {url}/user/dashboard                where "Back" goes
   *
   * The traffic is one-way from here: this service reads liveness and nothing
   * else. It never asks SandMan for data and never touches its database.
   *
   * `secret` is shared server-to-server so a browser cannot mint its own
   * launch. It must match SandMan's `DIGITAL_LOOP_SECRET`. The default is a
   * development placeholder, like the rest of the auth stub.
   */
  sandman: {
    url: (process.env.SANDMAN_URL || 'http://localhost:8080/sandman').replace(/\/$/, ''),
    /**
     * ⚠ No default, deliberately.
     *
     * A shared secret with a fallback is not a secret: it ships in the source,
     * so anybody who can reach port 5000 can mint a launch for any foundry and
     * any role. The server refuses to start without one — see `assertSecret`
     * below — rather than running in a state that looks secured and is not.
     *
     * Never printed, logged or written to a file.
     */
    secret: process.env.SANDMAN_SECRET || '',
    /** How long a launch ticket may sit unredeemed. */
    ticketSeconds: Number(process.env.SANDMAN_TICKET_SECONDS) || 120,
    /** Liveness answers are cached this long, so polling costs nothing. */
    healthCacheMs: 2000,
    /** Paths within SandMan. Not configurable: they are SandMan's own routes. */
    healthPath: '/api/su/digital-loop/health',
    /** Where the readings endpoints live, under the same context path. */
    apiPath: '/api/su/digital-loop',
    /**
     * How long to wait for a reading before giving up.
     *
     * It was five seconds, on the reasoning that a studio asking every thirty
     * seconds would rather be told "stale" quickly than hold a request open.
     * That is true of a warm SandMan and wrong about a cold one: where SandMan
     * reaches the foundry's database through an SSH tunnel, the first read
     * after an idle spell pays for the handshake. Measured on the plant's own
     * SandMan: 7.1 s for the first read, 0.16 s for every one after it. At
     * five seconds that first read always failed, the studio said SandMan
     * could not be reached, and the next poll half a minute later worked —
     * which reads as "production data is not coming" and is really "the first
     * one never gets through".
     *
     * So: long enough for a tunnel to come up, and no longer. The value on
     * screen stays visible while this is outstanding, and the cache below
     * means one slow read serves every screen on the line.
     */
    readTimeoutMs: Number(process.env.SANDMAN_READ_TIMEOUT_MS) || 20000,
    /**
     * How long a set of readings is reused before asking SandMan again.
     *
     * Thirty seconds, which is the cadence the studio polls at — see `POLL_MS`
     * in `frontend/app/sandman/live.mjs`. The two are meant to match: the
     * cache is what makes a control room with four screens on one line cost
     * one read of the foundry's database rather than four, and it can only do
     * that if a poll arrives while the entry is still alive.
     *
     * Overridable only so a test can watch an entry expire without sleeping
     * for half a minute. There is no reason to change it in a deployment.
     */
    valuesCacheMs: Number(process.env.DL_VALUES_CACHE_MS) || 30_000,
    /**
     * Back goes to the dashboard, not the landing page.
     *
     * Somebody leaving the studio is signed in and wants where they work, not
     * the front door. SandMan turns this into the front door by itself when
     * they are not: /user/** is behind its login filter, so an expired session
     * is redirected to /home — which is the behaviour wanted, without this
     * service having to know whether anyone is signed in.
     */
    homePath: '/user/dashboard',
  },

  /**
   * A redeemed launch lasts a shift, then you go back through SandMan.
   *
   * Long enough that nobody is thrown out mid-shift, short enough that a
   * forgotten browser on the plant floor does not stay signed in for days.
   */
  session: {
    hours: Number(process.env.SESSION_HOURS) || 12,
  },

  /**
   * The session cookie.
   *
   * The token lives here and nowhere else — never in a URL, never in a
   * response body, never in storage the page can read. `HttpOnly` is what
   * makes that true: script cannot see it, so a cross-site scripting bug
   * cannot carry it away.
   *
   * `SameSite=Lax` is right while SandMan and the studio share a registrable
   * domain — ports are not part of "site", so localhost:8080 and
   * localhost:5000 are the same site. Different domains in production need
   * `SameSite=None` **and** `Secure`, which means HTTPS.
   */
  cookie: {
    name: 'dl_session',
    sameSite: process.env.COOKIE_SAMESITE || 'Lax',
    secure: process.env.COOKIE_SECURE === 'true',
  },

  /**
   * Who may mint a launch.
   *
   * Port 5000 serves the studio too, so it cannot simply be firewalled: the
   * browser has to reach it. The endpoint is restricted instead, and loopback
   * is the default because SandMan runs on this machine.
   *
   * Checked against `req.socket.remoteAddress` — the actual peer. Proxy
   * headers are not consulted: `X-Forwarded-For` is a request header, so
   * trusting it would let anybody claim to be 127.0.0.1.
   *
   * On separate machines, set this to SandMan's server address and do not
   * expose /api/v1/session/launch through a public reverse proxy.
   */
  launchAllowedIps: (process.env.LAUNCH_ALLOWED_IPS || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean),
}

/**
 * Refuse to start without a database account.
 *
 * Checked at startup, before anything is listening, so a misconfigured
 * deployment fails in front of whoever is deploying rather than on the first
 * design somebody tries to save.
 */
export function assertDatabase() {
  const { user, host, port, name } = config.database
  if (user) return

  throw new Error(
    'DL_DB_USER is not set, so there is no account to reach MySQL with.\n\n' +
    `Digital Loop expects a MySQL server at ${host}:${port} and a database ` +
    `called "${name}" (it creates the database if it is missing).\n\n` +
    'Set these in the environment:\n' +
    '    DL_DB_USER       the MySQL account\n' +
    '    DL_DB_PASSWORD   its password\n' +
    '    DL_DB_HOST       optional, default 127.0.0.1\n' +
    '    DL_DB_PORT       optional, default 3306\n' +
    '    DL_DB_NAME       optional, default digital_loop\n'
  )
}

/**
 * Refuse to start without a usable shared secret.
 *
 * Checked at startup rather than per request, so a misconfigured deployment
 * fails at the point somebody is watching the logs instead of the first time
 * SandMan tries to open the studio.
 *
 * The message says what is wrong and how to fix it, and never shows the value.
 */
export function assertSecret() {
  const secret = config.sandman.secret
  const fix =
    '\n\nSet it in the environment on both sides — SANDMAN_SECRET here, ' +
    'DIGITAL_LOOP_SECRET in SandMan — to the same value:\n' +
    '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n'

  if (!secret) {
    throw new Error('SANDMAN_SECRET is not set, so a launch could not be verified.' + fix)
  }
  if (secret === 'dev-sandman-shared-secret') {
    throw new Error(
      'SANDMAN_SECRET is still the old development placeholder. It is published in ' +
      'this repository\'s history, so it secures nothing.' + fix
    )
  }
  if (secret.length < 32) {
    throw new Error(
      `SANDMAN_SECRET is ${secret.length} characters. Use at least 32; 64 hex is the intended form.` + fix
    )
  }
}
