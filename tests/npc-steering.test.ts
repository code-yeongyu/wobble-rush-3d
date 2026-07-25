import { describe, expect, test } from "bun:test"
import { npcInput } from "../src/shared/npc"
import { vec3 } from "../src/shared/types"
import { makeCourse, makeNpc, makeSim, makeWorld, STEP } from "./support/npc-fixtures"

describe("npcInput steering", () => {
  const world = makeWorld()

  test("steers straight at a waypoint directly ahead (+Z)", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const input = npcInput(npc, sim, makeCourse([vec3(0, 0, 10)]), world, 0)
    expect(input.forward).toBeCloseTo(1, 5)
    expect(input.strafe).toBeCloseTo(0, 5)
    expect(input.cameraYaw).toBe(0)
  })

  // strafe is camera-relative and cameraYaw is 0 for NPCs, so the camera's
  // right-hand axis is -X: a waypoint at +X is reached with NEGATIVE strafe.
  // tests/strafe-orientation.test.ts proves the NPC really closes the distance.
  test("steers with full strafe toward a waypoint on the +X side", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const input = npcInput(npc, sim, makeCourse([vec3(10, 0, 0)]), world, 0)
    expect(input.strafe).toBeCloseTo(-1, 5)
    expect(input.forward).toBeCloseTo(0, 5)
  })

  test("steers diagonally with normalized components", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const input = npcInput(npc, sim, makeCourse([vec3(3, 0, 4)]), world, 0)
    expect(input.strafe).toBeCloseTo(-0.6, 5)
    expect(input.forward).toBeCloseTo(0.8, 5)
  })

  test("steers backwards for a waypoint behind and to the -X side", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const input = npcInput(npc, sim, makeCourse([vec3(-6, 0, -8)]), world, 0)
    expect(input.strafe).toBeCloseTo(0.6, 5)
    expect(input.forward).toBeCloseTo(-0.8, 5)
  })

  test("skill scales the steering magnitude", () => {
    const npc = { ...makeNpc(), skill: 0.82 }
    const sim = makeSim(vec3(0, 0, 0))
    const input = npcInput(npc, sim, makeCourse([vec3(0, 0, 10)]), world, 0)
    expect(input.forward).toBeCloseTo(0.82, 5)
  })

  test("wobble perturbs the strafe axis over time but stays clamped", () => {
    const npc = makeNpc()
    npc.wobblePhase = 1.3
    const sim = makeSim(vec3(0, 0, 0))
    const course = makeCourse([vec3(0, 0, 10)])
    const strafes = new Set<number>()
    for (let tick = 0; tick < 120; tick++) {
      const input = npcInput(npc, sim, course, world, tick * STEP)
      strafes.add(input.strafe)
      expect(input.strafe).toBeGreaterThanOrEqual(-1)
      expect(input.strafe).toBeLessThanOrEqual(1)
      expect(Number.isFinite(input.forward)).toBe(true)
      expect(Number.isFinite(input.strafe)).toBe(true)
    }
    expect(strafes.size).toBeGreaterThan(1)
  })
})
