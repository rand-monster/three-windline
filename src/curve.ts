import type { Node } from 'three/webgpu'
import {
  cos,
  float,
  normalize,
  sin,
  step,
  vec2,
  vec3,
} from 'three/tsl'

import type { WindLineCurve } from './types.js'

const TAU = Math.PI * 2

interface CurveContext {
  readonly phase: Node<'float'>
  readonly advanced: Node<'float'>
  readonly trail: Node<'float'>
  readonly direction: Node<'vec3'>
  readonly horizontal: Node<'vec3'>
  readonly vertical: Node<'vec3'>
  readonly trait: Node<'vec4'>
  readonly length: Node<'float'>
  readonly amplitudeHorizontal: Node<'float'>
  readonly amplitudeVertical: Node<'float'>
  readonly frequencyHorizontal: Node<'float'>
  readonly frequencyVertical: Node<'float'>
  readonly sweep: Node<'float'>
  readonly turns: Node<'float'>
}

export interface CurveShape {
  readonly offset: Node<'vec3'>
  readonly slope: Node<'vec3'>
}

export function createCurveShape(
  curve: WindLineCurve,
  context: CurveContext,
): CurveShape {
  const {
    phase,
    advanced,
    trail,
    direction,
    horizontal,
    vertical,
    trait,
    length,
    amplitudeHorizontal,
    amplitudeVertical,
    frequencyHorizontal,
    frequencyVertical,
  } = context

  if (curve === 'straight') {
    return { offset: vec3(0), slope: vec3(0) }
  }

  if (curve === 'flow') {
    const seedPhase = trait.x.mul(TAU)
    const horizontalPhase = advanced.mul(frequencyHorizontal).add(seedPhase)
    const verticalPhase = advanced.mul(frequencyVertical).sub(seedPhase.mul(0.6))
    return {
      offset: horizontal.mul(sin(horizontalPhase).mul(amplitudeHorizontal))
        .add(vertical.mul(cos(verticalPhase).mul(amplitudeVertical))),
      slope: horizontal.mul(
        cos(horizontalPhase).mul(amplitudeHorizontal).mul(frequencyHorizontal),
      ).sub(
        vertical.mul(
          sin(verticalPhase).mul(amplitudeVertical).mul(frequencyVertical),
        ),
      ),
    }
  }

  const handedness = step(0.5, trait.w).mul(2).sub(1)
  if (curve === 'arc' || curve === 'ring') {
    const closed = curve === 'ring'
    const sweep = closed ? float(TAU) : context.sweep
    const angle = phase.mul(sweep)
    const angleSin = sin(angle)
    const angleCos = cos(angle)
    const radius = length.div(sweep)
    const baselineTrail = closed ? float(0) : trail
    return {
      offset: direction.mul(radius.mul(angleSin).negate().sub(baselineTrail))
        .add(
          horizontal.mul(
            handedness.mul(radius).mul(float(1).sub(angleCos)),
          ),
        ),
      slope: direction.mul(angleCos.sub(1))
        .sub(horizontal.mul(handedness.mul(angleSin))),
    }
  }

  const phaseBasis = normalize(
    vec2(trait.y.sub(0.5), trait.z.sub(0.5)),
  )
  const angularDistance = phase
    .mul(context.turns)
    .mul(TAU)
    .mul(handedness)
  const angleSin = sin(angularDistance)
  const angleCos = cos(angularDistance)
  const orbitCos = phaseBasis.x.mul(angleCos).sub(phaseBasis.y.mul(angleSin))
  const orbitSin = phaseBasis.y.mul(angleCos).add(phaseBasis.x.mul(angleSin))
  const angularSlope = handedness.mul(context.turns).mul(TAU).div(length)

  if (curve === 'helix') {
    return {
      offset: horizontal.mul(
        amplitudeHorizontal.mul(orbitCos.sub(phaseBasis.x)),
      ).add(
        vertical.mul(amplitudeVertical.mul(orbitSin.sub(phaseBasis.y))),
      ),
      slope: horizontal.mul(
        amplitudeHorizontal.mul(angularSlope).mul(orbitSin),
      ).sub(
        vertical.mul(amplitudeVertical.mul(angularSlope).mul(orbitCos)),
      ),
    }
  }

  return {
    offset: horizontal.mul(amplitudeHorizontal.mul(phase).mul(orbitCos))
      .add(vertical.mul(amplitudeVertical.mul(phase).mul(orbitSin))),
    slope: horizontal.mul(
      amplitudeHorizontal.mul(
        orbitCos.sub(
          phase.mul(handedness).mul(context.turns).mul(TAU).mul(orbitSin),
        ),
      ).div(length).negate(),
    ).add(
      vertical.mul(
        amplitudeVertical.mul(
          orbitSin.add(
            phase.mul(handedness).mul(context.turns).mul(TAU).mul(orbitCos),
          ),
        ).div(length).negate(),
      ),
    ),
  }
}
