/**
 * Talking to the studio.
 *
 * v6.8 is a classic script sharing one global scope, not a module — so there
 * is no import to reach it with, and nothing was added to it to let us in.
 * What it does leave on `window` is every top-level `function` declaration,
 * and that turns out to be everything this integration needs:
 *
 *   snap()            the document as JSON — `{ DOC, REG }`
 *   restore(json)     replace it
 *   changed()         redraw and persist after a change
 *   setMode(m)        'design' | 'monitor'
 *   setPresent(on)    the Publish view
 *   toast(text)       the studio's own notice
 *
 * `DOC` and `REG` themselves are declared with `let`, which in a classic
 * script does *not* create a property on `window`, so they are unreachable
 * directly — hence going through `snap` and `restore`, which is the same pair
 * the studio's own undo uses and therefore the pair most certain to stay.
 *
 * Everything here tolerates a missing function rather than assuming one: a
 * studio that renamed something should leave the lock up with a reason, not
 * throw inside an event handler where nobody sees it.
 */

const fn = name => (typeof window[name] === 'function' ? window[name] : null)

/**
 * Reach a binding the studio declared with `const` or `let`.
 *
 * Those do not become properties of `window` — which is why `DOC` and `REG`
 * cannot simply be read — but they do go into the global lexical environment,
 * which anything evaluated in global scope can see. `new Function` body runs
 * in exactly that scope, so this reaches them.
 *
 * Returns null rather than throwing if a drop ever renames one, so a studio
 * that moved something leaves a feature switched off instead of breaking the
 * page.
 */
export function peek(name) {
  try {
    return new Function(`return typeof ${name} === 'undefined' ? null : ${name}`)()
  } catch {
    return null
  }
}

/** Is the studio loaded and talking to us? */
export const ready = () => !!(fn('snap') && fn('restore'))

/**
 * Wait for the editor to finish starting.
 *
 * A module script runs after the classic scripts before it, so in principle
 * the editor is already there by the time this module does anything. In
 * practice `app.js` is four and a half megabytes: on a slower machine, or when
 * the browser has decided to recompile it, the moment our module runs is not
 * always the moment the editor has finished defining itself — and asking once
 * and giving up turned that into "This plant could not be opened", which reads
 * like a broken installation rather than a slow one.
 *
 * So this waits. If the editor genuinely never arrives the message is the same
 * as before, just later and now actually true.
 */
export function whenReady(timeoutMs = 20000) {
  if (ready()) return Promise.resolve(true)

  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs
    const look = () => {
      if (ready()) return resolve(true)
      if (Date.now() > deadline) return resolve(false)
      // A frame at a time: the editor is defining itself on this same thread,
      // so there is no point asking faster than it can make progress.
      requestAnimationFrame(look)
    }
    look()
  })
}

/** The open document, as the studio serialises it: `{ DOC, REG }`. */
export function read() {
  const snap = fn('snap')
  if (!snap) throw new Error('The studio did not finish loading.')
  return JSON.parse(snap())
}

/**
 * Is this a document this studio can open?
 *
 * Designs drawn in the previous studio are stored as `{ format, nodes, edges }`
 * and are still in the database — kept deliberately, because they are somebody's
 * work. v6.8 cannot read them: handing one to `restore` sets `DOC` to
 * undefined and the next redraw throws somewhere far from the cause. So the
 * shape is checked here, where the answer can still be a sentence.
 */
export const canOpen = document =>
  !!document && typeof document === 'object' &&
  !!document.DOC && Array.isArray(document.DOC.blocks)

/**
 * Replace the open document.
 *
 * `restore` sets the state; `changed` is what redraws and re-persists. Called
 * in that order because a restore without a redraw leaves the canvas showing
 * the previous loop.
 */
export function write(document) {
  const restore = fn('restore')
  if (!restore) throw new Error('The studio did not finish loading.')
  if (!canOpen(document)) {
    throw new Error('This loop was drawn in the previous studio and cannot be opened here.')
  }
  restore(JSON.stringify(document))
  /*
   * The page before the redraw, so the frame is part of the first paint rather
   * than appearing a moment later — and so the publish fit, which runs
   * immediately after this, already has a page to fit to.
   */
  ensurePublishPage()
  fn('changed')?.()
}

