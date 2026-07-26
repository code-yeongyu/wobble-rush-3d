import { describe, expect, test } from "bun:test"
import { RUNNER } from "../src/shared/constants"
import { createRunner, stepRunner } from "../src/shared/player"
import type { SimEvent } from "../src/shared/types"
import { asObstacleId, NEUTRAL_INPUT, vec3 } from "../src/shared/types"
import {
  DT,
  eventsOfKind,
  groundRunner,
  hSpeed,
  makeContactImpulse,
  makeStubWorld,
  RESPAWN,
  runSteps,
} from "./support/player-fixtures"

describe("one collision, one response", () => {
  test("a sweeper impulse emits exactly one hit event carrying the contact point and starts a stumble", () => {
    const point = vec3(0.2, RUNNER.radius, -0.3)
    const impulse = makeContactImpulse({ point })
    const world = makeStubWorld({ firstContactImpulses: [impulse] })
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)

    const events = stepRunner(sim, { ...NEUTRAL_INPUT, forward: 1 }, world, DT, RESPAWN)
    const hits = eventsOfKind(events, "hit")
    expect(hits).toHaveLength(1)
    expect(hits[0]?.position).toEqual(point)
    expect(hits[0]?.obstacle).toBe(impulse.obstacle)
    expect(sim.stumbleTimer).toBeGreaterThan(0)
    expect(sim.state).toBe("stumble")
  })

  test("a multi-tick overlap from the same obstacle fires its impulse exactly once", () => {
    // The collision clinic measured overlaps of up to 6 ticks for one arm
    // pass; this stub holds contact for 8 consecutive resolve calls.
    const impulse = makeContactImpulse({ speed: 9, lift: 4 })
    const world = makeStubWorld({
      impulsesWhen: (call) => (call >= 2 && call <= 9 ? [impulse] : []),
    })
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    groundRunner(sim, world)

    const all: SimEvent[] = []
    let speedAfterHit = 0
    let maxSpeedDuringOverlap = 0
    for (let step = 1; step <= 10; step += 1) {
      all.push(...stepRunner(sim, NEUTRAL_INPUT, world, DT, RESPAWN))
      const speed = hSpeed(sim)
      if (step === 1) speedAfterHit = speed
      if (step <= 8) maxSpeedDuringOverlap = Math.max(maxSpeedDuringOverlap, speed)
    }

    expect(eventsOfKind(all, "hit")).toHaveLength(1)
    expect(speedAfterHit).toBeGreaterThan(5)
    // Ignored repeats change nothing: friction only ever bleeds the throw.
    expect(maxSpeedDuringOverlap).toBe(speedAfterHit)
  })

  test("a different obstacle still lands during the lockout", () => {
    const sweeper = makeContactImpulse({
      obstacle: asObstacleId("sweeper-a"),
      direction: vec3(0, 0, -1),
    })
    const bumper = makeContactImpulse({
      kind: "bumper",
      obstacle: asObstacleId("bumper-b"),
      direction: vec3(1, 0, 0),
      speed: 7,
      lift: 3,
    })
    const world = makeStubWorld({
      impulsesWhen: (call) => (call === 2 ? [sweeper] : call === 4 ? [bumper] : []),
    })
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    groundRunner(sim, world)

    const events = runSteps(sim, world, 6, () => NEUTRAL_INPUT)
    expect(eventsOfKind(events, "hit")).toHaveLength(1)
    const bounces = eventsOfKind(events, "bounce")
    expect(bounces).toHaveLength(1)
    expect(bounces[0]?.obstacle).toBe(asObstacleId("bumper-b"))
    // The bumper's sideways throw actually landed on top of the sweeper's.
    expect(sim.velocity.x).toBeGreaterThan(3)
  })

  test("the same obstacle hits again once its lockout has expired", () => {
    const impulse = makeContactImpulse({ obstacle: asObstacleId("sweeper-a") })
    const world = makeStubWorld({
      impulsesWhen: (call) => (call === 2 || call === 50 ? [impulse] : []),
    })
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    groundRunner(sim, world)

    const events = runSteps(sim, world, 50, () => NEUTRAL_INPUT)
    expect(eventsOfKind(events, "hit")).toHaveLength(2)
  })
})

