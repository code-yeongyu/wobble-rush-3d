/**
 * Shared GPU resources for course construction. Before this, every deck and
 * every obstacle built its own MeshPhysicalMaterial and geometry, so identical
 * looks and shapes cost separate programs, materials and draw-call state.
 * Materials are keyed by their full look, geometries by their exact shape.
 */

import type * as THREE from "three"
import { createVinyl, type VinylOptions } from "./scene-kit"

export class VinylCache {
  private readonly materials = new Map<string, THREE.MeshPhysicalMaterial>()

  get(color: string, options: VinylOptions = {}): THREE.MeshPhysicalMaterial {
    const key = JSON.stringify([
      color,
      options.roughness,
      options.clearcoat,
      options.clearcoatRoughness,
      options.sheen,
      options.emissiveIntensity,
      options.metalness,
      options.transparent,
      options.opacity,
    ])
    const existing = this.materials.get(key)
    if (existing !== undefined) return existing
    const material = createVinyl(color, options)
    this.materials.set(key, material)
    return material
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }
}

export class GeometryCache {
  private readonly geometries = new Map<string, THREE.BufferGeometry>()

  get(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const existing = this.geometries.get(key)
    if (existing !== undefined) return existing
    const geometry = factory()
    this.geometries.set(key, geometry)
    return geometry
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose()
    this.geometries.clear()
  }
}
