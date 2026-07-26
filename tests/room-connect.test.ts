import { describe, expect, test } from "bun:test"
import type { BudgetVerdict } from "../src/server/budget"
import { type ConnectPorts, decideConnect } from "../src/server/room-connect"
import { createRoom, type RoomState } from "../src/shared/room"
import { asRoomCode } from "../src/shared/types"

const NOW = Date.parse("2026-07-26T12:00:00.000Z")

function makeVerdict(overrides: Partial<BudgetVerdict> = {}): BudgetVerdict {
  return {
    v: 1,
    tripped: true,
    worst: { meter: "doRequests", mtd: 950_000, limit: 1_000_000 },
    advisory: { workersRequests: 12_345 },
    resetsAtIso: "2026-08-01T00:00:00.000Z",
    computedAtIso: "2026-07-26T12:00:00.000Z",
    ...overrides,
  }
}

/** Spy ports: every call is counted so paused paths can prove zero room I/O. */
function makePorts(opts: {
  readonly verdict: BudgetVerdict | null
  readonly stored: RoomState | null
}): {
  readonly calls: { loadRoom: number; createRoom: number }
  readonly ports: ConnectPorts
  readonly storedRoom: RoomState | null
  readonly freshRoom: RoomState
} {
  const calls = { loadRoom: 0, createRoom: 0 }
  const freshRoom = createRoom(asRoomCode("WKRP"), 4242)
  return {
    calls,
    storedRoom: opts.stored,
    freshRoom,
    ports: {
      nowMs: NOW,
      readVerdict: () => Promise.resolve(opts.verdict),
      loadRoom: () => {
        calls.loadRoom += 1
        return Promise.resolve(opts.stored)
      },
      createRoom: () => {
        calls.createRoom += 1
        return Promise.resolve(freshRoom)
      },
    },
  }
}

describe("decideConnect", () => {
  test("tripped verdict pauses BEFORE any room load or create", async () => {
    const { calls, ports } = makePorts({ verdict: makeVerdict(), stored: null })

    const decision = await decideConnect(ports)

    expect(decision).toEqual({ kind: "paused" })
    expect(calls.loadRoom).toBe(0)
    expect(calls.createRoom).toBe(0)
  })

  test("untripped verdict with an existing room proceeds with it and never creates", async () => {
    const stored = createRoom(asRoomCode("WKRP"), 7)
    const { calls, ports } = makePorts({ verdict: makeVerdict({ tripped: false }), stored })

    const decision = await decideConnect(ports)

    expect(decision.kind).toBe("proceed")
    if (decision.kind !== "proceed") throw new Error("expected proceed")
    expect(decision.room).toBe(stored)
    expect(calls.loadRoom).toBe(1)
    expect(calls.createRoom).toBe(0)
  })

  test("untripped verdict with no stored room creates exactly once and returns that room", async () => {
    const { calls, freshRoom, ports } = makePorts({
      verdict: makeVerdict({ tripped: false }),
      stored: null,
    })

    const decision = await decideConnect(ports)

    expect(decision.kind).toBe("proceed")
    if (decision.kind !== "proceed") throw new Error("expected proceed")
    expect(decision.room).toBe(freshRoom)
    expect(calls.loadRoom).toBe(1)
    expect(calls.createRoom).toBe(1)
  })

  test("null verdict fails open and proceeds", async () => {
    const stored = createRoom(asRoomCode("WKRP"), 7)
    const { ports } = makePorts({ verdict: null, stored })

    const decision = await decideConnect(ports)

    expect(decision.kind).toBe("proceed")
  })

  test("tripped verdict with a PAST resetsAtIso force-opens and proceeds", async () => {
    const stored = createRoom(asRoomCode("WKRP"), 7)
    const { calls, ports } = makePorts({
      verdict: makeVerdict({ resetsAtIso: "2026-07-01T00:00:00.000Z" }),
      stored,
    })

    const decision = await decideConnect(ports)

    expect(decision.kind).toBe("proceed")
    if (decision.kind !== "proceed") throw new Error("expected proceed")
    expect(decision.room).toBe(stored)
    expect(calls.createRoom).toBe(0)
  })
})
