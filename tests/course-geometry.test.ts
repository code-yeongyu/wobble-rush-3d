/**
 * Executable geometry audit for the "Sunrise Scramble" course data.
 *
 * Every assertion is computed from SUNRISE_SCRAMBLE and the simulation's own
 * kinematics (world snapshots, obstacle functions, RUNNER constants) — nothing
 * is a hand-copied constant, so a future level edit re-audits itself.
 */

import { describe, expect, test } from "bun:test"
import { RUNNER } from "../src/shared/constants"
import { bumperSphereAt, moverBoxAt, sweeperArmAt } from "../src/shared/obstacles"
import { SUNRISE_SCRAMBLE as course } from "../src/shared/sunrise-scramble"
import type { BoxCollider, Platform } from "../src/shared/types"
import { createWorldSnapshot } from "../src/shared/world"

type Aabb = {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
}

/** AABB of a yaw-0 box (every static platform and mover box in this course). */
const aabbOf = (box: BoxCollider): Aabb => ({
  minX: box.center.x - box.halfExtents.x,
  maxX: box.center.x + box.halfExtents.x,
  minY: box.center.y - box.halfExtents.y,
  maxY: box.center.y + box.halfExtents.y,
  minZ: box.center.z - box.halfExtents.z,
  maxZ: box.center.z + box.halfExtents.z,
})

/** Strict volume overlap: faces that merely touch (abut) do not count. */
const overlaps = (a: Aabb, b: Aabb): boolean =>
  a.minX < b.maxX &&
  a.maxX > b.minX &&
  a.minY < b.maxY &&
  a.maxY > b.minY &&
  a.minZ < b.maxZ &&
  a.maxZ > b.minZ

/** XZ clearance between two footprints; 0 when they touch or overlap. */
const xzGap = (a: Aabb, b: Aabb): number => {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX))
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ))
  return Math.hypot(dx, dz)
}

const containsXz = (a: Aabb, x: number, z: number): boolean =>
  x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ

const deckTop = (p: Platform): number => p.box.center.y + p.box.halfExtents.y

const consecutivePairs = <T>(items: readonly T[]): [T, T][] =>
  items.slice(1).map((item, i) => [items[i] ?? item, item])

/** Full-jump horizontal distance derived from the runner's own tuning. */
const jumpApex = RUNNER.jumpSpeed ** 2 / (2 * RUNNER.gravityRise)
const jumpAirSec =
  RUNNER.jumpSpeed / RUNNER.gravityRise + Math.sqrt((2 * jumpApex) / RUNNER.gravityFall)
const jumpDistance = RUNNER.runSpeed * jumpAirSec
/** A gap is "comfortable" when it uses at most this fraction of a full jump. */
const COMFORT_FRACTION = 0.75
/** Waypoint spacing beyond which an NPC leg reads as a teleport, m. */
const MAX_WAYPOINT_LEG = 12
/** XZ clearance at which a flush mover counts as docked with a deck, m. */
const DOCK_CLEARANCE = 0.25

const sweepers = course.obstacles.filter((o) => o.kind === "sweeper")
const movers = course.obstacles.filter((o) => o.kind === "mover")
const bumpers = course.obstacles.filter((o) => o.kind === "bumper")

describe("1. platform overlap", () => {
  test("no two platform volumes intersect", () => {
    // No entry in this course justifies a deliberate overlap: the route never
    // stacks decks, so any pair found here is unintended.
    const violations: string[] = []
    for (const [i, a] of course.platforms.entries()) {
      for (const b of course.platforms.slice(i + 1)) {
        if (overlaps(aabbOf(a.box), aabbOf(b.box))) violations.push(`${a.id} x ${b.id}`)
      }
    }
    expect(violations).toEqual([])
  })
})

describe("2. gap crossability", () => {
  test("every route gap clears a single jump with margin", () => {
    const byZ = [...course.platforms].sort((a, b) => a.box.center.z - b.box.center.z)
    const violations: string[] = []
    for (const [a, b] of consecutivePairs(byZ)) {
      const aa = aabbOf(a.box)
      const ba = aabbOf(b.box)
      const gap = ba.minZ - aa.maxZ
      if (gap <= 0.001) continue // abutting decks, no jump needed
      const lateral = Math.min(aa.maxX, ba.maxX) - Math.max(aa.minX, ba.minX)
      if (lateral <= 0) violations.push(`${a.id}->${b.id}: no lateral overlap across gap`)
      if (gap > jumpDistance) {
        violations.push(
          `${a.id}->${b.id}: ${gap.toFixed(2)}m exceeds a ${jumpDistance.toFixed(2)}m jump (dive-only)`,
        )
      } else if (gap > COMFORT_FRACTION * jumpDistance) {
        violations.push(
          `${a.id}->${b.id}: ${gap.toFixed(2)}m is over ${COMFORT_FRACTION * 100}% of a full jump`,
        )
      }
    }
    expect(violations).toEqual([])
  })
})

describe("3. waypoint support", () => {
  test("every waypoint stands on something across the obstacle cycle", () => {
    const unsupported: string[] = []
    for (let t = 0; t <= 20; t += 0.2) {
      const world = createWorldSnapshot(course, t)
      for (const wp of course.waypoints) {
        if (world.supportHeightAt(wp.x, wp.z, wp.y + 2) === null) {
          unsupported.push(`t=${t.toFixed(1)} wp(${wp.x},${wp.y},${wp.z})`)
        }
      }
    }
    expect(unsupported).toEqual([])
  })
})

