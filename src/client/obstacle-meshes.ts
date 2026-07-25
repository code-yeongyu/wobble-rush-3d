/** Mesh builders for every obstacle archetype and the course furniture. */

import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { PALETTE } from "../shared/course"
import { moverBoxAt, sweeperArmAt } from "../shared/obstacles"
import type {
  BoxCollider,
  BumperSpec,
  CourseDefinition,
  MoverSpec,
  ObstacleSpec,
  SweeperSpec,
} from "../shared/types"
import { assertNever } from "../shared/types"
import { createVinyl } from "./scene-kit"

export function boxMesh(box: BoxCollider, material: THREE.Material, radius = 0.14): THREE.Mesh {
  const geometry = new RoundedBoxGeometry(
    box.halfExtents.x * 2,
    box.halfExtents.y * 2,
    box.halfExtents.z * 2,
    3,
    Math.min(radius, box.halfExtents.x, box.halfExtents.y, box.halfExtents.z),
  )
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(box.center.x, box.center.y, box.center.z)
  mesh.rotation.y = box.yaw
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function buildObstacle(spec: ObstacleSpec): THREE.Object3D {
  switch (spec.kind) {
    case "sweeper":
      return buildSweeper(spec)
    case "mover":
      return buildMover(spec)
    case "bumper":
      return buildBumper(spec)
    default:
      return assertNever(spec, "buildObstacle")
  }
}

function buildSweeper(spec: SweeperSpec): THREE.Object3D {
  const group = new THREE.Group()
  const arm = boxMesh(
    sweeperArmAt(spec, 0),
    createVinyl(spec.color, {
      roughness: 0.22,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
      emissiveIntensity: 0.28,
    }),
    0.18,
  )
  arm.name = `${spec.id}-arm`
  group.add(arm)

  // Caution striping: the hazard reads as dangerous even in peripheral vision.
  for (let index = 0; index < 3; index += 1) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, spec.armHalfHeight * 2.06, spec.armHalfThickness * 2.08),
      createVinyl(PALETTE.hazardStripe, { roughness: 0.25, clearcoat: 0.8 }),
    )
    stripe.position.x = -spec.armLength * 0.28 + index * spec.armLength * 0.28
    arm.add(stripe)
  }

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.5, spec.pivot.y + 0.7, 20),
    createVinyl(PALETTE.ink, { roughness: 0.45 }),
  )
  hub.position.set(spec.pivot.x, (spec.pivot.y - 0.7) / 2, spec.pivot.z)
  hub.castShadow = true
  group.add(hub)
  return group
}

function buildMover(spec: MoverSpec): THREE.Object3D {
  const mesh = boxMesh(
    moverBoxAt(spec, 0),
    createVinyl(spec.color, { roughness: 0.3, clearcoat: 0.7 }),
    0.2,
  )
  mesh.name = `${spec.id}-deck`
  const rail = new THREE.Mesh(
    new THREE.TorusGeometry(Math.max(spec.halfExtents.x, spec.halfExtents.z) * 0.92, 0.07, 8, 28),
    createVinyl(PALETTE.hazardStripe, { roughness: 0.3 }),
  )
  rail.rotation.x = Math.PI / 2
  rail.position.y = spec.halfExtents.y + 0.02
  mesh.add(rail)
  return mesh
}

function buildBumper(spec: BumperSpec): THREE.Object3D {
  const group = new THREE.Group()
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(spec.radius, 28, 20),
    createVinyl(spec.color, {
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      sheen: 0.35,
    }),
  )
  dome.castShadow = true
  dome.name = `${spec.id}-dome`
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(spec.radius * 0.82, spec.radius * 0.12, 10, 30),
    createVinyl(PALETTE.hazardStripe, { roughness: 0.25, clearcoat: 0.85 }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = spec.radius * 0.34
  dome.add(ring)
  group.add(dome)
  return group
}

export function buildCheckpointFlag(x: number, z: number): THREE.Object3D {
  const group = new THREE.Group()
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 3, 12),
    createVinyl(PALETTE.ink, { roughness: 0.5 }),
  )
  pole.position.y = 1.5
  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.66, 0.06),
    createVinyl(PALETTE.deckRest, { roughness: 0.25, clearcoat: 0.9, emissiveIntensity: 0.25 }),
  )
  flag.position.set(0.6, 2.6, 0)
  group.add(pole, flag)
  group.position.set(x - 3.4, 0, z)
  return group
}

export type FinishGate = { readonly group: THREE.Group; readonly beam: THREE.Mesh }

export function buildFinishGate(course: CourseDefinition): FinishGate {
  const group = new THREE.Group()
  const material = createVinyl(PALETTE.finish, {
    roughness: 0.25,
    metalness: 0.15,
    clearcoat: 0.9,
    emissiveIntensity: 0.35,
  })
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 5.4, 16), material)
    post.position.set(
      course.finish.center.x + side * 4.2,
      course.finish.center.y - 0.6,
      course.finish.center.z - 4.6,
    )
    post.castShadow = true
    group.add(post)
  }
  const beam = new THREE.Mesh(new RoundedBoxGeometry(9.4, 1.1, 0.9, 3, 0.3), material)
  beam.position.set(
    course.finish.center.x,
    course.finish.center.y + 2.1,
    course.finish.center.z - 4.6,
  )
  beam.castShadow = true
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 1.5),
    new THREE.MeshBasicMaterial({
      map: createBannerTexture(),
      transparent: true,
      side: THREE.DoubleSide,
    }),
  )
  banner.position.set(
    course.finish.center.x,
    course.finish.center.y + 2.1,
    course.finish.center.z - 4.1,
  )
  group.add(beam, banner)
  return { group, beam }
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
