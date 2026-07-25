import { describe, expect, test } from "bun:test"
import { NET } from "../src/shared/constants"
import type { ServerMessage } from "../src/shared/protocol"
import type { RemoteRunnerState, RoomEffect, RoomState } from "../src/shared/room"
import { createRoom, generateRoomCode, ROOM_PHASES, reduceRoom } from "../src/shared/room"
import { asPlayerId, asRoomCode, type PlayerId } from "../src/shared/types"

const CODE = asRoomCode("WXYZ")
const SEED = 424_242
const T0 = 1_000_000

const P1 = asPlayerId("player-1")
const P2 = asPlayerId("player-2")
const P3 = asPlayerId("player-3")

function runner(id: PlayerId): RemoteRunnerState {
  return { id, p: [1, 2, 3], v: [4, 5, 6], yaw: 0.25, st: "run", cp: 2 }
}

function join(state: RoomState, id: PlayerId, name: string, now: number) {
  return reduceRoom(state, { kind: "join", id, name, colorIndex: 1 }, now)
}

function lobbyWithTwo(): RoomState {
  const created = createRoom(CODE, SEED)
  const afterFirst = join(created, P1, "Alpha", T0).state
  return join(afterFirst, P2, "Bravo", T0).state
}

function racingState(): { readonly state: RoomState; readonly raceStartMs: number } {
  let state = lobbyWithTwo()
  state = reduceRoom(state, { kind: "ready", id: P1, ready: true }, T0).state
  state = reduceRoom(state, { kind: "ready", id: P2, ready: true }, T0).state
  const raceStartMs = T0 + NET.countdownSec * 1000
  state = reduceRoom(state, { kind: "tick" }, raceStartMs).state
  return { state, raceStartMs }
}

function findBroadcast(
  effects: readonly RoomEffect[],
  type: ServerMessage["type"],
): ServerMessage | null {
  for (const effect of effects) {
    if (effect.kind === "broadcast" && effect.message.type === type) return effect.message
  }
  return null
}

function findSend(effects: readonly RoomEffect[], to: PlayerId): ServerMessage | null {
  for (const effect of effects) {
    if (effect.kind === "send" && effect.to === to) return effect.message
  }
  return null
}

function findDisconnect(effects: readonly RoomEffect[], id: PlayerId): string | null {
  for (const effect of effects) {
    if (effect.kind === "disconnect" && effect.id === id) return effect.reason
  }
  return null
}

function findSchedule(effects: readonly RoomEffect[]): number | null {
  for (const effect of effects) {
    if (effect.kind === "schedule") return effect.atMs
  }
  return null
}

function player(state: RoomState, id: PlayerId) {
  const found = state.players.find((p) => p.id === id)
  if (found === undefined) throw new Error(`expected player ${id} in room`)
  return found
}

describe("createRoom", () => {
  test("starts in the lobby with no players", () => {
    const state = createRoom(CODE, SEED)
    expect(state.code).toBe(CODE)
    expect(state.seed).toBe(SEED)
    expect(state.phase).toBe("lobby")
    expect(state.players).toEqual([])
    expect(state.phaseEndsAtMs).toBeNull()
  })

  test("ROOM_PHASES lists the four phases in order", () => {
    expect(ROOM_PHASES).toEqual(["lobby", "countdown", "racing", "finished"])
  })
})

