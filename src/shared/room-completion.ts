/**
 * Race-completion transition: when every remaining racer has a finish time,
 * close the race and broadcast the results.
 */

import { buildResults } from "./room-messages"
import type { Reduction, RoomEffect, RoomState } from "./room-types"

/**
 * When every remaining racer has a finish time, close the race and broadcast
 * the results. Returns the input untouched otherwise.
 */
export function completeIfDone(state: RoomState): Reduction {
  if (state.phase !== "racing") return { state, effects: [] }
  if (state.players.length === 0) return { state, effects: [] }
  if (!state.players.every((p) => p.finishedMs !== null)) return { state, effects: [] }
  const next: RoomState = { ...state, phase: "finished" }
  return {
    state: next,
    effects: [
      { kind: "broadcast", message: { type: "results", results: buildResults(next.players) } },
    ],
  }
}

/** Append a completion transition (if any) onto an in-progress reduction. */
export function withCompletion(state: RoomState, effects: RoomEffect[]): Reduction {
  const completion = completeIfDone(state)
  return { state: completion.state, effects: [...effects, ...completion.effects] }
}
