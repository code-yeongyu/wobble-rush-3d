/**
 * Solo scenario: starts a solo race, drives with real keystrokes and asserts
 * the runner actually advances while the race timer ticks.
 */

import type { Browser } from "@playwright/test"
import type { Driver } from "../driver"
import { ScenarioFailure } from "../driver"

export async function runSolo(driver: Driver, browser: Browser): Promise<void> {
  const context = await driver.newContext(browser, "solo")
  const page = await driver.openGame(context)
  await page.fill("#name-input", "Wobbler")
  await page.click("#play-solo")
  await driver.waitFor(page, (s) => s.phase === "racing", 12_000, "race never started")
  const start = await driver.readState(page)
  await driver.humanDrive(page, 6)
  await page.screenshot({ path: `${driver.outDir}/solo-run.png` })
  await driver.humanDrive(page, 6)
  const after = await driver.readState(page)
  if (after.position.z - start.position.z < 8) {
    throw new ScenarioFailure(
      "solo",
      `runner only advanced ${(after.position.z - start.position.z).toFixed(2)} m`,
    )
  }
  if (after.raceMs <= 0) throw new ScenarioFailure("solo", "timer never advanced")
  console.log(
    `solo: advanced ${(after.position.z - start.position.z).toFixed(1)} m, timer ${after.raceMs.toFixed(0)} ms`,
  )
  await driver.finishVideo(context, page, "solo")
}
