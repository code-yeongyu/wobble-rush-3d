/**
 * Shared room test fixtures: fixed ids/timestamps plus small builders for
 * lobby and racing states and effect-query helpers.
 */

import { NET } from "../../src/shared/constants"
import type { ServerMessage } from "../../src/shared/protocol"
import type { RemoteRunnerState, RoomEffect, RoomState } from "../../src/shared/room"
import { createRoom, reduceRoom } from "../../src/shared/room"
import type { PlayerId } from "../../src/shared/types"
import { asPlayerId, asRoomCode } from "../../src/shared/types"

export const CODE = asRoomCode("WXYZ")
export const SEED = 424_242
export const T0 = 1_000_000

export const P1 = asPlayerId("player-1")
export const P2 = asPlayerId("player-2")
export const P3 = asPlayerId("player-3")

export function runner(id: PlayerId): RemoteRunnerState {
  return { id, p: [1, 2, 3], v: [4, 5, 6], yaw: 0.25, st: "run", cp: 2 }
}

export function join(state: RoomState, id: PlayerId, name: string, now: number) {
  return reduceRoom(state, { kind: "join", id, name, colorIndex: 1 }, now)
}

export function lobbyWithTwo(): RoomState {
  const created = createRoom(CODE, SEED)
  const afterFirst = join(created, P1, "Alpha", T0).state
  return join(afterFirst, P2, "Bravo", T0).state
}

export function racingState(): { readonly state: RoomState; readonly raceStartMs: number } {
  let state = lobbyWithTwo()
  state = reduceRoom(state, { kind: "ready", id: P1, ready: true }, T0).state
  state = reduceRoom(state, { kind: "ready", id: P2, ready: true }, T0).state
  const raceStartMs = T0 + NET.countdownSec * 1000
  state = reduceRoom(state, { kind: "tick" }, raceStartMs).state
  return { state, raceStartMs }
}

export function findBroadcast(
  effects: readonly RoomEffect[],
  type: ServerMessage["type"],
): ServerMessage | null {
  for (const effect of effects) {
    if (effect.kind === "broadcast" && effect.message.type === type) return effect.message
  }
  return null
}

export function findSend(effects: readonly RoomEffect[], to: PlayerId): ServerMessage | null {
  for (const effect of effects) {
    if (effect.kind === "send" && effect.to === to) return effect.message
  }
  return null
}

export function findDisconnect(effects: readonly RoomEffect[], id: PlayerId): string | null {
  for (const effect of effects) {
    if (effect.kind === "disconnect" && effect.id === id) return effect.reason
  }
  return null
}

export function findSchedule(effects: readonly RoomEffect[]): number | null {
  for (const effect of effects) {
    if (effect.kind === "schedule") return effect.atMs
  }
  return null
}

export function player(state: RoomState, id: PlayerId) {
  const found = state.players.find((p) => p.id === id)
  if (found === undefined) throw new Error(`expected player ${id} in room`)
  return found
}
