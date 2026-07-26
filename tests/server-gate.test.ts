import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { app, type GateEnv } from "../src/server/app"
import { type BudgetKv, VERDICT_KEY } from "../src/server/breaker"
import type { BudgetVerdict } from "../src/server/budget"

/**
 * The app's breaker reader is module-level with a 60 s cache TTL, so the
 * whole file runs on a patched Date.now: each verdict-state group advances
 * the fake clock past the TTL to force a KV re-read. Deterministic, no
 * real-time sleeps.
 */
const T0 = Date.parse("2026-07-26T12:00:00.000Z")
const realDateNow = Date.now
let nowMs = T0

beforeAll(() => {
  Date.now = () => nowMs
})

afterAll(() => {
  Date.now = realDateNow
})

function advance(ms: number): void {
  nowMs += ms
}

function kvFromMap(map: Map<string, string>): BudgetKv {
  return {
    get: async (key) => map.get(key) ?? null,
    put: async (key, value) => void map.set(key, value),
  }
}

const FORWARD = async () => new Response("forwarded", { status: 418 })

function makeEnv(map: Map<string, string>): GateEnv {
  return {
    BUDGET: kvFromMap(map),
    ROOMS: {
      getByName: (_name: string) => ({ fetch: FORWARD }),
    },
    ASSETS: { fetch: async () => new Response("asset") },
    CF_ANALYTICS_TOKEN: "cf-token-test",
    CF_ACCOUNT_ID: "acct-test",
    BILLING_ANCHOR_DAY: "1",
    BUDGET_TRIP_RATIO: "0.95",
  }
}

async function call(env: GateEnv, path: string, init?: RequestInit): Promise<Response> {
  return app.fetch(new Request(`https://test.local${path}`, init), env)
}

const WS_UPGRADE: RequestInit = { headers: { Upgrade: "websocket" } }

/** Registers the three "serving normally" assertions shared by the ungated groups. */
function expectServingNormally(env: GateEnv): void {
  test("POST /api/rooms answers 200", async () => {
    const res = await call(env, "/api/rooms", { method: "POST" })
    expect(res.status).toBe(200)
  })

  test("GET /ws/BCDF with an Upgrade header is forwarded to the room stub", async () => {
    const res = await call(env, "/ws/BCDF", WS_UPGRADE)
    expect(res.status).toBe(418)
    expect(await res.text()).toBe("forwarded")
  })

  test("GET /api/status reports unpaused with a no-store header", async () => {
    const res = await call(env, "/api/status")
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({ paused: false, resetsAt: null })
  })
}

describe("characterization (pure move from index.ts, ungated)", () => {
  test("GET /api/health answers 200 {ok:true}", async () => {
    const res = await call(makeEnv(new Map()), "/api/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  test("POST /api/rooms answers 200 with a 4-letter room code", async () => {
    const res = await call(makeEnv(new Map()), "/api/rooms", { method: "POST" })
    expect(res.status).toBe(200)
    expect(parseRoomCode(await res.json())).toMatch(/^[A-HJ-NP-Z]{4}$/)
  })

  test("GET /ws/BCDF without an Upgrade header answers 426", async () => {
    const res = await call(makeEnv(new Map()), "/ws/BCDF")
    expect(res.status).toBe(426)
    expect(await res.json()).toMatchObject({ error: { code: "upgrade_required" } })
  })

  test("GET /ws/bad!! with an Upgrade header answers 400", async () => {
    const res = await call(makeEnv(new Map()), "/ws/bad!!", WS_UPGRADE)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: "invalid_room_code" } })
  })

  test("an unknown path is forwarded to ASSETS", async () => {
    const res = await call(makeEnv(new Map()), "/some/page")
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("asset")
  })

  test("GET /ws/BCDF with an Upgrade header is forwarded to the room stub", async () => {
    const res = await call(makeEnv(new Map()), "/ws/BCDF", WS_UPGRADE)
    expect(res.status).toBe(418)
    expect(await res.text()).toBe("forwarded")
  })
})

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Parses a room-creation response through the shape under test. */
function parseRoomCode(payload: unknown): string {
  if (!isObject(payload) || typeof payload.code !== "string") {
    throw new Error("expected a { code: string } body")
  }
  return payload.code
}

const FUTURE_ISO = "2026-08-15T00:00:00.000Z"
const PAST_ISO = "2026-07-01T00:00:00.000Z"
const MALFORMED = "{not json"

function trippedVerdict(resetsAtIso: string): BudgetVerdict {
  return {
    v: 1,
    tripped: true,
    worst: { meter: "rowsWritten", mtd: 47_500_000, limit: 50_000_000 },
    advisory: { workersRequests: 1 },
    resetsAtIso,
    computedAtIso: new Date(nowMs).toISOString(),
  }
}

/** One group per verdict state; each advances the clock past the reader TTL and reseeds KV. */
function verdictGroup(name: string, seed: () => string, body: (env: GateEnv) => void): void {
  describe(name, () => {
    const map = new Map<string, string>()
    const env = makeEnv(map)

    beforeAll(() => {
      advance(61_000)
      map.set(VERDICT_KEY, seed())
    })

    body(env)
  })
}

verdictGroup(
  "budget gates (breaker tripped)",
  () => JSON.stringify(trippedVerdict(FUTURE_ISO)),
  (env) => {
    test("POST /api/rooms answers 503 service_paused with resetsAt", async () => {
      const res = await call(env, "/api/rooms", { method: "POST" })
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toMatchObject({ error: { code: "service_paused", resetsAt: FUTURE_ISO } })
    })

    test("GET /ws/BCDF with an Upgrade header answers 503", async () => {
      const res = await call(env, "/ws/BCDF", WS_UPGRADE)
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toMatchObject({ error: { code: "service_paused", resetsAt: FUTURE_ISO } })
    })

    test("GET /ws/BCDF WITHOUT an Upgrade header still answers 426 while tripped", async () => {
      const res = await call(env, "/ws/BCDF")
      expect(res.status).toBe(426)
    })

    test("GET /ws/bad!! still answers 400 while tripped", async () => {
      const res = await call(env, "/ws/bad!!", WS_UPGRADE)
      expect(res.status).toBe(400)
    })

    test("GET /api/status reports paused with a no-store header", async () => {
      const res = await call(env, "/api/status")
      expect(res.status).toBe(200)
      expect(res.headers.get("cache-control")).toBe("no-store")
      expect(await res.json()).toEqual({ paused: true, resetsAt: FUTURE_ISO })
    })

    test("GET /api/health is never gated", async () => {
      const res = await call(env, "/api/health")
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true })
    })
  },
)

verdictGroup(
  "budget gates (expired verdict forces open)",
  () => JSON.stringify(trippedVerdict(PAST_ISO)),
  expectServingNormally,
)

verdictGroup("gates (malformed JSON fails open)", () => MALFORMED, expectServingNormally)
