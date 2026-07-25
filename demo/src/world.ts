import * as THREE from 'three/webgpu'

export type DemoPresetId = 'breeze' | 'shear' | 'tornado' | 'storm'

type DisposableMaterial = THREE.Material & { map?: THREE.Texture | null }

export interface DemoWorld {
  readonly root: THREE.Group
  readonly anchor: THREE.Vector3
  readonly forward: THREE.Vector3
  readonly vortexCenter: THREE.Vector3
  setPreset(preset: DemoPresetId): void
  update(timeSeconds: number, deltaSeconds: number): void
  dispose(): void
}

const TERRAIN_SIZE = 280
const TERRAIN_SEGMENTS = 176
const TAU = Math.PI * 2

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
      const shade = (broad - 0.5) * 25 + (fine - 0.5) * 11 + fiber * 4
      const offset = (y * size + x) * 4
      data[offset] = THREE.MathUtils.clamp(142 + shade, 0, 255)
      data[offset + 1] = THREE.MathUtils.clamp(177 + shade, 0, 255)
      data[offset + 2] = THREE.MathUtils.clamp(112 + shade * 0.7, 0, 255)
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

function createTerrain(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  )
  geometry.rotateX(-Math.PI * 0.5)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const low = new THREE.Color(0x4f7557)
  const meadow = new THREE.Color(0x78a75c)
  const stone = new THREE.Color(0x66766b)
  const sunGrass = new THREE.Color(0x9bbf58)
  const color = new THREE.Color()
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const z = position.getZ(index)
    const height = terrainHeightAt(x, z)
    position.setY(index, height)
    const stoneMix = smoothstep(8, 26, height + (fbm(x * 0.08, z * 0.08) - 0.5) * 8)
    color.copy(low).lerp(meadow, smoothstep(-6, 4, height))
    color.lerp(stone, stoneMix * 0.68)
    color.lerp(sunGrass, smoothstep(-0.1, 0.75, fbm(x * 0.026 + 11, z * 0.026)))
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const material = new THREE.MeshStandardMaterial({
    map: createTerrainTexture(),
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

function createGrassField(): THREE.InstancedMesh {
  const count = 1_800
  const geometry = new THREE.ConeGeometry(0.055, 0.9, 3, 1)
  geometry.translate(0, 0.45, 0)
  const material = new THREE.MeshStandardMaterial({
    color: 0xbfd698,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  })
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
  for (let index = 0; index < count; index += 1) {
    const z = (random() - 0.5) * 240
    const center = -Math.sin(z * 0.021) * 7
    const spread = (random() - 0.5) * 118
    const x = center + spread
    const y = terrainHeightAt(x, z)
    const size = 0.55 + random() * 0.9
    position.set(x, y, z)
    quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, random() * TAU)
    scale.set(size * (0.65 + random() * 0.5), size, size * (0.65 + random() * 0.5))
    matrix.compose(position, quaternion, scale)
    grass.setMatrixAt(index, matrix)
    tint.setHSL(0.22 + random() * 0.075, 0.3 + random() * 0.22, 0.37 + random() * 0.16)
    grass.setColorAt(index, tint)
  }
  grass.instanceMatrix.needsUpdate = true
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true
  return grass
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

function createVortexGuide(): {
  group: THREE.Group
  rings: THREE.Mesh[]
  dust: THREE.Points
} {
  const group = new THREE.Group()
  group.name = 'windline-demo-vortex-guide'
  const ground = terrainHeightAt(0, 8)
  group.position.set(0, ground + 0.2, 8)
  group.visible = false
  const material = new THREE.MeshBasicMaterial({
    color: 0xf1d8b0,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const rings: THREE.Mesh[] = []
  for (let index = 0; index < 6; index += 1) {
    const phase = index / 5
    const radius = THREE.MathUtils.lerp(1.7, 6.8, phase)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 6, 96), material.clone())
    ring.position.y = phase * 14
    ring.rotation.x = Math.PI * 0.5 + Math.sin(index * 2.1) * 0.06
    ring.rotation.y = index * 0.38
    rings.push(ring)
    group.add(ring)
  }

  const count = 180
  const points = new Float32Array(count * 3)
  const random = mulberry32(0x70ad_51f1)
  for (let index = 0; index < count; index += 1) {
    const y = random() * 16
    const phase = y / 16
    const radius = 1.4 + phase * 6.2 + (random() - 0.5) * 1.7
    const angle = random() * TAU + y * 0.82
    points[index * 3] = Math.cos(angle) * radius
    points[index * 3 + 1] = y
    points[index * 3 + 2] = Math.sin(angle) * radius
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
  const dustMaterial = new THREE.PointsMaterial({
    color: 0xe8c898,
    size: 0.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  })
  const dust = new THREE.Points(geometry, dustMaterial)
  group.add(dust)
  return { group, rings, dust }
}

function createCloudBank(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'windline-demo-cloud-bank'
  const material = new THREE.MeshStandardMaterial({
    color: 0xe4eee8,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  })
  const geometry = new THREE.IcosahedronGeometry(1, 2)
  const random = mulberry32(0xc10d_2026)
  for (let cluster = 0; cluster < 10; cluster += 1) {
    const cloud = new THREE.Group()
    const x = (random() - 0.5) * 250
    const y = 44 + random() * 24
    const z = -90 + random() * 220
    cloud.position.set(x, y, z)
    for (let lobe = 0; lobe < 4; lobe += 1) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set((random() - 0.5) * 9, (random() - 0.5) * 2.8, (random() - 0.5) * 4)
      mesh.scale.set(5 + random() * 8, 2 + random() * 3, 3 + random() * 6)
      cloud.add(mesh)
    }
    group.add(cloud)
  }
  return group
}

export function createDemoWorld(scene: THREE.Scene): DemoWorld {
  const root = new THREE.Group()
  root.name = 'windline-demo-world'
  scene.add(root)

  const terrain = createTerrain()
  const rocks = createRockField()
  const grass = createGrassField()
  const backRidge = createDistantRidge(-176, 41, 0x6d8f86, 2.1)
  const farRidge = createDistantRidge(-224, 55, 0x789b94, 7.4)
  const sculpture = createWindSculpture()
  const vortex = createVortexGuide()
  const clouds = createCloudBank()
  root.add(terrain, rocks, grass, farRidge, backRidge, sculpture.group, vortex.group, clouds)

  scene.background = new THREE.Color(0x8cb8b7)
  scene.fog = new THREE.FogExp2(0x90aca4, 0.0037)
  const hemisphere = new THREE.HemisphereLight(0xd8ece5, 0x34483d, 1.05)
  const sun = new THREE.DirectionalLight(0xffd19a, 3.1)
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
  const fill = new THREE.DirectionalLight(0x83c3c1, 0.42)
  fill.position.set(62, 32, 48)
  root.add(hemisphere, sun, fill)

  const anchor = new THREE.Vector3(0, terrainHeightAt(0, 8) + 3, 8)
  const forward = new THREE.Vector3(0.95, 0.04, 0.31).normalize()
  const vortexCenter = new THREE.Vector3(0, terrainHeightAt(0, 8) + 2, 8)
  let currentPreset: DemoPresetId = 'breeze'
  let targetSunIntensity = 3.1
  const targetBackground = new THREE.Color(0x8cb8b7)
  const targetFog = new THREE.Color(0x90aca4)
  const vaneTarget = new THREE.Vector3(1, 0, 0)

  function setPreset(preset: DemoPresetId): void {
    currentPreset = preset
    vortex.group.visible = preset === 'tornado'
    sculpture.group.visible = preset !== 'tornado'
    if (preset === 'storm') {
      targetBackground.set(0x526f78)
      targetFog.set(0x657d7c)
      targetSunIntensity = 1.6
      vaneTarget.set(0.78, 0, 0.63)
    } else if (preset === 'shear') {
      targetBackground.set(0x81ada8)
      targetFog.set(0x8aa89e)
      targetSunIntensity = 3.35
      vaneTarget.set(0.68, 0, -0.74)
    } else if (preset === 'tornado') {
      targetBackground.set(0x718f8d)
      targetFog.set(0x81988f)
      targetSunIntensity = 2.45
      vaneTarget.set(0.2, 0, 0.98)
    } else {
      targetBackground.set(0x8cb8b7)
      targetFog.set(0x90aca4)
      targetSunIntensity = 3.1
      vaneTarget.set(0.95, 0, 0.31)
    }
  }

  function update(timeSeconds: number, deltaSeconds: number): void {
    const blend = 1 - Math.exp(-2.8 * Math.min(0.05, deltaSeconds))
    if (scene.background instanceof THREE.Color) scene.background.lerp(targetBackground, blend)
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
    clouds.position.x = Math.sin(timeSeconds * 0.018) * 8

    if (currentPreset === 'tornado') {
      vortex.group.rotation.y = timeSeconds * 0.72
      vortex.dust.rotation.y = timeSeconds * 1.4
      for (let index = 0; index < vortex.rings.length; index += 1) {
        const ring = vortex.rings[index]
        if (!ring) continue
        ring.rotation.z = Math.sin(timeSeconds * 1.3 + index) * 0.035
        ring.scale.setScalar(1 + Math.sin(timeSeconds * 2.1 + index * 0.7) * 0.035)
      }
    }
  }

  function dispose(): void {
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
    root.removeFromParent()
  }

  return Object.freeze({
    root,
    anchor,
    forward,
    vortexCenter,
    setPreset,
    update,
    dispose,
  })
}
