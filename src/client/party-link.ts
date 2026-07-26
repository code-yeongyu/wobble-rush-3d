/**
 * Party mode transport: owns the socket, decodes server messages and hands them to
 * the game as typed callbacks. Every failure surfaces — nothing reconnects silently.
 */

import type { ClientMessage, ServerMessage } from "../shared/protocol"
import type { RaceResult, RemoteRunnerState, RoomPhase, RoomSnapshot } from "../shared/room"
import type { PlayerId } from "../shared/types"
import { assertNever } from "../shared/types"
import { createRoom, fetchServiceStatus, NetClient, NetworkError, pauseMessage } from "./net"

export type PartyEvents = {
  onWelcome(you: PlayerId, snapshot: RoomSnapshot, seed: number): void
  onRoster(snapshot: RoomSnapshot): void
  onPhase(phase: RoomPhase, phaseEndsAtMs: number | null, serverNowMs: number): void
  onStates(players: readonly RemoteRunnerState[]): void
  onResults(results: readonly RaceResult[]): void
  onFailure(message: string): void
  onClosed(reason: string): void
}

export class PartyLink {
  private readonly events: PartyEvents
  private client: NetClient | null = null

  constructor(events: PartyEvents) {
    this.events = events
  }

  get active(): boolean {
    return this.client !== null
  }

  /** Joins `code`, or asks the server for a fresh room when `code` is null. */
  async join(code: string | null, join: ClientMessage): Promise<void> {
    try {
      const status = await fetchServiceStatus(fetch)
      if (status.paused) {
        this.events.onFailure(pauseMessage(status.resetsAt))
        return
      }
      const roomCode = code ?? (await createRoom())
      const client = new NetClient({
        onMessage: (message) => this.dispatch(message),
        onClose: (reason) => {
          this.client = null
          this.events.onClosed(reason)
        },
        onError: (error) => this.events.onFailure(error.message),
      })
      await client.connect(roomCode)
      this.client = client
      client.send(join)
    } catch (error) {
      this.events.onFailure(
        error instanceof NetworkError ? error.message : `Multiplayer failed: ${String(error)}`,
      )
    }
  }

  send(message: ClientMessage): void {
    this.client?.send(message)
  }

  sendState(nowMs: number, message: ClientMessage): void {
    this.client?.sendState(nowMs, message)
  }

  leave(): void {
    this.client?.send({ type: "leave" })
    this.close()
  }

  close(): void {
    this.client?.close()
    this.client = null
  }

  private dispatch(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.events.onWelcome(message.you, message.snapshot, message.seed)
        break
      case "roster":
        this.events.onRoster(message.snapshot)
        break
      case "phase":
        this.events.onPhase(message.phase, message.phaseEndsAtMs, message.serverNowMs)
        break
      case "states":
        this.events.onStates(message.players)
        break
      case "results":
        this.events.onResults(message.results)
        break
      case "error":
        this.events.onFailure(
          message.code === "service_paused"
            ? message.message
            : `${message.code}: ${message.message}`,
        )
        break
      default:
        assertNever(message, "PartyLink.dispatch")
    }
  }
}
