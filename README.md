# SandMan Digital Loop

Foundry sand loop studio: build a plant loop on a canvas, tag every item to a
data point, and publish it to the foundry. **A production line has exactly one
design**, so choosing a line is choosing a design.

Each application installs and runs on its own — there is no root package.

Storage is **MySQL 8**. Have a server running and an account for it; the
database and its tables are created on first start.

```bash
# once — the database account. No default: the server refuses to start
# without it. Put it in backend/.env, which npm start reads.
#
#   DL_DB_USER=...
#   DL_DB_PASSWORD=...
#   SANDMAN_SECRET=...        64 hex, the same value SandMan has
#
# .env.example lists every setting and holds nothing real.

cd backend  && npm install
cd frontend && npm install
cd database && npm install && npm run seed     # Munjal Kiru demo data
```

```bash
# every time — two terminals
cd backend  && npm start      # http://localhost:5000/sandman/digitalloop
cd frontend && npm run dev    # studio on  http://localhost:8000
```

Then open **http://localhost:8000/sandman** and click a line's Digital Loop icon.

Two processes, not three: the SandMan stand-in rides on the studio's dev
server. It is dev-only middleware in `frontend/sandman.plugin.js` — in
production the real SandMan is on the other end.

**Opening http://localhost:8000 directly shows a locked screen, by design.**
The studio is a view onto a line that SandMan chose, for a person SandMan
named; on its own it has neither. See "Opening from SandMan" below.

## Structure

Three folders and nothing else: **`backend/`**, **`frontend/`** and
**`database/`**, laid out to match the house style used by mpulse — routes flat
and one per surface, the connection in `config/db.js`, the schema as SQL in its
own folder. Everything that used to sit loose at the root now lives inside the
application it belongs to.

Each installs independently, so `node_modules` sits inside each application and
the root carries no package of its own. The one piece of shared code is pulled
in as a `file:` dependency rather than copied — see below.

```
backend/                     Node + Express API
  src/
    server.js                listener, graceful shutdown
    app.js                   createApp(): middleware and the mounts
    config/
      index.js               port, CORS origin, auth mode, paths, limits
      db.js                  the connection, plus audit() and transaction()
    middleware/
      auth.js                ⚠ authentication STUB — the file to replace for SSO
      error-handler.js
    routes/                  one file per surface, flat
      sessions.js            the SandMan launch handshake
      identity.js            who the caller is (/me)
      loops.js               the collection, one loop, its data tags
      loopVersions.js        saving a version, and publishing one
      organisation.js        foundries, lines and accounts
      assets.js              the equipment SVG library
      overview.js            what is published across every line
      audit.js               who changed what, and when
    services/                SVG safety, layout validation, SandMan liaison
    utils/
      loop-access.js         design access vs view access, decided once
      errors.js respond.js router.js
  packages/layout-core/      the layout document model, shared with the studio
  tests/
    api-test.mjs             every API surface, including what must be refused
    layout-fit.mjs           equipment overlaps, fitted zoom, ink share
  data/                      the old SQLite file, no longer read
  uploads/equipment/         uploaded artwork  (generated, gitignored)

database/                    the schema, and the data to start from
  schema.sql                 every table, as SQL
  seed.js                    Munjal Kiru, its lines, users, SVGs, one loop

frontend/                    React + Vite studio
  index.html
  vite.config.js             port 8000, proxies /api to the backend
  sandman.plugin.js          the SandMan stand-in at /sandman (dev only)
  public/                    equipment SVGs, the SVG pack, legacy dashboard
  src/
    main.jsx                 createRoot
    App.jsx                  the shell — locked, or the studio
    router.js                the five routes, on the history API
    context/                 studio-wide state, the engine bridge
    components/              panels, the line dropdown, dialogs
      dialogs/
    canvas/                  the imperative SVG engine (no React inside)
      core/ render/ equipment/
    api/                     API client, the launch handshake, session
    hooks/                   toasts, hints, dialog control
    styles/                  stylesheet, split into ordered passes
  tests/                     the browser suites, driven over the DevTools protocol
    launch.mjs               opens the studio the only way it opens
  tools/
    test.py                  the SandMan stand-in, standalone on :7000
    sandman_link.py          the same handshake, scripted
    sandman_store/           SandMan's own record, per foundry and line
```

