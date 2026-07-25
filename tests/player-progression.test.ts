import { describe, expect, test } from "bun:test"
import { RUNNER } from "../src/shared/constants"
import { createRunner, stepRunner } from "../src/shared/player"
import type { PlayerInput, SimEvent } from "../src/shared/types"
import { asCheckpointIndex, NEUTRAL_INPUT, vec3 } from "../src/shared/types"
import {
  DT,
  eventsOfKind,
  makeCheckpoint,
  makeStubWorld,
  RESPAWN,
  runSteps,
} from "./support/player-fixtures"

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
