/**
 * Live readings, in the studio, in a real browser.
 *
 * The API suite proves the server reads the right columns and refuses the
 * wrong ones. This proves the other half, which no server test can see: that a
 * linked reading on the canvas shows the plant's number, that an unlinked one
 * carries on being simulated and is labelled as such, that the studio's own
 * simulation does not quietly overwrite a real value a second later, and that
 * the control chart is drawn from records rather than from a random walk.
 *
 * Self-contained. It starts its own stand-in for SandMan and its own API
 * process, so it needs nothing running first except a browser with the
 * DevTools protocol open and a MySQL account:
 *
 *     chrome --headless=new --remote-debugging-port=9333
 *     cd frontend && npm run test:live
 *
 * The stand-in listens on 7097, never 8080: the real SandMan lives there and a
 * test that took its port would stop Tomcat starting. It is stopped at the end
 * however the run finishes.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const DEVTOOLS = process.env.DEVTOOLS_URL || 'http://localhost:9333'
const API_PORT = Number(process.env.LIVE_API_PORT) || 5088
const SANDMAN_PORT = Number(process.env.LIVE_SANDMAN_PORT) || 7097
const BASE_PATH = process.env.DL_BASE_PATH ?? '/sandman/digitalloop'
const API = `http://localhost:${API_PORT}${BASE_PATH}/api/v1`
const SECRET = randomBytes(32).toString('hex')

if (!process.env.DL_DB_USER) {
  console.error('\nThis test needs a MySQL account: set DL_DB_USER and DL_DB_PASSWORD.\n')
  process.exit(2)
}

let passed = 0
let failed = 0
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) }
  else { failed += 1; console.log(`  FAIL  ${label} :: ${JSON.stringify(detail)?.slice(0, 300)}`) }
}

/* ------------------------------------------------- the stand-in for SandMan ---
 *
 * Answers the three endpoints this feature uses. The reading it returns is
 * constant on purpose: "is the studio showing the plant's number" can then be
 * an exact comparison rather than a tolerance wide enough to also admit the
 * simulated one, which is the mistake that made an earlier version of this
 * test pass while the feature was broken.
 */
const MOISTURE = 2.62
/** A text column, of the kind v9.40 added: a pattern name, not a measurement. */
const PATTERN = 'BRAKE-DISC-A'
const RECORDS = Array.from({ length: 12 }, (_, i) => ({
  value: 2.5 + Math.sin(i / 2) * 0.12,
  date: `2026-02-${String(7 + i).padStart(2, '0')}`,
  time: '09:00:00',
  shift: 'A',
  recordedAt: `2026-02-${String(7 + i).padStart(2, '0')}T09:00:00`,
}))

const sandman = createServer((req, res) => {
  const json = body => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const read = () => new Promise(done => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => done(JSON.parse(body || '{}')))
  })

  if (req.url.endsWith('/values')) {
    read().then(asked => {
      const values = {}
      for (const tag of asked.tags || []) {
        values[tag.id] = {
          value: tag.column === 'prev_pattern' ? PATTERN : MOISTURE,
          date: '2026-02-18', time: '12:12:00', shift: 'A',
          recordedAt: '2026-02-18T12:12:00',
        }
      }
      json({ values, errors: {} })
    })
    return
  }

  if (req.url.endsWith('/chart')) {
    read().then(() => json({
      dateFrom: '2026-01-20',
      dateTo: '2026-02-18',
      series: RECORDS,
      processControl: {
        MEAN: {
          y: [2.60, 2.64, 2.58, 2.66, 2.61],
          n: ['14-Feb 9:00', '15-Feb 9:00', '16-Feb 9:00', '17-Feb 9:00', '18-Feb 9:00'],
          limits: [2.80, 2.62, 2.44],
        },
        RANGE: {
          y: [0.06, 0.04, 0.09, 0.03, 0.05],
          n: ['14-Feb 9:00', '15-Feb 9:00', '16-Feb 9:00', '17-Feb 9:00', '18-Feb 9:00'],
          limits: [0.15, 0.05, 0],
        },
        shiftAverages: 127,
      },
    }))
    return
  }

  json({ service: 'sandman', stub: true })
})
await new Promise(done => sandman.listen(SANDMAN_PORT, done))

/* ------------------------------------------------------- the API under test ---*/

