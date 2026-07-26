/**
 * Collapses duplicate presentation cues that arrive in a burst.
 *
 * Defence in depth: the simulation aims to emit exactly one event per
 * collision, but if several identical events land in the same frame or in
 * adjacent frames the player must still get ONE impact — one sound, one
 * particle burst, one shake. A key that fired inside the window is dropped.
 */
export class CueGuard {
  private readonly lastFired = new Map<string, number>()

  constructor(private readonly windowSec: number) {}

  /** True the first time `key` fires inside a window; false for repeats. */
  allow(key: string, nowSec: number): boolean {
    const last = this.lastFired.get(key)
    if (last !== undefined && nowSec - last < this.windowSec) return false
    this.lastFired.set(key, nowSec)
    return true
  }
}
