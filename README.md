# three-windline

Deterministic, camera-stable GPU wind ribbons for Three.js.

[Live demo](https://windline.rand.monster) |
[GitHub](https://github.com/rand-monster/three-windline) |
[MIT license](./LICENSE)

`three-windline` turns a sampled wind field into anti-aliased, screen-space
ribbons. It targets Three.js r185 `WebGPURenderer` and uses one instanced draw
per wind-line system.

> **Pre-release:** the package metadata declares the name `three-windline`, but
> this repository does not claim that an npm release is available yet. Use a
> local checkout until the first registry release is announced.

The package is ESM-only. It does not expose a CommonJS `require()` entry.

## What It Provides

- One GPU draw for up to 4,096 deterministic ribbons.
- TSL vertex generation with native WebGPU and a WebGL2 backend option.
- Stable CSS-pixel ribbon width, derivative edge anti-aliasing, and camera
  near/far fades.
- Static per-instance seed buffers. Runtime updates change uniforms, not
  instance data.
- Compile-specialized `flow`, `straight`, `arc`, `ring`, `helix`, and `spiral`
  curve programs.
- Uniform, affine/shear, coherent gust, and softened vortex wind fields.
- Runtime density, field, and style changes without rebuilding geometry.
- An allocation-free field-sampling contract for custom simulation sources.

The [interactive demo](https://windline.rand.monster) includes Breeze, Canyon
Shear, Tornado, and Storm Front presets.

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

Every curve is composed with the sampled field and its local Jacobian. The
field moves and bends the centerline; the curve program defines the ribbon's
intrinsic shape. Instance phase and handedness come from deterministic,
independent PCG lanes.

## Built-In Fields

Every field implements `WindField.sample(position, timeSeconds, out)`.
They are exported from both `three-windline` and `three-windline/fields`.

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
})
```

`VortexWindField` is the reusable tornado primitive. Its softened core avoids a
singularity, while radial inflow and lift make the field readable as a volume
instead of a flat rotation.

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
| `capacity` | Read-only static instance capacity. |
| `count` | Read-only active instance count. |
| `setCount(count)` | Changes the draw range without reallocating seed buffers. |
| `setField(field)` | Replaces the sampled wind source. |
| `setStyle(partial)` | Validates and applies material/style uniforms. |
| `update(frame)` | Samples the field and updates frame uniforms. |
| `readStats(out)` | Fills caller-owned diagnostics without allocating. |
| `dispose()` | Removes the mesh and releases its GPU resources. |

### Construction Options

| Option | Default | Notes |
| --- | --- | --- |
| `scene` | none | Adds the mesh immediately when provided. Otherwise add `mesh` yourself. |
| `field` | `UniformWindField([5, 0, 1])` | Any object implementing `WindField`. |
| `capacity` | `96` | Fixed allocation, from 1 to 4,096 lines. |
| `count` | `min(42, capacity)` | Active instances, from 0 to `capacity`. |
| `segments` | `28` | Ribbon segments, from 4 to 128. |
| `seed` | `0` | Unsigned 32-bit deterministic seed. |
| `curve` | `"flow"` | Compile-specialized centerline program. |
| `style` | package defaults | Partial `WindLineStyle`. |
| `renderOrder` | `3` | Assigned to the generated mesh. |
| `depthTest` | `true` | Depth testing for the transparent material. |
| `blending` | `"normal"` | `"normal"` or `"additive"`. |
| `name` | `"three-windline-field"` | Generated mesh name. |

Capacity, segment count, and curve program define static GPU resources and must
be chosen at construction. `setCount()` only changes the instanced draw range.

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
| `anchor` | World-space center of the wrapping wind region. |
| `camera` | Active camera used for billboarding and distance fading. |
| `observerVelocity` | Optional world velocity subtracted from the field. |
| `forward` | Optional world direction for the forward-biased region; defaults to camera forward on XZ. |
| `active` | Set `false` to fade the system to sleep. |
| `intensity` | Visibility multiplier, clamped from 0 through 8. |

`update()` returns `false` only after the system has been disposed.

### Runtime Controls

```ts
wind.setCount(160)
wind.setField(new VortexWindField({ center: [0, 0, 0] }))
wind.setStyle({
  length: 24,
  widthCssPixels: [1.1, 2.2],
  opacity: 0.46,
  colors: ['#fff1cf', '#a9fff1'],
  colorRandomness: 0.5,
})

scene.remove(wind.mesh) // optional; dispose() also removes it
wind.dispose()
```

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
| `colors` | `[#fff7e8, #b8fff4]` | Per-line color endpoints. |
| `colorRandomness` | `0.32` | Stable seed-based random color mixed independently per instance. |
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

The system samples the field once at the frame anchor. The shader applies that
local affine approximation to every ribbon origin. This is why a nonlinear
field such as a vortex should provide a useful local Jacobian.

Keep `sample()` allocation-free. The built-in nonlinear fields evaluate
velocity and an analytic Jacobian together, without finite-difference resampling
or per-frame objects.

## Rendering And Performance

This package intentionally does **not** use a compute shader:

1. Construction uploads one float `vec4` seed and one normalized byte `vec4`
   trait per capacity slot.
2. Each frame samples the wind field once on the CPU.
3. The frame updates a small set of material uniforms.
4. A curve-specialized TSL vertex graph wraps, advects, shapes, and billboards
   every ribbon. Fragment work is limited to edge coverage and compositing.
5. One `InstancedBufferGeometry` draw emits the complete field.

For this analytic effect, a compute pass would add dispatch and synchronization
cost without removing a required render pass. Compute becomes useful when wind
state must be integrated, collided, or shared with other GPU simulations; that
is outside this package's scope.

Practical tuning order:

1. Reduce `count` for direct vertex-cost savings.
2. Reduce `segments` if long curves remain visually smooth.
3. Keep `capacity` close to the largest count needed by the scene.
4. Prefer `setCount()` and `setStyle()` over rebuilding systems; rebuild only
   when selecting a different curve program.
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
