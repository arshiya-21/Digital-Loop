import express from 'express'
import cors from 'cors'
import { existsSync, readFileSync } from 'node:fs'
import { sep, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import { config } from './config/index.js'
import { authenticate, requireAdminRole, requireSameSite, tokenFromRequest } from './middleware/auth.js'
import { readSession } from './services/session-store.js'
import { contextScript } from './services/studio-context.js'
import { compressedStatic } from './middleware/compressed-static.js'
import { requestLog } from './middleware/request-log.js'
import { notFoundHandler, errorHandler } from './middleware/error-handler.js'
import { session } from './routes/sessions.js'
import { identity } from './routes/identity.js'
import { database } from './routes/database.js'
import { connections } from './routes/connections.js'
import { tableVisibility } from './routes/tableVisibility.js'
import { loops } from './routes/loops.js'
import { loopVersions } from './routes/loopVersions.js'
import { assets } from './routes/assets.js'
import { live } from './routes/live.js'
import { sopFiles } from './routes/sopFiles.js'
import { sops } from './routes/sops.js'
import { alarms } from './routes/alarms.js'
import { overview } from './routes/overview.js'
import { auditLog } from './routes/audit.js'

/**
 * The Express application.
 *
 * One origin serves the whole thing: the studio at `/`, the API under
 * `/api/v1`. The studio is plain ES modules with no build step, so there is
 * nothing for a second server to do — and one address means SandMan needs one
 * setting rather than two that can drift apart.
 *
 * Surfaces are named after the thing they serve, not after who is calling:
 *
 *   /                     the studio itself
 *   /api/v1/session       arriving from SandMan — the only way in
 *   /api/v1/me            who the caller is and what they may do
 *   /api/v1/database      the foundry's database, named but never connected to
 *   /api/v1/connections   plant databases somebody registered — admin only
 *   /api/v1/loops         the digital loops themselves
 *   /api/v1/assets        the equipment SVG library
 *   /api/v1/overview      what is published across every line in scope
 *   /api/v1/audit         who changed what, and when
 *
 * There is deliberately no `/admin` and no `/viewer`. Designing a loop and
 * viewing a published one are two levels of access to the *same* resource, not
 * two APIs, so both use `/api/v1/loops` and the server decides which applies —
 * see `utils/loop-access.js`.
 *
 * `authenticate` runs before every mount, and every handler re-checks access
 * against the record it touches. A prefix is never the security boundary.
 *
 * Exported separately from the listener so tests can mount it without opening
 * a port.
 */
export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  /*
   * Proxy headers are not trusted.
   *
   * With `trust proxy` on, Express takes `req.ip` from `X-Forwarded-For` — a
   * header any client can write. The launch allowlist compares the real peer
   * address, and this keeps it that way. Turn it on only behind a proxy that
   * is known to overwrite the header.
   */
  app.set('trust proxy', false)

  // Before everything, so what it times is the whole request.
  app.use(requestLog(`${config.basePath}/api/v1`))

  app.use(cors({
    origin: config.corsOrigin,
    credentials: true,
    allowedHeaders: ['authorization', 'content-type', 'x-requested-with'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }))

  /*
   * SandMan's page posts the ticket here as a form, into a full-page iframe.
   * The parser is mounted on this one route and nowhere else: every other
   * endpoint takes JSON, and a body parser that is not needed is a surface
   * that is not needed. 2 KB is far more than `ticket=<20 bytes>`.
   */
  app.post(
    `${config.basePath}/api/v1/session/enter`,
    express.urlencoded({ extended: false, limit: '2kb' })
  )

  /*
   * Everything this service serves hangs off one router, mounted at the path
   * SandMan opens it under — see `config.basePath`. The page, its scripts and
   * its API therefore share one address instead of the API living at the root
   * of a second host: one origin, no CORS to arrange, and a session cookie
   * scoped to this application rather than to the whole domain.
   */
  const site = express.Router()

  /*
   * An SOP document arrives as its own bytes, not as JSON.
   *
   * Parsed before `express.json` and only for this one path: a 25 MB PDF
   * base64'd into a JSON field would be a third larger and would have to be
   * decoded in memory, and a multipart parser is a dependency plus an attack
   * surface for a form with one field in it. The name and type travel in
   * headers — see `routes/sopFiles.js`.
   */
  site.use(
    '/api/v1/sop-files',
    express.raw({ type: () => true, limit: config.limits.sopFileBytes })
  )

  site.use(express.json({ limit: config.limits.bodyBytes }))

  // Responses are per-user and change on every write; nothing here is cacheable.
  site.use('/api/v1', (req, res, next) => {
    res.set('cache-control', 'no-store')
    next()
  })

  /*
   * Every state-changing request must prove it came from the studio.
   *
   * Mounted before the routes rather than inside them, so a route added later
   * is covered by default instead of by remembering. See `requireSameSite`.
   */
  site.use('/api/v1', requireSameSite)

  site.get('/api/v1/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() })
  })

  // Not authenticated: this is how a caller becomes authenticated. SandMan
  // proves itself with the shared secret; the browser only ever holds a
  // short-lived, single-use ticket.
  site.use('/api/v1/session', session.router)

  site.use('/api/v1/me', authenticate, identity.router)
  // The foundry's database as SandMan described it — names only, read from the
  // session. Both roles: the tag dropdowns and the published view use the same
  // list.
  site.use('/api/v1/database', authenticate, database.router)
  // One resource, two routers: the loops themselves, and their versions and
  // publishing. Mounted on the same prefix because they are the same resource
  // — see utils/loop-access.js.
  site.use('/api/v1/loops', authenticate, loops.router)
  site.use('/api/v1/loops', authenticate, loopVersions.router)
  site.use('/api/v1/assets', authenticate, assets.router)
  /*
   * Live readings for a loop's linked tags, read by SandMan on this service's
   * behalf. Everything about what may be read comes from the session and the
   * stored layout — see routes/live.js.
   */
  site.use('/api/v1/live', authenticate, live.router)
  /*
   * Written procedures, and what went out of limit.
   *
   * Both belong to a loop and borrow its access rules: anybody who may open
   * the loop may read them, and only somebody who may design it may add an
   * SOP document. The procedure itself — its number, revision and steps — is
   * `sops`; the uploaded PDF beside it is `sopFiles`. See routes/sops.js,
   * routes/sopFiles.js and routes/alarms.js.
   */
  site.use('/api/v1/sop-files', authenticate, sopFiles.router)
  site.use('/api/v1/sops', authenticate, sops.router)
  site.use('/api/v1/alarms', authenticate, alarms.router)
  /*
   * Plant databases somebody registered — the only credentials this service
   * holds. Administrator-only at the mount AND inside every handler: a prefix
   * is never the security boundary, and this is the prefix it would matter
   * most for.
   */
  site.use('/api/v1/connections', authenticate, requireAdminRole, connections.router)
  /*
   * Which tables each database offers in the reading dropdowns. Readable by
   * both roles because the dropdowns are built from it; the write inside is
   * administrator-only — see routes/tableVisibility.js.
   */
  site.use('/api/v1/table-visibility', authenticate, tableVisibility.router)
  // These three scope themselves to what the caller can already reach.
  site.use('/api/v1/overview', authenticate, overview.router)
  // Administration of the plant structure and the change log, both admin-only.
  site.use('/api/v1/audit', authenticate, requireAdminRole, auditLog.router)

  /*
   * The studio.
   *
   * Served after the API so `/api/...` can never be shadowed by a file, and
   * before the 404 handler so anything else falls through to the shell. The
   * modules and artwork are immutable between deploys but the shell is not, so
   * only `index.html` is told not to cache — otherwise a browser keeps
   * yesterday's page after an update.
   */
  if (existsSync(config.paths.studio)) {
    /*
     * The built editor, gzipped.
     *
     * Before `express.static`, which does not compress: `app.js` alone is four
     * and a half megabytes, and it was being sent whole on every cache miss.
     * Anything it does not handle — artwork, the integration modules — falls
     * through to the plain static handler below.
     */
    site.use(compressedStatic(config.paths.studio))

    site.use(express.static(config.paths.studio, {
      index: false,
      setHeaders(res, filePath) {
        /*
         * The shell and the integration layer are never cached; the editor's
         * own modules and its artwork are.
         *
         * `sandman/` is what turns the studio into this application — the
         * launch handshake, the session, the chrome. A stale copy of it does
         * not degrade, it strands: an old boot sequence against a current API
         * leaves somebody looking at "Opening…" with no way out, and a hard
         * reload is not something to expect of an operator. It is a few
         * kilobytes, so there is nothing to gain by caching it.
         */
        const name = filePath.split(sep).join('/')
        if (name.endsWith('index.html') || name.includes('/sandman/')) {
          res.set('cache-control', 'no-store')
        }
      },
    }))
    /*
     * The shell, with the session written into it.
     *
     * The studio reads `window.SANDMAN_CONTEXT` as its first script runs — who
     * is logged in and that foundry's database — so it has to be in the HTML
     * before the app, not fetched afterwards. The session is a cookie, so this
     * request already carries everything needed to write it.
     *
     * Somebody with no session gets the page with no context at all, and the
     * lock screen that is painted in the document's first bytes stays up.
     */
    site.get(/^\/(?!api\/).*/, (req, res, next) => {
      if (req.method !== 'GET') return next()

      /*
       * The shell answers navigations, not missing files.
       *
       * Without this, a request for a file that is not there falls through to
       * here and gets `index.html` with status 200 — so a missing `app.js`
       * arrives at the browser as HTML claiming to be JavaScript, fails to
       * parse, and leaves a half-built page with nothing in the log. That is
       * exactly how a broken studio hid itself. Anything that looks like a
       * file gets an honest 404.
       */
      const looksLikeAFile = /\.[a-z0-9]{1,8}$/i.test(req.path)
      const wantsHtml = (req.get('accept') || '').includes('text/html')
      if (looksLikeAFile && !wantsHtml) return next()

      let shell
      try {
        shell = readFileSync(resolve(config.paths.studio, 'index.html'), 'utf8')
      } catch {
        return next()
      }

      let context = ''
      try {
        const session = readSession(tokenFromRequest(req))
        if (session) {
          context = contextScript({
            foundry: session.foundry,
            name: session.user.name,
            sandmanUserId: session.user.sandmanUserId,
            database: session.database,
          })
        }
      } catch (error) {
        // A context that could not be built is not a reason to refuse the
        // page: the studio opens without a database rather than not at all.
        console.error(`   !  studio context not built  ${error.message}`)
      }

      /*
       * The page is patched at build time with `<base href="/">`, which is
       * right only when this service owns the root of its host. Mounted under
       * a path it has to say so, or every relative URL on the page — the
       * editor, its artwork and every API call — resolves against the host
       * root and 404s.
       */
      const based = config.basePath
        ? shell.replace('<base href="/">', `<base href="${config.basePath}/">`)
        : shell

      const page = context
        ? based.replace('<script src="app.js">', `${context}\n<script src="app.js">`)
        : based

      res.set('cache-control', 'no-store')
      res.type('html')

      /*
       * Compressed, but never cached.
       *
       * The context is the plant's whole schema — about 140 KB of very
       * repetitive JSON for a foundry with 244 tables, which gzip takes to a
       * fraction of that for a couple of milliseconds of work. It cannot join
       * the cache in `compressed-static.js`, because this page is different
       * for every session and a shared copy would hand one plant's context to
       * another.
       */
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const body = gzipSync(Buffer.from(page, 'utf8'), { level: 6 })
        res.set('content-encoding', 'gzip')
        res.set('vary', 'accept-encoding')
        res.set('content-length', String(body.length))
        return res.end(body)
      }
      return res.send(page)
    })
  }

  app.use(config.basePath || '/', site)

  /*
   * The bare root goes to where the application actually is, so somebody who
   * types the host without the path does not get a 404 from a server that is
   * running perfectly well.
   */
  if (config.basePath) {
    app.get('/', (req, res) => res.redirect(302, `${config.basePath}/`))
  }

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
