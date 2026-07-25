/**
 * Arcade player-physics controller for Wobble Rush 3D.
 *
 * `RunnerSim` is deliberately mutable simulation state: `stepRunner` rewrites
 * it in place every fixed tick and returns the side-effect events for
 * FX/audio/HUD. All gameplay tuning lives in RUNNER (constants.ts); the only
 * numbers here are structural thresholds named at the top of the file.
 * The step is time-pure: no clocks, no randomness, same inputs → same state.
 */

import { RUNNER } from "./constants"
import type {
  MutVec3,
  PlayerInput,
  RunnerSim,
  RunnerState,
  SimEvent,
  Vec3,
  WorldSnapshot,
} from "./types"
import { asCheckpointIndex, NEUTRAL_INPUT, vec3 } from "./types"

/** Grounded horizontal speed above which the state reads "run" (m/s). */
const RUN_SPEED_THRESHOLD = 0.35
/** Horizontal speed above which a dive follows the velocity, not the facing (m/s). */
const DIVE_DIRECTION_SPEED = 0.5
/** Horizontal speed below which yaw is left alone, so the runner does not jitter (m/s). */
const YAW_TRACK_SPEED = 0.1
/** Fraction of air acceleration available for steering while a dive is committed. */
const DIVE_STEER_FACTOR = 0.35

const horizontalSpeed = (velocity: MutVec3): number => Math.hypot(velocity.x, velocity.z)

const snapshotOf = (v: MutVec3): Vec3 => vec3(v.x, v.y, v.z)

/** Smallest signed angle from `from` to `to`, wrapped to [-PI, PI]. */
const shortestAngle = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from))

const deriveState = (sim: RunnerSim, speed: number): RunnerState => {
  if (sim.stumbleTimer > 0) return "stumble"
  if (sim.diveTimer > 0) return "dive"
  if (!sim.grounded) return "air"
  if (speed > RUN_SPEED_THRESHOLD) return "run"
  return "idle"
}

/**
 * Bleed horizontal speed towards `floor` (never past it) by `amount`,
 * preserving direction. Used for friction and for the natural decay of
 * over-speed impulses (dives, bumpers, sweepers).
 */
const decayHorizontal = (velocity: MutVec3, amount: number, floor: number): void => {
  const speed = horizontalSpeed(velocity)
  if (speed <= floor) return
  const next = Math.max(floor, speed - amount)
  const scale = next / speed
  velocity.x *= scale
  velocity.z *= scale
}

/**
 * Move horizontal velocity towards a target by at most `maxDelta`. When the
 * current velocity and the target both sit inside the run-speed disc, every
 * intermediate step stays inside it too, so input alone can never push the
 * runner past `runSpeed`.
 */
const approachHorizontal = (
  velocity: MutVec3,
  targetX: number,
  targetZ: number,
  maxDelta: number,
): void => {
  const dx = targetX - velocity.x
  const dz = targetZ - velocity.z
  const distance = Math.hypot(dx, dz)
  if (distance <= maxDelta) {
    velocity.x = targetX
    velocity.z = targetZ
    return
  }
  velocity.x += (dx / distance) * maxDelta
  velocity.z += (dz / distance) * maxDelta
}

