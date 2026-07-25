const UINT32_SCALE = 1 / 4_294_967_296

export function pcgHashU32(input: number): number {
  const seed = input >>> 0
  const state = (Math.imul(seed, 747_796_405) + 2_891_336_453) >>> 0
  const shift = (state >>> 28) + 4
  const word = Math.imul(((state >>> shift) ^ state) >>> 0, 277_803_737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}

export function hashU32ToUnit(input: number): number {
  return pcgHashU32(input) * UINT32_SCALE
}

export function tslHashFixture(value: number, seed = 0): number {
  const integer = Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0) >>> 0
  return hashU32ToUnit(integer ^ (seed >>> 0))
}

export interface WindLineSeedData {
  readonly positions: Float32Array
  readonly traits: Float32Array
}

export function createWindLineSeedData(capacity: number, seed = 0): WindLineSeedData {
  const positions = new Float32Array(capacity * 4)
  const traits = new Float32Array(capacity * 4)
  const resolvedSeed = seed >>> 0
  for (let index = 0; index < capacity; index += 1) {
    const positionOffset = index * 4
    const slot = Math.imul(index, 0x9e37_79b9) >>> 0
    positions[positionOffset] = hashU32ToUnit((slot + 0x68bc_21eb + resolvedSeed) >>> 0) * 2 - 1
    positions[positionOffset + 1] = (
      hashU32ToUnit((slot + 0x02e5_be93 + resolvedSeed) >>> 0) * 2 - 1
    )
    positions[positionOffset + 2] = (
      hashU32ToUnit((slot + 0x967a_889b + resolvedSeed) >>> 0) * 2 - 1
    )
    positions[positionOffset + 3] = hashU32ToUnit((slot + 0x51a1_f10d + resolvedSeed) >>> 0)
    traits[positionOffset] = tslHashFixture(index * 0.017 + 1.2, resolvedSeed)
    traits[positionOffset + 1] = tslHashFixture(index * 0.031 + 4.7, resolvedSeed)
    traits[positionOffset + 2] = tslHashFixture(index * 0.047 + 8.9, resolvedSeed)
    traits[positionOffset + 3] = tslHashFixture(index * 0.061 + 12.4, resolvedSeed)
  }
  return { positions, traits }
}
