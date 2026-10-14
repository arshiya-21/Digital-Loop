import express from 'express'
import { handle } from './respond.js'

/**
 * An Express router whose handlers receive a request context instead of
 * `(req, res, next)`.
 *
 *     router.get('/designs/:id', ({ user, params }) => loadDesign(user, params.id))
 *
 * Underneath this is a plain `express.Router()`, mounted with its prefix and
 * middleware in `app.js` like any other. The context is a deliberate
 * convention: a handler that takes what it needs and returns a value has no
 * `res.` plumbing to get wrong, cannot forget to send a response, and can be
 * called directly from a test. Errors thrown inside reach the error
 * middleware; `utils/respond.js` covers the cases that need an explicit status,
 * headers or an empty body.
 *
 * `req` is passed through for the rare handler that needs the raw request.
 */
export function createRouter() {
  const router = express.Router()

  const bind = method => (path, handler) => {
    router[method](path || '/', handle(req =>
      handler({
        user: req.user,
        params: req.params,
        body: req.body ?? {},
        query: req.query,
        req,
      })
    ))
    return api
  }

  const api = {
    /** The underlying express.Router, for mounting. */
    router,
    get: bind('get'),
    post: bind('post'),
    put: bind('put'),
    patch: bind('patch'),
    delete: bind('delete'),
  }

  return api
}