const api = spawn(process.execPath, [
  resolve(import.meta.dirname, '..', '..', 'backend', 'src', 'server.js'),
], {
  env: {
    ...process.env,
    PORT: String(API_PORT),
    SANDMAN_URL: `http://localhost:${SANDMAN_PORT}`,
    SANDMAN_SECRET: SECRET,
    /* A throwaway sealing key: registering a database stores a password, and
       the API refuses to do that in clear. Nothing it seals outlives this run. */
    DL_SECRET_KEY: randomBytes(32).toString('hex'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const apiErrors = []
api.stderr.on('data', chunk => apiErrors.push(String(chunk)))

let browserTarget = null
const stop = () => {
  try { api.kill() } catch { /* already gone */ }
  try { sandman.close() } catch { /* already closed */ }
}
process.on('exit', stop)

for (let attempt = 0; ; attempt++) {
  try {
    if ((await fetch(`${API}/session/sandman`)).ok) break
  } catch { /* not up yet */ }
  if (attempt === 79) {
    console.error('The API did not start.\n' + apiErrors.join(''))
    stop()
    process.exit(1)
  }
  await new Promise(done => setTimeout(done, 250))
}

/* ------------------------------------------------------------- the fixture ---*/

const stamp = Date.now().toString(36).slice(-5)
/*
 * One table the readings are linked to, and enough others to be a list.
 *
 * A real foundry database here is a couple of hundred tables; the search box
 * over that list only appears above a dozen, so a fixture with one table could
 * never show whether it works. These fifteen are named the way the plant's own
 * are — `asset_*`, `sand_*` — so a search can be asserted to narrow to one
 * family and not the other.
 */
const DATABASE = {
  name: `livetest_${stamp}`,
  tables: [
    {
      name: 'preparedsand',
      columns: [{ name: 'pkey', type: 'int' }, { name: 'moisture', type: 'float' }],
    },
    ...['asset', 'asset_group', 'asset_meter', 'asset_history', 'asset_spare',
      'sand_test', 'sand_batch', 'sand_return', 'sand_addition',
      'mould_cycle', 'mould_defect', 'pour_log', 'pour_temp',
      'shift_log', 'operator'].map(name => ({
      name,
      columns: [{ name: 'id', type: 'int' }, { name: 'value', type: 'float' }],
    })),
  ],
}
const PLANT = {
  foundry: `FND-LIVETEST-${stamp}`,
  foundryName: `Live test ${stamp}`,
  lines: [{ id: `LT1-${stamp}`, name: 'Live test line' }],
  database: DATABASE,
}

const mint = async () => {
  const response = await fetch(`${API}/session/launch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sandman-secret': SECRET },
    body: JSON.stringify({ user: 'admin.livetest', name: 'Live test', role: 'admin', ...PLANT }),
  })
  const body = await response.json()
  if (response.status !== 201) throw new Error(`launch refused ${response.status}: ${body?.message}`)
  return body.ticket
}

const entered = await fetch(`${API}/session/enter`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ ticket: await mint() }).toString(),
  redirect: 'manual',
})
const token = decodeURIComponent(
  /(?:^|[,;\s])dl_session=([^;]*)/.exec(entered.headers.get('set-cookie') || '')?.[1] || '')

const call = async (method, path, body) => {
  const response = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-requested-with': 'digital-loop',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

/**
 * One block with two readings: one linked to the foundry's database, one not.
 *
 * `props` matters — the studio's simulation reads `b.props.oos` on every tick
 * and a block without it throws, which is a broken fixture rather than a
 * broken feature and took a while to tell apart.
 */
const reading = (id, link) =>
  ({ id, desc: id, unit: '%', typ: 3, d: 2, noise: 0.4, ...(link ? { link } : {}) })

const layout = {
  DOC: {
    name: 'Live test loop',
    seq: 2,
    blocks: [{
      id: 'blk1', type: 'mixer', x: 200, y: 200, name: 'Mixer 1', props: {},
      /* `tagOff` is what `tagAnchor` places the labels by, and `show` is what
         puts each one on the canvas — without them the readings exist but the
         drawing has no badges, so nothing about the labels is testable. */
      tagOff: { x: 0, y: 0 },
      tags: [{ id: 'T_MOIST', show: true }, { id: 'T_PLAIN', show: true }],
    }],
    streams: [],
  },
  REG: {
    T_MOIST: reading('T_MOIST',
      { src: 'customer', db: DATABASE.name, table: 'preparedsand', col: 'moisture' }),
    T_PLAIN: reading('T_PLAIN'),
    // A text column, as v9.40 allows: the value is a name, not a number.
    T_TEXT: reading('T_TEXT',
      { src: 'customer', db: DATABASE.name, table: 'molding_cycles', col: 'prev_pattern' }),
    // A reading drawn before the demo servers were taken away: it points at
    // one of them, and must read as simulated rather than as connected.
    T_OLD: reading('T_OLD',
      { src: 'src_db', db: 'SandMan_Prod', table: 'equipment_status', col: 'running' }),
  },
}
layout.DOC.blocks[0].tags.push({ id: 'T_OLD', show: true }, { id: 'T_TEXT', show: true })

/*
 * A database an administrator registered.
 *
 * Pointed at the MySQL this suite already uses, so the tables it reports are
 * real and known — `asset` is the equipment catalogue, which is always there.
 * That is what makes "its real tables, not a hardcoded schema" checkable.
 */
const ADDED_DB = {
  label: `Added DB ${stamp}`,
  engine: 'mysql',
  host: process.env.DL_DB_HOST || '127.0.0.1',
  port: Number(process.env.DL_DB_PORT) || 3306,
  database: process.env.DL_DB_NAME || 'digital_loop_test',
  username: process.env.DL_DB_USER,
  password: process.env.DL_DB_PASSWORD || '',
}
/**
 * Take away what an earlier run left.
 *
 * Registered databases are not scoped to a plant — an administrator registers
 * one and every loop can read it — so a fixture this suite abandons is a
 * fixture somebody sees in their own Data sources panel the next morning. A
 * run that throws half way through never reaches its own teardown, so each run
 * starts by clearing the last one's, matched on the name this suite gives
 * them, and does the same at the end.
 */
async function sweepTestConnections() {
  for (const conn of (await call('GET', '/connections')).body || []) {
    if (/^Added DB /.test(conn.label || '')) await call('DELETE', `/connections/${conn.id}`)
  }
}
await sweepTestConnections()

const addedDb = await call('POST', '/connections', ADDED_DB)
if (addedDb.status !== 201) {
  console.error(`Could not register the test database: ${JSON.stringify(addedDb.body)}`)
  stop()
  process.exit(1)
}

const made = await call('POST', '/loops',
  { name: 'Live test loop', lineId: PLANT.lines[0].id, layout })
if (made.status !== 201) {
  console.error(`Could not create the fixture loop: ${JSON.stringify(made.body)}`)
  stop()
  process.exit(1)
}

/* --------------------------------------------------------------- the browser ---*/

try {
  browserTarget = await (await fetch(`${DEVTOOLS}/json/new?about:blank`, { method: 'PUT' })).json()
} catch {
  console.error(
    `No browser is listening at ${DEVTOOLS}.\n\n` +
    '    chrome --headless=new --remote-debugging-port=9333 about:blank\n'
  )
  stop()
  process.exit(2)
}

const ws = new WebSocket(browserTarget.webSocketDebuggerUrl)
await new Promise(done => ws.addEventListener('open', done))

let id = 0
const pending = new Map()
const thrown = []
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    thrown.push(details.exception?.description?.split('\n')[0] || details.text)
  }
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})
const send = (method, params = {}) => new Promise(done => {
  const next = ++id
  pending.set(next, done)
  ws.send(JSON.stringify({ id: next, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true })
  if (result.result?.exceptionDetails) {
    return { __err: result.result.exceptionDetails.exception?.description?.split('\n')[0] }
  }
  return result.result.result.value
}
const wait = ms => new Promise(done => setTimeout(done, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Network.clearBrowserCookies')
await send('Page.navigate', { url: `http://localhost:${API_PORT}${BASE_PATH}/` })
await wait(1500)
await evaluate(`(() => {
  const form = document.createElement('form');
  form.method = 'POST'; form.action = ${JSON.stringify(`${API}/session/enter`)};
  const field = document.createElement('input');
  field.type = 'hidden'; field.name = 'ticket'; field.value = ${JSON.stringify(await mint())};
  form.append(field); document.body.append(form); form.submit();
})()`)
await wait(7000)

/** `VAL` and `REG` are `const` in a classic script: global scope reaches them. */
const peek = `(name => { try { return new Function('return typeof ' + name + " === 'undefined' ? null : " + name)() } catch { return null } })`

console.log('\nLIVE READINGS — the plant\'s numbers on the canvas')

const seen = await evaluate(`(() => {
  const VAL = ${peek}('VAL'), REG = ${peek}('REG');
  const chipLabel = t => {
    if (typeof chipFor !== 'function') return null;
    const holder = document.createElement('div');
    holder.innerHTML = chipFor(t);
    return holder.textContent.trim();
  };
  return {
    body: document.body.className,
    moist: VAL?.T_MOIST?.v ?? null,
    plain: typeof val === 'function' ? val('T_PLAIN') : undefined,
    moistHistory: VAL?.T_MOIST?.h?.length ?? null,
    plainHistory: VAL?.T_PLAIN?.h?.length ?? null,
    plainShown: typeof fmtT === 'function' ? fmtT('T_PLAIN') : null,
    guarded: !!window.simTick?.__dlGuarded,
    // The visible label, not the markup: every chip's tooltip explains what
    // it is linked to, so matching the whole string matches the explanation
    // as well as the word, and "not Linked" was failing on "Linked to ...".
    chipLive: chipLabel(REG.T_MOIST),
    chipDemo: chipLabel(REG.T_PLAIN),
    chipOld: chipLabel(REG.T_OLD),
    textTag: REG?.T_TEXT?.txt ?? null,
    textShown: typeof tagTxt === 'function' ? tagTxt('T_TEXT') : null,
    textHistory: VAL?.T_TEXT?.h?.length ?? null,
    sources: typeof sources === 'function' ? sources().map(s => s.name) : null,
    docSources: ${peek}('DOC')?.sources ?? null,
    pickable: typeof srcOptions === 'function' ? srcOptions('', false) : '',
  };
})()`)

const added = await evaluate(`(async () => {
  const id = 'conn_' + ${JSON.stringify(addedDb.body.id)};
  const src = typeof SRC === 'function' ? SRC(id) : null;
  if (!src) return { missing: true };
  // First call starts the fetch and returns no tables; the studio redraws
  // when it lands, so this waits the same way the panel does.
  catalog(src);
  for (let i = 0; i < 40 && !(catalog(src)[0].tables || []).length; i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  return { tables: catalog(src)[0].tables.map(t => t.name), db: src.db, name: src.name };
})()`)
seen.addedTables = added?.tables || []

check('the studio opened', !!seen.body?.includes('dl-admin'), seen.body)
check('the simulation guard is installed before any loop opens', seen.guarded === true, seen.guarded)
check('a linked reading shows the plant\'s value exactly',
  seen.moist === MOISTURE, { shown: seen.moist, plant: MOISTURE })
check('its history holds the record, not the simulation\'s invented points',
  seen.moistHistory === 1, seen.moistHistory)
/*
 * No invented numbers. An unlinked reading shows its name and a dash — on a
 * plant screen a simulated 2.6 % is indistinguishable from a measured one,
 * and somebody will act on either.
 */
check('an unlinked reading shows no value at all',
  seen.plain === null && /^—/.test(seen.plainShown || ''),
  { value: seen.plain, shown: seen.plainShown })
check('the inspector marks the linked one Live', seen.chipLive === 'Live', seen.chipLive)
check('and marks the unlinked one Not linked', seen.chipDemo === 'Not linked', seen.chipDemo)

/*
 * v9.40 gave text columns a tag type of their own and one place that draws
 * them. A pattern name has to arrive through that, or it lands somewhere
 * nothing looks at and the equipment goes on showing an invented number.
 */
check('a text column arrives as text, through the studio\'s own text tag',
  seen.textTag === PATTERN, seen.textTag)
check('and is what the drawing shows for that reading',
  seen.textShown === PATTERN, seen.textShown)
check('a text reading puts nothing on the chart',
  !seen.textHistory, seen.textHistory)

console.log('\nDATA SOURCES — the foundry\'s database, and nothing invented')

/*
 * The studio ships three demo servers (a PLC gateway, a SQL box, a LIMS) with
 * a hardcoded schema behind them. They connect to nothing, and `sources()`
 * writes them into `DOC.sources` the moment the properties panel renders — so
 * three fictional servers end up saved with a real plant's design.
 *
 * They are **replaced** by the databases that exist, not simply removed:
 * emptying the list took the registered ones with it, and a database somebody
 * added had no way to appear either.
 */
check('no demonstration server is offered as a source',
  Array.isArray(seen.sources) &&
  !seen.sources.some(name => /SandMan Gateway|SandMan Production DB|Sand Lab LIMS/.test(name)),
  seen.sources)
check('and are not written into the document that gets saved',
  seen.docSources == null || seen.docSources.length === 0, seen.docSources)
check('a database an administrator registered is offered',
  (seen.sources || []).includes(ADDED_DB.label), seen.sources)
check('its real tables are what the flow offers, not a hardcoded schema',
  (seen.addedTables || []).includes('asset'), seen.addedTables)
check('with no invitation to add one by typing a host into the browser',
  !seen.pickable.includes('__manage'), seen.pickable?.slice(0, 200))

/*
 * "★ Customer default" is not a standing entry in the source menu.
 *
 * The studio writes it in from `CUSTOMER.defaultDb`, ahead of everything
 * `sources()` offers, whether or not the plant reads from that database — so
 * the menu and the Data sources page disagreed, the page listing what somebody
 * registered and the menu listing those plus one more.
 *
 * It stays where a reading already reads from it, which is the whole of the
 * exception: taking it off that reading's own menu would show the reading as
 * reading from something else, and the next change saved on the card would
 * make that true.
 */
const menu = await evaluate(`(() => ({
  fresh: typeof srcOptions === 'function' ? srcOptions('', false) : '',
  linked: typeof srcOptions === 'function' ? srcOptions('customer', false) : '',
}))()`)
check('a reading that reads from nothing is not offered the customer default',
  !/value="customer"/.test(menu.fresh || ''), menu.fresh?.slice(0, 300))
check('but one that already reads from it still shows it',
  /value="customer"/.test(menu.linked || ''), menu.linked?.slice(0, 300))
/*
 * A demo source is a real choice, and the number it gives is invented. The
 * chip has to say which — "Linked", the studio's own answer, is the confident
 * green pill on a random walk this exists to prevent.
 */
check('a reading left pointing at a removed demo server says so',
  seen.chipOld === 'Not connected', seen.chipOld)

/*
 * The Data sources page itself: SandMan's card off it, everything else on it.
 *
 * The studio puts "Customer default database" at the top of that page with its
 * type, host and database name, a Test connection button and "Managed by
 * Sandman" underneath. It is the one card there that cannot be managed — Test
 * tests the studio's simulated gateway rather than SandMan, and the host is
 * SandMan's to hold, not ours to print in a browser panel.
 *
 * What has to survive is the rest of the page: the databases an administrator
 * registered, with Edit, Test and Delete, and ＋ Add data source opening our
 * own form — host, account, password and the SSH tunnel — rather than the
 * studio's simulated-gateway one.
 */
const page = await evaluate(`(() => {
  closeModal?.();
  sourcesForm();
  const box = document.getElementById('mbox');
  return {
    sandmansCard: !!box?.querySelector('.src.cust-src'),
    cards: [...(box?.querySelectorAll('.src-g .src') || [])]
      .map(c => (c.querySelector('b')?.textContent || c.textContent.trim()).slice(0, 40)),
    add: !!box?.querySelector('#srcAdd'),
    edit: !!box?.querySelector('[data-se]'),
    test: !!box?.querySelector('[data-st]'),
    remove: !!box?.querySelector('[data-sd]'),
    gatewayNote: /stay simulated|credential reference/i.test(box?.textContent || ''),
  };
})()`)
check('SandMan\'s own card is off the Data sources page',
  page.sandmansCard === false, page.cards)
check('the registered database is still listed there',
  (page.cards || []).some(name => name.includes(ADDED_DB.label)), page.cards)
check('with Edit, Test and Delete on it',
  page.edit && page.test && page.remove, page)
check('and ＋ Add data source is still offered',
  page.add === true, page)
check('with nothing left saying the values are simulated',
  page.gatewayNote === false, page)

// Our form asks the server which engines it supports before it draws, so the
// modal is not the one we want until that answer is back.
await evaluate(`document.getElementById('srcAdd')?.click()`)
await wait(1200)
const form = await evaluate(`(() => {
  const box = document.getElementById('mbox');
  const text = box?.textContent || '';
  return {
    ours: !!box?.querySelector('[id^="dlDb"]'),
    fields: [...(box?.querySelectorAll('input,select,textarea') || [])].map(f => f.id).filter(Boolean),
    ssh: /ssh/i.test(text),
    tunnel: /tunnel|jump|bastion/i.test(text),
    gateway: /credential reference|poll every/i.test(text),
  };
})()`)
check('＋ Add data source opens our form, not the studio\'s gateway one',
  form.ours === true, form)
check('and that form still has its SSH tunnel section',
  form.ssh && form.tunnel, form)
check('with the tunnel\'s own fields on it',
  (form.fields || []).some(name => /tunnel|ssh|jump|key/i.test(name)), form.fields)
await evaluate('closeModal?.()')

/*
 * The guard is the whole point of the feature on this side. `simTick` runs
 * every second and rewrites every reading in `REG`, history included; without
 * this a real value would be replaced by an invented one within a second of
 * arriving, and nobody watching the screen would be able to tell.
 */
const ticked = await evaluate(`(() => {
  const VAL = ${peek}('VAL');
  const before = VAL.T_MOIST.v, plainBefore = VAL.T_PLAIN.v, depth = VAL.T_MOIST.h.length;
  for (let i = 0; i < 5; i++) simTick();
  return { before, after: VAL.T_MOIST.v, depth, depthAfter: VAL.T_MOIST.h.length,
           plainBefore, plainAfter: VAL.T_PLAIN.v,
           plainShownAfter: typeof fmtT === 'function' ? fmtT('T_PLAIN') : null };
})()`)

check('five simulation ticks leave the linked reading alone',
  ticked.before === ticked.after, ticked)
check('and do not pad its history with invented points',
  ticked.depth === ticked.depthAfter, ticked)
check('and an unlinked reading still shows nothing afterwards',
  ticked.plainShownAfter !== null && /^—/.test(ticked.plainShownAfter), ticked)

/*
 * Asked once a minute, not once a second — and a poll that finds the same
 * record does nothing at all. The studio's simulation is what ticks at 1 Hz;
 * a plant reading changes per shift or per batch.
 */
const cadence = await evaluate(`(async () => {
  const live = window.__dlLive;
  if (!live) return { missing: true };
  const was = live.status();
  await new Promise(r => setTimeout(r, 5));
  await live.poll();
  const now = live.status();
  return {
    pollMs: now.pollMs,
    changedAt: was.lastChangeAt,
    changedAtAfter: now.lastChangeAt,
    checkedBefore: was.lastCheckAt,
    checkedAfter: now.lastCheckAt,
    depth: ${peek}('VAL').T_MOIST.h.length,
  };
})()`)

check('readings are polled every thirty seconds, not every second',
  cadence.pollMs === 30_000, cadence.pollMs)
check('a poll that finds the same record is asked for but changes nothing',
  cadence.checkedAfter > cadence.checkedBefore &&
  cadence.changedAtAfter === cadence.changedAt, cadence)
check('and does not add a second copy of the same record to the history',
  cadence.depth === 1, cadence.depth)

/*
 * A loop still being drawn names no columns, so there is nothing to ask about.
 * Polling it anyway cost a read of the design and a parse of its layout every
 * minute, for ever, to discover the same nothing — which is what a real log
 * full of "no linked readings" turned out to be.
 */
const idle = await evaluate(`(async () => {
  const live = window.__dlLive;
  const REG = ${peek}('REG');
  const before = live.status();
  // Take the link off EVERY linked reading: one left behind keeps the timer
  // running, which is correct behaviour and would hide what is being checked.
  const kept = {};
  for (const id of Object.keys(REG)) {
    if (REG[id]?.link?.src === 'customer') { kept[id] = REG[id].link; delete REG[id].link; }
  }
  changed();
  await new Promise(r => setTimeout(r, 900));
  const after = live.status();
  for (const [id, link] of Object.entries(kept)) REG[id].link = link;
  changed();
  await new Promise(r => setTimeout(r, 900));
  const back = live.status();
  return {
    linkedBefore: before.linked.length,
    linkedAfter: after.linked.length,
    liveAfter: after.live.length,
    linkedBack: back.linked.length,
    liveBack: back.live.length,
  };
})()`)

check('unlinking the last reading stops the polling',
  idle.linkedAfter === 0 && idle.liveAfter === 0, idle)
check('and linking them again starts it',
  idle.linkedBack === idle.linkedBefore && idle.liveBack === idle.linkedBefore, idle)

console.log('\nPROPERTIES — one data connection, not two')

/*
 * The studio ships two places to connect a reading to data — the database
 * flow, and a "live source for the whole equipment" with a Map readings
 * button — plus a third section listing the readings. Two of those do the
 * same job, and the second belongs to a world where a gateway resolves an
 * address rather than a reading meaning a column in a named database.
 *
 * One section: Database connection, ＋ Add reading, the flow, the readings.
 */
const panel = await evaluate(`(() => {
  const DOC = ${peek}('DOC');
  const block = DOC?.blocks?.find(b => b.tags && b.tags.length);
  if (!block) return { noBlock: true };
  // Out of the publish view first: it hides the properties panel.
  setPresent(false);
  closeModal?.();
  setMode('design');
  select({ t: 'b', id: block.id });
  renderProps();

  const root = document.getElementById('props');
  const titleOf = s => (s.querySelector('h4')?.textContent || '').trim().replace(/\\s+/g, ' ');
  const sections = [...root.querySelectorAll('section.ix-sec')].map(titleOf);
  const connection = [...root.querySelectorAll('section.ix-sec')]
    .find(s => /Database connection/.test(titleOf(s)));
  const drawer = connection?.querySelector('#dlAddDrawer');

  const out = {
    sections,
    readingsSectionGone: !sections.some(t => /^Readings/.test(t)),
    secondConnectionGone: !root.querySelector('#ixSrc'),
    addButtonUnderConnection: !!connection?.querySelector('h4 #ixAddBtn'),
    flowHiddenUntilAsked: drawer?.hidden === true,
    flowInsideDrawer: !!drawer?.querySelector('#dbFlow'),
    readingsInConnection: connection?.querySelectorAll('.ix-card').length ?? 0,
  };
  // Where the drawer sits: pressing the button has to put the next thing to
  // do where the eye already is, not below a dozen reading cards.
  out.childOrder = [...connection.children].map(e => e.id || e.tagName.toLowerCase());

  connection?.querySelector('h4 #ixAddBtn')?.click();
  out.opensOnClick = drawer?.hidden === false;
  out.databaseDropdown = !!drawer?.querySelector('#dbDb');
  out.offered = [...(drawer?.querySelectorAll('#dbDb option') || [])].map(o => o.textContent.trim());

  // The database is already chosen, so its tables are on offer; the column and
  // the name wait for a table to be picked out of them.
  out.stepsWhenOpened = [...drawer.querySelectorAll('.db-step')].map(step =>
    (step.querySelector('i')?.textContent || '?') +
    (getComputedStyle(step).display === 'none' ? ':hidden' : ':shown'));

  // Which source it opens on, and which one the list offers first. The flow
  // used to open on nothing, so every reading began by answering a question
  // that, on a plant with one database, has one answer.
  const database = drawer.querySelector('#dbDb');
  out.chosenSource = database?.value || '';
  out.firstRealSource = [...(database?.options || [])].find(o =>
    o.value && !/^__/.test(o.value) && !/simulated|demo/i.test(o.textContent))?.value || '';

  // And the reading's own card: what the name field is called, whether it can
  // still be typed in, and whether the card says where the number comes from.
  const card = connection?.querySelector('.ix-card[data-tid]');
  const name = card?.querySelector('[data-ix="desc"]');
  out.nameLabel = (name?.closest('.ix-f')?.textContent || '').trim();
  out.nameEditable = !!name && !name.disabled && !name.readOnly;
  out.readsFrom = (card?.querySelector('.dl-reads-from')?.textContent || '').trim();
  return out;
})()`)

check('there is one connection section, not two',
  panel.readingsSectionGone && panel.secondConnectionGone, panel.sections)
check('and it is called Database connection',
  (panel.sections || []).some(t => /^Database connection/.test(t)), panel.sections)
check('＋ Add reading sits under it', panel.addButtonUnderConnection === true, panel)
check('the readings are listed in that same section',
  panel.readingsInConnection > 0, panel.readingsInConnection)
check('the flow is out of the way until Add reading is pressed',
  panel.flowHiddenUntilAsked && panel.flowInsideDrawer, panel)
check('pressing it shows the database dropdown',
  panel.opensOnClick && panel.databaseDropdown, panel)
/*
 * And it offers the registered data sources, those alone.
 *
 * Not the demo servers, which connect to nothing, and not the studio's fixed
 * "★ Customer default" entry either: that one is written into the menu from
 * the launch rather than coming from the data sources, so it made this list
 * disagree with the Data sources page about where a reading may come from.
 * A reading already linked to the foundry's database keeps reading it — the
 * stored link is untouched — and its own Source box still names it.
 */
check('which offers the registered data sources and nothing else',
  (panel.offered || []).length > 0 &&
  !(panel.offered || []).some(o =>
    /Customer default|SandMan Production DB|Sand Lab LIMS|SandMan Gateway/.test(o)),
  panel.offered)
check('the dropdown opens directly under the heading, not below the readings',
  panel.childOrder?.[1] === 'dlAddDrawer', panel.childOrder)
/*
 * One step at a time, from nothing chosen.
 *
 * Two other arrangements were tried. Opening on the first source in the list
 * answered the first question for the person, and opening on it with the
 * table step forced shut was worse still — the panel named `aiw_data` and
 * then refused to list its tables, which reads as broken rather than as
 * sequenced. Choosing a database is the first thing asked, and each step
 * after it arrives when the one before has an answer.
 */
check('and the steps come one at a time — only the database to begin with',
  panel.stepsWhenOpened?.join(' ') === '1:shown 2:hidden 3:hidden 4:hidden',
  panel.stepsWhenOpened)
/*
 * Whichever source the list offers first, not one named in the code.
 *
 * Asserted against the dropdown rather than against a name, so a plant whose
 * first source is something else still passes — which is the point: the
 * default is read from what is on offer, and there is no source written into
 * the module to go stale.
 */
/*
 * Two ways to say where a reading comes from, and only one on screen.
 *
 * The statement box carried `display: flex`, which beats the `hidden`
 * attribute — so it stayed up while "From the dropdowns" was the chosen mode
 * and pushed the table and column steps below the fold, where they read as
 * missing. The same mistake has now caught three elements in this project, so
 * it is checked rather than looked at.
 */
const how = await evaluate(`(async () => {
  // Set the panel up again: the checks above leave it torn down, and the
  // drawer lives inside it.
  const DOC = ${peek}('DOC');
  const block = DOC?.blocks?.find(b => b.tags && b.tags.length);
  if (!block) return { missing: true };
  setMode('design');
  select({ t: 'b', id: block.id });
  renderProps();
  await new Promise(r => setTimeout(r, 150));

  const drawer = document.getElementById('dlAddDrawer');
  const seg = document.getElementById('dlHow');
  if (!drawer || !seg) return { missing: true };

  // The drawer closes when the panel redraws; these two live inside it.
  if (drawer.hidden) {
    document.getElementById('ixAddBtn')?.click();
    await new Promise(r => setTimeout(r, 120));
  }

  // Client rects, not computed display: a child of a hidden parent still
  // reports its own display, so only the box it occupies tells the truth.
  const shown = id => {
    const el = document.getElementById(id);
    return !!el && el.getClientRects().length > 0;
  };
  /*
   * Found again on each press, the way a hand finds the button on screen.
   *
   * The panel rebuilds itself — a poll landing, a field losing focus — and a
   * reference taken before that is a button nobody can see any more. Holding
   * one here tested that the detached copy still worked, which is not a thing
   * anybody needs.
   */
  const press = how =>
    document.querySelector('#dlHow [data-how="' + how + '"]')?.click();

  /*
   * A database is chosen first, because that is the only way to a table.
   *
   * The flow opens with nothing picked and the table step shut behind it, so
   * a probe that went straight to the mode buttons would be asking whether a
   * step it had not reached was on screen.
   */
  const database = document.getElementById('dbDb');
  const first = [...(database?.options || [])].find(o =>
    o.value && !/^__/.test(o.value) && !/simulated|demo/i.test(o.textContent));
  if (database && first) {
    database.value = first.value;
    database.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 400));
  }

  press('query');
  await new Promise(r => setTimeout(r, 200));
  const query = { table: shown('dbTbl'), written: shown('dlWritten') };

  press('dropdowns');
  await new Promise(r => setTimeout(r, 200));
  const dropdowns = { table: shown('dbTbl'), written: shown('dlWritten') };
  return { dropdowns, query };
})()`)
check('adding a reading offers the dropdowns or a query', !how.missing, how)
check('the dropdowns show a table and no statement box',
  how.dropdowns?.table === true && how.dropdowns?.written === false, how.dropdowns)
check('and the query shows a statement box and no table',
  how.query?.written === true && how.query?.table === false, how.query)

/*
 * Nothing is pre-chosen, and the list it offers is the plant's own.
 *
 * The flow opened on the first source for a while, which answered the first
 * question on the person's behalf — and the studio's own default is the
 * customer database, which this installation does not use at all.
 */
check('the flow opens with no database chosen', panel.chosenSource === '', panel.chosenSource)
check('and offers a real one to choose', !!panel.firstRealSource, panel.firstRealSource)

check('a reading\'s name field is called Display name',
  /display name/i.test(panel.nameLabel || ''), panel.nameLabel)
check('and can still be typed in', panel.nameEditable === true, panel.nameEditable)
check('with the column it reads said underneath it',
  /preparedsand\.moisture/.test(panel.readsFrom || ''), panel.readsFrom)

/*
 * Renaming a reading changes what it is called. Nothing else.
 *
 * The three names a reading has are not the same thing: the tag id is what the
 * document, the server index and every stored version are keyed on; the link
 * is where the number comes from; the display name is what the plant calls it.
 * Typing in the name field writes `desc` — so this types a new name into the
 * studio's own input, the way somebody would, and checks that the tag id, the
 * link and the value all come through it untouched.
 */
const renamed = await evaluate(`(() => {
  const REG = ${peek}('REG'), VAL = ${peek}('VAL');
  const card = [...document.querySelectorAll('#props .ix-card[data-tid]')]
    .find(c => c.dataset.tid === 'T_MOIST');
  const field = card?.querySelector('[data-ix="desc"]');
  if (!field) return { noField: true };

  const before = {
    link: JSON.stringify(REG.T_MOIST.link),
    value: VAL.T_MOIST?.v ?? null,
    points: VAL.T_MOIST?.h?.length ?? 0,
  };
  field.value = 'Muller moisture, renamed';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));

  return {
    before,
    name: REG.T_MOIST.desc,
    idStillThere: !!REG.T_MOIST,
    link: JSON.stringify(REG.T_MOIST.link),
    value: VAL.T_MOIST?.v ?? null,
    points: VAL.T_MOIST?.h?.length ?? 0,
  };
})()`)
check('renaming a reading changes its name', renamed.name === 'Muller moisture, renamed', renamed.name)
check('and leaves the tag id alone', renamed.idStillThere === true, renamed)
check('and the link it reads from, exactly',
  renamed.link === renamed.before?.link, { was: renamed.before?.link, now: renamed.link })
check('and the value it is already showing',
  renamed.value === renamed.before?.value && renamed.points === renamed.before?.points, renamed)

// And the name reaches the canvas, which is the whole point of naming.mjs.
await evaluate('renderCanvas?.()')
const onCanvas = await evaluate(`(() => {
  const badge = [...document.querySelectorAll('#Ltags .tagb')].find(n => n.dataset.tag === 'T_MOIST');
  return { badge: badge?.textContent?.trim() || '(not drawn)' };
})()`)
check('and the new name is what the drawing says',
  /Muller moisture, renamed/.test(onCanvas.badge), onCanvas.badge)

/*
 * A search over the table list, where the list is long enough to need one.
 *
 * Sixteen tables in the fixture, against a couple of hundred in a real plant.
 * The box appears above a dozen and not below — under that it is furniture on
 * a list that is already one glance — so this is also what proves it is the
 * length that brings it out rather than it being there always.
 */
const search = await evaluate(`(async () => {
  const drawer = document.getElementById('dlAddDrawer');
  /*
   * On the foundry's own database, whichever one the flow opened on.
   *
   * A registered database's tables are fetched when it is chosen, so reading
   * the list straight away finds "Loading tables…"; the foundry's came with
   * the launch and are there at once.
   */
  const at = id => document.getElementById('dlAddDrawer')?.querySelector('#' + id);
  const wanted = 'conn_' + ${JSON.stringify(addedDb.body.id)} + '|' + ${JSON.stringify(ADDED_DB.database)};
  const database = drawer?.querySelector('#dbDb');
  if (database && database.value !== wanted) {
    database.value = wanted;
    database.dispatchEvent(new Event('change', { bubbles: true }));
  }
  /*
   * The tables of a registered database are fetched when it is chosen, and the
   * flow redraws when they land — which replaces these nodes, and can clear
   * the choice on the way. So this re-chooses until the list stops saying it
   * is loading rather than holding on to the first one it saw.
   */
  for (let i = 0; i < 200; i++) {
    const list = at('dbTbl');
    if (list && list.options.length > 1 && !/loading/i.test(list.options[0].textContent)) break;
    const pick = at('dbDb');
    if (pick && pick.value !== wanted) {
      pick.value = wanted;
      pick.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 100));
  }
  const tables = at('dbTbl');
  const box = document.getElementById('dlAddDrawer')?.querySelector('.dl-table-search');
  const field = box?.querySelector('.dl-table-search-text');
  if (!field || !tables) return {
    box: false,
    options: [...(tables?.options || [])].map(o => o.textContent).slice(0, 8),
  };

  const before = [...tables.options].map(o => o.value).filter(Boolean);
  field.value = 'asset';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const narrowed = [...tables.options].map(o => o.value).filter(Boolean);
  const count = box.querySelector('.dl-table-search-count')?.textContent || '';

  field.value = '';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const after = [...tables.options].map(o => o.value).filter(Boolean);
  return { box: true, before, narrowed, after, count };
})()`)
check('a long table list gets a search box above it', search.box === true, search)
check('typing narrows it to the tables that match',
  search.narrowed?.length > 0 && search.narrowed.every(name => /asset/i.test(name)),
  search.narrowed)
check('and leaves out the ones that do not',
  search.before?.length > (search.narrowed?.length ?? 0),
  { of: search.before?.length, shown: search.narrowed?.length })
check('and clearing it puts every table back',
  search.after?.length === search.before?.length, search)
check('with the box saying how many it is showing',
  /\d+ of \d+/.test(search.count || ''), search.count)

console.log('\nCONTROL CHART — real records, and SandMan\'s own')

/*
 * The window is what the chart asks for, and the only thing it asks for.
 *
 * This has now regressed twice. Both times the chart fetched more than the
 * window and relied on a row count to bound it, and both times the statement
 * in Preview data came back reading `>= '21 Oct 17:13' … LIMIT 2000` under a
 * chart labelled two hours — a statement that does not describe the chart
 * above it, which is the one thing that box exists to prevent.
 *
 * So what goes on the wire is asserted rather than looked at: the window the
 * buttons show, and no `points` at all.
 */
await evaluate(`(() => {
  window.__dlCalls = [];
  if (!window.fetch.__dlWatched) {
    const original = window.fetch;
    const watched = function (input, init) {
      try { window.__dlCalls.push(String(input?.url || input)); } catch {}
      return original.apply(this, arguments);
    };
    watched.__dlWatched = true;
    window.fetch = watched;
  }
})()`)

await evaluate('openTrend("T_MOIST")')
await wait(2500)

const asked = await evaluate(`(() => {
  const url = (window.__dlCalls || []).filter(u => /\\/live\\/chart\\?/.test(u)).pop() || '';
  return { url, window_: /windowSeconds=7200(&|$)/.test(url), capped: /[?&]points=/.test(url) };
})()`)
check('the chart asks for the window on the buttons', asked.window_ === true, asked.url)
check('and sends no row limit with it', asked.capped === false, asked.url)

const chart = await evaluate(`(() => {
  const seg = document.getElementById('dlChartSeg');
  const pts = typeof ccData === 'function' ? ccData() : [];
  return {
    hasSwitch: !!seg,
    buttons: seg ? [...seg.querySelectorAll('button')].map(b => b.textContent) : [],
    points: pts.length,
    firstValue: pts[0]?.v ?? null,
    // Where Copy data (CSV) is, for a reading this service reads itself.
    footer: document.getElementById('trCsv')?.textContent?.trim() || null,
  };
})()`)

/*
 * Both charts here, because this reading is SandMan's.
 *
 * Process Control is SandMan's own calculation, with its own subgroups and
 * limits. A reading on a database registered here has no such thing, so that
 * tab is not offered for one — it used to sit there permanently empty,
 * explaining itself in a tooltip nobody opens. In its place an administrator
 * gets Preview data: the statement the records came from, editable and
 * runnable, which is what answers "why does this chart look wrong".
 */
check('the trend window offers both charts',
  chart.hasSwitch && chart.buttons.length === 2, chart.buttons)
check('and the foot of the window is left as the studio had it',
  chart.footer === 'Copy data (CSV)', chart.footer)

/*
 * The moving range chart is a statistician's check on whether the control
 * limits can be trusted — useful while setting them, noise on the screen when
 * reading a sand line.
 */
const mr = await evaluate(`(() => {
  const gone = el => !el || getComputedStyle(el).display === 'none';
  const title = [...document.querySelectorAll('.cc-title')]
    .find(t => /^moving range/i.test(t.textContent.trim()));
  return { canvasHidden: gone(document.getElementById('trM')), titleHidden: gone(title) };
})()`)
check('the moving range chart is not shown', mr.canvasHidden && mr.titleHidden, mr)
/*
 * Every chart opens on two hours, whatever the reading records.
 *
 * These twelve records are a day apart — a lab result rather than a batch
 * reading — so two hours holds the newest one and the navigator underneath
 * reaches the rest.
 */
check('the individuals chart is drawn from the plant records',
  chart.points >= 1 && chart.points <= RECORDS.length, chart.points)
check('and those are the records themselves',
  Math.abs(chart.firstValue - RECORDS[RECORDS.length - chart.points].value) < 1e-9,
  { shown: chart.firstValue, points: chart.points })

const span = await evaluate(`(() => {
  const seg = document.getElementById('trWin')
  const nav = document.getElementById('dlNav')
  return {
    windows: [...(seg?.querySelectorAll('button') || [])].map(b => b.textContent.trim()),
    on: seg?.querySelector('button.on')?.textContent.trim(),
    navigator: !!nav && getComputedStyle(nav).display !== 'none',
    // What the strip says it is showing, out of what the button read.
    showing: document.getElementById('dlNavNow')?.textContent.trim() || '',
  }
})()`)
check('on the same four windows as every other chart',
  span.windows.join(' ') === '2 h 4 h 8 h 1 day' && span.on === '2 h', span)
check('with the rest of the records a drag away', span.navigator === true, span)
/*
 * The read and the drawn span are two different numbers.
 *
 * The button says what was read — two hours, and the statement in Preview
 * data says exactly that and nothing else. The strip says what is on the
 * chart: half an hour of those records, which is what gives the handle
 * somewhere to slide to. Tying the two together is what left the navigator
 * with a handle the width of the strip.
 */
check('and the chart opens on half an hour of them',
  /^30 min · /.test(span.showing), span.showing)

const pc = await evaluate(`(() => {
  const button = [...document.querySelectorAll('#dlChartSeg button')].find(b => b.dataset.cv === 'pc');
  if (!button) return { ok: false };
  button.click();
  const mean = document.getElementById('dlPcMean');
  const range = document.getElementById('dlPcRange');
  return {
    ok: true,
    hidden: document.getElementById('trC')?.classList.contains('dl-hidden'),
    meanDrawn: !!mean && mean.width > 100,
    rangeDrawn: !!range && range.width > 100,
    title: document.querySelector('#dlPcPanel .cc-title')?.textContent || '',
  };
})()`)

check('Process Control draws SandMan\'s mean and range charts',
  pc.meanDrawn && pc.rangeDrawn, pc)
check('and hides the individuals chart while it is showing', pc.hidden === true, pc.hidden)

const backToImr = await evaluate(`(() => {
  [...document.querySelectorAll('#dlChartSeg button')].find(b => b.dataset.cv === 'imr')?.click();
  const gone = el => !el || getComputedStyle(el).display === 'none';
  const title = [...document.querySelectorAll('.cc-title')]
    .find(t => /^moving range/i.test(t.textContent.trim()));
  return { individualsBack: !gone(document.getElementById('trC')),
           movingRangeStillHidden: gone(document.getElementById('trM')) && gone(title) };
})()`)
check('switching back brings the individuals chart, not the moving range one',
  backToImr.individualsBack && backToImr.movingRangeStillHidden, backToImr)
check('the panel says how many shift averages it was built from',
  /127 shift averages/.test(pc.title || ''), pc.title)

/*
 * One record is a chart.
 *
 * A lab result taken once a shift genuinely has a single record inside a
 * two-hour window, and the chart used to answer "Collecting data…" — which
 * says the reading is on its way when it has already arrived. Drawing around
 * one value is how somebody sees it is inside the specification.
 *
 * Checked by handing the studio a one-point series and making sure the draw
 * goes all the way through: the statistics are finite and nothing throws on
 * the arithmetic that assumes a gap between points.
 */
const lonely = await evaluate(`(() => {
  [...document.querySelectorAll('#dlChartSeg button')].find(b => b.dataset.cv === 'imr')?.click();
  const original = window.ccData;
  const tag = ${peek}('REG')?.T_MOIST;
  try {
    const one = ccStats([{ t: Date.now(), v: 3.4 }], tag);
    window.ccData = () => [{ t: Date.now(), v: 3.4 }];
    drawTrend();
    const none = ccStats([], tag);
    window.ccData = () => [];
    drawTrend();
    return {
      points: one.n,
      finite: Number.isFinite(one.cl) && Number.isFinite(one.sigma) && one.sigma > 0,
      emptyPoints: none.n,
      threw: null,
    };
  } catch (e) {
    return { threw: String(e && e.message || e) };
  } finally {
    window.ccData = original;
    drawTrend();
  }
})()`)
check('a single record is drawn rather than called "collecting"',
  lonely.points === 1 && lonely.finite === true && !lonely.threw, lonely)
check('and an empty window still draws without throwing',
  lonely.emptyPoints === 0 && !lonely.threw, lonely)

/*
 * Sand health scores a line from readings. Until those are linked there is
 * nothing behind it, so on the published screen it would be a confident
 * number computed from dashes.
 */
const bar = await evaluate(`(() => {
  setPresent(true);
  const shi = document.getElementById('pSHI');
  return {
    shown: [...document.querySelectorAll('#pbar button')]
      .filter(b => getComputedStyle(b).display !== 'none').map(b => b.textContent.trim()),
    sandHealthVisible: shi ? getComputedStyle(shi).display !== 'none' : false,
  };
})()`)

check('Sand health is not in the published view',
  bar.sandHealthVisible === false &&
  !(bar.shown || []).some(t => /Sand health/i.test(t)), bar.shown)

console.log('\nTHE WRITTEN PROCEDURE — from its tables, not from the drawing')

/*
 * The decisive test is a disagreement.
 *
 * The SOP used to live inside `DOC.cps[].sop`, saved with the drawing, which
 * made "is this coming from the database?" unanswerable — the drawing was in
 * the database too. So a procedure is written into the tables that says
 * something the layout does not, and whichever one the panel shows is the one
 * it is reading from.
 */
const written = await call('PUT', `/sops/${made.body.id}/cp_probe`, {
  processName: 'Probe process',
  no: 'SOP-FROM-THE-DATABASE',
  version: '3.2', status: 'Approved', owner: 'Sand engineer',
  ppe: ['Safety shoes', 'Helmet'],
  steps: [
    { t: 'Confirm the component group and its sandmix prescription.', key: 'Prescription loaded', crit: 1 },
    { t: 'Charge return sand, then additives as per prescription.', key: 'Bentonite as prescribed', crit: 1 },
  ],
  reaction: [{ cond: 'Compactability out of limit', action: 'Adjust water set point', esc: 'Mixer operator' }],
})
check('a procedure can be written against the open loop', written.status === 201, written.body)

const adopted = await evaluate(`(async () => {
  const DOC = ${peek}('DOC');
  // A process to hang it on. The studio seeds these from equipment; this
  // fixture has none of the equipment its templates look for.
  DOC.cps = [{ id: 'cp_probe', name: 'Probe process', blocks: [], items: [],
    sop: { no: 'FROM-THE-DRAWING', version: '0.1', status: 'Draft', steps: [], reaction: [] } }];
  const answer = await fetch('api/v1/sops?loopId=' + encodeURIComponent(${JSON.stringify(made.body.id)}),
    { credentials: 'same-origin', headers: { 'x-requested-with': 'digital-loop' } });
  const body = await answer.json();
  const stored = (body.sops || []).find(s => s.processId === 'cp_probe');
  if (stored) {
    DOC.cps[0].sop = {
      no: stored.no, title: stored.title, version: stored.version, status: stored.status,
      owner: stored.owner, ppe: stored.ppe, steps: stored.steps, reaction: stored.reaction,
    };
  }
  const sop = DOC.cps[0].sop;
  return {
    status: answer.status,
    no: sop.no, version: sop.version, owner: sop.owner,
    steps: (sop.steps || []).map(s => s.t),
    keys: (sop.steps || []).map(s => s.key),
    reaction: (sop.reaction || []).map(r => r.cond),
    ppe: sop.ppe,
  };
})()`)
check('the studio reads it back over the one in the drawing',
  adopted.no === 'SOP-FROM-THE-DATABASE', adopted.no)
check('with its version and owner',
  adopted.version === '3.2' && adopted.owner === 'Sand engineer', adopted)
check('its steps in order, each keeping its key point',
  adopted.steps?.length === 2 && /sandmix prescription/.test(adopted.steps[0]) &&
  adopted.keys?.[1] === 'Bentonite as prescribed', adopted.steps)
check('its reaction plan', adopted.reaction?.[0] === 'Compactability out of limit', adopted.reaction)
check('and the lists that are read whole', adopted.ppe?.length === 2, adopted.ppe)

check('nothing threw on the page', thrown.length === 0, thrown)

/* ---------------------------------------------------------------- teardown ---*/

try { await fetch(`${DEVTOOLS}/json/close/${browserTarget.id}`) } catch { /* gone */ }
ws.close()
for (const loop of (await call('GET', '/loops')).body || []) {
  await call('DELETE', `/loops/${loop.id}`)
}
await sweepTestConnections()

console.log(`\n${passed} passed, ${failed} failed`)
stop()
process.exit(failed ? 1 : 0)
