/**
 * Renderer, scene, lighting and the glossy-vinyl material factory.
 * Everything here implements DESIGN.md section 3 (Materials).
 */

import * as THREE from "three"
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
    clearcoat: options.clearcoat ?? 0.38,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.34,
    sheen: options.sheen ?? 0,
    sheenColor: new THREE.Color("#ffffff"),
    envMapIntensity: 0.42,
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

/**
 * The PMREM studio. RoomEnvironment's 900-intensity point light floods the
 * irradiance map: it washed saturated vinyl out to white and crushed the key
 * light's shadow contrast to nothing. This dome reuses the sky palette for
 * ambient and adds three dim light cards, so clearcoat still reads as glossy
 * plastic without nuking albedo or shadows.
 */
function createStudioEnvironment(): THREE.Scene {
  const scene = new THREE.Scene()
  const domeGeometry = new THREE.SphereGeometry(50, 32, 24)
  const positions = domeGeometry.getAttribute("position")
  const colors = new Float32Array(positions.count * 3)
  const top = new THREE.Color(PALETTE.skyTop).multiplyScalar(0.65)
  const horizon = new THREE.Color(PALETTE.skyHorizon).multiplyScalar(0.65)
  const scratch = new THREE.Color()
  for (let index = 0; index < positions.count; index += 1) {
    const height = THREE.MathUtils.clamp((positions.getY(index) / 50 + 0.25) / 1.1, 0, 1)
    scratch.copy(horizon).lerp(top, height ** 0.85)
    colors[index * 3] = scratch.r
    colors[index * 3 + 1] = scratch.g
    colors[index * 3 + 2] = scratch.b
  }
  domeGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  const dome = new THREE.Mesh(
    domeGeometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }),
  )
  scene.add(dome)

  const card = (
    width: number,
    height: number,
    intensity: number,
    x: number,
    y: number,
    z: number,
  ): void => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(intensity, intensity * 0.96, intensity * 0.9),
      }),
    )
    mesh.position.set(x, y, z)
    mesh.lookAt(0, 0, 0)
    scene.add(mesh)
  }
  card(24, 16, 2.5, 12, 30, -10)
  card(16, 10, 1.5, -18, 22, 14)
  card(10, 8, 0.9, 0, 8, -30)
  return scene
}

/** Vertical gradient sky dome (DESIGN.md section 7). */
function createSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.SphereGeometry(320, 32, 24)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    // The sky is authored colour, not light: skip tone mapping so the output
    // is exactly the DESIGN.md gradient (ACES would wash it to grey).
    toneMapped: false,
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
        // ShaderMaterial skips the automatic output transform: convert the
        // authored working-space colour to the output sRGB, then dither to
        // break up gradient banding.
        #include <colorspace_fragment>
        float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        gl_FragColor.rgb += (dither - 0.5) * (1.5 / 255.0);
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
  renderer.toneMappingExposure = 0.86
  renderer.shadowMap.enabled = true
  // PCFSoftShadowMap is deprecated in r185 (silently downgrades to PCF); use
  // PCF with a small radius for the soft toy shadow instead.
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()
  // Built-in materials tone-map fogged fragments toward the fog colour, so
  // pre-brighten it: after ACES it lands back on the authored horizon tone
  // and distant geometry dissolves seamlessly into the sky.
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.skyHorizon).multiplyScalar(1.22), 120, 340)
  const sky = createSky()
  scene.add(sky)

  // Studio reflections: what makes the plastic read as plastic.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const studio = createStudioEnvironment()
  const environment = pmrem.fromScene(studio, 0.04)
  scene.environment = environment.texture
  studio.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      if (object.material instanceof THREE.Material) object.material.dispose()
    }
  })

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    globalThis.innerWidth / globalThis.innerHeight,
    CAMERA.near,
    CAMERA.far,
  )
  camera.position.set(0, 6, -12)

  const sun = new THREE.DirectionalLight(0xfff6e8, 1.45)
  sun.position.set(28, 46, -18)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  sun.shadow.radius = 3
  const shadowCamera = sun.shadow.camera
  // Tight depth range around the light's working distance (~57 m): better
  // depth precision, no acne, no peter-panning.
  shadowCamera.near = 10
  shadowCamera.far = 120
  shadowCamera.left = -34
  shadowCamera.right = 34
  shadowCamera.top = 34
  shadowCamera.bottom = -34
  scene.add(sun)
  scene.add(sun.target)

  const bounce = new THREE.HemisphereLight(0xbfd8ff, 0xffd9b8, 0.25)
  scene.add(bounce)

  // QA inspection surface: automated checks read renderer.info and shadow state.
  Object.defineProperty(globalThis, "wobbleScene", {
    // camera included so rendering QA can free-look at overlap suspects
    // (grazing angles are where coincident surfaces flicker worst).
    value: { renderer, sun, scene, sky, camera },
    configurable: true,
  })

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
      environment.dispose()
      pmrem.dispose()
      sky.geometry.dispose()
      sky.material.dispose()
      renderer.dispose()
    },
  }
}
