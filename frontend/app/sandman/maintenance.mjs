import { api } from './api.mjs'
import { peek } from './studio.mjs'

/**
 * Maintenance and machine QR codes, from the server rather than the drawing.
 *
 * The studio keeps maintenance in `DOC.maint` and used to save it only inside
 * the drawing's version — which an operator cannot save and a phone cannot
 * reach. The record now lives in its own tables (see backend
 * `routes/maintenance.js`), and this is the seam, in the shape of `sops.mjs`:
 *
 *   on open    the server's record is written over `DOC.maint`, so every
 *              renderer the studio already has shows stored data untouched. A
 *              loop whose maintenance predates these tables is uploaded once.
 *   on change  the studio calls `save()` after every edit, which fires
 *              `dl:docsaved`; changes go up a moment later, so a job logged on
 *              the desktop is in the database in about a second — for anybody
 *              who may open the loop, not only an administrator.
 *   meanwhile  work logged from a phone (scanning a machine's QR) is pulled in
 *              every half minute and merged without disturbing anything being
 *              typed.
 *
 * The same module registers each piece of equipment with the server, which is
 * what makes its QR code work: the token the studio mints when the equipment is
 * drawn is confirmed there, and the sticker opens `<address>/m/<token>`.
 */

let loopId = null
let admin = false
/** True once the server's record has been read; nothing may be removed before. */
let adopted = false
/** What was last sent for each log entry / plan / part, to send only changes. */
let sent = new Map()
let pushTimer = 0
let pullTimer = 0
let chain = Promise.resolve()
let registeredKey = ''

const doc = () => peek('DOC')
const call = (name, ...args) => {
  try { return window[name]?.(...args) } catch (error) { console.error(`${name} failed:`, error); return undefined }
}

/** Where phones should be sent: the public address if set, else where this page is. */
function cardBase(publicUrl) {
  if (publicUrl) return publicUrl
  return new URL('.', document.baseURI).href.replace(/\/+$/, '')
}

const sig = value => JSON.stringify(value)

/** Everything on `DOC.maint` that is not the log, as the server stores it. */
const bodyOf = (m, full) => ({
  cfg: m.cfg, meters: m.meters, seq: m.seq || 0, assets: m.assets || {},
  plans: m.plans, parts: m.parts, team: m.team,
  log: m.log.filter(entry => full || sent.get(`w:${entry.id}`) !== sig(entry)),
})

const remember = m => {
  sent = new Map()
  m.log.forEach(e => sent.set(`w:${e.id}`, sig(e)))
  m.plans.forEach(p => sent.set(`p:${p.id}`, sig(p)))
  m.parts.forEach(p => sent.set(`s:${p.id}`, sig(p)))
}

const hasAny = m => !!(m && (m.plans?.length || m.log?.length || m.team?.length || m.parts?.length ||
  Object.keys(m.assets || {}).length))

/** Send a body, adopt any renumbering, remember what went. */
async function upload(body, replace) {
  const reply = await api.put(`/maintenance/${encodeURIComponent(loopId)}`, { ...body, replace })
  const m = doc()?.maint
  if (!m) return reply
  for (const [id, no] of Object.entries(reply.renumbered || {})) {
    const entry = m.log.find(e => e.id === id)
    if (entry) entry.no = no
  }
  m.seq = Math.max(m.seq || 0, reply.seq || 0)
  return reply
}

/* ------------------------------------------------------------ reading ----- */

/**
 * Put the stored record on screen. Called once a loop is open.
 *
 * Failing is not fatal: the drawing's own copy still reads, and `adopted`
 * stays false so nothing is ever deleted from the server on the strength of a
 * read that did not happen.
 */
