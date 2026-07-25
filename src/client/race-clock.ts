/**
 * The race state machine: countdown, running timer, finish.
 * Kept separate from Game so the phase rules read as one small table.
 */

export const RACE_PHASES = ["idle", "countdown", "racing", "finished"] as const
export type RacePhase = (typeof RACE_PHASES)[number]

export class RaceClock {
  private state: RacePhase = "idle"
  private elapsedMs = 0
  private countdown = 0

  get phase(): RacePhase {
    return this.state
  }

  get raceMs(): number {
    return this.elapsedMs
  }

  /** True whenever player input must be ignored. */
  get locked(): boolean {
    return this.state !== "racing"
  }

  beginCountdown(seconds: number): void {
    this.state = "countdown"
    this.countdown = seconds
    this.elapsedMs = 0
  }

  /** Server-driven races skip the local countdown and start on command. */
  startRacing(): void {
    this.state = "racing"
  }

  finish(): void {
    this.state = "finished"
  }

  idle(): void {
    this.state = "idle"
    this.elapsedMs = 0
  }

  /**
   * Advances one fixed step. Returns the countdown label to display (null once the
   * countdown is over) and whether the race just started locally.
   */
  tick(
    dt: number,
    autoStart: boolean,
  ): { readonly label: string | null; readonly started: boolean } {
    if (this.state === "countdown") {
      this.countdown -= dt
      if (this.countdown > 0) return { label: String(Math.ceil(this.countdown)), started: false }
      if (autoStart) {
        this.state = "racing"
        return { label: "GO!", started: true }
      }
      return { label: "GO!", started: false }
    }
    if (this.state === "racing") {
      this.elapsedMs += dt * 1000
      return { label: null, started: false }
    }
    return { label: null, started: false }
  }
}
