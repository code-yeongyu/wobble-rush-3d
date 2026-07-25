/** Captures the menu panels for contrast checking without running a whole race. */
import { chromium } from "@playwright/test"

const base = Bun.argv[2] ?? "http://localhost:8787"
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(base, { waitUntil: "domcontentloaded" })
await page.waitForSelector("#play-solo")
await page.waitForTimeout(600)
await page.screenshot({ path: "evidence/panel-start.png" })
await page.evaluate(() => {
  const finish = document.querySelector('[data-screen="finish"]')
  const start = document.querySelector('[data-screen="start"]')
  if (finish instanceof HTMLElement && start instanceof HTMLElement) {
    start.hidden = true
    finish.hidden = false
  }
})
await page.waitForTimeout(300)
await page.screenshot({ path: "evidence/panel-finish.png" })
await browser.close()
console.log("captured")
