import { createRouter } from '../utils/router.js'

/**
 * `/api/v1/database` — the foundry's database, as SandMan described it.
 *
 * Names only: the database name, its tables, and each table's columns with
 * their types. It is what the studio builds its table and column dropdowns
 * from, so tagging a piece of equipment is choosing "preparedsand.moisture"
 * from a list rather than typing it and hoping.
 *
 * **Nothing here is a connection.** Digital Loop holds no credentials for this
 * database, never opens a connection to it and could not: all it has is the
 * list of names that arrived with the launch. Reading values out of it, when
 * that comes, is a SandMan API call made by this server — never by the browser.
 *
 * Scoped by the session and nothing else. The answer is the database of the
 * foundry the caller launched from; there is no parameter to ask for another
 * one, which is the simplest way for there to be no way to reach one.
 *
 * Both roles may read it. An operator never edits a tag, but the published
 * view shows which table and column each reading comes from, and that is the
 * same list.
 */

export const database = createRouter()

database.get('/', ({ user }) => {
  const held = user.database

  return {
    foundry: { id: user.foundry.id, name: user.foundry.name },
    name: held?.name || null,
    /**
     * Counted here so the studio does not have to add up five thousand columns
     * to print "239 tables".
     */
    tableCount: held?.tables.length ?? 0,
    columnCount: held
      ? held.tables.reduce((total, table) => total + table.columns.length, 0)
      : 0,
    tables: held?.tables ?? [],
  }
})
