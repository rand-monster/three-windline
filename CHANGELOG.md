# Changelog

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
