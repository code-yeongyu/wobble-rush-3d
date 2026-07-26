import { describe, expect, test } from "bun:test"
import type { BudgetVerdict } from "../src/server/budget"
import {
  blockedWhilePaused,
  drainOnPause,
  gateRoomFetch,
  PAUSE_RACE_GRACE_MS,
} from "../src/server/drain-policy"
import type { ClientMessage } from "../src/shared/protocol"
import type { RoomPhase } from "../src/shared/room-types"

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

describe("PAUSE_RACE_GRACE_MS", () => {
  test("is exactly ten minutes", () => {
    expect(PAUSE_RACE_GRACE_MS).toBe(3 * 60_000)
  })
})

describe("gateRoomFetch", () => {
  test("null verdict admits the connection", () => {
    expect(gateRoomFetch(null, NOW)).toBe(false)
  })

  test("untripped verdict admits the connection", () => {
    expect(gateRoomFetch(makeVerdict({ tripped: false }), NOW)).toBe(false)
  })

  test("tripped verdict with a future resetsAt refuses the connection", () => {
    expect(gateRoomFetch(makeVerdict(), NOW)).toBe(true)
  })

  test("tripped verdict with a PAST resetsAt force-opens", () => {
    expect(gateRoomFetch(makeVerdict({ resetsAtIso: "2026-07-01T00:00:00.000Z" }), NOW)).toBe(false)
  })
})

describe("blockedWhilePaused", () => {
  const types: ClientMessage["type"][] = ["join", "ready", "state", "finish", "restart", "leave"]
  const phases: RoomPhase[] = ["lobby", "countdown", "racing", "finished"]

  // Lobby drivers are blocked everywhere; race frames only flow inside the
  // countdown|racing grace window; leaving is never blocked.
  function expectedBlocked(type: ClientMessage["type"], phase: RoomPhase): boolean {
    switch (type) {
      case "join":
      case "ready":
      case "restart":
        return true
      case "state":
      case "finish":
        return phase === "lobby" || phase === "finished"
      case "leave":
        return false
    }
  }

  for (const type of types) {
    for (const phase of phases) {
      const verdict = expectedBlocked(type, phase) ? "blocked" : "allowed"
      test(`${type} in ${phase} is ${verdict} while paused`, () => {
        expect(blockedWhilePaused(type, phase)).toBe(expectedBlocked(type, phase))
      })
    }
  }
})

describe("drainOnPause", () => {
  const phases: RoomPhase[] = ["lobby", "countdown", "racing", "finished"]

  describe("at pausedForMs 0", () => {
    test.each(phases)("%s", (phase) => {
      const expected = phase === "lobby" || phase === "finished"
      expect(drainOnPause(phase, 0)).toBe(expected)
    })
  })

  describe("at exactly PAUSE_RACE_GRACE_MS (boundary, still inside grace)", () => {
    test("lobby drains", () => {
      expect(drainOnPause("lobby", PAUSE_RACE_GRACE_MS)).toBe(true)
    })

    test("finished drains", () => {
      expect(drainOnPause("finished", PAUSE_RACE_GRACE_MS)).toBe(true)
    })

    test("countdown does NOT drain at the exact limit", () => {
      expect(drainOnPause("countdown", PAUSE_RACE_GRACE_MS)).toBe(false)
    })

    test("racing does NOT drain at the exact limit", () => {
      expect(drainOnPause("racing", PAUSE_RACE_GRACE_MS)).toBe(false)
    })
  })

  describe("at PAUSE_RACE_GRACE_MS + 1 (grace expired)", () => {
    test.each(phases)("%s drains", (phase) => {
      expect(drainOnPause(phase, PAUSE_RACE_GRACE_MS + 1)).toBe(true)
    })
  })
})
