import { db, transaction } from '../config/db.js'
import { linkedTags, externalTags } from './live-tags.js'
import { cachedValues } from './live-cache.js'
import { readValues, sendMail, isOnline } from './sandman.js'
import { latestValues } from './db-connect.js'
import { LoopEngine, engineError } from './alert-engine.js'
import { writeAlertRecords, CLOSED } from './alert-store.js'

/**
 * SERVER-SIDE ALERT CHECKER
 *
 * Alerts used to happen only while a screen had the loop open in the Publish
 * view: the browser read the values, decided, emailed and counted ticket days.
 * With every screen closed — nights, weekends, a control-room PC switched off —
 * nothing was checked. This does the same work in the backend, every 30 s, for
 * every published loop, with nobody signed in:
 *
 *   1. read the loop's linked readings exactly as the screens do (through
 *      SandMan, sharing the same 30 s cache, plus registered databases);
 *   2. work out ƒx fields and engineered alerts with the studio's own code
 *      (services/alert-engine.js), and tag / ƒx LL / HH limits;
 *   3. email through SandMan to the teams set in Administration — process zone
 *      routing, the per-alert Email switch, the repeat minutes, Critical only
 *      for tags (as the studio);
 *   4. record the alert history and the email log, count ticket days, create
 *      and reopen tickets — the same rows the screens read (alert-store.js).
 *
 * Only real readings can alert: a reading not linked to a database has no value
 * here and is never simulated. While this runs, screens leave emailing to it
 * (`serverChecking()` → alert-records GET → alert-mail.mjs), so nobody is told
 * twice; tickets and history from both meet in the same merged rows.
 *
 * DL_ALERT_CHECKS=0 switches it off; DL_ALERT_CHECK_MS sets the interval.
 */

const EVERY = Math.max(10_000, Number(process.env.DL_ALERT_CHECK_MS) || 30_000)
const ENABLED = process.env.DL_ALERT_CHECKS !== '0'
const SEVN = ['', 'Advisory', 'Warning', 'Critical']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

let timer = null
let busy = false
let lastDone = 0
export const serverChecking = () => ENABLED && !engineError() && Date.now() - lastDone < EVERY * 3

/** Per loop: the evaluation context for its published version, and each alert's state. */
const LOOPS = new Map()

export function startAlertChecker() {
  if (!ENABLED || timer) return
  const run = () => cycle().catch(error => console.error(`   !  alert checker: ${error.message}`))
  timer = setInterval(run, EVERY)
  timer.unref?.()
  setTimeout(run, 5000).unref?.()
  console.log(`   ·  alert checker: every ${EVERY / 1000} s`)
}
export function stopAlertChecker() {
  clearInterval(timer)
  timer = null
}

/** One pass over every published loop. Exported for tests. */
export async function cycle() {
  if (busy) return
  busy = true
  try {
    if (engineError()) return
    if (!(await isOnline())) return // SandMan down: no readings, so nothing to decide on
    const loops = await db.prepare(
      `SELECT d.id, d.foundry_id, d.line_id, d.name, d.published_version_id, f.database_name
         FROM design d LEFT JOIN foundry_info f ON f.foundry_id = d.foundry_id
        WHERE d.status = 'published' AND d.published_version_id IS NOT NULL`
    ).all()
    for (const loop of loops) {
      try {
        await checkLoop(loop)
      } catch (error) {
        console.error(`   !  alert check of loop ${loop.id}: ${error.message}`)
      }
    }
    lastDone = Date.now()
  } finally {
    busy = false
  }
}

/* --------------------------------------------------------------- readings */

async function readingsOf(loop, layout) {
  const tags = linkedTags(layout, loop.database_name)
  const external = externalTags(layout)
  const values = {}
  if (tags.length) {
    const foundry = String(loop.foundry_id), line = String(loop.line_id)
    const got = await cachedValues(foundry, line, tags, () => readValues({ foundry, line, tags }))
    Object.assign(values, got?.values || {})
  }
  for (const [connectionId, list] of external) {
    const row = await db.prepare('SELECT * FROM db_connection WHERE id = ?').get(connectionId)
    if (!row || (row.foundry_id && String(row.foundry_id) !== String(loop.foundry_id))) continue
    try {
      Object.assign(values, (await latestValues(row, list)).values || {})
    } catch {
      // that database is unreachable this time; its readings simply have no value
    }
  }
  return { values, any: tags.length > 0 || external.size > 0 }
}

