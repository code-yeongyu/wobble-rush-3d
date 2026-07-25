import { describe, expect, test } from "bun:test"
import { moverBoxAt, moverVelocityAt } from "../src/shared/obstacles"
import { vec3 } from "../src/shared/types"
import { createWorldSnapshot } from "../src/shared/world"
import { bumper, course, expectClose, mover, RADIUS, sweeper } from "./support/world-fixtures"

describe("world.resolve — platforms", () => {
  test("a sphere falling onto a platform lands on top, grounded, downward velocity zeroed", () => {
    const world = createWorldSnapshot(course, 0)
    const result = world.resolve(vec3(0, 2, 0), vec3(0, 0.5, 0), vec3(0, -5, 0), RADIUS)
    expect(result.grounded).toBe(true)
    // platform top is y=0.25, so the sphere rests at 0.25 + radius
    expectClose(result.position.y, 0.75)
    expect(result.velocity.y).toBe(0)
    expect(result.events).toHaveLength(0)
  })

  test("a sphere resting exactly on the surface stays grounded-adjacent (no penetration, no snap)", () => {
    const world = createWorldSnapshot(course, 0)
    const result = world.resolve(vec3(0, 0.75, 0), vec3(0, 0.75, 0), vec3(0, -1, 0), RADIUS)
    expectClose(result.position.y, 0.75)
  })

  test("a sphere driven into a wall slides along it instead of penetrating", () => {
    const world = createWorldSnapshot(course, 0)
    // wall face at x=2.75; sphere at x=2.6 with radius 0.5 overlaps by 0.35
    const result = world.resolve(vec3(2, 0.75, 0), vec3(2.6, 0.75, 0), vec3(5, 0, 3), RADIUS)
    expect(result.grounded).toBe(false)
    // pushed out to the wall face minus radius
    expectClose(result.position.x, 2.25)
    // into-wall velocity removed, tangential preserved
    expectClose(result.velocity.x, 0)
    expectClose(result.velocity.z, 3)
    expect(result.events).toHaveLength(0)
  })

  test("a sphere moving freely through open air is untouched", () => {
    const world = createWorldSnapshot(course, 0)
    const result = world.resolve(vec3(0, 5, 0), vec3(1, 5, 1), vec3(2, -1, 3), RADIUS)
    expect(result.grounded).toBe(false)
    expectClose(result.position.x, 1)
    expectClose(result.position.y, 5)
    expectClose(result.position.z, 1)
    expectClose(result.velocity.x, 2)
    expectClose(result.velocity.y, -1)
    expectClose(result.velocity.z, 3)
    expect(result.events).toHaveLength(0)
  })
})

describe("world.resolve — movers", () => {
  test("standing on a mover returns carry equal to moverVelocityAt at the snapshot time", () => {
    const t = 1
    const world = createWorldSnapshot(course, t)
    const box = moverBoxAt(mover, t)
    const expectedCarry = moverVelocityAt(mover, t)
    expect(Math.hypot(expectedCarry.x, expectedCarry.y, expectedCarry.z)).toBeGreaterThan(0)
    // stand slightly sunk into the mover top (top = center.y + 0.25)
    const standY = box.center.y + 0.25 + RADIUS - 0.05
    const result = world.resolve(
      vec3(box.center.x, standY + 0.1, box.center.z),
      vec3(box.center.x, standY, box.center.z),
      vec3(0, -1, 0),
      RADIUS,
    )
    expect(result.grounded).toBe(true)
    expectClose(result.carry.x, expectedCarry.x, 1e-9)
    expectClose(result.carry.y, expectedCarry.y, 1e-9)
    expectClose(result.carry.z, expectedCarry.z, 1e-9)
  })

  test("standing on a static platform reports zero carry", () => {
    const world = createWorldSnapshot(course, 1)
    const result = world.resolve(vec3(0, 1, 0), vec3(0, 0.7, 0), vec3(0, -1, 0), RADIUS)
    expect(result.grounded).toBe(true)
    expect(result.carry.x).toBe(0)
    expect(result.carry.y).toBe(0)
    expect(result.carry.z).toBe(0)
  })

  test("standing on a dwelling mover reports zero carry", () => {
    const t = 4.25 // dwell window for this mover spec (cycle 2*4+2*0.5=9, dwell at 4..4.5)
    const world = createWorldSnapshot(course, t)
    const box = moverBoxAt(mover, t)
    const standY = box.center.y + 0.25 + RADIUS - 0.05
    const result = world.resolve(
      vec3(box.center.x, standY, box.center.z),
      vec3(box.center.x, standY, box.center.z),
      vec3(0, 0, 0),
      RADIUS,
    )
    expect(result.grounded).toBe(true)
    expect(result.carry.x).toBe(0)
    expect(result.carry.y).toBe(0)
    expect(result.carry.z).toBe(0)
  })
})

