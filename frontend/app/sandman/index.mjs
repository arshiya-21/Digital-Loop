import { enter, session, isAdmin } from './session.mjs'
import * as designs from './designs.mjs'
import * as studio from './studio.mjs'
import * as live from './live.mjs'
import * as databases from './databases.mjs'
import * as properties from './properties.mjs'
import * as equipment from './equipment.mjs'
import * as dbForm from './db-form.mjs'
import * as tableVisibility from './table-visibility.mjs'
import * as processChecks from './process-checks.mjs'
import { ApiError } from './api.mjs'

/**
 * The Digital Loop build of the studio (v6.8).
 *
 * The editor knows nothing about SandMan, sessions or roles — it draws loops
 * and keeps them in this browser. This module is everything that makes it the
 * Digital Loop application: it opens only through a SandMan session, stores
 * designs on the server, offers the plant's lines, and shows the published
 * loop rather than the editor.
 *
 * What it does *not* do any more is describe the plant's database. v6.8 has
 * its own Database → Table → Tag flow, and the server hands it the real
 * schema through `window.SANDMAN_CONTEXT` as the page is served — so tagging
 * is upstream's, fed with our data, instead of ours bolted on.
 *
 * It reaches the editor only through functions the editor already had; see
 * `studio.mjs`.
 */

const $ = selector => document.querySelector(selector)

/* ------------------------------------------------------------ lock screen ---*/

function lock(reason, sandmanUrl) {
  const screen = $('#dlLocked')
  if (!screen) return
  $('#dlLockedReason').textContent = reason
  const back = $('#dlLockedGo')
  back.href = sandmanUrl || '/'
  back.hidden = false
  if (embedded()) back.target = '_top'
}

const unlock = () => {
  document.body.classList.remove('dl-locked')
  $('#dlLocked')?.remove()
}

/**
 * Are we inside SandMan's page rather than a tab of our own?
 *
 * SandMan opens the studio in a full-page iframe. That changes one thing: a
 * link out of here must replace the whole page, not load SandMan inside
 * SandMan. Reading `window.top` across origins throws, and being blocked is
 * itself the answer — a frame we cannot see out of is still a frame.
 */
function embedded() {
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}

/* --------------------------------------------------------- the line strip ---
 *
 * A line has one design, so choosing a line is choosing a design. Lines with
 * nothing on them are still listed and say so — for an administrator that is
 * the prompt to draw one.
 *
 * It goes in the header's right-hand group, where the studio puts the customer
 * chip: the plant and the line are the document's identity here, and the chip
 * says the same thing less usefully.
 */
function buildLineStrip() {
  const strip = document.createElement('div')
  strip.id = 'dlLineBar'
  strip.className = 'dl-linebar'
  strip.innerHTML = `
    <label class="dl-linelabel" id="dlPlant" for="dlLine"></label>
    <select id="dlLine" aria-label="Production line"></select>
    <button type="button" id="dlPublish" class="dl-publish" hidden></button>
    <a class="dl-back" id="dlBack" href="/" title="Leave the studio and go back to SandMan">
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
           stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
      Back
    </a>`

  const chip = document.getElementById('custChip')
  // The chip names the customer, which is our foundry — said once, by us.
  if (chip) chip.hidden = true

  placeStrip(strip)
  followPublishView(strip)

  $('#dlPlant').textContent = session.foundry.name
  const back = $('#dlBack')
  back.href = session.sandmanUrl || '/'
  if (embedded()) back.target = '_top'
  $('#dlLine').addEventListener('change', event => openLine(event.target.value))
  $('#dlPublish').addEventListener('click', togglePublish)
}

/**
 * Where the strip belongs right now.
 *
 * The publish view is full screen: it covers the header, which is where the
 * plant, the line and the way out live. Leaving them behind it would mean an
 * operator — who never leaves that view — could not change line or get back
 * to SandMan at all.
 *
 * So the strip moves rather than being duplicated. One element, in the header
 * or in the publish view's own bar, which is the only arrangement where the
 * two cannot drift out of step.
 */
