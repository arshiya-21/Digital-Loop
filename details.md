# Digital Loop — Structure & API Reference

Companion to `README.md`. This is the document for somebody who has to work on
the code: what sits where, what the database holds, and what every endpoint
does.

---

## Project structure

Each application installs and runs on its own. There is no root package —
`npm install` in a folder gets you that folder, and nothing else.

```
backend/            the API and the server that serves the studio
  src/
    app.js            Express app: middleware, route mounts, static studio
    server.js         listener and the startup banner
    config/
      index.js          every setting and its default, in one place
      db.js             the MySQL pool, audit() and transaction()
    middleware/
      auth.js           ⚠ the session check — the file to change for SSO
      error-handler.js  turns thrown errors into JSON, hides stack traces
    routes/           one file per surface, flat
      sessions.js       the SandMan launch handshake
      identity.js       who the caller is (/me)
      database.js       the foundry's tables, from the session
      connections.js    ⚠ databases somebody registered — admin only
      loops.js          the designs: list, open, create, rename, delete
      loopVersions.js   saving a version, publishing one
      assets.js         the equipment SVG library
      overview.js       what is published across every line in scope
      audit.js          who changed what, and when
    services/
      sandman.js            is SandMan running?
      session-store.js      sessions, in memory
      svg-safety.js         rejects executable SVG
      layout-validation.js  the authoritative layout check
      ticket-store.js       launch payloads do not linger: purge and scrub
      secrets.js            ⚠ seals stored database credentials (AES-256-GCM)
      ssh-keys.js           Ed25519 keys for a jump box, in OpenSSH form
      db-connect.js         ⚠ the one place this service dials a database
    utils/            errors, responses, the small router
      launch-allowlist.js  who may mint a launch — pure, so it is unit-tested
  packages/
    layout-core/      the layout model, shared with the studio
  tests/
    api-test.mjs      every API surface, including what must be refused
    startup-test.mjs  refusing to start without a secret; ticket scrubbing
    layout-fit.mjs    equipment overlaps, fitted zoom, ink share
  data/             the old SQLite file      (left over, no longer read)
  uploads/          the equipment artwork    (generated, gitignored)

database/
  schema.sql        every table, as SQL. Applied on every boot.
  seed.js           the equipment catalogue and one demo loop
  inspect.js        read-only look inside the database (npm run db)

frontend/
  studio/           the vendored SandMan Digital Loop Studio (v8.3) — upstream
    src/              its source; a new drop replaces this wholesale
    build.mjs         upstream's build: src/js/*.js → one classic script
    patch.mjs         OUR four changes to the page shell, then build → ../app
    docs/, CHANGES.md upstream's own
    header-button/    SandMan's own header icon — for SandMan's page, not ours
  app/              what the backend serves (generated, except sandman/)
    index.html        built shell + the lock, painted before any script runs
    app.js, app.css   the editor itself, built from frontend/studio/src
    sandman/          ← OUR integration layer. The build never touches it.
      index.mjs         boot, lock screen, foundry and line strip, role rules
      studio.mjs        the seam: how we reach into the editor at all
      session.mjs       who is signed in, from the session cookie
      designs.mjs       load, save, publish against the API
      api.mjs           the fetch wrapper: cookie + the CSRF header
      sandman.css       the chrome: lock, strip, what an operator is not shown
  tests/
    studio-test.mjs   the studio in a real browser, both roles
    launch.mjs        minting a launch and entering, as SandMan's page does

.env.example        every setting, with its default and what it means
README.md           what it is and how to run it
details.md          this file
```

### Two document formats

A design's `layout` is stored as JSON, and two shapes live in that column:

| Format | Shape | Status |
|---|---|---|
| **studio** | `{ DOC: { name, blocks, streams, seq }, REG: {…} }` | what the studio saves now, and every new version |
| **loop v1** | `{ format: 'sandman-loop', version: 1, nodes, edges }` | drawn in the previous studio |

Both are accepted, validated and served. The current studio **cannot open** a v1 design —
there is no reader for it and the equipment library is entirely different — so
the studio says so plainly and leaves the canvas empty rather than failing
somewhere further on. The rows were kept deliberately: they are somebody's
work, and deleting them to simplify a validator is not a trade worth making.
Redrawing a line and saving adds a current-format version to the same design, with the
old versions still in its history.

