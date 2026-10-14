import { api, ApiError } from './api.mjs'
import { peek } from './studio.mjs'

/**
 * Real readings, in place of the studio's simulated ones.
 *
 * The studio invents a plausible number for every reading so a loop can be
 * drawn and demonstrated before anything is connected. That is the right
 * default and it stays: a reading nobody has linked to a column still moves,
 * and is marked **Demo** so nobody mistakes it for the plant.
 *
 * A reading that *is* linked to the foundry's database is taken over here. The
 * drawing does not change — same equipment, same positions, same limits — only
 * where the number comes from:
 *
 *     linked     the last record SandMan read, marked Live, with its own
 *                date and time
 *     unlinked   the simulation, marked Demo
 *     stale      the last real record, kept on screen and marked grey,
 *                because SandMan is not answering
 *
 * **The browser never talks to SandMan.** It asks this service for one loop's
 * values; the service decides from the session and the stored layout which
 * columns that means, and asks SandMan itself. Nothing here sends a foundry, a
 * line, a table or a column, and there is no endpoint that would accept one.
 *
 * ## Reaching into the studio
 *
 * `VAL` and `REG` are declared `const` at the top level of a classic script.
 * That does not put them on `window` — but it does put them in the global
 * lexical environment, which anything evaluated in global scope can see. So
 * `new Function('return VAL')()` reaches them, and the handful of functions
 * this needs to wrap (`simTick`, `ccData`, `chipFor`, `liveText`) are ordinary
 * top-level declarations and therefore on `window` already.
 *
 * That is the whole of the coupling, and it is deliberately all in this file:
 * the studio is vendored and replaced wholesale on every drop, so nothing of
 * ours is spliced into it.
 */

/**
 * How often to ask SandMan whether anything changed: every thirty seconds.
 *
 * Nothing here reads every second — that is the studio's simulation, which
 * ticks at 1 Hz because it is drawing a plausible curve.
 *
 * A poll that finds the same record does nothing: no history point, no redraw.
 * And a loop with no linked readings is not polled at all. So the cost of the
 * shorter interval is one small request per open studio, which is what makes
 * it affordable — the thing that used to be expensive was asking about loops
 * that had nothing to ask about.
 *
 * **This is deliberately the same as the server's cache window**
 * (`sandman.valuesCacheMs`). The cache is what makes many open studios cost
 * one read of the foundry's database; a poll faster than the cache would be
 * served the same bytes again, and a slower one would let the entry expire
 * unused. If one is changed the other should change with it.
 */
const POLL_MS = 30_000

/** The studio's name for "linked to the foundry's own database". */
const CUSTOMER = 'customer'

const VAL = () => peek('VAL')
const REG = () => peek('REG')

/* ------------------------------------------------------------- the state ---*/

/** The loop being watched, or null when nothing is open. */
let loopId = null
let timer = null

/**
 * tagId → the last record seen, plus the moment it was recorded.
 *
 * `stamp` is what decides whether a poll brought something new. Without it
 * every poll would push the same record onto the history again and a chart of
 * one lab result an hour would look like a reading every thirty seconds.
 */
const records = new Map()

/** True when the last poll could not reach SandMan. */
let stale = false
/** Why the readings are not live, when they are not. */
let reason = ''

/** Per-tag problems SandMan reported — "unknown column" and the like. */
const problems = new Map()

/** Is this reading one we are driving? */
const isLinked = id => records.has(id) || problems.has(id)

/** Every reading in the open document that points at the foundry's database. */
function linkedIds() {
  const reg = REG() || {}
  return Object.keys(reg).filter(id => reg[id]?.link?.src === CUSTOMER)
}

/* ------------------------------------------------- when a record arrives ---*/

/**
 * The moment a record was taken, in milliseconds.
 *
 * `date` + `time` is what the plant recorded and what an operator recognises.
 * `recordedAt` is the fallback for a table that keeps only a timestamp. A
 * record with neither is placed at "now", because a point with no time at all
 * cannot go on a chart.
 */
function momentOf(record) {
  if (record.date) {
    const stamp = Date.parse(`${record.date}T${record.time || '00:00:00'}`)
    if (Number.isFinite(stamp)) return stamp
  }
  const fallback = Date.parse(record.recordedAt || '')
  return Number.isFinite(fallback) ? fallback : Date.now()
}

