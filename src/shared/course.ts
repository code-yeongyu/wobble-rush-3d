/**
 * The Wobble Rush 3D course: "Sunrise Scramble".
 *
 * Authored data, consumed by the simulation, the renderer and the NPC navigator.
 * Layout runs along +Z. Every deck surface has its top at y = 0 except the final
 * staircase and finish plateau, which climb to y = 2.25.
 *
 * Pacing (research-derived): a discrete hazard every ~8-14 m, a rest pad after every
 * knockdown-capable section, and a checkpoint on every rest pad so a mistake costs a
 * few seconds instead of the whole run.
 */

import type {
  BoxCollider,
  BumperSpec,
  Checkpoint,
  CourseDefinition,
  MoverSpec,
  Platform,
  PlatformKind,
  SweeperSpec,
  Vec3,
} from "./types"
import { asCheckpointIndex, asObstacleId } from "./types"

/** Deck slabs are 0.7 m thick with their top face at y = `top`. */
const DECK_HALF_THICKNESS = 0.35

const box = (center: Vec3, halfExtents: Vec3, yaw = 0): BoxCollider => ({
  center,
  halfExtents,
  yaw,
})

/** Slab spanning [x0,x1] x [z0,z1] with its walking surface at `top`. */
function deck(
  id: string,
  kind: PlatformKind,
  color: string,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  top = 0,
): Platform {
  return {
    id: asObstacleId(id),
    kind,
    color,
    box: box(
      { x: (x0 + x1) / 2, y: top - DECK_HALF_THICKNESS, z: (z0 + z1) / 2 },
      { x: (x1 - x0) / 2, y: DECK_HALF_THICKNESS, z: (z1 - z0) / 2 },
    ),
  }
}

export const PALETTE = {
  deckAqua: "#5CC9F5",
  deckSun: "#FFD25E",
  deckRest: "#8FE870",
  deckBridge: "#FFA94D",
  deckRamp: "#FF87C3",
  hazard: "#FF5A6E",
  hazardStripe: "#FFD400",
  bumper: "#FF7AD9",
  mover: "#A98BFF",
  finish: "#FFE45E",
  ink: "#2A2440",
  skyTop: "#7FA8FF",
  skyHorizon: "#FFE0C0",
  cloud: "#FFFFFF",
} as const

/** Runner body colours, cycled by player index. */
export const RUNNER_COLORS = [
  "#FF7A5C",
  "#5CC9F5",
  "#8FE870",
  "#FFD25E",
  "#C98BFF",
  "#FF7AD9",
  "#5CE8C8",
  "#FFA94D",
] as const

const platforms: readonly Platform[] = [
  // --- Segment 0: start plaza -------------------------------------------------
  deck("start-plaza", "start", PALETTE.deckSun, -6.5, 6.5, -9, 6),

  // --- Segment 1: sweeper lane ------------------------------------------------
  deck("lane-sweeper", "path", PALETTE.deckAqua, -3.6, 3.6, 6, 36),

  // --- Segment 2: first rest pad / checkpoint ---------------------------------
  deck("pad-cp1", "path", PALETTE.deckRest, -4.6, 4.6, 36, 42),

  // --- Segment 3: ferry crossing (gap between the pads is the hazard) ---------
  deck("island-mid", "path", PALETTE.deckSun, -3.6, 3.6, 58, 63.5),
  deck("pad-cp2", "path", PALETTE.deckRest, 4, 11, 69, 75),

  // --- Segment 4: bumper field ------------------------------------------------
  deck("lane-bumper", "path", PALETTE.deckAqua, 3.4, 11.6, 75, 99),

  // --- Segment 5: rest pad / checkpoint ---------------------------------------
  deck("pad-cp3", "path", PALETTE.deckRest, 4, 11, 99, 104),

  // --- Segment 6: the narrow bridge -------------------------------------------
  deck("bridge", "bridge", PALETTE.deckBridge, 6.45, 8.55, 104, 128),

  // --- Segment 7: rest pad / checkpoint ---------------------------------------
  deck("pad-cp4", "path", PALETTE.deckRest, 4.5, 10.5, 128, 133),

  // --- Segment 8: the climb — chunky toy steps into the finish gate -----------
  deck("ramp-1", "ramp", PALETTE.deckRamp, 4.5, 10.5, 133, 134.6, 0.45),
  deck("ramp-2", "ramp", PALETTE.deckRamp, 4.5, 10.5, 134.6, 136.2, 0.9),
  deck("ramp-3", "ramp", PALETTE.deckRamp, 4.5, 10.5, 136.2, 137.8, 1.35),
  deck("ramp-4", "ramp", PALETTE.deckRamp, 4.5, 10.5, 137.8, 139.4, 1.8),
  deck("ramp-5", "ramp", PALETTE.deckRamp, 4.5, 10.5, 139.4, 141, 2.25),

  // --- Segment 9: finish plateau ----------------------------------------------
  deck("finish-plateau", "finish", PALETTE.finish, 3, 12, 141, 152, 2.25),
]