function placeStrip(strip) {
  const inPublish = document.body.classList.contains('present')
  const home = inPublish
    ? document.getElementById('pbar')
    : document.getElementById('custChip')?.parentElement ||
      document.querySelector('header.hdr .r')
  if (!home || strip.parentElement === home) return

  strip.classList.toggle('dl-in-publish', inPublish)
  if (inPublish) home.append(strip)
  else home.prepend(strip)
}

/**
 * Follow the studio in and out of the publish view.
 *
 * It toggles a class on `body`; watching that is cheaper and far less brittle
 * than wrapping `setPresent`, which the studio calls from several places and
 * may rename.
 */
function followPublishView(strip) {
  new MutationObserver(() => placeStrip(strip))
    .observe(document.body, { attributes: true, attributeFilter: ['class'] })
}

/**
 * The line the dropdown is standing on.
 *
 * Not the same as the open design's line: an empty line has no design, and the
 * dropdown must still show where you are rather than snapping back.
 */
let standingLine = null

function refreshLineStrip() {
  const select = $('#dlLine')
  if (!select) return

  const openLineId = standingLine || designs.current?.lineId || ''
  select.innerHTML = ''
  for (const line of session.lines) {
    const design = designs.designOnLine(line.id)
    const option = document.createElement('option')
    option.value = line.id
    // Every line is listed for everyone. An operator standing on an empty one
    // is told nothing is published there, which is worth knowing; an
    // administrator is being invited to draw it.
    option.textContent = line.name
    option.dataset.has = design ? '1' : ''
    select.append(option)
  }
  select.value = openLineId

  const publish = $('#dlPublish')
  if (!isAdmin() || !designs.current) {
    publish.hidden = true
    return
  }

  publish.hidden = false
  const design = designs.current
  const live = design.status === 'published'
  // Saved work the plant cannot see yet — the one state worth noticing.
  const ahead = live && design.publishedVersion > 0 &&
    design.latestVersion > design.publishedVersion

  publish.dataset.state = ahead ? 'ahead' : live ? 'live' : 'draft'
  publish.textContent = ahead
    ? `Publish v${design.latestVersion}`
    : live
      ? `Published · v${design.publishedVersion}`
      : `Publish v${design.latestVersion}`
  publish.title = ahead
    ? `The foundry is still seeing v${design.publishedVersion}. ` +
      `Publish to show them v${design.latestVersion}.`
    : live
      ? 'Everyone in this foundry can see this version — click to hide it again'
      : 'Not published — click to show this version to the foundry'
}

/* ------------------------------------------------------------------ opening ---*/

/**
 * The view everybody lands in.
 *
 * Publish, for both roles. An operator has nothing else; an administrator is
 * shown what the plant sees and switches to Design to change it, which is one
 * click and makes "what is live" the default question rather than an
 * afterthought.
 */
function showPublished() {
  studio.setMode('monitor')
  studio.setPresent(true)
}

/* --------------------------------------------------------- an empty line ---
 *
 * A blank canvas tells nobody anything.
 *
 * There are two ways to end up looking at one — the line has no design yet, or
 * its design was drawn in the previous studio — and two people it can happen
 * to. An operator needs to know it is not broken and who to ask; an
 * administrator needs the way to start. Neither is served by an empty screen
 * and a toast that has already gone.
 *
 * Shown only in the publish view, by CSS. In Design the canvas is where the
 * work happens and a card sitting on it would be in the way.
 */
function emptyNotice({ heading, body, action }) {
  document.getElementById('dlEmpty')?.remove()

  const card = document.createElement('div')
  card.id = 'dlEmpty'
  card.className = 'dl-empty'
  card.innerHTML = `
    <div class="dl-empty-card">
      <h2></h2>
      <p></p>
    </div>`
  card.querySelector('h2').textContent = heading
  card.querySelector('p').textContent = body

  if (action) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dl-empty-go'
    button.textContent = action.label
    button.addEventListener('click', action.run)
    card.querySelector('.dl-empty-card').append(button)
  }

  // Over the canvas, inside the element the publish view sizes itself to.
  const canvas = document.getElementById('cwrap') || document.body
  canvas.append(card)
}

const clearEmptyNotice = () => document.getElementById('dlEmpty')?.remove()