/** A record's identity, for telling a new reading from the same one again. */
const stampOf = record =>
  `${record.date || ''}|${record.time || ''}|${record.recordedAt || ''}|${record.value}`

/**
 * Write one record into the studio's value store.
 *
 * `v` is what everything on the canvas reads; `x` is the simulation's target,
 * set to the same thing so that if this reading is ever unlinked it carries on
 * from the real value rather than jumping.
 *
 * The history is only appended to when the record actually changed. The first
 * real record also clears whatever the simulation had seeded, so a chart of a
 * linked reading contains plant data and nothing else.
 */
function writeRecord(id, record) {
  const values = VAL()
  if (!values) return false

  const previous = records.get(id)
  const stamp = stampOf(record)
  // The same record again. Nothing to write, nothing to redraw — which is the
  // usual case, because a poll is far faster than the plant records.
  if (previous && previous.stamp === stamp) return false

  window.ensureVal?.(id)
  const slot = values[id]
  if (!slot) return false

  const number = typeof record.value === 'number' && Number.isFinite(record.value)
    ? record.value
    : null

  /*
   * A text column — a pattern name, a batch number, a grade.
   *
   * As of v9.40 the studio has a tag type for these and one place that draws
   * them (`tagTxt`), reached through `setTagText`. Using it means a text
   * reading appears on the drawing, in Properties and on the value widgets
   * exactly like any other; writing the string onto `VAL` by hand, as this
   * did before that existed, put it somewhere nothing looked at.
   *
   * It is still not a point on a chart, and must not become NaN on one.
   */
  if (number === null) {
    const text = record.value == null ? '' : String(record.value)
    if (typeof window.setTagText === 'function') window.setTagText(id, text)
    else slot.text = text
    // A pattern name is not a point on a chart. Anything the simulation left
    // in this reading's history before the first record arrived is not one
    // either, so the series goes rather than being charted as if it were.
    slot.h = []
  } else {
    // Back to a number: clear any text this reading was showing, or the
    // studio would keep drawing the old string over the new value.
    delete slot.text
    if (peek('REG')?.[id]?.txt) window.setTagText?.(id, '')
    slot.v = number
    slot.x = number
    // The simulation seeded 300 invented points. The first real record is
    // where this reading's history actually begins.
    if (!previous) slot.h = []
    slot.h.push({ t: momentOf(record), v: number })
    if (slot.h.length > 900) slot.h.shift()
  }

  records.set(id, { ...record, stamp, at: momentOf(record) })
  return true
}

/** When the newest record arrived, for "last changed" as against "last asked". */
let lastChangeAt = null
/** When SandMan was last asked, whatever the answer was. */
let lastCheckAt = null

/* --------------------------------------------------------------- polling ---*/

async function pollOnce() {
  if (!loopId) return

  /*
   * Nobody is looking.
   *
   * A studio in a background tab, or on a terminal whose screen has gone to
   * sleep, does not need the plant's numbers — and will ask for them the
   * moment it comes back, because `visibilitychange` polls immediately. This
   * is what stops a forgotten tab reading the foundry's database all night.
   */
  if (document.visibilityState === 'hidden') return

  const wasStale = stale
  let changed = false

  try {
    const answer = await api.get(`/live/values?loopId=${encodeURIComponent(loopId)}`)
    lastCheckAt = Date.now()
    stale = !!answer.stale
    reason = stale ? 'SandMan is not answering — showing the last reading.' : ''

    const hadProblems = problems.size
    problems.clear()
    for (const [id, why] of Object.entries(answer.errors || {})) problems.set(id, why)
    if (hadProblems !== problems.size) changed = true

    for (const [id, record] of Object.entries(answer.values || {})) {
      // `null` means the line has no record for that column yet. The reading
      // is still linked — it is simply empty, which is not the same as demo.
      if (record) {
        if (writeRecord(id, record)) changed = true
      } else if (!records.has(id)) {
        records.set(id, null)
        changed = true
      }
    }

    if (changed) lastChangeAt = Date.now()
  } catch (error) {
    /*
     * A 503 is SandMan being unreachable, which is expected and handled: keep
     * the last real values and mark them stale. Anything else is this service
     * failing, which is also no reason to put invented numbers on a plant
     * screen — so the readings stay where they are either way.
     */
    lastCheckAt = Date.now()
    stale = true
    reason = error instanceof ApiError && error.status === 503
      ? 'SandMan is not answering — showing the last reading.'
      : `Live readings are unavailable: ${error.message}`
  }

  /*
   * Redraw only when something is actually different.
   *
   * Most polls find the same record as the last one — a lab result changes per
   * shift, not per minute — and redrawing every badge on the canvas to show
   * the same numbers is work nobody asked for. Going stale, or coming back
   * from stale, is a change worth showing even when no value moved.
   */
  if (changed || stale !== wasStale) refreshChrome()
}

