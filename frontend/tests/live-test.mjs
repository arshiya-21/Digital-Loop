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
const DATABASE = {
  name: `livetest_${stamp}`,
  tables: [{
    name: 'preparedsand',
    columns: [{ name: 'pkey', type: 'int' }, { name: 'moisture', type: 'float' }],
  }],
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
      tags: [{ id: 'T_MOIST' }, { id: 'T_PLAIN' }],
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
layout.DOC.blocks[0].tags.push({ id: 'T_OLD' }, { id: 'T_TEXT' })

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
check('the foundry\'s own database is still there too',
  seen.pickable.includes(DATABASE.name), seen.pickable?.slice(0, 300))
check('with no invitation to add one by typing a host into the browser',
  !seen.pickable.includes('__manage'), seen.pickable?.slice(0, 200))
/*
 * A demo source is a real choice, and the number it gives is invented. The
 * chip has to say which — "Linked", the studio's own answer, is the confident
 * green pill on a random walk this exists to prevent.
 */
check('a reading left pointing at a removed demo server says so',
  seen.chipOld === 'Not connected', seen.chipOld)

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

  // One step at a time, from nothing chosen: the database is asked for first,
  // and the table, the column and the name each wait for the one before.
  out.stepsWhenOpened = [...drawer.querySelectorAll('.db-step')].map(step =>
    (step.querySelector('i')?.textContent || '?') +
    (getComputedStyle(step).display === 'none' ? ':hidden' : ':shown'));
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
check('which offers the foundry database and nothing invented',
  (panel.offered || []).some(o => /Customer default/.test(o)) &&
  !(panel.offered || []).some(o => /SandMan Production DB|Sand Lab LIMS|SandMan Gateway/.test(o)),
  panel.offered)
check('the dropdown opens directly under the heading, not below the readings',
  panel.childOrder?.[1] === 'dlAddDrawer', panel.childOrder)
check('and the steps come one at a time — only the database to begin with',
  panel.stepsWhenOpened?.join(' ') === '1:shown 2:hidden 3:hidden 4:hidden',
  panel.stepsWhenOpened)

console.log('\nCONTROL CHART — real records, and SandMan\'s own')

await evaluate('openTrend("T_MOIST")')
await wait(2500)

const chart = await evaluate(`(() => {
  const seg = document.getElementById('dlChartSeg');
  const pts = typeof ccData === 'function' ? ccData() : [];
  return {
    hasSwitch: !!seg,
    buttons: seg ? [...seg.querySelectorAll('button')].map(b => b.textContent) : [],
    points: pts.length,
    firstValue: pts[0]?.v ?? null,
  };
})()`)

check('the trend window offers both charts',
  chart.hasSwitch && chart.buttons.length === 2, chart.buttons)

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
check('the individuals chart is drawn from the plant records',
  chart.points === RECORDS.length, chart.points)
check('and those are the records themselves',
  Math.abs(chart.firstValue - RECORDS[0].value) < 1e-9, chart.firstValue)

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

check('nothing threw on the page', thrown.length === 0, thrown)

/* ---------------------------------------------------------------- teardown ---*/

try { await fetch(`${DEVTOOLS}/json/close/${browserTarget.id}`) } catch { /* gone */ }
ws.close()
for (const loop of (await call('GET', '/loops')).body || []) {
  await call('DELETE', `/loops/${loop.id}`)
}
for (const conn of (await call('GET', '/connections')).body || []) {
  if (conn.label === ADDED_DB.label) await call('DELETE', `/connections/${conn.id}`)
}

console.log(`\n${passed} passed, ${failed} failed`)
stop()
process.exit(failed ? 1 : 0)
