import {
  MathUtils,
  Matrix3,
  Mesh,
  Vector3,
} from 'three/webgpu'

import {
  resolveWindLineOptions,
  resolveWindLineStyle,
  type ResolvedWindLineOptions,
} from './defaults.js'
import { UniformWindField, createWindSampleTarget } from './fields/uniform.js'
import { createWindLineGeometry } from './geometry.js'
import {
  applyWindLineStyle,
  createWindLineMaterial,
} from './material.js'
import { createWindLineSeedData } from './seed.js'
import {
  clamp,
  copyVec3,
  finite,
  matrixMagnitude,
  smoothstepNumber,
} from './internal/math.js'
import type {
  WindField,
  WindLineFrame,
  WindLineOptions,
  WindLineStats,
  WindLineStyle,
  WindLineStyleInput,
  WindLineSystem,
} from './types.js'

export class ThreeWindLineSystem implements WindLineSystem {
  readonly mesh
  readonly object3d
  readonly capacity

  #count: number
  #field: WindField
  #style: WindLineStyle
  #disposed = false
  #initialized = false
  #updates = 0
  #visibility = 0
  #sampledSpeed = 0
  #sampledTurbulence = 0

  readonly #segments: number
  readonly #seedBytes: number
  readonly #sample = createWindSampleTarget()
  readonly #center = new Vector3()
  readonly #eye = new Vector3()
  readonly #forward = new Vector3(0, 0, 1)
  readonly #observerVelocity = new Vector3()
  readonly #safeJacobian = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0)
  readonly #uniforms

  constructor(options: WindLineOptions = {}) {
    const resolved = resolveWindLineOptions(options)
    this.capacity = resolved.capacity
    this.#count = resolved.count
    this.#segments = resolved.segments
    this.#field = resolved.field ?? new UniformWindField()
    this.#style = resolved.style

    const seeds = createWindLineSeedData(resolved.capacity, resolved.seed)
    this.#seedBytes = seeds.positions.byteLength + seeds.traits.byteLength
    const geometry = createWindLineGeometry(resolved.segments, resolved.count, seeds)
    const bundle = createWindLineMaterial(
      resolved.style,
      resolved.depthTest,
      resolved.blending,
    )
    this.#uniforms = bundle.uniforms
    this.mesh = new Mesh(geometry, bundle.material)
    this.mesh.name = resolved.name
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = resolved.renderOrder
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.visible = false
    this.object3d = this.mesh
    resolved.scene?.add(this.mesh)
  }

  get count(): number {
    return this.#count
  }

  setCount(count: number): void {
    this.#assertAlive()
    if (!Number.isInteger(count) || count < 0 || count > this.capacity) {
      throw new RangeError(`count must be an integer from 0 to ${this.capacity}`)
    }
    this.#count = count
    this.mesh.geometry.instanceCount = count
    if (count === 0) this.mesh.visible = false
  }

  setField(field: WindField): void {
    this.#assertAlive()
    if (!field || typeof field.sample !== 'function') {
      throw new TypeError('field must implement sample(position, timeSeconds, out)')
    }
    this.#field = field
  }

  setStyle(input: WindLineStyleInput): void {
    this.#assertAlive()
    this.#style = resolveWindLineStyle(input, this.#style)
    applyWindLineStyle(this.#uniforms, this.#style)
  }

  update(frame: WindLineFrame): boolean {
    if (this.#disposed) return false
    if (!frame?.camera) throw new TypeError('update requires a camera')

    const time = finite(frame.timeSeconds, 0)
    const delta = clamp(finite(frame.deltaSeconds, 0), 0, 0.25)
    copyVec3(this.#center, frame.anchor)
    copyVec3(this.#observerVelocity, frame.observerVelocity)
    frame.camera.getWorldPosition(this.#eye)
    if (frame.forward !== undefined) copyVec3(this.#forward, frame.forward)
    else frame.camera.getWorldDirection(this.#forward)
    this.#forward.y = 0
    if (this.#forward.lengthSq() < 1e-8) this.#forward.set(0, 0, 1)
    else this.#forward.normalize()

    this.#field.sample(this.#center, time, this.#sample)
    sanitizeVector(this.#sample.velocity)
    sanitizeMatrix(this.#sample.jacobian, this.#safeJacobian)
    this.#sampledSpeed = this.#sample.velocity.length()
    this.#sampledTurbulence = Math.max(0, finite(this.#sample.turbulence, 0))

    const gradientEnergy = matrixMagnitude(this.#safeJacobian)
      * Math.min(this.#style.regionRadius, 20)
      * 0.25
    const signal = this.#sampledSpeed + gradientEnergy + this.#sampledTurbulence * 0.25
    const intensity = clamp(finite(frame.intensity, 1), 0, 8)
    const targetVisibility = frame.active === false
      ? 0
      : intensity * smoothstepNumber(
        this.#style.visibilityThreshold[0],
        this.#style.visibilityThreshold[1],
        signal,
      )
    const response = this.#style.visibilityResponse
    this.#visibility = !this.#initialized || response === 0
      ? targetVisibility
      : MathUtils.lerp(
        this.#visibility,
        targetVisibility,
        1 - Math.exp(-response * delta),
      )

    const elements = this.#safeJacobian.elements
    this.#uniforms.time.value = time
    this.#uniforms.center.value.copy(this.#center)
    this.#uniforms.eye.value.copy(this.#eye)
    this.#uniforms.forward.value.copy(this.#forward)
    this.#uniforms.observerVelocity.value.copy(this.#observerVelocity)
    this.#uniforms.fieldVelocity.value.copy(this.#sample.velocity)
    this.#uniforms.jacobianX.value.set(elements[0], elements[1], elements[2])
    this.#uniforms.jacobianY.value.set(elements[3], elements[4], elements[5])
    this.#uniforms.jacobianZ.value.set(elements[6], elements[7], elements[8])
    this.#uniforms.turbulence.value = this.#sampledTurbulence
    this.#uniforms.visibility.value = this.#visibility

    this.mesh.visible = this.#count > 0 && this.#visibility > 0.002
    this.#initialized = true
    this.#updates += 1
    return true
  }

  readStats(out: WindLineStats): WindLineStats {
    out.capacity = this.capacity
    out.count = this.#count
    out.segments = this.#segments
    out.drawCalls = this.#count > 0 ? 1 : 0
    out.triangles = this.#count * this.#segments * 2
    out.seedBytes = this.#seedBytes
    out.updates = this.#updates
    out.visible = this.mesh.visible
    out.visibility = this.#visibility
    out.sampledSpeed = this.#sampledSpeed
    out.sampledTurbulence = this.#sampledTurbulence
    out.dynamicInstanceUploads = 0
    out.disposed = this.#disposed
    return out
  }

  dispose(): boolean {
    if (this.#disposed) return false
    this.#disposed = true
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.mesh.visible = false
    return true
  }

  #assertAlive(): void {
    if (this.#disposed) throw new Error('three-windline system is disposed')
  }
}

export function createWindLineSystem(options: WindLineOptions = {}): ThreeWindLineSystem {
  return new ThreeWindLineSystem(options)
}

function sanitizeVector(vector: Vector3): void {
  vector.set(
    finite(vector.x, 0),
    finite(vector.y, 0),
    finite(vector.z, 0),
  )
}

function sanitizeMatrix(source: Matrix3, target: Matrix3): void {
  const input = source.elements
  const output = target.elements
  for (let index = 0; index < 9; index += 1) {
    output[index] = finite(input[index], 0)
  }
}