/**
 * Start or stop the timer according to whether there is anything to ask about.
 *
 * **A loop with no linked readings is not polled at all.** Every poll costs the
 * server a read of the design and a parse of its layout to discover the same
 * nothing, and a loop still being drawn can sit open for hours — a hundred
 * requests an evening, each one answered "no linked readings". There is no
 * reason to ask SandMan about a loop that names none of its columns.
 *
 * Called again whenever the document changes, so linking the first reading
 * starts the polling and unlinking the last one stops it.
 */
function schedule() {
  clearInterval(timer)
  timer = null
  if (!loopId) return

  if (!linkedIds().length) {
    // Nothing is linked. Drop anything held from a previous document so the
    // chips do not keep claiming readings this loop does not have.
    records.clear()
    problems.clear()
    return
  }

  pollOnce()
  timer = setInterval(pollOnce, POLL_MS)
}

/** Start watching a loop. Safe to call again for the same one. */
export function start(id) {
  if (loopId === id && timer) return
  stop()
  loopId = id || null
  if (!loopId) return
  schedule()
}

/** Stop watching, and forget what was read. */
export function stop() {
  clearInterval(timer)
  timer = null
  loopId = null
  records.clear()
  problems.clear()
  stale = false
  reason = ''
}

/* ---------------------------------------------- keeping the simulation off ---
 *
 * `simTick` runs every second and rewrites every reading in `REG`, history
 * included. A linked reading has to survive that, and the tidiest way to do it
 * without touching the studio's source is to let the tick run and then put the
 * real values back — the alternative, a filtered copy of the tick, is a copy
 * of a function that changes with every drop.
 */

function guardSimulation() {
  const original = window.simTick
  if (typeof original !== 'function' || original.__dlGuarded) return

  const guarded = function simTickWithLiveReadings(...args) {
    const values = VAL() || {}
    const held = []
    for (const id of records.keys()) {
      const slot = values[id]
      if (slot) held.push([id, slot.v, slot.x, slot.h.length, slot.text])
    }

    original.apply(this, args)

    for (const [id, v, x, depth, text] of held) {
      const slot = values[id]
      if (!slot) continue
      slot.v = v
      slot.x = x
      if (text === undefined) delete slot.text
      else slot.text = text
      // The tick pushed a simulated point onto every reading's history.
      if (slot.h.length > depth) slot.h.length = depth
    }
  }

  guarded.__dlGuarded = true
  guarded.original = original
  window.simTick = guarded
}

/**
 * Re-decide whether to poll whenever the document changes.
 *
 * `changed()` is what the studio calls after every edit — it redraws and
 * persists. Linking the first reading to the foundry's database therefore
 * starts the polling within a moment, and unlinking the last one stops it,
 * without the integration having to watch for either specifically.
 *
 * Debounced, because an edit can call `changed()` several times in a row and
 * re-deciding is only worth doing once they have settled.
 */
function followDocumentChanges() {
  const original = window.changed
  if (typeof original !== 'function' || original.__dlLive) return

  let queued = null
  const replaced = function changedThenReconsiderPolling(...args) {
    const result = original.apply(this, args)
    clearTimeout(queued)
    queued = setTimeout(() => {
      // Only when the answer would actually differ: `schedule()` restarts the
      // timer, and restarting it on every keystroke would reset the minute.
      const wanted = linkedIds().length > 0
      if (wanted !== !!timer) schedule()
    }, 400)
    return result
  }

  replaced.__dlLive = true
  replaced.original = original
  window.changed = replaced
}

