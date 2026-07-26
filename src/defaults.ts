import {
  WIND_LINE_CURVES,
  WIND_LINE_RIBBON_MODES,
  type WindLineCurve,
  type WindLineOptions,
  type WindLineRibbonMode,
  type WindLineStyle,
  type WindLineStyleInput,
} from './types.js'

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
  widthWorldUnits: Object.freeze([0.08, 0.18] as const),
  surfaceRoughness: 0.72,
  surfaceSpecular: 0.28,
  surfaceRim: 0.18,
  surfaceEmission: 0,
  surfaceLightDirection: Object.freeze([-0.42, 0.84, -0.34] as const),
  colors: Object.freeze([0xfff7e8, 0xb8fff4] as const),
  colorRandomness: 0.32,
  colorBanding: 0,
  opacity: 0.38,
  curveAmplitude: Object.freeze([2.4, 1.1] as const),
  curveFrequency: Object.freeze([0.19, 0.13] as const),
  curveSweepRadians: Math.PI,
  curveTurns: 1.5,
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
  readonly curve: WindLineCurve
  readonly ribbonMode: WindLineRibbonMode
  readonly style: WindLineStyle
  readonly renderOrder: number
  readonly depthTest: boolean
  readonly depthWrite: boolean
  readonly blending: 'normal' | 'additive'
  readonly name: string
}

function optionalBoolean(name: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`)
  }
  return value
}

function optionalString(name: string, value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`)
  }
  return value
}

function optionalScene(value: unknown): WindLineOptions['scene'] {
  if (value === undefined) return undefined
  if (
    value === null
    || typeof value !== 'object'
    || typeof (value as { add?: unknown }).add !== 'function'
  ) {
    throw new TypeError('scene must be a Three.js scene')
  }
  return value as NonNullable<WindLineOptions['scene']>
}

function integerInRange(name: string, value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = value === undefined ? fallback : value
  if (
    typeof number !== 'number'
    || !Number.isInteger(number)
    || number < minimum
    || number > maximum
  ) {
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
  const number = value === undefined ? fallback : value
  if (
    typeof number !== 'number'
    || !Number.isFinite(number)
    || number < minimum
    || number > maximum
  ) {
    throw new RangeError(`${name} must be a finite number from ${minimum} to ${maximum}`)
  }
  return number
}

function windLineCurve(value: unknown): WindLineCurve {
  const curve = value ?? 'flow'
  if (
    typeof curve !== 'string'
    || !WIND_LINE_CURVES.includes(curve as WindLineCurve)
  ) {
    throw new RangeError(`curve must be one of: ${WIND_LINE_CURVES.join(', ')}`)
  }
  return curve as WindLineCurve
}

function windLineRibbonMode(value: unknown): WindLineRibbonMode {
  const ribbonMode = value ?? 'camera'
  if (
    typeof ribbonMode !== 'string'
    || !WIND_LINE_RIBBON_MODES.includes(ribbonMode as WindLineRibbonMode)
  ) {
    throw new RangeError(
      `ribbonMode must be one of: ${WIND_LINE_RIBBON_MODES.join(', ')}`,
    )
  }
  return ribbonMode as WindLineRibbonMode
}

function blendingMode(value: unknown): 'normal' | 'additive' {
  const blending = value ?? 'normal'
  if (blending !== 'normal' && blending !== 'additive') {
    throw new RangeError('blending must be normal or additive')
  }
  return blending
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

function finiteDirection(
  name: string,
  value: readonly [number, number, number] | undefined,
  fallback: readonly [number, number, number],
) {
  const x = value?.[0] ?? fallback[0]
  const y = value?.[1] ?? fallback[1]
  const z = value?.[2] ?? fallback[2]
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(z)
    || x * x + y * y + z * z < 1e-8
  ) {
    throw new RangeError(`${name} must be a non-zero finite vec3`)
  }
  return [x, y, z] as const
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
    widthWorldUnits: orderedPair(
      'widthWorldUnits',
      input.widthWorldUnits,
      base.widthWorldUnits ?? DEFAULT_WIND_LINE_STYLE.widthWorldUnits!,
      0.001,
    ),
    surfaceRoughness: numberInRange(
      'surfaceRoughness',
      input.surfaceRoughness,
      base.surfaceRoughness ?? DEFAULT_WIND_LINE_STYLE.surfaceRoughness!,
      0,
      1,
    ),
    surfaceSpecular: numberInRange(
      'surfaceSpecular',
      input.surfaceSpecular,
      base.surfaceSpecular ?? DEFAULT_WIND_LINE_STYLE.surfaceSpecular!,
      0,
      2,
    ),
    surfaceRim: numberInRange(
      'surfaceRim',
      input.surfaceRim,
      base.surfaceRim ?? DEFAULT_WIND_LINE_STYLE.surfaceRim!,
      0,
      2,
    ),
    surfaceEmission: numberInRange(
      'surfaceEmission',
      input.surfaceEmission,
      base.surfaceEmission ?? DEFAULT_WIND_LINE_STYLE.surfaceEmission!,
      0,
      2,
    ),
    surfaceLightDirection: finiteDirection(
      'surfaceLightDirection',
      input.surfaceLightDirection,
      base.surfaceLightDirection ?? DEFAULT_WIND_LINE_STYLE.surfaceLightDirection!,
    ),
    colors: [colors[0], colors[1]],
    colorRandomness: numberInRange(
      'colorRandomness',
      input.colorRandomness,
      base.colorRandomness,
      0,
      1,
    ),
    colorBanding: numberInRange(
      'colorBanding',
      input.colorBanding,
      base.colorBanding,
      0,
      1,
    ),
    opacity: numberInRange('opacity', input.opacity, base.opacity, 0, 1),
    curveAmplitude: finitePair('curveAmplitude', input.curveAmplitude, base.curveAmplitude, 0),
    curveFrequency: finitePair('curveFrequency', input.curveFrequency, base.curveFrequency, 0),
    curveSweepRadians: numberInRange(
      'curveSweepRadians',
      input.curveSweepRadians,
      base.curveSweepRadians,
      0.01,
      Math.PI * 2,
    ),
    curveTurns: numberInRange('curveTurns', input.curveTurns, base.curveTurns, 0, 32),
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
  const seed = integerInRange('seed', options.seed, 0, 0, 0xffff_ffff)
  return {
    scene: optionalScene(options.scene),
    field: options.field,
    capacity,
    count,
    segments,
    seed,
    curve: windLineCurve(options.curve),
    ribbonMode: windLineRibbonMode(options.ribbonMode),
    style: resolveWindLineStyle(options.style),
    renderOrder: integerInRange('renderOrder', options.renderOrder, 3, -10_000, 10_000),
    depthTest: optionalBoolean('depthTest', options.depthTest, true),
    depthWrite: optionalBoolean('depthWrite', options.depthWrite, false),
    blending: blendingMode(options.blending),
    name: optionalString('name', options.name, 'three-windline-field'),
  }
}
