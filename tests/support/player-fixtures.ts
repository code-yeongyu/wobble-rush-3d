/**
 * Shared player-sim test fixtures: a hand-built stub world (flat floor at y=0
 * or a void, optional carry, one-shot contact events, checkpoint/finish
 * triggers and a kill plane) plus the step-running helpers. Deterministic by
 * construction.
 */

import { FIXED_STEP_SEC, RUNNER } from "../../src/shared/constants"
import { stepRunner } from "../../src/shared/player"
import type {
  Checkpoint,
  ContactResult,
  PlayerInput,
  RunnerSim,
  SimEvent,
  Vec3,
  WorldSnapshot,
} from "../../src/shared/types"
import { asCheckpointIndex, asObstacleId, NEUTRAL_INPUT, vec3 } from "../../src/shared/types"

export const DT = FIXED_STEP_SEC
export const RESPAWN = vec3(0, RUNNER.radius, 0)

export type StubWorldOptions = {
  readonly solid?: boolean
  readonly carry?: Vec3
  readonly firstContactEvents?: readonly SimEvent[]
  readonly checkpointWhen?: (position: Vec3) => Checkpoint | null
  readonly finishWhen?: (position: Vec3) => boolean
  readonly killY?: number
}

export const makeStubWorld = (options: StubWorldOptions = {}): WorldSnapshot => {
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

export const hSpeed = (sim: RunnerSim): number => Math.hypot(sim.velocity.x, sim.velocity.z)

export const eventsOfKind = <K extends SimEvent["kind"]>(
  events: readonly SimEvent[],
  kind: K,
): Extract<SimEvent, { kind: K }>[] =>
  events.filter((event): event is Extract<SimEvent, { kind: K }> => event.kind === kind)

export const runSteps = (
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
export const groundRunner = (sim: RunnerSim, world: WorldSnapshot): void => {
  stepRunner(sim, NEUTRAL_INPUT, world, DT, RESPAWN)
}

export const makeCheckpoint = (index: number): Checkpoint => ({
  index: asCheckpointIndex(index),
  id: asObstacleId(`cp-${index}`),
  respawn: vec3(0, RUNNER.radius, 5),
  trigger: { center: vec3(0, 1, 5), halfExtents: vec3(1, 1, 1), yaw: 0 },
  label: `CP${index}`,
})
