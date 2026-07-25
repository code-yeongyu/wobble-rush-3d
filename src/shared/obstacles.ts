/**
 * Deterministic obstacle kinematics for Wobble Rush 3D.
 *
 * Every collider is a pure function of (spec, timeSec) so replay and
 * multiplayer agree bit-for-bit. No Date.now(), no Math.random().
 */

import type { BoxCollider, BumperSpec, MoverSpec, SphereCollider, SweeperSpec, Vec3 } from "./types"
import { vec3 } from "./types"

const DEG_TO_RAD = Math.PI / 180
const TWO_PI = Math.PI * 2

/** Smoothstep easing: t*t*(3-2t). Zero slope at both ends. */
const smoothstep = (t: number): number => t * t * (3 - 2 * t)

/** d/dt of smoothstep. */
const smoothstepDerivative = (t: number): number => 6 * t * (1 - t)

/* ------------------------------------------------------------------ *
 * Sweeper
 * ------------------------------------------------------------------ */

export function sweeperAngleAt(spec: SweeperSpec, timeSec: number): number {
  return (spec.phaseDeg + spec.angularVelocityDeg * timeSec) * DEG_TO_RAD
}

export function sweeperArmAt(spec: SweeperSpec, timeSec: number): BoxCollider {
  const angle = sweeperAngleAt(spec, timeSec)
  // The box's local +X axis maps to world (cos(yaw), 0, -sin(yaw)), so the arm
  // spans from the pivot out to pivot + dir * armLength.
  const dirX = Math.cos(angle)
  const dirZ = -Math.sin(angle)
  const halfLength = spec.armLength / 2
  return {
    center: vec3(spec.pivot.x + dirX * halfLength, spec.pivot.y, spec.pivot.z + dirZ * halfLength),
    halfExtents: vec3(halfLength, spec.armHalfHeight, spec.armHalfThickness),
    yaw: angle,
  }
}

/* ------------------------------------------------------------------ *
 * Mover
 * ------------------------------------------------------------------ */

/**
 * Progress along the mover path: s in [0,1] where 0 is `from` and 1 is `to`,
 * plus ds/dt for the analytic velocity. Cycle layout:
 * travel from->to | dwell at to | travel to->from | dwell at from.
 */
const moverProgress = (spec: MoverSpec, timeSec: number): { s: number; dsdt: number } => {
  const cycle = spec.travelSec * 2 + spec.dwellSec * 2
  const raw = (timeSec + spec.phaseSec) % cycle
  const t = raw < 0 ? raw + cycle : raw
  const travelEnd = spec.travelSec
  const dwellToEnd = travelEnd + spec.dwellSec
  const returnEnd = dwellToEnd + spec.travelSec

  if (t < travelEnd) {
    const u = t / spec.travelSec
    return { s: smoothstep(u), dsdt: smoothstepDerivative(u) / spec.travelSec }
  }
  if (t < dwellToEnd) {
    return { s: 1, dsdt: 0 }
  }
  if (t < returnEnd) {
    const u = (t - dwellToEnd) / spec.travelSec
    return { s: 1 - smoothstep(u), dsdt: -smoothstepDerivative(u) / spec.travelSec }
  }
  return { s: 0, dsdt: 0 }
}

export function moverBoxAt(spec: MoverSpec, timeSec: number): BoxCollider {
  const { s } = moverProgress(spec, timeSec)
  return {
    center: vec3(
      spec.from.x + (spec.to.x - spec.from.x) * s,
      spec.from.y + (spec.to.y - spec.from.y) * s,
      spec.from.z + (spec.to.z - spec.from.z) * s,
    ),
    halfExtents: spec.halfExtents,
    yaw: 0,
  }
}

export function moverVelocityAt(spec: MoverSpec, timeSec: number): Vec3 {
  const { dsdt } = moverProgress(spec, timeSec)
  return vec3(
    (spec.to.x - spec.from.x) * dsdt,
    (spec.to.y - spec.from.y) * dsdt,
    (spec.to.z - spec.from.z) * dsdt,
  )
}

/* ------------------------------------------------------------------ *
 * Bumper
 * ------------------------------------------------------------------ */

export function bumperSphereAt(spec: BumperSpec, timeSec: number): SphereCollider {
  const bob = spec.bobAmplitude * Math.sin((TWO_PI * timeSec) / spec.bobPeriodSec)
  return {
    center: vec3(spec.center.x, spec.center.y + bob, spec.center.z),
    radius: spec.radius,
  }
}
