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

/**
 * Whether the canvas was started with New since the last open or save.
 *
 * A line may hold several loops, so a blank canvas on a line that already has
 * one is ambiguous: redrawing the line, or drawing a rebuild beside it. This
 * is what makes the next Save ask instead of guessing — and it is cleared by
 * opening anything or by saving, so it only ever colours the save that
 * follows New.
 */
let startedFresh = false

/**
 * The studio's New, which clears the canvas.
 *
 * The ribbon routes it through the hidden File select rather than a function
 * of its own — `fileAct('blank')` sets the value and dispatches `change` — so
 * that is what this listens for, in the capture phase, before the studio acts
 * on it.
 */
function watchForNew() {
  const file = document.getElementById('selFile')
  if (!file || file.dataset.dlWatched) return
  file.dataset.dlWatched = '1'
  file.addEventListener('change', event => {
    if (event.target.value === 'blank') startedFresh = true
  }, true)
}

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
  // Whatever was on the canvas is gone; the next Save is about this loop.
  startedFresh = false

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
   * A canvas started with New is a new loop; anything else is a version.
   *
   * That is the whole rule. Saving a loop that was opened stores the next
   * version of it, which is what every save but this one does; saving a
   * canvas that was started from nothing stores a loop of its own and leaves
   * the one that was open where it is. Only the name is asked for, because
   * that is the part nobody can work out from the drawing.
   */
  if (startedFresh && designs.current && standingLine) {
    const open = designs.current
    const lineName = designs.lineNameFor(standingLine) || open.lineName

    const name = await studio.askName({
      title: 'Name this loop',
      label: 'Loop name',
      value: freeLoopName(standingLine, nameOnCanvas(document_) || `${lineName} loop`),
      hint: `A new loop on ${lineName}, started from an empty canvas. ` +
        `${open.name} stays where it is, at version ${open.latestVersion}.`,
      action: 'Create',
    })
    if (!name) {
      studio.toast('Not saved — nothing on the server has changed.')
      return
    }

    const made = await designs.create(name, standingLine, titled(document_, name))
    startedFresh = false
    await openDesign(made.id)
    studio.toast(`Created ${name} on ${lineName} as version 1. ${open.name} is untouched.`)
    return
  }

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

  // Standing on a line with nothing open, Save is what creates the loop: the
  // line is already picked and the canvas is already its first version.
  if (!designs.current) {
    if (!standingLine) {
      studio.toast('Pick a line first, then Save to create its design.')
      return
    }
    /*
     * The saves that ask are the ones that make a loop, and they ask one
     * thing: its name. That is what everyone sees from then on — in the
     * publish banner and in every toast — and it is the part nobody can work
     * out from the drawing. Afterwards Save stores a version and says so.
     */
    const name = await studio.askName({
      title: 'Name this loop',
      label: 'Loop name',
      value: freeLoopName(
        standingLine,
        nameOnCanvas(document_) || `${designs.lineNameFor(standingLine)} loop`
      ),
      hint: `It is the loop for ${designs.lineNameFor(standingLine)}, and this is its first version.`,
      action: 'Create',
    })
    if (!name) {
      studio.toast('Not saved — nothing has been stored for this line yet.')
      return
    }

    const made = await designs.create(name, standingLine, titled(document_, name))
    startedFresh = false
    await openDesign(made.id)
    studio.toast(`Created ${name} on ${designs.lineNameFor(standingLine)} as version 1.`)
    return
  }

  /*
   * The name on the drawing is the loop's name.
   *
   * The box at the top of the window is where anybody would go to name this
   * thing, and it is the name on the drawing from then on — so a loop called
   * "Final Version" on screen saying "Saved DemoLoop3 as version 76" is the
   * studio disagreeing with itself. Renaming here keeps the two the same.
   *
   * It is a rename, not a new loop: the versions, the history and whatever is
   * published stay exactly where they are.
   */
  const title = nameOnCanvas(document_)
  let renamed = null
  let refused = null
  if (title && title !== designs.current.name) {
    const was = designs.current.name
    try {
      await designs.rename(title)
      renamed = was
    } catch (error) {
      // A name another loop on this line already has. The drawing still
      // saves — losing the work over the label would be the worse answer —
      // and the refusal is said in the one message about this save, not in a
      // toast the next one wipes out.
      refused = error.message
    }
  }

  const version = await designs.save(document_)
  // What is on the canvas now is the thing to compare against next time.
  openedWith = studio.size(document_)
  startedFresh = false
  studio.toast(
    `Saved ${designs.current.name} as version ${version}. ` +
    (renamed ? `Renamed from ${renamed}. ` : '') +
    (refused ? `Still called ${designs.current.name}: ${refused} ` : '') +
    (designs.current.status === 'published'
      ? 'Publish again to show it to the plant.'
      : 'Publish it when it is ready.')
  )
  refreshLineStrip()
}