`formatOf()` decides which is which by shape, never by a flag a document could
be wrong about itself.

### What the studio opens into

Three defaults are set by the integration rather than left to the editor,
because the editor's own are wrong for a plant:

- **The publish view**, for both roles. An operator has nothing else; an
  administrator is shown what the plant is seeing and switches to Design to
  change it.
- **Whole loop**, not *Fill screen*. The publish view starts on a mode that
  spreads the equipment to fill the display, which on a real sand line pushes
  the top of the loop off the screen. The studio's own *Whole loop* button is
  pressed once per page — after that the three fit buttons are the operator's.
- **Light**, unless somebody chose a theme. With no stored preference the
  stylesheet follows the operating system, so a terminal set to dark opened a
  dark HMI.

### One process, one origin

The backend serves **both** the API and the studio:

```
GET /                  the studio
GET /api/v1/...        the API
```

`app.js` is 4.9 MB of equipment drawings and editor, so the built `.js` and
`.css` are gzipped once per build and cached in memory — about 1.7 MB on the
wire. `index.html` is deliberately excluded: it is rewritten per request to
carry the session's foundry, and a cached copy would hand one plant's context
to another.

`npm start` in `backend/` is the whole application. That is why SandMan needs
one address rather than two, and why the browser is same-origin with the API
and never deals with CORS.

**The backend is the only thing that may serve the studio.** The page carries
`window.SANDMAN_CONTEXT` — the foundry and its database — written in as the
page is served from the session cookie. Any other server handing out the same
files produces a page with no context and no session, which is why the Vite
dev server was retired along with the React dependencies neither the studio
nor this integration has used for some time.

To work on the studio: `npm run build` in `frontend/` re-applies our shell
patches, builds, and copies the result into `app/`. Upstream's own
`npm run watch` in `frontend/studio/` rebuilds `dist/` on every change, but
only the copy in `app/` is served.

---

## Upstream drops

`frontend/studio/` is a vendored copy of the SandMan Digital Loop Studio
(v8.3). A new drop replaces `src/`, then:

```bash
cd frontend/studio && node patch.mjs     # re-apply our changes, build, copy to ../app
node patch.mjs --check                   # say what is and is not applied
```

**Only the page shell is patched**, in four places: `<base href="/">`, our
stylesheet, the lock markup, and the `<script>` that loads our module. Nothing
is spliced into the editor's own code.

That is possible because the studio has a real seam, and because a classic script
puts every top-level `function` on `window`. The integration reaches the
editor through `snap()`, `restore()`, `changed()`, `setMode()`, `setPresent()`
and `toast()` — the same functions its own undo uses, and therefore the ones
least likely to be renamed. `DOC` and `REG` are declared with `let`, so they
are *not* on `window` and are deliberately not reached for.

The one thing the server supplies is `window.SANDMAN_CONTEXT`, written into
the HTML as the page is served — see `services/studio-context.js`. The studio
reads it as its first script runs, which is why it is injected rather than
fetched: its own `setCustomerContext()` reloads the page when the customer
changes, and nothing would have set the context by the time the reloaded page
ran, so it would reload again.

Everything else of ours lives in `frontend/app/sandman/`, which the build never
writes to.

---

## Database

MySQL 8, through a small `mysql2` pool. The schema is `database/schema.sql`,
applied on every boot — every statement is `IF NOT EXISTS`, which is how that
file stays the single description of the schema. The database itself is created
on first start if it is missing, so the account needs `CREATE` as well as the
usual read and write.

Host, port and name have defaults (`127.0.0.1:3306/digital_loop`) because they
are not secrets. **The account has none**: `DL_DB_USER` must be set or the
server refuses to start, for the same reason the shared secret has no default.

**This used to be SQLite** — `node:sqlite`, no driver and no service — and the
change is not only where the bytes live. That driver was synchronous; this one
is not, so everything that touches the database is now `await`ed. `db.prepare(sql).get(…)`
kept its shape so the call sites read the same, but two things follow:

- `init()` must resolve before the server listens. Nothing may query before the
  schema is there, which is why startup is a sequence rather than a file of
  top-level statements.
