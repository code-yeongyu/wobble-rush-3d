/**
 * "Wobble" — the runner mascot, built from primitives per DESIGN.md section 4.
 *
 * A weeble: one egg body whose head is an integrated bulge, two stubby flared legs,
 * nub arms, high eye dots, and a spring-lagged antenna that sells every direction change.
 */

import * as THREE from "three"
import { RUNNER } from "../shared/constants"
import type { RunnerSim, RunnerState } from "../shared/types"
import { createVinyl } from "./scene-kit"

/** Egg silhouette: widest at 40% height, tapering into the dome. Units are metres. */
const BODY_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.0],
  [0.28, 0.02],
  [0.44, 0.12],
  [0.53, 0.32],
  [0.55, 0.52],
  [0.52, 0.75],
  [0.44, 0.95],
  [0.34, 1.12],
  [0.26, 1.26],
  [0.16, 1.38],
  [0.06, 1.46],
  [0.0, 1.48],
]

const lighten = (hex: string, amount: number): THREE.Color =>
  new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), amount)

export class RunnerView {
  readonly group = new THREE.Group()
  private readonly body = new THREE.Group()
  private readonly legLeft: THREE.Mesh
  private readonly legRight: THREE.Mesh
  private readonly armLeft: THREE.Mesh
  private readonly armRight: THREE.Mesh
  private readonly antenna = new THREE.Group()
  private readonly nameSprite: THREE.Sprite | null

  private runPhase = 0
  private squash = 0
  private antennaAngle = 0
  private antennaVelocity = 0
  private lastState: RunnerState = "idle"

