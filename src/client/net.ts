/**
 * WebSocket client for party mode. Owns exactly one socket, surfaces every failure
 * to the caller (no silent reconnect loops that hide a dead server).
 */

import { NET } from "../shared/constants"
import type { ClientMessage, ServerMessage } from "../shared/protocol"
import { decodeServerMessage, encodeClientMessage } from "../shared/protocol"

export class NetworkError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(`Multiplayer connection failed: ${detail}`)
    this.name = "NetworkError"
    this.detail = detail
  }
}

export type NetHandlers = {
  onMessage(message: ServerMessage): void
  onClose(reason: string): void
  onError(error: NetworkError): void
}

export class NetClient {
  private socket: WebSocket | null = null
  private readonly handlers: NetHandlers
  private lastStateSentMs = 0

  constructor(handlers: NetHandlers) {
    this.handlers = handlers
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  static socketUrl(code: string): string {
    const protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${globalThis.location.host}/ws/${code}`
  }

  /** Resolves once the socket is open; rejects with NetworkError otherwise. */
  connect(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket
      try {
        socket = new WebSocket(NetClient.socketUrl(code))
      } catch (error) {
        reject(new NetworkError(error instanceof Error ? error.message : String(error)))
        return
      }
      this.socket = socket

      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("error", () => {
        const failure = new NetworkError(`could not reach room ${code}`)
        this.handlers.onError(failure)
        reject(failure)
      })
      socket.addEventListener("close", (event) => {
        this.socket = null
        this.handlers.onClose(event.reason === "" ? "connection closed" : event.reason)
      })
      socket.addEventListener("message", (event) => {
        const data: unknown = event.data
        if (typeof data !== "string") return
        try {
          this.handlers.onMessage(decodeServerMessage(data))
        } catch (error) {
          this.handlers.onError(
            new NetworkError(error instanceof Error ? error.message : String(error)),
          )
        }
      })
    })
  }

  send(message: ClientMessage): void {
    const socket = this.socket
    if (socket === null || socket.readyState !== WebSocket.OPEN) return
    socket.send(encodeClientMessage(message))
  }

  /** Rate-limited position broadcast. */
  sendState(nowMs: number, message: ClientMessage): void {
    if (nowMs - this.lastStateSentMs < 1000 / NET.stateHz) return
    this.lastStateSentMs = nowMs
    this.send(message)
  }

  close(): void {
    const socket = this.socket
    this.socket = null
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "left")
    }
  }
}

/** Asks the server for a fresh room code. */
export async function createRoom(): Promise<string> {
  const response = await fetch("/api/rooms", { method: "POST" })
  if (!response.ok) throw new NetworkError(`room creation failed with HTTP ${response.status}`)
  const payload: unknown = await response.json()
  if (typeof payload !== "object" || payload === null || !("code" in payload)) {
    throw new NetworkError("room creation returned an unexpected payload")
  }
  const code = payload.code
  if (typeof code !== "string") throw new NetworkError("room creation returned a non-string code")
  return code
}