- A transaction holds one connection out of the pool. A query made through the
  module-level `db` while one is open is a *different* connection and therefore
  outside the transaction — it would commit on its own and survive a rollback.
  So `transaction()` hands its block a connection-scoped `tx` and the block uses
  that, `audit()` included.

The old SQLite file is left where it was and nothing reads it; the old schema is
kept beside the new one as `database/schema.sqlite.sql.bak`.

### Tables

| Table | Purpose |
|-------|---------|
| `design` | one loop per foundry + line |
| `design_version` | immutable snapshots; publishing points at one |
| `design_tag` | every data tag in a version, for a gateway to subscribe to — **one row per tag**, not per item |
| `asset` | the equipment SVG catalogue |
| `audit_log` | who changed what, and when |
| `launch_ticket` | one SandMan launch — **seconds old at most, then deleted** |
| `db_connection` | **⚠ plant databases somebody registered — the only credentials here** |

**There is no foundry, line or user table, deliberately.** SandMan owns the
organisation and the accounts. Digital Loop never connects to SandMan's
database and never keeps a second copy of it. What a person may see arrives
with their launch, lives in the session, and is gone afterwards.

### Key column notes

- `design.foundry_id` / `design.line_id` are **SandMan's** identifiers, stored
  as strings. `foundry_name` / `line_name` are kept alongside them so a design
  can be read, listed and confirmed without asking SandMan anything.
- `design` has `UNIQUE (foundry_id, line_id)` — **a line has one design**. That
  is the rule the whole studio rests on: choosing a line is choosing a design.
- `design.created_by`, `design_version.created_by`, `asset.uploaded_by` and
  `audit_log.actor_id` are SandMan usernames, not foreign keys. There is
  nothing local for them to point at.
- `design_version.layout` is the whole layout document as JSON. Versions are
  never edited — saving writes a new one — so `published_version_id` can point
  at an old version while an administrator keeps working.
- `design_tag` is keyed on `(version_id, node_id, data_tag)`. A mixer reports
  moisture *and* compactability *and* temperature — up to six data labels, each
  with its own tag — and a gateway subscribes to every one. The table is an
  index, derivable from the layout beside it, so it is rebuilt rather than
  migrated when that changes.
- `asset.revision` bumps every time artwork is replaced, so caches can be
  busted. `asset.builtin` marks what shipped with the studio as opposed to what
  a team uploaded.
- `launch_ticket.payload` is the entire launch body as JSON — a name, an email,
  the plant, its lines and the names of every table in its database. It is the
  only personal data in this file, so it is kept for the shortest time it can
  be: **deleted on use**, not marked used, and swept on a timer at startup and
  every minute after.

  `PRAGMA secure_delete` is on, so a deleted row's bytes are overwritten
  rather than left in a free page. The one-time scrub that runs after this
  change also `VACUUM`s **and** truncates the write-ahead log — without the
  latter the payloads are gone from the database and still sitting in the
  multi-megabyte `-wal` file beside it, which is exactly what was found when
  it was checked. A `user_version` marker makes that happen once per database
  rather than once per lucky restart.

### A reversal, stated plainly

This project was built on the rule that **Digital Loop never holds database
credentials and never connects to a database**. SandMan owns the organisation;
the foundry's database arrives named and unreachable. Everything about the
design — no account store, sessions in memory, nothing at rest but designs —
follows from that.

The "add a database" feature reverses it, deliberately and on request. Digital
Loop now stores a host, a username, a password and sometimes an SSH private key
for plant databases an administrator registers, and opens outbound connections
to them.

What that costs, so nobody has to rediscover it:

- **This service is now worth attacking for its contents**, not just its
  designs. The `db_connection` table holds credentials to plant systems.
- **`DL_SECRET_KEY` is now load-bearing.** Keep it out of version control and
  somewhere other than beside the database file it protects — a key stored next
  to the ciphertext is decoration. There is no recovery if it is lost.
- **Back up the key separately from the database**, for the same reason.
- An administrator account in SandMan is now, transitively, a way to reach
  whatever those connections can reach.

What still holds, and what the code enforces: metadata-only queries, no pooled
connections, administrator-only access to every verb, no secret in any
response, and the browser never talking to a database itself — every one of
these connections is made by the server.

The foundry's own database — the one SandMan describes in the launch — is
**not** affected. It is still described and never connected to.

