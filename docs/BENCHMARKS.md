# Benchmark evidence

Measured 2026-09-08 on the frozen development engine underlying QR Sal 0.1.0. The public extraction preserves its 22 core modules apart from the version string; the new wrapper, packaging, synthetic fixtures and demo are separately verified. The full corpus was **not re-run after rebranding**. Public source fingerprints and sanitized per-image measurements are in [benchmark-evidence.json](benchmark-evidence.json).

## BoofCV mixed scenes

| Measure                                          | QR Sal underlying engine | ZXing-C++ 3.0.0 |
| ------------------------------------------------ | -----------------------: | --------------: |
| Images with a decoded result                     |                478 / 487 |       356 / 487 |
| Distinct annotated regions spatially matched     |            1,135 / 1,148 |     904 / 1,148 |
| Conflicting text on geometrically paired results |               0 observed |      0 observed |

**98.87% is spatial coverage on this corpus, not guaranteed payload accuracy.** There are 461 detection scenes and 26 separate decoding controls. Detection annotations contain corners, generally without authoritative text. Five exact duplicate quadrangles among 1,153 raw annotation rows were removed, preserving a 1,148-region denominator. Thirteen regions in eleven images remain unread; they are still included in the score.

Matching uses greedy one-to-one polygon intersection-over-union ≥ 0.10. EXIF orientation is applied to both pixels and annotation corners. This is a permissive localization criterion adapted from the [original BoofCV benchmark](https://boofcv.org/index.php?title=Performance:QrCode), not a strict corner-precision score or that publication’s category-weighted F-measure.

All 26 decoding controls produced matching text between readers: 17 match annotation text exactly, and 9 differ from their labels only in CRLF/LF or final-newline conventions. Those are recorded separately from literal matching. The larger photographed set has no universal author-verified text ground truth. Reader agreement supports validation but cannot establish zero errors.

### Compute and tuning

The QR Sal engine used the complete recovery pipeline, multiple-code mode and a **35,000 ms per-image budget**. Four concurrent partitions took 2,077.11 seconds wall time; summed per-image decoder time was 8,147.29 seconds. Median per-image time was 13,675.90 ms, p95 35,006.45 ms, with 131 time-limit flags, some on images that still yielded results.

ZXing-C++ used identical grayscale buffers with `QRCode`, rotation/downscale/inversion enabled, `LocalAverage` binarization, plain text mode, and invalid results excluded. No custom preprocessing retry pipeline was added. Its total decode time was 6.50 seconds, median 7.38 ms, p95 36.28 ms.

**The comparison uses unequal compute and QR Sal is much slower in this recovery configuration.** The engine’s timing was measured under concurrent load; this is not an isolated performance measurement. The demo defaults to a shorter 12-second budget, so it should not be expected to reproduce 35-second benchmark coverage.

The corpus was used repeatedly for tuning. These are development/regression results, not a held-out generalization estimate or evidence of universal superiority over other readers.

### Consistency checks

A repeat of 93 selected hard images preserved all 556 previously decoded location/text pairs with no recorded differences. Fifty-two repeat inputs reached their time limit. Sixty-four sampled grids representing cumulative recovered cases were decoded with independent QR/RS implementations. Shared sampling geometry makes this an independent decoding check, not independent localization. No universal correctness guarantee follows.

## Physically scanned QR crops

All **4,593 distinct scanned QR crops** from [Yasin Sancar’s QR Code Dataset V2](https://figshare.com/articles/dataset/QR_Code_Dataset_V2/28424213) decoded with exact payload agreement between readers. The frozen final-engine repeat retained all 4,593 payloads and had no time-limit flags.

Of the publisher’s CSV labels, 4,591 match literally; two labels contain rounded scientific notation, so they cannot supply exact original text. A third decoder agreed on the original pixels for those two cases. The labels were not silently rewritten. The crops are uniformly 220 × 220 pixels, not 4,593 full document pages. Large counts of similarly cropped inputs do not erase the harder scene failures.

## Reproduce or challenge the result

1. Obtain the [BoofCV QR Images V2 archive](https://boofcv.org/notwiki/regression/fiducial/qrcodes_v2.zip) from its publisher and extract it locally. The corpus is not redistributed by QR Sal.
2. Run `npm ci` to build QR Sal.
3. Install the benchmark-only dependencies and run:

```sh
python -m pip install Pillow==11.3.0 numpy==2.2.6 opencv-python-headless==4.12.0.88 zxing-cpp==3.0.0
python scripts/benchmark.py /path/to/qrcodes --output benchmark-results.json
```

The directory must contain `detection/` and `decoding/`. Use `--limit 5` for a smoke test, clearly labelled partial, or `--time-limit-ms 12000` to compare another budget. The harness reads source pixels independently of annotations, uses the public API, and emits counts, timings, image hashes and matching status without raw decoded payloads. It runs sequentially, unlike the recorded four-partition engine run, so budget-sensitive results and timing can differ. Keep reports local and inspect before publishing.

For the 4,593-crop set, obtain the `Unreadable Scanned QR Codes` subset from the publisher’s archive, excluding learning and simulated images; compare full returned text with `Data.csv`, retaining the two known label issues. The provided BoofCV harness is not a parser for that separate CSV.

Synthetic regression tests are independently encoded by Python qrcode 8.2. They cover the package itself without depending on downloaded images. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Sources and rights

- Peter Abeles, [Study of QR Code Scanning Performance in Different Environments, V3](https://boofcv.org/index.php?title=Performance:QrCode); [original image archive](https://boofcv.org/notwiki/regression/fiducial/qrcodes_v2.zip). Our measurements are separate from that publication’s historical results.
- Yasin Sancar, [QR Code Dataset V2](https://figshare.com/articles/dataset/QR_Code_Dataset_V2/28424213), CC BY 4.0. No corpus photographs are shipped here.
- [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp), version 3.0.0 comparison reader; not a QR Sal runtime dependency.

The repository includes only synthetic visual examples, source code and sanitized measurement metadata. It does not include private documents or original decoded business records.
