/**
 * Respawn scenario: captures a checkpoint, falls off the course on purpose,
 * proves the respawn, then finishes and restarts the race.
 */

import type { Browser } from "@playwright/test"
import type { Driver } from "../driver"
import { ScenarioFailure } from "../driver"

export async function runRespawn(driver: Driver, browser: Browser): Promise<void> {
  const context = await driver.newContext(browser, "respawn")
  const page = await driver.openGame(context)
  await page.click("#play-solo")
  await driver.waitFor(page, (s) => s.phase === "racing", 12_000, "race never started")

  // Reach at least one checkpoint under autopilot, then deliberately run off the edge.
  await driver.setAutopilot(page, true)
  const reached = await driver.waitFor(
    page,
    (s) => s.checkpoint >= 1,
    90_000,
    "never reached checkpoint 1",
  )
  console.log(`respawn: checkpoint ${reached.checkpoint} reached`)
  await driver.setAutopilot(page, false)

  await page.keyboard.down("KeyD")
  await page.keyboard.down("KeyW")
  const fell = await driver.waitFor(
    page,
    (s) => s.position.y < -2,
    20_000,
    "runner never fell off the course",
  )
  console.log(`respawn: fell to y=${fell.position.y.toFixed(1)}`)
  await page.keyboard.up("KeyD")
  await page.keyboard.up("KeyW")

  const recovered = await driver.waitFor(
    page,
    (s) => s.position.y > 0.4,
    8_000,
    "runner never respawned",
  )
  if (recovered.checkpoint < 1)
    throw new ScenarioFailure("respawn", "respawned before the captured checkpoint")
  await page.screenshot({ path: `${driver.outDir}/respawn.png` })

  // Now finish the course and prove the finish + restart flow.
  await driver.setAutopilot(page, true)
  await driver.waitFor(page, (s) => s.phase === "finished", 180_000, "never finished the course")
  await page.waitForSelector('[data-screen="finish"]:not([hidden])', { timeout: 10_000 })
  const finishTime = await page.textContent("#finish-time")
  await page.screenshot({ path: `${driver.outDir}/finish-screen.png` })
  console.log(`respawn: finished with ${finishTime ?? "?"}`)
  if (finishTime === null || finishTime === "00:00.000")
    throw new ScenarioFailure("respawn", "finish time not displayed")

  await driver.setAutopilot(page, false)
  await page.click("#restart-btn")
  const restarted = await driver.waitFor(
    page,
    (s) => s.phase === "countdown" || s.phase === "racing",
    10_000,
    "restart did not start a new race",
  )
  if (restarted.raceMs > 2000)
    throw new ScenarioFailure("respawn", "timer did not reset on restart")
  await page.screenshot({ path: `${driver.outDir}/restart.png` })
  await driver.finishVideo(context, page, "respawn")
}
