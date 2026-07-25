/**
 * DOM overlay: every screen in DESIGN.md section 8.
 * The renderer owns the canvas; this owns everything drawn on top of it.
 */

import { RUNNER_COLORS } from "../shared/course"
import type { RaceResult, RoomPhase, RoomSnapshot } from "../shared/room"
import type { Screen } from "./ui-template"
import { escapeHtml, formatTime, query, SCREENS, TEMPLATE } from "./ui-template"

export { formatTime, MissingElementError } from "./ui-template"

export type UiHandlers = {
  onPlaySolo(name: string, colorIndex: number): void
  onPlayOnline(name: string, colorIndex: number, code: string | null): void
  onReady(ready: boolean): void
  onLeaveLobby(): void
  onRestart(): void
  onBackToMenu(): void
  onToggleSound(muted: boolean): void
}

export class Ui {
  readonly canvas: HTMLCanvasElement
  private readonly root: HTMLElement
  private readonly handlers: UiHandlers
  private colorIndex = 0
  private hintTimer: ReturnType<typeof globalThis.setTimeout> | null = null

  constructor(root: HTMLElement, handlers: UiHandlers) {
    this.root = root
    this.handlers = handlers
    root.innerHTML = TEMPLATE
    this.canvas = query<HTMLCanvasElement>(root, "#stage")
    this.buildColorRow()
    this.wire()
  }

  private buildColorRow(): void {
    const row = query<HTMLDivElement>(this.root, "#color-row")
    RUNNER_COLORS.forEach((color, index) => {
      const swatch = document.createElement("button")
      swatch.type = "button"
      swatch.className = "swatch"
      swatch.style.setProperty("--swatch", color)
      swatch.setAttribute("aria-label", `Colour ${index + 1}`)
      swatch.setAttribute("aria-pressed", String(index === 0))
      swatch.addEventListener("click", () => {
        this.colorIndex = index
        for (const other of row.querySelectorAll(".swatch"))
          other.setAttribute("aria-pressed", "false")
        swatch.setAttribute("aria-pressed", "true")
      })
      row.append(swatch)
    })
  }

  private wire(): void {
    const nameInput = query<HTMLInputElement>(this.root, "#name-input")
    const roomInput = query<HTMLInputElement>(this.root, "#room-input")
    const name = (): string => (nameInput.value.trim() === "" ? "Wobbler" : nameInput.value.trim())

    query<HTMLButtonElement>(this.root, "#play-solo").addEventListener("click", () => {
      this.handlers.onPlaySolo(name(), this.colorIndex)
    })
    query<HTMLButtonElement>(this.root, "#play-online").addEventListener("click", () => {
      const code = roomInput.value.trim().toUpperCase()
      this.handlers.onPlayOnline(name(), this.colorIndex, code === "" ? null : code)
    })
    query<HTMLButtonElement>(this.root, "#ready-btn").addEventListener("click", (event) => {
      const button = event.currentTarget
      if (!(button instanceof HTMLButtonElement)) return
      const next = button.dataset.ready !== "true"
      button.dataset.ready = String(next)
      button.textContent = next ? "Waiting for others…" : "I'm ready"
      this.handlers.onReady(next)
    })
    query<HTMLButtonElement>(this.root, "#leave-btn").addEventListener("click", () =>
      this.handlers.onLeaveLobby(),
    )
    query<HTMLButtonElement>(this.root, "#restart-btn").addEventListener("click", () =>
      this.handlers.onRestart(),
    )
    query<HTMLButtonElement>(this.root, "#menu-btn").addEventListener("click", () =>
      this.handlers.onBackToMenu(),
    )
    query<HTMLButtonElement>(this.root, "#error-reload").addEventListener("click", () =>
      globalThis.location.reload(),
    )

    const sound = query<HTMLButtonElement>(this.root, "#sound-toggle")
    sound.addEventListener("click", () => {
      const muted = sound.getAttribute("aria-pressed") !== "true"
      sound.setAttribute("aria-pressed", String(muted))
      sound.textContent = muted ? "Sound off" : "Sound on"
      this.handlers.onToggleSound(muted)
    })
  }