/** The administrator's way out of an empty line: leave publish, start drawing. */
const startDesigning = () => {
  clearEmptyNotice()
  document.getElementById('pExit')?.click()
  studio.setMode('design')
}

/** What to say about an empty canvas, to whoever is looking at it. */
function explainEmpty({ lineName, oldFormat, designName }) {
  if (isAdmin()) {
    emptyNotice({
      heading: oldFormat
        ? `“${designName}” was drawn in the previous studio`
        : `No loop on ${lineName} yet`,
      body: oldFormat
        ? 'It cannot be opened here. Draw it again and Save — it becomes a new ' +
          'version of the same design, and the old ones stay in its history.'
        : `Nothing has been drawn for ${lineName}. Switch to Design, build the ` +
          'loop, then Save and Publish it.',
      action: { label: 'Go to Design', run: startDesigning },
    })
    return
  }

  emptyNotice({
    heading: oldFormat
      ? `“${designName}” cannot be shown here yet`
      : `No loop published for ${lineName} yet`,
    body: oldFormat
      ? 'It was drawn in the previous studio. Ask an administrator to draw it again.'
      : 'Ask an administrator to design this line and publish it.',
  })
}

async function openLine(lineId) {
  standingLine = lineId ? String(lineId) : null

  const design = designs.designOnLine(lineId)
  if (!design) {
    // The canvas is emptied either way: leaving the previous line's loop on
    // screen would be claiming this line has a design when it has not.
    designs.close()
    const lineName = designs.lineNameFor(lineId) || 'this line'
    // Nothing is open, so nothing is linked to the plant.
    live.stop()
    // The view first, then the drawing, then the fit — see openDesign.
    showPublished()
    refreshLineStrip()
    // Nothing was opened, so there is nothing a save could overwrite.
    studio.write(studio.blank(`${lineName} loop`))
    openedWith = 0
    explainEmpty({ lineName })
    studio.fitWholeLoop()
    return
  }
  await openDesign(design.id)
}

async function openDesign(designId) {
  const layout = await designs.open(designId)
  standingLine = designs.current.lineId

  /*
   * A design from the previous studio.
   *
   * Those rows were kept on purpose rather than deleted, so they can still be
   * read, exported and counted — but this studio has no reader for them. The
   * canvas is emptied and the reason is said plainly, because the alternative
   * is a blank screen that looks like a loading failure.
   *
   * For an administrator it is also an invitation: drawing the line again and
   * saving puts a new version on the same design, and the old ones stay in the
   * history where they were.
   */
  if (!studio.canOpen(layout)) {
    const design = designs.current
    /*
     * Nothing was opened here either: the stored design is in the previous
     * format and could not be drawn. Saving over it with a new-format version
     * is exactly what this screen invites, so the guard must not stand in the
     * way of it.
     */
    // Drawn in the previous studio: nothing on the canvas, nothing to read.
    live.stop()
    showPublished()
    applyRole()
    refreshLineStrip()
    studio.write(studio.blank(design.name || `${design.lineName} loop`))
    openedWith = 0
    explainEmpty({
      lineName: design.lineName || designs.lineNameFor(design.lineId),
      designName: design.name,
      oldFormat: true,
    })
    studio.fitWholeLoop()
    return
  }

  /*
   * The order here is what decides whether opening looks settled or jumpy.
   *
   * The publish view is entered first, because it hides the header and shows
   * its own bar — the canvas is a different size in it, and a loop fitted to
   * the design canvas has to be fitted again the moment that happens. The
   * role and the line strip follow, because an operator has fewer controls and
   * the strip's width decides whether the publish bar is one row or two; both
   * change the height of the canvas.
   *
   * Only then is the loop drawn, and the fit is last, when everything it
   * measures has stopped moving.
   */
  showPublished()
  applyRole()
  refreshLineStrip()

  studio.write(layout)
  openedWith = studio.size(layout)
  clearEmptyNotice()
  studio.fitWholeLoop()

  /*
   * Readings last, because what is linked is a property of the document that
   * was just loaded — and because the first poll should not delay the drawing
   * appearing. Linked readings take over from the simulation within a second
   * or so; unlinked ones carry on being simulated, marked Demo.
   */
  live.start(designs.current.id)
}

