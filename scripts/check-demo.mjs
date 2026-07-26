import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, extname } from 'node:path'

import { chromium } from 'playwright-core'
import { PNG } from 'pngjs'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4192/'
const screenshotPath = process.env.SCREENSHOT_PATH || '/tmp/three-windline-webgpu.png'
const timeout = Number(process.env.TIMEOUT_MS) || 120_000
const chromeChannel = process.env.CHROME_CHANNEL || 'chrome'
const executablePath = process.env.CHROME_EXECUTABLE_PATH || undefined
const headless = process.env.HEADLESS !== '0'

function variantScreenshotPath(backend) {
  if (screenshotPath.includes('{backend}')) {
    return screenshotPath.replaceAll('{backend}', backend)
  }
  if (backend === 'webgpu') return screenshotPath
  const extension = extname(screenshotPath)
  return extension.length > 0
    ? `${screenshotPath.slice(0, -extension.length)}-${backend}${extension}`
    : `${screenshotPath}-${backend}.png`
}

function analyzePixels(buffer) {
  const image = PNG.sync.read(buffer)
  let samples = 0
  let visible = 0
  let luminance = 0
  let luminanceSquared = 0
  const colors = new Set()

  for (let y = 0; y < image.height; y += 4) {
    for (let x = 0; x < image.width; x += 4) {
      const offset = (y * image.width + x) * 4
      const red = image.data[offset] ?? 0
      const green = image.data[offset + 1] ?? 0
      const blue = image.data[offset + 2] ?? 0
      const alpha = image.data[offset + 3] ?? 0
      const value = red * 0.2126 + green * 0.7152 + blue * 0.0722
      luminance += value
      luminanceSquared += value * value
      if (alpha > 0 && value > 3) visible += 1
      colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`)
      samples += 1
    }
  }

  const mean = luminance / Math.max(1, samples)
  return {
    width: image.width,
    height: image.height,
    nonBlankRatio: visible / Math.max(1, samples),
    luminanceMean: mean,
    luminanceDeviation: Math.sqrt(Math.max(
      0,
      luminanceSquared / Math.max(1, samples) - mean * mean,
    )),
    colorBuckets: colors.size,
  }
}

function assertRenderedPixels(metrics, backend) {
  assert.ok(metrics.width > 0 && metrics.height > 0, `${backend} screenshot has no pixels`)
  assert.ok(
    metrics.nonBlankRatio > 0.05,
    `${backend} canvas appears blank: nonBlankRatio=${metrics.nonBlankRatio}`,
  )
  assert.ok(
    metrics.luminanceDeviation > 2,
    `${backend} canvas appears visually flat: deviation=${metrics.luminanceDeviation}`,
  )
  assert.ok(
    metrics.colorBuckets > 12,
    `${backend} canvas has too little rendered detail: buckets=${metrics.colorBuckets}`,
  )
}

function isGpuError(message) {
  return /GPU(?:Internal|OutOfMemory|Validation)Error|uncaptured WebGPU|WebGPU[^]*validation error|device lost/i
    .test(message)
}

function isIgnorableBrowserNoise(message) {
  return /Failed to load resource: the server responded with a status of 404 \(Not Found\)/i
    .test(message)
}

function readDemoSnapshot() {
  const hook = globalThis.__THREE_WINDLINE_DEMO__ ?? globalThis.__threeWindlineDemo
  if (!hook) return null
  if (typeof hook.snapshot === 'function') return hook.snapshot()
  if (typeof hook.getSnapshot === 'function') return hook.getSnapshot()
  return hook
}

function normalizeSnapshot(snapshot) {
  const stats = snapshot?.stats ?? snapshot?.windline ?? {}
  return {
    ready: snapshot?.ready === true,
    renderer: String(snapshot?.renderer ?? snapshot?.backend ?? '').toLowerCase(),
    frame: Number(snapshot?.frame ?? stats.updates ?? 0),
    curve: String(snapshot?.curve ?? ''),
    drawCalls: Number(stats.drawCalls),
    activeLines: Number(stats.activeLines ?? stats.count),
    raw: snapshot,
  }
}

async function installGpuErrorCapture(page) {
  await page.addInitScript(() => {
    globalThis.__THREE_WINDLINE_GPU_ERRORS__ = []
    globalThis.__THREE_WINDLINE_SHADERS__ = []
    const record = (value) => {
      const message = value instanceof Error ? value.message : String(value)
      globalThis.__THREE_WINDLINE_GPU_ERRORS__.push(message)
    }
    globalThis.addEventListener('unhandledrejection', event => record(event.reason))
    globalThis.addEventListener('error', event => record(event.error ?? event.message))

    const adapterPrototype = globalThis.GPUAdapter?.prototype
    const originalRequestDevice = adapterPrototype?.requestDevice
    if (adapterPrototype && typeof originalRequestDevice === 'function') {
      adapterPrototype.requestDevice = async function requestDevice(...args) {
        const device = await originalRequestDevice.apply(this, args)
        const createShaderModule = device.createShaderModule.bind(device)
        device.createShaderModule = descriptor => {
          globalThis.__THREE_WINDLINE_SHADERS__.push({
            label: descriptor.label ?? '',
            code: String(descriptor.code),
          })
          return createShaderModule(descriptor)
        }
        device.addEventListener('uncapturederror', event => record(event.error))
        device.lost.then(info => {
          if (info.reason !== 'destroyed') record(`GPU device lost: ${info.reason} ${info.message}`)
        })
        return device
      }
    }
  })
}

async function runVariant(browser, backend) {
  const expectedRenderer = backend === 'webgpu' ? 'webgpu' : 'webgl'
  const context = await browser.newContext({
    viewport: { width: 1_280, height: 800 },
    deviceScaleFactor: 1.5,
  })
  const page = await context.newPage()
  const errors = []

  page.on('console', message => {
    const value = message.text()
    if (message.type() === 'error' || isGpuError(value)) {
      errors.push(`console: ${value}`)
    }
  })
  page.on('pageerror', error => errors.push(`page: ${error.message}`))
  await installGpuErrorCapture(page)

  try {
    const url = new URL(baseUrl)
    url.searchParams.set('renderer', 'webgpu')
    url.searchParams.set('smoke', String(Date.now()))
    if (backend === 'webgl') {
      url.searchParams.set('force-webgl', '1')
      url.searchParams.set('backend', 'webgl')
    } else {
      url.searchParams.delete('force-webgl')
      url.searchParams.delete('backend')
    }

    const response = await page.goto(url.href, {
      waitUntil: 'domcontentloaded',
      timeout,
    })
    assert.ok(response?.ok(), `${backend} navigation returned HTTP ${response?.status()}`)

    if (backend === 'webgpu') {
      assert.equal(
        await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter({
          powerPreference: 'high-performance',
        }))),
        true,
        'Chrome did not expose a real WebGPU adapter',
      )
    }

    await page.waitForFunction(
      () => {
        const hook = globalThis.__THREE_WINDLINE_DEMO__ ?? globalThis.__threeWindlineDemo
        const state = typeof hook?.snapshot === 'function'
          ? hook.snapshot()
          : typeof hook?.getSnapshot === 'function'
            ? hook.getSnapshot()
            : hook
        const stats = state?.stats ?? state?.windline
        return state?.ready === true && Number(state?.frame ?? stats?.updates) >= 2
      },
      null,
      { timeout },
    )
    await page.waitForFunction(
      () => {
        const loading = document.querySelector('#loading')
        if (!(loading instanceof HTMLElement)) return true
        const style = getComputedStyle(loading)
        return style.visibility === 'hidden' && Number(style.opacity) < 0.01
      },
      null,
      { timeout },
    )

    const canvas = page.locator('canvas[data-windline-canvas], #windlineCanvas')
    assert.equal(await canvas.count(), 1, `${backend} demo must expose exactly one windline canvas`)

    const initial = normalizeSnapshot(await page.evaluate(readDemoSnapshot))
    assert.equal(initial.ready, true)
    assert.ok(
      initial.renderer.includes(expectedRenderer),
      `${backend} resolved unexpected renderer: ${initial.renderer}`,
    )
    assert.equal(initial.drawCalls, 1, `${backend} windline must render in one draw`)
    assert.ok(
      initial.activeLines > 0,
      `${backend} snapshot must report visible wind lines`,
    )
    const rendererTelemetry = await page.evaluate(() => {
      const demo = globalThis.__threeWindlineDemo
      const state = demo?.snapshot()
      return {
        snapshotDraws: Number(state?.draws),
        snapshotPasses: Number(state?.passes),
        rendererDraws: Number(demo?.renderer.info.render.drawCalls),
        rendererPasses: Number(demo?.renderer.info.render.frameCalls),
      }
    })
    assert.equal(rendererTelemetry.snapshotDraws, rendererTelemetry.rendererDraws)
    assert.equal(rendererTelemetry.snapshotPasses, rendererTelemetry.rendererPasses)
    assert.ok(rendererTelemetry.snapshotDraws >= initial.drawCalls)
    assert.ok(rendererTelemetry.snapshotPasses > 0)
    assert.deepEqual(initial.raw.bloom, {
      strength: 0.12,
      radius: 0.16,
      threshold: 1.18,
      exposure: 1.06,
    })
    const presetNavigation = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('[data-preset]')]
        .map(button => button.getAttribute('data-preset')),
      buttonLabels: [...document.querySelectorAll('[data-preset]')]
        .map(button => button.textContent?.trim()),
      twisterOptions: [...document.querySelectorAll('#twisterSelect option')]
        .map(option => option.getAttribute('value')),
    }))
    assert.deepEqual(presetNavigation.buttons, ['breeze', 'storm'])
    assert.deepEqual(presetNavigation.buttonLabels, ['Breeze', 'Hurricane'])
    assert.deepEqual(presetNavigation.twisterOptions, ['', 'tornado', 'water', 'fire'])
    assert.equal(await page.locator('#twisterSelect').inputValue(), '')
    const initialVane = await page.evaluate(() => {
      const vane = globalThis.__threeWindlineDemo?.scene
        .getObjectByName('windline-demo-wind-vane')
      return {
        sampleCount: Number(vane?.userData?.sampleCount),
        speed: Number(vane?.userData?.windSpeed),
        windX: Number(vane?.userData?.windX),
        windZ: Number(vane?.userData?.windZ),
        targetHeading: Number(vane?.userData?.targetHeading),
      }
    })
    assert.ok(initialVane.sampleCount >= 1)
    assert.ok(initialVane.speed > 1)
    assert.ok(Number.isFinite(initialVane.targetHeading))
    assert.ok(
      Math.abs(
        initialVane.targetHeading - Math.atan2(initialVane.windZ, initialVane.windX),
      ) < 1e-6,
    )
    await page.locator('#speedSlider').evaluate((element) => {
      element.value = '1.8'
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForFunction(
      before => {
        const vane = globalThis.__threeWindlineDemo?.scene
          .getObjectByName('windline-demo-wind-vane')
        return Number(vane?.userData?.sampleCount) > before.sampleCount
          && Number(vane?.userData?.windSpeed) > before.speed * 1.35
      },
      initialVane,
      { timeout },
    )

    const curves = ['flow', 'straight', 'arc', 'ring', 'helix', 'spiral']
    const compiledCurves = []
    for (const curve of curves) {
      assert.equal(
        await page.evaluate(
          value => globalThis.__threeWindlineDemo?.setCurve(value),
          curve,
        ),
        true,
        `${backend} rejected curve ${curve}`,
      )
      await page.waitForFunction(
        value => {
          const state = globalThis.__threeWindlineDemo?.snapshot()
          return state?.curve === value
            && Number(state?.windline?.updates) >= 3
            && Number(state?.windline?.drawCalls) === 1
        },
        curve,
        { timeout },
      )
      const state = normalizeSnapshot(await page.evaluate(readDemoSnapshot))
      assert.equal(state.curve, curve)
      assert.equal(state.drawCalls, 1)
      compiledCurves.push(curve)
    }
    await page.locator('#twisterSelect').selectOption('tornado')
    await page.waitForFunction(
      () => {
        const state = globalThis.__threeWindlineDemo?.snapshot()
        return state?.preset === 'tornado'
          && state?.curve === 'straight'
          && Number(state?.windline?.updates) >= 3
          && Number(state?.windline?.drawCalls) === 1
          && Number(state?.vortexBody?.updates) >= 3
          && Number(state?.vortexBody?.drawCalls) === 1
      },
      null,
      { timeout },
    )
    const tornado = normalizeSnapshot(await page.evaluate(readDemoSnapshot))
    assert.equal(tornado.drawCalls, 1)
    assert.equal(tornado.activeLines, 288)
    assert.equal(tornado.raw.vortexBody.count, 144)
    assert.equal(tornado.raw.vortexBody.segments, 12)
    assert.equal(tornado.raw.vortexBody.drawCalls, 1)
    assert.equal(tornado.raw.vortexBody.triangles, 144 * 12 * 2)
    assert.equal(tornado.raw.vortexBody.dynamicInstanceUploads, 0)
    assert.ok(Math.abs(tornado.raw.vortexMotion.angularSpeed - 26.16) < 1e-6)
    assert.deepEqual(tornado.raw.bloom, {
      strength: 0.2,
      radius: 0.18,
      threshold: 1.08,
      exposure: 1.04,
    })
    assert.equal(await page.locator('#twisterSelect').inputValue(), 'tornado')
    assert.equal(
      await page.locator('#twisterSelectShell').evaluate(
        element => element.classList.contains('is-active'),
      ),
      true,
    )
    const environmentVfx = await page.evaluate(() => {
      const scene = globalThis.__threeWindlineDemo?.scene
      const grass = scene?.getObjectByName('windline-demo-grass')
      const debris = scene?.getObjectByName('windline-demo-vortex-ground-debris')
      const contactLight = scene?.getObjectByName('windline-demo-vortex-contact-light')
      const grassRoot = grass?.geometry?.getAttribute?.('aGrassRoot')
      const matrices = grass?.instanceMatrix?.array
      let maximumBladeHeight = 0
      if (matrices) {
        for (let offset = 5; offset < matrices.length; offset += 16) {
          maximumBladeHeight = Math.max(maximumBladeHeight, matrices[offset])
        }
      }
      return {
        grassCount: Number(grass?.count),
        grassRootCount: Number(grassRoot?.count),
        grassRootItemSize: Number(grassRoot?.itemSize),
        maximumBladeHeight,
        debrisCount: Number(debris?.count),
        debrisIsInstanced: debris?.isInstancedMesh === true,
        contactLightIsPointLight: contactLight?.isPointLight === true,
      }
    })
    assert.equal(environmentVfx.grassCount, 36_000)
    assert.equal(environmentVfx.grassRootCount, 36_000)
    assert.equal(environmentVfx.grassRootItemSize, 2)
    assert.ok(environmentVfx.maximumBladeHeight >= 4.9)
    assert.equal(environmentVfx.debrisCount, 1_100)
    assert.equal(environmentVfx.debrisIsInstanced, true)
    assert.equal(environmentVfx.contactLightIsPointLight, true)

    for (const [preset, activeLines, angularSpeed, bloomLook] of [
      ['water', 304, 27.48, {
        strength: 0.26,
        radius: 0.26,
        threshold: 1.1,
        exposure: 1.02,
      }],
      ['fire', 320, 29.472, {
        strength: 0.82,
        radius: 0.36,
        threshold: 0.48,
        exposure: 0.88,
      }],
    ]) {
      await page.locator('#twisterSelect').selectOption(preset)
      await page.waitForFunction(
        ([expectedPreset, expectedLines, expectedAngularSpeed, expectedBloom]) => {
          const state = globalThis.__threeWindlineDemo?.snapshot()
          return state?.preset === expectedPreset
            && Number(state?.windline?.count) === expectedLines
            && Number(state?.windline?.drawCalls) === 1
            && Number(state?.vortexBody?.count) === 144
            && Number(state?.vortexBody?.drawCalls) === 1
            && Math.abs(
              Number(state?.vortexMotion?.angularSpeed) - expectedAngularSpeed,
            ) < 1e-6
            && Object.entries(expectedBloom).every(
              ([key, value]) => Number(state?.bloom?.[key]) === value,
            )
        },
        [preset, activeLines, angularSpeed, bloomLook],
        { timeout },
      )
      const state = normalizeSnapshot(await page.evaluate(readDemoSnapshot))
      assert.deepEqual(state.raw.bloom, bloomLook)
    }
    const vortexBasePath = variantScreenshotPath(backend)
    const vortexExtension = extname(vortexBasePath)
    const vortexTargetPath = vortexExtension.length > 0
      ? `${vortexBasePath.slice(0, -vortexExtension.length)}-vortex${vortexExtension}`
      : `${vortexBasePath}-vortex.png`
    await mkdir(dirname(vortexTargetPath), { recursive: true })
    const vortexScreenshot = await canvas.screenshot({ path: vortexTargetPath })
    const vortexPixels = analyzePixels(vortexScreenshot)
    assertRenderedPixels(vortexPixels, `${backend} vortex`)

    const vortexPositionBeforeClick = await page.evaluate(
      () => globalThis.__threeWindlineDemo?.scene
        .getObjectByName('windline-demo-vortex-guide')
      ?.position.toArray(),
    )
    assert.ok(Array.isArray(vortexPositionBeforeClick))
    const canvasBounds = await canvas.boundingBox()
    assert.ok(canvasBounds)
    await page.mouse.click(
      canvasBounds.x + canvasBounds.width * 0.78,
      canvasBounds.y + canvasBounds.height * 0.81,
    )
    await page.waitForTimeout(500)
    const vortexPositionAfterClick = await page.evaluate(
      () => globalThis.__threeWindlineDemo?.scene
        .getObjectByName('windline-demo-vortex-guide')
        ?.position.toArray(),
    )
    assert.ok(Array.isArray(vortexPositionAfterClick))
    const initialTravel = Math.hypot(
      vortexPositionAfterClick[0] - vortexPositionBeforeClick[0],
      vortexPositionAfterClick[2] - vortexPositionBeforeClick[2],
    )
    assert.ok(initialTravel > 0.3, 'vortex did not begin moving toward the click target')
    assert.ok(initialTravel < 4.5, `vortex target movement snapped ${initialTravel.toFixed(2)} m`)
    const vortexMotion = await page.evaluate(
      () => globalThis.__threeWindlineDemo?.snapshot().vortexMotion,
    )
    assert.ok(vortexMotion.speed > 0.2)
    assert.ok(vortexMotion.speed <= 6.5 + 1e-6)
    assert.ok(Math.hypot(...vortexMotion.lean) > 0.01)
    const targetMarker = await page.evaluate(() => {
      const scene = globalThis.__threeWindlineDemo?.scene
      const marker = scene?.getObjectByName('windline-demo-vortex-target-marker')
      const reticle = scene?.getObjectByName('windline-demo-vortex-target-reticle')
      return {
        visible: marker?.visible === true,
        phase: marker?.userData?.phase,
        commandSerial: Number(marker?.userData?.commandSerial),
        position: marker?.position.toArray(),
        vertices: Number(reticle?.geometry?.getAttribute?.('position')?.count),
      }
    })
    assert.equal(targetMarker.visible, true)
    assert.equal(targetMarker.phase, 'command')
    assert.ok(targetMarker.commandSerial >= 1)
    assert.ok(targetMarker.vertices > 0)
    assert.ok(
      Math.hypot(
        targetMarker.position[0] - vortexMotion.target[0],
        targetMarker.position[2] - vortexMotion.target[2],
      ) < 0.01,
    )
    await page.waitForFunction(
      before => {
        const position = globalThis.__threeWindlineDemo?.scene
          .getObjectByName('windline-demo-vortex-guide')
          ?.position
        if (!position) return false
        return Math.hypot(
          position.x - before[0],
          position.z - before[2],
        ) > 0.5
      },
      vortexPositionBeforeClick,
      { timeout },
    )
    await page.waitForFunction(
      () => {
        const bridge = globalThis.__threeWindlineDemo
        const state = bridge?.snapshot()
        const guide = bridge?.scene.getObjectByName('windline-demo-vortex-guide')
        const target = state?.vortexMotion?.target
        if (!guide || !target) return false
        return state.vortexMotion.speed < 0.01
          && Math.hypot(...state.vortexMotion.lean) < 0.02
          && Math.hypot(
            guide.position.x - target[0],
            guide.position.z - target[2],
          ) < 0.01
      },
      null,
      { timeout },
    )
    const settledMarker = await page.evaluate(() => {
      const marker = globalThis.__threeWindlineDemo?.scene
        .getObjectByName('windline-demo-vortex-target-marker')
      return {
        visible: marker?.visible === true,
        phase: marker?.userData?.phase,
        arrivalSerial: Number(marker?.userData?.arrivalSerial),
      }
    })
    assert.equal(settledMarker.visible, false)
    assert.equal(settledMarker.phase, 'hidden')
    assert.ok(settledMarker.arrivalSerial >= 1)
    await page.mouse.click(
      canvasBounds.x + canvasBounds.width * 0.22,
      canvasBounds.y + canvasBounds.height * 0.74,
    )
    await page.waitForTimeout(100)
    assert.equal(
      await page.evaluate(() => {
        const bridge = globalThis.__threeWindlineDemo
        const marker = bridge?.scene.getObjectByName(
          'windline-demo-vortex-target-marker',
        )
        if (marker?.userData?.phase !== 'command') return false
        bridge?.reset()
        return marker?.visible === false && marker?.userData?.phase === 'hidden'
      }),
      true,
    )

    assert.equal(
      await page.evaluate(() => globalThis.__threeWindlineDemo?.setPreset('storm')),
      true,
    )
    await page.waitForFunction(
      () => {
        const state = globalThis.__threeWindlineDemo?.snapshot()
        return state?.preset === 'storm'
          && state?.curve === 'straight'
          && Number(state?.windline?.count) === 1536
          && Number(state?.windline?.drawCalls) === 1
          && Number(state?.vortexBody?.count) === 576
          && Number(state?.vortexBody?.drawCalls) === 1
          && Math.abs(Number(state?.vortexMotion?.angularSpeed) - 40.5) < 1e-6
          && Number(state?.vortex?.height) === 84
          && Number(state?.vortex?.topRadius) === 64
          && Number(state?.vortex?.axisWander) === 9
          && Number(state?.vortex?.volume) === 1.35
      },
      null,
      { timeout },
    )
    const hurricane = normalizeSnapshot(await page.evaluate(readDemoSnapshot))
    assert.deepEqual(hurricane.raw.bloom, {
      strength: 0.34,
      radius: 0.35,
      threshold: 0.9,
      exposure: 0.9,
    })
    assert.equal(await page.locator('#fieldName').textContent(), 'Hurricane')
    assert.equal(await page.locator('#twisterSelect').inputValue(), '')
    assert.equal(
      await page.locator('[data-preset="storm"]').evaluate(
        element => element.classList.contains('is-active'),
      ),
      true,
    )
    await page.waitForFunction(
      () => document.querySelector('#lineValue')?.textContent === '1536',
      null,
      { timeout },
    )
    assert.ok(Math.abs(
      hurricane.raw.camera[0] - hurricane.raw.target[0] - 100,
    ) < 0.01)
    assert.ok(Math.abs(
      hurricane.raw.camera[1] - hurricane.raw.target[1] - 30,
    ) < 0.01)
    assert.ok(Math.abs(
      hurricane.raw.camera[2] - hurricane.raw.target[2] - 126,
    ) < 0.01)
    const airborne = await page.evaluate(() => {
      const scene = globalThis.__threeWindlineDemo?.scene
      const group = scene?.getObjectByName('windline-demo-hurricane-airborne')
      const inspect = name => {
        const mesh = scene?.getObjectByName(name)
        return {
          instanceCount: Number(mesh?.geometry?.instanceCount),
          instancedGeometry: mesh?.geometry?.isInstancedBufferGeometry === true,
          hasInstanceMatrix: mesh?.instanceMatrix !== undefined,
          orbitCount: Number(mesh?.geometry?.getAttribute?.('aHurricaneOrbit')?.count),
          traitCount: Number(mesh?.geometry?.getAttribute?.('aHurricaneTrait')?.count),
          shadeCount: Number(mesh?.geometry?.getAttribute?.('aHurricaneShade')?.count),
        }
      }
      return {
        visible: group?.visible === true,
        totalCount: Number(group?.userData?.totalCount),
        light: inspect('windline-demo-hurricane-light-debris'),
        medium: inspect('windline-demo-hurricane-medium-debris'),
        hero: inspect('windline-demo-hurricane-hero-debris'),
      }
    })
    assert.equal(airborne.visible, true)
    assert.equal(airborne.totalCount, 5_248)
    for (const [layer, count] of [
      [airborne.light, 4_096],
      [airborne.medium, 1_024],
      [airborne.hero, 128],
    ]) {
      assert.equal(layer.instanceCount, count)
      assert.equal(layer.instancedGeometry, true)
      assert.equal(layer.hasInstanceMatrix, false)
      assert.equal(layer.orbitCount, count)
      assert.equal(layer.traitCount, count)
      assert.equal(layer.shadeCount, count)
    }
    await page.waitForTimeout(200)
    const hurricaneBasePath = variantScreenshotPath(backend)
    const hurricaneExtension = extname(hurricaneBasePath)
    const hurricaneTargetPath = hurricaneExtension.length > 0
      ? `${hurricaneBasePath.slice(0, -hurricaneExtension.length)}-hurricane${hurricaneExtension}`
      : `${hurricaneBasePath}-hurricane.png`
    await mkdir(dirname(hurricaneTargetPath), { recursive: true })
    const hurricaneScreenshot = await canvas.screenshot({ path: hurricaneTargetPath })
    const hurricanePixels = analyzePixels(hurricaneScreenshot)
    assertRenderedPixels(hurricanePixels, `${backend} hurricane`)

    await page.evaluate(() => globalThis.__threeWindlineDemo?.reset())
    assert.equal(
      await page.evaluate(() => globalThis.__threeWindlineDemo?.setPreset('breeze')),
      true,
    )
    await page.waitForFunction(
      () => {
        const state = globalThis.__threeWindlineDemo?.snapshot()
        return state?.preset === 'breeze'
          && Number(state?.vortexBody?.count) === 0
          && Number(state?.vortexBody?.drawCalls) === 0
      },
      null,
      { timeout },
    )
    const resetCamera = normalizeSnapshot(await page.evaluate(readDemoSnapshot))
    for (const [actual, expected] of resetCamera.raw.camera.map(
      (value, index) => [value, [35, 22, 48][index]],
    )) {
      assert.ok(Math.abs(actual - expected) < 1e-9)
    }
    for (const [actual, expected] of resetCamera.raw.target.map(
      (value, index) => [value, [0, 7.2, 8][index]],
    )) {
      assert.ok(Math.abs(actual - expected) < 1e-9)
    }
    assert.equal(await page.locator('#twisterSelect').inputValue(), '')

    let shaderBudget
    if (backend === 'webgpu') {
      const bloomShaders = await page.evaluate(() => (
        globalThis.__THREE_WINDLINE_SHADERS__
          .map(shader => shader.label)
          .filter(label => label.includes('Bloom_'))
      ))
      for (const stage of ['Bloom_highPass', 'Bloom_separable', 'Bloom_comp']) {
        assert.ok(
          bloomShaders.some(label => label.includes(stage)),
          `WebGPU did not compile ${stage}`,
        )
      }
      shaderBudget = await page.evaluate(() => {
        const count = (source, token) => source.split(token).length - 1
        return globalThis.__THREE_WINDLINE_SHADERS__
          .filter(shader => shader.label.includes('three-windline-gpu-ribbon-material'))
          .map(shader => ({
            label: shader.label,
            stage: shader.label.startsWith('vertex') ? 'vertex' : 'fragment',
            bytes: shader.code.length,
            sin: count(shader.code, 'sin('),
            cos: count(shader.code, 'cos('),
            normalize: count(shader.code, 'normalize('),
            readsInstanceSeed: shader.code.includes('aWindSeed'),
          }))
      })
      const uniqueShaders = [...new Map(
        shaderBudget.map(shader => [`${shader.stage}:${shader.label}`, shader]),
      ).values()]
      const vertexShaders = uniqueShaders.filter(shader => shader.stage === 'vertex')
      const fragmentShaders = uniqueShaders.filter(shader => shader.stage === 'fragment')
      assert.equal(
        vertexShaders.length,
        curves.length + 2,
        `unexpected vertex shaders: ${vertexShaders.map(shader => shader.label).join(', ')}`,
      )
      assert.equal(
        fragmentShaders.length,
        curves.length + 2,
        `unexpected fragment shaders: ${fragmentShaders.map(shader => shader.label).join(', ')}`,
      )
      const affineVertexShaders = vertexShaders.filter(
        shader => shader.label.includes('-affine-') && shader.label.includes('-camera'),
      )
      const vortexCameraVertexShaders = vertexShaders.filter(
        shader => shader.label.includes('-vortex-') && shader.label.includes('-camera'),
      )
      const vortexRadialVertexShaders = vertexShaders.filter(
        shader => shader.label.includes('-vortex-') && shader.label.includes('-radial'),
      )
      assert.equal(affineVertexShaders.length, curves.length)
      assert.equal(vortexCameraVertexShaders.length, 1)
      assert.equal(vortexRadialVertexShaders.length, 1)
      assert.ok(affineVertexShaders.every(shader => shader.bytes < 10_000))
      assert.ok(vortexCameraVertexShaders.every(shader => shader.bytes < 16_000))
      assert.ok(vortexRadialVertexShaders.every(shader => shader.bytes < 18_000))
      assert.ok(
        [...affineVertexShaders, ...vortexCameraVertexShaders]
          .every(shader => shader.normalize <= 7),
      )
      assert.ok(vortexRadialVertexShaders.every(shader => shader.normalize <= 9))
      assert.ok(fragmentShaders.every(shader => shader.bytes < 2_000))
      assert.ok(fragmentShaders.every(shader => (
        shader.sin === 0
        && shader.cos === 0
        && shader.normalize === 0
        && shader.readsInstanceSeed === false
      )), 'windline path math leaked into the fragment shader')
      assert.deepEqual(
        affineVertexShaders.map(shader => shader.sin + shader.cos),
        [4, 0, 2, 2, 2, 2],
      )
      assert.ok(
        [...vortexCameraVertexShaders, ...vortexRadialVertexShaders]
          .every(shader => shader.sin + shader.cos >= 8),
        'vortex program did not compile its analytic spiral path',
      )
      assert.equal(
        vortexCameraVertexShaders[0].sin + vortexCameraVertexShaders[0].cos,
        vortexRadialVertexShaders[0].sin + vortexRadialVertexShaders[0].cos,
        'camera and radial ribbons must share the same vortex path',
      )
    }

    const initialSizing = await canvas.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return {
        cssWidth: rect.width,
        cssHeight: rect.height,
        width: element.width,
        height: element.height,
        dpr: globalThis.devicePixelRatio,
      }
    })
    assert.ok(initialSizing.cssWidth >= 1_200 && initialSizing.cssHeight >= 740)
    assert.ok(Math.abs(initialSizing.width - initialSizing.cssWidth * initialSizing.dpr) <= 2)
    assert.ok(Math.abs(initialSizing.height - initialSizing.cssHeight * initialSizing.dpr) <= 2)

    const frameBeforeResize = initial.frame
    await page.setViewportSize({ width: 1_024, height: 640 })
    await page.waitForFunction(
      previousFrame => {
        const hook = globalThis.__THREE_WINDLINE_DEMO__ ?? globalThis.__threeWindlineDemo
        const state = typeof hook?.snapshot === 'function'
          ? hook.snapshot()
          : typeof hook?.getSnapshot === 'function'
            ? hook.getSnapshot()
            : hook
        const stats = state?.stats ?? state?.windline
        const frame = Number(state?.frame ?? stats?.updates)
        const canvas = document.querySelector('canvas[data-windline-canvas], #windlineCanvas')
        if (!(canvas instanceof HTMLCanvasElement)) return false
        const rect = canvas.getBoundingClientRect()
        const dpr = globalThis.devicePixelRatio
        return frame > previousFrame
          && rect.width >= 1_000
          && rect.height >= 600
          && Math.abs(canvas.width - rect.width * dpr) <= 2
          && Math.abs(canvas.height - rect.height * dpr) <= 2
      },
      frameBeforeResize,
      { timeout },
    )

    const final = normalizeSnapshot(await page.evaluate(readDemoSnapshot))
    assert.equal(final.drawCalls, 1)
    assert.ok(final.activeLines > 0)

    const targetPath = variantScreenshotPath(backend)
    await mkdir(dirname(targetPath), { recursive: true })
    const screenshot = await canvas.screenshot({ path: targetPath })
    const pixels = analyzePixels(screenshot)
    assertRenderedPixels(pixels, backend)

    const capturedGpuErrors = await page.evaluate(
      () => globalThis.__THREE_WINDLINE_GPU_ERRORS__ ?? [],
    )
    const gpuErrors = capturedGpuErrors.filter(isGpuError)
    assert.deepEqual(gpuErrors, [], `${backend} emitted GPU errors`)
    assert.deepEqual(errors.filter(isGpuError), [], `${backend} emitted GPU console errors`)
    assert.deepEqual(
      errors.filter(message => !isIgnorableBrowserNoise(message)),
      [],
      `${backend} emitted browser errors`,
    )

    return {
      backend,
      renderer: final.renderer,
      frame: final.frame,
      compiledCurves,
      compiledPrograms: ['affine', 'vortex'],
      compiledRibbonModes: ['camera', 'radial'],
      shaderBudget,
      stats: final.raw.stats ?? final.raw.windline,
      deviceScaleFactor: initialSizing.dpr,
      screenshot: targetPath,
      pixels,
      vortexScreenshot: vortexTargetPath,
      vortexPixels,
      hurricaneScreenshot: hurricaneTargetPath,
      hurricanePixels,
    }
  } finally {
    await context.close()
  }
}

const launchOptions = {
  channel: executablePath ? undefined : chromeChannel,
  executablePath,
  headless,
  args: [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
  ],
}

const browser = await chromium.launch(launchOptions)
try {
  const webgpu = await runVariant(browser, 'webgpu')
  const webgl = await runVariant(browser, 'webgl')
  process.stdout.write(`${JSON.stringify({ baseUrl, webgpu, webgl }, null, 2)}\n`)
} finally {
  await browser.close()
}
