import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_WIND_LINE_STYLE,
  resolveWindLineOptions,
  resolveWindLineStyle,
} from '../src/defaults.js'
import {
  AffineWindField,
  CoherentWindField,
  UniformWindField,
  VortexWindField,
  createWindSampleTarget,
} from '../src/fields/index.js'
import { createWindLineGeometry } from '../src/geometry.js'
import {
  createWindLineSeedData,
  pcgHashU32,
  tslHashFixture,
} from '../src/seed.js'
import { createWindLineSystem } from '../src/system.js'
import type {
  WindLineFrame,
  WindLineOptions,
  WindLineStats,
} from '../src/types.js'
import { WIND_LINE_CURVES } from '../src/types.js'
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three'

function getInstancedAttribute(
  geometry: InstancedBufferGeometry,
  name: string,
): InstancedBufferAttribute {
  const attribute = geometry.getAttribute(name)
  assert.ok(attribute instanceof InstancedBufferAttribute, `${name} must be instanced`)
  return attribute
}

test('PCG hash matches the native Rootwalker and TSL fixtures', () => {
  assert.equal(pcgHashU32(1), 2_831_084_092)
  assert.equal(pcgHashU32(4), 678_955_108)
  assert.equal(pcgHashU32(12), 1_237_737_413)
  assert.ok(Math.abs(tslHashFixture(1.2) - 0.659_163_1) < 1e-7)
  assert.ok(Math.abs(tslHashFixture(4.7) - 0.158_081_55) < 1e-7)
  assert.ok(Math.abs(tslHashFixture(12.4) - 0.288_183_2) < 1e-7)
})

test('seed buffers are deterministic, bounded, finite, and seed-sensitive', () => {
  const first = createWindLineSeedData(64, 0x51a1_f10d)
  const second = createWindLineSeedData(64, 0x51a1_f10d)
  const different = createWindLineSeedData(64, 0x51a1_f10e)

  assert.notStrictEqual(first.positions, second.positions)
  assert.notStrictEqual(first.traits, second.traits)
  assert.deepEqual(first.positions, second.positions)
  assert.deepEqual(first.traits, second.traits)
  assert.notDeepEqual(first.positions, different.positions)
  assert.notDeepEqual(first.traits, different.traits)
  assert.equal(first.positions.byteLength, 64 * 4 * Float32Array.BYTES_PER_ELEMENT)
  assert.equal(first.traits.byteLength, 64 * 4 * Uint8Array.BYTES_PER_ELEMENT)

  for (let offset = 0; offset < first.positions.length; offset += 4) {
    assert.ok(first.positions[offset]! >= -1 && first.positions[offset]! <= 1)
    assert.ok(first.positions[offset + 1]! >= -1 && first.positions[offset + 1]! <= 1)
    assert.ok(first.positions[offset + 2]! >= -1 && first.positions[offset + 2]! <= 1)
    assert.ok(first.positions[offset + 3]! >= 0 && first.positions[offset + 3]! < 1)
  }
  assert.ok([...first.positions, ...first.traits].every(Number.isFinite))
  for (let lane = 0; lane < 4; lane += 1) {
    const unique = new Set<number>()
    for (let offset = lane; offset < first.traits.length; offset += 4) {
      unique.add(first.traits[offset]!)
    }
    assert.ok(unique.size > 48, `trait lane ${lane} has only ${unique.size} unique values`)
  }
})

test('wind-line geometry is one instanced ribbon without instance matrices', () => {
  const capacity = 96
  const count = 42
  const segments = 28
  const seedData = createWindLineSeedData(capacity, 7)
  const geometry = createWindLineGeometry(segments, count, seedData)
  try {
    assert.equal(geometry.isInstancedBufferGeometry, true)
    assert.equal(geometry.instanceCount, count)
    assert.equal(geometry.getAttribute('instanceMatrix'), undefined)
    assert.equal(geometry.getAttribute('position').count, (segments + 1) * 2)
    assert.equal(geometry.getAttribute('uv').count, (segments + 1) * 2)
    assert.equal(geometry.getIndex()?.count, segments * 6)
    assert.equal(geometry.getAttribute('aWindSeed').count, capacity)
    assert.equal(geometry.getAttribute('aWindTrait').count, capacity)
    assert.equal(getInstancedAttribute(geometry, 'aWindSeed').count, capacity)
    assert.equal(getInstancedAttribute(geometry, 'aWindTrait').count, capacity)
    assert.equal(getInstancedAttribute(geometry, 'aWindTrait').normalized, true)
  } finally {
    geometry.dispose()
  }
})

