/**
 * Budget domain: billing-period math and the trip verdict.
 *
 * The four Durable Object meters can trip the breaker; Workers requests are
 * advisory only - pausing multiplayer cannot reduce them, and static assets
 * never invoke the Worker, so tripping on that meter would pause the game
 * without stopping its own cause.
 */

/**
 * Monthly included allowances on the Workers Paid plan.
 * https://developers.cloudflare.com/durable-objects/platform/pricing/
 * https://developers.cloudflare.com/workers/platform/pricing/
 */
export const ALLOWANCES = {
  doRequests: 1_000_000,
  gbSeconds: 400_000,
  rowsWritten: 50_000_000,
  rowsRead: 25_000_000_000,
} as const

export type DoMeter = keyof typeof ALLOWANCES

/** Month-to-date account-wide totals, as the analytics API reports them. */
export type UsageTotals = {
  readonly doRequests: number
  readonly gbSeconds: number
  readonly rowsWritten: number
  readonly rowsRead: number
  readonly workersRequests: number
}

/** Schema v1 of the value stored in the BUDGET KV namespace under "verdict". */
export type BudgetVerdict = {
  readonly v: 1
  readonly tripped: boolean
  /** Highest-utilization DO meter, always present so QA can assert mtd > 0. */
  readonly worst: { readonly meter: DoMeter; readonly mtd: number; readonly limit: number }
  readonly advisory: { readonly workersRequests: number }
  readonly resetsAtIso: string
  readonly computedAtIso: string
}

const DO_METERS = [
  "doRequests",
  "gbSeconds",
  "rowsWritten",
  "rowsRead",
] as const satisfies readonly DoMeter[]

/** Length of the given UTC month (`monthIndex` may overflow/underflow, Date.UTC normalizes it). */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** Month-to-date total for one DO meter. */
function mtdFor(meter: DoMeter, usage: UsageTotals): number {
  switch (meter) {
    case "doRequests":
      return usage.doRequests
    case "gbSeconds":
      return usage.gbSeconds
    case "rowsWritten":
      return usage.rowsWritten
    case "rowsRead":
      return usage.rowsRead
  }
}

/** Start of the billing period containing `nowMs` (00:00 UTC on the anchor day, clamped to month length). */
export function billingPeriodStart(nowMs: number, anchorDay: number): number {
  const now = new Date(nowMs)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const anchor = Math.min(anchorDay, daysInMonth(year, month))
  if (now.getUTCDate() >= anchor) return Date.UTC(year, month, anchor)
  const prevAnchor = Math.min(anchorDay, daysInMonth(year, month - 1))
  return Date.UTC(year, month - 1, prevAnchor)
}

/** Start of the period after the one containing `nowMs`. */
export function nextPeriodStart(nowMs: number, anchorDay: number): number {
  const start = new Date(billingPeriodStart(nowMs, anchorDay))
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth()
  const anchor = Math.min(anchorDay, daysInMonth(year, month + 1))
  return Date.UTC(year, month + 1, anchor)
}

/** Trip when any DO meter reaches `ratio` x its allowance. */
export function computeVerdict(
  usage: UsageTotals,
  nowMs: number,
  anchorDay: number,
  ratio: number,
): BudgetVerdict {
  let worst: { meter: DoMeter; mtd: number; limit: number } = {
    meter: "doRequests",
    mtd: 0,
    limit: ALLOWANCES.doRequests,
  }
  let worstUtilization = -1
  for (const meter of DO_METERS) {
    const mtd = mtdFor(meter, usage)
    const limit = ALLOWANCES[meter]
    const utilization = mtd / limit
    if (utilization > worstUtilization) {
      worstUtilization = utilization
      worst = { meter, mtd, limit }
    }
  }
  return {
    v: 1,
    tripped: worstUtilization >= ratio,
    worst,
    advisory: { workersRequests: usage.workersRequests },
    resetsAtIso: new Date(nextPeriodStart(nowMs, anchorDay)).toISOString(),
    computedAtIso: new Date(nowMs).toISOString(),
  }
}
