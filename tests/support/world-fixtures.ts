/**
 * Shared world test fixtures: a stub course with one floor platform, one wall,
 * one mover, one sweeper, one bumper, two checkpoints and a finish volume.
 */

import { expect } from "bun:test"
import type { BumperSpec, CourseDefinition, MoverSpec, SweeperSpec } from "../../src/shared/types"
import { asCheckpointIndex, asObstacleId, vec3 } from "../../src/shared/types"

export const EPS = 1e-9
export const RADIUS = 0.5

export const expectClose = (actual: number, expected: number, eps = EPS): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

export const mover: MoverSpec = {
  kind: "mover",
  id: asObstacleId("mv-world"),
  from: vec3(0, 0, 10),
  to: vec3(10, 0, 10),
  halfExtents: vec3(1, 0.25, 1),
  travelSec: 4,
  dwellSec: 0.5,
  phaseSec: 0,
  color: "blue",
}

export const sweeper: SweeperSpec = {
  kind: "sweeper",
  id: asObstacleId("sw-world"),
  pivot: vec3(0, 0.75, 20),
  armLength: 6,
  armHalfThickness: 0.25,
  armHalfHeight: 0.5,
  angularVelocityDeg: 90,
  phaseDeg: 0,
  knockbackSpeed: 8,
  knockbackLift: 5,
  color: "red",
}

export const bumper: BumperSpec = {
  kind: "bumper",
  id: asObstacleId("bp-world"),
  center: vec3(0, 0.5, 40),
  radius: 1,
  impulseSpeed: 10,
  impulseLift: 4,
  bobAmplitude: 0,
  bobPeriodSec: 2,
  color: "green",
}

export const course: CourseDefinition = {
  id: "test-course",
  name: "Test Course",
  spawn: vec3(0, 1, 0),
  spawnYaw: 0,
  platforms: [
    {
      id: asObstacleId("plat-floor"),
      kind: "start",
      box: { center: vec3(0, 0, 0), halfExtents: vec3(5, 0.25, 5), yaw: 0 },
      color: "white",
    },
    {
      id: asObstacleId("plat-wall"),
      kind: "decor",
      box: { center: vec3(3, 0.75, 0), halfExtents: vec3(0.25, 1, 5), yaw: 0 },
      color: "gray",
    },
  ],
  obstacles: [mover, sweeper, bumper],
  checkpoints: [
    {
      index: asCheckpointIndex(0),
      id: asObstacleId("cp-0"),
      respawn: vec3(0, 1, 58),
      trigger: { center: vec3(0, 1, 60), halfExtents: vec3(1, 1, 1), yaw: 0 },
      label: "First",
    },
    {
      index: asCheckpointIndex(1),
      id: asObstacleId("cp-1"),
      respawn: vec3(0.5, 1, 58),
      trigger: { center: vec3(0.5, 1, 60), halfExtents: vec3(1, 1, 1), yaw: 0 },
      label: "Second",
    },
  ],
  finish: { center: vec3(0, 1, 80), halfExtents: vec3(1, 1, 1), yaw: 0 },
  killY: -5,
  waypoints: [],
}