export async function adopt(id, { isAdmin: canDesign = false } = {}) {
  stop()
  loopId = id || null
  admin = !!canDesign
  adopted = false
  if (!loopId) return { adopted: false }

  let answer
  try {
    answer = await api.get(`/maintenance?loopId=${encodeURIComponent(loopId)}`)
  } catch (error) {
    console.error('Reading the maintenance record failed:', error)
    return { adopted: false, error: error.message }
  }

  const d = doc()
  if (!d) return { adopted: false }
  call('mntDoc')
  const local = d.maint

  if (!hasAny(answer)) {
    // Nothing stored yet. A loop with maintenance in its drawing is uploaded once.
    if (hasAny(local)) {
      try {
        await upload(bodyOf(local, true), false)
      } catch (error) {
        console.error('Uploading the maintenance record failed:', error)
        return { adopted: false, error: error.message }
      }
    }
  } else {
    // The server's record wins; log entries only this studio has are kept and sent.
    const known = new Set(answer.log.map(e => e.id))
    const onlyHere = (local.log || []).filter(e => !known.has(e.id))
    Object.assign(local, {
      plans: answer.plans, team: answer.team, parts: answer.parts, assets: answer.assets,
      meters: answer.meters, cfg: { ...local.cfg, ...answer.cfg }, seq: Math.max(local.seq || 0, answer.seq || 0),
      log: [...answer.log, ...onlyHere],
    })
  }
  remember(local)
  sent.set('rest', sig([local.cfg, local.meters, local.assets, local.team, local.plans.map(p => p.id), local.parts.map(p => p.id)]))
  adopted = true

  await registerEquipment({ pull: true })
  call('mntCheck')
  redrawIfIdle()
  startTimers()
  return { adopted: true, plans: local.plans.length, log: local.log.length }
}

/** The maintenance window, redrawn only if nobody is in the middle of a form. */
function redrawIfIdle() {
  if (!document.getElementById('mntW')) return
  if (document.querySelector('#mntW .mnt-form, #mntPF .mnt-form')) return
  call('mntRender')
}

/**
 * Work logged elsewhere — a phone, another studio — merged in.
 *
 * Anything this studio has changed and not yet sent is left alone; the next
 * push carries it and the server's rules (later "last done" wins, stock by
 * revision, a cancelled entry is final) settle the rest.
 */
async function pull() {
  if (!loopId || !adopted) return
  let answer
  try {
    answer = await api.get(`/maintenance?loopId=${encodeURIComponent(loopId)}`)
  } catch {
    return
  }
  const d = doc()
  const m = d?.maint
  if (!m || loopId !== answer.loopId) return

  let changed = false
  const clean = (key, value) => sent.get(key) === sig(value)

  for (const e of answer.log) {
    const at = m.log.findIndex(x => x.id === e.id)
    if (at < 0) { m.log.push(e); sent.set(`w:${e.id}`, sig(e)); changed = true; continue }
    const mine = m.log[at]
    if ((e.rev || 0) > (mine.rev || 0) && clean(`w:${e.id}`, mine)) {
      m.log[at] = e; sent.set(`w:${e.id}`, sig(e)); changed = true
    }
  }
  for (const p of answer.plans) {
    const at = m.plans.findIndex(x => x.id === p.id)
    if (at < 0) continue
    if (clean(`p:${p.id}`, m.plans[at]) && sig(m.plans[at]) !== sig(p)) {
      m.plans[at] = p; sent.set(`p:${p.id}`, sig(p)); changed = true
    }
  }
  for (const q of answer.parts) {
    const at = m.parts.findIndex(x => x.id === q.id)
    if (at < 0) continue
    if (clean(`s:${q.id}`, m.parts[at]) && sig(m.parts[at]) !== sig(q)) {
      m.parts[at] = q; sent.set(`s:${q.id}`, sig(q)); changed = true
    }
  }
  m.seq = Math.max(m.seq || 0, answer.seq || 0)

  if (changed) {
    call('mntCheck')
    redrawIfIdle()
    window.dispatchEvent(new CustomEvent('dl:maintenance-pulled'))
  }
}

/* ------------------------------------------------------------ writing ----- */

