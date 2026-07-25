/**
 * Course furniture: checkpoint flags and the finish gate. Flags genuinely
 * repeat, so poles and banners render as two static InstancedMesh draws
 * total instead of two meshes per checkpoint.
 */

import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { PALETTE } from "../shared/course"
import type { CourseDefinition } from "../shared/types"
import type { MeshTools } from "./obstacle-meshes"

export type FlagPoint = {
  readonly x: number
  readonly z: number
  /** Pad bounds from the checkpoint trigger: poles must stand on the pad. */
  readonly bounds: {
    readonly minX: number
    readonly maxX: number
    readonly minZ: number
    readonly maxZ: number
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export function buildCheckpointFlags(points: readonly FlagPoint[], tools: MeshTools): THREE.Group {
  const group = new THREE.Group()
  const poles = new THREE.InstancedMesh(
    tools.geometry.get("flag-pole", () => new THREE.CylinderGeometry(0.07, 0.09, 3, 12)),
    tools.vinyl.get(PALETTE.ink, { roughness: 0.5 }),
    points.length,
  )
  const flags = new THREE.InstancedMesh(
    tools.geometry.get("flag-cloth", () => new THREE.BoxGeometry(1.1, 0.66, 0.06)),
    tools.vinyl.get(PALETTE.deckRest, {
      roughness: 0.25,
      clearcoat: 0.9,
      emissiveIntensity: 0.25,
    }),
    points.length,
  )
  const scratch = new THREE.Matrix4()
  points.forEach((point, index) => {
    // Preferred spot left of the respawn, clamped 0.5 m inside the pad so the
    // pole never floats off an edge or straddles the deck's rounded lip.
    const poleX = clamp(point.x - 3.4, point.bounds.minX + 0.5, point.bounds.maxX - 0.5)
    const poleZ = clamp(point.z, point.bounds.minZ + 0.5, point.bounds.maxZ - 0.5)
    // Base sunk 6 cm into the deck: the bottom cap is never coplanar with the
    // walking surface, so there is no z-fighting ring around the pole.
    scratch.makeTranslation(poleX, 1.44, poleZ)
    poles.setMatrixAt(index, scratch)
    scratch.makeTranslation(poleX + 0.6, 2.6, poleZ)
    flags.setMatrixAt(index, scratch)
  })
  poles.instanceMatrix.needsUpdate = true
  flags.instanceMatrix.needsUpdate = true
  poles.computeBoundingSphere()
  flags.computeBoundingSphere()
  group.add(poles, flags)
  return group
}

export type FinishGate = {
  readonly group: THREE.Group
  readonly beam: THREE.Mesh
  readonly material: THREE.MeshPhysicalMaterial
  readonly dispose: () => void
}

export function buildFinishGate(course: CourseDefinition, tools: MeshTools): FinishGate {
  const group = new THREE.Group()
  const material = tools.vinyl.get(PALETTE.finish, {
    roughness: 0.25,
    metalness: 0.15,
    clearcoat: 0.9,
    emissiveIntensity: 0.35,
  })
  // Posts reach from inside the plateau deck (bottom 0.55 m, hidden by the
  // skirt) up into the beam: nothing dangles below the skirt, nothing floats.
  const postGeometry = tools.geometry.get(
    "finish-post",
    () => new THREE.CylinderGeometry(0.34, 0.42, 4.2, 16),
  )
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, material)
    post.position.set(
      course.finish.center.x + side * 3.6,
      course.finish.center.y + 0.05,
      course.finish.center.z - 4.6,
    )
    post.castShadow = true
    group.add(post)
  }
  const beam = new THREE.Mesh(
    tools.geometry.get("finish-beam", () => new RoundedBoxGeometry(8.8, 1.1, 0.9, 3, 0.3)),
    material,
  )
  beam.position.set(
    course.finish.center.x,
    course.finish.center.y + 2.1,
    course.finish.center.z - 4.6,
  )
  beam.castShadow = true
  const bannerTexture = createBannerTexture()
  const bannerGeometry = new THREE.PlaneGeometry(7.6, 1.5)
  const bannerMaterial = new THREE.MeshBasicMaterial({
    map: bannerTexture,
    transparent: true,
    side: THREE.DoubleSide,
  })
  // Hung on the approach face of the beam (runners come from -Z): the FINISH
  // legend reads during the run-in instead of hiding behind the crossbar.
  const banner = new THREE.Mesh(bannerGeometry, bannerMaterial)
  banner.position.set(
    course.finish.center.x,
    course.finish.center.y + 2.1,
    course.finish.center.z - 5.2,
  )
  // Face the legend toward the incoming runners, not away from them.
  banner.rotation.y = Math.PI
  group.add(beam, banner)
  return {
    group,
    beam,
    material,
    dispose: () => {
      bannerGeometry.dispose()
      bannerMaterial.dispose()
      bannerTexture.dispose()
    },
  }
}

function createBannerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = 1024
  canvas.height = 192
  const context = canvas.getContext("2d")
  if (context === null) throw new Error("2D canvas context unavailable for the finish banner")
  context.fillStyle = PALETTE.ink
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = PALETTE.finish
  for (let index = 0; index < 16; index += 1) {
    if (index % 2 === 0) context.fillRect(index * 64, 0, 64, 26)
    else context.fillRect(index * 64, canvas.height - 26, 64, 26)
  }
  context.fillStyle = "#FFFFFF"
  context.font = "700 104px system-ui, sans-serif"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText("FINISH", canvas.width / 2, canvas.height / 2 + 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
