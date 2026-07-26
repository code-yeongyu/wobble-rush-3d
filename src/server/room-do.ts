/**
 * RoomDurableObject — one Durable Object instance per room code.
 *
 * Owns a single {@link RoomState} (persisted to storage so it survives
 * WebSocket Hibernation) and translates between WebSocket frames and the pure
 * `reduceRoom` state machine. All game rules live in `src/shared/room.ts`;
 * this class only moves bytes, applies effects and drives the alarm clock.
 */

import { DurableObject } from "cloudflare:workers"
import type { ClientMessage } from "../shared/protocol"
import { decodeClientMessage, encodeServerMessage, ProtocolError } from "../shared/protocol"
import type { RoomAction, RoomEffect, RoomState } from "../shared/room"
import { createRoom, reduceRoom } from "../shared/room"
import type { PlayerId } from "../shared/types"
import { asPlayerId, asRoomCode, assertNever } from "../shared/types"
import { isPaused, makeBreakerReader, PAUSED_MESSAGE } from "./breaker"
import { blockedWhilePaused, drainOnPause, gateRoomFetch } from "./drain-policy"

export type Env = {
  readonly ROOMS: DurableObjectNamespace
  readonly ASSETS: Fetcher
  readonly BUDGET: KVNamespace
  readonly CF_ANALYTICS_TOKEN: string
  readonly CF_ACCOUNT_ID: string
  readonly BILLING_ANCHOR_DAY: string
  readonly BUDGET_TRIP_RATIO: string
  readonly BUDGET_PLAN_TIER: string
}

const STORAGE_KEY = "room"
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/
/** Practical floor for alarm re-arms: DO alarms have second granularity. */
const ALARM_INTERVAL_MS = 1000

/** Cached breaker reader shared by every pause gate in this isolate. */
const readBreaker = makeBreakerReader()

/** Per-connection state persisted across hibernation on the socket itself. */
type Attachment = { readonly playerId: string }

function readAttachment(raw: unknown): Attachment | null {
  if (typeof raw !== "object" || raw === null) return null
  if (!("playerId" in raw)) return null
  const playerId = raw.playerId
  return typeof playerId === "string" ? { playerId } : null
}

function randomSeed(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] ?? 0
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function toAction(message: ClientMessage, id: PlayerId): RoomAction {
  switch (message.type) {
    case "join":
      return { kind: "join", id, name: message.name, colorIndex: message.colorIndex }
    case "ready":
      return { kind: "ready", id, ready: message.ready }
    case "state":
      return {
        kind: "state",
        id,
        state: {
          id,
          p: message.p,
          v: message.v,
          yaw: message.yaw,
          st: message.st,
          cp: message.cp,
        },
      }
    case "finish":
      return { kind: "finish", id, timeMs: message.timeMs }
    case "restart":
      return { kind: "restart", id }
    case "leave":
      return { kind: "leave", id }
    default:
      return assertNever(message, "ClientMessage")
  }
}

