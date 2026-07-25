import { describe, expect, test } from "bun:test"
import type { RemoteRunnerState } from "../src/shared/room"
import { reduceRoom } from "../src/shared/room"
import {
  findBroadcast,
  findSend,
  lobbyWithTwo,
  P1,
  P2,
  P3,
  player,
  racingState,
  runner,
  T0,
} from "./support/room-fixtures"

describe("state updates", () => {
  test("records the runner state and refreshes lastSeenMs", () => {
    const { state, raceStartMs } = racingState()
    const now = raceStartMs + 5000
    const { state: after, effects } = reduceRoom(
      state,
      { kind: "state", id: P1, state: runner(P1) },
      now,
    )
    const updated = player(after, P1)
    expect(updated.state).toEqual(runner(P1))
    expect(updated.lastSeenMs).toBe(now)
    // The update is relayed on arrival rather than held for the next alarm tick.
    const relay = findBroadcast(effects, "states")
    expect(relay).not.toBeNull()
    if (relay === null || relay.type !== "states") throw new Error("expected a states relay")
    expect(relay.players).toEqual([runner(P1)])
  })

  test("rejects a non-finite component with an error effect and keeps the old state", () => {
    const { state, raceStartMs } = racingState()
    const dirty: RemoteRunnerState = { ...runner(P1), p: [Number.POSITIVE_INFINITY, 0, 0] }
    const { state: after, effects } = reduceRoom(
      state,
      { kind: "state", id: P1, state: dirty },
      raceStartMs + 5000,
    )
    expect(after).toEqual(state)
    const error = findSend(effects, P1)
    if (error === null || error.type !== "error") throw new Error("expected an error send")
  })

  test("rejects NaN velocity with an error effect", () => {
    const { state, raceStartMs } = racingState()
    const dirty: RemoteRunnerState = { ...runner(P1), v: [0, Number.NaN, 0] }
    const { state: after, effects } = reduceRoom(
      state,
      { kind: "state", id: P1, state: dirty },
      raceStartMs + 5000,
    )
    expect(after).toEqual(state)
    expect(findSend(effects, P1)?.type).toBe("error")
  })

  test("ignores an unknown id without throwing", () => {
    const { state, raceStartMs } = racingState()
    const { state: after, effects } = reduceRoom(
      state,
      { kind: "state", id: P3, state: runner(P3) },
      raceStartMs + 5000,
    )
    expect(after).toEqual(state)
    expect(effects).toEqual([])
  })
})

describe("finish and results", () => {
  test("records the first finish time and ignores a duplicate", () => {
    const { state, raceStartMs } = racingState()
    const afterFirst = reduceRoom(
      state,
      { kind: "finish", id: P1, timeMs: 61_500 },
      raceStartMs + 61_500,
    )
    expect(player(afterFirst.state, P1).finishedMs).toBe(61_500)
    expect(afterFirst.state.phase).toBe("racing")

    const afterDup = reduceRoom(
      afterFirst.state,
      { kind: "finish", id: P1, timeMs: 99_000 },
      raceStartMs + 99_000,
    )
    expect(player(afterDup.state, P1).finishedMs).toBe(61_500)
    expect(afterDup.effects).toEqual([])
  })

  test("when all racers finish, the phase becomes finished and results are broadcast in ascending time order", () => {
    const { state, raceStartMs } = racingState()
    let next = reduceRoom(
      state,
      { kind: "finish", id: P1, timeMs: 61_500 },
      raceStartMs + 61_500,
    ).state
    const { state: after, effects } = reduceRoom(
      next,
      { kind: "finish", id: P2, timeMs: 55_000 },
      raceStartMs + 55_000,
    )
    next = after

    expect(next.phase).toBe("finished")
    const results = findBroadcast(effects, "results")
    if (results === null || results.type !== "results")
      throw new Error("expected a results broadcast")
    expect(results.results).toEqual([
      { id: P2, name: "Bravo", timeMs: 55_000, place: 1 },
      { id: P1, name: "Alpha", timeMs: 61_500, place: 2 },
    ])
  })

  test("ignores a finish outside the racing phase", () => {
    const state = lobbyWithTwo()
    const { state: after, effects } = reduceRoom(
      state,
      { kind: "finish", id: P1, timeMs: 1000 },
      T0,
    )
    expect(after).toEqual(state)
    expect(effects).toEqual([])
  })
})

describe("restart", () => {
  test("returns a finished room to the lobby with cleared times and readiness", () => {
    const { state, raceStartMs } = racingState()
    let next = reduceRoom(
      state,
      { kind: "finish", id: P1, timeMs: 61_500 },
      raceStartMs + 61_500,
    ).state
    next = reduceRoom(next, { kind: "finish", id: P2, timeMs: 55_000 }, raceStartMs + 55_000).state
    expect(next.phase).toBe("finished")

    const { state: after, effects } = reduceRoom(
      next,
      { kind: "restart", id: P1 },
      raceStartMs + 70_000,
    )
    expect(after.phase).toBe("lobby")
    expect(after.phaseEndsAtMs).toBeNull()
    for (const p of after.players) {
      expect(p.ready).toBe(false)
      expect(p.finishedMs).toBeNull()
    }

    const roster = findBroadcast(effects, "roster")
    if (roster === null || roster.type !== "roster") throw new Error("expected a roster broadcast")
    expect(roster.snapshot.phase).toBe("lobby")
  })

  test("is a no-op outside the finished phase", () => {
    const state = lobbyWithTwo()
    const { state: after, effects } = reduceRoom(state, { kind: "restart", id: P1 }, T0)
    expect(after).toEqual(state)
    expect(effects).toEqual([])
  })
})