/** Ask again as soon as somebody comes back to the tab. */
function pollWhenVisibleAgain() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && timer) pollOnce()
  })
}

/* ------------------------------------------------ the source of a reading ---
 *
 * The studio ships three demo data sources — a PLC gateway, a production SQL
 * server and a LIMS — hardcoded in `08-data-links.js`, with a hardcoded schema
 * behind them. They connect to nothing, and they come back with every drop.
 *
 * They are replaced, not merely hidden, by the databases that actually exist:
 * see `databases.mjs`. What is left here is the labelling — saying which of
 * those a reading is actually getting a number from.
 */

/**
 * Take "Add or manage data sources…" out of the source menu.
 *
 * The studio's own panel adds a server by typing a host into the browser,
 * which is not how a database gets registered here: Digital Loop holds the
 * password and dials out itself, so one is added through the API, by an
 * administrator, and the credential never reaches the page. Leaving the option
 * would offer a second way that quietly does something else.
 *
 * The option is removed from the rendered markup rather than by rewriting
 * `srcOptions`, because reimplementing that function would mean reimplementing
 * it again after every drop.
 */
function hideSourceManagement() {
  const original = window.srcOptions
  if (typeof original !== 'function' || original.__dlOnlyCustomer) return

  const replaced = function srcOptionsWithoutManage(...args) {
    return String(original.apply(this, args))
      .replace(/<option value="__manage">[^<]*<\/option>/, '')
  }

  replaced.__dlOnlyCustomer = true
  replaced.original = original
  window.srcOptions = replaced
}

/* ------------------------------------------------ no number without data ---
 *
 * The studio invents a value for every reading so a loop can be demonstrated
 * before anything is connected. On a plant screen that is the one thing that
 * must never happen: nobody can tell a simulated 2.6 % from a measured one,
 * and they will act on either.
 *
 * So a reading shows a number only when there is a record behind it. Until a
 * column has been chosen it shows its name and a dash — honest, and also the
 * clearest possible prompt that the reading still needs linking.
 *
 * `val()` is the single function every display goes through: the drawing, the
 * value widgets, Properties, the tag tables, the alarm list and the publish
 * view all end at it. So this is one override rather than a dozen, and `fmtN`
 * already renders null as an em dash, so nothing downstream has to change.
 */

/** Is there a real record behind this reading right now? */
const hasRecord = id => !!records.get(id)

function showNothingWithoutData() {
  const original = window.val
  if (typeof original !== 'function' || original.__dlRealOnly) return

  const replaced = function valFromThePlantOnly(id) {
    if (hasRecord(id)) return original.call(this, id)
    /*
     * Null, not zero — zero is a measurement.
     *
     * `tagSev` already treats null as "nothing to judge" and returns normal,
     * so an unlinked reading cannot raise an alarm either. That is right:
     * there is nothing to raise one about.
     */
    return null
  }

  replaced.__dlRealOnly = true
  replaced.original = original
  window.val = replaced
}

/* ----------------------------------------------------- saying which is which ---*/

/** The record behind a reading, for a tooltip or a card. */
export function recordFor(id) {
  return records.get(id) || null
}

/** "12 Feb 2026 14:03 · shift A", or '' when there is nothing to say. */
function recordText(id) {
  const record = records.get(id)
  if (!record) return problems.get(id) ? `Not read: ${problems.get(id)}` : ''

  const when = record.date
    ? `${record.date}${record.time ? ' ' + record.time : ''}`
    : (record.recordedAt || '').replace('T', ' ')
  const shift = record.shift ? ` · shift ${record.shift}` : ''
  const prefix = stale ? 'Last reading ' : 'Recorded '
  return when ? `${prefix}${when}${shift}` : ''
}

/**
 * The chip in the inspector: Live, Stale, No record, or the studio's own.
 *
 * The studio says "Linked" for anything with a link, which was true when every
 * link was to a simulated source. It is now the difference between a number
 * from the plant and a number from a random walk, so it is worth being exact.
 */
