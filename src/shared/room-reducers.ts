/**
 * Room state machine entry point: `createRoom` plus the `reduceRoom`
 * dispatcher. The per-action reducers live in `room-lobby-reducers.ts`
 * (join/leave/ready) and `room-race-reducers.ts` (state/finish/restart/tick).
 *
 * No Workers APIs, no `Date.now`, no randomness: time arrives as `nowMs` and
 * every transition returns a NEW state plus a list of effects for the host
 * (the Durable Object) to apply. This keeps the whole multiplayer ruleset
 * unit-testable in `bun test`.
 */

import { reduceJoin, reduceLeave, reduceReady } from "./room-lobby-reducers"
import { reduceFinish, reduceRestart, reduceStateUpdate, reduceTick } from "./room-race-reducers"
import type { Reduction, RoomAction, RoomState } from "./room-types"
import type { RoomCode } from "./types"
import { assertNever } from "./types"

export function createRoom(code: RoomCode, seed: number): RoomState {
  return { code, phase: "lobby", seed, players: [], phaseEndsAtMs: null }
}

export function reduceRoom(state: RoomState, action: RoomAction, nowMs: number): Reduction {
  switch (action.kind) {
    case "join":
      return reduceJoin(state, action, nowMs)
    case "leave":
      return reduceLeave(state, action)
    case "ready":
      return reduceReady(state, action, nowMs)
    case "state":
      return reduceStateUpdate(state, action, nowMs)
    case "finish":
      return reduceFinish(state, action, nowMs)
    case "restart":
      return reduceRestart(state, action, nowMs)
    case "tick":
      return reduceTick(state, nowMs)
    default:
      return assertNever(action, "reduceRoom")
  }
}
