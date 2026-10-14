import { HttpError, notFound } from '../utils/errors.js'

/** Anything that reached no route. */
export const notFoundHandler = (req, res, next) =>
  next(notFound(`No route for ${req.method} ${req.path}.`))

/**
 * The single place an error becomes a response.
 *
 * **An unexpected failure never leaks its message to the client.** It goes to
 * the log instead, because the text of something that was not meant to happen
 * can carry table names, paths or values.
 *
 * A deliberate `HttpError` is different: its message was written to be read by
 * whoever is in the studio, and it has already been checked for what it says.
 * That matters at 5xx as well as below it — "SandMan did not answer" is a 503
 * the studio acts on by showing the last reading as stale, and turning it into
 * a bare "Internal server error" would leave it unable to tell that apart from
 * a bug in this service.
 *
 * And nothing under `/session` is logged in detail at all. Those bodies carry
 * a launch ticket and, behind it, somebody's name, email and plant: a stack
 * trace that happened to quote the request would put all of that in a log file
 * that outlives the session by months.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies this by arity.
export function errorHandler(error, req, res, next) {
  /*
   * Express's own body parsers throw plain errors that already carry a status
   * — a body over the limit is `entity.too.large` with 413, malformed JSON is
   * 400. Those are the caller's fault and saying so is useful; treating them
   * as unexpected turned "your file is too big" into "internal server error",
   * which sends somebody looking for a bug that is not there.
   *
   * Only 4xx is honoured. A 5xx on something that is not a deliberate
   * `HttpError` is still something going wrong here, and still hidden.
   */
  const fromParser = Number(error?.status ?? error?.statusCode)
  const borrowed = Number.isInteger(fromParser) && fromParser >= 400 && fromParser < 500
    ? fromParser
    : null

  const deliberate = error instanceof HttpError
  const status = deliberate ? error.status : borrowed ?? 500
  const sensitive = req.path.startsWith('/session') || req.originalUrl.includes('/session/')

  if (status >= 500 && !deliberate) {
    if (sensitive) {
      // The route and the message. No stack, because a stack can quote the
      // frame that held the payload.
      console.error(`   !  ${req.method} ${req.path}  ${error.message}`)
    } else {
      console.error(`   !  ${req.method} ${req.originalUrl}  ${error.message}`)
      console.error(error.stack?.split('\n').slice(1, 4).join('\n') || '')
    }
    res.status(500).json({ error: 'internal_error', message: 'Internal server error.' })
    return
  }

  // A deliberate 5xx is worth a line — it says a dependency is unwell — but
  // only the one line: no stack, because nothing is wrong with this service.
  if (status >= 500) console.error(`   !  ${req.method} ${req.originalUrl}  ${error.message}`)

  res.status(status).json({
    error: error.code || 'request_failed',
    message: error.message,
    ...(error.detail ? { detail: error.detail } : {}),
  })
}
