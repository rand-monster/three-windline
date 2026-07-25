import { Vector3 } from 'three'
import { copyFiniteVec3 } from '../internal/math.js'
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

  constructor(options: VortexWindFieldOptions = {}) {
    this.configure(options)
  }

  configure(options: VortexWindFieldOptions): this {
    if (options.center !== undefined) copyFiniteVec3(this.center, options.center, 'center')
    if (options.baseVelocity !== undefined) {
      copyFiniteVec3(this.baseVelocity, options.baseVelocity, 'baseVelocity')
    }
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
    const x = position.x - this.center.x
    const z = position.z - this.center.z
    const radiusSquared = x * x + z * z
    const radius = Math.sqrt(radiusSquared)
    const softeningSquared = this.softeningRadius * this.softeningRadius
    const softenedSquared = radiusSquared + softeningSquared
    const softened = Math.sqrt(softenedSquared)
    const swirl = this.angularSpeed * this.softeningRadius / softened
    const inward = this.radialInflow / Math.max(softened, 0.001)
    const core = Math.exp(-radiusSquared / (softeningSquared * 2))
    const breathingPhase = timeSeconds * 0.7 + radius * 0.11
    const breathing = 1 + Math.sin(breathingPhase) * 0.08
    const horizontalX = -z * swirl - x * inward
    const horizontalZ = x * swirl - z * inward

    out.velocity.set(
      this.baseVelocity.x + horizontalX * breathing,
      this.baseVelocity.y + this.lift * (0.25 + core * 0.75),
      this.baseVelocity.z + horizontalZ * breathing,
    )

    const inverseSoftenedSquared = 1 / softenedSquared
    const swirlDerivativeX = -swirl * x * inverseSoftenedSquared
    const swirlDerivativeZ = -swirl * z * inverseSoftenedSquared
    const inwardDerivativeX = -inward * x * inverseSoftenedSquared
    const inwardDerivativeZ = -inward * z * inverseSoftenedSquared
    const radiusInverse = radius > 1e-6 ? 1 / radius : 0
    const breathingSlope = Math.cos(breathingPhase) * 0.0088 * radiusInverse
    const breathingDerivativeX = breathingSlope * x
    const breathingDerivativeZ = breathingSlope * z
    const horizontalDerivativeXX = (
      -z * swirlDerivativeX
      - inward
      - x * inwardDerivativeX
    )
    const horizontalDerivativeXZ = (
      -swirl
      - z * swirlDerivativeZ
      - x * inwardDerivativeZ
    )
    const horizontalDerivativeZX = (
      swirl
      + x * swirlDerivativeX
      - z * inwardDerivativeX
    )
    const horizontalDerivativeZZ = (
      x * swirlDerivativeZ
      - inward
      - z * inwardDerivativeZ
    )
    const liftDerivativeScale = -this.lift * 0.75 * core / softeningSquared

    out.jacobian.set(
      horizontalDerivativeXX * breathing + horizontalX * breathingDerivativeX,
      0,
      horizontalDerivativeXZ * breathing + horizontalX * breathingDerivativeZ,
      liftDerivativeScale * x,
      0,
      liftDerivativeScale * z,
      horizontalDerivativeZX * breathing + horizontalZ * breathingDerivativeX,
      0,
      horizontalDerivativeZZ * breathing + horizontalZ * breathingDerivativeZ,
    )
    out.turbulence = this.turbulence
  }
}

function finiteValue(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`)
  }
  return value
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
