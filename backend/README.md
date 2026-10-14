# Digital Loop API

Surfaces are named after the thing they serve, never after who is calling:

| Prefix | Purpose |
|---|---|
| `/api/v1/session` | arriving from SandMan — the only way in |
| `/api/v1/me` | who the caller is and what they may do |
| `/api/v1/loops` | the digital loops themselves |
| `/api/v1/organisation` | foundries, lines and accounts (admin) |
| `/api/v1/assets` | the equipment SVG library (read: any, write: admin) |
| `/api/v1/overview` | what is published across every line in scope |
| `/api/v1/audit` | who changed what, and when (admin) |

**There is no admin API and no viewer API.** A digital loop is one resource;
what differs is the access a caller has to it:

| Access | Who | What it means |
|---|---|---|
| **design** | administrator | create, save versions, publish, allocate |
| **view** | everyone | open the published version allocated to you |

So `GET /loops` serves both: an administrator gets every loop on their lines,
drafts included, and an operator gets their published, allocated loops. Neither
is refused. `POST`, `PATCH`, `DELETE`, `/versions`, `/publish` and `/assignees`
need design access and return `403` without it.

```bash
npm run api:seed   # create the database and demo data (safe to re-run)
npm run api        # http://localhost:5000
```

No build step. Storage is MySQL 8 via `mysql2`: point `DL_DB_USER` and
`DL_DB_PASSWORD` at a local server and the database and schema are created on
first start. `DL_DB_HOST`, `DL_DB_PORT` and `DL_DB_NAME` default to
`127.0.0.1:3306/digital_loop`.

---

## Getting in: the SandMan launch

The three session endpoints are mounted **without** authentication, because
they are how a caller becomes authenticated:

```
GET  /api/v1/session/sandman    is SandMan running? the studio polls this
POST /api/v1/session/launch     mint a ticket          SandMan only (secret)
POST /api/v1/session/enter      exchange it for a session
POST /api/v1/session/end        give the session back
```

`launch` requires `x-sandman-secret`, is restricted by address, and is called
server-to-server, so a browser cannot mint its own. It returns nothing but a
ticket, which is single-use and expires in two minutes.

`enter` is where the ticket is spent. SandMan POSTs it as a form into a
full-page iframe — **never a query string** — and the reply is a `303` to `/`
with the session in an HttpOnly cookie. The ticket row is deleted on use, not
marked, because the payload is the only personal data this service holds.

It is refused unless SandMan answers its own `/health`, which is what makes the
studio unopenable while SandMan is down rather than merely unopened. The launch
payload *is* the organisation: who is arriving, their role, their foundry and
every line they may see. Nothing is mirrored into this database and nothing is
read back out of SandMan's.

---

## ⚠ Authentication is stubbed

Once launched, every request identifies itself with:

```
Authorization: Bearer <sandmanUserId>
```

**The token is trusted as-is. Anyone can claim to be anyone. This must not be
deployed.** It exists so the API can be built and demonstrated before SandMan
SSO is available.

`resolveUser()` in [src/middleware/auth.js](src/middleware/auth.js) is the single function to replace, with
either JWT verification against SandMan's JWKS or token introspection. The
server refuses to start with `AUTH_MODE` set to anything but `stub` until that
is done. Nothing else changes: roles and foundry scope already come from the
mirrored account, and no credential is ever stored here.

Seeded accounts:

| Token | Role |
|---|---|
| `admin@mpminfosoft` | admin |
| `operator.line1` | viewer |
| `operator.line2` | viewer |

---

## Authorisation model

The prefixes are for clarity in logs and proxy rules. **They are not the
security boundary.** Access is decided per loop, in
[src/routes/loops/access.js](src/routes/loops/access.js):

- `loopToDesign(user, id)` — must be an administrator, and the loop's foundry
  must be in their scope. An operator gets `403`, not `404`: the loop is not a
  secret, they simply may not change it.
- `loopToView(user, id)` — an administrator may open anything in their
  foundries, drafts included. Everyone else needs the loop to be **published
  and allocated to them**: both, not either.

A viewer has no route to a draft, to version history, or to another user's
allocations. Those are not hidden behind a flag; the queries that serve them
simply do not select them.

