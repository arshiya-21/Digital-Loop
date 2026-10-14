import { createReadStream, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { extname, join, normalize, resolve, sep } from 'node:path'

/**
 * Serving the built studio, compressed.
 *
 * `app.js` is four and a half megabytes of equipment drawings and editor. Sent
 * as it is, that is the thing somebody waits for every time the studio opens —
 * and `express.static` does not compress, so it was being sent whole on every
 * cache miss. Gzipped it is closer to a megabyte.
 *
 * The files are build output: they change when `frontend/studio/patch.mjs`
 * runs and at no other time. So each one is compressed once, on the first
 * request for it, and kept in memory keyed by size and modification time — a
 * rebuild changes both, which invalidates the entry without anyone having to
 * remember to clear anything.
 *
 * Only `.js` and `.css` are handled. `index.html` is deliberately excluded: it
 * is rewritten per request to carry the session's foundry and database, so a
 * cached copy of it would hand one plant's context to another.
 */

const COMPRESSIBLE = new Set(['.js', '.mjs', '.css'])

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

/** path → { key, body }. One entry per built file; a rebuild replaces it. */
const cache = new Map()

export function compressedStatic(root) {
  const base = resolve(root)

  return function serveCompressed(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()

    const name = req.path
    const extension = extname(name).toLowerCase()
    if (!COMPRESSIBLE.has(extension)) return next()

    /*
     * Resolve inside the studio directory and nowhere else.
     *
     * `req.path` is URL-decoded by Express, so it can hold `..`. Normalising
     * and then checking the result is still under the root is what stops a
     * request for `/../../backend/data/digital-loop.db` being answered.
     */
    const target = resolve(join(base, normalize(name)))
    if (target !== base && !target.startsWith(base + sep)) return next()

    let stats
    try {
      stats = statSync(target)
    } catch {
      return next()
    }
    if (!stats.isFile()) return next()

    const key = `${stats.size}-${stats.mtimeMs}`
    res.set('content-type', TYPES[extension])
    res.set('etag', `W/"${key}"`)
    // These are immutable between builds, but their names never change — so a
    // short life plus revalidation, rather than a long one that would serve
    // yesterday's editor after a deploy.
    res.set('cache-control', 'public, max-age=0, must-revalidate')
    // The answer differs by encoding, so a shared cache must key on it.
    res.set('vary', 'accept-encoding')

    if (req.headers['if-none-match'] === `W/"${key}"`) {
      res.status(304).end()
      return
    }

    const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '')
    if (!wantsGzip) {
      res.set('content-length', String(stats.size))
      if (req.method === 'HEAD') return res.end()
      return createReadStream(target).pipe(res)
    }

    const cached = cache.get(target)
    let body = cached && cached.key === key ? cached.body : null
    if (!body) {
      try {
        // Level 6: the default, and the point past which a few more seconds of
        // compression buys very little on a file this size.
        body = gzipSync(readFileSync(target), { level: 6 })
      } catch (error) {
        console.error(`   !  gzip ${name} failed, sending it whole  ${error.message}`)
        res.set('content-length', String(stats.size))
        if (req.method === 'HEAD') return res.end()
        return createReadStream(target).pipe(res)
      }
      cache.set(target, { key, body })
    }

    res.set('content-encoding', 'gzip')
    res.set('content-length', String(body.length))
    if (req.method === 'HEAD') return res.end()
    return res.end(body)
  }
}

