/**
 * Connection decision for the room DO's fetch(): pure, zero Cloudflare
 * imports, so bun can prove the pause gate short-circuits before any room
 * storage I/O. The DO supplies real ports; tests supply spies.
 */

import type { RoomState } from "../shared/room"
import { isPaused } from "./breaker"
import type { BudgetVerdict } from "./budget"

export type ConnectPorts = {
  readonly nowMs: number
  readVerdict(): Promise<BudgetVerdict | null>
  loadRoom(): Promise<RoomState | null>
  createRoom(): Promise<RoomState>
}

export type ConnectDecision = { kind: "paused" } | { kind: "proceed"; room: RoomState }

/**
 * Paused verdicts reject BEFORE loadRoom/createRoom run - a paused socket
 * must never touch room storage (each read/write is billed). Otherwise load
 * the persisted room, creating and persisting a fresh one on first connect.
 */
export async function decideConnect(ports: ConnectPorts): Promise<ConnectDecision> {
  if (isPaused(await ports.readVerdict(), ports.nowMs)) {
    return { kind: "paused" }
  }
  const existing = await ports.loadRoom()
  if (existing !== null) {
    return { kind: "proceed", room: existing }
  }
  return { kind: "proceed", room: await ports.createRoom() }
}
