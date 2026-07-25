import { Matrix3, Vector3 } from 'three'
import { copyVec3 } from '../internal/math.js'
import type { Vec3Like, WindField, WindSampleTarget } from '../types.js'

export class UniformWindField implements WindField {
  readonly velocity = new Vector3(5, 0, 1)

  constructor(velocity?: Vec3Like) {
    if (velocity !== undefined) this.setVelocity(velocity)
  }

  setVelocity(velocity: Vec3Like): this {
    copyVec3(this.velocity, velocity)
    return this
  }

  sample(_position: Vector3, _timeSeconds: number, out: WindSampleTarget): void {
    out.velocity.copy(this.velocity)
    out.jacobian.set(0, 0, 0, 0, 0, 0, 0, 0, 0)
    out.turbulence = 0
  }
}

export function createWindSampleTarget(): WindSampleTarget {
  return {
    velocity: new Vector3(),
    jacobian: new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0),
    turbulence: 0,
  }
}
