/**
 * Remote players: roster sync plus buffered interpolation so other runners move
 * smoothly despite a 15 Hz update rate.
 */

import * as THREE from "three"
import { NET } from "../shared/constants"
import { RUNNER_COLORS } from "../shared/course"
import type { RemoteRunnerState, RoomSnapshot } from "../shared/room"
import type { CheckpointIndex, PlayerId, RunnerSim } from "../shared/types"
import { RunnerView } from "./runner-view"

type Sample = { readonly state: RemoteRunnerState; readonly atMs: number }
type Entry = { readonly view: RunnerView; readonly buffer: Sample[] }

const BUFFER_LIMIT = 8

export class RemoteRunners {
  private readonly scene: THREE.Scene
  private readonly entries = new Map<PlayerId, Entry>()

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  get count(): number {
    return this.entries.size
  }

  /** Furthest-forward Z of every remote runner, for placement display. */
  progress(): number[] {
    return [...this.entries.values()].map(
      (entry) => entry.buffer.at(-1)?.state.p[2] ?? Number.NEGATIVE_INFINITY,
    )
  }

  sync(snapshot: RoomSnapshot, selfId: PlayerId | null): void {
    const alive = new Set<PlayerId>()
    for (const player of snapshot.players) {
      if (player.id === selfId) continue
      alive.add(player.id)
      if (this.entries.has(player.id)) continue
      const color = RUNNER_COLORS[player.colorIndex % RUNNER_COLORS.length] ?? RUNNER_COLORS[0]
      const view = new RunnerView(color, player.name)
      this.scene.add(view.group)
      this.entries.set(player.id, { view, buffer: [] })
    }
    for (const [id, entry] of this.entries) {
      if (alive.has(id)) continue
      this.remove(id, entry)
    }
  }

  push(states: readonly RemoteRunnerState[], selfId: PlayerId | null, nowMs: number): void {
    for (const state of states) {
      if (state.id === selfId) continue
      const entry = this.entries.get(state.id)
      if (entry === undefined) continue
      entry.buffer.push({ state, atMs: nowMs })
      if (entry.buffer.length > BUFFER_LIMIT) entry.buffer.shift()
    }
  }

  render(nowMs: number, dt: number): void {
    const renderAt = nowMs - NET.interpolationDelaySec * 1000
    for (const entry of this.entries.values()) {
      const pair = pickPair(entry.buffer, renderAt)
      if (pair === null) continue
      const [older, newer] = pair
      const span = newer.atMs - older.atMs
      const alpha = span <= 0 ? 1 : THREE.MathUtils.clamp((renderAt - older.atMs) / span, 0, 1)
      entry.view.update(toSim(older.state, newer.state, alpha), dt)
    }
  }

  clear(): void {
    for (const [id, entry] of this.entries) this.remove(id, entry)
  }

  private remove(id: PlayerId, entry: Entry): void {
    this.scene.remove(entry.view.group)
    entry.view.dispose()
    this.entries.delete(id)
  }
}

function pickPair(buffer: readonly Sample[], renderAt: number): readonly [Sample, Sample] | null {
  if (buffer.length === 0) return null
  const first = buffer[0]
  const last = buffer[buffer.length - 1]
  if (first === undefined || last === undefined) return null
  for (let index = 0; index < buffer.length - 1; index += 1) {
    const a = buffer[index]
    const b = buffer[index + 1]
    if (a === undefined || b === undefined) continue
    if (a.atMs <= renderAt && b.atMs >= renderAt) return [a, b]
  }
  return [first, last]
}

/** Remote runners are rendered from a synthesised sim; only visual fields matter. */
function toSim(older: RemoteRunnerState, newer: RemoteRunnerState, alpha: number): RunnerSim {
  const lerp = (a: number, b: number): number => a + (b - a) * alpha
  return {
    position: {
      x: lerp(older.p[0], newer.p[0]),
      y: lerp(older.p[1], newer.p[1]),
      z: lerp(older.p[2], newer.p[2]),
    },
    velocity: { x: newer.v[0], y: newer.v[1], z: newer.v[2] },
    yaw: newer.yaw,
    grounded: newer.st !== "air" && newer.st !== "dive",
    timeSinceGrounded: 0,
    jumpBuffer: 0,
    diveTimer: newer.st === "dive" ? 1 : 0,
    diveCooldown: 0,
    stumbleTimer: newer.st === "stumble" ? 1 : 0,
    jumpRising: false,
    state: newer.st,
    checkpoint: newer.cp as CheckpointIndex,
    carry: { x: 0, y: 0, z: 0 },
  }
}