### Back up two things, not one

The database is a few hundred kilobytes; the artwork is several megabytes
across hundreds of files. **A design references artwork by slug.** Back up
`backend/data/` and `backend/uploads/` together, or restored designs render
holes where equipment should be.

`DL_SECRET_KEY` is the third thing, and it goes somewhere else — see above.

---

## How a person gets in

The studio is not somewhere you can browse to. Typing its address gets a
locked screen, every time.

```
1.  SandMan  →  POST {api}/session/launch        server-to-server, shared secret,
                                                  from an allowed address
                { user, name, role, foundry, foundryName, lines[], line,
                  database: { name, tables[{ name, columns[{ name, type }] }] } }
                                                  → 201 { ticket }

2.  SandMan opens its own page in a new tab. That page is a full-page iframe,
    and it POSTS the ticket into it as a hidden form:

                POST {api}/session/enter          ticket=<ticket>  (urlencoded)

3.  The server redeems the ticket, DELETES its row, sets an HttpOnly cookie,
    and answers  303 → "/"  so the iframe lands on the studio.
```

**The ticket never appears in a URL, and neither does the session.** A URL is
the most copied string in a browser: it reaches the address bar, the history,
the referrer of the next request and the access log of everything in between.
A request body reaches none of them.

- The **ticket** is single-use, expires in 120 seconds, and its row is
  **deleted** the moment it is used — including when it is refused for age.
  Entering is refused while SandMan is not answering: the studio opens
  *through* SandMan, not merely after it.
- The **session token** is 32 random bytes in an `HttpOnly` cookie, held in
  memory on the server for 12 hours. `HttpOnly` means the page cannot read it,
  so no bug on the page can carry it away — and a reload stays signed in
  instead of needing a second ticket.
- `SameSite=Lax` suffices while SandMan and the studio share a registrable
  domain; ports are not part of "site", so `localhost:8080` and
  `localhost:5000` are the same site. Separate domains need `SameSite=None`,
  which browsers honour only with `Secure`, which means HTTPS. Both are
  configurable: `COOKIE_SAMESITE`, `COOKIE_SECURE`.
- The browser never holds the shared secret and cannot mint a launch.

### Because the session is a cookie

A cookie is attached by the browser to every request to this origin, including
one another site caused. So every `POST`, `PUT`, `PATCH` and `DELETE` must also
carry **`X-Requested-With: digital-loop`** — a header a form, an image or a
link cannot set, and which a cross-origin `fetch` can only set by triggering a
preflight this server does not answer for other origins. Without it: `403`.

If `Origin` is present and is not the studio, the request is refused as well.
Absent is not a failure: command-line tools do not send one.

Reads are not guarded — they change nothing, and the same-origin policy stops
another site reading the answer. `/session/launch` and `/session/enter` are
exempt: the first is server-to-server with a shared secret and no cookie, the
second is what creates the session, so there is nothing yet to forge.

`Authorization: Bearer <token>` still works, for tests and command-line tools
that have no cookie jar. Nothing in the studio sets it.
- `role` arrives from SandMan because SandMan administers it. Every later
  request is answered from the session, never from anything the browser sends.
- **`database`** is the launching user's foundry database — its name, its
  tables and their columns with types. Names only: no credentials are sent,
  none would be accepted, and nothing here ever opens a connection to it. It is
  optional; a launch without one opens a studio whose tags are typed rather
  than chosen. Munjal Kiru's is about 239 tables and 5,000 columns, roughly
  250 KB of JSON, well inside the 8 MB body limit.

### Access

| Access | Who | What it means |
|--------|-----|---------------|
| `design` | administrator | create, save versions, publish, rename, delete |
| `view` | everyone else in the foundry | open the published version |

Both use the same URLs. `GET /loops` does not refuse an operator — it returns
the published designs in their foundry. `DELETE /loops/:id` refuses them. The
decision lives in `utils/loop-access.js` so it is made once, and every loop
response carries `access: "design" | "view"` so the studio never has to infer
it.

**Publishing is the whole of visibility.** There is no per-person allocation: a
published design is visible to everyone whose session names its foundry.

---

## API

Base path `/api/v1`. Everything except `/session` requires
`Authorization: Bearer <session token>`.

### `/session` — arriving from SandMan

