/**
 * The API's error vocabulary.
 *
 * Every failure reaches the client in one shape, with a machine-readable code
 * the studio can branch on:
 *
 *     { "error": "missing_data_tags", "message": "…", "detail": { … } }
 *
 * Handlers throw these; `middleware/error-handler.js` turns them into
 * responses. Nothing formats an error response by hand.
 */
export class HttpError extends Error {
  constructor(status, code, message, detail) {
    super(message || code)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export const badRequest = (code, message, detail) => new HttpError(400, code, message, detail)

export const unauthorized = (message = 'Authentication required.') =>
  new HttpError(401, 'unauthenticated', message)

export const forbidden = (message = 'Not permitted.') => new HttpError(403, 'forbidden', message)

export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message)

export const conflict = (code, message) => new HttpError(409, code, message)

/** Understood, well-formed, but refused — a business rule said no. */
export const unprocessable = (code, message, detail) => new HttpError(422, code, message, detail)

/**
 * Something this service depends on is not answering.
 *
 * Used when SandMan cannot be reached for live values. It is deliberately not
 * a 500: nothing here is broken and the caller should try again, which is a
 * different instruction from "this request will never work".
 */
export const unavailable = (code, message, detail) => new HttpError(503, code, message, detail)
