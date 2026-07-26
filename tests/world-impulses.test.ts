import { describe, expect, test } from "bun:test"
import type { BoxCollider, CourseDefinition, Platform } from "../src/shared/types"
import { asObstacleId, vec3 } from "../src/shared/types"
import { createWorldSnapshot } from "../src/shared/world"
import { course, expectClose, sweeper } from "./support/world-fixtures"

const RADIUS = 0.45

const platform = (id: string, box: BoxCollider): Platform => ({
  id: asObstacleId(id),
  kind: "decor",
  box,
  color: "gray",
})

describe("world.resolve — impulse reporting", () => {
  test("one obstacle touched by several resolve iterations still yields one impulse", () => {
    // The sphere is wedged in the 0.65 m gap between the sweeper arm's face
    // (z=20.25) and a wall (z=20.9): narrower than the 0.9 m diameter, so the
    // depenetration loop ping-pongs and touches the arm on every iteration.
    const wall = platform("wedge-wall", {
      center: vec3(2, 0.75, 21.15),
      halfExtents: vec3(1, 1, 0.25),
      yaw: 0,
    })
    const wedgeCourse: CourseDefinition = {
      ...course,
      platforms: [...course.platforms, wall],
    }
    const world = createWorldSnapshot(wedgeCourse, 0)
    const result = world.resolve(vec3(2, 0.75, 20.6), vec3(2, 0.75, 20.6), vec3(0, 0, 0), RADIUS)
    expect(result.impulses).toHaveLength(1)
    const impulse = result.impulses[0]
    if (impulse === undefined) throw new Error("expected one sweeper impulse")
    expect(impulse.kind).toBe("sweeper")
    expect(impulse.obstacle).toBe(sweeper.id)
    expect(impulse.depth).toBeGreaterThan(0)
    // depenetration still wins: the sphere ends clear of the arm's face
    expect(result.position.z).toBeGreaterThanOrEqual(20.25 + RADIUS - 1e-9)
    // wall + arm contacts are not the world's velocity business here
    expect(result.velocity).toEqual(vec3(0, 0, 0))
  })
})

describe("world.resolve — wall slide applied once per surface", () => {
  // Two tall walls meet at 45 degrees: the flank face (normal -Z) and an angled
  // wall (normal (-sqrt(2)/2, 0, sqrt(2)/2)). The sphere is driven diagonally:
  // +X is the slide along the flank, +Z presses into it. The wedge is narrower
  // than the sphere, so depenetration alternates between the walls for several
  // iterations. Projecting the velocity against a surface on EVERY iteration
  // bleeds the slide geometrically (5 -> 3.5 -> 1.75 -> 0.875 -> 0.4375);
  // projecting once per surface keeps the tangential component.
  const flank = platform("flank", {
    center: vec3(0, 0, 11.6),
    halfExtents: vec3(2.4, 2, 1.5),
    yaw: 0,
  })
  const angled = platform("angled", {
    center: vec3(2.2242640687119284, 0, 9.42573593128807),
    halfExtents: vec3(5, 2, 0.25),
    yaw: (3 * Math.PI) / 4,
  })
  const wedgeCourse: CourseDefinition = {
    ...course,
    platforms: [angled, flank],
    obstacles: [],
  }

  test("driven diagonally into meeting walls, the sphere keeps its tangential slide", () => {
    const world = createWorldSnapshot(wedgeCourse, 0)
    const sphere = vec3(1.8, 0.5, 9.85)
    const result = world.resolve(sphere, sphere, vec3(5, 0, 2), RADIUS)
    // Once against the angled wall removes the (-1, 0, 1)-diagonal component:
    // (5, 0, 2) -> (3.5, 0, 3.5); once against the flank removes +Z: (3.5, 0, 0).
    expectClose(result.velocity.x, 3.5)
    expectClose(result.velocity.z, 0)
    expect(result.velocity.y).toBe(0)
    expect(result.grounded).toBe(false)
    // depenetration is unchanged: the sphere ends flush with the flank face
    expectClose(result.position.z, 10.1 - RADIUS)
    // plain walls are not impulse sources
    expect(result.impulses).toHaveLength(0)
  })
})
