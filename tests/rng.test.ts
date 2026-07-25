import { describe, expect, test } from "bun:test"
import { EmptyPickError, hashString, mulberry32, pick, randomRange } from "../src/shared/rng"

describe("mulberry32", () => {
  test("matches the known reference sequence for seed 42", () => {
    const rng = mulberry32(42)
    // Reference values from the canonical 32-bit mulberry PRNG.
    const expected = [
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
      0.17481389874592423,
    ]
    for (const value of expected) {
      expect(rng()).toBe(value)
    }
  })

  test("same seed reproduces the same first 100 values", () => {
    const a = mulberry32(1337)
    const b = mulberry32(1337)
    const seqA = Array.from({ length: 100 }, () => a())
    const seqB = Array.from({ length: 100 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  test("different seeds diverge", () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 100 }, () => a())
    const seqB = Array.from({ length: 100 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  test("all values stay in [0, 1)", () => {
    const rng = mulberry32(987654321)
    for (let i = 0; i < 10_000; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe("hashString", () => {
  test("matches known FNV-1a 32-bit values", () => {
    expect(hashString("")).toBe(2166136261)
    expect(hashString("a")).toBe(3826002220)
    expect(hashString("npc-0")).toBe(750568469)
    expect(hashString("wobble-rush")).toBe(1986568029)
  })

  test("different strings hash differently", () => {
    expect(hashString("abc")).not.toBe(hashString("abd"))
    expect(hashString("npc-0")).not.toBe(hashString("npc-1"))
  })

  test("returns a non-negative 32-bit integer, stable across calls", () => {
    for (const text of ["", "wobble", "npc-7", "Course:Gauntlet", "🐝"]) {
      const hash = hashString(text)
      expect(Number.isInteger(hash)).toBe(true)
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThanOrEqual(0xffffffff)
      expect(hashString(text)).toBe(hash)
    }
  })
})

describe("randomRange", () => {
  test("stays inside [min, max)", () => {
    const rng = mulberry32(2024)
    for (let i = 0; i < 1_000; i++) {
      const value = randomRange(rng, -5, 5)
      expect(value).toBeGreaterThanOrEqual(-5)
      expect(value).toBeLessThan(5)
    }
  })

  test("is deterministic for a given seed", () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    for (let i = 0; i < 50; i++) {
      expect(randomRange(a, 0.82, 1)).toBe(randomRange(b, 0.82, 1))
    }
  })
})

describe("pick", () => {
  test("throws a typed EmptyPickError on an empty array", () => {
    const rng = mulberry32(1)
    expect(() => pick<number>(rng, [])).toThrow(EmptyPickError)
  })

  test("only returns members of the input array", () => {
    const rng = mulberry32(99)
    const items = ["alpha", "bravo", "charlie", "delta"] as const
    for (let i = 0; i < 200; i++) {
      expect(items).toContain(pick(rng, items))
    }
  })

  test("is deterministic for a given seed", () => {
    const items = [10, 20, 30, 40, 50] as const
    const a = mulberry32(555)
    const b = mulberry32(555)
    const seqA = Array.from({ length: 25 }, () => pick(a, items))
    const seqB = Array.from({ length: 25 }, () => pick(b, items))
    expect(seqA).toEqual(seqB)
  })
})
