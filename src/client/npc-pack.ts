/**
 * The AI pack: spawning, stepping and rendering NPC racers.
 *
 * NPCs are seeded, so every client in a party simulates an identical pack with zero
 * server cost — the seed arrives in the `welcome` message.
 */

import type * as THREE from "three"
import { RUNNER } from "../shared/constants"
import { RUNNER_COLORS } from "../shared/course"
import type { CrowdBody } from "../shared/crowd"
import type { NpcRacer } from "../shared/npc"
import { createNpcRacers, npcInput, updateNpcProgress } from "../shared/npc"
import { createRunner, respawnRunner, stepRunner } from "../shared/player"
import type {
  CheckpointIndex,
  CourseDefinition,
  RunnerSim,
  SimEvent,
  Vec3,
  WorldSnapshot,
} from "../shared/types"
import { NEUTRAL_INPUT } from "../shared/types"
import type { FinisherRow } from "./race-results"
import { localFinisherId } from "./race-results"
import { RunnerView } from "./runner-view"

type NpcEntry = { readonly racer: NpcRacer; readonly sim: RunnerSim; readonly view: RunnerView }

export type NpcStepContext = {
  readonly world: WorldSnapshot
  readonly timeSec: number
  readonly dt: number
  readonly locked: boolean
  readonly raceMs: number
}

/** Staggers the starting grid so runners do not spawn inside each other. */
export function startOffset(spawn: Vec3, index: number): Vec3 {
  return {
    x: spawn.x + ((index % 4) - 1.5) * 1.5,
    y: spawn.y,
    z: spawn.z - Math.floor(index / 4) * 1.6,
  }
}

export class NpcPack {
  private readonly scene: THREE.Scene
  private readonly course: CourseDefinition
  private readonly entries: NpcEntry[] = []

  constructor(scene: THREE.Scene, course: CourseDefinition) {
    this.scene = scene
    this.course = course
  }

  get size(): number {
    return this.entries.length
  }

  /** Bodies for runner-vs-runner separation; NPCs are simulated here, so movable. */
  bodies(): CrowdBody[] {
    return this.entries.map((entry) => ({
      id: entry.racer.id,
      radius: RUNNER.radius,
      position: entry.sim.position,
      velocity: entry.sim.velocity,
      movable: true,
    }))
  }

  progress(): number[] {
    return this.entries.map((entry) => entry.sim.position.z)
  }

  spawn(seed: number, count: number): void {
    this.dispose()
    for (const racer of createNpcRacers(this.course, seed, count)) {
      const spawn = startOffset(this.course.spawn, racer.colorIndex)
      const view = new RunnerView(
        RUNNER_COLORS[racer.colorIndex % RUNNER_COLORS.length] ?? "#5CC9F5",
        racer.name,
      )
      this.scene.add(view.group)
      this.entries.push({ racer, sim: createRunner(spawn, this.course.spawnYaw), view })
    }
  }

  reset(checkpoint: CheckpointIndex): void {
    for (const entry of this.entries) {
      respawnRunner(entry.sim, startOffset(this.course.spawn, entry.racer.colorIndex))
      entry.sim.checkpoint = checkpoint
      entry.racer.waypointIndex = 0
      entry.racer.finishedAtMs = null
    }
  }

  /** Advances every racer one fixed step. `locked` freezes them during the countdown. */
  step(context: NpcStepContext, onEvents: (events: readonly SimEvent[]) => void): void {
    for (const entry of this.entries) {
      const input = context.locked
        ? NEUTRAL_INPUT
        : npcInput(entry.racer, entry.sim, this.course, context.world, context.timeSec)
      const respawn =
        this.course.checkpoints.find((cp) => cp.index === entry.sim.checkpoint)?.respawn ??
        this.course.spawn
      const events = stepRunner(entry.sim, input, context.world, context.dt, respawn)
      updateNpcProgress(entry.racer, entry.sim, this.course, context.dt)
      if (entry.racer.finishedAtMs === null && events.some((event) => event.kind === "finish")) {
        entry.racer.finishedAtMs = context.raceMs
      }
      onEvents(events)
    }
  }

  render(dt: number): void {
    for (const entry of this.entries) entry.view.update(entry.sim, dt)
  }

  finishers(startIndex: number): readonly FinisherRow[] {
    return this.entries.map((entry, index) => ({
      id: localFinisherId(startIndex + index),
      name: entry.racer.name,
      timeMs: entry.racer.finishedAtMs === null ? null : Math.round(entry.racer.finishedAtMs),
    }))
  }

  dispose(): void {
    for (const entry of this.entries) {
      this.scene.remove(entry.view.group)
      entry.view.dispose()
    }
    this.entries.length = 0
  }
}
