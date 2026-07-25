import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicNodeMaterial,
  NormalBlending,
  Vector3,
} from 'three/webgpu'
import {
  abs,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
  float,
  mix,
  mod,
  normalize,
  positionLocal,
  pow,
  screenDPR,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  viewport,
} from 'three/tsl'

import type { WindLineStyle } from './types.js'

const TAU = Math.PI * 2

interface MutableUniform<T> {
  value: T
}

export interface WindLineMaterialUniforms {
  readonly time: MutableUniform<number>
  readonly center: MutableUniform<Vector3>
  readonly eye: MutableUniform<Vector3>
  readonly forward: MutableUniform<Vector3>
  readonly observerVelocity: MutableUniform<Vector3>
  readonly fieldVelocity: MutableUniform<Vector3>
  readonly jacobianX: MutableUniform<Vector3>
  readonly jacobianY: MutableUniform<Vector3>
  readonly jacobianZ: MutableUniform<Vector3>
  readonly turbulence: MutableUniform<number>
  readonly visibility: MutableUniform<number>
  readonly regionRadius: MutableUniform<number>
  readonly verticalHalfSpan: MutableUniform<number>
  readonly centerLift: MutableUniform<number>
  readonly forwardBias: MutableUniform<number>
  readonly length: MutableUniform<number>
  readonly widthMinimum: MutableUniform<number>
  readonly widthMaximum: MutableUniform<number>
  readonly warmColor: MutableUniform<Color>
  readonly coolColor: MutableUniform<Color>
  readonly opacity: MutableUniform<number>
  readonly curveHorizontal: MutableUniform<number>
  readonly curveVertical: MutableUniform<number>
  readonly frequencyHorizontal: MutableUniform<number>
  readonly frequencyVertical: MutableUniform<number>
  readonly nearStart: MutableUniform<number>
  readonly nearEnd: MutableUniform<number>
  readonly farStart: MutableUniform<number>
  readonly farEnd: MutableUniform<number>
  readonly lifetimeMinimum: MutableUniform<number>
  readonly lifetimeMaximum: MutableUniform<number>
  readonly speedMinimum: MutableUniform<number>
  readonly speedMaximum: MutableUniform<number>
  readonly fieldSpeedMultiplier: MutableUniform<number>
}

export interface WindLineMaterialBundle {
  readonly material: MeshBasicNodeMaterial
  readonly uniforms: WindLineMaterialUniforms
}

