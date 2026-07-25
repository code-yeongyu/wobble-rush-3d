import { describe, expect, test } from "bun:test"
import { FIXED_STEP_SEC, RUNNER } from "../src/shared/constants"
import { createRunner, stepRunner } from "../src/shared/player"
import type {
  Checkpoint,
  ContactResult,
  PlayerInput,
  RunnerSim,
  SimEvent,
  Vec3,
  WorldSnapshot,
} from "../src/shared/types"
import { asCheckpointIndex, asObstacleId, NEUTRAL_INPUT, vec3 } from "../src/shared/types"

const DT = FIXED_STEP_SEC
const RESPAWN = vec3(0, RUNNER.radius, 0)

/* ------------------------------------------------------------------ *
 * Hand-built stub world: a flat floor at y=0 (or a void), with optional
 * carry, one-shot contact events, checkpoint/finish triggers and a kill
 * plane. Deterministic by construction.
 * ------------------------------------------------------------------ */

type StubWorldOptions = {
  readonly solid?: boolean
  readonly carry?: Vec3
  readonly firstContactEvents?: readonly SimEvent[]
  readonly checkpointWhen?: (position: Vec3) => Checkpoint | null
  readonly finishWhen?: (position: Vec3) => boolean
  readonly killY?: number
}

const makeStubWorld = (options: StubWorldOptions = {}): WorldSnapshot => {
  const solid = options.solid ?? true
  const carry = options.carry ?? vec3(0, 0, 0)
  const killY = options.killY ?? -10
  let resolveCalls = 0
  return {
    timeSec: 0,
    resolve(_previous: Vec3, desired: Vec3, velocity: Vec3, radius: number): ContactResult {
      resolveCalls += 1
      const events = resolveCalls === 1 ? (options.firstContactEvents ?? []) : []
      if (solid && desired.y <= radius && velocity.y <= 0) {
        return {
          position: vec3(desired.x, radius, desired.z),
          velocity: vec3(velocity.x, 0, velocity.z),
          grounded: true,
          carry,
          events,
        }
      }
      return { position: desired, velocity, grounded: false, carry: vec3(0, 0, 0), events }
    },
    checkpointAt(position: Vec3): Checkpoint | null {
      return options.checkpointWhen?.(position) ?? null
    },
    isFinished(position: Vec3): boolean {
      return options.finishWhen?.(position) ?? false
    },
    hasFallen(position: Vec3): boolean {
      return position.y < killY
    },
    supportHeightAt(): number | null {
      return 0
    },
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const hSpeed = (sim: RunnerSim): number => Math.hypot(sim.velocity.x, sim.velocity.z)

const eventsOfKind = <K extends SimEvent["kind"]>(
  events: readonly SimEvent[],
  kind: K,
): Extract<SimEvent, { kind: K }>[] =>
  events.filter((event): event is Extract<SimEvent, { kind: K }> => event.kind === kind)

const runSteps = (
  sim: RunnerSim,
  world: WorldSnapshot,
  steps: number,
  inputFor: (step: number) => PlayerInput,
  respawnPoint: Vec3 = RESPAWN,
): SimEvent[] => {
  const all: SimEvent[] = []
  for (let step = 1; step <= steps; step += 1) {
    all.push(...stepRunner(sim, inputFor(step), world, DT, respawnPoint))
  }
  return all
}

/** Ground the runner on the floor for one tick so tests start from a known state. */
const groundRunner = (sim: RunnerSim, world: WorldSnapshot): void => {
  stepRunner(sim, NEUTRAL_INPUT, world, DT, RESPAWN)
}

const makeCheckpoint = (index: number): Checkpoint => ({
  index: asCheckpointIndex(index),
  id: asObstacleId(`cp-${index}`),
  respawn: vec3(0, RUNNER.radius, 5),
  trigger: { center: vec3(0, 1, 5), halfExtents: vec3(1, 1, 1), yaw: 0 },
  label: `CP${index}`,
})

/* ------------------------------------------------------------------ *
 * Suite
 * ------------------------------------------------------------------ */

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

describe("checkpoints and finish", () => {
  test("crossing a checkpoint trigger emits checkpoint once and never regresses to a lower index", () => {
    const cp2 = makeCheckpoint(2)
    const cp1 = makeCheckpoint(1)
    let active = cp2
    const world = makeStubWorld({ checkpointWhen: (position) => (position.z > 3 ? active : null) })
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)

    const events = runSteps(sim, world, 60, () => ({ ...NEUTRAL_INPUT, forward: 1 }))
    const checkpoints = eventsOfKind(events, "checkpoint")
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]?.index).toBe(asCheckpointIndex(2))
    expect(sim.checkpoint).toBe(asCheckpointIndex(2))

    // A lower-index trigger afterwards must not fire or regress the sim.
    active = cp1
    const more = runSteps(sim, world, 10, () => ({ ...NEUTRAL_INPUT, forward: 1 }))
    expect(eventsOfKind(more, "checkpoint")).toHaveLength(0)
    expect(sim.checkpoint).toBe(asCheckpointIndex(2))
  })

  test("overlapping the finish volume emits a finish event", () => {
    const world = makeStubWorld({ finishWhen: (position) => position.z > 2 })
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
    const events = runSteps(sim, world, 30, () => ({ ...NEUTRAL_INPUT, forward: 1 }))
    expect(eventsOfKind(events, "finish").length).toBeGreaterThan(0)
  })
})