| | | |
|---|---|---|
| `GET` | `/session/sandman` | is SandMan running, and where to send "Back" |
| `POST` | `/session/launch` | mint a ticket — **SandMan's server only**: an allowed address, then the shared secret |
| `POST` | `/session/enter` | the posted form; sets the cookie, `303` to `/`. **The only way in** |
| `POST` | `/session/end` | give the session up, and clear the cookie |

`/session/enter` takes `application/x-www-form-urlencoded`, parsed by a body
parser mounted on that one route and nowhere else. On any failure — a bad,
used or expired ticket, or SandMan offline — it sets no cookie and still
answers `303 → /`, where the studio shows its locked screen. The reason is
deliberately not put in the URL: it would tell anybody who could read it
whether a ticket was real.

### `/me` — who the caller is

`GET /me` returns the account, its role, and the plant it arrived in, read
straight out of the session:

```json
{ "id": "Munjalkiriu", "sandmanUserId": "Munjalkiriu",
  "name": "Anand Babu", "email": null, "role": "admin",
  "access": ["design", "publish", "view"],
  "foundries": [ { "id": "52", "name": "Munjal Kiriu", "sandmanFoundryId": "52",
                   "lines": [ { "id": "1", "name": "Disa 230C" } ] } ] }
```

`foundries` is always a list of one — a launch opens one plant — because that
is the shape the studio reads.

### `/database` — the foundry's tables

`GET /database` returns the database the session arrived with — the list the
studio's table and column dropdowns are built from:

```json
{ "foundry": { "id": "52", "name": "Munjal Kiriu" },
  "name": "munjalkiriu_sandman", "tableCount": 239, "columnCount": 5012,
  "tables": [ { "name": "preparedsand",
                "columns": [ { "name": "moisture", "type": "float" } ] } ] }
```

Both roles may read it: an operator never edits a tag, but the published view
shows which table and column each reading comes from, and that is this list.

It is scoped by the session and nothing else — there is no parameter to ask for
another foundry's database, which is the simplest way for there to be no way to
reach one. A session that arrived without a database gets
`{ "name": null, "tables": [] }`.

**Nothing here is a connection.** Digital Loop holds no credentials for this
database and never opens one. Reading values out of it, when that comes, is a
SandMan API call made by this server — never by the browser.

### `/loops` — the designs

| | | |
|---|---|---|
| `GET` | `/loops` | every design in scope; `?lineId=` narrows |
| `GET` | `/loops/:id` | one design — draft + history for an admin, the published version for everyone else |
| `GET` | `/loops/:id/tags` | the data tags, for a gateway |
| `POST` | `/loops` | create — **409 `line_has_design`** if the line already has one |
| `PATCH` | `/loops/:id` | rename or archive |
| `DELETE` | `/loops/:id` | delete, versions and all |
| `POST` | `/loops/:id/versions` | **save** — stores a new immutable version |
| `GET` | `/loops/:id/versions/:n` | one version |
| `POST` | `/loops/:id/publish` | point the design at a version |
| `POST` | `/loops/:id/unpublish` | hide it again |

Saving changes nothing anybody else sees. Publishing is what reaches the
plant, which is why editing a published loop cannot disturb a running line.

**Where a reading comes from** is the studio's own: a `REG` entry
carries a `link` naming the source, database, table, column and row key, and a
block lists the readings it owns.

```json
"REG": { "Mixer.MOIST": { "desc": "Moisture", "unit": "%",
  "link": { "src": "customer", "db": "munjalkiriu_sandman",
            "table": "preparedsand", "col": "moisture",
            "keyCol": "machine_id", "keyVal": "Mixer" } } }
```

`src: "customer"` means the foundry's own database — the one SandMan named in
the launch — so the same loop opened by another foundry reads *that* foundry's
database without being edited. `design_tag` indexes each link as
`database.table.column` against the block that owns it, which is the same thing
the index meant for the previous format.

Those dropdowns are fed by `window.SANDMAN_CONTEXT.defaultDb.schema`, which the
server writes from `GET /database` as the page is served. Nothing in the browser
connects to anything.

In a **loop v1** design the tag lived on a data label instead — up to six per
node, each optionally carrying a `dataSource` of `{database, table, column,
type}`. Still validated, because those designs are still stored.