export function createWindLineMaterial(
  style: WindLineStyle,
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

  const uTime = uniform(0)
  const uCenter = uniform(new Vector3())
  const uEye = uniform(new Vector3(0, 12, 18))
  const uForward = uniform(new Vector3(0, 0, 1))
  const uObserverVelocity = uniform(new Vector3())
  const uFieldVelocity = uniform(new Vector3(5, 0, 1))
  const uJacobianX = uniform(new Vector3())
  const uJacobianY = uniform(new Vector3())
  const uJacobianZ = uniform(new Vector3())
  const uTurbulence = uniform(0)
  const uVisibility = uniform(0)
  const uRegionRadius = uniform(style.regionRadius)
  const uVerticalHalfSpan = uniform(style.verticalHalfSpan)
  const uCenterLift = uniform(style.centerLift)
  const uForwardBias = uniform(style.forwardBias)
  const uLength = uniform(style.length)
  const uWidthMinimum = uniform(style.widthCssPixels[0])
  const uWidthMaximum = uniform(style.widthCssPixels[1])
  const uWarmColor = uniform(new Color(style.colors[0]))
  const uCoolColor = uniform(new Color(style.colors[1]))
  const uOpacity = uniform(style.opacity)
  const uCurveHorizontal = uniform(style.curveAmplitude[0])
  const uCurveVertical = uniform(style.curveAmplitude[1])
  const uFrequencyHorizontal = uniform(style.curveFrequency[0])
  const uFrequencyVertical = uniform(style.curveFrequency[1])
  const uNearStart = uniform(style.nearFade[0])
  const uNearEnd = uniform(style.nearFade[1])
  const uFarStart = uniform(style.farFade[0])
  const uFarEnd = uniform(style.farFade[1])
  const uLifetimeMinimum = uniform(style.lifetime[0])
  const uLifetimeMaximum = uniform(style.lifetime[1])
  const uSpeedMinimum = uniform(style.speed[0])
  const uSpeedMaximum = uniform(style.speed[1])
  const uFieldSpeedMultiplier = uniform(style.fieldSpeedMultiplier)

  const seed = attribute<'vec4'>('aWindSeed', 'vec4')
  const trait = attribute<'vec4'>('aWindTrait', 'vec4')
  const lifetime = mix(uLifetimeMinimum, uLifetimeMaximum, trait.x)
  const age = mod(uTime.add(trait.z.mul(lifetime)), lifetime)
  const lifePhase = age.div(lifetime)

  const forward = normalize(vec3(uForward.x, 0, uForward.z).add(vec3(0.0001, 0, 0.0001)))
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
  const gradientVelocity = uJacobianX.mul(local.x)
    .add(uJacobianY.mul(local.y))
    .add(uJacobianZ.mul(local.z))
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
  const baseDirection = normalize(field.add(forward.mul(0.0001)))
  const yaw = trait.y.sub(0.5).mul(0.35)
  const yawCos = cos(yaw)
  const yawSin = sin(yaw)
  const direction = normalize(vec3(
    baseDirection.x.mul(yawCos).sub(baseDirection.z.mul(yawSin)),
    clamp(baseDirection.y.add(trait.w.sub(0.5).mul(0.08)), -0.72, 0.72),
    baseDirection.x.mul(yawSin).add(baseDirection.z.mul(yawCos)),
  ))
  const speed = clamp(
    uSpeedMinimum
      .add(fieldSpeed.mul(uFieldSpeedMultiplier))
      .add(trait.y.mul(uSpeedMaximum.sub(uSpeedMinimum).mul(0.25))),
    uSpeedMinimum,
    uSpeedMaximum,
  )

  const advanced = positionLocal.z.mul(uLength).add(speed.mul(age))
  const horizontal = normalize(
    cross(direction, vec3(0, 1, 0)).add(vec3(0.0001, 0, 0.0001)),
  )
  const vertical = normalize(
    cross(direction, horizontal).add(vec3(0, 0.0001, 0.0001)),
  )
  const phase = trait.x.mul(TAU)
  const curveHorizontal = sin(advanced.mul(uFrequencyHorizontal).add(phase))
    .mul(uCurveHorizontal)
  const curveVertical = cos(
    advanced.mul(uFrequencyVertical).sub(phase.mul(0.6)),
  ).mul(uCurveVertical)
  const center = origin
    .add(direction.mul(advanced))
    .add(horizontal.mul(curveHorizontal))
    .add(vertical.mul(curveVertical))

  const tangentAdvanced = advanced.add(0.12)
  const tangentCenter = origin
    .add(direction.mul(tangentAdvanced))
    .add(
      horizontal.mul(
        sin(tangentAdvanced.mul(uFrequencyHorizontal).add(phase))
          .mul(uCurveHorizontal),
      ),
    )
    .add(
      vertical.mul(
        cos(tangentAdvanced.mul(uFrequencyVertical).sub(phase.mul(0.6)))
          .mul(uCurveVertical),
      ),
    )
  const eyeOffset = uEye.sub(center)
  const clipCenter = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(center, 1)))
  const clipTangent = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(tangentCenter, 1)))
  const ndcCenter = clipCenter.xy.div(clipCenter.w)
  const ndcTangent = clipTangent.xy.div(clipTangent.w)
  const aspect = viewport.z.div(viewport.w)
  const screenDirection = vec2(
    ndcTangent.x.sub(ndcCenter.x).mul(aspect),
    ndcTangent.y.sub(ndcCenter.y),
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
  const pointy = pow(
    clamp(ribbonUv.x.mul(float(1).sub(ribbonUv.x)).mul(4), 0, 1),
    0.8,
  )
  const centerCoverage = smoothstep(0, 0.5, ribbonUv.y)
    .mul(float(1).sub(smoothstep(0.5, 1, ribbonUv.y)))
  const edgeDistance = abs(ribbonUv.y.mul(2).sub(1))
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
  material.colorNode = mix(uWarmColor, uCoolColor, seed.w.mul(0.72))
  material.opacityNode = pointy
    .mul(centerCoverage)
    .mul(edgeCoverage)
    .mul(flowVariation)
    .mul(lifeFade)
    .mul(nearCameraFade)
    .mul(farCameraFade)
    .mul(uVisibility)
    .mul(uOpacity)

  return {
    material,
    uniforms: {
      time: uTime,
      center: uCenter,
      eye: uEye,
      forward: uForward,
      observerVelocity: uObserverVelocity,
      fieldVelocity: uFieldVelocity,
      jacobianX: uJacobianX,
      jacobianY: uJacobianY,
      jacobianZ: uJacobianZ,
      turbulence: uTurbulence,
      visibility: uVisibility,
      regionRadius: uRegionRadius,
      verticalHalfSpan: uVerticalHalfSpan,
      centerLift: uCenterLift,
      forwardBias: uForwardBias,
      length: uLength,
      widthMinimum: uWidthMinimum,
      widthMaximum: uWidthMaximum,
      warmColor: uWarmColor,
      coolColor: uCoolColor,
      opacity: uOpacity,
      curveHorizontal: uCurveHorizontal,
      curveVertical: uCurveVertical,
      frequencyHorizontal: uFrequencyHorizontal,
      frequencyVertical: uFrequencyVertical,
      nearStart: uNearStart,
      nearEnd: uNearEnd,
      farStart: uFarStart,
      farEnd: uFarEnd,
      lifetimeMinimum: uLifetimeMinimum,
      lifetimeMaximum: uLifetimeMaximum,
      speedMinimum: uSpeedMinimum,
      speedMaximum: uSpeedMaximum,
      fieldSpeedMultiplier: uFieldSpeedMultiplier,
    } as WindLineMaterialUniforms,
  }
}