describe("world.resolve — sweepers", () => {
  test("touching the arm emits a hit event and imparts knockback speed/lift", () => {
    // t=0: arm extends along +X from the pivot, arm box z in [19.75, 20.25]
    const world = createWorldSnapshot(course, 0)
    const result = world.resolve(vec3(2, 0.75, 20), vec3(2, 0.75, 20.4), vec3(0, 0, 2), RADIUS)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ kind: "hit", obstacle: sweeper.id })
    expectClose(result.velocity.y, sweeper.knockbackLift)
    const horizontal = Math.hypot(result.velocity.x, result.velocity.z)
    expectClose(horizontal, sweeper.knockbackSpeed, 1e-9)
    // positive angular velocity sweeps the +X arm towards -Z: knockback has -Z component
    expect(result.velocity.z).toBeLessThan(0)
  })

  test("standing clear of the arm produces no hit event", () => {
    const world = createWorldSnapshot(course, 0)
    const result = world.resolve(vec3(0, 1, 0), vec3(0, 0.7, 0), vec3(0, -1, 0), RADIUS)
    expect(result.events).toHaveLength(0)
  })
})

describe("world.resolve — bumpers", () => {
  test("touching a bumper emits a bounce event and imparts outward impulse + lift", () => {
    const world = createWorldSnapshot(course, 0)
    const result = world.resolve(vec3(0.9, 0.5, 40), vec3(1.3, 0.5, 40), vec3(3, 0, 0), RADIUS)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ kind: "bounce", obstacle: bumper.id })
    expectClose(result.velocity.y, bumper.impulseLift)
    const horizontal = Math.hypot(result.velocity.x, result.velocity.z)
    expectClose(horizontal, bumper.impulseSpeed, 1e-9)
    // the runner is on the +X side of the bumper, so the impulse points +X
    expect(result.velocity.x).toBeGreaterThan(0)
    expectClose(result.velocity.z, 0, 1e-9)
  })
})

describe("determinism", () => {
  test("identical inputs produce identical outputs", () => {
    const a = createWorldSnapshot(course, 1)
    const b = createWorldSnapshot(course, 1)
    const ra = a.resolve(vec3(0, 1, 0), vec3(0, 0.7, 0), vec3(1, -2, 3), RADIUS)
    const rb = b.resolve(vec3(0, 1, 0), vec3(0, 0.7, 0), vec3(1, -2, 3), RADIUS)
    expect(ra).toEqual(rb)
    // same snapshot, repeated calls
    const rc = a.resolve(vec3(0, 1, 0), vec3(0, 0.7, 0), vec3(1, -2, 3), RADIUS)
    expect(ra).toEqual(rc)
  })

  test("resolve does not mutate its inputs or the course", () => {
    const world = createWorldSnapshot(course, 0)
    const previous = vec3(0, 1, 0)
    const desired = vec3(0, 0.5, 0)
    const velocity = vec3(0, -5, 0)
    world.resolve(previous, desired, velocity, RADIUS)
    expect(previous).toEqual(vec3(0, 1, 0))
    expect(desired).toEqual(vec3(0, 0.5, 0))
    expect(velocity).toEqual(vec3(0, -5, 0))
    expect(course.platforms[0]?.box.center).toEqual(vec3(0, 0, 0))
  })
})