**Publish is refused when a loop would show the plant nothing real** —
`422 missing_data_tags`. What that means depends on the format, and the two are
held to different standards on purpose:

- **loop v1** — per item: every piece of equipment must carry a tag, and the
  refusal names the offending ones. The server can check this because it knows
  which types are equipment and which are drawn annotation.
- **studio format** — a loop with no readings at all cannot be published.
  Per-item is *not* enforced here, because whether a block is a machine or a
  decoration is decided by the studio's equipment library — four megabytes of
  it, in the browser — and this service has no copy. Claiming the per-item
  check here would be claiming a check that is not happening. The studio
  applies it in the UI.

Publishing means the plant sees those numbers, and numbers from nowhere are
worse than none.

### `/assets` — the equipment SVG library

| | | |
|---|---|---|
| `GET` | `/assets` | the catalogue; `?category=` narrows |
| `GET` | `/assets/:id` | one item, plus `usedBy` — the designs placing it |
| `GET` | `/assets/:id/file` | the artwork, served as a file |
| `POST` | `/assets` | **add** new artwork |
| `PATCH` | `/assets/:id` | **rename / recategorise / change slug** |
| `PUT` | `/assets/:id/file` | **replace** artwork, slug unchanged |
| `DELETE` | `/assets/:id` | remove; `?force=true` to override |

Reads are open to any signed-in account — the studio needs the catalogue to
draw. Every write is administrator-only.

Two behaviours worth knowing:

- **Changing a slug rewrites every design that uses it**, in one transaction,
  because the slug *is* the node `type` in a layout. The response names what it
  touched (`rewroteDesigns`).
- **Delete is refused while a design still places it** — `422 asset_in_use`,
  listing them. `?force=true` deletes anyway and returns `brokeDesigns`.

Uploads are **rejected, not cleaned**: `<script>`, inline handlers,
`javascript:` URLs, `<foreignObject>`, external references, XXE doctypes, and
anything over 512 KB. Artwork is inlined straight into the canvas, so anything
executable would run in the browser of every operator who opens that loop.
Silent cleaning hides mistakes and invites bypasses.

### `/connections` — databases somebody added

**⚠ The only credentials this service holds.** The foundry's own database is
described and never connected to; a connection here is one an administrator
registered, which Digital Loop dials out to itself. See *A reversal, stated
plainly* below.

| | | |
|---|---|---|
| `GET` | `/connections` | every registered database — **never a secret** |
| `GET` | `/connections/:id` | one of them |
| `POST` | `/connections` | add one |
| `PATCH` | `/connections/:id` | change it; `password: ""` clears, omitted keeps |
| `DELETE` | `/connections/:id` | remove it, stored password and key with it |
| `POST` | `/connections/:id/test` | can it be reached? |
| `GET` | `/connections/:id/schema` | its tables and columns, live |
| `POST` | `/connections/:id/keypair` | make an SSH key for the jump box |

**Administrator-only, every verb including the reads** — at the mount and again
inside each handler, because a prefix is never the security boundary and this
is the prefix where that matters most.

- **A password can be set, never read back.** Responses carry `hasPassword`,
  not the password. The same holds for the tunnel's private key: it is
  generated on the server by `/keypair`, sealed, and used only inside
  `services/db-connect.js`. Only the public half is returned, because that is
  the half that goes in `authorized_keys`.
- **Stored sealed.** AES-256-GCM under `DL_SECRET_KEY`, which has no default —
  without it the API refuses to store a password rather than writing it in
  clear. A dump of this database is therefore not a copy of the credentials.
- **Metadata only.** Every statement this service sends reads
  `information_schema`. Nothing selects from a plant table, so the studio
  cannot be turned into a query console, and nothing is pooled — a connection
  is opened for one question and closed in a `finally`, tunnel included.
- **MySQL/MariaDB and SQL Server.** `engine` picks the driver.
- **The jump box is optional.** With `tunnel` set, the connection goes over SSH
  through a local port forward; `tunnel: null` turns it off and deletes the key
  with it, because a private key kept for a tunnel nobody uses is a credential
  kept for no reason.
- The audit log records what changed, never what it changed to: a
  `connection.update` entry naming `password` means one was replaced.

