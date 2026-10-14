/**
 * The API and the studio watcher in one terminal.
 *
 * Most of the time you do not need this — `npm start` on its own is enough.
 * The backend serves `frontend/app` straight from disk, so everything in
 * `frontend/app/sandman/` (our integration) is picked up by reloading the
 * browser. Nothing there is compiled and nothing watches it.
 *
 * The watcher earns its place only when `frontend/studio/src/` is being
 * edited — the vendored studio, which `studio/patch.mjs` concatenates into
 * `app.js`. That is rare: a new drop replaces that directory wholesale, and
 * our own code lives outside it.
 *
 * Ctrl+C stops both.
 *
 * ## Why these are spawned as `node`, not as `npm run …`
 *
 * `npm` on Windows is `npm.cmd`, which has to go through a shell, and the
 * shell then runs the real process as a *grandchild*. Stopping the child kills
 * the shell and leaves the server holding port 5000 — so the next start fails
 * with a port clash that looks nothing like its cause, and somebody spends
 * twenty minutes on it. Spawning `node` directly means the child *is* the
 * server, and stopping it stops it.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Is something already listening there? */
const inUse = port => new Promise(done => {
  const socket = createConnection({ host: '127.0.0.1', port })
  socket.on('connect', () => { socket.destroy(); done(true) })
  socket.on('error', () => done(false))
  setTimeout(() => { socket.destroy(); done(false) }, 700)
})

const run = (name, cwd, args) => {
  const child = spawn(process.execPath, args, {
    cwd: resolve(ROOT, cwd),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Prefixed, so two streams in one terminal can still be told apart.
  const tag = line => `${name.padEnd(7)}│ ${line}`
  for (const stream of [child.stdout, child.stderr]) {
    let rest = ''
    stream.on('data', chunk => {
      const lines = (rest + chunk).split('\n')
      rest = lines.pop()
      for (const line of lines) console.log(tag(line))
    })
  }

  child.on('exit', code => {
    console.log(tag(`exited (${code})`))
    // Half a pair is not much use, and a half-running pair is the kind of
    // thing that wastes an afternoon.
    stop(code ?? 1)
  })

  return child
}

const children = []
let stopping = false

function stop(code) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    try { child.kill() } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(code), 200)
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))

/*
 * A port already in use is almost always a previous run that was killed
 * rather than stopped. Saying so is worth more than letting the server fail
 * with EADDRINUSE three lines into its own startup.
 */
const PORT = Number(process.env.PORT) || 5000
if (await inUse(PORT)) {
  console.error(
    `\nSomething is already listening on port ${PORT}.\n\n` +
    'Most likely a Digital Loop left running from before. Stop it first:\n' +
    `    netstat -ano | findstr :${PORT}\n` +
    '    taskkill /PID <pid> /F\n'
  )
  process.exit(1)
}

console.log(
  '\nStarting the API and the studio watcher. Ctrl+C stops both.\n' +
  'Editing frontend/app/sandman/ needs neither — just reload the browser.\n'
)

children.push(run('api', 'backend', ['--env-file-if-exists=.env', 'src/server.js']))
children.push(run('studio', 'frontend', ['studio/patch.mjs', '--watch']))
