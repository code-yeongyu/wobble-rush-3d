/**
 * Runner-vs-runner crowd resolution for Wobble Rush 3D.
 *
 * Pure and deterministic: the same input array always produces the same
 * mutations and the same bump list, so this runs identically in the browser,
 * in the Durable Object and under `bun test`. Resolution is strictly
 * horizontal (XZ) — knockdowns and launches belong to obstacles, not to
 * bumping into rivals — so neither `position.y` nor `velocity.y` is touched.
 */

import type { MutVec3, Vec3 } from "./types"

/** Arcade tuning for crowd contact. */
export const CROWD = {
  /** Penetration deliberately left in place so resting pairs do not vibrate, m. */
  separationSlop: 0.002,
  /** Closing speed at or below which a pair is treated as resting, m/s. */
  restClosingSpeed: 0.05,
  /** Closing speed above which a contact is reported as a bump event, m/s. */
  bumpMinSpeed: 1,
  /** Contact restitution: 0 is perfectly soft, 1 is a perfect bounce. */
  restitution: 0.4,
} as const

export type CrowdBody = {
  readonly id: string
  readonly radius: number
  /** Mutated in place when the body is pushed. */
  position: MutVec3
  velocity: MutVec3
  /**
   * False for bodies this client does not simulate (remote players, whose
   * position is network-authoritative). An immovable body still PUSHES others
   * but is never moved itself.
   */
  readonly movable: boolean
}

export type CrowdBump = {
  readonly a: string
  readonly b: string
  readonly point: Vec3
  /** Closing speed along the contact axis at impact, m/s. */
  readonly speed: number
}

/** Centre distance below which two bodies are treated as coincident, m. */
const COINCIDENT_EPS = 1e-9

/**
 * Resolves one ordered pair. `a` always precedes `b` in the caller's array, so
 * the contact axis, the correction split and the bump report are stable for a
 * given input. No allocations: all scratch lives in locals.
 */
function resolvePair(a: CrowdBody, b: CrowdBody, bumps: CrowdBump[]): void {
  const minDist = a.radius + b.radius
  const dx = b.position.x - a.position.x
  const dz = b.position.z - a.position.z
  const distSq = dx * dx + dz * dz
  if (distSq >= minDist * minDist) return
  const rawDist = Math.sqrt(distSq)
  let nx = 1
  let nz = 0
  let dist = 0
  if (rawDist > COINCIDENT_EPS) {
    nx = dx / rawDist
    nz = dz / rawDist
    dist = rawDist
  }
  const correction = minDist - dist - CROWD.separationSlop
  if (correction > 0) {
    const pushA = a.movable ? (b.movable ? correction / 2 : correction) : 0
    const pushB = b.movable ? (a.movable ? correction / 2 : correction) : 0
    a.position.x -= nx * pushA
    a.position.z -= nz * pushA
    b.position.x += nx * pushB
    b.position.z += nz * pushB
  }
  const closing = -((b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz)
  const invA = a.movable ? 1 : 0
  const invB = b.movable ? 1 : 0
  const invSum = invA + invB
  if (closing <= CROWD.restClosingSpeed || invSum === 0) return
  const impulse = ((1 + CROWD.restitution) * closing) / invSum
  a.velocity.x -= impulse * invA * nx
  a.velocity.z -= impulse * invA * nz
  b.velocity.x += impulse * invB * nx
  b.velocity.z += impulse * invB * nz
  if (closing > CROWD.bumpMinSpeed) {
    bumps.push({
      a: a.id,
      b: b.id,
      point: {
        x: a.position.x + nx * a.radius,
        y: (a.position.y + b.position.y) / 2,
        z: a.position.z + nz * a.radius,
      },
      speed: closing,
    })
  }
}

/**
 * Separates overlapping bodies, exchanges horizontal momentum between closing
 * pairs and reports the resulting bumps. Bodies are visited in array order
 * with each pair resolved exactly once, so output order is deterministic.
 */
export function resolveCrowd(bodies: readonly CrowdBody[]): readonly CrowdBump[] {
  const bumps: CrowdBump[] = []
  let i = 0
  for (const a of bodies) {
    let j = 0
    for (const b of bodies) {
      if (j > i) resolvePair(a, b, bumps)
      j += 1
    }
    i += 1
  }
  return bumps
}
