/**
 * Parallax sky furniture: drifting cloud clusters, bobbing blimps and slow arches.
 * Purely decorative — none of it is in the collision world (DESIGN.md section 7).
 *
 * Cost control: clouds render as three InstancedMesh draws (one per puff
 * layout) instead of ~90 spheres, blimps merge hull/fin/cabin into one
 * vertex-coloured geometry, arches share one torus. Roughly ten draw calls
 * of decoration where there used to be a hundred, with the same sky life.
 */

import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { PALETTE } from "../shared/course"
import { createVinyl } from "./scene-kit"

type CloudItem = {
  readonly mesh: THREE.InstancedMesh
  readonly index: number
  readonly speed: number
  readonly baseX: number
  readonly baseY: number
  readonly baseZ: number
  readonly scale: number
}

type Bobber = {
  readonly mesh: THREE.Object3D
  readonly speed: number
  readonly baseY: number
  readonly baseYaw: number
  readonly amplitude: number
}

/** Merged puff cluster: one geometry per layout variant. */
function cloudGeometry(puffs: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let puff = 0; puff < puffs; puff += 1) {
    const sphere = new THREE.SphereGeometry(2.6 + (puff % 2) * 1.4, 14, 10)
    sphere.translate(puff * 3.4 - puffs * 1.4, Math.sin(puff * 2.1) * 0.9, Math.cos(puff) * 1.6)
    parts.push(sphere)
  }
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  return merged
}

/** Blimp body: hull, fin and cabin baked into a single vertex-coloured mesh. */
function blimpGeometry(hullColor: string): THREE.BufferGeometry {
  const paint = (geometry: THREE.BufferGeometry, hex: string): THREE.BufferGeometry => {
    const color = new THREE.Color(hex)
    const count = geometry.getAttribute("position").count
    const colors = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
    return geometry
  }
  const hull = paint(new THREE.SphereGeometry(3.1, 20, 14), hullColor)
  hull.scale(1, 0.66, 1.9)
  const fin = paint(new THREE.BoxGeometry(0.24, 1.8, 1.5), PALETTE.finish)
  fin.translate(0, 0, -4.6)
  const cabin = paint(new THREE.BoxGeometry(1.1, 0.7, 2), PALETTE.ink)
  cabin.translate(0, -2.2, 0)
  const parts = [hull, fin, cabin]
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  return merged
}

export class Backdrop {
  readonly group = new THREE.Group()
  private readonly clouds: CloudItem[] = []
  private readonly cloudMeshes: THREE.InstancedMesh[] = []
  private readonly bobbers: Bobber[] = []
  private readonly scratch = new THREE.Matrix4()

  constructor() {
    this.addClouds()
    this.addBlimps()
    this.addArches()
  }

  private addClouds(): void {
    const material = createVinyl(PALETTE.cloud, { roughness: 0.85, clearcoat: 0 })
    const lanes: { mesh: THREE.InstancedMesh; next: number }[] = []
    for (let variant = 0; variant < 3; variant += 1) {
      // Exact capacity: an unfilled instance would render as a blob at the origin.
      const count = Math.floor((26 - variant + 2) / 3)
      const mesh = new THREE.InstancedMesh(cloudGeometry(3 + variant), material, count)
      // Drift spans the whole sky; a static bounds sphere would cull clouds
      // that have drifted out of it. Deliberate.
      mesh.frustumCulled = false
      this.cloudMeshes.push(mesh)
      this.group.add(mesh)
      lanes.push({ mesh, next: 0 })
    }
    for (let index = 0; index < 26; index += 1) {
      const lane = index % 3
      const bucket = lanes[lane]
      if (bucket === undefined) continue
      const item: CloudItem = {
        mesh: bucket.mesh,
        index: bucket.next,
        speed: 0.6 + lane * 0.55,
        baseX: (index % 2 === 0 ? -1 : 1) * (34 + lane * 22 + (index % 5) * 6),
        baseY: 16 + lane * 9 + (index % 4) * 2.5,
        baseZ: -20 + index * 7.5,
        scale: 0.8 + lane * 0.5,
      }
      bucket.next += 1
      this.clouds.push(item)
      this.writeCloudMatrix(item, item.baseX)
    }
    for (const mesh of this.cloudMeshes) mesh.instanceMatrix.needsUpdate = true
  }

  private writeCloudMatrix(item: CloudItem, x: number): void {
    this.scratch.makeScale(item.scale, item.scale, item.scale)
    this.scratch.setPosition(x, item.baseY, item.baseZ)
    item.mesh.setMatrixAt(item.index, this.scratch)
  }

  private addBlimps(): void {
    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.6,
      clearcoat: 0,
      envMapIntensity: 0.42,
    })
    const geometries = [blimpGeometry(PALETTE.bumper), blimpGeometry(PALETTE.mover)]
    for (let index = 0; index < 4; index += 1) {
      const geometry = geometries[index % 2]
      if (geometry === undefined) continue
      const blimp = new THREE.Mesh(geometry, material)
      blimp.position.set(index % 2 === 0 ? -46 : 46, 30 + index * 5, 14 + index * 32)
      this.group.add(blimp)
      this.bobbers.push({
        mesh: blimp,
        speed: 0.5 + index * 0.2,
        baseY: blimp.position.y,
        baseYaw: 0,
        amplitude: 2.4,
      })
    }
  }

  private addArches(): void {
    const geometry = new THREE.TorusGeometry(11, 1.3, 12, 40, Math.PI)
    const materials = [
      createVinyl(PALETTE.bumper, { roughness: 0.6, clearcoat: 0 }),
      createVinyl(PALETTE.deckSun, { roughness: 0.6, clearcoat: 0 }),
    ]
    for (let index = 0; index < 3; index += 1) {
      const material = index === 1 ? materials[1] : materials[0]
      if (material === undefined) continue
      const arch = new THREE.Mesh(geometry, material)
      arch.position.set(index % 2 === 0 ? -30 : 32, 0, 20 + index * 46)
      arch.rotation.y = index % 2 === 0 ? 0.6 : -0.6
      this.group.add(arch)
      this.bobbers.push({
        mesh: arch,
        speed: 0.18 + index * 0.05,
        baseY: 0,
        baseYaw: arch.rotation.y,
        amplitude: 0,
      })
    }
  }

  update(timeSec: number, reducedMotion: boolean): void {
    if (reducedMotion) return
    for (const item of this.clouds) {
      const drift = ((timeSec * item.speed) % 52) - 26
      this.writeCloudMatrix(item, item.baseX + drift)
    }
    for (const mesh of this.cloudMeshes) mesh.instanceMatrix.needsUpdate = true
    for (const bobber of this.bobbers) {
      bobber.mesh.position.y =
        bobber.baseY + Math.sin(timeSec * bobber.speed * 0.6) * bobber.amplitude
      bobber.mesh.rotation.y = bobber.baseYaw + timeSec * bobber.speed * 0.054
    }
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
        geometries.add(object.geometry)
        const material = object.material
        if (Array.isArray(material)) {
          for (const entry of material) materials.add(entry)
        } else {
          materials.add(material)
        }
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }
}
