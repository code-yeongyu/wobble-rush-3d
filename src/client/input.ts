/**
 * Keyboard state → PlayerInput, plus pointer-drag camera orbit.
 *
 * Edge-triggered actions are latched so a press is never missed between two
 * fixed simulation steps. Drags use pointer capture on the canvas so a fast
 * flick off-window still ends cleanly, and every focus-loss path (blur,
 * tab hide) drops held keys and latched presses so nothing sticks.
 */

import { CAMERA } from "../shared/constants"
import type { PlayerInput } from "../shared/types"
import type { OrbitDelta } from "./camera-math"

const MOVE_KEYS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
} as const

/** Keys the page must never see as scroll commands. */
const SCROLL_KEYS: ReadonlySet<string> = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
])

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

export class InputSource {
  private readonly held = new Set<string>()
  private jumpLatched = false
  private diveLatched = false
  private respawnLatched = false
  private attached = false
  private dragging = false
  private activePointerId: number | null = null
  private target: HTMLElement | null = null
  private dragYaw = 0
  private dragPitch = 0

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return
    if (isTypingTarget(event.target)) return
    this.held.add(event.code)
    if (SCROLL_KEYS.has(event.code)) event.preventDefault()
    if (event.code === "Space") this.jumpLatched = true
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") this.diveLatched = true
    if (event.code === "KeyR") this.respawnLatched = true
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code)
  }

  /** Drops everything: held keys, latched presses and any drag in flight. */
  private releaseAll(): void {
    this.held.clear()
    this.jumpLatched = false
    this.diveLatched = false
    this.dragging = false
    this.activePointerId = null
  }

  private readonly onBlur = (): void => {
    this.releaseAll()
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.releaseAll()
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.target === null) return
    this.dragging = true
    this.activePointerId = event.pointerId
    this.target.setPointerCapture(event.pointerId)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return
    this.dragging = false
    this.activePointerId = null
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.activePointerId) return
    this.dragYaw -= event.movementX * CAMERA.orbitSensitivity
    this.dragPitch += event.movementY * CAMERA.orbitSensitivity
  }

  attach(target: HTMLElement): void {
    if (this.attached) return
    this.attached = true
    this.target = target
    globalThis.addEventListener("keydown", this.onKeyDown)
    globalThis.addEventListener("keyup", this.onKeyUp)
    globalThis.addEventListener("blur", this.onBlur)
    document.addEventListener("visibilitychange", this.onVisibilityChange)
    target.addEventListener("pointerdown", this.onPointerDown)
    target.addEventListener("pointermove", this.onPointerMove)
    globalThis.addEventListener("pointerup", this.onPointerUp)
    globalThis.addEventListener("pointercancel", this.onPointerUp)
  }

  detach(target: HTMLElement): void {
    if (!this.attached) return
    this.attached = false
    this.target = null
    globalThis.removeEventListener("keydown", this.onKeyDown)
    globalThis.removeEventListener("keyup", this.onKeyUp)
    globalThis.removeEventListener("blur", this.onBlur)
    document.removeEventListener("visibilitychange", this.onVisibilityChange)
    target.removeEventListener("pointerdown", this.onPointerDown)
    target.removeEventListener("pointermove", this.onPointerMove)
    globalThis.removeEventListener("pointerup", this.onPointerUp)
    globalThis.removeEventListener("pointercancel", this.onPointerUp)
    this.releaseAll()
  }

  /** Camera orbit accumulated from pointer drags since the last frame. */
  takeOrbitDelta(): OrbitDelta {
    const delta = { yaw: this.dragYaw, pitch: this.dragPitch }
    this.dragYaw = 0
    this.dragPitch = 0
    return delta
  }

  consumeRespawn(): boolean {
    const value = this.respawnLatched
    this.respawnLatched = false
    return value
  }

  private anyHeld(codes: readonly string[]): boolean {
    return codes.some((code) => this.held.has(code))
  }

  /** Samples the current keyboard into one simulation step's input. */
  sample(cameraYaw: number, locked: boolean): PlayerInput {
    if (locked) {
      this.jumpLatched = false
      this.diveLatched = false
      return {
        forward: 0,
        strafe: 0,
        jumpHeld: false,
        jumpPressed: false,
        divePressed: false,
        cameraYaw,
      }
    }
    const forward =
      (this.anyHeld(MOVE_KEYS.forward) ? 1 : 0) - (this.anyHeld(MOVE_KEYS.back) ? 1 : 0)
    const strafe = (this.anyHeld(MOVE_KEYS.right) ? 1 : 0) - (this.anyHeld(MOVE_KEYS.left) ? 1 : 0)
    const jumpPressed = this.jumpLatched
    const divePressed = this.diveLatched
    this.jumpLatched = false
    this.diveLatched = false
    return {
      forward,
      strafe,
      jumpHeld: this.held.has("Space"),
      jumpPressed,
      divePressed,
      cameraYaw,
    }
  }
}
