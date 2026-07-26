/**
 * Runner-vs-runner contact pass.
 *
 * Racers are solid to each other: once everyone has moved for a tick, overlaps
 * are separated and momentum is traded, so bumping a rival shoves them instead
 * of ghosting through. Remote runners take part as immovable bodies — they push
 * you, but their position belongs to the network, not to this client.
 */

import { RUNNER } from "../shared/constants"
import type { CrowdBody } from "../shared/crowd"
import { resolveCrowd } from "../shared/crowd"
import type { RunnerSim } from "../shared/types"
import type { NpcPack } from "./npc-pack"
import type { FeedbackPorts } from "./race-feedback"
import { applyCrowdBumps } from "./race-feedback"
import type { RemoteRunners } from "./remote-runners"

/** Stable id for the local runner inside the crowd solver. */
export const SELF_BODY_ID = "self"

export function runCrowdPass(
  sim: RunnerSim,
  npcs: NpcPack,
  remotes: RemoteRunners,
  ports: FeedbackPorts,
): void {
  const self: CrowdBody = {
    id: SELF_BODY_ID,
    radius: RUNNER.radius,
    position: sim.position,
    velocity: sim.velocity,
    movable: true,
  }
  const bumps = resolveCrowd([self, ...npcs.bodies(), ...remotes.bodies()])
  if (bumps.length > 0) applyCrowdBumps(bumps, ports, SELF_BODY_ID)
}
