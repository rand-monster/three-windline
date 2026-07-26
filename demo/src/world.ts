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
export type DemoPresetId = 'breeze' | 'shear' | DemoVortexPresetId | 'storm'

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
  readonly vortexCenter: THREE.Vector3
  setPreset(preset: DemoPresetId): void
  setVortexLook(look: DemoVortexLook): void
  setVortexTarget(point: THREE.Vector3): boolean
  update(timeSeconds: number, deltaSeconds: number): void
  dispose(): void
}

const TERRAIN_SIZE = 280
const TERRAIN_SEGMENTS = 176
const TAU = Math.PI * 2
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
  axisWander: 1.45,
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
  const grassFlex = attribute<'float'>('aGrassFlex', 'float')
  const grassColor = attribute<'vec3'>('aGrassColor', 'vec3')
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
  const rootX = positionLocal.x
  const rootZ = positionLocal.z
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
  const shearWeight = float(1).sub(clamp(abs(preset.sub(1)), 0, 1))
  const tornadoWeight = float(1).sub(clamp(abs(preset.sub(2)), 0, 1))
  const stormWeight = float(1).sub(clamp(abs(preset.sub(3)), 0, 1))

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
  const windX = breezeWeight.mul(0.42 * 0.95)
    .add(shearWeight.mul(0.76 * 0.68))
    .add(stormWeight.mul(1.08 * 0.78))
    .add(
      tornadoWeight.mul(
        vortexTangentX
          .add(vortexInwardX.mul(0.28))
          .mul(vortexStrength),
      ),
    )
  const windZ = breezeWeight.mul(0.42 * 0.31)
    .add(shearWeight.mul(0.76 * 0.74))
    .add(stormWeight.mul(1.08 * 0.63))
    .add(
      tornadoWeight.mul(
        vortexTangentZ
          .add(vortexInwardZ.mul(0.28))
          .mul(vortexStrength),
      ),
    )
  const windLength = windX.mul(windX).add(windZ.mul(windZ)).add(0.01).sqrt()
  const flutter = sin(
    time.mul(3.1)
      .add(instance.mul(1.91))
      .add(bladePhase.mul(4.8)),
  ).mul(tipPhase).mul(0.055)
  const bendX = windX.mul(gust).mul(bendPhase).mul(grassFlex)
    .add(windZ.negate().div(windLength).mul(flutter))
  const bendZ = windZ.mul(gust).mul(bendPhase).mul(grassFlex)
    .add(windX.div(windLength).mul(flutter))
  const bendDrop = windLength
    .mul(gust)
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
    const size = 1.45 + random() ** 0.72 * 2.6
    position.set(x, y, z)
    quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, random() * TAU)
    const width = 0.82 + random() * 0.73
    scale.set(width, size, width)
    matrix.compose(position, quaternion, scale)
    grass.setMatrixAt(index, matrix)
    flexValues[index] = 0.72 + size * 0.2 + random() * 0.08
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
      0.045 + index * 0.012,
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
    })
    const ring = new THREE.Mesh(geometry, material)
    ring.name = `windline-demo-vortex-ground-ring-${index}`
    ring.position.y = 0.08 + index * 0.06
    ring.renderOrder = 6
    group.add(ring)
    return ring
  })
  const count = 640
  const points = new Float32Array(count * 3)
  const random = mulberry32(0x70ad_51f1)
  for (let index = 0; index < count; index += 1) {
    const radius = 0.9 + Math.sqrt(random()) * 8.4
    points[index * 3] = radius
    points[index * 3 + 1] = random()
    points[index * 3 + 2] = random() * TAU
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
  const dustMaterial = new THREE.PointsNodeMaterial({
    color: 0xd9bf75,
    size: 1.45,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  dustMaterial.name = 'windline-demo-vortex-ground-debris'
  const dustAge = fract(positionLocal.y.add(time.mul(0.34)))
  const dustRadius = positionLocal.x.mul(mix(1, 0.2, dustAge))
  const dustAngle = positionLocal.z.add(time.mul(2.2)).add(dustAge.mul(4.4))
  dustMaterial.positionNode = vec3(
    cos(dustAngle).mul(dustRadius),
    dustAge.mul(4.6),
    sin(dustAngle).mul(dustRadius),
  )
  dustMaterial.opacityNode = vertexStage(
    float(1).sub(tslSmoothstep(0.68, 1, dustAge)).mul(0.3),
  )
  const dust = new THREE.Points(geometry, dustMaterial)
  dust.renderOrder = 7
  group.add(dust)
  return {
    group,
    dust,
    rings,
    time,
  }
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
  const skyTexture = createSkyTexture()
  root.add(
    terrain,
    rocks,
    grass.mesh,
    farRidge,
    backRidge,
    sculpture.group,
    vortex.group,
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
  const vortexCenter = new THREE.Vector3(0, terrainHeightAt(0, 8) + 0.25, 8)
  const vortexTarget = vortexCenter.clone()
  let currentPreset: DemoPresetId = 'breeze'
  let targetSunIntensity = 3.8
  const targetFog = new THREE.Color(0x90aca4)
  const vaneTarget = new THREE.Vector3(1, 0, 0)

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
    return true
  }

  function setPreset(preset: DemoPresetId): void {
    currentPreset = preset
    grass.preset.value = preset === 'breeze'
      ? 0
      : preset === 'shear'
        ? 1
        : isVortexPreset(preset)
          ? 2
          : 3
    const vortexActive = isVortexPreset(preset)
    vortex.group.visible = vortexActive
    sculpture.group.visible = !vortexActive
    rocks.visible = !vortexActive
    if (preset === 'storm') {
      targetFog.set(0x657d7c)
      targetSunIntensity = 1.6
      vaneTarget.set(0.78, 0, 0.63)
    } else if (preset === 'shear') {
      targetFog.set(0x8aa89e)
      targetSunIntensity = 3.35
      vaneTarget.set(0.68, 0, 0.74)
    } else if (preset === 'water') {
      targetFog.set(0x80abb2)
      targetSunIntensity = 4.35
      vaneTarget.set(0.2, 0, 0.98)
      vortex.dust.material.color.set(0x89ddff)
      for (const [index, ring] of vortex.rings.entries()) {
        ring.material.color.set(index % 2 === 0 ? 0x91eaff : 0xdffbff)
      }
    } else if (preset === 'fire') {
      targetFog.set(0xa99a82)
      targetSunIntensity = 4.55
      vaneTarget.set(0.2, 0, 0.98)
      vortex.dust.material.color.set(0xff7a24)
      for (const [index, ring] of vortex.rings.entries()) {
        ring.material.color.set(index % 2 === 0 ? 0xff8a2b : 0xffdda1)
      }
    } else if (preset === 'tornado') {
      targetFog.set(0x90a99d)
      targetSunIntensity = 4.2
      vaneTarget.set(0.2, 0, 0.98)
      vortex.dust.material.color.set(0xd9bf75)
      for (const [index, ring] of vortex.rings.entries()) {
        ring.material.color.set(index % 2 === 0 ? 0xd8f5d5 : 0xffe5b0)
      }
    } else {
      targetFog.set(0x90aca4)
      targetSunIntensity = 3.8
      vaneTarget.set(0.95, 0, 0.31)
    }
  }

  function update(timeSeconds: number, deltaSeconds: number): void {
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
    sculpture.vane.rotation.y = THREE.MathUtils.lerp(
      sculpture.vane.rotation.y,
      -vaneHeading,
      1 - Math.exp(-4 * Math.min(deltaSeconds, 0.05)),
    )
    grass.time.value = timeSeconds

    if (isVortexPreset(currentPreset)) {
      const follow = 1 - Math.exp(-5.5 * Math.min(0.05, deltaSeconds))
      vortexCenter.lerp(vortexTarget, follow)
      vortex.group.position.copy(vortexCenter)
      grass.vortexCenter.value.set(vortexCenter.x, vortexCenter.z)
      vortex.time.value = timeSeconds
      for (const [index, ring] of vortex.rings.entries()) {
        const pulse = 1 + Math.sin(timeSeconds * 1.25 + index * 1.7) * 0.045
        ring.rotation.y = timeSeconds * (index % 2 === 0 ? 0.34 : -0.27)
        ring.scale.set(
          pulse * (1.08 + index * 0.055),
          1,
          pulse * (0.72 + index * 0.045),
        )
      }
    }
  }

  function dispose(): void {
    rocks.dispose()
    grass.mesh.dispose()
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<DisposableMaterial>()
    root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        if (object.geometry) geometries.add(object.geometry)
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
    vortexCenter,
    setPreset,
    setVortexLook,
    setVortexTarget,
    update,
    dispose,
  })
}