  show(screen: Screen): void {
    for (const name of SCREENS) {
      const section = query<HTMLElement>(this.root, `[data-screen="${name}"]`)
      section.hidden = name !== screen
    }
    if (screen === "hud") this.resetControlsHint()
  }

  /** The HUD and the countdown overlay live together; the countdown can be shown over it. */
  private resetControlsHint(): void {
    const hint = query<HTMLElement>(this.root, "#controls-hint")
    hint.classList.remove("controls-hint--faded")
    if (this.hintTimer !== null) globalThis.clearTimeout(this.hintTimer)
    this.hintTimer = globalThis.setTimeout(() => hint.classList.add("controls-hint--faded"), 6000)
  }

  setTimer(milliseconds: number): void {
    query<HTMLElement>(this.root, "#timer").textContent = formatTime(milliseconds)
  }

  setCheckpoints(current: number, total: number): void {
    const pips = query<HTMLElement>(this.root, "#pips")
    if (pips.childElementCount !== total) {
      pips.replaceChildren()
      for (let index = 0; index < total; index += 1) {
        const pip = document.createElement("span")
        pip.className = "pip"
        pips.append(pip)
      }
    }
    pips.querySelectorAll(".pip").forEach((pip, index) => {
      pip.classList.toggle("pip--on", index < current)
    })
  }

  setPlace(text: string): void {
    query<HTMLElement>(this.root, "#place").textContent = text
  }

  setCountdown(value: string | null): void {
    const element = query<HTMLElement>(this.root, "#countdown")
    if (value === null) {
      element.hidden = true
      return
    }
    element.hidden = false
    element.textContent = value
    element.classList.remove("countdown--pop")
    void element.offsetWidth
    element.classList.add("countdown--pop")
    this.announce(value)
  }

  setRoom(snapshot: RoomSnapshot, selfName: string): void {
    query<HTMLElement>(this.root, "#room-code").textContent = snapshot.code
    const list = query<HTMLElement>(this.root, "#player-list")
    list.replaceChildren()
    for (const player of snapshot.players) {
      const item = document.createElement("li")
      item.className = `player${player.ready ? " player--ready" : ""}`
      const color = RUNNER_COLORS[player.colorIndex % RUNNER_COLORS.length] ?? RUNNER_COLORS[0]
      item.innerHTML = `<span class="player__dot" style="--dot:${color}"></span><span class="player__name">${escapeHtml(player.name)}${player.name === selfName ? " (you)" : ""}</span><span class="player__state">${player.ready ? "Ready" : "Waiting"}</span>`
      list.append(item)
    }
  }

  setPhaseHint(phase: RoomPhase): void {
    const hint = query<HTMLElement>(this.root, ".screen--lobby .panel__hint")
    hint.textContent =
      phase === "countdown"
        ? "Everyone is ready — starting!"
        : "Share the code. Everyone readies up, then the race starts."
  }

  showFinish(timeMs: number, note: string, results: readonly RaceResult[]): void {
    query<HTMLElement>(this.root, "#finish-time").textContent = formatTime(timeMs)
    query<HTMLElement>(this.root, "#finish-note").textContent = note
    const list = query<HTMLElement>(this.root, "#results")
    list.replaceChildren()
    for (const result of results) {
      const item = document.createElement("li")
      item.className = "results__row"
      item.innerHTML = `<span class="results__place">${result.place}</span><span class="results__name">${escapeHtml(result.name)}</span><span class="results__time">${result.timeMs === null ? "—" : formatTime(result.timeMs)}</span>`
      list.append(item)
    }
    this.show("finish")
    this.announce(`Finished in ${formatTime(timeMs)}`)
  }

  showError(message: string): void {
    query<HTMLElement>(this.root, "#error-message").textContent = message
    this.show("error")
  }

  announce(message: string): void {
    query<HTMLElement>(this.root, "#live").textContent = message
  }

  resetReadyButton(): void {
    const button = query<HTMLButtonElement>(this.root, "#ready-btn")
    button.dataset.ready = "false"
    button.textContent = "I'm ready"
  }
}
