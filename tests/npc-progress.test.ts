import { describe, expect, test } from "bun:test"
import { updateNpcProgress } from "../src/shared/npc"
import { vec3 } from "../src/shared/types"
import { makeCourse, makeNpc, makeSim, STEP } from "./support/npc-fixtures"

describe("updateNpcProgress", () => {
  const course = makeCourse([vec3(0, 0, 0), vec3(10, 0, 0), vec3(20, 0, 0)])

  test("advances the waypoint index on arrival", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(1.5, 0, 0.5))
    updateNpcProgress(npc, sim, course, STEP)
    expect(npc.waypointIndex).toBe(1)
  })

  test("advances through multiple waypoints in one call and clamps at the last", () => {
    const tight = makeCourse([vec3(0, 0, 0), vec3(1, 0, 0), vec3(2, 0, 0)])
    const npc = makeNpc()
    const sim = makeSim(vec3(0.5, 0, 0))
    updateNpcProgress(npc, sim, tight, STEP)
    expect(npc.waypointIndex).toBe(2)
  })

  test("never regresses even when the runner is pushed backwards", () => {
    const npc = makeNpc()
    npc.waypointIndex = 2
    const sim = makeSim(vec3(0, 0, 0))
    updateNpcProgress(npc, sim, course, STEP)
    expect(npc.waypointIndex).toBe(2)
  })

  test("clamps an out-of-range index to the last waypoint", () => {
    const npc = makeNpc()
    npc.waypointIndex = 99
    const sim = makeSim(vec3(0, 0, 0))
    updateNpcProgress(npc, sim, course, STEP)
    expect(npc.waypointIndex).toBe(2)
  })

  test("does not advance while outside the waypoint radius", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(5, 0, 0))
    updateNpcProgress(npc, sim, course, STEP)
    expect(npc.waypointIndex).toBe(0)
  })

  test("decrements a positive reaction timer by dt", () => {
    const npc = makeNpc()
    npc.reactionTimer = 0.1
    const sim = makeSim(vec3(5, 0, 0))
    updateNpcProgress(npc, sim, course, STEP)
    expect(npc.reactionTimer).toBeCloseTo(0.1 - STEP, 10)
  })

  test("is a pure function of its arguments (no wall-clock, no randomness)", () => {
    const a = makeNpc()
    const b = makeNpc()
    a.reactionTimer = 0.18
    b.reactionTimer = 0.18
    const simA = makeSim(vec3(1.5, 0, 0.5))
    const simB = makeSim(vec3(1.5, 0, 0.5))
    updateNpcProgress(a, simA, course, STEP)
    updateNpcProgress(b, simB, course, STEP)
    expect(a).toEqual(b)
  })
})
