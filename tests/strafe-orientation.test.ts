/**
 * Strafe has to match what the player sees.
 *
 * `PlayerInput.strafe` is positive toward the CAMERA'S RIGHT — the direction the
 * player perceives as right when they press D. These tests derive that direction
 * from the real `CameraRig` placement rather than restating a sign, so they fail
 * if either the camera or the movement basis is changed independently.
 *
 * The NPC case is the same contract seen from the other end: whatever convention
 * `strafe` uses, an NPC must actually travel toward its waypoint.
 */

import { describe, expect, test } from "bun:test"
import * as THREE from "three"
import { CameraRig } from "../src/client/camera-rig"
import { createNpcRacers, npcInput, updateNpcProgress } from "../src/shared/npc"
import { createRunner, stepRunner } from "../src/shared/player"
import type { CourseDefinition, PlayerInput, Vec3, WorldSnapshot } from "../src/shared/types"
import { asCheckpointIndex, asObstacleId, vec3 } from "../src/shared/types"
import { DT, makeStubWorld, RESPAWN, runSteps } from "./support/player-fixtures"

const UP = new THREE.Vector3(0, 1, 0)

/** The direction the player sees as "right", taken from the actual camera pose. */
function cameraRight(runnerPosition: Vec3, yaw: number): THREE.Vector3 {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500)
  const rig = new CameraRig(camera)
  rig.snapTo(runnerPosition, yaw)
  const forward = new THREE.Vector3(
    runnerPosition.x - camera.position.x,
    0,
    runnerPosition.z - camera.position.z,
  ).normalize()
  return forward.clone().cross(UP).normalize()
}

const strafeInput = (cameraYaw: number, strafe: number): PlayerInput => ({
  forward: 0,
  strafe,
  jumpHeld: false,
  jumpPressed: false,
  divePressed: false,
  cameraYaw,
})

describe("strafe follows the camera's right hand", () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 4, 2.4]) {
    test(`pressing right at camera yaw ${yaw.toFixed(2)} moves toward the camera's right`, () => {
      const spawn = vec3(0, 0.45, 0)
      const right = cameraRight(spawn, yaw)
      const world = makeStubWorld()
      const sim = createRunner(spawn, yaw)
      runSteps(sim, world, 20, () => strafeInput(yaw, 1))

      const velocity = new THREE.Vector3(sim.velocity.x, 0, sim.velocity.z)
      expect(velocity.length()).toBeGreaterThan(1)
      // Moving along the camera's right-hand axis, not against it.
      expect(velocity.clone().normalize().dot(right)).toBeGreaterThan(0.99)
    })
  }

  test("pressing left mirrors it exactly", () => {
    const spawn = vec3(0, 0.45, 0)
    const right = cameraRight(spawn, 0.8)
    const world = makeStubWorld()
    const sim = createRunner(spawn, 0.8)
    runSteps(sim, world, 20, () => strafeInput(0.8, -1))
    const velocity = new THREE.Vector3(sim.velocity.x, 0, sim.velocity.z).normalize()
    expect(velocity.dot(right)).toBeLessThan(-0.99)
  })

  test("forward is unaffected: it still travels along the camera's view direction", () => {
    const spawn = vec3(0, 0.45, 0)
    const yaw = Math.PI / 2
    const world = makeStubWorld()
    const sim = createRunner(spawn, yaw)
    runSteps(sim, world, 20, () => ({ ...strafeInput(yaw, 0), forward: 1 }))
    expect(sim.velocity.x).toBeGreaterThan(1)
    expect(Math.abs(sim.velocity.z)).toBeLessThan(0.2)
  })
})

const straightCourse = (waypoint: Vec3): CourseDefinition => ({
  id: "steer",
  name: "steer",
  spawn: vec3(0, 0.45, 0),
  spawnYaw: 0,
  platforms: [],
  obstacles: [],
  checkpoints: [
    {
      index: asCheckpointIndex(0),
      id: asObstacleId("cp"),
      respawn: vec3(0, 0.45, 0),
      trigger: { center: vec3(0, 0, 0), halfExtents: vec3(1, 1, 1), yaw: 0 },
      label: "start",
    },
  ],
  finish: { center: vec3(0, 0, 999), halfExtents: vec3(1, 1, 1), yaw: 0 },
  killY: -20,
  waypoints: [waypoint],
})

describe("an NPC travels toward its waypoint", () => {
  const world: WorldSnapshot = makeStubWorld()

  for (const [label, waypoint] of [
    ["to the +X side", vec3(30, 0, 0)],
    ["to the -X side", vec3(-30, 0, 0)],
    ["straight ahead", vec3(0, 0, 30)],
  ] as const) {
    test(`waypoint ${label}: the NPC closes the distance`, () => {
      const course = straightCourse(waypoint)
      const racer = createNpcRacers(course, 5, 1)[0]
      if (racer === undefined) throw new Error("expected one racer")
      const sim = createRunner(course.spawn, 0)
      const startDistance = Math.hypot(waypoint.x - sim.position.x, waypoint.z - sim.position.z)

      for (let step = 0; step < 90; step += 1) {
        stepRunner(sim, npcInput(racer, sim, course, world, step * DT), world, DT, RESPAWN)
        updateNpcProgress(racer, sim, course, DT)
      }

      const endDistance = Math.hypot(waypoint.x - sim.position.x, waypoint.z - sim.position.z)
      expect(endDistance).toBeLessThan(startDistance - 2)
    })
  }
})
