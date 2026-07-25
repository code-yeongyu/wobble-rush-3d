/**
 * Bundles the browser client into ./dist, which wrangler serves as static assets.
 * Any failure aborts with a non-zero exit code — the build never half-succeeds.
 *
 * The output is staged in a temp directory and swapped in file by file. Deleting
 * ./dist outright would yank the directory out from under a running `wrangler dev`,
 * which then serves 500s from a stale asset manifest until it is restarted.
 */

import { cp, mkdir, readdir, rm, unlink } from "node:fs/promises"
import { join } from "node:path"

class BuildFailedError extends Error {
  readonly logs: readonly string[]
  constructor(logs: readonly string[]) {
    super(`Client bundle failed:\n${logs.join("\n")}`)
    this.name = "BuildFailedError"
    this.logs = logs
  }
}

const OUT_DIR = "dist"
const STAGE_DIR = ".build-stage"
const CSS_PARTS = ["base", "lobby", "hud", "finish"] as const

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found: string[] = []
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) found.push(...(await listFiles(join(dir, entry.name), relative)))
    else found.push(relative)
  }
  return found
}

async function build(): Promise<void> {
  await rm(STAGE_DIR, { recursive: true, force: true })
  await mkdir(`${STAGE_DIR}/assets`, { recursive: true })

  const result = await Bun.build({
    entrypoints: ["src/client/main.ts"],
    outdir: `${STAGE_DIR}/assets`,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "linked",
    naming: { entry: "[dir]/main.[ext]", chunk: "[name]-[hash].[ext]" },
  })
  if (!result.success) throw new BuildFailedError(result.logs.map((log) => String(log)))

  await cp("src/client/index.html", `${STAGE_DIR}/index.html`)
  const css = await Promise.all(
    CSS_PARTS.map((part) => Bun.file(`src/client/styles/${part}.css`).text()),
  )
  await Bun.write(`${STAGE_DIR}/assets/style.css`, css.join("\n"))

  // Swap into place without ever removing OUT_DIR itself.
  await mkdir(`${OUT_DIR}/assets`, { recursive: true })
  const staged = await listFiles(STAGE_DIR)
  for (const file of staged) {
    await cp(join(STAGE_DIR, file), join(OUT_DIR, file), { force: true })
  }
  const stale = (await listFiles(OUT_DIR)).filter((file) => !staged.includes(file))
  for (const file of stale) await unlink(join(OUT_DIR, file))
  await rm(STAGE_DIR, { recursive: true, force: true })

  const sizes = await Promise.all(staged.map((file) => Bun.file(join(OUT_DIR, file)).size))
  const bytes = sizes.reduce((total, size) => total + size, 0)
  console.log(
    `built ${staged.length} files, ${(bytes / 1024).toFixed(0)} kB → ${OUT_DIR}/` +
      (stale.length > 0 ? ` (removed ${stale.length} stale)` : ""),
  )
}

// no-excuse-ok: catch — top-level CLI boundary
try {
  await build()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
