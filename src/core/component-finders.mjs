// Locate measured solid finder cores when their outer ring has broken strokes.
// Missing border pixels remain missing. Payload cells are never inputs here.
const cross = (o, a, b) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function quadOf(points) {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const lower = [],
    upper = [];
  for (const p of points) {
    while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0)
      lower.pop();
    lower.push(p);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0)
      upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1)),
    quad = hull.slice();
  if (quad.length < 4) return null;
  while (quad.length > 4) {
    let remove = 0,
      best = Infinity;
    for (let i = 0; i < quad.length; i++) {
      const a = Math.abs(
        cross(
          quad[(i + quad.length - 1) % quad.length],
          quad[i],
          quad[(i + 1) % quad.length],
        ),
      );
      if (a < best) {
        best = a;
        remove = i;
      }
    }
    quad.splice(remove, 1);
  }
  const lengths = quad.map((p, i) =>
      Math.hypot(p.x - quad[(i + 1) % 4].x, p.y - quad[(i + 1) % 4].y),
    ),
    mean = lengths.reduce((a, b) => a + b) / 4;
  if (
    Math.min(...lengths) < 3 ||
    Math.max(...lengths) > Math.min(...lengths) * 2.5
  )
    return null;
  const residual = Math.sqrt(
    hull.reduce(
      (sum, p) =>
        sum +
        Math.min(
          ...quad.map(
            (a, i) => Math.abs(cross(a, quad[(i + 1) % 4], p)) / lengths[i],
          ),
        ) **
          2,
      0,
    ) / hull.length,
  );
  if (residual > mean * 0.07) return null;
  return { quad, module: mean / 3, residual };
}
function mapper(q) {
  const [p0, p1, p2, p3] = q,
    dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x,
    dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y,
    det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-6) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / det,
    j = (dx1 * dy3 - dx3 * dy1) / det;
  return (x, y) => ({
    x:
      ((p1.x - p0.x + g * p1.x) * x + (p3.x - p0.x + j * p3.x) * y + p0.x) /
      (g * x + j * y + 1),
    y:
      ((p1.y - p0.y + g * p1.y) * x + (p3.y - p0.y + j * p3.y) * y + p0.y) /
      (g * x + j * y + 1),
  });
}
export function componentFinders(
  bits,
  w,
  h,
  { deadline = Infinity, known = [], audit = null } = {},
) {
  const seen = new Uint8Array(bits.length),
    queue = new Int32Array(bits.length),
    rowStamp = new Int32Array(h),
    rowMin = new Int32Array(h),
    rowMax = new Int32Array(h),
    found = [];
  for (let seed = 0; seed < bits.length; seed++) {
    if ((seed & 16383) === 0 && performance.now() > deadline) break;
    if (seen[seed] || !bits[seed]) continue;
    let head = 0,
      tail = 1,
      minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    queue[0] = seed;
    seen[seed] = 1;
    let boundaryCount = 0;
    while (head < tail) {
      if ((head & 16383) === 0 && performance.now() > deadline) return found;
      const i = queue[head++],
        x = i % w,
        y = Math.floor(i / w);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      let edge = false;
      // Keep the same left/right/up/down traversal without allocating four
      // coordinate pairs for every pixel in every connected component.
      for (let direction = 0; direction < 4; direction++) {
        const outside =
          direction === 0
            ? x === 0
            : direction === 1
              ? x === w - 1
              : direction === 2
                ? y === 0
                : y === h - 1;
        const ii =
          direction === 0
            ? i - 1
            : direction === 1
              ? i + 1
              : direction === 2
                ? i - w
                : i + w;
        if (outside || !bits[ii]) {
          edge = true;
          continue;
        }
        if (!seen[ii]) {
          seen[ii] = 1;
          queue[tail++] = ii;
        }
      }
      if (edge && boundaryCount < 10000) {
        boundaryCount += 4;
        if (rowStamp[y] !== seed + 1) {
          rowStamp[y] = seed + 1;
          rowMin[y] = x;
          rowMax[y] = x + 1;
        } else {
          rowMin[y] = Math.min(rowMin[y], x);
          rowMax[y] = Math.max(rowMax[y], x + 1);
        }
      }
    }
    const bw = maxX - minX + 1,
      bh = maxY - minY + 1;
    if (
      tail < 9 ||
      tail > 100000 ||
      Math.min(bw, bh) < 3 ||
      Math.max(bw, bh) > Math.min(bw, bh) * 2.8 ||
      tail / (bw * bh) < 0.45 ||
      boundaryCount >= 10000
    )
      continue;
    // Every boundary point lies between this row's two extrema. Their four
    // pixel corners therefore have exactly the same convex hull as the full
    // boundary; retain the original boundary-size rejection above.
    const boundary = [];
    for (let y = minY; y <= maxY; y++)
      if (rowStamp[y] === seed + 1) {
        boundary.push(
          { x: rowMin[y], y },
          { x: rowMax[y], y },
          { x: rowMin[y], y: y + 1 },
          { x: rowMax[y], y: y + 1 },
        );
      }
    const fit = quadOf(boundary);
    if (!fit) continue;
    const map = mapper(fit.quad);
    if (!map) continue;
    const center = map(0.5, 0.5);
    if (
      known.some(
        (p) => Math.hypot(p.x - center.x, p.y - center.y) < fit.module * 1.5,
      )
    )
      continue;
    let core = 0,
      light = 0,
      border = 0,
      valid = true;
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const p = map((x + 0.5 - 2) / 3, (y + 0.5 - 2) / 3),
          xx = Math.floor(p.x),
          yy = Math.floor(p.y),
          d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        if (
          !Number.isFinite(xx + yy) ||
          xx < 0 ||
          yy < 0 ||
          xx >= w ||
          yy >= h
        ) {
          valid = false;
          continue;
        }
        if (bits[yy * w + xx] === (d === 3 || d <= 1 ? 1 : 0)) {
          if (d <= 1) core++;
          else if (d === 2) light++;
          else border++;
        }
      }
    if (!valid || core < 8 || light < 15 || border < 12) continue;
    const angle = Math.atan2(
        fit.quad[1].y - fit.quad[0].y,
        fit.quad[1].x - fit.quad[0].x,
      ),
      axis = Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
    const p = {
      ...center,
      module: fit.module / axis,
      hits: 3,
      quality: (core + light + border) / 49,
      angle,
      componentVerified: true,
      componentEvidence: {
        core,
        light,
        border,
        residualModules: fit.residual / fit.module,
        coreCorners: fit.quad,
      },
    };
    if (audit) audit.push(p);
    found.push(p);
    if (found.length >= 96) break;
  }
  return found;
}
