import { describe, expect, test } from "bun:test"
import { NET } from "../src/shared/constants"
import { createRoom, ROOM_PHASES, reduceRoom } from "../src/shared/room"
import { asPlayerId } from "../src/shared/types"
import {
  CODE,
  findBroadcast,
  findDisconnect,
  findSend,
  join,
  lobbyWithTwo,
  P1,
  P2,
  P3,
  player,
  SEED,
  T0,
} from "./support/room-fixtures"

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
