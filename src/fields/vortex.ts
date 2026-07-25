import { Matrix3, Vector3 } from 'three'
import { copyVec3, finite } from '../internal/math.js'
import type { Vec3Like, WindField, WindSampleTarget } from '../types.js'

export interface VortexWindFieldOptions {
  center?: Vec3Like
  baseVelocity?: Vec3Like
  angularSpeed?: number
  radialInflow?: number
  lift?: number
  turbulence?: number
  softeningRadius?: number
}

export class VortexWindField implements WindField {
  readonly center = new Vector3()
  readonly baseVelocity = new Vector3(0.8, 0, 0.2)
  angularSpeed = 1.4
  radialInflow = 0.22
  lift = 4.5
  turbulence = 1.8
  softeningRadius = 7

  readonly #dx = new Vector3()
  readonly #plus = new Vector3()
  readonly #minus = new Vector3()
  readonly #velocityPlus = new Vector3()
  readonly #velocityMinus = new Vector3()

  constructor(options: VortexWindFieldOptions = {}) {
    this.configure(options)
  }

  configure(options: VortexWindFieldOptions): this {
    if (options.center !== undefined) copyVec3(this.center, options.center)
    if (options.baseVelocity !== undefined) copyVec3(this.baseVelocity, options.baseVelocity)
    this.angularSpeed = nonNegative('angularSpeed', options.angularSpeed, this.angularSpeed)
    this.radialInflow = nonNegative('radialInflow', options.radialInflow, this.radialInflow)
    this.lift = finiteValue('lift', options.lift, this.lift)
    this.turbulence = nonNegative('turbulence', options.turbulence, this.turbulence)
    this.softeningRadius = positive(
      'softeningRadius',
      options.softeningRadius,
      this.softeningRadius,
    )
    return this
  }

  sample(position: Vector3, timeSeconds: number, out: WindSampleTarget): void {
    this.#sampleVelocity(position, timeSeconds, out.velocity)
    this.#sampleJacobian(position, timeSeconds, out.jacobian)
    out.turbulence = this.turbulence
  }

  #sampleVelocity(position: Vector3, timeSeconds: number, out: Vector3): Vector3 {
    this.#dx.subVectors(position, this.center)
    const x = this.#dx.x
    const z = this.#dx.z
    const radiusSquared = x * x + z * z
    const radius = Math.sqrt(radiusSquared)
    const softened = Math.sqrt(radiusSquared + this.softeningRadius * this.softeningRadius)
    const swirl = this.angularSpeed * this.softeningRadius / softened
    const inward = this.radialInflow / Math.max(softened, 0.001)
    const core = Math.exp(-radiusSquared / (this.softeningRadius * this.softeningRadius * 2))
    const breathing = 1 + Math.sin(timeSeconds * 0.7 + radius * 0.11) * 0.08

    return out.set(
      this.baseVelocity.x + (-z * swirl - x * inward) * breathing,
      this.baseVelocity.y + this.lift * (0.25 + core * 0.75),
      this.baseVelocity.z + (x * swirl - z * inward) * breathing,
    )
  }

  #sampleJacobian(position: Vector3, timeSeconds: number, out: Matrix3): void {
    const epsilon = Math.max(0.15, this.softeningRadius * 0.025)
    const inverseSpan = 0.5 / epsilon
    const elements = out.elements

    for (let axis = 0; axis < 3; axis += 1) {
      this.#plus.copy(position).setComponent(axis, position.getComponent(axis) + epsilon)
      this.#minus.copy(position).setComponent(axis, position.getComponent(axis) - epsilon)
      this.#sampleVelocity(this.#plus, timeSeconds, this.#velocityPlus)
      this.#sampleVelocity(this.#minus, timeSeconds, this.#velocityMinus)
      this.#velocityPlus.sub(this.#velocityMinus).multiplyScalar(inverseSpan)

      elements[axis * 3] = this.#velocityPlus.x
      elements[axis * 3 + 1] = this.#velocityPlus.y
      elements[axis * 3 + 2] = this.#velocityPlus.z
    }
  }
}

function finiteValue(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const result = finite(value, Number.NaN)
  if (!Number.isFinite(result)) throw new RangeError(`${name} must be finite`)
  return result
}

function nonNegative(name: string, value: number | undefined, fallback: number): number {
  const result = finiteValue(name, value, fallback)
  if (result < 0) throw new RangeError(`${name} must be >= 0`)
  return result
}

function positive(name: string, value: number | undefined, fallback: number): number {
  const result = finiteValue(name, value, fallback)
  if (result <= 0) throw new RangeError(`${name} must be > 0`)
  return result
}
