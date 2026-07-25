/**
 * Bundles the browser client into ./dist, which wrangler serves as static assets.
 * Any failure aborts with a non-zero exit code — the build never half-succeeds.
 */

import { cp, mkdir, rm } from "node:fs/promises"

class BuildFailedError extends Error {
  readonly logs: readonly string[]
  constructor(logs: readonly string[]) {
    super(`Client bundle failed:\n${logs.join("\n")}`)
    this.name = "BuildFailedError"
    this.logs = logs
  }
}

const OUT_DIR = "dist"

async function build(): Promise<void> {
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(`${OUT_DIR}/assets`, { recursive: true })

  const result = await Bun.build({
    entrypoints: ["src/client/main.ts"],
    outdir: `${OUT_DIR}/assets`,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "linked",
    naming: { entry: "[dir]/main.[ext]", chunk: "[name]-[hash].[ext]" },
  })

  if (!result.success) {
    throw new BuildFailedError(result.logs.map((log) => String(log)))
  }

  await cp("src/client/index.html", `${OUT_DIR}/index.html`)
  const cssParts = ["base", "lobby", "hud", "finish"]
  const css = await Promise.all(
    cssParts.map((part) => Bun.file(`src/client/styles/${part}.css`).text()),
  )
  await Bun.write(`${OUT_DIR}/assets/style.css`, css.join("\n"))

  const bytes = result.outputs.reduce((total, output) => total + output.size, 0)
  console.log(`built ${result.outputs.length} files, ${(bytes / 1024).toFixed(0)} kB → ${OUT_DIR}/`)
}

// no-excuse-ok: catch — top-level CLI boundary
try {
  await build()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
