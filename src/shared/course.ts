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
  deckAqua: "#2FB3E8",
  deckSun: "#FFC02E",
  deckRest: "#5FD44A",
  deckBridge: "#FF8A1F",
  deckRamp: "#FF5FA8",
  hazard: "#F5273F",
  hazardStripe: "#FFD400",
  bumper: "#F857C4",
  mover: "#8B62FF",
  finish: "#FFD62E",
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
  // Wide enough that a sweeper hit knocks you around rather than straight off.
  deck("lane-sweeper", "path", PALETTE.deckAqua, -5.2, 5.2, 6, 22),
  deck("pad-cp1", "path", PALETTE.deckRest, -5.2, 5.2, 22, 26),
  deck("lane-sweeper-2", "path", PALETTE.deckAqua, -5.2, 5.2, 26, 40),

  // --- Segment 2: rest pad / checkpoint ---------------------------------------
  deck("pad-cp2", "path", PALETTE.deckRest, -5, 5, 40, 45),

  // --- Segment 3: the hop chain ------------------------------------------------
  // Three islands with 3.2 m gaps: always clearable with one jump, so a mistimed
  // ride is a fall you recover from, never a dead end. The sliding platforms
  // sweep through the gaps as both a shortcut and a shove.
  deck("hop-1", "path", PALETTE.deckSun, -3.2, 3.2, 48.2, 52.6),
  deck("hop-2", "path", PALETTE.deckSun, -3.2, 3.2, 55.8, 60.2),
  deck("hop-3", "path", PALETTE.deckSun, 0.4, 6.8, 63.4, 67.8),
  deck("pad-cp3", "path", PALETTE.deckRest, 4, 11, 71, 76),

  // --- Segment 4: bumper field ------------------------------------------------
  deck("lane-bumper", "path", PALETTE.deckAqua, 2.6, 12.4, 76, 100),

  // --- Segment 5: rest pad / checkpoint ---------------------------------------
  deck("pad-cp4", "path", PALETTE.deckRest, 4, 11, 100, 105),

  // --- Segment 6: the narrow bridge -------------------------------------------
  // 2.8 m for a 0.9 m runner: tense, but you can correct a wobble.
  deck("bridge", "bridge", PALETTE.deckBridge, 6.1, 8.9, 105, 127),

  // --- Segment 7: rest pad / checkpoint ---------------------------------------
  deck("pad-cp5", "path", PALETTE.deckRest, 4.5, 10.5, 127, 133),

  // --- Segment 8: the climb — shallow toy steps into the finish gate ---------
  deck("ramp-1", "ramp", PALETTE.deckRamp, 4.5, 10.5, 133.0, 133.9, 0.15),
  deck("ramp-2", "ramp", PALETTE.deckRamp, 4.5, 10.5, 133.9, 134.8, 0.3),
  deck("ramp-3", "ramp", PALETTE.deckRamp, 4.5, 10.5, 134.8, 135.7, 0.45),
  deck("ramp-4", "ramp", PALETTE.deckRamp, 4.5, 10.5, 135.7, 136.6, 0.6),
  deck("ramp-5", "ramp", PALETTE.deckRamp, 4.5, 10.5, 136.6, 137.5, 0.75),
  deck("ramp-6", "ramp", PALETTE.deckRamp, 4.5, 10.5, 137.5, 138.4, 0.9),
  deck("ramp-7", "ramp", PALETTE.deckRamp, 4.5, 10.5, 138.4, 139.3, 1.05),
  deck("ramp-8", "ramp", PALETTE.deckRamp, 4.5, 10.5, 139.3, 140.2, 1.2),

  // --- Segment 9: finish plateau ----------------------------------------------
  deck("finish-plateau", "finish", PALETTE.finish, 3, 12, 140.2, 152, 1.2),
]

