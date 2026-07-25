/**
 * Mesh builders for the obstacle archetypes. Materials and geometries come
 * from the shared caches in `render-cache`, so identical looks and shapes
 * across the course cost one material, one geometry and one program.
 * Genuinely repeated statics (sweeper hubs) and bobbing bumper domes render
 * as InstancedMesh; moving arms and movers stay individual meshes.
 */

import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { PALETTE } from "../shared/course"
import { moverBoxAt, sweeperArmAt } from "../shared/obstacles"
import type { BoxCollider, BumperSpec, MoverSpec, SweeperSpec } from "../shared/types"
import type { GeometryCache, VinylCache } from "./render-cache"

export type MeshTools = { readonly vinyl: VinylCache; readonly geometry: GeometryCache }

export function boxMesh(
  box: BoxCollider,
  material: THREE.Material,
  radius = 0.14,
  tools?: MeshTools,
): THREE.Mesh {
  const corner = Math.min(radius, box.halfExtents.x, box.halfExtents.y, box.halfExtents.z)
  const factory = (): THREE.BufferGeometry =>
    new RoundedBoxGeometry(
      box.halfExtents.x * 2,
      box.halfExtents.y * 2,
      box.halfExtents.z * 2,
      3,
      corner,
    )
  const key = `rbox:${box.halfExtents.x}:${box.halfExtents.y}:${box.halfExtents.z}:${corner}`
  const geometry = tools === undefined ? factory() : tools.geometry.get(key, factory)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(box.center.x, box.center.y, box.center.z)
  mesh.rotation.y = box.yaw
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export type SweeperMesh = {
  readonly spec: SweeperSpec
  readonly group: THREE.Group
  readonly arm: THREE.Mesh
}
export type MoverMesh = { readonly spec: MoverSpec; readonly mesh: THREE.Mesh }

export function buildSweeper(spec: SweeperSpec, tools: MeshTools): SweeperMesh {
  const group = new THREE.Group()
  const arm = boxMesh(
    sweeperArmAt(spec, 0),
    tools.vinyl.get(spec.color, {
      roughness: 0.22,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
      emissiveIntensity: 0.28,
    }),
    0.18,
    tools,
  )
  group.add(arm)

  // Caution striping: one merged geometry per arm length, one draw call per arm.
  const stripeGeometry = tools.geometry.get(
    `stripes:${spec.armLength}:${spec.armHalfHeight}:${spec.armHalfThickness}`,
    () => {
      const parts: THREE.BufferGeometry[] = []
      for (let index = 0; index < 3; index += 1) {
        const part = new THREE.BoxGeometry(
          0.34,
          spec.armHalfHeight * 2.06,
          spec.armHalfThickness * 2.08,
        )
        part.translate(-spec.armLength * 0.28 + index * spec.armLength * 0.28, 0, 0)
        parts.push(part)
      }
      const merged = mergeGeometries(parts)
      for (const part of parts) part.dispose()
      return merged
    },
  )
  const stripes = new THREE.Mesh(
    stripeGeometry,
    tools.vinyl.get(PALETTE.hazardStripe, { roughness: 0.25, clearcoat: 0.8 }),
  )
  arm.add(stripes)
  return { spec, group, arm }
}

/** Static hub columns under every sweeper pivot, one instanced draw per height. */
export function buildSweeperHubs(specs: readonly SweeperSpec[], tools: MeshTools): THREE.Group {
  const group = new THREE.Group()
  const byHeight = new Map<number, SweeperSpec[]>()
  for (const spec of specs) {
    const list = byHeight.get(spec.pivot.y) ?? []
    list.push(spec)
    byHeight.set(spec.pivot.y, list)
  }
  const scratch = new THREE.Matrix4()
  for (const [pivotY, list] of byHeight) {
    const geometry = tools.geometry.get(
      `hub:${pivotY}`,
      () => new THREE.CylinderGeometry(0.42, 0.5, pivotY + 0.7, 20),
    )
    const mesh = new THREE.InstancedMesh(
      geometry,
      tools.vinyl.get(PALETTE.ink, { roughness: 0.45 }),
      list.length,
    )
    list.forEach((spec, index) => {
      scratch.makeTranslation(spec.pivot.x, (spec.pivot.y - 0.7) / 2, spec.pivot.z)
      mesh.setMatrixAt(index, scratch)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = true
    mesh.computeBoundingSphere()
    group.add(mesh)
  }
  return group
}

export function buildMover(spec: MoverSpec, tools: MeshTools): MoverMesh {
  const mesh = boxMesh(
    moverBoxAt(spec, 0),
    tools.vinyl.get(spec.color, { roughness: 0.3, clearcoat: 0.7 }),
    0.2,
    tools,
  )
  const railRadius = Math.max(spec.halfExtents.x, spec.halfExtents.z) * 0.92
  const rail = new THREE.Mesh(
    tools.geometry.get(
      `rail:${railRadius}`,
      () => new THREE.TorusGeometry(railRadius, 0.07, 8, 28),
    ),
    tools.vinyl.get(PALETTE.hazardStripe, { roughness: 0.3 }),
  )
  rail.rotation.x = Math.PI / 2
  rail.position.y = spec.halfExtents.y + 0.02
  mesh.add(rail)
  return { spec, mesh }
}

export type BumperEntry = {
  readonly spec: BumperSpec
  readonly domes: THREE.InstancedMesh
  readonly rings: THREE.InstancedMesh
  readonly index: number
}

export type BumperSet = {
  readonly group: THREE.Group
  readonly entries: readonly BumperEntry[]
  /** Every instanced mesh whose instanceMatrix needs flagging after updates. */
  readonly instanced: readonly THREE.InstancedMesh[]
}

/** Bumper domes genuinely repeat: one instanced draw for domes, one for rings. */
export function buildBumperSet(specs: readonly BumperSpec[], tools: MeshTools): BumperSet {
  const group = new THREE.Group()
  const entries: BumperEntry[] = []
  const instanced: THREE.InstancedMesh[] = []
  const byRadius = new Map<number, BumperSpec[]>()
  for (const spec of specs) {
    const list = byRadius.get(spec.radius) ?? []
    list.push(spec)
    byRadius.set(spec.radius, list)
  }
  for (const [radius, list] of byRadius) {
    const domes = new THREE.InstancedMesh(
      tools.geometry.get(`dome:${radius}`, () => new THREE.SphereGeometry(radius, 28, 20)),
      tools.vinyl.get("#ffffff", {
        roughness: 0.18,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        sheen: 0.35,
      }),
      list.length,
    )
    const rings = new THREE.InstancedMesh(
      tools.geometry.get(
        `ring:${radius}`,
        () => new THREE.TorusGeometry(radius * 0.82, radius * 0.12, 10, 30),
      ),
      tools.vinyl.get(PALETTE.hazardStripe, { roughness: 0.25, clearcoat: 0.85 }),
      list.length,
    )
    list.forEach((spec, index) => {
      domes.setColorAt(index, new THREE.Color(spec.color))
      entries.push({ spec, domes, rings, index })
    })
    if (domes.instanceColor !== null) domes.instanceColor.needsUpdate = true
    domes.castShadow = true
    // The instances bob: their bounds change every frame, so culling against
    // the base geometry sphere would pop them out. Deliberate, documented.
    domes.frustumCulled = false
    rings.frustumCulled = false
    group.add(domes, rings)
    instanced.push(domes, rings)
  }
  return { group, entries, instanced }
}
