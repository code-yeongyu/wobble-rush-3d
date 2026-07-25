import { describe, expect, test } from "bun:test"
import { NPC, RUNNER } from "../src/shared/constants"
import {
  createNpcRacers,
  NPC_NAMES,
  type NpcRacer,
  npcInput,
  updateNpcProgress,
} from "../src/shared/npc"
import {
  asCheckpointIndex,
  asPlayerId,
  type CourseDefinition,
  type PlayerInput,
  type RunnerSim,
  type Vec3,
  vec3,
  type WorldSnapshot,
  ZERO_VEC3,
} from "../src/shared/types"

/* ------------------------------------------------------------------ *
 * Inline stubs — deliberately NOT importing course.ts / world.ts,
 * which sibling agents own.
 * ------------------------------------------------------------------ */

const makeCourse = (waypoints: readonly Vec3[]): CourseDefinition => ({
  id: "test-course",
  name: "Test Course",
  spawn: vec3(0, 0, 0),
  spawnYaw: 0,
  platforms: [],
  obstacles: [],
  checkpoints: [],
  finish: { center: vec3(0, 0, 0), halfExtents: vec3(1, 1, 1), yaw: 0 },
  killY: -10,
  waypoints,
})

const makeWorld = (
  hasFallen: (position: Vec3) => boolean = () => false,
  supportHeightAt: (x: number, z: number, fromY: number) => number | null = () => 0,
): WorldSnapshot => ({
  timeSec: 0,
  resolve: (_previous, desired, velocity) => ({
    position: desired,
    velocity,
    grounded: true,
    carry: ZERO_VEC3,
    events: [],
  }),
  checkpointAt: () => null,
  isFinished: () => false,
  hasFallen,
  supportHeightAt,
})

const makeSim = (position: Vec3, velocity: Vec3 = vec3(0, 0, 0), grounded = true): RunnerSim => ({
  position: { x: position.x, y: position.y, z: position.z },
  velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
  yaw: 0,
  grounded,
  timeSinceGrounded: 0,
  jumpBuffer: 0,
  diveTimer: 0,
  diveCooldown: 0,
  stumbleTimer: 0,
  jumpRising: false,
  state: grounded ? "run" : "air",
  checkpoint: asCheckpointIndex(0),
  carry: { x: 0, y: 0, z: 0 },
})

const makeNpc = (): NpcRacer => ({
  id: asPlayerId("npc-test"),
  name: "Test Racer",
  colorIndex: 0,
  skill: 1,
  waypointIndex: 0,
  reactionTimer: 0,
  wobblePhase: 0,
  finishedAtMs: null,
})

const STEP = 1 / 60

/* ------------------------------------------------------------------ *
 * createNpcRacers
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * npcInput — steering
 * ------------------------------------------------------------------ */

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

  test("steers with pure +X strafe for a waypoint directly to the right", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const input = npcInput(npc, sim, makeCourse([vec3(10, 0, 0)]), world, 0)
    expect(input.strafe).toBeCloseTo(1, 5)
    expect(input.forward).toBeCloseTo(0, 5)
  })

  test("steers diagonally with normalized components", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const input = npcInput(npc, sim, makeCourse([vec3(3, 0, 4)]), world, 0)
    expect(input.strafe).toBeCloseTo(0.6, 5)
    expect(input.forward).toBeCloseTo(0.8, 5)
  })

  test("steers backwards-left for a waypoint behind", () => {
    const npc = makeNpc()
    const sim = makeSim(vec3(0, 0, 0))
    const input = npcInput(npc, sim, makeCourse([vec3(-6, 0, -8)]), world, 0)
    expect(input.strafe).toBeCloseTo(-0.6, 5)
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

/* ------------------------------------------------------------------ *
 * npcInput — jumping
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * npcInput — finish-line dive
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * updateNpcProgress
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Determinism headline: identical input streams for identical seeds.
 * ------------------------------------------------------------------ */

describe("determinism", () => {
  test("two independent 600-tick runs produce identical input streams", () => {
    const course = makeCourse([
      vec3(0, 0, 8),
      vec3(5, 0, 16),
      vec3(0, 1.5, 20),
      vec3(-4, 0, 28),
      vec3(0, 0, 34),
    ])
    const world = makeWorld(
      () => false,
      (_x, z) => (z > 10 && z < 25 ? null : 0),
    )

    const runOnce = (): string => {
      const racers = createNpcRacers(course, 99, 3)
      const sims = racers.map(() => makeSim(vec3(0, 0, 0)))
      const stream: unknown[] = []
      let timeSec = 0
      for (let tick = 0; tick < 600; tick++) {
        racers.forEach((npc, index) => {
          const sim = sims[index]
          if (sim === undefined) return
          const input = npcInput(npc, sim, course, world, timeSec)
          stream.push([
            input.forward,
            input.strafe,
            input.jumpHeld,
            input.jumpPressed,
            input.divePressed,
            input.cameraYaw,
          ])
          // Trivial deterministic kinematics: drift towards the current waypoint.
          const target = course.waypoints[Math.min(npc.waypointIndex, course.waypoints.length - 1)]
          if (target !== undefined) {
            const dx = target.x - sim.position.x
            const dz = target.z - sim.position.z
            const dist = Math.hypot(dx, dz)
            if (dist > 1e-6) {
              const speed = RUNNER.runSpeed * npc.skill * STEP
              sim.position.x += (dx / dist) * speed
              sim.position.z += (dz / dist) * speed
            }
          }
          updateNpcProgress(npc, sim, course, STEP)
        })
        timeSec += STEP
      }
      return JSON.stringify(stream)
    }

    const first = runOnce()
    const second = runOnce()
    expect(first).toBe(second)

    // Sanity: the stream is not all-neutral and every value is finite and clamped.
    const parsed = JSON.parse(first) as [number, number, boolean, boolean, boolean, number][]
    expect(parsed.some(([forward]) => Math.abs(forward) > 0.1)).toBe(true)
    expect(parsed.some(([, , , jumpPressed]) => jumpPressed)).toBe(true)
    for (const [forward, strafe, , , , cameraYaw] of parsed) {
      expect(Number.isFinite(forward)).toBe(true)
      expect(Number.isFinite(strafe)).toBe(true)
      expect(Math.abs(forward)).toBeLessThanOrEqual(1)
      expect(Math.abs(strafe)).toBeLessThanOrEqual(1)
      expect(cameraYaw).toBe(0)
    }
  })
})
