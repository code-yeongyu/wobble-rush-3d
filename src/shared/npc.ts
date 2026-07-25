/**
 * Deterministic NPC racers for Wobble Rush 3D.
 *
 * Every NPC decision is a pure function of (seed, course, tick sequence), so
 * each multiplayer client simulates byte-identical opponents locally with
 * zero server cost. No `Math.random`, no `Date.now`, no hidden state beyond
 * the fields on `NpcRacer`.
 */

import { NPC, RUNNER } from "./constants"
import { hashString, mulberry32, type Rng, randomRange } from "./rng"
import {
  asPlayerId,
  type CourseDefinition,
  NEUTRAL_INPUT,
  type PlayerId,
  type PlayerInput,
  type RunnerSim,
  type Vec3,
  type WorldSnapshot,
} from "./types"

/** Original playful racer names (not Fall Guys names). */
export const NPC_NAMES: readonly string[] = [
  "Bolt Biscuit",
  "Wobbly Wendy",
  "Turbo Tofu",
  "Captain Crumble",
  "Zigzag Zelda",
  "Pickle Rocket",
  "Noodle Knight",
  "Blimp Betty",
  "Socks McGee",
  "Fumblebee",
]

export type NpcRacer = {
  readonly id: PlayerId
  readonly name: string
  readonly colorIndex: number
  /** 0.82..1.0 multiplier on run speed; makes the pack spread out. */
  readonly skill: number
  waypointIndex: number
  reactionTimer: number
  wobblePhase: number
  finishedAtMs: number | null
}

/**
 * `reactionTimer` encodes the jump state machine so no extra fields are
 * needed (the type above is the multiplayer-serialisable contract):
 *   0               — idle, no hazard detected
 *   > 0             — hazard detected, counting down the reaction delay
 *   REACTION_READY  — delay elapsed; fire on the next `npcInput` tick
 *   JUMP_LATCHED    — already fired for this continuous hazard (rising edge)
 * Clearing the hazard resets the timer to 0, cancelling a pending jump and
 * re-arming the latch.
 */
const REACTION_READY = -0.5
const JUMP_LATCHED = -1

/** Waypoint must be at least this much higher than the NPC to trigger a jump. */
const ELEVATED_JUMP_DELTA = 0.6
/** Depth below the NPC's feet at which the ground probe samples the world. */
const GAP_PROBE_DROP = 1.2
/** Remaining distance to the final waypoint that triggers a finish-line lunge. */
const DIVE_DISTANCE = 6
/** Fraction of the NPC's top speed required before it will dive. */
const DIVE_SPEED_FRACTION = 0.85

/** Fisher–Yates shuffle driven by the seeded RNG (deterministic). */
const shuffle = (items: readonly string[], rng: Rng): string[] => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = result[i]
    const b = result[j]
    if (a !== undefined && b !== undefined) {
      result[i] = b
      result[j] = a
    }
  }
  return result
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/**
 * Build `count` racers deterministically from `seed` (mixed with the course
 * id so different courses field different packs from the same seed). Names
 * are drawn from a seeded shuffle of `NPC_NAMES` without repetition; when
 * `count` exceeds the pool, later cycles get a numeric suffix.
 */
export function createNpcRacers(course: CourseDefinition, seed: number, count: number): NpcRacer[] {
  const rng = mulberry32((seed ^ hashString(course.id)) >>> 0)
  const names = shuffle(NPC_NAMES, rng)
  const racers: NpcRacer[] = []
  for (let i = 0; i < count; i++) {
    const cycle = Math.floor(i / names.length)
    const base = names[i % names.length] ?? `Racer ${i + 1}`
    racers.push({
      id: asPlayerId(`npc-${i}`),
      name: cycle === 0 ? base : `${base} ${cycle + 1}`,
      colorIndex: i,
      skill: randomRange(rng, NPC.minSkill, NPC.maxSkill),
      waypointIndex: 0,
      reactionTimer: 0,
      wobblePhase: randomRange(rng, 0, Math.PI * 2),
      finishedAtMs: null,
    })
  }
  return racers
}

