/**
 * Talking to the Digital Loop API.
 *
 * There is no token in this file, and that is the point.
 *
 * The session lives in an `HttpOnly` cookie that the server set when SandMan
 * posted the launch ticket. Script cannot read it, so there is nothing here
 * for a cross-site scripting bug to steal and nothing to accidentally write
 * into a URL, a log or storage. `credentials: 'same-origin'` is what attaches
 * it; the browser does the rest.
 *
 * What every request does carry is `X-Requested-With: digital-loop`. A cookie
 * is sent on any request to this origin, including one another site caused —
 * so the server refuses to change anything without a header that only script
 * on this page can set. See `requireSameSite` on the server.
 */

/**
 * Relative on purpose.
 *
 * The page carries `<base href>`, which the server sets to wherever this
 * service is mounted — `/sandman/digitalloop/` in a plant, `/` when it owns a
 * host. A relative URL resolves against that, so the API is found without this
 * file knowing the path, and moving the mount needs no change here.
 *
 * A leading slash would defeat that: `/api/v1` resolves against the host root
 * and would miss the prefix entirely.
 */
const BASE = 'api/v1'

/** Marks a request as coming from the studio rather than from another site. */
const CSRF = { 'x-requested-with': 'digital-loop' }

/** An error that carries the API's own code and detail, not just a message. */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.code = body?.error || null
    this.detail = body?.detail || null
  }
}

async function request(method, path, body) {
  let response
  try {
    response = await fetch(BASE + path, {
      method,
      // The session cookie, which this page cannot read and does not need to.
      credentials: 'same-origin',
      headers: {
        ...CSRF,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new ApiError(0, { message: 'Cannot reach the Digital Loop API.' })
  }

  if (response.status === 204) return null

  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, payload)
  return payload
}

export const api = {
  get: path => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body ?? {}),
  delete: path => request('DELETE', path),
}

/**
 * The digital loops. One resource, two levels of access to it: the server
 * decides whether a caller may design or only view, and refuses accordingly.
 */
export const loopApi = {
  list: () => api.get('/loops'),
  get: id => api.get(`/loops/${id}`),
  create: (name, lineId, layout) => api.post('/loops', { name, lineId, layout }),
  rename: (id, name) => api.patch(`/loops/${id}`, { name }),
  remove: id => api.delete(`/loops/${id}`),
  saveVersion: (id, layout, note) => api.post(`/loops/${id}/versions`, { layout, note }),
  publish: id => api.post(`/loops/${id}/publish`, {}),
  unpublish: id => api.post(`/loops/${id}/unpublish`, {}),
}

/** Who the caller is, and the plant they arrived in. */
export const meApi = { get: () => api.get('/me') }

/**
 * The foundry's database, as SandMan described it in the launch: its name, its
 * tables and their columns. Names only — nothing here is a connection, and the
 * browser holds no credentials for it. It is what the tag dropdowns are built
 * from.
 */
export const databaseApi = { get: () => api.get('/database') }

/**
 * Plant databases an administrator registered.
 *
 * Unlike the foundry's own database, these are ones the server connects to
 * itself. The browser never sees a password or a private key — it can set one
 * and never read it back — and every one of these calls is refused for anybody
 * who is not an administrator.
 */
export const connectionApi = {
  /** What a connection may be: the engines, and the port each one listens on. */
  engines: () => api.get('/connections/engines'),
  list: () => api.get('/connections'),
  create: body => api.post('/connections', body),
  update: (id, body) => api.patch(`/connections/${id}`, body),
  remove: id => api.delete(`/connections/${id}`),
  /** Try settings that have not been saved. Stores nothing, changes nothing. */
  try: body => api.post('/connections/test', body),
  test: id => api.post(`/connections/${id}/test`, {}),
  schema: id => api.get(`/connections/${id}/schema`),
  keypair: id => api.post(`/connections/${id}/keypair`, {}),
}

/** The equipment catalogue, which the studio's own library is checked against. */
export const assetApi = { list: () => api.get('/assets') }
