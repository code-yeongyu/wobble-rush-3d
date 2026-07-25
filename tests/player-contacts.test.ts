import { describe, expect, test } from "bun:test"
import { RUNNER } from "../src/shared/constants"
import { createRunner, stepRunner } from "../src/shared/player"
import type { SimEvent } from "../src/shared/types"
import { asObstacleId, NEUTRAL_INPUT, vec3 } from "../src/shared/types"
import {
  DT,
  eventsOfKind,
  hSpeed,
  makeStubWorld,
  RESPAWN,
  runSteps,
} from "./support/player-fixtures"

describe("stumble", () => {
  test("a hit contact event triggers a stumble during which input is ignored", () => {
    const hit: SimEvent = {
      kind: "hit",
      position: vec3(0, RUNNER.radius, 0),
      obstacle: asObstacleId("sweeper-test"),
    }
    const world = makeStubWorld({ firstContactEvents: [hit] })
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)

    const firstTickEvents = stepRunner(sim, { ...NEUTRAL_INPUT, forward: 1 }, world, DT, RESPAWN)
    expect(eventsOfKind(firstTickEvents, "hit")).toHaveLength(1)
    expect(sim.stumbleTimer).toBeGreaterThan(0)
    expect(sim.state).toBe("stumble")

    // Full forward input while stumbling: the runner must not accelerate.
    runSteps(sim, world, 12, () => ({ ...NEUTRAL_INPUT, forward: 1 }))
    expect(hSpeed(sim)).toBeLessThan(0.01)
    expect(sim.state).toBe("stumble")

    // After stumbleSec elapses, input works again.
    runSteps(sim, world, 40, () => ({ ...NEUTRAL_INPUT, forward: 1 }))
    expect(hSpeed(sim)).toBeGreaterThan(4)
  })
})

describe("landing", () => {
  test("landing emits a land event carrying the impact speed", () => {
    const world = makeStubWorld()
    const sim = createRunner(vec3(0, 3, 0), 0)
    const events = runSteps(sim, world, 60, () => NEUTRAL_INPUT)
    const lands = eventsOfKind(events, "land")
    expect(lands).toHaveLength(1)
    const land = lands[0]
    if (land) {
      expect(land.impactSpeed).toBeGreaterThan(8)
      expect(land.impactSpeed).toBeLessThan(20)
    }
    expect(sim.grounded).toBe(true)
  })
})

describe("moving platforms", () => {
  test("carry displaces a grounded runner without adding to its velocity", () => {
    const world = makeStubWorld({ carry: vec3(3, 0, 0) })
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    runSteps(sim, world, 10, () => NEUTRAL_INPUT)
    expect(sim.grounded).toBe(true)
    expect(sim.velocity.x).toBe(0)
    expect(sim.position.x).toBeCloseTo(10 * 3 * DT, 5)
  })
})
