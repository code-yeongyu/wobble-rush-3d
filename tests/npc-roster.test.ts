import { describe, expect, test } from "bun:test"
import { NPC } from "../src/shared/constants"
import { createNpcRacers, NPC_NAMES } from "../src/shared/npc"
import { asPlayerId, vec3 } from "../src/shared/types"
import { makeCourse } from "./support/npc-fixtures"

describe("createNpcRacers", () => {
  const course = makeCourse([vec3(0, 0, 10), vec3(0, 0, 20)])

  test("same seed produces deeply equal racers", () => {
    const a = createNpcRacers(course, 42, 6)
    const b = createNpcRacers(course, 42, 6)
    expect(a).toEqual(b)
  })

  test("different seeds produce different racers", () => {
    const a = createNpcRacers(course, 42, 6)
    const b = createNpcRacers(course, 43, 6)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  test("ids follow npc-0..npc-n and names are unique", () => {
    const racers = createNpcRacers(course, 7, 8)
    racers.forEach((racer, index) => {
      expect(racer.id).toBe(asPlayerId(`npc-${index}`))
    })
    expect(new Set(racers.map((racer) => racer.name)).size).toBe(8)
  })

  test("colorIndex is spread across the pack", () => {
    const racers = createNpcRacers(course, 7, 8)
    expect(new Set(racers.map((racer) => racer.colorIndex)).size).toBe(8)
  })

  test("names wrap with a numeric suffix when count exceeds the name pool", () => {
    const count = NPC_NAMES.length + 3
    const racers = createNpcRacers(course, 11, count)
    expect(racers).toHaveLength(count)
    expect(new Set(racers.map((racer) => racer.name)).size).toBe(count)
    for (const racer of racers) {
      expect(NPC_NAMES.some((base) => racer.name.startsWith(base))).toBe(true)
    }
  })

  test("every skill lies inside [NPC.minSkill, NPC.maxSkill]", () => {
    const racers = createNpcRacers(course, 123456, 40)
    for (const racer of racers) {
      expect(racer.skill).toBeGreaterThanOrEqual(NPC.minSkill)
      expect(racer.skill).toBeLessThanOrEqual(NPC.maxSkill)
    }
  })

  test("NPC_NAMES holds at least 8 names", () => {
    expect(NPC_NAMES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(NPC_NAMES).size).toBe(NPC_NAMES.length)
  })
})