function markChips() {
  const original = window.chipFor
  if (typeof original !== 'function' || original.__dlLive) return

  const replaced = function chipForWithLiveReadings(tag) {
    const id = tag?.id
    if (id && isLinked(id)) {
      const title = recordText(id)
      const attr = title ? ` title="${title.replaceAll('"', '&quot;')}"` : ''
      if (problems.has(id)) return `<span class="ix-chip err"${attr}>Not read</span>`
      if (stale) return `<span class="ix-chip stale"${attr}><i></i>Stale</span>`
      if (!records.get(id)) return `<span class="ix-chip wait"${attr}>No record</span>`
      return `<span class="ix-chip live"${attr}><i></i>Live</span>`
    }
    /*
     * Linked, but not to the foundry's database — so nothing is driving it.
     *
     * Three cases, and they are genuinely different things to tell somebody:
     *
     *   a registered database   real, and Digital Loop can reach it, but
     *                           nothing reads it into the canvas yet
     *   a shipped demo server   invented, and always will be
     *   neither                 the source is gone; the link points at nothing
     *
     * All three show a simulated number. Saying "Linked" for any of them would
     * be the confident green pill on a random walk that this whole feature
     * exists to remove.
     */
    const source = tag?.link?.src
    if (source && source !== CUSTOMER) {
      const resolve = peek('SRC')
      const known = typeof resolve === 'function' ? resolve(source) : null
      const name = known ? String(known.name).replaceAll('"', '&quot;') : ''

      if (!known) {
        return '<span class="ix-chip demo" title="Linked to a data source that ' +
          'no longer exists. The value shown is simulated.">Not connected</span>'
      }
      if (String(source).startsWith('conn_')) {
        return `<span class="ix-chip wait" title="Linked to ${name}. That ` +
          'database is registered, but its values are not being read into the ' +
          'canvas yet — the number shown is simulated.">Not read yet</span>'
      }
      return `<span class="ix-chip demo" title="Linked to ${name}, one of the ` +
        'studio\'s demonstration sources. The value shown is simulated.">Demo</span>'
    }

    /*
     * Unlinked.
     *
     * The studio's own chip says "Demo", which was true when it invented a
     * number for every reading. It no longer does: an unlinked reading shows
     * a dash. "Not linked" is what is actually the matter, and it says what
     * to do about it.
     */
    return '<span class="ix-chip wait" title="This reading is not linked to a ' +
      'column yet, so there is no value to show. Add it from a database ' +
      'above.">Not linked</span>'
  }

  replaced.__dlLive = true
  replaced.original = original
  window.chipFor = replaced
}

/**
 * The record's time on every badge, and on the inspector's status line.
 *
 * `liveText` is the studio's own refresh of everything showing a value, so it
 * is the one place that runs whenever any of them is redrawn.
 */
function markBadges() {
  const original = window.liveText
  if (typeof original !== 'function' || original.__dlLive) return

  const replaced = function liveTextWithRecordTimes(...args) {
    original.apply(this, args)
    decorate()
  }

  replaced.__dlLive = true
  replaced.original = original
  window.liveText = replaced
}

/** Put the record time on the badges, and correct the inspector's wording. */
function decorate() {
  for (const el of document.querySelectorAll('[data-live]')) {
    const id = el.dataset.live
    if (!isLinked(id)) continue
    const text = recordText(id)
    if (text) el.title = text
    el.classList.toggle('dl-stale', stale)
  }

  /*
   * The inspector says "● Live from <source>" for anything linked. For a
   * reading we are driving it can say something truer: where it came from and
   * when it was recorded.
   */
  for (const card of document.querySelectorAll('.ix-card[data-tid]')) {
    const id = card.dataset.tid
    const status = card.querySelector('.ix-status')
    if (!status || !isLinked(id)) continue

    const problem = problems.get(id)
    const text = recordText(id)
    status.textContent = replaying()
      ? '● Replay — the value shown is simulated, not the plant record'
      : problem
        ? `● ${problem}`
        : stale
          ? `● ${text || 'Last known reading'} — SandMan is not answering`
          : records.get(id)
            ? `● Live from the foundry database · ${text}`
            : '● Linked — the line has no record for this column yet'
    status.classList.toggle('dl-stale', replaying() || stale || !!problem)
  }
}

