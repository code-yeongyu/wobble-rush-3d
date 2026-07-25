import { describe, expect, test } from "bun:test"
import { RUNNER } from "../src/shared/constants"
import { createRunner, stepRunner } from "../src/shared/player"
import type { RunnerSim, SimEvent } from "../src/shared/types"
import { NEUTRAL_INPUT, vec3 } from "../src/shared/types"
import {
  DT,
  eventsOfKind,
  groundRunner,
  makeStubWorld,
  RESPAWN,
  runSteps,
} from "./support/player-fixtures"

describe("gravity", () => {
  test("gravity pulls a runner down over time and clamps at maxFallSpeed", () => {
    // Kill plane far away so the fall never triggers a respawn mid-test.
    const world = makeStubWorld({ solid: false, killY: -1e9 })
    const sim = createRunner(vec3(0, 10, 0), 0)
    runSteps(sim, world, 10, () => NEUTRAL_INPUT)
    expect(sim.velocity.y).toBeLessThan(0)
    expect(sim.position.y).toBeLessThan(10)
    runSteps(sim, world, 120, () => NEUTRAL_INPUT)
    expect(sim.velocity.y).toBe(-RUNNER.maxFallSpeed)
  })
})

describe("jumping", () => {
  test("a grounded jump reaches an apex within 5% of jumpSpeed^2/(2*gravityRise) and returns to the ground", () => {
    const world = makeStubWorld()
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    groundRunner(sim, world)
    expect(sim.grounded).toBe(true)

    let apex = 0
    for (let step = 1; step <= 90; step += 1) {
      stepRunner(
        sim,
        { ...NEUTRAL_INPUT, jumpPressed: step === 1, jumpHeld: true },
        world,
        DT,
        RESPAWN,
      )
      apex = Math.max(apex, sim.position.y - RUNNER.radius)
    }

    const expected = RUNNER.jumpSpeed ** 2 / (2 * RUNNER.gravityRise)
    expect(Math.abs(apex - expected) / expected).toBeLessThan(0.05)
    expect(sim.grounded).toBe(true)
  })

  test("releasing the jump key early produces a measurably lower apex than holding it", () => {
    const jumpApex = (heldSteps: number): number => {
      const world = makeStubWorld()
      const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
      groundRunner(sim, world)
      let apex = 0
      for (let step = 1; step <= 90; step += 1) {
        stepRunner(
          sim,
          { ...NEUTRAL_INPUT, jumpPressed: step === 1, jumpHeld: step <= heldSteps },
          world,
          DT,
          RESPAWN,
        )
        apex = Math.max(apex, sim.position.y - RUNNER.radius)
      }
      return apex
    }

    const held = jumpApex(90)
    const cut = jumpApex(3)
    expect(cut).toBeLessThan(held * 0.8)
  })

  test("coyote time: a runner that just left the ground can still jump within coyoteSec, but not after", () => {
    // Within the window: airborne for 6 ticks (~0.1s < 0.14s), then press jump.
    const floorA = makeStubWorld()
    const voidA = makeStubWorld({ solid: false })
    const simA = createRunner(vec3(0, RUNNER.radius, 0), 0)
    groundRunner(simA, floorA)
    expect(simA.grounded).toBe(true)
    const eventsA: SimEvent[] = []
    for (let step = 2; step <= 8; step += 1) {
      eventsA.push(
        ...stepRunner(
          simA,
          step === 8 ? { ...NEUTRAL_INPUT, jumpPressed: true } : NEUTRAL_INPUT,
          voidA,
          DT,
          RESPAWN,
        ),
      )
    }
    expect(eventsOfKind(eventsA, "jump")).toHaveLength(1)
    expect(simA.velocity.y).toBeGreaterThan(0)

    // After the window: airborne for 10 ticks (~0.167s > 0.14s), jump is refused.
    const floorB = makeStubWorld()
    const voidB = makeStubWorld({ solid: false })
    const simB = createRunner(vec3(0, RUNNER.radius, 0), 0)
    groundRunner(simB, floorB)
    const eventsB: SimEvent[] = []
    for (let step = 2; step <= 20; step += 1) {
      eventsB.push(
        ...stepRunner(
          simB,
          step === 12 ? { ...NEUTRAL_INPUT, jumpPressed: true } : NEUTRAL_INPUT,
          voidB,
          DT,
          RESPAWN,
        ),
      )
    }
    expect(eventsOfKind(eventsB, "jump")).toHaveLength(0)
    expect(simB.velocity.y).toBeLessThan(0)
  })

  test("jump buffering: a press while airborne fires on landing within jumpBufferSec, drops after", () => {
    // From y=3 the runner lands on tick 21 of the fall (gravityFall, dt=1/60),
    // and coyote time (0.14s) is dead from tick 10 — so only the buffer can fire.
    const makeFall = (pressStep: number): { sim: RunnerSim; jumpStep: number | null } => {
      const world = makeStubWorld()
      const sim = createRunner(vec3(0, 3, 0), 0)
      let jumpStep: number | null = null
      for (let step = 1; step <= 26; step += 1) {
        const events = stepRunner(
          sim,
          step === pressStep ? { ...NEUTRAL_INPUT, jumpPressed: true } : NEUTRAL_INPUT,
          world,
          DT,
          RESPAWN,
        )
        if (eventsOfKind(events, "jump").length > 0) jumpStep = step
      }
      return { sim, jumpStep }
    }

    // Pressed 8 ticks (~0.133s < 0.16s) before the post-landing check: fires on touchdown.
    const buffered = makeFall(14)
    expect(buffered.jumpStep).toBe(22)

    // Pressed 10 ticks before the post-landing check (~0.167s > 0.16s): expired, no jump.
    const dropped = makeFall(12)
    expect(dropped.jumpStep).toBeNull()
    expect(dropped.sim.grounded).toBe(true)
  })
})
