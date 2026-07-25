/**
 * Builds the course geometry and drives obstacle transforms from the shared
 * kinematics every frame, so what you see is exactly what the simulation
 * collides with. Static decks merge into one mesh per look; repeated
 * obstacles render instanced; everything shares cached vinyl materials.
 */

import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { PALETTE } from "../shared/course"
import { bumperSphereAt, moverBoxAt, sweeperArmAt } from "../shared/obstacles"
import type { BumperSpec, CourseDefinition, Platform, SweeperSpec } from "../shared/types"
import { Backdrop } from "./backdrop"
import { buildCheckpointFlags, buildFinishGate, type FinishGate } from "./course-furniture"
import {
  type BumperSet,
  buildBumperSet,
  buildMover,
  buildSweeper,
  buildSweeperHubs,
  type MoverMesh,
  type SweeperMesh,
} from "./obstacle-meshes"
import { GeometryCache, VinylCache } from "./render-cache"

export class CourseView {
  readonly group = new THREE.Group()
  private readonly vinyl = new VinylCache()
  private readonly geometry = new GeometryCache()
  private readonly mergedGeometries: THREE.BufferGeometry[] = []
  private readonly sweepers: SweeperMesh[] = []
  private readonly movers: MoverMesh[] = []
  private readonly bumpers: BumperSet
  private readonly backdrop = new Backdrop()
  private readonly finish: FinishGate
  private readonly finishBeamBaseY: number
  private readonly scratchMatrix = new THREE.Matrix4()
  private readonly ringMatrix = new THREE.Matrix4()

  constructor(course: CourseDefinition) {
    this.buildDecks(course.platforms)

    const bumperSpecs: BumperSpec[] = []
    const sweeperSpecs: SweeperSpec[] = []
    for (const spec of course.obstacles) {
      if (spec.kind === "bumper") {
        bumperSpecs.push(spec)
      } else if (spec.kind === "sweeper") {
        sweeperSpecs.push(spec)
        const sweeper = buildSweeper(spec, this.tools())
        this.group.add(sweeper.group)
        this.sweepers.push(sweeper)
      } else {
        const mover = buildMover(spec, this.tools())
        this.group.add(mover.mesh)
        this.movers.push(mover)
      }
    }
    this.group.add(buildSweeperHubs(sweeperSpecs, this.tools()))
    this.bumpers = buildBumperSet(bumperSpecs, this.tools())
    this.group.add(this.bumpers.group)

    this.group.add(
      buildCheckpointFlags(
        course.checkpoints
          .filter((checkpoint) => checkpoint.index !== 0)
          .map((checkpoint) => ({
            x: checkpoint.respawn.x,
            z: checkpoint.respawn.z,
            bounds: {
              minX: checkpoint.trigger.center.x - checkpoint.trigger.halfExtents.x,
              maxX: checkpoint.trigger.center.x + checkpoint.trigger.halfExtents.x,
              minZ: checkpoint.trigger.center.z - checkpoint.trigger.halfExtents.z,
              maxZ: checkpoint.trigger.center.z + checkpoint.trigger.halfExtents.z,
            },
          })),
        this.tools(),
      ),
    )

    this.finish = buildFinishGate(course, this.tools())
    this.finishBeamBaseY = this.finish.beam.position.y
    this.group.add(this.finish.group, this.backdrop.group)
  }

  private tools(): { vinyl: VinylCache; geometry: GeometryCache } {
    return { vinyl: this.vinyl, geometry: this.geometry }
  }

