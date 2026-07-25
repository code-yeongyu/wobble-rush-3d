import { describe, expect, test } from "bun:test"
import { NET } from "../src/shared/constants"
import { reduceRoom } from "../src/shared/room"
import {
  findBroadcast,
  findDisconnect,
  findSchedule,
  lobbyWithTwo,
  P1,
  P2,
  player,
  racingState,
  runner,
  SEED,
  T0,
} from "./support/room-fixtures"

describe("ready and the countdown", () => {
  test("a single ready player does NOT start the countdown", () => {
    const state = lobbyWithTwo()
    const { state: after, effects } = reduceRoom(state, { kind: "ready", id: P1, ready: true }, T0)
    expect(after.phase).toBe("lobby")
    expect(after.phaseEndsAtMs).toBeNull()
    expect(findBroadcast(effects, "roster")).not.toBeNull()
    expect(findBroadcast(effects, "phase")).toBeNull()
    expect(findSchedule(effects)).toBeNull()
  })

  test("everyone ready with >= 2 players starts the countdown and schedules it", () => {
    let state = lobbyWithTwo()
    state = reduceRoom(state, { kind: "ready", id: P1, ready: true }, T0).state
    const { state: after, effects } = reduceRoom(state, { kind: "ready", id: P2, ready: true }, T0)

    const expectedEnd = T0 + NET.countdownSec * 1000
    expect(after.phase).toBe("countdown")
    expect(after.phaseEndsAtMs).toBe(expectedEnd)

    const phase = findBroadcast(effects, "phase")
    if (phase === null || phase.type !== "phase") throw new Error("expected a phase broadcast")
    expect(phase.phase).toBe("countdown")
    expect(phase.phaseEndsAtMs).toBe(expectedEnd)
    expect(phase.serverNowMs).toBe(T0)
    expect(phase.seed).toBe(SEED)
    expect(findSchedule(effects)).toBe(expectedEnd)
  })

  test("un-readying a player keeps the room in the lobby", () => {
    let state = lobbyWithTwo()
    state = reduceRoom(state, { kind: "ready", id: P1, ready: true }, T0).state
    const { state: after } = reduceRoom(state, { kind: "ready", id: P1, ready: false }, T0)
    expect(after.phase).toBe("lobby")
    expect(player(after, P1).ready).toBe(false)
  })
})

describe("tick", () => {
  test("does nothing before the countdown ends", () => {
    let state = lobbyWithTwo()
    state = reduceRoom(state, { kind: "ready", id: P1, ready: true }, T0).state
    state = reduceRoom(state, { kind: "ready", id: P2, ready: true }, T0).state
    const { state: after, effects } = reduceRoom(state, { kind: "tick" }, T0 + 1000)
    expect(after).toEqual(state)
    expect(effects).toEqual([])
  })

  test("moves countdown → racing at phaseEndsAtMs and broadcasts the phase", () => {
    let state = lobbyWithTwo()
    state = reduceRoom(state, { kind: "ready", id: P1, ready: true }, T0).state
    state = reduceRoom(state, { kind: "ready", id: P2, ready: true }, T0).state
    const raceStartMs = T0 + NET.countdownSec * 1000
    const { state: after, effects } = reduceRoom(state, { kind: "tick" }, raceStartMs)

    expect(after.phase).toBe("racing")
    expect(after.phaseEndsAtMs).toBeNull()

    const phase = findBroadcast(effects, "phase")
    if (phase === null || phase.type !== "phase") throw new Error("expected a phase broadcast")
    expect(phase.phase).toBe("racing")
    expect(phase.phaseEndsAtMs).toBeNull()
    expect(phase.serverNowMs).toBe(raceStartMs)
  })

  test("disconnects a stale player during racing and relays live states", () => {
    const { state, raceStartMs } = racingState()
    const refreshed = reduceRoom(
      state,
      { kind: "state", id: P1, state: runner(P1) },
      raceStartMs + 36_000,
    ).state

    const now = raceStartMs + 40_000
    const { state: after, effects } = reduceRoom(refreshed, { kind: "tick" }, now)

    expect(after.players).toHaveLength(1)
    expect(player(after, P1).state).toEqual(runner(P1))
    expect(findDisconnect(effects, P2)).not.toBeNull()

    const roster = findBroadcast(effects, "roster")
    if (roster === null || roster.type !== "roster") throw new Error("expected a roster broadcast")
    expect(roster.snapshot.players).toHaveLength(1)

    const states = findBroadcast(effects, "states")
    if (states === null || states.type !== "states") throw new Error("expected a states broadcast")
    expect(states.serverNowMs).toBe(now)
    expect(states.players).toEqual([runner(P1)])
  })

  test("keeps a player whose last update is inside the timeout window", () => {
    const { state, raceStartMs } = racingState()
    let refreshed = reduceRoom(
      state,
      { kind: "state", id: P1, state: runner(P1) },
      raceStartMs + 25_000,
    ).state
    refreshed = reduceRoom(
      refreshed,
      { kind: "state", id: P2, state: runner(P2) },
      raceStartMs + 25_000,
    ).state
    const { state: after, effects } = reduceRoom(refreshed, { kind: "tick" }, raceStartMs + 54_000)
    expect(after.players).toHaveLength(2)
    expect(findDisconnect(effects, P1)).toBeNull()
    expect(findDisconnect(effects, P2)).toBeNull()
  })
})
