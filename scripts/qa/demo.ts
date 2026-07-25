/**
 * Playwright demo/QA driver. Records a video per scenario into ./evidence.
 *
 * Usage: bun run scripts/qa/demo.ts --scenario solo --base http://localhost:8787
 * Scenarios: solo | respawn | npc | multiplayer | error
 *
 * Every scenario asserts a binary observable and exits non-zero when it fails,
 * so a recorded video always corresponds to a checked outcome.
 */

import { mkdir, readdir, rename } from "node:fs/promises"
import type { Browser, BrowserContext, Page } from "@playwright/test"
import { chromium } from "@playwright/test"

type WobbleState = {
  phase: string
  raceMs: number
  checkpoint: number
  position: { x: number; y: number; z: number }
  remotes: number
  npcs: number
  npcProgress: number[]
  room: string | null
}

class ScenarioFailure extends Error {
  constructor(scenario: string, detail: string) {
    super(`scenario "${scenario}" failed: ${detail}`)
    this.name = "ScenarioFailure"
  }
}

const args = new Map<string, string>()
for (let index = 2; index < Bun.argv.length; index += 2) {
  const key = Bun.argv[index]
  const value = Bun.argv[index + 1]
  if (key !== undefined && value !== undefined) args.set(key.replace(/^--/, ""), value)
}
const scenario = args.get("scenario") ?? "solo"
const base = args.get("base") ?? "http://localhost:8787"
const outDir = args.get("out") ?? "evidence"
const headless = args.get("headed") !== "true"

const VIEWPORT = { width: 1280, height: 720 }

async function newContext(browser: Browser, name: string): Promise<BrowserContext> {
  await mkdir(`${outDir}/${name}`, { recursive: true })
  return browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: `${outDir}/${name}`, size: VIEWPORT },
    deviceScaleFactor: 1,
  })
}

