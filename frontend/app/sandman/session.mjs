import { api, meApi } from './api.mjs'

/**
 * Arriving from SandMan.
 *
 * The studio is not a page you can browse to, and there is no longer a link
 * that opens it. SandMan mints a ticket server-to-server and its page **posts**
 * that ticket into a full-page iframe:
 *
 *     POST /api/v1/session/enter      ticket=…      (a hidden form)
 *
 * The server redeems it, sets an `HttpOnly` session cookie and redirects the
 * iframe to "/". By the time this module runs, either that happened or it did
 * not — so there is nothing here to read out of the URL, nothing to scrub from
 * the address bar, and no token to hold.
 *
 * `enter()` therefore asks one question: does the server recognise me? A 200
 * from `/me` is a session; a 401 is the locked screen.
 *
 * **Why the ticket stopped being a query parameter.** `?ticket=…` is a working
 * credential, and a URL is the most copied string in a browser: it goes into
 * the address bar, the history, the referrer of the next request, and the
 * access log of anything in between. A request body is in none of those.
 *
 * **Why the token is a cookie and not a variable.** It was held in memory to
 * keep it out of storage. `HttpOnly` is stronger: the page cannot read it at
 * all, so no bug on this page can carry it away — and a reload stays signed in
 * rather than sending somebody back through SandMan for a refresh.
 */

/** Everything the session says about the caller. Populated by `enter()`. */
export const session = {
  ok: false,
  reason: '',
  user: null,          // { sandmanUserId, name, role }
  foundry: null,       // { id, name }
  lines: [],           // [{ id, name }]
  lineId: null,        // the line SandMan opened on, if it named one
  sandmanUrl: null,    // where to go back to
}

export const isAdmin = () => session.user?.role === 'admin'

/**
 * Load who we are, from the cookie the server set.
 *
 * Never throws: every failure here has the same answer — lock, and say why.
 */
export async function enter() {
  let me
  try {
    me = await meApi.get()
  } catch (error) {
    session.reason = error.status === 401
      ? 'Open Digital Loop from SandMan. It identifies you and the plant to show.'
      : error.message
    session.sandmanUrl = await sandmanUrl()
    return session
  }

  const plant = me.foundries?.[0]
  if (!plant) {
    session.reason = 'Your account is not in any foundry.'
    session.sandmanUrl = await sandmanUrl()
    return session
  }

  session.ok = true
  session.user = { sandmanUserId: me.sandmanUserId, name: me.name, role: me.role }
  session.foundry = { id: plant.id, name: plant.name }
  session.lines = plant.lines.map(line => ({ id: line.id, name: line.name }))
  // The line SandMan opened on comes from the session, like everything else:
  // there is no redeem reply to carry it any more.
  session.lineId = me.line || plant.lines[0]?.id || null
  session.sandmanUrl = await sandmanUrl()
  return session
}

/** Where SandMan is, so the lock screen and the back link point somewhere real. */
async function sandmanUrl() {
  try {
    const status = await api.get('/session/sandman')
    return status?.url || null
  } catch {
    return null
  }
}
