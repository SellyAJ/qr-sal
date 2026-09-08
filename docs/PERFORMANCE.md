# Performance work and validation

## What changed

Version 0.1.1 optimizes pixel thresholding and reuses image calculations. It computes luminance once per scan, reuses column window bounds, skips variance calculations in mean-only thresholding, and reuses standard threshold images for repeated and inverted passes. Caching is bounded and scoped to one scan, including its original and reduced resolutions. It does not retain answers across documents.

Finder, geometry, format, Reed–Solomon and payload validation rules remain unchanged. Recovery is still bounded by time; hard inputs can consume the full budget. The demo still defaults to 12 seconds. This is not a claim of ZXing-like speed.

An initial CPU profile on ten development inputs identified thresholding as the largest sampled cost. Independent direct-window tests compare 144 threshold outputs, including image borders, uniform images, varying contrast radii and inverted polarity. Public API tests also check that reuse cannot carry an answer into another scan or retain stale caller pixels.

## Paired timing: a modest improvement

On 23 preselected development inputs, the sum of per-image median times fell from **23,776.64 ms to 22,521.10 ms: 5.3% less decoding time**. The median per-image reduction was 6.1%. Both versions produced identical location/text pairs in all three repetitions. None of these timed trials reached its deadline.

Selection was fixed before candidate timing: the first up to two images per category in the original BoofCV manifest whose historical baseline completed without timeout in under three seconds. The run used Node 25.9.0 on Windows, an Intel i9-13900HX, one sequential process, one warmup per version per input, three measured trials in alternating version order, multiple-code mode and the same 35-second budget. Other corpus workers had finished before this measurement.

This is a fast/completed development subset, **not a whole-corpus speedup or a guarantee on other hardware**. Full recovery can still take tens of seconds. Detailed input identities, timings and counts are in [performance-evidence.json](performance-evidence.json).

## Full development regression

All 487 BoofCV images were re-run through the extracted candidate. All **1,161 saved location/text pairs** were preserved, including 26 decoding controls, with no additional outputs. Annotation scoring remained **1,135 / 1,148 distinct physical regions**; 13 regions remain unread. There were 131 deadline flags. This preservation run used four concurrent workers and is not the isolated timing comparison above.

All **4,593 scanned crops** were also re-run, preserving every saved location/text pair with no additional outputs or deadline flags. These are the existing development collections, not new held-out samples. The baseline copy was verified against the actual v0.1.0 tag before release.

## Fresh OpenCV evaluation

Seventy images were downloaded from the [OpenCV extra test repository](https://github.com/opencv/opencv_extra/tree/3f08649781aed06f1a1aa22f0472db5ad09d2d0d/testdata/cv/qrcode). Encoded-generation fixtures were excluded. No exact source-file or rendered-pixel hashes matched the previous BoofCV or scanned-crop manifests. This establishes exact-deduplication against those collections, not independence of every photographed scene.

Both v0.1.0 and the candidate decoded 115 results across 66 of the 70 images. All baseline location/text pairs were preserved. There were no text conflicts in 102 results geometrically paired with ZXing-C++ 3.0.0. All 85 available annotated regions matched their literal expected text. The other outputs do not have complete publisher text ground truth, and agreement does not establish universal correctness.

The four images with no result in either QR Sal version were `flipped/flipped_1.png`, `flipped/flipped_2.png`, `issue_22892.png`, and `issue_3478.png`. They remain failures in the 70-image denominator. No decoder tuning was done against this new set.

The readers received identical original-resolution grayscale pixels and no annotations. QR Sal used multiple-code mode with a 35-second budget. Evaluation used one-to-one polygon IoU ≥ 0.10. The close-up and monitor annotations were transformed from the publisher's 1024-short-side resized coordinates back to the original dimensions, following [OpenCV's test code](https://github.com/opencv/opencv/blob/4.x/modules/objdetect/test/test_qrcode.cpp). That evaluation correction did not change a decoder output. Photographs and raw decoded text are not redistributed.

## Reproduce a paired timing check

Use `scripts/compare-performance.mjs` with trusted local checkouts of the two releases. Prepare a local JSON array containing `width`, `height`, and `bufferFile` for each image; a buffer has exactly one grayscale byte per pixel, and file paths resolve relative to the manifest. Render the same source pixels for both releases. Keep this manifest and the pixels private when they contain private documents.

```sh
node scripts/compare-performance.mjs inputs.json ../qr-sal-baseline/src/index.mjs src/index.mjs comparison.json
```

The tool warms both versions once per input and runs three measured trials in alternating order, sequentially. It rejects input mutation and output-file overwrite. Reports contain pixel hashes, sizes, times, timeout flags, counts and missing/additional location/text pair counts; they omit local paths and raw QR text. Matching uses exact text and the engine's stable `sameRegion` rule, one-to-one, preserving repeated payloads on separate symbols.

Run timing checks without competing benchmark workers. Report the input selection, hardware/runtime, warmups and repeated measurements. Keep deadline-clipped results separate from completed scans. Never present a development subset as a held-out accuracy estimate or use output count alone as proof of correct decoding.