/**
 * The last value of every reading, for the QR sticker pages (machine and category), which have no session to ask
 * SandMan with. Screens store these while they poll; this stores them with no screen open — real plant values and
 * the ƒx results worked out from them, never a simulated number.
 */
async function storeReadings(loopId, values, E) {
  const stamp = new Date().toISOString()
  const rows = []
  for (const [tag, v] of Object.entries(values || {})) {
    if (!v || v.value === null || v.value === undefined) continue
    const n = typeof v.value === 'number' ? v.value : Number(v.value)
    const isNum = Number.isFinite(n) && String(v.value).trim() !== ''
    rows.push([loopId, String(tag).slice(0, 160), isNum ? n : null, isNum ? null : String(v.value).slice(0, 200), v.recordedAt ? String(v.recordedAt).slice(0, 60) : null, stamp])
  }
  for (const c of Array.isArray(E.DOC.calc) ? E.DOC.calc : []) {
    for (const I of E.sandbox.ctInstances(c)) {
      const v = E.value(I.id)
      if (v != null) rows.push([loopId, String(I.id).slice(0, 160), v, null, null, stamp])
    }
  }
  for (const r of rows) {
    await db.prepare(
      `INSERT INTO tag_reading (design_id, tag_id, num_value, text_value, recorded_at, read_at) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE num_value = VALUES(num_value), text_value = VALUES(text_value),
         recorded_at = VALUES(recorded_at), read_at = VALUES(read_at)`
    ).run(...r)
  }
}

/* ------------------------------------------------------------------ zones */

/** Which process area (area box) each piece of equipment is in — saved by the studio, else from positions. */
function zoneIndex(DOC) {
  const zones = (DOC.blocks || []).filter(b => b.type === 'areaBox')
  const name = z => String(z?.props?.text || z?.name || 'Area').trim()
  const saved = DOC.zoneMap && typeof DOC.zoneMap === 'object' ? DOC.zoneMap : null
  const of = new Map()
  for (const b of DOC.blocks || []) {
    if (b.type === 'areaBox') continue
    let z = saved && saved[b.id] ? zones.find(x => x.id === saved[b.id]) : null
    if (!z && !saved) {
      const cx = b.x + (b.w || 60) / 2, cy = b.y + (b.h || 60) / 2
      z = zones.find(a => cx >= a.x && cx <= a.x + (a.w || 0) && cy >= a.y && cy <= a.y + (a.h || 0)) || null
    }
    if (z) of.set(b.id, { id: z.id, name: name(z) })
  }
  return of
}

/* ------------------------------------------------------------------ check */

async function checkLoop(loop) {
  let L = LOOPS.get(loop.id)
  if (!L || L.versionId !== loop.published_version_id) {
    const row = await db.prepare('SELECT layout FROM design_version WHERE id = ?').get(loop.published_version_id)
    if (!row) return
    const layout = JSON.parse(row.layout)
    L = { versionId: loop.published_version_id, layout, engine: new LoopEngine(layout), state: new Map(), days: new Map() }
    L.zones = zoneIndex(L.engine.DOC)
    LOOPS.set(loop.id, L)
  }
  const { values, any } = await readingsOf(loop, L.layout)
  if (!any) return
  const at = Date.now()
  const E = L.engine
  E.update(values, at)
  E.calcs(at)
  const DOC = E.DOC, REG = E.REG
  await storeReadings(loop.id, values, E)
  const st = key => L.state.get(key) || (L.state.set(key, { on: false }), L.state.get(key))

  /* what is active now */
  const found = new Map()
  const owner = new Map()
  for (const b of DOC.blocks) for (const bt of b.tags) if (!owner.has(bt.id)) owner.set(bt.id, b)
  for (const [id, t] of Object.entries(REG)) {
    if (!t || (t.ll == null && t.hh == null)) continue
    const v = E.value(id)
    if (v == null) continue
    const b = owner.get(id) || (t.calc && t.host ? E.sandbox.B(t.host) : null)
    if (!b && !t.calc) continue
    if (b && b.props.oos) continue
    const out = (t.ll != null && v < +t.ll) || (t.hh != null && v > +t.hh)
    if (out) found.set('lim:' + id, { kind: t.calc ? 'calc' : 'limit', sev: 3, name: t.short || t.desc || id, equip: b ? b.id : null, tagId: id, v, t, vals: { [t.short || t.desc || id]: v } })
  }
  for (const r of DOC.eng.rules) {
    if (!r || !r.on || !r.id) continue
    const key = 'eng:' + r.id, S = st(key)
    const ev = E.engineered(r)
    if (ev.ok) {
      if (S.okSince == null) S.okSince = at
      if (at - S.okSince >= (+r.dur || 0) * 1000) {
        const vals = {}
        for (const k of ['A', 'B', 'C', 'D']) if (r.vars && r.vars[k] && REG[r.vars[k]]) vals[REG[r.vars[k]].short || REG[r.vars[k]].desc || k] = ev.V[k]
        found.set(key, { kind: 'eng', sev: ev.sev, name: r.name || 'Engineered alert', equip: r.equip, rule: r, vals, V: ev.V })
      }
    } else S.okSince = null
  }

  /* starts, escalations, clears */
  for (const [key, a] of found) {
    const S = st(key)
    if (!S.on) {
      Object.assign(S, { on: true, since: at, sev: a.sev, a })
      await started(loop, L, key, a, at, 'start')
    } else if (a.sev > S.sev) {
      S.sev = a.sev
      await started(loop, L, key, a, at, 'worse')
    }
    S.a = a
    await countDay(loop, L, key, a, at)
  }
  for (const [key, S] of L.state) {
    if (S.on && !found.has(key)) {
      S.on = false
      await cleared(loop, L, key, S, at)
    }
  }
}

