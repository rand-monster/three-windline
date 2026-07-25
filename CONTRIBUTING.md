# Contributing

Thanks for helping improve `three-windline`. Changes should preserve the small,
predictable runtime contract: one instanced wind-ribbon draw, static seed
buffers, and no per-frame instance uploads.

## Prerequisites

- Node.js 20.19 or newer
- npm
- A current desktop browser for the interactive demo
- A WebGPU-capable browser and adapter for native WebGPU verification

The WebGL2 fallback is provided by `WebGPURenderer({ forceWebGL: true })`.
Classic `WebGLRenderer` is outside the supported surface.

## Setup

```sh
git clone https://github.com/rand-monster/three-windline.git
cd three-windline
npm ci
npm run dev
```

The Vite server defaults to `http://127.0.0.1:4192`.

## Required Checks

Run the complete local gate before opening a pull request:

```sh
npm run check
```

This runs strict TypeScript checking, Node contract tests, library and demo
builds, and `npm pack --dry-run`.

For renderer or demo changes, keep the dev server running in one terminal and
run the browser check in another:

```sh
npm run dev
npm run check:demo
```

The browser check exercises native WebGPU and the `WebGPURenderer` WebGL2
fallback, watches for GPU validation errors, and checks rendered pixels.

## Design Constraints

Changes to the core should retain these properties unless a proposal explicitly
justifies a contract change:

- One draw call per visible `ThreeWindLineSystem`.
- `InstancedBufferGeometry`, without an unused `instanceMatrix`.
- Static `aWindSeed` and `aWindTrait` buffers after construction.
- No dynamic per-instance uploads in `update()`.
- No compute pass for the analytic ribbon path.
- Caller-owned targets for field samples and statistics.
- Deterministic output for the same seed and frame inputs.
- Camera-stable CSS-pixel width and edge anti-aliasing.
- Compatibility with Three.js r185.1 on both supported backends.

The system samples a `WindField` once at the anchor and sends velocity,
Jacobian, and turbulence uniforms to the vertex graph. A custom field should
mutate the supplied `WindSampleTarget`, avoid allocations, and provide a
Jacobian where:

```text
field(position + offset) ~= velocity + jacobian * offset
```

If a feature needs persistent GPU state, collisions, or a compute dispatch,
keep it separate from the current analytic path and document the additional
cost and synchronization model.

## Code Style

- Use TypeScript with strict types.
- Use two spaces, single quotes, and no semicolons, matching the repository.
- Keep public exports intentional and add their declarations to the package
  entry points.
- Validate public numeric ranges at the boundary.
- Avoid hidden wall-clock reads; callers own simulation time.
- Reuse scratch vectors, matrices, and output objects in frame loops.
- Add comments only when they explain a non-obvious invariant.

## Tests

Add or update focused tests when changing:

- seed generation or deterministic fixtures;
- option validation and public limits;
- geometry layout, draw count, or buffer update behavior;
- built-in field sampling;
- disposal and lifecycle behavior;
- WebGPU or WebGL2 shader behavior.

Do not update a deterministic fixture just to make a failing change pass.
Explain intentional behavior changes and review the expected values first.

## Pull Requests

Keep each pull request focused. Include:

- the behavior being changed and why;
- public API or compatibility impact;
- performance impact, especially draw calls and GPU uploads;
- tests run;
- screenshots for visible demo or material changes.

Avoid mixing file moves, algorithm changes, and visual tuning when they can be
reviewed independently.

## Releases

Publishing npm packages and deploying `windline.rand.monster` are maintainer
operations. Do not describe unreleased code as available from npm.
