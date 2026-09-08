# How QR Sal works

The same pipeline runs in Node and the browser. There is no neural model, expected-answer lookup, document-specific extraction or network request inside the engine.

1. **Get the pixels.** Convert grayscale/RGBA to luminance, blending transparency onto white.
2. **Find plausible QR regions.** Global/local thresholds, normal/inverted polarity, finder run patterns, connected components and observations from multiple passes produce candidates.
3. **Measure geometry.** Group finder patterns, fit perspective, use QR timing/alignment structure, and refine candidate sampling. Local edge, curved-map and scanline recovery address particular distortions.
4. **Read a grid.** Sample dark/light modules; bounded variations in registration, local contrast and blur compensation offer additional source-derived candidates.
5. **Validate and decode.** Check format/version information, remove the QR mask, deinterleave blocks, run Reed–Solomon correction, and parse supported payload segments. Recovery-specific strict padding and capacity checks help reject unsupported repairs.
6. **Collect by physical region.** Keep separate codes even when their text matches. Record conflicting valid readings rather than silently choosing a convenient one.

The established pass runs first. If budget remains, enhanced recovery uses the image’s own results and measured structure. The decoder never takes a ground-truth text label or a benchmark annotation as an input.

Threshold calculations reuse column window bounds and avoid variance work in mean-only modes. A scan can reuse its three standard positive threshold images; inverted retries use exact bit inversion. Caches are local to the scan and capped at 24 MB per resolution, with caching disabled above that resolution's cap. Source and reduced-resolution caches may coexist. No decoded answer is cached across input images, and the same geometry, format and error-correction gates still run.

## Why diagnostics matter

Failure logs distinguish finder detection, grouping, sampling, format, error correction, and payload parsing. Bounded failed-grid samples preserve the evidence closest to a valid decode. This makes it possible to investigate whether a failure came from localization, warped sampling or insufficient information, instead of adding blind retries.

These are **observations about the algorithm**, not proof that a document is damaged or a QR is absent. Candidate finder patterns can be false positives. Logs are opt-in and may contain sensitive source fragments.

## Boundaries

Error correction reduces mistakes but cannot authenticate a code. A badly degraded candidate might, in principle, produce another valid message. Payload agreement between readers is useful evidence, not a proof of the physical author’s intent. QR Sal makes no zero-error or calibrated-confidence claim.

Recovery exchanges time for additional hypotheses. Budget checks are cooperative, not preemptive. On interactive pages, isolate the scanner in a worker and keep cancellation available. Expensive recovery can still reach the full time budget.
