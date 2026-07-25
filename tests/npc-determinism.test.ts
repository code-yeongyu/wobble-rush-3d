import { describe, expect, test } from "bun:test"
import { RUNNER } from "../src/shared/constants"
import { createNpcRacers, npcInput, updateNpcProgress } from "../src/shared/npc"
import { vec3 } from "../src/shared/types"
import { makeCourse, makeSim, makeWorld, STEP } from "./support/npc-fixtures"

describe("determinism", () => {
  test("two independent 600-tick runs produce identical input streams", () => {
    const course = makeCourse([
      vec3(0, 0, 8),
      vec3(5, 0, 16),
      vec3(0, 1.5, 20),
      vec3(-4, 0, 28),
      vec3(0, 0, 34),
    ])
    const world = makeWorld(
      () => false,
      (_x, z) => (z > 10 && z < 25 ? null : 0),
    )

    /** One sampled input: forward, strafe, held, pressed, dive, cameraYaw. */
    type Sample = readonly [number, number, boolean, boolean, boolean, number]

    const runOnce = (): readonly Sample[] => {
      const racers = createNpcRacers(course, 99, 3)
      const sims = racers.map(() => makeSim(vec3(0, 0, 0)))
      const stream: Sample[] = []
      let timeSec = 0
      for (let tick = 0; tick < 600; tick++) {
        racers.forEach((npc, index) => {
          const sim = sims[index]
          if (sim === undefined) return
          const input = npcInput(npc, sim, course, world, timeSec)
          stream.push([
            input.forward,
            input.strafe,
            input.jumpHeld,
            input.jumpPressed,
            input.divePressed,
            input.cameraYaw,
          ])
          // Trivial deterministic kinematics: drift towards the current waypoint.
          const target = course.waypoints[Math.min(npc.waypointIndex, course.waypoints.length - 1)]
          if (target !== undefined) {
            const dx = target.x - sim.position.x
            const dz = target.z - sim.position.z
            const dist = Math.hypot(dx, dz)
            if (dist > 1e-6) {
              const speed = RUNNER.runSpeed * npc.skill * STEP
              sim.position.x += (dx / dist) * speed
              sim.position.z += (dz / dist) * speed
            }
          }
          updateNpcProgress(npc, sim, course, STEP)
        })
        timeSec += STEP
      }
      return stream
    }

    const first = runOnce()
    const second = runOnce()
    // Compare the serialised streams so a mismatch reports the differing frame,
    // but keep the typed samples for the sanity assertions below.
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))

    // Sanity: the stream is not all-neutral and every value is finite and clamped.
    const parsed = first
    expect(parsed.some(([forward]) => Math.abs(forward) > 0.1)).toBe(true)
    expect(parsed.some(([, , , jumpPressed]) => jumpPressed)).toBe(true)
    for (const [forward, strafe, , , , cameraYaw] of parsed) {
      expect(Number.isFinite(forward)).toBe(true)
      expect(Number.isFinite(strafe)).toBe(true)
      expect(Math.abs(forward)).toBeLessThanOrEqual(1)
      expect(Math.abs(strafe)).toBeLessThanOrEqual(1)
      expect(cameraYaw).toBe(0)
    }
  })
})