export class RoomDurableObject extends DurableObject<Env> {
  private pausedSinceMs: number | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Answer keepalives without waking the isolate out of hibernation.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
  }

  private async loadRoom(): Promise<RoomState | null> {
    const stored = await this.ctx.storage.get<RoomState>(STORAGE_KEY)
    return stored ?? null
  }

  private async saveRoom(state: RoomState): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, state)
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = url.pathname.split("/").filter((s) => s.length > 0)
    const code = segments.at(-1) ?? ""
    if (!ROOM_CODE_PATTERN.test(code)) {
      return jsonError(
        400,
        "invalid_room_code",
        "Room code must be 4 uppercase letters (no I or O)",
      )
    }
    const upgrade = request.headers.get("Upgrade")
    if (upgrade === null || upgrade.toLowerCase() !== "websocket") {
      return jsonError(426, "upgrade_required", "Expected a WebSocket upgrade request")
    }

    if (gateRoomFetch(await readBreaker(this.env.BUDGET, Date.now()), Date.now())) {
      return jsonError(503, "service_paused", PAUSED_MESSAGE)
    }

    let room = await this.loadRoom()
    if (room === null) {
      room = createRoom(asRoomCode(code), randomSeed())
      await this.saveRoom(room)
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const playerId = asPlayerId(crypto.randomUUID())
    server.serializeAttachment({ playerId } satisfies Attachment)
    this.ctx.acceptWebSocket(server)
    server.send(
      encodeServerMessage({
        type: "welcome",
        you: playerId,
        room: room.code,
        seed: room.seed,
        snapshot: room,
      }),
    )
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = readAttachment(ws.deserializeAttachment())
    if (attachment === null) {
      ws.close(1008, "missing session attachment")
      return
    }
    const room = await this.loadRoom()
    if (room === null) {
      ws.close(1011, "room state lost")
      return
    }
    const playerId = asPlayerId(attachment.playerId)

    let decoded: ClientMessage
    try {
      decoded = decodeClientMessage(message)
    } catch (e) {
      if (e instanceof ProtocolError) {
        // Malformed frames are answered, then the socket is dropped — the
        // DO itself keeps running.
        ws.send(encodeServerMessage({ type: "error", code: "protocol", message: e.message }))
        ws.close(1008, "protocol error")
        return
      }
      throw e
    }

    if (
      blockedWhilePaused(decoded.type) &&
      gateRoomFetch(await readBreaker(this.env.BUDGET, Date.now()), Date.now())
    ) {
      ws.send(
        encodeServerMessage({ type: "error", code: "service_paused", message: PAUSED_MESSAGE }),
      )
      ws.close(1001, "service paused")
      return
    }

    const { state, effects } = reduceRoom(room, toAction(decoded, playerId), Date.now())
    await this.saveRoom(state)
    await this.applyEffects(effects)
    if (decoded.type === "leave") {
      ws.close(1000, "left")
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.handleLeave(ws)
  }

  override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.handleLeave(ws)
  }

  override async alarm(): Promise<void> {
    const room = await this.loadRoom()
    if (room === null) return
    const now = Date.now()
    if (isPaused(await readBreaker(this.env.BUDGET, now), now)) {
      this.pausedSinceMs ??= now
      if (drainOnPause(room.phase, now - this.pausedSinceMs)) {
        const frame = encodeServerMessage({
          type: "error",
          code: "service_paused",
          message: PAUSED_MESSAGE,
        })
        for (const socket of this.ctx.getWebSockets()) {
          socket.send(frame)
          socket.close(1001, "service paused")
        }
        // No re-arm: the drained room goes idle.
        return
      }
    } else {
      this.pausedSinceMs = null
    }
    const { state, effects } = reduceRoom(room, { kind: "tick" }, now)
    await this.saveRoom(state)
    await this.applyEffects(effects)
    // Re-arm while the room is occupied; an empty room goes idle.
    if (state.players.length > 0) {
      await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS)
    }
  }

  private async handleLeave(ws: WebSocket): Promise<void> {
    const attachment = readAttachment(ws.deserializeAttachment())
    if (attachment === null) return
    const room = await this.loadRoom()
    if (room === null) return
    const { state, effects } = reduceRoom(
      room,
      { kind: "leave", id: asPlayerId(attachment.playerId) },
      Date.now(),
    )
    await this.saveRoom(state)
    await this.applyEffects(effects)
  }

  private findSocket(id: PlayerId): WebSocket | null {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = readAttachment(socket.deserializeAttachment())
      if (attachment !== null && attachment.playerId === id) return socket
    }
    return null
  }

  private async applyEffects(effects: readonly RoomEffect[]): Promise<void> {
    for (const effect of effects) {
      switch (effect.kind) {
        case "broadcast": {
          const encoded = encodeServerMessage(effect.message)
          for (const socket of this.ctx.getWebSockets()) {
            socket.send(encoded)
          }
          break
        }
        case "send": {
          this.findSocket(effect.to)?.send(encodeServerMessage(effect.message))
          break
        }
        case "disconnect": {
          this.findSocket(effect.id)?.close(1008, effect.reason)
          break
        }
        case "schedule": {
          await this.ctx.storage.setAlarm(effect.atMs)
          break
        }
        default:
          assertNever(effect, "RoomEffect")
      }
    }
  }
}
