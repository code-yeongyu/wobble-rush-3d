/**
 * The race clock also owns the world clock.
 *
 * Obstacle kinematics and the seeded NPC pack are both pure functions of a time
 * value. If two clients feed them different times, they render different
 * sweeper angles and different NPC trajectories for the same race — so the
 * clock has to be anchored to the server's countdown, not to page load.
 */

import { describe, expect, test } from "bun:test"
import { RaceClock } from "../src/client/race-clock"

const STEP = 1 / 60

function advance(clock: RaceClock, seconds: number, autoStart = false): void {
  for (let step = 0; step < Math.round(seconds / STEP); step += 1) clock.tick(STEP, autoStart)
}

describe("world clock", () => {
  test("a fresh clock starts the world at zero", () => {
    const clock = new RaceClock()
    expect(clock.worldTimeSec).toBe(0)
  })

  test("the world clock advances during the countdown so obstacles are already moving", () => {
    const clock = new RaceClock()
    clock.beginCountdown(3)
    advance(clock, 1)
    expect(clock.worldTimeSec).toBeCloseTo(1, 5)
  })

  test("two clients that enter the countdown at different moments share one world clock", () => {
    // The host enters the countdown first; 1.2 s later a guest is told the
    // countdown has 1.8 s left. From that moment they run in lockstep, and at
    // any shared wall-clock instant their world clocks must agree.
    const host = new RaceClock()
    host.beginCountdown(3, 0)
    advance(host, 1.2)

    const guest = new RaceClock()
    guest.beginCountdown(1.8, 1.2)

    advance(host, 1.8)
    advance(guest, 1.8)

    expect(guest.worldTimeSec).toBeCloseTo(host.worldTimeSec, 5)
  })

  test("the world clock never runs backwards into negative time", () => {
    const clock = new RaceClock()
    clock.beginCountdown(3, 0)
    advance(clock, 0.5)
    expect(clock.worldTimeSec).toBeGreaterThanOrEqual(0)
  })

  test("returning to idle rewinds the world clock for the next race", () => {
    const clock = new RaceClock()
    clock.beginCountdown(3)
    advance(clock, 2)
    clock.idle()
    expect(clock.worldTimeSec).toBe(0)
  })

  test("the world clock keeps running once the race starts", () => {
    const clock = new RaceClock()
    clock.beginCountdown(0.5)
    advance(clock, 1, true)
    expect(clock.phase).toBe("racing")
    advance(clock, 1, true)
    expect(clock.worldTimeSec).toBeCloseTo(2, 5)
  })
})
