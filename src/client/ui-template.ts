/** The overlay markup and the small pure helpers the UI renders with. */

export const SCREENS = ["start", "lobby", "hud", "finish", "error"] as const
export type Screen = (typeof SCREENS)[number]

export class MissingElementError extends Error {
  constructor(selector: string) {
    super(`Required UI element is missing: ${selector}`)
    this.name = "MissingElementError"
  }
}

export function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new MissingElementError(selector)
  return element
}

/** Stopwatch format used across the HUD and the results table. */
export const formatTime = (milliseconds: number): string => {
  const clamped = Math.max(0, milliseconds)
  const minutes = Math.floor(clamped / 60000)
  const seconds = Math.floor((clamped % 60000) / 1000)
  const millis = Math.floor(clamped % 1000)
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })

export const TEMPLATE = /* html */ `
<canvas id="stage" aria-label="Wobble Rush 3D game view"></canvas>

<section class="screen screen--start" data-screen="start">
  <div class="panel panel--start">
    <h1 class="logo"><span class="logo__wobble">Wobble</span><span class="logo__rush">Rush</span><span class="logo__three">3D</span></h1>
    <p class="tagline">Bounce, dive and wobble your way to the finish gate.</p>
    <label class="field">
      <span class="field__label">Racer name</span>
      <input id="name-input" class="field__input" maxlength="16" placeholder="Wobbler" autocomplete="off" />
    </label>
    <fieldset class="colors">
      <legend class="field__label">Colour</legend>
      <div id="color-row" class="colors__row"></div>
    </fieldset>
    <div class="actions">
      <button id="play-solo" class="btn btn--primary" type="button">Play Solo</button>
      <button id="play-online" class="btn btn--secondary" type="button">Play Online</button>
    </div>
    <label class="field field--inline">
      <span class="field__label">Room code (optional)</span>
      <input id="room-input" class="field__input field__input--code" maxlength="4" placeholder="ABCD" autocomplete="off" />
    </label>
    <p class="hint"><kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>Shift</kbd> dive · <kbd>R</kbd> respawn</p>
  </div>
  <button id="sound-toggle" class="sound" type="button" aria-pressed="false">Sound on</button>
</section>

<section class="screen screen--lobby" data-screen="lobby" hidden>
  <div class="panel">
    <h2 class="panel__title">Lobby</h2>
    <p class="roomcode">Room <strong id="room-code">----</strong></p>
    <p class="panel__hint">Share the code. Everyone readies up, then the race starts.</p>
    <ul id="player-list" class="players"></ul>
    <div class="actions">
      <button id="ready-btn" class="btn btn--primary" type="button">I'm ready</button>
      <button id="leave-btn" class="btn btn--ghost" type="button">Leave</button>
    </div>
  </div>
</section>

<section class="screen screen--hud" data-screen="hud" hidden>
  <div class="hud">
    <div class="hud__timer" id="timer">00:00.000</div>
    <div class="hud__pips" id="pips" aria-label="checkpoints"></div>
    <div class="hud__place" id="place"></div>
  </div>
  <div class="controls-hint" id="controls-hint"><kbd>WASD</kbd> move <kbd>Space</kbd> jump <kbd>Shift</kbd> dive <kbd>R</kbd> respawn</div>
  <div class="countdown" id="countdown" hidden></div>
</section>

<section class="screen screen--finish" data-screen="finish" hidden>
  <div class="panel panel--finish">
    <h2 class="panel__title" id="finish-title">Finished!</h2>
    <p class="finish-time" id="finish-time">00:00.000</p>
    <p class="finish-note" id="finish-note"></p>
    <ol id="results" class="results"></ol>
    <div class="actions">
      <button id="restart-btn" class="btn btn--primary" type="button">Race again</button>
      <button id="menu-btn" class="btn btn--ghost" type="button">Back to menu</button>
    </div>
  </div>
</section>

<section class="screen screen--error" data-screen="error" hidden>
  <div class="panel panel--error">
    <h2 class="panel__title">Something failed to load</h2>
    <p class="error-message" id="error-message"></p>
    <p class="panel__hint">Nothing was silently skipped — the game stops rather than run half-broken.</p>
    <button id="error-reload" class="btn btn--primary" type="button">Reload</button>
  </div>
</section>

<div class="live" id="live" aria-live="polite"></div>
`
