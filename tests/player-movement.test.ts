import { describe, expect, test } from "bun:test"
import { RUNNER } from "../src/shared/constants"
import { createRunner, stepRunner } from "../src/shared/player"
import { NEUTRAL_INPUT, vec3 } from "../src/shared/types"
import {
  DT,
  eventsOfKind,
  hSpeed,
  makeStubWorld,
  RESPAWN,
  runSteps,
} from "./support/player-fixtures"

describe("horizontal movement", () => {
  test("acceleration ramps to runSpeed and stops there; releasing input decays speed toward zero", () => {
    const world = makeStubWorld()
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    for (let step = 1; step <= 20; step += 1) {
      stepRunner(sim, { ...NEUTRAL_INPUT, forward: 1 }, world, DT, RESPAWN)
      expect(hSpeed(sim)).toBeLessThanOrEqual(RUNNER.runSpeed + 1e-9)
    }
    expect(hSpeed(sim)).toBeCloseTo(RUNNER.runSpeed, 5)
    expect(sim.velocity.z).toBeGreaterThan(0)

    runSteps(sim, world, 20, () => NEUTRAL_INPUT)
    expect(hSpeed(sim)).toBe(0)
  })

  test("camera-relative movement: with cameraYaw = PI/2, forward input moves the runner along +X", () => {
    const world = makeStubWorld()
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    runSteps(sim, world, 15, () => ({ ...NEUTRAL_INPUT, forward: 1, cameraYaw: Math.PI / 2 }))
    expect(sim.velocity.x).toBeGreaterThan(RUNNER.runSpeed * 0.9)
    expect(Math.abs(sim.velocity.z)).toBeLessThan(1e-6)
    expect(sim.position.x).toBeGreaterThan(0)
    expect(Math.abs(sim.position.z)).toBeLessThan(1e-6)
  })
})

describe("dive", () => {
  test("dive adds forward speed and lift, sets the cooldown, and a second dive during cooldown is ignored", () => {
    const world = makeStubWorld()
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    runSteps(sim, world, 12, () => ({ ...NEUTRAL_INPUT, forward: 1 }))

    const firstDiveEvents = stepRunner(
      sim,
      { ...NEUTRAL_INPUT, forward: 1, divePressed: true },
      world,
      DT,
      RESPAWN,
    )
    expect(eventsOfKind(firstDiveEvents, "dive")).toHaveLength(1)
    expect(hSpeed(sim)).toBeGreaterThan(RUNNER.runSpeed + 8)
    expect(sim.velocity.y).toBeGreaterThan(1)
    expect(sim.diveCooldown).toBeGreaterThan(0.7)
    expect(sim.diveTimer).toBeGreaterThan(0.3)
    expect(sim.state).toBe("dive")

    const speedAfterDive = hSpeed(sim)
    const secondDiveEvents = stepRunner(
      sim,
      { ...NEUTRAL_INPUT, forward: 1, divePressed: true },
      world,
      DT,
      RESPAWN,
    )
    expect(eventsOfKind(secondDiveEvents, "dive")).toHaveLength(0)
    expect(hSpeed(sim)).toBeLessThanOrEqual(speedAfterDive + 1e-9)
  })
})