test('options and style validation fail early at the public capacity boundaries', () => {
  const resolved = resolveWindLineOptions({
    capacity: 128,
    count: 71,
    segments: 32,
    seed: 0xffff_ffff,
    curve: 'helix',
    style: {
      widthCssPixels: [1.1, 2.2],
      colors: ['#ffffff', '#74f7ff'],
      opacity: 0.5,
    },
  })
  assert.equal(resolved.capacity, 128)
  assert.equal(resolved.count, 71)
  assert.equal(resolved.segments, 32)
  assert.equal(resolved.seed, 0xffff_ffff)
  assert.equal(resolved.curve, 'helix')
  assert.deepEqual(resolved.style.widthCssPixels, [1.1, 2.2])
  assert.notStrictEqual(resolved.style.widthCssPixels, DEFAULT_WIND_LINE_STYLE.widthCssPixels)

  for (const options of [
    { capacity: 0 },
    { capacity: 4_097 },
    { capacity: 8, count: 9 },
    { segments: 3 },
    { segments: 129 },
    { seed: -1 },
    { seed: 1.5 },
    { seed: Number.NaN },
    { seed: 0x1_0000_0000 },
    { curve: 'bezier' },
    { blending: 'screen' },
    { capacity: '8' },
  ] as readonly unknown[]) {
    assert.throws(
      () => resolveWindLineOptions(options as WindLineOptions),
      RangeError,
    )
  }
  for (const options of [
    { depthTest: 'false' },
    { name: 12 },
    { scene: {} },
  ] as readonly unknown[]) {
    assert.throws(
      () => resolveWindLineOptions(options as WindLineOptions),
      TypeError,
    )
  }

  for (const style of [
    { regionRadius: 0 },
    { verticalHalfSpan: Number.NaN },
    { widthCssPixels: [2, 1] as const },
    { opacity: 1.01 },
    { colorRandomness: 1.01 },
    { curveSweepRadians: 0 },
    { curveTurns: 33 },
    { colors: ['#fff'] as unknown as readonly [string, string] },
    { lifetime: [0, 1] as const },
    { nearFade: [8, 4] as const },
    { visibilityResponse: 101 },
  ]) {
    assert.throws(() => resolveWindLineStyle(style), RangeError)
  }
})

test('every curve family specializes one system without changing the instance layout', () => {
  for (const curve of WIND_LINE_CURVES) {
    const system = createWindLineSystem({
      curve,
      capacity: 16,
      count: 8,
      segments: 20,
    })
    try {
      const geometry = system.mesh.geometry
      assert.ok(geometry instanceof InstancedBufferGeometry)
      assert.equal(system.curve, curve)
      assert.equal(geometry.instanceCount, 8)
      assert.equal(geometry.getAttribute('instanceMatrix'), undefined)
      assert.equal(getInstancedAttribute(geometry, 'aWindTrait').normalized, true)
      const positions = geometry.getAttribute('position')
      assert.equal(
        positions.getY(0),
        curve === 'ring' ? 0.5 : 0,
        `${curve} has the wrong head taper`,
      )
      assert.equal(
        positions.getY(positions.count - 2),
        curve === 'ring' ? 0.5 : 0,
        `${curve} has the wrong tail taper`,
      )
    } finally {
      system.dispose()
    }
  }
})

test('built-in fields overwrite a caller-owned finite sample without replacing its storage', () => {
  const fields = [
    new UniformWindField([4, 0.25, -2]),
    new AffineWindField({
      origin: [1, 2, 3],
      velocity: [4, 5, 6],
      jacobian: new Matrix3().set(1, 0, 0, 0, 2, 0, 0, 0, 3),
      turbulence: 0.25,
    }),
    new CoherentWindField({
      baseVelocity: [5, 0.2, -1],
      gustSpeed: 8,
      turbulence: 0.8,
    }),
    new VortexWindField({
      center: [-3, 1, 7],
      baseVelocity: [0.8, 0, 0.2],
      angularSpeed: 1.4,
      radialInflow: 0.22,
      lift: 4.5,
      turbulence: 1.8,
      softeningRadius: 7,
    }),
  ]
  const position = new Vector3(2, 4, 6)
  const sample = createWindSampleTarget()
  const velocity = sample.velocity
  const jacobian = sample.jacobian
  const jacobianElements = sample.jacobian.elements

  for (const field of fields) {
    for (let index = 0; index < 2_048; index += 1) {
      position.set(
        Math.sin(index * 0.17) * 800,
        Math.cos(index * 0.11) * 70,
        Math.sin(index * 0.07) * 900,
      )
      const result = field.sample(position, index / 60, sample)
      assert.equal(result, undefined)
      assert.strictEqual(sample.velocity, velocity)
      assert.strictEqual(sample.jacobian, jacobian)
      assert.strictEqual(sample.jacobian.elements, jacobianElements)
      assert.ok(sample.velocity.toArray().every(Number.isFinite))
      assert.ok(sample.jacobian.elements.every(Number.isFinite))
      assert.ok(Number.isFinite(sample.turbulence))
      assert.ok(sample.turbulence >= 0)
    }
  }

  const affine = fields[1]!
  position.set(2, 4, 6)
  affine.sample(position, 0, sample)
  assert.deepEqual(sample.velocity.toArray(), [5, 9, 15])
  assert.deepEqual(position.toArray(), [2, 4, 6], 'sampling must not mutate the query position')
})

