import { api } from './api.mjs'
import { peek } from './studio.mjs'

/**
 * The written procedures, from the server rather than from the drawing.
 *
 * The studio keeps a process's SOP inside the document — `DOC.cps[].sop` —
 * seeded from its own templates and saved with everything else as
 * `design_version.layout`. That did store the words, and it made them a
 * detail of a picture: a 78 KB JSON blob per version, rewritten whenever
 * somebody moves a conveyor, which cannot answer "which processes are still
 * on version 1.0" or "what is the reaction plan when compactability goes out
 * of limit" without parsing every version of every loop.
 *
 * So they have tables of their own — `sop`, `sop_step`, `sop_reaction` — and
 * this is the seam between them and the panel:
 *
 *   on open   whatever the server holds is written over `DOC.cps[].sop`, so
 *             every renderer the studio already has shows stored procedures
 *             without one of them being touched. A process the server has
 *             nothing for keeps what the drawing gave it, which is how a loop
 *             drawn before these tables existed still reads.
 *   on save   each process's procedure goes up as its own row, beside the
 *             version of the drawing.
 *
 * The copy in the layout is left where it is rather than stripped out. The
 * studio needs something to render before this has answered, and a document
 * that loses its procedures when opened by an older build is a worse failure
 * than a duplicate that is overwritten a moment later.
 */

/** The loop whose procedures are on screen, so a save knows what to write. */
let loopId = null

/** What the panel's own fields are called, for both directions. */
const toStudio = sop => ({
  v2: 1,
  no: sop.no || '',
  title: sop.title || '',
  version: sop.version || '1.0',
  effective: sop.effective || '',
  owner: sop.owner || '',
  approver: sop.approver || '',
  status: sop.status || 'Draft',
  reviewMonths: sop.reviewMonths ?? null,
  purpose: sop.purpose || '',
  scope: sop.scope || '',
  roles: sop.roles || [],
  ppe: sop.ppe || [],
  prestart: sop.prestart || [],
  steps: sop.steps || [],
  reaction: sop.reaction || [],
  refs: sop.refs || [],
  revisions: sop.revisions || [],
})

const fromStudio = (process, sop) => ({
  processName: process.name || '',
  no: sop.no || '',
  title: sop.title || '',
  version: sop.version || '1.0',
  status: sop.status || 'Draft',
  owner: sop.owner || '',
  approver: sop.approver || '',
  effective: sop.effective || '',
  reviewMonths: sop.reviewMonths ?? null,
  purpose: sop.purpose || '',
  scope: sop.scope || '',
  roles: sop.roles || [],
  ppe: sop.ppe || [],
  prestart: sop.prestart || [],
  refs: sop.refs || [],
  revisions: sop.revisions || [],
  steps: sop.steps || [],
  reaction: sop.reaction || [],
})

/**
 * Put the stored procedures on screen.
 *
 * Called once a loop is open. Failing is not fatal — the drawing's own copy is
 * still there and the panel still reads — so a server that cannot answer
 * leaves the studio working rather than refusing to show a procedure at all.
 */
export async function adopt(id) {
  loopId = id || null
  if (!loopId) return { adopted: 0 }

  let answer
  try {
    answer = await api.get(`/sops?loopId=${encodeURIComponent(loopId)}`)
  } catch (error) {
    console.error('Reading the stored procedures failed:', error)
    return { adopted: 0, error: error.message }
  }

  const processes = peek('DOC')?.cps
  if (!Array.isArray(processes)) return { adopted: 0 }

  const byProcess = new Map((answer?.sops || []).map(sop => [String(sop.processId), sop]))
  let adopted = 0
  for (const process of processes) {
    const stored = byProcess.get(String(process?.id))
    if (!stored) continue
    process.sop = toStudio(stored)
    adopted += 1
  }

  /*
   * The Process & SOP panel may already be open on one of them — redraw it
   * then, and only then. `cpRender` opens the panel when it is not showing,
   * so calling it unconditionally put Process & SOP over the loop every time
   * a loop with procedures was opened, the publish view included.
   */
  const panelOpen = !!document.getElementById('cpBody') &&
    !!document.getElementById('modal')?.classList.contains('on')
  if (adopted && panelOpen) window.cpRender?.()
  return { adopted, offered: byProcess.size }
}

/**
 * Store every procedure in the open loop.
 *
 * Called after the drawing has been saved, because a procedure is written
 * against a loop and the loop has to exist first. One request per process:
 * there are six of them on a full sand line, they are small, and a partial
 * failure then names the process it could not store instead of losing the lot.
 */
export async function store(id = loopId) {
  if (!id) return { stored: 0 }
  loopId = id

  const processes = peek('DOC')?.cps
  if (!Array.isArray(processes)) return { stored: 0 }

  let stored = 0
  const failed = []
  for (const process of processes) {
    if (!process?.id || !process.sop) continue
    try {
      await api.put(
        `/sops/${encodeURIComponent(id)}/${encodeURIComponent(process.id)}`,
        fromStudio(process, process.sop)
      )
      stored += 1
    } catch (error) {
      failed.push(`${process.name || process.id}: ${error.message}`)
    }
  }

  if (failed.length) console.error('Storing procedures failed for:', failed)
  return { stored, failed }
}

/** What is on screen and where it came from, for the tests and a console. */
export const status = () => ({
  loopId,
  processes: (peek('DOC')?.cps || []).map(process => ({
    id: process.id,
    name: process.name,
    no: process.sop?.no || null,
    version: process.sop?.version || null,
    steps: process.sop?.steps?.length ?? 0,
  })),
})
