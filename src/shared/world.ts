/**
 * World collision layer for Wobble Rush 3D.
 *
 * `createWorldSnapshot` freezes every dynamic collider at `timeSec` and
 * exposes sphere queries against the whole course. Deterministic: the same
 * (course, timeSec, inputs) always produce the same ContactResult.
 */

import { sphereVsBox, sphereVsSphere } from "./collision"
import { bumperSphereAt, moverBoxAt, moverVelocityAt, sweeperArmAt } from "./obstacles"
import type {
  BoxCollider,
  BumperSpec,
  Checkpoint,
  ContactResult,
  CourseDefinition,
  MoverSpec,
  SimEvent,
  SphereCollider,
  SweeperSpec,
  Vec3,
  WorldSnapshot,
} from "./types"
import { assertNever, vec3, ZERO_VEC3 } from "./types"

/** Contacts with normal.y at or above this count as ground. */
const GROUND_NORMAL_Y = 0.6
/** Depenetration passes so corner contacts settle. */
const MAX_RESOLVE_ITERATIONS = 4

type MoverEntry = { readonly spec: MoverSpec; readonly box: BoxCollider }
type SweeperEntry = { readonly spec: SweeperSpec; readonly arm: BoxCollider }
type BumperEntry = { readonly spec: BumperSpec; readonly sphere: SphereCollider }

export function createWorldSnapshot(course: CourseDefinition, timeSec: number): WorldSnapshot {
  const platformBoxes: readonly BoxCollider[] = course.platforms.map((p) => p.box)
  const movers: MoverEntry[] = []
  const sweepers: SweeperEntry[] = []
  const bumpers: BumperEntry[] = []
  for (const obstacle of course.obstacles) {
    switch (obstacle.kind) {
      case "mover":
        movers.push({ spec: obstacle, box: moverBoxAt(obstacle, timeSec) })
        break
      case "sweeper":
        sweepers.push({ spec: obstacle, arm: sweeperArmAt(obstacle, timeSec) })
        break
      case "bumper":
        bumpers.push({ spec: obstacle, sphere: bumperSphereAt(obstacle, timeSec) })
        break
      default:
        assertNever(obstacle, "createWorldSnapshot")
    }
  }

  const resolve = (
    _previous: Vec3,
    desired: Vec3,
    velocity: Vec3,
    radius: number,
  ): ContactResult => {
    let px = desired.x
    let py = desired.y
    let pz = desired.z
    let vx = velocity.x
    let vy = velocity.y
    let vz = velocity.z
    let grounded = false
    let carry: Vec3 = ZERO_VEC3
    const events: SimEvent[] = []

    // Platforms and movers push the sphere out along the contact normal.
    for (let iteration = 0; iteration < MAX_RESOLVE_ITERATIONS; iteration++) {
      let anyHit = false

      const depenetrate = (box: BoxCollider, moverSpec: MoverSpec | null): void => {
        const hit = sphereVsBox(vec3(px, py, pz), radius, box)
        if (!hit.hit) return
        anyHit = true
        px += hit.normal.x * hit.depth
        py += hit.normal.y * hit.depth
        pz += hit.normal.z * hit.depth
        if (hit.normal.y >= GROUND_NORMAL_Y) {
          grounded = true
          if (vy < 0) vy = 0
          if (moverSpec !== null) carry = moverVelocityAt(moverSpec, timeSec)
        } else {
          // Slide along walls: remove only the velocity component into the surface.
          const into = vx * hit.normal.x + vy * hit.normal.y + vz * hit.normal.z
          if (into < 0) {
            vx -= hit.normal.x * into
            vy -= hit.normal.y * into
            vz -= hit.normal.z * into
          }
        }
      }

      for (const box of platformBoxes) depenetrate(box, null)
      for (const entry of movers) depenetrate(entry.box, entry.spec)

      if (!anyHit) break
    }

    // Sweeper arms knock the runner away tangentially.
    for (const entry of sweepers) {
      const hit = sphereVsBox(vec3(px, py, pz), radius, entry.arm)
      if (!hit.hit) continue
      px += hit.normal.x * hit.depth
      py += hit.normal.y * hit.depth
      pz += hit.normal.z * hit.depth
      // Tangential direction: omega x r, with omega along +/-Y.
      const spin = entry.spec.angularVelocityDeg >= 0 ? 1 : -1
      const rx = px - entry.spec.pivot.x
      const rz = pz - entry.spec.pivot.z
      let tx = spin * rz
      let tz = -spin * rx
      const tangentLen = Math.hypot(tx, tz)
      if (tangentLen > 1e-9) {
        tx /= tangentLen
        tz /= tangentLen
      } else {
        // Directly above the pivot: fall back to the contact normal.
        const normalLen = Math.hypot(hit.normal.x, hit.normal.z)
        if (normalLen > 1e-9) {
          tx = hit.normal.x / normalLen
          tz = hit.normal.z / normalLen
        } else {
          tx = 1
          tz = 0
        }
      }
      vx = tx * entry.spec.knockbackSpeed
      vz = tz * entry.spec.knockbackSpeed
      vy = entry.spec.knockbackLift
      events.push({ kind: "hit", position: vec3(px, py, pz), obstacle: entry.spec.id })
    }

    // Bumpers reflect the runner radially outward.
    for (const entry of bumpers) {
      const hit = sphereVsSphere(vec3(px, py, pz), radius, entry.sphere.center, entry.sphere.radius)
      if (!hit.hit) continue
      px += hit.normal.x * hit.depth
      py += hit.normal.y * hit.depth
      pz += hit.normal.z * hit.depth
      let ox = hit.normal.x
      let oz = hit.normal.z
      const outwardLen = Math.hypot(ox, oz)
      if (outwardLen > 1e-9) {
        ox /= outwardLen
        oz /= outwardLen
      } else {
        // Directly above/below the bumper centre: push along +X deterministically.
        ox = 1
        oz = 0
      }
      vx = ox * entry.spec.impulseSpeed
      vz = oz * entry.spec.impulseSpeed
      vy = entry.spec.impulseLift
      events.push({ kind: "bounce", position: vec3(px, py, pz), obstacle: entry.spec.id })
    }

    return {
      position: vec3(px, py, pz),
      velocity: vec3(vx, vy, vz),
      grounded,
      carry,
      events,
    }
  }

  const checkpointAt = (position: Vec3, radius: number): Checkpoint | null => {
    let best: Checkpoint | null = null
    for (const checkpoint of course.checkpoints) {
      if (!sphereVsBox(position, radius, checkpoint.trigger).hit) continue
      if (best === null || checkpoint.index > best.index) best = checkpoint
    }
    return best
  }

  const isFinished = (position: Vec3, radius: number): boolean =>
    sphereVsBox(position, radius, course.finish).hit

  const hasFallen = (position: Vec3): boolean => position.y < course.killY

  return { timeSec, resolve, checkpointAt, isFinished, hasFallen }
}
