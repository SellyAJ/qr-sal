// Recover projective geometry from the actual three finder borders. No payload
// bits or benchmark annotations are involved. Especially useful for QR version 1,
// which has no fourth alignment marker.
const cross = (o, a, b) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function hull(points) {
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
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function outline(bits, w, h, p, ux, uy, vx, vy, deadline, audit) {
  const m = p.module,
    radius = Math.ceil(m * 6),
    x0 = Math.max(0, Math.floor(p.x) - radius),
    y0 = Math.max(0, Math.floor(p.y) - radius);
  const rw = Math.min(w, Math.ceil(p.x) + radius) - x0,
    rh = Math.min(h, Math.ceil(p.y) + radius) - y0;
  if (rw * rh > 2_000_000 || m < 1) {
    audit.rejection = 'component-budget';
    return null;
  }
  let seed = null;
  for (const [dx, dy] of [
    [ux, uy],
    [vx, vy],
    [-ux, -uy],
    [-vx, -vy],
  ]) {
    let white = false;
    for (let t = 0; t < m * 5; t += 0.5) {
      const x = Math.floor(p.x + t * dx),
        y = Math.floor(p.y + t * dy);
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      const dark = bits[y * w + x];
      if (!dark) white = true;
      else if (white && t > m * 1.8) {
        seed = { x, y };
        break;
      }
    }
    if (seed) break;
  }
  if (!seed) {
    audit.rejection = 'outer-ring-seed';
    return null;
  }
  const seen = new Uint8Array(rw * rh),
    queue = new Int32Array(rw * rh),
    rowMin = new Int32Array(rh).fill(w),
    rowMax = new Int32Array(rh).fill(-1),
    boundary = [];
  let head = 0,
    tail = 1,
    touches = false;
  queue[0] = (seed.y - y0) * rw + seed.x - x0;
  seen[queue[0]] = 1;
  while (head < tail) {
    if ((head & 4095) === 0 && performance.now() > deadline) {
      audit.rejection = 'deadline';
      return null;
    }
    const index = queue[head++],
      lx = index % rw,
      ly = Math.floor(index / rw),
      x = lx + x0,
      y = ly + y0;
    if (lx === 0 || ly === 0 || lx === rw - 1 || ly === rh - 1) {
      touches = true;
      continue;
    }
    let edge = false;
    // Boundary pixels already returned above. Preserve traversal order while
    // avoiding per-pixel coordinate arrays in this hot flood-fill loop.
    const sourceIndex = y * w + x;
    for (let direction = 0; direction < 4; direction++) {
      const ni =
        direction === 0
          ? index - 1
          : direction === 1
            ? index + 1
            : direction === 2
              ? index - rw
              : index + rw;
      const sourceNeighbor =
        direction === 0
          ? sourceIndex - 1
          : direction === 1
            ? sourceIndex + 1
            : direction === 2
              ? sourceIndex - w
              : sourceIndex + w;
      if (!bits[sourceNeighbor]) {
        edge = true;
        continue;
      }
      if (!seen[ni]) {
        seen[ni] = 1;
        queue[tail++] = ni;
      }
    }
    if (edge) {
      rowMin[ly] = Math.min(rowMin[ly], x);
      rowMax[ly] = Math.max(rowMax[ly], x + 1);
    }
  }
  audit.area = tail;
  if (touches || tail < 8 * m * m || tail > 55 * m * m) {
    audit.rejection = touches ? 'connected-outside-window' : 'outer-ring-area';
    return null;
  }
  for (let ly = 0; ly < rh; ly++)
    if (rowMax[ly] >= 0) {
      const y = ly + y0;
      boundary.push(
        { x: rowMin[ly], y },
        { x: rowMax[ly], y },
        { x: rowMin[ly], y: y + 1 },
        { x: rowMax[ly], y: y + 1 },
      );
    }
  const convex = hull(boundary),
    quad = convex.slice();
  if (quad.length < 4) {
    audit.rejection = 'border-hull';
    return null;
  }
  while (quad.length > 4) {
    let remove = 0,
      best = Infinity;
    for (let i = 0; i < quad.length; i++) {
      const area = Math.abs(
        cross(
          quad[(i + quad.length - 1) % quad.length],
          quad[i],
          quad[(i + 1) % quad.length],
        ),
      );
      if (area < best) {
        best = area;
        remove = i;
      }
    }
    quad.splice(remove, 1);
  }
  // Order the four edges in the candidate QR's own basis, including rotations.
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < 0.2) {
    audit.rejection = 'basis';
    return null;
  }
  const score = (q) =>
    ((q.x - p.x) * (vy - uy) + (q.y - p.y) * (ux - vx)) / det;
  const first = quad.reduce(
    (best, q, i) => (score(q) < score(quad[best]) ? i : best),
    0,
  );
  const ordered = quad.map((_, i) => quad[(first + i) % 4]);
  const residual = Math.sqrt(
    convex.reduce(
      (sum, p) =>
        sum +
        Math.min(
          ...ordered.map((a, i) => {
            const b = ordered[(i + 1) % 4];
            return Math.abs(cross(a, b, p)) / Math.hypot(b.x - a.x, b.y - a.y);
          }),
        ) **
          2,
      0,
    ) / convex.length,
  );
  audit.residualModules = residual / m;
  if (residual > m * 0.35) {
    audit.rejection = 'nonquadrilateral-border';
    return null;
  }
  audit.corners = ordered;
  return ordered;
}
export function finderBorders(
  bits,
  w,
  h,
  group,
  { deadline = Infinity, allowMissing = false } = {},
) {
  const { tl, tr, bl } = group,
    ul = Math.hypot(tr.x - tl.x, tr.y - tl.y),
    vl = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const ux = (tr.x - tl.x) / ul,
    uy = (tr.y - tl.y) / ul,
    vx = (bl.x - tl.x) / vl,
    vy = (bl.y - tl.y) / vl;
  const trace = [],
    corners = [];
  for (const p of [tl, tr, bl]) {
    const audit = { center: { x: p.x, y: p.y } };
    trace.push(audit);
    if (allowMissing && p.inferred) {
      audit.inferred = true;
      corners.push(null);
      continue;
    }
    const q = outline(bits, w, h, p, ux, uy, vx, vy, deadline, audit);
    if (!q) return { corners: null, trace };
    corners.push(q);
  }
  return { corners, trace };
}
export function verifyProjectiveFinder(
  bits,
  w,
  h,
  p,
  { deadline = Infinity } = {},
) {
  const c = Math.cos(p.angle ?? 0),
    s = Math.sin(p.angle ?? 0),
    audit = {};
  const q = outline(bits, w, h, p, c, s, -s, c, deadline, audit);
  if (!q) return { accepted: false, ...audit };
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-6)
    return { accepted: false, rejection: 'singular-border' };
  const g = (dx3 * dy2 - dx2 * dy3) / det,
    j = (dx1 * dy3 - dx3 * dy1) / det;
  const map = (x, y) => ({
    x:
      ((p1.x - p0.x + g * p1.x) * x + (p3.x - p0.x + j * p3.x) * y + p0.x) /
      (g * x + j * y + 1),
    y:
      ((p1.y - p0.y + g * p1.y) * x + (p3.y - p0.y + j * p3.y) * y + p0.y) /
      (g * x + j * y + 1),
  });
  let correct = 0;
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const pixel = map((x + 0.5) / 7, (y + 0.5) / 7),
        xx = Math.floor(pixel.x),
        yy = Math.floor(pixel.y);
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (
        xx >= 0 &&
        yy >= 0 &&
        xx < w &&
        yy < h &&
        bits[yy * w + xx] === (d === 3 || d <= 1 ? 1 : 0)
      )
        correct++;
    }
  return {
    accepted: correct >= 46,
    quality: correct / 49,
    center: map(0.5, 0.5),
    ...audit,
  };
}
export function fitFinderMap(borders, n) {
  if (!borders.corners || borders.corners.filter(Boolean).length < 2)
    return null;
  const from = [],
    to = [];
  for (let i = 0; i < 3; i++) {
    if (!borders.corners[i]) continue;
    const inset = borders.inset ?? 0,
      span = borders.span ?? 7,
      x = (i === 1 ? n - 7 : 0) + inset,
      y = (i === 2 ? n - 7 : 0) + inset;
    from.push([x, y], [x + span, y], [x + span, y + span], [x, y + span]);
    to.push(...borders.corners[i]);
  }
  const origin = to[0],
    scale = Math.max(
      ...to.map((p) => Math.hypot(p.x - origin.x, p.y - origin.y)),
    );
  const rows = [];
  for (let i = 0; i < from.length; i++) {
    const x = from[i][0] / n,
      y = from[i][1] / n,
      u = (to[i].x - origin.x) / scale,
      v = (to[i].y - origin.y) / scale;
    rows.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  }
  const normal = Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 9 }, (_, j) =>
      rows.reduce((sum, row) => sum + row[i] * row[j], 0),
    ),
  );
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++)
      if (Math.abs(normal[r][c]) > Math.abs(normal[p][c])) p = r;
    if (Math.abs(normal[p][c]) < 1e-10) return null;
    [normal[c], normal[p]] = [normal[p], normal[c]];
    const div = normal[c][c];
    for (let j = c; j < 9; j++) normal[c][j] /= div;
    for (let r = 0; r < 8; r++)
      if (r !== c) {
        const factor = normal[r][c];
        for (let j = c; j < 9; j++) normal[r][j] -= factor * normal[c][j];
      }
  }
  const a = normal.map((row) => row[8]);
  const map = (xx, yy) => {
    const x = xx / n,
      y = yy / n,
      z = a[6] * x + a[7] * y + 1;
    return {
      x: origin.x + (scale * (a[0] * x + a[1] * y + a[2])) / z,
      y: origin.y + (scale * (a[3] * x + a[4] * y + a[5])) / z,
    };
  };
  const residual = Math.sqrt(
    from.reduce((sum, p, i) => {
      const q = map(...p);
      return sum + (q.x - to[i].x) ** 2 + (q.y - to[i].y) ** 2;
    }, 0) / from.length,
  );
  // Reject incompatible triples even if a least-squares solution exists.
  if (residual > (scale / n) * 0.6) return null;
  return { map, residualModules: residual / (scale / n) };
}
