import { api } from './api.mjs'
import { peek } from './studio.mjs'

/**
 * Tickets, alert days, engineered-alert history and the email log, from the
 * server rather than the drawing.
 *
 * The studio keeps them in `DOC.tk` (list, days, mins, dlog) and `DOC.eng`
 * (log, outbox). Those change all day from the Publish view, where operators
 * cannot save the drawing, and must be the same on every screen — so they live
 * in their own tables (backend `routes/alert-records.js`), and this is the
 * seam, in the shape of `maintenance.mjs`:
 *
 *   on open    the server's records are written over the studio's, so every
 *              screen the studio already has (Tickets, Alert history, Sent
 *              emails) shows stored data untouched. A loop whose records predate
 *              these tables uploads them once.
 *   every 5 s  what changed here is sent — only what changed.
 *   every 20 s what other screens changed is pulled in, without overwriting
 *              anything changed here and not yet sent.
 *
 * The server merges (see services/alert-store.js): it issues ticket numbers,
 * keeps every screen's ticket history, combines alert days, and turns a second
 * screen's copy of the same open alert into the one already stored.
 */

let loopId = null
let adopted = false
let sent = new Map()
let pushTimer = 0
let pullTimer = 0
let chain = Promise.resolve()
/** The backend is checking alerts and emailing itself (services/alert-checker.js). */
let serverChecks = false
export const serverIsChecking = () => serverChecks

const sig = value => JSON.stringify(value)
export const LEFT = 'left to the server'
const rid = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const call = name => {
  const f = peek(name)
  return typeof f === 'function' ? f() : null
}
const tk = () => call('tkDoc')
const eng = () => call('engDoc')

const dayKeys = T => [...new Set([...Object.keys(T.days || {}), ...Object.keys(T.mins || {}), ...Object.keys(T.dlog || {})])]
const dayRec = (T, k) => ({ days: (T.days || {})[k] || [], mins: (T.mins || {})[k] || {}, dlog: (T.dlog || {})[k] || {} })
function putDay(T, k, rec) {
  T.days = T.days || {}
  T.mins = T.mins || {}
  T.dlog = T.dlog || {}
  T.days[k] = rec.days || []
  T.mins[k] = rec.mins || {}
  T.dlog[k] = rec.dlog || {}
}

/** The same merge the server does (services/alert-store.js › mergeDays). */
function mergeDays(a = {}, b = {}) {
  const days = [...new Set([...(a.days || []), ...(b.days || [])])].sort().slice(-60)
  const mins = { ...(a.mins || {}) }
  for (const [d, n] of Object.entries(b.mins || {})) mins[d] = Math.max(+mins[d] || 0, +n || 0)
  const dlog = { ...(a.dlog || {}) }
  for (const [d, e] of Object.entries(b.dlog || {})) if (!dlog[d] || (+e?.mins || 0) >= (+dlog[d]?.mins || 0)) dlog[d] = e
  return { days, mins, dlog }
}

/** Every ticket and email gets an id of its own, once — what the server keys them by. */
function ensureIds(T, E) {
  T.list.forEach(t => { if (!t.id) t.id = rid('tk') })
  ;(E.outbox || []).forEach(o => { if (!o.id) o.id = rid('m') })
}

/** What changed since it was last sent (or everything), with the signatures to remember once it is stored. */
function collect(full) {
  const T = tk(), E = eng()
  if (!T || !E) return null
  ensureIds(T, E)
  const sigs = new Map()
  const pick = (prefix, id, value) => {
    const s = sig(value)
    if (!full && sent.get(prefix + id) === s) return false
    sigs.set(prefix + id, s)
    return true
  }
  const tickets = T.list.filter(t => pick('t:', t.id, t))
  const days = {}
  for (const k of dayKeys(T)) {
    const r = dayRec(T, k)
    if (pick('d:', k, r)) days[k] = r
  }
  const events = (E.log || []).filter(e => e && e.id && e.rule && pick('e:', e.id, e))
  // An email still being handed to SandMan is sent once it has its outcome.
  // A screen's email left to the server is not logged: the server logs the one it sent.
  const mails = (E.outbox || []).filter(m => m && m.id && m.status !== 'sending…' && m.status !== LEFT && pick('m:', m.id, m))
  const count = tickets.length + Object.keys(days).length + events.length + mails.length
  return { body: { tickets, days, events, mails }, sigs, count }
}

/** Fix up a ticket number on screen (the open ticket panel follows its number). */
function renumber(t, no) {
  const TKS = peek('TKS')
  if (TKS && TKS.sel === t.no) TKS.sel = no
  t.no = no
}

async function upload(full, first = false) {
  const got = collect(full)
  if (!got || (!got.count && !full)) return
  const reply = await api.put(`/alert-records/${encodeURIComponent(loopId)}`, { ...got.body, first })
  const T = tk(), E = eng()
  for (const [k, s] of got.sigs) sent.set(k, s)
  for (const [id, no] of Object.entries(reply.renumbered || {})) {
    const t = T.list.find(x => x.id === id)
    if (t) { renumber(t, no); sent.set('t:' + id, sig(t)) }
  }
  for (const [id, server] of Object.entries(reply.mergedTickets || {})) {
    const at = T.list.findIndex(x => x.id === id)
    if (at < 0) continue
    const TKS = peek('TKS')
    if (TKS && TKS.sel === T.list[at].no) TKS.sel = server.no
    if (T.list.some(x => x.id === server.id)) T.list.splice(at, 1)
    else T.list[at] = server
    sent.set('t:' + server.id, sig(server))
  }
  for (const [id, serverId] of Object.entries(reply.mergedEvents || {})) {
    const e = (E.log || []).find(x => x.id === id)
    if (e) { e.id = serverId; sent.set('e:' + serverId, sig(e)) }
  }
  T.seq = Math.max(+T.seq || 0, +reply.seq || 0)
}

