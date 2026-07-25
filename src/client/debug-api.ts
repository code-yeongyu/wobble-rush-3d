/**
 * `window.wobble` — the inspection surface automated QA drives.
 *
 * `autopilot` hands the local runner to the same NPC brain the AI racers use, so a
 * recorded QA run still exercises the real simulation: physics, obstacles, checkpoints
 * and the finish trigger all apply. Nothing here teleports, disables collision or skips
 * any part of the course.
 */

export type WobbleSnapshot = {
  readonly phase: string
  readonly raceMs: number
  readonly checkpoint: number
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly remotes: number
  readonly npcs: number
  readonly npcProgress: readonly number[]
  readonly room: string | null
}

export type WobbleDebugApi = {
  state(): WobbleSnapshot
  autopilot(enabled: boolean): void
}

export function installDebugApi(api: WobbleDebugApi): void {
  Object.defineProperty(globalThis, "wobble", { value: api, configurable: true })
}
