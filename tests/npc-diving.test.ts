import { describe, expect, test } from "bun:test"
import { npcInput } from "../src/shared/npc"
import { vec3 } from "../src/shared/types"
import { makeCourse, makeNpc, makeSim, makeWorld } from "./support/npc-fixtures"

describe("npcInput diving", () => {
  const world = makeWorld()

  test("dives when grounded, near top speed, within 6 m of the final waypoint", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0), vec3(0, 0, 8), true)
    const course = makeCourse([vec3(0, 0, 30), vec3(0, 0, 5)])
    npc.waypointIndex = 1
    const input = npcInput(npc, sim, course, world, 0)
    expect(input.divePressed).toBe(true)
  })

  test("does not dive far from the final waypoint", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0), vec3(0, 0, 8), true)
    const course = makeCourse([vec3(0, 0, 30)])
    const input = npcInput(npc, sim, course, world, 0)
    expect(input.divePressed).toBe(false)
  })

  test("does not dive while slow", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0), vec3(0, 0, 3), true)
    const course = makeCourse([vec3(0, 0, 5)])
    const input = npcInput(npc, sim, course, world, 0)
    expect(input.divePressed).toBe(false)
  })

  test("does not dive while airborne", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0), vec3(0, 0, 8), false)
    const course = makeCourse([vec3(0, 0, 5)])
    const input = npcInput(npc, sim, course, world, 0)
    expect(input.divePressed).toBe(false)
  })
})
