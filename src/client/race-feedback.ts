/**
 * Turns simulation events into what the player sees, hears and reads.
 * Keeping this out of Game means the mapping is one obvious table.
 */

import { RUNNER } from "../shared/constants"
import type { SimEvent } from "../shared/types"
import { assertNever } from "../shared/types"
import type { AudioKit } from "./audio"
import type { CameraRig } from "./camera-rig"
import type { Effects } from "./effects"
import type { Ui } from "./ui"

export type FeedbackPorts = {
  readonly effects: Effects
  readonly audio: AudioKit
  readonly ui: Ui
  readonly camera: CameraRig
  readonly runnerColor: string
  readonly checkpointTotal: number
}

export type FeedbackOutcome = { readonly finished: boolean }

/**
 * `isLocal` gates sound and camera shake: a remote runner's bumper hit should
 * spark on screen without deafening or shaking the local player.
 */
export function applyEvents(
  events: readonly SimEvent[],
  ports: FeedbackPorts,
  isLocal: boolean,
): FeedbackOutcome {
  let finished = false
  for (const event of events) {
    switch (event.kind) {
      case "jump":
        if (isLocal) ports.audio.play("jump")
        break
      case "land":
        if (event.impactSpeed >= RUNNER.landEffectSpeed) {
          ports.effects.land(event.position, event.impactSpeed)
          if (isLocal) ports.audio.play("land")
        }
        break
      case "dive":
        ports.effects.dive(event.position, ports.runnerColor)
        if (isLocal) ports.audio.play("dive")
        break
      case "hit":
        ports.effects.hit(event.position)
        if (isLocal) {
          ports.audio.play("hit")
          ports.camera.addShake(0.6)
        }
        break
      case "bounce":
        ports.effects.bounce(event.position)
        if (isLocal) {
          ports.audio.play("bounce")
          ports.camera.addShake(0.3)
        }
        break
      case "checkpoint":
        ports.effects.checkpoint(event.position)
        if (isLocal) {
          ports.audio.play("checkpoint")
          ports.ui.setCheckpoints(event.index, ports.checkpointTotal)
          ports.ui.announce(`Checkpoint ${event.index}`)
        }
        break
      case "respawn":
        ports.effects.respawn(event.position)
        if (isLocal) ports.audio.play("respawn")
        break
      case "finish":
        if (isLocal) finished = true
        break
      default:
        assertNever(event, "applyEvents")
    }
  }
  return { finished }
}
