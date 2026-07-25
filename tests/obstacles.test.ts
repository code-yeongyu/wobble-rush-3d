import { describe, expect, test } from "bun:test"
import {
  bumperSphereAt,
  moverBoxAt,
  moverVelocityAt,
  sweeperAngleAt,
  sweeperArmAt,
} from "../src/shared/obstacles"
import type { BumperSpec, MoverSpec, SweeperSpec, Vec3 } from "../src/shared/types"
import { asObstacleId, vec3 } from "../src/shared/types"

const EPS = 1e-9

const expectClose = (actual: number, expected: number, eps = EPS): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

const expectVecClose = (actual: Vec3, expected: Vec3, eps = EPS): void => {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(eps)
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(eps)
  expect(Math.abs(actual.z - expected.z)).toBeLessThan(eps)
}

const sweeper: SweeperSpec = {
  kind: "sweeper",
  id: asObstacleId("sw-test"),
  pivot: vec3(0, 1, 0),
  armLength: 4,
  armHalfThickness: 0.2,
  armHalfHeight: 0.5,
  angularVelocityDeg: 90,
  phaseDeg: 0,
  knockbackSpeed: 8,
  knockbackLift: 5,
  color: "red",
}

describe("sweeperAngleAt", () => {
  test("starts at phaseDeg and advances linearly with time", () => {
    expectClose(sweeperAngleAt(sweeper, 0), 0)
    expectClose(sweeperAngleAt(sweeper, 1), Math.PI / 2)
    expectClose(sweeperAngleAt(sweeper, 2), Math.PI)
  })

  test("respects a non-zero phaseDeg", () => {
    const phased: SweeperSpec = { ...sweeper, phaseDeg: 45 }
    expectClose(sweeperAngleAt(phased, 0), Math.PI / 4)
    expectClose(sweeperAngleAt(phased, 1), Math.PI / 4 + Math.PI / 2)
  })

  test("a full revolution returns to the start angle (mod 2*PI)", () => {
    const fast: SweeperSpec = { ...sweeper, angularVelocityDeg: 360 }
    const start = sweeperAngleAt(fast, 0)
    const end = sweeperAngleAt(fast, 1)
    const twoPi = Math.PI * 2
    const wrapped = (((end - start) % twoPi) + twoPi) % twoPi
    expect(wrapped).toBeLessThan(1e-9)
  })

  test("negative angular velocity sweeps backwards", () => {
    const reverse: SweeperSpec = { ...sweeper, angularVelocityDeg: -90 }
    expectClose(sweeperAngleAt(reverse, 1), -Math.PI / 2)
  })
})

describe("sweeperArmAt", () => {
  test("arm centre stays exactly armLength/2 from the pivot at all times", () => {
    for (const t of [0, 0.13, 0.5, 1, 2.7, 10, 123.456]) {
      const arm = sweeperArmAt(sweeper, t)
      const dist = Math.hypot(
        arm.center.x - sweeper.pivot.x,
        arm.center.y - sweeper.pivot.y,
        arm.center.z - sweeper.pivot.z,
      )
      expect(Math.abs(dist - sweeper.armLength / 2)).toBeLessThan(1e-9)
    }
  })

  test("arm yaw equals the sweep angle", () => {
    for (const t of [0, 0.5, 1, 3.33]) {
      const arm = sweeperArmAt(sweeper, t)
      expectClose(arm.yaw, sweeperAngleAt(sweeper, t))
    }
  })

  test("half extents are (armLength/2, armHalfHeight, armHalfThickness)", () => {
    const arm = sweeperArmAt(sweeper, 0)
    expectVecClose(arm.halfExtents, vec3(2, 0.5, 0.2))
  })

  test("at angle 0 the arm extends along +X from the pivot", () => {
    const arm = sweeperArmAt(sweeper, 0)
    expectVecClose(arm.center, vec3(2, 1, 0))
  })

  test("at angle PI/2 the arm extends along -Z from the pivot", () => {
    const arm = sweeperArmAt(sweeper, 1)
    expectVecClose(arm.center, vec3(0, 1, -2))
  })
})

const mover: MoverSpec = {
  kind: "mover",
  id: asObstacleId("mv-test"),
  from: vec3(0, 0, 0),
  to: vec3(10, 0, 0),
  halfExtents: vec3(1, 0.25, 1),
  travelSec: 2,
  dwellSec: 1,
  phaseSec: 0,
  color: "blue",
}

