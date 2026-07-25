import {
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  TriangleAlert,
  X,
  createIcons,
} from 'lucide'
import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  AffineWindField,
  CoherentWindField,
  UniformWindField,
  VortexWindField,
  WIND_LINE_CURVES,
  createWindLineSystem,
  type WindField,
  type WindLineCurve,
  type WindLineStats,
} from 'three-windline'

import { createDemoWorld, type DemoPresetId } from './world.js'
import './styles.css'

interface DemoControls {
  density: number
  speed: number
  gust: number
  length: number
  width: number
  opacity: number
  colorRandomness: number
  curveSweep: number
  curveTurns: number
}

interface PresetDefinition {
  readonly id: DemoPresetId
  readonly index: string
  readonly label: string
  readonly fieldLabel: string
  readonly metric: string
  readonly curve: WindLineCurve
  readonly controls: DemoControls
  readonly colors: readonly [THREE.ColorRepresentation, THREE.ColorRepresentation]
  readonly curveAmplitude: readonly [number, number]
  readonly regionRadius: number
  readonly verticalHalfSpan: number
  readonly centerLift: number
  readonly lifetime: readonly [number, number]
  readonly speedRange: readonly [number, number]
  readonly fieldSpeedMultiplier: number
}

interface DemoSnapshot {
  readonly ready: boolean
  readonly paused: boolean
  readonly preset: DemoPresetId
  readonly curve: WindLineCurve
  readonly backend: string
  readonly fps: number
  readonly draws: number
  readonly controls: Readonly<DemoControls>
  readonly camera: readonly number[]
  readonly target: readonly number[]
  readonly windline: Readonly<WindLineStats>
}

interface ThreeWindlineDemoBridge {
  ready: boolean
  readonly renderer: THREE.WebGPURenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly windline: ReturnType<typeof createWindLineSystem>
  setPreset(preset: DemoPresetId): boolean
  setCurve(curve: WindLineCurve): boolean
  setPaused(paused: boolean): void
  reset(): void
  snapshot(): DemoSnapshot
  dispose(): void
}

declare global {
  // Browser and visual-check automation entry point.
  // eslint-disable-next-line no-var
  var __threeWindlineDemo: ThreeWindlineDemoBridge | undefined
}

const PRESETS: Readonly<Record<DemoPresetId, PresetDefinition>> = Object.freeze({
  breeze: {
    id: 'breeze',
    index: '01',
    label: 'Breeze',
    fieldLabel: 'uniform',
    metric: '6.8 m/s',
    curve: 'flow',
    controls: {
      density: 256,
      speed: 1,
      gust: 5.5,
      length: 22,
      width: 2.1,
      opacity: 0.7,
      colorRandomness: 0.18,
      curveSweep: 180,
      curveTurns: 1.5,
    },
    colors: [0xfff1c7, 0xd9fff1],
    curveAmplitude: [2.2, 0.85],
    regionRadius: 60,
    verticalHalfSpan: 18,
    centerLift: 11,
    lifetime: [2.2, 5.8],
    speedRange: [4, 32],
    fieldSpeedMultiplier: 1.8,
  },
  shear: {
    id: 'shear',
    index: '02',
    label: 'Canyon Shear',
    fieldLabel: 'affine',
    metric: '11.2 m/s',
    curve: 'arc',
    controls: {
      density: 320,
      speed: 1.15,
      gust: 8,
      length: 26,
      width: 2.2,
      opacity: 0.72,
      colorRandomness: 0.24,
      curveSweep: 132,
      curveTurns: 1.5,
    },
    colors: [0xffd08d, 0xbff7e8],
    curveAmplitude: [3.4, 1.15],
    regionRadius: 58,
    verticalHalfSpan: 20,
    centerLift: 11,
    lifetime: [1.8, 4.8],
    speedRange: [4, 30],
    fieldSpeedMultiplier: 1.6,
  },
  tornado: {
    id: 'tornado',
    index: '03',
    label: 'Tornado',
    fieldLabel: 'vortex',
    metric: '1.55 rad/s',
    curve: 'straight',
    controls: {
      density: 112,
      speed: 1.1,
      gust: 10,
      length: 4,
      width: 1.6,
      opacity: 0.48,
      colorRandomness: 0.58,
      curveSweep: 180,
      curveTurns: 0.85,
    },
    colors: [0xffc675, 0x9ef4dd],
    curveAmplitude: [0.3, 0.12],
    regionRadius: 8.8,
    verticalHalfSpan: 14,
    centerLift: 8,
    lifetime: [0.48, 0.95],
    speedRange: [1.2, 3.2],
    fieldSpeedMultiplier: 0.28,
  },
  storm: {
    id: 'storm',
    index: '04',
    label: 'Storm Front',
    fieldLabel: 'coherent',
    metric: '17.5 m/s',
    curve: 'flow',
    controls: {
      density: 480,
      speed: 1.55,
      gust: 16,
      length: 34,
      width: 2.2,
      opacity: 0.68,
      colorRandomness: 0.3,
      curveSweep: 180,
      curveTurns: 1.5,
    },
    colors: [0xffd49d, 0xc0f3ff],
    curveAmplitude: [4.1, 1.8],
    regionRadius: 66,
    verticalHalfSpan: 23,
    centerLift: 13,
    lifetime: [1.4, 4.2],
    speedRange: [5, 34],
    fieldSpeedMultiplier: 1.75,
  },
})

