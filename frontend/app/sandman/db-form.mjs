/**
 * The external database form — a real one.
 *
 * The studio's "Add data source" dialog was written to demonstrate the editor
 * without a plant behind it, and it shows:
 *
 *   Default database     a dropdown of invented database names (`SQL_SCHEMA`)
 *   Credential reference `gateway-vault:name` — a string for a service that
 *                        does not exist here, and no password field at all
 *   Test connection      a timer, then "Reachable (simulated) · 23 ms ·
 *                        N tables found" where N counts the invented catalogue
 *
 * None of that can register a database. This replaces it with the fields a
 * database actually needs — name, address, port, database, user, password —
 * saves them through `/connections`, and reports what the server found when it
 * connected: the real table count, read live, from the real schema.
 *
 * Databases that are only reachable through a jump box get the five settings
 * the plant gateway already uses for the same job: SSH host, SSH port, SSH
 * username, private key and key passphrase.
 *
 * **Test stores nothing.** It posts what is on screen to an endpoint that
 * tries it and discards it. Only Save writes.
 *
 * ## What is deliberately not here
 *
 * **No list of databases to pick from.** The studio offered one built from its
 * own fixtures, so every plant was shown the same four invented names. A
 * database name is typed, because only the person connecting knows it.
 *
 * **No poll interval, timeout or credential reference.** Readings are polled
 * on the service's own thirty-second cycle, the timeout is the service's, and
 * the password is sealed on the server. Three fields that looked like settings
 * and changed nothing.
 *
 * The engine *is* still chosen, because the server needs it to know which
 * driver to use, and MySQL, PostgreSQL, SQL Server and Azure SQL were asked
 * for. It is a type, not a list of databases.
 *
 * ## Why these are replaced rather than rearranged
 *
 * `properties.mjs` and `equipment.mjs` move the studio's own nodes about
 * because its markup is right and only its arrangement is wrong. Here the
 * markup is wrong: the fields describe a different system. So `sourceEdit` and
 * `testSource` are replaced outright — forty lines of ours instead of a copy
 * of forty lines of theirs — and `sourcesForm` is left alone and only filled
 * in afterwards.
 */
import { connectionApi } from './api.mjs'
import { connectionIdFrom, load as reloadDatabases } from './databases.mjs'

const esc = value =>
  String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/**
 * The engines, from the server.
 *
 * Fetched rather than written out here so there is one list: the server
 * validates against `ENGINE_CATALOGUE` and would reject anything this file
 * invented on its own.
 */
let engines = null
async function engineList() {
  if (engines) return engines
  try {
    const answer = await connectionApi.engines()
    engines = Array.isArray(answer?.engines) ? answer.engines : []
  } catch {
    // An operator cannot read it, and neither can a browser that lost its
    // session. One sensible default beats an empty dropdown.
    engines = [{ id: 'mysql', label: 'MySQL', port: 3306 }]
  }
  return engines
}

/** connectionId → table count, so a list of six does not fetch six times over. */
const counts = new Map()

async function tableCount(connectionId) {
  if (counts.has(connectionId)) return counts.get(connectionId)
  try {
    const schema = await connectionApi.schema(connectionId)
    const count = Number(schema?.tableCount)
    counts.set(connectionId, Number.isInteger(count) ? count : null)
  } catch {
    counts.set(connectionId, null)
  }
  return counts.get(connectionId)
}

/** Forget what was counted, because the thing counted may have changed. */
const forget = connectionId => counts.delete(connectionId)

/* ------------------------------------------------------------------ the form ---*/

const FIELDS = [
  ['dlDbName', 'Name', 'text', 'Plant database'],
  ['dlDbHost', 'URL', 'text', 'db.plant.local'],
  ['dlDbPort', 'Port', 'number', ''],
  ['dlDbBase', 'Database', 'text', 'Database name'],
  ['dlDbUser', 'User', 'text', 'Username'],
  ['dlDbPass', 'Password', 'password', ''],
]