// full cycle = 2*2 + 2*1 = 6 s
describe("moverBoxAt", () => {
  test("starts at `from` at cycle start", () => {
    expectVecClose(moverBoxAt(mover, 0).center, vec3(0, 0, 0))
  })

  test("reaches `to` exactly at travelSec", () => {
    expectVecClose(moverBoxAt(mover, 2).center, vec3(10, 0, 0))
  })

  test("dwells at `to` through the dwell window", () => {
    for (const t of [2, 2.25, 2.5, 2.99]) {
      expectVecClose(moverBoxAt(mover, t).center, vec3(10, 0, 0))
    }
  })

  test("returns to `from` after the return travel and dwells there", () => {
    expectVecClose(moverBoxAt(mover, 5).center, vec3(0, 0, 0))
    for (const t of [5.25, 5.5, 5.99]) {
      expectVecClose(moverBoxAt(mover, t).center, vec3(0, 0, 0))
    }
  })

  test("wraps back to `from` at the end of the full cycle", () => {
    expectVecClose(moverBoxAt(mover, 6).center, vec3(0, 0, 0))
  })

  test("smoothstep easing puts the midpoint at half the travel time", () => {
    expectVecClose(moverBoxAt(mover, 1).center, vec3(5, 0, 0))
  })

  test("eases in: first quarter of travel covers less than half the distance", () => {
    const early = moverBoxAt(mover, 0.5).center.x
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(2.5)
  })

  test("phaseSec shifts the whole cycle", () => {
    const shifted: MoverSpec = { ...mover, phaseSec: 2 }
    expectVecClose(moverBoxAt(shifted, 0).center, moverBoxAt(mover, 2).center)
    expectVecClose(moverBoxAt(shifted, 1).center, moverBoxAt(mover, 3).center)
    expectVecClose(moverBoxAt(shifted, 3.5).center, moverBoxAt(mover, 5.5).center)
  })

  test("keeps the spec half extents and zero yaw", () => {
    const box = moverBoxAt(mover, 1)
    expectVecClose(box.halfExtents, vec3(1, 0.25, 1))
    expect(box.yaw).toBe(0)
  })
})

describe("moverVelocityAt", () => {
  test("is exactly zero during both dwell windows", () => {
    for (const t of [2.25, 2.5, 2.99, 5.25, 5.5, 5.99]) {
      const v = moverVelocityAt(mover, t)
      expect(v.x).toBe(0)
      expect(v.y).toBe(0)
      expect(v.z).toBe(0)
    }
  })

  test("matches the finite-difference derivative of moverBoxAt during travel", () => {
    const h = 1e-4
    for (const t of [0.3, 1, 1.7, 3.2, 3.6, 3.95]) {
      const analytic = moverVelocityAt(mover, t)
      const before = moverBoxAt(mover, t - h).center
      const after = moverBoxAt(mover, t + h).center
      const fd = vec3(
        (after.x - before.x) / (2 * h),
        (after.y - before.y) / (2 * h),
        (after.z - before.z) / (2 * h),
      )
      expect(Math.abs(analytic.x - fd.x)).toBeLessThan(1e-3)
      expect(Math.abs(analytic.y - fd.y)).toBeLessThan(1e-3)
      expect(Math.abs(analytic.z - fd.z)).toBeLessThan(1e-3)
    }
  })

  test("moves towards `to` on the outbound leg and back on the return leg", () => {
    expect(moverVelocityAt(mover, 1).x).toBeGreaterThan(0)
    expect(moverVelocityAt(mover, 3.5).x).toBeLessThan(0)
  })

  test("velocity is zero at the travel segment boundaries (smooth ease in/out)", () => {
    const atStart = moverVelocityAt(mover, 0)
    expect(Math.hypot(atStart.x, atStart.y, atStart.z)).toBeLessThan(1e-9)
  })
})

const bumper: BumperSpec = {
  kind: "bumper",
  id: asObstacleId("bp-test"),
  center: vec3(0, 1, 0),
  radius: 1,
  impulseSpeed: 10,
  impulseLift: 4,
  bobAmplitude: 0.3,
  bobPeriodSec: 2,
  color: "green",
}

describe("bumperSphereAt", () => {
  test("bobs between center.y +/- bobAmplitude", () => {
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * bumper.bobPeriodSec * 3
      const s = bumperSphereAt(bumper, t)
      expect(s.center.y).toBeGreaterThanOrEqual(bumper.center.y - bumper.bobAmplitude - 1e-9)
      expect(s.center.y).toBeLessThanOrEqual(bumper.center.y + bumper.bobAmplitude + 1e-9)
    }
  })

  test("hits the extremes at quarter and three-quarter period", () => {
    expectClose(bumperSphereAt(bumper, 0).center.y, 1)
    expectClose(bumperSphereAt(bumper, 0.5).center.y, 1.3)
    expectClose(bumperSphereAt(bumper, 1.5).center.y, 0.7)
  })

  test("repeats with the configured period", () => {
    for (const t of [0.1, 0.7, 1.3]) {
      expectClose(
        bumperSphereAt(bumper, t).center.y,
        bumperSphereAt(bumper, t + bumper.bobPeriodSec).center.y,
      )
    }
  })

  test("keeps xz position and radius fixed", () => {
    const s = bumperSphereAt(bumper, 0.5)
    expect(s.center.x).toBe(0)
    expect(s.center.z).toBe(0)
    expect(s.radius).toBe(1)
  })
})
