/** Pooled GPU particle primitives: a Points pool and an expanding ring burst. */

import * as THREE from "three"
import type { Vec3 } from "../shared/types"

export const SPRITE = (() => {
  const canvas = document.createElement("canvas")
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext("2d")
  if (context === null) throw new Error("2D canvas context unavailable for particle sprite")
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, "rgba(255,255,255,1)")
  gradient.addColorStop(0.45, "rgba(255,255,255,0.85)")
  gradient.addColorStop(1, "rgba(255,255,255,0)")
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
})()

export type SpawnOptions = {
  readonly speed: number
  readonly lift: number
  readonly life: number
  readonly gravity: number
  readonly spread: number
}

type Particle = {
  life: number
  maxLife: number
  vx: number
  vy: number
  vz: number
  gravity: number
  spin: number
}

export class ParticlePool {
  readonly points: THREE.Points
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly sizes: Float32Array
  private readonly particles: Particle[]
  private cursor = 0

  constructor(capacity: number, size: number, blending: THREE.Blending) {
    this.positions = new Float32Array(capacity * 3)
    this.colors = new Float32Array(capacity * 3)
    this.sizes = new Float32Array(capacity)
    this.particles = Array.from({ length: capacity }, () => ({
      life: 0,
      maxLife: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: 0,
      spin: 0,
    }))

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3))
    geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1))

    const material = new THREE.PointsMaterial({
      size,
      map: SPRITE,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending,
      sizeAttenuation: true,
    })
    this.points = new THREE.Points(geometry, material)
    this.points.frustumCulled = false
  }

  spawn(origin: Vec3, color: THREE.Color, options: SpawnOptions): void {
    const index = this.cursor
    this.cursor = (this.cursor + 1) % this.particles.length
    const particle = this.particles[index]
    if (particle === undefined) return

    const angle = Math.random() * Math.PI * 2
    const radial = options.speed * (0.4 + Math.random() * 0.6)
    particle.life = options.life * (0.7 + Math.random() * 0.5)
    particle.maxLife = particle.life
    particle.vx = Math.cos(angle) * radial + (Math.random() - 0.5) * options.spread
    particle.vz = Math.sin(angle) * radial + (Math.random() - 0.5) * options.spread
    particle.vy = options.lift * (0.5 + Math.random())
    particle.gravity = options.gravity
    particle.spin = Math.random() * 2 - 1

    this.positions[index * 3] = origin.x
    this.positions[index * 3 + 1] = origin.y
    this.positions[index * 3 + 2] = origin.z
    this.colors[index * 3] = color.r
    this.colors[index * 3 + 1] = color.g
    this.colors[index * 3 + 2] = color.b
    this.sizes[index] = 1
  }

  update(dt: number): void {
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index]
      if (particle === undefined || particle.life <= 0) continue
      particle.life -= dt
      particle.vy -= particle.gravity * dt
      const base = index * 3
      const px = this.positions[base]
      const py = this.positions[base + 1]
      const pz = this.positions[base + 2]
      if (px === undefined || py === undefined || pz === undefined) continue
      this.positions[base] = px + particle.vx * dt
      this.positions[base + 1] = py + particle.vy * dt
      this.positions[base + 2] = pz + particle.vz * dt
      const ratio = Math.max(0, particle.life / particle.maxLife)
      this.sizes[index] = ratio
      if (particle.life <= 0) {
        this.positions[base + 1] = -9999
      }
    }
    const geometry = this.points.geometry
    const position = geometry.getAttribute("position")
    const color = geometry.getAttribute("color")
    position.needsUpdate = true
    color.needsUpdate = true
  }

  dispose(): void {
    this.points.geometry.dispose()
    const material = this.points.material
    if (!Array.isArray(material)) material.dispose()
  }
}

/** Expanding ring used for checkpoints and the finish. */
export class RingBurst {
  readonly mesh: THREE.Mesh
  private life = 0
  private duration = 0.6

  constructor(color: string) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 40), material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.visible = false
  }

  fire(at: Vec3, duration = 0.6): void {
    this.mesh.position.set(at.x, at.y - 0.35, at.z)
    this.life = duration
    this.duration = duration
    this.mesh.visible = true
  }

  update(dt: number): void {
    if (this.life <= 0) return
    this.life -= dt
    const progress = 1 - Math.max(0, this.life) / this.duration
    const scale = 0.4 + progress * 3.4
    this.mesh.scale.setScalar(scale)
    const material = this.mesh.material
    if (!Array.isArray(material) && material instanceof THREE.MeshBasicMaterial) {
      material.opacity = Math.max(0, 1 - progress)
    }
    if (this.life <= 0) this.mesh.visible = false
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    const material = this.mesh.material
    if (!Array.isArray(material)) material.dispose()
  }
}