/* ------------------------------------------------------------- saving ------ */

/**
 * How much was on the canvas when this design was opened.
 *
 * Saving an empty canvas over a drawn loop is almost never what somebody
 * meant, and from the outside it is indistinguishable from losing the work:
 * versions are immutable so nothing is destroyed, but the newest version is
 * what an administrator opens next time, so the loop looks gone.
 *
 * It has already happened once — a design went from 97 items to two empty
 * versions within half an hour.
 */
let openedWith = 0

async function saveToServer() {
  if (!isAdmin()) {
    studio.toast('Viewing only — ask an administrator to change this loop.')
    return
  }

  const document_ = studio.read()

  /*
   * Do not replace a drawn loop with an empty one without asking.
   *
   * Clearing a line deliberately is legitimate, so this confirms rather than
   * forbids — but the default answer is no, and the message says what will
   * happen rather than asking "are you sure".
   */
  if (designs.current && openedWith > 0 && studio.size(document_) === 0) {
    const ok = confirm(
      `The canvas is empty, but ${designs.current.name} has ${openedWith} items in it.\n\n` +
      'Saving now stores an empty loop as the newest version, and that is what ' +
      'opens next time.\n\nSave an empty loop anyway?'
    )
    if (!ok) {
      studio.toast('Not saved — the loop on the server is unchanged.')
      return
    }
  }

  // Standing on an empty line, Save is what creates the design. A line has one
  // design, so there is nothing to choose: the line is already picked and the
  // canvas is already the first version.
  if (!designs.current) {
    if (!standingLine) {
      studio.toast('Pick a line first, then Save to create its design.')
      return
    }
    /*
     * The one save that asks.
     *
     * This is the save that names the line's loop, and the name is what
     * everyone sees from then on — in the Open list, in the publish banner, in
     * every toast. Afterwards Save stores a new version and says so, because
     * asking for the same name on every save is a dialog to dismiss, not a
     * decision to make.
     */
    const drawn = document_.DOC?.name?.trim()
    const suggested = drawn && !/^(new flowsheet|untitled)/i.test(drawn)
      ? drawn
      : `${designs.lineNameFor(standingLine)} loop`

    const name = await studio.askName({
      title: 'Name this loop',
      label: 'Loop name',
      value: suggested,
      hint: `It is the loop for ${designs.lineNameFor(standingLine)}, and this is its first version.`,
    })
    if (!name) {
      studio.toast('Not saved — nothing has been stored for this line yet.')
      return
    }

    const made = await designs.create(name, standingLine, document_)
    await openDesign(made.id)
    studio.toast(`Created ${name} on ${designs.lineNameFor(standingLine)} as version 1.`)
    return
  }

  const version = await designs.save(document_)
  // What is on the canvas now is the thing to compare against next time.
  openedWith = studio.size(document_)
  studio.toast(
    `Saved ${designs.current.name} as version ${version}. ` +
    (designs.current.status === 'published'
      ? 'Publish again to show it to the plant.'
      : 'Publish it when it is ready.')
  )
  refreshLineStrip()
}

async function togglePublish() {
  if (!designs.current) return
  try {
    if (designs.current.status === 'published') {
      await designs.unpublish()
      studio.toast(`${designs.current.name} hidden — nobody in this foundry can open it now.`)
    } else {
      await designs.publish()
      studio.toast(`${designs.current.name} published — everyone in this foundry can see it.`)
    }
    refreshLineStrip()
  } catch (error) {
    reportFailure(error)
  }
}

/** A publish refused for missing data tags names the offending equipment. */
function reportFailure(error) {
  if (error instanceof ApiError && error.code === 'missing_data_tags') {
    const items = (error.detail?.missing || []).map(item => item.name || item.id).join(', ')
    studio.toast(`${error.message}${items ? ` (${items})` : ''}`)
    return
  }
  studio.toast(error.message)
}

/* -------------------------------------------------------------- the role ---
 *
 * Hiding the editing chrome from an operator is presentation only. The API
 * refuses their writes regardless, which is the actual control — this is so
 * they are not shown tools that would only fail.
 */
