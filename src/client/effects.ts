/**
 * Particle effects — one pooled Points system per kind, zero per-frame allocation.
 * Budgets come from DESIGN.md section 6.
 */

import * as THREE from "three"
import { PALETTE } from "../shared/course"
import type { Vec3 } from "../shared/types"
import { ParticlePool, RingBurst } from "./particles"

export class Effects {
  readonly group = new THREE.Group()
  private readonly puffs = new ParticlePool(240, 0.42, THREE.NormalBlending)
  private readonly sparks = new ParticlePool(420, 0.3, THREE.AdditiveBlending)
  private readonly confetti = new ParticlePool(320, 0.34, THREE.NormalBlending)
  private readonly checkpointRing = new RingBurst(PALETTE.deckRest)
  private readonly finishRing = new RingBurst(PALETTE.finish)
  private readonly respawnRing = new RingBurst(PALETTE.mover)
  private readonly scratch = new THREE.Color()

  constructor() {
    this.group.add(this.puffs.points, this.sparks.points, this.confetti.points)
    this.group.add(this.checkpointRing.mesh, this.finishRing.mesh, this.respawnRing.mesh)
  }

  land(at: Vec3, impactSpeed: number): void {
    const count = Math.min(24, 8 + Math.round(impactSpeed))
    this.scratch.set("#ffffff")
    for (let index = 0; index < count; index += 1) {
      this.puffs.spawn(at, this.scratch, {
        speed: 2.6,
        lift: 1.2,
        life: 0.45,
        gravity: 6,
        spread: 1.4,
      })
    }
  }

  dive(at: Vec3, color: string): void {
    this.scratch.set(color)
    for (let index = 0; index < 14; index += 1) {
      this.sparks.spawn(at, this.scratch, {
        speed: 3.2,
        lift: 0.8,
        life: 0.4,
        gravity: 2,
        spread: 2,
      })
    }
  }

  hit(at: Vec3): void {
    this.scratch.set(PALETTE.hazard)
    for (let index = 0; index < 22; index += 1) {
      this.sparks.spawn(at, this.scratch, {
        speed: 5.5,
        lift: 3,
        life: 0.55,
        gravity: 9,
        spread: 2.5,
      })
    }
  }

  bounce(at: Vec3): void {
    this.scratch.set(PALETTE.bumper)
    for (let index = 0; index < 20; index += 1) {
      this.sparks.spawn(at, this.scratch, { speed: 4.4, lift: 4, life: 0.5, gravity: 8, spread: 2 })
    }
  }

  checkpoint(at: Vec3): void {
    this.checkpointRing.fire(at)
    this.scratch.set(PALETTE.deckRest)
    for (let index = 0; index < 26; index += 1) {
      this.sparks.spawn(at, this.scratch, {
        speed: 3,
        lift: 5.5,
        life: 0.9,
        gravity: 6,
        spread: 1.2,
      })
    }
  }

  respawn(at: Vec3): void {
    this.respawnRing.fire(at, 0.5)
    this.scratch.set(PALETTE.mover)
    for (let index = 0; index < 26; index += 1) {
      this.sparks.spawn(at, this.scratch, {
        speed: 1.1,
        lift: 7,
        life: 0.8,
        gravity: 3,
        spread: 0.6,
      })
    }
  }

  finish(at: Vec3): void {
    this.finishRing.fire(at, 1)
    const colors = [PALETTE.finish, PALETTE.bumper, PALETTE.deckAqua, PALETTE.deckRest]
    for (let index = 0; index < 220; index += 1) {
      const color = colors[index % colors.length]
      this.scratch.set(color === undefined ? PALETTE.finish : color)
      this.confetti.spawn({ x: at.x, y: at.y + 3, z: at.z }, this.scratch, {
        speed: 6,
        lift: 6,
        life: 2.5,
        gravity: 9,
        spread: 4,
      })
    }
  }

  update(dt: number): void {
    this.puffs.update(dt)
    this.sparks.update(dt)
    this.confetti.update(dt)
    this.checkpointRing.update(dt)
    this.finishRing.update(dt)
    this.respawnRing.update(dt)
  }

  dispose(): void {
    this.puffs.dispose()
    this.sparks.dispose()
    this.confetti.dispose()
    this.checkpointRing.dispose()
    this.finishRing.dispose()
    this.respawnRing.dispose()
  }
}
