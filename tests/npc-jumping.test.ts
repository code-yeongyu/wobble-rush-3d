import { describe, expect, test } from "bun:test"
import { npcInput, updateNpcProgress } from "../src/shared/npc"
import type { PlayerInput } from "../src/shared/types"
import { vec3 } from "../src/shared/types"
import { makeCourse, makeNpc, makeSim, makeWorld, STEP } from "./support/npc-fixtures"

describe("npcInput jumping", () => {
  test("requests a jump for a higher waypoint inside look-ahead, after the reaction delay", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    // 1.5 m higher, 2 m ahead: dy > 0.6 and within NPC.jumpLookAhead.
    const course = makeCourse([vec3(0, 1.5, 2)])
    const world = makeWorld()
    let fired = false
    for (let tick = 0; tick < 30 && !fired; tick++) {
      const input = npcInput(npc, sim, course, world, tick * STEP)
      if (input.jumpPressed) {
        fired = true
        expect(input.jumpHeld).toBe(true)
      }
      updateNpcProgress(npc, sim, course, STEP)
    }
    expect(fired).toBe(true)
  })

  test("never jumps on flat ground", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const course = makeCourse([vec3(0, 0, 10)])
    const world = makeWorld()
    for (let tick = 0; tick < 40; tick++) {
      const input = npcInput(npc, sim, course, world, tick * STEP)
      expect(input.jumpPressed).toBe(false)
      updateNpcProgress(npc, sim, course, STEP)
    }
  })

  test("requests a jump when the world probe ahead reports a gap", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const course = makeCourse([vec3(0, 0, 50)])
    // Gap in the floor: no support past z = 0.5, so the look-ahead probe finds none.
    const world = makeWorld(
      () => false,
      (_x, z) => (z > 0.4 ? null : 0),
    )
    let fired = false
    for (let tick = 0; tick < 30 && !fired; tick++) {
      const input = npcInput(npc, sim, course, world, tick * STEP)
      if (input.jumpPressed) fired = true
      updateNpcProgress(npc, sim, course, STEP)
    }
    expect(fired).toBe(true)
  })

  test("jump requests are rising-edge only across consecutive ticks", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const course = makeCourse([vec3(0, 1.5, 2)])
    const world = makeWorld()
    let presses = 0
    for (let tick = 0; tick < 60; tick++) {
      const input = npcInput(npc, sim, course, world, tick * STEP)
      if (input.jumpPressed) presses++
      updateNpcProgress(npc, sim, course, STEP)
    }
    expect(presses).toBe(1)
  })

  test("jumpHeld follows a rising jump from the sim", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const course = makeCourse([vec3(0, 1.5, 2)])
    const world = makeWorld()
    let input: PlayerInput = npcInput(npc, sim, course, world, 0)
    while (!input.jumpPressed) {
      updateNpcProgress(npc, sim, course, STEP)
      input = npcInput(npc, sim, course, world, 0)
    }
    expect(input.jumpHeld).toBe(true)
    sim.jumpRising = true
    const held = npcInput(npc, sim, course, world, STEP)
    expect(held.jumpPressed).toBe(false)
    expect(held.jumpHeld).toBe(true)
  })

  test("reaction delay: no action before NPC.reactionSec of accumulated dt", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const course = makeCourse([vec3(0, 1.5, 2)])
    const world = makeWorld()
    // 11 ticks of input+dt accumulate 11/60 = 0.1833 s > 0.18 s of delay only
    // after the 11th update; the first 11 inputs must not jump.
    for (let tick = 0; tick < 11; tick++) {
      const input = npcInput(npc, sim, course, world, tick * STEP)
      expect(input.jumpPressed).toBe(false)
      updateNpcProgress(npc, sim, course, STEP)
    }
    const input = npcInput(npc, sim, course, world, 11 * STEP)
    expect(input.jumpPressed).toBe(true)
  })
})
