/**
 * Renderer, scene, lighting and the glossy-vinyl material factory.
 * Everything here implements DESIGN.md section 3 (Materials).
 */

import * as THREE from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { CAMERA } from "../shared/constants"
import { PALETTE } from "../shared/course"

export class WebGLUnavailableError extends Error {
  constructor(cause: string) {
    super(`WebGL is not available in this browser: ${cause}`)
    this.name = "WebGLUnavailableError"
  }
}

export type VinylOptions = {
  readonly roughness?: number
  readonly clearcoat?: number
  readonly clearcoatRoughness?: number
  readonly sheen?: number
  readonly emissiveIntensity?: number
  readonly metalness?: number
  readonly transparent?: boolean
  readonly opacity?: number
}

/** The single material family: injection-moulded vinyl under a studio light. */
export function createVinyl(color: string, options: VinylOptions = {}): THREE.MeshPhysicalMaterial {
  const base = new THREE.Color(color)
  const material = new THREE.MeshPhysicalMaterial({
    color: base,
    roughness: options.roughness ?? 0.34,
    metalness: options.metalness ?? 0,
    clearcoat: options.clearcoat ?? 0.55,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.28,
    sheen: options.sheen ?? 0,
    sheenColor: new THREE.Color("#ffffff"),
    envMapIntensity: 0.85,
  })
  if (options.emissiveIntensity !== undefined) {
    material.emissive = base.clone().multiplyScalar(0.6)
    material.emissiveIntensity = options.emissiveIntensity
  }
  if (options.transparent === true) {
    material.transparent = true
    material.opacity = options.opacity ?? 1
  }
  return material
}

/** Vertical gradient sky dome (DESIGN.md section 7). */
function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(320, 32, 24)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(PALETTE.skyTop) },
      horizonColor: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = clamp((normalize(vWorldPosition).y + 0.25) / 1.1, 0.0, 1.0);
        vec3 sky = mix(horizonColor, topColor, pow(h, 0.85));
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  return mesh
}

export type SceneKit = {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly sun: THREE.DirectionalLight
  resize(): void
  render(): void
  dispose(): void
}

export function createSceneKit(canvas: HTMLCanvasElement): SceneKit {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    })
  } catch (error) {
    throw new WebGLUnavailableError(error instanceof Error ? error.message : String(error))
  }

  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2))
  renderer.setSize(globalThis.innerWidth, globalThis.innerHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.skyHorizon), 120, 340)
  scene.add(createSky())

  // Studio reflections: what makes the plastic read as plastic.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = environment.texture

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    globalThis.innerWidth / globalThis.innerHeight,
    CAMERA.near,
    CAMERA.far,
  )
  camera.position.set(0, 6, -12)

  const sun = new THREE.DirectionalLight(0xfff4e2, 2.5)
  sun.position.set(28, 46, -18)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  const shadowCamera = sun.shadow.camera
  shadowCamera.near = 1
  shadowCamera.far = 200
  shadowCamera.left = -34
  shadowCamera.right = 34
  shadowCamera.top = 34
  shadowCamera.bottom = -34
  scene.add(sun)
  scene.add(sun.target)

  const bounce = new THREE.HemisphereLight(0xbfd8ff, 0xffd9b8, 0.55)
  scene.add(bounce)

  return {
    renderer,
    scene,
    camera,
    sun,
    resize() {
      const width = globalThis.innerWidth
      const height = globalThis.innerHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2))
      renderer.setSize(width, height, false)
    },
    render() {
      renderer.render(scene, camera)
    },
    dispose() {
      environment.texture.dispose()
      pmrem.dispose()
      renderer.dispose()
    },
  }
}
