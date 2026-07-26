import * as THREE from 'three/webgpu'
import {
  abs,
  attribute,
  clamp,
  cos,
  float,
  fract,
  instanceIndex,
  mix,
  positionLocal,
  sin,
  smoothstep as tslSmoothstep,
  uniform,
  uv,
  vec3,
  vertexStage,
} from 'three/tsl'

export const VORTEX_PRESET_IDS = Object.freeze([
  'tornado',
  'water',
  'fire',
] as const)

export type DemoVortexPresetId = (typeof VORTEX_PRESET_IDS)[number]
export type DemoPresetId = 'breeze' | DemoVortexPresetId | 'storm'

export function isVortexPreset(preset: DemoPresetId): preset is DemoVortexPresetId {
  return VORTEX_PRESET_IDS.includes(preset as DemoVortexPresetId)
}

type DisposableMaterial = THREE.Material & { map?: THREE.Texture | null }

export interface DemoVortexLook {
  readonly height: number
  readonly topRadius: number
  readonly axisBend: number
  readonly axisWander: number
  readonly volume: number
}

export interface DemoWorld {
  readonly root: THREE.Group
  readonly anchor: THREE.Vector3
  readonly forward: THREE.Vector3
  readonly vanePosition: THREE.Vector3
  readonly vortexCenter: THREE.Vector3
  readonly vortexTarget: THREE.Vector3
  readonly vortexVelocity: THREE.Vector3
  readonly vortexLean: THREE.Vector2
  resetFeedback(): void
  setPreset(preset: DemoPresetId): void
  setVaneWind(velocity: THREE.Vector3): void
  setVortexLook(look: DemoVortexLook): void
  setVortexTarget(point: THREE.Vector3): boolean
  update(timeSeconds: number, deltaSeconds: number): void
  dispose(): void
}

const TERRAIN_SIZE = 280
const TERRAIN_SEGMENTS = 176
const TAU = Math.PI * 2
const VORTEX_MAX_SPEED = 6.5
const VORTEX_ACCELERATION = 8.5
const VORTEX_BRAKING = 10.5
const VORTEX_TURN_ACCELERATION = 12.5
const VORTEX_LEAN_RESPONSE = 4.2
const TERRAIN_LOW = new THREE.Color(0x557b4f)
const TERRAIN_MEADOW = new THREE.Color(0x80a953)
const TERRAIN_MOSS = new THREE.Color(0x3f7b50)
const TERRAIN_SUN_GRASS = new THREE.Color(0xb4c85d)
const TERRAIN_STRAW = new THREE.Color(0xc5ae62)
const TERRAIN_STONE = new THREE.Color(0x6d7e68)

export const DEMO_VORTEX_ENVELOPE = Object.freeze({
  height: 26,
  radius: Object.freeze([0.7, 9.6] as const),
  taperExponent: 0.68,
  shellBias: 0.64,
  coreRadiusRatio: 0.12,
  axisControl: Object.freeze([4.5, -2.2] as const),
  axisTip: Object.freeze([-3, 2.8] as const),
  axisWander: 1.8,
})

function smoothstep(minimum: number, maximum: number, value: number): number {
  const phase = THREE.MathUtils.clamp(
    (value - minimum) / Math.max(1e-6, maximum - minimum),
    0,
    1,
  )
  return phase * phase * (3 - 2 * phase)
}

function hash2(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43_758.545_312_3
  return value - Math.floor(value)
}

function valueNoise(x: number, z: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = x - x0
  const fz = z - z0
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = hash2(x0, z0)
  const b = hash2(x0 + 1, z0)
  const c = hash2(x0, z0 + 1)
  const d = hash2(x0 + 1, z0 + 1)
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, sx),
    THREE.MathUtils.lerp(c, d, sx),
    sz,
  )
}

function fbm(x: number, z: number): number {
  let amplitude = 0.5
  let frequency = 1
  let value = 0
  let weight = 0
  for (let octave = 0; octave < 5; octave += 1) {
    value += valueNoise(x * frequency, z * frequency) * amplitude
    weight += amplitude
    amplitude *= 0.5
    frequency *= 2.03
  }
  return value / weight
}

export function terrainHeightAt(x: number, z: number): number {
  const longWave = (fbm(x * 0.012 + 8.4, z * 0.012 - 3.7) - 0.5) * 9
  const detail = (fbm(x * 0.041 - 5.1, z * 0.041 + 9.8) - 0.5) * 2.6
  const valleyDistance = Math.abs(x + Math.sin(z * 0.021) * 7)
  const shoulders = smoothstep(18, 78, valleyDistance) * 20
  const channel = -Math.exp(-(valleyDistance * valleyDistance) / 180) * 1.9
  const distantRise = smoothstep(82, 136, Math.hypot(x, z)) * 8
  return longWave + detail + shoulders + channel + distantRise - 2
}

function terrainSurfaceColorAt(
  x: number,
  z: number,
  height: number,
  out: THREE.Color,
): THREE.Color {
  const broadPatch = fbm(x * 0.018 + 11.4, z * 0.018 - 6.2)
  const mossPatch = fbm(x * 0.052 - 4.7, z * 0.052 + 18.1)
  const warmPatch = fbm(x * 0.031 + 32.5, z * 0.031 - 21.7)
  const stoneMix = smoothstep(
    8,
    26,
    height + (fbm(x * 0.08, z * 0.08) - 0.5) * 8,
  )
  out.copy(TERRAIN_LOW).lerp(TERRAIN_MEADOW, smoothstep(-6, 4, height))
  out.lerp(TERRAIN_MOSS, smoothstep(0.56, 0.78, mossPatch) * 0.38)
  out.lerp(TERRAIN_SUN_GRASS, smoothstep(0.5, 0.76, broadPatch) * 0.56)
  out.lerp(TERRAIN_STRAW, smoothstep(0.68, 0.86, warmPatch) * 0.22)
  out.lerp(TERRAIN_STONE, stoneMix * 0.68)
  return out
}

function terrainTextureColorAt(x: number, z: number, out: THREE.Color): THREE.Color {
  const textureX = THREE.MathUtils.euclideanModulo(
    (x / TERRAIN_SIZE + 0.5) * 12,
    1,
  ) * 256
  const textureY = THREE.MathUtils.euclideanModulo(
    (0.5 - z / TERRAIN_SIZE) * 12,
    1,
  ) * 256
  const broad = fbm(textureX * 0.035 + 19, textureY * 0.035 - 12)
  const fine = hash2(textureX * 0.73, textureY * 0.73)
  const fiber = Math.sin((textureX + broad * 34) * 0.42) * 0.5 + 0.5
  const warmPatch = smoothstep(0.56, 0.78, broad)
  const coolPatch = smoothstep(0.2, 0.46, broad)
  const shade = (broad - 0.5) * 22 + (fine - 0.5) * 9 + fiber * 4
  return out.setRGB(
    THREE.MathUtils.clamp(142 + shade + warmPatch * 22, 0, 255) / 255,
    THREE.MathUtils.clamp(
      178 + shade + warmPatch * 15 + coolPatch * 5,
      0,
      255,
    ) / 255,
    THREE.MathUtils.clamp(
      101 + shade * 0.72 + coolPatch * 16 - warmPatch * 5,
      0,
      255,
    ) / 255,
    THREE.SRGBColorSpace,
  )
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let result = Math.imul(state ^ (state >>> 15), 1 | state)
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296
  }
}

function createTerrainTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Unable to create terrain texture')
  const image = context.createImageData(size, size)
  const data = image.data
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = fbm(x * 0.035 + 19, y * 0.035 - 12)
      const fine = hash2(x * 0.73, y * 0.73)
      const fiber = Math.sin((x + broad * 34) * 0.42) * 0.5 + 0.5
      const warmPatch = smoothstep(0.56, 0.78, broad)
      const coolPatch = smoothstep(0.2, 0.46, broad)
      const shade = (broad - 0.5) * 22 + (fine - 0.5) * 9 + fiber * 4
      const offset = (y * size + x) * 4
      data[offset] = THREE.MathUtils.clamp(142 + shade + warmPatch * 22, 0, 255)
      data[offset + 1] = THREE.MathUtils.clamp(
        178 + shade + warmPatch * 15 + coolPatch * 5,
        0,
        255,
      )
      data[offset + 2] = THREE.MathUtils.clamp(
        101 + shade * 0.72 + coolPatch * 16 - warmPatch * 5,
        0,
        255,
      )
      data[offset + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(12, 12)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function createSkyTexture(): THREE.CanvasTexture {
  const width = 768
  const height = 384
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Unable to create sky texture')
  const image = context.createImageData(width, height)
  const data = image.data
  for (let y = 0; y < height; y += 1) {
    const vertical = y / (height - 1)
    const cloudBand = THREE.MathUtils.lerp(
      0.76,
      1,
      smoothstep(0.08, 0.42, vertical),
    ) * (1 - smoothstep(0.82, 0.98, vertical))
    for (let x = 0; x < width; x += 1) {
      const horizontal = x / width
      const broad = fbm(x * 0.009 + 17.3, y * 0.015 - 4.7)
      const detail = fbm(x * 0.028 - 8.2, y * 0.041 + 12.4)
      const ridge = fbm(x * 0.005 + 31.2, y * 0.024 + 3.5)
      const cloudField = broad * 0.62 + detail * 0.23 + ridge * 0.15
      const cloud = smoothstep(0.39, 0.59, cloudField) * cloudBand
      const underside = smoothstep(0.44, 0.68, ridge)
      const horizon = smoothstep(0.42, 0.92, vertical)
      const sunDistance = (
        (horizontal - 0.16) * (horizontal - 0.16) * 7
        + (vertical - 0.61) * (vertical - 0.61) * 18
      )
      const sunGlow = Math.exp(-sunDistance * 5.5)

      let red = THREE.MathUtils.lerp(92, 174, horizon)
      let green = THREE.MathUtils.lerp(133, 188, horizon)
      let blue = THREE.MathUtils.lerp(143, 181, horizon)
      const cloudLight = THREE.MathUtils.clamp(
        0.38 + (broad - ridge) * 1.8 + sunGlow * 0.58,
        0,
        1,
      )
      const cloudRed = THREE.MathUtils.lerp(104, 232, cloudLight)
      const cloudGreen = THREE.MathUtils.lerp(126, 231, cloudLight)
      const cloudBlue = THREE.MathUtils.lerp(130, 211, cloudLight)
      const cloudStrength = cloud * THREE.MathUtils.lerp(0.66, 0.92, underside)
      red = THREE.MathUtils.lerp(red, cloudRed, cloudStrength)
      green = THREE.MathUtils.lerp(green, cloudGreen, cloudStrength)
      blue = THREE.MathUtils.lerp(blue, cloudBlue, cloudStrength)
      red += sunGlow * 48
      green += sunGlow * 35
      blue += sunGlow * 14

      const offset = (y * width + x) * 4
      data[offset] = THREE.MathUtils.clamp(red, 0, 255)
      data[offset + 1] = THREE.MathUtils.clamp(green, 0, 255)
      data[offset + 2] = THREE.MathUtils.clamp(blue, 0, 255)
      data[offset + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.name = 'windline-demo-procedural-cloud-sky'
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

function createTerrain(terrainTexture: THREE.CanvasTexture): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  )
  geometry.rotateX(-Math.PI * 0.5)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const color = new THREE.Color()
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const z = position.getZ(index)
    const height = terrainHeightAt(x, z)
    position.setY(index, height)
    terrainSurfaceColorAt(x, z, height, color)
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const material = new THREE.MeshStandardMaterial({
    map: terrainTexture,
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
  })
  const terrain = new THREE.Mesh(geometry, material)
  terrain.name = 'windline-demo-terrain'
  terrain.receiveShadow = true
  return terrain
}

function createRockField(): THREE.InstancedMesh {
  const count = 84
  const geometry = new THREE.DodecahedronGeometry(1, 1)
  geometry.scale(1, 1.55, 0.9)
  const material = new THREE.MeshStandardMaterial({
    color: 0xaab7a9,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
  })
  const rocks = new THREE.InstancedMesh(geometry, material, count)
  rocks.name = 'windline-demo-rock-field'
  rocks.castShadow = true
  rocks.receiveShadow = true
  const random = mulberry32(0x51a7_2026)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const euler = new THREE.Euler()
  const tint = new THREE.Color()
  for (let index = 0; index < count; index += 1) {
    const side = index % 2 === 0 ? -1 : 1
    let x = side * (34 + random() * 92)
    const z = (random() - 0.5) * 245
    if (side > 0 && z > 18 && x < 72) x += 34
    const size = 1.2 + random() ** 2 * 6.8
    position.set(x, terrainHeightAt(x, z) + size * 0.62, z)
    euler.set((random() - 0.5) * 0.3, random() * TAU, (random() - 0.5) * 0.22)
    quaternion.setFromEuler(euler)
    scale.set(
      size * (0.65 + random() * 0.55),
      size * (0.78 + random() * 0.72),
      size * (0.7 + random() * 0.5),
    )
    matrix.compose(position, quaternion, scale)
    rocks.setMatrixAt(index, matrix)
    tint.setHSL(0.29 + random() * 0.035, 0.12 + random() * 0.1, 0.4 + random() * 0.11)
    rocks.setColorAt(index, tint)
  }
  rocks.instanceMatrix.needsUpdate = true
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true
  return rocks
}

function createGrassBladeGeometry(): THREE.BufferGeometry {
  const segments = 9
  const planes = 2
  const verticesPerPlane = (segments + 1) * 2
  const positions = new Float32Array(planes * verticesPerPlane * 3)
  const uvs = new Float32Array(planes * verticesPerPlane * 2)
  const indices = new Uint16Array(planes * segments * 6)
  let vertex = 0
  let uvIndex = 0
  let triangle = 0
  for (let plane = 0; plane < planes; plane += 1) {
    const planeStart = plane * verticesPerPlane
    for (let row = 0; row <= segments; row += 1) {
      const heightPhase = row / segments
      const halfWidth = 0.15 * (1 - heightPhase ** 1.45) + 0.005
      const crownLean = heightPhase ** 2 * 0.075
      for (let side = 0; side < 2; side += 1) {
        const cross = side === 0 ? -halfWidth : halfWidth
        if (plane === 0) {
          positions[vertex] = cross
          positions[vertex + 1] = heightPhase
          positions[vertex + 2] = crownLean
        } else {
          positions[vertex] = -crownLean
          positions[vertex + 1] = heightPhase
          positions[vertex + 2] = cross
        }
        uvs[uvIndex] = side
        uvs[uvIndex + 1] = heightPhase
        vertex += 3
        uvIndex += 2
      }
      if (row < segments) {
        const current = planeStart + row * 2
        indices[triangle] = current
        indices[triangle + 1] = current + 2
        indices[triangle + 2] = current + 1
        indices[triangle + 3] = current + 1
        indices[triangle + 4] = current + 2
        indices[triangle + 5] = current + 3
        triangle += 6
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function createGrassField() {
  const count = 36_000
  const geometry = createGrassBladeGeometry()
  const flexValues = new Float32Array(count)
  const colorValues = new Float32Array(count * 3)
  const rootValues = new Float32Array(count * 2)
  const grassFlex = attribute<'float'>('aGrassFlex', 'float')
  const grassColor = attribute<'vec3'>('aGrassColor', 'vec3')
  const grassRoot = attribute<'vec2'>('aGrassRoot', 'vec2')
  const time = uniform(0)
  const preset = uniform(0)
  const vortexTopRadius = uniform(DEMO_VORTEX_ENVELOPE.radius[1])
  const vortexCenter = uniform(new THREE.Vector2(0, 8))
  const material = new THREE.MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  material.name = 'windline-demo-gpu-grass-material'

  const bladePhase = uv().y
  const bendPhase = bladePhase.mul(bladePhase)
  const tipPhase = bendPhase.mul(bladePhase)
  const instance = float(instanceIndex)
  const rootX = grassRoot.x
  const rootZ = grassRoot.y
  const gust = sin(
    time.mul(1.18)
      .add(rootX.mul(0.115))
      .add(rootZ.mul(0.073))
      .add(instance.mul(0.037)),
  ).mul(0.18).add(
    sin(
      time.mul(2.07)
        .sub(rootX.mul(0.043))
        .add(rootZ.mul(0.19))
        .add(instance.mul(0.011)),
    ).mul(0.08),
  ).add(0.82)

  const breezeWeight = float(1).sub(clamp(abs(preset), 0, 1))
  const tornadoWeight = float(1).sub(clamp(abs(preset.sub(1)), 0, 1))
  const stormWeight = float(1).sub(clamp(abs(preset.sub(2)), 0, 1))

  const vortexX = rootX.sub(vortexCenter.x)
  const vortexZ = rootZ.sub(vortexCenter.y)
  const vortexRadius = vortexX
    .mul(vortexX)
    .add(vortexZ.mul(vortexZ))
    .add(0.16)
    .sqrt()
  const inverseRadius = float(1).div(vortexRadius)
  const vortexFalloff = float(1).sub(tslSmoothstep(
    vortexTopRadius.mul(0.52),
    vortexTopRadius.mul(3.96),
    vortexRadius,
  ))
  const vortexTangentX = vortexZ.negate().mul(inverseRadius)
  const vortexTangentZ = vortexX.mul(inverseRadius)
  const vortexInwardX = vortexX.negate().mul(inverseRadius)
  const vortexInwardZ = vortexZ.negate().mul(inverseRadius)
  const vortexStrength = vortexFalloff.mul(1.62).add(0.08)
  const vortexBuffet = sin(
    time.mul(9.6)
      .add(vortexRadius.mul(1.42))
      .add(instance.mul(0.83)),
  ).mul(0.16).add(
    sin(
      time.mul(15.4)
        .sub(vortexRadius.mul(0.74))
        .add(instance.mul(2.17)),
    ).mul(0.07),
  ).mul(vortexFalloff).mul(tornadoWeight)
  const windX = breezeWeight.mul(0.42 * 0.95)
    .add(stormWeight.mul(1.08 * 0.78))
    .add(
      tornadoWeight.mul(
        vortexTangentX
          .add(vortexInwardX.mul(0.28))
          .mul(vortexStrength),
      ),
    )
  const windZ = breezeWeight.mul(0.42 * 0.31)
    .add(stormWeight.mul(1.08 * 0.63))
    .add(
      tornadoWeight.mul(
        vortexTangentZ
          .add(vortexInwardZ.mul(0.28))
          .mul(vortexStrength),
      ),
    )
  const windLength = windX.mul(windX).add(windZ.mul(windZ)).add(0.01).sqrt()
  const ambientFlutter = sin(
    time.mul(3.1)
      .add(instance.mul(1.91))
      .add(bladePhase.mul(4.8)),
  ).mul(tipPhase).mul(0.055)
  const tipBuffet = vortexBuffet.mul(tipPhase).mul(grassFlex)
  const bendX = windX
    .mul(gust.add(vortexBuffet.mul(0.44)))
    .mul(bendPhase)
    .mul(grassFlex)
    .add(
      windZ.negate()
        .div(windLength)
        .mul(ambientFlutter.add(tipBuffet)),
    )
  const bendZ = windZ
    .mul(gust.add(vortexBuffet.mul(0.44)))
    .mul(bendPhase)
    .mul(grassFlex)
    .add(
      windX
        .div(windLength)
        .mul(ambientFlutter.add(tipBuffet)),
    )
  const bendDrop = windLength
    .mul(gust.add(abs(vortexBuffet).mul(0.32)))
    .mul(bendPhase)
    .mul(grassFlex)
    .mul(-0.13)
  material.positionNode = positionLocal.add(vec3(bendX, bendDrop, bendZ))

  const tipLift = vec3(1.6, 1.7, 0.96)
  const heightColor = mix(
    vec3(1),
    tipLift,
    tslSmoothstep(0.18, 1, bladePhase),
  )
  const sunFleck = sin(instance.mul(2.399).add(rootX.mul(0.31)))
    .mul(0.5)
    .add(0.5)
  material.colorNode = grassColor.mul(heightColor).mul(
    mix(1, mix(0.9, 1.12, sunFleck), tipPhase),
  )
  material.emissiveNode = grassColor.mul(
    mix(0.82, 0.16, tslSmoothstep(0, 0.76, bladePhase)),
  )

  const grass = new THREE.InstancedMesh(geometry, material, count)
  grass.name = 'windline-demo-grass'
  grass.castShadow = false
  grass.receiveShadow = true
  const random = mulberry32(0x6a45_51c)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const tint = new THREE.Color()
  const textureTint = new THREE.Color()
  for (let index = 0; index < count; index += 1) {
    const z = (random() - 0.5) * 248
    const center = -Math.sin(z * 0.021) * 7
    const spread = (random() - 0.5) * 176
    const x = center + spread
    const y = terrainHeightAt(x, z)
    const size = 1.85 + random() ** 0.72 * 3.15
    position.set(x, y, z)
    quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, random() * TAU)
    const width = 0.88 + random() * 0.78
    scale.set(width, size, width)
    matrix.compose(position, quaternion, scale)
    grass.setMatrixAt(index, matrix)
    flexValues[index] = 0.68 + size * 0.17 + random() * 0.08
    rootValues[index * 2] = x
    rootValues[index * 2 + 1] = z
    terrainSurfaceColorAt(x, z, y, tint).multiply(
      terrainTextureColorAt(x, z, textureTint),
    )
    colorValues[index * 3] = tint.r
    colorValues[index * 3 + 1] = tint.g
    colorValues[index * 3 + 2] = tint.b
  }
  grass.instanceMatrix.needsUpdate = true
  geometry.setAttribute(
    'aGrassFlex',
    new THREE.InstancedBufferAttribute(flexValues, 1),
  )
  geometry.setAttribute(
    'aGrassColor',
    new THREE.InstancedBufferAttribute(colorValues, 3),
  )
  geometry.setAttribute(
    'aGrassRoot',
    new THREE.InstancedBufferAttribute(rootValues, 2),
  )
  grass.computeBoundingSphere()
  if (grass.boundingSphere) grass.boundingSphere.radius += 8
  return { mesh: grass, time, preset, vortexTopRadius, vortexCenter }
}

function createDistantRidge(
  distance: number,
  height: number,
  color: number,
  phase: number,
): THREE.Mesh {
  const sections = 72
  const positions = new Float32Array((sections + 1) * 2 * 3)
  const indices = new Uint16Array(sections * 6)
  for (let index = 0; index <= sections; index += 1) {
    const x = (index / sections - 0.5) * 430
    const ridge = height
      + Math.sin(index * 0.37 + phase) * height * 0.18
      + Math.sin(index * 0.13 + phase * 2) * height * 0.24
      + valueNoise(index * 0.29, phase) * height * 0.32
    const offset = index * 6
    positions[offset] = x
    positions[offset + 1] = -15
    positions[offset + 2] = distance
    positions[offset + 3] = x
    positions[offset + 4] = ridge
    positions[offset + 5] = distance
    if (index < sections) {
      const base = index * 2
      const indexOffset = index * 6
      indices[indexOffset] = base
      indices[indexOffset + 1] = base + 1
      indices[indexOffset + 2] = base + 2
      indices[indexOffset + 3] = base + 1
      indices[indexOffset + 4] = base + 3
      indices[indexOffset + 5] = base + 2
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  })
  const ridge = new THREE.Mesh(geometry, material)
  ridge.name = `windline-demo-ridge-${distance}`
  ridge.receiveShadow = true
  return ridge
}

function createWindSculpture(): {
  group: THREE.Group
  rings: THREE.Mesh[]
  vane: THREE.Group
} {
  const group = new THREE.Group()
  group.name = 'windline-demo-wind-sculpture'
  const baseY = terrainHeightAt(0, 8)
  group.position.set(0, baseY, 8)

  const stone = new THREE.MeshStandardMaterial({
    color: 0x445b54,
    roughness: 0.72,
    metalness: 0.08,
  })
  const brass = new THREE.MeshStandardMaterial({
    color: 0xd4783d,
    roughness: 0.28,
    metalness: 0.74,
  })
  const paleMetal = new THREE.MeshStandardMaterial({
    color: 0xd8e3d8,
    roughness: 0.34,
    metalness: 0.62,
  })
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8f4e5,
    emissive: 0x5ea792,
    emissiveIntensity: 0.45,
    roughness: 0.2,
    metalness: 0.35,
  })

  const footing = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 0.8, 10), stone)
  footing.position.y = 0.4
  footing.receiveShadow = true
  footing.castShadow = true
  group.add(footing)

  const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.32, 7.6, 12), paleMetal)
  pylon.position.y = 4.2
  pylon.castShadow = true
  group.add(pylon)

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 2), coreMaterial)
  core.position.y = 7.6
  core.castShadow = true
  group.add(core)

  const rings: THREE.Mesh[] = []
  const ringProfiles: ReadonlyArray<{
    readonly radius: number
    readonly tube: number
    readonly rotation: readonly [number, number, number]
  }> = [
    { radius: 3.6, tube: 0.075, rotation: [0.18, 0, 0.1] },
    { radius: 2.8, tube: 0.065, rotation: [Math.PI * 0.5, 0.22, 0] },
    { radius: 2.05, tube: 0.055, rotation: [0.22, Math.PI * 0.5, -0.14] },
  ]
  for (const [index, profile] of ringProfiles.entries()) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(profile.radius, profile.tube, 10, 96),
      index === 0 ? brass : paleMetal,
    )
    ring.position.y = 7.6
    ring.rotation.set(...profile.rotation)
    ring.castShadow = true
    rings.push(ring)
    group.add(ring)
  }

  const vane = new THREE.Group()
  vane.name = 'windline-demo-wind-vane'
  vane.position.y = 7.6
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 5.1, 8), brass)
  shaft.rotation.z = Math.PI * 0.5
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.85, 8), brass)
  tip.position.x = 2.95
  tip.rotation.z = -Math.PI * 0.5
  vane.add(shaft, tip)
  group.add(vane)
  return { group, rings, vane }
}

