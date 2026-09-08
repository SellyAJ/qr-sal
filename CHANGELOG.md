# Changelog

## 0.1.1 — 2026-09-09

- Reuse grayscale and bounded standard threshold images within a scan; invert existing threshold bits for inverted retries. Reuse column bounds and avoid variance work in mean-only thresholding.
- Keep detection, recovery and payload-validation rules unchanged. Preserve every saved result on the 487-scene and 4,593-crop development collections.
- Record a modest 5.3% time reduction on a preselected 23-input, three-repeat paired timing comparison. Document the fresh 70-image OpenCV evaluation and its remaining unread images.
- Add 144 independent threshold comparisons, a cross-scan isolation check, a repeatable performance-comparison script and package/engine version consistency checks.
- Include initial grayscale conversion in elapsed time for scans that finish after the first pass.

See [the performance methodology and evidence](docs/PERFORMANCE.md). No API change or new runtime dependency. v0.1.0 remains available as the frozen baseline.

## 0.1.0 — 2026-09-08

Initial standalone library and browser demo, with image/PDF support, multiple-code detection, recovery, opt-in diagnostics, typed ESM/CommonJS APIs, local processing and documented benchmark boundaries.