/**
 * Is the studio replaying history rather than showing now?
 *
 * `RP` is the studio's replay state. While it is set, every reading on the
 * canvas comes from `histVal` — which is still the simulation, for linked
 * readings as much as for demo ones. Nothing here feeds it, so the honest
 * thing is to say so rather than let a replayed number look like a plant
 * record that happens to be old.
 */
const replaying = () => !!peek('RP')

/** Redraw whatever is showing a value, after a poll changed things. */
function refreshChrome() {
  try {
    window.liveText?.()
  } catch {
    // The studio redraws on its own timer too; a failed decoration is not
    // worth taking the page down for.
  }
}

/* ----------------------------------------------------------- the charts ---*/

/** tagId → what SandMan returned for it, while its chart is open. */
const charts = new Map()

/** Which chart the trend modal is showing. */
let chartView = 'imr'

/**
 * The points the control chart is drawn from.
 *
 * For a simulated reading this stays the studio's own: the last N seconds of
 * the random walk. For a linked one it is the records SandMan returned, which
 * are real, far apart in time, and not a window of seconds — so the window
 * control does not apply to them and every returned point is used.
 */
function useRealChartData() {
  const original = window.ccData
  if (typeof original !== 'function' || original.__dlLive) return

  const replaced = function ccDataFromPlantRecords() {
    const id = peek('trendTag')
    const loaded = id && charts.get(id)
    /*
     * No records, no chart. The studio's own answer is the last N seconds of
     * its simulation, which on a reading nobody has linked is a chart of
     * invented numbers — the same lie as an invented value, drawn with a
     * trend line and control limits to make it look considered.
     */
    if (!loaded) return hasRecord(id) ? original.call(this) : []

    return (loaded.series || [])
      .map(point => ({ t: momentOf(point), v: Number(point.value) }))
      .filter(point => Number.isFinite(point.v))
  }

  replaced.__dlLive = true
  replaced.original = original
  window.ccData = replaced
}

/**
 * Take the moving range chart out of the trend window.
 *
 * An I-MR pair is two charts: the readings themselves, and the gap between
 * each one and the last. The second is a statistician's tool for judging
 * whether the control limits on the first can be trusted — useful when you are
 * setting the limits, noise on the screen when you are reading a sand line.
 *
 * The title and the canvas are hidden rather than removed, because the studio
 * redraws into both: `ccCanvas` returns null for anything under 20 px wide, so
 * a hidden canvas is skipped without the drawing code having to know.
 *
 * Keyed on the heading's own text rather than on its position, because it is
 * a bare `.cc-title` with no id, and "the title before #trM" is not something
 * a stylesheet can say.
 */
function hideMovingRange() {
  const canvas = document.getElementById('trM')
  if (!canvas) return
  canvas.classList.add('dl-hidden')

  for (const title of document.querySelectorAll('.cc-title')) {
    if (/^moving range/i.test(title.textContent.trim())) title.classList.add('dl-hidden')
  }
}

/**
 * Fetch the chart for a linked reading when its trend window opens.
 *
 * The modal is built by the studio and drawn a frame later, so this loads in
 * the background and redraws when the answer arrives rather than holding the
 * window shut.
 */
function loadChartsOnOpen() {
  const original = window.openTrend
  if (typeof original !== 'function' || original.__dlLive) return

  const replaced = function openTrendWithPlantRecords(id) {
    chartView = 'imr'
    original.call(this, id)
    hideMovingRange()
    if (!loopId || !isLinked(id)) return

    addChartSwitch(id)

    api.get(`/live/chart?loopId=${encodeURIComponent(loopId)}&tag=${encodeURIComponent(id)}`)
      .then(answer => {
        charts.set(id, answer)
        if (peek('trendTag') !== id) return
        addChartSwitch(id)
        window.drawTrend?.()
      })
      .catch(error => {
        charts.set(id, { series: [], processControl: null, failed: error.message })
        if (peek('trendTag') === id) addChartSwitch(id)
      })
  }

  replaced.__dlLive = true
  replaced.original = original
  window.openTrend = replaced
}

/**
 * The two views, and the panel the second one draws into.
 *
 * "Individuals" is the studio's own I-MR chart, now over real points.
 * "Process control" is SandMan's calculation, drawn exactly as returned —
 * its subgroups, its limits. Recomputing it here would mean two charts that
 * are meant to be the same drifting apart without anyone noticing.
 */