describe("falling", () => {
  test("falling below the kill plane respawns at the given point, zeroes velocity, emits exactly one respawn", () => {
    const world = makeStubWorld({ solid: false, killY: -5 })
    const respawnPoint = vec3(1, RUNNER.radius, 2)
    const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)

    const all: SimEvent[] = []
    let respawnTickEvents: readonly SimEvent[] = []
    for (let step = 1; step <= 60; step += 1) {
      const events = stepRunner(sim, NEUTRAL_INPUT, world, DT, respawnPoint)
      all.push(...events)
      if (eventsOfKind(events, "respawn").length > 0) {
        respawnTickEvents = events
        break
      }
    }

    expect(eventsOfKind(all, "respawn")).toHaveLength(1)
    expect(all).toHaveLength(1)
    expect(respawnTickEvents).toHaveLength(1)
    expect(sim.position.x).toBe(1)
    expect(sim.position.y).toBe(RUNNER.radius)
    expect(sim.position.z).toBe(2)
    expect(sim.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(sim.state).toBe("idle")
    expect(sim.diveTimer).toBe(0)
    expect(sim.stumbleTimer).toBe(0)
    expect(sim.jumpBuffer).toBe(0)
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

describe("determinism", () => {
  test("two identical runs from the same state produce byte-identical trajectories", () => {
    const script = (step: number): PlayerInput => ({
      forward: step < 40 ? 1 : step < 60 ? 0 : -0.5,
      strafe: step >= 20 && step < 50 ? 0.5 : 0,
      jumpHeld: step >= 10 && step < 25,
      jumpPressed: step === 10 || step === 70,
      divePressed: step === 30 || step === 90,
      cameraYaw: step >= 50 ? Math.PI / 4 : 0,
    })
    const runOnce = (): string => {
      const world = makeStubWorld()
      const sim = createRunner(vec3(0, RUNNER.radius, 0), 0)
      const frames: unknown[] = []
      for (let step = 1; step <= 120; step += 1) {
        const events = stepRunner(sim, script(step), world, DT, RESPAWN)
        frames.push({
          position: { ...sim.position },
          velocity: { ...sim.velocity },
          yaw: sim.yaw,
          state: sim.state,
          events,
        })
      }
      return JSON.stringify(frames)
    }
    expect(runOnce()).toBe(runOnce())
  })
})
