/**
 * Worker entrypoint for Wobble Rush 3D.
 *
 * Thin shell: the Hono app lives in app.ts (kept free of Cloudflare-typed
 * imports so tests can compile it), the scheduled budget check lives in
 * budget-cron.ts. Wrangler resolves the `RoomDurableObject` class from this
 * module's exports. This file is compiled only by tsconfig.server.json, so
 * Workers globals (ScheduledController, ExecutionContext) are fine here.
 */

import { app } from "./app"
import { runBudgetCron } from "./budget-cron"
import type { Env } from "./room-do"

export { RoomDurableObject } from "./room-do"

// biome-ignore lint/style/noDefaultExport: the Workers runtime requires a default-exported handler
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runBudgetCron(env, fetch))
  },
}
