import { HttpError } from './errors.js'

/**
 * A small fixed-window limiter for the endpoints that have no login.
 *
 * The machine page is opened from a QR code by somebody with no SandMan
 * session, so the only things standing between it and a script are the
 * unguessable token and this. In memory on purpose: a restart forgets the
 * counts, which only ever lets a few extra requests through, and this service
 * runs as one process.
 *
 *     const limit = rateLimit({ windowMs: 60_000, max: 60 })
 *     limit(req, 'read')            // throws 429 when over
 */
export function rateLimit({ windowMs, max }) {
  const hits = new Map()

  // Old windows are swept now and then so the map cannot grow without bound.
  setInterval(() => {
    const cutoff = Date.now() - windowMs
    for (const [key, entry] of hits) if (entry.start < cutoff) hits.delete(key)
  }, Math.max(windowMs, 30_000)).unref()

  return (req, bucket = '') => {
    const key = `${req.ip || req.socket?.remoteAddress || '?'}|${bucket}`
    const t = Date.now()
    let entry = hits.get(key)
    if (!entry || t - entry.start >= windowMs) {
      entry = { start: t, count: 0 }
      hits.set(key, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      throw new HttpError(429, 'rate_limited', 'Too many requests — wait a minute and try again.')
    }
  }
}
