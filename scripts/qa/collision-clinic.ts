/**
 * Collision clinic: headless, deterministic measurements of contact quality.
 *
 * Each probe reproduces a situation players actually hit and reports a number
 * instead of an impression: hitches crossing a deck seam, repeated impulse
 * events from one contact episode, sticking against a wall, tunnelling at
 * terminal velocity, and jitter while resting on ground.
 *
 * Usage: bun run scripts/qa/collision-clinic.ts
 */

import { FIXED_STEP_SEC, RUNNER } from "../../src/shared/constants"
import { SUNRISE_SCRAMBLE } from "../../src/shared/course"
import { createRunner, stepRunner } from "../../src/shared/player"
import type { PlayerInput, RunnerSim, SimEvent, Vec3 } from "../../src/shared/types"
import { vec3 } from "../../src/shared/types"
import { createWorldSnapshot } from "../../src/shared/world"

const course = SUNRISE_SCRAMBLE
const DT = FIXED_STEP_SEC

const input = (forward: number, strafe = 0): PlayerInput => ({
  forward,
  strafe,
  jumpHeld: false,
  jumpPressed: false,
  divePressed: false,
  cameraYaw: 0,
})

type Frame = {
  readonly t: number
  readonly pos: Vec3
  readonly vel: Vec3
  readonly grounded: boolean
  readonly events: readonly SimEvent[]
}

function run(
  sim: RunnerSim,
  steps: number,
  controls: (step: number) => PlayerInput,
  startTime = 0,
): Frame[] {
  const frames: Frame[] = []
  let t = startTime
  for (let step = 0; step < steps; step += 1) {
    t += DT
    const world = createWorldSnapshot(course, t)
    const events = stepRunner(sim, controls(step), world, DT, course.spawn)
    frames.push({
      t,
      pos: vec3(sim.position.x, sim.position.y, sim.position.z),
      vel: vec3(sim.velocity.x, sim.velocity.y, sim.velocity.z),
      grounded: sim.grounded,
      events,
    })
  }
  return frames
}

/** Steps against a world frozen at one instant: isolates geometry from motion. */
function runFrozen(
  sim: RunnerSim,
  steps: number,
  controls: (step: number) => PlayerInput,
  frozenTime: number,
): Frame[] {
  const world = createWorldSnapshot(course, frozenTime)
  const frames: Frame[] = []
  for (let step = 0; step < steps; step += 1) {
    const events = stepRunner(sim, controls(step), world, DT, course.spawn)
    frames.push({
      t: frozenTime,
      pos: vec3(sim.position.x, sim.position.y, sim.position.z),
      vel: vec3(sim.velocity.x, sim.velocity.y, sim.velocity.z),
      grounded: sim.grounded,
      events,
    })
  }
  return frames
}

const place = (x: number, y: number, z: number, vz = 0): RunnerSim => {
  const sim = createRunner(vec3(x, y, z), 0)
  sim.velocity.z = vz
  return sim
}

const results: string[] = []
const report = (name: string, value: string): void => {
  results.push(`${name.padEnd(42)} ${value}`)
}

/* 1. Crossing deck seams at full speed --------------------------------- */
{
  // pad-cp3 (71..76) abuts lane-bumper (76..100) exactly. Sweeper arms reach
  // 5.4 m from their pivots, so this stretch is the nearest genuinely clear
  // seam: the closest arm ends at z=42.4 and the first bumper starts at 78.9.
  const sim = place(7.5, RUNNER.radius, 71, RUNNER.runSpeed)
  const frames = run(sim, 50, () => input(1))
  const grounded = frames.filter((f) => f.grounded)
  let maxRise = 0
  let maxDrop = 0
  let worstSlowdown = 0
  for (let i = 1; i < grounded.length; i += 1) {
    const a = grounded[i - 1]
    const b = grounded[i]
    if (a === undefined || b === undefined) continue
    maxRise = Math.max(maxRise, b.pos.y - a.pos.y)
    maxDrop = Math.min(maxDrop, b.pos.y - a.pos.y)
    worstSlowdown = Math.max(worstSlowdown, a.vel.z - b.vel.z)
  }
  const airborne = frames.filter((f) => !f.grounded).length
  report("seam: max vertical pop per tick", `${maxRise.toFixed(4)} m (drop ${maxDrop.toFixed(4)})`)
  report("seam: worst forward speed loss per tick", `${worstSlowdown.toFixed(3)} m/s`)
  report("seam: airborne ticks while running flat", `${airborne} / ${frames.length}`)
}

