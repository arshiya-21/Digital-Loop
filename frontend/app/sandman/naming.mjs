import { peek } from './studio.mjs'
import { recordFor } from './live.mjs'

/**
 * What a reading is called, as opposed to where it comes from.
 *
 * A reading has three names and they are not the same thing:
 *
 *   the tag id      `BEN-BIN.ADDITIVE` — the key the document, the server
 *                   index and every stored version are keyed on. Never
 *                   changed by anything here.
 *   the link        `munjalkiriu_sand.adjustment.additive` — where the number
 *                   is read from. Also untouched: renaming a reading must not
 *                   move it.
 *   the display name  what the plant calls it. "Bentonite bin level", not
 *                   `ADDITIVE`.
 *
 * The studio keeps the display name in `desc` and shows it in the inspector,
 * the tag table, the trend window and the CSV export — but the label on the
 * canvas is built from `short || <last part of the tag id>`, so a reading made
 * from a column was captioned with that column's name in capitals however it
 * had been named. This puts the display name on the canvas too, and says
 * underneath the name where the number actually comes from, which is the thing
 * the name no longer tells you.
 *
 * Nothing here writes to the document: the canvas label is computed, and the
 * inspector's own field is the one that stores a name.
 */

const fn = name => (typeof window[name] === 'function' ? window[name] : null)

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/**
 * What a reading is showing now, or null when it is not being read.
 *
 * `tagTxt` is the studio's own formatter — value, decimals and unit, or the
 * text of a text reading — so a badge in Design says exactly what the same
 * badge says in Publish. Null for a reading with no record: a simulated
 * number dressed as a plant value is the one thing worse than no value, and
 * `recordFor` is what knows the difference.
 */
function readingNow(id) {
  if (!id || !recordFor(id)) return null
  const text = fn('tagTxt')?.(id)
  return typeof text === 'string' && text.trim() && text.trim() !== '—' ? text : null
}

/** The display name of a reading, falling back the way the studio does. */
export function displayName(tag, id) {
  const named = typeof tag?.desc === 'string' ? tag.desc.trim() : ''
  if (named) return named
  const short = typeof tag?.short === 'string' ? tag.short.trim() : ''
  if (short) return short
  return String(id || tag?.id || '').split('.').pop()
}

/** Where a reading reads from, in one line, or '' for one that is simulated. */
export function sourceOf(tag) {
  const link = tag?.link
  if (!link) return ''
  if (link.sql) return 'a query of its own'
  if (!link.table || !link.col) return ''
  return [link.db, link.table, link.col].filter(Boolean).join('.')
}

/**
 * The canvas label, from the display name.
 *
 * `tagLayout` decides what each badge says: a key and a value, sized to fit.
 * Wrapping it rather than editing the drawing means the badge, its background,
 * the drag handles and the leader lines all stay the studio's own — only the
 * text changes, and the width with it so a longer name is not clipped.
 *
 * A `short` set by hand still wins. That field exists precisely to keep a long
 * name off a crowded canvas, and taking it away to force the display name
 * everywhere would be this feature overruling a decision somebody already
 * made.
 */
function nameOnTheCanvas() {
  const original = fn('tagLayout')
  if (!original || original.__dlNamed) return

  const replaced = function tagLayoutWithDisplayNames(block) {
    const laid = original.call(this, block)
    if (!Array.isArray(laid)) return laid

    const style = peek('DOC')?.tagStyle === 'card'
    const size = (peek('PREF')?.ts || 1) * (style ? 1.32 : 1)
    const perCharacter = (style ? 7.1 : 6.7) * size

    for (const label of laid) {
      if (!label) continue

      /*
       * The plant's number, in Design as well.
       *
       * The studio shows a reading's value only in monitor mode; in Design a
       * badge shows the unit instead — "%" where the loop is being drawn, the
       * value once it is published. That made "is this reading working?" a
       * question you could only answer by leaving the mode you were in. A
       * reading that is being read shows what it reads, in every mode; one
       * that has no record yet still shows its unit, which is what Design
       * had.
       */
      const value = readingNow(label.t?.id)
      if (value !== null) label.txt = value

      // An instrument draws its value alone — there is no key to replace.
      if (!label.k) continue

      const named = displayName(label.t, label.t?.id)
      if (named && named !== label.k) label.k = named

      label.w = Math.max(
        56, (String(label.k).length + String(label.txt ?? '').length + 1) * perCharacter + 12)
    }
    return laid
  }

  replaced.__dlNamed = true
  replaced.original = original
  window.tagLayout = replaced
}

/**
 * The hover card: the name, the tag id, and where the number comes from.
 *
 * The studio's own tooltip is `<id> · <desc> — drag to move this label…`. With
 * the name now on the badge, the useful second line is the source: a reading
 * called "Bentonite bin level" says nothing about which column it reads, and
 * that is the first thing anybody checks when the number looks wrong.
 *
 * Done to the drawn SVG rather than to the markup, because the markup is a
 * template literal in the studio's own renderer. `renderCanvas` is wrapped so
 * every redraw gets it.
 */