  /** Decks are static: merge every slab sharing a look into a single mesh. */
  private buildDecks(platforms: readonly Platform[]): void {
    const buckets = new Map<string, { material: THREE.Material; parts: THREE.BufferGeometry[] }>()
    const skirtParts: THREE.BufferGeometry[] = []
    for (const platform of platforms) {
      // Decks are the calm surface: matte enough that the sun does not blow a
      // white hotspot across them. Gloss is reserved for hazards, so "shiny"
      // always means "this one moves and hurts".
      const roughness = platform.kind === "bridge" ? 0.5 : 0.56
      const key = `${platform.color}|${roughness}`
      let bucket = buckets.get(key)
      if (bucket === undefined) {
        bucket = {
          material: this.vinyl.get(platform.color, {
            roughness,
            clearcoat: 0.12,
            clearcoatRoughness: 0.5,
          }),
          parts: [],
        }
        buckets.set(key, bucket)
      }
      const deck = new RoundedBoxGeometry(
        platform.box.halfExtents.x * 2,
        platform.box.halfExtents.y * 2,
        platform.box.halfExtents.z * 2,
        3,
        Math.min(0.22, platform.box.halfExtents.x, platform.box.halfExtents.y),
      )
      deck.rotateY(platform.box.yaw)
      deck.translate(platform.box.center.x, platform.box.center.y, platform.box.center.z)
      bucket.parts.push(deck)

      // A darker skirt under every deck reads as thickness and grounds the toy.
      const skirt = new RoundedBoxGeometry(
        platform.box.halfExtents.x * 1.94,
        0.9,
        platform.box.halfExtents.z * 1.94,
        2,
        0.12,
      )
      skirt.rotateY(platform.box.yaw)
      skirt.translate(platform.box.center.x, platform.box.center.y - 0.55, platform.box.center.z)
      skirtParts.push(skirt)
    }
    for (const bucket of buckets.values()) {
      const merged = mergeGeometries(bucket.parts)
      for (const part of bucket.parts) part.dispose()
      const mesh = new THREE.Mesh(merged, bucket.material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.group.add(mesh)
      this.mergedGeometries.push(merged)
    }
    const skirts = mergeGeometries(skirtParts)
    for (const part of skirtParts) part.dispose()
    const skirtMesh = new THREE.Mesh(
      skirts,
      this.vinyl.get(PALETTE.ink, { roughness: 0.6, clearcoat: 0.1 }),
    )
    skirtMesh.receiveShadow = true
    this.group.add(skirtMesh)
    this.mergedGeometries.push(skirts)
  }

  update(timeSec: number, reducedMotion: boolean): void {
    for (const { spec, arm } of this.sweepers) {
      const box = sweeperArmAt(spec, timeSec)
      arm.position.set(box.center.x, box.center.y, box.center.z)
      arm.rotation.y = box.yaw
    }
    for (const { spec, mesh } of this.movers) {
      const box = moverBoxAt(spec, timeSec)
      mesh.position.set(box.center.x, box.center.y, box.center.z)
    }
    for (const entry of this.bumpers.entries) {
      const sphere = bumperSphereAt(entry.spec, timeSec)
      this.scratchMatrix.makeTranslation(sphere.center.x, sphere.center.y, sphere.center.z)
      entry.domes.setMatrixAt(entry.index, this.scratchMatrix)
      this.ringMatrix
        .makeRotationX(Math.PI / 2)
        .setPosition(sphere.center.x, sphere.center.y + entry.spec.radius * 0.34, sphere.center.z)
      entry.rings.setMatrixAt(entry.index, this.ringMatrix)
    }
    for (const mesh of this.bumpers.instanced) mesh.instanceMatrix.needsUpdate = true

    // Finish gate presence: a gentle bob plus the 1.6 s emissive pulse DESIGN.md asks for.
    this.finish.beam.position.y = this.finishBeamBaseY + Math.sin(timeSec * 2.4) * 0.05
    this.finish.material.emissiveIntensity = 0.35 + 0.12 * Math.sin((timeSec * Math.PI * 2) / 1.6)

    this.backdrop.update(timeSec, reducedMotion)
  }

  dispose(): void {
    for (const geometry of this.mergedGeometries) geometry.dispose()
    this.finish.dispose()
    this.backdrop.dispose()
    this.vinyl.dispose()
    this.geometry.dispose()
  }
}