/**
 * The SSH tunnel, in the same terms as the gateway.
 *
 * `AIW/config/config.json` names these `ssh_host`, `ssh_port`, `ssh_username`
 * and `ssh_private_key_path`, and `production_booking.py` reads one more that
 * the example file leaves out — `ssh_private_key_password`. All five are here,
 * under the names somebody who has set up that gateway will recognise.
 *
 * The key is pasted rather than pointed at: a path on a plant engineer's
 * laptop means nothing to a service that dials out from somewhere else.
 */
const TUNNEL_FIELDS = [
  ['dlDbSshHost', 'SSH host', 'text', '3.7.49.62'],
  ['dlDbSshPort', 'SSH port', 'number', ''],
  ['dlDbSshUser', 'SSH username', 'text', 'rds-tunnel'],
]

function formMarkup(draft, list, editing) {
  const row = (id, label, type, placeholder) => {
    // One placeholder attribute, chosen here. Writing a second one conditionally
    // would be ignored: a repeated attribute keeps its first value, so the hint
    // would never appear.
    const hint = type === 'password' && editing
      ? 'Leave blank to keep the current password'
      : placeholder
    /*
     * `new-password` on every secret, and `off` elsewhere.
     *
     * Without it Chrome treats any `type="password"` as a login box: it offers
     * saved passwords for this origin and fills them in, so a form for one
     * plant can arrive showing a credential belonging to another. `off` alone
     * is ignored on password fields; `new-password` is the one browsers honour.
     */
    const auto = type === 'password' ? 'new-password' : 'off'
    return `
    <div class="fld">
      <label for="${id}">${label}</label>
      <input id="${id}" type="${type}" ${type === 'text' ? 'class="mono"' : ''}
             value="${esc(draft[id] ?? '')}"
             placeholder="${esc(hint)}"
             autocomplete="${auto}" spellcheck="false">
    </div>`
  }

  const tunnelOn = !!draft.dlDbSsh

  return `<h3>${editing ? 'Edit' : 'Add'} database</h3>
    <div class="row2" style="margin-top:10px">
      ${row(...FIELDS[0])}
      <div class="fld"><label for="dlDbEngine">Type</label>
        <select id="dlDbEngine">${
          list.map(engine =>
            `<option value="${esc(engine.id)}" data-port="${engine.port}" ${
              engine.id === draft.dlDbEngine ? 'selected' : ''
            }>${esc(engine.label)}</option>`
          ).join('')
        }</select>
      </div>
    </div>
    <div class="row2">${row(...FIELDS[1])}${row(...FIELDS[2])}</div>
    <div class="row2">${row(...FIELDS[3])}${row(...FIELDS[4])}</div>
    <div class="row2">${row(...FIELDS[5])}<div></div></div>

    <label class="chk" id="dlDbSshToggleRow">
      <input type="checkbox" id="dlDbSsh" ${tunnelOn ? 'checked' : ''}>
      Connect through an SSH tunnel
    </label>
    <div id="dlDbSshBox" ${tunnelOn ? '' : 'hidden'}>
      <div class="row2">${row(...TUNNEL_FIELDS[0])}${row(...TUNNEL_FIELDS[1])}</div>
      <div class="row2">${row(...TUNNEL_FIELDS[2])}${row('dlDbSshPhrase', 'Key passphrase', 'password', '')}</div>
      <div class="fld">
        <label for="dlDbSshKey">Private key</label>
        <textarea id="dlDbSshKey" rows="3" class="mono" spellcheck="false"
                  autocomplete="off"
                  placeholder="${
                    draft.dlDbSshHasKey
                      ? 'A key is stored — paste a new one to replace it'
                      : '-----BEGIN OPENSSH PRIVATE KEY-----'
                  }"></textarea>
      </div>
    </div>

    <p class="note" id="dlDbSays"></p>
    <div class="mact">
      <button class="ib" id="dlDbBack">Back</button>
      <button class="ib" id="dlDbTest">Test connection</button>
      <button class="ib pri" id="dlDbSave">Save</button>
    </div>`
}

