import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { fetchUsageTotals, UsageError } from "../src/server/usage-analytics"

const ACCOUNT_ID = "acct-9f8e7d6c5b4a"
const TOKEN = "cf-token-deadbeef"
const SINCE = "2026-07-01T00:00:00.000Z"
const OPTS = { accountId: ACCOUNT_ID, token: TOKEN, sinceIso: SINCE } as const

type CapturedCall = {
  readonly input: string | URL | Request
  readonly init: RequestInit | undefined
}

function stubFetcher(
  fixture: unknown,
  status = 200,
): { readonly calls: CapturedCall[]; readonly fetcher: typeof fetch } {
  const calls: CapturedCall[] = []
  const fetcher: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ input, init })
      return new Response(JSON.stringify(fixture), { status })
    },
    { preconnect: (_url: string | URL): void => undefined },
  )
  return { calls, fetcher }
}

/** Real captured shape from the Cloudflare analytics GraphQL API. */
const HAPPY = {
  data: {
    viewer: {
      accounts: [
        {
          durableObjectsPeriodicGroups: [
            {
              sum: {
                activeTime: 70_565_942,
                rowsRead: 2532,
                rowsWritten: 2408,
                inboundWebsocketMsgCount: 1429,
              },
            },
          ],
          durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: 2872 } }],
          workersInvocationsAdaptive: [{ sum: { requests: 1_519_924 } }],
        },
      ],
    },
  },
  errors: null,
}

function invocationFixture(requests: number, inboundWebsocketMsgCount: number): unknown {
  return {
    data: {
      viewer: {
        accounts: [
          {
            durableObjectsPeriodicGroups: [
              { sum: { activeTime: 0, rowsRead: 0, rowsWritten: 0, inboundWebsocketMsgCount } },
            ],
            durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests } }],
            workersInvocationsAdaptive: [],
          },
        ],
      },
    },
    errors: null,
  }
}

async function catchUsageError(promise: Promise<unknown>): Promise<UsageError> {
  try {
    await promise
  } catch (e) {
    if (e instanceof UsageError) {
      return e
    }
    throw e
  }
  throw new Error("expected fetchUsageTotals to reject with UsageError")
}

describe("fetchUsageTotals", () => {
  test("maps a real single-node analytics response into usage totals", async () => {
    const { fetcher } = stubFetcher(HAPPY)

    const totals = await fetchUsageTotals(fetcher, OPTS)

    // Billed DO requests: max(0, 2872 - 1429) + ceil(1429 / 20) = 1443 + 72 = 1515
    expect(totals.doRequests).toBe(1515)
    expect(totals.rowsWritten).toBe(2408)
    expect(totals.rowsRead).toBe(2532)
    expect(totals.workersRequests).toBe(1_519_924)
    // 70_565_942 / 1e6 * 0.125 = 8.82074275
    expect(Math.abs(totals.gbSeconds - 8.8207)).toBeLessThan(0.001)
  })

  test("clamps the non-WebSocket remainder when sampled inbound messages exceed raw requests", async () => {
    // The two counters are sampled independently, so inboundWebsocketMsgCount
    // can legitimately land above sum.requests; the remainder clamps at zero.
    const { fetcher } = stubFetcher(invocationFixture(100, 1429))

    const totals = await fetchUsageTotals(fetcher, OPTS)

    // max(0, 100 - 1429) + ceil(1429 / 20) = 0 + 72 = 72
    expect(totals.doRequests).toBe(72)
  })

  test("leaves doRequests unchanged when no inbound WebSocket messages were sampled", async () => {
    const { fetcher } = stubFetcher(invocationFixture(2872, 0))

    const totals = await fetchUsageTotals(fetcher, OPTS)

    // max(0, 2872 - 0) + ceil(0 / 20) = 2872
    expect(totals.doRequests).toBe(2872)
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
    const headers = new Headers(call.init?.headers)
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`)
    expect(headers.get("content-type")).toBe("application/json")
    const requestBodySchema = z.object({
      query: z.string(),
      variables: z.object({ a: z.string(), s: z.string() }),
    })
    const body = requestBodySchema.parse(JSON.parse(String(call.init?.body)))
    expect(body.query).toContain("durableObjectsPeriodicGroups")
    expect(body.query).toContain("durableObjectsInvocationsAdaptiveGroups")
    expect(body.query).toMatch(
      /durableObjectsPeriodicGroups\(limit:2[^)]*\)\{sum\{[^}]*inboundWebsocketMsgCount/,
    )
    expect(body.query).not.toMatch(
      /durableObjectsInvocationsAdaptiveGroups\(limit:2[^)]*\)\{sum\{[^}]*inboundWebsocketMsgCount/,
    )
    expect(body.query).toContain("workersInvocationsAdaptive")
    expect(body.variables).toEqual({ a: ACCOUNT_ID, s: SINCE })
  })
})