const sweeper = (
  id: string,
  pivot: Vec3,
  armLength: number,
  angularVelocityDeg: number,
  phaseDeg: number,
  knockbackSpeed = 11,
): SweeperSpec => ({
  kind: "sweeper",
  id: asObstacleId(id),
  pivot,
  armLength,
  armHalfThickness: 0.3,
  armHalfHeight: 0.35,
  angularVelocityDeg,
  phaseDeg,
  knockbackSpeed,
  knockbackLift: 5.5,
  color: PALETTE.hazard,
})

const bumper = (id: string, x: number, z: number, radius = 1.1): BumperSpec => ({
  kind: "bumper",
  id: asObstacleId(id),
  center: { x, y: 0.32, z },
  radius,
  impulseSpeed: 12.5,
  impulseLift: 6.4,
  bobAmplitude: 0.22,
  bobPeriodSec: 2.4,
  color: PALETTE.bumper,
})

const obstacles: readonly (SweeperSpec | MoverSpec | BumperSpec)[] = [
  // Sweeper lane — three arms, alternating direction, speeding up as you go.
  // Arm underside sits 0.55 m above the deck: a full jump clears it, a walk does not.
  sweeper("sweep-1", { x: 0, y: 0.9, z: 14 }, 4.6, 95, 0),
  sweeper("sweep-2", { x: 0, y: 0.9, z: 24 }, 4.6, -110, 140),
  sweeper("sweep-3", { x: 0, y: 0.9, z: 33 }, 4.6, 125, 60),

  // Ferry across the first void: a shuttle that bridges pad-cp1 to island-mid.
  {
    kind: "mover",
    id: asObstacleId("ferry-1"),
    from: { x: 0, y: -0.35, z: 45.5 },
    to: { x: 0, y: -0.35, z: 55.5 },
    halfExtents: { x: 2.8, y: 0.35, z: 2.8 },
    travelSec: 3,
    dwellSec: 1.2,
    phaseSec: 0,
    color: PALETTE.mover,
  },
  // Second crossing: a sideways slider that carries you from the island out to pad-cp2.
  {
    kind: "mover",
    id: asObstacleId("ferry-2"),
    from: { x: 0, y: -0.35, z: 66.5 },
    to: { x: 6.5, y: -0.35, z: 66.5 },
    halfExtents: { x: 2.4, y: 0.35, z: 2.4 },
    travelSec: 2.6,
    dwellSec: 1,
    phaseSec: 1.3,
    color: PALETTE.mover,
  },

  // Bumper field — six bobbing domes that pop you sideways.
  bumper("bump-1", 5.5, 79),
  bumper("bump-2", 9.5, 82),
  bumper("bump-3", 7.5, 86),
  bumper("bump-4", 4.6, 89.5),
  bumper("bump-5", 10.4, 90.5),
  bumper("bump-6", 7.5, 94),
  // One last arm guarding the exit of the bumper field.
  sweeper("sweep-4", { x: 7.5, y: 0.9, z: 96.5 }, 4.2, -115, 200),

  // The bridge sweeper: slow, long telegraph, but the deck is only 2.1 m wide.
  sweeper("sweep-bridge", { x: 7.5, y: 0.9, z: 114 }, 3.6, 82, 25, 8.5),
]