/* ------------------------------------------------------------ reading ----- */

const empty = a => !a.tickets.length && !a.events.length && !a.mails.length && !Object.keys(a.days || {}).length

/** Put the stored records on screen. Called once a loop is open. */
export async function adopt(id) {
  stop()
  loopId = id || null
  adopted = false
  sent = new Map()
  if (!loopId) return { adopted: false }
  let answer
  try {
    answer = await api.get(`/alert-records?loopId=${encodeURIComponent(loopId)}`)
  } catch (error) {
    console.error('Reading the alert records failed:', error)
    return { adopted: false, error: error.message }
  }
  serverChecks = !!answer.serverChecks
  const T = tk(), E = eng()
  if (!T || !E || answer.loopId !== loopId) return { adopted: false }

  if (empty(answer)) {
    // Nothing stored yet: a loop that kept tickets in its drawing uploads them once.
    try {
      await upload(true, true)
    } catch (error) {
      console.error('Uploading the alert records failed:', error)
      return { adopted: false, error: error.message }
    }
  } else {
    // The server is the record. What the drawing carried is an old copy of it.
    T.list = answer.tickets
    T.days = {}
    T.mins = {}
    T.dlog = {}
    for (const [k, rec] of Object.entries(answer.days)) putDay(T, k, rec)
    E.log = answer.events
    E.outbox = answer.mails
    T.seq = Math.max(+T.seq || 0, +answer.seq || 0)
    collect(true).sigs.forEach((s, k) => sent.set(k, s))
  }
  adopted = true
  redraw()
  startTimers()
  return { adopted: true, tickets: T.list.length }
}

/** Screens that show the records, redrawn if nobody is typing in them. */
function redraw() {
  const box = document.getElementById('tkBox')
  if (box && typeof peek('tkPageRender') === 'function') peek('tkPageRender')()
}

/** Other screens' changes, merged in. Anything changed here and not yet sent is left alone. */
async function pull() {
  if (!loopId || !adopted) return
  let answer
  try {
    answer = await api.get(`/alert-records?loopId=${encodeURIComponent(loopId)}`)
  } catch {
    return
  }
  serverChecks = !!answer.serverChecks
  const T = tk(), E = eng()
  if (!T || !E || answer.loopId !== loopId) return
  let changed = false
  const clean = (key, value) => sent.get(key) === sig(value)
  E.log = E.log || []
  E.outbox = E.outbox || []

  for (const s of answer.tickets) {
    const at = T.list.findIndex(x => x.id === s.id)
    if (at < 0) { T.list.unshift(s); sent.set('t:' + s.id, sig(s)); changed = true; continue }
    const mine = T.list[at]
    if ((+s.rev || 0) > (+mine.rev || 0) && clean('t:' + s.id, mine)) {
      T.list[at] = s
      sent.set('t:' + s.id, sig(s))
      changed = true
    }
  }
  for (const [k, rec] of Object.entries(answer.days)) {
    const mine = dayRec(T, k)
    const merged = mergeDays(mine, rec)
    if (sig(merged) !== sig(mine)) {
      putDay(T, k, merged)
      changed = true
    }
  }
  for (const [list, prefix, items] of [[E.log, 'e:', answer.events], [E.outbox, 'm:', answer.mails]]) {
    for (const s of items) {
      const at = list.findIndex(x => x && x.id === s.id)
      if (at < 0) { list.push(s); sent.set(prefix + s.id, sig(s)); changed = true; continue }
      if (clean(prefix + s.id, list[at]) && sig(list[at]) !== sig(s)) {
        list[at] = s
        sent.set(prefix + s.id, sig(s))
        changed = true
      }
    }
  }
  E.log.sort((a, b) => (+b.start || 0) - (+a.start || 0))
  E.outbox.sort((a, b) => (+b.t || 0) - (+a.t || 0))
  E.outbox.length = Math.min(E.outbox.length, 300)
  T.seq = Math.max(+T.seq || 0, +answer.seq || 0)
  if (changed) redraw()
}

/* ------------------------------------------------------------ writing ----- */

async function push() {
  if (!loopId || !adopted) return
  try {
    await upload(false)
  } catch (error) {
    console.error('Storing the alert records failed:', error)
  }
}

/** Store everything now — before the page goes. */
export function flush() {
  chain = chain.catch(() => {}).then(push)
  return chain
}

/**
 * A saved drawing does not carry the records: the tables hold them, and a
 * copy in each version would be an older truth. Only once they are stored here.
 */
export function stripFromLayout(document_) {
  if (!adopted || !document_?.DOC) return document_
  const { tk: T, eng: E } = document_.DOC
  if (T) for (const k of ['list', 'days', 'mins', 'dlog']) delete T[k]
  if (E) for (const k of ['log', 'outbox']) delete E[k]
  return document_
}

const onHide = () => { push() }
const onSaved = () => {
  clearTimeout(onSaved.t)
  onSaved.t = setTimeout(flush, 1000)
}

function startTimers() {
  addEventListener('pagehide', onHide)
  document.addEventListener('dl:docsaved', onSaved)
  clearInterval(pushTimer)
  clearInterval(pullTimer)
  pushTimer = setInterval(flush, 5000)
  pullTimer = setInterval(() => { if (document.visibilityState === 'visible') pull() }, 20_000)
}

export function stop() {
  clearInterval(pushTimer)
  clearInterval(pullTimer)
  removeEventListener('pagehide', onHide)
  document.removeEventListener('dl:docsaved', onSaved)
  adopted = false
}

export const status = () => ({ loopId, adopted })
