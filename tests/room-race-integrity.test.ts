/**
 * Multiplayer integrity rules that a review found missing.
 *
 * Each case here is a way a real race went wrong: a finisher being timed out
 * while waiting for the pack, a latecomer wedging a room that can never
 * complete, an unjoined socket resetting someone else's results, and remote
 * runners that only moved once a second because nothing relayed their state.
 */

import { describe, expect, test } from "bun:test"
import { NET } from "../src/shared/constants"
import { reduceRoom } from "../src/shared/room"
import {
  findBroadcast,
  findDisconnect,
  findSend,
  P1,
  P2,
  P3,
  racingState,
  runner,
} from "./support/room-fixtures"

describe("a finished racer is not treated as idle", () => {
  test("finishing keeps the player alive past the idle timeout", () => {
    const { state, raceStartMs } = racingState()
    const finished = reduceRoom(
      state,
      { kind: "finish", id: P1, timeMs: 30_000 },
      raceStartMs + 30_000,
    ).state

    // P1 stops sending state the moment it finishes; P2 races on for another minute.
    const muchLater = raceStartMs + 30_000 + NET.timeoutSec * 1000 + 5_000
    const ticked = reduceRoom(finished, { kind: "state", id: P2, state: runner(P2) }, muchLater - 1)
    const after = reduceRoom(ticked.state, { kind: "tick" }, muchLater)

    expect(after.state.players.some((p) => p.id === P1)).toBe(true)
    expect(findDisconnect(after.effects, P1)).toBeNull()
  })
})

describe("joining is only allowed while the room is open", () => {
  test("a join during a race is rejected instead of wedging the room", () => {
    const { state, raceStartMs } = racingState()
    const { state: after, effects } = reduceRoom(
      state,
      { kind: "join", id: P3, name: "Late", colorIndex: 3 },
      raceStartMs + 5_000,
    )

    expect(after.players.some((p) => p.id === P3)).toBe(false)
    const error = findSend(effects, P3)
    expect(error).not.toBeNull()
    if (error === null || error.type !== "error") throw new Error("expected an error message")
    expect(error.code).toBe("race_in_progress")
    expect(findDisconnect(effects, P3)).not.toBeNull()
  })
})

describe("restart is a member action", () => {
  test("a socket that never joined cannot reset a finished room", () => {
    const { state, raceStartMs } = racingState()
    const first = reduceRoom(
      state,
      { kind: "finish", id: P1, timeMs: 30_000 },
      raceStartMs + 30_000,
    ).state
    const finished = reduceRoom(
      first,
      { kind: "finish", id: P2, timeMs: 40_000 },
      raceStartMs + 40_000,
    ).state
    expect(finished.phase).toBe("finished")

    const outsider = reduceRoom(finished, { kind: "restart", id: P3 }, raceStartMs + 50_000)
    expect(outsider.state.phase).toBe("finished")
    expect(outsider.effects).toHaveLength(0)

    const member = reduceRoom(finished, { kind: "restart", id: P1 }, raceStartMs + 50_000)
    expect(member.state.phase).toBe("lobby")
  })
})

describe("runner positions are relayed as they arrive", () => {
  test("a state update broadcasts immediately instead of waiting for the next tick", () => {
    const { state, raceStartMs } = racingState()
    const { effects } = reduceRoom(
      state,
      { kind: "state", id: P1, state: runner(P1) },
      raceStartMs + 100,
    )

    const states = findBroadcast(effects, "states")
    expect(states).not.toBeNull()
    if (states === null || states.type !== "states") throw new Error("expected a states broadcast")
    expect(states.players.some((p) => p.id === P1)).toBe(true)
  })

  test("a rejected non-finite state is not relayed", () => {
    const { state, raceStartMs } = racingState()
    const broken = { ...runner(P1), p: [0, Number.NaN, 0] as const }
    const { effects } = reduceRoom(
      state,
      { kind: "state", id: P1, state: broken },
      raceStartMs + 100,
    )
    expect(findBroadcast(effects, "states")).toBeNull()
  })
})