The schema comes back in the same shape as `/database`, so the studio's table
and column dropdowns cannot tell the two apart — choosing "Use for tagging" in
the panel is the only difference.

### `/overview` and `/audit`

| | | |
|---|---|---|
| `GET` | `/overview` | every line in scope, grouped, including lines with nothing on them |
| `GET` | `/overview/published` | a flat list of what is live — the one worth polling |
| `GET` | `/overview/lines/:lineId` | one line in detail |
| `GET` | `/audit` | who changed what, and when — **admin only** |

---

### `/live` — what the plant is actually doing

| | | |
|---|---|---|
| `GET` | `/live/values?loopId=` | the last record of every linked reading in a loop |
| `GET` | `/live/chart?loopId=&tag=` | the recent records for one reading, and SandMan's own process control chart |

The studio invents a plausible number for every reading so a loop can be drawn
and demonstrated before anything is connected. These two endpoints are what
make a *linked* reading real. The drawing does not change — same equipment,
same positions, same limits — only where the number comes from.

**The browser sends a loop id, and for a chart a tag id. Nothing else.** Not
the foundry, not the line, not the database, table or column. All of those are
taken from the session and from the layout stored on the server, and there is
deliberately no endpoint that would accept them: an operator's session must not
become a query console onto the foundry's database. Three narrowings, in
`services/live-tags.js`:

1. **The loop** — `loopToView` refuses one outside the session's foundry or
   lines, and refuses an unpublished one to anybody who is not an administrator.
2. **The version** — an operator reads the published version's readings, an
   administrator the latest. Reading the draft's as an operator would leak a
   design that has deliberately not been published.
3. **The database** — only links whose `db` is the one SandMan named in the
   launch. A layout may name any database it likes; only that one is read.
   Links to other sources are ignored rather than refused, because they are not
   SandMan's to answer for.

**Digital Loop holds no connection to the plant's database.** SandMan does the
reading, server to server, with the shared secret — the browser never talks to
it, and `DIGITAL_LOOP_ALLOWED_IPS` on SandMan's side means it would be refused
if it tried.

Answers are cached for thirty seconds per (foundry, line, exact tag list), so a
control room with four screens on one line is one read of the plant database
rather than four. When SandMan cannot be reached:

| | |
|---|---|
| there is a previous reading | `200` with `stale: true` and `since` — the last real value stays on screen, marked |
| there has never been one | `503`, because there is nothing honest to show |

A simulated number is never substituted for a real one. That is the single rule
the whole surface exists to keep.

**Nothing here is logged.** The request body names the foundry's tables and the
answer is its readings; the log line carries a count and whether the answer was
fresh, and nothing else.

---

## Who may mint a launch

Port 5000 serves the studio as well as the API, so it cannot simply be
firewalled — the browser has to reach it. `/api/v1/session/launch` is
restricted by address instead, and **before** the secret is looked at, so
somebody who cannot reach the endpoint never gets to make guesses at the secret
either.

The address compared is `req.socket.remoteAddress`: the peer the packets came
from. `X-Forwarded-For` is deliberately ignored and Express's `trust proxy` is
off, because a request header can say anything — trusting it would let anybody
claim to be `127.0.0.1` and turn this into decoration.

> **In production**, when SandMan and Digital Loop are on different machines,
> set `LAUNCH_ALLOWED_IPS` to SandMan's server address and **do not expose
> `/api/v1/session/launch` through the public reverse proxy.** The studio and
> the rest of the API can be public; that one endpoint has exactly one caller.

Only the address is logged when a launch is refused — no header, no body.
Nothing under `/session` is logged in detail at all: those bodies carry a
ticket and, behind it, somebody's name, email and plant, and a stack trace that
quoted one would put all of it in a file that outlives the session by months.

## Configuration

Every setting comes from the environment. **No secret is ever committed.**
`.env.example` documents the names and defaults and holds nothing real.

