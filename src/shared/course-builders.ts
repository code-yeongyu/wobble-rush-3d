/**
 * Small geometry builders for authoring a course: deck slabs, sweeper arms,
 * bumper domes and checkpoint trigger volumes.
 */

import { PALETTE } from "./course-palette"
import type { BoxCollider, BumperSpec, Platform, PlatformKind, SweeperSpec, Vec3 } from "./types"
import { asObstacleId } from "./types"

/** Deck slabs are 0.7 m thick with their top face at y = `top`. */
const DECK_HALF_THICKNESS = 0.35

export const box = (center: Vec3, halfExtents: Vec3, yaw = 0): BoxCollider => ({
  center,
  halfExtents,
  yaw,
})

/** Slab spanning [x0,x1] x [z0,z1] with its walking surface at `top`. */
export function deck(
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

export const sweeper = (
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

export const bumper = (id: string, x: number, z: number, radius = 1.1): BumperSpec => ({
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

export const checkpointBox = (
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  top = 0,
): BoxCollider =>
  box(
    { x: (x0 + x1) / 2, y: top + 1.4, z: (z0 + z1) / 2 },
    { x: (x1 - x0) / 2, y: 1.8, z: (z1 - z0) / 2 },
  )