describe("momentum", () => {
  test("a hit retains a share of the runner's momentum instead of overwriting velocity", () => {
    const impulse = makeContactImpulse({ direction: vec3(0, 0, -1), speed: 9, lift: 0, depth: 0.2 })

    // A runner at full tilt, struck from the front (call 12 = step 12).
    const worldMoving = makeStubWorld({ impulsesWhen: (call) => (call === 12 ? [impulse] : []) })
    const moving = createRunner(vec3(0, RUNNER.radius, 0), 0)
    runSteps(moving, worldMoving, 11, () => ({ ...NEUTRAL_INPUT, forward: 1 }))
    expect(hSpeed(moving)).toBeCloseTo(RUNNER.runSpeed, 5)
    stepRunner(moving, NEUTRAL_INPUT, worldMoving, DT, RESPAWN)

    // A stationary runner struck by the same blow.
    const worldStill = makeStubWorld({ firstContactImpulses: [impulse] })
    const still = createRunner(vec3(0, RUNNER.radius, 0), 0)
    stepRunner(still, NEUTRAL_INPUT, worldStill, DT, RESPAWN)

    // Both are visibly thrown backwards, but the moving runner's forward
    // momentum survives: it is thrown measurably less than the standing one.
    expect(still.velocity.z).toBeLessThan(-4)
    expect(moving.velocity.z).toBeLessThan(0)
    expect(moving.velocity.z).toBeGreaterThan(still.velocity.z + 1)
  })

  test("lift keeps the higher of the current rise and the imparted lift", () => {
    // Rising off a jump: a weak imparted lift must not cancel the jump.
    const riser = makeContactImpulse({ speed: 0, lift: 2 })
    const worldRising = makeStubWorld({ impulsesWhen: (call) => (call === 3 ? [riser] : []) })
    const rising = createRunner(vec3(0, RUNNER.radius, 0), 0)
    groundRunner(rising, worldRising)
    stepRunner(
      rising,
      { ...NEUTRAL_INPUT, jumpPressed: true, jumpHeld: true },
      worldRising,
      DT,
      RESPAWN,
    )
    const jumpVy = rising.velocity.y
    stepRunner(rising, { ...NEUTRAL_INPUT, jumpHeld: true }, worldRising, DT, RESPAWN)
    expect(jumpVy).toBeGreaterThan(8)
    expect(rising.velocity.y).toBeGreaterThan(6)

    // Standing still: the imparted lift pops the runner off the deck.
    const popper = makeContactImpulse({ speed: 0, lift: 5 })
    const worldStill = makeStubWorld({ firstContactImpulses: [popper] })
    const still = createRunner(vec3(0, RUNNER.radius, 0), 0)
    stepRunner(still, NEUTRAL_INPUT, worldStill, DT, RESPAWN)
    expect(still.velocity.y).toBeCloseTo(5, 5)
  })
})

describe("steering recovery", () => {
  test("input is dead right after the hit but steering returns before the stumble ends", () => {
    const world = makeStubWorld({
      impulsesWhen: (call) => (call === 2 ? [makeContactImpulse({ speed: 0, lift: 0 })] : []),
    })
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    groundRunner(sim, world)
    stepRunner(sim, NEUTRAL_INPUT, world, DT, RESPAWN)
    expect(sim.state).toBe("stumble")

    // Dead zone: full forward input, no acceleration.
    runSteps(sim, world, 6, () => ({ ...NEUTRAL_INPUT, forward: 1 }))
    expect(hSpeed(sim)).toBeLessThan(0.01)
    expect(sim.stumbleTimer).toBeGreaterThan(0)

    // Recovery: speed builds while the stumble timer is still running.
    let recoveredEarly = false
    for (let step = 0; step < 40; step += 1) {
      stepRunner(sim, { ...NEUTRAL_INPUT, forward: 1 }, world, DT, RESPAWN)
      if (sim.stumbleTimer > 0 && hSpeed(sim) > 0.5) recoveredEarly = true
    }
    expect(recoveredEarly).toBe(true)

    // Full control once the stumble has fully elapsed.
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
