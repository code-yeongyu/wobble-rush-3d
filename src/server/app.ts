/**
 * Hono application for Wobble Rush 3D: health + room creation endpoints,
 * WebSocket upgrade validation and forwarding to the per-room Durable Object,
 * and a static-asset fallback for everything else.
 *
 * This module deliberately has ZERO Cloudflare-typed imports so tests can
 * compile it under tsconfig.client.json; the entrypoint in index.ts supplies
 * the real bindings, which satisfy {@link GateEnv} structurally.
 */

import { Hono } from "hono"
import { PROTOCOL_VERSION } from "../shared/protocol"
import { generateRoomCode } from "../shared/room"
import type { BudgetKv } from "./breaker"
import { isPaused, makeBreakerReader, PAUSED_MESSAGE } from "./breaker"

/** Structural stand-in for DurableObjectId: the app never needs more than this. */
export type DurableObjectIdLike = { toString(): string }

/**
 * The binding surface the app reads. Method syntax keeps parameter checking
 * bivariant, so the real DurableObjectNamespace / Fetcher / KVNamespace
 * satisfy this shape while tests can implement it with plain objects.
 */
export type GateEnv = {
  readonly BUDGET: BudgetKv
  readonly ROOMS: {
    idFromName(name: string): DurableObjectIdLike
    get(id: DurableObjectIdLike): { fetch(request: Request): Promise<Response> }
  }
  readonly ASSETS: { fetch(request: Request): Promise<Response> }
  readonly CF_ANALYTICS_TOKEN: string
  readonly CF_ACCOUNT_ID: string
  readonly BILLING_ANCHOR_DAY: string
  readonly BUDGET_TRIP_RATIO: string
}

const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/

/** Uniform [0, 1) from a CSPRNG, injected into `generateRoomCode`. */
function randomFloat(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return (buffer[0] ?? 0) / 2 ** 32
}

/** Cached, fail-open verdict reader shared by every gated route. */
const readBreaker = makeBreakerReader()

const app = new Hono<{ Bindings: GateEnv }>()

app.get("/api/health", (c) => c.json({ ok: true, version: PROTOCOL_VERSION }))

app.post("/api/rooms", async (c) => {
  const nowMs = Date.now()
  const verdict = await readBreaker(c.env.BUDGET, nowMs)
  if (verdict !== null && isPaused(verdict, nowMs)) {
    return c.json(
      {
        error: { code: "service_paused", message: PAUSED_MESSAGE, resetsAt: verdict.resetsAtIso },
      },
      503,
    )
  }
  const code = generateRoomCode(randomFloat)
  return c.json({ code })
})

app.get("/api/status", async (c) => {
  const nowMs = Date.now()
  const verdict = await readBreaker(c.env.BUDGET, nowMs)
  const resetsAt = verdict !== null && isPaused(verdict, nowMs) ? verdict.resetsAtIso : null
  c.header("cache-control", "no-store")
  return c.json({ paused: resetsAt !== null, resetsAt })
})

app.get("/ws/:code", async (c) => {
  const upgrade = c.req.header("Upgrade")
  if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
    return c.json(
      { error: { code: "upgrade_required", message: "Expected a WebSocket upgrade request" } },
      426,
    )
  }
  const code = c.req.param("code")
  if (!ROOM_CODE_PATTERN.test(code)) {
    return c.json(
      {
        error: {
          code: "invalid_room_code",
          message: "Room code must be 4 uppercase letters (no I or O)",
        },
      },
      400,
    )
  }
  const nowMs = Date.now()
  const verdict = await readBreaker(c.env.BUDGET, nowMs)
  if (verdict !== null && isPaused(verdict, nowMs)) {
    return c.json(
      {
        error: { code: "service_paused", message: PAUSED_MESSAGE, resetsAt: verdict.resetsAtIso },
      },
      503,
    )
  }
  const id = c.env.ROOMS.idFromName(code)
  const stub = c.env.ROOMS.get(id)
  return stub.fetch(c.req.raw)
})

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw))

// biome-ignore lint/style/noDefaultExport: index.ts mounts this app as the Worker's fetch handler
export default app