/* ----------------------------------------------------------------- events */

async function store(loopId, body) {
  return transaction(tx => writeAlertRecords(tx, loopId, body))
}

async function started(loop, L, key, a, at, what) {
  const S = L.state.get(key)
  if (a.kind === 'eng' && what === 'start') {
    const id = 'ea' + at.toString(36) + a.rule.id
    const reply = await store(loop.id, {
      events: [{ id, rule: a.rule.id, name: a.name, equip: a.equip, sev: a.sev, start: at, vals: a.V, teams: {}, hits: 1, by: 'server' }],
    })
    S.eventId = (reply.mergedEvents && reply.mergedEvents[id]) || id
    S.eventStart = at
  }
  // tags and ƒx email only when Critical (outside LL / HH); an engineered alert whenever it fires
  if (a.kind !== 'eng' && a.sev < 3) return
  await email(loop, L, key, a, at, what)
}

async function cleared(loop, L, key, S, at) {
  if (S.eventId) {
    await store(loop.id, { events: [{ id: S.eventId, rule: key.slice(4), start: S.eventStart, cleared: at }] })
    S.eventId = null
  }
  // a ticket closed while this alert was still on may reopen once it has come back
  const rows = await db.prepare(
    `SELECT * FROM alert_ticket WHERE design_id = ? AND alert_key = ? AND status IN (${CLOSED.map(() => '?').join(',')})`
  ).all(loop.id, key, ...CLOSED)
  const fix = rows.map(r => ({ ...JSON.parse(r.doc), id: r.id, status: r.status })).filter(t => t.closedActive)
  if (fix.length) await store(loop.id, { tickets: fix.map(t => ({ ...t, closedActive: null })) })
  const R = L.engine.DOC.route || {}
  if (R.set && R.set.cleared && S.a) await email(loop, L, key, S.a, at, 'clear')
}

/* ------------------------------------------------------------------ email */

function teamsOf(DOC) {
  return (DOC.eng && Array.isArray(DOC.eng.teams) ? DOC.eng.teams : []).map(t => ({
    ...t,
    recips: Array.isArray(t.recips) ? t.recips : t.email ? String(t.email).split(/[,;\s]+/).filter(Boolean).map(e => ({ email: e, on: true })) : [],
  }))
}
const emailsOf = t => (t && t.on !== false ? t.recips.filter(r => r.on !== false && EMAIL.test(String(r.email || '').trim())).map(r => r.email.trim().toLowerCase()) : [])

function catOf(t) {
  if (!t) return 'process'
  const s = `${t.id} ${t.desc || ''} ${t.short || ''} ${t.unit || ''}`.toLowerCase()
  if (t.lab || /moist|compact|gcs|green comp|perm|active clay|\bac\b|loi|vcm|bentonite|strength|afs|spall|inoculant|chemistry|carbon|silicon/.test(s)) return 'quality'
  if (/current|\bamps?\b|power|\bkw\b|motor|fault|trip|vibr|bearing|overload|inverter|lube|oil|hydraul|running|stopped|lamp|door/.test(s)) return 'equipment'
  return 'process'
}