---

## Organisation
```
GET    /api/v1/organisation/foundries                    foundries in scope, with lines
POST   /api/v1/organisation/foundries                    { sandmanFoundryId, name }
POST   /api/v1/organisation/foundries/:foundryId/lines   { sandmanLineId, name }
GET    /api/v1/organisation/users                        accounts sharing a foundry
POST   /api/v1/organisation/users                        { sandmanUserId, name, role, foundryIds }
```

## Loops
```
GET    /api/v1/loops?foundryId=&lineId=&status=   loops you can reach
POST   /api/v1/loops                      { name, lineId, layout? } → draft + version 1
GET    /api/v1/loops/:id                  design access: newest layout + history + assignees
                                          view access:   the published layout only
PATCH  /api/v1/loops/:id                  { name?, status?: draft|archived }
DELETE /api/v1/loops/:id
```

### Versions and publishing (design access)
```
POST   /api/v1/loops/:id/versions         { layout, note? }  ← this is "Save"
GET    /api/v1/loops/:id/versions/:n
POST   /api/v1/loops/:id/publish          { version? }  default: newest
POST   /api/v1/loops/:id/unpublish
```

Versions are immutable. Publishing points `published_version_id` at one of
them, so an admin keeps editing the draft while operators keep seeing the last
published loop. Rollback is publishing an older version number.

**Publishing enforces the mandatory data-tag rule.** If any equipment item has
no data tag the request is refused:

```json
422 {
  "error": "missing_data_tags",
  "message": "1 equipment item must have a data tag before this design can be published.",
  "detail": { "missing": [{ "id": "belt1", "label": "Conveyor", "tag": "BC-01" }] }
}
```

The studio blocks this in the UI too, but a client check is a convenience, not
a control — this is the check that cannot be bypassed.

### Allocation to specific users (design access)
```
GET    /api/v1/loops/:id/assignees
PUT    /api/v1/loops/:id/assignees        { userIds: [...] }  replaces the set
DELETE /api/v1/loops/:id/assignees/:userId
```

A user can only be allocated a design in a foundry they belong to; otherwise
`422 user_not_in_foundry`.

## Audit
```
GET    /api/v1/audit?entityId=&limit=
```

Every write is recorded: who, what, when, and a detail payload.

---

## Opening a published loop (view access)

```
GET    /api/v1/me                       identity, foundries and lines
GET    /api/v1/loops                  the published loops allocated to me
GET    /api/v1/loops/:id              that loop's published layout
GET    /api/v1/loops/:id/tags         the data tags it needs
```

`GET /loops` returns everything a home screen needs, grouped by foundry and
line:

```json
[{
  "id": "dsg_…", "name": "Line 1 loop", "version": 2,
  "publishedAt": "2026-09-22T09:14:03.221Z",
  "foundry": { "id": "fnd_…", "name": "Demo foundry" },
  "line":    { "id": "lin_…", "name": "Moulding line 1" }
}]
```

Responses:
- `403` the design exists but is not allocated to this account
- `404` the design has no published version yet

`/tags` is what a data gateway subscribes to for a line — the exact tag list,
without parsing the layout. Values are not served here; see the main README,
"Data and persistence".

---

## Overview

```
GET    /api/v1/overview              foundry → line → loops, with totals
GET    /api/v1/overview/published    flat list of what is live now
GET    /api/v1/overview/lines/:id    one line in detail
```

The rest of the API answers "show me this loop". This answers "what is the
state of the plant", which is a different question with a different shape — so
it is a surface of its own rather than another filter on `/loops`.

Read-only and scope-aware, the same way loops are: an administrator sees every
line in their foundries **including the ones with no loop at all**, an operator
sees only the published loops allocated to them. It reports on loops; it never
returns a layout.

```json
{
  "role": "admin",
  "totals": { "foundries": 2, "lines": 4, "linesWithoutLoop": 2,
              "total": 1, "published": 1, "draft": 0, "tags": 19 },
  "foundries": [{ "name": "Demo foundry", "lines": [
    { "name": "Moulding line 1",
      "summary": { "total": 1, "published": 1, "draft": 0, "tags": 19 },
      "loops": [{ "name": "Digital Sand Loop", "status": "published",
                  "version": 1, "assignees": 2, "tagCount": 19 }] }]}]
}
```

