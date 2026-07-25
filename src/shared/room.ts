/**
 * Pure lobby/room state machine for Wobble Rush 3D.
 *
 * No Workers APIs, no `Date.now`, no randomness: time arrives as `nowMs` and
 * every transition returns a NEW state plus a list of effects for the host
 * (the Durable Object) to apply. This keeps the whole multiplayer ruleset
 * unit-testable in `bun test`.
 */

import { NET } from "./constants"
import type { ServerMessage } from "./protocol"
import type { PlayerId, RoomCode, RunnerState } from "./types"
import { asRoomCode, assertNever } from "./types"

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

type Reduction = { readonly state: RoomState; readonly effects: readonly RoomEffect[] }

/* ------------------------------------------------------------------ *
 * Constructors
 * ------------------------------------------------------------------ */

export function createRoom(code: RoomCode, seed: number): RoomState {
  return { code, phase: "lobby", seed, players: [], phaseEndsAtMs: null }
}

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ" as const

export function generateRoomCode(random: () => number): RoomCode {
  let code = ""
  for (let i = 0; i < 4; i++) {
    const index = Math.min(
      Math.floor(random() * ROOM_CODE_ALPHABET.length),
      ROOM_CODE_ALPHABET.length - 1,
    )
    code += ROOM_CODE_ALPHABET.charAt(index)
  }
  return asRoomCode(code)
}

/* ------------------------------------------------------------------ *
 * Message builders
 * ------------------------------------------------------------------ */

function rosterMessage(state: RoomState): ServerMessage {
  return { type: "roster", snapshot: state }
}

function phaseMessage(state: RoomState, nowMs: number): ServerMessage {
  return {
    type: "phase",
    phase: state.phase,
    serverNowMs: nowMs,
    phaseEndsAtMs: state.phaseEndsAtMs,
    seed: state.seed,
  }
}

function errorMessage(code: string, message: string): ServerMessage {
  return { type: "error", code, message }
}

function statesMessage(state: RoomState, nowMs: number): ServerMessage {
  const players: RemoteRunnerState[] = []
  for (const player of state.players) {
    if (player.state !== null) players.push(player.state)
  }
  return { type: "states", serverNowMs: nowMs, players }
}