/** The name on the canvas, unless it is the studio's own placeholder. */
function nameOnCanvas(document_) {
  const drawn = document_?.DOC?.name?.trim()
  return drawn && !/^(new flowsheet|untitled)/i.test(drawn) ? drawn : ''
}

/**
 * The drawing, under the name the loop was given.
 *
 * A loop made from a blank canvas carries the studio's placeholder title, so
 * the strip at the top said "New flowsheet" over a loop called "Bay two
 * trial". The name is stored with the drawing as well as on the loop, and
 * written into the box where the title is shown.
 */
function titled(document_, name) {
  const doc = studio.peek('DOC')
  if (doc) doc.name = name
  const box = document.getElementById('docName')
  if (box) box.value = name

  return { ...document_, DOC: { ...(document_.DOC || {}), name } }
}

/**
 * A name no loop on this line is using.
 *
 * Two loops on a line may not share one — that is how they are told apart —
 * and the server refuses the second. Suggesting "Disa 230C loop 2" is kinder
 * than letting Save fail on a name the person did not choose.
 */
function freeLoopName(lineId, wanted) {
  const taken = new Set(designs.designsOnLine(lineId).map(loop => loop.name))
  if (!taken.has(wanted)) return wanted
  for (let n = 2; n < 100; n++) {
    if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`
  }
  return `${wanted} ${Date.now()}`
}

/**
 * Open — the latest loop on this line.
 *
 * A line may hold more than one, because pressing New and saving starts
 * another, but only the newest is ever shown: the older ones are history on
 * the server rather than a list to pick through. So this reloads and opens
 * whatever is latest, which is also what choosing the line does.
 */
async function openAnotherLoop() {
  const lineId = standingLine || designs.current?.lineId
  if (!lineId) {
    studio.toast('Pick a line at the top first.')
    return
  }

  // From the server, not from the copy taken when the studio opened: somebody
  // else may have saved since.
  try {
    await designs.reload()
  } catch (error) {
    studio.toast(error.message)
  }

  const lineName = designs.lineNameFor(lineId) || 'this line'
  const latest = designs.designOnLine(lineId)
  if (!latest) {
    studio.toast(`Nothing has been drawn for ${lineName} yet — draw it and press Save.`)
    return
  }

  if (latest.id === designs.current?.id) {
    studio.toast(`${latest.name} is the latest loop on ${lineName}, and it is already open.`)
    return
  }

  await openDesign(latest.id)
  studio.toast(`Opened ${designs.current.name}, the latest loop on ${lineName}.`)
}

async function togglePublish() {
  if (!designs.current) return
  try {
    if (designs.current.status === 'published') {
      await designs.unpublish()
      studio.toast(`${designs.current.name} hidden — nobody in this foundry can open it now.`)
    } else {
      const result = await designs.publish()
      // A line shows one loop at a time, so publishing this one took the other
      // off the plant's screens. Said here rather than found out there.
      const replaced = (result?.replaced || []).join(', ')
      studio.toast(
        `${designs.current.name} published — everyone in this foundry can see it.` +
        (replaced ? ` ${replaced} is no longer published.` : '')
      )
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
    // "Build your sand loop" belongs on the page it is talking about, not in
    // the middle of the window while the page is scrolled somewhere else.
    studio.anchorEmptyCardToThePage()
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
    // `onLinked` because the studio's own linking wizard writes links too, and
    // those have to reach the server like the ones made in Properties do.
    databases.install({ onLinked: properties.persist })

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
      onOpen: openAnotherLoop,
    })
    watchForNew()
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
