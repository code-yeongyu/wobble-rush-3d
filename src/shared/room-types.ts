/**
 * Room state machine types: snapshot shapes, player records, actions the host
 * can apply and effects the host must perform.
 */

import type { ServerMessage } from "./protocol"
import type { PlayerId, RoomCode, RunnerState } from "./types"

export const ROOM_PHASES = ["lobby", "countdown", "racing", "finished"] as const
export type RoomPhase = (typeof ROOM_PHASES)[number]

export type RemoteRunnerState = {
  readonly id: PlayerId
  readonly p: readonly [number, number, number]
  readonly v: readonly [number, number, number]
  readonly yaw: number
  readonly st: RunnerState
  readonly cp: number
}

export type RoomPlayer = {
  readonly id: PlayerId
  readonly name: string
  readonly colorIndex: number
  readonly ready: boolean
  readonly finishedMs: number | null
  readonly lastSeenMs: number
  readonly state: RemoteRunnerState | null
}

export type RoomSnapshot = {
  readonly code: RoomCode
  readonly phase: RoomPhase
  readonly seed: number
  readonly players: readonly RoomPlayer[]
  readonly phaseEndsAtMs: number | null
}

export type RaceResult = {
  readonly id: PlayerId
  readonly name: string
  readonly timeMs: number | null
  readonly place: number
}

export type RoomAction =
  | {
      readonly kind: "join"
      readonly id: PlayerId
      readonly name: string
      readonly colorIndex: number
    }
  | { readonly kind: "leave"; readonly id: PlayerId }
  | { readonly kind: "ready"; readonly id: PlayerId; readonly ready: boolean }
  | { readonly kind: "state"; readonly id: PlayerId; readonly state: RemoteRunnerState }
  | { readonly kind: "finish"; readonly id: PlayerId; readonly timeMs: number }
  | { readonly kind: "restart"; readonly id: PlayerId }
  | { readonly kind: "tick" }

export type RoomEffect =
  | { readonly kind: "broadcast"; readonly message: ServerMessage }
  | { readonly kind: "send"; readonly to: PlayerId; readonly message: ServerMessage }
  | { readonly kind: "disconnect"; readonly id: PlayerId; readonly reason: string }
  | { readonly kind: "schedule"; readonly atMs: number }

export type RoomState = RoomSnapshot

export type Reduction = { readonly state: RoomState; readonly effects: readonly RoomEffect[] }
