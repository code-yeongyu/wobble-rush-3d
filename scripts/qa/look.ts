/** Ad-hoc visual check: capture the game at a few moments for eyeballing. */
import { chromium } from "@playwright/test"

const base = Bun.argv[2] ?? "http://localhost:8787"
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(base, { waitUntil: "domcontentloaded" })
await page.waitForSelector("#play-solo")
await page.waitForTimeout(700)
await page.screenshot({ path: "evidence/look-start-screen.png" })
await page.click("#play-solo")
await page.waitForTimeout(1200)
await page.screenshot({ path: "evidence/look-countdown.png" })
await page.waitForTimeout(2600)
await page.screenshot({ path: "evidence/look-race-begin.png" })
await page.evaluate(() => {
  const api = (globalThis as unknown as { wobble?: { autopilot(value: boolean): void } }).wobble
  if (api === undefined) throw new Error("window.wobble debug API is unavailable")
  api.autopilot(true)
})
await page.waitForTimeout(6000)
await page.screenshot({ path: "evidence/look-sweepers.png" })
await page.waitForTimeout(9000)
await page.screenshot({ path: "evidence/look-hopchain.png" })
await page.waitForTimeout(12000)
await page.screenshot({ path: "evidence/look-bumpers.png" })
await page.waitForTimeout(14000)
await page.screenshot({ path: "evidence/look-bridge.png" })
await browser.close()
console.log("captured")
