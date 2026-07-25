/**
 * Third-person follow camera with exponential (frame-rate independent) damping
 * and velocity look-ahead — DESIGN.md section 5.
 */

import * as THREE from "three"
import { CAMERA } from "../shared/constants"
import type { MutVec3, Vec3 } from "../shared/types"

/** Frame-rate independent smoothing: fraction of the remaining gap to close this frame. */
const damp = (halfLife: number, dt: number): number => 1 - 2 ** (-dt / halfLife)

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera
  private readonly position = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly desiredTarget = new THREE.Vector3()
  private shake = 0
  private yaw = 0

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  /** Camera yaw in radians — movement input is expressed relative to this. */
  get cameraYaw(): number {
    return this.yaw
  }

  /** Places the camera behind the runner with no smoothing (race start, respawn). */
  snapTo(runnerPosition: Vec3, runnerYaw: number): void {
    this.yaw = runnerYaw
    this.desired.set(
      runnerPosition.x - Math.sin(runnerYaw) * CAMERA.distance,
      runnerPosition.y + CAMERA.height,
      runnerPosition.z - Math.cos(runnerYaw) * CAMERA.distance,
    )
    this.position.copy(this.desired)
    this.target.set(runnerPosition.x, runnerPosition.y + 1, runnerPosition.z)
    this.apply()
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount)
  }

  update(
    runnerPosition: MutVec3,
    runnerVelocity: MutVec3,
    orbitYaw: number,
    dt: number,
    reducedMotion: boolean,
  ): void {
    this.yaw = orbitYaw
    const lookAhead = CAMERA.lookAheadSec
    this.desired.set(
      runnerPosition.x - Math.sin(orbitYaw) * CAMERA.distance,
      runnerPosition.y + CAMERA.height,
      runnerPosition.z - Math.cos(orbitYaw) * CAMERA.distance,
    )
    this.desiredTarget.set(
      runnerPosition.x + runnerVelocity.x * lookAhead,
      runnerPosition.y + 1 + runnerVelocity.y * lookAhead * 0.35,
      runnerPosition.z + runnerVelocity.z * lookAhead,
    )

    this.position.lerp(this.desired, damp(CAMERA.positionHalfLife, dt))
    this.target.lerp(this.desiredTarget, damp(CAMERA.targetHalfLife, dt))

    if (this.shake > 0.001) {
      const magnitude = this.shake * (reducedMotion ? 0.25 : 0.5)
      this.position.x += (Math.random() - 0.5) * magnitude
      this.position.y += (Math.random() - 0.5) * magnitude
      this.shake *= 2 ** (-dt / 0.12)
    } else {
      this.shake = 0
    }

    this.apply()
  }

  private apply(): void {
    this.camera.position.copy(this.position)
    this.camera.lookAt(this.target)
  }
}