describe("join", () => {
  test("adds a player and broadcasts a roster", () => {
    const created = createRoom(CODE, SEED)
    const { state, effects } = join(created, P1, "Alpha", T0)
    expect(state.players).toHaveLength(1)
    const added = player(state, P1)
    expect(added.name).toBe("Alpha")
    expect(added.ready).toBe(false)
    expect(added.finishedMs).toBeNull()
    expect(added.lastSeenMs).toBe(T0)
    expect(added.state).toBeNull()

    const roster = findBroadcast(effects, "roster")
    if (roster === null || roster.type !== "roster") throw new Error("expected a roster broadcast")
    expect(roster.snapshot.players).toHaveLength(1)
  })

  test("trims surrounding whitespace from names", () => {
    const created = createRoom(CODE, SEED)
    const { state } = join(created, P1, "  Wob  ", T0)
    expect(player(state, P1).name).toBe("Wob")
  })

  test("rejects a join beyond maxPlayersPerRoom with an error and a disconnect", () => {
    let state = createRoom(CODE, SEED)
    for (let i = 0; i < NET.maxPlayersPerRoom; i++) {
      state = join(state, asPlayerId(`p-${i}`), `Racer${i}`, T0).state
    }
    const { state: after, effects } = join(state, P3, "TooLate", T0)
    expect(after.players).toHaveLength(NET.maxPlayersPerRoom)

    const error = findSend(effects, P3)
    if (error === null || error.type !== "error") throw new Error("expected an error send")
    expect(findDisconnect(effects, P3)).not.toBeNull()
  })

  test("rejects an empty (whitespace-only) name", () => {
    const created = createRoom(CODE, SEED)
    const { state, effects } = join(created, P1, "   ", T0)
    expect(state.players).toHaveLength(0)
    expect(findSend(effects, P1)?.type).toBe("error")
    expect(findDisconnect(effects, P1)).not.toBeNull()
  })

  test("rejects a name longer than maxNameLength", () => {
    const created = createRoom(CODE, SEED)
    const { state, effects } = join(created, P1, "x".repeat(NET.maxNameLength + 1), T0)
    expect(state.players).toHaveLength(0)
    expect(findSend(effects, P1)?.type).toBe("error")
    expect(findDisconnect(effects, P1)).not.toBeNull()
  })

  test("accepts a name exactly maxNameLength long", () => {
    const created = createRoom(CODE, SEED)
    const { state } = join(created, P1, "x".repeat(NET.maxNameLength), T0)
    expect(state.players).toHaveLength(1)
  })
})

describe("leave", () => {
  test("removes the player and broadcasts a roster", () => {
    const state = lobbyWithTwo()
    const { state: after, effects } = reduceRoom(state, { kind: "leave", id: P1 }, T0)
    expect(after.players).toHaveLength(1)
    expect(player(after, P2).name).toBe("Bravo")
    expect(findBroadcast(effects, "roster")).not.toBeNull()
  })

  test("ignores an unknown id without throwing", () => {
    const state = lobbyWithTwo()
    const { state: after, effects } = reduceRoom(state, { kind: "leave", id: P3 }, T0)
    expect(after).toEqual(state)
    expect(effects).toEqual([])
  })
})

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
    expect(effects).toEqual([])
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

describe("generateRoomCode", () => {
  test("draws 4 uppercase letters from the unambiguous alphabet", () => {
    let call = 0
    const rolls = [0.1, 0.2, 0.3, 0.4]
    const code = generateRoomCode(() => {
      const roll = rolls[call]
      call += 1
      if (roll === undefined) throw new Error("random called too many times")
      return roll
    })
    expect(code).toBe(asRoomCode("CEHK"))
    expect(code).toHaveLength(4)
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/)
  })

  test("clamps the extremes of the random range", () => {
    expect(generateRoomCode(() => 0)).toBe(asRoomCode("AAAA"))
    expect(generateRoomCode(() => 0.9999)).toBe(asRoomCode("ZZZZ"))
  })
})

describe("purity", () => {
  test("reduceRoom never mutates the state passed in", () => {
    const state = lobbyWithTwo()
    const before = structuredClone(state)
    reduceRoom(state, { kind: "join", id: P3, name: "Gamma", colorIndex: 2 }, T0)
    reduceRoom(state, { kind: "ready", id: P1, ready: true }, T0)
    reduceRoom(state, { kind: "tick" }, T0 + 5000)
    reduceRoom(state, { kind: "leave", id: P1 }, T0)
    expect(state).toEqual(before)
  })
})
