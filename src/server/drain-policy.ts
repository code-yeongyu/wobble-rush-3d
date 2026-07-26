/**
 * Pause gates for RoomDurableObject: pure decisions, no Cloudflare imports.
 *
 * While the budget breaker is tripped, every route into a room DO is blocked:
 * new sockets are refused in fetch(), lobby-driving messages are rejected in
 * webSocketMessage() (an idle lobby has no armed alarm, so the message gate is
 * the only thing stopping ready -> countdown), and occupied rooms drain on
 * their next alarm tick after a bounded grace.
 */

import type { ClientMessage } from "../shared/protocol"
import type { RoomPhase } from "../shared/room-types"
import { assertNever } from "../shared/types"
import { isPaused } from "./breaker"
import type { BudgetVerdict } from "./budget"

/**
/**
 * A race lasts 1-2 minutes; three covers any legitimate finish. The bound on
 * free-tier overshoot while a race rides out this grace is documented in the
 * PR: breaker staleness is at most ~2 min (60 s KV edge cache + 60 s isolate
 * cache), and Cloudflare's own daily caps remain the hard backstop behind
 * this guard.
 */
export const PAUSE_RACE_GRACE_MS = 3 * 60_000

/**
 * True = refuse the new connection. The single named decision point for the
 * fetch()-side pause gate so it is exhaustively unit-tested.
 */
export function gateRoomFetch(verdict: BudgetVerdict | null, nowMs: number): boolean {
  return isPaused(verdict, nowMs)
}

/**
 * Messages that move a room forward are blocked while paused. Lobby drivers
 * (join/ready/restart) are refused in every phase; state/finish frames only
 * flow during the countdown|racing grace window - in lobby or finished they
 * would each trigger a reduceRoom + saveRoom storage write with no armed
 * alarm to drain an idle room. Leaving is never blocked.
 */
export function blockedWhilePaused(type: ClientMessage["type"], phase: RoomPhase): boolean {
  switch (type) {
    case "join":
    case "ready":
    case "restart":
      return true
    case "state":
    case "finish":
      switch (phase) {
        case "countdown":
        case "racing":
          return false
        case "lobby":
        case "finished":
          return true
        default:
          return assertNever(phase, "RoomPhase")
      }
    case "leave":
      return false
    default:
      return assertNever(type, "ClientMessage")
  }
}

/**
 * Lobby and finished rooms drain immediately; countdown and racing rooms get
 * the grace window and drain only once it has fully elapsed.
 */
export function drainOnPause(phase: RoomPhase, pausedForMs: number): boolean {
  switch (phase) {
    case "lobby":
    case "finished":
      return true
    case "countdown":
    case "racing":
      return pausedForMs > PAUSE_RACE_GRACE_MS
    default:
      return assertNever(phase, "RoomPhase")
  }
}
