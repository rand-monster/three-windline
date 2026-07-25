import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Matrix3,
  MeshBasicNodeMaterial,
  NormalBlending,
  Vector3,
  Vector4,
} from 'three/webgpu'
import {
  abs,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cross,
  float,
  mix,
  mod,
  normalize,
  positionLocal,
  screenDPR,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  vertexStage,
  viewport,
} from 'three/tsl'

import { createCurveShape } from './curve.js'
import type { WindLineCurve, WindLineStyle } from './types.js'

interface MutableUniform<T> {
  value: T
}

export interface WindLineMaterialUniforms {
  readonly frame: MutableUniform<Vector4>
  readonly center: MutableUniform<Vector3>
  readonly eye: MutableUniform<Vector3>
  readonly forward: MutableUniform<Vector3>
  readonly observerVelocity: MutableUniform<Vector3>
  readonly fieldVelocity: MutableUniform<Vector3>
  readonly jacobian: MutableUniform<Matrix3>
  readonly region: MutableUniform<Vector4>
  readonly ribbon: MutableUniform<Vector4>
  readonly shape: MutableUniform<Vector4>
  readonly curve: MutableUniform<Vector3>
  readonly fade: MutableUniform<Vector4>
  readonly motion: MutableUniform<Vector4>
  readonly warmColor: MutableUniform<Color>
  readonly coolColor: MutableUniform<Color>
}

export interface WindLineMaterialBundle {
  readonly material: MeshBasicNodeMaterial
  readonly uniforms: WindLineMaterialUniforms
}

