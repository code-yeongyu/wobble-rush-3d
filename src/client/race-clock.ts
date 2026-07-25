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
  private worldSec = 0

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

  /**
   * Time fed to obstacle kinematics and the NPC brains.
   *
   * Anchored to the countdown rather than to page load: every client in a party
   * is told the same countdown by the server, so they all drive the world from
   * the same clock and see identical sweepers, platforms and AI trajectories.
   */
  get worldTimeSec(): number {
    return this.worldSec
  }

  /**
   * `worldStartSec` is how much of the countdown has already elapsed on the
   * server, so a client that joins the countdown late still lines up.
   */
  beginCountdown(seconds: number, worldStartSec = 0): void {
    this.state = "countdown"
    this.countdown = seconds
    this.elapsedMs = 0
    this.worldSec = Math.max(0, worldStartSec)
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
    this.worldSec = 0
  }

  /**
   * Advances one fixed step. Returns the countdown label to display (null once the
   * countdown is over) and whether the race just started locally.
   */
  tick(
    dt: number,
    autoStart: boolean,
  ): { readonly label: string | null; readonly started: boolean } {
    if (this.state !== "idle") this.worldSec += dt
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
