/**
 * Race-phase room reducers: live runner-state updates, finish times, the
 * post-race restart and the host tick (countdown advance, stale-player
 * timeouts, state relay).
 */

import { NET } from "./constants"
import { withCompletion } from "./room-completion"
import {
  errorMessage,
  phaseMessage,
  rosterMessage,
  singleStateMessage,
  statesMessage,
} from "./room-messages"
import type { Reduction, RoomAction, RoomEffect, RoomState } from "./room-types"
import { assertNever } from "./types"

export function reduceStateUpdate(
  state: RoomState,
  action: Extract<RoomAction, { kind: "state" }>,
  nowMs: number,
): Reduction {
  const target = state.players.find((p) => p.id === action.id)
  if (target === undefined) {
    return { state, effects: [] }
  }
  const s = action.state
  const components = [...s.p, ...s.v, s.yaw, s.cp]
  if (!components.every(Number.isFinite)) {
    return {
      state,
      effects: [
        {
          kind: "send",
          to: action.id,
          message: errorMessage("invalid_state", "State contains non-finite numbers"),
        },
      ],
    }
  }
  const next: RoomState = {
    ...state,
    players: state.players.map((p) =>
      p.id === action.id ? { ...p, state: s, lastSeenMs: nowMs } : p,
    ),
  }
  // Relay immediately. Waiting for the alarm tick capped remote runners at the
  // alarm's one-second cadence, however fast clients actually sent.
  return { state: next, effects: [{ kind: "broadcast", message: singleStateMessage(s, nowMs) }] }
}

export function reduceFinish(
  state: RoomState,
  action: Extract<RoomAction, { kind: "finish" }>,
  nowMs: number,
): Reduction {
  if (state.phase !== "racing") {
    return { state, effects: [] }
  }
  const target = state.players.find((p) => p.id === action.id)
  if (target === undefined || target.finishedMs !== null) {
    return { state, effects: [] }
  }
  if (!Number.isFinite(action.timeMs) || action.timeMs < 0) {
    return {
      state,
      effects: [
        {
          kind: "send",
          to: action.id,
          message: errorMessage("invalid_finish", "Finish time must be a non-negative number"),
        },
      ],
    }
  }
  // A finisher stops sending state, so its lastSeenMs must be refreshed here or
  // the idle sweep would evict it while it waits for the rest of the pack.
  const next: RoomState = {
    ...state,
    players: state.players.map((p) =>
      p.id === action.id ? { ...p, finishedMs: action.timeMs, lastSeenMs: nowMs } : p,
    ),
  }
  return withCompletion(next, [])
}

export function reduceRestart(
  state: RoomState,
  action: Extract<RoomAction, { kind: "restart" }>,
  nowMs: number,
): Reduction {
  if (state.phase !== "finished") {
    return { state, effects: [] }
  }
  // Only a racer in this room may reopen it — an unjoined socket must not be
  // able to wipe someone else's results.
  if (!state.players.some((p) => p.id === action.id)) {
    return { state, effects: [] }
  }
  const next: RoomState = {
    ...state,
    phase: "lobby",
    phaseEndsAtMs: null,
    players: state.players.map((p) => ({ ...p, ready: false, finishedMs: null })),
  }
  // The phase broadcast is what pulls the other clients off the finish screen;
  // a roster alone leaves them stranded there.
  return {
    state: next,
    effects: [
      { kind: "broadcast", message: phaseMessage(next, nowMs) },
      { kind: "broadcast", message: rosterMessage(next) },
    ],
  }
}

export function reduceTick(state: RoomState, nowMs: number): Reduction {
  switch (state.phase) {
    case "countdown": {
      if (state.phaseEndsAtMs === null || nowMs < state.phaseEndsAtMs) {
        return { state, effects: [] }
      }
      const next: RoomState = { ...state, phase: "racing", phaseEndsAtMs: null }
      return { state: next, effects: [{ kind: "broadcast", message: phaseMessage(next, nowMs) }] }
    }
    case "racing": {
      const timeoutMs = NET.timeoutSec * 1000
      const stale = state.players.filter(
        (p) => p.finishedMs === null && nowMs - p.lastSeenMs > timeoutMs,
      )
      const effects: RoomEffect[] = []
      let next = state
      if (stale.length > 0) {
        const staleIds = new Set(stale.map((p) => p.id))
        next = { ...next, players: next.players.filter((p) => !staleIds.has(p.id)) }
        // Roster goes out BEFORE the disconnects so a closing socket never
        // receives a frame after its close handshake.
        effects.push({ kind: "broadcast", message: rosterMessage(next) })
        for (const p of stale) {
          effects.push({ kind: "disconnect", id: p.id, reason: "timed out" })
        }
      }
      effects.push({ kind: "broadcast", message: statesMessage(next, nowMs) })
      return withCompletion(next, effects)
    }
    case "lobby":
    case "finished":
      return { state, effects: [] }
    default:
      return assertNever(state.phase, "reduceTick")
  }
}
