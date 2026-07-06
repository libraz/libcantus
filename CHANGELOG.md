# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-07-07

Initial public release.

### Added

- Pure-TypeScript music-theory core: pitch, interval, scale, and tuning primitives.
- Chord and key recognition, functional harmony analysis, and pitch spelling.
- Composition modules: motif, rhythm, meter, progression, voicing, and chord-scale with modal interchange.
- Arrangement, reharmony, and chord-symbol modules.
- Fluent immutable class API (`Note`, `Chord`, `Key`, ...) layered over the tree-shakeable functional core.
- Dual ESM/CJS builds with bundled type declarations.

[Unreleased]: https://github.com/libraz/libcantus/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/libraz/libcantus/releases/tag/v0.9.0