/* 2. One sweeper contact -> how many impulse events? -------------------- */
{
  const sim = place(0, RUNNER.radius, 8, RUNNER.runSpeed)
  const frames = run(sim, 240, () => input(1))
  const hits = frames.flatMap((f) => f.events.filter((e) => e.kind === "hit"))
  // Group into episodes: consecutive frames containing a hit are one contact.
  let episodes = 0
  let runLength = 0
  const runs: number[] = []
  for (const f of frames) {
    const has = f.events.some((e) => e.kind === "hit")
    if (has) {
      if (runLength === 0) episodes += 1
      runLength += 1
    } else if (runLength > 0) {
      runs.push(runLength)
      runLength = 0
    }
  }
  if (runLength > 0) runs.push(runLength)
  report("sweeper: hit events total", `${hits.length}`)
  report("sweeper: contact episodes", `${episodes}`)
  report("sweeper: events per episode", runs.length > 0 ? runs.join(", ") : "none")
}

/* 3. One bumper contact -> how many bounce events? ---------------------- */
{
  const sim = place(5, RUNNER.radius, 74, RUNNER.runSpeed)
  const frames = run(sim, 240, () => input(1))
  const runs: number[] = []
  let runLength = 0
  for (const f of frames) {
    const has = f.events.some((e) => e.kind === "bounce")
    if (has) runLength += 1
    else if (runLength > 0) {
      runs.push(runLength)
      runLength = 0
    }
  }
  if (runLength > 0) runs.push(runLength)
  report("bumper: events per episode", runs.length > 0 ? runs.join(", ") : "none")
}

/* 4. Pressing into a sweeper bar: slide along it, or weld to it? -------- */
{
  // This course has no walls taller than its decks — the only true barrier a
  // runner can press against is a sweeper arm, a knee-high bar across the lane.
  // Freeze time so the arm cannot sweep away and hide a sticking bug.
  const frozen = 0.35
  const armWorld = createWorldSnapshot(course, frozen)
  // Walk into the bar, then try to slide sideways along it.
  const sim = place(0, RUNNER.radius, 11.2, 0)
  const frames = runFrozen(sim, 150, (step) => (step < 40 ? input(1) : input(0.3, 1)), frozen)
  const sliding = frames.slice(60)
  const lateral = sliding.map((f) => Math.abs(f.vel.x))
  const maxLateral = Math.max(...lateral)
  const stalled = sliding.filter((f) => Math.hypot(f.vel.x, f.vel.z) < 0.5).length
  report("bar: max sideways speed while pressed", `${maxLateral.toFixed(3)} m/s`)
  report("bar: stalled ticks while sliding", `${stalled} / ${sliding.length}`)
  report("bar: world sampled at", `t=${armWorld.timeSec.toFixed(2)}s`)
}