function createVortexGuide() {
  const group = new THREE.Group()
  group.name = 'windline-demo-vortex-guide'
  const ground = terrainHeightAt(0, 8)
  group.position.set(0, ground + 0.25, 8)
  group.visible = false
  const time = uniform(0)
  const rings = [2.8, 4.25, 5.9, 7.2].map((radius, index) => {
    const geometry = new THREE.TorusGeometry(
      radius,
      0.075 + index * 0.018,
      6,
      96,
    )
    geometry.rotateX(Math.PI * 0.5)
    const material = new THREE.MeshBasicMaterial({
      color: index % 2 === 0 ? 0xd8f5d5 : 0xffe5b0,
      transparent: true,
      opacity: 0.34 - index * 0.045,
      depthWrite: false,
      toneMapped: true,
      blending: THREE.AdditiveBlending,
    })
    const ring = new THREE.Mesh(geometry, material)
    ring.name = `windline-demo-vortex-ground-ring-${index}`
    ring.position.y = 0.08 + index * 0.06
    ring.renderOrder = 6
    group.add(ring)
    return ring
  })
  const glowStrength = uniform(0.18)
  const glowMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0xccebd4,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  glowMaterial.name = 'windline-demo-vortex-impact-glow'
  const glowRadius = uv().sub(0.5).length().mul(2)
  glowMaterial.opacityNode = float(1)
    .sub(tslSmoothstep(0.08, 1, glowRadius))
    .pow(2)
    .mul(glowStrength)
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    glowMaterial,
  )
  glow.rotation.x = -Math.PI * 0.5
  glow.position.y = 0.18
  glow.renderOrder = 5
  group.add(glow)

  const haloStrength = uniform(0.08)
  const haloMaterial = new THREE.SpriteNodeMaterial({
    color: 0x9ed9b6,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  })
  haloMaterial.name = 'windline-demo-vortex-local-halo'
  const haloRadius = uv().sub(0.5).length().mul(2)
  haloMaterial.opacityNode = float(1)
    .sub(tslSmoothstep(0, 1, haloRadius))
    .pow(2.4)
    .mul(haloStrength)
  const halo = new THREE.Sprite(haloMaterial)
  halo.position.y = 12
  halo.scale.set(22, 34, 1)
  halo.renderOrder = 3
  group.add(halo)

  const contactLight = new THREE.PointLight(0x9ed9b6, 0, 26, 2)
  contactLight.name = 'windline-demo-vortex-contact-light'
  contactLight.position.y = 2.4
  group.add(contactLight)

  const count = 1_100
  const debrisSeeds = new Float32Array(count * 4)
  const random = mulberry32(0x70ad_51f1)
  for (let index = 0; index < count; index += 1) {
    const radius = 0.9 + Math.sqrt(random()) * 8.4
    debrisSeeds[index * 4] = radius
    debrisSeeds[index * 4 + 1] = random()
    debrisSeeds[index * 4 + 2] = random() * TAU
    debrisSeeds[index * 4 + 3] = 0.62 + random() * 1.5
  }
  const geometry = new THREE.TetrahedronGeometry(0.075, 0)
  geometry.setAttribute(
    'aDebrisSeed',
    new THREE.InstancedBufferAttribute(debrisSeeds, 4),
  )
  const debrisSeed = attribute<'vec4'>('aDebrisSeed', 'vec4')
  const dustMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0xd9bf75,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  dustMaterial.name = 'windline-demo-vortex-ground-debris'
  const dustAge = fract(debrisSeed.y.add(time.mul(0.4)))
  const dustRadius = debrisSeed.x.mul(mix(1, 0.18, dustAge))
  const dustAngle = debrisSeed.z.add(time.mul(2.8)).add(dustAge.mul(5.2))
  const dustFade = tslSmoothstep(0, 0.08, dustAge)
    .mul(float(1).sub(tslSmoothstep(0.68, 1, dustAge)))
  const dustScale = debrisSeed.w
    .mul(mix(0.35, 1, tslSmoothstep(0, 0.16, dustAge)))
    .mul(mix(1, 0.26, tslSmoothstep(0.68, 1, dustAge)))
  dustMaterial.positionNode = positionLocal.mul(dustScale).add(vec3(
    cos(dustAngle).mul(dustRadius),
    dustAge.mul(6.8).add(sin(dustAngle.mul(2.7)).mul(0.16)),
    sin(dustAngle).mul(dustRadius),
  ))
  dustMaterial.opacityNode = vertexStage(
    dustFade.mul(0.62),
  )
  const dust = new THREE.InstancedMesh(geometry, dustMaterial, count)
  const identity = new THREE.Matrix4()
  for (let index = 0; index < count; index += 1) {
    dust.setMatrixAt(index, identity)
  }
  dust.instanceMatrix.needsUpdate = true
  dust.name = 'windline-demo-vortex-ground-debris'
  dust.frustumCulled = false
  dust.renderOrder = 7
  group.add(dust)
  return {
    group,
    dust,
    rings,
    glow,
    glowStrength,
    halo,
    haloStrength,
    contactLight,
    time,
  }
}