export function createWindLineMaterial(
  style: WindLineStyle,
  curve: WindLineCurve,
  depthTest: boolean,
  blending: 'normal' | 'additive',
): WindLineMaterialBundle {
  const material = new MeshBasicNodeMaterial()
  material.name = 'three-windline-gpu-ribbon-material'
  material.transparent = true
  material.depthWrite = false
  material.depthTest = depthTest
  material.side = DoubleSide
  material.blending = blending === 'additive' ? AdditiveBlending : NormalBlending
  material.toneMapped = true
  material.alphaToCoverage = false
  material.lights = false

  const uFrame = uniform(new Vector4(0, 0, 0, style.fieldSpeedMultiplier))
  const uCenter = uniform(new Vector3())
  const uEye = uniform(new Vector3(0, 12, 18))
  const uForward = uniform(new Vector3(0, 0, 1))
  const uObserverVelocity = uniform(new Vector3())
  const uFieldVelocity = uniform(new Vector3(5, 0, 1))
  const uJacobian = uniform(new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0))
  const uRegion = uniform(new Vector4(
    style.regionRadius,
    style.verticalHalfSpan,
    style.centerLift,
    style.forwardBias,
  ))
  const uRibbon = uniform(new Vector4(
    style.length,
    style.widthCssPixels[0],
    style.widthCssPixels[1],
    style.opacity,
  ))
  const uShape = uniform(new Vector4(
    style.curveAmplitude[0],
    style.curveAmplitude[1],
    style.curveFrequency[0],
    style.curveFrequency[1],
  ))
  const uCurve = uniform(new Vector3(
    style.curveSweepRadians,
    style.curveTurns,
    style.colorRandomness,
  ))
  const uFade = uniform(new Vector4(
    style.nearFade[0],
    style.nearFade[1],
    style.farFade[0],
    style.farFade[1],
  ))
  const uMotion = uniform(new Vector4(
    style.lifetime[0],
    style.lifetime[1],
    style.speed[0],
    style.speed[1],
  ))
  const uWarmColor = uniform(new Color(style.colors[0]))
  const uCoolColor = uniform(new Color(style.colors[1]))

  const uTime = uFrame.x
  const uTurbulence = uFrame.y
  const uVisibility = uFrame.z
  const uFieldSpeedMultiplier = uFrame.w
  const uRegionRadius = uRegion.x
  const uVerticalHalfSpan = uRegion.y
  const uCenterLift = uRegion.z
  const uForwardBias = uRegion.w
  const uLength = uRibbon.x
  const uWidthMinimum = uRibbon.y
  const uWidthMaximum = uRibbon.z
  const uOpacity = uRibbon.w
  const uCurveHorizontal = uShape.x
  const uCurveVertical = uShape.y
  const uFrequencyHorizontal = uShape.z
  const uFrequencyVertical = uShape.w
  const uCurveSweepRadians = uCurve.x
  const uCurveTurns = uCurve.y
  const uColorRandomness = uCurve.z
  const uNearStart = uFade.x
  const uNearEnd = uFade.y
  const uFarStart = uFade.z
  const uFarEnd = uFade.w
  const uLifetimeMinimum = uMotion.x
  const uLifetimeMaximum = uMotion.y
  const uSpeedMinimum = uMotion.z
  const uSpeedMaximum = uMotion.w

  const seed = attribute<'vec4'>('aWindSeed', 'vec4')
  const trait = attribute<'vec4'>('aWindTrait', 'vec4')
  const lifetime = mix(uLifetimeMinimum, uLifetimeMaximum, trait.x)
  const age = mod(uTime.add(trait.z.mul(lifetime)), lifetime)
  const lifePhase = age.div(lifetime)

  const forward = vec3(uForward.x, 0, uForward.z)
  const fieldCenter = uCenter
    .add(forward.mul(uRegionRadius.mul(uForwardBias)))
    .add(vec3(0, uCenterLift, 0))
  const horizontalDiameter = uRegionRadius.mul(2)
  const verticalDiameter = uVerticalHalfSpan.mul(2)
  const lattice = vec3(
    seed.x.mul(uRegionRadius),
    seed.y.mul(uVerticalHalfSpan),
    seed.z.mul(uRegionRadius),
  )
  const originX = mod(
    lattice.x.sub(fieldCenter.x).add(uRegionRadius),
    horizontalDiameter,
  ).sub(uRegionRadius).add(fieldCenter.x)
  const originY = mod(
    lattice.y.sub(fieldCenter.y).add(uVerticalHalfSpan),
    verticalDiameter,
  ).sub(uVerticalHalfSpan).add(fieldCenter.y)
  const originZ = mod(
    lattice.z.sub(fieldCenter.z).add(uRegionRadius),
    horizontalDiameter,
  ).sub(uRegionRadius).add(fieldCenter.z)
  const origin = vec3(originX, originY, originZ)

  const local = origin.sub(uCenter)
  const gradientVelocity = uJacobian.mul(local)
  const turbulenceVector = vec3(
    trait.y.sub(0.5),
    trait.w.sub(0.5).mul(0.4),
    trait.x.sub(0.5),
  ).mul(uTurbulence)
  const field = uFieldVelocity
    .add(gradientVelocity)
    .add(turbulenceVector)
    .sub(uObserverVelocity)
  const fieldSpeed = field.length().max(0.0001)
  const baseDirection = field.div(fieldSpeed)
  const yaw = trait.y.sub(0.5).mul(0.35)
  const yawSin = yaw
  const yawCos = float(1).sub(yaw.mul(yaw).mul(0.5))
  const direction = normalize(
    vec3(
      baseDirection.x.mul(yawCos).sub(baseDirection.z.mul(yawSin)),
      clamp(baseDirection.y.add(trait.w.sub(0.5).mul(0.08)), -0.72, 0.72),
      baseDirection.x.mul(yawSin).add(baseDirection.z.mul(yawCos)),
    ).add(forward.mul(0.0001)),
  )
  const speed = clamp(
    uSpeedMinimum
      .add(fieldSpeed.mul(uFieldSpeedMultiplier))
      .add(trait.y.mul(uSpeedMaximum.sub(uSpeedMinimum).mul(0.25))),
    uSpeedMinimum,
    uSpeedMaximum,
  )

  // Integrate the local affine field as a bounded osculating arc. The polynomial
  // form is stable at zero curvature and exposes an analytic tangent.
  const directionGradient = uJacobian.mul(direction)
  const turnRate = directionGradient
    .sub(direction.mul(direction.dot(directionGradient)))
    .div(fieldSpeed)
  const turnMagnitude = turnRate.length()
  const boundedTurnMagnitude = clamp(
    turnMagnitude,
    0,
    float(1.2).div(uLength.max(0.0001)),
  )
  const boundedTurn = turnRate.mul(
    boundedTurnMagnitude.div(turnMagnitude.max(0.0001)),
  )
  const trail = positionLocal.z.mul(uLength)
  const headAdvance = speed.mul(age)
  const advanced = curve === 'ring' ? headAdvance : trail.add(headAdvance)
  const fieldPhase = clamp(advanced, uLength.negate(), uLength)
  const fieldPhaseSquared = fieldPhase.mul(fieldPhase)
  const curvatureAngleSquared = boundedTurnMagnitude
    .mul(boundedTurnMagnitude)
    .mul(fieldPhaseSquared)
  const curvatureAngleFourth = curvatureAngleSquared.mul(curvatureAngleSquared)
  const sinc = float(1)
    .sub(curvatureAngleSquared.div(6))
    .add(curvatureAngleFourth.div(120))
  const cosc = float(1)
    .sub(curvatureAngleSquared.div(12))
    .add(curvatureAngleFourth.div(360))
  const cosine = float(1)
    .sub(curvatureAngleSquared.div(2))
    .add(curvatureAngleFourth.div(24))
    .sub(curvatureAngleFourth.mul(curvatureAngleSquared).div(720))
  const streamTangent = normalize(
    direction.mul(cosine).add(boundedTurn.mul(fieldPhase.mul(sinc))),
  )
  const streamCenter = origin
    .add(direction.mul(fieldPhase.mul(sinc)))
    .add(boundedTurn.mul(fieldPhaseSquared.mul(0.5).mul(cosc)))
    .add(streamTangent.mul(advanced.sub(fieldPhase)))

  const horizontal = normalize(
    cross(direction, vec3(0, 1, 0)).add(vec3(0.0001, 0, 0.0001)),
  )
  const vertical = normalize(
    cross(direction, horizontal).add(vec3(0, 0.0001, 0.0001)),
  )

  const curveShape = createCurveShape(curve, {
    phase: positionLocal.z.negate(),
    advanced,
    trail,
    direction,
    horizontal,
    vertical,
    trait,
    length: uLength,
    amplitudeHorizontal: uCurveHorizontal,
    amplitudeVertical: uCurveVertical,
    frequencyHorizontal: uFrequencyHorizontal,
    frequencyVertical: uFrequencyVertical,
    sweep: uCurveSweepRadians,
    turns: uCurveTurns,
  })
  const center = streamCenter.add(curveShape.offset)
  // Ring vertices share one advected center, so only its intrinsic path
  // contributes to the longitudinal tangent.
  const baseCurveTangent = curve === 'ring' ? direction : streamTangent
  const curveTangent = normalize(
    baseCurveTangent.add(curveShape.slope).add(direction.mul(0.0001)),
  )
  const eyeOffset = uEye.sub(center)
  const clipCenter = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(center, 1)))
  const clipDirection = cameraProjectionMatrix.mul(
    cameraViewMatrix.mul(vec4(curveTangent, 0)),
  )
  const projectedTangent = clipDirection.xy
    .mul(clipCenter.w)
    .sub(clipCenter.xy.mul(clipDirection.w))
  const aspect = viewport.z.div(viewport.w)
  const screenDirection = vec2(
    projectedTangent.x.mul(aspect),
    projectedTangent.y,
  ).add(vec2(0.00001, 0)).normalize()
  const perpendicular = vec2(screenDirection.y.div(aspect), screenDirection.x.negate())
  const sideProfile = positionLocal.y.mul(2)
  const widthPixels = mix(uWidthMinimum, uWidthMaximum, trait.w)
  const cssViewportHeight = viewport.w.div(screenDPR).max(1)
  const widthOffset = perpendicular.mul(
    sideProfile.mul(widthPixels).div(cssViewportHeight),
  )
  material.vertexNode = clipCenter.add(vec4(widthOffset.mul(clipCenter.w), 0, 0))

  const ribbonUv = uv()
  const pointy = curve === 'ring'
    ? float(1)
    : clamp(ribbonUv.x.mul(float(1).sub(ribbonUv.x)).mul(5), 0, 1)
  const edgeDistance = abs(ribbonUv.y.mul(2).sub(1))
  const centerCoverage = float(1).sub(smoothstep(0, 1, edgeDistance))
  const edgeDerivative = edgeDistance.fwidth().max(0.012)
  const edgeCoverage = float(1).sub(smoothstep(
    float(1).sub(edgeDerivative),
    float(1).add(edgeDerivative),
    edgeDistance,
  ))
  const lifeFade = smoothstep(0, 0.18, lifePhase)
    .mul(float(1).sub(smoothstep(0.65, 1, lifePhase)))
  const distance = eyeOffset.length()
  const nearCameraFade = smoothstep(uNearStart, uNearEnd, distance)
  const farCameraFade = float(1).sub(smoothstep(uFarStart, uFarEnd, distance))
  const flowVariation = float(0.72).add(trait.z.mul(0.24))
  const authoredColor = mix(uWarmColor, uCoolColor, seed.w.mul(0.72))
  const hue = trait.y.mul(6)
  const randomInstanceColor = clamp(
    abs(mod(vec3(hue, hue.add(4), hue.add(2)), 6).sub(3)).sub(1),
    0,
    1,
  ).mul(0.78).add(0.22).mul(trait.w.mul(0.18).add(0.82))
  material.colorNode = vertexStage(
    mix(authoredColor, randomInstanceColor, uColorRandomness),
  )
  material.opacityNode = pointy
    .mul(centerCoverage)
    .mul(edgeCoverage)
    .mul(vertexStage(
      flowVariation
        .mul(lifeFade)
        .mul(nearCameraFade)
        .mul(farCameraFade)
        .mul(uVisibility)
        .mul(uOpacity),
    ))

  return {
    material,
    uniforms: {
      frame: uFrame,
      center: uCenter,
      eye: uEye,
      forward: uForward,
      observerVelocity: uObserverVelocity,
      fieldVelocity: uFieldVelocity,
      jacobian: uJacobian,
      region: uRegion,
      ribbon: uRibbon,
      shape: uShape,
      curve: uCurve,
      fade: uFade,
      motion: uMotion,
      warmColor: uWarmColor,
      coolColor: uCoolColor,
    } satisfies WindLineMaterialUniforms,
  }
}

export function applyWindLineStyle(
  uniforms: WindLineMaterialUniforms,
  style: WindLineStyle,
): void {
  uniforms.region.value.set(
    style.regionRadius,
    style.verticalHalfSpan,
    style.centerLift,
    style.forwardBias,
  )
  uniforms.ribbon.value.set(
    style.length,
    style.widthCssPixels[0],
    style.widthCssPixels[1],
    style.opacity,
  )
  uniforms.shape.value.set(
    style.curveAmplitude[0],
    style.curveAmplitude[1],
    style.curveFrequency[0],
    style.curveFrequency[1],
  )
  uniforms.curve.value.set(
    style.curveSweepRadians,
    style.curveTurns,
    style.colorRandomness,
  )
  uniforms.fade.value.set(
    style.nearFade[0],
    style.nearFade[1],
    style.farFade[0],
    style.farFade[1],
  )
  uniforms.motion.value.set(
    style.lifetime[0],
    style.lifetime[1],
    style.speed[0],
    style.speed[1],
  )
  uniforms.frame.value.w = style.fieldSpeedMultiplier
  uniforms.warmColor.value.set(style.colors[0])
  uniforms.coolColor.value.set(style.colors[1])
}
