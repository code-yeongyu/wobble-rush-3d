/**
 * How a runner responds to an obstacle impulse.
 *
 * The world reports contacts; this decides what they do to the runner. Two rules
 * carry the feel: one physical collision produces exactly one response however
 * many ticks the overlap lasts, and the throw is blended with the runner's own
 * motion instead of replacing it, so a hit never feels like a teleport.
 */

import { RUNNER } from "./constants"
import type { ContactImpulse, RunnerSim, SimEvent } from "./types"
import { assertNever } from "./types"

/**
 * How long the same obstacle is ignored after connecting. A sweeper arm stays
 * inside the runner for several ticks and keeps sweeping afterwards; without
 * this a single pass fired up to six hits.
 */
const CONTACT_LOCKOUT_SEC = 0.5

/** Share of the runner's own horizontal velocity kept through a hit. */
const KNOCKBACK_KEEP = 0.45

/** Applies every accepted impulse to `sim`, appending the events it produced. */
export function applyContactImpulses(
  sim: RunnerSim,
  impulses: readonly ContactImpulse[],
  events: SimEvent[],
): void {
  // Obstacle impulses: one physical collision, one response. While the same
  // obstacle sits inside its lockout its repeat contacts are ignored entirely
  // — no velocity change, no event; a different obstacle still connects.
  for (const impulse of impulses) {
    if (sim.contactLockout > 0 && impulse.obstacle === sim.lastContactId) continue
    sim.lastContactId = impulse.obstacle
    sim.contactLockout = CONTACT_LOCKOUT_SEC
    // Blend the throw with the runner's own motion: keep a share of the
    // current velocity, take the higher of rise and imparted lift, and scale
    // the slam by depth — a graze (depth 0) imparts 65%, a full slam 100%.
    const slam = Math.min(1, impulse.depth / RUNNER.radius)
    const imparted = impulse.speed * (0.65 + 0.35 * slam)
    sim.velocity.x = sim.velocity.x * KNOCKBACK_KEEP + impulse.direction.x * imparted
    sim.velocity.z = sim.velocity.z * KNOCKBACK_KEEP + impulse.direction.z * imparted
    sim.velocity.y = Math.max(sim.velocity.y, impulse.lift)
    switch (impulse.kind) {
      case "sweeper":
        sim.stumbleTimer = RUNNER.stumbleSec
        events.push({
          kind: "hit",
          position: impulse.point,
          obstacle: impulse.obstacle,
          impactSpeed: imparted,
        })
        break
      case "bumper":
        events.push({
          kind: "bounce",
          position: impulse.point,
          obstacle: impulse.obstacle,
          impactSpeed: imparted,
        })
        break
      default:
        assertNever(impulse.kind, "ContactImpulse.kind")
    }
  }
}
