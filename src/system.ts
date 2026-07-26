import {
  MathUtils,
  Matrix3,
  Mesh,
  Vector3,
} from 'three/webgpu'

import {
  resolveWindLineOptions,
  resolveWindLineStyle,
} from './defaults.js'
import { UniformWindField } from './fields/uniform.js'
import { createWindLineGeometry } from './geometry.js'
import {
  applyWindLineStyle,
  createWindLineMaterial,
} from './material.js'
import type { WindLineMaterialUniforms } from './material.js'
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
  WindFieldProgram,
  WindLineFrame,
  WindLineOptions,
  WindLineStats,
  WindLineStyle,
  WindLineStyleInput,
  WindLineSystem,
  WindSampleTarget,
} from './types.js'

class WindLineSystemImpl implements WindLineSystem {
  readonly mesh
  readonly curve
  readonly program
  readonly ribbonMode
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
  readonly #sample: WindSampleTarget
  readonly #uniforms

  constructor(options: WindLineOptions = {}) {
    const resolved = resolveWindLineOptions(options)
    this.capacity = resolved.capacity
    this.curve = resolved.curve
    this.ribbonMode = resolved.ribbonMode
    this.#count = resolved.count
    this.#segments = resolved.segments
    this.#field = validateField(resolved.field ?? new UniformWindField())
    this.program = resolveFieldProgram(this.#field)
    if (this.program === 'vortex' && this.curve !== 'straight') {
      throw new RangeError('VortexWindField requires curve: "straight"')
    }
    if (this.ribbonMode === 'radial' && this.program !== 'vortex') {
      throw new RangeError('radial ribbons require a VortexWindField')
    }
    this.#style = resolved.style

    const seeds = createWindLineSeedData(resolved.capacity, resolved.seed)
    this.#seedBytes = seeds.positions.byteLength + seeds.traits.byteLength
    const geometry = createWindLineGeometry(
      resolved.segments,
      resolved.count,
      seeds,
      resolved.curve === 'ring',
    )
    const bundle = createWindLineMaterial(
      resolved.style,
      resolved.curve,
      this.program,
      resolved.ribbonMode,
      resolved.depthTest,
      resolved.depthWrite,
      resolved.blending,
    )
    this.#uniforms = bundle.uniforms
    this.#sample = {
      velocity: bundle.uniforms.fieldVelocity.value,
      jacobian: bundle.uniforms.jacobian.value,
      turbulence: 0,
    }
    this.mesh = new Mesh(geometry, bundle.material)
    this.mesh.name = resolved.name
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = resolved.renderOrder
    this.mesh.visible = false
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
    const resolved = validateField(field)
    const program = resolveFieldProgram(resolved)
    if (program !== this.program) {
      throw new RangeError(
        `cannot change field program from ${this.program} to ${program}; rebuild the system`,
      )
    }
    this.#field = resolved
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
    const center = this.#uniforms.center.value
    const eye = this.#uniforms.eye.value
    const forward = this.#uniforms.forward.value
    const observerVelocity = this.#uniforms.observerVelocity.value
    const jacobian = this.#uniforms.jacobian.value
    copyVec3(center, frame.anchor)
    if (this.program === 'vortex') {
      applyVortexProgram(this.#field, this.#uniforms)
      copyVec3(center, getVortexField(this.#field).center)
    }
    copyVec3(observerVelocity, frame.observerVelocity)
    frame.camera.getWorldPosition(eye)
    if (frame.forward !== undefined) copyVec3(forward, frame.forward)
    else frame.camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1)
    else forward.normalize()

    this.#field.sample(center, time, this.#sample)
    sanitizeVector(this.#sample.velocity)
    sanitizeMatrix(this.#sample.jacobian, jacobian)
    this.#sampledSpeed = this.#sample.velocity.length()
    this.#sampledTurbulence = Math.max(0, finite(this.#sample.turbulence, 0))

    const gradientEnergy = matrixMagnitude(jacobian)
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

    const frameState = this.#uniforms.frame.value
    frameState.set(time, this.#sampledTurbulence, this.#visibility, frameState.w)

    this.mesh.visible = this.#count > 0 && this.#visibility > 0.002
    this.#initialized = true
    this.#updates += 1
    return true
  }

  readStats(out: WindLineStats): WindLineStats {
    out.capacity = this.capacity
    out.count = this.#count
    out.segments = this.#segments
    out.drawCalls = this.mesh.visible && !this.#disposed ? 1 : 0
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

export function createWindLineSystem(options: WindLineOptions = {}): WindLineSystem {
  return new WindLineSystemImpl(options)
}

function validateField(field: WindField): WindField {
  if (!field || typeof field.sample !== 'function') {
    throw new TypeError('field must implement sample(position, timeSeconds, out)')
  }
  resolveFieldProgram(field)
  return field
}

function resolveFieldProgram(field: WindField): WindFieldProgram {
  const program = field.program ?? 'affine'
  if (program !== 'affine' && program !== 'vortex') {
    throw new RangeError('field.program must be "affine" or "vortex"')
  }
  if (program === 'vortex') getVortexField(field)
  return program
}

interface VortexProgramField extends WindField {
  readonly program: 'vortex'
  readonly center: Vector3
  readonly baseVelocity: Vector3
  readonly envelope: {
    readonly height: number
    readonly radius: readonly [number, number]
    readonly taperExponent: number
    readonly shellBias: number
    readonly coreRadiusRatio: number
    readonly axisControl: readonly [number, number]
    readonly axisTip: readonly [number, number]
    readonly axisWander: number
  }
  readonly angularSpeed: number
  readonly radialInflow: number
  readonly lift: number
  readonly softeningRadius: number
}

function getVortexField(field: WindField): VortexProgramField {
  const candidate = field as Partial<VortexProgramField>
  const envelope = candidate.envelope
  if (
    candidate.program !== 'vortex'
    || !(candidate.center instanceof Vector3)
    || !(candidate.baseVelocity instanceof Vector3)
    || !envelope
    || !Array.isArray(envelope.radius)
  ) {
    throw new TypeError('vortex fields must provide VortexWindField program parameters')
  }
  return candidate as VortexProgramField
}

function applyVortexProgram(
  source: WindField,
  uniforms: WindLineMaterialUniforms,
): void {
  const field = getVortexField(source)
  const envelope = field.envelope
  const baseRadius = finite(envelope.radius[0], 0.8)
  const topRadius = finite(envelope.radius[1], 8)
  const contraction = Math.max(
    0,
    finite(field.radialInflow, 0) / Math.max(
      0.001,
      finite(field.softeningRadius, topRadius),
      topRadius,
    ),
  )
  uniforms.vortexShape.value.set(
    Math.max(0.001, finite(envelope.height, 24)),
    Math.max(0.001, baseRadius),
    Math.max(baseRadius + 0.001, topRadius),
    clamp(finite(envelope.taperExponent, 0.72), 0.2, 4),
  )
  uniforms.vortexMotion.value.set(
    Math.max(0, finite(field.angularSpeed, 1.4)),
    contraction,
    Math.max(0.1, finite(field.baseVelocity.y + field.lift, 4.5)),
    clamp(finite(envelope.coreRadiusRatio, 0.12), 0.01, 0.5),
  )
  uniforms.vortexDetail.value.set(
    clamp(finite(envelope.shellBias, 0.76), 0, 1),
    Math.max(0, finite(envelope.axisWander, 0.8)),
  )
  uniforms.vortexAxis.value.set(
    finite(envelope.axisControl[0], 1.4),
    finite(envelope.axisControl[1], -0.7),
    finite(envelope.axisTip[0], -1),
    finite(envelope.axisTip[1], 1.1),
  )
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