function addChartSwitch(id) {
  const title = document.querySelector('.cc-title')
  if (!title) return

  let bar = document.getElementById('dlChartSwitch')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'dlChartSwitch'
    bar.className = 'cc-ctl dl-chart-switch'
    title.parentNode.insertBefore(bar, title)
  }

  const loaded = charts.get(id)
  const points = loaded?.series?.length || 0
  const range = loaded?.dateFrom ? `${loaded.dateFrom} to ${loaded.dateTo}` : ''

  bar.innerHTML = `
    <span class="note">Chart</span>
    <div class="seg" id="dlChartSeg">
      <button data-cv="imr" class="${chartView === 'imr' ? 'on' : ''}">Individuals (I-MR)</button>
      <button data-cv="pc" class="${chartView === 'pc' ? 'on' : ''}">Process Control (SandMan)</button>
    </div>
    <span class="note">${loaded
      ? loaded.failed
        ? 'Could not be loaded'
        : `${points} record${points === 1 ? '' : 's'}${range ? ' · ' + range : ''}`
      : 'Loading from SandMan…'}</span>
    ${replaying()
      ? '<span class="note dl-stale">Replay is simulated — these charts are the real records.</span>'
      : ''}`

  for (const button of bar.querySelectorAll('[data-cv]')) {
    button.onclick = () => {
      chartView = button.dataset.cv
      addChartSwitch(id)
      showView(id)
    }
  }
  showView(id)
}

/** Swap between the studio's canvases and ours. */
function showView(id) {
  const own = chartView === 'pc'
  for (const node of document.querySelectorAll('.cc-title, #trC, #trM, #trStats, #trDist, #trRules')) {
    node.classList.toggle('dl-hidden', own)
  }

  let panel = document.getElementById('dlPcPanel')
  if (!own) {
    panel?.classList.add('dl-hidden')
    // The loop above un-hid everything, the moving range chart included. It
    // is not part of this view either, so it goes back away.
    hideMovingRange()
    window.drawTrend?.()
    return
  }

  if (!panel) {
    panel = document.createElement('div')
    panel.id = 'dlPcPanel'
    document.getElementById('dlChartSwitch')?.insertAdjacentElement('afterend', panel)
  }
  panel.classList.remove('dl-hidden')
  drawProcessControl(panel, charts.get(id))
}

/**
 * SandMan's Process Control Chart: the mean chart and the range chart.
 *
 * Both are drawn from the arrays it returned, against the limits it returned.
 * Nothing is recalculated and nothing is re-centred.
 */
function drawProcessControl(panel, loaded) {
  const pc = loaded?.processControl
  if (!pc) {
    panel.innerHTML = `<p class="note dl-pc-empty">${loaded?.failed
      ? 'The chart could not be loaded from SandMan.'
      : 'Not enough shift data (SandMan needs more than 30 shift averages).'}</p>`
    return
  }

  panel.innerHTML = `
    <div class="cc-title">Process control — mean${
      pc.shiftAverages ? ` · ${pc.shiftAverages} shift averages` : ''}</div>
    <canvas id="dlPcMean" class="cc-cv" style="height:250px"></canvas>
    <div class="cc-title">Process control — range</div>
    <canvas id="dlPcRange" class="cc-cv" style="height:160px"></canvas>`

  plot(document.getElementById('dlPcMean'), pc.MEAN, ['UCL', 'CL', 'LCL'])
  plot(document.getElementById('dlPcRange'), pc.RANGE, ['UCL', 'R̄', 'LCL'])
}

/** Fit a canvas to its box at the screen's pixel density. */
function sized(canvas) {
  if (!canvas) return null
  const box = canvas.getBoundingClientRect()
  if (box.width < 10) return null
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.round(box.width * ratio)
  canvas.height = Math.round(box.height * ratio)
  const c = canvas.getContext('2d')
  c.setTransform(ratio, 0, 0, ratio, 0, 0)
  return { c, W: box.width, H: box.height }
}

const cssVar = name =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#64748b'

