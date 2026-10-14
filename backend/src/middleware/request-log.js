/**
 * One line per request, and only for requests worth a line.
 *
 * This server was silent. When the studio failed to open there was nothing to
 * read: not whether the launch arrived, not whether the browser came back with
 * the ticket, not whether a file 404'd. Every answer had to come from a
 * browser's developer tools, which is no use at all on a plant machine.
 *
 * So: every API call, and anything else only when it fails. Serving four
 * megabytes of editor and a few hundred drawings would otherwise bury the four
 * lines that matter under a few hundred that do not.
 *
 *   14:22:07  POST  session/launch          201   12ms  Munjalkiriu
 *   14:22:07  POST  session/enter           303    4ms  signed in
 *   14:22:08  GET   me                      200    1ms  Munjalkiriu admin
 *   14:22:08  GET   database                200   28ms  sandman_dev, 244 tables
 *   14:22:19  GET   app.js                  404    0ms  not found
 */

const clock = () => new Date().toTimeString().slice(0, 8)

/** Right-pad, but never truncate: a cut-off path is worse than a ragged column. */
const pad = (text, width) => String(text).padEnd(width)

/**
 * What a request was about, in a few words.
 *
 * Read from what the handler resolved rather than from the body, so nothing
 * here can print a ticket, a password or a launch payload.
 */
function note(req, res, path) {
  const user = req.user

  /*
   * A handler may say what its request was about, in words it has checked.
   *
   * Used by the live-readings routes, where the useful line is how many tags
   * were asked for and whether the answer was fresh — never a reading, and
   * never a table name.
   */
  if (req.logNote) return req.logNote

  if (path === '/session/launch') {
    return res.statusCode === 201 ? req.body?.user || 'ticket issued' : 'refused'
  }
  if (path === '/session/enter') {
    return res.statusCode === 303 && res.getHeader('set-cookie') ? 'signed in' : 'refused'
  }
  if (path === '/session/end') return 'signed out'
  if (!user) return ''
  if (path === '/me') return `${user.sandmanUserId} ${user.role}`
  if (path === '/database') {
    const database = user.database
    return database?.name ? `${database.name}, ${database.tables.length} tables` : 'none'
  }
  return user.sandmanUserId
}

/** Timing and the line itself. Mounted before everything it should measure. */
export function requestLog(apiPrefix = '/api/v1') {
  return function log(req, res, next) {
    const started = process.hrtime.bigint()

    res.on('finish', () => {
      const isApi = req.originalUrl.startsWith(apiPrefix)
      const failed = res.statusCode >= 400

      // Static files are only interesting when they are missing: that is how a
      // half-loaded studio shows itself.
      if (!isApi && !failed) return

      const ms = Number(process.hrtime.bigint() - started) / 1e6
      /*
       * The path relative to the API, taken from `originalUrl`.
       *
       * This middleware is mounted at the root, so `req.path` here is the
       * whole `/api/v1/me` — which is why matching it against `/me` quietly
       * described nothing for every route.
       */
      const full = req.originalUrl.split('?')[0]
      const where = isApi ? full.slice(apiPrefix.length + 1) : full
      const route = isApi ? full.slice(apiPrefix.length) : full

      const tail = isApi ? note(req, res, route) : failed ? 'not found' : ''
      console.log(
        `${clock()}  ${pad(req.method, 5)} ${pad(where, 24)} ${pad(res.statusCode, 4)}` +
        `${ms.toFixed(0).padStart(5)}ms  ${tail}`
      )
    })

    next()
  }
}
