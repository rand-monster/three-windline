import * as THREE from 'three/webgpu'
import {
  attribute,
  cos,
  float,
  fract,
  mix,
  normalLocal,
  positionLocal,
  sin,
  smoothstep as tslSmoothstep,
  transformNormalToView,
  uniform,
  vec3,
} from 'three/tsl'

const TAU = Math.PI * 2
const HURRICANE_LIGHT_DEBRIS_COUNT = 4_096
const HURRICANE_MEDIUM_DEBRIS_COUNT = 1_024
const HURRICANE_HERO_DEBRIS_COUNT = 128

interface HurricaneDebrisLayerConfig {
  readonly name: string
  readonly count: number
  readonly geometry: THREE.BufferGeometry
  readonly colors: readonly [number, number]
  readonly roughness: number
  readonly metalness: number
  readonly heightRange: readonly [number, number]
  readonly periodRange: readonly [number, number]
  readonly scaleX: readonly [number, number]
  readonly scaleY: readonly [number, number]
  readonly scaleZ: readonly [number, number]
  readonly tumbleRange: readonly [number, number]
  readonly flutter: readonly [number, number]
  readonly seed: number
  readonly doubleSided?: boolean
  readonly castShadow?: boolean
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

export function createHurricaneDebrisField() {
  const group = new THREE.Group()
  group.name = 'windline-demo-hurricane-airborne'
  group.visible = false
  const time = uniform(0)
  const height = uniform(84)
  const topRadius = uniform(64)

  function createLayer(config: HurricaneDebrisLayerConfig): void {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setIndex(config.geometry.index?.clone() ?? null)
    for (const [name, source] of Object.entries(config.geometry.attributes)) {
      geometry.setAttribute(name, source.clone())
    }
    config.geometry.dispose()
    geometry.instanceCount = config.count
    const orbitValues = new Float32Array(config.count * 4)
    const traitValues = new Float32Array(config.count * 4)
    const shadeValues = new Float32Array(config.count * 4)
    const random = mulberry32(config.seed)
    for (let index = 0; index < config.count; index += 1) {
      // Core, shell, and ejecta lanes keep the field dense without clumping.
      const laneRoll = random()
      const laneMinimum = laneRoll < 0.25 ? 0.28 : laneRoll < 0.85 ? 0.68 : 1.12
      const laneMaximum = laneRoll < 0.25 ? 0.62 : laneRoll < 0.85 ? 1.08 : 1.55
      const angularMinimum = laneRoll < 0.25 ? 3.2 : laneRoll < 0.85 ? 1.8 : 0.8
      const angularMaximum = laneRoll < 0.25 ? 5.2 : laneRoll < 0.85 ? 3.4 : 1.8
      orbitValues[index * 4] = (
        index * 0.754_877_666 + random() * 0.19
      ) % 1
      orbitValues[index * 4 + 1] = THREE.MathUtils.lerp(
        laneMinimum,
        laneMaximum,
        random(),
      )
      orbitValues[index * 4 + 2] = (
        index * 0.618_033_989 + random() * 0.17
      ) % 1 * TAU
      orbitValues[index * 4 + 3] = THREE.MathUtils.lerp(
        angularMinimum,
        angularMaximum,
        random(),
      )
      traitValues[index * 4] = THREE.MathUtils.lerp(
        config.scaleX[0],
        config.scaleX[1],
        random(),
      )
      traitValues[index * 4 + 1] = THREE.MathUtils.lerp(
        config.scaleY[0],
        config.scaleY[1],
        random(),
      )
      traitValues[index * 4 + 2] = THREE.MathUtils.lerp(
        config.scaleZ[0],
        config.scaleZ[1],
        random(),
      )
      const period = THREE.MathUtils.lerp(
        config.periodRange[0],
        config.periodRange[1],
        random(),
      )
      traitValues[index * 4 + 3] = 1 / period
      shadeValues[index * 4] = random()
      shadeValues[index * 4 + 1] = THREE.MathUtils.lerp(
        config.tumbleRange[0],
        config.tumbleRange[1],
        random(),
      )
      shadeValues[index * 4 + 2] = random() * TAU
      shadeValues[index * 4 + 3] = THREE.MathUtils.lerp(
        config.flutter[0],
        config.flutter[1],
        random(),
      )
    }
    geometry.setAttribute(
      'aHurricaneOrbit',
      new THREE.InstancedBufferAttribute(orbitValues, 4),
    )
    geometry.setAttribute(
      'aHurricaneTrait',
      new THREE.InstancedBufferAttribute(traitValues, 4),
    )
    geometry.setAttribute(
      'aHurricaneShade',
      new THREE.InstancedBufferAttribute(shadeValues, 4),
    )
    geometry.computeBoundingSphere()

    const orbit = attribute<'vec4'>('aHurricaneOrbit', 'vec4')
    const trait = attribute<'vec4'>('aHurricaneTrait', 'vec4')
    const shade = attribute<'vec4'>('aHurricaneShade', 'vec4')
    const age = fract(orbit.x.add(time.mul(trait.w)))
    const rise = age.pow(0.78)
    const lifeScale = tslSmoothstep(0, 0.045, age).mul(
      float(1).sub(tslSmoothstep(0.93, 1, age)),
    )
    const envelopeRadius = topRadius.mul(mix(0.08, 1, rise.pow(0.68)))
    const radiusPulse = sin(
      time.mul(1.7)
        .add(orbit.z.mul(1.9))
        .add(age.mul(11.4)),
    ).mul(0.07).add(1)
    const orbitRadius = envelopeRadius.mul(orbit.y).mul(radiusPulse)
    const angle = orbit.z
      .add(time.mul(orbit.w))
      .add(rise.mul(TAU * 1.35))
      .add(sin(time.mul(2.3).add(shade.z)).mul(0.16))
    const axisX = sin(time.mul(0.62).add(rise.mul(5.1)))
      .mul(topRadius)
      .mul(0.075)
    const axisZ = cos(time.mul(0.51).add(rise.mul(4.3)).add(1.7))
      .mul(topRadius)
      .mul(0.065)
    const centerX = cos(angle).mul(orbitRadius).add(axisX)
    const centerY = height
      .mul(mix(config.heightRange[0], config.heightRange[1], rise))
      .add(
        sin(angle.mul(2.7).add(shade.z))
          .mul(topRadius)
          .mul(0.018),
      )
    const centerZ = sin(angle).mul(orbitRadius).add(axisZ)

    const flutter = sin(
      time.mul(shade.w.mul(8).add(5.5))
        .add(shade.z)
        .add(age.mul(18)),
    )
    const pitch = time.mul(shade.y)
      .add(shade.z)
      .add(flutter.mul(shade.w).mul(0.9))
    const yaw = time.mul(shade.y.mul(0.73))
      .add(shade.z.mul(1.7))
      .add(age.mul(5.4))
    const roll = time.mul(shade.y.mul(1.17))
      .add(shade.z.mul(0.47))
      .sub(flutter.mul(shade.w).mul(1.1))
    const pitchCos = cos(pitch)
    const pitchSin = sin(pitch)
    const yawCos = cos(yaw)
    const yawSin = sin(yaw)
    const rollCos = cos(roll)
    const rollSin = sin(roll)

    const localX = positionLocal.x.mul(trait.x).mul(lifeScale)
    const localY = positionLocal.y.mul(trait.y).mul(lifeScale)
    const localZ = positionLocal.z.mul(trait.z).mul(lifeScale)
    const pitchX = localX
    const pitchY = localY.mul(pitchCos).sub(localZ.mul(pitchSin))
    const pitchZ = localY.mul(pitchSin).add(localZ.mul(pitchCos))
    const yawX = pitchX.mul(yawCos).add(pitchZ.mul(yawSin))
    const yawY = pitchY
    const yawZ = pitchZ.mul(yawCos).sub(pitchX.mul(yawSin))
    const rotatedX = yawX.mul(rollCos).sub(yawY.mul(rollSin))
    const rotatedY = yawX.mul(rollSin).add(yawY.mul(rollCos))
    const rotatedZ = yawZ

    const normalX = normalLocal.x.div(trait.x)
    const normalY = normalLocal.y.div(trait.y)
    const normalZ = normalLocal.z.div(trait.z)
    const normalPitchX = normalX
    const normalPitchY = normalY.mul(pitchCos).sub(normalZ.mul(pitchSin))
    const normalPitchZ = normalY.mul(pitchSin).add(normalZ.mul(pitchCos))
    const normalYawX = normalPitchX.mul(yawCos).add(normalPitchZ.mul(yawSin))
    const normalYawY = normalPitchY
    const normalYawZ = normalPitchZ.mul(yawCos).sub(normalPitchX.mul(yawSin))
    const rotatedNormal = vec3(
      normalYawX.mul(rollCos).sub(normalYawY.mul(rollSin)),
      normalYawX.mul(rollSin).add(normalYawY.mul(rollCos)),
      normalYawZ,
    ).normalize()

    const firstColor = new THREE.Color(config.colors[0])
    const secondColor = new THREE.Color(config.colors[1])
    const material = new THREE.MeshStandardNodeMaterial({
      color: 0xffffff,
      roughness: config.roughness,
      metalness: config.metalness,
      side: config.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      flatShading: true,
    })
    material.name = `${config.name}-material`
    material.positionNode = vec3(rotatedX, rotatedY, rotatedZ).add(vec3(
      centerX,
      centerY,
      centerZ,
    ))
    material.normalNode = transformNormalToView(rotatedNormal)
    const sunFlash = sin(
      angle.mul(1.4).add(time.mul(0.7)).add(shade.z),
    ).mul(0.5).add(0.5)
    const debrisColor = mix(
      vec3(firstColor.r, firstColor.g, firstColor.b),
      vec3(secondColor.r, secondColor.g, secondColor.b),
      shade.x,
    )
    material.colorNode = debrisColor.mul(mix(0.72, 1.18, sunFlash))
    material.emissiveNode = debrisColor.mul(0.018)

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = config.name
    mesh.castShadow = config.castShadow ?? false
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    mesh.renderOrder = 3
    mesh.userData.instanceCount = config.count
    group.add(mesh)
  }

  createLayer({
    name: 'windline-demo-hurricane-light-debris',
    count: HURRICANE_LIGHT_DEBRIS_COUNT,
    geometry: new THREE.PlaneGeometry(1, 1),
    colors: [0xd9e8d2, 0xf3e8c7],
    roughness: 0.78,
    metalness: 0,
    heightRange: [0.045, 1.02],
    periodRange: [7, 13],
    scaleX: [0.22, 0.82],
    scaleY: [0.34, 1.28],
    scaleZ: [0.04, 0.07],
    tumbleRange: [2.8, 7.2],
    flutter: [0.45, 1],
    seed: 0xc10d_1eaf,
    doubleSided: true,
  })
  createLayer({
    name: 'windline-demo-hurricane-medium-debris',
    count: HURRICANE_MEDIUM_DEBRIS_COUNT,
    geometry: new THREE.BoxGeometry(1, 1, 1),
    colors: [0x76543b, 0xbb8652],
    roughness: 0.74,
    metalness: 0.06,
    heightRange: [0.07, 0.8],
    periodRange: [11, 18],
    scaleX: [0.55, 2.3],
    scaleY: [0.09, 0.3],
    scaleZ: [0.2, 0.68],
    tumbleRange: [1.2, 3.8],
    flutter: [0.08, 0.38],
    seed: 0xb04d_5ca7,
  })
  createLayer({
    name: 'windline-demo-hurricane-hero-debris',
    count: HURRICANE_HERO_DEBRIS_COUNT,
    geometry: new THREE.IcosahedronGeometry(0.72, 0),
    colors: [0x4f5b5d, 0x9d6b4e],
    roughness: 0.88,
    metalness: 0.04,
    heightRange: [0.035, 0.58],
    periodRange: [16, 25],
    scaleX: [0.78, 2.1],
    scaleY: [0.62, 1.65],
    scaleZ: [0.72, 2],
    tumbleRange: [0.45, 1.65],
    flutter: [0.02, 0.14],
    seed: 0x1ce5_70ae,
    castShadow: true,
  })
  group.userData.totalCount = (
    HURRICANE_LIGHT_DEBRIS_COUNT
    + HURRICANE_MEDIUM_DEBRIS_COUNT
    + HURRICANE_HERO_DEBRIS_COUNT
  )
  return {
    group,
    time,
    height,
    topRadius,
  }
}