test('nonlinear field Jacobians match finite differences', () => {
  const fields = [
    new CoherentWindField({
      baseVelocity: [8.2, 0.3, -2.6],
      gustSpeed: 11,
      turbulence: 0.9,
    }),
    new VortexWindField({
      center: [-3, 2, 5],
      baseVelocity: [0.5, 0.1, -0.2],
      angularSpeed: 1.7,
      radialInflow: 0.42,
      lift: 5.8,
      turbulence: 0.6,
      softeningRadius: 6.5,
    }),
  ]
  const points = [
    new Vector3(0, 4, 0),
    new Vector3(2.5, -8, 7.25),
    new Vector3(-19, 3, 14),
    new Vector3(31, 12, -27),
  ]
  const center = createWindSampleTarget()
  const plus = createWindSampleTarget()
  const minus = createWindSampleTarget()
  const offset = new Vector3()
  const epsilon = 1e-3

  for (const field of fields) {
    for (const point of points) {
      field.sample(point, 17.25, center)
      const elements = center.jacobian.elements
      for (let axis = 0; axis < 3; axis += 1) {
        offset.copy(point).setComponent(axis, point.getComponent(axis) + epsilon)
        field.sample(offset, 17.25, plus)
        offset.copy(point).setComponent(axis, point.getComponent(axis) - epsilon)
        field.sample(offset, 17.25, minus)
        for (let component = 0; component < 3; component += 1) {
          const finiteDifference = (
            plus.velocity.getComponent(component)
            - minus.velocity.getComponent(component)
          ) / (epsilon * 2)
          const analytic = elements[axis * 3 + component]!
          assert.ok(
            Math.abs(analytic - finiteDifference) < 2e-5,
            `${field.constructor.name} J[${component},${axis}] ${analytic} != ${finiteDifference}`,
          )
        }
      }
    }
  }
})

test('coherent field matches the native Rust WeatherWindField fixture', () => {
  const field = new CoherentWindField({
    baseVelocity: [1.7, 0, -0.9],
    gustSpeed: 0.7,
    turbulence: 0,
  })
  const sample = createWindSampleTarget()
  field.sample(new Vector3(123.25, 8, -44.5), 91.125, sample)

  const expectedBits = [1_071_509_944, 1_009_852_626, 3_211_750_061]
  const bits = new DataView(new ArrayBuffer(4))
  const expected = expectedBits.map(value => {
    bits.setUint32(0, value, false)
    return bits.getFloat32(0, false)
  })
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(
      Math.abs(sample.velocity.getComponent(axis) - expected[axis]!) < 2e-6,
      `axis ${axis} diverged from Rust: ${sample.velocity.getComponent(axis)} != ${expected[axis]}`,
    )
  }
})

test('built-in fields reject malformed configuration at construction', () => {
  assert.throws(() => new AffineWindField({ turbulence: Number.NaN }), RangeError)
  assert.throws(
    () => new AffineWindField({ jacobian: [1, 0, 0] as unknown as Matrix3 }),
    RangeError,
  )
  assert.throws(
    () => new UniformWindField([1, Number.NaN, 2]),
    RangeError,
  )
  assert.throws(() => new CoherentWindField({ gustSpeed: Number.POSITIVE_INFINITY }), RangeError)
  assert.throws(
    () => new CoherentWindField({
      baseVelocity: [1, 2] as unknown as [number, number, number],
    }),
    RangeError,
  )
  assert.throws(() => new CoherentWindField({ turbulence: -1 }), RangeError)
  assert.throws(() => new VortexWindField({ angularSpeed: Number.NaN }), RangeError)
  assert.throws(() => new VortexWindField({ softeningRadius: 0 }), RangeError)
})

