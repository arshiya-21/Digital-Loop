import { config } from '../config/index.js'
import { unavailable } from '../utils/errors.js'

/**
 * Talking to SandMan.
 *
 * Two kinds of question, one direction, and always server to server:
 *
 *   liveness   is SandMan running? A launch is only honoured while it is,
 *              which is what makes the studio unreachable on its own rather
 *              than merely unreachable at first.
 *   readings   the last record, or a chart, for tags on one line.
 *
 * **The browser never calls SandMan.** It asks this service, which asks
 * SandMan with the shared secret from the environment — a secret the browser
 * must never see, and which SandMan only accepts from loopback. That is also
 * why the request body is built here from the session and the stored layout:
 * nothing about which foundry, line, table or column to read is taken from
 * the caller.
 *
 * Designs still live in this service's own database and are never mirrored
 * back, this service still never reads SandMan's database, and it holds no
 * credentials for it. A reading arrives as a number, not a connection.
 *
 * **Nothing here logs a body or a value.** A reading is plant data and a
 * request body names the foundry's tables; an error says which endpoint and
 * what status, and nothing else.
 */

const { url, healthPath, healthCacheMs, apiPath, readTimeoutMs } = config.sandman

/** Liveness is asked for on a timer, so the answer is cached briefly. */
let cached = { at: 0, online: false }

async function fetchWithTimeout(path, options = {}, ms = 1500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url + path, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Is SandMan up?
 *
 * Any failure — refused, timed out, wrong shape — counts as down. The studio
 * locking when SandMan is unreachable is the correct behaviour, not an error
 * to work around.
 */
export async function isOnline() {
  if (Date.now() - cached.at < healthCacheMs) return cached.online

  let online = false
  try {
    const response = await fetchWithTimeout(healthPath)
    online = response.ok && (await response.json().catch(() => null))?.service === 'sandman'
  } catch {
    online = false
  }

  cached = { at: Date.now(), online }
  return online
}

/** Forget the cached answer — used by tests that stop and start SandMan. */
export const forgetHealth = () => { cached = { at: 0, online: false } }

/* ------------------------------------------------------------- readings ---*/

/**
 * POST to one of SandMan's digital-loop endpoints.
 *
 * The secret goes in a header and never anywhere else. A failure — refused,
 * timed out, or an error status — becomes a 503 with the endpoint named and
 * nothing of the body in it, because the body is the foundry's table names
 * and the answer is the foundry's readings.
 */
async function ask(endpoint, body) {
  const where = `${url}${apiPath}${endpoint}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), readTimeoutMs)

  let response
  try {
    response = await fetch(where, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sandman-secret': config.sandman.secret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    // `AbortError` when the timeout fired, otherwise a connection failure.
    const why = error.name === 'AbortError'
      ? `did not answer within ${readTimeoutMs} ms`
      : 'could not be reached'
    throw unavailable('sandman_unreachable', `SandMan ${why}.`)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    /*
     * SandMan's own message is read but not passed on verbatim: a 400 from it
     * describes a body this service built, which is a detail of how the two
     * talk rather than anything the person in the studio can act on. The
     * status is what distinguishes "SandMan is unwell" from "we asked wrongly".
     */
    throw unavailable(
      'sandman_refused',
      `SandMan answered ${response.status} for ${endpoint}.`
    )
  }

  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object') {
    throw unavailable('sandman_unreadable', `SandMan's answer for ${endpoint} was not readable.`)
  }
  return payload
}

/**
 * The last record of each tag on a line.
 *
 * `tags` is at most 200 entries of `{ id, table, column, keyColumn?, keyValue? }`.
 * The answer carries a `values` map and an `errors` map; a tag the line has no
 * record for comes back as `null` rather than being left out, which is what
 * lets the studio tell "nothing recorded" from "not asked for".
 */
export const readValues = ({ foundry, line, tags }) =>
  ask('/values', { foundry, line, tags })

/** Chart data for one tag — the series, and SandMan's own process control. */
export const readChart = body => ask('/chart', body)
