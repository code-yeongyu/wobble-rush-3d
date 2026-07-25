/**
 * Pure orbit-camera math: exponential damping, angle wrapping and the
 * manual-drag / auto-follow state machine. No DOM and no THREE, so every
 * behaviour here is unit-tested in tests/camera-follow.test.ts.
 *
 * The one rule that keeps movement honest: auto-follow only eases toward
 * headings inside a narrow cone around camera-forward. Strafe, diagonal and
 * backpedal headings sit outside the cone, so the frame a held key is
 * expressed in never rotates under the runner — straight keys, straight travel.
 */

import { CAMERA } from "../shared/constants"

/** Frame-rate independent smoothing: fraction of the remaining gap to close this frame. */
export const damp = (halfLife: number, dt: number): number => 1 - 2 ** (-dt / halfLife)

/** Smallest signed angle from `from` to `to`, wrapped to [-PI, PI]. */
export const shortestAngle = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from))

/** Full orbit state: yaw/pitch plus the timer that suspends auto-follow after a drag. */
export type OrbitState = {
  readonly yaw: number
  readonly pitch: number
  readonly followCooldownSec: number
}

/** Orbit delta accumulated from pointer drags since the last frame. */
export type OrbitDelta = {
  readonly yaw: number
  readonly pitch: number
}

/** Horizontal velocity, the only part of motion the orbit ever reads. */
export type PlanarVelocity = {
  readonly x: number
  readonly z: number
}

/** Rest pitch: the angle implied by CAMERA.distance and CAMERA.height. */
export const DEFAULT_PITCH = Math.atan2(CAMERA.height, CAMERA.distance)

/** Fresh orbit behind the runner (race start, respawn). */
export const createOrbit = (yaw: number): OrbitState => ({
  yaw,
  pitch: DEFAULT_PITCH,
  followCooldownSec: 0,
})

/** Keeps the camera between nearly-level and looking-down, never under the deck. */
export const clampPitch = (pitch: number): number =>
  Math.min(CAMERA.maxPitch, Math.max(CAMERA.minPitch, pitch))

/** A pointer drag wins immediately and suspends auto-follow for a beat. */
export const applyManualOrbit = (
  orbit: OrbitState,
  deltaYaw: number,
  deltaPitch: number,
): OrbitState => ({
  yaw: orbit.yaw + deltaYaw,
  pitch: clampPitch(orbit.pitch + deltaPitch),
  followCooldownSec: CAMERA.manualFollowDelaySec,
})

/**
 * One frame of auto-follow: the cooldown ticks down, then — only while the
 * runner moves fast enough and roughly forward relative to the camera — the
 * yaw eases toward the heading with frame-rate independent damping.
 */
export const advanceOrbit = (
  orbit: OrbitState,
  velocity: PlanarVelocity,
  dt: number,
): OrbitState => {
  const cooldown = Math.max(0, orbit.followCooldownSec - dt)
  const resting: OrbitState = { yaw: orbit.yaw, pitch: orbit.pitch, followCooldownSec: cooldown }
  if (cooldown > 0) return resting
  const speed = Math.hypot(velocity.x, velocity.z)
  if (speed < CAMERA.followMinSpeed) return resting
  const delta = shortestAngle(orbit.yaw, Math.atan2(velocity.x, velocity.z))
  if (Math.abs(delta) > CAMERA.followConeRad) return resting
  return {
    yaw: orbit.yaw + delta * damp(CAMERA.followHalfLife, dt),
    pitch: orbit.pitch,
    followCooldownSec: 0,
  }
}

/** One frame of orbit: a drag (if any) takes over, then auto-follow may ease. */
export const updateOrbit = (
  orbit: OrbitState,
  drag: OrbitDelta,
  velocity: PlanarVelocity,
  dt: number,
): OrbitState => {
  const base =
    drag.yaw !== 0 || drag.pitch !== 0 ? applyManualOrbit(orbit, drag.yaw, drag.pitch) : orbit
  return advanceOrbit(base, velocity, dt)
}
