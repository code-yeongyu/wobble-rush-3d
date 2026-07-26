import { describe, expect, test } from "bun:test"
import type { UsageTotals } from "../src/server/budget"
import {
  ALLOWANCES_FREE,
  ALLOWANCES_PAID,
  billingPeriodStart,
  computeVerdict,
  nextPeriodStart,
  usageWindowStart,
} from "../src/server/budget"

const ANCHOR = 1
const RATIO = 0.95

function makeUsage(overrides: Partial<UsageTotals> = {}): UsageTotals {
  return {
    doRequests: 0,
    gbSeconds: 0,
    rowsWritten: 0,
    rowsRead: 0,
    workersRequests: 0,
    ...overrides,
  }
}

describe("billingPeriodStart", () => {
  test("mid-month with anchor 1 starts on the first of the month", () => {
    const now = Date.UTC(2026, 2, 15, 12, 30, 0)
    expect(billingPeriodStart(now, 1)).toBe(Date.UTC(2026, 2, 1))
  })

  test("day before the anchor rolls back to the previous month", () => {
    const now = Date.UTC(2026, 2, 14, 23, 59, 59)
    expect(billingPeriodStart(now, 15)).toBe(Date.UTC(2026, 1, 15))
  })

  test("on the anchor day itself the period starts that day at 00:00 UTC", () => {
    const now = Date.UTC(2026, 2, 15, 0, 0, 1)
    expect(billingPeriodStart(now, 15)).toBe(Date.UTC(2026, 2, 15))
  })

  test("anchor 31 in February 2026 clamps to Feb 28", () => {
    const now = Date.UTC(2026, 2, 5, 8, 0, 0)
    expect(billingPeriodStart(now, 31)).toBe(Date.UTC(2026, 1, 28))
  })

  test("anchor 31 in April clamps to Apr 30", () => {
    const now = Date.UTC(2026, 4, 10, 8, 0, 0)
    expect(billingPeriodStart(now, 31)).toBe(Date.UTC(2026, 3, 30))
  })

  test("anchor 31 in leap-year February 2028 clamps to Feb 29", () => {
    const now = Date.UTC(2028, 2, 10, 8, 0, 0)
    expect(billingPeriodStart(now, 31)).toBe(Date.UTC(2028, 1, 29))
  })
})

describe("nextPeriodStart", () => {
  test("mid-month with anchor 1 rolls to the first of the next month", () => {
    const now = Date.UTC(2026, 2, 15, 12, 30, 0)
    expect(nextPeriodStart(now, 1)).toBe(Date.UTC(2026, 3, 1))
  })

  test("day before the anchor rolls to this month's anchor", () => {
    const now = Date.UTC(2026, 2, 14, 23, 59, 59)
    expect(nextPeriodStart(now, 15)).toBe(Date.UTC(2026, 2, 15))
  })

  test("anchor 31 after the February 2026 clamp lands on Mar 31", () => {
    const now = Date.UTC(2026, 2, 5, 8, 0, 0)
    expect(nextPeriodStart(now, 31)).toBe(Date.UTC(2026, 2, 31))
  })

  test("anchor 31 after the April clamp lands on May 31", () => {
    const now = Date.UTC(2026, 4, 10, 8, 0, 0)
    expect(nextPeriodStart(now, 31)).toBe(Date.UTC(2026, 4, 31))
  })

  test("anchor 31 after leap-year February 2028 lands on Mar 31", () => {
    const now = Date.UTC(2028, 2, 10, 8, 0, 0)
    expect(nextPeriodStart(now, 31)).toBe(Date.UTC(2028, 2, 31))
  })
})

describe("usageWindowStart", () => {
  test("free returns the UTC day start containing now, whatever the anchor", () => {
    const now = Date.parse("2026-07-26T13:45:00.000Z")
    expect(usageWindowStart(now, "free", 1)).toBe(Date.parse("2026-07-26T00:00:00.000Z"))
    expect(usageWindowStart(now, "free", 27)).toBe(Date.parse("2026-07-26T00:00:00.000Z"))
  })

  test("free at exactly UTC midnight returns that midnight", () => {
    const midnight = Date.parse("2026-07-26T00:00:00.000Z")
    expect(usageWindowStart(midnight, "free", ANCHOR)).toBe(midnight)
  })

  test("paid returns the billing period start for the anchor", () => {
    const now = Date.UTC(2026, 2, 15, 12, 0, 0)
    expect(usageWindowStart(now, "paid", 15)).toBe(Date.UTC(2026, 2, 15))
    expect(usageWindowStart(now, "paid", 1)).toBe(Date.UTC(2026, 2, 1))
  })
})

