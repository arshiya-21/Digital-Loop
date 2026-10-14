import { generateKeyPairSync, createPublicKey, randomBytes } from 'node:crypto'

/**
 * Keys for reaching a database through a jump box.
 *
 * When a plant database is not directly reachable, the connection goes through
 * SSH. Rather than ask somebody to paste a private key into a web form — which
 * means it has existed in a browser, a clipboard and probably a chat message —
 * this generates the pair here: the private half is sealed into the database
 * and never leaves, and the public half is shown so it can be installed on the
 * jump box.
 *
 * Ed25519 rather than RSA: small, fast, and no key size to get wrong. Every
 * OpenSSH since 6.5 (2014) accepts it.
 *
 * The public key has to be in OpenSSH's own wire format — `ssh-ed25519
 * AAAAC3Nz…` — because that is what `authorized_keys` reads. Node exports SPKI
 * DER, so the 32 raw bytes are taken out of that and re-encoded. For Ed25519
 * the DER is a fixed 44 bytes with the key as the last 32, which is what makes
 * this short enough to do by hand instead of taking a dependency.
 */

/** An OpenSSH wire string: 4-byte big-endian length, then the bytes. */
const field = buffer =>
  Buffer.concat([
    Buffer.from([buffer.length >>> 24, (buffer.length >>> 16) & 255, (buffer.length >>> 8) & 255, buffer.length & 255]),
    buffer,
  ])

/** The `ssh-ed25519 AAAA… comment` line for an Ed25519 public key. */
export function opensshPublicKey(publicKey, comment = 'digital-loop') {
  const der = createPublicKey(publicKey).export({ type: 'spki', format: 'der' })
  const raw = der.subarray(der.length - 32)
  const blob = Buffer.concat([field(Buffer.from('ssh-ed25519')), field(raw)])
  return `ssh-ed25519 ${blob.toString('base64')} ${comment}`
}

/**
 * The private key, in OpenSSH's own container.
 *
 * Node exports PKCS#8, which ssh2 refuses for Ed25519 — it reads only
 * `-----BEGIN OPENSSH PRIVATE KEY-----`. The container is well defined and
 * short, so it is written here rather than taken as a dependency or dodged by
 * falling back to RSA, whose `ssh-rsa` signatures OpenSSH 8.8 turned off by
 * default.
 *
 * Unencrypted — cipher "none" — because the file never touches a disk in this
 * form: it is sealed by `secrets.js` before it is stored and opened only in
 * memory to make a connection. A passphrase here would be a second secret with
 * nowhere better to live than beside the first.
 */
function opensshPrivateKey(privateKeyPem, publicKeyPem, comment) {
  const der = Buffer.from(
    privateKeyPem.replace(/-----[^-]+-----|\s/g, ''), 'base64'
  )
  // PKCS#8 Ed25519 is a fixed 48 bytes and the 32-byte seed is the tail.
  const seed = der.subarray(der.length - 32)
  const spki = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  const pub = spki.subarray(spki.length - 32)

  const keyBlob = Buffer.concat([field(Buffer.from('ssh-ed25519')), field(pub)])

  // Two matching check integers prove the section decrypted correctly. There
  // is nothing to decrypt here, but the format still carries them.
  const check = randomBytes(4)
  let secret = Buffer.concat([
    check, check,
    field(Buffer.from('ssh-ed25519')),
    field(pub),
    field(Buffer.concat([seed, pub])),
    field(Buffer.from(comment)),
  ])
  // Padded to the cipher block size with 1, 2, 3… even for cipher "none".
  for (let i = 1; secret.length % 8 !== 0; i += 1) {
    secret = Buffer.concat([secret, Buffer.from([i])])
  }

  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'binary'),
    field(Buffer.from('none')),   // cipher
    field(Buffer.from('none')),   // kdf
    field(Buffer.alloc(0)),       // kdf options
    Buffer.from([0, 0, 0, 1]),    // one key
    field(keyBlob),
    field(secret),
  ])

  const base64 = body.toString('base64').match(/.{1,70}/g).join('\n')
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${base64}\n-----END OPENSSH PRIVATE KEY-----\n`
}

/**
 * A fresh pair for one connection.
 *
 * Returns the private key in the OpenSSH container ssh2 reads, and the public
 * key as the one line to paste into `authorized_keys` on the jump box.
 */
export function generateTunnelKeyPair(comment = 'digital-loop') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return {
    privateKey: opensshPrivateKey(privateKey, publicKey, comment),
    publicKey: opensshPublicKey(publicKey, comment),
  }
}