/** An empty loop, named after the line it is for. */
export const blank = name => ({
  DOC: { name, blocks: [], streams: [], seq: 1 },
  REG: {},
})

/** How much is on the canvas — used to tell an empty line from a drawn one. */
export function size(document) {
  const doc = document?.DOC
  return (doc?.blocks?.length || 0) + (doc?.streams?.length || 0)
}

export const setMode = mode => fn('setMode')?.(mode)
export const setPresent = on => fn('setPresent')?.(on)
export const toast = text => fn('toast')?.(text)

/**
 * Put the whole loop on the screen.
 *
 * The studio's own default is `fit: 'width'`, which fills the width and lets a
 * tall loop run off the bottom — on a real sand line, most of the moulding end.
 * Opening a design is an act of looking at it, so the whole thing is what
 * should be there.
 *
 * Two frames of delay: the canvas is measured from its container, and after
 * `restore` the container has not been laid out yet — fitting immediately
 * measures the old size and lands the loop in the wrong place. The studio's
 * own startup waits the same way.
 */
export function fitWholeLoop() {
  const fit = fn('fit')
  if (!fit) return

  /*
   * The publish view fits itself, and does it better than we can.
   *
   * It used not to: its "Fill screen" spread the equipment into a temporary
   * layout that pushed the top of a tall sand line off the screen, so this
   * reached in and pressed "Whole loop" instead. As of v8.3 that mode scales
   * the drawing uniformly, keeps every position as drawn, and arranges the
   * HMI panels into the free space around it — about 99 % of the screen on a
   * 1920x1080 display. Forcing the older mode now uses *less* of the screen,
   * so what is called there is the studio's own `fit()`, which hands straight
   * to its publish sizing.
   *
   * Design and Simulate still default to filling the width, which lets a tall
   * loop run off the bottom, so those ask for the whole page.
   */
  const once = () => {
    try {
      if (document.body.classList.contains('present')) fit()
      else fit('page', true)
    } catch (error) {
      console.error('Fitting the loop failed:', error)
    }
  }

  /*
   * Now, before the browser paints — and again two frames later.
   *
   * The first call is the one that matters. `restore()` draws the loop
   * immediately, under whatever view the canvas was last left in; for a freshly
   * opened studio that is `translate(40,30) scale(1)`, the empty-document view.
   * Leaving the fit to a later frame therefore paints the loop once at 100 %
   * in the corner and then shrinks it — which is what made opening the publish
   * view look like it zoomed in and then out. Fitting in the same task means
   * the first frame the loop appears in is already the right one.
   *
   * The deferred pass stays because the canvas is measured from its container,
   * and a container that has only just been shown has not been laid out yet —
   * measuring it then lands the loop in the wrong place. It is a correction,
   * not the fit, and when nothing moved it sets the same numbers again.
   */
  once()
  requestAnimationFrame(() => requestAnimationFrame(once))
}

/* --------------------------------------------------------- publish page ---
 *
 * The design canvas and the publish view are not the same shape. The editor
 * keeps a header and a toolbar; the publish view covers them. On a 1920-wide
 * screen that is roughly 1902x731 against 1902x927 — so the same loop, fitted
 * uniformly to each, lands at a different size with different spare space.
 * That is where the bands down either side of the published loop came from.
 *
 * The studio's answer to this is the **publish page**: a rectangle of exactly
 * the publish area's shape, drawn as a dashed frame in Design. The loop is
 * drawn inside it, and publishing shows that page 1:1. What you arrange is
 * then what the plant sees, and a screen of another size scales the whole page
 * by one factor rather than re-fitting the drawing.
 *
 * Full HD, fixed, rather than the viewing machine's own screen: one plant, one
 * page size, so a loop drawn on somebody's laptop is the loop the control room
 * gets, only larger.
 */

/** The page every loop here is drawn for. `pageSize` subtracts the button bar. */
const PAGE_PRESET = 'fhd'

/**
 * Give the open document a publish page, unless that would hide part of it.
 *
 * Called after a document is restored. A loop already larger than the page is
 * left alone: `presentFit` shows the page and nothing outside it, so adopting
 * a page too small for the drawing would silently crop a plant's loop. Those
 * keep the old uniform fit until somebody rearranges them — which the studio's
 * own Publish page control and its "Move loop into page" button are for.
 *
 * Returns what it did, so the caller can say so.
 */
