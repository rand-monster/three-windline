# Changelog

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
