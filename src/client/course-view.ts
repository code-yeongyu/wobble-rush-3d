/**
 * Builds the course geometry and drives obstacle transforms from the shared
 * kinematics every frame, so what you see is exactly what the simulation collides with.
 */

import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { PALETTE } from "../shared/course"
import { bumperSphereAt, moverBoxAt, sweeperArmAt } from "../shared/obstacles"
import type { CourseDefinition, ObstacleSpec } from "../shared/types"
import { assertNever } from "../shared/types"
import { Backdrop } from "./backdrop"
import { boxMesh, buildCheckpointFlag, buildFinishGate, buildObstacle } from "./obstacle-meshes"
import { createVinyl } from "./scene-kit"

type Driven = { readonly spec: ObstacleSpec; readonly mesh: THREE.Object3D }

export class CourseView {
  readonly group = new THREE.Group()
  private readonly driven: Driven[] = []
  private readonly backdrop = new Backdrop()
  private readonly finishBeam: THREE.Mesh

  constructor(course: CourseDefinition) {
    for (const platform of course.platforms) {
      const material = createVinyl(platform.color, {
        roughness: platform.kind === "bridge" ? 0.3 : 0.34,
        clearcoat: 0.55,
      })
      const mesh = boxMesh(platform.box, material, 0.22)
      mesh.name = platform.id
      this.group.add(mesh)

      // A darker skirt under every deck reads as thickness and grounds the toy.
      const skirt = new THREE.Mesh(
        new RoundedBoxGeometry(
          platform.box.halfExtents.x * 1.94,
          0.9,
          platform.box.halfExtents.z * 1.94,
          2,
          0.12,
        ),
        createVinyl(PALETTE.ink, { roughness: 0.6, clearcoat: 0.1 }),
      )
      skirt.position.set(platform.box.center.x, platform.box.center.y - 0.55, platform.box.center.z)
      skirt.receiveShadow = true
      this.group.add(skirt)
    }

    for (const spec of course.obstacles) {
      const mesh = buildObstacle(spec)
      this.group.add(mesh)
      this.driven.push({ spec, mesh })
    }

    for (const checkpoint of course.checkpoints) {
      if (checkpoint.index === 0) continue
      this.group.add(buildCheckpointFlag(checkpoint.respawn.x, checkpoint.respawn.z))
    }

    const gate = buildFinishGate(course)
    this.finishBeam = gate.beam
    this.group.add(gate.group, this.backdrop.group)
  }

  update(timeSec: number, reducedMotion: boolean): void {
    for (const { spec, mesh } of this.driven) {
      switch (spec.kind) {
        case "sweeper": {
          const arm = mesh.getObjectByName(`${spec.id}-arm`)
          if (arm !== undefined) {
            const box = sweeperArmAt(spec, timeSec)
            arm.position.set(box.center.x, box.center.y, box.center.z)
            arm.rotation.y = box.yaw
          }
          break
        }
        case "mover": {
          const box = moverBoxAt(spec, timeSec)
          mesh.position.set(box.center.x, box.center.y, box.center.z)
          break
        }
        case "bumper": {
          const sphere = bumperSphereAt(spec, timeSec)
          mesh.position.set(sphere.center.x, sphere.center.y, sphere.center.z)
          break
        }
        default:
          assertNever(spec, "CourseView.update")
      }
    }
    this.finishBeam.position.y += Math.sin(timeSec * 2.4) * 0.0025
    this.backdrop.update(timeSec, reducedMotion)
  }
}