describe("4. checkpoint placement", () => {
  test("each trigger overlaps the deck it belongs to", () => {
    for (const cp of course.checkpoints) {
      const trigger = aabbOf(cp.trigger)
      const hosts = course.platforms.filter((p) => overlaps(trigger, aabbOf(p.box)))
      expect(hosts.length, cp.id).toBeGreaterThan(0)
      const centred = hosts.some((p) =>
        containsXz(aabbOf(p.box), cp.trigger.center.x, cp.trigger.center.z),
      )
      expect(centred, cp.id).toBe(true)
    }
  })

  test("each respawn point is above a supported column", () => {
    const world = createWorldSnapshot(course, 0)
    for (const cp of course.checkpoints) {
      expect(world.supportHeightAt(cp.respawn.x, cp.respawn.z, cp.respawn.y), cp.id).not.toBeNull()
    }
  })

  test("no two triggers overlap (no early capture of a later checkpoint)", () => {
    const violations: string[] = []
    for (const [i, a] of course.checkpoints.entries()) {
      for (const b of course.checkpoints.slice(i + 1)) {
        if (overlaps(aabbOf(a.trigger), aabbOf(b.trigger))) violations.push(`${a.id} x ${b.id}`)
      }
    }
    expect(violations).toEqual([])
  })
})

describe("5. obstacles stay on the course", () => {
  test("every sweeper pivot stands on a platform", () => {
    const world = createWorldSnapshot(course, 0)
    for (const s of sweepers) {
      expect(world.supportHeightAt(s.pivot.x, s.pivot.z, s.pivot.y), s.id).not.toBeNull()
    }
  })

  test("every sweeper arc crosses walkable deck", () => {
    const decoration: string[] = []
    for (const s of sweepers) {
      const period = 360 / Math.abs(s.angularVelocityDeg)
      let crosses = false
      for (let k = 0; k < 72 && !crosses; k++) {
        const arm = sweeperArmAt(s, (period * k) / 72)
        const halfLength = s.armLength / 2
        const dirX = (arm.center.x - s.pivot.x) / halfLength
        const dirZ = (arm.center.z - s.pivot.z) / halfLength
        for (const f of [0.25, 0.5, 0.75, 1]) {
          const px = s.pivot.x + dirX * s.armLength * f
          const pz = s.pivot.z + dirZ * s.armLength * f
          const overDeck = course.platforms.some(
            (p) => containsXz(aabbOf(p.box), px, pz) && deckTop(p) < s.pivot.y,
          )
          if (overDeck) {
            crosses = true
            break
          }
        }
      }
      if (!crosses) decoration.push(s.id)
    }
    expect(decoration).toEqual([])
  })

  test("movers never intersect a static platform volume", () => {
    const hits: string[] = []
    for (const m of movers) {
      const cycle = m.travelSec * 2 + m.dwellSec * 2
      for (let k = 0; k < 240; k++) {
        const t = (cycle * k) / 240
        const box = aabbOf(moverBoxAt(m, t))
        for (const p of course.platforms) {
          if (overlaps(box, aabbOf(p.box))) hits.push(`${m.id} x ${p.id} @t=${t.toFixed(2)}s`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  test("each mover docks flush with the decks it serves", () => {
    for (const m of movers) {
      const cycle = m.travelSec * 2 + m.dwellSec * 2
      const served = new Set<string>()
      for (let k = 0; k < 240; k++) {
        const box = aabbOf(moverBoxAt(m, (cycle * k) / 240))
        for (const p of course.platforms) {
          const flush = Math.abs(box.maxY - deckTop(p)) <= 0.05
          if (flush && xzGap(box, aabbOf(p.box)) <= DOCK_CLEARANCE) served.add(p.id)
        }
      }
      expect(served.size, `${m.id} serves ${[...served].join(",")}`).toBeGreaterThanOrEqual(2)
    }
  })
})

describe("6. bumpers stay on the deck", () => {
  test("each bumper centre is on a deck and its sphere straddles the surface", () => {
    const bad: string[] = []
    for (const b of bumpers) {
      const host = course.platforms.find((p) => containsXz(aabbOf(p.box), b.center.x, b.center.z))
      if (host === undefined) {
        bad.push(`${b.id}: no deck under centre (${b.center.x},${b.center.z})`)
        continue
      }
      const top = deckTop(host)
      for (let k = 0; k < 24; k++) {
        const sphere = bumperSphereAt(b, (b.bobPeriodSec * k) / 24)
        if (sphere.center.y - sphere.radius >= top) bad.push(`${b.id}: floats free @k=${k}`)
        if (sphere.center.y + sphere.radius <= top) bad.push(`${b.id}: sunk below deck @k=${k}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe("7. finish and kill plane", () => {
  test("finish volume overlaps the finish plateau", () => {
    const finish = aabbOf(course.finish)
    const plateaus = course.platforms.filter((p) => p.kind === "finish")
    expect(plateaus.some((p) => overlaps(finish, aabbOf(p.box)))).toBe(true)
  })

  test("killY sits well below the lowest walkable surface", () => {
    const lowestTop = Math.min(...course.platforms.map(deckTop))
    expect(course.killY).toBeLessThanOrEqual(lowestTop - 5)
  })
})

describe("8. route continuity", () => {
  test("consecutive waypoints are sane hops, monotonic in +Z", () => {
    const bad: string[] = []
    for (const [i, [a, b]] of consecutivePairs(course.waypoints).entries()) {
      const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
      if (dist > MAX_WAYPOINT_LEG) bad.push(`wp${i}->wp${i + 1}: ${dist.toFixed(2)}m leg`)
      if (b.z <= a.z) bad.push(`wp${i}->wp${i + 1}: z retreats ${a.z}->${b.z}`)
    }
    expect(bad).toEqual([])
  })
})