| Variable | Default | What it is |
|----------|---------|-----------|
| `PORT` | `5000` | serves the studio and the API |
| `SANDMAN_URL` | `http://localhost:8080/sandman` | SandMan's context path — one address |
| `SANDMAN_SECRET` | **none — required** | must equal SandMan's `DIGITAL_LOOP_SECRET`. The server refuses to start if it is missing, under 32 characters, or the old placeholder |
| `LAUNCH_ALLOWED_IPS` | `127.0.0.1,::1,::ffff:127.0.0.1` | who may mint a launch, checked before the secret |
| `COOKIE_SAMESITE` | `Lax` | `None` when SandMan and the studio are on different domains |
| `COOKIE_SECURE` | `false` | `true` in production; required with `SameSite=None` |
| `DL_DB_HOST` | `127.0.0.1` | where MySQL is |
| `DL_DB_PORT` | `3306` | |
| `DL_DB_NAME` | `digital_loop` | created if missing; overridable so a test can use a database of its own |
| `DL_DB_USER` | **none — required** | the server refuses to start without it: an account that ships in the source is an account anybody can use |
| `DL_DB_PASSWORD` | *(none)* | |
| `SANDMAN_TICKET_SECONDS` | `120` | how long a launch may sit unredeemed |
| `SESSION_HOURS` | `12` | how long a redeemed launch lasts |
| `AUTH_MODE` | `stub` | ⚠ see below |
| `DL_SECRET_KEY` | *(none)* | ⚠ seals stored database credentials. No default: without it, adding a database with a password is refused rather than stored in clear |
| `CORS_ORIGIN` | `http://localhost:8000` | only needed if the studio is served elsewhere |
| `SEED_FOUNDRY_ID` / `_NAME` | `FND-MUNJAL-KIRU` / `Munjal Kiru` | which plant the demo loop is filed under |
| `SEED_LINE_ID` / `_NAME` | `LINE-1` / `Line 1` | which line it is filed under |

⚠ **The seed identifiers are placeholders and do not match real SandMan**,
which sends its own primary keys — Munjal Kiriu is customer `52`, with lines
`1` (Disa 230C) and `2` (Disa 231Y). A loop seeded under `FND-MUNJAL-KIRU`
belongs to a line nobody ever arrives on, so it reads as missing rather than
as wrong. Set these to the real ids before seeding a demo, or re-file the
existing rows.

Two paths hang off `SANDMAN_URL`, because one address is easier to keep right
than two:

```
liveness   {SANDMAN_URL}/api/su/digital-loop/health
"Back"     {SANDMAN_URL}/user/dashboard
```

SandMan needs one setting in return: `http://<host>:5000`, from which it
derives `/api/v1/session/launch` and `/?ticket=`.

---

## What is not finished

Stated plainly, because a demo should not imply more than is there.

- **⚠ `AUTH_MODE=stub`.** A launch is trusted because it carried a shared
  secret, which is a secret rather than a signature: it proves the caller knows
  the value, not that SandMan issued the claim. The server refuses to start on
  any other value. Going live means replacing that check with a signed
  assertion from SandMan — OIDC against its JWKS, or token introspection. The
  session model, the scoping and every guard stay exactly as they are.

  The secret is at least real now: it has no default, it comes only from the
  environment, it is never printed or written to a file, and it is compared
  with `timingSafeEqual` rather than `===` so the time an answer takes says
  nothing about how much of a guess was right.
- **Live values are simulated.** Every reading on the canvas is generated in
  the browser: a label knows which table and column it should come from, and
  nothing reads one yet. Live values are to arrive from a SandMan API, backend
  to backend — the browser must never talk to a database or a PLC — and every
  tag a design carries is already indexed in `design_tag`, ready for a gateway
  to subscribe to.
- **Designs drawn in the previous studio cannot be opened**, only listed and
  kept. See "Two document formats".
- **The `/connections` feature has no screen any more.** The API is intact —
  registering a plant database, testing it, reading its schema, the SSH
  tunnel, the encrypted credentials — but the panel that drove it was built
  against the previous studio's dialog and was removed rather than left to
  rot. The studio has its own *Data › Data sources*, which is where it should be
  wired back in.
- **The browser suite needs things running.** `npm test` in `backend/` is
  self-contained — it starts its own API and its own liveness stub and needs
  nothing. `npm test` in `frontend/` drives a real browser, so it needs the API
  on :5000, SandMan answering its health endpoint, and Chrome with
  `--remote-debugging-port=9333`; it refuses to run rather than report a wall
  of failures when any of those is missing.

  The suites written against the previous studio were moved to
  `_backup/old-frontend-tests/` rather than left to fail: they drive a DOM that
  no longer exists.
