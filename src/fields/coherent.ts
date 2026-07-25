import { Matrix3, Vector3 } from 'three'
import { copyVec3, finite } from '../internal/math.js'
import type { Vec3Like, WindField, WindSampleTarget } from '../types.js'

export interface CoherentWindFieldOptions {
  baseVelocity?: Vec3Like
  gustSpeed?: number
  turbulence?: number
}

export class CoherentWindField implements WindField {
  readonly baseVelocity = new Vector3(5, 0, 1)
  gustSpeed = 5
  turbulence = 0.8

  readonly #plus = new Vector3()
  readonly #minus = new Vector3()
  readonly #velocityPlus = new Vector3()
  readonly #velocityMinus = new Vector3()

  constructor(options: CoherentWindFieldOptions = {}) {
    this.configure(options)
  }

  configure(options: CoherentWindFieldOptions): this {
    if (options.baseVelocity !== undefined) copyVec3(this.baseVelocity, options.baseVelocity)
    this.gustSpeed = nonNegative('gustSpeed', options.gustSpeed, this.gustSpeed)
    this.turbulence = nonNegative('turbulence', options.turbulence, this.turbulence)
    return this
  }

  sample(position: Vector3, timeSeconds: number, out: WindSampleTarget): void {
    this.#sampleVelocity(position, timeSeconds, out.velocity)
    this.#sampleJacobian(position, timeSeconds, out.jacobian)
    out.turbulence = this.turbulence
  }

  #sampleVelocity(position: Vector3, timeSeconds: number, out: Vector3): Vector3 {
    const baseLength = Math.hypot(this.baseVelocity.x, this.baseVelocity.z)
    const directionX = baseLength > 0.0001 ? this.baseVelocity.x / baseLength : 1
    const directionZ = baseLength > 0.0001 ? this.baseVelocity.z / baseLength : 0
    const crossX = -directionZ
    const crossZ = directionX
    const along = position.x * directionX + position.z * directionZ
    const across = position.x * crossX + position.z * crossZ
    const travel = timeSeconds * (0.035 * baseLength + 0.18)
    const primary = Math.sin(0.052 * along + 0.018 * across + 0.7 - travel)
    const secondary = Math.sin(-0.021 * along + 0.043 * across + 2.1 - travel * 0.61)
    const crossWave = Math.sin(0.017 * along + 0.031 * across + 4.2 - travel * 0.44)
    const liftWave = Math.sin(0.026 * along - 0.019 * across + 1.4 - travel * 0.73)
    const alongStrength = Math.max(0, Math.min(0.76, 0.25 * primary + 0.13 * secondary + 0.38))
    const crossStrength = crossWave * 0.11
    const liftStrength = liftWave * 0.055 * (0.25 * primary + 0.75)

    return out.set(
      this.baseVelocity.x + this.gustSpeed
        * (directionX * alongStrength + crossX * crossStrength),
      this.baseVelocity.y + this.gustSpeed * liftStrength,
      this.baseVelocity.z + this.gustSpeed
        * (directionZ * alongStrength + crossZ * crossStrength),
    )
  }

  #sampleJacobian(position: Vector3, timeSeconds: number, out: Matrix3): void {
    const epsilon = 0.5
    const elements = out.elements

    for (let axis = 0; axis < 3; axis += 1) {
      this.#plus.copy(position).setComponent(axis, position.getComponent(axis) + epsilon)
      this.#minus.copy(position).setComponent(axis, position.getComponent(axis) - epsilon)
      this.#sampleVelocity(this.#plus, timeSeconds, this.#velocityPlus)
      this.#sampleVelocity(this.#minus, timeSeconds, this.#velocityMinus)
      this.#velocityPlus.sub(this.#velocityMinus)

      elements[axis * 3] = this.#velocityPlus.x
      elements[axis * 3 + 1] = this.#velocityPlus.y
      elements[axis * 3 + 2] = this.#velocityPlus.z
    }

    out.multiplyScalar(0.5 / epsilon)
  }
}

function nonNegative(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const result = finite(value, Number.NaN)
  if (!Number.isFinite(result) || result < 0) {
    throw new RangeError(`${name} must be a finite number >= 0`)
  }
  return result
}
