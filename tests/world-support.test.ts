import { describe, expect, test } from "bun:test"
import type { CourseDefinition, MoverSpec, Platform } from "../src/shared/types"
import { asCheckpointIndex, asObstacleId } from "../src/shared/types"
import { createWorldSnapshot } from "../src/shared/world"

const platform = (
  id: string,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  top: number,
): Platform => ({
  id: asObstacleId(id),
  kind: "path",
  color: "#ffffff",
  box: {
    center: { x: (x0 + x1) / 2, y: top - 0.35, z: (z0 + z1) / 2 },
    halfExtents: { x: (x1 - x0) / 2, y: 0.35, z: (z1 - z0) / 2 },
    yaw: 0,
  },
})

const slider: MoverSpec = {
  kind: "mover",
  id: asObstacleId("slider"),
  from: { x: 0, y: -0.35, z: 20 },
  to: { x: 10, y: -0.35, z: 20 },
  halfExtents: { x: 2, y: 0.35, z: 1.5 },
  travelSec: 2,
  dwellSec: 0,
  phaseSec: 0,
  color: "#ffffff",
}

const course: CourseDefinition = {
  id: "probe",
  name: "probe",
  spawn: { x: 0, y: 1, z: 0 },
  spawnYaw: 0,
  platforms: [platform("near", -4, 4, -4, 6, 0), platform("far", -4, 4, 12, 18, 0)],
  obstacles: [slider],
  checkpoints: [
    {
      index: asCheckpointIndex(0),
      id: asObstacleId("cp"),
      respawn: { x: 0, y: 1, z: 0 },
      trigger: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 }, yaw: 0 },
      label: "start",
    },
  ],
  finish: { center: { x: 0, y: 1, z: 40 }, halfExtents: { x: 2, y: 2, z: 2 }, yaw: 0 },
  killY: -14,
  waypoints: [{ x: 0, y: 0, z: 0 }],
}

describe("supportHeightAt", () => {
  test("returns the deck top when standing over a platform", () => {
    const world = createWorldSnapshot(course, 0)
    expect(world.supportHeightAt(0, 0, 1)).toBeCloseTo(0, 6)
  })

  test("returns null over a gap between platforms", () => {
    const world = createWorldSnapshot(course, 0)
    expect(world.supportHeightAt(0, 9, 1)).toBeNull()
  })

  test("ignores geometry above the query height", () => {
    const world = createWorldSnapshot(course, 0)
    expect(world.supportHeightAt(0, 0, -5)).toBeNull()
  })

  test("counts a moving platform as support where it currently is", () => {
    const atStart = createWorldSnapshot(course, 0)
    expect(atStart.supportHeightAt(0, 20, 1)).toBeCloseTo(0, 6)
    expect(atStart.supportHeightAt(9, 20, 1)).toBeNull()

    const atEnd = createWorldSnapshot(course, 2)
    expect(atEnd.supportHeightAt(9, 20, 1)).toBeCloseTo(0, 6)
    expect(atEnd.supportHeightAt(0, 20, 1)).toBeNull()
  })

  test("returns the highest support below the query point", () => {
    const stacked: CourseDefinition = {
      ...course,
      platforms: [platform("low", -4, 4, -4, 6, 0), platform("high", -4, 4, -4, 6, 3)],
    }
    const world = createWorldSnapshot(stacked, 0)
    expect(world.supportHeightAt(0, 0, 5)).toBeCloseTo(3, 6)
    expect(world.supportHeightAt(0, 0, 2)).toBeCloseTo(0, 6)
  })
})
