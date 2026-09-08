import { bilinear } from './preprocess.mjs';
// Register sampling geometry against fixed QR function patterns only.
export function refineMap(gray, w, h, base, n, { deadline = Infinity } = {}) {
  const cells = [],
    dark = [],
    light = [];
  for (const [sx, sy] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ])
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3)),
          expected = d === 3 || d <= 1;
        const p = base(sx + x + 0.5, sy + y + 0.5);
        if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) return null;
        (expected ? dark : light).push(bilinear(gray, w, h, p.x, p.y));
        cells.push({ x: sx + x + 0.5, y: sy + y + 0.5, dark: expected });
      }
  for (let i = 8; i < n - 8; i++) {
    cells.push({ x: i + 0.5, y: 6.5, dark: (i & 1) === 0 });
    cells.push({ x: 6.5, y: i + 0.5, dark: (i & 1) === 0 });
  }
  if (n > 21)
    for (let y = -2; y <= 2; y++)
      for (let x = -2; x <= 2; x++)
        cells.push({
          x: n - 6.5 + x,
          y: n - 6.5 + y,
          dark: Math.max(Math.abs(x), Math.abs(y)) === 2 || (!x && !y),
        });
  const median = (a) => a.sort((a, b) => a - b)[a.length >> 1],
    black = median(dark),
    white = median(light),
    contrast = Math.abs(white - black);
  if (contrast < 3) return null;
  const p0 = base(0, 0),
    p1 = base(n, 0),
    p2 = base(0, n),
    modulePixels =
      (Math.hypot(p1.x - p0.x, p1.y - p0.y) +
        Math.hypot(p2.x - p0.x, p2.y - p0.y)) /
      (2 * n);
  const observations = cells.flatMap((c) =>
    [
      [0, 0],
      [-0.25, -0.25],
      [0.25, -0.25],
      [-0.25, 0.25],
      [0.25, 0.25],
    ].map(([dx, dy]) => {
      const x = (c.x + dx) / n,
        y = (c.y + dy) / n;
      return {
        ...c,
        p: base(c.x + dx, c.y + dy),
        weights: [(1 - x) * (1 - y), x * (1 - y), x * y, (1 - x) * y],
      };
    }),
  );
  let evaluations = 0;
  const score = (parameters) => {
    evaluations++;
    let total = 0;
    for (const c of observations) {
      let x = c.p.x,
        y = c.p.y;
      for (let i = 0; i < 4; i++) {
        x += c.weights[i] * parameters[i * 2] * modulePixels;
        y += c.weights[i] * parameters[i * 2 + 1] * modulePixels;
      }
      if (x < 0.5 || y < 0.5 || x > w - 0.5 || y > h - 0.5) return Infinity;
      const error =
        (bilinear(gray, w, h, x, y) - (c.dark ? black : white)) / contrast;
      total += Math.min(1, error * error);
    }
    return (
      total / observations.length +
      parameters.reduce((s, v) => s + v * v, 0) * 0.0005
    );
  };
  const parameters = Array.from({ length: 8 }, () => 0),
    before = score(parameters);
  let best = before;
  if (!Number.isFinite(before) || before > 0.45) return null;
  for (const step of [0.5, 0.25, 0.125, 0.0625]) {
    for (let round = 0; round < 2; round++)
      for (let i = 0; i < 8; i++) {
        if (performance.now() > deadline) return null;
        const value = parameters[i];
        let selected = value;
        for (const delta of [-step, step]) {
          if (Math.abs(value + delta) > 1.5) continue;
          parameters[i] = value + delta;
          const trial = score(parameters);
          if (trial < best - 1e-6) {
            best = trial;
            selected = parameters[i];
          }
        }
        parameters[i] = selected;
      }
  }
  if (best > before * 0.98) return null;
  const map = (xx, yy) => {
    const x = xx / n,
      y = yy / n,
      weights = [(1 - x) * (1 - y), x * (1 - y), x * y, (1 - x) * y],
      p = base(xx, yy);
    for (let i = 0; i < 4; i++) {
      p.x += weights[i] * parameters[i * 2] * modulePixels;
      p.y += weights[i] * parameters[i * 2 + 1] * modulePixels;
    }
    return p;
  };
  map.registration = {
    baseCorners: [base(0, 0), base(n, 0), base(n, n), base(0, n)],
    baseCurvedGeometry: base.curvedGeometry,
    method: 'fixed-function-photometric-registration',
    before,
    after: best,
    evaluations,
    cornerDisplacementsModules: parameters,
    modulePixels: modulePixels,
  };
  return map;
}