const DEFAULT_CAMERA_POSITION = new THREE.Vector3(35, 22, 48)
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 7.2, 8)
const OBSERVER_VELOCITY = new THREE.Vector3()
const BREEZE_DIRECTION = new THREE.Vector3(0.95, 0.025, 0.31).normalize()
const STORM_DIRECTION = new THREE.Vector3(0.78, -0.015, 0.63).normalize()
const BREEZE_VELOCITY_SCRATCH = new THREE.Vector3()
const sliderIds = [
  'density',
  'speed',
  'gust',
  'length',
  'width',
  'opacity',
  'colorRandomness',
  'curveSweep',
  'curveTurns',
] as const
type SliderId = (typeof sliderIds)[number]

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`)
  return element as T
}

function formatControl(id: SliderId, value: number): string {
  if (id === 'density') return Math.round(value).toLocaleString()
  if (id === 'speed') return `${value.toFixed(2)}×`
  if (id === 'gust') return `${value.toFixed(1)} m/s`
  if (id === 'length') return `${value.toFixed(1)} m`
  if (id === 'width') return `${value.toFixed(1)} px`
  if (id === 'curveSweep') return `${Math.round(value)}°`
  if (id === 'curveTurns') return value.toFixed(2)
  return `${Math.round(value * 100)}%`
}

function installIcons(root: Element | Document | DocumentFragment = document): void {
  createIcons({
    root,
    icons: {
      Pause,
      Play,
      RotateCcw,
      SlidersHorizontal,
      TriangleAlert,
      X,
    },
    attrs: {
      'aria-hidden': 'true',
      'stroke-width': 1.8,
    },
  })
}

async function start(): Promise<void> {
  installIcons()
  const viewport = requiredElement<HTMLDivElement>('viewport')
  const loading = requiredElement<HTMLDivElement>('loading')
  const backendState = requiredElement<HTMLDivElement>('backendState')
  const backendLabel = requiredElement<HTMLSpanElement>('backendLabel')
  const fpsValue = requiredElement<HTMLElement>('fpsValue')
  const drawValue = requiredElement<HTMLElement>('drawValue')
  const lineValue = requiredElement<HTMLElement>('lineValue')
  const fieldIndex = requiredElement<HTMLSpanElement>('fieldIndex')
  const fieldName = requiredElement<HTMLElement>('fieldName')
  const fieldMetric = requiredElement<HTMLSpanElement>('fieldMetric')
  const settingsDrawer = requiredElement<HTMLElement>('settingsDrawer')
  const settingsButton = requiredElement<HTMLButtonElement>('settingsButton')
  const closeSettingsButton = requiredElement<HTMLButtonElement>('closeSettingsButton')
  const pauseButton = requiredElement<HTMLButtonElement>('pauseButton')
  const resetButton = requiredElement<HTMLButtonElement>('resetButton')
  const curveSelect = requiredElement<HTMLSelectElement>('curveSelect')
  const presetButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-preset]')]
  const sliders = Object.fromEntries(sliderIds.map((id) => [
    id,
    requiredElement<HTMLInputElement>(`${id}Slider`),
  ])) as Record<SliderId, HTMLInputElement>
  const outputs = Object.fromEntries(sliderIds.map((id) => [
    id,
    requiredElement<HTMLOutputElement>(`${id}Value`),
  ])) as Record<SliderId, HTMLOutputElement>
  const events = new AbortController()
  const listen = { signal: events.signal }

  const search = new URLSearchParams(globalThis.location.search)
  const forceWebGL = search.get('backend') === 'webgl' || search.get('force-webgl') === '1'
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    samples: 4,
    forceWebGL,
    alpha: false,
  })
  renderer.domElement.id = 'windlineCanvas'
  renderer.domElement.dataset.windlineCanvas = ''
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1.06
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  viewport.appendChild(renderer.domElement)
  await renderer.init()

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(47, 1, 0.15, 620)
  camera.position.copy(DEFAULT_CAMERA_POSITION)
  camera.lookAt(DEFAULT_CAMERA_TARGET)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(DEFAULT_CAMERA_TARGET)
  controls.enableDamping = true
  controls.dampingFactor = 0.055
  controls.rotateSpeed = 0.52
  controls.zoomSpeed = 0.72
  controls.panSpeed = 0.48
  controls.minDistance = 22
  controls.maxDistance = 112
  controls.minPolarAngle = 0.22
  controls.maxPolarAngle = Math.PI * 0.48
  controls.update()

  const world = createDemoWorld(scene)
  const fields = {
    breeze: new UniformWindField(),
    shear: new AffineWindField(),
    tornado: new VortexWindField(),
    storm: new CoherentWindField(),
  } satisfies Record<DemoPresetId, WindField>
  const runtimeControls: DemoControls = { ...PRESETS.breeze.controls }
  let activePreset: DemoPresetId = 'breeze'
  let activeCurve: WindLineCurve = PRESETS.breeze.curve
  let activeField: WindField = fields.breeze

  function createWindline(curve: WindLineCurve) {
    return createWindLineSystem({
      scene,
      curve,
      capacity: 480,
      count: PRESETS.breeze.controls.density,
      segments: 28,
      seed: 0x51a1_f10d,
      style: {
        regionRadius: PRESETS.breeze.regionRadius,
        verticalHalfSpan: PRESETS.breeze.verticalHalfSpan,
        centerLift: PRESETS.breeze.centerLift,
        forwardBias: 0.12,
        length: PRESETS.breeze.controls.length,
        widthCssPixels: [0.95, PRESETS.breeze.controls.width],
        colors: PRESETS.breeze.colors,
        colorRandomness: PRESETS.breeze.controls.colorRandomness,
        opacity: PRESETS.breeze.controls.opacity,
        curveAmplitude: PRESETS.breeze.curveAmplitude,
        curveFrequency: [0.16, 0.11],
        curveSweepRadians: Math.PI,
        curveTurns: PRESETS.breeze.controls.curveTurns,
        nearFade: [4, 9],
        farFade: [118, 178],
        lifetime: [2.2, 5.8],
        speed: [4, 32],
        fieldSpeedMultiplier: 1.8,
        visibilityResponse: 7,
        visibilityThreshold: [0.05, 1],
      },
      renderOrder: 5,
      blending: 'normal',
    })
  }

  let windline = createWindline(activeCurve)
  const windlineStats: WindLineStats = {
    capacity: 0,
    count: 0,
    segments: 0,
    drawCalls: 0,
    triangles: 0,
    seedBytes: 0,
    updates: 0,
    visible: false,
    visibility: 0,
    sampledSpeed: 0,
    sampledTurbulence: 0,
    dynamicInstanceUploads: 0,
    disposed: false,
  }
  let paused = false
  let simulationTime = 0
  let previousNow = performance.now() * 0.001
  let frames = 0
  let fps = 0
  let frameWindowStart = previousNow
  let frameWindowCount = 0
  let renderCallsAtWindowStart = 0
  let draws = 0
  let disposed = false

  const rendererBackend = renderer.backend as THREE.Backend & { isWebGPUBackend?: boolean }
  const backend = rendererBackend.isWebGPUBackend === true ? 'WebGPU' : 'WebGL2 fallback'
  backendLabel.textContent = `${backend} · TSL`
  backendState.classList.add('is-ready')

  function setSettingsOpen(open: boolean, focus = false): void {
    settingsDrawer.hidden = !open
    settingsButton.setAttribute('aria-expanded', String(open))
    if (focus) (open ? closeSettingsButton : settingsButton).focus()
  }

  function syncSlider(id: SliderId, value: number): void {
    sliders[id].value = String(value)
    outputs[id].value = formatControl(id, value)
    outputs[id].textContent = outputs[id].value
  }

  function syncAllSliders(): void {
    for (const id of sliderIds) syncSlider(id, runtimeControls[id])
  }

  function syncCurveControls(): void {
    sliders.curveSweep.disabled = activeCurve !== 'arc'
    sliders.curveTurns.disabled = activeCurve !== 'helix' && activeCurve !== 'spiral'
  }

  function configureField(preset: DemoPresetId): WindField {
    const speed = runtimeControls.speed
    const gust = runtimeControls.gust
    if (preset === 'breeze') {
      fields.breeze.setVelocity(BREEZE_DIRECTION.clone().multiplyScalar(6.8 * speed))
      return fields.breeze
    }
    if (preset === 'shear') {
      fields.shear.configure({
        origin: world.anchor,
        velocity: [8.4 * speed, 0.25, 3.2 * speed],
        jacobian: [
          0.002, 0, 0.038 + gust * 0.002,
          0, 0, 0.006,
          -0.016, 0, -0.002,
        ],
        turbulence: gust * 0.1,
      })
      return fields.shear
    }
    if (preset === 'tornado') {
      fields.tornado.configure({
        center: world.vortexCenter,
        baseVelocity: [0.45 * speed, 0, 0.1],
        angularSpeed: 1.55 * speed + gust * 0.025,
        radialInflow: 0.38 + gust * 0.01,
        lift: 4.7 + gust * 0.13,
        turbulence: 0.12 + gust * 0.018,
        softeningRadius: 6,
      })
      return fields.tornado
    }
    fields.storm.configure({
      baseVelocity: STORM_DIRECTION.clone().multiplyScalar(9.8 * speed),
      gustSpeed: gust,
      turbulence: 0.65 + gust * 0.08,
    })
    return fields.storm
  }

  function applyStyle(definition: PresetDefinition): void {
    const minimumWidth = Math.max(0.4, runtimeControls.width * 0.68)
    const maximumWidth = Math.max(minimumWidth, runtimeControls.width * 1.24)
    windline.setStyle({
      regionRadius: definition.regionRadius,
      verticalHalfSpan: definition.verticalHalfSpan,
      centerLift: definition.centerLift,
      length: runtimeControls.length,
      widthCssPixels: [minimumWidth, maximumWidth],
      colors: definition.colors,
      colorRandomness: runtimeControls.colorRandomness,
      opacity: runtimeControls.opacity,
      curveAmplitude: definition.curveAmplitude,
      curveSweepRadians: THREE.MathUtils.degToRad(runtimeControls.curveSweep),
      curveTurns: runtimeControls.curveTurns,
      lifetime: definition.lifetime,
      speed: definition.speedRange,
      fieldSpeedMultiplier: definition.fieldSpeedMultiplier * runtimeControls.speed,
    })
  }

  function updateFieldReadout(): void {
    const definition = PRESETS[activePreset]
    fieldIndex.textContent = definition.index
    fieldName.textContent = definition.label
    const speed = windlineStats.sampledSpeed > 0.01
      ? `${windlineStats.sampledSpeed.toFixed(1)} m/s`
      : definition.metric
    fieldMetric.textContent = `${speed} · ${definition.fieldLabel}`
  }

  function replaceWindline(curve: WindLineCurve): void {
    if (curve === activeCurve) return
    const previous = windline
    windline = createWindline(curve)
    activeCurve = curve
    previous.dispose()
  }

  function setCurve(curve: WindLineCurve): boolean {
    if (!WIND_LINE_CURVES.includes(curve)) return false
    replaceWindline(curve)
    windline.setField(activeField)
    windline.setCount(runtimeControls.density)
    applyStyle(PRESETS[activePreset])
    curveSelect.value = activeCurve
    syncCurveControls()
    return true
  }

  function setPreset(preset: DemoPresetId, resetParameters = true): boolean {
    const definition = PRESETS[preset]
    if (!definition) return false
    activePreset = preset
    if (resetParameters) Object.assign(runtimeControls, definition.controls)
    replaceWindline(definition.curve)
    activeField = configureField(preset)
    windline.setField(activeField)
    windline.setCount(runtimeControls.density)
    applyStyle(definition)
    world.setPreset(preset)
    for (const button of presetButtons) {
      const selected = button.dataset.preset === preset
      button.classList.toggle('is-active', selected)
      button.setAttribute('aria-pressed', String(selected))
    }
    curveSelect.value = activeCurve
    syncAllSliders()
    syncCurveControls()
    updateFieldReadout()
    return true
  }

  function updateLiveParameter(id: SliderId, value: number): void {
    runtimeControls[id] = value
    outputs[id].value = formatControl(id, value)
    outputs[id].textContent = outputs[id].value
    if (id === 'density') {
      windline.setCount(value)
    } else {
      if (id === 'speed' || id === 'gust') {
        activeField = configureField(activePreset)
        windline.setField(activeField)
      }
      applyStyle(PRESETS[activePreset])
    }
  }

  function setPaused(nextPaused: boolean): void {
    paused = nextPaused
    pauseButton.innerHTML = `<i data-lucide="${paused ? 'play' : 'pause'}" aria-hidden="true"></i>`
    pauseButton.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation')
    pauseButton.dataset.tooltip = paused ? 'Resume' : 'Pause'
    installIcons(pauseButton)
  }

  function reset(): void {
    simulationTime = 0
    camera.position.copy(DEFAULT_CAMERA_POSITION)
    controls.target.copy(DEFAULT_CAMERA_TARGET)
    controls.update()
    setPaused(false)
    setPreset(activePreset, true)
  }

  function resize(): void {
    const width = Math.max(1, viewport.clientWidth)
    const height = Math.max(1, viewport.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function snapshot(): DemoSnapshot {
    windline.readStats(windlineStats)
    return Object.freeze({
      ready: bridge.ready,
      paused,
      preset: activePreset,
      curve: activeCurve,
      backend,
      fps,
      draws,
      controls: Object.freeze({ ...runtimeControls }),
      camera: Object.freeze(camera.position.toArray()),
      target: Object.freeze(controls.target.toArray()),
      windline: Object.freeze({ ...windlineStats }),
    })
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    renderer.setAnimationLoop(null)
    events.abort()
    controls.dispose()
    windline.dispose()
    world.dispose()
    renderer.dispose()
    renderer.domElement.remove()
    if (globalThis.__threeWindlineDemo === bridge) globalThis.__threeWindlineDemo = undefined
  }

  const bridge: ThreeWindlineDemoBridge = {
    ready: false,
    renderer,
    scene,
    camera,
    controls,
    get windline() {
      return windline
    },
    setPreset: (preset) => setPreset(preset, true),
    setCurve,
    setPaused,
    reset,
    snapshot,
    dispose,
  }
  globalThis.__threeWindlineDemo = bridge

  for (const button of presetButtons) {
    button.addEventListener('click', () => {
      const preset = button.dataset.preset as DemoPresetId | undefined
      if (preset && preset in PRESETS) setPreset(preset, true)
    }, listen)
  }
  for (const id of sliderIds) {
    sliders[id].addEventListener('input', () => {
      updateLiveParameter(id, Number(sliders[id].value))
    }, listen)
  }
  curveSelect.addEventListener('change', () => {
    setCurve(curveSelect.value as WindLineCurve)
  }, listen)
  settingsButton.addEventListener('click', () => {
    setSettingsOpen(settingsDrawer.hidden, settingsDrawer.hidden)
  }, listen)
  closeSettingsButton.addEventListener('click', () => setSettingsOpen(false, true), listen)
  pauseButton.addEventListener('click', () => setPaused(!paused), listen)
  resetButton.addEventListener('click', reset, listen)
  renderer.domElement.addEventListener('pointerdown', () => {
    if (!settingsDrawer.hidden) setSettingsOpen(false)
  }, listen)
  globalThis.addEventListener('resize', resize, listen)
  globalThis.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && !settingsDrawer.hidden) {
      event.preventDefault()
      setSettingsOpen(false, true)
    } else if (event.code === 'Space' && event.target === document.body) {
      event.preventDefault()
      setPaused(!paused)
    }
  }, listen)
  globalThis.addEventListener('pagehide', dispose, { ...listen, once: true })
  const hot = (import.meta as ImportMeta & {
    hot?: { dispose(callback: () => void): void }
  }).hot
  hot?.dispose(dispose)

  resize()
  setPreset('breeze', true)
  renderer.setAnimationLoop((nowMilliseconds: number) => {
    if (disposed) return
    const now = nowMilliseconds * 0.001
    const delta = THREE.MathUtils.clamp(now - previousNow, 0, 0.05)
    previousNow = now
    const simulationDelta = paused ? 0 : delta
    if (!paused) simulationTime += simulationDelta

    if (activePreset === 'breeze') {
      const gustPulse = (
        Math.sin(simulationTime * 0.71)
        + Math.sin(simulationTime * 0.23 + 1.7) * 0.55
      ) * 0.5 + 0.5
      const breezeSpeed = 6.8 * runtimeControls.speed + runtimeControls.gust * gustPulse * 0.24
      fields.breeze.setVelocity(BREEZE_VELOCITY_SCRATCH
        .copy(BREEZE_DIRECTION)
        .multiplyScalar(breezeSpeed))
    }

    controls.update()
    camera.updateMatrixWorld()
    world.update(simulationTime, simulationDelta)
    windline.update({
      timeSeconds: simulationTime,
      deltaSeconds: simulationDelta,
      anchor: activePreset === 'tornado' ? world.vortexCenter : world.anchor,
      camera,
      observerVelocity: OBSERVER_VELOCITY,
      forward: activePreset === 'storm' ? STORM_DIRECTION : world.forward,
      active: true,
      intensity: 1,
    })
    renderer.render(scene, camera)

    frames += 1
    frameWindowCount += 1
    if (now - frameWindowStart >= 0.5) {
      const currentRenderCalls = renderer.info.render.calls
      fps = Math.round(frameWindowCount / Math.max(0.001, now - frameWindowStart))
      draws = Math.max(
        0,
        Math.round((currentRenderCalls - renderCallsAtWindowStart) / Math.max(1, frameWindowCount)),
      )
      renderCallsAtWindowStart = currentRenderCalls
      frameWindowCount = 0
      frameWindowStart = now
      windline.readStats(windlineStats)
      fpsValue.textContent = String(fps)
      drawValue.textContent = String(draws)
      lineValue.textContent = String(windlineStats.count)
      updateFieldReadout()
    }
    if (frames === 3) {
      bridge.ready = true
      loading.classList.add('is-hidden')
    }
  })
}

start().catch((error: unknown) => {
  console.error('[three-windline] Demo startup failed', error)
  const loading = document.getElementById('loading')
  loading?.classList.add('is-hidden')
  const fatalError = document.getElementById('fatalError')
  const message = document.getElementById('fatalErrorMessage')
  if (fatalError instanceof HTMLElement) fatalError.hidden = false
  if (message instanceof HTMLElement) {
    message.textContent = error instanceof Error ? error.message : String(error)
  }
  installIcons()
})
