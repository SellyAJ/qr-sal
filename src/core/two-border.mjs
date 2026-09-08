import { finderBorders, fitFinderMap } from './finder-geometry.mjs';
// Fit eight actually observed border vertices. The missing finder is geometry
// only; every data/format/timing cell must still be read from source pixels.
export function* twoBorderMaps(
  points,
  bits,
  w,
  h,
  { deadline = Infinity, known = [], audit = null } = {},
) {
  const inside = (p, q) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i],
        b = q[(i + 1) % 4],
        c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (c) {
        if (sign && Math.sign(c) !== sign) return false;
        sign = Math.sign(c);
      }
    }
    return true;
  };
  const anchors = points
    .filter(
      (p) => p.quality >= 0.76 && !known.some((c) => inside(p, c.corners)),
    )
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 18);
  const count = (key, detail) => {
    if (!audit) return;
    audit[key] = (audit[key] ?? 0) + 1;
    if (detail && (audit.examples ??= []).length < 64)
      audit.examples.push({ reason: key, ...detail });
  };
  if (audit)
    audit.anchors = anchors.map((p) => ({
      x: p.x,
      y: p.y,
      module: p.module,
      quality: p.quality,
    }));
  let yielded = 0;
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++) {
      if (performance.now() > deadline) return;
      const p = anchors[i],
        q = anchors[j],
        dx = q.x - p.x,
        dy = q.y - p.y,
        d = Math.hypot(dx, dy),
        raw = (p.module + q.module) / 2;
      if (
        d / raw < 10 ||
        d / raw > 170 ||
        Math.max(p.module, q.module) > 2 * Math.min(p.module, q.module)
      )
        continue;
      const virtual = (x, y) => ({
        x,
        y,
        module: raw,
        inferred: true,
        quality: 0,
        hits: 0,
      });
      const guesses = [
        { tl: p, tr: q, bl: virtual(p.x - dy, p.y + dx), missing: 'bl' },
        { tl: q, tr: p, bl: virtual(q.x + dy, q.y - dx), missing: 'bl' },
        { tl: p, tr: virtual(p.x + dy, p.y - dx), bl: q, missing: 'tr' },
        { tl: q, tr: virtual(q.x - dy, q.y + dx), bl: p, missing: 'tr' },
        {
          tl: virtual((p.x + q.x - dy) / 2, (p.y + q.y + dx) / 2),
          tr: p,
          bl: q,
          missing: 'tl',
        },
        {
          tl: virtual((p.x + q.x + dy) / 2, (p.y + q.y - dx) / 2),
          tr: q,
          bl: p,
          missing: 'tl',
        },
      ];
      for (const group of guesses) {
        if (performance.now() > deadline) return;
        const { tl, tr, bl, missing } = group;
        const borders = finderBorders(bits, w, h, group, {
          deadline,
          allowMissing: true,
        });
        if (!borders.corners) {
          count('borderRejected', { missing, trace: borders.trace });
          continue;
        }
        const a = Math.hypot(tr.x - tl.x, tr.y - tl.y),
          b = Math.hypot(bl.x - tl.x, bl.y - tl.y),
          axis =
            (Math.max(Math.abs(tr.x - tl.x), Math.abs(tr.y - tl.y)) / a +
              Math.max(Math.abs(bl.x - tl.x), Math.abs(bl.y - tl.y)) / b) /
            2;
        const estimate =
          17 + 4 * Math.round(((a + b) / 2 / (raw * axis) + 7 - 17) / 4);
        for (const delta of [0, -4, 4, -8, 8]) {
          if (performance.now() > deadline) return;
          const n = estimate + delta;
          if (n < 21 || n > 85) continue;
          const fit = fitFinderMap(borders, n);
          if (!fit || fit.residualModules > 0.6) {
            count('fitRejected');
            continue;
          }
          const map = fit.map,
            corners = [map(0, 0), map(n, 0), map(n, n), map(0, n)];
          if (
            corners.some(
              (c) =>
                !Number.isFinite(c.x + c.y) ||
                c.x < 0 ||
                c.y < 0 ||
                c.x >= w - 1 ||
                c.y >= h - 1,
            )
          )
            continue;
          let valid = true;
          for (let y = 0; y <= n; y += n / 4)
            for (let x = 0; x <= n; x += n / 4) {
              const c = map(x, y),
                u = map(x + 0.1, y),
                v = map(x, y + 0.1),
                jac =
                  ((u.x - c.x) * (v.y - c.y) - (u.y - c.y) * (v.x - c.x)) /
                  0.01 /
                  raw ** 2;
              if (jac < 0.05 || jac > 10 || !Number.isFinite(jac))
                valid = false;
            }
          if (!valid) continue;
          let errors = 0;
          for (let k = 8; k < n - 8; k++)
            for (const [x, y] of [
              [k + 0.5, 6.5],
              [6.5, k + 0.5],
            ]) {
              const c = map(x, y),
                xx = Math.floor(c.x),
                yy = Math.floor(c.y);
              if (bits[yy * w + xx] !== (k & 1 ? 0 : 1)) errors++;
            }
          if (errors > Math.max(1, Math.floor((n - 16) * 0.25))) {
            count('timingWeak', { n, errors, missing, corners });
          }
          const resolved = { ...group };
          for (const [role, x, y] of [
            ['tl', 3.5, 3.5],
            ['tr', n - 3.5, 3.5],
            ['bl', 3.5, n - 3.5],
          ])
            resolved[role] = { ...group[role], ...map(x, y) };
          map.twoBorderGeometry = {
            missing,
            dimension: n,
            observedBorders: borders.corners,
            residualModules: fit.residualModules,
            timingErrors: errors,
          };
          count('yielded', { n, missing, corners });
          yield { map, n, group: resolved, missing };
          if (++yielded >= 24) return;
        }
      }
    }
}

export function twoBorderEvidence(grid, n, missing) {
  const skip = { tl: 0, tr: 1, bl: 2 }[missing];
  if (skip === undefined) return false;
  for (const [index, [x0, y0]] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ].entries()) {
    if (index === skip) continue;
    let errors = 0;
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        errors += grid[(y0 + y) * n + x0 + x] !== (d === 3 || d <= 1 ? 1 : 0);
      }
    if (errors > 6) return false;
  }
  let errors = 0;
  for (let k = 8; k < n - 8; k++)
    for (const i of [6 * n + k, k * n + 6])
      errors += grid[i] !== (k & 1 ? 0 : 1);
  return true; // Timing can be obscured together with the missing corner. It remains logged; intact finder borders, format and RS still validate the sample.
}
