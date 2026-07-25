/**
 * Fixed-timestep loop with a capped substep budget.
 *
 * Simulation always advances in whole `FIXED_STEP_SEC` slices so jump arcs and
 * obstacle timing are identical on every machine; rendering happens once per frame.
 * When a frame stalls, the step budget caps the catch-up instead of spiralling.
 */

import { FIXED_STEP_SEC, MAX_STEPS_PER_FRAME } from "../shared/constants"

const MAX_FRAME_SEC = 0.25

export class FrameLoop {
  private readonly step: (dt: number) => void
  private readonly draw: (dt: number, nowMs: number) => void
  private accumulator = 0
  private lastMs = 0
  private handle = 0

  constructor(step: (dt: number) => void, draw: (dt: number, nowMs: number) => void) {
    this.step = step
    this.draw = draw
  }

  start(): void {
    this.lastMs = performance.now()
    const frame = (nowMs: number): void => {
      this.handle = globalThis.requestAnimationFrame(frame)
      const elapsed = Math.min(MAX_FRAME_SEC, (nowMs - this.lastMs) / 1000)
      this.lastMs = nowMs
      this.accumulator += elapsed

      let steps = 0
      while (this.accumulator >= FIXED_STEP_SEC && steps < MAX_STEPS_PER_FRAME) {
        this.step(FIXED_STEP_SEC)
        this.accumulator -= FIXED_STEP_SEC
        steps += 1
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0

      this.draw(elapsed, nowMs)
    }
    this.handle = globalThis.requestAnimationFrame(frame)
  }

  stop(): void {
    globalThis.cancelAnimationFrame(this.handle)
  }
}
