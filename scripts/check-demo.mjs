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
    drawCalls: Number(stats.drawCalls),
    activeLines: Number(stats.activeLines ?? stats.count),
    raw: snapshot,
  }
}

async function installGpuErrorCapture(page) {
  await page.addInitScript(() => {
    globalThis.__THREE_WINDLINE_GPU_ERRORS__ = []
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
      stats: final.raw.stats ?? final.raw.windline,
      deviceScaleFactor: initialSizing.dpr,
      screenshot: targetPath,
      pixels,
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
