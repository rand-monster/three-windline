import { Matrix3, Vector3 } from 'three'
import { copyMatrix3, copyVec3, finite } from '../internal/math.js'
import type {
  Matrix3Like,
  Vec3Like,
  WindField,
  WindSampleTarget,
} from '../types.js'

export interface AffineWindFieldOptions {
  origin?: Vec3Like
  velocity?: Vec3Like
  jacobian?: Matrix3Like
  turbulence?: number
}

export class AffineWindField implements WindField {
  readonly origin = new Vector3()
  readonly velocity = new Vector3(5, 0, 1)
  readonly jacobian = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0)
  turbulence = 0

  readonly #offset = new Vector3()

  constructor(options: AffineWindFieldOptions = {}) {
    this.configure(options)
  }

  configure(options: AffineWindFieldOptions): this {
    if (options.origin !== undefined) copyVec3(this.origin, options.origin)
    if (options.velocity !== undefined) copyVec3(this.velocity, options.velocity)
    if (options.jacobian !== undefined) copyMatrix3(this.jacobian, options.jacobian)
    if (options.turbulence !== undefined) {
      const turbulence = finite(options.turbulence, Number.NaN)
      if (!Number.isFinite(turbulence) || turbulence < 0) {
        throw new RangeError('turbulence must be a finite number >= 0')
      }
      this.turbulence = turbulence
    }
    return this
  }

  sample(position: Vector3, _timeSeconds: number, out: WindSampleTarget): void {
    this.#offset.subVectors(position, this.origin).applyMatrix3(this.jacobian)
    out.velocity.copy(this.velocity).add(this.#offset)
    out.jacobian.copy(this.jacobian)
    out.turbulence = this.turbulence
  }
}