/**
 * Add or edit one database.
 *
 * `id` is the studio's source id, which for anything of ours is `conn_<id>` —
 * `connectionIdFrom` is what turns it back into the connection it names.
 */
async function openForm(sourceId, back) {
  const connectionId = connectionIdFrom(sourceId)
  const editing = !!connectionId
  const list = await engineList()

  const draft = {
    dlDbName: '', dlDbHost: '', dlDbPort: list[0]?.port ?? 3306,
    dlDbBase: '', dlDbUser: '', dlDbPass: '', dlDbEngine: list[0]?.id ?? 'mysql',
    dlDbSsh: false, dlDbSshHost: '', dlDbSshPort: 22, dlDbSshUser: '',
    dlDbSshPhrase: '', dlDbSshHasKey: false,
  }

  if (editing) {
    try {
      const existing = await connectionApi.list()
      const row = (Array.isArray(existing) ? existing : []).find(item => item.id === connectionId)
      if (row) {
        Object.assign(draft, {
          dlDbName: row.label, dlDbHost: row.host, dlDbPort: row.port,
          dlDbBase: row.database, dlDbUser: row.username, dlDbEngine: row.engine,
        })
        // The secrets are not in `publicShape` and never will be; what comes
        // back says only whether they are set, which is what the form shows.
        if (row.tunnel) {
          Object.assign(draft, {
            dlDbSsh: true,
            dlDbSshHost: row.tunnel.host || '',
            dlDbSshPort: row.tunnel.port || 22,
            dlDbSshUser: row.tunnel.user || '',
            dlDbSshHasKey: !!row.tunnel.hasKey,
          })
        }
      }
    } catch { /* shown as an empty form, which is recoverable */ }
  }

  window.openModal?.(formMarkup(draft, list, editing))

  const box = document.getElementById('mbox')
  if (!box) return
  const at = id => box.querySelector(`#${id}`)
  const says = at('dlDbSays')
  const tell = (text, tone = '') => { if (says) says.innerHTML = `<span class="${tone}">${esc(text)}</span>` }

  // Typing a port is almost always unnecessary, so changing the type fills in
  // the one that engine listens on — unless a port was already typed.
  const engineSelect = at('dlDbEngine')
  let portTouched = false
  at('dlDbPort').oninput = () => { portTouched = true }
  engineSelect.onchange = () => {
    if (portTouched) return
    const option = engineSelect.selectedOptions[0]
    if (option?.dataset.port) at('dlDbPort').value = option.dataset.port
  }

  // The tunnel fields only when the tunnel is wanted.
  const sshToggle = at('dlDbSsh')
  const sshBox = at('dlDbSshBox')
  sshToggle.onchange = () => { sshBox.hidden = !sshToggle.checked }

  const read = () => {
    const body = {
      label: at('dlDbName').value.trim(),
      engine: engineSelect.value,
      host: at('dlDbHost').value.trim(),
      port: Number(at('dlDbPort').value) || undefined,
      database: at('dlDbBase').value.trim(),
      username: at('dlDbUser').value.trim(),
    }

    const password = at('dlDbPass').value
    // Absent means "leave it" when editing; on a new one it is simply sent.
    if (password || !editing) body.password = password

    /*
     * `tunnel: null` is how the server is told to forget one, so the unchecked
     * box has to send that rather than nothing — sending nothing would leave a
     * tunnel configured on a connection whose box is now clear.
     */
    if (!sshToggle.checked) {
      body.tunnel = null
      return body
    }

    body.tunnel = {
      host: at('dlDbSshHost').value.trim(),
      port: Number(at('dlDbSshPort').value) || 22,
      user: at('dlDbSshUser').value.trim(),
    }
    const key = at('dlDbSshKey').value
    if (key.trim()) body.tunnel.privateKey = key
    // A passphrase typed is a passphrase meant; one left blank on an edit
    // leaves whatever is stored, the same rule the password follows.
    const phrase = at('dlDbSshPhrase').value
    if (phrase || !editing) body.tunnel.passphrase = phrase
    return body
  }

  /** The first thing left blank, in the words on its own label. */
  const missing = (body, forSaving) => {
    const wanted = [['host', 'URL'], ['database', 'Database'], ['username', 'User']]
    if (forSaving) wanted.unshift(['label', 'Name'])
    for (const [key, label] of wanted) if (!body[key]) return label

    if (body.tunnel) {
      if (!body.tunnel.host) return 'SSH host'
      if (!body.tunnel.user) return 'SSH username'
      // Without a key there is nothing to authenticate with, and the failure
      // otherwise arrives much later as a refused handshake.
      if (!body.tunnel.privateKey && !draft.dlDbSshHasKey) return 'Private key'
    }
    return null
  }

  at('dlDbBack').onclick = () => window.sourcesForm?.(back)

  /*
   * Test stores nothing.
   *
   * It posts what is on screen to an endpoint that tries it and throws it
   * away. Pressing Test is not a decision to keep these settings — it is how
   * somebody finds out whether to — so saving first would leave a half-right
   * connection behind every time a host was mistyped.
   *
   * When an existing connection is being edited, `use` lets the server borrow
   * the stored password or key for fields left blank. The secret still never
   * leaves the server in either direction.
   */
  at('dlDbTest').onclick = async () => {
    const body = read()
    const absent = missing(body, false)
    if (absent) { tell(`${absent} is required`, 'tx3'); return }

    tell('Connecting…', 'tx1')
    try {
      const result = await connectionApi.try(editing ? { ...body, use: connectionId } : body)
      if (!result?.ok) {
        tell(`Could not connect — ${result?.error || 'no reason given'}`, 'tx3')
        return
      }
      const count = result.tableCount
      tell(
        count === null || count === undefined
          ? 'Connected, but its tables could not be listed'
          : `Connected · ${count} table${count === 1 ? '' : 's'} found`,
        count === null || count === undefined ? 'tx2' : 'tx0'
      )
    } catch (error) {
      tell(error?.message || 'Could not reach it', 'tx3')
    }
  }

  at('dlDbSave').onclick = async () => {
    const body = read()
    const absent = missing(body, true)
    if (absent) { tell(`${absent} is required`, 'tx3'); return }

    tell('Saving…', 'tx1')
    try {
      const saved = editing
        ? await connectionApi.update(connectionId, body)
        : await connectionApi.create(body)
      forget(saved.id)
      await reloadDatabases()
      window.toast?.(`${saved.label} saved`)
      window.sourcesForm?.(back)
    } catch (error) {
      tell(error?.message || 'That could not be saved', 'tx3')
    }
  }
}

