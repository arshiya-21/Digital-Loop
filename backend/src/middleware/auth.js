import { config } from '../config/index.js'
import { unauthorized, forbidden } from '../utils/errors.js'
import { readSession } from '../services/session-store.js'

/**
 * ============================================================================
 * AUTHENTICATION — SESSIONS MINTED FROM A SANDMAN LAUNCH
 * ============================================================================
 *
 * This service stores no credentials and no accounts. SandMan is the identity
 * provider. A person arrives with a launch ticket SandMan minted for them
 * server-to-server; redeeming it opens a session here, and the bearer token is
 * that session's random token:
 *
 *     Authorization: Bearer <sessionToken>
 *
 * The token is 32 random bytes and can only come from a redeemed ticket, so a
 * caller cannot name themselves. What the session says about them — their role,
 * their foundry, its lines — came from SandMan and is never taken from the
 * request.
 *
 * THIS IS STILL NOT SSO, and `AUTH_MODE` refuses any value but `stub` to say
 * so. What is missing is verification of SandMan's own claim: the launch is
 * trusted because it carried the shared secret, which is a development
 * placeholder rather than a signature. To go live, replace the secret check in
 * `routes/sessions.js` with one of:
 *
 *   a) OIDC — SandMan posts a signed assertion; verify it against its JWKS
 *      (issuer, audience, expiry, signature) and read the subject from it.
 *   b) Introspection — SandMan sends an opaque token; POST it to its
 *      introspection endpoint with this service's client credentials.
 *
 * Everything below stays as it is: the session, its scope and these guards do
 * not care how the launch was proved.
 */

if (config.authMode !== 'stub') {
  throw new Error(
    `AUTH_MODE="${config.authMode}" is not implemented. Replace the shared-secret check in ` +
    'backend/src/routes/sessions.js with SandMan assertion verification first.'
  )
}

/**
 * Read one cookie out of the Cookie header.
 *
 * Written here rather than taken as a dependency: it is a split on `;` and
 * `=`, and this service has one cookie. The value is percent-encoded on the
 * way out, so it is decoded here; a malformed value decodes to itself rather
 * than throwing, because a bad cookie should be "not signed in", not a 500.
 */
