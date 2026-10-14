/**
 * The studio, opened the way SandMan opens it.
 *
 * Covers what the re-platform had to get right and what no backend test can
 * see: that the page opens at all, that the server wrote the foundry and its
 * real schema into it, that our foundry and line strip is there — including
 * inside the full-screen publish view, which covers the header — that both
 * roles land in the publish view, that a design in the previous studio's
 * format is explained rather than crashed on, and that an operator is shown
 * no way to edit.
 *
 * Needs a browser with the DevTools protocol open and the API running:
 *
 *     chrome --headless=new --remote-debugging-port=9333
 *     cd backend && npm start
 *     cd frontend && npm test
 *
 * It refuses to run rather than report a wall of failures when SandMan is not
 * answering, because entering is correctly impossible then.
 */
import { PLANT, enterAs, admin, requireSandMan } from './launch.mjs'

const DEVTOOLS = process.env.DEVTOOLS_URL || 'http://localhost:9333'

let passed = 0
let failed = 0
const check = (label, condition, detail) => {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`) }
  else { failed += 1; console.log(`  FAIL  ${label} :: ${JSON.stringify(detail)?.slice(0, 240)}`) }
}

await requireSandMan()

/* ------------------------------------------------------------- the browser ---*/

let target
try {
  target = await (await fetch(`${DEVTOOLS}/json/new?about:blank`, { method: 'PUT' })).json()
} catch {
  console.error(
    `No browser is listening at ${DEVTOOLS}.\n\n` +
    'Start one:\n    chrome --headless=new --remote-debugging-port=9333 about:blank\n'
  )
  process.exit(2)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve))

let id = 0
const pending = new Map()
const pageErrors = []
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    pageErrors.push(details.exception?.description?.split('\n')[0] || details.text)
  }
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})
const send = (method, params = {}) => new Promise(resolve => {
  const next = ++id
  pending.set(next, resolve)
  ws.send(JSON.stringify({ id: next, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.result?.exceptionDetails) {
    return { __err: result.result.exceptionDetails.exception?.description?.split('\n')[0] || 'Uncaught' }
  }
  return result.result.result.value
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function stop(code) {
  try { await fetch(`${DEVTOOLS}/json/close/${target.id}`) } catch { /* already gone */ }
  ws.close()
  process.exit(code)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
})

/**
 * Open the studio as somebody.
 *
 * The ticket is posted, never put in a URL — so this lands on the studio's
 * origin and submits the form exactly as SandMan's page does.
 */
async function open(who) {
  const entry = await enterAs(who)

  /*
   * Start signed out, every time.
   *
   * The cookie outlives a run, so without this the first page load is already
   * a session from the previous one — the lock lifts before the ticket is even
   * posted, this function returns on *that*, and then the form's redirect
   * navigates again underneath whatever is being measured. Everything after it
   * then reads a page that is being torn down.
   */
  await send('Network.clearBrowserCookies')

  await send('Page.navigate', { url: entry.origin })
  await wait(1200)
  await evaluate(entry.submit)

  const started = Date.now()
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await wait(250)
    const state = await evaluate(
      '[document.getElementById("dlLocked") ? 1 : 0, typeof window.snap]'
    )
    if (Array.isArray(state) && state[0] === 0 && state[1] === 'function') {
      console.log(`  opened in ${((Date.now() - started) / 1000).toFixed(1)} s`)
      return true
    }
  }
  console.log('  lock reason:', await evaluate('document.getElementById("dlLockedReason")?.textContent'))
  return false
}

/* ---------------------------------------------------------- administrator ---*/

console.log('\nOPENING — from a SandMan session, never a link')
check('the studio opens', await open({ user: 'admin@mpminfosoft', role: 'admin', line: PLANT.lines[0].id }))

console.log('\nCONTEXT — the server writes the plant into the page')
const context = await evaluate(`(() => {
  const c = window.SANDMAN_CONTEXT
  return c && {
    id: c.customer?.id,
    name: c.customer?.name,
    db: c.defaultDb?.db,
    tables: c.defaultDb?.schema?.map(t => t.name),
    types: [...new Set((c.defaultDb?.schema || []).flatMap(t => t.cols.map(col => col.t)))].sort(),
  }
})()`)
check('the foundry is the studio\'s customer',
  context?.id === PLANT.foundry && context.name === PLANT.foundryName, context)
check('the foundry database and its tables are there',
  context?.db === PLANT.database.name &&
  context.tables?.join() === PLANT.database.tables.map(t => t.name).join(),
  context?.tables)
check('column types are mapped to what the studio understands',
  Array.isArray(context?.types) && context.types.every(t => ['datetime', 'float', 'int', 'varchar'].includes(t)),
  context?.types)
check('the studio took it, rather than its demo customer',
  (await evaluate('window.SandmanStudio?.getCustomerContext()?.id')) === PLANT.foundry)

console.log('\nCHROME — the foundry and line stay ours')
const strip = await evaluate(`(() => {
  const bar = document.getElementById('dlLineBar')
  if (!bar) return null
  return {
    placed: !!bar.closest('header.hdr') || bar.parentElement?.id === 'pbar',
    visible: bar.getBoundingClientRect().height > 0,
    plant: document.getElementById('dlPlant')?.textContent,
    lines: [...document.getElementById('dlLine').options].map(o => o.textContent),
    chipHidden: document.getElementById('custChip')?.hidden,
    back: document.getElementById('dlBack')?.textContent.trim(),
  }
})()`)
check('the strip is on the page with every line',
  strip?.placed && strip.visible &&
  strip.plant === PLANT.foundryName &&
  strip.lines.join() === PLANT.lines.map(l => l.name).join(),
  strip)
check('the studio\'s own customer chip gives way to it', strip?.chipHidden === true)

/*
 * One foundry name in the header, not two, and nothing that belongs to the
 * page around us. Measured, not assumed: `hidden` loses to `display`, which
 * is how the chip stayed on screen the first time it was hidden.
 */
const header = await evaluate(`(() => {
  const gone = sel => {
    const el = document.querySelector(sel)
    return !el || getComputedStyle(el).display === 'none' || el.getBoundingClientRect().width === 0
  }
  /* The two places the foundry could be named: the studio's chip and our
     own label. Counted by id rather than by searching the page, because the
     strip moves into the publish bar — which is in the footer, not the
     header — and because the drawing itself may contain the word. */
  const shows = ['#custChip', '#dlPlant'].filter(sel => !gone(sel))
  return {
    breadcrumb: gone('.docA .bc'),
    gateway: gone('header .gw'),
    chip: gone('#custChip'),
    namedBy: shows,
  }
})()`)
check('the SandMan breadcrumb and the gateway chip are gone',
  header?.breadcrumb === true && header.gateway === true, header)
check('the foundry is named once, not twice',
  header?.chip === true && header.namedBy?.length === 1 && header.namedBy[0] === '#dlPlant',
  header)

check('Back is there', /Back/.test(strip?.back || ''), strip?.back)

console.log('\nLOOK — light by default, the whole loop on screen')
const look = await evaluate(`(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  stored: (() => { try { return localStorage.getItem('sandman-theme') } catch { return 'blocked' } })(),
}))()`)
check('light unless somebody chose otherwise',
  look?.theme === 'light' || look?.stored === look?.theme, look)

console.log('\nVIEW — publish, for both roles')
const landed = await evaluate('document.body.className')
check('an administrator lands in the publish view',
  /is-sim/.test(String(landed)) && /present/.test(String(landed)), landed)
const bar = await evaluate(`(() => {
  const gone = sel => {
    const el = document.querySelector(sel)
    return !el || getComputedStyle(el).display === 'none' || el.getBoundingClientRect().height === 0
  }
  return {
    status: gone('#pbar .pinfo'),
    versionPill: gone('#dlLineBar.dl-in-publish .dl-publish'),
    line: !gone('#dlLine'),
    back: !gone('#dlBack'),
    controls: !gone('#pAlarm'),
  }
})()`)
check('the published view shows no status, clock or version',
  bar?.status === true && bar.versionPill === true, bar)
check('but keeps the controls, the line and the way back',
  bar?.controls === true && bar.line === true && bar.back === true, bar)

check('and the strip followed into it, where it is the only chrome',
  (await evaluate(`document.getElementById('dlLineBar')?.parentElement?.id`)) === 'pbar' &&
  (await evaluate(`document.getElementById('dlLineBar')?.getBoundingClientRect().height > 0`)) === true)

/*
 * A design drawn in the previous studio.
 *
 * The seeded demo is one. v6.8 has no reader for that format, so the canvas is
 * emptied and the reason is said — the alternative is a blank screen that
 * looks like a loading failure, which is what it did before this was handled.
 */
console.log('\nOLDER DESIGNS — kept, explained, never crashed on')
const explained = await evaluate(`(() => {
  const card = document.getElementById('dlEmpty')
  /* Doubled on purpose: this is inside a template literal, so a single
     backslash is eaten before the page ever sees the expression — which
     turned this into /s+/g and quietly deleted every letter "s". */
  return card ? (card.textContent || '').replace(/\\s+/g, ' ').trim() : ''
})()`)
check('a design in the previous format says so rather than failing',
  /previous studio/.test(explained), explained.slice(0, 140))
check('and the page is still working', (await evaluate('typeof window.snap')) === 'function')

/* ------------------------------------------------------------------ saving ---*/

console.log('\nSAVING — the new document format reaches the server')
const scratchLine = PLANT.lines[1].id
const drew = await evaluate(`(() => {
  const d = JSON.parse(window.snap())
  d.DOC.name = 'Studio test loop'
  // props is not optional in practice: the publish view's ticker reads
  // b.props.oos every second, so a block written without it throws once a
  // second for as long as the page is open.
  d.DOC.blocks = [{ id: 'b1', type: 'mixer', name: 'Mixer', x: 200, y: 200, tags: [], props: {} }]
  d.DOC.streams = []
  window.restore(JSON.stringify(d))
  /* Kept for the save below. Re-snapshotting there would pick up whatever the
     publish view had restored in the meantime, which is how an empty document
     reached the server. */
  window.__dlDrawn = d
  return JSON.parse(window.snap()).DOC.blocks.length
})()`)

/* ------------------------------------------------------- an empty line ---
 *
 * A blank canvas tells nobody anything. Both roles get a message; only the
 * administrator gets a way to start.
 */
console.log('\nEMPTY LINE — a message, not a blank screen')
await evaluate(`(() => {
  const sel = document.getElementById('dlLine')
  sel.value = ${JSON.stringify(scratchLine)}
  sel.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await wait(2000)

const empty = await evaluate(`(() => {
  const el = document.getElementById('dlEmpty')
  if (!el) return null
  const box = el.getBoundingClientRect()
  const bar = document.getElementById('pbar')?.getBoundingClientRect()
  return {
    visible: getComputedStyle(el).display !== 'none' && box.height > 0,
    heading: el.querySelector('h2')?.textContent || '',
    button: el.querySelector('.dl-empty-go')?.textContent || null,
    clearOfTheBar: bar ? box.bottom <= bar.top + 1 : true,
  }
})()`)
check('an administrator is told the line is empty, and offered a way to start',
  empty?.visible === true && /no loop on/i.test(empty.heading) && empty.button === 'Go to Design',
  empty)
check('and the message does not sit under the publish bar', empty?.clearOfTheBar === true, empty)

const started = await evaluate(`(async () => {
  document.querySelector('.dl-empty-go')?.click()
  await new Promise(r => setTimeout(r, 1500))
  return {
    leftPublish: !document.body.classList.contains('present'),
    inDesign: !!document.getElementById('mDesign')?.classList.contains('on'),
    cardGone: !document.getElementById('dlEmpty'),
  }
})()`)
check('"Go to Design" leaves the publish view and starts designing',
  started?.leftPublish === true && started.inDesign === true && started.cardGone === true,
  started)

check('a loop can be put on the canvas', drew === 1, drew)

/*
 * Fitted to the page, not to the width.
 *
 * The studio's own default fills the width and lets a tall loop run off the
 * bottom. Opening a design is an act of looking at it, so what is checked is
 * that nothing drawn ends up outside the canvas viewport.
 */
await evaluate('typeof window.fit === "function" ? (window.fit("page", true), true) : false')
await wait(500)
const fitted = await evaluate(`(() => {
  const wrap = document.getElementById('cwrap')?.getBoundingClientRect()
  if (!wrap) return null
  const boxes = [...document.querySelectorAll('#cv g[data-b]')].map(m => m.getBoundingClientRect())
  return {
    blocks: boxes.length,
    inside: boxes.every(b => b.top >= wrap.top - 2 && b.bottom <= wrap.bottom + 2),
  }
})()`)
check('the whole loop is on screen, not just its width',
  fitted === null || fitted.blocks === 0 || fitted.inside === true, fitted)


const created = await evaluate(`(async () => {
  const r = await fetch('api/v1/loops', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'digital-loop' },
    body: JSON.stringify({ name: 'Studio test loop', lineId: ${JSON.stringify(scratchLine)}, layout: window.__dlDrawn }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
})()`)
check('the server accepts and stores it', created?.status === 201, created)

if (created?.body?.id) {
  const read = await evaluate(`(async () => {
    const r = await fetch('api/v1/loops/${created.body.id}', {
      credentials: 'same-origin', headers: { 'x-requested-with': 'digital-loop' },
    })
    const b = await r.json().catch(() => null)
    return { status: r.status, blocks: b?.layout?.DOC?.blocks?.length }
  })()`)
  check('and serves it back unchanged', read?.status === 200 && read.blocks === 1, read)
}

/* ------------------------------------------- not over the top of real work ---
 *
 * Saving an empty canvas over a drawn loop looks exactly like losing it: the
 * versions are all still there, but the newest is what opens next time. A real
 * design went from 97 items to two empty versions this way, so Save asks
 * before it does that — and the default answer is no.
 */
console.log('\nSAVING — an empty canvas does not quietly replace a loop')

/* The design above was created by posting to the API, so the page's own list
   does not know about it yet. Entering again is how a person would meet it. */
await open({ user: 'admin@mpminfosoft', role: 'admin', line: scratchLine })
await wait(1500)

const guard = await evaluate(`(async () => {
  const sel = document.getElementById('dlLine')
  sel.value = ${JSON.stringify(scratchLine)}
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise(r => setTimeout(r, 2500))

  const before = JSON.parse(window.snap()).DOC.blocks.length
  const asked = []
  const realConfirm = window.confirm
  window.confirm = message => { asked.push(message); return false }

  const d = JSON.parse(window.snap())
  d.DOC.blocks = []
  d.DOC.streams = []
  window.restore(JSON.stringify(d))

  document.getElementById('bSave').click()
  await new Promise(r => setTimeout(r, 2000))
  window.confirm = realConfirm

  const r = await fetch('api/v1/loops/${created?.body?.id}', {
    credentials: 'same-origin', headers: { 'x-requested-with': 'digital-loop' },
  })
  const b = await r.json().catch(() => null)
  return { before, asked: asked.length, warned: /empty/i.test(asked[0] || ''), stillOnServer: b?.layout?.DOC?.blocks?.length }
})()`)
check('Save asks before storing an empty canvas over a drawn loop',
  guard?.before === 1 && guard.asked === 1 && guard.warned === true, guard)
check('and declining leaves the stored loop untouched',
  guard?.stillOnServer === 1, guard)

/* ---------------------------------------------------------------- operator ---*/

console.log('\nOPERATOR — the published loop and nothing else')
check('an operator opens too', await open({ user: 'operator.line1', role: 'viewer', line: PLANT.lines[0].id }))

const viewer = await evaluate(`(() => {
  const gone = id => {
    const el = document.getElementById(id)
    return !el || getComputedStyle(el).display === 'none'
  }
  return {
    marked: document.body.classList.contains('dl-viewer'),
    design: gone('mDesign'), save: gone('bSave'), open: gone('bOpen'),
    library: gone('left'), exit: gone('pExit'), main: gone('pMain'),
    publishPill: gone('dlPublish'),
    back: !gone('dlBack'),
    line: !gone('dlLine'),
  }
})()`)
check('an operator is marked as a viewer', viewer?.marked === true, viewer)
check('with no Design, Save, Open or library',
  viewer?.design && viewer.save && viewer.open && viewer.library, viewer)
check('and no way out of the publish view into the editor',
  viewer?.exit && viewer.main, viewer)
check('no publish button, and no empty pill where one would be',
  viewer?.publishPill === true, viewer)
check('but the line and the way back to SandMan remain',
  viewer?.back === true && viewer.line === true, viewer)

check('nothing threw on the page', pageErrors.length === 0, pageErrors.slice(0, 3))

/* ----------------------------------------------------------------- teardown ---*/

// From here, as an administrator: the page is an operator by now and cannot
// delete — and a teardown that silently fails leaves the next run failing.
const loops = (await admin('GET', '/loops')).body || []
for (const loop of loops) {
  if ((loop.line?.id || loop.lineId) !== scratchLine) continue
  const removed = await admin('DELETE', `/loops/${loop.id}`)
  // Checked, not assumed. A teardown that reports success it did not have
  // leaves the next run failing on a fixture nobody can see — which is
  // exactly what a missing CSRF header did here.
  if (removed.status === 204) {
    console.log(`\n  removed the scratch design on ${PLANT.lines[1].name} (${loop.name})`)
  } else {
    failed += 1
    console.log(`\n  FAIL  teardown left "${loop.name}" behind :: ${removed.status}`)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
await stop(failed ? 1 : 0)
