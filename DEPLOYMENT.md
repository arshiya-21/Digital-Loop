# Deploying SandMan Digital Loop

Written for whoever installs and runs this on the plant's server.

Digital Loop is one Node service. It serves the studio (a browser application)
and its own API from a single port, and keeps its data in MySQL. It is opened
from SandMan and cannot be opened any other way.

---

## 1. What the machine needs

| | | |
|---|---|---|
| **Node.js** | **24 or newer** | the service uses `--env-file-if-exists`, which is not in older releases |
| **MySQL** | **8.0 or newer** | 5.7 will not do: the schema uses `CHECK` constraints and `utf8mb4` defaults |
| **Disk** | ~500 MB to start | the application is ~15 MB; the rest is uploaded artwork and SOP documents, which grow |
| **SandMan** | reachable over HTTP | Digital Loop refuses to open a session while SandMan is unreachable — this is deliberate |

One port, by default **5000**. It serves the studio *and* the API, so the
browser only ever needs that one address.

## 2. What you must be given before you start

Four things. The service **refuses to start** without the first three, by
design — none of them has a default, because a default secret is not a secret.

| | |
|---|---|
| `DL_DB_USER` / `DL_DB_PASSWORD` | a MySQL account |
| `SANDMAN_SECRET` | the shared secret. **Must be the same value as SandMan's `DIGITAL_LOOP_SECRET`** |
| `DL_SECRET_KEY` | 32 random bytes, used to encrypt stored database passwords |
| `SANDMAN_URL` | where SandMan is, e.g. `http://sandman.plant.local:8080/sandman` |

Generate the two keys with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**`DL_SECRET_KEY` cannot be recovered.** It encrypts the passwords of any plant
database an administrator registers in the studio. Lose it and every one of
those has to be entered again. Back it up somewhere other than beside the
database it protects — a key stored next to the ciphertext is decoration.

### The MySQL account

The service creates its database on first start and applies the schema on every
start, so the account needs `CREATE` as well as ordinary read and write:

```sql
CREATE USER 'digitalloop'@'localhost' IDENTIFIED BY '<a real password>';
GRANT ALL PRIVILEGES ON digital_loop.* TO 'digitalloop'@'localhost';
-- plus CREATE on the server, so it can make the database the first time:
GRANT CREATE ON *.* TO 'digitalloop'@'localhost';
FLUSH PRIVILEGES;
```

If you would rather not grant server-wide `CREATE`, make the database by hand
(`CREATE DATABASE digital_loop CHARACTER SET utf8mb4;`) and grant only on it.

**Do not use `root`.** It is what the development machine uses and it is wrong
here: this account can drop every database on the server.

## 3. Installing

```bash
git clone <the repository>  digital-loop
cd digital-loop
npm run setup
```

`npm run setup` installs the three workspaces and builds the studio. It needs
network access to npm.

Then create `backend/.env`:

```ini
# Database
DL_DB_HOST=127.0.0.1
DL_DB_PORT=3306
DL_DB_NAME=digital_loop
DL_DB_USER=digitalloop
DL_DB_PASSWORD=<the password>

# SandMan — the secret must match SandMan's DIGITAL_LOOP_SECRET exactly
SANDMAN_URL=http://sandman.plant.local:8080/sandman
SANDMAN_SECRET=<64 hex characters>

# Encrypts stored database passwords. No default, no recovery.
DL_SECRET_KEY=<64 hex characters>

# Where this service lives inside the URL. Everything — the page, its scripts
# and its API — is served under it, so there is one address, one origin and a
# session cookie scoped to this application rather than the whole domain.
DL_BASE_PATH=/sandman/digitalloop

# Which addresses may mint a launch. SandMan's address, nothing else.
LAUNCH_ALLOWED_IPS=127.0.0.1,::1,::ffff:127.0.0.1

# Behind HTTPS, both of these change — see "Running behind HTTPS" below.
COOKIE_SAMESITE=Lax
COOKIE_SECURE=false
```

`.env.example` in the repository lists every setting with an explanation.
Nothing in it is a real value.

Then, optionally, demo data:

```bash
npm run seed
```

This loads the 102 bundled equipment drawings and one example loop. The example
loop is filed under placeholder identifiers (`FND-MUNJAL-KIRU` / `LINE-1`) and
**real SandMan sends its own**, so nobody will ever open it — it is there to
prove the installation works, not to be used. The equipment drawings matter and
should be loaded.

