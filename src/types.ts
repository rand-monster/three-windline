import type {
  Camera,
  ColorRepresentation,
  Matrix3,
  Mesh,
  Object3D,
  Scene,
  Vector3,
} from 'three'

export type Vec3Like =
  | { readonly x: number; readonly y: number; readonly z: number }
  | ArrayLike<number>

export type Matrix3Like = Matrix3 | ArrayLike<number>

export interface WindSampleTarget {
  readonly velocity: Vector3
  readonly jacobian: Matrix3
  turbulence: number
}

export interface WindField {
  sample(position: Vector3, timeSeconds: number, out: WindSampleTarget): void
}

export interface WindLineStyle {
  regionRadius: number
  verticalHalfSpan: number
  centerLift: number
  forwardBias: number
  length: number
  widthCssPixels: readonly [number, number]
  colors: readonly [ColorRepresentation, ColorRepresentation]
  opacity: number
  curveAmplitude: readonly [number, number]
  curveFrequency: readonly [number, number]
  nearFade: readonly [number, number]
  farFade: readonly [number, number]
  lifetime: readonly [number, number]
  speed: readonly [number, number]
  fieldSpeedMultiplier: number
  visibilityResponse: number
  visibilityThreshold: readonly [number, number]
}

export type WindLineStyleInput = Partial<WindLineStyle>

export interface WindLineOptions {
  scene?: Scene
  field?: WindField
  capacity?: number
  count?: number
  segments?: number
  seed?: number
  style?: WindLineStyleInput
  renderOrder?: number
  depthTest?: boolean
  blending?: 'normal' | 'additive'
  name?: string
}

export interface WindLineFrame {
  timeSeconds: number
  deltaSeconds: number
  anchor: Vec3Like
  camera: Camera
  observerVelocity?: Vec3Like
  forward?: Vec3Like
  active?: boolean
  intensity?: number
}

export interface WindLineStats {
  capacity: number
  count: number
  segments: number
  drawCalls: number
  triangles: number
  seedBytes: number
  updates: number
  visible: boolean
  visibility: number
  sampledSpeed: number
  sampledTurbulence: number
  dynamicInstanceUploads: number
  disposed: boolean
}

export interface WindLineSystem {
  readonly object3d: Object3D
  readonly mesh: Mesh
  readonly capacity: number
  readonly count: number
  setCount(count: number): void
  setField(field: WindField): void
  setStyle(style: WindLineStyleInput): void
  update(frame: WindLineFrame): boolean
  readStats(out: WindLineStats): WindLineStats
  dispose(): boolean
}