/** True when the current target warrants a jump (ledge above, or gap ahead). */
const detectJumpCondition = (
  sim: RunnerSim,
  target: Vec3,
  dist: number,
  dirX: number,
  dirZ: number,
  world: WorldSnapshot,
): boolean => {
  if (target.y - sim.position.y > ELEVATED_JUMP_DELTA && dist <= NPC.jumpLookAhead) {
    return true
  }
  if (dist <= 1e-6) {
    return false
  }
  const probe: Vec3 = {
    x: sim.position.x + dirX * NPC.jumpLookAhead,
    y: sim.position.y - GAP_PROBE_DROP,
    z: sim.position.z + dirZ * NPC.jumpLookAhead,
  }
  return world.hasFallen(probe)
}

/**
 * Compute this tick's input for one NPC. Steering is expressed in world
 * space: `cameraYaw` is fixed at 0 and forward/strafe carry the normalised
 * XZ direction towards the target waypoint, scaled by `skill`.
 */
export function npcInput(
  npc: NpcRacer,
  sim: RunnerSim,
  course: CourseDefinition,
  world: WorldSnapshot,
  timeSec: number,
): PlayerInput {
  const waypoints = course.waypoints
  const lastIndex = waypoints.length - 1
  const targetIndex = clamp(npc.waypointIndex, 0, Math.max(lastIndex, 0))
  const target = waypoints[targetIndex]
  if (target === undefined) {
    return NEUTRAL_INPUT
  }

  const dx = target.x - sim.position.x
  const dz = target.z - sim.position.z
  const dist = Math.hypot(dx, dz)
  const dirX = dist > 1e-6 ? dx / dist : 0
  const dirZ = dist > 1e-6 ? dz / dist : 0

  let forward = dirZ * npc.skill
  let strafe = dirX * npc.skill
  strafe += Math.sin(timeSec * 2 * Math.PI * NPC.wobbleHz + npc.wobblePhase) * NPC.wobbleAmplitude

  // Jump: rising-edge only, gated by the reaction-delay state machine.
  const jumpCondition = detectJumpCondition(sim, target, dist, dirX, dirZ, world)
  let jumpPressed = false
  if (jumpCondition) {
    if (npc.reactionTimer === 0) {
      npc.reactionTimer = NPC.reactionSec
    } else if (npc.reactionTimer === REACTION_READY) {
      jumpPressed = true
      npc.reactionTimer = JUMP_LATCHED
    }
  } else if (npc.reactionTimer !== 0) {
    npc.reactionTimer = 0
  }
  // Keep the key held for the whole rise so the jump reaches full height.
  const jumpHeld = jumpPressed || sim.jumpRising

  // Dive: finish-line lunge when grounded and moving near top speed.
  const finalWaypoint = waypoints[lastIndex]
  let divePressed = false
  if (finalWaypoint !== undefined && sim.grounded && sim.diveTimer <= 0 && sim.diveCooldown <= 0) {
    const finalDist = Math.hypot(finalWaypoint.x - sim.position.x, finalWaypoint.z - sim.position.z)
    const speed = Math.hypot(sim.velocity.x, sim.velocity.z)
    if (finalDist < DIVE_DISTANCE && speed >= RUNNER.runSpeed * npc.skill * DIVE_SPEED_FRACTION) {
      divePressed = true
    }
  }

  forward = clamp(Number.isFinite(forward) ? forward : 0, -1, 1)
  strafe = clamp(Number.isFinite(strafe) ? strafe : 0, -1, 1)

  return { forward, strafe, jumpHeld, jumpPressed, divePressed, cameraYaw: 0 }
}

/**
 * Advance waypoint progress and tick the reaction timer. Pure function of
 * its arguments: advances `waypointIndex` (never backwards, clamped at the
 * last waypoint) while the NPC is inside `NPC.waypointRadius` of its target.
 */
export function updateNpcProgress(
  npc: NpcRacer,
  sim: RunnerSim,
  course: CourseDefinition,
  dt: number,
): void {
  if (npc.reactionTimer > 0) {
    npc.reactionTimer -= dt
    if (npc.reactionTimer <= 0) {
      npc.reactionTimer = REACTION_READY
    }
  }

  const waypoints = course.waypoints
  const lastIndex = waypoints.length - 1
  if (lastIndex < 0) {
    return
  }
  npc.waypointIndex = clamp(npc.waypointIndex, 0, lastIndex)
  while (npc.waypointIndex < lastIndex) {
    const target = waypoints[npc.waypointIndex]
    if (target === undefined) {
      break
    }
    const dist = Math.hypot(target.x - sim.position.x, target.z - sim.position.z)
    if (dist >= NPC.waypointRadius) {
      break
    }
    npc.waypointIndex += 1
  }
}
