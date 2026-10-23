import { api, ApiError } from './api.mjs'
import { peek } from './studio.mjs'
import { isAdmin } from './session.mjs'

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

/**
 * Is this reading one we are driving?
 *
 * The link decides it, not whether a poll has happened yet. Asking "have we a
 * record for it" meant a reading linked to the foundry's database said **Not
 * linked** until the first value arrived — and said it for good if the column
 * never answered. That is the one thing the chip must never get wrong: it sent
 * people back to re-link a reading that was already linked.
 *
 * `records` and `problems` stay in the test as well, so a reading SandMan
 * answered for is still counted as ours even if the document has since been
 * edited underneath it.
 */
/**
 * A source this service reads: the foundry's own database, or one registered
 * here. Both are answered by `/live/values`, so both are ours to drive.
 */
const readable = source => source === CUSTOMER || /^conn_/.test(String(source || ''))
const linkedToPlant = id => readable((REG() || {})[id]?.link?.src)
const isLinked = id => linkedToPlant(id) || records.has(id) || problems.has(id)

/** Every reading in the open document that points at the foundry's database. */
function linkedIds() {
  const reg = REG() || {}
  return Object.keys(reg).filter(id => readable(reg[id]?.link?.src))
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
    /*
     * Linked here, but the server was not asked about it.
     *
     * The server reads the stored layout, so a link that has not been saved
     * is not in it — and without this the reading would say "Reading…" for
     * ever, waiting for an answer nobody is going to give.
     */
    const answered = { ...(answer.values || {}), ...(answer.errors || {}) }
    for (const id of linkedIds()) {
      if (!(id in answered)) problems.set(id, 'Not read yet — this link is not in the saved loop. Save, then wait a moment.')
    }
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

/** Which loop is open, for anything that needs to name it in a request. */
export const watching = () => loopId

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
  clearTimeout(soon)
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
      else if (timer && linkedIds().some(id => !records.has(id))) askSoon()
    }, 400)
    return result
  }

  replaced.__dlLive = true
  replaced.original = original
  window.changed = replaced
}

/**
 * A reading was just linked: ask once it has been stored, not at the next tick.
 *
 * The server reads the stored layout, and Properties stores a link a moment
 * after it is chosen — so asking straight away would find the old layout, and
 * waiting for the timer left the new reading saying nothing for up to thirty
 * seconds. A few seconds covers the store.
 */
let soon = null
function askSoon() {
  clearTimeout(soon)
  soon = setTimeout(pollOnce, 4000)
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
 * The source menu offers the data sources, and nothing else.
 *
 * Two of the studio's own entries are taken out of the rendered markup:
 *
 *   Add or manage data sources…   its panel adds a server by typing a host
 *                                 into the browser, which is not how a
 *                                 database gets registered here: Digital Loop
 *                                 holds the password and dials out itself, so
 *                                 one is added through the API, by an
 *                                 administrator, and the credential never
 *                                 reaches the page. Leaving the option would
 *                                 offer a second way that quietly does
 *                                 something else.
 *   ★ Customer default · <db>     a fixed entry for the database named in
 *                                 SandMan's launch, written into the menu
 *                                 whether or not it is one of the plant's data
 *                                 sources. The Data sources page lists the
 *                                 databases somebody registered; this menu now
 *                                 lists the same ones, so what a reading may be
 *                                 linked to is one list in both places rather
 *                                 than a list plus a hardcoded extra.
 *
 * **Unless a reading is already linked to it.** Then the option stays, marked
 * selected, because taking it away would show that reading as reading from
 * something else — and the first change to any other field on the card would
 * save that lie. The entry disappears from every reading that is not already
 * using it, which is what "don't offer it" means.
 *
 * Done to the markup rather than by rewriting `srcOptions`, because
 * reimplementing that function means reimplementing it again after every drop.
 */
const MANAGE = /<option value="__manage">[^<]*<\/option>/
const CUSTOMER_OPTION = /<option value="customer"\s*([^>]*)>[^<]*<\/option>/

function hideSourceManagement() {
  const original = window.srcOptions
  if (typeof original !== 'function' || original.__dlOnlyCustomer) return

  const replaced = function srcOptionsWithoutManage(...args) {
    return String(original.apply(this, args))
      .replace(MANAGE, '')
      .replace(CUSTOMER_OPTION, (whole, attributes) =>
        /selected/.test(attributes) ? whole : '')
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
      if (!records.has(id)) return `<span class="ix-chip wait"${attr}>Reading…</span>`
      if (!records.get(id)) return `<span class="ix-chip wait"${attr}>No record</span>`
      return `<span class="ix-chip live"${attr}><i></i>Live</span>`
    }
    /*
     * Linked, but to something this service does not read.
     *
     * Registered databases used to be here too — "Not read yet", because
     * nothing fetched them. They are read now, so they go through the branch
     * above with every other real reading, and what is left is a source that
     * cannot produce a number at all:
     *
     *   a shipped demo server   invented, and always will be
     *   nothing at all          the source is gone; the link points nowhere
     *
     * Both show a simulated number. Saying "Linked" for either would be the
     * confident green pill on a random walk that this feature exists to
     * remove.
     */
    const source = tag?.link?.src
    if (source && !readable(source)) {
      const resolve = peek('SRC')
      const known = typeof resolve === 'function' ? resolve(source) : null
      const name = known ? String(known.name).replaceAll('"', '&quot;') : ''

      if (!known) {
        return '<span class="ix-chip demo" title="Linked to a data source that ' +
          'no longer exists. The value shown is simulated.">Not connected</span>'
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
  hideTrendOnText()
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

    /*
     * Say where it is reading from, in that database's own terms.
     *
     * The foundry's database is read per line, because that is how SandMan
     * scopes it — so "the line has no record" is the right thing to say about
     * one. A database somebody registered here has no line and no foundry in
     * it: this service asks for the newest row of a table, full stop. Telling
     * somebody the *line* has no record for a column in their own historian
     * sends them looking for a scoping rule that is not there.
     */
    const where = (REG() || {})[id]?.link?.src
    const ours = typeof where === 'string' && where.startsWith('conn_')
    const from = ours
      ? (typeof peek('SRC') === 'function' ? peek('SRC')(where)?.name : null) || 'the database'
      : 'the foundry database'

    status.textContent = replaying()
      ? '● Replay — the value shown is simulated, not the plant record'
      : problem
        ? `● ${problem}`
        : stale
          ? `● ${text || 'Last known reading'} — SandMan is not answering`
          : records.get(id)
            ? `● Live from ${from} · ${text}`
            /*
             * Not answered yet is not the same as answered with nothing. A
             * database across the internet takes seconds to answer, and
             * saying "no row" in the meantime sent people to check a table
             * that was full.
             */
            : !records.has(id)
              ? `● Reading from ${from}…`
              : ours
              ? `● Linked — ${from} has no row for this column yet`
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
    /*
     * And the badges on the drawing.
     *
     * `liveText` refreshes the panels; the canvas redraws itself on the
     * studio's own timer, but only while it is simulating. In Design nothing
     * asked it to, so a reading that had just started answering kept showing
     * its unit until the mode changed — see `nameOnTheCanvas` in naming.mjs,
     * which is what puts the value there in the first place.
     */
    window.liveCanvas?.(true)
  } catch {
    // The studio redraws on its own timer too; a failed decoration is not
    // worth taking the page down for.
  }
}

/* ----------------------------------------------------------- the charts ---*/

/** tagId → what the service returned for it, while its chart is open. */
const charts = new Map()

/** Names and driver messages go into markup here; neither is ours to trust. */
const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/**
 * The span two timestamps cover, in words somebody reads at a glance.
 *
 * The day is dropped from the second when both fall on it, which is the usual
 * case — a shift's records say "16 Oct 05:45 → 12:23" rather than printing the
 * date twice.
 */
function when(from, to) {
  const start = from ? new Date(from) : null
  const end = to ? new Date(to) : null
  if (!start || Number.isNaN(start.getTime())) return ''

  const day = date => date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const clock = date => date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

  if (!end || Number.isNaN(end.getTime())) return `${day(start)} ${clock(start)}`
  return day(start) === day(end)
    ? `${day(start)} ${clock(start)} → ${clock(end)}`
    : `${day(start)} ${clock(start)} → ${day(end)} ${clock(end)}`
}

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
/**
 * How many records stand in for an hour, where the records carry no time.
 *
 * A number had to be picked, and this one says: a sand line produces roughly a
 * reading a minute. It only decides how much of the run each window button
 * shows — 2 h is 120 records, a day is the lot — and the navigator reaches the
 * rest either way.
 */
const ONE_HOUR_MS = 3_600_000
const RECORDS_PER_HOUR = 60

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

    const points = (loaded.series || [])
      .map(point => ({ t: momentOf(point), v: Number(point.value) }))
      .filter(point => Number.isFinite(point.v))

    /*
     * A window of the records, ending wherever the navigator is parked.
     *
     * A plant record arrives once a batch or once a shift, and the last one
     * may be hours old. Cutting from `Date.now()` would empty the chart
     * whenever the line was quiet, which reads as "no data" rather than "no
     * data since lunchtime" — so the window ends at the newest record, or at
     * the point the navigator below the chart has been dragged to.
     */
    // What is drawn, not what was read — see `viewSpan`.
    const window_ = viewSpan() * 1000
    if (!points.length || !Number.isFinite(window_) || window_ <= 0) return points

    const newest = points[points.length - 1].t
    const end = viewport.id === id && Number.isFinite(viewport.end) ? viewport.end : newest
    const inside = points.filter(point => point.t > end - window_ && point.t <= end)

    /*
     * A window is only a window if the records are spread through time.
     *
     * Plenty of plant columns are ordered by a date with no time of day —
     * `Det` on the RTC table is one — so every record taken on a given day
     * carries the same instant. Two hundred readings then sit on two or three
     * points, and asking for "the last two hours" of them returns whatever
     * landed on the single newest instant, or nothing. The chart came up with
     * one point and the panel said "Collecting data…" over two hundred
     * records that had already arrived.
     *
     * So when the window cannot separate them, the records themselves are the
     * series — the last `window_` seconds' worth by count rather than by
     * clock, which is what an I-MR chart is really about: the last N
     * observations in the order they were taken. The window control still
     * means something (a longer window shows more of them) and the navigator
     * underneath still scrolls the whole run.
     */
    if (inside.length >= 2) return inside

    const distinct = new Set(points.map(point => point.t)).size
    if (distinct < points.length / 2) {
      const upTo = points.filter(point => point.t <= end)
      const take = Math.max(2, Math.round(window_ / ONE_HOUR_MS * RECORDS_PER_HOUR))
      return (upTo.length ? upTo : points).slice(-take)
    }

    // Never an empty chart when there are records: a window narrower than the
    // gap between two readings would otherwise hide every one of them.
    if (inside.length) return inside
    const before = points.filter(point => point.t <= end)
    return before.length ? before.slice(-1) : points.slice(0, 1)
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

/* ------------------------------------------------- the chart's time window ---*/

/**
 * Hours, not minutes — and only as many as still read well.
 *
 * The studio offers 2, 5 and 15 minutes, which suits a reading that arrives
 * every second from a simulation. A plant record arrives once a batch or once
 * a shift, so a fifteen-minute window is almost always empty — which is what
 * "Collecting data… · Points 0" was saying.
 *
 * The other end was just as wrong. Eight hours of batch records is two hundred
 * markers shoulder to shoulder: still offered, because a shift is a thing
 * people want to see, but not what a chart opens on. It opens on two hours,
 * and reaching the rest of the records is the navigator's job.
 */

/** The four windows every chart offers: a run, half a shift, a shift, a day. */
const HOURS = [
  [7_200, '2 h'],
  [14_400, '4 h'],
  [28_800, '8 h'],
  [86_400, '1 day'],
]

/** Two hours: the one every chart opens on. */
const DEFAULT_WINDOW = 7_200

/**
 * The window is the read: the chart asks for the span on the buttons.
 *
 * Reading a day at a time and cutting the window out of it here was tried,
 * because it gives the navigator a run to slide across and turns four window
 * buttons into one read. It was rejected: the statement in Preview data then
 * says `>= '21 Oct 17:03' … LIMIT 2000` under a chart labelled two hours, and
 * a statement that does not describe the chart above it is the thing this
 * whole path was fixed to stop.
 *
 * So the window decides, and nothing else: 2 h opens, pressing 4 h / 8 h /
 * 1 day reads that span, and no row limit is sent — the window is what bounds
 * the read, which is exactly what the statement says.
 */

/** The usual gap between two records, in seconds. */
function spacingOf(points) {
  if (points.length < 2) return 0
  const gaps = []
  for (let i = 1; i < points.length; i++) {
    const gap = points[i].t - points[i - 1].t
    if (gap > 0) gaps.push(gap)
  }
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)] / 1000
}

