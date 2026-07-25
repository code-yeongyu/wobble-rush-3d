/**
 * Error scenario: blocks the bundle request and asserts the boot-failure
 * screen renders with the expected copy.
 */

import type { Browser } from "@playwright/test"
import type { Driver } from "../driver"
import { ScenarioFailure } from "../driver"

export async function runError(driver: Driver, browser: Browser): Promise<void> {
  const context = await browser.newContext({ viewport: driver.viewport })
  const page = await context.newPage()
  await page.route("**/assets/main.js", (route) => route.abort())
  await page.goto(driver.base, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#boot-error", { timeout: 15_000 })
  const text = (await page.textContent("#boot-error")) ?? ""
  if (!text.includes("failed to load"))
    throw new ScenarioFailure("error", `unexpected error text: ${text}`)
  await page.screenshot({ path: `${driver.outDir}/error-screen.png` })
  console.log("error: boot failure screen rendered")
  await context.close()
}