function sayWhereItCameFrom() {
  /*
   * Both renderers, because either can rebuild the badges.
   *
   * `renderCanvas` draws the whole drawing; `liveCanvas` redraws the value
   * badges alone, which is what runs on every poll. Wrapping only the first
   * meant the hover text was right until the next value arrived and then
   * silently went back to the studio's own.
   */
  for (const name of ['renderCanvas', 'liveCanvas']) {
    const original = fn(name)
    if (!original || original.__dlNamed) continue

    const replaced = function rendererThenSources(...args) {
      const result = original.apply(this, args)
      try {
        tellEachBadge()
      } catch (error) {
        // The canvas is drawn either way; only the tooltips are missing.
        console.error('Labelling the readings failed:', error)
      }
      return result
    }

    replaced.__dlNamed = true
    replaced.original = original
    window[name] = replaced
  }
}

function tellEachBadge() {
  const readings = peek('REG')
  if (!readings) return

  for (const badge of document.querySelectorAll('#Ltags [data-tag]')) {
    const id = badge.dataset.tag
    const tag = readings[id]
    const title = badge.querySelector('title')
    if (!tag || !title) continue

    const from = sourceOf(tag)
    const name = displayName(tag, id)
    title.textContent =
      `${name} · ${id}${from ? ` · reads ${from}` : ''}` +
      ' — drag to move this label, double-click for the trend'
  }
}

/**
 * In the inspector: call the field what it is, and say what it is not.
 *
 * The studio labels it "Parameter", which is the word for the quantity rather
 * than for the caption. And once a reading is called "Bentonite bin level",
 * nothing on that card says it reads `adjustment.additive` — so the source
 * goes underneath it, as plain text, where a name alone would otherwise be the
 * whole story.
 *
 * Read-only outside Design, because the studio's own field is: this adds a
 * label and a line of text and leaves who-may-edit where it was.
 */
function callItADisplayName(card, tag, id) {
  const field = card.querySelector('[data-ix="desc"]')?.closest('.ix-f')
  if (!field) return

  // The label is the text node before the input, which is how the studio
  // writes its fields: `<label class="ix-f">Parameter<input …></label>`.
  for (const node of field.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && /parameter/i.test(node.textContent)) {
      node.textContent = 'Display name'
    }
  }

  const from = sourceOf(tag)
  let says = field.nextElementSibling?.classList?.contains('dl-reads-from')
    ? field.nextElementSibling
    : null

  if (!from) {
    says?.remove()
    return
  }

  if (!says) {
    says = document.createElement('p')
    says.className = 'note dl-reads-from'
    field.after(says)
  }
  says.innerHTML =
    `Reads <span class="mono">${escapeHtml(from)}</span> · tag <span class="mono">${escapeHtml(id)}</span>` +
    '<br>Renaming changes what is shown, not what is read.'
}

/** Every reading card in the panel, after the studio has drawn it. */
function nameTheReadings() {
  const original = fn('renderProps')
  if (!original || original.__dlNamed) return

  const replaced = function renderPropsWithDisplayNames(...args) {
    const result = original.apply(this, args)
    try {
      const readings = peek('REG') || {}
      for (const card of document.querySelectorAll('.ix-card[data-tid]')) {
        const tag = readings[card.dataset.tid]
        if (tag) callItADisplayName(card, tag, card.dataset.tid)
      }
    } catch (error) {
      console.error('Naming the readings in the panel failed:', error)
    }
    return result
  }

  replaced.__dlNamed = true
  replaced.original = original
  window.renderProps = replaced
}

/**
 * And in the tag table, where a loop's readings are edited in bulk.
 *
 * The same column, under the same word as everywhere else.
 */
function nameTheColumn() {
  const original = fn('renderDock')
  if (!original || original.__dlNamed) return

  const replaced = function renderDockWithDisplayNames(...args) {
    const result = original.apply(this, args)
    try {
      for (const heading of document.querySelectorAll('.dock th, #dock th')) {
        if (/^description$/i.test(heading.textContent.trim())) heading.textContent = 'Display name'
      }
    } catch { /* the table is the studio's; a heading is not worth throwing over */ }
    return result
  }

  replaced.__dlNamed = true
  replaced.original = original
  window.renderDock = replaced
}

/** Wrap once, at boot. Safe to call again. */
export function install() {
  nameOnTheCanvas()
  sayWhereItCameFrom()
  nameTheReadings()
  nameTheColumn()
}

/** For the tests, and for looking at this from a console. */
export const status = () => {
  const readings = peek('REG') || {}
  return Object.fromEntries(
    Object.entries(readings).map(([id, tag]) =>
      [id, { name: displayName(tag, id), reads: sourceOf(tag) }])
  )
}
