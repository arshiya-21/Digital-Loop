import { createRouter } from '../utils/router.js'

/**
 * `/api/v1/me` — who the caller is, and what they can reach.
 *
 * The studio asks this once at boot and never again. It is the answer to
 * "am I designing or viewing?", and it comes from the server precisely because
 * the link that opened the studio cannot be trusted to say.
 *
 * Every field is read out of the session, which came from SandMan's launch.
 * There is no lookup because there is nothing here to look in: this service
 * keeps no foundries, no lines and no accounts of its own.
 *
 * The shape is unchanged — `foundries[].lines[]`, with ids and `sandmanFoundryId`
 * / `sandmanLineId` — because the studio's context resolution is built on it.
 * `id` and the SandMan id are now the same value: SandMan's, since that is the
 * only identifier either side agrees on.
 */

export const identity = createRouter()

identity.get('/', ({ user }) => ({
  id: user.sandmanUserId,
  sandmanUserId: user.sandmanUserId,
  name: user.name,
  email: user.email,
  role: user.role,
  /** What this account may do, stated rather than inferred from the role. */
  access: user.role === 'admin' ? ['design', 'publish', 'view'] : ['view'],
  /**
   * One foundry, always: a launch opens one plant. It is still a list because
   * that is the shape the studio reads, and because an account that can reach
   * several plants opens each through its own launch.
   */
  foundries: [
    {
      id: user.foundry.id,
      name: user.foundry.name,
      sandmanFoundryId: user.foundry.id,
      lines: user.lines.map(line => ({
        id: line.id,
        name: line.name,
        sandmanLineId: line.id,
      })),
    },
  ],
  /**
   * The line SandMan opened on, when it named one.
   *
   * It used to come back from redeeming the ticket. There is no redeem reply
   * any more — the ticket is posted and answered with a redirect — so the
   * studio reads it here, from the session, like everything else.
   */
  line: user.lineId || null,
}))
