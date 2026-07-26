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
 * A race lasts 1-2 minutes; this is the hard ceiling a tripped countdown or
 * racing room may keep running before its next alarm tick drains it.
 */
export const PAUSE_RACE_GRACE_MS = 10 * 60_000

/**
 * True = refuse the new connection. The single named decision point for the
 * fetch()-side pause gate so it is exhaustively unit-tested.
 */
export function gateRoomFetch(verdict: BudgetVerdict | null, nowMs: number): boolean {
  return isPaused(verdict, nowMs)
}

/**
 * Messages that move a room forward are blocked while paused; passive or
 * leaving traffic still flows so in-flight races can wind down on grace.
 */
export function blockedWhilePaused(type: ClientMessage["type"]): boolean {
  switch (type) {
    case "join":
    case "ready":
    case "restart":
      return true
    case "state":
    case "finish":
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