const readState = (page: Page): Promise<WobbleState> =>
  page.evaluate(() => {
    const api = (globalThis as unknown as { wobble?: { state(): WobbleState } }).wobble
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
    const api = (globalThis as unknown as { wobble?: { autopilot(value: boolean): void } }).wobble
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

async function runSolo(browser: Browser): Promise<void> {
  const context = await newContext(browser, "solo")
  const page = await openGame(context)
  await page.fill("#name-input", "Wobbler")
  await page.click("#play-solo")
  await waitFor(page, (s) => s.phase === "racing", 12_000, "race never started")
  const start = await readState(page)
  await humanDrive(page, 6)
  await page.screenshot({ path: `${outDir}/solo-run.png` })
  await humanDrive(page, 6)
  const after = await readState(page)
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
  await finishVideo(context, page, "solo")
}

async function runRespawn(browser: Browser): Promise<void> {
  const context = await newContext(browser, "respawn")
  const page = await openGame(context)
  await page.click("#play-solo")
  await waitFor(page, (s) => s.phase === "racing", 12_000, "race never started")

  // Reach at least one checkpoint under autopilot, then deliberately run off the edge.
  await setAutopilot(page, true)
  const reached = await waitFor(
    page,
    (s) => s.checkpoint >= 1,
    90_000,
    "never reached checkpoint 1",
  )
  console.log(`respawn: checkpoint ${reached.checkpoint} reached`)
  await setAutopilot(page, false)

  await page.keyboard.down("KeyD")
  await page.keyboard.down("KeyW")
  const fell = await waitFor(
    page,
    (s) => s.position.y < -2,
    20_000,
    "runner never fell off the course",
  )
  console.log(`respawn: fell to y=${fell.position.y.toFixed(1)}`)
  await page.keyboard.up("KeyD")
  await page.keyboard.up("KeyW")

  const recovered = await waitFor(page, (s) => s.position.y > 0.4, 8_000, "runner never respawned")
  if (recovered.checkpoint < 1)
    throw new ScenarioFailure("respawn", "respawned before the captured checkpoint")
  await page.screenshot({ path: `${outDir}/respawn.png` })

  // Now finish the course and prove the finish + restart flow.
  await setAutopilot(page, true)
  await waitFor(page, (s) => s.phase === "finished", 180_000, "never finished the course")
  await page.waitForSelector('[data-screen="finish"]:not([hidden])', { timeout: 10_000 })
  const finishTime = await page.textContent("#finish-time")
  await page.screenshot({ path: `${outDir}/finish-screen.png` })
  console.log(`respawn: finished with ${finishTime ?? "?"}`)
  if (finishTime === null || finishTime === "00:00.000")
    throw new ScenarioFailure("respawn", "finish time not displayed")

  await setAutopilot(page, false)
  await page.click("#restart-btn")
  const restarted = await waitFor(
    page,
    (s) => s.phase === "countdown" || s.phase === "racing",
    10_000,
    "restart did not start a new race",
  )
  if (restarted.raceMs > 2000)
    throw new ScenarioFailure("respawn", "timer did not reset on restart")
  await page.screenshot({ path: `${outDir}/restart.png` })
  await finishVideo(context, page, "respawn")
}

async function runNpc(browser: Browser): Promise<void> {
  const context = await newContext(browser, "npc")
  const page = await openGame(context)
  await page.click("#play-solo")
  await waitFor(page, (s) => s.phase === "racing", 12_000, "race never started")
  const before = await readState(page)
  if (before.npcs < 2) throw new ScenarioFailure("npc", `expected NPC racers, found ${before.npcs}`)
  await setAutopilot(page, true)
  const advanced = await waitFor(
    page,
    (s) => s.npcProgress.filter((z) => z > 36).length >= 2,
    120_000,
    "fewer than two NPCs cleared the sweeper section",
  )
  console.log(`npc: progress ${advanced.npcProgress.map((z) => z.toFixed(0)).join(", ")}`)
  await page.screenshot({ path: `${outDir}/npc-race.png` })
  await finishVideo(context, page, "npc")
}

async function runMultiplayer(browser: Browser): Promise<void> {
  const hostContext = await newContext(browser, "multiplayer-host")
  const guestContext = await newContext(browser, "multiplayer-guest")
  const host = await openGame(hostContext)
  const guest = await openGame(guestContext)

  await host.fill("#name-input", "Pip")
  await host.click("#play-online")
  await host.waitForSelector('[data-screen="lobby"]:not([hidden])', { timeout: 20_000 })
  const code = (await host.textContent("#room-code"))?.trim() ?? ""
  if (code.length !== 4) throw new ScenarioFailure("multiplayer", `invalid room code "${code}"`)
  console.log(`multiplayer: room ${code}`)

  await guest.fill("#name-input", "Bramble")
  await guest.fill("#room-input", code)
  await guest.click("#play-online")
  await guest.waitForSelector('[data-screen="lobby"]:not([hidden])', { timeout: 20_000 })
  await host.waitForFunction(
    () => document.querySelectorAll("#player-list .player").length >= 2,
    undefined,
    { timeout: 20_000 },
  )
  await host.screenshot({ path: `${outDir}/multiplayer-lobby.png` })

  await host.click("#ready-btn")
  await guest.click("#ready-btn")
  await waitFor(host, (s) => s.phase === "racing", 30_000, "host race never started")
  await waitFor(guest, (s) => s.phase === "racing", 30_000, "guest race never started")

  await setAutopilot(host, true)
  await setAutopilot(guest, true)
  const seen = await waitFor(host, (s) => s.remotes >= 1, 25_000, "host never saw the guest avatar")
  await waitFor(guest, (s) => s.remotes >= 1, 25_000, "guest never saw the host avatar")
  console.log(`multiplayer: host sees ${seen.remotes} remote runner(s)`)
  await host.waitForTimeout(9000)
  await host.screenshot({ path: `${outDir}/multiplayer-host.png` })
  await guest.screenshot({ path: `${outDir}/multiplayer-guest.png` })

  await finishVideo(hostContext, host, "multiplayer-host")
  await finishVideo(guestContext, guest, "multiplayer-guest")
}

async function runError(browser: Browser): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await context.newPage()
  await page.route("**/assets/main.js", (route) => route.abort())
  await page.goto(base, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#boot-error", { timeout: 15_000 })
  const text = (await page.textContent("#boot-error")) ?? ""
  if (!text.includes("failed to load"))
    throw new ScenarioFailure("error", `unexpected error text: ${text}`)
  await page.screenshot({ path: `${outDir}/error-screen.png` })
  console.log("error: boot failure screen rendered")
  await context.close()
}

const SCENARIOS: Record<string, (browser: Browser) => Promise<void>> = {
  solo: runSolo,
  respawn: runRespawn,
  npc: runNpc,
  multiplayer: runMultiplayer,
  error: runError,
}

// no-excuse-ok: catch — CLI boundary
async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true })
  const run = SCENARIOS[scenario]
  if (run === undefined)
    throw new Error(`unknown scenario "${scenario}" (have: ${Object.keys(SCENARIOS).join(", ")})`)
  const browser = await chromium.launch({
    headless,
    args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
  })
  try {
    await run(browser)
  } finally {
    await browser.close()
  }
  console.log(`scenario ${scenario}: PASS`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
