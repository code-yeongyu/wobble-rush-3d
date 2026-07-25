/**
 * Core shared vocabulary for Wobble Rush 3D.
 *
 * Everything in `src/shared` is pure, DOM-free and Workers-safe so the same
 * simulation runs in the browser, in the Durable Object and in `bun test`.
 */

declare const brand: unique symbol

/** Nominal type helper. `Brand<string, "PlayerId">` is not assignable from `string`. */
export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type PlayerId = Brand<string, "PlayerId">
export type RoomCode = Brand<string, "RoomCode">
export type ObstacleId = Brand<string, "ObstacleId">
export type CheckpointIndex = Brand<number, "CheckpointIndex">

/**
 * Brand constructors.
 *
 * These four functions are the ONLY place a type assertion is allowed in this
 * codebase: a nominal type cannot be produced without one, and confining the
 * assertion here is exactly what buys nominal safety everywhere else. Every
 * other module must go through these instead of casting.
 */
export const asPlayerId = (value: string): PlayerId => value as PlayerId
export const asRoomCode = (value: string): RoomCode => value as RoomCode
export const asObstacleId = (value: string): ObstacleId => value as ObstacleId
export const asCheckpointIndex = (value: number): CheckpointIndex => value as CheckpointIndex

/** Exhaustiveness guard for discriminated unions. */
export function assertNever(value: never, context: string): never {
  throw new UnreachableVariantError(context, value)
}

export class UnreachableVariantError extends Error {
  readonly context: string
  readonly value: unknown
  constructor(context: string, value: unknown) {
    super(`Unreachable variant in ${context}: ${JSON.stringify(value)}`)
    this.name = "UnreachableVariantError"
    this.context = context
    this.value = value
  }
}

/* ------------------------------------------------------------------ *
 * Vectors — plain data, no Three.js dependency.
 * ------------------------------------------------------------------ */

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number }
/** Mutable scratch vector. Only simulation internals may hold one. */
export type MutVec3 = { x: number; y: number; z: number }

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
export const ZERO_VEC3: Vec3 = { x: 0, y: 0, z: 0 }

/* ------------------------------------------------------------------ *
 * Colliders
 * ------------------------------------------------------------------ */

/** Axis-aligned-in-local-space box, rotated by `yaw` radians around +Y. */
export type BoxCollider = {
  readonly center: Vec3
  readonly halfExtents: Vec3
  /** Rotation around the Y axis, radians. 0 for axis-aligned boxes. */
  readonly yaw: number
}

export type SphereCollider = {
  readonly center: Vec3
  readonly radius: number
}

/* ------------------------------------------------------------------ *
 * Course description — authored data, consumed by sim + renderer.
 * ------------------------------------------------------------------ */

export const PLATFORM_KINDS = ["start", "path", "bridge", "ramp", "finish", "decor"] as const
export type PlatformKind = (typeof PLATFORM_KINDS)[number]

export type Platform = {
  readonly id: ObstacleId
  readonly kind: PlatformKind
  readonly box: BoxCollider
  /** Palette token from DESIGN.md, resolved by the renderer. */
  readonly color: string
}

/** Rotating sweeper bar: an arm revolving around a vertical pivot. */
export type SweeperSpec = {
  readonly kind: "sweeper"
  readonly id: ObstacleId
  /** Pivot position; the arm sweeps in the XZ plane at `pivot.y`. */
  readonly pivot: Vec3
  readonly armLength: number
  readonly armHalfThickness: number
  readonly armHalfHeight: number
  /** Degrees per second. Negative reverses the sweep direction. */
  readonly angularVelocityDeg: number
  /** Starting angle in degrees, so neighbouring sweepers can be de-synced. */
  readonly phaseDeg: number
  /** Horizontal speed imparted to a struck player, m/s. */
  readonly knockbackSpeed: number
  /** Vertical speed imparted to a struck player, m/s. */
  readonly knockbackLift: number
  readonly color: string
}

/** Platform shuttling between two points with a dwell at each end. */
export type MoverSpec = {
  readonly kind: "mover"
  readonly id: ObstacleId
  readonly from: Vec3
  readonly to: Vec3
  readonly halfExtents: Vec3
  /** Seconds for one one-way traversal (excluding dwell). */
  readonly travelSec: number
  /** Seconds paused at each endpoint. */
  readonly dwellSec: number
  /** Phase offset in seconds within the full cycle. */
  readonly phaseSec: number
  readonly color: string
}

/** Static dome that pops the player away on contact. */
export type BumperSpec = {
  readonly kind: "bumper"
  readonly id: ObstacleId
  readonly center: Vec3
  readonly radius: number
  /** Horizontal speed imparted on contact, m/s. */
  readonly impulseSpeed: number
  /** Vertical speed imparted on contact, m/s. */
  readonly impulseLift: number
  /** Bob amplitude in metres for the idle animation (visual + collider). */
  readonly bobAmplitude: number
  readonly bobPeriodSec: number
  readonly color: string
}

export type ObstacleSpec = SweeperSpec | MoverSpec | BumperSpec

