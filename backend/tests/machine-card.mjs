/**
 * Equipment QR cards and maintenance storage, end to end.
 * Starts its own API and a SandMan liveness stub. Needs DL_DB_USER / DL_DB_PASSWORD.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import mysql from 'mysql2/promise'

const PORT = Number(process.env.TEST_API_PORT) || 5003
const SM = Number(process.env.TEST_SANDMAN_PORT) || 7103
const BASE_PATH = process.env.DL_BASE_PATH ?? '/sandman/digitalloop'
const ROOT = `http://localhost:${PORT}${BASE_PATH}`
const API = `${ROOT}/api/v1`
const SECRET = randomBytes(32).toString('hex')
const CSRF = { 'x-requested-with': 'digital-loop' }

let passed = 0, failed = 0
const check = (label, ok, detail) => {
  if (ok) { passed++; console.log(`  PASS  ${label}`) } else { failed++; console.log(`  FAIL  ${label} :: ${JSON.stringify(detail)?.slice(0, 300)}`) }
}

const sandman = createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"ok":true,"service":"sandman"}') })
await new Promise(d => sandman.listen(SM, d))
const errs = []
const api = spawn(process.execPath, [resolve(import.meta.dirname, '..', 'src', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), SANDMAN_URL: `http://localhost:${SM}`, SANDMAN_SECRET: SECRET, DL_SECRET_KEY: randomBytes(32).toString('hex') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
api.stderr.on('data', c => errs.push(String(c)))
const stop = () => { try { api.kill() } catch {} ; sandman.close() }
process.on('exit', stop)
for (let i = 0; ; i++) {
  try { if ((await fetch(`${API}/session/sandman`)).ok) break } catch {}
  await new Promise(r => setTimeout(r, 250))
  if (i > 80) { console.error('API did not start\n' + errs.join('')); process.exit(1) }
}

const call = async (token, method, path, body, base = API) => {
  const res = await fetch(base + path, { method, headers: { ...CSRF, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const t = await res.text(); let b = t; try { b = JSON.parse(t) } catch {}
  return { status: res.status, body: b, type: res.headers.get('content-type') }
}
async function signIn(launch) {
  const m = await fetch(`${API}/session/launch`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sandman-secret': SECRET }, body: JSON.stringify(launch) })
  const { ticket } = await m.json()
  const e = await fetch(`${API}/session/enter`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket }), redirect: 'manual' })
  return decodeURIComponent(/dl_session=([^;]*)/.exec(e.headers.get('set-cookie') || '')?.[1] || '')
}

const stamp = Date.now().toString(36).slice(-5)
const PLANT = { foundry: `FND-MC-${stamp}`, foundryName: 'Card test foundry', lines: [{ id: `L1-${stamp}`, name: 'Line 1' }], database: { name: `mc_${stamp}`, tables: [{ name: 'bins', columns: [{ name: 'pkey', type: 'int' }, { name: 'bentonite', type: 'float' }] }] } }
const ADMIN = await signIn({ user: 'admin', name: 'Admin', role: 'admin', ...PLANT })
const VIEW = await signIn({ user: 'op', name: 'Operator', role: 'viewer', ...PLANT })

const layout = {
  DOC: {
    name: 'Card test', seq: 3, streams: [],
    blocks: [
      { id: 'b1', type: 'bin', name: 'BEN-BIN', props: { desc: 'Bentonite additive bin' }, tags: [{ id: 'BEN-BIN.ACT' }], x: 0, y: 0 },
      { id: 'b2', type: 'bin', name: 'NS-BIN', props: { desc: 'New sand bin' }, tags: [], x: 100, y: 0 },
    ],
    cps: [{ id: 'cp_sp', name: 'Sand preparation', blocks: ['b1', 'b2'] }],
  },
  REG: { 'BEN-BIN.ACT': { id: 'BEN-BIN.ACT', desc: 'Ben Act Kg', unit: 'kg', d: 1, typ: 20, link: { src: 'customer', db: `mc_${stamp}`, table: 'bins', col: 'bentonite' }, ll: 14, lo: 15, hi: 28, hh: 30 } },
}
const made = await call(ADMIN, 'POST', '/loops', { name: `Card test ${stamp}`, lineId: PLANT.lines[0].id, layout })
check('loop created', made.status === 201, made)
const LOOP = made.body.id
const pub = await call(ADMIN, 'POST', `/loops/${LOOP}/publish`, { version: 1 }); check('loop published', pub.status === 200, pub)

console.log('EQUIPMENT / QR')
const proposed = randomBytes(16).toString('base64url')
let eq = await call(ADMIN, 'PUT', `/equipment/${LOOP}`, { items: [
  { key: 'b1', name: 'BEN-BIN', type: 'bin', desc: 'Bentonite additive bin', token: proposed },
  { key: 'b2', name: 'NS-BIN', type: 'bin', desc: 'New sand bin', token: proposed }, // same token proposed twice
] })
check('equipment registered', eq.status === 200 && eq.body.cards.length === 2, eq)
const t1 = eq.body.cards.find(c => c.key === 'b1')?.token, t2 = eq.body.cards.find(c => c.key === 'b2')?.token
check('the studio\'s proposed token is kept', t1 === proposed, t1)
check('a duplicate token is replaced, never shared', t2 && t2 !== t1 && /^[A-Za-z0-9_-]{16,64}$/.test(t2), t2)
eq = await call(ADMIN, 'PUT', `/equipment/${LOOP}`, { items: [{ key: 'b1', name: 'BEN-BIN', type: 'bin', desc: 'x' }, { key: 'b2', name: 'NS-BIN', type: 'bin' }] })
check('tokens never change on re-sync', eq.body.cards.find(c => c.key === 'b1').token === t1)
check('an operator cannot write the register', (await call(VIEW, 'PUT', `/equipment/${LOOP}`, { items: [] })).status === 403)
check('no session cannot read the register', (await call(null, 'GET', `/equipment?loopId=${LOOP}`)).status === 401)

console.log('MACHINE PAGE (no session)')
const page = await fetch(`${ROOT}/m/${t1}`)
const html = await page.text()
check('/m/<token> serves the phone page', page.status === 200 && /<base href="\/sandman\/digitalloop\/">/.test(html) && /viewport/.test(html), page.status)
let card = await call(null, 'GET', `/m/${t1}`)
check('card opens with no session', card.status === 200 && card.body.machine.tag === 'BEN-BIN', card)
check('card lists the reading with limits', card.body.readings[0]?.limits.hh === 30 && card.body.readings[0].value === null, card.body.readings)
check('card carries the SOP area only when one exists', card.body.sop === null, card.body.sop)
check('unknown token is 404', (await call(null, 'GET', '/m/aaaaaaaaaaaaaaaaaaaaaa')).status === 404)
check('malformed token is 404', (await call(null, 'GET', '/m/short')).status === 404)

const db = await mysql.createConnection({ host: '127.0.0.1', user: process.env.DL_DB_USER, password: process.env.DL_DB_PASSWORD, database: process.env.DL_DB_NAME || 'digital_loop' })
await db.query('INSERT INTO tag_reading (design_id, tag_id, num_value, read_at) VALUES (?,?,?,?)', [LOOP, 'BEN-BIN.ACT', 31.5, new Date().toISOString()])
card = await call(null, 'GET', `/m/${t1}`)
check('last real value shows with severity', card.body.readings[0].value === 31.5 && card.body.readings[0].severity === 3 && card.body.machine.status === 'alarm', card.body.readings[0])

console.log('MAINTENANCE STORAGE')
const hash = '3dd2aa1b' // any stored value: the PIN lock is compared by the same function below
const { pinHash } = await import('../src/services/maintenance-store.js')
const today = new Date().toISOString().slice(0, 10)
const longAgo = '2020-01-01'
const maint = {
  replace: true, seq: 4,
  cfg: { rate: 400 },
  meters: {},
  assets: { b1: { make: 'Acme', model: 'B9', serial: 'S1', crit: 'A', phone: '+91 98765 43210', inst: '2019-05-01', year: '2019' } },
  plans: [{ id: 'p1', blk: 'b1', task: 'Grease bearings', kind: 'pm', days: 7, hours: null, crit: true, last: longAgo, lastH: null, who: 'Suresh', steps: ['Isolate', 'Grease'] }],
  parts: [{ id: 's1', name: 'Blade', no: 'B-1', unit: 'pc', cost: 1000, stock: 5, min: 2, for: 'BEN-BIN', rev: 0 }],
  team: [{ id: 't1', name: 'Suresh', role: 'Fitter', rk: 'tech', pin: pinHash('1234') }, { id: 't2', name: 'Anand', role: 'Fitter', rk: 'tech', pin: pinHash('4321') }],
  log: [{ id: 'w1', blk: 'b1', kind: 'pm', task: 'Old job', date: '2026-01-05T10:00', by: 'Suresh', no: 'WO-2026-0001', status: 'done', hours: 100, labHrs: 2, rate: 400, cost: 800 }],
}
let put = await call(VIEW, 'PUT', `/maintenance/${LOOP}`, maint)
check('a viewer of the loop can store maintenance', put.status === 200, put)
check('work-order sequence carried', put.body.seq >= 4, put.body)
let got = await call(VIEW, 'GET', `/maintenance?loopId=${LOOP}`)
check('plans round-trip', got.body.plans[0]?.task === 'Grease bearings' && got.body.plans[0].last === longAgo && got.body.plans[0].steps.length === 2, got.body.plans)
check('log, team, parts, assets round-trip', got.body.log.length === 1 && got.body.team.length === 2 && got.body.parts[0].stock === 5 && got.body.assets.b1.make === 'Acme', got.body)
check('settings merge with defaults', got.body.cfg.rate === 400 && got.body.cfg.warnDays === 3, got.body.cfg)
const dup = await call(VIEW, 'PUT', `/maintenance/${LOOP}`, { log: [{ id: 'w2', blk: 'b1', kind: 'pm', task: 'Other', date: '2026-01-06T10:00', by: 'S', no: 'WO-2026-0001', status: 'done' }] })
check('a clashing work-order number is renumbered', dup.body.renumbered?.w2 && dup.body.renumbered.w2 !== 'WO-2026-0001', dup.body)
check('stranger from another plant is refused', (await call(await signIn({ user: 'x', name: 'x', role: 'admin', foundry: 'OTHER', foundryName: 'O', lines: [{ id: 'z', name: 'z' }], database: { name: 'o', tables: [] } }), 'GET', `/maintenance?loopId=${LOOP}`)).status === 403)

console.log('PHONE WRITES')
card = await call(null, 'GET', `/m/${t1}`)
check('overdue plan is flagged on the card', card.body.maintenance.plans[0].state === 'over' && card.body.team.length === 2 && !('pin' in card.body.team[0]), card.body.maintenance.plans)
const rq = await call(null, 'POST', `/m/${t1}/request`, { task: 'Belt slipping', reportedBy: 'Ravi', priority: 'P2', stop: true })
check('anybody can report a fault', rq.status === 201 && /^WO-/.test(rq.body.no), rq)
check('a fault needs a description and a name', (await call(null, 'POST', `/m/${t1}/request`, { task: '', reportedBy: 'R' })).status === 400 && (await call(null, 'POST', `/m/${t1}/request`, { task: 'x' })).status === 400)
card = await call(null, 'GET', `/m/${t1}`)
check('open request is on the card', card.body.maintenance.open.length === 1 && card.body.maintenance.open[0].stop === true, card.body.maintenance.open)
const reqId = card.body.maintenance.open[0].id

check('logging without a valid PIN is refused', (await call(null, 'POST', `/m/${t1}/work`, { memberId: 't1', pin: '9999', planId: 'p1' })).status === 403)
const ok = await call(null, 'POST', `/m/${t1}/work`, { memberId: 't1', pin: '1234', planId: 'p1', hours: 250, labHrs: 2, other: 100, partsUsed: [{ id: 's1', qty: 2 }], checks: [{ t: 'Isolate', ok: true }] })
check('team member logs a planned task', ok.status === 201 && ok.body.cost === 2900, ok)
got = await call(VIEW, 'GET', `/maintenance?loopId=${LOOP}`)
check('plan "last done" moved to today', got.body.plans[0].last >= today, got.body.plans[0].last)
check('stock was taken from the store', got.body.parts[0].stock === 3 && got.body.parts[0].rev === 2, got.body.parts[0])
check('entry stored with phone origin and late days', got.body.log.some(e => e.origin === 'phone' && e.plan === 'p1' && e.late > 0), got.body.log.map(e => [e.id, e.origin, e.late]))
const stale = await call(VIEW, 'PUT', `/maintenance/${LOOP}`, { replace: true, plans: [{ ...maint.plans[0], last: longAgo }], parts: [{ ...maint.parts[0], stock: 5, rev: 0 }], team: maint.team, assets: maint.assets })
got = await call(VIEW, 'GET', `/maintenance?loopId=${LOOP}`)
check('a stale studio cannot wind a task back', got.body.plans[0].last >= today, got.body.plans[0].last)
check('a stale studio cannot overwrite stock', got.body.parts[0].stock === 3, got.body.parts[0])
check('a studio sync without the log does not delete it', got.body.log.length >= 3, got.body.log.length)

const fix = await call(null, 'POST', `/m/${t1}/work`, { memberId: 't2', pin: '4321', woId: reqId, task: 'Replaced belt', fail: { p: 'Mechanical', c: 'Wear and tear', a: 'Replaced' } })
check('a repair closes the service request', fix.status === 201, fix)
card = await call(null, 'GET', `/m/${t1}`)
check('request is no longer open', card.body.maintenance.open.length === 0 && card.body.maintenance.last.some(w => w.task === 'Replaced belt'), card.body.maintenance)
check('closing again is refused', (await call(null, 'POST', `/m/${t1}/work`, { memberId: 't2', pin: '4321', woId: reqId })).status === 409)

for (let i = 0; i < 5; i++) await call(null, 'POST', `/m/${t1}/work`, { memberId: 't1', pin: '0000', kind: 'pm', task: 'x' })
const locked = await call(null, 'POST', `/m/${t1}/work`, { memberId: 't1', pin: '1234', kind: 'pm', task: 'x' })
check('five wrong PINs lock that member out', locked.status === 423, locked)

console.log('RETIRING')
await call(ADMIN, 'PUT', `/equipment/${LOOP}`, { items: [{ key: 'b1', name: 'BEN-BIN', type: 'bin' }] })
const gone = await call(null, 'GET', `/m/${t2}`)
check('a removed machine\'s sticker says so', gone.status === 200 && gone.body.machine.retired === true, gone.body.machine)
check('a live machine is marked as saved in the loop', card.body.machine.saved === true && card.body.machine.retired === false, card.body.machine)
check('and refuses new reports', (await call(null, 'POST', `/m/${t2}/request`, { task: 'x', reportedBy: 'Ravi' })).status === 410)
check('a deleted loop takes its cards with it', (await call(ADMIN, 'DELETE', `/loops/${LOOP}`)).status < 300 && (await call(null, 'GET', `/m/${t1}`)).status === 404)

await db.end(); stop()
console.log(`\n${passed} passed, ${failed} failed`)
if (errs.length) console.log('API stderr:\n' + errs.join(''))
process.exit(failed ? 1 : 0)
