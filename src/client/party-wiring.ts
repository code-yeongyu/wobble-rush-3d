/**
 * Adapter between the server's room messages and the game's own surfaces.
 * Isolating it keeps `Game` free of transport vocabulary.
 */

import type { RaceResult, RemoteRunnerState, RoomPhase, RoomSnapshot } from "../shared/room"
import type { PlayerId } from "../shared/types"
import type { PartyEvents } from "./party-link"

export type PartyPorts = {
  identify(you: PlayerId, snapshot: RoomSnapshot, seed: number): void
  roster(snapshot: RoomSnapshot): void
  phase(phase: RoomPhase, phaseEndsAtMs: number | null, serverNowMs: number): void
  states(players: readonly RemoteRunnerState[]): void
  results(results: readonly RaceResult[]): void
  failure(message: string): void
  closed(reason: string): void
}

export const partyEvents = (ports: PartyPorts): PartyEvents => ({
  onWelcome: (you, snapshot, seed) => ports.identify(you, snapshot, seed),
  onRoster: (snapshot) => ports.roster(snapshot),
  onPhase: (phase, endsAtMs, serverNowMs) => ports.phase(phase, endsAtMs, serverNowMs),
  onStates: (players) => ports.states(players),
  onResults: (results) => ports.results(results),
  onFailure: (message) => ports.failure(message),
  onClosed: (reason) => ports.closed(reason),
})
