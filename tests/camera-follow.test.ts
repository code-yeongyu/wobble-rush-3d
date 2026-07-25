import { describe, expect, test } from "bun:test"
import * as THREE from "three"
import {
  advanceOrbit,
  applyManualOrbit,
  createOrbit,
  DEFAULT_PITCH,
  damp,
  shortestAngle,
  updateOrbit,
} from "../src/client/camera-math"
import { CameraRig } from "../src/client/camera-rig"
import { CAMERA, RUNNER } from "../src/shared/constants"
import { vec3 } from "../src/shared/types"

const FORWARD_SPEED = RUNNER.runSpeed

/** Advances the orbit for `seconds` in `dt` slices and returns the final state. */
function orbitAfter(
  seconds: number,
  dt: number,
  velocity: { readonly x: number; readonly z: number },
  start = createOrbit(0),
) {
  let orbit = start
  for (let t = 0; t < seconds; t += dt) orbit = advanceOrbit(orbit, velocity, dt)
  return orbit
}

describe("damp", () => {
  test("closes exactly half the gap after one half-life", () => {
    expect(damp(0.3, 0.3)).toBeCloseTo(0.5, 10)
  })

  test("is frame-rate independent: two half steps equal one full step", () => {
    const halfLife = 0.25
    const dt = 1 / 60
    const oneStep = damp(halfLife, dt * 2)
    const twoSteps = 1 - (1 - damp(halfLife, dt)) ** 2
    expect(twoSteps).toBeCloseTo(oneStep, 10)
  })
})

describe("shortestAngle", () => {
  test("wraps across the PI seam instead of going the long way", () => {
    const delta = shortestAngle(3.0, -3.0)
    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeCloseTo(Math.PI * 2 - 6, 5)
  })

  test("returns the plain delta when no wrap is needed", () => {
    expect(shortestAngle(0, 0.5)).toBeCloseTo(0.5, 10)
    expect(shortestAngle(0.2, -0.4)).toBeCloseTo(-0.6, 10)
  })
})

describe("createOrbit", () => {
  test("starts behind the runner at the rest pitch with auto-follow armed", () => {
    const orbit = createOrbit(1.2)
    expect(orbit.yaw).toBe(1.2)
    expect(orbit.pitch).toBeCloseTo(Math.atan2(CAMERA.height, CAMERA.distance), 10)
    expect(orbit.pitch).toBe(DEFAULT_PITCH)
    expect(orbit.followCooldownSec).toBe(0)
  })
})

describe("advanceOrbit — the camera-follow feedback loop", () => {
  test("holding strafe only: pure sideways velocity never rotates the orbit yaw", () => {
    const orbit = orbitAfter(4, 1 / 60, { x: FORWARD_SPEED, z: 0 })
    expect(orbit.yaw).toBe(0)
  })

  test("holding back only: velocity toward the camera never whips the orbit 180°", () => {
    const orbit = orbitAfter(3, 1 / 60, { x: 0, z: -FORWARD_SPEED })
    expect(orbit.yaw).toBe(0)
  })

  test("holding a diagonal: 45° velocity sits outside the follow cone, yaw stays put", () => {
    const diagonal = FORWARD_SPEED / Math.SQRT2
    const orbit = orbitAfter(4, 1 / 60, { x: diagonal, z: diagonal })
    expect(orbit.yaw).toBe(0)
  })

  test("roughly forward velocity inside the cone is followed until aligned", () => {
    const heading = CAMERA.followConeRad - 0.2
    const velocity = {
      x: Math.sin(heading) * FORWARD_SPEED,
      z: Math.cos(heading) * FORWARD_SPEED,
    }
    const orbit = orbitAfter(4, 1 / 60, velocity)
    expect(orbit.yaw).toBeGreaterThan(0)
    expect(orbit.yaw).toBeCloseTo(heading, 2)
  })

  test("a heading just outside the cone is never followed", () => {
    const heading = CAMERA.followConeRad + 0.05
    const velocity = {
      x: Math.sin(heading) * FORWARD_SPEED,
      z: Math.cos(heading) * FORWARD_SPEED,
    }
    expect(orbitAfter(4, 1 / 60, velocity).yaw).toBe(0)
  })

  test("follow converges without overshoot and never past the heading", () => {
    const heading = 0.3
    const velocity = {
      x: Math.sin(heading) * FORWARD_SPEED,
      z: Math.cos(heading) * FORWARD_SPEED,
    }
    let orbit = createOrbit(0)
    for (let step = 0; step < 600; step += 1) {
      orbit = advanceOrbit(orbit, velocity, 1 / 60)
      expect(orbit.yaw).toBeLessThanOrEqual(heading + 1e-9)
    }
    expect(orbit.yaw).toBeCloseTo(heading, 3)
  })

  test("follow is frame-rate independent: 60 Hz and 17 Hz land on the same yaw", () => {
    const heading = 0.35
    const velocity = {
      x: Math.sin(heading) * FORWARD_SPEED,
      z: Math.cos(heading) * FORWARD_SPEED,
    }
    const smooth = orbitAfter(1, 1 / 60, velocity)
    const choppy = orbitAfter(1, 1 / 17, velocity)
    expect(smooth.yaw).toBeCloseTo(choppy.yaw, 2)
  })

  test("below the minimum follow speed the orbit does not rotate", () => {
    const orbit = orbitAfter(2, 1 / 60, { x: CAMERA.followMinSpeed * 0.5, z: 0 })
    expect(orbit.yaw).toBe(0)
  })
})

