import { describe, expect, test } from "bun:test"
import { fetchUsageTotals, UsageError } from "../src/server/usage-analytics"

const ACCOUNT_ID = "acct-9f8e7d6c5b4a"
const TOKEN = "cf-token-deadbeef"
const SINCE = "2026-07-01T00:00:00.000Z"
const OPTS = { accountId: ACCOUNT_ID, token: TOKEN, sinceIso: SINCE } as const

type CapturedCall = {
  readonly input: Parameters<typeof fetch>[0]
  readonly init: Parameters<typeof fetch>[1]
}

function stubFetcher(fixture: unknown, status = 200) {
  const calls: CapturedCall[] = []
  const fetcher: typeof fetch = (async (
    input: CapturedCall["input"],
    init: CapturedCall["init"],
  ) => {
    calls.push({ input, init })
    return new Response(JSON.stringify(fixture), { status })
  }) as typeof fetch
  return { calls, fetcher }
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
          durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: 2872 } }],
          workersInvocationsAdaptive: [{ sum: { requests: 1_519_924 } }],
        },
      ],
    },
  },
  errors: null,
}

async function catchUsageError(promise: Promise<unknown>): Promise<UsageError> {
  try {
    await promise
  } catch (e) {
    expect(e).toBeInstanceOf(UsageError)
    return e as UsageError
  }
  throw new Error("expected fetchUsageTotals to reject with UsageError")
}

describe("fetchUsageTotals", () => {
  test("maps a real single-node analytics response into usage totals", async () => {
    const { fetcher } = stubFetcher(HAPPY)

    const totals = await fetchUsageTotals(fetcher, OPTS)

    expect(totals.doRequests).toBe(2872)
    expect(totals.rowsWritten).toBe(2408)
    expect(totals.rowsRead).toBe(2532)
    expect(totals.workersRequests).toBe(1_519_924)
    // 70_565_942 / 1e6 * 0.125 = 8.82074275
    expect(Math.abs(totals.gbSeconds - 8.8207)).toBeLessThan(0.001)
  })

  test("rejects a multi-node dataset instead of silently undercounting", async () => {
    const fixture = {
      data: {
        viewer: {
          accounts: [
            {
              durableObjectsPeriodicGroups: [],
              durableObjectsInvocationsAdaptiveGroups: [],
              workersInvocationsAdaptive: [{ sum: { requests: 10 } }, { sum: { requests: 20 } }],
            },
          ],
        },
      },
      errors: null,
    }
    const { fetcher } = stubFetcher(fixture)

    const err = await catchUsageError(fetchUsageTotals(fetcher, OPTS))
    expect(err.message).toContain("single aggregate node")
  })

  test("treats empty datasets as zero usage without throwing", async () => {
    const fixture = {
      data: {
        viewer: {
          accounts: [
            {
              durableObjectsPeriodicGroups: [],
              durableObjectsInvocationsAdaptiveGroups: [],
              workersInvocationsAdaptive: [],
            },
          ],
        },
      },
      errors: null,
    }
    const { fetcher } = stubFetcher(fixture)

    const totals = await fetchUsageTotals(fetcher, OPTS)

    expect(totals).toEqual({
      doRequests: 0,
      gbSeconds: 0,
      rowsWritten: 0,
      rowsRead: 0,
      workersRequests: 0,
    })
  })

  test("surfaces the first GraphQL error message", async () => {
    const { fetcher } = stubFetcher({ data: null, errors: [{ message: "boom" }] })

    const err = await catchUsageError(fetchUsageTotals(fetcher, OPTS))
    expect(err.message).toContain("boom")
  })

  test("carries the HTTP status on a non-2xx response", async () => {
    const { fetcher } = stubFetcher({ errors: [{ message: "Forbidden" }] }, 403)

    const err = await catchUsageError(fetchUsageTotals(fetcher, OPTS))
    expect(err.status).toBe(403)
    expect(err.message).toContain("403")
  })

  test("rejects a malformed sum with the zod path surfaced", async () => {
    const fixture = {
      data: {
        viewer: {
          accounts: [
            {
              durableObjectsPeriodicGroups: [{ sum: { activeTime: 1, rowsRead: 2 } }],
              durableObjectsInvocationsAdaptiveGroups: [],
              workersInvocationsAdaptive: [],
            },
          ],
        },
      },
      errors: null,
    }
    const { fetcher } = stubFetcher(fixture)

    const err = await catchUsageError(fetchUsageTotals(fetcher, OPTS))
    expect(err.message).toContain("rowsWritten")
  })

  test("issues exactly one POST carrying all datasets, variables, and the bearer token", async () => {
    const { calls, fetcher } = stubFetcher(HAPPY)

    await fetchUsageTotals(fetcher, OPTS)

    expect(calls).toHaveLength(1)
    const call = calls.at(0)
    if (!call) throw new Error("expected one captured call")
    expect(String(call.input)).toBe("https://api.cloudflare.com/client/v4/graphql")
    expect(call.init?.method).toBe("POST")
    const headers = call.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(headers["content-type"]).toBe("application/json")
    const body = JSON.parse(String(call.init?.body)) as {
      query: string
      variables: Record<string, string>
    }
    expect(body.query).toContain("durableObjectsPeriodicGroups")
    expect(body.query).toContain("durableObjectsInvocationsAdaptiveGroups")
    expect(body.query).toContain("workersInvocationsAdaptive")
    expect(body.variables).toEqual({ a: ACCOUNT_ID, s: SINCE })
  })
})
