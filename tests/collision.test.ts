import { describe, expect, test } from "bun:test"
import { closestPointOnBox, sphereVsBox, sphereVsSphere } from "../src/shared/collision"
import type { BoxCollider, Vec3 } from "../src/shared/types"
import { vec3 } from "../src/shared/types"

const EPS = 1e-9

const expectVecClose = (actual: Vec3, expected: Vec3, eps = EPS): void => {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(eps)
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(eps)
  expect(Math.abs(actual.z - expected.z)).toBeLessThan(eps)
}

const expectClose = (actual: number, expected: number, eps = EPS): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

const unitBox: BoxCollider = {
  center: vec3(0, 0, 0),
  halfExtents: vec3(1, 1, 1),
  yaw: 0,
}

describe("closestPointOnBox — axis-aligned", () => {
  const box: BoxCollider = {
    center: vec3(0, 0, 0),
    halfExtents: vec3(1, 2, 3),
    yaw: 0,
  }

  test("point outside clamps to the nearest face", () => {
    expectVecClose(closestPointOnBox(vec3(5, 0, 0), box), vec3(1, 0, 0))
    expectVecClose(closestPointOnBox(vec3(0, -9, 0), box), vec3(0, -2, 0))
    expectVecClose(closestPointOnBox(vec3(5, 9, -8), box), vec3(1, 2, -3))
  })

  test("point inside returns the point unchanged", () => {
    expectVecClose(closestPointOnBox(vec3(0.5, 1, -2), box), vec3(0.5, 1, -2))
  })

  test("point on the surface returns the point unchanged", () => {
    expectVecClose(closestPointOnBox(vec3(1, 0.5, 0), box), vec3(1, 0.5, 0))
  })

  test("respects the box centre offset", () => {
    const shifted: BoxCollider = {
      center: vec3(10, 0, 0),
      halfExtents: vec3(1, 1, 1),
      yaw: 0,
    }
    expectVecClose(closestPointOnBox(vec3(15, 0, 0), shifted), vec3(11, 0, 0))
  })
})

describe("closestPointOnBox — yaw-rotated", () => {
  // yaw = PI/2: local +X maps to world (0, 0, -1)
  const box: BoxCollider = {
    center: vec3(0, 0, 0),
    halfExtents: vec3(2, 1, 0.5),
    yaw: Math.PI / 2,
  }

  test("point outside along the rotated long axis clamps to the rotated face", () => {
    expectVecClose(closestPointOnBox(vec3(0, 0, -5), box), vec3(0, 0, -2))
  })

  test("diagonal point clamps per-axis in local space", () => {
    expectVecClose(closestPointOnBox(vec3(0.3, 0, -5), box), vec3(0.3, 0, -2))
  })

  test("point inside the rotated box returns unchanged", () => {
    expectVecClose(closestPointOnBox(vec3(0.2, 0.5, -1), box), vec3(0.2, 0.5, -1))
  })
})

describe("sphereVsBox", () => {
  test("clear miss: hit false, depth 0", () => {
    const result = sphereVsBox(vec3(5, 0, 0), 0.5, unitBox)
    expect(result.hit).toBe(false)
    expect(result.depth).toBe(0)
  })

  test("touching exactly at the surface is not a hit", () => {
    const result = sphereVsBox(vec3(1.5, 0, 0), 0.5, unitBox)
    expect(result.hit).toBe(false)
    expect(result.depth).toBe(0)
  })

  test("face hit: outward normal and correct depth", () => {
    const result = sphereVsBox(vec3(1.4, 0, 0), 0.5, unitBox)
    expect(result.hit).toBe(true)
    expectVecClose(result.normal, vec3(1, 0, 0))
    expectClose(result.depth, 0.1)
    expectVecClose(result.point, vec3(1, 0, 0))
  })

  test("glancing corner hit: normal points diagonally outward", () => {
    const result = sphereVsBox(vec3(1.3, 1.3, 0), 0.5, unitBox)
    expect(result.hit).toBe(true)
    const inv = 1 / Math.sqrt(2)
    expectVecClose(result.normal, vec3(inv, inv, 0))
    expectClose(result.depth, 0.5 - Math.sqrt(0.18))
    expectVecClose(result.point, vec3(1, 1, 0))
  })

  test("deep overlap with centre inside pushes along least-penetration axis", () => {
    // centre 0.5 deep in x, 1.0 in y, 1.0 in z -> escape along +x
    const result = sphereVsBox(vec3(0.5, 0, 0), 0.5, unitBox)
    expect(result.hit).toBe(true)
    expectVecClose(result.normal, vec3(1, 0, 0))
    // 0.5 to escape the box interior + 0.5 radius to clear the face
    expectClose(result.depth, 1.0)
    expectVecClose(result.point, vec3(1, 0, 0))
  })

  test("centre at the exact box centre still produces a unit normal", () => {
    const result = sphereVsBox(vec3(0, 0, 0), 0.5, unitBox)
    expect(result.hit).toBe(true)
    const len = Math.hypot(result.normal.x, result.normal.y, result.normal.z)
    expectClose(len, 1)
    expectClose(result.depth, 1.5)
  })

  test("rotated box hit: normal is expressed in world space", () => {
    const box: BoxCollider = {
      center: vec3(0, 0, 0),
      halfExtents: vec3(2, 1, 0.5),
      yaw: Math.PI / 2,
    }
    // local +X (length 2) points along world -Z
    const result = sphereVsBox(vec3(0, 0, -2.4), 0.5, box)
    expect(result.hit).toBe(true)
    expectVecClose(result.normal, vec3(0, 0, -1))
    expectClose(result.depth, 0.1)
    expectVecClose(result.point, vec3(0, 0, -2))
  })

  test("rotated box miss along the short axis", () => {
    const box: BoxCollider = {
      center: vec3(0, 0, 0),
      halfExtents: vec3(2, 1, 0.5),
      yaw: Math.PI / 2,
    }
    // local +Z (length 0.5) points along world +X
    const result = sphereVsBox(vec3(1.2, 0, 0), 0.5, box)
    expect(result.hit).toBe(false)
    expect(result.depth).toBe(0)
  })
})

describe("sphereVsSphere", () => {
  test("clear miss", () => {
    const result = sphereVsSphere(vec3(0, 0, 0), 1, vec3(3, 0, 0), 1)
    expect(result.hit).toBe(false)
    expect(result.depth).toBe(0)
  })

  test("overlap: normal from b toward a, depth is the overlap", () => {
    const result = sphereVsSphere(vec3(0, 0, 0), 1, vec3(1.5, 0, 0), 1)
    expect(result.hit).toBe(true)
    expectVecClose(result.normal, vec3(-1, 0, 0))
    expectClose(result.depth, 0.5)
  })

  test("concentric spheres produce a unit normal and full overlap depth", () => {
    const result = sphereVsSphere(vec3(1, 1, 1), 0.5, vec3(1, 1, 1), 0.5)
    expect(result.hit).toBe(true)
    const len = Math.hypot(result.normal.x, result.normal.y, result.normal.z)
    expectClose(len, 1)
    expectClose(result.depth, 1)
  })
})