function createStatsTarget(): WindLineStats {
  return {
    capacity: -1,
    count: -1,
    segments: -1,
    drawCalls: -1,
    triangles: -1,
    seedBytes: -1,
    updates: -1,
    visible: false,
    visibility: -1,
    sampledSpeed: -1,
    sampledTurbulence: -1,
    dynamicInstanceUploads: -1,
    disposed: false,
  }
}

test('system update is one instanced draw with no instance matrix or seed uploads', () => {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 500)
  camera.position.set(3, 15, 26)
  camera.lookAt(0, 5, 0)
  camera.updateMatrixWorld(true)
  const system = createWindLineSystem({
    capacity: 128,
    count: 72,
    segments: 28,
    seed: 99,
    field: new CoherentWindField({
      baseVelocity: [8, 0.4, 2],
      gustSpeed: 5,
      turbulence: 0.7,
    }),
  })
  const geometry = system.mesh.geometry
  assert.ok(geometry instanceof InstancedBufferGeometry)
  const seedAttribute = getInstancedAttribute(geometry, 'aWindSeed')
  const traitAttribute = getInstancedAttribute(geometry, 'aWindTrait')
  const seedVersion = seedAttribute.version
  const traitVersion = traitAttribute.version
  const frame: WindLineFrame = {
    timeSeconds: 0,
    deltaSeconds: 1 / 60,
    anchor: new Vector3(),
    camera,
    observerVelocity: new Vector3(1, 0, 0),
    forward: new Vector3(0, 0, -1),
    active: true,
    intensity: 1,
  }
  const stats = createStatsTarget()

  try {
    assert.equal(geometry.isInstancedBufferGeometry, true)
    assert.equal(geometry.getAttribute('instanceMatrix'), undefined)
    assert.equal(system.mesh.children.length, 0)
    assert.equal(Array.isArray(system.mesh.material), false)

    for (let index = 0; index < 240; index += 1) {
      frame.timeSeconds = index / 60
      assert.equal(system.update(frame), true)
    }

    assert.strictEqual(system.readStats(stats), stats)
    assert.equal(stats.capacity, 128)
    assert.equal(stats.count, 72)
    assert.equal(stats.segments, 28)
    assert.equal(stats.drawCalls, 1)
    assert.equal(stats.triangles, 72 * 28 * 2)
    assert.equal(stats.seedBytes, 128 * (
      4 * Float32Array.BYTES_PER_ELEMENT
      + 4 * Uint8Array.BYTES_PER_ELEMENT
    ))
    assert.equal(stats.updates, 240)
    assert.equal(stats.dynamicInstanceUploads, 0)
    assert.equal(stats.visible, true)
    assert.ok(stats.sampledSpeed > 0)
    assert.equal(seedAttribute.version, seedVersion)
    assert.equal(traitAttribute.version, traitVersion)
    assert.equal(geometry.getAttribute('instanceMatrix'), undefined)
  } finally {
    system.dispose()
  }
})

test('setCount changes only the instanced draw range and validates capacity', () => {
  const system = createWindLineSystem({ capacity: 32, count: 16, segments: 12 })
  const geometry = system.mesh.geometry
  assert.ok(geometry instanceof InstancedBufferGeometry)
  const seedAttribute = getInstancedAttribute(geometry, 'aWindSeed')
  const traitAttribute = getInstancedAttribute(geometry, 'aWindTrait')
  const seedVersion = seedAttribute.version
  const traitVersion = traitAttribute.version
  const stats = createStatsTarget()
  try {
    system.setCount(31)
    assert.equal(system.count, 31)
    assert.equal(geometry.instanceCount, 31)
    system.readStats(stats)
    assert.equal(stats.count, 31)
    assert.equal(stats.drawCalls, 0)
    assert.equal(stats.triangles, 31 * 12 * 2)

    system.setCount(0)
    assert.equal(system.count, 0)
    assert.equal(geometry.instanceCount, 0)
    assert.equal(system.mesh.visible, false)
    system.readStats(stats)
    assert.equal(stats.drawCalls, 0)
    assert.equal(stats.triangles, 0)

    assert.throws(() => system.setCount(-1), RangeError)
    assert.throws(() => system.setCount(33), RangeError)
    assert.throws(() => system.setCount(1.25), RangeError)
    assert.equal(seedAttribute.version, seedVersion)
    assert.equal(traitAttribute.version, traitVersion)
  } finally {
    system.dispose()
  }
})

