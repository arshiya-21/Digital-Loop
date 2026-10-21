/**
 * SandMan's own card off the Data sources page.
 *
 * The page lists the places a reading can come from, and the studio puts its
 * "Customer default database" at the top of that list: the foundry database
 * named in the launch, printed with its type, host and database name, a Test
 * connection button beside it and "🔒 Managed by Sandman" underneath.
 *
 * It is the one card on the page that should not be there:
 *
 *   it is not a source to manage   SandMan chose it and SandMan reads it. The
 *                                  card offers nothing to do — no Edit, no
 *                                  Delete — on a row that cannot be changed.
 *   the host is not ours to print  those are SandMan's connection details,
 *                                  shown in a browser panel to somebody who
 *                                  cannot act on them and should not need to.
 *   Test connection lies           it tests the studio's simulated gateway,
 *                                  not SandMan. An answer that means nothing
 *                                  is worse than no button.
 *
 * Everything else on the page stays exactly as it is — the registered
 * databases with their Edit, Test and Delete, and ＋ Add data source, which
 * opens our own form with its host, account, password and SSH tunnel. Readings
 * can still be linked to the foundry's database: that choice lives in the
 * inspector and in the linking wizard, where it is a choice rather than a card
 * pretending to be manageable.
 *
 * The note at the foot of the page goes too. It describes a credential
 * reference resolved by a gateway service that is not part of this, and
 * promises that "values stay simulated" — which is false on this page: a
 * registered database here is dialled for real.
 */

function rewrite() {
  const box = document.getElementById('mbox')
  const grid = box?.querySelector('.src-g')
  if (!grid || grid.dataset.dlNoCustomerCard) return
  grid.dataset.dlNoCustomerCard = '1'

  // SandMan's card, and only that one. The studio marks it `cust-src`.
  grid.querySelector('.src.cust-src')?.remove()

  for (const note of box.querySelectorAll(':scope > .note')) {
    if (/credential reference|sample catalogue|stay simulated/i.test(note.textContent)) {
      note.remove()
    }
  }
}

export function install() {
  const original = window.sourcesForm
  if (typeof original !== 'function' || original.__dlNoCustomerCard) return

  const replaced = function sourcesFormWithoutSandmansCard(...args) {
    const result = original.apply(this, args)
    try {
      rewrite()
    } catch (error) {
      // The studio's own page is still there; only the tidying is missing.
      console.error('Tidying the data sources page failed:', error)
    }
    return result
  }

  replaced.__dlNoCustomerCard = true
  replaced.original = original
  window.sourcesForm = replaced
}