/**
 * The same four windows on every chart, opening on two hours.
 *
 * A run, half a shift, a shift, a day. They were built from how often each
 * column recorded, so one reading offered 2/4/8 h and the next offered weeks
 * — accurate, and four different charts to learn. One set everywhere is worth
 * more than a set fitted to each: a sparse reading now shows a flat stretch
 * and a point or two, which is the truth about that reading.
 *
 * The navigator underneath still moves the window across everything there is,
 * so a record from last month is two drags away rather than unreachable.
 */
function windowsFor() {
  return { offered: HOURS, opens: DEFAULT_WINDOW }
}

/** The narrowest a grip may drag the window: still a few records wide. */
function smallestWindow(points) {
  return Math.max(60, Math.round(spacingOf(points) * 3) || 300)
}

/** Put the window back in range, whatever it was left on. */
function defaultWindow() {
  const TR = peek('TR')
  if (!TR) return
  if (!Number.isFinite(TR.win) || TR.win < 60) TR.win = DEFAULT_WINDOW
}


function useDayWindows() {
  const segment = document.getElementById('trWin')
  const TR = peek('TR')
  if (!segment || !TR) return

  const was = TR.win
  defaultWindow()

  const { offered, opens } = windowsFor()

  /*
   * Two hours, every time a trend is opened.
   *
   * Not the narrowest window that holds the records, which is what it used to
   * be: that made the chart open differently for every reading, so nobody
   * could tell a quiet line from a short history. Two hours is what a chart
   * means now, and the buttons and the navigator move from there.
   */
  TR.win = opens

  segment.innerHTML = offered.map(([seconds, label]) =>
    `<button data-w="${seconds}" class="${TR.win === seconds ? 'on' : ''}">${label}</button>`
  ).join('')

  // The studio binds each button individually, so replacing them means
  // binding the new ones.
  for (const button of segment.querySelectorAll('button')) {
    button.onclick = () => {
      TR.win = Number(button.dataset.w)
      markWindowButtons()
      // A wider window is a wider read, not more of the records already here.
      viewport.end = null
      navSignature = ''
      window.drawTrend?.()
      readTheWindow(peek('trendTag'))
    }
  }

  // The first draw used whatever the window was before this corrected it.
  if (was !== TR.win) window.drawTrend?.()
}

/** Light the button that matches the window, or none when a grip set it. */
function markWindowButtons() {
  const TR = peek('TR')
  for (const button of document.querySelectorAll('#trWin button')) {
    button.classList.toggle('on', Number(button.dataset.w) === TR?.win)
  }
}

/* ------------------------------------------- what is read, what is drawn ---*/

/**
 * The window is read; half an hour of it is drawn.
 *
 * These are two questions that were one for too long, and making them one
 * forced a choice between two things both of which were asked for: a
 * statement that describes the chart exactly, and a navigator with somewhere
 * to slide to. Tying the read to the drawn span gave the first and left the
 * handle filling the strip; reading a day and drawing two hours of it gave the
 * second and put `>= '21 Oct 17:13' … LIMIT 2000` under a chart labelled two
 * hours.
 *
 * Separated, both hold. The buttons above the chart say what is **read** —
 * `WHERE datetime >= (newest − 2 h)`, nothing else in the statement, which is
 * what Preview data shows. The strip underneath says what is **drawn**: half
 * an hour of those records, moved across the read by dragging, widened or
 * narrowed by its grips.
 *
 * Half an hour because a sand line writes a reading every two or three
 * minutes: that is a dozen or so points, far enough apart to read a drift off
 * and close enough together that the line is not a single flat stroke.
 */
