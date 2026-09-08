// Infer a small separable blur kernel from known finder cells, then invert
// that same image-formation model over measured luminance. No payload prior.
export function deblurGrid(values, n, { deadline = Infinity } = {}) {
  const positions = [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ],
    samples = [];
  const expected = (x, y) => {
    const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
    return d === 3 || d <= 1 ? 1 : 0;
  };
  for (const [region, [sx, sy]] of positions.entries())
    for (let y = 1; y < 6; y++)
      for (let x = 1; x < 6; x++)
        samples.push({ region, x, y, value: values[(sy + y) * n + sx + x] });
  let best = null;
  for (const ax of [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24])
    for (const ay of [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24]) {
      if (performance.now() > deadline) return [];
      const fits = [];
      let error = 0,
        valid = true;
      for (let region = 0; region < 3; region++) {
        const rows = samples
          .filter((s) => s.region === region)
          .map((s) => {
            let prediction = 0;
            for (let y = -1; y <= 1; y++)
              for (let x = -1; x <= 1; x++)
                prediction +=
                  expected(s.x + x, s.y + y) *
                  (x ? ax : 1 - 2 * ax) *
                  (y ? ay : 1 - 2 * ay);
            return { prediction, value: s.value };
          });
        const meanX = rows.reduce((s, r) => s + r.prediction, 0) / rows.length,
          meanY = rows.reduce((s, r) => s + r.value, 0) / rows.length;
        const variance = rows.reduce(
          (s, r) => s + (r.prediction - meanX) ** 2,
          0,
        );
        if (variance < 1e-6) {
          valid = false;
          break;
        }
        const slope =
            rows.reduce(
              (s, r) => s + (r.prediction - meanX) * (r.value - meanY),
              0,
            ) / variance,
          intercept = meanY - slope * meanX;
        if (
          !Number.isFinite(slope) ||
          Math.abs(slope) < 5 ||
          Math.abs(slope) > 500
        ) {
          valid = false;
          break;
        }
        fits.push({ slope, intercept });
        error +=
          rows.reduce(
            (s, r) =>
              s + ((r.value - intercept - slope * r.prediction) / slope) ** 2,
            0,
          ) / rows.length;
      }
      if (
        !valid ||
        fits.some((f) => Math.sign(f.slope) !== Math.sign(fits[0].slope))
      )
        continue;
      error /= 3;
      if (!best || error < best.error) best = { ax, ay, error, fits };
    }
  if (!best || Math.max(best.ax, best.ay) < 0.08 || best.error > 0.06)
    return [];
  const observed = Float64Array.from(values, (v, i) => {
    const x = ((i % n) + 0.5 - 3.5) / (n - 7),
      y = (Math.floor(i / n) + 0.5 - 3.5) / (n - 7);
    const plane = (key) =>
      best.fits[0][key] +
      x * (best.fits[1][key] - best.fits[0][key]) +
      y * (best.fits[2][key] - best.fits[0][key]);
    const slope = plane('slope');
    return Math.abs(slope) < 3 ? NaN : (v - plane('intercept')) / slope;
  });
  if (observed.some((v) => !Number.isFinite(v))) return [];
  function inverse(source, alpha, vertical, ridge) {
    const result = new Float64Array(n * n),
      upper = new Float64Array(n),
      rhs = new Float64Array(n);
    for (let line = 0; line < n; line++) {
      if (performance.now() > deadline) return null;
      for (let i = 0; i < n; i++) {
        const denominator =
          1 - 2 * alpha + ridge - (i ? alpha * upper[i - 1] : 0);
        if (Math.abs(denominator) < 1e-5) return null;
        upper[i] = alpha / denominator;
        rhs[i] =
          (source[vertical ? i * n + line : line * n + i] -
            (i ? alpha * rhs[i - 1] : 0)) /
          denominator;
      }
      let next = 0;
      for (let i = n - 1; i >= 0; i--) {
        next = rhs[i] - (i < n - 1 ? upper[i] * next : 0);
        result[vertical ? i * n + line : line * n + i] = next;
      }
    }
    return result;
  }
  const trials = [];
  for (const ridge of [0.01, 0.04, 0.1]) {
    const horizontal = inverse(observed, best.ax, false, ridge);
    if (!horizontal) break;
    const restored = inverse(horizontal, best.ay, true, ridge);
    if (!restored) break;
    const normalized = Float64Array.from(restored, (v) => v * (1 + ridge) ** 2);
    const overshoot =
      normalized.filter((v) => v < -0.25 || v > 1.25).length / (n * n);
    if (overshoot > 0.35) continue;
    const grid = Uint8Array.from(normalized, (v) => (v >= 0.5 ? 1 : 0)),
      confidence = Float32Array.from(normalized, (v) =>
        Math.min(1, Math.abs(v - 0.5)),
      );
    const finderErrors = positions.map(([sx, sy]) => {
      let wrong = 0;
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++)
          wrong += grid[(sy + y) * n + sx + x] !== expected(x, y);
      return wrong;
    });
    trials.push({
      grid,
      confidence,
      trace: {
        mode: 'finder-fitted-deblur',
        kernelX: best.ax,
        kernelY: best.ay,
        fittedLuminance: best.fits,
        finderFitMeanSquaredError: best.error,
        ridge,
        overshootFraction: overshoot,
        finderErrors,
        shapeAccepted: finderErrors.every((e) => e <= 12),
        uncertaintyMeasure: 'Inverse-filter margin, not a probability',
      },
    });
  }
  return trials;
}
