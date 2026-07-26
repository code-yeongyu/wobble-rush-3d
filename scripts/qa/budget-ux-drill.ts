import { chromium } from "@playwright/test"
import "./driver"

const b = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
})
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
await p.goto("http://localhost:8788", { waitUntil: "domcontentloaded" })
// PAUSED party attempt: click Play Online with no code -> pre-flight must show the pause message
await p.waitForSelector("#play-online")
await p.click("#play-online")
await p.waitForFunction(
  () => {
    const el = document.querySelector("#error-message")
    return el !== null && (el.textContent ?? "").length > 0
  },
  undefined,
  { timeout: 10000 },
)
const msg = await p.evaluate(() => document.querySelector("#error-message")?.textContent ?? "")
console.log("party error message:", JSON.stringify(msg))
if (!msg.includes("paused") || !msg.includes("2026-07-27"))
  throw new Error("FAIL: pause message wrong")
await p.screenshot({ path: ".omo/evidence/cost-guard/task-8-pause-message.png" })
console.log("PARTY PAUSE UX PASS (screenshot saved)")
// SOLO must still work while tripped
await p.click("#error-reload")
await p.waitForSelector("#play-solo")
await p.click("#play-solo")
let phase = ""
for (let i = 0; i < 40; i++) {
  const s = await p.evaluate(() => globalThis.wobble?.state())
  phase = s?.phase ?? ""
  if (phase === "racing") break
  await p.waitForTimeout(300)
}
console.log("solo phase while tripped:", phase)
if (phase !== "racing") throw new Error("FAIL: solo blocked")
await p.screenshot({ path: ".omo/evidence/cost-guard/task-8-solo-while-tripped.png" })
console.log("SOLO-WHILE-TRIPPED PASS (screenshot saved)")
await b.close()
