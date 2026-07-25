/**
 * Shared browser/state/video helpers for the Playwright QA scenarios.
 * A Driver is bound to the CLI options (base URL, output dir, scenario name)
 * so the scenario modules stay free of argument plumbing.
 */

import { mkdir, readdir, rename } from "node:fs/promises"
import type { Browser, BrowserContext, Page } from "@playwright/test"

declare global {
  /** Injected by the game at boot; see src/client/debug-api.ts. */
  var wobble: { state(): WobbleState; autopilot(value: boolean): void } | undefined
}

export type WobbleState = {
  phase: string
  raceMs: number
  worldTimeSec: number
  checkpoint: number
  position: { x: number; y: number; z: number }
  remotes: number
  npcs: number
  npcProgress: number[]
  remoteProgress: number[]
  room: string | null
}

export class ScenarioFailure extends Error {
  constructor(scenario: string, detail: string) {
    super(`scenario "${scenario}" failed: ${detail}`)
    this.name = "ScenarioFailure"
  }
}

export type DriverOptions = {
  readonly base: string
  readonly outDir: string
  readonly scenario: string
}

export type Driver = ReturnType<typeof createDriver>

export function createDriver(options: DriverOptions) {
  const { base, outDir, scenario } = options
  const viewport = { width: 1280, height: 720 }

  async function newContext(browser: Browser, name: string): Promise<BrowserContext> {
    await mkdir(`${outDir}/${name}`, { recursive: true })
    return browser.newContext({
      viewport,
      recordVideo: { dir: `${outDir}/${name}`, size: viewport },
      deviceScaleFactor: 1,
    })
  }

  const readState = (page: Page): Promise<WobbleState> =>
    page.evaluate(() => {
      const api = globalThis.wobble
      if (api === undefined) throw new Error("window.wobble debug API is unavailable")
      return api.state()
    })

  async function waitFor(
    page: Page,
    predicate: (state: WobbleState) => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<WobbleState> {
    const deadline = Date.now() + timeoutMs
    let last: WobbleState | null = null
    while (Date.now() < deadline) {
      last = await readState(page)
      if (predicate(last)) return last
      await page.waitForTimeout(120)
    }
    throw new ScenarioFailure(scenario, `${label} (last state: ${JSON.stringify(last)})`)
  }

  async function openGame(context: BrowserContext): Promise<Page> {
    const page = await context.newPage()
    page.on("pageerror", (error) => console.error("[page error]", error.message))
    await page.goto(base, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("#play-solo", { timeout: 20_000 })
    await page.waitForTimeout(900)
    return page
  }

  /**
   * Drives the runner with real keystrokes so the video shows genuine input:
   * forward the whole time, weaving side to side, jumping and occasionally diving.
   */
  async function humanDrive(page: Page, seconds: number): Promise<void> {
    const end = Date.now() + seconds * 1000
    await page.keyboard.down("KeyW")
    let tick = 0
    let strafe: "KeyA" | "KeyD" | null = null
    while (Date.now() < end) {
      await page.waitForTimeout(360)
      tick += 1
      if (tick % 3 === 0) await page.keyboard.press("Space")
      if (tick % 4 === 0) {
        if (strafe !== null) await page.keyboard.up(strafe)
        strafe = tick % 8 === 0 ? "KeyA" : "KeyD"
        await page.keyboard.down(strafe)
      }
      if (tick % 9 === 0) {
        await page.keyboard.down("ShiftLeft")
        await page.waitForTimeout(90)
        await page.keyboard.up("ShiftLeft")
      }
    }
    if (strafe !== null) await page.keyboard.up(strafe)
    await page.keyboard.up("KeyW")
  }

  const setAutopilot = (page: Page, on: boolean): Promise<void> =>
    page.evaluate((enabled) => {
      const api = globalThis.wobble
      if (api === undefined) throw new Error("window.wobble debug API is unavailable")
      api.autopilot(enabled)
    }, on)

  async function finishVideo(context: BrowserContext, page: Page, name: string): Promise<void> {
    const video = page.video()
    await context.close()
    if (video === null) return
    const path = await video.path()
    await rename(path, `${outDir}/${name}.webm`)
    const leftovers = await readdir(`${outDir}/${name}`).catch(() => [])
    console.log(`video → ${outDir}/${name}.webm (${leftovers.length} temp files left)`)
  }

  return {
    base,
    outDir,
    viewport,
    newContext,
    readState,
    waitFor,
    openGame,
    humanDrive,
    setAutopilot,
    finishVideo,
  }
}