const DEFAULT_VIEW = 1_800

/** The drawn span, as last left by a grip — see `viewSpan` for what applies. */
let viewAsked = DEFAULT_VIEW

/**
 * The span the chart draws, in seconds.
 *
 * Never wider than what was read: there is nothing out there to draw. A
 * narrower read than the drawn span is what happens on "2 h" after the grips
 * were widened on "1 day", and then the chart is simply the whole read.
 */
function viewSpan() {
  const read = Number(peek('TR')?.win) || DEFAULT_WINDOW
  return Math.max(60, Math.min(viewAsked, read))
}

/* ------------------------------------------------------ the range navigator ---*/

/**
 * Where the window sits in the records.
 *
 * `end` is the right-hand edge of the chart, in milliseconds. Null means the
 * newest record — which is where every chart opens, and where it goes back to
 * on "Latest".
 */
const viewport = { id: null, end: null }

/** The loaded records of one reading, as points. */
function seriesPoints(id) {
  const loaded = id && charts.get(id)
  if (!loaded) return []
  return (loaded.series || [])
    .map(point => ({ t: momentOf(point), v: Number(point.value) }))
    .filter(point => Number.isFinite(point.v) && Number.isFinite(point.t))
    .sort((a, b) => a.t - b.t)
}

/** Keep the window inside the records, however it was dragged. */
function clampEnd(end, first, last, window_) {
  const earliest = Math.min(last, first + window_)
  return Math.min(last, Math.max(earliest, end))
}

const HOUR = 3_600_000

/** "45 min", "2 h", "1 h 20 m", "6 days" — the window, in words. */
function spanWords(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    const rest = minutes % 60
    return rest ? `${hours} h ${rest} m` : `${hours} h`
  }

  const days = Math.round(hours / 24)
  return days < 14 ? `${days} days` : `${Math.round(days / 7)} weeks`
}

const clockOf = at =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

const dayOf = at =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/**
 * The strip under the chart: every record, and the part being shown.
 *
 * Built once per trend window and then kept in step with the chart. The chart
 * itself is the studio's canvas and is left alone — this only decides which
 * records it is handed, by moving `viewport.end`.
 */
function navigator_() {
  let strip = document.getElementById('dlNav')
  if (strip) return strip

  const chart = document.getElementById('trC')
  if (!chart) return null

  strip = document.createElement('div')
  strip.id = 'dlNav'
  strip.className = 'dl-nav'
  strip.innerHTML = `
    <div class="dl-nav-strip" id="dlNavStrip">
      <canvas id="dlNavCv"></canvas>
      <div class="dl-nav-dim" id="dlNavLeft"></div>
      <div class="dl-nav-dim" id="dlNavRight"></div>
      <div class="dl-nav-sel" id="dlNavSel">
        <span class="dl-nav-grip" data-grip="from"></span>
        <span class="dl-nav-grip" data-grip="to"></span>
      </div>
    </div>
    <div class="dl-nav-foot">
      <span id="dlNavFrom"></span>
      <span class="dl-nav-now" id="dlNavNow"></span>
      <span class="dl-nav-right"><button type="button" class="dl-nav-latest" id="dlNavLatest">Latest</button><span id="dlNavTo"></span></span>
    </div>`
  chart.insertAdjacentElement('afterend', strip)

  strip.querySelector('#dlNavLatest').onclick = () => {
    viewport.end = null
    window.drawTrend?.()
  }
  bindDragging(strip.querySelector('#dlNavStrip'))
  return strip
}

/**
 * Drag the window along the records, or drag an edge to resize it.
 *
 * Pointer events rather than mouse ones, so a tablet on the shop floor drags
 * the same way; the capture is what keeps the drag alive when the pointer
 * leaves the strip, which it does constantly near either end.
 */
function bindDragging(strip) {
  let drag = null

  const span = () => {
    const points = seriesPoints(viewport.id)
    if (points.length < 2) return null
    const first = points[0].t
    const last = points[points.length - 1].t
    return last > first ? { first, last, width: last - first } : null
  }

  const timeAt = (event, bounds) => {
    const box = strip.getBoundingClientRect()
    const across = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    return bounds.first + across * bounds.width
  }

  let frame = null
  const redraw = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = null
      window.drawTrend?.()
    })
  }

  strip.addEventListener('pointerdown', event => {
    const bounds = span()
    const TR = peek('TR')
    if (!bounds || !TR) return

    const window_ = viewSpan() * 1000
    const end = clampEnd(
      Number.isFinite(viewport.end) ? viewport.end : bounds.last,
      bounds.first, bounds.last, window_,
    )
    const grip = event.target?.dataset?.grip
    const at = timeAt(event, bounds)

    if (grip) {
      drag = { kind: grip, bounds, from: end - window_, to: end }
    } else if (at >= end - window_ && at <= end) {
      drag = { kind: 'pan', bounds, grab: end - at }
    } else {
      // A click on bare strip puts the middle of the window there, and goes
      // on panning — the same gesture whether you aimed or not.
      viewport.end = clampEnd(at + window_ / 2, bounds.first, bounds.last, window_)
      drag = { kind: 'pan', bounds, grab: viewport.end - at }
      redraw()
    }

    strip.setPointerCapture(event.pointerId)
    event.preventDefault()
  })

  strip.addEventListener('pointermove', event => {
    if (!drag) return
    const TR = peek('TR')
    if (!TR) return
    const at = timeAt(event, drag.bounds)
    const narrowest = smallestWindow(seriesPoints(viewport.id)) * 1000

    /*
     * A grip resizes what is drawn, and reads nothing.
     *
     * It used to move `TR.win`, which is the read — so widening the view by a
     * centimetre was a query, through an SSH tunnel, on every pointermove.
     * The records are already here; the grips choose how much of them to put
     * on the chart. Reaching past what was read is what the buttons are for.
     */
    if (drag.kind === 'pan') {
      viewport.end = clampEnd(at + drag.grab, drag.bounds.first, drag.bounds.last, viewSpan() * 1000)
    } else if (drag.kind === 'to') {
      const to = Math.max(drag.from + narrowest, Math.min(drag.bounds.last, at))
      viewAsked = Math.round((to - drag.from) / 1000)
      viewport.end = to
    } else {
      const from = Math.min(drag.to - narrowest, Math.max(drag.bounds.first, at))
      viewAsked = Math.round((drag.to - from) / 1000)
      viewport.end = drag.to
    }

    redraw()
  })

  const release = event => {
    if (!drag) return
    drag = null
    if (strip.hasPointerCapture?.(event.pointerId)) strip.releasePointerCapture(event.pointerId)
    window.drawTrend?.()
  }
  strip.addEventListener('pointerup', release)
  strip.addEventListener('pointercancel', release)
}

/** What the strip was last drawn for, so a hover does not redraw it. */
let navSignature = ''

/**
 * Draw the strip and put the selection where the window is.
 *
 * Hidden when there is nothing to drag: fewer than two records, or a window
 * that already holds all of them. A navigator whose handle fills the whole
 * strip is furniture.
 */
