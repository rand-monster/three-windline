export {
  DEFAULT_WIND_LINE_STYLE,
  WIND_LINE_LIMITS,
} from './defaults.js'
export {
  AffineWindField,
  CoherentWindField,
  UniformWindField,
  VortexWindField,
  createWindSampleTarget,
  type AffineWindFieldOptions,
  type CoherentWindFieldOptions,
  type VortexWindFieldOptions,
} from './fields/index.js'
export {
  ThreeWindLineSystem,
  createWindLineSystem,
} from './system.js'
export type {
  Matrix3Like,
  Vec3Like,
  WindField,
  WindLineFrame,
  WindLineOptions,
  WindLineStats,
  WindLineStyle,
  WindLineStyleInput,
  WindLineSystem,
  WindSampleTarget,
} from './types.js'
