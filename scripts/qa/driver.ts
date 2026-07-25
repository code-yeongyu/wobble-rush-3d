/**
 * Shared browser/state/video helpers for the Playwright QA scenarios.
 * A Driver is bound to the CLI options (base URL, output dir, scenario name)
 * so the scenario modules stay free of argument plumbing.
 */

import { mkdir, readdir, rename } from "node:fs/promises"
import type { Browser, BrowserContext, Page } from "@playwright/test"

/** Per-frame extremes recorded in-page so assertions never depend on sample timing. */
export type Peaks = {
  maxY: number
  maxZ: number
  startY: number
  startZ: number
}

declare global {
  /** Injected by the game at boot; see src/client/debug-api.ts. */
  var wobble: { state(): WobbleState; autopilot(value: boolean): void } | undefined
  var __wobblePeaks: Peaks | undefined
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
  /**
   * Drives with real keystrokes the way a player does: forward the whole time,
   * short sidestep taps to weave around a sweeper, regular jumps, occasional
   * dives. Strafe is TAPPED rather than held — now that camera-relative movement
   * is honest, a held sidestep walks straight off the course, which is correct
   * behaviour but makes for a bot that kills itself instead of racing.
   */
  async function humanDrive(page: Page, seconds: number): Promise<void> {
    const end = Date.now() + seconds * 1000
    await page.keyboard.down("KeyW")
    let tick = 0
    while (Date.now() < end) {
      await page.waitForTimeout(300)
      tick += 1
      if (tick % 2 === 0) await page.keyboard.press("Space")
      if (tick % 3 === 0) {
        const sidestep = tick % 6 === 0 ? "KeyA" : "KeyD"
        await page.keyboard.down(sidestep)
        await page.waitForTimeout(170)
        await page.keyboard.up(sidestep)
      }
      if (tick % 11 === 0) {
        await page.keyboard.down("ShiftLeft")
        await page.waitForTimeout(90)
        await page.keyboard.up("ShiftLeft")
      }
    }
    await page.keyboard.up("KeyW")
  }

  /**
   * Records the runner's peak height and furthest progress from inside the page,
   * on every animation frame. Sampling from the test side between drive chunks
   * makes the assertion depend on when the sample happens to land, which is
   * exactly the timing luck a jump-arc assertion must not rely on.
   */
  const trackPeaks = (page: Page): Promise<void> =>
    page.evaluate(() => {
      const api = globalThis.wobble
      if (api === undefined) throw new Error("window.wobble debug API is unavailable")
      const start = api.state().position
      const peaks = { maxY: start.y, maxZ: start.z, startY: start.y, startZ: start.z }
      globalThis.__wobblePeaks = peaks
      const sample = (): void => {
        const current = globalThis.wobble?.state().position
        if (current !== undefined) {
          peaks.maxY = Math.max(peaks.maxY, current.y)
          peaks.maxZ = Math.max(peaks.maxZ, current.z)
        }
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })

  const readPeaks = (page: Page): Promise<Peaks> =>
    page.evaluate(() => {
      const peaks = globalThis.__wobblePeaks
      if (peaks === undefined) throw new Error("peak tracking was never started")
      return peaks
    })

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
    trackPeaks,
    readPeaks,
    setAutopilot,
    finishVideo,
  }
}