/** Who is told: zone routing (Who gets emails), plus an engineered alert's own email teams. */
function recipients(L, key, a, sev) {
  const DOC = L.engine.DOC
  const R = DOC.route || {}
  if (R.mute && R.mute[key]) return { to: [], teams: [] }
  const zone = a.equip ? L.zones.get(a.equip) : null
  const kind = a.kind === 'eng' ? 'eng' : 'limit'
  const cat = R.cat && a.tagId && R.cat[a.tagId] ? R.cat[a.tagId] : a.kind === 'eng' && !a.tagId ? 'process' : catOf(L.engine.REG[a.tagId])
  const rules = Array.isArray(R.rules) ? R.rules : []
  const specific = rules.filter(r => r.alert && r.alert === key && r.on !== false && (+r.sev || 1) <= sev)
  const list = specific.length ? specific : rules.filter(r => !r.alert && r.on !== false && (!r.zone || r.zone === (zone && zone.id)) &&
    (!r.kind || r.kind === kind) && (+r.sev || 1) <= sev && (!r.cat || r.cat === cat))
  const names = new Set(list.flatMap(r => r.teams || []))
  if (zone && R.zoneOff && R.zoneOff[zone.id]) names.clear()
  if (a.kind === 'eng') for (const tm of a.rule.teams || []) if ((tm.ch || []).includes('email')) names.add(tm.team)
  const T = teamsOf(DOC)
  const teams = [...names].map(n => T.find(t => t.name === n || t.id === n)).filter(Boolean)
  return { to: [...new Set(teams.flatMap(emailsOf))], teams: teams.map(t => t.name), zone }
}

/** Was this alert emailed (by the server or a screen) within its repeat minutes? */
async function emailedRecently(loop, L, key, at) {
  const R = L.engine.DOC.route || {}
  const own = R.repeat && +R.repeat[key]
  const mins = own > 0 ? own : +(R.set && R.set.repeatMin) || 30
  const since = new Date(at - mins * 60000).toISOString()
  const rule = key.startsWith('eng:') ? key.slice(4) : null
  const row = await db.prepare(
    `SELECT id FROM alert_mail WHERE design_id = ? AND queued_at >= ?
       AND (alert_key = ? OR (? IS NOT NULL AND alert_key LIKE 'ea%' AND alert_key LIKE ?))
       AND subject NOT LIKE '[Back to normal]%' LIMIT 1`
  ).get(loop.id, since, key, rule, rule ? '%' + rule : '')
  return !!row
}

async function email(loop, L, key, a, at, what) {
  const sev = what === 'clear' ? Math.max(a.sev, 1) : a.sev
  const { to, teams, zone } = recipients(L, key, a, sev)
  if (!to.length) return
  if (what === 'start' && (await emailedRecently(loop, L, key, at))) return
  const DOC = L.engine.DOC, REG = L.engine.REG
  const b = a.equip ? L.engine.sandbox.B(a.equip) : null
  const where = [zone && zone.name, b && b.name].filter(Boolean).join(' · ')
  const subject = what === 'clear'
    ? `[Back to normal] ${a.name} — ${(zone && zone.name) || where}`
    : `[${SEVN[sev] || 'Alert'}] ${a.name} — ${(zone && zone.name) || where}`
  const lines = [subject, '', `Alert     : ${a.name}`, `Where     : ${where || '—'}`,
    `Type      : ${a.kind === 'eng' ? 'Engineered alert' : a.kind === 'calc' ? 'ƒx calculated field' : 'Limit alarm'}`, `Severity  : ${SEVN[sev] || ''}`]
  if (a.kind === 'eng') {
    lines.push(`Values    : ${Object.entries(a.vals).map(([k, v]) => `${k} ${v == null ? '—' : +(+v).toFixed(3)}`).join(' · ') || '—'}`)
    if (a.rule.cause) lines.push(`Cause     : ${a.rule.cause}`)
    if (a.rule.action) lines.push(`Action    : ${a.rule.action}`)
  } else {
    const t = REG[a.tagId] || {}
    const side = a.v > +t.hh ? `above the limit (${t.hh}${t.unit ? ' ' + t.unit : ''})` : `below the limit (${t.ll}${t.unit ? ' ' + t.unit : ''})`
    lines.push(`Value     : ${+(+a.v).toFixed(t.d != null ? t.d : 2)}${t.unit ? ' ' + t.unit : ''}${what === 'clear' ? '' : ' — ' + side}`)
  }
  lines.push(`Time      : ${new Date(at).toLocaleString('en-GB')}`, `Sent to   : ${teams.join(', ')}`, '', 'Checked by the Digital Loop server.')
  const text = lines.join('\n')
  let status, sent = [], refused = {}
  try {
    const reply = await sendMail({ foundry: String(loop.foundry_id), line: String(loop.line_id), to, subject, text })
    sent = reply.sent || []
    refused = reply.refused || {}
    const n = Object.keys(refused).length
    status = sent.length ? `sent by SandMan to ${sent.length}${n ? ` · not to ${n}` : ''}` : 'not sent'
  } catch (error) {
    status = `not sent: ${error.message}`
  }
  await store(loop.id, {
    mails: [{ id: 'ms' + at.toString(36) + Math.random().toString(36).slice(2, 6), t: at, ch: 'email', inst: key, rule: a.rule ? a.rule.id : undefined,
      team: teams.join(', '), to, subject, text, status, sent, refused, by: 'server' }],
  })
}

