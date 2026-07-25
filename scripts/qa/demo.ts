/**
 * Playwright demo/QA driver. Records a video per scenario into ./evidence.
 *
 * Usage: bun run scripts/qa/demo.ts --scenario solo --base http://localhost:8787
 * Scenarios: solo | respawn | npc | multiplayer | error
 *
 * Every scenario asserts a binary observable and exits non-zero when it fails,
 * so a recorded video always corresponds to a checked outcome.
 */

import { mkdir } from "node:fs/promises"
import type { Browser } from "@playwright/test"
import { chromium } from "@playwright/test"
import type { Driver } from "./driver"
import { createDriver } from "./driver"
import { runError } from "./scenarios/error"
import { runMultiplayer } from "./scenarios/multiplayer"
import { runNpc } from "./scenarios/npc"
import { runRespawn } from "./scenarios/respawn"
import { runSolo } from "./scenarios/solo"

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

const SCENARIOS: Record<string, (driver: Driver, browser: Browser) => Promise<void>> = {
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
  const driver = createDriver({ base, outDir, scenario })
  const browser = await chromium.launch({
    headless,
    args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
  })
  try {
    await run(driver, browser)
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