### Where the shared and the cross-cutting things went

- **`backend/packages/layout-core`** — the layout document model: geometry,
  routing, validation and the mandatory data-tag rules. Both applications use
  it, so there is exactly one copy and the studio imports it by package name;
  npm workspaces resolve it wherever it sits. It lives under the backend
  because it is the model the API **validates and stores** — the same reason
  `database/schema.sql` describes the tables. Duplicating it is the one thing
  that must not happen: the studio's checks and the API's publish check would
  drift apart the first time either changed.

- **`backend/tests`** and **`frontend/tests`** — split by what each drives. The
  API suite and the pure layout check belong to the backend; the browser suites
  belong to the studio. They still cross the boundary at runtime — a browser
  suite publishes through the API and then reads the studio — which is why
  `launch.mjs` sits with them and mints real launches.

- **`frontend/tools`** — the SandMan stand-ins. SandMan is served by the dev
  server (`sandman.plugin.js`), so the standalone version and the store it
  writes belong on that side too.

- **`database/`** — the schema and the data to start from. SQL belongs in a
  `.sql` file, where it can be read, diffed and handed to a DBA without going
  through JavaScript, and a seed is something you run *against* a database
  rather than part of the service that serves it. `backend/src/config/db.js`
  applies it on boot — every statement is `IF NOT EXISTS`, which is how that
  file stays the single description of the schema.

The root keeps only what configures the whole repository: `package.json` (the
workspaces), `.gitignore`, `.env.example` and this README.

`data/` and `uploads/` stay inside `backend/` — they are the running service's
own state, not something to check in or share.

### Why the split

`backend/packages/layout-core` holds everything **pure**: geometry, routing,
validation, the equipment/connection schema and the mandatory data-tag rules.
No DOM, no filesystem, no network. That is what lets the studio and the API
share it — and it is the rule to keep when adding to it.

The two consumers differ in exactly one place: which equipment types exist.
`validate(doc, knownTypes)` takes that as an argument — the studio passes its
bundled catalogue, the API passes the slugs in its asset table. The data-tag
rule is shared outright, so the studio's UI check and the API's publish check
cannot drift apart.

### Layering inside the studio

React owns the chrome — every panel, dialog and the line dropdown. The
SVG canvas stays imperative inside a single `<Canvas/>` component, because it
redraws thousands of nodes on drag and a virtual DOM buys nothing there.

The two meet in exactly one place: `canvas/engine.js` exposes
`subscribe`/`getSnapshot`, and `StudioContext` reads it with
`useSyncExternalStore`. Components call engine actions; the engine calls
`notify()`; the snapshot changes. React never mutates the document.

`canvas/` imports nothing from `components/` or `api/` — it raises events
through `canvas/notices.js` instead, which is what keeps the engine reusable
and the module graph acyclic.

### How big the equipment looks

The view opens fitted to the whole loop, which makes this less obvious than it
sounds: **scaling equipment and spacing together changes nothing**. It zooms
out by exactly as much as it zoomed in. Equipment only looks bigger when it
occupies more of the drawing.

Three numbers decide it, and `npm run check:layout` (in `backend/`) is what they came from:

| | Where | What it does |
|---|---|---|
| `SIZE` | `sample.mjs` | how large each machine is drawn |
| `SPREAD_X` / `SPREAD_Y` | `sample.mjs` | how far apart, horizontally and vertically |
| `CAPTION_SCALE.max` | `caption-scale.mjs` | ceiling on caption size in layout units |

Horizontal and vertical spread are separate because the stage is far wider
than it is tall: this loop runs out of height long before it runs out of
width, so shortening it raises the fitted zoom while widening it is nearly
free.

The caption ceiling matters most. Captions are drawn at a fixed size on
screen, so their size *in layout units* is the reciprocal of the zoom —
unbounded, a zoomed-out view gives every machine a label several times its own
width, which inflates the bounding box and shrinks everything. Lowering the
ceiling tightens the box and grows the machines, at the cost of smaller label
text at the far end of the zoom range. That is the right trade for a plant
diagram: the equipment is the subject.

```bash
cd backend && npm run check:layout                      # overlaps, fitted zoom, ink share
node backend/tests/layout-fit.mjs --search --label=8    # sweep, label held readable
```

