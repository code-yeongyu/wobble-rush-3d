/**
 * Headless course-tuning harness.
 *
 * Runs the NPC brains over the whole course with no browser and no renderer, and
 * reports finish time and fall count per racer. This is how the level is tuned:
 * if the AI pack cannot complete the course with a handful of falls, the course
 * is unfair to humans too.
 *
 * Usage: bun run scripts/qa/course-harness.ts [seed] [racers]
 */
import { FIXED_STEP_SEC } from "../../src/shared/constants"
import { SUNRISE_SCRAMBLE } from "../../src/shared/course"
import { createNpcRacers, npcInput, updateNpcProgress } from "../../src/shared/npc"
import { createRunner, stepRunner } from "../../src/shared/player"
import { createWorldSnapshot } from "../../src/shared/world"

const course = SUNRISE_SCRAMBLE
const seed = Number(Bun.argv[2] ?? 42)
const count = Number(Bun.argv[3] ?? 5)
const racers = createNpcRacers(course, seed, count)
const sims = racers.map((_r, i) =>
  createRunner(
    { x: course.spawn.x + ((i % 4) - 1.5) * 1.5, y: course.spawn.y, z: course.spawn.z },
    0,
  ),
)
const finished: (number | null)[] = racers.map(() => null)
const falls = racers.map(() => 0)
const maxZ = racers.map(() => -99)
const stuckAt = racers.map(() => ({ z: -99, sec: 0 }))

let t = 0
const LIMIT = 180
while (t < LIMIT) {
  t += FIXED_STEP_SEC
  const world = createWorldSnapshot(course, t)
  for (let i = 0; i < racers.length; i++) {
    const racer = racers[i]
    const sim = sims[i]
    if (racer === undefined || sim === undefined) continue
    if (finished[i] !== null) continue
    const respawn =
      course.checkpoints.find((c) => c.index === sim.checkpoint)?.respawn ?? course.spawn
    const events = stepRunner(
      sim,
      npcInput(racer, sim, course, world, t),
      world,
      FIXED_STEP_SEC,
      respawn,
    )
    updateNpcProgress(racer, sim, course, FIXED_STEP_SEC)
    for (const e of events) {
      if (e.kind === "respawn") falls[i] = (falls[i] ?? 0) + 1
      if (e.kind === "finish") finished[i] = t
    }
    if (sim.position.z > (maxZ[i] ?? -99)) {
      maxZ[i] = sim.position.z
      stuckAt[i] = { z: sim.position.z, sec: t }
    }
  }
  if (finished.every((f) => f !== null)) break
}
for (let i = 0; i < racers.length; i++) {
  const racer = racers[i]
  if (racer === undefined) continue
  const f = finished[i] ?? null
  const top = maxZ[i] ?? -99
  const stuck = stuckAt[i] ?? { z: -99, sec: 0 }
  console.log(
    `${racer.name.padEnd(12)} skill=${racer.skill.toFixed(2)} ` +
      `${f === null ? `STUCK maxZ=${top.toFixed(1)} (last progress ${stuck.sec.toFixed(0)}s, wp=${racer.waypointIndex})` : `finished ${f.toFixed(1)}s`} falls=${falls[i] ?? 0}`,
  )
}
