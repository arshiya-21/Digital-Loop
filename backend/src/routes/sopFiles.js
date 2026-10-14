import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

import { db, now, audit } from '../config/db.js'
import { createRouter } from '../utils/router.js'
import { rawReply, noContent } from '../utils/respond.js'
import { loopToView, loopToDesign } from '../utils/loop-access.js'
import { badRequest, notFound, unprocessable } from '../utils/errors.js'
import { config } from '../config/index.js'

/**
 * API 7 — SOP DOCUMENTS
 *
 * The written procedure for a process: a PDF, a spreadsheet, a Word file.
 *
 * **The studio keeps these in the browser.** Its own release notes say so —
 * IndexedDB, with a line telling whoever ships it to replace that with a real
 * backend. In a browser a procedure is invisible to the next terminal, gone
 * when somebody clears site data, and absent from every backup. For a document
 * that tells an operator how to run a sand line, that is not storage.
 *
 * So this is that backend. The studio mints a file id and hands over the
 * bytes; this keeps the bytes beside the equipment artwork and a row saying
 * what they are. The studio's own `sfPut` / `sfGet` / `sfDel` are pointed here
 * from the integration layer — see `frontend/app/sandman/sop-files.mjs`.
 *
 * **Access follows the loop.** A document belongs to a design; anybody who may
 * open that design may read its documents, and only somebody who may design it
 * may add or remove one. There is no separate sharing model, because a
 * procedure is part of the loop it describes.
 */

export const sopFiles = createRouter()

const DIR = resolve(config.paths.uploads, '..', 'sop')

/** `id` comes from the studio, so it is checked rather than trusted. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/

const pathFor = id => resolve(DIR, id)

/**
 * What a browser may be told to open inline.
 *
 * A PDF is shown in place and the rest is downloaded. Anything not on this
 * list is served as a download with a generic type: an uploaded file is
 * somebody's document, not something this service should invite the browser
 * to interpret.
 */
const INLINE = new Set(['application/pdf'])

const publicShape = row => ({
  id: row.id,
  loopId: row.design_id,
  name: row.name,
  mime: row.mime,
  bytes: row.bytes,
  uploadedBy: row.uploaded_by,
  createdAt: row.created_at,
})

const fileById = async id => {
  const row = await db.prepare('SELECT * FROM sop_file WHERE id = ?').get(id)
  if (!row) throw notFound('That document is not stored here.')
  return row
}

/* --------------------------------------------------------------- reading ---*/

/** Every document stored against a loop. Metadata only — never the bytes. */
sopFiles.get('', async ({ user, query }) => {
  const loop = await loopToView(user, query.loopId)
  const rows = await db
    .prepare('SELECT * FROM sop_file WHERE design_id = ? ORDER BY created_at DESC')
    .all(loop.id)
  return { loopId: loop.id, count: rows.length, documents: rows.map(publicShape) }
})

/**
 * The document itself.
 *
 * Served defensively: `nosniff` and a sandbox, because this is a file somebody
 * uploaded and the one thing it must not do is run as script in the studio's
 * own origin.
 */
sopFiles.get('/:fileId', async ({ user, params }) => {
  const row = await fileById(params.fileId)
  // The loop decides: this throws for anybody who may not open it.
  await loopToView(user, row.design_id)

  const path = pathFor(row.id)
  if (!existsSync(path)) throw notFound('The document is recorded but its file is missing.')

  const disposition = INLINE.has(row.mime) ? 'inline' : 'attachment'
  return rawReply(
    200,
    {
      'content-type': row.mime,
      'content-disposition': `${disposition}; filename="${row.name.replace(/["\r\n]/g, '')}"`,
      'cache-control': 'private, no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
    readFileSync(path)
  )
})

/* --------------------------------------------------------------- writing ---*/

/**
 * Store a document under the id the studio minted.
 *
 * The body is the file itself; the name and type come from headers, because a
 * multipart parser is a dependency and a parser for one field is a liability.
 * Re-uploading the same id replaces it, which is what "replace this version's
 * file" means in the studio.
 */
sopFiles.put('/:fileId', async ({ user, params, query, req }) => {
  const id = String(params.fileId)
  if (!SAFE_ID.test(id)) throw badRequest('invalid_id', 'That is not a usable document id.')

  const loop = await loopToDesign(user, query.loopId)

  const body = req.body
  if (!Buffer.isBuffer(body) || !body.length) {
    throw badRequest('empty_body', 'The request carried no file.')
  }
  if (body.length > config.limits.sopFileBytes) {
    throw unprocessable(
      'file_too_large',
      `A document may be at most ${Math.round(config.limits.sopFileBytes / 1048576)} MB.`
    )
  }

  const name = String(req.get('x-file-name') || 'document').slice(0, 255)
  const mime = String(req.get('x-file-type') || 'application/octet-stream').slice(0, 160)

  mkdirSync(DIR, { recursive: true })
  writeFileSync(pathFor(id), body)

  /*
   * Replaced rather than refused if it is already there: the studio's "Replace
   * file" fixes the current version in place, and it uses the same id.
   */
  await db.prepare(
    `INSERT INTO sop_file (id, design_id, name, mime, bytes, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), mime = VALUES(mime), bytes = VALUES(bytes)`
  ).run(id, loop.id, name, mime, body.length, user.id, now())

  // The name and size only. Never the contents.
  await audit(user.id, 'sop.upload', 'sop_file', id, { loopId: loop.id, name, bytes: body.length })

  return publicShape(await fileById(id))
})

/** Remove a document, bytes and all. */
sopFiles.delete('/:fileId', async ({ user, params }) => {
  const row = await fileById(params.fileId)
  await loopToDesign(user, row.design_id)

  const path = pathFor(row.id)
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch (error) {
      // A row with no file is recoverable; a file with no row is an orphan
      // nobody will ever find. The row goes either way, and this is said.
      console.error(`   !  sop file ${row.id} could not be removed  ${error.message}`)
    }
  }

  await db.prepare('DELETE FROM sop_file WHERE id = ?').run(row.id)
  await audit(user.id, 'sop.delete', 'sop_file', row.id, { loopId: row.design_id, name: row.name })
  return noContent()
})