export function applyWindLineStyle(
  uniforms: WindLineMaterialUniforms,
  style: WindLineStyle,
): void {
  uniforms.regionRadius.value = style.regionRadius
  uniforms.verticalHalfSpan.value = style.verticalHalfSpan
  uniforms.centerLift.value = style.centerLift
  uniforms.forwardBias.value = style.forwardBias
  uniforms.length.value = style.length
  uniforms.widthMinimum.value = style.widthCssPixels[0]
  uniforms.widthMaximum.value = style.widthCssPixels[1]
  uniforms.warmColor.value.set(style.colors[0])
  uniforms.coolColor.value.set(style.colors[1])
  uniforms.opacity.value = style.opacity
  uniforms.curveHorizontal.value = style.curveAmplitude[0]
  uniforms.curveVertical.value = style.curveAmplitude[1]
  uniforms.frequencyHorizontal.value = style.curveFrequency[0]
  uniforms.frequencyVertical.value = style.curveFrequency[1]
  uniforms.nearStart.value = style.nearFade[0]
  uniforms.nearEnd.value = style.nearFade[1]
  uniforms.farStart.value = style.farFade[0]
  uniforms.farEnd.value = style.farFade[1]
  uniforms.lifetimeMinimum.value = style.lifetime[0]
  uniforms.lifetimeMaximum.value = style.lifetime[1]
  uniforms.speedMinimum.value = style.speed[0]
  uniforms.speedMaximum.value = style.speed[1]
  uniforms.fieldSpeedMultiplier.value = style.fieldSpeedMultiplier
}
