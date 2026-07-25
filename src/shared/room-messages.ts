/**
 * Server-message builders for the room state machine: roster, phase, error,
 * live-state relays and the final race results.
 */

import type { ServerMessage } from "./protocol"
import type { RaceResult, RemoteRunnerState, RoomPlayer, RoomState } from "./room-types"

export function rosterMessage(state: RoomState): ServerMessage {
  return { type: "roster", snapshot: state }
}

export function phaseMessage(state: RoomState, nowMs: number): ServerMessage {
  return {
    type: "phase",
    phase: state.phase,
    serverNowMs: nowMs,
    phaseEndsAtMs: state.phaseEndsAtMs,
    seed: state.seed,
  }
}

export function errorMessage(code: string, message: string): ServerMessage {
  return { type: "error", code, message }
}

export function statesMessage(state: RoomState, nowMs: number): ServerMessage {
  const players: RemoteRunnerState[] = []
  for (const player of state.players) {
    if (player.state !== null) players.push(player.state)
  }
  return { type: "states", serverNowMs: nowMs, players }
}

/** Relay for exactly one runner, so a 15 Hz update costs one small frame. */
export function singleStateMessage(runner: RemoteRunnerState, nowMs: number): ServerMessage {
  return { type: "states", serverNowMs: nowMs, players: [runner] }
}

export function buildResults(players: readonly RoomPlayer[]): readonly RaceResult[] {
  const sorted = [...players].sort((a, b) => {
    if (a.finishedMs === null) return b.finishedMs === null ? 0 : 1
    if (b.finishedMs === null) return -1
    return a.finishedMs - b.finishedMs
  })
  return sorted.map((p, index) => ({
    id: p.id,
    name: p.name,
    timeMs: p.finishedMs,
    place: index + 1,
  }))
}
