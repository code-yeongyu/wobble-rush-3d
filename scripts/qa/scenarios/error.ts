/**
 * Error scenario: blocks the bundle request and asserts the boot-failure
 * screen renders with the expected copy.
 */

import type { Browser } from "@playwright/test"
import type { Driver } from "../driver"
import { ScenarioFailure } from "../driver"

/** Blocks one asset and asserts the page says so out loud. */
async function assertFailureScreen(
  driver: Driver,
  browser: Browser,
  blocked: string,
  label: string,
  shot: string,
): Promise<void> {
  const context = await browser.newContext({ viewport: driver.viewport })
  const page = await context.newPage()
  await page.route(blocked, (route) => route.abort())
  await page.goto(driver.base, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#boot-error", { timeout: 15_000 })
  const text = (await page.textContent("#boot-error")) ?? ""
  if (!text.includes("failed to load")) {
    throw new ScenarioFailure("error", `${label}: unexpected error text: ${text}`)
  }
  await page.screenshot({ path: `${driver.outDir}/${shot}` })
  console.log(`error: ${label} failure screen rendered`)
  await context.close()
}

export async function runError(driver: Driver, browser: Browser): Promise<void> {
  await assertFailureScreen(driver, browser, "**/assets/main.js", "bundle", "error-screen.png")
  await assertFailureScreen(
    driver,
    browser,
    "**/assets/style.css",
    "stylesheet",
    "error-screen-css.png",
  )
}
