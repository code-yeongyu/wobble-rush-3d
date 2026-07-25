/**
 * Keyboard state → PlayerInput. Edge-triggered actions are latched so a press is
 * never missed between two fixed simulation steps.
 */

import type { PlayerInput } from "../shared/types"

const MOVE_KEYS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
} as const

export class InputSource {
  private readonly held = new Set<string>()
  private jumpLatched = false
  private diveLatched = false
  private respawnLatched = false
  private attached = false
  private dragging = false
  private dragYaw = 0

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return
    this.held.add(event.code)
    if (event.code === "Space") {
      this.jumpLatched = true
      event.preventDefault()
    }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") this.diveLatched = true
    if (event.code === "KeyR") this.respawnLatched = true
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code)
  }

  private readonly onBlur = (): void => {
    this.held.clear()
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    this.dragging = true
  }

  private readonly onPointerUp = (): void => {
    this.dragging = false
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return
    this.dragYaw -= event.movementX * 0.005
  }

  attach(target: HTMLElement): void {
    if (this.attached) return
    this.attached = true
    globalThis.addEventListener("keydown", this.onKeyDown)
    globalThis.addEventListener("keyup", this.onKeyUp)
    globalThis.addEventListener("blur", this.onBlur)
    target.addEventListener("pointerdown", this.onPointerDown)
    globalThis.addEventListener("pointerup", this.onPointerUp)
    globalThis.addEventListener("pointermove", this.onPointerMove)
  }

  detach(target: HTMLElement): void {
    if (!this.attached) return
    this.attached = false
    globalThis.removeEventListener("keydown", this.onKeyDown)
    globalThis.removeEventListener("keyup", this.onKeyUp)
    globalThis.removeEventListener("blur", this.onBlur)
    target.removeEventListener("pointerdown", this.onPointerDown)
    globalThis.removeEventListener("pointerup", this.onPointerUp)
    globalThis.removeEventListener("pointermove", this.onPointerMove)
    this.held.clear()
  }

  /** Manual camera orbit accumulated from pointer drags, in radians. */
  takeDragYaw(): number {
    const value = this.dragYaw
    this.dragYaw = 0
    return value
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
