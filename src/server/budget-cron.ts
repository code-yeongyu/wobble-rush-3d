/**
 * Scheduled budget check: one analytics round-trip per cron tick, then the
 * trip verdict lands in the BUDGET KV for the request-path breaker to read.
 *
 * A metering failure (UsageError) only logs - the previous verdict stays in
 * KV, so a flaky analytics API never clears or fabricates breaker state.
 * Every other failure (e.g. the KV write itself) propagates so the
 * scheduled-handler invocation is marked failed.
 */

import { type BudgetKv, writeBreaker } from "./breaker"
import { computeVerdict, type PlanTier, usageWindowStart } from "./budget"
import { fetchUsageTotals, UsageError } from "./usage-analytics"

export type CronEnv = {
  readonly BUDGET: BudgetKv
  readonly CF_ANALYTICS_TOKEN: string
  readonly CF_ACCOUNT_ID: string
  readonly BILLING_ANCHOR_DAY: string
  readonly BUDGET_TRIP_RATIO: string
  readonly BUDGET_PLAN_TIER: string
}

/** Billing anchor day of month; falls back to the 1st on junk config. */
function parseAnchorDay(raw: string): number {
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) || parsed < 1 || parsed > 31 ? 1 : parsed
}

/** Trip ratio in (0, 1] - tiny values are legal for QA drills; junk falls back to 0.95. */
function parseTripRatio(raw: string): number {
  const parsed = Number.parseFloat(raw)
  return Number.isNaN(parsed) || parsed <= 0 || parsed > 1 ? 0.95 : parsed
}

export async function runBudgetCron(env: CronEnv, fetcher: typeof fetch): Promise<void> {
  const anchorDay = parseAnchorDay(env.BILLING_ANCHOR_DAY)
  const ratio = parseTripRatio(env.BUDGET_TRIP_RATIO)
  // Free is the safe default: anything but an explicit "paid" enforces the daily windows.
  const tier: PlanTier = env.BUDGET_PLAN_TIER === "paid" ? "paid" : "free"
  const nowMs = Date.now()
  const sinceIso = new Date(usageWindowStart(nowMs, tier, anchorDay)).toISOString()
  try {
    const totals = await fetchUsageTotals(fetcher, {
      accountId: env.CF_ACCOUNT_ID,
      token: env.CF_ANALYTICS_TOKEN,
      sinceIso,
    })
    await writeBreaker(env.BUDGET, computeVerdict(totals, nowMs, tier, anchorDay, ratio))
  } catch (error) {
    if (error instanceof UsageError) {
      console.warn(`budget cron: ${error.message}`)
      return
    }
    throw error
  }
}
