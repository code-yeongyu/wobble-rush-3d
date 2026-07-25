/**
 * Lobby-phase room reducers: joining, leaving and readiness (which arms the
 * countdown once everyone is ready).
 */

import { NET } from "./constants"
import { withCompletion } from "./room-completion"
import { errorMessage, phaseMessage, rosterMessage } from "./room-messages"
import type { Reduction, RoomAction, RoomEffect, RoomPlayer, RoomState } from "./room-types"
import type { PlayerId } from "./types"

/** A join that cannot be honoured: tell the client why, then drop it. */
function rejectJoin(state: RoomState, id: PlayerId, code: string, message: string): Reduction {
  return {
    state,
    effects: [
      { kind: "send", to: id, message: errorMessage(code, message) },
      { kind: "disconnect", id, reason: message },
    ],
  }
}

export function reduceJoin(
  state: RoomState,
  action: Extract<RoomAction, { kind: "join" }>,
  nowMs: number,
): Reduction {
  const name = action.name.trim()
  if (name.length === 0 || name.length > NET.maxNameLength) {
    return rejectJoin(
      state,
      action.id,
      "invalid_name",
      `Name must be 1-${NET.maxNameLength} characters`,
    )
  }
  if (state.players.some((p) => p.id === action.id)) {
    return { state, effects: [] }
  }
  // A latecomer would never finish, and room completion waits for everyone —
  // so an in-progress room is closed rather than silently wedged.
  if (state.phase !== "lobby") {
    return rejectJoin(
      state,
      action.id,
      "race_in_progress",
      "That race has already started — try again when it finishes",
    )
  }
  if (state.players.length >= NET.maxPlayersPerRoom) {
    return rejectJoin(
      state,
      action.id,
      "room_full",
      `Room is full (${NET.maxPlayersPerRoom} players)`,
    )
  }
  const player: RoomPlayer = {
    id: action.id,
    name,
    colorIndex: action.colorIndex,
    ready: false,
    finishedMs: null,
    lastSeenMs: nowMs,
    state: null,
  }
  const next: RoomState = { ...state, players: [...state.players, player] }
  return { state: next, effects: [{ kind: "broadcast", message: rosterMessage(next) }] }
}

export function reduceLeave(
  state: RoomState,
  action: Extract<RoomAction, { kind: "leave" }>,
): Reduction {
  if (!state.players.some((p) => p.id === action.id)) {
    return { state, effects: [] }
  }
  const next: RoomState = {
    ...state,
    players: state.players.filter((p) => p.id !== action.id),
  }
  const effects: RoomEffect[] = [{ kind: "broadcast", message: rosterMessage(next) }]
  return withCompletion(next, effects)
}

export function reduceReady(
  state: RoomState,
  action: Extract<RoomAction, { kind: "ready" }>,
  nowMs: number,
): Reduction {
  if (!state.players.some((p) => p.id === action.id)) {
    return { state, effects: [] }
  }
  let next: RoomState = {
    ...state,
    players: state.players.map((p) => (p.id === action.id ? { ...p, ready: action.ready } : p)),
  }
  const effects: RoomEffect[] = [{ kind: "broadcast", message: rosterMessage(next) }]
  const everyoneReady = next.players.length >= 2 && next.players.every((p) => p.ready)
  if (next.phase === "lobby" && everyoneReady) {
    const endsAtMs = nowMs + NET.countdownSec * 1000
    next = { ...next, phase: "countdown", phaseEndsAtMs: endsAtMs }
    effects.push({ kind: "broadcast", message: phaseMessage(next, nowMs) })
    effects.push({ kind: "schedule", atMs: endsAtMs })
  }
  return { state: next, effects }
}
