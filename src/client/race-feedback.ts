/**
 * Turns simulation events into what the player sees, hears and reads.
 * Keeping this out of Game means the mapping is one obvious table.
 */

import { RUNNER } from "../shared/constants"
import type { CrowdBump } from "../shared/crowd"
import type { SimEvent } from "../shared/types"
import { assertNever } from "../shared/types"
import type { AudioKit } from "./audio"
import type { CameraRig } from "./camera-rig"
import type { Effects } from "./effects"
import { CueGuard } from "./impact-guard"
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

/** Closing speed at or above which a runner-vs-runner bump reads as a shove. */
const SHOVE_SPEED = 8

/**
 * Runner-vs-runner contacts. Only bumps involving the local player are felt —
 * two NPCs jostling each other should not shake the camera.
 */
export function applyCrowdBumps(
  bumps: readonly CrowdBump[],
  ports: FeedbackPorts,
  selfId: string,
): void {
  const now = performance.now()
  for (const bump of bumps) {
    if (bump.a !== selfId && bump.b !== selfId) continue
    const other = bump.a === selfId ? bump.b : bump.a
    if (!impactGuard.allow(`self:bump:${other}`, now)) continue
    const force = Math.min(1, bump.speed / SHOVE_SPEED)
    ports.effects.bounce(bump.point)
    ports.audio.play("bounce", 0.3 + 0.4 * force)
    ports.camera.addShake(0.1 + 0.2 * force)
  }
}

/**
 * One physical collision must read as ONE impact. If the simulation emits a
 * burst of identical events (same frame or adjacent frames), this guard
 * collapses them so sound, particles and shake never stack into mush. Keys
 * carry the obstacle id, so two different obstacles inside the window still
 * land as two impacts, and the local/NPC scope keeps a remote runner's burst
 * from swallowing the local player's feedback.
 */
const IMPACT_GUARD_WINDOW_SEC = 0.15
const impactGuard = new CueGuard(IMPACT_GUARD_WINDOW_SEC)

/** An obstacle impulse at or above this reads as a full-force slam. */
const SLAM_SPEED = 12

/** impactSpeed at or above this plays the land cue at full gain. */
const LAND_FULL_GAIN_SPEED = 14

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
  // One timestamp for the whole batch: events from the same frame share it,
  // which is exactly what makes a same-frame burst collapse to one cue.
  const now = performance.now() / 1000
  const scope = isLocal ? "self" : "npc"
  for (const event of events) {
    switch (event.kind) {
      case "jump":
        if (isLocal) ports.audio.play("jump")
        break
      case "land":
        if (
          event.impactSpeed >= RUNNER.landEffectSpeed &&
          impactGuard.allow(`${scope}:land`, now)
        ) {
          ports.effects.land(event.position, event.impactSpeed)
          if (isLocal)
            ports.audio.play("land", Math.min(1, event.impactSpeed / LAND_FULL_GAIN_SPEED))
        }
        break
      case "dive":
        ports.effects.dive(event.position, ports.runnerColor)
        if (isLocal) ports.audio.play("dive")
        break
      case "hit": {
        // Severity scales the whole response so a graze cannot feel like a slam.
        const force = Math.min(1, event.impactSpeed / SLAM_SPEED)
        if (impactGuard.allow(`${scope}:hit:${event.obstacle}`, now)) {
          ports.effects.hit(event.position)
          if (isLocal) {
            ports.audio.play("hit", 0.45 + 0.55 * force)
            ports.camera.addShake(0.25 + 0.45 * force)
          }
        }
        break
      }
      case "bounce": {
        const force = Math.min(1, event.impactSpeed / SLAM_SPEED)
        if (impactGuard.allow(`${scope}:bounce:${event.obstacle}`, now)) {
          ports.effects.bounce(event.position)
          if (isLocal) {
            ports.audio.play("bounce", 0.5 + 0.5 * force)
            ports.camera.addShake(0.15 + 0.3 * force)
          }
        }
        break
      }
      case "checkpoint":
        if (impactGuard.allow(`${scope}:checkpoint:${event.index}`, now)) {
          ports.effects.checkpoint(event.position)
          if (isLocal) {
            ports.audio.play("checkpoint")
            ports.ui.setCheckpoints(event.index, ports.checkpointTotal)
            ports.ui.announce(`Checkpoint ${event.index}`)
          }
        }
        break
      case "respawn":
        if (impactGuard.allow(`${scope}:respawn`, now)) {
          ports.effects.respawn(event.position)
          if (isLocal) ports.audio.play("respawn")
        }
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
