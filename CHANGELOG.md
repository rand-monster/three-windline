# Changelog

## 0.3.8 - 2026-07-26

### Fixed

- Makes the documented one-draw wind-line contract true at the renderer
  backend by forcing transparent double-sided ribbons through a single pass.
  This removes one redundant draw submission per visible wind-line system.
- Extends the real-browser WebGPU and WebGL2 checks to compare the public
  `drawCalls` statistic against calls observed at the renderer backend.

## 0.3.7 - 2026-07-26

### Changed

- Extracts the demo-only Hurricane debris generator from the world assembly
  into a focused module without changing its rendering, simulation, or
  performance contract.
- Documents the repository layout and explicitly identifies the public source
  for the library, demo, browser worker, tests, and verification tooling.

## 0.3.6 - 2026-07-26

### Changed

- Expands Hurricane from an 18.6-meter crown radius to 64 meters and raises
  its envelope to 84 meters, with 1,536 shell ribbons, 576 radial body ribbons,
  farther camera fades, and a dedicated disaster-scale composition.
- Adds 5,248 solid GPU-instanced airborne objects across light paper and leaf
  fragments, tumbling wood and metal pieces, and heavy rock ejecta. All lift,
  orbit, flutter, tumble, and lifecycle motion remains vertex-driven with no
  per-frame instance uploads.
- Widens the terrain vegetation coverage, gives Hurricane a stronger grass
  pressure response, limits targets to the available world, and extends its
  fog, lighting, and shadow footprint.

## 0.3.5 - 2026-07-25

### Changed

- Lifts Water Vortex from deep cobalt into a brighter lake-blue and sky-blue
  palette across its ribbons, body, fog, contact light, debris, and ground
  rings while preserving the distinct white-and-blue grouping.
- Fixes the demo telemetry to report actual per-frame draw commands instead of
  an averaged render-pass count, and exposes render passes separately in the
  automation snapshot.
- Replaces Storm Front with a giant Hurricane presentation while retaining the
  existing `storm` preset ID: the new look uses the analytic vortex program,
  a 46-meter asymmetric envelope, denser funnel geometry, supercell lighting,
  and a dedicated wide camera composition.

## 0.3.4 - 2026-07-25

### Changed

- Adds a unified TSL `RenderPipeline` bloom pass for WebGPU and the WebGL2
  fallback, rendered at `0.4x` resolution with preset-specific strength,
  radius, threshold, and tone-mapping exposure.
- Recolors Water Vortex as distinct white and clear-blue ribbon groups, with
  pale-blue fog, contact light, ground rings, and restrained bloom.
- Reworks Fire Vortex around the supplied fire-tornado reference: dark inner
  bands, HDR orange body ribbons, white-hot accent trails, brighter embers,
  local fire lighting, and a strong orange bloom halo.
- Adds opt-in `colorBanding` and enables it for the Water and Fire presets so
  authored palette endpoints remain readable; the default `0` preserves
  existing continuous color interpolation.
- Extends the browser smoke test to verify every preset's post-processing look
  and the WebGPU high-pass, blur, and composite bloom shaders.

## 0.3.3 - 2026-07-25

### Changed

- Triples Twister angular transport from `7.2 * speed + gust * 0.08` to
  `21.6 * speed + gust * 0.24`, producing roughly one visible rotation every
  `0.16-0.38` seconds depending on radial layer, preset, and instance.
- Keeps the animated funnel-axis rate capped independently so the faster
  circulation remains readable without turning silhouette motion into jitter.
- Scales lift and radial contraction by `6x`, roughly doubling the nominal
  helical pitch so broad diagonal ribbons remain dominant at the new `3x`
  circulation speed instead of flattening into horizontal rings.
- Normalizes signed position seeds before applying the new radius and orbital
  variation ranges, keeping those random factors inside their documented
  bounds.

## 0.3.2 - 2026-07-25

### Changed

- Ties vortex silhouette speed to `angularSpeed`, so runtime speed changes now
  accelerate both ribbon transport and the animated funnel axis.
- Increases the axis phase separation from base to crown and adds a secondary
  Z harmonic, producing faster multi-stage S-shaped deformation instead of a
  slowly drifting centerline.
- Raises the demo's angular transport to roughly one visible rotation every
  `0.5-1.1` seconds depending on radial layer, preset, and instance, and lifts
  the animated-axis speed ceiling without adding camera motion.
- Widens deterministic per-instance variation across orbital speed, radius,
  height, phase, length, and local flutter, keeping the funnel readable while
  breaking up synchronized windline bands with no dynamic CPU uploads.
- Replaces click-target interpolation with acceleration-limited arrival
  steering, curved redirection, braking-distance deceleration, and a
  velocity-driven crown lean that trails the moving funnel and settles at rest.
