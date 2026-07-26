/**
 * World collision layer for Wobble Rush 3D.
 *
 * `createWorldSnapshot` freezes every dynamic collider at `timeSec` and
 * exposes sphere queries against the whole course. Deterministic: the same
 * (course, timeSec, inputs) always produce the same ContactResult.
 *
 * `resolve` reports: it depenetrates, detects ground and slides along walls,
 * and returns one ContactImpulse per distinct obstacle touched. It never
 * decides how the runner reacts to a sweeper or bumper — that is the
 * consumer's job, so one physical collision can produce one response.
 */

import { sphereVsBox, sphereVsSphere } from "./collision"
import { bumperSphereAt, moverBoxAt, moverVelocityAt, sweeperArmAt } from "./obstacles"
import type {
  BoxCollider,
  BumperSpec,
  Checkpoint,
  ContactImpulse,
  ContactResult,
  CourseDefinition,
  MoverSpec,
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

/** True when the (x, z) column lies inside a yaw-rotated box footprint. */
function containsColumn(box: BoxCollider, x: number, z: number): boolean {
  const dx = x - box.center.x
  const dz = z - box.center.z
  const cos = Math.cos(-box.yaw)
  const sin = Math.sin(-box.yaw)
  const localX = dx * cos - dz * sin
  const localZ = dx * sin + dz * cos
  return Math.abs(localX) <= box.halfExtents.x && Math.abs(localZ) <= box.halfExtents.z
}

/** Highest deck top at or below `fromY` under the (x, z) column. */
function highestSupport(
  boxes: readonly BoxCollider[],
  x: number,
  z: number,
  fromY: number,
): number | null {
  let best: number | null = null
  for (const box of boxes) {
    if (!containsColumn(box, x, z)) continue
    const top = box.center.y + box.halfExtents.y
    if (top > fromY) continue
    if (best === null || top > best) best = top
  }
  return best
}

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
    // One wall-slide projection per collider per tick, in first-contact order.
    // Depenetration can touch the same collider on several iterations; applying
    // the projection every time bleeds the tangential component (a 45-degree
    // wedge halves the slide per pass), so the velocity response runs once per
    // surface after the position loop.
    const wallNormals = new Map<string, Vec3>()
    // One impulse per distinct obstacle, however many iterations touch it.
    const impulses = new Map<string, ContactImpulse>()

    const depenetrateSolid = (key: string, box: BoxCollider, moverSpec: MoverSpec | null): void => {
      const hit = sphereVsBox(vec3(px, py, pz), radius, box)
      if (!hit.hit) return
      anyHit = true
      px += hit.normal.x * hit.depth
      py += hit.normal.y * hit.depth
      pz += hit.normal.z * hit.depth
      if (hit.normal.y >= GROUND_NORMAL_Y) {
        grounded = true
        if (moverSpec !== null) carry = moverVelocityAt(moverSpec, timeSec)
      } else if (!wallNormals.has(key)) {
        wallNormals.set(key, hit.normal)
      }
    }

    // Sweeper arms depenetrate and report a tangential push direction.
    const depenetrateSweeper = (entry: SweeperEntry): void => {
      const hit = sphereVsBox(vec3(px, py, pz), radius, entry.arm)
      if (!hit.hit) return
      anyHit = true
      px += hit.normal.x * hit.depth
      py += hit.normal.y * hit.depth
      pz += hit.normal.z * hit.depth
      if (impulses.has(entry.spec.id)) return
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
      impulses.set(entry.spec.id, {
        kind: "sweeper",
        obstacle: entry.spec.id,
        direction: vec3(tx, 0, tz),
        speed: entry.spec.knockbackSpeed,
        lift: entry.spec.knockbackLift,
        point: hit.point,
        depth: hit.depth,
      })
    }

    // Bumpers depenetrate and report a radially outward push direction.
    const depenetrateBumper = (entry: BumperEntry): void => {
      const hit = sphereVsSphere(vec3(px, py, pz), radius, entry.sphere.center, entry.sphere.radius)
      if (!hit.hit) return
      anyHit = true
      px += hit.normal.x * hit.depth
      py += hit.normal.y * hit.depth
      pz += hit.normal.z * hit.depth
      if (impulses.has(entry.spec.id)) return
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
      impulses.set(entry.spec.id, {
        kind: "bumper",
        obstacle: entry.spec.id,
        direction: vec3(ox, 0, oz),
        speed: entry.spec.impulseSpeed,
        lift: entry.spec.impulseLift,
        point: hit.point,
        depth: hit.depth,
      })
    }

    // Every solid pushes the sphere out along the contact normal; corner
    // contacts settle over a few passes.
    let anyHit = false
    for (let iteration = 0; iteration < MAX_RESOLVE_ITERATIONS; iteration++) {
      anyHit = false
      for (const [index, box] of platformBoxes.entries()) depenetrateSolid(`p:${index}`, box, null)
      for (const [index, entry] of movers.entries())
        depenetrateSolid(`m:${index}`, entry.box, entry.spec)
      for (const entry of sweepers) depenetrateSweeper(entry)
      for (const entry of bumpers) depenetrateBumper(entry)
      if (!anyHit) break
    }

    // Slide along walls: remove only the velocity component into the surface,
    // once per surface touched this tick.
    for (const normal of wallNormals.values()) {
      const into = vx * normal.x + vy * normal.y + vz * normal.z
      if (into < 0) {
        vx -= normal.x * into
        vy -= normal.y * into
        vz -= normal.z * into
      }
    }
    if (grounded && vy < 0) vy = 0

    return {
      position: vec3(px, py, pz),
      velocity: vec3(vx, vy, vz),
      grounded,
      carry,
      impulses: [...impulses.values()],
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

  const supportHeightAt = (x: number, z: number, fromY: number): number | null =>
    highestSupport([...platformBoxes, ...movers.map((entry) => entry.box)], x, z, fromY)

  return { timeSec, resolve, checkpointAt, isFinished, hasFallen, supportHeightAt }
}
