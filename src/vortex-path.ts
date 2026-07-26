import type { Node } from 'three/webgpu'
import {
  clamp,
  cos,
  exp,
  float,
  fract,
  instanceIndex,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  sqrt,
  step,
  vec3,
} from 'three/tsl'

const TAU = Math.PI * 2

interface VortexPathContext {
  readonly time: Node<'float'>
  readonly center: Node<'vec3'>
  readonly fieldVelocity: Node<'vec3'>
  readonly observerVelocity: Node<'vec3'>
  readonly turbulence: Node<'float'>
  readonly length: Node<'float'>
  readonly positionZ: Node<'float'>
  readonly seed: Node<'vec4'>
  readonly trait: Node<'vec4'>
  readonly shape: Node<'vec4'>
  readonly motion: Node<'vec4'>
  readonly detail: Node<'vec2'>
  readonly axis: Node<'vec4'>
}

export interface VortexPath {
  readonly center: Node<'vec3'>
  readonly tangent: Node<'vec3'>
  readonly radialNormal: Node<'vec3'>
  readonly visibility: Node<'float'>
  readonly layerWeight: Node<'float'>
}

export function createVortexPath(context: VortexPathContext): VortexPath {
  const {
    time,
    center,
    fieldVelocity,
    observerVelocity,
    turbulence,
    length,
    positionZ,
    seed,
    trait,
    shape,
    motion,
    detail,
    axis,
  } = context
  const height = shape.x
  const baseRadius = shape.y
  const topRadius = shape.z
  const taperExponent = shape.w
  const angularSpeed = motion.x
  const contraction = motion.y
  const lift = motion.z
  const coreRadiusRatio = motion.w
  const shellBias = detail.x
  const axisWander = detail.y

  // Irrational rotations create a low-discrepancy prefix for every setCount(n),
  // so height, angle, and radial layers remain filled without another attribute.
  const index = float(instanceIndex)
  const heightPhase = fract(
    index.mul(0.754877666).add(trait.z.mul(0.16)),
  )
  const initialAngle = fract(
    index.mul(0.618033989).add(trait.x.mul(0.14)),
  ).mul(TAU)
  const radialUnit = fract(
    index.mul(0.569840296).add(trait.y.mul(0.22)),
  )
  const coreLayer = mix(coreRadiusRatio, 0.58, sqrt(radialUnit))
  const shellLayer = mix(0.55, 1, pow(radialUnit, 0.35))
  const outerLayer = step(0.94, seed.w)
  const shellSelector = step(float(1).sub(shellBias), trait.w)
  const layeredRadius = mix(coreLayer, shellLayer, shellSelector)
  const initialRadiusRatio = mix(
    layeredRadius,
    mix(1.02, 1.2, radialUnit),
    outerLayer,
  ).mul(mix(0.9, 1.12, seed.x))
  const layerWeight = mix(
    mix(0.72, 1, shellSelector),
    0.58,
    outerLayer,
  )

  const verticalSpeed = lift.mul(mix(0.84, 1.18, trait.x)).max(0.1)
  const pathHeight = height.mul(mix(0.84, 1.18, trait.z))
  const cycleDuration = pathHeight.div(verticalSpeed)
  const headTime = fract(heightPhase.add(time.div(cycleDuration)))
    .mul(cycleDuration)
  const headHeight = clamp(verticalSpeed.mul(headTime).div(pathHeight), 0, 1)
  const headEnvelope = baseRadius.add(
    topRadius.sub(baseRadius).mul(pow(headHeight, taperExponent)),
  )
  const headContraction = coreRadiusRatio.add(
    initialRadiusRatio.sub(coreRadiusRatio).mul(
      exp(contraction.mul(headTime).negate()),
    ),
  )
  const instanceAngularSpeed = angularSpeed.mul(
    mix(1.32, 0.76, clamp(initialRadiusRatio, 0, 1)),
  ).mul(mix(0.84, 1.18, seed.z))
  const headRadius = headEnvelope.mul(headContraction)
  const horizontalDrift = vec3(
    fieldVelocity.x.sub(observerVelocity.x),
    0,
    fieldVelocity.z.sub(observerVelocity.z),
  )
  const headPathSpeed = sqrt(
    verticalSpeed.mul(verticalSpeed)
      .add(instanceAngularSpeed.mul(headRadius).pow(2))
      .add(horizontalDrift.dot(horizontalDrift)),
  ).max(0.1)
  const instanceLength = length.mul(
    mix(0.32, 1.16, trait.y).mul(mix(0.78, 1.12, shellSelector)),
  )
  const pathTime = headTime.add(positionZ.mul(instanceLength).div(headPathSpeed))
  const rawHeight = verticalSpeed.mul(pathTime).div(pathHeight)
  const normalizedHeight = clamp(rawHeight, 0, 1)
  const safeHeight = normalizedHeight.max(0.001)
  const envelope = baseRadius.add(
    topRadius.sub(baseRadius).mul(pow(normalizedHeight, taperExponent)),
  )
  const contractionTime = pathTime.max(0)
  const radialContraction = coreRadiusRatio.add(
    initialRadiusRatio.sub(coreRadiusRatio).mul(
      exp(contraction.mul(contractionTime).negate()),
    ),
  )
  const basePathRadius = envelope.mul(radialContraction)
  const radialFlutterFrequency = mix(0.68, 1.92, trait.w)
  const radialFlutterAmplitude = clamp(turbulence.mul(0.13), 0, 0.22)
    .mul(mix(0.45, 1, clamp(initialRadiusRatio, 0, 1)))
  const radialFlutterPhase = pathTime
    .mul(radialFlutterFrequency)
    .add(trait.x.mul(TAU))
  const radialFlutter = float(1).add(
    sin(radialFlutterPhase).mul(radialFlutterAmplitude),
  )
  const radius = basePathRadius.mul(radialFlutter)

  const flutterFrequency = mix(0.95, 2.8, trait.z)
  const flutterAmplitude = clamp(turbulence.mul(0.045), 0, 0.22)
    .mul(mix(0.45, 1, clamp(initialRadiusRatio, 0, 1)))
  const flutterPhase = pathTime.mul(flutterFrequency).add(trait.y.mul(TAU))
  const angle = initialAngle
    .add(instanceAngularSpeed.mul(pathTime))
    .add(sin(flutterPhase).mul(flutterAmplitude))
  const angleRate = instanceAngularSpeed.add(
    cos(flutterPhase).mul(flutterFrequency).mul(flutterAmplitude),
  )
  const angleCos = cos(angle)
  const angleSin = sin(angle)

  const insideHeight = step(0, rawHeight)
    .mul(float(1).sub(step(1, rawHeight)))
  const heightRate = verticalSpeed.div(pathHeight).mul(insideHeight)
  const envelopeRate = topRadius.sub(baseRadius)
    .mul(taperExponent)
    .mul(pow(safeHeight, taperExponent.sub(1)))
    .mul(heightRate)
  const contractionRate = contraction
    .mul(radialContraction.sub(coreRadiusRatio))
    .negate()
    .mul(step(0, pathTime))
  const baseRadiusRate = envelopeRate
    .mul(radialContraction)
    .add(envelope.mul(contractionRate))
  const radiusRate = baseRadiusRate.mul(radialFlutter).add(
    basePathRadius
      .mul(cos(radialFlutterPhase))
      .mul(radialFlutterFrequency)
      .mul(radialFlutterAmplitude),
  )

  // All particles orbit one shared quadratic axis. The authored control/tip
  // offsets define its silhouette; low-frequency wander moves that whole curve.
  const rawAxisHeight = verticalSpeed.mul(pathTime).div(height)
  const axisHeight = clamp(rawAxisHeight, 0, 1)
  const insideAxisHeight = step(0, rawAxisHeight)
    .mul(float(1).sub(step(1, rawAxisHeight)))
  const axisHeightRate = verticalSpeed.div(height).mul(insideAxisHeight)
  const axisControlWeight = axisHeight
    .mul(float(1).sub(axisHeight))
    .mul(2)
  const axisTipWeight = axisHeight.mul(axisHeight)
  const axisControlRate = float(2).sub(axisHeight.mul(4)).mul(axisHeightRate)
  const axisTipRate = axisHeight.mul(axisHeightRate).mul(2)
  const axisShapeRate = clamp(angularSpeed.mul(0.25), 0.95, 2.25)
  const axisPhaseX = time.mul(axisShapeRate)
  const axisPhaseZ = time.mul(axisShapeRate.mul(0.82)).add(1.4)
  const axisSecondaryPhase = time.mul(axisShapeRate.mul(1.75)).add(0.7)
  const axisAngleX = axisPhaseX.add(axisHeight.mul(4.1))
  const axisAngleZ = axisPhaseZ.add(axisHeight.mul(3.4))
  const axisSecondaryAngle = axisSecondaryPhase.add(axisHeight.mul(8.2))
  const axisX = axis.x.mul(axisControlWeight)
    .add(axis.z.mul(axisTipWeight))
    .add(
      sin(axisAngleX).sub(sin(axisPhaseX)).mul(axisWander),
    )
    .add(
      sin(axisSecondaryAngle).sub(sin(axisSecondaryPhase))
        .mul(axisWander)
        .mul(0.25),
    )
  const axisZ = axis.y.mul(axisControlWeight)
    .add(axis.w.mul(axisTipWeight))
    .add(
      cos(axisAngleZ).sub(cos(axisPhaseZ)).mul(axisWander).mul(0.76),
    )
    .add(
      cos(axisSecondaryAngle).sub(cos(axisSecondaryPhase))
        .mul(axisWander)
        .mul(0.2),
    )
  const axisRateX = axis.x.mul(axisControlRate)
    .add(axis.z.mul(axisTipRate))
    .add(
      cos(axisAngleX)
        .mul(axisHeightRate)
        .mul(4.1)
        .mul(axisWander),
    )
    .add(
      cos(axisSecondaryAngle)
        .mul(axisHeightRate)
        .mul(8.2)
        .mul(axisWander)
        .mul(0.25),
    )
  const axisRateZ = axis.y.mul(axisControlRate)
    .add(axis.w.mul(axisTipRate))
    .add(
      sin(axisAngleZ)
        .negate()
        .mul(axisHeightRate)
        .mul(3.4)
        .mul(axisWander)
        .mul(0.76),
    )
    .add(
      sin(axisSecondaryAngle)
        .negate()
        .mul(axisHeightRate)
        .mul(8.2)
        .mul(axisWander)
        .mul(0.2),
    )

  const pathCenter = center
    .add(horizontalDrift.mul(pathTime))
    .add(vec3(
      radius.mul(angleCos).add(axisX),
      verticalSpeed.mul(pathTime),
      radius.mul(angleSin).add(axisZ),
    ))
  const tangent = normalize(vec3(
    radiusRate.mul(angleCos)
      .sub(radius.mul(angleRate).mul(angleSin))
      .add(horizontalDrift.x)
      .add(axisRateX),
    verticalSpeed,
    radiusRate.mul(angleSin)
      .add(radius.mul(angleRate).mul(angleCos))
      .add(horizontalDrift.z)
      .add(axisRateZ),
  ))
  const visibility = smoothstep(-0.02, 0.025, rawHeight).mul(
    float(1).sub(smoothstep(0.94, 1.02, rawHeight)),
  )
  return {
    center: pathCenter,
    tangent,
    radialNormal: vec3(angleCos, 0, angleSin),
    visibility,
    layerWeight,
  }
}
