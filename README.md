# three-windline

Deterministic, camera-stable GPU wind ribbons for Three.js.

[Live demo](https://windline.rand.monster) |
[GitHub](https://github.com/rand-monster/three-windline) |
[MIT license](./LICENSE)

`three-windline` turns a sampled wind field into anti-aliased GPU ribbons.
Camera-facing ribbons keep a stable screen-space width, while vortex ribbons
can use a radial frame and world-space width. It targets Three.js r185
`WebGPURenderer` and uses one instanced draw per wind-line system.

> **Pre-release:** the package metadata declares the name `three-windline`, but
> this repository does not claim that an npm release is available yet. Use a
> local checkout until the first registry release is announced.

The package is ESM-only. It does not expose a CommonJS `require()` entry.

## What It Provides

- One GPU draw for up to 4,096 deterministic ribbons.
- TSL vertex generation with native WebGPU and a WebGL2 backend option.
- Construction-specialized `camera` ribbons with stable CSS-pixel width and
  `radial` vortex ribbons with world-space width.
- Derivative edge anti-aliasing and camera near/far fades.
- Static per-instance seed buffers. Runtime updates change uniforms, not
  instance data.
- Compile-specialized `flow`, `straight`, `arc`, `ring`, `helix`, and `spiral`
  curve programs.
- Construction-specialized `affine` and exact analytic `vortex` GPU field
  programs.
- Uniform, affine/shear, coherent gust, and softened vortex wind fields.
- Runtime density, style, and same-program field changes without rebuilding
  geometry.
- An allocation-free field-sampling contract for custom simulation sources.

The [interactive demo](https://windline.rand.monster) includes Breeze, Wind,
Water, Fire, and Storm Front presets. Wind, Water, and Fire are
three radial vortex themes, reported as Tornado, Water Vortex, and Fire Vortex
in the scene readout. With one of those themes active, click or tap the terrain
without dragging to move the vortex target; the funnel eases toward the selected
point.

## Install

For development from the repository:

```sh
git clone https://github.com/rand-monster/three-windline.git
cd three-windline
npm ci
npm run build:lib
```

Then install the built checkout and the matching Three.js version in your app:

```sh
npm install three@0.185.1 /absolute/path/to/three-windline
```

After an npm release is announced, the intended registry command is:

```sh
npm install three@0.185.1 three-windline
```

## Minimal Example

```ts
import * as THREE from 'three/webgpu'
import {
  CoherentWindField,
  createWindLineSystem,
} from 'three-windline'

const renderer = new THREE.WebGPURenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)
await renderer.init()

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x172b35)

const camera = new THREE.PerspectiveCamera(
  50,
  innerWidth / innerHeight,
  0.1,
  300,
)
camera.position.set(0, 10, 30)
camera.lookAt(0, 6, 0)

const field = new CoherentWindField({
  baseVelocity: [7, 0.2, 2],
  gustSpeed: 6,
  turbulence: 0.8,
})

const wind = createWindLineSystem({
  scene,
  field,
  curve: 'flow',
  capacity: 128,
  count: 96,
  seed: 42,
})

const anchor = new THREE.Vector3()
const clock = new THREE.Clock()
let timeSeconds = 0

renderer.setAnimationLoop(() => {
  const deltaSeconds = Math.min(clock.getDelta(), 0.1)
  timeSeconds += deltaSeconds

  wind.update({
    timeSeconds,
    deltaSeconds,
    anchor,
    camera,
  })

  renderer.render(scene, camera)
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
```

Keep `anchor` close to the player, vehicle, or camera focus. The deterministic
ribbon lattice wraps around this point, so the effect can cover a moving world
without streaming new instance data.

## Curve Programs

Choose the centerline function when constructing a system:

```ts
const rings = createWindLineSystem({
  scene,
  field,
  curve: 'ring',
  style: {
    length: 18,
    widthCssPixels: [1, 2],
  },
})
```

| Curve | Centerline |
| --- | --- |
| `flow` | Field streamline plus the authored horizontal/vertical wave. |
| `straight` | Field streamline only; no authored oscillation. |
| `arc` | Circular arc controlled by `curveSweepRadians`; the default is a semicircle. |
| `ring` | A closed `2π` circle whose radius is `length / 2π`. |
| `helix` | A head-anchored elliptical orbit controlled by `curveAmplitude` and `curveTurns`. |
| `spiral` | A helix whose radius grows from the head toward the tail. |

The curve is a construction-time shader program, not a per-frame branch.
A fixed `straight` system therefore does not compile or execute ring/helix
math. Numeric shape parameters remain uniforms and can be changed with
`setStyle()`. Recreate the system to change its curve program; this is an
intentional pipeline change, not a frame-time control.

Field transport is specialized separately at construction. The `affine`
program composes the curve with a sampled velocity and local Jacobian. The
`vortex` program instead evaluates the funnel centerline and exact tangent
analytically on the GPU and requires `curve: 'straight'`. Instance phase and
handedness come from deterministic, independent PCG lanes.

## Ribbon Modes

Choose the ribbon frame when constructing a system:

```ts
const vortexBody = createWindLineSystem({
  scene,
  field: new VortexWindField(),
  curve: 'straight',
  ribbonMode: 'radial',
  depthWrite: true,
  style: {
    widthWorldUnits: [0.08, 0.18],
    surfaceRoughness: 0.72,
    surfaceSpecular: 0.28,
    surfaceRim: 0.18,
    surfaceEmission: 0,
    surfaceLightDirection: [-0.42, 0.84, -0.34],
  },
})
```

| Mode | Behavior |
| --- | --- |
| `camera` | Default. Faces the active camera and uses `widthCssPixels`, keeping its apparent width stable across distance and device pixel ratio. |
| `radial` | Orients a vortex ribbon around the analytic funnel path and uses `widthWorldUnits`, so its apparent width changes with perspective. |

`ribbonMode` is a construction-time shader variant and is exposed as the
read-only `WindLineSystem.ribbonMode`. Recreate the system to change it.
`radial` is intentionally narrow: it is accepted only with a
`VortexWindField` and `curve: 'straight'`. Camera ribbons remain the default for
all existing configurations.

## Built-In Fields

Every field implements `WindField.sample(position, timeSeconds, out)` and may
expose a `program` marker. A missing marker resolves to `affine`, preserving the
custom-field contract from earlier versions. Built-in fields are exported from
both `three-windline` and `three-windline/fields`.

### Uniform

```ts
const field = new UniformWindField([8, 0.15, 2])
field.setVelocity([12, 0, -1])
```

Use `UniformWindField` for a single global wind vector.

### Affine

```ts
const field = new AffineWindField({
  origin: [0, 0, 0],
  velocity: [8, 0, 2],
  jacobian: new THREE.Matrix3().set(
    0, 0.22, 0,
    0, 0,    0,
    0, 0,    0,
  ),
  turbulence: 0.4,
})
```

`AffineWindField` represents a constant velocity plus a spatial gradient. It is
useful for canyon shear, updrafts, and authored local zones. Array-based
Jacobians follow `THREE.Matrix3.fromArray()` storage order; passing a
`THREE.Matrix3` is clearer when authoring derivatives.

### Coherent

```ts
const field = new CoherentWindField({
  baseVelocity: [10, 0, 3],
  gustSpeed: 9,
  turbulence: 1.1,
})

field.configure({ gustSpeed: 14 })
```

`CoherentWindField` adds deterministic, low-frequency gust and crosswind
variation. Its base sampling behavior is kept compatible with the corresponding
ROOTWALKER native wind fixture.

### Vortex

```ts
const field = new VortexWindField({
  center: [0, 0, 0],
  baseVelocity: [0.6, 0, 0.2],
  angularSpeed: 1.4,
  radialInflow: 0.25,
  lift: 5,
  turbulence: 1.8,
  softeningRadius: 8,
  envelope: {
    height: 28,
    radius: [0.8, 9],
    taperExponent: 0.72,
    shellBias: 0.76,
    coreRadiusRatio: 0.12,
    axisControl: [1.4, -0.7],
    axisTip: [-1, 1.1],
    axisWander: 0.8,
  },
})

const tornado = createWindLineSystem({
  scene,
  field,
  curve: 'straight',
})
```

`VortexWindField` is the reusable tornado primitive. Its softened core avoids a
singularity, while radial inflow and lift make the field readable as a volume
instead of a flat rotation. `center` is the base of the funnel; the envelope
extends upward from it.

| Envelope option | Default | Meaning |
| --- | --- | --- |
| `height` | `24` | Vertical extent above the funnel base. |
| `radius` | `[0.8, 8]` | Funnel radii at the base and top. |
| `taperExponent` | `0.72` | Shapes how the radius grows over the funnel height. |
| `shellBias` | `0.76` | Biases deterministic ribbon placement toward the outer shell. |
| `coreRadiusRatio` | `0.12` | Sets the inner-core radius as a fraction of the local funnel radius. |
| `axisControl` | `[1.4, -0.7]` | XZ offset of the quadratic axis control point, relative to the funnel base. |
| `axisTip` | `[-1, 1.1]` | XZ offset of the funnel axis at the top, relative to the funnel base. |
| `axisWander` | `0.8` | Non-negative amplitude of time-varying axis motion in world units. |

Passing this field to `createWindLineSystem({ field })` selects the exact
analytic `vortex` GPU program. It evaluates funnel positions and tangents per
vertex instead of extrapolating one anchor Jacobian. The specialized path still
uses one draw, performs zero dynamic instance uploads, and compiles for both
native WebGPU and the WebGL2 backend. Use `curve: 'straight'`; other curve
programs are rejected because the vortex program defines the complete
centerline.

All mutable built-in fields return `this` from `setVelocity()` or `configure()`
so runtime tuning can be chained.

## Runtime API

Create a system with `createWindLineSystem(options)`. The factory is the only
construction surface, so implementation details remain free to evolve.

Each system exposes:

| Member | Meaning |
| --- | --- |
| `mesh` | The generated `Mesh` for render-order or layer integration. |
| `curve` | Read-only compile-specialized curve program. |
| `program` | Read-only compile-specialized field program: `"affine"` or `"vortex"`. |
| `ribbonMode` | Read-only compile-specialized ribbon mode: `"camera"` or `"radial"`. |
| `capacity` | Read-only static instance capacity. |
| `count` | Read-only active instance count. |
| `setCount(count)` | Changes the draw range without reallocating seed buffers. |
| `setField(field)` | Replaces the wind source when its resolved program matches `program`. |
| `setStyle(partial)` | Validates and applies material/style uniforms. |
| `update(frame)` | Samples the field and updates frame uniforms. |
| `readStats(out)` | Fills caller-owned diagnostics without allocating. |
| `dispose()` | Removes the mesh and releases its GPU resources. |

### Construction Options

| Option | Default | Notes |
| --- | --- | --- |
| `scene` | none | Adds the mesh immediately when provided. Otherwise add `mesh` yourself. |
| `field` | `UniformWindField([5, 0, 1])` | Any `WindField`; its optional marker selects the GPU field program. |
| `capacity` | `96` | Fixed allocation, from 1 to 4,096 lines. |
| `count` | `min(42, capacity)` | Active instances, from 0 to `capacity`. |
| `segments` | `28` | Ribbon segments, from 4 to 128. |
| `seed` | `0` | Unsigned 32-bit deterministic seed. |
| `curve` | `"flow"` | Compile-specialized centerline program; the `vortex` field program requires `"straight"`. |
| `ribbonMode` | `"camera"` | `"camera"` uses CSS-pixel width; `"radial"` requires `VortexWindField` with `curve: "straight"` and uses world-unit width. |
| `style` | package defaults | Partial `WindLineStyle`. |
| `renderOrder` | `3` | Assigned to the generated mesh. |
| `depthTest` | `true` | Depth testing for the transparent material. |
| `depthWrite` | `false` | Whether the generated material writes depth; useful for opaque-looking radial vortex bodies, but may occlude later transparent draws. |
| `blending` | `"normal"` | `"normal"` or `"additive"`. |
| `name` | `"three-windline-field"` | Generated mesh name. |

Capacity, segment count, curve program, field program, and ribbon mode define
static GPU resources and must be chosen at construction. The field program is
inferred from `field`, so the public construction API remains
`createWindLineSystem({ field })`. `setCount()` only changes the instanced draw
range.

### Migrating From 0.1

Version 0.2 narrows construction to one public path:

```ts
// 0.1
const wind = new ThreeWindLineSystem(options)
scene.add(wind.object3d)

// 0.2
const wind = createWindLineSystem(options)
scene.add(wind.mesh)
```

`ThreeWindLineSystem` is now private implementation detail, and the duplicate
`object3d` alias was removed. Use `createWindLineSystem()` and `mesh`.

### Per-Frame Update

```ts
wind.update({
  timeSeconds,
  deltaSeconds,
  anchor: player.position,
  camera,
  observerVelocity: playerVelocity,
  forward: playerForward,
  active: true,
  intensity: 1,
})
```

| Frame value | Meaning |
| --- | --- |
| `timeSeconds` | Simulation time in seconds. Use a monotonic game clock. |
| `deltaSeconds` | Frame delta in seconds; the system clamps it to 0 through 0.25. |
| `anchor` | World-space center of the wrapping region for `affine`; ignored for vortex positioning, which uses `field.center`. |
| `camera` | Active camera used for billboarding and distance fading. |
| `observerVelocity` | Optional world velocity subtracted from the field. |
| `forward` | Optional world direction for the forward-biased region; defaults to camera forward on XZ. |
| `active` | Set `false` to fade the system to sleep. |
| `intensity` | Visibility multiplier, clamped from 0 through 8. |

`update()` returns `false` only after the system has been disposed.

### Runtime Controls

```ts
wind.setCount(160)
wind.setField(new CoherentWindField({
  baseVelocity: [9, 0.1, 2],
  gustSpeed: 7,
}))
wind.setStyle({
  length: 24,
  widthCssPixels: [1.1, 2.2],
  opacity: 0.46,
  colors: ['#fff1cf', '#a9fff1'],
  colorRandomness: 0.5,
  colorBanding: 0.7,
})

scene.remove(wind.mesh) // optional; dispose() also removes it
wind.dispose()
```

`setField()` permits runtime swaps only within the system's construction-time
program. Uniform, affine, coherent, and unmarked custom fields all resolve to
`affine` and can replace one another. Rebuild with
`createWindLineSystem({ field })` when changing between `affine` and `vortex`.
Changing `ribbonMode` or material depth state also requires rebuilding the
system; neither is a `setStyle()` control.

`dispose()` releases geometry and material resources and is idempotent. Runtime
mutators throw after disposal.

### Style

| Property | Default | Meaning |
| --- | --- | --- |
| `regionRadius` | `48` | Horizontal half extent of the wrapping lattice. |
| `verticalHalfSpan` | `8` | Vertical half extent. |
| `centerLift` | `5.5` | Vertical offset from the anchor. |
| `forwardBias` | `0.25` | Region offset along the supplied forward direction. |
| `length` | `15.5` | World-space ribbon length. |
| `widthCssPixels` | `[0.9, 1.7]` | Deterministic per-line width range in CSS pixels. |
| `widthWorldUnits` | `[0.08, 0.18]` | Deterministic per-line **total width** range for `radial` ribbons, in world units; these values are not half-widths. |
| `surfaceRoughness` | `0.72` | Radial-surface highlight spread, from 0 through 1. |
| `surfaceSpecular` | `0.28` | Radial-surface highlight strength, from 0 through 2. |
| `surfaceRim` | `0.18` | Radial-surface view-angle rim strength, from 0 through 2. |
| `surfaceEmission` | `0` | Radial-surface unlit contribution, from 0 through 2. |
| `surfaceLightDirection` | `[-0.42, 0.84, -0.34]` | Non-zero finite world-space direction for radial shading; the shader normalizes it. |
| `colors` | `[#fff7e8, #b8fff4]` | Per-line color endpoints. |
| `colorRandomness` | `0.32` | Stable seed-based random color mixed independently per instance. |
| `colorBanding` | `0` | Strength of deterministic endpoint grouping, from continuous interpolation at 0 to distinct palette bands at 1. |
| `opacity` | `0.38` | Global opacity multiplier. |
| `curveAmplitude` | `[2.4, 1.1]` | Horizontal/vertical wave or orbit radii, depending on the curve. |
| `curveFrequency` | `[0.19, 0.13]` | Horizontal/vertical frequencies used by `flow`. |
| `curveSweepRadians` | `π` | Sweep used by `arc`; `ring` always uses `2π`. |
| `curveTurns` | `1.5` | Turns used by `helix` and `spiral`. |
| `nearFade` | `[1.8, 5.5]` | Camera-distance fade-in range. |
| `farFade` | `[120, 190]` | Camera-distance fade-out range. |
| `lifetime` | `[2.6, 6]` | Deterministic line lifetime range in seconds. |
| `speed` | `[4, 28]` | Minimum and maximum advection speed. |
| `fieldSpeedMultiplier` | `1.8` | Maps sampled wind speed to line speed. |
| `visibilityResponse` | `6` | Exponential fade response; `0` is immediate. |
| `visibilityThreshold` | `[0.05, 1]` | Field signal range that wakes the effect. |

The `surface*` controls provide lightweight, physically-inspired shading for
`radial` ribbons using an internal directional-light approximation,
view-dependent highlights, rim response, and emission.
`surfaceLightDirection` must contain three finite values and have non-zero
length; its magnitude has no effect because the shader normalizes it. These
controls do not consume Three.js scene lights, shadows, environment maps, or
material IBL and should not be treated as a complete scene-light PBR material.

Invalid ranges and non-finite configuration fail early with `RangeError`.

### Statistics

`readStats(out)` mutates and returns a caller-owned `WindLineStats` object. It
reports capacity, active count, triangle count, sampled field strength,
visibility, and lifecycle state without allocating a new object. In the normal
visible state:

- `drawCalls` is `1`.
- `triangles` is `count * segments * 2`.
- `seedBytes` is `capacity * 20`.
- `dynamicInstanceUploads` is `0`.

## Custom Wind Fields

Custom fields must mutate the supplied target instead of replacing its
`velocity` or `jacobian` objects:

```ts
import type { WindField, WindSampleTarget } from 'three-windline'
import type { Vector3 } from 'three'

class HeightShearField implements WindField {
  readonly program = 'affine' as const

  sample(position: Vector3, timeSeconds: number, out: WindSampleTarget): void {
    const pulse = Math.sin(timeSeconds * 0.4) * 0.8
    out.velocity.set(7 + position.y * 0.25 + pulse, 0.1, 2)
    out.jacobian.set(
      0, 0.25, 0,
      0, 0,    0,
      0, 0,    0,
    )
    out.turbulence = 0.5
  }
}
```

The Jacobian must satisfy:

```text
field(position + offset) ~= velocity + jacobian * offset
```

This contract drives the `affine` GPU program: the system samples the field once
at the frame anchor, then applies the local approximation to ribbon origins.
The explicit marker in the example is optional because unmarked fields also
resolve to `affine`.

Keep `sample()` allocation-free. `VortexWindField` still implements the sampling
contract for diagnostics and CPU consumers, but its `vortex` GPU program does
not use the anchor Jacobian to shape rendered ribbons.

## Rendering And Performance

This package intentionally does **not** use a compute shader:

1. Construction uploads one float `vec4` seed and one normalized byte `vec4`
   trait per capacity slot.
2. Each frame samples the wind field on the CPU for visibility and diagnostics.
3. The frame updates a small set of material uniforms, including the selected
   field program's parameters.
4. Curve-, field-, and ribbon-mode-specialized TSL vertex logic wraps, advects,
   and shapes every ribbon. Camera ribbons billboard; radial ribbons use the
   vortex path's analytic tangent and radial frame. Fragment work is limited to
   edge coverage and compositing.
5. One `InstancedBufferGeometry` draw emits the complete field.

For this analytic effect, a compute pass would add dispatch and synchronization
cost without removing a required render pass. Compute becomes useful when wind
state must be integrated, collided, or shared with other GPU simulations; that
is outside this package's scope.

Practical tuning order:

1. Reduce `count` for direct vertex-cost savings.
2. Reduce `segments` if long curves remain visually smooth.
3. Keep `capacity` close to the largest count needed by the scene.
4. Prefer `setCount()` and `setStyle()` over rebuilding systems; rebuild when
   selecting a different curve, field program, ribbon mode, or depth state.
5. Reuse frame vectors and field objects.

The generated mesh disables Three.js frustum culling because its vertices are
procedurally displaced around a moving anchor. Use `active: false` or
`setCount(0)` when a system is not needed.

## Renderer Compatibility

| Renderer | Support |
| --- | --- |
| `WebGPURenderer` with native WebGPU | Supported |
| `WebGPURenderer({ forceWebGL: true })` using WebGL2 | Supported |
| Classic `WebGLRenderer` | Not supported |

The classic renderer cannot compile the package's `MeshBasicNodeMaterial` and
TSL node graph. Use the WebGL2 backend through `WebGPURenderer` when native
WebGPU is not the desired backend:

```ts
const renderer = new THREE.WebGPURenderer({
  antialias: true,
  forceWebGL: true,
})
await renderer.init()
```

Both backends compile the `affine` and exact analytic `vortex` field programs.

The peer dependency is deliberately narrow:

```text
three >=0.185.1 <0.186.0
```

TSL and WebGPU APIs can change between Three.js revisions, so upgrade the peer
range only after testing both backends.

## Source And Scope

The initial ribbon behavior was extracted from the ROOTWALKER rendering code
and generalized into a standalone package by
[rand.monster](https://rand.monster). Deterministic hash and coherent-wind
fixtures keep relevant behavior aligned with the native Rust/wgpu project.

This repository contains no ROOTWALKER game assets, gameplay authority, weather
state management, physics, or damage logic. `three-windline` is a presentation
component that consumes a wind field supplied by the host application. See
[NOTICE.md](./NOTICE.md) for the attribution statement.

## Development

Requires Node.js 20.19 or newer.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run check
```

The demo dev server defaults to `http://127.0.0.1:4192`. With it running,
browser verification can be executed separately:

```sh
npm run check:demo
```

Deployment is configured for Cloudflare Workers and the
`windline.rand.monster` custom domain:

```sh
npm run deploy
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting a change and
[SECURITY.md](./SECURITY.md) for private vulnerability reporting.

## License

MIT. See [LICENSE](./LICENSE).