  constructor(color: string, label?: string) {
    const bodyMaterial = createVinyl(color, {
      roughness: 0.28,
      clearcoat: 0.85,
      clearcoatRoughness: 0.15,
      sheen: 0.4,
    })
    const bellyMaterial = new THREE.MeshPhysicalMaterial({
      color: lighten(color, 0.55),
      roughness: 0.3,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.85,
    })
    const inkMaterial = createVinyl("#2A2440", { roughness: 0.4, clearcoat: 0.3 })
    const accentMaterial = createVinyl("#FFD400", { roughness: 0.25, clearcoat: 0.9 })

    const profile = BODY_PROFILE.map(([x, y]) => new THREE.Vector2(x, y))
    const shell = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), bodyMaterial)
    shell.castShadow = true
    this.body.add(shell)

    // Belly panel: a shell patch on the front, slightly proud of the body.
    const belly = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.5,
        24,
        18,
        Math.PI * 0.62,
        Math.PI * 0.76,
        Math.PI * 0.34,
        Math.PI * 0.44,
      ),
      bellyMaterial,
    )
    belly.scale.set(1.06, 1.28, 1.06)
    belly.position.y = 0.62
    this.body.add(belly)

    const eyeGeometry = new THREE.SphereGeometry(0.062, 14, 12)
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeometry, inkMaterial)
      eye.position.set(side * 0.13, 1.2, 0.27)
      this.body.add(eye)
      const glint = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 8, 8),
        new THREE.MeshBasicMaterial({ color: "#ffffff" }),
      )
      glint.position.set(side * 0.15, 1.23, 0.31)
      this.body.add(glint)
    }

    const armGeometry = new THREE.SphereGeometry(0.13, 16, 12)
    this.armLeft = new THREE.Mesh(armGeometry, bodyMaterial)
    this.armLeft.position.set(-0.5, 0.74, 0)
    this.armLeft.scale.set(0.8, 1.05, 0.8)
    this.armLeft.castShadow = true
    this.armRight = this.armLeft.clone()
    this.armRight.position.x = 0.5
    this.body.add(this.armLeft, this.armRight)

    // Antenna: the read at distance.
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.42, 10), inkMaterial)
    stalk.position.y = 0.21
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 14), accentMaterial)
    ball.position.y = 0.46
    ball.castShadow = true
    this.antenna.add(stalk, ball)
    this.antenna.position.y = 1.44
    this.body.add(this.antenna)

    const legGeometry = new THREE.CylinderGeometry(0.11, 0.125, 0.26, 14)
    const footGeometry = new THREE.SphereGeometry(0.15, 16, 12)
    const makeLeg = (side: number): THREE.Mesh => {
      const leg = new THREE.Mesh(legGeometry, bodyMaterial)
      leg.position.set(side * 0.19, 0.14, 0)
      leg.castShadow = true
      const foot = new THREE.Mesh(footGeometry, inkMaterial)
      foot.scale.set(1, 0.55, 1.35)
      foot.position.y = -0.14
      leg.add(foot)
      return leg
    }
    this.legLeft = makeLeg(-1)
    this.legRight = makeLeg(1)
    this.body.add(this.legLeft, this.legRight)

    this.group.add(this.body)
    this.nameSprite = label === undefined ? null : createLabel(label)
    if (this.nameSprite !== null) {
      this.nameSprite.position.y = 2.25
      this.group.add(this.nameSprite)
    }
  }

  /** Squash on landing; the harder the landing, the deeper the squash. */
  impact(speed: number): void {
    this.squash = Math.min(1, speed / 18)
  }

  update(sim: RunnerSim, dt: number): void {
    this.group.position.set(sim.position.x, sim.position.y - RUNNER.radius, sim.position.z)
    this.group.rotation.y = sim.yaw

    const horizontalSpeed = Math.hypot(sim.velocity.x, sim.velocity.z)

    if (sim.state === "run" && this.lastState !== "run") this.runPhase = 0
    if (sim.grounded && this.lastState === "air") this.impact(Math.abs(sim.velocity.y) + 4)
    this.lastState = sim.state

    // Run cycle: legs counter-swing, body bobs on the off-beat.
    this.runPhase += horizontalSpeed * dt * 2.6
    const swing = sim.grounded
      ? Math.sin(this.runPhase) * Math.min(1, horizontalSpeed / RUNNER.runSpeed)
      : 0
    this.legLeft.rotation.x = swing * 0.9
    this.legRight.rotation.x = -swing * 0.9
    this.armLeft.rotation.x = -swing * 0.7
    this.armRight.rotation.x = swing * 0.7
    this.body.position.y = sim.grounded ? Math.abs(Math.sin(this.runPhase)) * 0.045 : 0

    // Squash and stretch.
    this.squash *= 2 ** (-dt / 0.09)
    const dive = sim.state === "dive" ? 1 : 0
    const stretch = !sim.grounded && sim.velocity.y > 2 ? 0.08 : 0
    this.body.scale.set(
      1 + this.squash * 0.16,
      1 - this.squash * 0.22 + stretch,
      1 + this.squash * 0.16,
    )

    // Lean into acceleration; roll fully while diving.
    const lean = THREE.MathUtils.clamp(horizontalSpeed / RUNNER.runSpeed, 0, 1) * 0.24
    const targetPitch = dive === 1 ? 1.22 : lean
    this.body.rotation.x += (targetPitch - this.body.rotation.x) * Math.min(1, dt * 14)
    this.body.rotation.z =
      sim.state === "stumble" ? Math.sin(this.runPhase * 3) * 0.28 : this.body.rotation.z * 0.85

    // Antenna: a damped spring that lags behind the body's motion.
    const drive = -horizontalSpeed * 0.045 - sim.velocity.y * 0.02
    this.antennaVelocity += (drive - this.antennaAngle) * 62 * dt
    this.antennaVelocity *= 2 ** (-dt / 0.14)
    this.antennaAngle += this.antennaVelocity * dt
    this.antenna.rotation.x = THREE.MathUtils.clamp(this.antennaAngle, -0.9, 0.9)
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) {
          for (const entry of material) entry.dispose()
        } else {
          material.dispose()
        }
      }
    })
  }
}

function createLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas")
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext("2d")
  if (context === null) throw new Error("2D canvas context unavailable for the name label")
  context.font = "600 34px system-ui, sans-serif"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillStyle = "rgba(42,36,64,0.82)"
  roundRect(context, 4, 8, 248, 48, 24)
  context.fill()
  context.fillStyle = "#ffffff"
  context.fillText(text.slice(0, 14), 128, 33)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  )
  sprite.scale.set(2.1, 0.52, 1)
  return sprite
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}