const checkpointBox = (x0: number, x1: number, z0: number, z1: number, top = 0): BoxCollider =>
  box(
    { x: (x0 + x1) / 2, y: top + 1.4, z: (z0 + z1) / 2 },
    { x: (x1 - x0) / 2, y: 1.8, z: (z1 - z0) / 2 },
  )

const checkpoints: readonly Checkpoint[] = [
  {
    index: asCheckpointIndex(0),
    id: asObstacleId("cp-start"),
    respawn: { x: 0, y: 1.1, z: -4 },
    trigger: checkpointBox(-6.5, 6.5, -9, 6),
    label: "Start",
  },
  {
    index: asCheckpointIndex(1),
    id: asObstacleId("cp-1"),
    respawn: { x: 0, y: 1.1, z: 39 },
    trigger: checkpointBox(-4.6, 4.6, 36, 42),
    label: "Sweepers cleared",
  },
  {
    index: asCheckpointIndex(2),
    id: asObstacleId("cp-2"),
    respawn: { x: 7.5, y: 1.1, z: 72 },
    trigger: checkpointBox(4, 11, 69, 75),
    label: "Ferries cleared",
  },
  {
    index: asCheckpointIndex(3),
    id: asObstacleId("cp-3"),
    respawn: { x: 7.5, y: 1.1, z: 101.5 },
    trigger: checkpointBox(4, 11, 99, 104),
    label: "Bumpers cleared",
  },
  {
    index: asCheckpointIndex(4),
    id: asObstacleId("cp-4"),
    respawn: { x: 7.5, y: 1.1, z: 130.5 },
    trigger: checkpointBox(4.5, 10.5, 128, 133),
    label: "Bridge cleared",
  },
]

/** Ordered path hints for NPC navigation — the centre line of the intended route. */
const waypoints: readonly Vec3[] = [
  { x: 0, y: 0, z: 2 },
  { x: 0, y: 0, z: 11 },
  { x: 0, y: 0, z: 19 },
  { x: 0, y: 0, z: 29 },
  { x: 0, y: 0, z: 39 },
  { x: 0, y: 0, z: 47 },
  { x: 0, y: 0, z: 54 },
  { x: 0, y: 0, z: 61 },
  { x: 1.5, y: 0, z: 66.5 },
  { x: 6.5, y: 0, z: 67 },
  { x: 7.5, y: 0, z: 72 },
  { x: 6, y: 0, z: 80 },
  { x: 9, y: 0, z: 85 },
  { x: 7.5, y: 0, z: 92 },
  { x: 7.5, y: 0, z: 101.5 },
  { x: 7.5, y: 0, z: 110 },
  { x: 7.5, y: 0, z: 119 },
  { x: 7.5, y: 0, z: 126 },
  { x: 7.5, y: 0, z: 130.5 },
  { x: 7.5, y: 1.4, z: 137 },
  { x: 7.5, y: 2.25, z: 143 },
  { x: 7.5, y: 2.25, z: 148 },
]

export const SUNRISE_SCRAMBLE: CourseDefinition = {
  id: "sunrise-scramble",
  name: "Sunrise Scramble",
  spawn: { x: 0, y: 1.1, z: -4 },
  spawnYaw: 0,
  platforms,
  obstacles,
  checkpoints,
  finish: box({ x: 7.5, y: 3.6, z: 146.5 }, { x: 4.5, y: 2.4, z: 5.5 }),
  killY: -14,
  waypoints,
}

/** Every course the game can load. One polished course for now. */
export const COURSES: readonly CourseDefinition[] = [SUNRISE_SCRAMBLE]
