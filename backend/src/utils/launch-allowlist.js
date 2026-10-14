import { config } from '../config/index.js'

/**
 * Who may mint a launch.
 *
 * Port 5000 serves the studio as well as the API, so it cannot simply be
 * firewalled — the browser has to reach it. The launch endpoint is restricted
 * by address instead, and checked before the shared secret, so somebody who
 * cannot reach it never gets to make guesses at the secret either.
 *
 * The address compared is `req.socket.remoteAddress`: the peer the packets
 * actually came from. `X-Forwarded-For` is deliberately not consulted — it is
 * a request header, so anybody can write `127.0.0.1` in it, and trusting it
 * would turn this check into decoration. Express's `trust proxy` is off for
 * the same reason.
 *
 * In its own file, with no database and no routes behind it, so a test can
 * check it directly rather than by trying to make a request arrive from an
 * address this machine does not have.
 */
export function launchAllowed(remoteAddress, allowed = config.launchAllowedIps) {
  if (!remoteAddress) return false

  const address = String(remoteAddress)
  // An IPv4 peer on a dual-stack socket arrives as ::ffff:127.0.0.1. Compare
  // both forms, so an allowlist written either way means what it looks like.
  const bare = address.startsWith('::ffff:') ? address.slice(7) : address
  return allowed.includes(address) || allowed.includes(bare)
}