function buildResults(players: readonly RoomPlayer[]): readonly RaceResult[] {
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

/* ------------------------------------------------------------------ *
 * Shared transitions
 * ------------------------------------------------------------------ */

/** A join that cannot be honoured: tell the client why, then drop it. */
function rejectJoin(state: RoomState, id: PlayerId, code: string, message: string): Reduction {
  return {
    state,
    effects: [
      { kind: "send", to: id, message: errorMessage(code, message) },
      { kind: "disconnect", id, reason: message },
    ],
  }
}

/**
 * When every remaining racer has a finish time, close the race and broadcast
 * the results. Returns the input untouched otherwise.
 */
function completeIfDone(state: RoomState): Reduction {
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
function withCompletion(state: RoomState, effects: RoomEffect[]): Reduction {
  const completion = completeIfDone(state)
  return { state: completion.state, effects: [...effects, ...completion.effects] }
}

/* ------------------------------------------------------------------ *
 * Per-action reducers
 * ------------------------------------------------------------------ */

function reduceJoin(
  state: RoomState,
  action: Extract<RoomAction, { kind: "join" }>,
  nowMs: number,
): Reduction {
  const name = action.name.trim()
  if (name.length === 0 || name.length > NET.maxNameLength) {
    return rejectJoin(
      state,
      action.id,
      "invalid_name",
      `Name must be 1-${NET.maxNameLength} characters`,
    )
  }
  if (state.players.some((p) => p.id === action.id)) {
    return { state, effects: [] }
  }
  if (state.players.length >= NET.maxPlayersPerRoom) {
    return rejectJoin(
      state,
      action.id,
      "room_full",
      `Room is full (${NET.maxPlayersPerRoom} players)`,
    )
  }
  const player: RoomPlayer = {
    id: action.id,
    name,
    colorIndex: action.colorIndex,
    ready: false,
    finishedMs: null,
    lastSeenMs: nowMs,
    state: null,
  }
  const next: RoomState = { ...state, players: [...state.players, player] }
  return { state: next, effects: [{ kind: "broadcast", message: rosterMessage(next) }] }
}

function reduceLeave(state: RoomState, action: Extract<RoomAction, { kind: "leave" }>): Reduction {
  if (!state.players.some((p) => p.id === action.id)) {
    return { state, effects: [] }
  }
  const next: RoomState = {
    ...state,
    players: state.players.filter((p) => p.id !== action.id),
  }
  const effects: RoomEffect[] = [{ kind: "broadcast", message: rosterMessage(next) }]
  return withCompletion(next, effects)
}

function reduceReady(
  state: RoomState,
  action: Extract<RoomAction, { kind: "ready" }>,
  nowMs: number,
): Reduction {
  if (!state.players.some((p) => p.id === action.id)) {
    return { state, effects: [] }
  }
  let next: RoomState = {
    ...state,
    players: state.players.map((p) => (p.id === action.id ? { ...p, ready: action.ready } : p)),
  }
  const effects: RoomEffect[] = [{ kind: "broadcast", message: rosterMessage(next) }]
  const everyoneReady = next.players.length >= 2 && next.players.every((p) => p.ready)
  if (next.phase === "lobby" && everyoneReady) {
    const endsAtMs = nowMs + NET.countdownSec * 1000
    next = { ...next, phase: "countdown", phaseEndsAtMs: endsAtMs }
    effects.push({ kind: "broadcast", message: phaseMessage(next, nowMs) })
    effects.push({ kind: "schedule", atMs: endsAtMs })
  }
  return { state: next, effects }
}

function reduceStateUpdate(
  state: RoomState,
  action: Extract<RoomAction, { kind: "state" }>,
  nowMs: number,
): Reduction {
  const target = state.players.find((p) => p.id === action.id)
  if (target === undefined) {
    return { state, effects: [] }
  }
  const s = action.state
  const components = [...s.p, ...s.v, s.yaw, s.cp]
  if (!components.every(Number.isFinite)) {
    return {
      state,
      effects: [
        {
          kind: "send",
          to: action.id,
          message: errorMessage("invalid_state", "State contains non-finite numbers"),
        },
      ],
    }
  }
  const next: RoomState = {
    ...state,
    players: state.players.map((p) =>
      p.id === action.id ? { ...p, state: s, lastSeenMs: nowMs } : p,
    ),
  }
  return { state: next, effects: [] }
}

function reduceFinish(
  state: RoomState,
  action: Extract<RoomAction, { kind: "finish" }>,
): Reduction {
  if (state.phase !== "racing") {
    return { state, effects: [] }
  }
  const target = state.players.find((p) => p.id === action.id)
  if (target === undefined || target.finishedMs !== null) {
    return { state, effects: [] }
  }
  if (!Number.isFinite(action.timeMs) || action.timeMs < 0) {
    return {
      state,
      effects: [
        {
          kind: "send",
          to: action.id,
          message: errorMessage("invalid_finish", "Finish time must be a non-negative number"),
        },
      ],
    }
  }
  const next: RoomState = {
    ...state,
    players: state.players.map((p) =>
      p.id === action.id ? { ...p, finishedMs: action.timeMs } : p,
    ),
  }
  return withCompletion(next, [])
}

function reduceRestart(state: RoomState): Reduction {
  if (state.phase !== "finished") {
    return { state, effects: [] }
  }
  const next: RoomState = {
    ...state,
    phase: "lobby",
    phaseEndsAtMs: null,
    players: state.players.map((p) => ({ ...p, ready: false, finishedMs: null })),
  }
  return { state: next, effects: [{ kind: "broadcast", message: rosterMessage(next) }] }
}

function reduceTick(state: RoomState, nowMs: number): Reduction {
  switch (state.phase) {
    case "countdown": {
      if (state.phaseEndsAtMs === null || nowMs < state.phaseEndsAtMs) {
        return { state, effects: [] }
      }
      const next: RoomState = { ...state, phase: "racing", phaseEndsAtMs: null }
      return { state: next, effects: [{ kind: "broadcast", message: phaseMessage(next, nowMs) }] }
    }
    case "racing": {
      const timeoutMs = NET.timeoutSec * 1000
      const stale = state.players.filter((p) => nowMs - p.lastSeenMs > timeoutMs)
      const effects: RoomEffect[] = []
      let next = state
      if (stale.length > 0) {
        const staleIds = new Set(stale.map((p) => p.id))
        next = { ...next, players: next.players.filter((p) => !staleIds.has(p.id)) }
        // Roster goes out BEFORE the disconnects so a closing socket never
        // receives a frame after its close handshake.
        effects.push({ kind: "broadcast", message: rosterMessage(next) })
        for (const p of stale) {
          effects.push({ kind: "disconnect", id: p.id, reason: "timed out" })
        }
      }
      effects.push({ kind: "broadcast", message: statesMessage(next, nowMs) })
      return withCompletion(next, effects)
    }
    case "lobby":
    case "finished":
      return { state, effects: [] }
    default:
      return assertNever(state.phase, "reduceTick")
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function reduceRoom(state: RoomState, action: RoomAction, nowMs: number): Reduction {
  switch (action.kind) {
    case "join":
      return reduceJoin(state, action, nowMs)
    case "leave":
      return reduceLeave(state, action)
    case "ready":
      return reduceReady(state, action, nowMs)
    case "state":
      return reduceStateUpdate(state, action, nowMs)
    case "finish":
      return reduceFinish(state, action)
    case "restart":
      return reduceRestart(state)
    case "tick":
      return reduceTick(state, nowMs)
    default:
      return assertNever(action, "reduceRoom")
  }
}