**The shipped numbers are on the frontier, and the frontier is flat.** Sweeping
the whole space with the label held at 8px or better puts on-screen equipment
size at 0.54–0.57 whatever you choose: label pixels and machine pixels trade
one for one, and no pair buys more of both. Maximising machine size alone walks
off a cliff — `3.92 / 3.00 / 2.20` is 19% more equipment and a 4.5px label,
which is worse at the only thing the size is for. Always pass `--label=` when
sweeping; the unconstrained optimum is a trap.

What *did* move the fitted zoom was the viewport, not the grid: `fit()` was
reserving 90px below the drawing for a legend that needs 64, which cost about a
sixth of the stage's height. Fixing it took the demo loop from 25% to 32%.

`check:layout` runs as part of the backend's `npm test` and fails on any overlap, so the
grid cannot be tightened past what it can carry. `frontend/tests/layout-quality.mjs`
measures the other half — connection lines crossing captions — by sampling
every path every 3px against every label rectangle in the real browser.

### Stylesheet order

`src/styles/index.css` imports twelve numbered files. **Order is significant** —
the stylesheet grew as a series of passes, each overriding the one before. Add
rules to the file they belong to, or append a new numbered file; do not reorder.

## Opening from SandMan

**SandMan is the only way in.** Typing the studio's address gets a locked
screen: no canvas is mounted, the engine never starts, and nothing is fetched.
The studio has no account of its own and no line of its own, so on its own
there is nothing for it to show.

### The handshake

```
1.  You click a line's Digital Loop icon in SandMan.
2.  SandMan calls  POST /api/v1/session/launch  server-to-server, proving
    itself with a shared secret and calling from an allowed address.
    It gets a single-use ticket.
3.  SandMan opens its own page in a new tab. That page is a full-page iframe,
    and it POSTS the ticket into it as a hidden form:
        POST /api/v1/session/enter      ticket=<id>      (urlencoded)
4.  The server redeems the ticket, DELETES it, sets an HttpOnly session
    cookie, and answers 303 to "/". The iframe lands on the studio.
```

**The ticket is never in a URL, and neither is the session.** A URL is the most
copied string in a browser — it reaches the address bar, the history, the
referrer of the next request and the access log of anything in between — so a
credential in one is a credential in all of them. A request body is in none.
The session token is an `HttpOnly` cookie for the same reason, plus one more:
the page cannot read it, so no bug on the page can carry it away.

The browser never holds the shared secret. The ticket is single-use, expires in
two minutes, and its row is deleted the moment it is used — so what is on disk
afterwards is nothing. Neither the ticket nor the cookie carries a role: that
comes from the session the server opened.

Because the session is a cookie, every state-changing request must also carry
`X-Requested-With: digital-loop`. A cookie is sent on any request to this
origin, including one another site caused; a header only this page's script can
set is what tells the two apart.

### Who may mint a launch

Port 5000 serves the studio as well as the API, so it cannot simply be
firewalled — the browser has to reach it. `/api/v1/session/launch` is
restricted instead, by address, **before** the secret is even looked at:
`LAUNCH_ALLOWED_IPS`, loopback by default.

The address compared is the real peer, `req.socket.remoteAddress`.
`X-Forwarded-For` is deliberately ignored and Express's `trust proxy` is off,
because a request header can say anything.

> **In production**, if SandMan and Digital Loop are on different machines, set
> `LAUNCH_ALLOWED_IPS` to SandMan's server address — and do not expose
> `/api/v1/session/launch` through the public reverse proxy. The studio and the
> rest of the API can be public; that one endpoint has exactly one caller.

The shared secret comes from the environment and has no default. The server
**refuses to start** if `SANDMAN_SECRET` is missing, shorter than 32
characters, or still the old development placeholder. SandMan reads the same
value from `DIGITAL_LOOP_SECRET` — in its environment, not in a properties
file. The header is compared with `timingSafeEqual`, not `===`.

### Only while SandMan is running

Entering is refused unless SandMan answers its own `/health`, and the studio keeps
polling it. Stop SandMan and the open canvas locks itself within ten seconds —
"it was running when you opened it" is not the same promise as "it is running
now". There is a test for exactly that.

### Nothing is remembered