type TargetMarkerPhase = 'hidden' | 'command' | 'waiting' | 'arrival'

interface VortexTargetMarker {
  readonly group: THREE.Group
  command(x: number, z: number, heading: number, timeSeconds: number): void
  arrive(timeSeconds: number): void
  cancel(): void
  setColor(color: THREE.ColorRepresentation): void
  update(timeSeconds: number): void
}

function pushMarkerBand(
  target: number[],
  innerRadius: number,
  outerRadius: number,
  segments: number,
): void {
  for (let segment = 0; segment < segments; segment += 1) {
    const firstAngle = segment / segments * TAU
    const secondAngle = (segment + 1) / segments * TAU
    const firstCos = Math.cos(firstAngle)
    const firstSin = Math.sin(firstAngle)
    const secondCos = Math.cos(secondAngle)
    const secondSin = Math.sin(secondAngle)
    target.push(
      firstCos * innerRadius, firstSin * innerRadius,
      firstCos * outerRadius, firstSin * outerRadius,
      secondCos * outerRadius, secondSin * outerRadius,
      firstCos * innerRadius, firstSin * innerRadius,
      secondCos * outerRadius, secondSin * outerRadius,
      secondCos * innerRadius, secondSin * innerRadius,
    )
  }
}

function pushMarkerTick(
  target: number[],
  angle: number,
  innerRadius: number,
  outerRadius: number,
  halfWidth: number,
): void {
  const directionX = Math.cos(angle)
  const directionZ = Math.sin(angle)
  const tangentX = -directionZ * halfWidth
  const tangentZ = directionX * halfWidth
  const innerX = directionX * innerRadius
  const innerZ = directionZ * innerRadius
  const outerX = directionX * outerRadius
  const outerZ = directionZ * outerRadius
  target.push(
    innerX - tangentX, innerZ - tangentZ,
    outerX - tangentX, outerZ - tangentZ,
    outerX + tangentX, outerZ + tangentZ,
    innerX - tangentX, innerZ - tangentZ,
    outerX + tangentX, outerZ + tangentZ,
    innerX + tangentX, innerZ + tangentZ,
  )
}

