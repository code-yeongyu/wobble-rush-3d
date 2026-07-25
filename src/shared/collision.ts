/**
 * Pure collision geometry for Wobble Rush 3D.
 *
 * No game concepts here: spheres, yaw-rotated boxes, closest points and
 * penetration queries. All functions are deterministic and allocation-frugal.
 */

import type { BoxCollider, Vec3 } from "./types"
import { vec3, ZERO_VEC3 } from "./types"

export type SphereBoxHit = {
  readonly hit: boolean
  /** Unit vector from the box surface towards the sphere centre. */
  readonly normal: Vec3
  /** Penetration depth in metres; 0 when not hit. */
  readonly depth: number
  /** The contact point on the box surface (or closest point on a miss). */
  readonly point: Vec3
}

const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi)

/** World-space offset of `point` from `box.center`, expressed in box-local space. */
const toLocal = (dx: number, dz: number, cos: number, sin: number): { lx: number; lz: number } => ({
  lx: dx * cos - dz * sin,
  lz: dx * sin + dz * cos,
})

/** Box-local vector rotated back to world space (rotate by +yaw about +Y). */
const toWorld = (lx: number, lz: number, cos: number, sin: number): { wx: number; wz: number } => ({
  wx: lx * cos + lz * sin,
  wz: -lx * sin + lz * cos,
})

export function closestPointOnBox(point: Vec3, box: BoxCollider): Vec3 {
  const cos = Math.cos(box.yaw)
  const sin = Math.sin(box.yaw)
  const { lx, lz } = toLocal(point.x - box.center.x, point.z - box.center.z, cos, sin)
  const ly = point.y - box.center.y
  const cx = clamp(lx, -box.halfExtents.x, box.halfExtents.x)
  const cy = clamp(ly, -box.halfExtents.y, box.halfExtents.y)
  const cz = clamp(lz, -box.halfExtents.z, box.halfExtents.z)
  const { wx, wz } = toWorld(cx, cz, cos, sin)
  return vec3(box.center.x + wx, box.center.y + cy, box.center.z + wz)
}

export function sphereVsBox(center: Vec3, radius: number, box: BoxCollider): SphereBoxHit {
  const cos = Math.cos(box.yaw)
  const sin = Math.sin(box.yaw)
  const { lx, lz } = toLocal(center.x - box.center.x, center.z - box.center.z, cos, sin)
  const ly = center.y - box.center.y

  const cx = clamp(lx, -box.halfExtents.x, box.halfExtents.x)
  const cy = clamp(ly, -box.halfExtents.y, box.halfExtents.y)
  const cz = clamp(lz, -box.halfExtents.z, box.halfExtents.z)

  const ddx = lx - cx
  const ddy = ly - cy
  const ddz = lz - cz
  const distSq = ddx * ddx + ddy * ddy + ddz * ddz

  const closestWorld = (): Vec3 => {
    const { wx, wz } = toWorld(cx, cz, cos, sin)
    return vec3(box.center.x + wx, box.center.y + cy, box.center.z + wz)
  }

  if (distSq > 0) {
    const dist = Math.sqrt(distSq)
    const { wx, wz } = toWorld(ddx / dist, ddz / dist, cos, sin)
    const normal = vec3(wx, ddy / dist, wz)
    if (dist >= radius) {
      return { hit: false, normal, depth: 0, point: closestWorld() }
    }
    return { hit: true, normal, depth: radius - dist, point: closestWorld() }
  }

  // Degenerate case: the sphere centre is inside the box. Push out along the
  // local axis of least penetration; ties break towards +X for determinism.
  const penX = box.halfExtents.x - Math.abs(lx)
  const penY = box.halfExtents.y - Math.abs(ly)
  const penZ = box.halfExtents.z - Math.abs(lz)
  let nlx = 0
  let nly = 0
  let nlz = 0
  let escapeDist = penX
  if (penY <= penX && penY <= penZ) {
    nly = ly >= 0 ? 1 : -1
    escapeDist = penY
  } else if (penZ <= penX && penZ <= penY) {
    nlz = lz >= 0 ? 1 : -1
    escapeDist = penZ
  } else {
    nlx = lx >= 0 ? 1 : -1
  }
  const { wx, wz } = toWorld(nlx, nlz, cos, sin)
  const normal = vec3(wx, nly, wz)
  const surfaceDist = escapeDist
  return {
    hit: true,
    normal,
    depth: escapeDist + radius,
    point: vec3(
      center.x + wx * surfaceDist,
      center.y + nly * surfaceDist,
      center.z + wz * surfaceDist,
    ),
  }
}

export function sphereVsSphere(a: Vec3, ra: number, b: Vec3, rb: number): SphereBoxHit {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  const distSq = dx * dx + dy * dy + dz * dz
  const radiusSum = ra + rb

  if (distSq >= radiusSum * radiusSum) {
    if (distSq > 0) {
      const dist = Math.sqrt(distSq)
      const normal = vec3(dx / dist, dy / dist, dz / dist)
      const point = vec3(b.x + normal.x * rb, b.y + normal.y * rb, b.z + normal.z * rb)
      return { hit: false, normal, depth: 0, point }
    }
    return { hit: false, normal: ZERO_VEC3, depth: 0, point: b }
  }

  if (distSq === 0) {
    // Concentric: pick a deterministic unit normal.
    const normal = vec3(0, 1, 0)
    return { hit: true, normal, depth: radiusSum, point: a }
  }

  const dist = Math.sqrt(distSq)
  const normal = vec3(dx / dist, dy / dist, dz / dist)
  const depth = radiusSum - dist
  const point = vec3(
    b.x + normal.x * (rb - depth * 0.5),
    b.y + normal.y * (rb - depth * 0.5),
    b.z + normal.z * (rb - depth * 0.5),
  )
  return { hit: true, normal, depth, point }
}