/* ---------------------------------------------------------------- tickets */

const ymd = t => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function runOf(days, at, win) {
  const set = new Set(days)
  if (win > 0) {
    const from = ymd(at - (win - 1) * 86400000)
    return [...set].filter(d => d >= from).length
  }
  let n = 0
  const d = new Date(at)
  while (set.has(ymd(d))) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}
const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
function dayLine(rec, d) {
  const x = rec.dlog && rec.dlog[d]
  const day = new Date(d + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
  if (!x) return `${day}: active (details not recorded)`
  return `${day}: first at ${hm(x.first)}, last at ${hm(x.last)}, active ${x.mins || 1} min in ${x.n || 1} episode${(x.n || 1) > 1 ? 's' : ''}`
}

/** While an alert is active: count the day, and add to / reopen / open its ticket (the studio's tkHit). */
async function countDay(loop, L, key, a, at) {
  if (a.kind !== 'eng' && a.sev < 3) return // only what is emailed makes tickets
  const DOC = L.engine.DOC
  const T = DOC.tk || {}
  const set = { days: 3, owner: 'Maintenance', ...(T.set || {}) }
  const rule = (T.rules || {})[key] || {}
  if (rule.on === false) return // tickets switched off for this alert
  const minMin = +rule.minMin > 0 ? +rule.minMin : +set.minMin > 0 ? +set.minMin : 1

  let rec = L.days.get(key)
  if (!rec) {
    const row = await db.prepare('SELECT doc FROM alert_day WHERE design_id = ? AND alert_key = ?').get(loop.id, key)
    rec = row ? JSON.parse(row.doc) : {}
    rec.days = rec.days || []
    rec.mins = rec.mins || {}
    rec.dlog = rec.dlog || {}
    L.days.set(key, rec)
  }
  const today = ymd(at), minute = Math.floor(at / 60000)
  if (rec.mins._m === minute) return // counted this minute already
  rec.mins._m = minute
  rec.mins[today] = (+rec.mins[today] || 0) + 1
  const dd = (rec.dlog[today] = rec.dlog[today] || { first: at, firstVals: a.vals, mins: 0, n: 0, worst: {} })
  if (!dd._on || at - dd.last > 120000) dd.n++
  Object.assign(dd, { _on: 1, last: at, lastVals: a.vals, mins: rec.mins[today] })
  if (!rec.days.includes(today) && rec.mins[today] >= minMin) rec.days.push(today)
  await store(loop.id, { days: { [key]: { days: rec.days, mins: rec.mins, dlog: rec.dlog } } })
  if (!rec.days.includes(today)) return

  const rows = await db.prepare('SELECT * FROM alert_ticket WHERE design_id = ? AND alert_key = ? ORDER BY created_at DESC').all(loop.id, key)
  const tickets = rows.map(r => ({ ...JSON.parse(r.doc), id: r.id, no: r.ticket_no, status: r.status }))
  const open = tickets.find(t => !CLOSED.includes(t.status))
  if (open) {
    if (open.dayNoted === today) return
    open.dayNoted = today
    open.last = at
    open.count = (+open.count || 0) + 1
    open.days = runOf(rec.days, at, +rule.win || +set.win || 0)
    open.hist = [...(open.hist || []), { t: at, by: 'System', text: 'Alert again today — ' + dayLine(rec, today), k: 'trig' }]
    await store(loop.id, { tickets: [open] })
    return
  }
  const watchDays = 3
  const back = tickets.find(t => CLOSED.includes(t.status) && !t.closedActive && at - (+t.closedAt || 0) < watchDays * 86400000)
  if (back) {
    back.status = 'progress'
    back.reopened = (+back.reopened || 0) + 1
    back.verifyUntil = null
    back.last = at
    back.hist = [...(back.hist || []), { t: at, by: 'System', text: 'Reopened — the alert fired again after closing', k: 'reopen' }]
    await store(loop.id, { tickets: [back] })
    await ticketMail(loop, L, back, `Ticket ${back.no} reopened — ${back.name}`, at)
    return
  }
  const r = a.rule
  const need = +rule.days > 0 ? +rule.days : r && +r.tkDays > 0 ? +r.tkDays : a.equip && T.eqDays && +T.eqDays[a.equip] > 0 ? +T.eqDays[a.equip] : +set.days || 3
  const win = +rule.win || +set.win || 0
  const run = runOf(rec.days, at, win)
  if (run < need) return
  const zone = a.equip ? L.zones.get(a.equip) : null
  const prio = a.sev >= 3 ? 'High' : a.sev === 2 ? 'Medium' : 'Low'
  const fixH = { High: 24, Medium: 72, Low: 168, ...((set.fixH) || {}) }[prio]
  const ackH = { High: 1, Medium: 4, Low: 8, ...((set.ackH) || {}) }[prio]
  const ownerTeam = rule.owner || (r && (r.tkOwner || (r.teams && r.teams[0] && r.teams[0].team))) || set.owner
  const counted = [...new Set(rec.days)].sort().slice(-run)
  const tk = {
    id: 'tk' + at.toString(36) + Math.random().toString(36).slice(2, 6),
    key, name: `${a.name} — recurring`, equip: a.equip, process: zone ? zone.name : '', source: 'alert', v2: 1,
    first: new Date(counted[0] + 'T00:00').getTime(), last: at, days: run, count: 1, trig: [{ t: at, vals: a.vals }],
    owner: ownerTeam, person: rule.person || (r && r.tkPerson) || '', cc: [], prio, status: 'new', created: at, paused: 0, esc: 0,
    ackDue: at + ackH * 3600000, fixDue: at + fixH * 3600000, due: at + fixH * 3600000, dayNoted: today, by: 'server',
    hist: [
      { t: at, by: 'System', text: `Created — the alert was active on ${win ? `${run} of the last ${win} days` : `${run} days in a row`} (rule: ${need} days${win ? ` within ${win}` : ' in a row'}, a day counts after ${minMin} min active)`, k: 'sys' },
      ...counted.map((d, i) => ({ t: at, by: 'System', text: `Day ${i + 1} of ${run} — ${dayLine(rec, d)}`, k: 'trig' })),
    ],
  }
  const reply = await store(loop.id, { tickets: [tk] })
  if (reply.mergedTickets && reply.mergedTickets[tk.id]) return // a screen opened it a moment ago
  tk.no = (reply.renumbered && reply.renumbered[tk.id]) || tk.no
  await ticketMail(loop, L, tk, `[${prio}] Ticket ${tk.no} — ${tk.name}`, at)
}

/** A ticket opened / reopened: its owner team is told (as the studio's ticket emails). */
async function ticketMail(loop, L, tk, subject, at) {
  const T = teamsOf(L.engine.DOC)
  const team = T.find(t => t.name === tk.owner)
  const to = emailsOf(team)
  if (!to.length) return
  const b = tk.equip ? L.engine.sandbox.B(tk.equip) : null
  const text = [subject, '', `Ticket    : ${tk.no} · ${tk.name}`, `Equipment : ${b ? b.name : '—'}${tk.process ? ' · ' + tk.process : ''}`,
    `Owner     : ${tk.owner}`, `Priority  : ${tk.prio}`, '', 'When it fired:',
    ...(tk.hist || []).filter(h => h.k === 'trig').slice(-10).map(h => '  ' + h.text), '',
    'Open the Tickets page in the Digital Loop to work on it and close it.'].join('\n')
  let status
  try {
    const reply = await sendMail({ foundry: String(loop.foundry_id), line: String(loop.line_id), to, subject, text })
    status = (reply.sent || []).length ? `sent by SandMan to ${reply.sent.length}` : 'not sent'
  } catch (error) {
    status = `not sent: ${error.message}`
  }
  await store(loop.id, {
    mails: [{ id: 'mt' + at.toString(36) + Math.random().toString(36).slice(2, 6), t: at, ch: 'email', inst: tk.no, team: tk.owner, to, subject, text, status, by: 'server' }],
  })
}

/** For tests: forget every loop's state. */
export const resetAlertChecker = () => LOOPS.clear()
