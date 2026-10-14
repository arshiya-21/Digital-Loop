/**
 * One data connection in Properties, not two.
 *
 * The studio's equipment panel ships two separate places to connect a reading
 * to data, and a third section listing the readings themselves:
 *
 *   Data connection   "Tags from a database"  — Database → Table → Column
 *                     "Live source for the whole equipment" — pick a source,
 *                     type a data tag, press *Map readings*
 *   Readings          ＋ Add reading, then a card per reading
 *
 * Two of those do the same job by different means, and the second one — typing
 * an address and mapping every reading onto it at once — belongs to a world
 * where a gateway resolves the address. Here a reading is linked to a column
 * in a named database, which is exactly what the first flow does.
 *
 * So this leaves one section: **Database connection**, with *＋ Add reading*
 * under it, the Database → Table → Column flow revealed when that is pressed,
 * and the readings listed underneath.
 *
 * ## Why it is done to the DOM
 *
 * The markup belongs to `15-inspector.js`, which is vendored and replaced
 * wholesale on every drop — v9.40 rewrote it. Overriding `eqInspector` would
 * mean owning a copy of several hundred lines of somebody else's markup and
 * re-copying it every release. Moving the rendered nodes instead keeps the
 * studio's own handlers attached (they are bound to the elements, so a node
 * that moves takes its wiring with it) and leaves us with a dozen lines that
 * fail visibly rather than silently if the panel is restructured again.
 */

/** Re-applied after every render, so it has to be safe to run repeatedly. */
const DONE = 'dlOneConnection'

/** The section whose heading starts with this text. */
function sectionTitled(root, text) {
  for (const section of root.querySelectorAll('section.ix-sec')) {
    const heading = section.querySelector('h4')
    if (heading && heading.textContent.trim().startsWith(text)) return section
  }
  return null
}

/**
 * Everything from a sub-heading to the end of its section.
 *
 * The panel is flat — `<h5>` then the fields that belong to it, as siblings —
 * so a sub-section is "this heading and everything after it", which is what
 * removing one means.
 */
function fromSubheadingToEnd(section, text) {
  const heading = [...section.querySelectorAll('h5.ix-sub')]
    .find(node => node.textContent.trim().startsWith(text))
  if (!heading) return []

  const out = [heading]
  let next = heading.nextElementSibling
  while (next) {
    out.push(next)
    next = next.nextElementSibling
  }
  return out
}

function restructure() {
  const root = document.getElementById('props')
  if (!root) return

  const connection = sectionTitled(root, 'Data connection')
  const readings = sectionTitled(root, 'Readings')
  if (!connection) return

  /*
   * The second way of connecting goes.
   *
   * "Map readings" fills every reading's data tag from one address and links
   * them all to a source — which, now that a reading means a column in a named
   * database, would produce a panel full of readings linked to nothing
   * resolvable. The Database → Table → Column flow is the one that works.
   */
  for (const node of fromSubheadingToEnd(connection, 'Live source for the whole equipment')) {
    node.remove()
  }

  // With one flow left, its sub-heading says nothing the section's own does not.
  for (const node of connection.querySelectorAll('h5.ix-sub')) {
    if (node.textContent.trim().startsWith('Tags from a database')) node.remove()
  }

  const heading = connection.querySelector('h4')
  if (heading) heading.childNodes[0].nodeValue = 'Database connection '

  /*
   * The flow itself is put away until somebody asks for a reading.
   *
   * It is three dropdowns and a button, and on an item that already has its
   * readings it is the first thing in the way. `#dbFlow` is the studio's own
   * container for it; `#ixAdd` is its search-and-create box, which is the
   * other way to add one and belongs in the same place rather than in a
   * section of its own.
   */
  let drawer = connection.querySelector('#dlAddDrawer')
  if (!drawer) {
    drawer = document.createElement('div')
    drawer.id = 'dlAddDrawer'
    drawer.className = 'dl-add-drawer'
    drawer.hidden = true
  }

  const flow = root.querySelector('#dbFlow')
  if (flow && flow.parentElement !== drawer) drawer.append(flow)

  const search = root.querySelector('#ixAdd')
  if (search && search.parentElement !== drawer) {
    // The studio hides this until its own button is pressed. The drawer is
    // what hides things now, so inside it this is always shown.
    search.hidden = false
    drawer.append(search)
  }

  /*
   * The button moves to the one section, and opens the drawer rather than the
   * studio's search box. Its own handler is replaced rather than removed: the
   * studio set `.onclick` directly, so assigning over it is the whole of it.
   */
  let button = root.querySelector('#ixAddBtn')
  if (button && !button.dataset[DONE]) {
    button.dataset[DONE] = '1'
    button.onclick = () => {
      drawer.hidden = !drawer.hidden
      button.textContent = drawer.hidden ? '＋ Add reading' : '✕ Close'
      if (!drawer.hidden) drawer.querySelector('select, input')?.focus()
    }
  }
  if (button && heading && button.parentElement !== heading) heading.append(button)

  /*
   * The readings themselves, into the same section — which is the whole point:
   * what an item reads and where it reads it from are one subject, and having
   * them in two sections meant scrolling between them to answer one question.
   */
  if (readings) {
    for (const card of readings.querySelectorAll('.ix-card')) connection.append(card)
    for (const hint of readings.querySelectorAll('p.ix-hint')) connection.append(hint)
    readings.remove()
  }

  /*
   * The drawer sits directly under the heading and its button, not at the
   * foot of the section.
   *
   * Pressing ＋ Add reading has to put the next thing to do where the eye
   * already is. Appending it below the readings meant the dropdown opened off
   * the bottom of a panel with a dozen cards in it — the button appeared to do
   * nothing at all unless you thought to scroll.
   */
  if (heading) heading.after(drawer)
  else connection.prepend(drawer)
}

/**
 * Run after every properties render.
 *
 * `renderProps` rebuilds the panel from scratch — on selection, on a change,
 * and when the database's tables arrive — so this has to run each time rather
 * than once.
 */
export function install() {
  const original = window.renderProps
  if (typeof original !== 'function' || original.__dlOneConnection) return

  const replaced = function renderPropsWithOneConnection(...args) {
    const result = original.apply(this, args)
    try {
      restructure()
    } catch (error) {
      // A panel that failed to restructure is still the studio's own working
      // panel. Losing the tidying is not a reason to lose Properties.
      console.error('Rearranging the properties panel failed:', error)
    }
    return result
  }

  replaced.__dlOneConnection = true
  replaced.original = original
  window.renderProps = replaced
}
