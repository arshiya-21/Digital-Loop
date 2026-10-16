/**
 * Process checks, from the plant's own values.
 *
 * Two things about the Process & SOP panel were untrue on a plant screen.
 *
 * **Invented records.** `cpSeedByType` fills the checkpoint log with made-up
 * history so the panel looks populated with nothing behind it — measured
 * values derived from the limits, timestamps spread across the last shift,
 * four invented operators, and one check deliberately left unrecorded so
 * something shows as overdue:
 *
 *     // demo records so the consolidated view is meaningful in the prototype
 *     by: ['R. Patil', 'S. Kulkarni', 'A. Jadhav', 'M. Shinde'][k % 4]
 *     if (k === 6) return;   // never recorded → overdue
 *
 * That is what "Checks 8% OK · 24 overdue" was counting. Nobody did those
 * checks, and the names are of people who do not work there.
 *
 * **Limits that raised nothing.** `ALCFG.limitAlarms` is false unless the
 * embedding page sets `SANDMAN_ALARM_MODE`, and nothing did — so the LL / L /
 * H / HH somebody typed coloured the reading and the equipment but never
 * reached the Fault alarm list or its history. The alarms came only from the
 * custom rules on the Alerts tab.
 *
 * So: nothing is recorded that nobody recorded, and the limits raise alarms
 * from the live value.
 *
 * ## What each check now shows
 *
 *   automatic   read from the reading it is bound to, against its limits —
 *               `cpStatus` already did this, and `val()` returns nothing until
 *               a record arrives, so an unlinked one reads "No data"
 *   manual      "never recorded" until somebody records one
 *
 * Both are the honest answer, and both follow the value rather than a fixture.
 */
import { peek } from './studio.mjs'

/**
 * Records invented in earlier sessions are in `localStorage` already.
 *
 * The seeding persisted what it made up, so a browser that opened the studio
 * before this existed is carrying that history and would keep showing it —
 * stopping the seeder only stops it happening again. This clears it once, and
 * the flag is what stops it clearing anything recorded afterwards.
 */
const CLEARED = 'dl-cp-log-cleared'
const LOG_KEY = 'sandman-cp-log'

function clearInventedHistoryOnce() {
  try {
    if (localStorage.getItem(CLEARED) === '1') return
    const log = peek('CPLOG')
    if (log) for (const id of Object.keys(log)) delete log[id]
    localStorage.removeItem(LOG_KEY)
    localStorage.setItem(CLEARED, '1')
  } catch {
    // A browser with storage blocked has nothing persisted to clear.
  }
}

/**
 * Let the seeder build the checks, and take back the records it invented.
 *
 * `cpSeedByType` does two jobs in one call: it works out which checks apply to
 * the equipment on the flowsheet — which is wanted, and is derived from the
 * loop rather than made up — and then fills their log with fiction. Only the
 * second is removed, by noticing what the call added.
 *
 * A record is identified by its timestamp, which is what the log is keyed on
 * internally and is unique per record within a check.
 */
function stopInventingRecords() {
  const original = window.cpSeedByType
  if (typeof original !== 'function' || original.__dlNoFixtures) return

  const replaced = function cpSeedByTypeWithoutFixtures(...args) {
    const log = peek('CPLOG')
    if (!log) return original.apply(this, args)

    const before = new Map(
      Object.entries(log).map(([id, list]) => [id, new Set((list || []).map(record => record.t))])
    )

    const result = original.apply(this, args)

    for (const [id, list] of Object.entries(log)) {
      const kept = (list || []).filter(record => before.get(id)?.has(record.t))
      if (kept.length) log[id] = kept
      else delete log[id]
    }
    window.cpSaveLog?.()

    return result
  }

  replaced.__dlNoFixtures = true
  replaced.original = original
  window.cpSeedByType = replaced
}

/**
 * The limits raise alarms.
 *
 * Set through the studio's own API rather than by writing `SANDMAN_ALARM_MODE`
 * on `window`: that is read once while the studio's scripts evaluate, and this
 * module is deferred by definition, so by the time it runs the decision has
 * been made. `alarmConfig` is the way to change it afterwards.
 *
 * `both` rather than `limits`: the custom rules on the Alerts tab are somebody
 * else's deliberate configuration and turning them off is not ours to do.
 */
function raiseAlarmsFromLimits() {
  window.SandmanStudio?.alarmConfig?.({ limitAlarms: true })
}

export function install() {
  raiseAlarmsFromLimits()
  stopInventingRecords()
  clearInventedHistoryOnce()
}

/** What the checks are reading, for the tests and for a console. */
export const status = () => {
  const log = peek('CPLOG') || {}
  return {
    limitAlarms: !!peek('ALCFG')?.limitAlarms,
    recorded: Object.entries(log).map(([id, list]) => ({ id, records: (list || []).length })),
  }
}