function syncNavigator(id) {
  const points = seriesPoints(id)
  const TR = peek('TR')
  const existing = document.getElementById('dlNav')

  if (!TR || points.length < 2 || !document.getElementById('trC')) {
    existing?.classList.add('dl-hidden')
    return
  }

  const first = points[0].t
  const last = points[points.length - 1].t
  const width = last - first
  const window_ = viewSpan() * 1000
  /*
   * Hidden only when there is nothing to drag.
   *
   * That is: no spread in the records at all, or a drawn span that already
   * covers every one of them — which happens when the grips are pulled out to
   * the full width of the read. A handle filling the strip is furniture.
   */
  if (width <= 0 || width <= window_) {
    existing?.classList.add('dl-hidden')
    return
  }

  const strip = navigator_()
  if (!strip) return
  strip.classList.remove('dl-hidden')

  const end = clampEnd(Number.isFinite(viewport.end) ? viewport.end : last, first, last, window_)
  const from = end - window_
  const left = ((from - first) / width) * 100
  const across = (window_ / width) * 100

  const canvas = document.getElementById('dlNavCv')
  const signature = `${id}|${points.length}|${Math.round(canvas?.getBoundingClientRect().width || 0)}`
  if (signature !== navSignature) {
    navSignature = signature
    drawStrip(canvas, points, first, width)
  }

  const selection = document.getElementById('dlNavSel')
  selection.style.left = `${left}%`
  selection.style.width = `${across}%`
  document.getElementById('dlNavLeft').style.width = `${left}%`
  document.getElementById('dlNavRight').style.width = `${Math.max(0, 100 - left - across)}%`

  document.getElementById('dlNavFrom').textContent = `${dayOf(first)} ${clockOf(first)}`
  document.getElementById('dlNavTo').textContent = `${dayOf(last)} ${clockOf(last)}`
  document.getElementById('dlNavNow').textContent =
    `${spanWords(window_)} · ${dayOf(from) === dayOf(end)
      ? `${dayOf(from)} ${clockOf(from)} → ${clockOf(end)}`
      : `${dayOf(from)} ${clockOf(from)} → ${dayOf(end)} ${clockOf(end)}`}`

  const latest = document.getElementById('dlNavLatest')
  latest.classList.toggle('dl-hidden', last - end < HOUR / 60)
}

/** Every record, small: the shape of the whole run behind the window. */
function drawStrip(canvas, points, first, width) {
  const surface = sized(canvas)
  if (!surface) return
  const { c, W, H } = surface
  c.clearRect(0, 0, W, H)

  const values = points.map(point => point.v)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi - lo < 1e-9) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.15
  lo -= pad
  hi += pad

  const x = at => ((at - first) / width) * W
  const y = value => 5 + (1 - (value - lo) / (hi - lo)) * (H - 10)

  c.beginPath()
  c.moveTo(x(points[0].t), H)
  for (const point of points) c.lineTo(x(point.t), y(point.v))
  c.lineTo(x(points[points.length - 1].t), H)
  c.closePath()
  c.fillStyle = 'rgba(31,111,235,.12)'
  c.fill()

  c.beginPath()
  points.forEach((point, i) => (i ? c.lineTo(x(point.t), y(point.v)) : c.moveTo(x(point.t), y(point.v))))
  c.strokeStyle = 'rgba(31,111,235,.6)'
  c.lineWidth = 1.2
  c.stroke()
}

/**
 * Keep the strip in step with every redraw of the chart.
 *
 * The studio redraws on hover, on every control, and on each poll, and the
 * window may have moved in any of them. The signature above means a hover
 * costs two style writes rather than a repaint of the strip.
 */
function keepNavigatorInStep() {
  const original = window.drawTrend
  if (typeof original !== 'function' || original.__dlLive) return

  const replaced = function drawTrendThenTheStrip() {
    const answer = original.apply(this, arguments)
    try {
      syncNavigator(peek('trendTag'))
      hideViolations()
    } catch {
      /* The chart is drawn either way. */
    }
    return answer
  }

  replaced.__dlLive = true
  replaced.original = original
  window.drawTrend = replaced
}

/**
 * Until somebody sets limits, the chart is measured against the plant.
 *
 * `spec()` makes up a standard deviation when none was configured:
 *
 *     sd = Math.max(Math.abs(opt) * 0.02, …)
 *
 * — two percent of the optimal value. On a reading carrying `typ: 12.5` from
 * a design somebody drew, that is σ = 0.25, so ±3σ spans 11.75 to 13.25. The
 * column's own records run 11.5 to 25.0 with a spread of 5.84, so **every**
 * point lands outside: two hundred rule violations, every marker red, the
 * whole plot filled with the beyond-3σ wash. The chart was not showing the
 * process going wrong — it was showing an invented limit being wrong.
 *
 * So while the limits are not configured, the control band comes from the
 * records: centre on the process mean, σ from the data. The moment somebody
 * enters real limits the chart measures against those instead, which is what
 * a control chart is for.
 *
 * The two selectors are set rather than hidden — they say which it is, and
 * they still work.
 */
function measureAgainstTheData(id) {
  const TR = peek('TR')
  const reg = REG() || {}
  const readSpec = peek('spec')
  const tag = reg[id]
  if (!TR || !tag || typeof readSpec !== 'function') return

  let configured = false
  try {
    configured = !!readSpec(tag).cfg
  } catch {
    return
  }
  if (configured) return

  TR.basis = 'win'
  TR.sig = 'sd'

  const centre = document.getElementById('trBasis')
  if (centre) centre.value = 'win'
  const sigma = document.getElementById('trSig')
  if (sigma) sigma.value = 'sd'
}

/**
 * A window where nothing moved still needs a scale to be drawn against.
 *
 * A set point sits at 25.0 for hours. Over such a window the standard
 * deviation is exactly zero, and the studio's floor for that is
 * `|typ| × 1e-6` — so ±1σ, ±2σ, ±3σ and the centre line all land on the same
 * pixel and print seven labels reading "25.0" on top of one another. That is
 * the chart saying "no variation" in the least legible way available.
 *
 * When the window is flat but the reading is not, the band comes from the
 * whole run of records instead: a real spread, measured from real data, so
 * the flat stretch is drawn as what it is — a steady line inside the scale
 * the reading normally moves in. "σ used" and "σ of data" are separate cells
 * in the stats, so the chart still says which number it drew with.
 */
function spreadOfTheWholeRun(id) {
  const values = seriesPoints(id).map(point => point.v)
  if (values.length < 2) return 0
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function useARealSpread() {
  const original = window.ccStats
  if (typeof original !== 'function' || original.__dlLive) return

  const replaced = function ccStatsWithASpreadToDrawAgainst(points, tag) {
    const stats = original.call(this, points, tag)
    const TR = peek('TR')
    // Configured limits are the operator's own and are never second-guessed;
    // neither is a window that has variation of its own to be drawn against.
    if (!TR || TR.sig === 'cfg' || !(stats.sdw >= 0) || stats.sdw > 0) return stats

    const spread = spreadOfTheWholeRun(peek('trendTag'))
    if (!(spread > 0)) return stats

    return { ...stats, sigma: spread, ucl: stats.cl + 3 * spread, lcl: stats.cl - 3 * spread }
  }

  replaced.__dlLive = true
  replaced.original = original
  window.ccStats = replaced
}

/* ------------------------------------------------- a reading that blinks ---*/

/**
 * A reading can be set to blink on the drawing, at a rate of its own.
 *
 * A sand line's screen is ninety labels of small text, and an operator walking
 * past needs the two or three that matter today to catch the eye from across
 * the shop floor — the bentonite that is drifting, the moisture nobody has
 * looked at since the shift change. That is not an alarm: it is somebody
 * saying "watch this one", and it belongs to the reading rather than to a
 * limit being crossed.
 *
 * Kept as `blink` on the tag — seconds for a whole on-off cycle — so it
 * travels with the loop and arrives on the operator's screen with everything
 * else that was saved.
 *
 * ## Why a stylesheet rather than a style on the element
 *
 * The labels are rebuilt from a template string on every tick — see
 * `tagsSVG` — so an inline style set on one survives until the next poll and
 * no longer. A rule keyed on `[data-tag]` is matched again each time the
 * element is recreated, so the blink is unbroken and the canvas code needs to
 * know nothing about it.
 */
const BLINK_MIN = 0.4
const BLINK_MAX = 60

/** The blink set on a reading, in seconds, or null for none. */
export function blinkOf(tag) {
  const seconds = Number(tag?.blink)
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(BLINK_MAX, Math.max(BLINK_MIN, seconds))
    : null
}

/** What the stylesheet was last written for, so a tick costs one comparison. */
let blinkSignature = ''

export function paintBlinks() {
  const reg = REG() || {}
  const blinking = Object.entries(reg)
    .map(([id, tag]) => [id, blinkOf(tag)])
    .filter(([, seconds]) => seconds)

  const signature = blinking.map(([id, seconds]) => `${id}@${seconds}`).join('|')
  if (signature === blinkSignature) return
  blinkSignature = signature

  let sheet = document.getElementById('dlBlink')
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = 'dlBlink'
    document.head.append(sheet)
  }

  /*
   * The value blinks, not the label it is written on.
   *
   * A canvas label reads `Coal dust actual 3.5`, and blinking the whole thing
   * took the name of the reading off the screen every other second — on a
   * drawing of ninety labels, where the name is how you know which one is
   * flashing at you. The number is the part that is being watched.
   *
   * `.tv` is the value's own element, added to the studio's `tagsSVG`; the
   * card in the panel has `.ix-val` for the same thing.
   */
  sheet.textContent = blinking.length
    ? '@keyframes dl-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: .2 } }\n' +
      blinking.map(([id, seconds]) =>
        `.tagb[data-tag="${cssString(id)}"] .tv, ` +
        `.ix-card[data-tid="${cssString(id)}"] > summary .ix-val ` +
        `{ animation: dl-blink ${seconds}s steps(1, end) infinite }`).join('\n')
    : ''
}