A launch is good for **exactly the navigation it arrived on**. It is not kept
in localStorage, sessionStorage or a cookie, so reloading, reopening the tab,
or typing the address locks the studio again and you go back through SandMan.

That is stricter than comfort needs, deliberately: a remembered launch is a
second way in, and there is meant to be one. Losing a reload costs nothing —
the loop is already saved on the server.

## Screens have addresses

Each screen is a route, not one page that changes mode underneath:

| Route | Screen |
|---|---|
| `/edit/<loopId>` | designing one |
| `/simulate/<loopId>` | simulating one |
| `/publish/<loopId>` | the published view of one |
| `/` | a launch that named no loop, or a line with no design on it |

The address bar is the single source of truth for which loop is open and in
which mode. Opening a loop anywhere — the line dropdown, a mode button — is a
navigation, and one effect in `StudioContext` acts on it. Browser Back works.

A URL is still **not a way in**: every route locks without a launch. It only
says which screen the launch should open. An operator who types `/edit/<id>`
is redirected to `/publish/<id>`, because that is the only view they have —
correcting the address rather than quietly showing them something else.

Routing is a small history-API module in `frontend/src/router.js`. Five routes
and no nesting did not justify a router library; if routes ever nest, replace
it with one.

### The stand-in

Something has to play SandMan while the real one does not exist: the plant,
its lines, a Digital Loop icon per line, and the account it opens as. It ships
twice, deliberately.

**`frontend/sandman.plugin.js`** — dev-server middleware at
**http://localhost:8000/sandman**. This is the default, and the reason
development needs two processes rather than three.

It lives in the frontend, not the backend, for two reasons. The backend is what
actually deploys, and a fake SandMan must never be able to ship inside it. And
keeping it in a different process from the API means the API's liveness check
is a real cross-process call rather than the API asking itself.

**`frontend/tools/test.py`** — the same thing as its own server on :7000, for when you
want to stop SandMan while the studio keeps running and watch the canvas lock:

```bash
python frontend/tools/test.py
SANDMAN_URL=http://localhost:7000 npm start   # in backend/
```

Both serve **Munjal Kiru** with **Line 1** and **Line 2**, matching the seed.
Adding a line means adding it in both places; nothing else is plant-specific.

It also keeps SandMan's own record of every loop. When a loop is saved or
published the backend tells it, and it writes one file per loop under its line:

```
frontend/tools/sandman_store/FND-MUNJAL-KIRU/LINE-1/Digital_Sand_Loop.json
frontend/tools/sandman_store/FND-MUNJAL-KIRU/LINE-2/…
```

That stands in for a table on SandMan's side. It is filed under SandMan's own
foundry and line ids, never this database's internal ones, and it is written
after the version is committed here — a failure over there can never undo a
save over here.

`frontend/tools/sandman_link.py` does the same handshake from a command line, and can
provision a foundry, line and account first:

```bash
python frontend/tools/sandman_link.py --setup --open \
    --foundry FND-MUNJAL-KIRU --foundry-name "Munjal Kiru" \
    --line LINE-1 --line-name "Line 1" \
    --user arshiya@mpminfosoft --role admin
```

⚠ The shared secret, and a ticket resolving to a plain user id, are part of the
**authentication stub** and unfit to deploy. What is already real is the shape:
server-to-server minting, single-use tickets, and a role that only ever comes
from the server.

### On arrival

SandMan's icon opens a **plant**, not a line — there is nothing to pick before
clicking it. The studio resolves the launch against the account's scope, loads
every design in that foundry and opens one: the line the launch named if it
named one, otherwise the first line in the plant that has a design.

Above the canvas is a **LINE** dropdown, one entry per line in the plant. A
line has one design, so picking a line opens its design; a line with nothing on
it is listed but not selectable, and says `— no design yet`. A plant with a
single line has nothing to choose, so the dropdown is hidden.

| | Administrator | Operator |
|---|---|---|
| The dropdown offers | every line, drafts included | every line, published designs only |
| Opens in | Design Mode | Publish view |
| Can use | Design / Simulate / Publish, Save, New, library | the published design only |

When the line has **no loop yet**, the canvas is cleared rather than left
showing a sample that belongs to nobody, and the message says why:

| | Administrator | Operator |
|---|---|---|
| Sees | "No digital loop on this line yet", naming the line | "No design yet" |
| Offered | ＋ Create the first loop, and the full editor | nothing — an admin must publish one |