const sweeper = (
  id: string,
  pivot: Vec3,
  armLength: number,
  angularVelocityDeg: number,
  phaseDeg: number,
  knockbackSpeed = 7.5,
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
  knockbackLift: 4.2,
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
  sweeper("sweep-1", { x: 0, y: 0.9, z: 13 }, 5.4, 85, 0),
  sweeper("sweep-2", { x: 0, y: 0.9, z: 19 }, 5.4, -100, 140),
  sweeper("sweep-3", { x: 0, y: 0.9, z: 31 }, 5.4, 115, 60),
  sweeper("sweep-4", { x: 0, y: 0.9, z: 37 }, 5.4, -130, 210),

  // Sliding platforms sweep across the hop-chain gaps: ride one for a free crossing,
  // or jump the gap yourself. Either way the route is always completable.
  {
    kind: "mover",
    id: asObstacleId("slider-1"),
    from: { x: -7.5, y: -0.35, z: 54.2 },
    to: { x: 7.5, y: -0.35, z: 54.2 },
    halfExtents: { x: 2.4, y: 0.35, z: 1.5 },
    travelSec: 3.4,
    dwellSec: 0.8,
    phaseSec: 0,
    color: PALETTE.mover,
  },
  {
    kind: "mover",
    id: asObstacleId("slider-2"),
    from: { x: 9, y: -0.35, z: 61.8 },
    to: { x: -5.5, y: -0.35, z: 61.8 },
    halfExtents: { x: 2.4, y: 0.35, z: 1.5 },
    travelSec: 3,
    dwellSec: 0.7,
    phaseSec: 1.6,
    color: PALETTE.mover,
  },
  // A rideable lift that ferries you from the last island onto the checkpoint pad.
  {
    kind: "mover",
    id: asObstacleId("ferry-1"),
    from: { x: 5.6, y: -0.35, z: 68.4 },
    to: { x: 7.5, y: -0.35, z: 70.6 },
    halfExtents: { x: 2.6, y: 0.35, z: 1.9 },
    travelSec: 2,
    dwellSec: 0.9,
    phaseSec: 0,
    color: PALETTE.mover,
  },

  // Bumper field — six bobbing domes that pop you sideways.
  bumper("bump-1", 5, 80),
  bumper("bump-2", 10, 83.5),
  bumper("bump-3", 7.5, 87),
  bumper("bump-4", 4.4, 90.5),
  bumper("bump-5", 10.6, 91.5),
  bumper("bump-6", 7.5, 95),
  // One last arm guarding the exit of the bumper field.
  sweeper("sweep-5", { x: 7.5, y: 0.9, z: 98 }, 4.6, -115, 200, 6),

  // The bridge sweeper: slow, long telegraph, and a gentle shove — the drop does the work.
  sweeper("sweep-bridge", { x: 7.5, y: 0.9, z: 115 }, 3.4, 74, 25, 4.5),
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
    respawn: { x: 0, y: 1.1, z: 24 },
    trigger: checkpointBox(-5.2, 5.2, 22, 26),
    label: "First sweepers cleared",
  },
  {
    index: asCheckpointIndex(2),
    id: asObstacleId("cp-2"),
    respawn: { x: 0, y: 1.1, z: 42.5 },
    trigger: checkpointBox(-5, 5, 40, 45),
    label: "Sweeper lane cleared",
  },
  {
    index: asCheckpointIndex(3),
    id: asObstacleId("cp-3"),
    respawn: { x: 7.5, y: 1.1, z: 73.5 },
    trigger: checkpointBox(4, 11, 71, 76),
    label: "Hop chain cleared",
  },
  {
    index: asCheckpointIndex(4),
    id: asObstacleId("cp-4"),
    respawn: { x: 7.5, y: 1.1, z: 102.5 },
    trigger: checkpointBox(4, 11, 100, 105),
    label: "Bumpers cleared",
  },
  {
    index: asCheckpointIndex(5),
    id: asObstacleId("cp-5"),
    respawn: { x: 7.5, y: 1.1, z: 130 },
    trigger: checkpointBox(4.5, 10.5, 127, 133),
    label: "Bridge cleared",
  },
]

/** Ordered path hints for NPC navigation — the centre line of the intended route. */
const waypoints: readonly Vec3[] = [
  { x: 0, y: 0, z: 2 },
  { x: 0, y: 0, z: 10 },
  { x: 0, y: 0, z: 16 },
  { x: 0, y: 0, z: 24 },
  { x: 0, y: 0, z: 34 },
  { x: 0, y: 0, z: 42.5 },
  { x: 0, y: 0, z: 50.4 },
  { x: 0, y: 0, z: 58 },
  { x: 3.6, y: 0, z: 65.6 },
  { x: 7, y: 0, z: 70 },
  { x: 7.5, y: 0, z: 73.5 },
  { x: 6.5, y: 0, z: 81 },
  { x: 8.6, y: 0, z: 86 },
  { x: 7.5, y: 0, z: 93 },
  { x: 7.5, y: 0, z: 102.5 },
  { x: 7.5, y: 0, z: 110 },
  { x: 7.5, y: 0, z: 119 },
  { x: 7.5, y: 0, z: 125 },
  { x: 7.5, y: 0, z: 130 },
  { x: 7.5, y: 0.6, z: 136 },
  { x: 7.5, y: 1.2, z: 142 },
  { x: 7.5, y: 1.2, z: 148 },
]

export const SUNRISE_SCRAMBLE: CourseDefinition = {
  id: "sunrise-scramble",
  name: "Sunrise Scramble",
  spawn: { x: 0, y: 1.1, z: -4 },
  spawnYaw: 0,
  platforms,
  obstacles,
  checkpoints,
  finish: box({ x: 7.5, y: 2.6, z: 146.5 }, { x: 4.5, y: 2.4, z: 5.5 }),
  killY: -14,
  waypoints,
}

/** Every course the game can load. One polished course for now. */
export const COURSES: readonly CourseDefinition[] = [SUNRISE_SCRAMBLE]
