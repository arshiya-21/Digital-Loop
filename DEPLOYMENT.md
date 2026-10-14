# Deploying Digital Loop

Everything needed to install, configure and run it. One page.

Digital Loop is **one Node service**. It serves the studio and its API from a
single port and path, and keeps everything in MySQL. It is opened from SandMan
and cannot be opened any other way.

---

## 1. Prerequisites

| | |
|---|---|
| **Node.js 24+** | older releases lack `--env-file-if-exists` |
| **MySQL 8+** | 5.7 will not take the schema |
| a MySQL account | with `CREATE` — the database is made on first start. **Not `root`** |
| SandMan | reachable over HTTP |

```sql
CREATE USER 'digitalloop'@'localhost' IDENTIFIED BY '<password>';
CREATE DATABASE digital_loop CHARACTER SET utf8mb4;
GRANT ALL PRIVILEGES ON digital_loop.* TO 'digitalloop'@'localhost';
FLUSH PRIVILEGES;
```

## 2. Install

```bash
git clone https://github.com/arshiya-21/Digital-Loop.git
cd Digital-Loop
npm run setup
```

## 3. Configure — `backend/.env`

Copy `.env.example` to `backend/.env` and fill in these five. The service
refuses to start without them, and says which is missing.

```ini
DL_DB_USER=digitalloop
DL_DB_PASSWORD=<password>
SANDMAN_SECRET=<64 hex — must equal SandMan's DIGITAL_LOOP_SECRET, exactly>
DL_SECRET_KEY=<64 hex — encrypts stored database passwords>
SANDMAN_URL=http://<sandman-host>:8080/sandman
```

Generate the two keys with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Everything else has a working default: `DL_DB_HOST` 127.0.0.1, `DL_DB_PORT`
3306, `DL_DB_NAME` digital_loop, `PORT` 5000, `DL_BASE_PATH`
/sandman/digitalloop. `.env.example` explains every setting.

> **`DL_SECRET_KEY` has no recovery.** It encrypts the passwords of plant
> databases registered in the studio. Lose it and every one must be re-entered.
> Back it up somewhere other than beside the database it protects.

## 4. Seed and run

```bash
npm run seed    # equipment catalogue (102 drawings) + one demo loop
npm start       # http://localhost:5000/sandman/digitalloop
```

One process serves the studio and the API. There is nothing to run separately.

To confirm it is talking to what you think — which database, which SandMan,
which addresses may launch — start once with `DL_VERBOSE=1`.

As a service: `node --env-file-if-exists=.env src/server.js` from `backend/`,
under systemd or NSSM. Nothing to compile, no warm-up.

## 5. SandMan server

In `sandman.properties`:

```properties
# Digital Loop
DIGITAL_LOOP_API_BASE_PATH = http://127.0.0.1:5000/sandman/digitalloop/api/v1
DIGITAL_LOOP_STUDIO_URL    = http://127.0.0.1:5000/sandman/digitalloop
```

**Both carry `/sandman/digitalloop`** — the page, its scripts and the API all
live under that one path, so there is a single origin and no CORS to arrange.
Configurations written against an earlier build that served from the host root
will 404. If `DL_BASE_PATH` is changed, both must change with it.

And as an environment variable on the SandMan server:

```
DIGITAL_LOOP_SECRET = <the same value as SANDMAN_SECRET>
```

Byte-identical, or the studio opens to a locked screen and nothing says why.

A launch ticket lasts **120 seconds** and is deleted the moment it is used. The
session it opens lasts **12 hours**.

## 6. Back up two things, together

| | |
|---|---|
| the MySQL database | loops, every version, readings, limits, processes, SOP metadata, alarm history |
| `backend/uploads/` | equipment artwork and uploaded SOP documents |

A design references artwork by name. The database alone restores to a drawing
full of holes; the files alone are an orphan directory. `DL_SECRET_KEY` is the
third thing and belongs somewhere else entirely.

## 7. ⚠ Before it carries production data

**Authentication is a placeholder.** A launch is trusted because it carried the
shared secret — that is not a signature, and anyone who learns it can mint a
session for any plant, person or role. `AUTH_MODE` refuses every value but
`stub` so this cannot ship unnoticed.

Replacing it is one function — the secret check in
`backend/src/routes/sessions.js` — swapped for OIDC (verify SandMan's signed
assertion against its JWKS) or token introspection. Nothing else changes.

Behind HTTPS, also set `COOKIE_SECURE=true`, and `COOKIE_SAMESITE=None` only if
SandMan and the studio are on different domains.

**Keep `/api/v1/session/launch` off any public reverse proxy.** It is restricted
by address, and that check runs before the secret is compared.

## 8. If something is wrong

| it says | it means |
|---|---|
| `DL_DB_USER is not set` | `backend/.env` missing, or not being read |
| `MySQL at …:3306 could not be used` | wrong host, port, account or password; or MySQL is down |
| `SANDMAN_SECRET is not set` | as above |
| studio opens to a locked screen | SandMan unreachable, or the two secrets differ |
| `Something is already listening on port 5000` | a previous run was killed rather than stopped |
| a 404 from SandMan's launch | `sandman.properties` is missing `/sandman/digitalloop` |

Every API call is one log line: method, path, status, milliseconds, who.
Values, request bodies and anything under `/session` are never logged.

To check an installation end to end:

```bash
DL_DB_NAME=digital_loop_test npm test
```

186 server checks. The browser suite additionally needs Chrome with
`--headless=new --remote-debugging-port=9333`.
