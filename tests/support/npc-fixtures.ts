/**
 * Shared NPC test fixtures: an inline stub course/world/sim/racer, deliberately
 * NOT importing course.ts / world.ts, which sibling agents own.
 */

import type { NpcRacer } from "../../src/shared/npc"
import type { CourseDefinition, RunnerSim, Vec3, WorldSnapshot } from "../../src/shared/types"
import { asCheckpointIndex, asPlayerId, vec3, ZERO_VEC3 } from "../../src/shared/types"

export const makeCourse = (waypoints: readonly Vec3[]): CourseDefinition => ({
  id: "test-course",
  name: "Test Course",
  spawn: vec3(0, 0, 0),
  spawnYaw: 0,
  platforms: [],
  obstacles: [],
  checkpoints: [],
  finish: { center: vec3(0, 0, 0), halfExtents: vec3(1, 1, 1), yaw: 0 },
  killY: -10,
  waypoints,
})

export const makeWorld = (
  hasFallen: (position: Vec3) => boolean = () => false,
  supportHeightAt: (x: number, z: number, fromY: number) => number | null = () => 0,
): WorldSnapshot => ({
  timeSec: 0,
  resolve: (_previous, desired, velocity) => ({
    position: desired,
    velocity,
    grounded: true,
    carry: ZERO_VEC3,
    events: [],
  }),
  checkpointAt: () => null,
  isFinished: () => false,
  hasFallen,
  supportHeightAt,
})

export const makeSim = (
  position: Vec3,
  velocity: Vec3 = vec3(0, 0, 0),
  grounded = true,
): RunnerSim => ({
  position: { x: position.x, y: position.y, z: position.z },
  velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
  yaw: 0,
  grounded,
  timeSinceGrounded: 0,
  jumpBuffer: 0,
  diveTimer: 0,
  diveCooldown: 0,
  stumbleTimer: 0,
  jumpRising: false,
  state: grounded ? "run" : "air",
  checkpoint: asCheckpointIndex(0),
  carry: { x: 0, y: 0, z: 0 },
})

export const makeNpc = (): NpcRacer => ({
  id: asPlayerId("npc-test"),
  name: "Test Racer",
  colorIndex: 0,
  skill: 1,
  waypointIndex: 0,
  reactionTimer: 0,
  wobblePhase: 0,
  finishedAtMs: null,
})

export const STEP = 1 / 60
