/**
 * The Fault alarm panel's chosen readings, kept in the database.
 *
 * The picker (✎ Choose) used to write only into the open document, which
 * reaches the database when the whole loop is next saved and is lost if it
 * never is. Here the selection is stored on its own the moment Save is pressed
 * in the picker, and read back when the loop is opened, so what was ticked is
 * what comes back on any screen.
 *
 * Nothing stored means nobody has chosen yet: the document's own value (or the
 * suggested set) stands.
 */
import { api } from './api.mjs'
import { peek } from './studio.mjs'

let loopId = null

/** Read the stored selection into the open loop. Call after the loop is drawn. */
export async function adopt(id) {
  loopId = id || null
  if (!loopId) return { adopted: false }
  let answer
  try {
    answer = await api.get(`/monitor/${encodeURIComponent(loopId)}`)
  } catch (error) {
    console.error('Reading the monitored parameters failed:', error)
    return { adopted: false, error: error.message }
  }
  const doc = peek('DOC')
  if (!doc || !answer?.chosen || !Array.isArray(answer.tags)) return { adopted: false }
  doc.mon = doc.mon || { on: true, tags: null }
  doc.mon.tags = answer.tags.slice()
  window.mpRender?.(true)
  return { adopted: true, count: answer.tags.length }
}

/** Store a selection. The studio calls this from the picker's Save. */
export async function store(tags) {
  if (!loopId) return { stored: false }
  try {
    await api.put(`/monitor/${encodeURIComponent(loopId)}`, { tags })
    return { stored: true }
  } catch (error) {
    console.error('Storing the monitored parameters failed:', error)
    window.toast?.(`Could not save the monitored parameters to the database: ${error.message}`)
    return { stored: false, error: error.message }
  }
}

export function install() {
  window.dlMonitorStore = tags => store(tags)
}
