/**
 * The player's own runner: simulation state, its mesh, and the optional autopilot.
 *
 * Autopilot hands control to the same NPC brain the AI racers use, which is what lets
 * automated QA drive a genuine run without faking physics or skipping the course.
 */

import type * as THREE from "three"
import type { NpcRacer } from "../shared/npc"
import { createNpcRacers, npcInput, updateNpcProgress } from "../shared/npc"
import { createRunner, respawnRunner, stepRunner } from "../shared/player"
import type {
  CheckpointIndex,
  CourseDefinition,
  PlayerInput,
  RunnerSim,
  SimEvent,
  Vec3,
  WorldSnapshot,
} from "../shared/types"
import { RunnerView } from "./runner-view"

const AUTOPILOT_SEED = 7

export class LocalRunner {
  readonly sim: RunnerSim
  private readonly scene: THREE.Scene
  private readonly course: CourseDefinition
  private view: RunnerView
  private pilot: NpcRacer | null = null

  constructor(scene: THREE.Scene, course: CourseDefinition, color: string) {
    this.scene = scene
    this.course = course
    this.sim = createRunner(course.spawn, course.spawnYaw)
    this.view = new RunnerView(color)
    scene.add(this.view.group)
  }

  get autopilotActive(): boolean {
    return this.pilot !== null
  }

  setAutopilot(enabled: boolean): void {
    this.pilot = enabled ? (createNpcRacers(this.course, AUTOPILOT_SEED, 1)[0] ?? null) : null
  }

  setColor(color: string): void {
    this.scene.remove(this.view.group)
    this.view.dispose()
    this.view = new RunnerView(color)
    this.scene.add(this.view.group)
  }

  /** Respawn point for the checkpoint this runner has captured. */
  respawnPoint(): Vec3 {
    return (
      this.course.checkpoints.find((entry) => entry.index === this.sim.checkpoint)?.respawn ??
      this.course.spawn
    )
  }

  reset(checkpoint: CheckpointIndex): void {
    respawnRunner(this.sim, this.course.spawn)
    this.sim.checkpoint = checkpoint
  }

  respawn(): void {
    respawnRunner(this.sim, this.respawnPoint())
  }

  /** One fixed step. `manual` is used unless the autopilot has taken over. */
  step(
    world: WorldSnapshot,
    timeSec: number,
    dt: number,
    manual: PlayerInput,
  ): readonly SimEvent[] {
    const pilot = this.pilot
    const input = pilot === null ? manual : npcInput(pilot, this.sim, this.course, world, timeSec)
    const events = stepRunner(this.sim, input, world, dt, this.respawnPoint())
    if (pilot !== null) updateNpcProgress(pilot, this.sim, this.course, dt)
    return events
  }

  render(dt: number): void {
    this.view.update(this.sim, dt)
  }

  dispose(): void {
    this.scene.remove(this.view.group)
    this.view.dispose()
  }
}
