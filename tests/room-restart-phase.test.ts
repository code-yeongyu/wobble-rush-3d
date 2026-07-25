/**
 * Restarting has to be announced, not just implied.
 *
 * The player who clicks "Race again" moves itself back to the lobby locally, but
 * every other client only learns the room reopened from a `phase` broadcast. A
 * roster alone leaves them stranded on the finish screen.
 */

import { describe, expect, test } from "bun:test"
import { reduceRoom } from "../src/shared/room"
import { findBroadcast, P1, P2, racingState } from "./support/room-fixtures"

function finishedRoom() {
  const { state, raceStartMs } = racingState()
  const afterFirst = reduceRoom(
    state,
    { kind: "finish", id: P1, timeMs: 40_000 },
    raceStartMs + 40_000,
  ).state
  const afterSecond = reduceRoom(
    afterFirst,
    { kind: "finish", id: P2, timeMs: 52_000 },
    raceStartMs + 52_000,
  )
  return { state: afterSecond.state, atMs: raceStartMs + 52_000 }
}

describe("restart broadcasts the phase change", () => {
  test("the room reaches the finished phase once everyone is home", () => {
    expect(finishedRoom().state.phase).toBe("finished")
  })

  test("restart broadcasts a lobby phase so every client leaves the finish screen", () => {
    const finished = finishedRoom()
    const { state, effects } = reduceRoom(
      finished.state,
      { kind: "restart", id: P1 },
      finished.atMs + 1_000,
    )

    expect(state.phase).toBe("lobby")
    const phase = findBroadcast(effects, "phase")
    expect(phase).not.toBeNull()
    if (phase === null || phase.type !== "phase") throw new Error("expected a phase broadcast")
    expect(phase.phase).toBe("lobby")
    expect(phase.phaseEndsAtMs).toBeNull()
    expect(phase.seed).toBe(state.seed)
  })

  test("restart still broadcasts the cleared roster", () => {
    const finished = finishedRoom()
    const { effects } = reduceRoom(
      finished.state,
      { kind: "restart", id: P1 },
      finished.atMs + 1_000,
    )
    const roster = findBroadcast(effects, "roster")
    expect(roster).not.toBeNull()
    if (roster === null || roster.type !== "roster") throw new Error("expected a roster broadcast")
    expect(roster.snapshot.players.every((p) => !p.ready && p.finishedMs === null)).toBe(true)
  })
})