/** One of SandMan's two charts: the points, and its three limit lines. */
function plot(canvas, chart, labels) {
  const surface = sized(canvas)
  if (!surface || !chart) return
  const { c, W, H } = surface

  const ys = (chart.y || []).map(Number).filter(Number.isFinite)
  const limits = (chart.limits || []).map(Number).filter(Number.isFinite)
  if (!ys.length) {
    c.fillStyle = cssVar('--muted')
    c.font = '12px IBM Plex Sans, system-ui, sans-serif'
    c.fillText('No points for this chart.', 12, 24)
    return
  }

  const left = 64
  const right = 58
  const top = 12
  const bottom = 28
  const lo = Math.min(...ys, ...limits)
  const hi = Math.max(...ys, ...limits)
  const pad = (hi - lo) * 0.08 || 1
  const min = lo - pad
  const max = hi + pad
  const x = i => left + (ys.length === 1 ? (W - left - right) / 2 : (i * (W - left - right)) / (ys.length - 1))
  const y = v => top + ((max - v) / (max - min)) * (H - top - bottom)

  c.clearRect(0, 0, W, H)
  c.font = '11px IBM Plex Mono, monospace'

  // The limits first, so the series is drawn over them.
  const colours = ['#d93636', '#1f9d55', '#d93636']
  limits.forEach((limit, i) => {
    c.strokeStyle = colours[i] || cssVar('--line')
    c.setLineDash(i === 1 ? [] : [6, 4])
    c.beginPath()
    c.moveTo(left, y(limit))
    c.lineTo(W - right, y(limit))
    c.stroke()
    c.setLineDash([])
    c.fillStyle = colours[i] || cssVar('--muted')
    c.fillText(`${labels[i]} ${limit.toFixed(3)}`, W - right + 4, y(limit) + 3)
  })

  c.strokeStyle = cssVar('--line')
  c.beginPath()
  c.moveTo(left, H - bottom)
  c.lineTo(W - right, H - bottom)
  c.stroke()

  c.fillStyle = cssVar('--muted')
  c.fillText(max.toFixed(3), 6, y(max) + 10)
  c.fillText(min.toFixed(3), 6, y(min))

  c.strokeStyle = '#1f6feb'
  c.lineWidth = 1.5
  c.beginPath()
  ys.forEach((value, i) => (i ? c.lineTo(x(i), y(value)) : c.moveTo(x(i), y(value))))
  c.stroke()
  c.lineWidth = 1

  c.fillStyle = '#1f6feb'
  ys.forEach((value, i) => {
    c.beginPath()
    c.arc(x(i), y(value), 2.5, 0, Math.PI * 2)
    c.fill()
  })

  // A handful of subgroup labels, not one per point: SandMan returns hours.
  const names = chart.n || []
  const step = Math.max(1, Math.ceil(ys.length / 6))
  c.fillStyle = cssVar('--muted')
  for (let i = 0; i < ys.length; i += step) {
    const label = String(names[i] || i + 1)
    c.fillText(label, Math.min(x(i) - 24, W - right - 48), H - bottom + 16)
  }
}

/* -------------------------------------------------------------- starting ---*/

/**
 * Wrap everything once, at boot.
 *
 * Separate from `start()` because the wrappers must be in place before the
 * first loop opens — `simTick` runs from the moment the studio does — and
 * because wrapping twice would stack the guards.
 */
export function install() {
  showNothingWithoutData()
  hideSourceManagement()
  guardSimulation()
  markChips()
  markBadges()
  useRealChartData()
  loadChartsOnOpen()
  followDocumentChanges()
  pollWhenVisibleAgain()

  /*
   * A seam for the browser tests, and for looking at this from a console.
   *
   * It exposes what is already on the page — which readings are live, when
   * they were last checked — and the ability to ask again now rather than
   * waiting out the minute. Nothing here reads anything the page cannot
   * already see, and nothing writes a value.
   */
  window.__dlLive = { status, poll: pollOnce }
}

/** Whether a reading is being driven from the plant. For tests and the UI. */
export const status = () => ({
  loopId,
  live: [...records.keys()],
  linked: linkedIds(),
  stale,
  reason,
  problems: Object.fromEntries(problems),
  /** When SandMan was last asked — once a minute while a loop is open. */
  lastCheckAt,
  /** When a reading last actually changed, which is far less often. */
  lastChangeAt,
  pollMs: POLL_MS,
})