function pushMarkerDisc(target: number[], radius: number, segments: number): void {
  for (let segment = 0; segment < segments; segment += 1) {
    const firstAngle = segment / segments * TAU
    const secondAngle = (segment + 1) / segments * TAU
    target.push(
      0, 0,
      Math.cos(firstAngle) * radius, Math.sin(firstAngle) * radius,
      Math.cos(secondAngle) * radius, Math.sin(secondAngle) * radius,
    )
  }
}

function createMarkerGeometry(offsets: readonly number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions = new THREE.BufferAttribute(
    new Float32Array(offsets.length / 2 * 3),
    3,
  )
  positions.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', positions)
  geometry.userData.offsets = Float32Array.from(offsets)
  return geometry
}

function fitMarkerToTerrain(
  geometry: THREE.BufferGeometry,
  centerX: number,
  centerZ: number,
  heading: number,
): void {
  const offsets = geometry.userData.offsets as Float32Array
  const positions = geometry.getAttribute('position')
  const centerHeight = terrainHeightAt(centerX, centerZ)
  const headingCos = Math.cos(heading)
  const headingSin = Math.sin(heading)
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const localX = offsets[vertex * 2] ?? 0
    const localZ = offsets[vertex * 2 + 1] ?? 0
    const rotatedX = localX * headingCos - localZ * headingSin
    const rotatedZ = localX * headingSin + localZ * headingCos
    positions.setXYZ(
      vertex,
      rotatedX,
      terrainHeightAt(centerX + rotatedX, centerZ + rotatedZ) - centerHeight + 0.12,
      rotatedZ,
    )
  }
  positions.needsUpdate = true
  geometry.computeBoundingSphere()
}

