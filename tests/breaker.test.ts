import { describe, expect, test } from "bun:test"
import type { BudgetKv } from "../src/server/breaker"
import {
  isPaused,
  makeBreakerReader,
  parseVerdict,
  VERDICT_KEY,
  writeBreaker,
} from "../src/server/breaker"
import type { BudgetVerdict } from "../src/server/budget"

const T0 = 1_000_000

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

function makeMapKv(
  initial: Record<string, string> = {},
): BudgetKv & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial))
  return {
    store,
    get: (key) => Promise.resolve(store.get(key) ?? null),
    put: (key, value) => {
      store.set(key, value)
      return Promise.resolve()
    },
  }
}

function counting(kv: BudgetKv): { kv: BudgetKv; calls: () => number } {
  let n = 0
  return {
    calls: () => n,
    kv: {
      get: (key) => {
        n += 1
        return kv.get(key)
      },
      put: (key, value) => kv.put(key, value),
    },
  }
}

describe("breaker roundtrip", () => {
  test("writeBreaker then reader round-trips the verdict through a Map-backed KV", async () => {
    const kv = makeMapKv()
    const verdict = makeVerdict()
    await writeBreaker(kv, verdict)
    expect(kv.store.get(VERDICT_KEY)).toBe(JSON.stringify(verdict))
    const read = makeBreakerReader()
    expect(await read(kv, T0)).toEqual(verdict)
  })
})

describe("parseVerdict", () => {
  test("parses a valid verdict", () => {
    expect(parseVerdict(JSON.stringify(makeVerdict()))).toEqual(makeVerdict())
  })

  test("returns null for null input", () => {
    expect(parseVerdict(null)).toBeNull()
  })

  test("returns null for garbage that is not JSON", () => {
    expect(parseVerdict("not json {{{")).toBeNull()
  })

  test("returns null for valid JSON with the wrong shape", () => {
    expect(parseVerdict(JSON.stringify({ v: 2, tripped: true }))).toBeNull()
    expect(
      parseVerdict(
        JSON.stringify({ ...makeVerdict(), worst: { meter: "workersRequests", mtd: 1, limit: 2 } }),
      ),
    ).toBeNull()
  })
})

describe("isPaused", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z")

  test("tripped with a future resetsAtIso pauses", () => {
    expect(isPaused(makeVerdict(), now)).toBe(true)
  })

  test("tripped with a past resetsAtIso force-opens", () => {
    expect(isPaused(makeVerdict({ resetsAtIso: "2026-07-01T00:00:00.000Z" }), now)).toBe(false)
  })

  test("untripped verdict never pauses", () => {
    expect(isPaused(makeVerdict({ tripped: false }), now)).toBe(false)
  })

  test("null verdict never pauses", () => {
    expect(isPaused(null, now)).toBe(false)
  })

  test("tripped with an unparseable resetsAtIso opens (Date.parse NaN)", () => {
    expect(isPaused(makeVerdict({ resetsAtIso: "not-a-date" }), now)).toBe(false)
  })
})

describe("breaker reader cache", () => {
  test("serves from cache within ttl and refetches past it", async () => {
    const base = makeMapKv({ [VERDICT_KEY]: JSON.stringify(makeVerdict()) })
    const { kv, calls } = counting(base)
    const read = makeBreakerReader()
    await read(kv, T0)
    await read(kv, T0 + 30_000)
    expect(calls()).toBe(1)
    await read(kv, T0 + 61_000)
    expect(calls()).toBe(2)
  })

  test("honours a custom ttl", async () => {
    const base = makeMapKv({ [VERDICT_KEY]: JSON.stringify(makeVerdict()) })
    const { kv, calls } = counting(base)
    const read = makeBreakerReader(5_000)
    await read(kv, T0)
    await read(kv, T0 + 6_000)
    expect(calls()).toBe(2)
  })
})

describe("breaker reader fail-open", () => {
  test("returns the last cached verdict when kv.get throws past ttl", async () => {
    const verdict = makeVerdict()
    const base = makeMapKv({ [VERDICT_KEY]: JSON.stringify(verdict) })
    let fail = false
    const kv: BudgetKv = {
      get: (key) => (fail ? Promise.reject(new Error("kv down")) : base.get(key)),
      put: base.put,
    }
    const read = makeBreakerReader()
    expect(await read(kv, T0)).toEqual(verdict)
    fail = true
    expect(await read(kv, T0 + 61_000)).toEqual(verdict)
  })

  test("returns null when kv.get throws with an empty cache", async () => {
    const kv: BudgetKv = {
      get: () => Promise.reject(new Error("kv down")),
      put: () => Promise.resolve(),
    }
    const read = makeBreakerReader()
    expect(await read(kv, T0)).toBeNull()
  })
})
