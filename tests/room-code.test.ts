import { describe, expect, test } from "bun:test"
import { generateRoomCode } from "../src/shared/room"
import { asRoomCode } from "../src/shared/types"

describe("generateRoomCode", () => {
  test("draws 4 uppercase letters from the unambiguous alphabet", () => {
    let call = 0
    const rolls = [0.1, 0.2, 0.3, 0.4]
    const code = generateRoomCode(() => {
      const roll = rolls[call]
      call += 1
      if (roll === undefined) throw new Error("random called too many times")
      return roll
    })
    expect(code).toBe(asRoomCode("CEHK"))
    expect(code).toHaveLength(4)
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/)
  })

  test("clamps the extremes of the random range", () => {
    expect(generateRoomCode(() => 0)).toBe(asRoomCode("AAAA"))
    expect(generateRoomCode(() => 0.9999)).toBe(asRoomCode("ZZZZ"))
  })
})