function createVortexTargetMarker(): VortexTargetMarker {
  const group = new THREE.Group()
  group.name = 'windline-demo-vortex-target-marker'
  group.visible = false

  const reticleOffsets: number[] = []
  pushMarkerBand(reticleOffsets, 0.72, 0.84, 64)
  pushMarkerBand(reticleOffsets, 1.72, 1.82, 64)
  for (let tick = 0; tick < 8; tick += 1) {
    const forward = tick === 0
    pushMarkerTick(
      reticleOffsets,
      tick / 8 * TAU,
      forward ? 1.06 : 1.28,
      forward ? 2.24 : 1.58,
      forward ? 0.075 : 0.055,
    )
  }
  const pulseOffsets: number[] = []
  pushMarkerBand(pulseOffsets, 1.96, 2.08, 64)
  pushMarkerDisc(pulseOffsets, 0.2, 24)

  const reticleMaterial = new THREE.MeshBasicMaterial({
    color: 0xcfffd0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  reticleMaterial.name = 'windline-demo-vortex-target-reticle'
  const pulseMaterial = new THREE.MeshBasicMaterial({
    color: 0xeaffdb,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  })
  pulseMaterial.name = 'windline-demo-vortex-target-pulse'
  const reticle = new THREE.Mesh(
    createMarkerGeometry(reticleOffsets),
    reticleMaterial,
  )
  const pulse = new THREE.Mesh(
    createMarkerGeometry(pulseOffsets),
    pulseMaterial,
  )
  reticle.name = 'windline-demo-vortex-target-reticle'
  pulse.name = 'windline-demo-vortex-target-pulse'
  reticle.renderOrder = 8
  pulse.renderOrder = 9
  group.add(reticle, pulse)

  let phase: TargetMarkerPhase = 'hidden'
  let phaseStartedAt = 0
  let commandSerial = 0
  let arrivalSerial = 0

  function syncDebugState(): void {
    group.userData.phase = phase
    group.userData.commandSerial = commandSerial
    group.userData.arrivalSerial = arrivalSerial
  }

  function setPhase(nextPhase: TargetMarkerPhase, timeSeconds: number): void {
    phase = nextPhase
    phaseStartedAt = timeSeconds
    group.visible = nextPhase === 'command' || nextPhase === 'arrival'
    syncDebugState()
  }

  function command(
    x: number,
    z: number,
    heading: number,
    timeSeconds: number,
  ): void {
    const height = terrainHeightAt(x, z)
    group.position.set(x, height, z)
    group.scale.setScalar(1)
    fitMarkerToTerrain(reticle.geometry, x, z, heading)
    fitMarkerToTerrain(pulse.geometry, x, z, heading)
    commandSerial += 1
    setPhase('command', timeSeconds)
  }

  function arrive(timeSeconds: number): void {
    if (phase === 'hidden' || phase === 'arrival') return
    arrivalSerial += 1
    setPhase('arrival', timeSeconds)
  }

  function cancel(): void {
    phase = 'hidden'
    group.visible = false
    reticleMaterial.opacity = 0
    pulseMaterial.opacity = 0
    syncDebugState()
  }

  function setColor(color: THREE.ColorRepresentation): void {
    reticleMaterial.color.set(color)
    pulseMaterial.color.copy(reticleMaterial.color).lerp(new THREE.Color(0xffffff), 0.42)
  }

  function update(timeSeconds: number): void {
    if (phase === 'hidden' || phase === 'waiting') return
    const age = Math.max(0, timeSeconds - phaseStartedAt)
    if (phase === 'command') {
      if (age >= 0.9) {
        setPhase('waiting', timeSeconds)
        reticleMaterial.opacity = 0
        pulseMaterial.opacity = 0
        return
      }
      const expansion = 1 - (1 - Math.min(1, age / 0.42)) ** 3
      const fade = 1 - smoothstep(0.18, 0.9, age)
      reticleMaterial.opacity = 0.72 * fade
      pulseMaterial.opacity = 0.95 * fade
      reticle.scale.setScalar(0.86 + expansion * 0.18)
      pulse.scale.setScalar(0.7 + expansion * 0.58)
      return
    }
    if (age >= 0.46) {
      setPhase('hidden', timeSeconds)
      reticleMaterial.opacity = 0
      pulseMaterial.opacity = 0
      return
    }
    const contraction = smoothstep(0, 0.46, age)
    const fade = 1 - smoothstep(0.08, 0.46, age)
    reticleMaterial.opacity = 0.38 * fade
    pulseMaterial.opacity = 0.34 * fade
    reticle.scale.setScalar(1.08 - contraction * 0.34)
    pulse.scale.setScalar(1.18 - contraction * 0.58)
  }

  syncDebugState()
  return { group, command, arrive, cancel, setColor, update }
}

export function createDemoWorld(scene: THREE.Scene): DemoWorld {
  const root = new THREE.Group()
  root.name = 'windline-demo-world'
  scene.add(root)

  const terrainTexture = createTerrainTexture()
  const terrain = createTerrain(terrainTexture)
  const rocks = createRockField()
  const grass = createGrassField()
  const backRidge = createDistantRidge(-176, 41, 0x6d8f86, 2.1)
  const farRidge = createDistantRidge(-224, 55, 0x789b94, 7.4)
  const sculpture = createWindSculpture()
  const vortex = createVortexGuide()
  const targetMarker = createVortexTargetMarker()
  const skyTexture = createSkyTexture()
  root.add(
    terrain,
    rocks,
    grass.mesh,
    farRidge,
    backRidge,
    sculpture.group,
    vortex.group,
    targetMarker.group,
  )

  scene.background = skyTexture
  scene.fog = new THREE.FogExp2(0x90aca4, 0.0037)
  const hemisphere = new THREE.HemisphereLight(0xd8ece5, 0x34483d, 0.68)
  const sun = new THREE.DirectionalLight(0xffd19a, 3.8)
  sun.name = 'windline-demo-sun'
  sun.position.set(-52, 82, -38)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -72
  sun.shadow.camera.right = 72
  sun.shadow.camera.top = 72
  sun.shadow.camera.bottom = -72
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 220
  sun.shadow.bias = -0.00025
  sun.shadow.normalBias = 0.035
  const fill = new THREE.DirectionalLight(0x83c3c1, 0.3)
  fill.position.set(62, 32, 48)
  root.add(hemisphere, sun, fill)

  const anchor = new THREE.Vector3(0, terrainHeightAt(0, 8) + 3, 8)
  const forward = new THREE.Vector3(0.95, 0.04, 0.31).normalize()
  const vanePosition = new THREE.Vector3(
    sculpture.group.position.x + sculpture.vane.position.x,
    sculpture.group.position.y + sculpture.vane.position.y,
    sculpture.group.position.z + sculpture.vane.position.z,
  )
  const vortexCenter = new THREE.Vector3(0, terrainHeightAt(0, 8) + 0.25, 8)
  const vortexTarget = vortexCenter.clone()
  const vortexVelocity = new THREE.Vector3()
  const vortexLean = new THREE.Vector2()
  const vortexLeanTarget = new THREE.Vector2()
  let worldTimeSeconds = 0
  let currentPreset: DemoPresetId = 'breeze'
  let targetSunIntensity = 3.8
  let vortexGlowStrength = 0.18
  let vortexHaloStrength = 0.08
  let vortexContactLightIntensity = 48
  const targetFog = new THREE.Color(0x90aca4)
  const vaneTarget = new THREE.Vector3(1, 0, 0)

  function setVaneWind(velocity: THREE.Vector3): void {
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z)
    sculpture.vane.userData.windSpeed = Number.isFinite(horizontalSpeed)
      ? horizontalSpeed
      : 0
    if (
      !Number.isFinite(velocity.x)
      || !Number.isFinite(velocity.z)
      || horizontalSpeed < 0.05
    ) return
    vaneTarget.set(
      velocity.x / horizontalSpeed,
      0,
      velocity.z / horizontalSpeed,
    )
    sculpture.vane.userData.windX = velocity.x
    sculpture.vane.userData.windZ = velocity.z
    sculpture.vane.userData.targetHeading = Math.atan2(vaneTarget.z, vaneTarget.x)
    sculpture.vane.userData.sampleCount = (
      Number(sculpture.vane.userData.sampleCount) || 0
    ) + 1
  }

  function resetFeedback(): void {
    targetMarker.cancel()
  }

  function setVortexLook(look: DemoVortexLook): void {
    const height = THREE.MathUtils.clamp(look.height, 12, 48)
    const topRadius = THREE.MathUtils.clamp(look.topRadius, 3, 18)
    const radialScale = topRadius / DEMO_VORTEX_ENVELOPE.radius[1]
    vortex.group.scale.set(
      radialScale,
      height / DEMO_VORTEX_ENVELOPE.height,
      radialScale,
    )
    grass.vortexTopRadius.value = topRadius
  }

  function setVortexTarget(point: THREE.Vector3): boolean {
    if (
      !Number.isFinite(point.x)
      || !Number.isFinite(point.z)
    ) return false
    const x = THREE.MathUtils.clamp(point.x, -96, 96)
    const z = THREE.MathUtils.clamp(point.z, -96, 96)
    vortexTarget.set(x, terrainHeightAt(x, z) + 0.25, z)
    targetMarker.command(
      x,
      z,
      Math.atan2(z - vortexCenter.z, x - vortexCenter.x),
      worldTimeSeconds,
    )
    return true
  }

  function setPreset(preset: DemoPresetId): void {
    currentPreset = preset
    grass.preset.value = preset === 'breeze'
      ? 0
      : isVortexPreset(preset)
        ? 1
        : 2
    const vortexActive = isVortexPreset(preset)
    vortex.group.visible = vortexActive
    sculpture.group.visible = !vortexActive
    rocks.visible = !vortexActive
    if (!vortexActive) {
      vortexTarget.copy(vortexCenter)
      vortexVelocity.set(0, 0, 0)
      vortexLean.set(0, 0)
      targetMarker.cancel()
    }
    if (preset === 'storm') {
      targetFog.set(0x657d7c)
      targetSunIntensity = 1.6
    } else if (preset === 'water') {
      targetMarker.setColor(0xbcefff)
      targetFog.set(0x9cc4ca)
      targetSunIntensity = 4.35
      vortex.dust.material.color.set(0xdaf9ff)
      vortex.glow.material.color.set(0x8de4ff)
      vortex.halo.material.color.set(0x4abce8)
      vortex.contactLight.color.set(0xc6f4ff)
      vortexGlowStrength = 0.44
      vortexHaloStrength = 0.09
      vortexContactLightIntensity = 125
      for (const [index, ring] of vortex.rings.entries()) {
        ring.material.color.set(index % 2 === 0 ? 0xe9fdff : 0x68d3ff)
      }
    } else if (preset === 'fire') {
      targetMarker.setColor(0xffa34f)
      targetFog.set(0x4f514d)
      targetSunIntensity = 1.4
      vortex.dust.material.color.set(0xffffc0)
      vortex.glow.material.color.set(0xff8a00)
      vortex.halo.material.color.set(0xff3d00)
      vortex.contactLight.color.set(0xff5418)
      vortexGlowStrength = 0.62
      vortexHaloStrength = 0.11
      vortexContactLightIntensity = 185
      for (const [index, ring] of vortex.rings.entries()) {
        ring.material.color.set(index % 2 === 0 ? 0xffffd0 : 0xff7a08)
      }
    } else if (preset === 'tornado') {
      targetMarker.setColor(0xcfffd0)
      targetFog.set(0x90a99d)
      targetSunIntensity = 4.2
      vortex.dust.material.color.set(0xd9bf75)
      vortex.glow.material.color.set(0x9ed9b6)
      vortex.halo.material.color.set(0x65b990)
      vortex.contactLight.color.set(0xbce6c3)
      vortexGlowStrength = 0.24
      vortexHaloStrength = 0.052
      vortexContactLightIntensity = 68
      for (const [index, ring] of vortex.rings.entries()) {
        ring.material.color.set(index % 2 === 0 ? 0xd8f5d5 : 0xffe5b0)
      }
    } else {
      targetFog.set(0x90aca4)
      targetSunIntensity = 3.8
    }
  }

  function update(timeSeconds: number, deltaSeconds: number): void {
    worldTimeSeconds = timeSeconds
    targetMarker.update(timeSeconds)
    const blend = 1 - Math.exp(-2.8 * Math.min(0.05, deltaSeconds))
    if (scene.fog instanceof THREE.FogExp2) scene.fog.color.lerp(targetFog, blend)
    sun.intensity = THREE.MathUtils.lerp(sun.intensity, targetSunIntensity, blend)

    sculpture.rings[0]?.rotation.set(
      0.18 + Math.sin(timeSeconds * 0.31) * 0.04,
      timeSeconds * 0.08,
      0.1,
    )
    if (sculpture.rings[1]) sculpture.rings[1].rotation.y = 0.22 - timeSeconds * 0.11
    if (sculpture.rings[2]) sculpture.rings[2].rotation.x = 0.22 + timeSeconds * 0.14
    const vaneHeading = Math.atan2(vaneTarget.z, vaneTarget.x)
    const targetRotation = -vaneHeading
    const rotationDelta = Math.atan2(
      Math.sin(targetRotation - sculpture.vane.rotation.y),
      Math.cos(targetRotation - sculpture.vane.rotation.y),
    )
    sculpture.vane.rotation.y += rotationDelta
      * (1 - Math.exp(-4 * Math.min(deltaSeconds, 0.05)))
    grass.time.value = timeSeconds

    if (isVortexPreset(currentPreset)) {
      const delta = Math.min(0.05, Math.max(0, deltaSeconds))
      const deltaX = vortexTarget.x - vortexCenter.x
      const deltaZ = vortexTarget.z - vortexCenter.z
      const distance = Math.hypot(deltaX, deltaZ)
      const currentSpeed = Math.hypot(vortexVelocity.x, vortexVelocity.z)
      let desiredVelocityX = 0
      let desiredVelocityZ = 0
      let desiredSpeed = 0
      if (distance > 1e-4) {
        desiredSpeed = Math.min(
          VORTEX_MAX_SPEED,
          Math.sqrt(2 * VORTEX_BRAKING * distance),
        )
        desiredVelocityX = deltaX / distance * desiredSpeed
        desiredVelocityZ = deltaZ / distance * desiredSpeed
      }

      let accelerationX = 0
      let accelerationZ = 0
      if (delta > 0) {
        const steeringX = desiredVelocityX - vortexVelocity.x
        const steeringZ = desiredVelocityZ - vortexVelocity.z
        const steeringLength = Math.hypot(steeringX, steeringZ)
        const reversing = desiredVelocityX * vortexVelocity.x
          + desiredVelocityZ * vortexVelocity.z < 0
        const accelerationLimit = reversing
          ? VORTEX_TURN_ACCELERATION
          : desiredSpeed < currentSpeed
            ? VORTEX_BRAKING
            : VORTEX_ACCELERATION
        const velocityStep = Math.min(steeringLength, accelerationLimit * delta)
        if (steeringLength > 1e-5) {
          const velocityScale = velocityStep / steeringLength
          const velocityDeltaX = steeringX * velocityScale
          const velocityDeltaZ = steeringZ * velocityScale
          vortexVelocity.x += velocityDeltaX
          vortexVelocity.z += velocityDeltaZ
          accelerationX = velocityDeltaX / delta
          accelerationZ = velocityDeltaZ / delta
        }
        vortexCenter.x += vortexVelocity.x * delta
        vortexCenter.z += vortexVelocity.z * delta
      }
      const remainingX = vortexTarget.x - vortexCenter.x
      const remainingZ = vortexTarget.z - vortexCenter.z
      const crossedTarget = distance > 1e-4
        && deltaX * remainingX + deltaZ * remainingZ <= 0
      const restingAtTarget = Math.hypot(remainingX, remainingZ) < 0.06
        && Math.hypot(vortexVelocity.x, vortexVelocity.z) < 0.25
      if (crossedTarget || restingAtTarget) {
        vortexCenter.x = vortexTarget.x
        vortexCenter.z = vortexTarget.z
        vortexVelocity.x = 0
        vortexVelocity.z = 0
        accelerationX = 0
        accelerationZ = 0
        targetMarker.arrive(timeSeconds)
      }
      const previousHeight = vortexCenter.y
      vortexCenter.y = terrainHeightAt(vortexCenter.x, vortexCenter.z) + 0.25
      vortexVelocity.y = delta > 0
        ? (vortexCenter.y - previousHeight) / delta
        : 0
      vortexLeanTarget.set(
        -vortexVelocity.x * 0.29 - accelerationX * 0.055,
        -vortexVelocity.z * 0.29 - accelerationZ * 0.055,
      )
      if (vortexLeanTarget.lengthSq() > 2.4 ** 2) {
        vortexLeanTarget.setLength(2.4)
      }
      vortexLean.lerp(
        vortexLeanTarget,
        1 - Math.exp(-VORTEX_LEAN_RESPONSE * delta),
      )
      vortex.group.position.copy(vortexCenter)
      grass.vortexCenter.value.set(vortexCenter.x, vortexCenter.z)
      vortex.time.value = timeSeconds
      const impactWave = Math.sin(timeSeconds * 4.2) * 0.5 + 0.5
      const impactBeat = impactWave ** 7
      const impactPulse = 0.78 + impactBeat * 0.32
      vortex.glowStrength.value = vortexGlowStrength * impactPulse
      vortex.haloStrength.value = vortexHaloStrength * impactPulse
      vortex.contactLight.intensity = vortexContactLightIntensity
        * (0.72 + impactBeat * 0.42)
      const glowScale = 9.4 + Math.sin(timeSeconds * 2.2) * 0.7
      vortex.glow.scale.setScalar(glowScale)
      vortex.halo.scale.set(
        22 + Math.sin(timeSeconds * 1.8) * 0.8,
        34 + Math.cos(timeSeconds * 2.1) * 1.2,
        1,
      )
      for (const [index, ring] of vortex.rings.entries()) {
        const wave = (timeSeconds * 0.36 + index * 0.24) % 1
        const pulse = 0.32 + wave * 1.02
        const birth = smoothstep(0, 0.1, wave)
        ring.rotation.y = timeSeconds * (index % 2 === 0 ? 0.62 : -0.48)
        ring.scale.set(
          pulse * (1.05 + index * 0.045),
          1,
          pulse * (0.68 + index * 0.04),
        )
        ring.material.opacity = birth
          * (1 - wave) ** 1.35
          * (0.58 - index * 0.055)
      }
    }
  }

  function dispose(): void {
    rocks.dispose()
    grass.mesh.dispose()
    vortex.dust.dispose()
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<DisposableMaterial>()
    root.traverse((object) => {
      if (
        object instanceof THREE.Mesh
        || object instanceof THREE.Sprite
      ) {
        if (object instanceof THREE.Mesh && object.geometry) {
          geometries.add(object.geometry)
        }
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of objectMaterials) materials.add(material as DisposableMaterial)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) {
      material.map?.dispose()
      material.dispose()
    }
    skyTexture.dispose()
    if (scene.background === skyTexture) scene.background = null
    root.removeFromParent()
  }

  return Object.freeze({
    root,
    anchor,
    forward,
    vanePosition,
    vortexCenter,
    vortexTarget,
    vortexVelocity,
    vortexLean,
    resetFeedback,
    setPreset,
    setVaneWind,
    setVortexLook,
    setVortexTarget,
    update,
    dispose,
  })
}
