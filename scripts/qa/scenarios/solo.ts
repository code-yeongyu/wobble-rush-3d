/**
 * Solo scenario: starts a solo race, drives with real keystrokes, and asserts
 * the three things the controls criterion actually claims — the runner travels
 * down the course, it leaves the ground when Space is pressed, and the race
 * timer runs.
 *
 * Progress is measured as the furthest point reached, not the final position:
 * sweepers knock a runner backwards on purpose, and that is the obstacle
 * criterion doing its job, not a movement failure.
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

  const start = await driver.readState(page)
  let furthestZ = start.position.z
  let highestY = start.position.y

  const driveChunk = async (seconds: number): Promise<void> => {
    await driver.humanDrive(page, seconds)
    const sample = await driver.readState(page)
    furthestZ = Math.max(furthestZ, sample.position.z)
    highestY = Math.max(highestY, sample.position.y)
  }

  // Short chunks so the samples catch the runner mid-arc rather than only at rest.
  for (let chunk = 0; chunk < 8; chunk += 1) {
    await driveChunk(1.5)
    if (chunk === 3) await page.screenshot({ path: `${driver.outDir}/solo-run.png` })
  }

  const advanced = furthestZ - start.position.z
  if (advanced < MIN_ADVANCE_M) {
    throw new ScenarioFailure(
      "solo",
      `runner only reached ${advanced.toFixed(2)} m down the course`,
    )
  }
  if (highestY - start.position.y < MIN_JUMP_HEIGHT_M) {
    throw new ScenarioFailure(
      "solo",
      `runner never left the ground (peak ${(highestY - start.position.y).toFixed(2)} m)`,
    )
  }
  const after = await driver.readState(page)
  if (after.raceMs <= 0) throw new ScenarioFailure("solo", "timer never advanced")

  console.log(
    `solo: reached ${advanced.toFixed(1)} m, peak jump ${(highestY - start.position.y).toFixed(2)} m, timer ${after.raceMs.toFixed(0)} ms`,
  )
  await driver.finishVideo(context, page, "solo")
}
