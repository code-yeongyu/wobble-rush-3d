import { describe, expect, test } from "bun:test"
import { asObstacleId, vec3 } from "../src/shared/types"
import { createWorldSnapshot } from "../src/shared/world"
import { course, RADIUS } from "./support/world-fixtures"

describe("world.checkpointAt", () => {
  test("returns the highest-index checkpoint when several triggers overlap", () => {
    const world = createWorldSnapshot(course, 0)
    // sphere at (0.25, 1, 60) overlaps both trigger boxes
    const cp = world.checkpointAt(vec3(0.25, 1, 60), RADIUS)
    expect(cp).not.toBeNull()
    expect(cp?.id).toBe(asObstacleId("cp-1"))
    expect(cp?.label).toBe("Second")
  })

  test("returns the only overlapping checkpoint", () => {
    const world = createWorldSnapshot(course, 0)
    const cp = world.checkpointAt(vec3(-1.4, 1, 60), RADIUS)
    expect(cp?.id).toBe(asObstacleId("cp-0"))
  })

  test("returns null when outside every trigger", () => {
    const world = createWorldSnapshot(course, 0)
    expect(world.checkpointAt(vec3(100, 1, 60), RADIUS)).toBeNull()
    expect(world.checkpointAt(vec3(0, 10, 60), RADIUS)).toBeNull()
  })
})

describe("world.isFinished / world.hasFallen", () => {
  test("isFinished is true only inside the finish volume", () => {
    const world = createWorldSnapshot(course, 0)
    expect(world.isFinished(vec3(0, 1, 80), RADIUS)).toBe(true)
    expect(world.isFinished(vec3(0.9, 1, 80), RADIUS)).toBe(true)
    expect(world.isFinished(vec3(5, 1, 80), RADIUS)).toBe(false)
    expect(world.isFinished(vec3(0, 5, 80), RADIUS)).toBe(false)
  })

  test("hasFallen is true only below killY", () => {
    const world = createWorldSnapshot(course, 0)
    expect(world.hasFallen(vec3(0, -6, 0))).toBe(true)
    expect(world.hasFallen(vec3(0, -5, 0))).toBe(false)
    expect(world.hasFallen(vec3(0, 0, 0))).toBe(false)
  })
})
