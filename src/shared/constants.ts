/**
 * Tuning constants for Wobble Rush 3D.
 *
 * Values are metres, seconds and radians. The simulation runs at a fixed
 * 60 Hz step; anything time-based is expressed per second and multiplied by
 * the step duration so replay and multiplayer stay deterministic.
 */

/** Fixed simulation step. 60 Hz keeps jump arcs identical across machines. */
export const FIXED_STEP_SEC = 1 / 60
/** Never simulate more than this many steps in one frame (spiral-of-death guard). */
export const MAX_STEPS_PER_FRAME = 5

export const RUNNER = {
  /** Collision sphere radius; the visual body is slightly taller than wide. */
  radius: 0.45,
  /** Eye-height offset used for camera framing. */
  height: 1.1,
  /** Top ground speed, m/s. */
  runSpeed: 8.2,
  /** Ground acceleration, m/s^2 — high so the runner feels responsive. */
  groundAccel: 62,
  /** Ground deceleration when no input, m/s^2. */
  groundFriction: 48,
  /** Air acceleration, m/s^2 — lower than ground but generous (forgiving). */
  airAccel: 34,
  /** Air drag when no input, m/s^2. */
  airFriction: 6,
  /** Upward speed at jump start, m/s. Apex ~1.55 m under `gravity`. */
  jumpSpeed: 9.4,
  /** Gravity while rising with jump held, m/s^2. */
  gravityRise: 28,
  /** Stronger gravity while falling — snappy, arcade-feeling arcs. */
  gravityFall: 42,
  /** Gravity when the jump key is released early (variable jump height). */
  gravityCut: 62,
  /** Terminal downward speed, m/s. */
  maxFallSpeed: 34,
  /** Grace period after walking off a ledge during which jump still works. */
  coyoteSec: 0.14,
  /** Window in which a jump pressed before landing still fires. */
  jumpBufferSec: 0.16,
  /** Forward speed added at dive start, m/s. */
  diveSpeed: 13.5,
  /** Small hop added at dive start, m/s. */
  diveLift: 3.4,
  /** Dive duration, s. */
  diveSec: 0.42,
  /** Cooldown between dives, s. */
  diveCooldownSec: 0.75,
  /** Stumble duration after an obstacle hit, s. */
  stumbleSec: 0.55,
  /** Turn rate towards the movement direction, radians/s. */
  turnRate: 14,
  /** Landing impact speed above which a landing puff spawns. */
  landEffectSpeed: 6,
} as const

export const CAMERA = {
  /** Distance behind the runner, m. */
  distance: 7.4,
  /** Height above the runner, m. */
  height: 3.5,
  /** Position smoothing half-life, s (lower = snappier). */
  positionHalfLife: 0.12,
  /** Look-at smoothing half-life, s. */
  targetHalfLife: 0.09,
  /** Extra look-ahead in the direction of travel, seconds of velocity. */
  lookAheadSec: 0.18,
  /** Mouse-drag orbit sensitivity, radians per pixel. */
  orbitSensitivity: 0.0045,
  /** Lowest orbit pitch (nearly level with the runner), rad. */
  minPitch: 0.12,
  /** Highest orbit pitch (looking down at the runner), rad. */
  maxPitch: 1.15,
  /** Auto-follow only eases toward headings within this angle of camera forward, rad. */
  followConeRad: 0.6,
  /** Auto-follow yaw smoothing half-life, s (frame-rate independent). */
  followHalfLife: 0.3,
  /** Auto-follow engages above this horizontal speed, m/s. */
  followMinSpeed: 1.5,
  /** Auto-follow pause after a manual drag, s — manual control wins, then yields. */
  manualFollowDelaySec: 1.4,
  fov: 62,
  near: 0.1,
  far: 400,
} as const

export const NET = {
  /** Client → server position updates per second. */
  stateHz: 15,
  /** Interpolation delay for remote runners, s. */
  interpolationDelaySec: 0.12,
  /** Countdown before a multiplayer race starts, s. */
  countdownSec: 3,
  /** Server drops a player after this long without any message. */
  timeoutSec: 30,
  maxPlayersPerRoom: 8,
  maxNameLength: 16,
} as const

export const NPC = {
  /** Speed multiplier range applied per NPC so the pack spreads out. */
  minSkill: 0.82,
  maxSkill: 1.0,
  /** Distance to a waypoint at which the NPC targets the next one, m. */
  waypointRadius: 2.4,
  /** Look-ahead distance used to decide when to jump, m. */
  jumpLookAhead: 3.2,
  /** Reaction delay before an NPC responds to a hazard, s. */
  reactionSec: 0.18,
  /** Steering noise amplitude so NPCs do not run a perfect line. */
  wobbleAmplitude: 0.35,
  wobbleHz: 0.6,
} as const

export const COURSE_METRICS = {
  /** Lane width for the main path, m. */
  laneWidth: 7,
  /** Narrow bridge width, m — ~3x the runner diameter: tense but fair. */
  bridgeWidth: 2.1,
  /** Sweeper arm underside height above the deck, m — clears a full jump. */
  sweeperClearance: 0.55,
} as const