A link to a line the account cannot reach is refused with a message naming the
foundry and line. A launch that names no plant at all opens a plain canvas —
there is no list screen to fall back on.

Hiding the editing chrome from an operator is presentation only. The API
refuses their writes regardless, which is the actual control.

## Loops and publishing

**There is no loop list screen.** SandMan opens a plant, the LINE dropdown
moves around inside it, and a line has one design — so a list would have had
nothing to say that the dropdown does not. What was `☰ Loops` is gone, and with
it the `/designlist` route.

- **＋ New** opens the create dialog straight onto the canvas. It lists the
  plant's lines and disables the ones that already have a design, so the one
  design per line rule is stated in the picker rather than by a 409 afterwards.
- **Save** stores a new version of the open loop. It turns amber with a dot the
  moment anything changes, and its tooltip names the destination.
- Export ▾ → **Layout as JSON file** downloads a layout at any time.

> **Publishing, renaming and deleting have no control in the studio.** They
> went with the list screen and are API-only for now:
> `POST /loops/:id/publish`, `PATCH /loops/:id`, `DELETE /loops/:id`. Putting
> Publish back in the header is a small change if it is wanted.

Versions are immutable, and publishing points at one of them. So an
administrator can go back into Design Mode after publishing and keep saving:
the foundry goes on seeing the published version until they publish again. The
card says so while the two differ — *"Editing v3 · the foundry still sees v2"*.

## Data tags and live values

Every equipment item requires a data tag; text labels do not.

- The inspector field is `Data tag (required)` — red and explained when empty,
  green with the current live value when filled.
- Untagged equipment shows an amber "⚠ data tag" badge, and the footer counts
  the gaps.
- **Simulate and Publish are refused** while any item is untagged, in the studio
  *and* in the API. A client check is a convenience; the API check is the control.
- Saving is never blocked, so unfinished work is never lost.

Once tagged, the item gets a live value badge that refreshes every 2 seconds:

```
DISA moulding line 1
ML-01
[ ● 58.1 t/hr ]
```

The caption block moves to whichever side has no connection attached — below by
default, above when the bottom port is used, beside when both are. A line
leaving a port travels through whatever is on that side, so a caption there
would be crossed by its own connection. Within the block the order is always
the same: **name, tag, value**.

Do not reintroduce free-floating value badges positioned by a collision solver.
That was tried: geometrically it reached zero overlaps, but badges drifted away
from their equipment and became unreadable.

## Data and persistence

This is a demonstration/editor, not a PLC-connected control system. Readings
come from `apps/studio/src/core/readings.mjs`, which invents them from a sine
wave. Auto/Manual fields are metadata, not a closed-loop controller. No
equipment commands are sent.

`readings()` is the single place the badges, hover card and inspector all take
values from, so replacing its simulated branches with adapter lookups keyed on
`dataTag` is enough to make the whole UI show real data.

**The browser must never talk to a PLC or database directly.** Values arrive
through the backend, which holds the credentials.

## The API

**33 endpoints across seven surfaces**, plus `GET /api/v1/health`.

Surfaces are named after the thing they serve, never after who is calling.

| Prefix | Endpoints | Purpose |
|---|---|---|
| `/api/v1/session` | 3 | arriving from SandMan — the only way in |
| `/api/v1/me` | 1 | who the caller is and what they may do |
| `/api/v1/loops` | 13 | the digital loops themselves |
| `/api/v1/organisation` | 5 | foundries, lines and accounts (admin) |
| `/api/v1/assets` | 7 | the equipment SVG library (read: any, write: admin) |
| `/api/v1/overview` | 3 | what is published across every line in scope |
| `/api/v1/audit` | 1 | who changed what, and when (admin) |

### There is no "admin API" and no "viewer API"

A digital loop is **one resource**. What differs is the access a caller has:

| Access | Who | What it means |
|---|---|---|
| **design** | administrator | create, save versions, publish |
| **view** | everyone in the foundry | open the published version |

Both use the same URLs. `GET /loops` returns every design in an
administrator's foundries, drafts included, and returns the published designs
in an operator's foundry — it does not refuse them. `DELETE /loops/:id` refuses
the operator. The decision lives in `backend/src/utils/loop-access.js` so it is
made once.

