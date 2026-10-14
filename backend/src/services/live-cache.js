import { config } from '../config/index.js'

/**
 * One read of the plant, shared by every studio looking at the same line.
 *
 * A control room with four terminals on one line is four studios polling every
 * thirty seconds for the same numbers. Without this that is four reads of the
 * foundry's database for an answer that cannot have changed between them, and
 * it gets worse with every screen somebody hangs on a wall.
 *
 * So an answer is kept for `valuesCacheMs` and handed to anyone who asks the
 * same question. The question is (foundry, line, exact tag list): two loops on
 * the same line that read different columns are different questions, and a
 * design that gains a reading stops matching the entry for the old one rather
 * than being served a stale shape.
 *
 * **The last good answer is kept past its life, and marked stale.** When
 * SandMan goes down the right thing to show an operator is the last real
 * reading with a grey badge, not a gap and certainly not a simulated number.
 * `stale` is how the route says which it is handing back.
 *
 * Nothing here is logged: the entries are plant readings.
 */

/** key → { at, payload }. One entry per distinct question. */
const entries = new Map()

/**
 * Bounded, because the key includes the tag list.
 *
 * An administrator editing a loop changes the tag set as they work, and each
 * shape is a new key. The cap is generous next to the number of lines a plant
 * has and small enough that a session of editing cannot grow this without
 * bound; the oldest entry goes first, which on a Map is insertion order.
 */
const MAX_ENTRIES = 200

const keyFor = (foundry, line, tags) =>
  `${foundry}\u0000${line}\u0000` +
  tags.map(t => [t.id, t.table, t.column, t.keyColumn || '', t.keyValue || ''].join('\u0001'))
    .join('\u0002')

/**
 * Ask once per window.
 *
 * `read` is only called when there is nothing fresh. If it throws — SandMan
 * down, timed out — a previous answer is returned marked stale, and the
 * failure is re-thrown only when there has never been one.
 */
export async function cachedValues(foundry, line, tags, read) {
  const key = keyFor(foundry, line, tags)
  const hit = entries.get(key)
  const now = Date.now()

  if (hit && now - hit.at < config.sandman.valuesCacheMs) {
    return { ...hit.payload, cached: true, stale: false }
  }

  try {
    const payload = await read()
    entries.set(key, { at: now, payload })
    if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value)
    return { ...payload, cached: false, stale: false }
  } catch (error) {
    if (!hit) throw error
    /*
     * Kept at its original age, not re-stamped.
     *
     * Re-stamping would make the entry look fresh and stop this trying
     * SandMan again until the window passed — exactly when it should be
     * trying. `since` is what lets the studio say how old the reading is.
     */
    return { ...hit.payload, cached: true, stale: true, since: new Date(hit.at).toISOString() }
  }
}

/** Forget everything — used by tests, which must not inherit a previous run. */
export const forgetValues = () => entries.clear()