export type Checkpoint = {
  readonly index: CheckpointIndex
  readonly id: ObstacleId
  /** Where the player is placed when respawning here. */
  readonly respawn: Vec3
  /** Volume that captures the checkpoint when the player overlaps it. */
  readonly trigger: BoxCollider
  readonly label: string
}

export type CourseDefinition = {
  readonly id: string
  readonly name: string
  readonly spawn: Vec3
  /** Facing angle at spawn, radians (0 = +Z). */
  readonly spawnYaw: number
  readonly platforms: readonly Platform[]
  readonly obstacles: readonly ObstacleSpec[]
  readonly checkpoints: readonly Checkpoint[]
  readonly finish: BoxCollider
  /** Below this Y the runner has fallen off the course. */
  readonly killY: number
  /** Ordered path hints used by NPC navigation. */
  readonly waypoints: readonly Vec3[]
}

/* ------------------------------------------------------------------ *
 * Player simulation
 * ------------------------------------------------------------------ */

export type PlayerInput = {
  /** -1 back .. +1 forward, already clamped. */
  readonly forward: number
  /** -1 left .. +1 right, already clamped. */
  readonly strafe: number
  /** True while the jump key is held (enables variable jump height). */
  readonly jumpHeld: boolean
  /** True only on the frame the jump key went down. */
  readonly jumpPressed: boolean
  /** True only on the frame the dive key went down. */
  readonly divePressed: boolean
  /** Camera yaw in radians; movement is camera-relative. */
  readonly cameraYaw: number
}

export const NEUTRAL_INPUT: PlayerInput = {
  forward: 0,
  strafe: 0,
  jumpHeld: false,
  jumpPressed: false,
  divePressed: false,
  cameraYaw: 0,
}

export const RUNNER_STATES = ["idle", "run", "air", "dive", "stumble"] as const
export type RunnerState = (typeof RUNNER_STATES)[number]

/**
 * Full mutable simulation state for one runner.
 * Mutable by design: the fixed-step integrator writes it in place every tick.
 */
export type RunnerSim = {
  position: MutVec3
  velocity: MutVec3
  /** Facing angle in radians, smoothed towards the movement direction. */
  yaw: number
  grounded: boolean
  /** Seconds since the runner last left the ground (coyote-time source). */
  timeSinceGrounded: number
  /** Seconds remaining in which a buffered jump will fire on landing. */
  jumpBuffer: number
  /** Seconds remaining of the current dive. */
  diveTimer: number
  /** Seconds until diving is allowed again. */
  diveCooldown: number
  /** Seconds remaining of the knockback stumble (input is ignored). */
  stumbleTimer: number
  /** True while a jump is rising and the key is still held. */
  jumpRising: boolean
  state: RunnerState
  checkpoint: CheckpointIndex
  /** Ground platform velocity applied this tick (moving-platform carry). */
  carry: MutVec3
}

/** Side effects produced by one simulation tick, consumed by FX/audio/HUD. */
export type SimEvent =
  | { readonly kind: "jump"; readonly position: Vec3 }
  | { readonly kind: "land"; readonly position: Vec3; readonly impactSpeed: number }
  | { readonly kind: "dive"; readonly position: Vec3 }
  | { readonly kind: "hit"; readonly position: Vec3; readonly obstacle: ObstacleId }
  | { readonly kind: "bounce"; readonly position: Vec3; readonly obstacle: ObstacleId }
  | { readonly kind: "checkpoint"; readonly position: Vec3; readonly index: CheckpointIndex }
  | { readonly kind: "respawn"; readonly position: Vec3 }
  | { readonly kind: "finish"; readonly position: Vec3 }

/* ------------------------------------------------------------------ *
 * World query — the seam between the player controller (lane A) and
 * course/obstacle collision (lane B).
 * ------------------------------------------------------------------ */

export type ContactResult = {
  /** Corrected position after depenetration. */
  readonly position: Vec3
  /** Velocity after collision response (e.g. zeroed into a wall). */
  readonly velocity: Vec3
  readonly grounded: boolean
  /** Velocity of the surface the runner stands on (moving platform carry). */
  readonly carry: Vec3
  /** Impulses from bumpers/sweepers applied this tick, already in velocity. */
  readonly events: readonly SimEvent[]
}

/**
 * A snapshot of the collidable world at one instant.
 * `resolve` moves a sphere of `radius` from `previous` to `desired`,
 * returning the corrected transform plus contact events.
 */
export type WorldSnapshot = {
  readonly timeSec: number
  resolve(previous: Vec3, desired: Vec3, velocity: Vec3, radius: number): ContactResult
  /** Checkpoint captured at this position, if any. */
  checkpointAt(position: Vec3, radius: number): Checkpoint | null
  /** True when the sphere overlaps the finish volume. */
  isFinished(position: Vec3, radius: number): boolean
  /** True when the runner has fallen below the course kill plane. */
  hasFallen(position: Vec3): boolean
  /**
   * Height of the highest walkable surface at (x, z) that sits at or below
   * `fromY`, or null when nothing supports that column. Used to look ahead for
   * gaps — `hasFallen` only answers "already fell", never "about to".
   */
  supportHeightAt(x: number, z: number, fromY: number): number | null
}