```
GET    /api/v1/loops                     loops you can reach (?lineId= narrows)
POST   /api/v1/loops                     create                        [design]
GET    /api/v1/loops/:id                 draft + history, or published version
PATCH  /api/v1/loops/:id                 rename or archive             [design]
DELETE /api/v1/loops/:id                                               [design]
GET    /api/v1/loops/:id/tags            data tags, for a gateway
POST   /api/v1/loops/:id/versions        save                          [design]
GET    /api/v1/loops/:id/versions/:n                                   [design]
POST   /api/v1/loops/:id/publish                                       [design]
POST   /api/v1/loops/:id/unpublish                                     [design]
```

There is no allocation endpoint, and no `assignment` table. Being in the
foundry is the access control; publishing is what decides a design is ready to
be seen. `POST /loops` refuses a second design on a line with `409
line_has_design`, naming the design already there.

### Overview

Read-only, and scopes itself the same way: an administrator sees every line in
their foundries **including the ones with no loop at all**, an operator sees
only what is published to them. It reports on loops; it never returns a layout.

```
GET /api/v1/overview              foundry -> line -> loops, with totals
GET /api/v1/overview/published    flat list of what is live now
GET /api/v1/overview/lines/:id    one line in detail
```

### Live readings

A reading linked to the foundry's database shows the plant's number; one that
is not linked keeps the studio's simulation and is marked **Demo**, so a
half-linked loop still works and nobody mistakes one for the other.

```
GET /api/v1/live/values?loopId=        last record of every linked reading
GET /api/v1/live/chart?loopId=&tag=    recent records + SandMan's process control
```

SandMan does the reading, server to server. **The browser sends a loop id and
nothing else** — the foundry, line, table and column come from the session and
the stored layout, so a session cannot be turned into a query console. If
SandMan goes quiet the last real reading stays on screen marked stale; a
simulated number is never put in its place.

Storage is MySQL 8, through a small `mysql2` pool. The database is created on
first start if it is missing and `database/schema.sql` is applied every boot,
so the only setup is a running server and an account:

```bash
set DL_DB_USER=...        # no default: the server refuses to start without it
set DL_DB_PASSWORD=...
```

**Authentication is stubbed.** The bearer token is trusted as a SandMan user id
so the API can be developed before SSO exists. `resolveUser()` in
`backend/src/middleware/auth.js` is the one function to replace; the server
refuses to start in any other auth mode until it is. It must not be deployed
as is.

## Tests

With the API and the studio both running:

```bash
cd backend  && npm test          # 143 API checks, 16 startup checks, the layout checker
cd frontend && npm test          # 33 studio checks + 17 live-reading checks, in a browser
```

The browser suites need SandMan answering — which `npm run dev` provides — and
a headless Chrome on port 9333. They refuse to start rather than report a wall
of failures if either is missing.

Reset the demo data between runs, because the suites create loops and leave
them behind:

```bash
cd database && npm run seed:reset
```

That clears designs, versions and foundries. Users and the
equipment catalogue survive it, and the seeded **Digital Sand Loop** comes
back exactly as it shipped — there is a check that no suite has altered it.

The browser suites drive a headless Chrome over the DevTools protocol and
assert on the real DOM. They cover, among other things: the mandatory data-tag
rule end to end, publish being refused for untagged equipment, a line refusing
a second design, an operator seeing only published designs, draft edits not
reaching operators until they are published, and seven SVG upload attacks.

Still untested: multi-selection resize of rotated items, small screens, and
browsers other than Chromium.

## Extending the equipment library

Add catalogue entries and artwork through `apps/studio/src/equipment/`, keep
per-instance SVG IDs unique, and provide a matching
`apps/studio/public/equipment/<id>.svg`. Verify Save/Open accepts the new type.
Uploading artwork at runtime goes through the assets API instead.

## Known limits

The default loop is a visual reconstruction of a screenshot, not an approved
plant P&ID. Equipment uses schematic dimensions. Static and animated variants
are separate catalogue entries.

At heavy zoom-out a caption block is physically larger than the machine it
names, and a few instrument signal lines still graze their own captions. The
principled fix is semantic zoom — dropping the tag line below a threshold — not
further hand-tuning of coordinates.

No repository credentials, environment secrets or hosting configuration are
included.