test('inactive updates sleep the draw and dispose is event-once and idempotent', () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 8, 18)
  camera.lookAt(0, 3, 0)
  camera.updateMatrixWorld(true)
  const system = createWindLineSystem({
    scene,
    capacity: 24,
    count: 24,
    field: new UniformWindField([12, 0, 0]),
  })
  const frame: WindLineFrame = {
    timeSeconds: 0,
    deltaSeconds: 0.25,
    anchor: [0, 0, 0],
    camera,
    active: true,
  }
  const stats = createStatsTarget()
  let geometryDisposals = 0
  let materialDisposals = 0
  system.mesh.geometry.addEventListener('dispose', () => {
    geometryDisposals += 1
  })
  const material = system.mesh.material
  assert.equal(Array.isArray(material), false)
  if (Array.isArray(material)) throw new TypeError('windline material must be singular')
  material.addEventListener('dispose', () => {
    materialDisposals += 1
  })

  assert.equal(system.mesh.parent, scene)
  assert.equal(system.update(frame), true)
  assert.equal(system.mesh.visible, true)
  frame.active = false
  for (let index = 0; index < 12; index += 1) {
    frame.timeSeconds += frame.deltaSeconds
    system.update(frame)
  }
  system.readStats(stats)
  assert.equal(stats.visible, false)
  assert.ok(stats.visibility < 0.002)

  assert.equal(system.dispose(), true)
  assert.equal(system.dispose(), false)
  assert.equal(system.mesh.parent, null)
  assert.equal(system.mesh.visible, false)
  assert.equal(geometryDisposals, 1)
  assert.equal(materialDisposals, 1)
  assert.equal(system.update(frame), false)
  assert.throws(() => system.setCount(1), /disposed/)
  assert.throws(() => system.setField(new UniformWindField()), /disposed/)
  assert.throws(() => system.setStyle({ opacity: 0.2 }), /disposed/)
  system.readStats(stats)
  assert.equal(stats.disposed, true)
})

test('runtime style updates validate before touching static geometry', () => {
  const system = createWindLineSystem({ capacity: 48, count: 32, seed: 4 })
  const geometry = system.mesh.geometry
  assert.ok(geometry instanceof InstancedBufferGeometry)
  const seedAttribute = getInstancedAttribute(geometry, 'aWindSeed')
  const traitAttribute = getInstancedAttribute(geometry, 'aWindTrait')
  const seedVersion = seedAttribute.version
  const traitVersion = traitAttribute.version
  try {
    system.setStyle({
      opacity: 0.64,
      length: 24,
      widthCssPixels: [1.25, 2.5],
      colors: ['#fff4dc', '#9affee'],
      colorRandomness: 0.86,
      visibilityThreshold: [0.1, 2],
    })
    assert.strictEqual(system.mesh.geometry, geometry)
    assert.equal(seedAttribute.version, seedVersion)
    assert.equal(traitAttribute.version, traitVersion)
    assert.throws(() => system.setStyle({ opacity: Number.NaN }), RangeError)
    assert.throws(() => system.setStyle({ colorRandomness: -0.01 }), RangeError)
    assert.throws(() => system.setStyle({ widthCssPixels: [3, 2] }), RangeError)
    assert.throws(
      () => system.setStyle({ colors: [] as unknown as [string, string] }),
      RangeError,
    )
    assert.strictEqual(system.mesh.geometry, geometry)
    assert.equal(seedAttribute.version, seedVersion)
    assert.equal(traitAttribute.version, traitVersion)
  } finally {
    system.dispose()
  }
})

test('system sanitizes a malformed custom field at the presentation boundary', () => {
  const camera = new PerspectiveCamera()
  camera.updateMatrixWorld(true)
  const field = {
    sample(_position: Vector3, _timeSeconds: number, out: ReturnType<typeof createWindSampleTarget>) {
      out.velocity.set(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
      out.jacobian.set(
        Number.NaN, 0, 0,
        0, Number.POSITIVE_INFINITY, 0,
        0, 0, Number.NEGATIVE_INFINITY,
      )
      out.turbulence = Number.NaN
    },
  }
  const system = createWindLineSystem({ field, count: 8 })
  const stats = createStatsTarget()
  try {
    assert.equal(system.update({
      timeSeconds: Number.NaN,
      deltaSeconds: Number.POSITIVE_INFINITY,
      anchor: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      camera,
    }), true)
    system.readStats(stats)
    assert.equal(stats.sampledSpeed, 0)
    assert.equal(stats.sampledTurbulence, 0)
    assert.equal(Number.isFinite(stats.visibility), true)
  } finally {
    system.dispose()
  }
})