describe("manual orbit vs auto-follow", () => {
  test("a drag applies immediately and arms the auto-follow cooldown", () => {
    const orbit = applyManualOrbit(createOrbit(0.4), 0.25, 0.1)
    expect(orbit.yaw).toBeCloseTo(0.65, 10)
    expect(orbit.pitch).toBeCloseTo(DEFAULT_PITCH + 0.1, 10)
    expect(orbit.followCooldownSec).toBe(CAMERA.manualFollowDelaySec)
  })

  test("pitch is clamped to the CAMERA range no matter how hard the drag", () => {
    expect(applyManualOrbit(createOrbit(0), 0, 100).pitch).toBe(CAMERA.maxPitch)
    expect(applyManualOrbit(createOrbit(0), 0, -100).pitch).toBe(CAMERA.minPitch)
  })

  test("during the cooldown auto-follow stays silent even for forward headings", () => {
    const heading = 0.3
    const velocity = {
      x: Math.sin(heading) * FORWARD_SPEED,
      z: Math.cos(heading) * FORWARD_SPEED,
    }
    const dragged = applyManualOrbit(createOrbit(0), 0.5, 0)
    const orbit = orbitAfter(0.5, 1 / 60, velocity, dragged)
    expect(orbit.yaw).toBeCloseTo(0.5, 10)
  })

  test("auto-follow resumes once the cooldown has elapsed", () => {
    const heading = 0.3
    const velocity = {
      x: Math.sin(heading) * FORWARD_SPEED,
      z: Math.cos(heading) * FORWARD_SPEED,
    }
    const dragged = applyManualOrbit(createOrbit(0), 0.1, 0)
    const orbit = orbitAfter(CAMERA.manualFollowDelaySec + 2, 1 / 60, velocity, dragged)
    expect(orbit.yaw).toBeCloseTo(heading, 2)
  })

  test("updateOrbit with no drag behaves like plain auto-follow", () => {
    const heading = 0.3
    const velocity = {
      x: Math.sin(heading) * FORWARD_SPEED,
      z: Math.cos(heading) * FORWARD_SPEED,
    }
    let orbit = createOrbit(0)
    for (let step = 0; step < 240; step += 1)
      orbit = updateOrbit(orbit, { yaw: 0, pitch: 0 }, velocity, 1 / 60)
    expect(orbit.yaw).toBeCloseTo(heading, 2)
  })

  test("updateOrbit applies a drag and suppresses follow for that frame", () => {
    const heading = 0.3
    const velocity = {
      x: Math.sin(heading) * FORWARD_SPEED,
      z: Math.cos(heading) * FORWARD_SPEED,
    }
    const orbit = updateOrbit(createOrbit(0), { yaw: -0.4, pitch: 0 }, velocity, 1 / 60)
    expect(orbit.yaw).toBeCloseTo(-0.4, 10)
  })
})

describe("CameraRig geometry", () => {
  test("snapTo places the camera CAMERA.distance behind and CAMERA.height above the runner", () => {
    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far)
    const rig = new CameraRig(camera)
    rig.snapTo(vec3(2, 1, 10), Math.PI / 6)
    const dx = camera.position.x - 2
    const dy = camera.position.y - 1
    const dz = camera.position.z - 10
    expect(dy).toBeCloseTo(CAMERA.height, 5)
    expect(Math.hypot(dx, dz)).toBeCloseTo(CAMERA.distance, 5)
    // Directly behind the facing: offset opposes (sin(yaw), cos(yaw)).
    const behindX = -Math.sin(Math.PI / 6)
    const behindZ = -Math.cos(Math.PI / 6)
    expect(dx / CAMERA.distance).toBeCloseTo(behindX, 5)
    expect(dz / CAMERA.distance).toBeCloseTo(behindZ, 5)
  })
})
