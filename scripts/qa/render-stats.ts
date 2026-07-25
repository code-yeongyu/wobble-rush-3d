/**
 * Rendering QA probe: renderer.info averaged over real frames at several
 * points on the course, plus uncapped rAF frame time.
 *
 * Usage: bun run scripts/qa/render-stats.ts [base]
 */
import { chromium } from "@playwright/test"
import "./driver"

/** Measurement hook published by the renderer; see src/client/scene-kit.ts. */
type RendererInfo = {
  autoReset: boolean
  reset(): void
  render: { calls: number; triangles: number }
  memory: { geometries: number; textures: number }
  programs: readonly unknown[]
}

declare global {
  var wobbleScene: { renderer: { info: RendererInfo } } | undefined
}

const base = Bun.argv[2] ?? "http://localhost:8787"
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader", "--disable-frame-rate-limit"],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(base, { waitUntil: "domcontentloaded" })
await page.waitForSelector("#play-solo")
await page.click("#play-solo")
await page.waitForTimeout(3800)
await page.evaluate(() => {
  const api = globalThis.wobble
  if (api === undefined) throw new Error("window.wobble debug API is unavailable")
  api.autopilot(true)
})

type Sample = {
  perFrame: { calls: number; triangles: number }
  memory: { geometries: number; textures: number }
  programs: number
  frameMs: { avg: number; p95: number }
}

const sample = (): Promise<Sample> =>
  page.evaluate<Sample>(
    () =>
      new Promise((resolve) => {
        const holder = globalThis.wobbleScene
        if (holder === undefined) throw new Error("wobbleScene hook missing")
        const info = holder.renderer.info
        info.autoReset = false
        info.reset()
        const deltas: number[] = []
        let last = performance.now()
        let frames = 0
        const tick = (now: number): void => {
          deltas.push(now - last)
          last = now
          frames += 1
          if (frames < 120) {
            requestAnimationFrame(tick)
            return
          }
          const sorted = [...deltas].sort((a, b) => a - b)
          const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
          const avg = deltas.reduce((sum, value) => sum + value, 0) / deltas.length
          resolve({
            perFrame: {
              calls: Math.round(info.render.calls / frames),
              triangles: Math.round(info.render.triangles / frames),
            },
            memory: { geometries: info.memory.geometries, textures: info.memory.textures },
            programs: info.programs.length,
            frameMs: { avg: Math.round(avg * 100) / 100, p95: Math.round(p95 * 100) / 100 },
          })
          info.reset()
          info.autoReset = true
        }
        requestAnimationFrame(tick)
      }),
  )

const results: Record<string, Sample> = {}
results["race-begin"] = await sample()
await page.waitForTimeout(6000)
results.sweepers = await sample()
await page.waitForTimeout(15000)
results.bumpers = await sample()
console.log(JSON.stringify(results, null, 2))
await browser.close()