/** A change was saved in the studio: send it shortly, once, in order. */
function schedulePush() {
  if (!loopId || !adopted) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    chain = chain.catch(() => {}).then(push)
  }, 1200)
}

async function push() {
  const m = doc()?.maint
  if (!loopId || !adopted || !m) return
  const body = bodyOf(m, false)
  const dirty = body.log.length ||
    m.plans.some(p => sent.get(`p:${p.id}`) !== sig(p)) ||
    m.parts.some(p => sent.get(`s:${p.id}`) !== sig(p)) ||
    sent.get('rest') !== sig([m.cfg, m.meters, m.assets, m.team, m.plans.map(p => p.id), m.parts.map(p => p.id)])
  if (!dirty) return

  try {
    await upload(body, true)
    m.log.forEach(e => sent.set(`w:${e.id}`, sig(e)))
    m.plans.forEach(p => sent.set(`p:${p.id}`, sig(p)))
    m.parts.forEach(p => sent.set(`s:${p.id}`, sig(p)))
    sent.set('rest', sig([m.cfg, m.meters, m.assets, m.team, m.plans.map(p => p.id), m.parts.map(p => p.id)]))
  } catch (error) {
    console.error('Storing the maintenance record failed:', error)
    window.dispatchEvent(new CustomEvent('dl:maintenance-error', { detail: error.message }))
  }
}

/** Store everything now — for the Save button and before the page goes. */
export async function flush() {
  clearTimeout(pushTimer)
  chain = chain.catch(() => {}).then(push)
  return chain
}

/* ---------------------------------------------------------- equipment ----- */

/**
 * Make the server's register match the drawing, and take its tokens back.
 *
 * Administrators write the register; everybody else only reads it, so an
 * operator's studio still shows the stickers' real tokens. A token the studio
 * minted is kept by the server unless it clashes — what comes back is what is
 * printed.
 */
export async function registerEquipment({ pull: readFirst = false } = {}) {
  if (!loopId) return
  try {
    if (readFirst || !admin) {
      const read = await api.get(`/equipment?loopId=${encodeURIComponent(loopId)}`)
      window.DL_CARD_BASE = cardBase(read.publicUrl)
      call('mcApplyTokens', read.cards)
    }
    if (!admin) return

    const items = call('mcSyncPayload') || []
    const key = sig(items)
    if (key === registeredKey) return
    const reply = await api.put(`/equipment/${encodeURIComponent(loopId)}`, { items })
    registeredKey = key
    call('mcApplyTokens', reply.cards)
    window.DL_CARD_BASE = window.DL_CARD_BASE || cardBase()
  } catch (error) {
    console.error('Registering equipment failed:', error)
  }
}

let equipTimer = 0
function scheduleEquipment() {
  if (!loopId || !admin || !adopted) return
  clearTimeout(equipTimer)
  equipTimer = setTimeout(() => registerEquipment(), 2500)
}

/* ------------------------------------------------------------- timers ----- */

const onSaved = () => { schedulePush(); scheduleEquipment() }
const onVisible = () => { if (document.visibilityState === 'visible') pull(); else flush() }
const onHide = () => { clearTimeout(pushTimer); push() }

function startTimers() {
  document.addEventListener('dl:docsaved', onSaved)
  document.addEventListener('visibilitychange', onVisible)
  addEventListener('pagehide', onHide)
  clearInterval(pullTimer)
  pullTimer = setInterval(() => { if (document.visibilityState === 'visible') pull() }, 30_000)
}

export function stop() {
  clearTimeout(pushTimer)
  clearTimeout(equipTimer)
  clearInterval(pullTimer)
  document.removeEventListener('dl:docsaved', onSaved)
  document.removeEventListener('visibilitychange', onVisible)
  removeEventListener('pagehide', onHide)
  adopted = false
  registeredKey = ''
}

export const status = () => ({ loopId, adopted, admin, base: window.DL_CARD_BASE || null })
