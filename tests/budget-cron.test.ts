import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { type BudgetKv, parseVerdict, VERDICT_KEY } from "../src/server/breaker"
import { billingPeriodStart, usageWindowStart } from "../src/server/budget"
import { type CronEnv, runBudgetCron } from "../src/server/budget-cron"

/**
 * runBudgetCron reads Date.now for its billing window, so the file runs on a
 * patched clock anchored at a fixed instant. Deterministic, no real-time sleeps.
 */
const T0 = Date.parse("2026-07-26T12:00:00.000Z")
const realDateNow = Date.now
const nowMs = T0

beforeAll(() => {
  Date.now = () => nowMs
})

afterAll(() => {
  Date.now = realDateNow
})

function kvFromMap(map: Map<string, string>): BudgetKv {
  return {
    get: async (key) => map.get(key) ?? null,
    put: async (key, value) => void map.set(key, value),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Relative fetch targets resolve against a dummy origin so a Request can be built. */
function toRequest(input: string | URL | Request, init?: RequestInit): Request {
  if (typeof input === "string" || input instanceof URL) {
    return new Request(new URL(input.toString(), "http://test.local"), init)
  }
  return init === undefined ? input : new Request(input, init)
}

/** Builds a real `fetch`-shaped stub around a Request handler - no casts. */
function stubFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  const impl = async (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
    const [input, init] = args
    return handler(toRequest(input, init))
  }
  // Bun's fetch carries a custom `preconnect`; the stub re-exports the real one.
  return Object.assign(impl, { preconnect: fetch.preconnect })
}

function stubFetcher(fixture: unknown, status = 200) {
  const calls: { url: string; body: string }[] = []
  const fetcher = stubFetch(async (req) => {
    calls.push({ url: req.url, body: await req.text() })
    return new Response(JSON.stringify(fixture), { status })
  })
  return { calls, fetcher }
}

/** Parses the captured GraphQL request body through the shape under test. */
function parseAnalyticsBody(raw: string): { variables: { a: string; s: string } } {
  const payload: unknown = JSON.parse(raw)
  if (!isObject(payload) || !isObject(payload.variables)) {
    throw new Error("expected an analytics body with variables")
  }
  const { a, s } = payload.variables
  if (typeof a !== "string" || typeof s !== "string") {
    throw new Error("expected string variables a and s")
  }
  return { variables: { a, s } }
}

/** Real captured shape from the Cloudflare analytics GraphQL API. */
const HAPPY = {
  data: {
    viewer: {
      accounts: [
        {
          durableObjectsPeriodicGroups: [
            { sum: { activeTime: 70_565_942, rowsRead: 2532, rowsWritten: 2408 } },
          ],
          durableObjectsInvocationsAdaptiveGroups: [
            { sum: { requests: 2872, inboundWebsocketMsgCount: 1429 } },
          ],
          workersInvocationsAdaptive: [{ sum: { requests: 1_519_924 } }],
        },
      ],
    },
  },
  errors: null,
}

function makeCronEnv(kv: BudgetKv): CronEnv {
  return {
    BUDGET: kv,
    CF_ANALYTICS_TOKEN: "cf-token-test",
    CF_ACCOUNT_ID: "acct-test",
    BILLING_ANCHOR_DAY: "1",
    BUDGET_TRIP_RATIO: "0.95",
    BUDGET_PLAN_TIER: "paid",
  }
}

describe("runBudgetCron", () => {
  test("writes a fresh parseable verdict from the analytics totals", async () => {
    const map = new Map<string, string>()
    const { calls, fetcher } = stubFetcher(HAPPY)

    await runBudgetCron(makeCronEnv(kvFromMap(map)), fetcher)

    const verdict = parseVerdict(map.get(VERDICT_KEY) ?? null)
    // max(0, 2872 - 1429) + ceil(1429 / 20) = 1443 + 72 = 1515 billed DO requests
    expect(verdict?.worst).toEqual({ meter: "doRequests", mtd: 1515, limit: 1_000_000 })
    expect(verdict).toMatchObject({ tripped: false, advisory: { workersRequests: 1_519_924 } })
    const call = calls.at(0)
    if (!call) throw new Error("expected one analytics call")
    const body = parseAnalyticsBody(call.body)
    expect(body.variables.a).toBe("acct-test")
    expect(body.variables.s).toBe(new Date(billingPeriodStart(nowMs, 1)).toISOString())
  })

  test("any tier value but 'paid' falls back to the free daily window", async () => {
    const map = new Map<string, string>()
    const { calls, fetcher } = stubFetcher(HAPPY)
    const env = { ...makeCronEnv(kvFromMap(map)), BUDGET_PLAN_TIER: "monthly" }

    await runBudgetCron(env, fetcher)

    const verdict = parseVerdict(map.get(VERDICT_KEY) ?? null)
    expect(verdict?.tripped).toBe(false)
    const call = calls.at(0)
    if (!call) throw new Error("expected one analytics call")
    const body = parseAnalyticsBody(call.body)
    expect(body.variables.s).toBe(new Date(usageWindowStart(nowMs, "free", 1)).toISOString())
  })

  test("warns and keeps the last verdict when the analytics API answers 500", async () => {
    const map = new Map<string, string>()
    map.set(VERDICT_KEY, "sentinel")
    const { fetcher } = stubFetcher(HAPPY, 500)
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "))
    }
    try {
      await runBudgetCron(makeCronEnv(kvFromMap(map)), fetcher)
    } finally {
      console.warn = originalWarn
    }

    expect(warnings.some((w) => w.startsWith("budget cron: ") && w.includes("500"))).toBe(true)
    expect(map.get(VERDICT_KEY)).toBe("sentinel")
  })

  test("propagates non-UsageError failures (a throwing KV put)", async () => {
    const kv: BudgetKv = {
      get: async () => null,
      put: async () => {
        throw new Error("kv exploded")
      },
    }
    const { fetcher } = stubFetcher(HAPPY)

    await expect(runBudgetCron(makeCronEnv(kv), fetcher)).rejects.toThrow("kv exploded")
  })
})