- Adds a terrain-conforming RTS target reticle with a command pulse and a
  quieter arrival contraction, and groups Wind, Water, and Fire inside one
  Twister dropdown.
- Drives the wind vane from a live per-frame sample of the active `WindField`,
  with shortest-arc damping and a calm threshold instead of preset directions.

## 0.3.1 - 2026-07-25

### Changed

- Vortex targets now travel across the terrain at a bounded `6.5 m/s` with a
  smooth final approach instead of rapidly interpolating most of the distance.
  The GPU grass response follows the moving vortex center.
- Increased vortex angular transport, vertical lift, and the three animated
  axis-wander frequencies so the funnel twists quickly while its world-space
  target moves slowly.
- Raised the 36k-blade instanced grass field and added per-blade world roots,
  so vegetation bends and trembles locally around the moving vortex instead
  of reacting as one sheet.
- Added terrain pressure rings, a local contact light, and single-draw
  instanced debris for clearer Wind, Water, and Fire impact without camera
  shake.
- Removed Canyon Shear from the focused demo navigation. `AffineWindField` and
  all six public curve programs remain part of the package.

## 0.3.0 - 2026-07-25

### Added

- Construction-time `affine` and exact analytic `vortex` GPU field programs,
  selected by the field passed to `createWindLineSystem({ field })`.
- An optional `WindField.program` marker and read-only
  `WindLineSystem.program`, with `"affine"` and `"vortex"` as the supported
  programs. Unmarked custom fields resolve to `affine`.
- `VortexWindField` envelope controls for `height`, base/top `radius`,
  `taperExponent`, `shellBias`, `coreRadiusRatio`, XZ `axisControl` and
  `axisTip` offsets, and animated `axisWander`. Its `center` is the funnel base.
- Construction-time `ribbonMode` variants: the default `"camera"` mode keeps
  CSS-pixel width, while `"radial"` orients ribbons around the analytic vortex
  path and uses world-space width. `WindLineSystem.ribbonMode` and
  `WIND_LINE_RIBBON_MODES` expose the selected mode and supported values.
  `"radial"` is accepted only with `VortexWindField` and
  `curve: "straight"`.
- `widthWorldUnits`, whose pair specifies the minimum and maximum **total**
  ribbon width in world units rather than half-width.
- `surfaceRoughness`, `surfaceSpecular`, `surfaceRim`, `surfaceEmission`, and
  `surfaceLightDirection` for lightweight, physically-inspired radial-surface
  shading. The light direction defaults to `[-0.42, 0.84, -0.34]`, must be a
  non-zero finite vector, and is normalized in the shader. These controls use
  an internal lighting approximation; they are not full scene-light PBR and do
  not integrate Three.js lights, shadows, environment maps, or material IBL.
- The `depthWrite` construction option, defaulting to `false`.

### Changed

- Vortex ribbons now evaluate the funnel centerline and exact tangent
  analytically in the vertex shader instead of extrapolating one anchor
  Jacobian. The path remains one draw with zero dynamic instance uploads on
  native WebGPU and the WebGL2 backend.
- `VortexWindField.center` now positions the funnel base; `frame.anchor` is
  ignored for vortex positioning.
- The demo now includes three radial vortex themes: Wind/Tornado, Water Vortex,
  and Fire Vortex. Clicking or tapping the terrain without dragging retargets
  the active vortex, which moves smoothly to the selected point.

### Breaking

- `setField()` now accepts only fields whose resolved program matches the
  system's construction-time `program`. Rebuild with
  `createWindLineSystem({ field })` to change between `affine` and `vortex`;
  same-program field swaps remain runtime controls.
- The `vortex` field program requires `curve: "straight"` because it defines the
  complete centerline.

## 0.2.0 - 2026-07-25

### Added

- Compile-specialized `flow`, `straight`, `arc`, `ring`, `helix`, and `spiral`
  curve programs.
- Deterministic per-instance color variation and runtime curve controls in the
  demo.
- Native WebGPU and WebGL2 shader compilation checks for every curve family.

### Changed

- Replaced finite-difference coherent and vortex sampling with exact analytic
  Jacobians.
- Kept centerline, color, and fade work in the vertex stage; the fragment stage
  now handles ribbon coverage and compositing only.
- Compressed static trait storage from four `Float32` lanes to normalized
  `Uint8` lanes.
- Tightened public option and built-in field validation.

### Breaking

- Removed the public `ThreeWindLineSystem` constructor. Use
  `createWindLineSystem(options)`.
- Removed the duplicate `object3d` member. Use `mesh`.

The package remains pre-release and is not claimed as published to npm.
