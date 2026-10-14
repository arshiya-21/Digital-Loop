import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

import { config } from '../config/index.js'

/**
 * Sealing the one kind of secret this service stores.
 *
 * Digital Loop holds no credentials of its own — SandMan owns the accounts,
 * and the foundry's database arrives described but unreachable. The exception
 * is a database an administrator registers by hand, which this service
 * connects to itself: that needs a password, and sometimes an SSH private key.
 *
 * Those are sealed here with AES-256-GCM before they reach SQLite, under a key
 * that must come from the environment. The point is that a copy of the
 * database file is not a copy of the credentials: somebody who takes
 * `digital-loop.db` off a backup disk has ciphertext and nothing to open it
 * with.
 *
 * GCM rather than CBC because it authenticates as well as encrypts — a
 * tampered row fails to open rather than decrypting to rubbish that gets
 * handed to a connection string.
 *
 * **There is no key escrow and no recovery.** Lose `DL_SECRET_KEY` and every
 * stored password has to be entered again, which is the correct trade: the
 * alternative is a key derivable from something that ships with the code,
 * which is not a key at all.
 */

const VERSION = 'v1'

/** A missing or weak key is refused loudly, not defaulted to something. */
function key() {
  const raw = config.secretKey
  if (!raw) {
    throw new Error(
      'DL_SECRET_KEY is not set, so database credentials cannot be stored. ' +
      'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    )
  }
  // 64 hex characters is the intended form. Anything else is accepted but
  // hashed to 32 bytes, so a passphrase works rather than failing obscurely.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  if (raw.length < 16) {
    throw new Error('DL_SECRET_KEY is too short. Use 64 hex characters, or a long passphrase.')
  }
  return createHash('sha256').update(raw).digest()
}

/** Is a key configured? Used to refuse the feature cleanly rather than at write time. */
export function sealingAvailable() {
  try {
    key()
    return true
  } catch {
    return false
  }
}

/**
 * Seal a secret. Returns `v1:<iv>:<tag>:<ciphertext>`, all base64url.
 *
 * The version prefix is there so a future change of algorithm can read what
 * this wrote instead of orphaning every stored password.
 */
export function seal(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join(':')
}

/** Open a sealed secret. Throws if the key is wrong or the row was tampered with. */
export function open(sealed) {
  if (!sealed) return null

  const [version, iv, tag, body] = String(sealed).split(':')
  if (version !== VERSION || !iv || !tag || !body) {
    throw new Error('This stored secret is not in a format this version understands.')
  }

  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new Error(
      'A stored credential could not be opened. DL_SECRET_KEY has changed, ' +
      'or the row was altered — the password will have to be entered again.'
    )
  }
}
