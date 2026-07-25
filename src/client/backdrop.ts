/**
 * Parallax sky furniture: drifting cloud clusters, bobbing blimps and slow arches.
 * Purely decorative — none of it is in the collision world (DESIGN.md section 7).
 */

import * as THREE from "three"
import { PALETTE } from "../shared/course"
import { createVinyl } from "./scene-kit"

type DecorItem = {
  readonly mesh: THREE.Object3D
  readonly speed: number
  readonly axis: "drift" | "bob"
  readonly base: number
  readonly amplitude: number
}

export class Backdrop {
  readonly group = new THREE.Group()
  private readonly items: DecorItem[] = []

  constructor() {
    this.addClouds()
    this.addBlimps()
    this.addArches()
  }

  private addClouds(): void {
    const material = createVinyl(PALETTE.cloud, { roughness: 0.85, clearcoat: 0 })
    for (let index = 0; index < 26; index += 1) {
      const cloud = new THREE.Group()
      const puffs = 3 + (index % 3)
      for (let puff = 0; puff < puffs; puff += 1) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(2.6 + (puff % 2) * 1.4, 14, 10),
          material,
        )
        sphere.position.set(
          puff * 3.4 - puffs * 1.4,
          Math.sin(puff * 2.1) * 0.9,
          Math.cos(puff) * 1.6,
        )
        cloud.add(sphere)
      }
      const lane = index % 3
      cloud.position.set(
        (index % 2 === 0 ? -1 : 1) * (34 + lane * 22 + (index % 5) * 6),
        16 + lane * 9 + (index % 4) * 2.5,
        -20 + index * 7.5,
      )
      cloud.scale.setScalar(0.8 + lane * 0.5)
      this.group.add(cloud)
      this.items.push({
        mesh: cloud,
        speed: 0.6 + lane * 0.55,
        axis: "drift",
        base: cloud.position.x,
        amplitude: 26,
      })
    }
  }

  private addBlimps(): void {
    for (let index = 0; index < 4; index += 1) {
      const blimp = new THREE.Group()
      const hull = new THREE.Mesh(
        new THREE.SphereGeometry(3.1, 20, 14),
        createVinyl(index % 2 === 0 ? PALETTE.bumper : PALETTE.mover, {
          roughness: 0.3,
          clearcoat: 0.6,
        }),
      )
      hull.scale.set(1, 0.66, 1.9)
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 1.8, 1.5),
        createVinyl(PALETTE.finish, { roughness: 0.3 }),
      )
      fin.position.z = -4.6
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.7, 2),
        createVinyl(PALETTE.ink, { roughness: 0.5 }),
      )
      cabin.position.y = -2.2
      blimp.add(hull, fin, cabin)
      blimp.position.set(index % 2 === 0 ? -46 : 46, 30 + index * 5, 14 + index * 32)
      this.group.add(blimp)
      this.items.push({
        mesh: blimp,
        speed: 0.5 + index * 0.2,
        axis: "bob",
        base: blimp.position.y,
        amplitude: 2.4,
      })
    }
  }

  private addArches(): void {
    for (let index = 0; index < 3; index += 1) {
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(11, 1.3, 12, 40, Math.PI),
        createVinyl(index === 1 ? PALETTE.deckSun : PALETTE.bumper, {
          roughness: 0.3,
          clearcoat: 0.7,
        }),
      )
      arch.position.set(index % 2 === 0 ? -30 : 32, 0, 20 + index * 46)
      arch.rotation.y = index % 2 === 0 ? 0.6 : -0.6
      this.group.add(arch)
      this.items.push({
        mesh: arch,
        speed: 0.18 + index * 0.05,
        axis: "bob",
        base: 0,
        amplitude: 0,
      })
    }
  }

  update(timeSec: number, reducedMotion: boolean): void {
    if (reducedMotion) return
    for (const item of this.items) {
      if (item.axis === "drift") {
        const drift = ((timeSec * item.speed) % (item.amplitude * 2)) - item.amplitude
        item.mesh.position.x = item.base + drift
      } else {
        item.mesh.position.y = item.base + Math.sin(timeSec * item.speed * 0.6) * item.amplitude
        item.mesh.rotation.y += 0.0009 * item.speed
      }
    }
  }
}