/** Create a fresh runner at `spawn`, facing `yaw` radians (0 = +Z). */
export function createRunner(spawn: Vec3, yaw: number): RunnerSim {
  return {
    position: { x: spawn.x, y: spawn.y, z: spawn.z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw,
    grounded: false,
    timeSinceGrounded: 0,
    jumpBuffer: 0,
    diveTimer: 0,
    diveCooldown: 0,
    stumbleTimer: 0,
    jumpRising: false,
    state: "idle",
    checkpoint: asCheckpointIndex(-1),
    carry: { x: 0, y: 0, z: 0 },
  }
}

/** Reset the runner onto `respawnPoint` with zeroed velocity and cleared timers. */
export function respawnRunner(sim: RunnerSim, respawnPoint: Vec3): void {
  sim.position.x = respawnPoint.x
  sim.position.y = respawnPoint.y
  sim.position.z = respawnPoint.z
  sim.velocity.x = 0
  sim.velocity.y = 0
  sim.velocity.z = 0
  sim.grounded = false
  sim.timeSinceGrounded = 0
  sim.jumpBuffer = 0
  sim.diveTimer = 0
  sim.diveCooldown = 0
  sim.stumbleTimer = 0
  sim.jumpRising = false
  sim.state = "idle"
  sim.carry.x = 0
  sim.carry.y = 0
  sim.carry.z = 0
}

/**
 * Advance the runner one fixed step, mutating `sim` in place and returning
 * the events produced by this tick. Order of operations: timers → input
 * (jump/dive) → steering → gravity → integrate → world resolve → events.
 */
export function stepRunner(
  sim: RunnerSim,
  input: PlayerInput,
  world: WorldSnapshot,
  dt: number,
  respawnPoint: Vec3,
): readonly SimEvent[] {
  const events: SimEvent[] = []

  // Tick down the timers.
  sim.jumpBuffer = Math.max(0, sim.jumpBuffer - dt)
  sim.diveTimer = Math.max(0, sim.diveTimer - dt)
  sim.diveCooldown = Math.max(0, sim.diveCooldown - dt)
  sim.stumbleTimer = Math.max(0, sim.stumbleTimer - dt)

  // During a stumble the course owns the body: every input is ignored while
  // velocity keeps integrating.
  const controls: PlayerInput = sim.stumbleTimer > 0 ? NEUTRAL_INPUT : input

  // Jump: fresh presses refill the buffer; the buffer fires on the ground or
  // inside the coyote window, and never twice for one airborne spell.
  if (controls.jumpPressed) sim.jumpBuffer = RUNNER.jumpBufferSec
  const canJump = sim.grounded || sim.timeSinceGrounded <= RUNNER.coyoteSec
  if (sim.jumpBuffer > 0 && !sim.jumpRising && canJump) {
    sim.velocity.y = RUNNER.jumpSpeed
    sim.grounded = false
    sim.jumpRising = true
    sim.jumpBuffer = 0
    events.push({ kind: "jump", position: snapshotOf(sim.position) })
  }

  // Dive: a committed burst along the current travel direction (or facing
  // when nearly stationary), plus a small hop of lift.
  if (controls.divePressed && sim.diveCooldown <= 0 && sim.diveTimer <= 0) {
    const speed = horizontalSpeed(sim.velocity)
    const dirX = speed > DIVE_DIRECTION_SPEED ? sim.velocity.x / speed : Math.sin(sim.yaw)
    const dirZ = speed > DIVE_DIRECTION_SPEED ? sim.velocity.z / speed : Math.cos(sim.yaw)
    sim.velocity.x += dirX * RUNNER.diveSpeed
    sim.velocity.z += dirZ * RUNNER.diveSpeed
    sim.velocity.y += RUNNER.diveLift
    sim.diveTimer = RUNNER.diveSec
    sim.diveCooldown = RUNNER.diveCooldownSec
    events.push({ kind: "dive", position: snapshotOf(sim.position) })
  }

  // Camera-relative steering.
  //
  // The camera looks along F = (sin yaw, 0, cos yaw), so the direction the player
  // sees as right is R = F x up = (-cos yaw, 0, sin yaw). Steering strafe along
  // +R is what makes D move right on screen; the mirrored basis sends it left.
  const magnitude = Math.hypot(controls.forward, controls.strafe)
  if (magnitude > 0) {
    const inputScale = magnitude > 1 ? 1 / magnitude : 1
    const forward = controls.forward * inputScale
    const strafe = controls.strafe * inputScale
    const sin = Math.sin(controls.cameraYaw)
    const cos = Math.cos(controls.cameraYaw)
    const wishX = sin * forward - cos * strafe
    const wishZ = cos * forward + sin * strafe
    const diving = sim.diveTimer > 0
    const accel = diving
      ? RUNNER.airAccel * DIVE_STEER_FACTOR
      : sim.grounded
        ? RUNNER.groundAccel
        : RUNNER.airAccel
    if (horizontalSpeed(sim.velocity) <= RUNNER.runSpeed) {
      approachHorizontal(sim.velocity, wishX * RUNNER.runSpeed, wishZ * RUNNER.runSpeed, accel * dt)
    } else {
      // Faster than runSpeed from an external impulse: decay naturally with
      // friction, never snap-clamped back to the cap.
      const friction = (sim.grounded ? RUNNER.groundFriction : RUNNER.airFriction) * dt
      decayHorizontal(sim.velocity, friction, RUNNER.runSpeed)
      if (diving) {
        // A dive commits but keeps a whisper of steering control.
        const speed = horizontalSpeed(sim.velocity)
        approachHorizontal(sim.velocity, wishX * speed, wishZ * speed, accel * dt)
      }
    }
  } else {
    const friction = (sim.grounded ? RUNNER.groundFriction : RUNNER.airFriction) * dt
    decayHorizontal(sim.velocity, friction, 0)
  }

  // Gravity: held jump floats, released jump cuts short (variable height),
  // falls are snappy, and terminal velocity is capped.
  if (sim.velocity.y > 0) {
    sim.velocity.y -= (controls.jumpHeld ? RUNNER.gravityRise : RUNNER.gravityCut) * dt
  } else {
    sim.velocity.y -= RUNNER.gravityFall * dt
  }
  if (sim.velocity.y < -RUNNER.maxFallSpeed) sim.velocity.y = -RUNNER.maxFallSpeed

  // Integrate, then let the world resolve collisions. The downward speed at
  // the moment of contact is captured before resolve zeroes it.
  const wasAirborne = !sim.grounded
  const impactSpeed = Math.abs(Math.min(0, sim.velocity.y))
  const previous = snapshotOf(sim.position)
  const desired = vec3(
    previous.x + sim.velocity.x * dt,
    previous.y + sim.velocity.y * dt,
    previous.z + sim.velocity.z * dt,
  )
  const contact = world.resolve(previous, desired, snapshotOf(sim.velocity), RUNNER.radius)
  sim.position.x = contact.position.x
  sim.position.y = contact.position.y
  sim.position.z = contact.position.z
  sim.velocity.x = contact.velocity.x
  sim.velocity.y = contact.velocity.y
  sim.velocity.z = contact.velocity.z
  sim.grounded = contact.grounded
  sim.carry.x = contact.carry.x
  sim.carry.y = contact.carry.y
  sim.carry.z = contact.carry.z
  // Moving-platform carry rides as pure displacement, never as velocity.
  sim.position.x += contact.carry.x * dt
  sim.position.y += contact.carry.y * dt
  sim.position.z += contact.carry.z * dt

  // Falling off the course ends the tick: respawn, then nothing else fires.
  if (world.hasFallen(snapshotOf(sim.position))) {
    respawnRunner(sim, respawnPoint)
    events.push({ kind: "respawn", position: respawnPoint })
    return events
  }

  // Contact events (hits, bounces) are forwarded; a hit starts a stumble.
  for (const event of contact.events) {
    events.push(event)
    if (event.kind === "hit") sim.stumbleTimer = RUNNER.stumbleSec
  }

  // Touchdown.
  if (wasAirborne && sim.grounded) {
    events.push({ kind: "land", position: snapshotOf(sim.position), impactSpeed })
    sim.jumpRising = false
  }

  // Checkpoints only ever move forwards.
  const checkpoint = world.checkpointAt(snapshotOf(sim.position), RUNNER.radius)
  if (checkpoint !== null && checkpoint.index > sim.checkpoint) {
    sim.checkpoint = checkpoint.index
    events.push({
      kind: "checkpoint",
      position: snapshotOf(sim.position),
      index: checkpoint.index,
    })
  }

  if (world.isFinished(snapshotOf(sim.position), RUNNER.radius)) {
    events.push({ kind: "finish", position: snapshotOf(sim.position) })
  }

  // Coyote bookkeeping.
  if (sim.grounded) {
    sim.timeSinceGrounded = 0
  } else {
    sim.timeSinceGrounded += dt
  }

  // Face the travel direction, turning along the shortest arc.
  const speed = horizontalSpeed(sim.velocity)
  if (speed > YAW_TRACK_SPEED) {
    const target = Math.atan2(sim.velocity.x, sim.velocity.z)
    const delta = shortestAngle(sim.yaw, target)
    const maxTurn = RUNNER.turnRate * dt
    sim.yaw += Math.max(-maxTurn, Math.min(maxTurn, delta))
  }

  sim.state = deriveState(sim, speed)
  return events
}
