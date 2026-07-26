/**
 * Third-person follow camera with exponential (frame-rate independent) damping
 * and velocity look-ahead — DESIGN.md section 5.
 *
 * The rig is a dumb smoother: orbit state (yaw/pitch, manual-vs-follow rules)
 * lives in the pure, unit-tested camera-math module; this class only turns an
 * OrbitState into a smoothed camera transform each frame.
 */

import * as THREE from "three"
import { CAMERA } from "../shared/constants"
import type { MutVec3, Vec3 } from "../shared/types"
import { DEFAULT_PITCH, damp, type OrbitState } from "./camera-math"

/** Full 3D orbit radius: CAMERA.distance/height define the rest pose. */
const ORBIT_RADIUS = Math.hypot(CAMERA.distance, CAMERA.height)

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera
  private readonly position = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly desiredTarget = new THREE.Vector3()
  private shake = 0

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  /** Places the camera behind the runner with no smoothing (race start, respawn). */
  snapTo(runnerPosition: Vec3, runnerYaw: number): void {
    this.desiredFrom(runnerPosition, runnerYaw, DEFAULT_PITCH)
    this.position.copy(this.desired)
    this.target.set(runnerPosition.x, runnerPosition.y + 1, runnerPosition.z)
    this.apply()
  }

  addShake(amount: number): void {
    // A burst of stacked hits must not pile into nausea: only a shake stronger
    // than what is already playing raises the envelope, so N identical calls
    // inside one impact read as ONE shake.
    this.shake = Math.min(1, Math.max(this.shake, amount))
  }

  update(
    runnerPosition: MutVec3,
    runnerVelocity: MutVec3,
    orbit: OrbitState,
    dt: number,
    reducedMotion: boolean,
  ): void {
    this.desiredFrom(runnerPosition, orbit.yaw, orbit.pitch)
    const lookAhead = CAMERA.lookAheadSec
    this.desiredTarget.set(
      runnerPosition.x + runnerVelocity.x * lookAhead,
      runnerPosition.y + 1 + runnerVelocity.y * lookAhead * 0.35,
      runnerPosition.z + runnerVelocity.z * lookAhead,
    )

    this.position.lerp(this.desired, damp(CAMERA.positionHalfLife, dt))
    this.target.lerp(this.desiredTarget, damp(CAMERA.targetHalfLife, dt))

    if (this.shake > 0.01) {
      const magnitude = this.shake * (reducedMotion ? 0.25 : 0.5)
      this.position.x += (Math.random() - 0.5) * magnitude
      this.position.y += (Math.random() - 0.5) * magnitude
      // Half-life ~85 ms: a full 0.6 hit settles under the cutoff in ~0.5 s,
      // inside the 600 ms motion ceiling. Reduced motion still halves it.
      this.shake *= 2 ** (-dt / 0.085)
    } else {
      this.shake = 0
    }

    this.apply()
  }

  /** Spherical offset behind the runner: `yaw` around, `pitch` above the deck. */
  private desiredFrom(runnerPosition: Vec3, yaw: number, pitch: number): void {
    const horizontal = Math.cos(pitch) * ORBIT_RADIUS
    this.desired.set(
      runnerPosition.x - Math.sin(yaw) * horizontal,
      runnerPosition.y + Math.sin(pitch) * ORBIT_RADIUS,
      runnerPosition.z - Math.cos(yaw) * horizontal,
    )
  }

  private apply(): void {
    this.camera.position.copy(this.position)
    this.camera.lookAt(this.target)
  }
}
