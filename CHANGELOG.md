# Changelog

All notable changes to `@zakkster/lite-signal-dom` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-03

Correctness + dependency-contract release. `keyed()` is fixed on modern
lite-signal, `@zakkster/lite-signal` becomes a peer dependency, and the release
furniture (VERSION, changelog, install-shape gate) lands.

### Fixed

- **`keyed()` no longer freezes surviving rows on modern lite-signal (SD-05).**
  lite-signal >= 1.2.0 auto-disposes a nested effect when its owner re-runs. The
  reconciler creates each row's bindings while the list `effect` is running, so on
  any list change every surviving (moved/untouched) row's fine-grained bindings
  were cascade-disposed and never recreated -- the row silently stopped updating.
  Reproduced from lite-signal 1.2.0 onward; only visible when a row's own signal
  changes *after* a list change, so most real keyed usage was affected. Rows are
  now created under a stable per-`keyed` ownership scope via lite-signal's
  `runWithOwner`, so they outlive list re-runs; `keyed`'s own sweep and teardown
  dispose them. Teardown also cascade-disposes any binding a throwing `renderFn`
  created partially, so no row effect can outlive the `keyed` instance.

### Changed

- **`@zakkster/lite-signal` is now a peer dependency, not a runtime dependency.**
  A signal graph is module-instance state: two copies of lite-signal are two
  graphs, and a signal from one does not drive an effect from the other. As a
  bundled dependency a consumer could silently receive a second, non-shared copy,
  freezing every binding with no error. It is declared a peer to guarantee one
  shared graph, and also listed under `devDependencies` so the suite and CI
  resolve.
- **Raised the lite-signal floor to `^1.5.0-rc.1`** (from the previous `^1.1.1`
  runtime dependency). The SD-05 fix uses `runWithOwner`, introduced in
  lite-signal 1.5.0. **Compatibility impact:** this package now requires
  lite-signal >= 1.5.0-rc.1; it will not run against older lite-signal. This is
  why the release is a minor, not a patch.

### Added

- **`VERSION`** - exported package-version string constant, kept in three-place
  sync with `package.json` and this changelog.
- **`CHANGELOG.md`** - now shipped in the published tarball (`files[]`).
- **Cross-graph install-shape test** - asserts an effect from this package reruns
  on a signal from the app's lite-signal on a deduped install, and fails on a
  deliberately duplicated two-copy tree, making the peer-dependency contract
  executable rather than assumed.
- **SD-05 regression suite** (`test/keyed-ownership.test.js`) - surviving-row
  liveness across reorders/append/removal and repeated churn, no-effect-leak
  under add/remove churn, full-teardown observer reclamation, and the
  throwing-`renderFn` teardown backstop.

## [1.0.1] - 2026-05-23

- Initial published release: eight `bind*` primitives plus the `keyed` list
  reconciler, Symbol-keyed disposables, and one document-level MutationObserver
  for automatic teardown. ~0 bytes allocated per update.