`linesWithoutLoop` is the number worth watching: it is how many production
lines have no digital loop yet.

---

## Equipment SVG library

```
GET    /api/v1/assets?category=      catalogue metadata          any user
GET    /api/v1/assets/:id            one item, plus what uses it any user
GET    /api/v1/assets/:id/file       the SVG itself              any user
POST   /api/v1/assets                { slug, name, category, svg, width?, height? }   admin
PATCH  /api/v1/assets/:id            { name?, category?, slug? }                      admin
PUT    /api/v1/assets/:id/file       { svg }  replace artwork, keep the slug           admin
DELETE /api/v1/assets/:id[?force=true]                                                 admin
```

`slug` is what a layout stores as a node's `type`, so the three write paths are
deliberately different operations:

- **PATCH with a new slug** rewrites the node `type` in every stored design in
  one transaction, so nothing is left dangling. The response lists what it
  rewrote.
- **PUT .../file** keeps the slug and swaps the drawing. Every design using it
  picks up the new artwork; `revision` bumps so caches can be busted.
- **DELETE** is refused (`422 asset_in_use`) while any design still places the
  equipment, naming them. `?force=true` overrides and reports what it breaks.

Width and height are read from the SVG's `width`/`height` or its `viewBox` and
become the catalogue's default placement size.

### Upload safety

An SVG is executable content. Artwork is inlined into the canvas of every
operator who opens a loop, so uploads are checked and **rejected**, not silently
cleaned — see [sanitize-svg.mjs](sanitize-svg.mjs). Rejected: `<script>`,
inline `on*` handlers, `javascript:`/`vbscript:` URLs, `<foreignObject>` and
other embedded content, `DOCTYPE`/`ENTITY` (XXE), CSS `expression()`, and
external `href`/`url()` references. Comments are stripped before scanning so a
payload cannot hide behind one.

```json
422 {
  "error": "svg_unsafe",
  "message": "This SVG contains content that is not allowed in equipment artwork.",
  "detail": { "found": ["script element"] }
}
```

This is text analysis, not a parser, which is appropriate for an admin-only
path behind authentication. Before opening uploads to untrusted users, add a
parser-based sanitizer and serve artwork from a separate origin.

Storage is the filesystem plus a database row: `uploads/equipment/<assetId>.svg`
with metadata in `asset`. **Backing up the database alone is not enough — back
up `uploads/` with it.**

---

## Errors

Every failure returns the same shape:

```json
{ "error": "machine_readable_code", "message": "Human sentence.", "detail": { } }
```

| Status | Meaning |
|---|---|
| 400 | malformed request (`invalid_json`, `invalid_field`, `invalid_slug`) |
| 401 | no or unrecognised token |
| 403 | authenticated, but not permitted (wrong role, foundry or allocation) |
| 404 | not found, or no published version |
| 405 | path exists, method does not |
| 409 | conflict (`slug_exists`, `foundry_exists`, `line_exists`) |
| 422 | understood but rejected (`missing_data_tags`, `svg_unsafe`, `asset_in_use`) |

---

## Schema

See [db.mjs](db.mjs). Plain SQL that moves to PostgreSQL unchanged apart from
id defaults and the JSON column type.

```
foundry ─┬─ line ─┬─ design ─┬─ design_version ── design_tag
         │        │          └─ assignment ── app_user
         └─ user_foundry ── app_user
asset        (equipment catalogue; layout validation accepts these slugs)
audit_log
```

`app_user` is a **mirror** of SandMan accounts keyed on `sandman_user_id`. It
holds no password and no credential of any kind.

## Testing

```bash
npm run api        # in one terminal
npm run api:test   # in another
```

44 end-to-end checks cover the three APIs, including the paths that must be
refused: unauthenticated access, an operator reaching admin routes, publishing
with a missing data tag, an unallocated operator opening a design, draft edits
leaking to operators, and seven SVG upload attacks.

The suite is idempotent — it asserts against the records it creates rather than
absolute counts, so it can run repeatedly against the same database.