export function ensurePublishPage() {
  const doc = peek('DOC')
  const size = fn('pageSize')
  if (!doc || !size) return { set: false, reason: 'unavailable' }
  if (doc.page && doc.page.w && doc.page.h) return { set: false, reason: 'already' }

  const page = size(PAGE_PRESET)
  if (!page) return { set: false, reason: 'unavailable' }

  /*
   * Where to put it, and whether it fits.
   *
   * `bounds()` is the drawn extent of the loop. An empty canvas has none, so a
   * new loop gets the page at the origin and is drawn inside it from the
   * start — which is the case this is really for.
   */
  const blocks = doc.blocks || []
  let x = 0
  let y = 0
  if (blocks.length) {
    const extent = fn('bounds')?.()
    if (!extent) return { set: false, reason: 'unavailable' }
    const width = extent.x1 - extent.x0
    const height = extent.y1 - extent.y0
    if (width > page.w || height > page.h) {
      return { set: false, reason: 'too-large', width, height, page }
    }
    // Centre the page on the drawing, so an existing loop keeps its position
    // relative to the frame rather than being pushed into a corner.
    x = Math.round((extent.x0 + extent.x1) / 2 - page.w / 2)
    y = Math.round((extent.y0 + extent.y1) / 2 - page.h / 2)
  }

  /*
   * Written straight onto the document rather than through `setPage()`.
   *
   * That function pushes an undo entry and calls `changed()`, which would make
   * merely opening a loop look like an edit — and, for an operator, would mark
   * a document they are only allowed to read. The frame is drawn directly
   * instead; an administrator's next save stores it.
   */
  doc.page = { preset: PAGE_PRESET, w: page.w, h: page.h, x, y, n: page.n }
  fn('pageSync')?.()
  return { set: true, page: doc.page }
}

/**
 * Light unless somebody chose otherwise.
 *
 * With no stored preference the studio leaves `data-theme` unset and the
 * stylesheet follows the operating system — so a plant terminal set to dark
 * opens a dark HMI, which is not what this is for. Setting it explicitly makes
 * the default the same everywhere; the theme button still works and still
 * stores a choice, which this then leaves alone.
 */
export function defaultToLightTheme() {
  let chosen = null
  try {
    chosen = localStorage.getItem('sandman-theme')
  } catch {
    // Private windows and locked-down terminals throw on access; treat that
    // as "no preference" rather than failing the boot.
  }
  if (!chosen) document.documentElement.setAttribute('data-theme', 'light')
}

/**
 * Stop the studio keeping a copy in this browser.
 *
 * Designs live on the server here, so a copy in localStorage is a second,
 * older truth — and on a shared terminal it puts one person's draft in front
 * of the next person before they have signed in. `save` and `saveNow` are the
 * two functions the studio funnels every write through; replacing them keeps
 * the call sites working and sends the notification here instead.
 */
export function captureSaves(onChange) {
  for (const name of ['save', 'saveNow']) {
    const original = fn(name)
    if (!original) continue
    window[name] = function captured() {
      try {
        onChange()
      } catch (error) {
        console.error('Tracking a change failed:', error)
      }
      // The original is deliberately not called: it writes to localStorage.
    }
    window[name].original = original
  }
}

/**
 * The studio's own Save and Open, pointed at the server.
 *
 * The buttons stay where people expect them; only what they do changes. A
 * handler that throws is caught here rather than in the studio's click
 * dispatcher, where the failure would be silent.
 */
export function captureButtons({ onSave, onOpen }) {
  // The studio wires these with `.onclick`, so assigning over it replaces the
  // handler outright rather than running alongside it — which is what we want:
  // its Save keeps a copy in this browser, and ours is the only one that
  // reaches the plant.
  const wire = (id, handler) => {
    const button = document.getElementById(id)
    if (!button || !handler) return
    button.onclick = () => Promise.resolve(handler()).catch(error => toast(error.message))
  }
  wire('bSave', onSave)
  wire('bOpen', onOpen)
}

/**
 * Ctrl+S saves to the server.
 *
 * Captured on the window so it runs before the studio's own handler, which
 * would otherwise export a file — the one path that still quietly loses work.
 */
export function captureSaveShortcut(onSave) {
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    event.stopImmediatePropagation()
    Promise.resolve(onSave()).catch(error => toast(error.message))
  }, true)
}
