/**
 * A stand-in for SandMan's liveness endpoint, for running the browser suite
 * without Tomcat.
 *
 *     node tests/sandman-stub.mjs       # then: npm test
 *
 * The API refuses to redeem a launch while SandMan is unreachable — that is
 * the point of the handshake, and the suite refuses to run rather than report
 * a wall of failures. So checking anything in the studio needs *something* at
 * that address.
 *
 * It answers the one endpoint the liveness check asks for, and says plainly
 * that it is a stub. `service: "sandman"` is what the check looks for: an
 * endpoint that merely answers 200 is not proof it is SandMan answering.
 *
 * **Stop it when the real SandMan is wanted.** It binds the same port, so a
 * stub left running is a Tomcat that cannot start and a "Back" link that goes
 * somewhere fake.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.STUB_PORT) || 8080
const HEALTH = '/sandman/api/su/digital-loop/health'

const server = createServer((req, res) => {
  if (req.url.startsWith(HEALTH)) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ service: 'sandman', stub: true }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><title>SandMan (stub)</title>' +
    '<p>This is the liveness stub from frontend/tests, not SandMan.</p>')
})

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use — most likely the real SandMan, which is\n` +
      'what you want. Nothing to do.'
    )
    process.exit(0)
  }
  throw error
})

server.listen(PORT, () => {
  console.log(`SandMan liveness stub on :${PORT}${HEALTH}`)
  console.log('Stop it before starting the real SandMan — they share this port.')
})