function applyRole() {
  document.body.classList.toggle('dl-viewer', !isAdmin())
  document.body.classList.toggle('dl-admin', isAdmin())
}

/* ----------------------------------------------------------------- boot ---- */

async function boot() {
  const result = await enter()
  if (!result.ok) {
    lock(result.reason, result.sandmanUrl)
    return
  }

  /*
   * Everything past this point is guarded.
   *
   * `unlock()` is the last thing that happens, so anything that threw on the
   * way left the cover up reading "Opening…" — for ever, with no reason and no
   * way out. A failure here is rare but not impossible, and the one screen
   * somebody cannot leave is the worst place to put it.
   */
  try {
    if (!(await studio.whenReady())) {
      /*
       * Say which of the two it was.
       *
       * The editor builds its own markup as it runs, so `#cv` on the page but
       * no functions means it started and stopped partway; neither means the
       * script never arrived at all. Those have completely different causes
       * and the same message served neither.
       */
      const drewItself = !!document.querySelector('#cv')
      throw new Error(
        drewItself
          ? 'The studio started but did not finish — reload the page.'
          : 'The studio could not be loaded. Check that the Digital Loop server is running, then reload.'
      )
    }

    studio.defaultToLightTheme()
    applyRole()
    buildLineStrip()

    /*
     * Before any loop opens.
     *
     * `simTick` starts with the studio, so the guard that keeps it off linked
     * readings has to be in place before the first tick — not when the first
     * loop happens to load.
     */
    live.install()

    /*
     * Before the first loop opens, for the same reason `live.install()` is:
     * the checkpoint seeder runs as a loop is built, so the wrapper that takes
     * its invented records back has to be in place first — see
     * process-checks.mjs. It also switches on alarms from the tag limits.
     */
    processChecks.install()

    /*
     * The databases a reading may be linked to: the foundry's own, from the
     * launch, and any an administrator registered. This replaces the studio's
     * three invented demo servers — see databases.mjs. Not awaited, because a
     * slow list should not hold up the loop appearing; the properties panel
     * redraws when it lands.
     */
    databases.install()

    /*
     * One data connection in Properties rather than two, with the readings
     * under it — see properties.mjs.
     *
     * It is given `saveToServer` because the studio's own save is discarded
     * below, and linking a reading to a column has to reach the server: that
     * stored layout is the only thing `/live/values` reads.
     */
    properties.install({ save: saveToServer })

    // The equipment designer picked by group, and the drawing uploaded from
    // the form rather than from behind the Shape select — see equipment.mjs.
    equipment.install()

    // The external database form, against `/connections` rather than the
    // studio's simulated gateway — see db-form.mjs.
    dbForm.install()

    /*
     * Which tables each database offers when a reading is linked.
     *
     * After `databases.install()`, deliberately: this wraps `catalog` on top
     * of that one so it narrows whatever the layer below produced, rather than
     * being bypassed by it. Not awaited — a slow list should not hold up the
     * loop, and the panel redraws when it lands.
     */
    tableVisibility.install()

    // Designs live on the server from here: the browser keeps no copy, and
    // Save means a new version rather than a file or a localStorage entry.
    studio.captureSaves(() => {})
    studio.captureButtons({
      onSave: saveToServer,
      onOpen: () => studio.toast('Choose a line at the top to open its loop.'),
    })
    studio.captureSaveShortcut(saveToServer)

    try {
      await designs.reload()
    } catch (error) {
      studio.toast(error.message)
    }

    const landing = designs.landingDesign()
    if (landing) await openDesign(landing.id)
    else await openLine(session.lineId || session.lines[0]?.id)

    unlock()
  } catch (error) {
    console.error('Opening the studio failed:', error)
    lock(
      `This plant could not be opened: ${error?.message || error}. ` +
      'Try opening Digital Loop from SandMan again.',
      session.sandmanUrl
    )
  }
}

/* The editor builds its DOM as its script runs. This module is deferred by
   being a module, so that has happened — but `DOMContentLoaded` may still be
   pending, and the studio wires its buttons on it. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}
