import { describe, expect, test } from "bun:test"
import { NPC } from "../src/shared/constants"
import { createNpcRacers, npcInput, updateNpcProgress } from "../src/shared/npc"
import type { CourseDefinition, RunnerSim, Vec3, WorldSnapshot } from "../src/shared/types"
import { asCheckpointIndex, asObstacleId, ZERO_VEC3 } from "../src/shared/types"

const course = (waypoints: readonly Vec3[]): CourseDefinition => ({
  id: "gap",
  name: "gap",
  spawn: { x: 0, y: 1, z: 0 },
  spawnYaw: 0,
  platforms: [],
  obstacles: [],
  checkpoints: [
    {
      index: asCheckpointIndex(0),
      id: asObstacleId("cp"),
      respawn: { x: 0, y: 1, z: 0 },
      trigger: { center: ZERO_VEC3, halfExtents: { x: 1, y: 1, z: 1 }, yaw: 0 },
      label: "start",
    },
  ],
  finish: { center: { x: 0, y: 1, z: 100 }, halfExtents: { x: 2, y: 2, z: 2 }, yaw: 0 },
  killY: -14,
  waypoints,
})

/** Ground everywhere except the strip named by `gapFrom`..`gapTo`. */
const worldWithGap = (gapFrom: number, gapTo: number): WorldSnapshot => ({
  timeSec: 0,
  resolve: (_p, desired, velocity) => ({
    position: desired,
    velocity,
    grounded: true,
    carry: ZERO_VEC3,
    impulses: [],
  }),
  checkpointAt: () => null,
  isFinished: () => false,
  hasFallen: (position) => position.y < -14,
  supportHeightAt: (_x, z) => (z >= gapFrom && z <= gapTo ? null : 0),
})

const sim = (z: number): RunnerSim => ({
  position: { x: 0, y: 0.45, z },
  velocity: { x: 0, y: 0, z: 8 },
  yaw: 0,
  grounded: true,
  timeSinceGrounded: 0,
  jumpBuffer: 0,
  diveTimer: 0,
  diveCooldown: 0,
  stumbleTimer: 0,
  jumpRising: false,
  state: "run",
  checkpoint: asCheckpointIndex(0),
  carry: { x: 0, y: 0, z: 0 },
  lastContactId: null,
  contactLockout: 0,
})

describe("NPC gap handling", () => {
  test("requests a jump when the ground ahead is missing", () => {
    const track = course([{ x: 0, y: 0, z: 30 }])
    const racer = createNpcRacers(track, 1, 1)[0]
    if (racer === undefined) throw new Error("expected one racer")
    const world = worldWithGap(12, 15)
    const runner = sim(10)

    // First tick detects the hazard, the reaction delay elapses, then it jumps.
    let jumped = false
    for (let tick = 0; tick < 30; tick += 1) {
      const input = npcInput(racer, runner, track, world, tick / 60)
      if (input.jumpPressed) {
        jumped = true
        break
      }
      updateNpcProgress(racer, runner, track, 1 / 60)
    }
    expect(jumped).toBe(true)
  })

  test("does not jump when solid ground continues ahead", () => {
    const track = course([{ x: 0, y: 0, z: 30 }])
    const racer = createNpcRacers(track, 1, 1)[0]
    if (racer === undefined) throw new Error("expected one racer")
    const world = worldWithGap(200, 210)
    const runner = sim(10)
    for (let tick = 0; tick < 30; tick += 1) {
      expect(npcInput(racer, runner, track, world, tick / 60).jumpPressed).toBe(false)
      updateNpcProgress(racer, runner, track, 1 / 60)
    }
  })

  test("probes ahead by a speed-derived distance so take-off lands past the gap", () => {
    const track = course([{ x: 0, y: 0, z: 30 }])
    const racer = createNpcRacers(track, 1, 1)[0]
    if (racer === undefined) throw new Error("expected one racer")
    const probed: number[] = []
    const world: WorldSnapshot = {
      ...worldWithGap(200, 210),
      supportHeightAt: (_x, z) => {
        probed.push(z)
        return 0
      },
    }
    const runner = sim(10)
    npcInput(racer, runner, track, world, 0)
    const speed = Math.hypot(runner.velocity.x, runner.velocity.z)
    const expected = 10 + Math.min(NPC.jumpLookAhead, speed * (NPC.reactionSec + 0.06) + 0.5)
    expect(probed.some((z) => Math.abs(z - expected) < 0.2)).toBe(true)
    // A fixed look-ahead would probe much further out and jump far too early.
    expect(probed.every((z) => z < 10 + NPC.jumpLookAhead)).toBe(true)
  })
})
