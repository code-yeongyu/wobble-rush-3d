/**
 * Boot. Any failure here paints the error screen — the game never renders a blank
 * canvas or silently degrades.
 */

import { Game } from "./game"

const FALLBACK_STYLE =
  "position:fixed;inset:0;display:grid;place-items:center;padding:32px;font:16px/1.5 system-ui,sans-serif;background:#fff2f2;color:#2a2440;text-align:center"

function paintFatal(message: string): void {
  const root = document.getElementById("app")
  if (root === null) {
    document.body.innerHTML = `<div style="${FALLBACK_STYLE}"><div><h1>Wobble Rush 3D failed to start</h1><p>${message}</p></div></div>`
    return
  }
  root.innerHTML = `<div style="${FALLBACK_STYLE}"><div><h1>Wobble Rush 3D failed to start</h1><p>${message}</p><button type="button" onclick="location.reload()" style="margin-top:16px;padding:12px 22px;font:inherit;font-weight:700;border:3px solid #2a2440;border-radius:14px;background:#ffd25e;cursor:pointer">Reload</button></div></div>`
}

function boot(): void {
  const root = document.getElementById("app")
  if (root === null) throw new Error("The #app container is missing from the page.")
  const game = new Game(root)
  globalThis.addEventListener("pagehide", () => game.dispose(), { once: true })
}

// no-excuse-ok: catch — top-level boundary; every failure must reach the user.
try {
  boot()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error("[wobble-rush] boot failed", error)
  paintFatal(message)
}

window.addEventListener("error", (event: ErrorEvent) => {
  console.error("[wobble-rush] runtime error", event.error)
})
window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  console.error("[wobble-rush] unhandled rejection", event.reason)
})
