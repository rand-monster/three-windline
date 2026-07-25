import { Vector3 } from 'three'
import { copyFiniteVec3 } from '../internal/math.js'
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

  constructor(options: CoherentWindFieldOptions = {}) {
    this.configure(options)
  }

  configure(options: CoherentWindFieldOptions): this {
    if (options.baseVelocity !== undefined) {
      copyFiniteVec3(this.baseVelocity, options.baseVelocity, 'baseVelocity')
    }
    this.gustSpeed = nonNegative('gustSpeed', options.gustSpeed, this.gustSpeed)
    this.turbulence = nonNegative('turbulence', options.turbulence, this.turbulence)
    return this
  }

  sample(position: Vector3, timeSeconds: number, out: WindSampleTarget): void {
    const baseLength = Math.hypot(this.baseVelocity.x, this.baseVelocity.z)
    const directionX = baseLength > 0.0001 ? this.baseVelocity.x / baseLength : 1
    const directionZ = baseLength > 0.0001 ? this.baseVelocity.z / baseLength : 0
    const crossX = -directionZ
    const crossZ = directionX
    const along = position.x * directionX + position.z * directionZ
    const across = position.x * crossX + position.z * crossZ
    const travel = timeSeconds * (0.035 * baseLength + 0.18)
    const primaryPhase = 0.052 * along + 0.018 * across + 0.7 - travel
    const secondaryPhase = -0.021 * along + 0.043 * across + 2.1 - travel * 0.61
    const crossPhase = 0.017 * along + 0.031 * across + 4.2 - travel * 0.44
    const liftPhase = 0.026 * along - 0.019 * across + 1.4 - travel * 0.73
    const primary = Math.sin(primaryPhase)
    const secondary = Math.sin(secondaryPhase)
    const crossWave = Math.sin(crossPhase)
    const liftWave = Math.sin(liftPhase)
    const rawAlong = 0.25 * primary + 0.13 * secondary + 0.38
    const alongStrength = Math.max(0, Math.min(0.76, rawAlong))
    const crossStrength = crossWave * 0.11
    const liftStrength = liftWave * 0.055 * (0.25 * primary + 0.75)

    out.velocity.set(
      this.baseVelocity.x + this.gustSpeed
        * (directionX * alongStrength + crossX * crossStrength),
      this.baseVelocity.y + this.gustSpeed * liftStrength,
      this.baseVelocity.z + this.gustSpeed
        * (directionZ * alongStrength + crossZ * crossStrength),
    )

    const primaryAlong = 0.052 * directionX + 0.018 * crossX
    const primaryAcross = 0.052 * directionZ + 0.018 * crossZ
    const secondaryAlong = -0.021 * directionX + 0.043 * crossX
    const secondaryAcross = -0.021 * directionZ + 0.043 * crossZ
    const crossAlong = 0.017 * directionX + 0.031 * crossX
    const crossAcross = 0.017 * directionZ + 0.031 * crossZ
    const liftAlong = 0.026 * directionX - 0.019 * crossX
    const liftAcross = 0.026 * directionZ - 0.019 * crossZ
    const primaryDerivativeX = Math.cos(primaryPhase) * primaryAlong
    const primaryDerivativeZ = Math.cos(primaryPhase) * primaryAcross
    const secondaryDerivativeX = Math.cos(secondaryPhase) * secondaryAlong
    const secondaryDerivativeZ = Math.cos(secondaryPhase) * secondaryAcross
    const unclamped = rawAlong > 0 && rawAlong < 0.76 ? 1 : 0
    const alongDerivativeX = unclamped
      * (0.25 * primaryDerivativeX + 0.13 * secondaryDerivativeX)
    const alongDerivativeZ = unclamped
      * (0.25 * primaryDerivativeZ + 0.13 * secondaryDerivativeZ)
    const crossDerivativeX = Math.cos(crossPhase) * crossAlong * 0.11
    const crossDerivativeZ = Math.cos(crossPhase) * crossAcross * 0.11
    const liftBase = 0.25 * primary + 0.75
    const liftDerivativeX = 0.055 * (
      Math.cos(liftPhase) * liftAlong * liftBase
      + liftWave * 0.25 * primaryDerivativeX
    )
    const liftDerivativeZ = 0.055 * (
      Math.cos(liftPhase) * liftAcross * liftBase
      + liftWave * 0.25 * primaryDerivativeZ
    )
    const gust = this.gustSpeed
    out.jacobian.set(
      gust * (directionX * alongDerivativeX + crossX * crossDerivativeX),
      0,
      gust * (directionX * alongDerivativeZ + crossX * crossDerivativeZ),
      gust * liftDerivativeX,
      0,
      gust * liftDerivativeZ,
      gust * (directionZ * alongDerivativeX + crossZ * crossDerivativeX),
      0,
      gust * (directionZ * alongDerivativeZ + crossZ * crossDerivativeZ),
    )
    out.turbulence = this.turbulence
  }
}

function nonNegative(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0`)
  }
  return value
}
