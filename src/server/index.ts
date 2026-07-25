/**
 * Worker entrypoint for Wobble Rush 3D.
 *
 * Thin HTTP layer: health + room creation endpoints, WebSocket upgrade
 * validation and forwarding to the per-room Durable Object, and a static-asset
 * fallback for everything else. Wrangler resolves the `RoomDurableObject`
 * class from this module's exports.
 */

import { Hono } from "hono"
import { PROTOCOL_VERSION } from "../shared/protocol"
import { generateRoomCode } from "../shared/room"
import type { Env } from "./room-do"

export { RoomDurableObject } from "./room-do"

const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/

/** Uniform [0, 1) from a CSPRNG, injected into `generateRoomCode`. */
function randomFloat(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return (buffer[0] ?? 0) / 2 ** 32
}

const app = new Hono<{ Bindings: Env }>()

app.get("/api/health", (c) => c.json({ ok: true, version: PROTOCOL_VERSION }))

app.post("/api/rooms", (c) => {
  const code = generateRoomCode(randomFloat)
  return c.json({ code })
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
  const id = c.env.ROOMS.idFromName(code)
  const stub = c.env.ROOMS.get(id)
  return stub.fetch(c.req.raw)
})

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw))

// biome-ignore lint/style/noDefaultExport: the Workers runtime requires a default-exported handler
export default app
