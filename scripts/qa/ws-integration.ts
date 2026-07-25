/**
 * End-to-end room protocol check against a running worker (wrangler dev or prod).
 *
 * Opens two real WebSockets into one Durable Object room and drives the whole
 * lobby -> countdown -> racing -> finished -> lobby cycle, asserting the server's
 * broadcasts at each step. Exits non-zero on the first violated expectation.
 *
 * Usage: bun run scripts/qa/ws-integration.ts [http-base]
 */

import type { ClientMessage, ServerMessage } from "../../src/shared/protocol"
import { decodeServerMessage, encodeClientMessage } from "../../src/shared/protocol"

class ExpectationFailed extends Error {
  constructor(what: string) {
    super(`expectation failed: ${what}`)
    this.name = "ExpectationFailed"
  }
}

const httpBase = Bun.argv[2] ?? "http://localhost:8787"
const wsBase = httpBase.replace(/^http/, "ws")

type Client = {
  readonly name: string
  readonly socket: WebSocket
  readonly inbox: ServerMessage[]
  send(message: ClientMessage): void
  waitFor(
    type: ServerMessage["type"],
    predicate?: (m: ServerMessage) => boolean,
    timeoutMs?: number,
  ): Promise<ServerMessage>
}

async function connect(name: string, code: string): Promise<Client> {
  const socket = new WebSocket(`${wsBase}/ws/${code}`)
  const inbox: ServerMessage[] = []
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") inbox.push(decodeServerMessage(event.data))
  })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true })
    socket.addEventListener(
      "error",
      () => reject(new ExpectationFailed(`${name} could not open a socket`)),
      { once: true },
    )
  })
  return {
    name,
    socket,
    inbox,
    send: (message) => socket.send(encodeClientMessage(message)),
    waitFor: async (type, predicate, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const hit = inbox.find((m) => m.type === type && (predicate === undefined || predicate(m)))
        if (hit !== undefined) return hit
        await Bun.sleep(60)
      }
      throw new ExpectationFailed(
        `${name} never received "${type}" (saw: ${inbox.map((m) => m.type).join(", ")})`,
      )
    },
  }
}

const check = (condition: boolean, what: string): void => {
  if (!condition) throw new ExpectationFailed(what)
  console.log(`  ok  ${what}`)
}

async function main(): Promise<void> {
  const created = await fetch(`${httpBase}/api/rooms`, { method: "POST" })
  const payload: unknown = await created.json()
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("code" in payload) ||
    typeof payload.code !== "string"
  ) {
    throw new ExpectationFailed("POST /api/rooms did not return a room code")
  }
  const code = payload.code
  console.log(`room ${code}`)

  const host = await connect("host", code)
  const guest = await connect("guest", code)

  const hostWelcome = await host.waitFor("welcome")
  const guestWelcome = await guest.waitFor("welcome")
  check(
    hostWelcome.type === "welcome" && guestWelcome.type === "welcome",
    "both clients receive welcome",
  )
  if (hostWelcome.type !== "welcome" || guestWelcome.type !== "welcome") return
  check(hostWelcome.seed === guestWelcome.seed, "both clients receive the same NPC seed")
  check(hostWelcome.you !== guestWelcome.you, "each client gets a distinct player id")

  host.send({ type: "join", name: "Pip", mode: "party", colorIndex: 0 })
  guest.send({ type: "join", name: "Bramble", mode: "party", colorIndex: 1 })
  await host.waitFor("roster", (m) => m.type === "roster" && m.snapshot.players.length === 2)
  check(true, "roster reaches two players")

  host.send({ type: "ready", ready: true })
  guest.send({ type: "ready", ready: true })
  const countdown = await host.waitFor(
    "phase",
    (m) => m.type === "phase" && m.phase === "countdown",
  )
  check(
    countdown.type === "phase" && countdown.phaseEndsAtMs !== null,
    "countdown starts with an end time",
  )

  await host.waitFor("phase", (m) => m.type === "phase" && m.phase === "racing", 15000)
  await guest.waitFor("phase", (m) => m.type === "phase" && m.phase === "racing", 15000)
  check(true, "both clients are told the race started")

  host.send({ type: "state", p: [1, 2, 3], v: [0, 0, 8], yaw: 0.5, st: "run", cp: 1 })
  const states = await guest.waitFor(
    "states",
    (m) => m.type === "states" && m.players.length > 0,
    10000,
  )
  check(
    states.type === "states" && states.players.some((p) => Math.abs(p.p[2] - 3) < 1e-6),
    "the guest receives the host's broadcast position",
  )

  // Relay rate: a client sending at NET.stateHz must reach the other client at
  // roughly that rate. Before the relay fix this was pinned to the 1 Hz alarm.
  const before = guest.inbox.filter((m) => m.type === "states").length
  const sendCount = 15
  for (let index = 0; index < sendCount; index += 1) {
    host.send({ type: "state", p: [0, 1, index], v: [0, 0, 8], yaw: 0, st: "run", cp: 1 })
    await Bun.sleep(1000 / sendCount)
  }
  await Bun.sleep(250)
  const relayed = guest.inbox.filter((m) => m.type === "states").length - before
  check(
    relayed >= sendCount - 3,
    `relayed ${relayed} of ${sendCount} updates within a second (>= ${sendCount - 3})`,
  )

  host.send({ type: "finish", timeMs: 42_000 })
  guest.send({ type: "finish", timeMs: 51_500 })
  const results = await host.waitFor("results", undefined, 15000)
  check(results.type === "results" && results.results.length === 2, "results list both racers")
  if (results.type === "results") {
    const [first, second] = results.results
    check(first?.timeMs === 42_000 && first.place === 1, "the faster racer places first")
    check(second?.timeMs === 51_500 && second.place === 2, "the slower racer places second")
  }

  host.send({ type: "restart" })
  await host.waitFor("phase", (m) => m.type === "phase" && m.phase === "lobby", 10000)
  check(true, "restart returns the room to the lobby")

  host.socket.close()
  guest.socket.close()
  console.log("ws-integration: PASS")
}

// no-excuse-ok: catch — CLI boundary
try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
