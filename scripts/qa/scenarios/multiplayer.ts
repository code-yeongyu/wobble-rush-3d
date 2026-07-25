/**
 * Multiplayer scenario: host creates a room, guest joins by code, both ready
 * up and each asserts it can see the other's avatar during the race.
 */

import type { Browser } from "@playwright/test"
import type { Driver } from "../driver"
import { ScenarioFailure } from "../driver"

export async function runMultiplayer(driver: Driver, browser: Browser): Promise<void> {
  const hostContext = await driver.newContext(browser, "multiplayer-host")
  const guestContext = await driver.newContext(browser, "multiplayer-guest")
  const host = await driver.openGame(hostContext)
  const guest = await driver.openGame(guestContext)

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
  await host.screenshot({ path: `${driver.outDir}/multiplayer-lobby.png` })

  await host.click("#ready-btn")
  await guest.click("#ready-btn")
  await driver.waitFor(host, (s) => s.phase === "racing", 30_000, "host race never started")
  await driver.waitFor(guest, (s) => s.phase === "racing", 30_000, "guest race never started")

  await driver.setAutopilot(host, true)
  await driver.setAutopilot(guest, true)
  const seen = await driver.waitFor(
    host,
    (s) => s.remotes >= 1,
    25_000,
    "host never saw the guest avatar",
  )
  await driver.waitFor(guest, (s) => s.remotes >= 1, 25_000, "guest never saw the host avatar")
  console.log(`multiplayer: host sees ${seen.remotes} remote runner(s)`)

  // Both clients must drive obstacles and NPCs from the same world clock, or they
  // are watching different sweepers in what is supposed to be the same race.
  const [hostClock, guestClock] = await Promise.all([
    driver.readState(host),
    driver.readState(guest),
  ])
  const skew = Math.abs(hostClock.worldTimeSec - guestClock.worldTimeSec)
  if (skew > 0.75) {
    throw new ScenarioFailure("multiplayer", `world clocks disagree by ${skew.toFixed(2)}s`)
  }
  console.log(`multiplayer: world clocks agree within ${skew.toFixed(3)}s`)

  // Remote runners must actually move, not merely exist.
  const firstProgress = seen.remoteProgress
  await host.waitForTimeout(2500)
  const moved = await driver.readState(host)
  const advanced = moved.remoteProgress.some(
    (z, index) => Math.abs(z - (firstProgress[index] ?? z)) > 1,
  )
  if (!advanced) {
    throw new ScenarioFailure("multiplayer", "the remote runner never moved on the host's screen")
  }
  console.log("multiplayer: remote runner position advances on the host screen")

  await host.waitForTimeout(6500)
  await host.screenshot({ path: `${driver.outDir}/multiplayer-host.png` })
  await guest.screenshot({ path: `${driver.outDir}/multiplayer-guest.png` })

  await driver.finishVideo(hostContext, host, "multiplayer-host")
  await driver.finishVideo(guestContext, guest, "multiplayer-guest")
}
