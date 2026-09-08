// Smooth maps from observed finder borders. No data-cell values are inputs.
function solve(rows) {
  const n = rows.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const d = rows[col][col];
    for (let j = col; j < rows[col].length; j++) rows[col][j] /= d;
    for (let r = 0; r < n; r++)
      if (r !== col) {
        const v = rows[r][col];
        for (let j = col; j < rows[r].length; j++)
          rows[r][j] -= v * rows[col][j];
      }
  }
  return rows.map((r) => r.slice(n));
}
export function curvedFinderMaps(borders, n) {
  if (!borders.corners) return [];
  const from = [],
    to = borders.corners.flat(),
    maps = [];
  for (let i = 0; i < 3; i++) {
    const inset = borders.inset ?? 0,
      span = borders.span ?? 7,
      x = (i === 1 ? n - 7 : 0) + inset,
      y = (i === 2 ? n - 7 : 0) + inset;
    from.push(
      [x / n, y / n],
      [(x + span) / n, y / n],
      [(x + span) / n, (y + span) / n],
      [x / n, (y + span) / n],
    );
  }
  const origin = to[0],
    scale = Math.max(
      ...to.map((p) => Math.hypot(p.x - origin.x, p.y - origin.y)),
    ),
    targets = to.map((p) => [
      (p.x - origin.x) / scale,
      (p.y - origin.y) / scale,
    ]);
  function add(local, method, coefficients) {
    const map = (x, y) => {
      const p = local(x / n, y / n);
      return { x: origin.x + p[0] * scale, y: origin.y + p[1] * scale };
    };
    const residual =
      Math.sqrt(
        from.reduce((s, p, i) => {
          const q = map(p[0] * n, p[1] * n);
          return s + (q.x - to[i].x) ** 2 + (q.y - to[i].y) ** 2;
        }, 0) / 12,
      ) /
      (scale / n);
    if (!Number.isFinite(residual) || residual > 0.8) return;
    let minimumJacobian = Infinity,
      maximumJacobian = 0;
    for (let y = 0; y <= n; y += n / 8)
      for (let x = 0; x <= n; x += n / 8) {
        const p = map(x, y),
          u = map(x + 0.1, y),
          v = map(x, y + 0.1),
          j =
            ((u.x - p.x) * (v.y - p.y) - (u.y - p.y) * (v.x - p.x)) /
            0.01 /
            (scale / n) ** 2;
        if (!Number.isFinite(j) || j < 0.025 || j > 10) return;
        minimumJacobian = Math.min(minimumJacobian, j);
        maximumJacobian = Math.max(maximumJacobian, j);
      }
    map.curvedGeometry = {
      method,
      dimension: n,
      controlPoints: from,
      sourceCorners: to,
      normalization: { origin, scale },
      coefficients,
      residualModules: residual,
      minimumJacobian,
      maximumJacobian,
    };
    maps.push(map);
  }
  const basis = (x, y) => [1, x, y, x * x, x * y, y * y];
  const design = from.map((p) => basis(...p));
  const normal = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 8 }, (_, j) =>
      design.reduce(
        (s, row, k) => s + row[i] * (j < 6 ? row[j] : targets[k][j - 6]),
        0,
      ),
    ),
  );
  const poly = solve(normal);
  if (poly)
    add(
      (x, y) => {
        const b = basis(x, y);
        return [0, 1].map((axis) =>
          b.reduce((s, v, i) => s + v * poly[i][axis], 0),
        );
      },
      'quadratic-finder-borders',
      poly,
    );
  const kernel = (x, y) => {
    const r = x * x + y * y;
    return r > 0 ? r * Math.log(r) : 0;
  };
  for (const lambda of [0.0001, 0.01]) {
    const rows = Array.from({ length: 15 }, (_, i) =>
      Array.from({ length: 17 }, (_, j) => {
        if (i < 12 && j < 12)
          return (
            kernel(from[i][0] - from[j][0], from[i][1] - from[j][1]) +
            (i === j ? lambda : 0)
          );
        if (i < 12 && j < 15) return [1, ...from[i]][j - 12];
        if (i >= 12 && j < 12) return [1, ...from[j]][i - 12];
        if (j >= 15) return i < 12 ? targets[i][j - 15] : 0;
        return 0;
      }),
    );
    const a = solve(rows);
    if (a)
      add(
        (x, y) =>
          [0, 1].map(
            (axis) =>
              a[12][axis] +
              a[13][axis] * x +
              a[14][axis] * y +
              from.reduce(
                (s, p, i) => s + a[i][axis] * kernel(x - p[0], y - p[1]),
                0,
              ),
          ),
        'thin-plate-finder-borders-' + lambda,
        a,
      );
  }
  return maps;
}
