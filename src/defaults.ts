import type { WindLineOptions, WindLineStyle, WindLineStyleInput } from './types.js'

export const WIND_LINE_LIMITS = Object.freeze({
  minimumCapacity: 1,
  maximumCapacity: 4_096,
  minimumSegments: 4,
  maximumSegments: 128,
})

export const DEFAULT_WIND_LINE_STYLE: Readonly<WindLineStyle> = Object.freeze({
  regionRadius: 48,
  verticalHalfSpan: 8,
  centerLift: 5.5,
  forwardBias: 0.25,
  length: 15.5,
  widthCssPixels: Object.freeze([0.9, 1.7] as const),
  colors: Object.freeze([0xfff7e8, 0xb8fff4] as const),
  opacity: 0.38,
  curveAmplitude: Object.freeze([2.4, 1.1] as const),
  curveFrequency: Object.freeze([0.19, 0.13] as const),
  nearFade: Object.freeze([1.8, 5.5] as const),
  farFade: Object.freeze([120, 190] as const),
  lifetime: Object.freeze([2.6, 6] as const),
  speed: Object.freeze([4, 28] as const),
  fieldSpeedMultiplier: 1.8,
  visibilityResponse: 6,
  visibilityThreshold: Object.freeze([0.05, 1] as const),
})

export interface ResolvedWindLineOptions {
  readonly scene: WindLineOptions['scene']
  readonly field: WindLineOptions['field']
  readonly capacity: number
  readonly count: number
  readonly segments: number
  readonly seed: number
  readonly style: WindLineStyle
  readonly renderOrder: number
  readonly depthTest: boolean
  readonly blending: 'normal' | 'additive'
  readonly name: string
}

function integerInRange(name: string, value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return number
}

function numberInRange(
  name: string,
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new RangeError(`${name} must be a finite number from ${minimum} to ${maximum}`)
  }
  return number
}

function orderedPair(
  name: string,
  value: readonly [number, number] | undefined,
  fallback: readonly [number, number],
  minimum: number,
) {
  const first = value?.[0] ?? fallback[0]
  const second = value?.[1] ?? fallback[1]
  if (
    !Number.isFinite(first)
    || !Number.isFinite(second)
    || first < minimum
    || second < first
  ) {
    throw new RangeError(`${name} must be an ordered finite pair with values >= ${minimum}`)
  }
  return [first, second] as const
}

function finitePair(
  name: string,
  value: readonly [number, number] | undefined,
  fallback: readonly [number, number],
  minimum: number,
) {
  const first = value?.[0] ?? fallback[0]
  const second = value?.[1] ?? fallback[1]
  if (
    !Number.isFinite(first)
    || !Number.isFinite(second)
    || first < minimum
    || second < minimum
  ) {
    throw new RangeError(`${name} must contain two finite values >= ${minimum}`)
  }
  return [first, second] as const
}

export function resolveWindLineStyle(
  input: WindLineStyleInput = {},
  base: WindLineStyle = DEFAULT_WIND_LINE_STYLE,
): WindLineStyle {
  const colors = input.colors ?? base.colors
  if (!colors || colors.length !== 2) throw new RangeError('colors must contain two values')
  return {
    regionRadius: numberInRange('regionRadius', input.regionRadius, base.regionRadius, 0.1, 10_000),
    verticalHalfSpan: numberInRange(
      'verticalHalfSpan',
      input.verticalHalfSpan,
      base.verticalHalfSpan,
      0.1,
      10_000,
    ),
    centerLift: numberInRange('centerLift', input.centerLift, base.centerLift, -10_000, 10_000),
    forwardBias: numberInRange('forwardBias', input.forwardBias, base.forwardBias, -2, 2),
    length: numberInRange('length', input.length, base.length, 0.1, 1_000),
    widthCssPixels: orderedPair('widthCssPixels', input.widthCssPixels, base.widthCssPixels, 0.1),
    colors: [colors[0], colors[1]],
    opacity: numberInRange('opacity', input.opacity, base.opacity, 0, 1),
    curveAmplitude: finitePair('curveAmplitude', input.curveAmplitude, base.curveAmplitude, 0),
    curveFrequency: finitePair('curveFrequency', input.curveFrequency, base.curveFrequency, 0),
    nearFade: orderedPair('nearFade', input.nearFade, base.nearFade, 0),
    farFade: orderedPair('farFade', input.farFade, base.farFade, 0),
    lifetime: orderedPair('lifetime', input.lifetime, base.lifetime, 0.01),
    speed: orderedPair('speed', input.speed, base.speed, 0),
    fieldSpeedMultiplier: numberInRange(
      'fieldSpeedMultiplier',
      input.fieldSpeedMultiplier,
      base.fieldSpeedMultiplier,
      0,
      100,
    ),
    visibilityResponse: numberInRange(
      'visibilityResponse',
      input.visibilityResponse,
      base.visibilityResponse,
      0,
      100,
    ),
    visibilityThreshold: orderedPair(
      'visibilityThreshold',
      input.visibilityThreshold,
      base.visibilityThreshold,
      0,
    ),
  }
}

export function resolveWindLineOptions(options: WindLineOptions = {}): ResolvedWindLineOptions {
  const capacity = integerInRange(
    'capacity',
    options.capacity,
    96,
    WIND_LINE_LIMITS.minimumCapacity,
    WIND_LINE_LIMITS.maximumCapacity,
  )
  const count = integerInRange('count', options.count, Math.min(42, capacity), 0, capacity)
  const segments = integerInRange(
    'segments',
    options.segments,
    28,
    WIND_LINE_LIMITS.minimumSegments,
    WIND_LINE_LIMITS.maximumSegments,
  )
  const seedNumber = options.seed === undefined ? 0 : Number(options.seed)
  if (!Number.isInteger(seedNumber) || seedNumber < 0 || seedNumber > 0xffff_ffff) {
    throw new RangeError('seed must be an unsigned 32-bit integer')
  }
  return {
    scene: options.scene,
    field: options.field,
    capacity,
    count,
    segments,
    seed: seedNumber >>> 0,
    style: resolveWindLineStyle(options.style),
    renderOrder: integerInRange('renderOrder', options.renderOrder, 3, -10_000, 10_000),
    depthTest: options.depthTest !== false,
    blending: options.blending === 'additive' ? 'additive' : 'normal',
    name: options.name ?? 'three-windline-field',
  }
}
