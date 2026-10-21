/**
 * A search box over a long list of tables.
 *
 * The foundry's database has a couple of hundred tables, and both places a
 * reading picks one — the Add reading flow and the Table box on a reading
 * card — are plain `<select>`s. Finding `adjustment_source` in two hundred
 * alphabetical entries means scrolling a dropdown with the mouse wheel and
 * hoping; typing the first letter jumps to the first match and no further.
 *
 * So a box sits above the list and narrows it. The `<select>` stays exactly
 * what it was — the studio reads its `value`, our code listens to its
 * `change`, and nothing else learns a new shape — and the options that do not
 * match are taken out of it while the search holds, then put back.
 *
 * The chosen option is never hidden, whatever the search says: a list that
 * drops what you already picked reads as if the choice were lost.
 */

/** Every option of a select, remembered before anything is filtered out. */
const remembered = new WeakMap()

/**
 * What the select holds right now, cheaply.
 *
 * The remembered list has to survive this module narrowing the select, and
 * has to be thrown away when somebody *else* refills it — picking a different
 * database refills the table list in place, and answering that search from
 * the old list would offer tables from the database before it. The signature
 * is of what is in the select, so our own narrowing matches what we recorded
 * and anybody else's write does not.
 */
const signature = select =>
  `${select.options.length}|${select.options[0]?.value ?? ''}|` +
  `${select.options[select.options.length - 1]?.value ?? ''}`

function optionsOf(select) {
  const held = remembered.get(select)
  if (held && held.stamp === signature(select)) return held.options

  const options = [...select.options].map(option => ({
    value: option.value,
    label: option.textContent,
    placeholder: !option.value,
  }))
  remembered.set(select, { options, stamp: signature(select) })
  return options
}

/** Rebuild the list from what was remembered, narrowed to the search. */
function narrow(select, text) {
  const all = optionsOf(select)
  const wanted = text.trim().toLowerCase()
  const chosen = select.value

  const keep = all.filter(option =>
    option.placeholder ||
    option.value === chosen ||
    !wanted ||
    option.label.toLowerCase().includes(wanted))

  select.innerHTML = keep.map(option =>
    `<option value="${option.value.replaceAll('"', '&quot;')}"${
      option.value === chosen ? ' selected' : ''
    }>${option.label.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</option>`
  ).join('')
  select.value = chosen

  // Our own narrowing is not a refill: record what the select now looks like
  // against the full list, so the next read does not start over.
  remembered.set(select, { options: all, stamp: signature(select) })

  return keep.filter(option => !option.placeholder).length
}

/**
 * Put a search box above a select, if it is long enough to need one.
 *
 * Under a dozen tables a search box is furniture: the list is already one
 * glance. The count is of the options as they were, not as they are narrowed,
 * so the box does not come and go as somebody types.
 */
export function searchable(select, { least = 12, label = 'Search tables' } = {}) {
  if (!select || select.dataset.dlSearchable) return
  const all = optionsOf(select)
  if (all.filter(option => !option.placeholder).length < least) return
  select.dataset.dlSearchable = '1'

  const box = document.createElement('div')
  box.className = 'dl-table-search'
  box.innerHTML =
    `<input type="search" class="dl-table-search-text" placeholder="${label}" ` +
    'autocomplete="off" spellcheck="false">' +
    '<span class="note dl-table-search-count"></span>'

  select.before(box)
  const field = box.querySelector('.dl-table-search-text')
  const count = box.querySelector('.dl-table-search-count')

  const run = () => {
    const showing = narrow(select, field.value)
    const total = all.filter(option => !option.placeholder).length
    count.textContent = field.value.trim() ? `${showing} of ${total}` : `${total} tables`
  }

  field.oninput = run
  field.onkeydown = event => {
    // Enter picks the only match, which is what somebody typing a name wants.
    if (event.key !== 'Enter') return
    event.preventDefault()
    const matches = [...select.options].filter(option => option.value)
    if (matches.length === 1) {
      select.value = matches[0].value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
  run()
}