describe("computeVerdict tripping (paid, monthly)", () => {
  const now = Date.UTC(2026, 2, 15, 12, 0, 0)

  test("doRequests trips independently at the ratio", () => {
    const verdict = computeVerdict(makeUsage({ doRequests: 950_000 }), now, "paid", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(true)
    expect(verdict.worst.meter).toBe("doRequests")
    expect(verdict.worst.mtd).toBe(950_000)
    expect(verdict.worst.limit).toBe(ALLOWANCES_PAID.doRequests)
  })

  test("gbSeconds trips independently at the ratio", () => {
    const verdict = computeVerdict(makeUsage({ gbSeconds: 380_000 }), now, "paid", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(true)
    expect(verdict.worst.meter).toBe("gbSeconds")
  })

  test("rowsWritten trips independently at the ratio", () => {
    const verdict = computeVerdict(
      makeUsage({ rowsWritten: 47_500_000 }),
      now,
      "paid",
      ANCHOR,
      RATIO,
    )
    expect(verdict.tripped).toBe(true)
    expect(verdict.worst.meter).toBe("rowsWritten")
  })

  test("rowsRead trips independently at the ratio", () => {
    const verdict = computeVerdict(
      makeUsage({ rowsRead: 23_750_000_000 }),
      now,
      "paid",
      ANCHOR,
      RATIO,
    )
    expect(verdict.tripped).toBe(true)
    expect(verdict.worst.meter).toBe("rowsRead")
  })

  test("utilization 0.9499 does not trip", () => {
    const verdict = computeVerdict(makeUsage({ doRequests: 949_900 }), now, "paid", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(false)
    expect(verdict.worst.meter).toBe("doRequests")
  })

  test("utilization exactly 0.95 trips", () => {
    const verdict = computeVerdict(makeUsage({ doRequests: 950_000 }), now, "paid", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(true)
  })

  test("utilization 1.0 trips", () => {
    const verdict = computeVerdict(makeUsage({ doRequests: 1_000_000 }), now, "paid", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(true)
  })
})

describe("computeVerdict free tier (daily UTC windows)", () => {
  const now = Date.parse("2026-07-26T13:45:00.000Z")

  test("mid-day now resets at the next UTC midnight", () => {
    const verdict = computeVerdict(makeUsage(), now, "free", ANCHOR, RATIO)
    expect(verdict.resetsAtIso).toBe("2026-07-27T00:00:00.000Z")
    expect(verdict.computedAtIso).toBe("2026-07-26T13:45:00.000Z")
  })

  test("exactly at UTC midnight the window starts there and resets a day later", () => {
    const midnight = Date.parse("2026-07-26T00:00:00.000Z")
    const verdict = computeVerdict(makeUsage(), midnight, "free", ANCHOR, RATIO)
    expect(usageWindowStart(midnight, "free", ANCHOR)).toBe(midnight)
    expect(verdict.resetsAtIso).toBe("2026-07-27T00:00:00.000Z")
  })

  test("rowsWritten 95k trips the 100k daily allowance at ratio 0.95", () => {
    const verdict = computeVerdict(makeUsage({ rowsWritten: 95_000 }), now, "free", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(true)
    expect(verdict.worst).toEqual({
      meter: "rowsWritten",
      mtd: 95_000,
      limit: ALLOWANCES_FREE.rowsWritten,
    })
  })

  test("paid does NOT trip on the same rowsWritten 95k usage", () => {
    const verdict = computeVerdict(makeUsage({ rowsWritten: 95_000 }), now, "paid", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(false)
    expect(verdict.worst.meter).toBe("rowsWritten")
    expect(verdict.worst.limit).toBe(ALLOWANCES_PAID.rowsWritten)
  })

  test("doRequests 95k trips the 100k daily allowance at ratio 0.95", () => {
    const verdict = computeVerdict(makeUsage({ doRequests: 95_000 }), now, "free", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(true)
    expect(verdict.worst.meter).toBe("doRequests")
    expect(verdict.worst.limit).toBe(ALLOWANCES_FREE.doRequests)
  })

  test("free ignores anchorDay (identical verdicts for anchor 1 and 27)", () => {
    const usage = makeUsage({ rowsWritten: 95_000 })
    const byAnchor1 = computeVerdict(usage, now, "free", 1, RATIO)
    const byAnchor27 = computeVerdict(usage, now, "free", 27, RATIO)
    expect(byAnchor1).toEqual(byAnchor27)
  })
})

describe("computeVerdict advisory and metadata", () => {
  const now = Date.UTC(2026, 2, 15, 12, 0, 0)

  test("workersRequests at 200% of 10M never trips and is carried verbatim", () => {
    const verdict = computeVerdict(
      makeUsage({ workersRequests: 20_000_000 }),
      now,
      "paid",
      ANCHOR,
      RATIO,
    )
    expect(verdict.tripped).toBe(false)
    expect(verdict.advisory.workersRequests).toBe(20_000_000)
  })

  test("a new period with small usage is untripped and resets strictly after now", () => {
    const resetNow = Date.UTC(2026, 3, 1, 0, 0, 1)
    const verdict = computeVerdict(makeUsage({ doRequests: 100 }), resetNow, "paid", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(false)
    expect(Date.parse(verdict.resetsAtIso)).toBeGreaterThan(resetNow)
    expect(verdict.resetsAtIso).toBe(new Date(Date.UTC(2026, 4, 1)).toISOString())
  })

  test("verdict carries schema v1 and both ISO timestamps", () => {
    const verdict = computeVerdict(makeUsage(), now, "paid", ANCHOR, RATIO)
    expect(verdict.v).toBe(1)
    expect(verdict.computedAtIso).toBe(new Date(now).toISOString())
    expect(verdict.resetsAtIso).toBe(new Date(Date.UTC(2026, 3, 1)).toISOString())
  })
})

describe("computeVerdict worst-meter selection", () => {
  const now = Date.UTC(2026, 2, 15, 12, 0, 0)

  test("all-zero usage is untripped with doRequests as the first-key worst", () => {
    const verdict = computeVerdict(makeUsage(), now, "paid", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(false)
    expect(verdict.worst).toEqual({
      meter: "doRequests",
      mtd: 0,
      limit: ALLOWANCES_PAID.doRequests,
    })
  })

  test("rowsWritten at 50% beats doRequests at 10%", () => {
    const usage = makeUsage({ doRequests: 100_000, rowsWritten: 25_000_000 })
    const verdict = computeVerdict(usage, now, "paid", ANCHOR, RATIO)
    expect(verdict.tripped).toBe(false)
    expect(verdict.worst.meter).toBe("rowsWritten")
    expect(verdict.worst.mtd).toBe(25_000_000)
    expect(verdict.worst.limit).toBe(ALLOWANCES_PAID.rowsWritten)
  })
})
