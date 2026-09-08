import { deblurGrid } from './grid-deblur.mjs';
import { bilinear } from './preprocess.mjs';
// Local photometry of a candidate QR, using original grayscale pixels. The
// known finder cells choose polarity/threshold; payload cells are never supplied.
export function grayGridTrials(
  gray,
  w,
  h,
  map,
  n,
  { deadline = Infinity, offset = { x: 0, y: 0 }, deblur = false } = {},
) {
  const values = new Float64Array(n * n),
    knownDark = [],
    knownLight = [],
    hist = new Uint32Array(256),
    regions = Array.from({ length: 3 }, () => ({ dark: [], light: [] }));
  for (let y = 0; y < n; y++) {
    if (performance.now() > deadline) return [];
    for (let x = 0; x < n; x++) {
      let sum = 0;
      for (const [ox, oy] of [
        [0, 0],
        [-0.16, -0.16],
        [0.16, -0.16],
        [-0.16, 0.16],
        [0.16, 0.16],
      ]) {
        const p = map(x + 0.5 + ox + offset.x, y + 0.5 + oy + offset.y),
          xx = Math.floor(p.x),
          yy = Math.floor(p.y);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !Number.isFinite(xx + yy))
          return [];
        sum += bilinear(gray, w, h, p.x, p.y);
      }
      const value = sum / 5;
      values[y * n + x] = value;
      hist[Math.round(value)]++;
      for (const [i, [sx, sy]] of [
        [0, 0],
        [n - 7, 0],
        [0, n - 7],
      ].entries()) {
        const xx = x - sx,
          yy = y - sy;
        if (xx >= 0 && yy >= 0 && xx < 7 && yy < 7) {
          const d = Math.max(Math.abs(xx - 3), Math.abs(yy - 3));
          (d === 3 || d <= 1 ? knownDark : knownLight).push(value);
          (d === 3 || d <= 1 ? regions[i].dark : regions[i].light).push(value);
        }
      }
    }
  }
  const median = (a) => a.sort((a, b) => a - b)[a.length >> 1];
  const dark = median(knownDark),
    light = median(knownLight),
    contrast = Math.abs(light - dark);
  if (contrast < 1) return [];
  const invert = dark > light;
  const total = values.length,
    mean = values.reduce((a, b) => a + b, 0);
  let weight = 0,
    sum = 0,
    best = -1,
    otsu = (dark + light) / 2;
  for (let t = 0; t < 255; t++) {
    weight += hist[t];
    sum += hist[t] * t;
    if (!weight || weight === total) continue;
    const difference = sum / weight - (mean - sum) / (total - weight),
      score = weight * (total - weight) * difference * difference;
    if (score > best) {
      best = score;
      otsu = t;
    }
  }
  const thresholds = [
    otsu,
    (dark + light) / 2,
    (dark + light) / 2 - contrast * 0.12,
    (dark + light) / 2 + contrast * 0.12,
  ];
  const controls = regions.map((r) => ({
    dark: median(r.dark),
    light: median(r.light),
  }));
  const options = thresholds
    .filter((t, i) => thresholds.findIndex((q) => Math.abs(t - q) < 0.25) === i)
    .map((threshold) => ({ threshold }));
  options.push({ mode: 'finder-lighting-plane' });
  // Estimate slowly varying illumination in module units. A fixed pixel
  // window behaves differently for a close-up and a tiny distant QR.
  const integral = new Float64Array((n + 1) ** 2);
  for (let y = 0; y < n; y++) {
    let rowSum = 0;
    for (let x = 0; x < n; x++) {
      rowSum += values[y * n + x];
      integral[(y + 1) * (n + 1) + x + 1] =
        integral[y * (n + 1) + x + 1] + rowSum;
    }
  }
  for (const radius of [3, 5])
    options.push({ mode: 'module-local-mean', radius });
  // Blur mixes a cell with its neighbours. Bounded unsharp trials undo some
  // of that mixing in measured luminance, before deciding black/white. They
  // neither fill missing cells nor relax any matrix/error-correction checks.
  for (const amount of [0.5, 1])
    options.push({
      mode: 'module-unsharp',
      amount,
      threshold: (dark + light) / 2,
    });
  const trials = options.map((option) => {
    const confidence = new Float32Array(n * n);
    let changedModules = 0,
      nearThresholdModules = 0;
    const grid = Uint8Array.from(values, (v, i) => {
      const original = v;
      if (option.mode === 'module-unsharp') {
        const xx = i % n,
          yy = Math.floor(i / n),
          neighbours =
            (values[yy * n + Math.max(0, xx - 1)] +
              values[yy * n + Math.min(n - 1, xx + 1)] +
              values[Math.max(0, yy - 1) * n + xx] +
              values[Math.min(n - 1, yy + 1) * n + xx]) /
            4;
        v += option.amount * (v - neighbours);
      }
      const x = ((i % n) + 0.5 - 3.5) / (n - 7),
        y = (Math.floor(i / n) + 0.5 - 3.5) / (n - 7);
      const plane = (key) =>
        controls[0][key] +
        (controls[1][key] - controls[0][key]) * x +
        (controls[2][key] - controls[0][key]) * y;
      let threshold = option.threshold ?? (plane('dark') + plane('light')) / 2;
      if (option.mode === 'module-local-mean') {
        const xx = i % n,
          yy = Math.floor(i / n),
          left = Math.max(0, xx - option.radius),
          right = Math.min(n, xx + option.radius + 1),
          top = Math.max(0, yy - option.radius),
          bottom = Math.min(n, yy + option.radius + 1),
          sum =
            integral[bottom * (n + 1) + right] -
            integral[bottom * (n + 1) + left] -
            integral[top * (n + 1) + right] +
            integral[top * (n + 1) + left];
        threshold =
          sum / ((right - left) * (bottom - top)) -
          (invert ? -1 : 1) * contrast * 0.03;
      }
      confidence[i] = Math.min(1, Math.abs(v - threshold) / contrast);
      if (
        (!invert && original > light + contrast * 0.35) ||
        (invert && original < light - contrast * 0.35)
      )
        confidence[i] = Math.min(confidence[i], 0.02);
      const originalDark = original <= threshold,
        sampledDark = v <= threshold;
      changedModules += originalDark !== sampledDark;
      nearThresholdModules += Math.abs(v - threshold) <= contrast * 0.05;
      return (sampledDark ? 1 : 0) ^ (invert ? 1 : 0);
    });
    const finderErrors = [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ].map(([sx, sy]) => {
      let errors = 0;
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++) {
          const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          if (grid[(sy + y) * n + sx + x] !== (d === 3 || d <= 1 ? 1 : 0))
            errors++;
        }
      return errors;
    });
    return {
      grid,
      confidence,
      trace: {
        mode: 'local-gray',
        ...option,
        offset,
        controls,
        knownDarkMedian: dark,
        knownLightMedian: light,
        contrast,
        invert,
        changedModules,
        nearThresholdModules,
        uncertaintyMeasure:
          'Luminance distance only; not a probability of correct data',
        finderErrors,
        shapeAccepted: finderErrors.every((e) => e <= 12),
      },
    };
  });
  if (deblur) trials.push(...deblurGrid(values, n, { deadline }));
  return trials;
}
