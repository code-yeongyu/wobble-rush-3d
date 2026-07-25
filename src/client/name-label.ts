/** Floating name tag above remote runners and NPCs. Owns its CanvasTexture. */

import * as THREE from "three"

export type NameLabel = {
  readonly sprite: THREE.Sprite
  readonly dispose: () => void
}

export function createNameLabel(text: string): NameLabel {
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
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(2.1, 0.52, 1)
  return {
    sprite,
    dispose: () => {
      material.dispose()
      texture.dispose()
    },
  }
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
