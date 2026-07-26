/**
 * Breaker KV flag: schema-v1 verdict persistence plus a fail-open cached reader.
 *
 * Every read path fails open - malformed JSON, a schema mismatch, or a
 * throwing KV resolve to "keep serving" rather than pausing the game on bad
 * data. Writes are the only operation allowed to surface errors.
 */

import { z } from "zod"
import type { BudgetVerdict } from "./budget"

/** Minimal KV surface so the breaker and its tests need no Cloudflare types. */
export interface BudgetKv {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export const VERDICT_KEY = "verdict"

const verdictSchema = z.object({
  v: z.literal(1),
  tripped: z.boolean(),
  worst: z.object({
    meter: z.enum(["doRequests", "gbSeconds", "rowsWritten", "rowsRead"]),
    mtd: z.number(),
    limit: z.number(),
  }),
  advisory: z.object({ workersRequests: z.number() }),
  resetsAtIso: z.string(),
  computedAtIso: z.string(),
})

/** Decode a stored flag; any malformed value reads as "no verdict", never throws. */
export function parseVerdict(raw: string | null): BudgetVerdict | null {
  if (raw === null) {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const result = verdictSchema.safeParse(json)
  return result.success ? result.data : null
}

export async function writeBreaker(kv: BudgetKv, verdict: BudgetVerdict): Promise<void> {
  await kv.put(VERDICT_KEY, JSON.stringify(verdict))
}

/**
 * Cached reader: within `ttlMs` serves the last fetched verdict without
 * touching KV; past it, re-reads. A throwing `kv.get` yields the stale value
 * (or null before the first success) and never propagates.
 */
export function makeBreakerReader(
  ttlMs = 60_000,
): (kv: BudgetKv, nowMs: number) => Promise<BudgetVerdict | null> {
  let cached: BudgetVerdict | null = null
  let fetchedAtMs = Number.NEGATIVE_INFINITY
  return async (kv, nowMs) => {
    if (nowMs - fetchedAtMs < ttlMs) {
      return cached
    }
    try {
      cached = parseVerdict(await kv.get(VERDICT_KEY))
      fetchedAtMs = nowMs
    } catch {
      // Fail open: serve the stale verdict and retry on the next call.
    }
    return cached
  }
}

/** True only while a tripped verdict's billing period is still running. */
export function isPaused(verdict: BudgetVerdict | null, nowMs: number): boolean {
  if (verdict === null || !verdict.tripped) {
    return false
  }
  return nowMs < Date.parse(verdict.resetsAtIso)
}
