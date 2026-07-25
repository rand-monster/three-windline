import {
  BufferAttribute,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
} from 'three'

import type { WindLineSeedData } from './seed.js'

const TAPER_FRACTION = 0.4

export function createWindLineGeometry(
  segments: number,
  count: number,
  seedData: WindLineSeedData,
): InstancedBufferGeometry {
  const positions = new Float32Array((segments + 1) * 2 * 3)
  const uvs = new Float32Array((segments + 1) * 2 * 2)
  const indices = segments * 6 > 65_535
    ? new Uint32Array(segments * 6)
    : new Uint16Array(segments * 6)
  for (let index = 0; index <= segments; index += 1) {
    const phase = index / segments
    const taper = phase < TAPER_FRACTION
      ? phase / TAPER_FRACTION
      : phase > 1 - TAPER_FRACTION
        ? (1 - phase) / TAPER_FRACTION
        : 1
    const positionOffset = index * 6
    positions[positionOffset] = 0
    positions[positionOffset + 1] = 0.5 * taper
    positions[positionOffset + 2] = -phase
    positions[positionOffset + 3] = 0
    positions[positionOffset + 4] = -0.5 * taper
    positions[positionOffset + 5] = -phase
    const uvOffset = index * 4
    uvs[uvOffset] = phase
    uvs[uvOffset + 1] = 1
    uvs[uvOffset + 2] = phase
    uvs[uvOffset + 3] = 0
    if (index >= segments) continue
    const vertex = index * 2
    const triangle = index * 6
    indices[triangle] = vertex
    indices[triangle + 1] = vertex + 1
    indices[triangle + 2] = vertex + 2
    indices[triangle + 3] = vertex + 1
    indices[triangle + 4] = vertex + 3
    indices[triangle + 5] = vertex + 2
  }

  const geometry = new InstancedBufferGeometry()
  geometry.name = 'three-windline-ribbon'
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('aWindSeed', new InstancedBufferAttribute(seedData.positions, 4))
  geometry.setAttribute('aWindTrait', new InstancedBufferAttribute(seedData.traits, 4))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.instanceCount = count
  geometry.boundingSphere = null
  return geometry
}