/**
 * A tag id inside a CSS attribute selector.
 *
 * Ids here are `BEN-BIN.BENTONITE_LEVEL_PCT` and the like — dots, dashes and
 * whatever somebody typed — so the quotes and backslashes are escaped rather
 * than trusted. `CSS.escape` escapes an identifier, which is not what a quoted
 * string needs.
 */
const cssString = id => String(id).replace(/[\\"]/g, match => '\\' + match)

function keepBlinksPainted() {
  const original = window.liveCanvas
  if (typeof original !== 'function' || original.__dlBlink) return

  const replaced = function liveCanvasThenBlinks() {
    const answer = original.apply(this, arguments)
    try {
      paintBlinks()
    } catch {
      /* The canvas is drawn either way. */
    }
    return answer
  }

  replaced.__dlBlink = true
  replaced.original = original
  window.liveCanvas = replaced
}

/* -------------------------------------------------------- one colour ---*/

/**
 * The markers in one colour, and no rule violations.
 *
 * The studio colours each point by the zone it is in — amber past ±1σ, orange
 * past ±2σ — and red for every point the Western Electric rules flag. On a set
 * point that genuinely holds at 25.0 for an hour that painted sixty markers
 * red and lit the legend's "Rule violation", because eight points in a row on
 * one side of a centre line **computed from those same points** is a rule, and
 * on a flat set point it is a certainty. The chart was shouting about its own
 * arithmetic.
 *
 * So the series is drawn in one blue, the colour of the line it sits on, and
 * the violation marking is gone: no red dots, no rules panel, no violation
 * count. The zone bands behind it are the studio's own and are left alone —
 * they are the scale, and they say where a point is without shouting.
 */
const BLUE = ['#1f6feb', '#1f6feb', '#1f6feb', '#1f6feb']

function readInBlue() {
  const markers = peek('PTC')
  if (Array.isArray(markers)) markers.splice(0, markers.length, ...BLUE)

  const original = window.ccRules
  if (typeof original !== 'function' || original.__dlLive) return

  // Nothing flagged: the markers then take their colour from the zone they are
  // in, which is now blue all the way out.
  const replaced = function noRulesToMark(stats) {
    return (stats?.vs || []).map(() => 0)
  }

  replaced.__dlLive = true
  replaced.original = original
  window.ccRules = replaced
}

/**
 * Take the rest of the violation furniture off the window.
 *
 * The flags are already empty, so the rules panel would read "In control" for
 * ever and the count would be a permanent zero — both of them answers to a
 * question this chart no longer asks. The legend's red dot goes with them.
 *
 * Run after each draw, because the studio rebuilds the stats every time.
 */
function hideViolations() {
  for (const entry of document.querySelectorAll('.cc-leg span')) {
    if (/rule violation/i.test(entry.textContent || '')) entry.classList.add('dl-hidden')
  }

  document.getElementById('trRules')?.classList.add('dl-hidden')

  for (const cell of document.querySelectorAll('#trStats div')) {
    const label = cell.querySelector('span')?.textContent || ''
    if (/^rule violations/i.test(label.trim())) cell.classList.add('dl-hidden')
  }
}

/**
 * Fetch the chart for a linked reading when its trend window opens.
 *
 * The modal is built by the studio and drawn a frame later, so this loads in
 * the background and redraws when the answer arrives rather than holding the
 * window shut.
 */
/** Column types the studio's catalogue uses for anything that is not a number. */
/* The column's declared type is no longer consulted — see `isTextReading`. */

/**
 * Is this reading text rather than a measurement?
 *
 * Two answers, in this order, and nothing else:
 *
 *   the value   once there is one, what it actually is decides. A number kept
 *               in a VARCHAR — `"12.5"` — arrives as a number, because the
 *               server converts text that is wholly numeric, and charts like
 *               any other.
 *   the tag     before that, what the tag was declared to be. "Number
 *               (measured value)" in Edit tag means a number; a pattern name
 *               or a status list means text.
 *
 * **The column's own type used to get the last word, and it was wrong.** A
 * reading declared a measured number, pointed at a column the schema calls
 * `varchar`, was called text — so the trend answered "This reading is text, so
 * it has no chart" about a tag whose Value type says Number, with limits, a
 * σ and a unit set on it. Plant columns are `varchar` all the time; a SCADA
 * dump writes every column as text and means none of it. A guess about the
 * schema has no business overruling something somebody stated.
 *
 * What a genuinely textual column costs now is one empty chart, which says
 * what it found — see `recentValues`. That is a far better failure than
 * refusing to chart a column of numbers.
 */
export function isTextReading(id) {
  const tag = (REG() || {})[id]
  if (!tag) return false

  const record = records.get(id)
  if (record && record.value != null) return typeof record.value !== 'number'

  const textTag = peek('tagIsText')
  return typeof textTag === 'function' ? !!textTag(tag) : false
}

/** Take the Trend button off a text reading's card in the inspector. */
function hideTrendOnText() {
  for (const card of document.querySelectorAll('.ix-card[data-tid]')) {
    const button = card.querySelector('[data-ixa="trend"]')
    if (button) button.hidden = isTextReading(card.dataset.tid)
  }
}

/**
 * The windowed statement for a reading, read if it is not already in hand.
 *
 * Preview data opens on what the chart ran, and the chart may not have run
 * yet — it is loaded when a trend opens, and the preview can be reached
 * before that answer lands. Asking `/live/preview` instead is what used to
 * fill the box with the badge's `… LIMIT 1`, which is a different query about
 * a different question.
 */
async function fetchTheChartsStatement(id) {
  if (!loopId || !isLinked(id)) return null

  const seconds = Number(peek('TR')?.win) || DEFAULT_WINDOW
  try {
    const answer = await api.get(
      `/live/chart?loopId=${encodeURIComponent(loopId)}&tag=${encodeURIComponent(id)}` +
      `&windowSeconds=${seconds}`)
    charts.set(id, answer)
    return answer?.query || null
  } catch (error) {
    // A refusal carries the statement it refused on, which is the one wanted.
    return error?.detail?.query || null
  }
}

/**
 * Read the window the chart is showing, and redraw on what comes back.
 *
 * Called when a trend opens and again whenever the window changes, because
 * the window *is* the query: 8 h is not 2 h with more of the same records
 * drawn, it is a different `WHERE`. Cutting a wider window out of records
 * already in hand would show whatever the first read happened to bring back
 * and label it eight hours.
 *
 * `settle` is for the first read only: the window buttons and the control
 * limits are drawn before any record arrives, so they are set again once the
 * data is in hand. On a later read they are already right, and redoing them
 * would snap the window back to two hours — which is the button that was just
 * pressed being undone.
 */
function readTheWindow(id, { settle = false } = {}) {
  if (!loopId || !isLinked(id)) return

  const seconds = Number(peek('TR')?.win) || DEFAULT_WINDOW
  api.get(`/live/chart?loopId=${encodeURIComponent(loopId)}&tag=${encodeURIComponent(id)}` +
    `&windowSeconds=${seconds}`)
    .then(answer => {
      charts.set(id, answer)
      if (peek('trendTag') !== id) return
      addChartSwitch(id)
      if (settle) {
        useDayWindows()
        measureAgainstTheData(id)
      }
      window.drawTrend?.()
    })
    .catch(error => {
      charts.set(id, {
        series: [], processControl: null, failed: error.message,
        /*
         * The statement the refusal came with — see `chart_unreadable` in
         * routes/live.js. A chart that refused itself is the one somebody
         * most wants to open Preview data on, and an empty box there would
         * make them retype a query the server already knows.
         */
        failedQuery: error?.detail?.query || null,
      })
      if (peek('trendTag') === id) addChartSwitch(id)
    })
}

function loadChartsOnOpen() {
  const original = window.openTrend
  if (typeof original !== 'function' || original.__dlLive) return

  const replaced = function openTrendWithPlantRecords(id) {
    // A pattern name or a batch code has no trend, no mean and no σ.
    if (isTextReading(id)) {
      window.toast?.('This reading is text, so it has no chart.')
      return
    }
    chartView = 'imr'
    // A chart opens on the newest records, wherever the last one was dragged.
    viewport.id = id
    viewport.end = null
    navSignature = ''
    // And on half an hour of them, however wide the last chart was dragged.
    viewAsked = DEFAULT_VIEW
    original.call(this, id)
    hideMovingRange()
    useDayWindows()
    if (!loopId || !isLinked(id)) return

    addChartSwitch(id)
    readTheWindow(id, { settle: true })
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
  /*
   * What is drawn, out of what was read.
   *
   * These are two numbers now — the window button says what was read, the
   * strip under the chart says how much of it is on screen — and printing
   * only the second made the chart look like it had lost records. "12 of 33"
   * says plainly that the rest are a drag away.
   */
  const read = loaded?.series?.length || 0
  const drawn = (() => {
    try {
      return typeof window.ccData === 'function' ? window.ccData().length : read
    } catch {
      return read
    }
  })()

  /*
   * Readable, not machine-readable.
   *
   * These were printed as they arrived — `2026-10-16T00:15:14.000Z` twice,
   * either side of the word "to" — which is thirty characters of timestamp
   * saying what "16 Oct 05:45 → 12:23" says in twenty, in a bar that also
   * has to hold the chart's own controls.
   */
  const range = when(loaded?.dateFrom, loaded?.dateTo)

  /*
   * Where these records came from, and whether the second chart applies.
   *
   * The Process Control chart is SandMan's own calculation. A reading on a
   * database registered here has no such thing — so the tab is offered but
   * says why it is empty, rather than letting "Could not be loaded" imply
   * something went wrong when nothing did.
   */
  const from = loaded?.source || null

  /*
   * The second chart is offered only where there is a second chart.
   *
   * Process Control is SandMan's own calculation, with its own subgroups and
   * limits. A reading on a database registered here has no such thing, so the
   * tab sat there permanently empty, explaining itself in a tooltip nobody
   * opens — a control that cannot do anything, beside a chart that can.
   *
   * In its place, for an administrator, the statement these records came
   * from: the one thing that answers "why does this chart look wrong", and
   * the one thing they can change to fix it.
   */
  /*
   * Decided from the link, not from the answer.
   *
   * This used to be `!loaded?.source`, which is only known once the records
   * are back — and a *failed* fetch carries no source at all. So the reading
   * whose chart had just refused itself ("that column holds no values") was
   * the one reading with no Preview button on it, which is precisely the one
   * somebody needs to open the statement for. It is also missing for the
   * second or two before any fetch returns, which reads as a button that
   * comes and goes.
   *
   * `conn_…` on the link means this service does the reading, which is true
   * the moment the trend opens.
   */
  const sandmansOwn = !/^conn_/.test(String((REG() || {})[id]?.link?.src || ''))

  bar.innerHTML = `
    <span class="note">Chart</span>
    <div class="seg" id="dlChartSeg">
      <button data-cv="imr" class="${chartView === 'imr' ? 'on' : ''}">Individuals (I-MR)</button>
      ${sandmansOwn
        ? `<button data-cv="pc" class="${chartView === 'pc' ? 'on' : ''}">Process Control (SandMan)</button>`
        : ''}
    </div>
    <span class="note">${loaded
      ? loaded.failed
        ? escapeHtml(loaded.failed)
        : `${drawn < read ? `${drawn} of ${read}` : read} record${read === 1 ? '' : 's'}${
            range ? ' · ' + range : ''
          }${from ? ` · from ${escapeHtml(from)}` : ''}`
      : 'Loading the records…'}</span>
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
  // The tab may have gone while it was the one showing.
  if (chartView === 'pc' && !sandmansOwn) chartView = 'imr'
  offerThePreview(id, sandmansOwn)
  showView(id)
}

/**
 * Preview data, where Copy data (CSV) was.
 *
 * That button is at the foot of the trend window, which is where somebody
 * looking at a chart that is wrong puts their hand — and what it did there was
 * fail: the studio copies through `navigator.clipboard`, which a page inside
 * SandMan's iframe is not permitted to use, so it answered "Copy is blocked
 * here" and nothing else happened.
 *
 * So the foot of the window now opens the records instead: the statement they
 * came from, the rows themselves, and a copy that works — see `previewData`.
 * Copying is not taken away, it is moved to where the data it copies is.
 *
 * Only for an administrator, and only where this service runs the read. Where
 * SandMan does, there is no statement of ours to show and the studio's own
 * button is left exactly as it was.
 */
function offerThePreview(id, sandmansOwn) {
  const csv = document.getElementById('trCsv')
  if (!csv || !isAdmin() || sandmansOwn) return
  if (csv.dataset.dlPreview) return
  csv.dataset.dlPreview = '1'

  // A clone, to drop the studio's own click handler — see `captureButtons`.
  const button = csv.cloneNode(true)
  button.textContent = 'Preview data'
  button.title = 'The statement these records came from, and the rows it returns'
  csv.replaceWith(button)
  button.onclick = () => previewData(id)
}

/**
 * The statement behind this chart, and a way to try another one.
 *
 * "Why does this chart look wrong" is nearly always a question about the
 * query: the wrong column, ordered by something that is not a time, a row
 * filter matching nothing. Showing the statement answers it, and letting an
 * administrator edit and run it turns a support conversation into a thing
 * they fix themselves.
 *
 * It runs through `/live/preview`, which is the same fence every other typed
 * statement goes through — administrators only, one SELECT, read-only, capped
 * and timed out, and only against a database their own foundry registered.
 * Running one here changes nothing about the reading; adopting it is still
 * done on the reading's own card.
 */
async function previewData(id) {
  const open = window.openModal
  const close = window.closeModal
  if (!open || !close) return

  const tag = (REG() || {})[id]
  const link = tag?.link || {}
  const loop = watching()
  const loaded = charts.get(id)

  open(
    /*
     * Scrollable, because the modal is taller than the window on a laptop.
     * The statement, the buttons and two hundred rows do not fit in 600px,
     * and what fell off the bottom was the rows — the thing being previewed.
     */
    `<div id="dlQueryBox" style="max-height:72vh;overflow:auto">
 <h3>Preview data — ${escapeHtml(id)}</h3>
 <div class="note">The statement these records came from. Edit it and press Run to try another — the reading itself is not changed.</div>
 <textarea id="dlQuerySql" class="mono" rows="4" spellcheck="false"
   style="width:100%;margin-top:10px" placeholder="Loading the statement…"></textarea>
 <div class="mact" style="justify-content:flex-start;margin-top:8px;gap:8px">
   <button type="button" class="ib pri" id="dlQueryRun">Run</button>
   <button type="button" class="ib" id="dlQueryCopy">Download as CSV</button>
   <label class="note" style="margin-left:12px">Decimals
     <select id="dlQueryDp" style="margin-left:4px">
       ${[0, 1, 2, 3, 4].map(n => `<option>${n}</option>`).join('')}
     </select></label>
   <button type="button" class="ib" id="dlQueryClose" style="margin-left:auto">Back</button>
 </div>
 <p class="note" id="dlQuerySays" style="margin-top:10px"></p>
 <div id="dlQueryRows" class="dl-query-rows"></div></div>`,
    'lg'
  )

  const sql = document.getElementById('dlQuerySql')
  const says = document.getElementById('dlQuerySays')
  const rows = document.getElementById('dlQueryRows')
  /*
   * Back goes back to the chart, not out of everything.
   *
   * This modal opened from the trend window and took its place, so closing it
   * left the canvas — two steps from where somebody was, when they asked for
   * one. Reopening the trend on the same reading is what "back" means here.
   */
  document.getElementById('dlQueryClose').onclick = () => {
    close()
    window.openTrend?.(id)
  }

  const tell = (text, tone = '') => {
    says.textContent = text
    says.className = `note ${tone}`
  }

  /*
   * The records as CSV, headed by the columns the database knows.
   *
   * It used to say `recordedAt,value` — two names that appear nowhere in the
   * plant's schema, invented on the way through this service. Pasted beside a
   * Workbench result they matched nothing. The server now reports what it
   * selected, and these are those names.
   */
  const named = loaded?.columns || []
  /*
   * How many decimals the rows show, and how a moment is written.
   *
   * `34.79999923706055` is a float's exact value and nobody's measurement —
   * the reading is two decimals at most and the rest is the binary. The
   * reading's own Decimals setting says how many it is shown to everywhere
   * else; this follows it, defaulting to two, and the box above the table
   * changes it for a look without changing the reading.
   *
   * `2026-10-22T00:00:00` is ISO, which is for machines. `2026-10-22
   * 00:00:00` is the same moment written the way the plant's own tools write
   * it, which is what somebody is comparing it against.
   */
  let decimals = Number((REG() || {})[id]?.d)
  if (!Number.isFinite(decimals)) decimals = 2

  const figure = value =>
    (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : value)
  const written = at => String(at ?? '').replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '')

  const asCsv = () =>
    [named.filter(Boolean).join(',') || 'value,at']
      .concat((loaded?.series || []).map(point =>
        `${figure(point.value) ?? ''},${written(point.recordedAt)}`))
      .join('\n')

  /*
   * The rows as a table, which is what rows are.
   *
   * They were a read-only textarea of CSV — a format for a machine, shown to
   * a person, with the columns lining up only by luck of character width. A
   * table has headings that stay put and cells that align, which is the whole
   * reason anybody opens this.
   */
  const asTable = (heads, body) => {
    const cell = value => `<td>${escapeHtml(value ?? '')}</td>`
    return `<table class="dl-rows">
 <thead><tr>${heads.map(head => `<th>${escapeHtml(head)}</th>`).join('')}</tr></thead>
 <tbody>${body.map(line => `<tr>${line.map(cell).join('')}</tr>`).join('')}</tbody>
 </table>`
  }

  const showChartRows = () => {
    const heads = named.filter(Boolean).length ? named.filter(Boolean) : ['value', 'at']
    const body = (loaded?.series || []).map(point => [figure(point.value), written(point.recordedAt)])
    rows.innerHTML = body.length
      ? asTable(heads, body)
      : '<p class="note">No rows.</p>'
  }

  showChartRows()

  /*
   * Changing the decimals redraws the rows and nothing else.
   *
   * It is a way of looking at the numbers, not a change to the reading — the
   * reading's own Decimals setting is in its card and this does not touch it.
   */
  const places = document.getElementById('dlQueryDp')
  places.value = String(decimals)
  places.onchange = () => {
    decimals = Number(places.value) || 0
    showChartRows()
  }

  const chartPoints = loaded?.series?.length || 0

  /*
   * A file, not the clipboard.
   *
   * Copying was the wrong shape twice over. `navigator.clipboard` is not
   * permitted inside SandMan's iframe, so the studio's own button answered
   * "Copy is blocked here" — and the fallback, selecting the text and asking
   * for Ctrl+C, is an instruction rather than a thing the button did. Two
   * hundred rows are going into a spreadsheet anyway, and a file is what a
   * spreadsheet opens.
   *
   * The blob is revoked after the click: an object URL held open keeps the
   * whole CSV in memory for as long as the page lives.
   */
  document.getElementById('dlQueryCopy').onclick = () => {
    const text = asCsv()
    if (!text.trim()) { tell('There is nothing to download yet.'); return }

    // `BENTONITE_WEIGHT_KG_22-10-2026.csv` — the tag, then the day, the way
    // the plant writes a date.
    const today = new Date()
    const two = number => String(number).padStart(2, '0')
    const when = `${two(today.getDate())}-${two(today.getMonth() + 1)}-${today.getFullYear()}`
    const file = `${String(id).replace(/[^A-Za-z0-9_.-]+/g, '_')}_${when}.csv`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))

    const link = document.createElement('a')
    link.href = url
    link.download = file
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)

    tell(`${text.split('\n').length - 1} row(s) downloaded as ${file}.`)
  }

  /*
   * It opens on the statement the **chart** ran, not the one the badge ran.
   *
   * These are different queries and only one of them is the subject: the badge
   * asks for a single newest row (`… LIMIT 1`), the chart asks for the last
   * two hundred in order. Showing the first while somebody is looking at an
   * empty chart left them editing a statement that was never the one failing.
   *
   * It is carried on the chart's own answer, and on its refusal — which is
   * exactly when it is wanted.
   *
   * Where no chart has been read yet, the chart is read — it is **not** filled
   * in from `/live/preview`, which answers for the badge. That fallback is how
   * `SELECT \`coal_dust_actual\`, \`created_on\` FROM … ORDER BY \`created_on\`
   * DESC LIMIT 1` came to be sitting in this box over a chart holding one
   * record: the box showed the badge's query, somebody read `LIMIT 1` and
   * quite rightly asked why a chart was being limited to a row.
   */
  const chartQuery = loaded?.query || loaded?.failedQuery || null
  if (chartQuery) sql.value = chartQuery
  else fetchTheChartsStatement(id).then(found => {
    // Only if nothing has been typed in the meantime.
    if (found && !sql.value.trim()) sql.value = found
  })

  const ask = async statement => {
    tell('Running…')
    try {
      const answer = await api.post('/live/preview', {
        loopId: loop,
        source: link.src,
        ...(statement ? { sql: statement } : { table: link.table, column: link.col }),
      })

      if (answer.error) {
        tell(`${answer.via || 'The database'} refused it: ${answer.error}`, 'dl-stale')
        return
      }

      /*
       * The value, read as a value — not as the JSON it arrived in.
       *
       * This printed the record itself: `answered {"value":34.70000076293945,
       * "recordedAt":null} in 919 ms`. Three things wrong with that in one
       * line — a field name nobody asked about, fifteen decimal places of
       * float noise on a reading set to two, and `recordedAt: null` reading as
       * a fault when it only means that query selected no timestamp.
       *
       * So: the number at the reading's own precision, with its unit, and the
       * moment beside it when there is one.
       */
      const record = answer.value && typeof answer.value === 'object' ? answer.value : null
      const value = record ? record.value : answer.value
      const when = record?.recordedAt || [record?.date, record?.time].filter(Boolean).join(' ')
      const empty = value === null || value === undefined
      tell(
        `${answer.via || 'The database'} answered ` +
        (empty ? 'an empty cell' : `${figure(value)}${tag?.unit ? ` ${tag.unit}` : ''}`) +
        `${when ? ` · recorded ${when}` : ''} in ${answer.tookMs} ms. ` +
        (empty
          ? 'Which is why this chart has no points.'
          : `The chart below holds ${chartPoints} record(s).`)
      )
      /*
       * A written statement answers with one value — put it above the chart's
       * rows rather than replacing them, so what was asked and what the chart
       * is drawing can be read against each other.
       */
      if (statement) rows.innerHTML = asTable(['answer'], [[figure(value)]]) + rows.innerHTML
    } catch (error) {
      tell(error.message, 'dl-stale')
    }
  }

  document.getElementById('dlQueryRun').onclick = () => ask(sql.value.trim())
  // Opens by showing what the chart itself ran.
  ask(null)
}

/** Swap between the studio's canvases and ours. */
function showView(id) {
  const own = chartView === 'pc'
  for (const node of document.querySelectorAll('.cc-title, #trC, #dlNav, #trM, #trStats, #trDist, #trRules')) {
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
/**
 * A standard deviation is not something to be stopped for.
 *
 * The studio's Edit tag dialog marks σ required and refuses to save without
 * one: "Enter a standard deviation greater than 0". On a reading that has just
 * been pointed at a plant column, nobody knows it yet — it is a property of
 * the data, not a decision — so naming a reading meant inventing a number to
 * get past a dialog, and an invented σ draws control bands that look
 * considered and are not.
 *
 * It is only used to place the ±1σ / ±2σ / ±3σ bands, and the trend window
 * already offers "From data — std. deviation" as the alternative. So when the
 * field is left empty this fills it the way the studio fills it elsewhere:
 * from the records if there are any, otherwise from the spec width, where
 * Min to Max is the classic six σ. Both are derived, and the hint under the
 * field says which was used rather than leaving a number nobody recognises.
 */
function sigmaIsNotRequired() {
  const original = window.tagForm
  if (typeof original !== 'function' || original.__dlSoftSigma) return

  const replaced = function tagFormWithOptionalSigma(id, block) {
    const answer = original.call(this, id, block)
    try {
      relaxTheSigmaField(id)
    } catch (error) {
      // The dialog is the studio's and works either way.
      console.error('Relaxing the standard deviation failed:', error)
    }
    return answer
  }

  replaced.__dlSoftSigma = true
  replaced.original = original
  window.tagForm = replaced
}

function relaxTheSigmaField(id) {
  const box = document.getElementById('mbox')
  const sigma = document.getElementById('fSd')
  if (!box || !sigma) return

  // The asterisks say "you cannot save without this", which is no longer true.
  for (const label of box.querySelectorAll('label, .fld > label, h4, .note')) {
    if (/^(Std dev \(σ\)|Optimal|Process specification)\s*\*$/.test(label.textContent.trim())) {
      label.textContent = label.textContent.replace(/\s*\*$/, '')
    }
  }

  let hint = sigma.parentElement?.querySelector('.dl-sigma-note')
  if (!hint) {
    hint = document.createElement('div')
    hint.className = 'note dl-sigma-note'
    sigma.parentElement?.append(hint)
  }
  hint.textContent = 'Optional — worked out from the records if left empty.'

  /*
   * Filled in the capture phase, before the studio's own handler reads it.
   *
   * The dialog's Save is wired with `onclick`; this listens on the way down,
   * so by the time that handler asks for the field there is a number in it.
   */
  const save = [...box.querySelectorAll('button')].find(b => /^Save (tag|reading)$/.test(b.textContent.trim()))
  if (!save || save.dataset.dlSoftSigma) return
  save.dataset.dlSoftSigma = '1'

  save.addEventListener('click', () => {
    if (Number(sigma.value) > 0) return
    const derived = sigmaFor(id)
    if (derived > 0) {
      sigma.value = String(derived)
      hint.textContent = `Worked out as ${derived} — change it if you know better.`
    }
  }, true)
}

/** σ from the reading's own records, or from the spec width, or nothing. */
function sigmaFor(id) {
  const points = (peek('VAL')?.[id]?.h || []).map(point => point.v).filter(Number.isFinite)
  if (points.length >= 2) {
    const mean = points.reduce((sum, v) => sum + v, 0) / points.length
    const variance = points.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (points.length - 1)
    const spread = Math.sqrt(variance)
    if (spread > 0) return Number(spread.toPrecision(3))
  }

  // Min to Max is six σ, which is what a specification means.
  const min = Number(document.getElementById('fMin')?.value)
  const max = Number(document.getElementById('fMax')?.value)
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
    return Number(((max - min) / 6).toPrecision(3))
  }

  /*
   * Nothing to work from: a tenth of the optimal, which is a placeholder and
   * is admitted to be one in the hint. Better than a dialog that cannot be
   * left, and the bands it draws are visibly nominal rather than wrong.
   */
  const optimal = Math.abs(Number(document.getElementById('fTyp')?.value))
  return Number.isFinite(optimal) && optimal > 0 ? Number((optimal / 10).toPrecision(3)) : 1
}

/**
 * Decimals for every reading, and the arithmetic, in the Data tab.
 *
 * Decimals is a per-reading setting in its own card, which is right for one
 * reading and wrong for a hundred: a plant wanting two decimals everywhere had
 * to open a hundred cards. This sets them all at once, where the other things
 * that apply to the whole loop already live.
 *
 * The formulas stand beside it rather than behind a button, and rather than
 * under the chart where they were first put: they are reference, read once and
 * then known, and a panel that repeats them under every chart is in the way of
 * the figures it is explaining.
 */
function figuresInTheDataTab() {
  const panel = document.querySelector('[data-rp="data"]')
  if (!panel || panel.querySelector('#dlFigures')) return

  const group = document.createElement('div')
  group.className = 'grp'
  group.id = 'dlFigures'
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', 'Figures')
  group.innerHTML =
    '<div class="gi">' +
    '<div class="rcol"><label class="mlbl">Decimals' +
    '<select id="dlAllDecimals" title="How many decimals every reading shows">' +
    '<option value="">—</option>' +
    [0, 1, 2, 3, 4].map(n => `<option value="${n}">${n}</option>`).join('') +
    '</select></label></div>' +
    '<div class="dl-formulas">' +
    '<div><code>mean = Σx / n</code></div>' +
    '<div><code>σ = √( Σ(x − mean)² / (n − 1) )</code></div>' +
    '<div><code>CL = mean   ·   bands = CL ± kσ</code></div>' +
    '<div><code>Cp = (Max − Min) / 6σ</code></div>' +
    '<div><code>Cpk = min(Max − mean, mean − Min) / 3σ</code></div>' +
    '<div class="note">σ <b>used</b> is the reading\'s configured σ; σ <b>of data</b> is what the ' +
    'window holds. σ of 0 means every reading is identical — Cp and Cpk then divide by nothing.</div>' +
    '</div></div><span class="gl">Figures</span>'

  panel.append(group)

  const places = group.querySelector('#dlAllDecimals')

  // Blank unless every reading already agrees, because "2" on a loop that is
  // a mixture would be a claim rather than a setting.
  const readings = Object.values(REG() || {})
  const agreed = new Set(readings.map(tag => tag.d ?? 1))
  places.value = agreed.size === 1 ? String([...agreed][0]) : ''

  places.onchange = () => {
    if (places.value === '') return
    const decimals = Number(places.value)
    for (const tag of Object.values(REG() || {})) tag.d = decimals
    window.renderAll?.()
    window.liveCanvas?.(true)
    window.toast?.(`Every reading now shows ${decimals} decimal${decimals === 1 ? '' : 's'}.`)
    onDecimalsChanged?.()
  }
}

/** Told when the loop-wide decimals change, so the document can be stored. */
let onDecimalsChanged = null

export function install({ onDecimals } = {}) {
  if (typeof onDecimals === 'function') onDecimalsChanged = onDecimals
  figuresInTheDataTab()
  sigmaIsNotRequired()
  /*
   * One handle on the console, for the question this module exists to answer.
   *
   * "The chart says Collecting data… over records that are plainly there" is
   * not answerable from the screen: what matters is whether the fetch ran,
   * what it returned and why it failed, all of which live in this module's
   * own variables. `window.dlLive()` prints them.
   */
  window.dlLive = status

  showNothingWithoutData()
  hideSourceManagement()
  guardSimulation()
  markChips()
  markBadges()
  useRealChartData()
  useARealSpread()
  readInBlue()
  keepNavigatorInStep()
  keepBlinksPainted()
  loadChartsOnOpen()
  // Before any chart opens, so the first one drawn is already a window wide.
  defaultWindow()
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
  /**
   * What each trend window fetched, which is the first thing to ask when a
   * chart says "Collecting data…" over records that are plainly there.
   */
  charts: [...charts.entries()].map(([id, loaded]) => ({
    id,
    points: loaded?.series?.length ?? 0,
    failed: loaded?.failed || null,
  })),
  stale,
  reason,
  problems: Object.fromEntries(problems),
  /** When SandMan was last asked — once a minute while a loop is open. */
  lastCheckAt,
  /** When a reading last actually changed, which is far less often. */
  lastChangeAt,
  pollMs: POLL_MS,
})
