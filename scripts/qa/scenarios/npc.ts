/**
 * NPC scenario: starts a solo race and asserts at least two NPC racers clear
 * the sweeper section under their own navigation.
 */

import type { Browser } from "@playwright/test"
import type { Driver } from "../driver"
import { ScenarioFailure } from "../driver"

export async function runNpc(driver: Driver, browser: Browser): Promise<void> {
  const context = await driver.newContext(browser, "npc")
  const page = await driver.openGame(context)
  await page.click("#play-solo")
  await driver.waitFor(page, (s) => s.phase === "racing", 12_000, "race never started")
  const before = await driver.readState(page)
  if (before.npcs < 2) throw new ScenarioFailure("npc", `expected NPC racers, found ${before.npcs}`)
  await driver.setAutopilot(page, true)
  const advanced = await driver.waitFor(
    page,
    (s) => s.npcProgress.filter((z) => z > 36).length >= 2,
    120_000,
    "fewer than two NPCs cleared the sweeper section",
  )
  console.log(`npc: progress ${advanced.npcProgress.map((z) => z.toFixed(0)).join(", ")}`)
  await page.screenshot({ path: `${driver.outDir}/npc-race.png` })
  await driver.finishVideo(context, page, "npc")
}