## 4. Running

```bash
npm start
```

A correct start prints:

```
Digital Loop  http://localhost:5000/sandman/digitalloop
```

That is the whole address: the studio, its scripts and its API all live under
it, so there is one origin to configure and nothing else to open.

For the detail — which database, which SandMan, which addresses may mint a
launch — set `DL_VERBOSE=1`. It is worth doing once after any change to
`.env`, to confirm it is talking to what you think:

```
Digital Loop  http://localhost:5000/sandman/digitalloop

  studio + API  /sandman/digitalloop/  and  /sandman/digitalloop/api/v1
  sandman       http://sandman.plant.local:8080/sandman
  launches from 127.0.0.1, ::1, ::ffff:127.0.0.1
  database      mysql://digitalloop@127.0.0.1:3306/digital_loop
  auth          STUB — shared secret, not a signature. Not for production.
```

It refuses to start, and says exactly why, if a setting is missing or MySQL
cannot be reached. That is intentional: failing in front of whoever is
deploying is better than a 500 somebody else has to diagnose next week.

As a service, run `node --env-file-if-exists=.env src/server.js` from `backend/`
under systemd, NSSM or whatever the site uses. There is nothing to compile at
start and no warm-up.

## 5. ⚠ Before this carries real production data

**Authentication is a placeholder.** A launch is trusted because it carried the
shared secret. That is not a signature — anyone who learns the secret can mint a
session for any person, any plant and any role. `AUTH_MODE` refuses every value
but `stub` so that this cannot be forgotten.

Replacing it means one function: the secret check in
`backend/src/routes/sessions.js`, swapped for either

* **OIDC** — SandMan posts a signed assertion, verified against its JWKS
  (issuer, audience, expiry, signature), or
* **introspection** — SandMan sends an opaque token, posted to its
  introspection endpoint with this service's client credentials.

Everything else — the session, its scope, the guards — is unaffected.

### Running behind HTTPS

If the studio is served over HTTPS, or on a different domain from SandMan:

```ini
COOKIE_SECURE=true
COOKIE_SAMESITE=None   # only if SandMan and the studio are on different domains
```

`SameSite=None` is only honoured by browsers when `Secure` is set, which means
HTTPS. On the same domain (ports do not count), leave both as they are.

### The launch endpoint

`POST /api/v1/session/launch` is what mints a session. It is restricted by
address (`LAUNCH_ALLOWED_IPS`) and that check runs **before** the secret is
compared, so an attacker who cannot reach it never gets to guess. Port 5000 as a
whole cannot be firewalled — the browser needs it — so **keep
`/api/v1/session/launch` off any public reverse proxy.**

## 6. Backing up

Two things, and they must be taken **together**:

| | |
|---|---|
| the MySQL database | loops, every saved version, readings, limits, processes and SOP metadata, alarm history, registered databases |
| `backend/uploads/` | equipment artwork and uploaded SOP documents |

A design references its artwork by name. The database alone restores to a
drawing full of holes; the files alone are an orphan directory.

`DL_SECRET_KEY` is the third thing, and it belongs somewhere else entirely —
see above.

## 7. Checking it works

```bash
npm test
```

186 server checks plus a browser suite. The browser half needs Chrome with the
DevTools protocol open:

```bash
chrome --headless=new --remote-debugging-port=9333 about:blank
```

The suites create and delete their own data. Point them at a scratch database
first:

```bash
DL_DB_NAME=digital_loop_test npm test
```

## 8. If it will not start

| what it says | what it means |
|---|---|
| `DL_DB_USER is not set` | `backend/.env` is missing, or the service is not reading it |
| `MySQL at …:3306 could not be used` | wrong host, port, account or password; or MySQL is not running |
| `SANDMAN_SECRET is not set` | as above |
| `SANDMAN_SECRET is still the old development placeholder` | somebody copied a value from an old example |
| the studio opens but shows a locked screen | SandMan is not answering, or the secrets do not match on the two sides |
| `Something is already listening on port 5000` | a previous run was killed rather than stopped |

Every API call is logged as one line — method, path, status, milliseconds, and
who. Values, request bodies and anything under `/session` are deliberately never
logged.
