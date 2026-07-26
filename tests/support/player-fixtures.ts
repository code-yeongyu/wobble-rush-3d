/**
 * Shared player-sim test fixtures: a hand-built stub world (flat floor at y=0
 * or a void, optional carry, scripted contact impulses, checkpoint/finish
 * triggers and a kill plane) plus the step-running helpers. Deterministic by
 * construction.
 */

import { FIXED_STEP_SEC, RUNNER } from "../../src/shared/constants"
import { stepRunner } from "../../src/shared/player"
import type {
  Checkpoint,
  ContactImpulse,
  ContactKind,
  ContactResult,
  ObstacleId,
  PlayerInput,
  RunnerSim,
  SimEvent,
  Vec3,
  WorldSnapshot,
} from "../../src/shared/types"
import { asCheckpointIndex, asObstacleId, NEUTRAL_INPUT, vec3 } from "../../src/shared/types"

export const DT = FIXED_STEP_SEC
export const RESPAWN = vec3(0, RUNNER.radius, 0)

export type ContactImpulseInit = {
  readonly kind?: ContactKind
  readonly obstacle?: ObstacleId
  readonly direction?: Vec3
  readonly speed?: number
  readonly lift?: number
  readonly point?: Vec3
  readonly depth?: number
}

/** Build a contact impulse with realistic defaults; override what the test cares about. */
export const makeContactImpulse = (init: ContactImpulseInit = {}): ContactImpulse => ({
  kind: init.kind ?? "sweeper",
  obstacle: init.obstacle ?? asObstacleId("sweeper-test"),
  direction: init.direction ?? vec3(0, 0, -1),
  speed: init.speed ?? 9,
  lift: init.lift ?? 4,
  point: init.point ?? vec3(0, RUNNER.radius, 0),
  depth: init.depth ?? 0.2,
})

export type StubWorldOptions = {
  readonly solid?: boolean
  readonly carry?: Vec3
  /** Impulses reported on the FIRST resolve call only. */
  readonly firstContactImpulses?: readonly ContactImpulse[]
  /** Impulses scripted per resolve call (1-based); overrides firstContactImpulses. */
  readonly impulsesWhen?: (resolveCall: number) => readonly ContactImpulse[]
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
      const impulses = options.impulsesWhen
        ? options.impulsesWhen(resolveCalls)
        : resolveCalls === 1
          ? (options.firstContactImpulses ?? [])
          : []
      if (solid && desired.y <= radius && velocity.y <= 0) {
        return {
          position: vec3(desired.x, radius, desired.z),
          velocity: vec3(velocity.x, 0, velocity.z),
          grounded: true,
          carry,
          impulses,
        }
      }
      return { position: desired, velocity, grounded: false, carry: vec3(0, 0, 0), impulses }
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