/** Reach it, then count what is in it. Both from the server, neither invented. */
async function report(connectionId, tell) {
  tell('Connecting…', 'tx1')
  let result
  try {
    result = await connectionApi.test(connectionId)
  } catch (error) {
    tell(error?.message || 'Could not reach it', 'tx3')
    return
  }
  if (!result?.ok) {
    tell(`Could not connect — ${result?.error || 'no reason given'}`, 'tx3')
    return
  }

  forget(connectionId)
  const count = await tableCount(connectionId)
  tell(
    count === null
      ? 'Connected, but its tables could not be listed'
      : `Connected · ${count} table${count === 1 ? '' : 's'} found`,
    count === null ? 'tx2' : 'tx0'
  )
}

/* ------------------------------------------------------------- the list page ---*/

/**
 * Put the real table count on each card, and make Delete delete.
 *
 * The studio's card says "N tag(s) linked · poll every 5s". The poll interval
 * is not ours to set and means nothing here, so it is replaced by the count of
 * tables the database actually has — which is the thing somebody is looking
 * for when they open this page.
 */
/**
 * Whether a connection goes through a jump box, for its card.
 *
 * A tunnel is the part of a connection that explains the others: why the host
 * is a private address, why the database answers from here and nowhere else.
 * It was configured in the form and then invisible everywhere afterwards, so
 * the only way to know was to open the form again.
 *
 * One request per time the panel is drawn, shared by every card on it.
 */
