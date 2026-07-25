/**
 * Deterministic randomness for Wobble Rush 3D.
 *
 * Multiplayer clients must produce identical NPC behaviour with zero server
 * traffic, so every source of "randomness" is a pure function of an explicit
 * seed. No `Math.random`, no `Date.now`, ever.
 */

/** Uniform generator: each call returns the next value in [0, 1). */
export type Rng = () => number

/** Thrown by `pick` when asked to choose from an empty array. */
export class EmptyPickError extends Error {
  constructor() {
    super("pick() cannot choose from an empty array")
    this.name = "EmptyPickError"
  }
}

/**
 * Standard 32-bit mulberry PRNG. Same seed → same sequence on every machine
 * (all arithmetic is 32-bit integer ops plus one division, so it is
 * bit-for-bit reproducible across JS engines).
 */
export function mulberry32(seed: number): Rng {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * FNV-1a 32-bit string hash. Stable across runs, platforms and processes;
 * returns a non-negative 32-bit integer.
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Next value from `rng`, scaled into [min, max). */
export function randomRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

/** Uniformly pick one element. Throws `EmptyPickError` on an empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new EmptyPickError()
  }
  const index = Math.min(Math.floor(rng() * items.length), items.length - 1)
  let seen = -1
  for (const item of items) {
    seen += 1
    if (seen === index) {
      return item
    }
  }
  throw new EmptyPickError()
}
