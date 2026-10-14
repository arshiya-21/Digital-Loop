/**
 * Lets route handlers stay plain functions of the request.
 *
 * A handler returns a value and `handle()` sends it as JSON. That keeps the
 * business logic free of `res.` plumbing and makes every handler trivially
 * callable from a test. Anything thrown — including the helpers in
 * `utils/errors.js` — reaches the error middleware, so no handler needs a
 * try/catch just to report a failure.
 */

/** An explicit reply, for a specific status, headers or an empty body. */
export class ApiReply {
  constructor(status, body, headers) {
    this.status = status
    this.body = body
    this.headers = headers
  }
}

export const reply = (status, body) => new ApiReply(status, body)

export const created = body => new ApiReply(201, body)

export const noContent = () => new ApiReply(204)

/** Send bytes with explicit headers, bypassing JSON encoding. */
export const rawReply = (status, headers, body) => new ApiReply(status, body, headers)

/**
 * Wrap a handler for Express.
 *
 * `ApiReply` is a class rather than a duck-typed `{status, body}` object on
 * purpose: domain objects carry their own `status` field — a design is 'draft'
 * or 'published' — so an envelope shaped like data would be indistinguishable
 * from data.
 */
export const handle = fn => async (req, res, next) => {
  try {
    const result = await fn(req, res)

    if (!(result instanceof ApiReply)) {
      res.json(result ?? {})
      return
    }
    if (result.headers) {
      res.writeHead(result.status, result.headers)
      res.end(result.body)
      return
    }
    if (result.status === 204) {
      res.status(204).end()
      return
    }
    res.status(result.status).json(result.body)
  } catch (error) {
    next(error)
  }
}