export function cookieFrom(header, name) {
  if (!header) return ''
  for (const part of String(header).split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    if (part.slice(0, at).trim() !== name) continue
    const raw = part.slice(at + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return ''
}

/**
 * The session token.
 *
 * The cookie is what the studio uses and the only thing the browser ever
 * holds: `HttpOnly`, so script cannot read it, and never in a URL, a response
 * body or storage. `Authorization: Bearer` is kept for tests and command-line
 * tools, which have no cookie jar — it is not a second way in for the browser,
 * because nothing in the studio sets it.
 */
export function tokenFromRequest(req) {
  const cookie = cookieFrom(req.headers?.cookie, config.cookie.name)
  if (cookie) return cookie

  const header = req.get('authorization') || ''
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  return req.get('x-session-token') || ''
}

/** The `Set-Cookie` value that signs somebody in. */
export function sessionCookie(token) {
  const maxAge = Math.round(config.session.hours * 3600)
  return [
    `${config.cookie.name}=${encodeURIComponent(token)}`,
    'HttpOnly',
    `Path=${config.basePath || '/'}`,
    `SameSite=${config.cookie.sameSite}`,
    `Max-Age=${maxAge}`,
    ...(config.cookie.secure ? ['Secure'] : []),
  ].join('; ')
}

/** The same cookie, expired — what signing out sends. */
export function clearedCookie() {
  return [
    `${config.cookie.name}=`,
    'HttpOnly',
    `Path=${config.basePath || '/'}`,
    `SameSite=${config.cookie.sameSite}`,
    'Max-Age=0',
    ...(config.cookie.secure ? ['Secure'] : []),
  ].join('; ')
}

/**
 * Identify the caller from their session.
 *
 * `id` is the SandMan username, so everything written here — `created_by`,
 * `uploaded_by`, the audit actor — records the person in the terms SandMan
 * uses. There is no local user id to record instead.
 */
function resolveUser(req) {
  const session = readSession(tokenFromRequest(req))
  if (!session) {
    throw unauthorized('Your session has expired. Open Digital Loop from SandMan again.')
  }

  return {
    id: session.user.sandmanUserId,
    sandmanUserId: session.user.sandmanUserId,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    foundry: session.foundry,
    lines: session.lines,
    lineId: session.lineId,
    /** The foundry's database, described by SandMan. Names only; may be null. */
    database: session.database || null,
    token: session.token,
  }
}

/** Express middleware: attaches `req.user` or rejects the request. */
export function authenticate(req, res, next) {
  try {
    req.user = resolveUser(req)
    next()
  } catch (error) {
    next(error)
  }
}

/** Route guard for administrator-only endpoints. */
export function requireAdminRole(req, res, next) {
  if (req.user?.role !== 'admin') {
    next(forbidden('This endpoint requires an administrator account.'))
    return
  }
  next()
}

/** Throwing forms, for use inside handlers that guard per-record. */
export function requireAdmin(user) {
  if (user.role !== 'admin') throw forbidden('This endpoint requires an administrator account.')
  return user
}

/**
 * The foundry in the session is the only foundry there is.
 *
 * A launch names one plant, so this is not "is it in a list" but "is it the
 * one you came in through". Typing another foundry's id gets nothing.
 */
export function requireFoundryScope(user, foundryId) {
  if (String(foundryId) !== String(user.foundry.id)) {
    throw forbidden('Your session is not for this foundry.')
  }
}

/** Likewise for a line: only the lines SandMan listed in the launch. */
export function requireLineScope(user, lineId) {
  if (!user.lines.some(line => String(line.id) === String(lineId))) {
    throw forbidden('Your session does not include this production line.')
  }
}

/** Whether the caller may design, rather than only view published loops. */
export const canDesign = user => user.role === 'admin'

/**
 * ============================================================================
 * CROSS-SITE REQUEST FORGERY
 * ============================================================================
 *
 * A cookie is sent by the browser on every request to this origin, including
 * ones another site caused. That is what makes it convenient and what makes
 * this necessary: without a check, a page anywhere could POST to
 * `/api/v1/loops/…/publish` and the browser would attach the session.
 *
 * Two guards, both cheap:
 *
 *   1. **A header only script can set.** `X-Requested-With: digital-loop` is
 *      not a header a form, an image or a link can carry, and a cross-origin
 *      `fetch` that sets it triggers a preflight that this server does not
 *      answer for other origins. The studio sends it on every request.
 *   2. **The Origin, when the browser sends one.** Browsers put `Origin` on
 *      every state-changing request; if it is present and is not this studio,
 *      the request did not come from the studio. Absent is not treated as
 *      failure, because curl and server-to-server callers do not send it.
 *
 * Reads are not guarded: they change nothing, and the same-origin policy keeps
 * another site from seeing the answer.
 *
 * `/session/launch` and `/session/enter` are exempt. Launch is a
 * server-to-server call with a shared secret and no cookie; enter is the form
 * post that creates the session, so there is nothing yet to forge.
 */

const CSRF_HEADER = 'x-requested-with'
const CSRF_VALUE = 'digital-loop'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const EXEMPT = new Set(['/session/launch', '/session/enter'])

/** The origins a state-changing request may claim to come from. */
function allowedOrigins(req) {
  const host = req.get('host')
  const list = [config.corsOrigin]
  if (host) list.push(`http://${host}`, `https://${host}`)
  return list
}

export function requireSameSite(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next()
  // `req.path` here is relative to the /api/v1 mount.
  if (EXEMPT.has(req.path)) return next()

  if ((req.get(CSRF_HEADER) || '').toLowerCase() !== CSRF_VALUE) {
    return next(forbidden(
      `This request needs the ${CSRF_HEADER}: ${CSRF_VALUE} header. ` +
      'It is what distinguishes the studio from another site using your session.'
    ))
  }

  const origin = req.get('origin')
  if (origin && !allowedOrigins(req).includes(origin)) {
    return next(forbidden('This request came from another site.'))
  }

  return next()
}
