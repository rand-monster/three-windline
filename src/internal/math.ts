import { Matrix3, Vector3 } from 'three'

import type { Matrix3Like, Vec3Like } from '../types.js'

export function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function coordinate(value: Vec3Like | undefined, axis: 'x' | 'y' | 'z', index: number): number {
  if (!value) return 0
  const source = value as { readonly x?: number; readonly y?: number; readonly z?: number }
    & ArrayLike<number>
  return finite(source[axis] ?? source[index])
}

export function copyVec3(target: Vector3, value: Vec3Like | undefined): Vector3 {
  if (!value) return target.set(0, 0, 0)
  return target.set(
    coordinate(value, 'x', 0),
    coordinate(value, 'y', 1),
    coordinate(value, 'z', 2),
  )
}

export function copyFiniteVec3(
  target: Vector3,
  value: Vec3Like,
  name: string,
): Vector3 {
  const source = value as {
    readonly x?: unknown
    readonly y?: unknown
    readonly z?: unknown
  } & ArrayLike<unknown>
  const x = source.x ?? source[0]
  const y = source.y ?? source[1]
  const z = source.z ?? source[2]
  if (
    typeof x !== 'number'
    || typeof y !== 'number'
    || typeof z !== 'number'
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(z)
  ) {
    throw new RangeError(`${name} must contain three finite numbers`)
  }
  return target.set(x, y, z)
}

export function copyMatrix3(target: Matrix3, value: Matrix3Like | undefined): Matrix3 {
  if (!value) return target.identity()
  if ('isMatrix3' in value && value.isMatrix3) {
    if (!value.elements.every(Number.isFinite)) {
      throw new RangeError('jacobian must contain nine finite numbers')
    }
    return target.copy(value)
  }
  const source = value as ArrayLike<number>
  if (source.length !== 9) {
    throw new RangeError('jacobian must contain exactly nine finite numbers')
  }
  for (let index = 0; index < 9; index += 1) {
    if (!Number.isFinite(source[index])) {
      throw new RangeError('jacobian must contain exactly nine finite numbers')
    }
  }
  return target.fromArray(source)
}

export function matrixMagnitude(matrix: Matrix3): number {
  let sum = 0
  for (const value of matrix.elements) sum += value * value
  return Math.sqrt(sum)
}

export function smoothstepNumber(minimum: number, maximum: number, value: number): number {
  const phase = clamp((value - minimum) / Math.max(1e-8, maximum - minimum), 0, 1)
  return phase * phase * (3 - 2 * phase)
}