let listOnce = null

function tunnelOf(connectionId) {
  if (!listOnce) listOnce = connectionApi.list().catch(() => [])
  return listOnce.then(rows =>
    (Array.isArray(rows) ? rows : []).find(row => row.id === connectionId)?.tunnel || null)
}

function fillInList() {
  // Drawn again means asked again: a tunnel may have just been added.
  listOnce = null

  const box = document.getElementById('mbox')
  if (!box) return

  for (const button of box.querySelectorAll('[data-se]')) {
    const connectionId = connectionIdFrom(button.dataset.se)
    if (!connectionId) continue

    const card = button.closest('.src')
    const note = card?.querySelector(':scope > .note')
    if (!note || note.dataset.dlCounted) continue
    note.dataset.dlCounted = '1'

    const linked = (note.textContent.split('·')[0] || '').trim()
    note.textContent = `${linked} · counting tables…`
    Promise.all([tableCount(connectionId), tunnelOf(connectionId)]).then(([count, tunnel]) => {
      note.textContent = `${linked} · ${
        count === null ? 'tables unavailable' : `${count} table${count === 1 ? '' : 's'}`
      }${tunnel ? ` · through ${tunnel.user}@${tunnel.host}` : ''}`
    })
  }

  /*
   * Delete, on the server.
   *
   * The studio's own handler removes the source from `DOC.sources` — the
   * flowsheet's copy — which for a registered database does nothing at all:
   * the list comes from `/connections`, so it would reappear on the next
   * render and look like a delete that silently failed.
   */
  for (const button of box.querySelectorAll('[data-sd]')) {
    const connectionId = connectionIdFrom(button.dataset.sd)
    if (!connectionId || button.dataset.dlDelete) continue
    button.dataset.dlDelete = '1'

    button.onclick = async () => {
      const name = button.closest('.src')?.querySelector('b')?.textContent || 'this database'
      if (!window.confirm(`Remove ${name}? Readings linked to it will stop updating.`)) return
      try {
        await connectionApi.remove(connectionId)
        forget(connectionId)
        await reloadDatabases()
        window.toast?.(`${name} removed`)
        window.sourcesForm?.()
      } catch (error) {
        window.toast?.(error?.message || 'That could not be removed')
      }
    }
  }
}

/* --------------------------------------------------------------------- install ---*/

export function install() {
  /* The form itself, replaced. */
  if (typeof window.sourceEdit === 'function' && !window.sourceEdit.__dlRealForm) {
    const replaced = function sourceEditAgainstTheServer(id, back) {
      openForm(id, back).catch(error => {
        console.error('The database form failed to open:', error)
        window.toast?.('The database form could not be opened')
      })
    }
    replaced.__dlRealForm = true
    replaced.original = window.sourceEdit
    window.sourceEdit = replaced
  }

  /* Test, against the database rather than a timer. */
  if (typeof window.testSource === 'function' && !window.testSource.__dlRealTest) {
    const original = window.testSource
    const replaced = function testSourceAgainstTheServer(source, element) {
      const connectionId = connectionIdFrom(source?.id)
      if (!connectionId || !element) return original.call(this, source, element)
      report(connectionId, (text, tone) => {
        element.innerHTML = `<span class="${tone}">${esc(text)}</span>`
      })
      return undefined
    }
    replaced.__dlRealTest = true
    replaced.original = original
    window.testSource = replaced
  }

  /* The list page, filled in after the studio has drawn it. */
  if (typeof window.sourcesForm === 'function' && !window.sourcesForm.__dlCounts) {
    const original = window.sourcesForm
    const replaced = function sourcesFormWithCounts(...args) {
      const result = original.apply(this, args)
      try {
        fillInList()
      } catch (error) {
        console.error('Filling in the database list failed:', error)
      }
      return result
    }
    replaced.__dlCounts = true
    replaced.original = original
    window.sourcesForm = replaced
  }
}
