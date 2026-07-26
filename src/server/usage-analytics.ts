/**
 * Usage analytics: a single GraphQL round-trip to the Cloudflare analytics API
 * that reads every meter the budget verdict needs for the current window.
 *
 * All three datasets ride in one request, each with `limit: 2` purely as a
 * tripwire: no group dimensions are requested, so a healthy response carries
 * exactly one account-wide aggregate node per dataset (or zero when the window
 * had no usage). A second node would mean partial buckets - reading only the
 * first would silently undercount, so that response is rejected instead.
 */

import { z } from "zod"
import type { UsageTotals } from "./budget"

const ANALYTICS_URL = "https://api.cloudflare.com/client/v4/graphql"

/** One document, three datasets; variables keep account and window out of the query text. */
const USAGE_QUERY = `query($a:String!,$s:Time!){viewer{accounts(filter:{accountTag:$a}){
 durableObjectsPeriodicGroups(limit:2, filter:{datetime_geq:$s}){sum{activeTime rowsWritten rowsRead}}
 durableObjectsInvocationsAdaptiveGroups(limit:2, filter:{datetime_geq:$s}){sum{requests inboundWebsocketMsgCount}}
 workersInvocationsAdaptive(limit:2, filter:{datetime_geq:$s}){sum{requests}}
}}}`

export class UsageError extends Error {
  readonly status: number | null
  readonly detail: string

  constructor(detail: string, status: number | null = null) {
    super(`Usage metering failed: ${detail}`)
    this.name = "UsageError"
    this.detail = detail
    this.status = status
  }
}

/* ------------------------------------------------------------------ *
 * Zod schemas — boundary validation, same style as shared/protocol.ts.
 * ------------------------------------------------------------------ */

const periodicGroupSchema = z.object({
  sum: z.object({
    activeTime: z.number(),
    rowsWritten: z.number(),
    rowsRead: z.number(),
  }),
})

const doInvocationGroupSchema = z.object({
  sum: z.object({ requests: z.number(), inboundWebsocketMsgCount: z.number() }),
})

const invocationGroupSchema = z.object({
  sum: z.object({ requests: z.number() }),
})

const accountSchema = z.object({
  durableObjectsPeriodicGroups: z.array(periodicGroupSchema),
  durableObjectsInvocationsAdaptiveGroups: z.array(doInvocationGroupSchema),
  workersInvocationsAdaptive: z.array(invocationGroupSchema),
})

type DatasetName = keyof z.infer<typeof accountSchema>

const analyticsResponseSchema = z.object({
  data: z.object({ viewer: z.object({ accounts: z.array(accountSchema) }) }).nullable(),
  errors: z.array(z.object({ message: z.string() })).nullable(),
})

/** The single aggregate node for a dataset, or null when the window had no usage. */
function singleNode<T>(nodes: readonly T[], dataset: DatasetName): T | null {
  if (nodes.length > 1) {
    throw new UsageError(`expected a single aggregate node for ${dataset}, got ${nodes.length}`)
  }
  return nodes.at(0) ?? null
}

function parsePayload(payload: unknown): z.infer<typeof analyticsResponseSchema> {
  const parsed = analyticsResponseSchema.safeParse(payload)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join(".")}: ${issue.message}`,
    )
    throw new UsageError(`unexpected analytics payload: ${issues.join("; ")}`)
  }
  return parsed.data
}

/** Exactly one attempt - no retries; callers decide whether a failure is fatal. */
export async function fetchUsageTotals(
  fetcher: typeof fetch,
  opts: { readonly accountId: string; readonly token: string; readonly sinceIso: string },
): Promise<UsageTotals> {
  let response: Response
  try {
    response = await fetcher(ANALYTICS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: USAGE_QUERY,
        variables: { a: opts.accountId, s: opts.sinceIso },
      }),
    })
  } catch (cause) {
    throw new UsageError(String(cause))
  }

  if (!response.ok) {
    throw new UsageError(`analytics API answered HTTP ${response.status}`, response.status)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (cause) {
    throw new UsageError(`analytics API returned invalid JSON: ${String(cause)}`)
  }

  const { data, errors } = parsePayload(payload)
  const firstError = errors?.at(0)
  if (firstError) {
    throw new UsageError(firstError.message)
  }
  if (!data) {
    throw new UsageError("analytics response carried no data")
  }
  const account = data.viewer.accounts.length === 1 ? data.viewer.accounts.at(0) : undefined
  if (!account) {
    throw new UsageError(`expected a single account node, got ${data.viewer.accounts.length}`)
  }

  const periodic = singleNode(account.durableObjectsPeriodicGroups, "durableObjectsPeriodicGroups")
  const doInvocations = singleNode(
    account.durableObjectsInvocationsAdaptiveGroups,
    "durableObjectsInvocationsAdaptiveGroups",
  )
  const workers = singleNode(account.workersInvocationsAdaptive, "workersInvocationsAdaptive")

  const rawRequests = doInvocations?.sum.requests ?? 0
  const inboundWs = doInvocations?.sum.inboundWebsocketMsgCount ?? 0
  // Cloudflare bills incoming WebSocket messages to a DO at 20 messages per
  // billed request, while every other invocation bills 1:1
  // (https://developers.cloudflare.com/durable-objects/platform/pricing/).
  // sum.requests counts raw invocations, so split off the WebSocket traffic
  // and re-price it; the two counters are sampled independently and inboundWs
  // can exceed rawRequests, so the 1:1 remainder clamps at zero.
  const doRequests = Math.max(0, rawRequests - inboundWs) + Math.ceil(inboundWs / 20)

  const activeTimeMicros = periodic?.sum.activeTime ?? 0
  return {
    doRequests,
    // DO duration bills a fixed 128 MB (https://developers.cloudflare.com/durable-objects/platform/pricing/)
    gbSeconds: (activeTimeMicros / 1e6) * 0.125,
    rowsWritten: periodic?.sum.rowsWritten ?? 0,
    rowsRead: periodic?.sum.rowsRead ?? 0,
    workersRequests: workers?.sum.requests ?? 0,
  }
}
