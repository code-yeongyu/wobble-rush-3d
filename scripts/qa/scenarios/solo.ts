/**
 * Solo scenario: starts a solo race, drives with real keystrokes, and asserts
 * the three things the controls criterion actually claims — the runner travels
 * down the course, it leaves the ground when Space is pressed, and the race
 * timer runs.
 *
 * Progress is measured as the furthest point reached, not the final position:
 * sweepers knock a runner backwards on purpose, and that is the obstacle
 * criterion doing its job, not a movement failure. Both extremes are recorded
 * frame by frame inside the page, so no assertion depends on when a sample
 * happens to land relative to a jump arc.
 */

import type { Browser } from "@playwright/test"
import type { Driver } from "../driver"
import { ScenarioFailure } from "../driver"

const MIN_ADVANCE_M = 8
const MIN_JUMP_HEIGHT_M = 0.5

export async function runSolo(driver: Driver, browser: Browser): Promise<void> {
  const context = await driver.newContext(browser, "solo")
  const page = await driver.openGame(context)
  await page.fill("#name-input", "Wobbler")
  await page.click("#play-solo")
  await driver.waitFor(page, (s) => s.phase === "racing", 12_000, "race never started")

  await driver.trackPeaks(page)
  for (let chunk = 0; chunk < 8; chunk += 1) {
    await driver.humanDrive(page, 1.5)
    if (chunk === 3) await page.screenshot({ path: `${driver.outDir}/solo-run.png` })
  }

  const peaks = await driver.readPeaks(page)
  const advanced = peaks.maxZ - peaks.startZ
  // The arc between the lowest and highest point, not a difference against a
  // baseline sampled at an arbitrary moment: `trackPeaks` can start while the
  // runner is still settling onto the deck, which made a real jump read as none.
  const jumped = peaks.maxY - peaks.minY
  if (advanced < MIN_ADVANCE_M) {
    throw new ScenarioFailure(
      "solo",
      `runner only reached ${advanced.toFixed(2)} m down the course`,
    )
  }
  if (jumped < MIN_JUMP_HEIGHT_M) {
    throw new ScenarioFailure("solo", `runner never left the ground (peak ${jumped.toFixed(2)} m)`)
  }
  const after = await driver.readState(page)
  if (after.raceMs <= 0) throw new ScenarioFailure("solo", "timer never advanced")

  console.log(
    `solo: reached ${advanced.toFixed(1)} m, peak jump ${jumped.toFixed(2)} m, timer ${after.raceMs.toFixed(0)} ms`,
  )
  await driver.finishVideo(context, page, "solo")
}