/* 4b. How long does ONE sweeper contact keep driving the runner? -------- */
{
  const sim = place(0, RUNNER.radius, 8, RUNNER.runSpeed)
  const frames = run(sim, 240, () => input(1))
  // Player authority: fraction of ticks where the runner's velocity is still
  // dominated by knockback rather than by the input direction.
  let dragged = 0
  let longestDrag = 0
  let current = 0
  for (const f of frames) {
    const speed = Math.hypot(f.vel.x, f.vel.z)
    const awayFromInput = speed > 1 && f.vel.z < 0
    if (awayFromInput) {
      dragged += 1
      current += 1
      longestDrag = Math.max(longestDrag, current)
    } else current = 0
  }
  report("knockback: ticks pushed backwards", `${dragged} / ${frames.length}`)
  report(
    "knockback: longest unbroken backward push",
    `${longestDrag} ticks (${(longestDrag / 60).toFixed(2)} s)`,
  )
}

/* 5. Terminal-velocity drop onto a moving platform ---------------------- */
{
  // Drop onto a STATIC deck at terminal velocity: a moving platform would let
  // the runner fall through a gap and confuse the tunnelling question.
  const sim = place(7.5, 40, 73, 0)
  sim.velocity.y = -RUNNER.maxFallSpeed
  const frames = run(sim, 240, () => input(0))
  const landed = frames.find((f) => f.grounded)
  const wentBelow = frames.some((f) => f.pos.y < -5)
  report(
    "tunnel: caught by a platform after 34 m/s drop",
    landed === undefined ? "NO — fell through" : `yes at y=${landed.pos.y.toFixed(2)}`,
  )
  report("tunnel: passed below the course", wentBelow ? "YES — tunnelled" : "no")
}

/* 6. Resting on flat ground: any jitter? -------------------------------- */
{
  // pad-cp3: no sweeper arc, no bumper, no mover reaches it.
  const sim = place(7.5, RUNNER.radius + 0.02, 73, 0)
  const frames = run(sim, 180, () => input(0))
  const tail = frames.slice(60)
  const ys = tail.map((f) => f.pos.y)
  const spread = Math.max(...ys) - Math.min(...ys)
  const groundedFlips = tail.filter((f, i) => i > 0 && f.grounded !== tail[i - 1]?.grounded).length
  report("rest: vertical spread while standing", `${spread.toFixed(5)} m`)
  report("rest: grounded flips while standing", `${groundedFlips}`)
}

/* 7. Landing on a deck edge ------------------------------------------- */
{
  // Land on the lip where lane-bumper begins (z=76), in the clear stretch.
  const sim = place(7.5, 2.2, 74.4, RUNNER.runSpeed)
  const frames = run(sim, 120, () => input(1))
  const settled = frames.slice(30)
  const stuck = settled.every((f) => Math.abs(f.vel.z) < 0.5)
  const yJumps = settled.filter(
    (f, i) => i > 0 && Math.abs(f.pos.y - (settled[i - 1]?.pos.y ?? f.pos.y)) > 0.25,
  ).length
  report("edge: stuck on the lip", stuck ? "YES — stuck" : "no")
  report("edge: >0.25 m vertical jumps after landing", `${yJumps}`)
}

/* 8. Does one clean hit still THROW the runner? ------------------------ */
{
  // "Cleaner" must not mean "cosmetic": a sweeper should visibly shove you.
  const sim = place(0, RUNNER.radius, 8, RUNNER.runSpeed)
  const frames = run(sim, 300, () => input(1))
  let worstThrow = 0
  let speedAtHit = 0
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i]
    if (f === undefined || !f.events.some((e) => e.kind === "hit")) continue
    const before = frames[i - 1] ?? f
    // Lateral displacement over the second following the hit.
    const after = frames[Math.min(frames.length - 1, i + 60)]
    if (after === undefined) continue
    worstThrow = Math.max(worstThrow, Math.abs(after.pos.x - before.pos.x))
    speedAtHit = Math.max(speedAtHit, Math.hypot(f.vel.x, f.vel.z))
  }
  report("throw: lateral shove 1 s after a hit", `${worstThrow.toFixed(2)} m`)
  report("throw: speed imparted at contact", `${speedAtHit.toFixed(2)} m/s`)
}

console.log("\n=== collision clinic ===")
for (const line of results) console.log(line)
