import { FailureGridLog } from './failure-grids.mjs';
import { mergeFinderObservations } from './finder-fusion.mjs';
import { twoBorderMaps, twoBorderEvidence } from './two-border.mjs';
import { finderCoreBorders } from './core-control.mjs';
import { latticePhase } from './lattice-phase.mjs';
import { refineMap } from './refine-map.mjs';
import { sharpenSource } from './source-sharpen.mjs';
import { componentFinders } from './component-finders.mjs';
import { multiThresholds } from './multilevel.mjs';
import { curvedFinderMaps } from './curved-map.mjs';
import { decodeMatrix } from './matrix.mjs';
import { timingWarp, edgeWarp } from './grid-recovery.mjs';
import { errorStage, makeFailureLog, STAGES } from './diagnostics.mjs';
import { inside, collectCode } from './regions.mjs';
import { completeFinderPairs } from './finder-pairs.mjs';
import { grayGridTrials } from './gray-grid.mjs';
import { resizeGray, filterGray } from './preprocess.mjs';
import {
  finderBorders,
  fitFinderMap,
  verifyProjectiveFinder,
} from './finder-geometry.mjs';
export const ENGINE_VERSION = 'qr-sal-0.1.0';
export function grayscale(image) {
  const { width, height, data } = image;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 21 ||
    height < 21 ||
    width * height > 20_000_000
  )
    throw Error('Image size must be between 21 pixels and 20 megapixels');
  if (data.length === width * height) return Uint8Array.from(data);
  if (data.length !== width * height * 4) throw Error('Invalid image buffer');
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const a = data[i * 4 + 3] / 255;
    gray[i] = Math.round(
      (0.299 * data[i * 4] +
        0.587 * data[i * 4 + 1] +
        0.114 * data[i * 4 + 2]) *
        a +
        255 * (1 - a),
    );
  }
  return gray;
}
export function binarize(gray, w, h, adaptive = false, invert = false) {
  const out = new Uint8Array(gray.length);
  if (!adaptive) {
    const hist = new Uint32Array(256);
    let sum = 0;
    for (const p of gray) {
      hist[p]++;
      sum += p;
    }
    let weight = 0,
      left = 0,
      best = -1,
      threshold = 127;
    for (let t = 0; t < 255; t++) {
      weight += hist[t];
      left += t * hist[t];
      if (!weight || weight === gray.length) continue;
      const d = left / weight - (sum - left) / (gray.length - weight);
      const score = weight * (gray.length - weight) * d * d;
      if (score > best) {
        best = score;
        threshold = t;
      }
    }
    for (let i = 0; i < gray.length; i++)
      out[i] = (gray[i] <= threshold ? 1 : 0) ^ (invert ? 1 : 0);
    return out;
  }
  const stride = w + 1,
    integral = new Float64Array(stride * (h + 1));
  const contrast = adaptive === 'contrast' || typeof adaptive === 'object';
  const squares = contrast ? new Float64Array(integral.length) : null;
  for (let y = 0; y < h; y++) {
    let total = 0,
      totalSquared = 0;
    for (let x = 0; x < w; x++) {
      total += gray[y * w + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + total;
      if (squares) {
        totalSquared += gray[y * w + x] ** 2;
        squares[(y + 1) * stride + x + 1] =
          squares[y * stride + x + 1] + totalSquared;
      }
    }
  }
  const r = typeof adaptive === 'object' ? adaptive.radius : 20;
  for (let y = 0; y < h; y++) {
    const t = Math.max(0, y - r),
      b = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - r),
        right = Math.min(w, x + r + 1),
        mean =
          (integral[b * stride + right] -
            integral[t * stride + right] -
            integral[b * stride + l] +
            integral[t * stride + l]) /
          ((b - t) * (right - l));
      const variance = squares
        ? Math.max(
            0,
            (squares[b * stride + right] -
              squares[t * stride + right] -
              squares[b * stride + l] +
              squares[t * stride + l]) /
              ((b - t) * (right - l)) -
              mean * mean,
          )
        : 0;
      const offset = contrast
        ? typeof adaptive === 'object'
          ? Math.max(0.05, Math.sqrt(variance) * 0.07)
          : Math.max(0.6, Math.min(7, Math.sqrt(variance) * 0.15))
        : 7;
      out[y * w + x] =
        (gray[y * w + x] < mean - offset ? 1 : 0) ^ (invert ? 1 : 0);
    }
  }
  return out;
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function ratio(counts) {
  const total = counts.reduce((a, b) => a + b, 0),
    m = total / 7;
  return total >= 7 &&
    counts.every(
      (v, i) =>
        Math.abs(v - (i === 2 ? 3 * m : m)) < (i === 2 ? 2.0 : 0.85) * m,
    )
    ? m
    : 0;
}
function cross(bits, w, h, x, y, vertical, expected, audit = null) {
  const limit = vertical ? h : w,
    at = (n) => (vertical ? bits[n * w + x] : bits[y * w + n]),
    center = vertical ? y : x;
  const counts = [0, 0, 0, 0, 0];
  const reject = (reason, observed = null) => {
    if (audit) {
      const axis = vertical ? 'vertical' : 'horizontal',
        key = axis + ':' + reason;
      audit.crossRejections[key] = (audit.crossRejections[key] ?? 0) + 1;
      const band = Math.min(15, Math.floor((y / h) * 16));
      if ((audit.sampleBands[band] ?? 0) < 2) {
        audit.sampleBands[band] = (audit.sampleBands[band] ?? 0) + 1;
        audit.rejectedSamples.push({
          axis,
          reason,
          x,
          y,
          expectedModule: expected,
          observedModule: observed,
          runs: counts.slice(),
        });
      }
    }
    return null;
  };
  if (center < 0 || center >= limit || !at(center))
    return reject('center-not-black');
  let a = center,
    b = center + 1;
  while (a >= 0 && at(a) && counts[2] < expected * 5) {
    counts[2]++;
    a--;
  }
  while (b < limit && at(b) && counts[2] < expected * 5) {
    counts[2]++;
    b++;
  }
  for (const k of [1, 0]) {
    const color = k === 0 ? 1 : 0;
    while (a >= 0 && at(a) === color && counts[k] < expected * 3) {
      counts[k]++;
      a--;
    }
  }
  for (const k of [3, 4]) {
    const color = k === 4 ? 1 : 0;
    while (b < limit && at(b) === color && counts[k] < expected * 3) {
      counts[k]++;
      b++;
    }
  }
  const m = ratio(counts);
  if (!m) return reject(a < 0 || b >= limit ? 'edge-or-ratio' : 'run-ratio');
  if (m / expected < 0.45 || m / expected > 1.8)
    return reject('module-disagreement', m);
  return { center: b - counts[4] - counts[3] - counts[2] / 2, module: m };
}
export function findPatterns(
  bits,
  w,
  h,
  audit = null,
  deadline = Infinity,
  knownCodes = [],
  enhanced = false,
) {
  const patterns = [];
  const started = performance.now();
  if (audit)
    Object.assign(audit, {
      rowsScanned: 0,
      ratioMatches: 0,
      verticalRejected: 0,
      horizontalRejected: 0,
      merged: 0,
      poolEvictions: 0,
      rejectedSamples: [],
      crossRejections: {},
      sampleBands: {},
    });
  for (let y = 0; y < h; y += h > 2200 ? 2 : 1) {
    if ((y & 31) === 0 && performance.now() > deadline) break;
    if (audit) audit.rowsScanned++;
    const runs = [];
    let start = 0,
      color = bits[y * w];
    for (let x = 1; x <= w; x++) {
      const next = x === w ? 1 - color : bits[y * w + x];
      if (next === color) continue;
      runs.push({ length: x - start, color });
      if (runs.length > 5) runs.shift();
      if (color === 1 && runs.length === 5 && runs[0].color === 1) {
        const lengths = runs.map((r) => r.length),
          m = ratio(lengths);
        if (m) {
          if (audit) audit.ratioMatches++;
          const cx = x - lengths[4] - lengths[3] - lengths[2] / 2,
            vertical = cross(bits, w, h, Math.floor(cx), y, true, m, audit);
          if (!vertical && audit) {
            audit.verticalRejected++;
          }
          if (vertical) {
            const cy = vertical.center,
              horizontal = cross(
                bits,
                w,
                h,
                Math.floor(cx),
                Math.floor(cy),
                false,
                m,
                audit,
              );
            if (!horizontal && audit) audit.horizontalRejected++;
            if (horizontal) {
              const p = {
                x: horizontal.center,
                y: cy,
                module: (m + vertical.module + horizontal.module) / 3,
                hits: 1,
              };
              const previous = patterns.find(
                (q) =>
                  distance(p, q) < Math.max(q.module, p.module) * 1.5 &&
                  Math.abs(q.module - p.module) < q.module,
              );
              if (previous) {
                if (audit) audit.merged++;
                const n = previous.hits;
                previous.x = (previous.x * n + p.x) / (n + 1);
                previous.y = (previous.y * n + p.y) / (n + 1);
                previous.module = (previous.module * n + p.module) / (n + 1);
                previous.hits++;
              } else {
                if (patterns.length >= 600) {
                  if (audit) audit.poolEvictions++;
                  let weakest = 0;
                  for (let i = 1; i < patterns.length; i++)
                    if (patterns[i].hits < patterns[weakest].hits) weakest = i;
                  patterns.splice(weakest, 1);
                }
                patterns.push(p);
              }
            }
          }
        }
      }
      color = next;
      start = x;
    }
  }
  for (const p of patterns) {
    let best = 0;
    for (const angle of [
      0,
      Math.PI / 12,
      Math.PI / 6,
      Math.PI / 4,
      Math.PI / 3,
      (5 * Math.PI) / 12,
    ]) {
      let correct = 0;
      const c = Math.cos(angle),
        s = Math.sin(angle),
        m = p.module * Math.max(c, s);
      for (let j = -3; j <= 3; j++)
        for (let i = -3; i <= 3; i++) {
          const x = Math.floor(p.x + (i * c - j * s) * m),
            y = Math.floor(p.y + (i * s + j * c) * m),
            d = Math.max(Math.abs(i), Math.abs(j)),
            expected = d === 3 || d <= 1 ? 1 : 0;
          if (
            x >= 0 &&
            y >= 0 &&
            x < w &&
            y < h &&
            bits[y * w + x] === expected
          )
            correct++;
        }
      if (correct > best) {
        best = correct;
        p.angle = angle;
      }
    }
    p.quality = best / 49;
  }
  // Recheck only promising rejected patterns; tolerate anisotropic print stretch.
  const refinements = patterns
    .filter((p) => p.hits >= 2 && p.quality >= 0.6 && p.quality < 0.76)
    .sort((a, b) => b.hits * b.quality - a.hits * a.quality)
    .slice(0, 48);
  if (audit) audit.refinements = [];
  for (const p of refinements) {
    if (performance.now() > deadline) break;
    const original = { ...p };
    let best = null;
    let strongest = null;
    function evaluate(angle, sx, sy, dx, dy) {
      const c = Math.cos(angle),
        s = Math.sin(angle),
        m = p.module * Math.max(c, s);
      let core = 0,
        light = 0,
        border = 0;
      for (let j = -3; j <= 3; j++)
        for (let i = -3; i <= 3; i++) {
          const x = Math.floor(p.x + dx * m + (i * c * sx - j * s * sy) * m),
            y = Math.floor(p.y + dy * m + (i * s * sx + j * c * sy) * m),
            d = Math.max(Math.abs(i), Math.abs(j));
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (bits[y * w + x] === (d === 3 || d <= 1 ? 1 : 0)) {
            if (d <= 1) core++;
            else if (d === 2) light++;
            else border++;
          }
        }
      const quality = (core + light + border) / 49,
        score =
          quality -
          0.008 *
            (Math.abs(dx) + Math.abs(dy) + Math.abs(sx - 1) + Math.abs(sy - 1));
      const fit = {
        x: p.x + dx * m,
        y: p.y + dy * m,
        module: p.module * Math.sqrt(sx * sy),
        quality,
        score,
        sx,
        sy,
        dx,
        dy,
        angle,
        core,
        light,
        border,
      };
      if (!strongest || score > strongest.score) strongest = fit;
      if (
        core >= 7 &&
        light >= 13 &&
        border >= 20 &&
        quality >= 0.84 &&
        (!best || score > best.score)
      )
        best = fit;
      return fit;
    }
    for (const sx of [0.85, 1, 1.15, 1.3])
      for (const sy of [0.85, 1, 1.15, 1.3])
        for (const dx of [-0.3, 0, 0.3])
          for (const dy of [-0.3, 0, 0.3])
            evaluate(p.angle ?? 0, sx, sy, dx, dy);
    if (!best)
      for (const angle of [
        0,
        Math.PI / 12,
        Math.PI / 6,
        Math.PI / 4,
        Math.PI / 3,
        (5 * Math.PI) / 12,
      ]) {
        let coarse = null;
        for (const sx of [0.85, 1, 1.15, 1.3])
          for (const sy of [0.85, 1, 1.15, 1.3]) {
            const f = evaluate(angle, sx, sy, 0, 0);
            if (!coarse || f.score > coarse.score) coarse = f;
          }
        for (const dx of [-0.6, -0.3, 0, 0.3, 0.6])
          for (const dy of [-0.6, -0.3, 0, 0.3, 0.6])
            evaluate(angle, coarse.sx, coarse.sy, dx, dy);
      }
    if (best)
      Object.assign(p, {
        x: best.x,
        y: best.y,
        module: best.module,
        quality: best.quality,
        refined: true,
      });
    if (audit)
      audit.refinements.push({
        original,
        result: best,
        strongestRejected: best ? null : strongest,
        accepted: !!best,
      });
  }
  const projectiveCandidates = patterns
    .filter((p) => p.hits >= 3 && p.quality >= 0.5 && p.quality < 0.76)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 64);
  if (audit) audit.projectiveRefinements = [];
  for (const p of projectiveCandidates) {
    if (performance.now() > deadline) break;
    const result = verifyProjectiveFinder(bits, w, h, p, { deadline });
    if (audit)
      audit.projectiveRefinements.push({ original: { ...p }, ...result });
    if (result.accepted)
      Object.assign(p, {
        x: result.center.x,
        y: result.center.y,
        quality: result.quality,
        projective: true,
      });
  }
  if (audit) audit.pairPredictions = [];
  patterns.push(
    ...completeFinderPairs(bits, w, h, patterns, {
      deadline,
      knownCodes,
      contains: inside,
      audit: audit?.pairPredictions,
    }),
  );
  if (enhanced) {
    if (audit) audit.componentFinders = [];
    patterns.push(
      ...componentFinders(bits, w, h, {
        deadline,
        known: patterns.filter((p) => p.quality >= 0.76),
        audit: audit?.componentFinders,
      }),
    );
  }
  // Independent refinements can converge on the same physical finder.
  const unique = [];
  for (const p of patterns.sort(
    (a, b) => b.quality * b.hits - a.quality * a.hits,
  )) {
    if (
      !unique.some(
        (q) =>
          Math.hypot(p.x - q.x, p.y - q.y) <
            Math.min(p.module, q.module) * 0.6 &&
          Math.max(p.module, q.module) < Math.min(p.module, q.module) * 1.5,
      )
    )
      unique.push(p);
  }
  patterns.splice(0, patterns.length, ...unique);
  const selected = patterns
    .filter(
      (p) =>
        p.hits >= 2 &&
        (p.quality >= 0.76 || p.componentVerified) &&
        !knownCodes.some((c) => inside(p, c.corners)),
    )
    .sort((a, b) => b.quality ** 4 * b.hits - a.quality ** 4 * a.hits)
    .slice(0, 256);
  if (audit)
    Object.assign(audit, {
      rawCandidates: patterns.length,
      lowSupport: patterns.filter((p) => p.hits < 2).length,
      lowQuality: patterns.filter((p) => p.hits >= 2 && p.quality < 0.76)
        .length,
      selected: selected.length,
      candidates: patterns
        .filter((p) => p.hits >= 2)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 600)
        .map((p) => ({
          ...p,
          accepted: selected.includes(p),
          rejection:
            p.quality < 0.76 && !p.componentVerified
              ? 'shape-quality'
              : knownCodes.some((c) => inside(p, c.corners))
                ? 'already-decoded-region'
                : !selected.includes(p)
                  ? 'candidate-limit'
                  : null,
        })),
      elapsedMs: performance.now() - started,
      timedOut: performance.now() > deadline,
    });
  return selected;
}
function triples(points, audit = null, deadline = Infinity) {
  const groups = [];
  if (audit)
    Object.assign(audit, {
      combinations: 0,
      rejectedScale: 0,
      rejectedAngle: 0,
      rejectedDimension: 0,
    });
  const visited = new Set();
  for (let i = 0; i < points.length; i++) {
    if (performance.now() > deadline) break;
    const neighbors = points
      .map((p, index) => ({ p, index, d: distance(p, points[i]) }))
      .filter((p) => p.index !== i);
    if (points.length > 12) neighbors.sort((a, b) => a.d - b.d).splice(16);
    for (let jj = 0; jj < neighbors.length; jj++)
      for (let kk = jj + 1; kk < neighbors.length; kk++) {
        const j = neighbors[jj].index,
          k = neighbors[kk].index;
        const key = [i, j, k].sort((a, b) => a - b).join(',');
        if (visited.has(key)) continue;
        visited.add(key);
        if (audit) audit.combinations++;
        const p = [points[i], points[j], points[k]];
        const distances = [
          distance(p[1], p[2]),
          distance(p[0], p[2]),
          distance(p[0], p[1]),
        ];
        const longest = distances.indexOf(Math.max(...distances));
        // Perspective can change which observed side is longest. Test each
        // plausible right-angle assignment; sampled geometry still must pass.
        for (const index of [
          longest,
          ...[0, 1, 2].filter((i) => i !== longest),
        ]) {
          const tl = p[index];
          let [tr, bl] = p.filter((_, n) => n !== index);
          const a = distance(tl, tr),
            b = distance(tl, bl),
            m = (tl.module + tr.module + bl.module) / 3,
            axis =
              (Math.max(Math.abs(tr.x - tl.x), Math.abs(tr.y - tl.y)) / a +
                Math.max(Math.abs(bl.x - tl.x), Math.abs(bl.y - tl.y)) / b) /
              2;
          if (!Number.isFinite(axis)) continue;
          if (
            Math.min(a, b) < m * axis * 10 ||
            a / b < 0.4 ||
            a / b > 2.5 ||
            Math.max(tl.module, tr.module, bl.module) >
              2.3 * Math.min(tl.module, tr.module, bl.module)
          ) {
            if (audit) audit.rejectedScale++;
            continue;
          }
          const dot =
            ((tr.x - tl.x) * (bl.x - tl.x) + (tr.y - tl.y) * (bl.y - tl.y)) /
            (a * b);
          if (Math.abs(dot) > 0.65) {
            if (audit) audit.rejectedAngle++;
            continue;
          }
          if ((tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x) < 0)
            [tr, bl] = [bl, tr];
          const dimension = (a + b) / (2 * m * axis) + 7;
          if (dimension < 17 || dimension > 185) {
            if (audit) audit.rejectedDimension++;
            continue;
          }
          groups.push({
            tl,
            tr,
            bl,
            estimate: Math.round((dimension - 17) / 4) * 4 + 17,
            projectiveOnly: Math.abs(dot) > 0.42,
            geometry: {
              angleCosine: dot,
              rawModule: m,
              rotationFactor: axis,
              minimumSpacingModules: Math.min(a, b) / (m * axis),
            },
            score:
              (tl.hits + tr.hits + bl.hits) /
              ((1 + Math.abs(dot) * 10) *
                (points.length > 12 ? 1 + (a + b) / (m * 20) : 1)),
          });
        }
      }
  }
  const selected = groups
    .sort((a, b) => b.score - a.score)
    .slice(0, points.length > 12 ? 512 : 50);
  if (audit)
    Object.assign(audit, {
      accepted: groups.length,
      truncated: groups.length - selected.length,
      groups: selected,
    });
  return selected;
}
export function homography(from, to) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i],
      { x: u, y: v } = to[i];
    rows.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++)
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    if (Math.abs(rows[pivot][col]) < 1e-9)
      throw Error('Degenerate QR geometry');
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const d = rows[col][col];
    for (let c = col; c < 9; c++) rows[col][c] /= d;
    for (let r = 0; r < 8; r++)
      if (r !== col) {
        const s = rows[r][col];
        for (let c = col; c < 9; c++) rows[r][c] -= s * rows[col][c];
      }
  }
  const a = rows.map((r) => r[8]);
  return (x, y) => {
    const z = a[6] * x + a[7] * y + 1;
    return {
      x: (a[0] * x + a[1] * y + a[2]) / z,
      y: (a[3] * x + a[4] * y + a[5]) / z,
    };
  };
}
function alignmentCandidates(bits, w, h, group, n) {
  const { tl, tr, bl } = group,
    ux = (tr.x - tl.x) / (n - 7),
    uy = (tr.y - tl.y) / (n - 7),
    vx = (bl.x - tl.x) / (n - 7),
    vy = (bl.y - tl.y) / (n - 7);
  const prediction = {
      x: tl.x + (ux + vx) * (n - 10),
      y: tl.y + (uy + vy) * (n - 10),
    },
    m = (Math.hypot(ux, uy) + Math.hypot(vx, vy)) / 2;
  const radius = Math.ceil(m * 5),
    step = Math.max(1, Math.floor(m / 2)),
    found = [];
  for (
    let y = Math.max(0, Math.floor(prediction.y - radius));
    y < Math.min(h, prediction.y + radius);
    y += step
  )
    for (
      let x = Math.max(0, Math.floor(prediction.x - radius));
      x < Math.min(w, prediction.x + radius);
      x += step
    ) {
      if (!bits[y * w + x]) continue;
      let error = 0;
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) {
          const xx = Math.floor(x + i * ux + j * vx),
            yy = Math.floor(y + i * uy + j * vy),
            expected =
              Math.max(Math.abs(i), Math.abs(j)) === 2 || (i === 0 && j === 0)
                ? 1
                : 0;
          if (
            xx < 0 ||
            yy < 0 ||
            xx >= w ||
            yy >= h ||
            bits[yy * w + xx] !== expected
          )
            error++;
        }
      if (error <= 4)
        found.push({
          x: x + 0.5,
          y: y + 0.5,
          score: error + distance({ x, y }, prediction) / Math.max(1, m * 10),
        });
    }
  found.sort((a, b) => a.score - b.score);
  const result = [];
  for (const p of found) {
    if (result.every((q) => distance(q, p) > m * 1.5)) result.push(p);
    if (result.length === 3) break;
  }
  return result;
}
export function sample(
  bits,
  w,
  h,
  map,
  n,
  offset = 0,
  audit = null,
  mode = 'center',
) {
  const grid = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const ox = typeof offset === 'number' ? offset : offset.x,
        oy = typeof offset === 'number' ? offset : offset.y;
      const p = map(x + 0.5 + ox, y + 0.5 + oy),
        xx = Math.floor(p.x),
        yy = Math.floor(p.y);
      if (
        !Number.isFinite(xx) ||
        !Number.isFinite(yy) ||
        xx < 0 ||
        yy < 0 ||
        xx >= w ||
        yy >= h
      ) {
        if (audit) audit.rejection = 'out-of-bounds';
        return null;
      }
      grid[y * n + x] = bits[yy * w + xx];
      if (mode !== 'center') {
        let dark = 0,
          count = 0;
        for (const dy of [-0.22, 0, 0.22])
          for (const dx of [-0.22, 0, 0.22]) {
            const q = map(x + 0.5 + ox + dx, y + 0.5 + oy + dy),
              qx = Math.floor(q.x),
              qy = Math.floor(q.y);
            if (qx >= 0 && qy >= 0 && qx < w && qy < h) {
              dark += bits[qy * w + qx];
              count++;
            }
          }
        grid[y * n + x] =
          dark >= (mode === 'majority' ? count / 2 : count / 3) ? 1 : 0;
      }
    }
  const finderErrors = [];
  for (const [left, top] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ]) {
    let errors = 0;
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3)),
          expected = d === 3 || d <= 1 ? 1 : 0;
        if (grid[(top + y) * n + left + x] !== expected) errors++;
      }
    finderErrors.push(errors);
  }
  const sorted = finderErrors.slice().sort((a, b) => a - b);
  const strict = finderErrors.every((n) => n <= 12);
  // One worn corner can be supported by two strong corners; decoded data must
  // still pass all existing BCH and Reed–Solomon checks.
  const supported =
    sorted[0] <= 6 &&
    sorted[1] <= 6 &&
    sorted[2] <= 20 &&
    sorted.reduce((a, b) => a + b, 0) <= 24;
  if (audit)
    Object.assign(audit, {
      finderErrors,
      validation: strict
        ? 'strict'
        : supported
          ? 'two-strong-corners'
          : 'rejected',
      rejection: !strict && !supported ? 'finder-shape' : null,
    });
  if (!strict && !supported) return null;
  return grid;
}
function packedGrid(grid) {
  const bytes = new Uint8Array(Math.ceil(grid.length / 8));
  for (let i = 0; i < grid.length; i++)
    if (grid[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function gridEvidence(grid, n, audit) {
  let horizontal = 0,
    vertical = 0,
    alignment = 0;
  for (let i = 8; i < n - 8; i++) {
    horizontal += grid[6 * n + i] !== (i & 1 ? 0 : 1);
    vertical += grid[i * n + 6] !== (i & 1 ? 0 : 1);
  }
  if (n > 21)
    for (let y = -2; y <= 2; y++)
      for (let x = -2; x <= 2; x++) {
        const d = Math.max(Math.abs(x), Math.abs(y));
        alignment +=
          grid[(n - 7 + y) * n + n - 7 + x] !== (d === 2 || d === 0 ? 1 : 0);
      }
  const timingModules = Math.max(1, n - 16),
    finderErrors = audit.finderErrors.reduce((a, b) => a + b, 0);
  return {
    horizontalTimingErrors: horizontal,
    verticalTimingErrors: vertical,
    timingModulesPerAxis: timingModules,
    bottomAlignmentErrors: n > 21 ? alignment : null,
    finderErrors,
    score:
      finderErrors / 147 +
      (horizontal + vertical) / (2 * timingModules) +
      (n > 21 ? alignment / 25 : 0),
  };
}
export function scanBinary(
  bits,
  w,
  h,
  {
    deadline = Infinity,
    maxResults = 256,
    trace = false,
    knownCodes = [],
    gray = null,
    enhanced = false,
    extraFinders = [],
  } = {},
) {
  const detection = trace ? {} : null,
    grouping = trace ? {} : null;
  const measured = findPatterns(
      bits,
      w,
      h,
      detection,
      deadline,
      knownCodes,
      enhanced,
    ),
    patterns = extraFinders.length
      ? mergeFinderObservations(measured, extraFinders)
      : measured,
    groups = triples(patterns, grouping, deadline),
    results = [];
  const errors = [];
  const hypotheses = [];
  const regionTrace = trace ? [] : null;
  const failedSamples = trace ? new FailureGridLog() : null;
  const covered = (group) =>
    [...knownCodes, ...results].some(
      (c) =>
        inside(group.tl, c.corners) &&
        inside(group.tr, c.corners) &&
        inside(group.bl, c.corners),
    );
  const sampling = trace
    ? { outOfBounds: 0, shapeRejected: 0, closestRejected: null }
    : null;
  let sampledGrids = 0,
    rejectedGrids = 0;
  let furthestStage = groups.length ? 'alignment' : 'detection';
  let candidates = 0,
    lastError = 'No QR grid found';
  for (const group of groups) {
    if (performance.now() > deadline) break;
    if (
      results.some(
        (r) => distance(group.tl, r.finders.tl) < group.tl.module * 4,
      )
    )
      continue;
    const region = trace
      ? {
          finders: [group.tl, group.tr, group.bl],
          estimate: group.estimate,
          geometry: group.geometry,
          projectiveOnly: group.projectiveOnly,
          sampled: 0,
          shapeRejected: 0,
          stages: {},
          decoded: false,
        }
      : null;
    if (region) regionTrace.push(region);
    let borders;
    for (const delta of [0, -4, 4, -8, 8, -12, 12]) {
      const n = group.estimate + delta;
      if (n < 21 || n > 177) continue;
      const { tl, tr, bl } = group,
        br = { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y };
      const maps = [];
      const base = [
        [3.5, 3.5],
        [n - 3.5, 3.5],
        [3.5, n - 3.5],
      ];
      if (n > 21 && !group.projectiveOnly)
        for (const align of alignmentCandidates(bits, w, h, group, n))
          maps.push(
            homography([...base, [n - 6.5, n - 6.5]], [tl, tr, bl, align]),
          );
      if (!group.projectiveOnly)
        maps.push(homography([...base, [n - 3.5, n - 3.5]], [tl, tr, bl, br]));
      if (n <= 45 || group.projectiveOnly) {
        borders ??= finderBorders(bits, w, h, group, { deadline });
        const fit = fitFinderMap(borders, n);
        if (fit) maps.push(fit.map);
        if (enhanced) maps.push(...curvedFinderMaps(borders, n));
        if (region) {
          region.finderBorders = borders.trace;
          (region.projectiveFits ??= []).push({
            dimension: n,
            residualModules: fit?.residualModules ?? null,
          });
        }
      }
      let success = false;
      for (const map of maps) {
        for (const offset of [0, -0.2, 0.2]) {
          if (performance.now() > deadline) break;
          const sampleAudit = { curvedGeometry: map.curvedGeometry };
          const grid = sample(bits, w, h, map, n, offset, sampleAudit);
          sampledGrids++;
          if (region) region.sampled++;
          if (!grid) {
            if (region) region.shapeRejected++;
            if (sampling) {
              if (sampleAudit.rejection === 'out-of-bounds')
                sampling.outOfBounds++;
              else {
                sampling.shapeRejected++;
                const score = sampleAudit.finderErrors.reduce(
                  (a, b) => a + b,
                  0,
                );
                if (
                  !sampling.closestRejected ||
                  score < sampling.closestRejected.score
                )
                  sampling.closestRejected = {
                    score,
                    gridSize: n,
                    offset,
                    ...sampleAudit,
                    corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
                  };
              }
            }
            rejectedGrids++;
            continue;
          }
          candidates++;
          const evidence = gridEvidence(grid, n, sampleAudit);
          const decoderAudit = trace ? {} : null;
          try {
            const decoded = decodeMatrix(grid, n, decoderAudit);
            results.push({
              ...decoded,
              corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
              finders: group,
              engine: ENGINE_VERSION,
              ...(trace
                ? {
                    gridBits: packedGrid(grid),
                    decoderTrace: decoderAudit,
                    samplingTrace: sampleAudit,
                  }
                : {}),
            });
            success = true;
            if (region) region.decoded = true;
            break;
          } catch (e) {
            failedSamples?.record(
              grid,
              n,
              map,
              {
                mode: 'binary',
                offset,
                error: e.message,
                curvedGeometry: map.curvedGeometry,
              },
              decoderAudit,
            );
            lastError = e.message;
            // Retain a bounded set of plausible grids, using known QR patterns
            // rather than any expected receipt value to rank them.
            const hypothesis = {
              map,
              n,
              offset,
              evidence,
              group,
              ...(trace ? { gridBits: packedGrid(grid) } : {}),
            };
            // Preserve recovery candidates per finder group; one easy symbol
            // must not displace every hypothesis belonging to its neighbors.
            const regional = hypotheses.filter((h) => h.group === group);
            if (regional.length < 12) hypotheses.push(hypothesis);
            else {
              const worst = regional.reduce((a, b) =>
                a.evidence.score > b.evidence.score ? a : b,
              );
              if (hypothesis.evidence.score < worst.evidence.score)
                hypotheses.splice(hypotheses.indexOf(worst), 1, hypothesis);
            }
            hypotheses.sort((a, b) => a.evidence.score - b.evidence.score);
            if (hypotheses.length > 192) hypotheses.length = 192;
            if (!trace) continue;
            const stage = decoderAudit.stage ?? errorStage(e.message);
            if (region) region.stages[stage] = (region.stages[stage] ?? 0) + 1;
            if (STAGES.indexOf(stage) > STAGES.indexOf(furthestStage))
              furthestStage = stage;
            const existing = errors.find((r) => r.message === e.message);
            if (existing) existing.count++;
            else if (errors.length < 16)
              errors.push({
                stage,
                message: e.message,
                count: 1,
                sample: {
                  gridSize: n,
                  offset,
                  finderErrors: sampleAudit.finderErrors,
                  decoder: decoderAudit,
                  evidence,
                  corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
                },
              });
          }
        }
        if (success) break;
      }
      if (success) break;
    }
    if (results.length >= maxResults) break;
  }
  const recoveryTrace = trace ? [] : null;
  const pending = (limit) => {
    const counts = new Map();
    return hypotheses.filter((h) => {
      if (covered(h.group)) return false;
      const count = counts.get(h.group) ?? 0;
      counts.set(h.group, count + 1);
      return count < limit;
    });
  };
  for (const hypothesis of pending(6)) {
    if (covered(hypothesis.group)) continue;
    if (performance.now() > deadline) break;
    const { map, n, offset, group } = hypothesis;
    const trials = [
      { mode: 'majority', offset },
      { mode: 'dark-third', offset },
    ];
    if (hypothesis.evidence.score < 0.35)
      for (const dx of [-0.25, 0, 0.25])
        for (const dy of [-0.25, 0, 0.25]) {
          if (!dx && !dy) continue;
          for (const mode of ['center', 'majority', 'dark-third'])
            trials.push({ mode, offset: { x: offset + dx, y: offset + dy } });
        }
    for (const trial of trials) {
      const { mode, offset: trialOffset } = trial;
      if (performance.now() > deadline) break;
      const audit = {},
        grid = sample(bits, w, h, map, n, trialOffset, audit, mode);
      if (!grid) continue;
      const decoderAudit = trace ? {} : null;
      const evidence = gridEvidence(grid, n, audit);
      try {
        const decoded = decodeMatrix(grid, n, decoderAudit);
        results.push({
          ...decoded,
          corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
          finders: group,
          engine: ENGINE_VERSION,
          samplingMode: mode,
          ...(trace
            ? {
                gridBits: packedGrid(grid),
                decoderTrace: decoderAudit,
                samplingTrace: { ...audit, offset: trialOffset },
              }
            : {}),
        });
        if (recoveryTrace)
          recoveryTrace.push({
            mode,
            gridSize: n,
            offset: trialOffset,
            evidence,
            decoded: true,
          });
        break;
      } catch (error) {
        failedSamples?.record(
          grid,
          n,
          map,
          {
            mode,
            offset: trialOffset,
            error: error.message,
            curvedGeometry: map.curvedGeometry,
          },
          decoderAudit,
        );
        if (recoveryTrace)
          recoveryTrace.push({
            corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
            mode,
            gridSize: n,
            offset: trialOffset,
            evidence,
            error: error.message,
            decoder: decoderAudit,
          });
      }
    }
    if (results.length >= maxResults) break;
  }
  if (gray) {
    const seen = new Set();
    for (const { map, n, group } of pending(3)) {
      if (performance.now() > deadline) break;
      if (covered(group) || seen.has(map)) continue;
      seen.add(map);
      const offsets = [{ x: 0, y: 0 }];
      if (n <= 45)
        for (const x of [-0.15, 0, 0.15])
          for (const y of [-0.15, 0, 0.15]) if (x || y) offsets.push({ x, y });
      for (const offset of offsets) {
        if (covered(group) || performance.now() > deadline) break;
        for (const trial of grayGridTrials(gray, w, h, map, n, {
          deadline,
          offset,
          deblur: enhanced,
        })) {
          if (performance.now() > deadline) break;
          if (!trial.trace.shapeAccepted) {
            if (recoveryTrace)
              recoveryTrace.push({
                ...trial.trace,
                gridSize: n,
                corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
                rejection: 'finder-shape',
              });
            continue;
          }
          const decoderAudit = trace ? {} : null;
          const corners = [map(0, 0), map(n, 0), map(n, n), map(0, n)];
          try {
            const decoded = decodeMatrix(
              trial.grid,
              n,
              decoderAudit,
              enhanced ? { confidence: trial.confidence } : {},
            );
            results.push({
              ...decoded,
              corners,
              finders: group,
              engine: ENGINE_VERSION,
              samplingMode: 'local-gray',
              ...(trace
                ? {
                    gridBits: packedGrid(trial.grid),
                    decoderTrace: decoderAudit,
                    samplingTrace: {
                      ...trial.trace,
                      curvedGeometry: map.curvedGeometry,
                    },
                  }
                : {}),
            });
            if (recoveryTrace)
              recoveryTrace.push({
                ...trial.trace,
                gridSize: n,
                decoded: true,
                decoder: decoderAudit,
                corners,
              });
            break;
          } catch (error) {
            failedSamples?.record(
              trial.grid,
              n,
              map,
              {
                ...trial.trace,
                mode: 'local-gray',
                offset,
                error: error.message,
                curvedGeometry: map.curvedGeometry,
              },
              decoderAudit,
              trial.confidence,
            );
            if (recoveryTrace)
              recoveryTrace.push({
                ...trial.trace,
                gridSize: n,
                corners,
                error: error.message,
                decoder: decoderAudit,
              });
          }
        }
      }
    }
  }
  for (const hypothesis of pending(3)) {
    if (covered(hypothesis.group)) continue;
    if (performance.now() > deadline) break;
    if (hypothesis.evidence.score > 0.4) continue;
    const { map, n, group } = hypothesis,
      warp = timingWarp(bits, w, h, map, n);
    const warpTrials = ['center', 'majority', 'dark-third'].map((mode) => ({
      axis: 'both',
      mapper: warp.map,
      offset: 0,
      mode,
    }));
    for (const trial of warpTrials) {
      if (performance.now() > deadline) break;
      const { mode, mapper, offset, axis } = trial;
      const audit = {},
        grid = sample(bits, w, h, mapper, n, offset, audit, mode);
      if (!grid) continue;
      const evidence = gridEvidence(grid, n, audit),
        decoderAudit = trace ? {} : null;
      try {
        const decoded = decodeMatrix(grid, n, decoderAudit);
        results.push({
          ...decoded,
          corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
          finders: group,
          engine: ENGINE_VERSION,
          samplingMode: 'timing-warp-' + mode,
          ...(trace
            ? {
                gridBits: packedGrid(grid),
                decoderTrace: decoderAudit,
                samplingTrace: { ...audit, offset, axis, warp: warp.trace },
              }
            : {}),
        });
        if (recoveryTrace)
          recoveryTrace.push({
            mode: 'timing-warp-' + mode,
            axis,
            offset,
            gridSize: n,
            evidence,
            decoded: true,
            warp: warp.trace,
          });
        break;
      } catch (error) {
        failedSamples?.record(
          grid,
          n,
          mapper,
          {
            mode: 'timing-warp-' + mode,
            offset,
            warp: warp.trace,
            baseCorners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
            baseCurvedGeometry: map.curvedGeometry,
            error: error.message,
          },
          decoderAudit,
        );
        if (recoveryTrace)
          recoveryTrace.push({
            mode: 'timing-warp-' + mode,
            axis,
            offset,
            gridSize: n,
            evidence,
            error: error.message,
            decoder: decoderAudit,
            warp: warp.trace,
            gridBits: packedGrid(grid),
            corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
          });
      }
    }
    if (results.length >= maxResults) break;
  }
  {
    const seenMaps = new Set();
    const candidates = pending(12).filter((hypothesis) => {
      if (
        hypothesis.n < 21 ||
        hypothesis.evidence.score > 0.4 ||
        seenMaps.has(hypothesis.map)
      )
        return false;
      seenMaps.add(hypothesis.map);
      return true;
    });
    const regionalMaps = new Map();
    for (const { map, n, group, evidence: before } of candidates) {
      if (covered(group) || (regionalMaps.get(group) ?? 0) >= 3) continue;
      regionalMaps.set(group, (regionalMaps.get(group) ?? 0) + 1);
      if (performance.now() > deadline) break;
      const warp = edgeWarp(bits, w, h, map, n, { deadline });
      if (!warp) continue;
      for (const mode of ['center', 'majority', 'dark-third']) {
        if (performance.now() > deadline) break;
        const audit = {},
          grid = sample(bits, w, h, warp.map, n, 0, audit, mode);
        if (!grid) {
          if (recoveryTrace)
            recoveryTrace.push({
              mode: 'edge-warp-' + mode,
              gridSize: n,
              rejection: audit.rejection,
              sampling: audit,
            });
          continue;
        }
        const evidence = gridEvidence(grid, n, audit),
          decoderAudit = trace ? {} : null,
          corners = [map(0, 0), map(n, 0), map(n, n), map(0, n)];
        try {
          const decoded = decodeMatrix(grid, n, decoderAudit);
          results.push({
            ...decoded,
            corners,
            finders: group,
            engine: ENGINE_VERSION,
            samplingMode: 'edge-warp-' + mode,
            ...(trace
              ? {
                  gridBits: packedGrid(grid),
                  decoderTrace: decoderAudit,
                  samplingTrace: {
                    ...audit,
                    offset: 0,
                    warp: warp.trace,
                    baseCurvedGeometry: map.curvedGeometry,
                  },
                }
              : {}),
          });
          if (recoveryTrace)
            recoveryTrace.push({
              mode: 'edge-warp-' + mode,
              gridSize: n,
              evidenceBefore: before,
              evidence,
              decoded: true,
              decoder: decoderAudit,
              warp: warp.trace,
            });
          break;
        } catch (error) {
          failedSamples?.record(
            grid,
            n,
            warp.map,
            {
              mode: 'edge-warp-' + mode,
              warp: warp.trace,
              baseCorners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
              baseCurvedGeometry: map.curvedGeometry,
              error: error.message,
            },
            decoderAudit,
          );
          if (recoveryTrace)
            recoveryTrace.push({
              mode: 'edge-warp-' + mode,
              gridSize: n,
              evidenceBefore: before,
              evidence,
              error: error.message,
              decoder: decoderAudit,
              warp: warp.trace,
              gridBits: packedGrid(grid),
              corners,
            });
        }
      }
      if (enhanced && gray && !covered(group)) {
        for (const offset of [
          { x: 0, y: 0 },
          { x: -0.15, y: 0 },
          { x: 0.15, y: 0 },
          { x: 0, y: -0.15 },
          { x: 0, y: 0.15 },
        ]) {
          if (performance.now() > deadline || covered(group)) break;
          for (const trial of grayGridTrials(gray, w, h, warp.map, n, {
            deadline,
            offset,
            deblur: true,
          })) {
            if (performance.now() > deadline) break;
            if (!trial.trace.shapeAccepted) continue;
            const audit = trace ? {} : null,
              corners = [map(0, 0), map(n, 0), map(n, n), map(0, n)];
            const metadata = {
              ...trial.trace,
              mode: 'edge-warp-gray',
              warp: warp.trace,
              baseCorners: corners,
              baseCurvedGeometry: map.curvedGeometry,
            };
            try {
              const decoded = decodeMatrix(trial.grid, n, audit, {
                confidence: trial.confidence,
              });
              results.push({
                ...decoded,
                corners,
                finders: group,
                engine: ENGINE_VERSION,
                samplingMode: 'edge-warp-gray',
                ...(trace
                  ? {
                      gridBits: packedGrid(trial.grid),
                      decoderTrace: audit,
                      samplingTrace: metadata,
                    }
                  : {}),
              });
              recoveryTrace?.push({
                ...metadata,
                corners,
                gridSize: n,
                decoded: true,
                decoder: audit,
              });
              break;
            } catch (error) {
              failedSamples?.record(
                trial.grid,
                n,
                warp.map,
                { ...metadata, error: error.message },
                audit,
                trial.confidence,
              );
              recoveryTrace?.push({
                ...metadata,
                corners,
                gridSize: n,
                error: error.message,
                decoder: audit,
              });
            }
          }
        }
      }
      if (results.length >= maxResults) break;
    }
  }
  if (enhanced && gray) {
    const seen = new Set();
    for (const hypothesis of pending(3)) {
      if (performance.now() > deadline) break;
      const { map: base, n, group } = hypothesis;
      if (covered(group) || seen.has(base)) continue;
      seen.add(base);
      const map = refineMap(gray, w, h, base, n, { deadline });
      if (!map) continue;
      for (const trial of grayGridTrials(gray, w, h, map, n, {
        deadline,
        deblur: true,
      })) {
        if (performance.now() > deadline) break;
        if (!trial.trace.shapeAccepted) continue;
        const audit = trace ? {} : null;
        try {
          const decoded = decodeMatrix(trial.grid, n, audit, {
            confidence: trial.confidence,
          });
          results.push({
            ...decoded,
            corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
            finders: group,
            engine: ENGINE_VERSION,
            samplingMode: 'registered-gray',
            ...(trace
              ? {
                  gridBits: packedGrid(trial.grid),
                  decoderTrace: audit,
                  samplingTrace: {
                    ...trial.trace,
                    registration: map.registration,
                  },
                }
              : {}),
          });
          if (recoveryTrace)
            recoveryTrace.push({
              ...trial.trace,
              gridSize: n,
              decoded: true,
              registration: map.registration,
            });
          break;
        } catch (error) {
          failedSamples?.record(
            trial.grid,
            n,
            map,
            {
              ...trial.trace,
              mode: 'registered-gray',
              error: error.message,
              registration: map.registration,
            },
            audit,
            trial.confidence,
          );
          if (recoveryTrace)
            recoveryTrace.push({
              corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
              ...trial.trace,
              gridSize: n,
              registration: map.registration,
              error: error.message,
              decoder: audit,
            });
        }
      }
    }
  }
  if (enhanced && gray) {
    const seen = new Set();
    for (const { map: base, n, group } of pending(2)) {
      if (performance.now() > deadline) break;
      if (covered(group) || seen.has(base)) continue;
      seen.add(base);
      for (const map of latticePhase(gray, w, h, base, n, { deadline })) {
        if (covered(group) || performance.now() > deadline) break;
        for (const trial of grayGridTrials(gray, w, h, map, n, {
          deadline,
          deblur: true,
        })) {
          if (performance.now() > deadline) break;
          if (!trial.trace.shapeAccepted) continue;
          const audit = trace ? {} : null;
          try {
            const decoded = decodeMatrix(trial.grid, n, audit, {
              confidence: trial.confidence,
            });
            results.push({
              ...decoded,
              corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
              finders: group,
              engine: ENGINE_VERSION,
              samplingMode: 'scanline-phase-gray',
              ...(trace
                ? {
                    gridBits: packedGrid(trial.grid),
                    decoderTrace: audit,
                    samplingTrace: {
                      ...trial.trace,
                      latticePhase: map.latticePhase,
                    },
                  }
                : {}),
            });
            if (recoveryTrace)
              recoveryTrace.push({
                mode: 'scanline-phase-gray',
                gridSize: n,
                decoded: true,
                axis: map.latticePhase.axis,
              });
            break;
          } catch (error) {
            failedSamples?.record(
              trial.grid,
              n,
              map,
              {
                ...trial.trace,
                mode: 'scanline-phase-gray',
                error: error.message,
                latticePhase: map.latticePhase,
              },
              audit,
              trial.confidence,
            );
            if (recoveryTrace)
              recoveryTrace.push({
                corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
                mode: 'scanline-phase-gray',
                gridSize: n,
                axis: map.latticePhase.axis,
                error: error.message,
                decoder: audit,
              });
          }
        }
      }
    }
  }
  if (enhanced && gray) {
    const seen = new Set();
    for (const { n, group } of pending(12)) {
      if (performance.now() > deadline) break;
      const key = [
        group.tl.x,
        group.tl.y,
        group.tr.x,
        group.tr.y,
        group.bl.x,
        group.bl.y,
        n,
      ].join(',');
      if (covered(group) || seen.has(key)) continue;
      seen.add(key);
      if (seen.size > 3) break;
      const borders = finderCoreBorders(bits, w, h, group, { deadline });
      if (!borders) continue;
      const fit = fitFinderMap(borders, n),
        maps = curvedFinderMaps(borders, n);
      if (fit) maps.unshift(fit.map);
      for (const map of maps) {
        if (covered(group) || performance.now() > deadline) break;
        for (const trial of grayGridTrials(gray, w, h, map, n, {
          deadline,
          deblur: true,
        })) {
          if (performance.now() > deadline) break;
          if (!trial.trace.shapeAccepted) continue;
          const audit = trace ? {} : null;
          try {
            const decoded = decodeMatrix(trial.grid, n, audit, {
              confidence: trial.confidence,
            });
            results.push({
              ...decoded,
              corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
              finders: group,
              engine: ENGINE_VERSION,
              samplingMode: 'core-border-gray',
              ...(trace
                ? {
                    gridBits: packedGrid(trial.grid),
                    decoderTrace: audit,
                    samplingTrace: {
                      ...trial.trace,
                      coreBorders: borders,
                      curvedGeometry: map.curvedGeometry ?? null,
                    },
                  }
                : {}),
            });
            if (recoveryTrace)
              recoveryTrace.push({
                mode: 'core-border-gray',
                gridSize: n,
                decoded: true,
              });
            break;
          } catch (error) {
            failedSamples?.record(
              trial.grid,
              n,
              map,
              {
                ...trial.trace,
                mode: 'core-border-gray',
                error: error.message,
                coreBorders: borders,
                curvedGeometry: map.curvedGeometry,
              },
              audit,
              trial.confidence,
            );
            if (recoveryTrace)
              recoveryTrace.push({
                corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
                mode: 'core-border-gray',
                gridSize: n,
                error: error.message,
                decoder: audit,
              });
          }
        }
      }
    }
  }
  const twoBorderAudit = trace ? {} : null;
  if (enhanced && gray) {
    for (const { map, n, group, missing } of twoBorderMaps(
      patterns,
      bits,
      w,
      h,
      { deadline, known: [...knownCodes, ...results], audit: twoBorderAudit },
    )) {
      if (performance.now() > deadline) break;
      if (covered(group)) continue;
      for (const trial of grayGridTrials(gray, w, h, map, n, { deadline })) {
        if (performance.now() > deadline) break;
        if (!twoBorderEvidence(trial.grid, n, missing)) continue;
        const audit = {};
        try {
          const decoded = decodeMatrix(trial.grid, n, audit);
          if (
            decoded.formatCorrections !== 0 ||
            audit.repair.blocks.some(
              (b) =>
                (b.capacityUsed ?? b.correctedCodewords * 2) >
                b.eccCodewords - 4,
            )
          )
            throw Error('Strict two-finder format/parity gate');
          results.push({
            ...decoded,
            corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
            finders: group,
            engine: ENGINE_VERSION,
            samplingMode: 'two-border-gray',
            ...(trace
              ? {
                  gridBits: packedGrid(trial.grid),
                  decoderTrace: audit,
                  samplingTrace: {
                    ...trial.trace,
                    twoBorderGeometry: map.twoBorderGeometry,
                  },
                }
              : {}),
          });
          if (recoveryTrace)
            recoveryTrace.push({
              mode: 'two-border-gray',
              gridSize: n,
              decoded: true,
              geometry: map.twoBorderGeometry,
            });
          break;
        } catch (error) {
          failedSamples?.record(
            trial.grid,
            n,
            map,
            {
              ...trial.trace,
              mode: 'two-border-gray',
              error: error.message,
              twoBorderGeometry: map.twoBorderGeometry,
            },
            audit,
            trial.confidence,
          );
          if (recoveryTrace)
            recoveryTrace.push({
              corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
              mode: 'two-border-gray',
              gridSize: n,
              error: error.message,
              decoder: audit,
            });
        }
      }
    }
  }
  if (recoveryTrace)
    for (const attempt of recoveryTrace) {
      const stage = attempt.decoder?.stage;
      if (stage && STAGES.indexOf(stage) > STAGES.indexOf(furthestStage))
        furthestStage = stage;
    }
  return {
    codes: results,
    finderObservations: measured,
    diagnostics: {
      ...(trace ? { twoBorder: twoBorderAudit } : {}),
      finderPatterns: patterns.length,
      smallUnresolvedFinders: patterns.filter(
        (p) =>
          p.module <= 4 &&
          ![...knownCodes, ...results].some((c) => inside(p, c.corners)),
      ).length,
      unresolvedFinders: patterns.filter(
        (p) => ![...knownCodes, ...results].some((c) => inside(p, c.corners)),
      ).length,
      candidateGrids: candidates,
      ...(trace
        ? {
            detection,
            failureGridAudit: failedSamples.snapshot(),
            grouping,
            sampling,
            hypotheses: hypotheses.map(
              ({ map, n, offset, evidence, gridBits }) => ({
                gridSize: n,
                offset,
                evidence,
                gridBits,
                corners: [map(0, 0), map(n, 0), map(n, n), map(0, n)],
              }),
            ),
            recovery: recoveryTrace,
            regions: regionTrace.map((region) => ({
              ...region,
              decoded:
                region.decoded ||
                results.some((c) =>
                  region.finders.every((p) => inside(p, c.corners)),
                ),
            })),
            candidateGroups: groups.length,
            sampledGrids,
            rejectedGrids,
            furthestStage: results.length ? 'decoded' : furthestStage,
            errors,
          }
        : {}),
      lastError: results.length ? null : lastError,
      timedOut: performance.now() > deadline,
    },
  };
}
function scanPass(
  image,
  {
    timeLimitMs = 12000,
    recovery = true,
    trace = false,
    multiple = true,
    pyramid = true,
    enhanced = false,
    seedCodes = [],
  } = {},
) {
  const started = performance.now(),
    gray = grayscale(image),
    deadline = started + Math.max(100, Math.min(60000, timeLimitMs)),
    { width: w, height: h } = image;
  const diagnostics = [];
  const conflicts = [];
  const codes = [...seedCodes];
  let observedFinders = [];
  const runBinary = (bits, bw, bh, opts) => {
    const result = scanBinary(bits, bw, bh, opts);
    if (enhanced && bw === w && bh === h)
      observedFinders = mergeFinderObservations(
        observedFinders,
        result.finderObservations,
      );
    return result;
  };

  let best = '';
  for (const [adaptive, invert] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
    ['contrast', false],
    ['contrast', true],
  ]) {
    if (performance.now() > deadline) break;
    const attemptStarted = performance.now();
    const result = runBinary(binarize(gray, w, h, adaptive, invert), w, h, {
      deadline,
      trace,
      enhanced,
      knownCodes: multiple ? codes : [],
      gray,
    });
    diagnostics.push({
      ...result.diagnostics,
      ...(trace
        ? {
            preprocessing:
              (adaptive === 'contrast'
                ? 'contrast'
                : adaptive
                  ? 'adaptive'
                  : 'global') + (invert ? '-inverted' : ''),
            elapsedMs: performance.now() - attemptStarted,
          }
        : {}),
    });
    for (const code of result.codes)
      collectCode(
        codes,
        {
          ...code,
          preprocessing:
            (adaptive === 'contrast'
              ? 'contrast'
              : adaptive
                ? 'adaptive'
                : 'global') + (invert ? '-inverted' : ''),
        },
        conflicts,
      );
    // Very small observed finders can disappear when downsampled. Give a
    // one-pixel vertical filter a chance before the image pyramid consumes
    // their search budget. The decision uses finder measurements only.
    if (
      recovery &&
      adaptive === true &&
      !invert &&
      result.diagnostics.smallUnresolvedFinders >= 2 &&
      Math.max(w, h) > 800 &&
      deadline - performance.now() > 150
    ) {
      const begin = performance.now(),
        filtered = filterGray(gray, w, h, 'vertical');
      const retry = runBinary(binarize(filtered, w, h, true), w, h, {
        deadline: Math.min(deadline, begin + 1000),
        trace,
        enhanced,
        knownCodes: codes,
        gray,
      });
      diagnostics.push({
        ...retry.diagnostics,
        ...(trace
          ? {
              preprocessing: 'early-small-vertical-adaptive',
              elapsedMs: performance.now() - begin,
            }
          : {}),
      });
      for (const code of retry.codes)
        collectCode(
          codes,
          { ...code, preprocessing: 'early-small-vertical-adaptive' },
          conflicts,
        );
    }
    // A screen's fine pixel pattern can overwhelm native-resolution grouping.
    // Try the averaged original pixels before spending the budget on inversion.
    if (
      pyramid &&
      recovery &&
      adaptive === true &&
      !invert &&
      !codes.length &&
      Math.max(w, h) > 800 &&
      deadline - performance.now() > 150
    ) {
      const {
        width: sw,
        height: sh,
        data: reduced,
      } = resizeGray(gray, w, h, 2);
      const begin = performance.now(),
        preview = runBinary(binarize(reduced, sw, sh), sw, sh, {
          deadline: Math.min(deadline, begin + 800),
          trace,
          enhanced,
          gray: reduced,
        });
      diagnostics.push({
        ...preview.diagnostics,
        ...(trace
          ? {
              preprocessing: 'early-scale-2-global',
              coordinateScale: 2,
              elapsedMs: performance.now() - begin,
            }
          : {}),
      });
      for (const c of preview.codes)
        collectCode(
          codes,
          {
            ...c,
            corners: c.corners.map((p) => ({ x: p.x * 2, y: p.y * 2 })),
            finders: {
              ...c.finders,
              ...Object.fromEntries(
                ['tl', 'tr', 'bl'].map((k) => [
                  k,
                  {
                    ...c.finders[k],
                    x: c.finders[k].x * 2,
                    y: c.finders[k].y * 2,
                    module: c.finders[k].module * 2,
                  },
                ]),
              ),
            },
            preprocessing: 'early-scale-2-global',
            coordinateScale: 2,
          },
          conflicts,
        );
    }
    if ((!multiple && codes.length) || !recovery) break;
    best = result.diagnostics.lastError;
  }
  if (enhanced && recovery && (!codes.length || multiple)) {
    for (const threshold of multiThresholds(gray)) {
      if (performance.now() > deadline) break;
      const begin = performance.now(),
        binary = Uint8Array.from(gray, (v) => (v <= threshold ? 1 : 0));
      const result = runBinary(binary, w, h, {
        deadline,
        trace,
        enhanced,
        gray,
        knownCodes: codes,
      });
      const preprocessing = 'multilevel-' + threshold;
      diagnostics.push({
        ...result.diagnostics,
        ...(trace
          ? { preprocessing, threshold, elapsedMs: performance.now() - begin }
          : {}),
      });
      for (const code of result.codes)
        collectCode(codes, { ...code, preprocessing }, conflicts);
      if (!multiple && codes.length) break;
    }
  }
  // Large camera close-ups need smaller pixel neighborhoods as well as the
  // original image. Area averaging preserves evidence; no generated pixels.
  if (
    pyramid &&
    recovery &&
    (Math.max(w, h) > 800 ||
      !codes.length ||
      diagnostics.some((d) => d.unresolvedFinders >= 2)) &&
    (multiple || !codes.length)
  ) {
    for (const factor of Math.max(w, h) > 800 ? [2, 4] : [0.5]) {
      if (performance.now() > deadline) break;
      const {
        width: sw,
        height: sh,
        data: reduced,
      } = resizeGray(gray, w, h, factor);
      for (const [adaptive, invert, filter] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
        ['contrast', false],
        ['contrast', true],
        ...(factor < 1
          ? [
              [false, false, 'horizontal'],
              [false, false, 'vertical'],
              [false, false, 'smooth'],
            ]
          : []),
      ]) {
        if (performance.now() > deadline) break;
        const begin = performance.now();
        const knownCodes = codes.map((c) => ({
          ...c,
          corners: c.corners.map((p) => ({ x: p.x / factor, y: p.y / factor })),
        }));
        const pixels = filter ? filterGray(reduced, sw, sh, filter) : reduced;
        const result = runBinary(
          binarize(pixels, sw, sh, adaptive, invert),
          sw,
          sh,
          { deadline, trace, enhanced, knownCodes, gray: reduced },
        );
        const preprocessing = `scale-${factor}-${filter ? filter + '-' : ''}${adaptive === 'contrast' ? 'contrast' : adaptive ? 'adaptive' : 'global'}${invert ? '-inverted' : ''}`;
        diagnostics.push({
          ...result.diagnostics,
          ...(trace
            ? {
                preprocessing,
                coordinateScale: factor,
                elapsedMs: performance.now() - begin,
              }
            : {}),
        });
        for (const c of result.codes)
          collectCode(
            codes,
            {
              ...c,
              corners: c.corners.map((p) => ({
                x: p.x * factor,
                y: p.y * factor,
              })),
              finders: {
                ...c.finders,
                ...Object.fromEntries(
                  ['tl', 'tr', 'bl'].map((key) => [
                    key,
                    {
                      ...c.finders[key],
                      x: c.finders[key].x * factor,
                      y: c.finders[key].y * factor,
                      module: c.finders[key].module * factor,
                    },
                  ]),
                ),
              },
              preprocessing,
              coordinateScale: factor,
            },
            conflicts,
          );
        if (!multiple && codes.length) break;
      }
      if (!multiple && codes.length) break;
    }
  }
  if (recovery && (!codes.length || multiple))
    for (const axis of ['horizontal', 'vertical', 'both', 'smooth']) {
      if (performance.now() > deadline) break;
      const filtered = filterGray(gray, w, h, axis);
      for (const adaptive of [false, true]) {
        if (performance.now() > deadline) break;
        const attemptStarted = performance.now();
        const result = runBinary(binarize(filtered, w, h, adaptive), w, h, {
          deadline,
          trace,
          enhanced,
          knownCodes: multiple ? codes : [],
          gray,
        });
        diagnostics.push({
          ...result.diagnostics,
          ...(trace
            ? {
                preprocessing: axis + '-' + (adaptive ? 'adaptive' : 'global'),
                elapsedMs: performance.now() - attemptStarted,
              }
            : {}),
        });
        if (result.codes.length) {
          for (const c of result.codes)
            collectCode(
              codes,
              {
                ...c,
                preprocessing: axis + '-' + (adaptive ? 'adaptive' : 'global'),
              },
              conflicts,
            );
          if (!multiple) break;
        }
      }
      if (codes.length && !multiple) break;
    }
  if (enhanced && recovery && (multiple || !codes.length)) {
    for (const specification of [
      { radius: 5 },
      { radius: 10 },
      { radius: 40 },
      { radius: 80 },
      ...[0.8, 1.5, 3, 5].map((sigma) => ({ sigma, amount: 1.5 })),
    ]) {
      if (performance.now() > deadline) break;
      const pixels = specification.sigma
        ? sharpenSource(
            gray,
            w,
            h,
            specification.sigma,
            specification.amount,
            deadline,
          )
        : gray;
      if (!pixels) break;
      const modes = specification.radius ? [specification] : [false, true];
      for (const adaptive of modes) {
        if (performance.now() > deadline) break;
        const begin = performance.now();
        const result = runBinary(binarize(pixels, w, h, adaptive), w, h, {
          deadline,
          trace,
          enhanced,
          knownCodes: codes,
          gray: pixels,
        });
        const preprocessing = specification.radius
          ? 'local-contrast-radius-' + specification.radius
          : 'source-unsharp-' +
            specification.sigma +
            '-' +
            (adaptive ? 'adaptive' : 'global');
        diagnostics.push({
          ...result.diagnostics,
          ...(trace
            ? {
                preprocessing,
                sourceFilter: specification,
                elapsedMs: performance.now() - begin,
              }
            : {}),
        });
        for (const code of result.codes)
          collectCode(codes, { ...code, preprocessing }, conflicts);
        if (!multiple && codes.length) break;
      }
      if (!multiple && codes.length) break;
    }
  }
  if (
    enhanced &&
    recovery &&
    observedFinders.length >= 3 &&
    (multiple || !codes.length)
  ) {
    const unresolved = observedFinders.filter(
      (p) => !codes.some((c) => inside(p, c.corners)),
    );
    if (unresolved.length >= 3)
      for (const specification of [null, { sigma: 1.5 }, { sigma: 3 }]) {
        if (performance.now() > deadline) break;
        const pixels = specification
          ? sharpenSource(gray, w, h, specification.sigma, 1.5, deadline)
          : gray;
        if (!pixels) continue;
        for (const adaptive of [false, true, 'contrast']) {
          if (performance.now() > deadline) break;
          const begin = performance.now(),
            result = scanBinary(binarize(pixels, w, h, adaptive), w, h, {
              deadline,
              trace,
              enhanced,
              gray: pixels,
              knownCodes: codes,
              extraFinders: unresolved,
            });
          const preprocessing =
            'finder-fusion-' +
            (specification ? 'unsharp-' + specification.sigma : 'source') +
            '-' +
            adaptive;
          diagnostics.push({
            ...result.diagnostics,
            ...(trace
              ? {
                  preprocessing,
                  observedFinderCount: unresolved.length,
                  observedFinders: unresolved,
                  elapsedMs: performance.now() - begin,
                }
              : {}),
          });
          for (const code of result.codes)
            collectCode(codes, { ...code, preprocessing }, conflicts);
          if (!multiple && codes.length) break;
        }
        if (!multiple && codes.length) break;
      }
  }
  const timedOut = performance.now() > deadline;
  const failureLog = trace
    ? makeFailureLog(diagnostics, {
        decoded: codes.length > 0,
        decodedCount: codes.length,
        timedOut,
      })
    : null;
  return {
    engine: ENGINE_VERSION,
    codes,
    elapsedMs: performance.now() - started,
    diagnostics,
    ...(trace ? { failureLog, image: { width: w, height: h } } : {}),
    reason: codes.length
      ? null
      : (failureLog?.summary ?? (best || 'No readable QR found')),
    timedOut,
    ...(trace
      ? {
          collection: {
            mode: multiple ? 'multiple' : 'first-success',
            decodedRegions: codes.length,
            returnedWithinBudget: !timedOut,
            completeness: 'unknown-without-external-reference',
            conflicts,
          },
        }
      : {}),
  };
}

// Preserve the established pass before spending a separate budget on recovery.
// Seed results are private, produced by this image's scan, never caller data.
export function scanImage(image, options = {}) {
  const started = performance.now();
  const requestedBudget = options.timeLimitMs ?? 12000;
  if (!Number.isFinite(requestedBudget))
    throw Error('Scan time limit must be a finite number');
  const budget = Math.max(100, Math.min(60000, requestedBudget));
  const base = scanPass(image, {
    ...options,
    timeLimitMs: Math.min(5000, budget),
    enhanced: false,
    seedCodes: [],
  });
  if (
    options.recovery === false ||
    (options.multiple === false && base.codes.length) ||
    budget - (performance.now() - started) < 100
  )
    return base;
  const extra = scanPass(image, {
    ...options,
    timeLimitMs: budget - (performance.now() - started),
    enhanced: true,
    seedCodes: base.codes,
  });
  const diagnostics = [
    ...base.diagnostics.map((d) => ({ ...d, searchPhase: 'established' })),
    ...extra.diagnostics.map((d) => ({ ...d, searchPhase: 'enhanced' })),
  ];
  const timedOut = extra.timedOut;
  const failureLog = options.trace
    ? makeFailureLog(diagnostics, {
        decoded: extra.codes.length > 0,
        decodedCount: extra.codes.length,
        timedOut,
      })
    : null;
  return {
    ...extra,
    elapsedMs: performance.now() - started,
    diagnostics,
    timedOut,
    ...(options.trace
      ? {
          failureLog,
          searchPhases: [
            {
              name: 'established',
              requestedBudgetMs: Math.min(5000, budget),
              elapsedMs: base.elapsedMs,
              timedOut: base.timedOut,
              codes: base.codes.length,
            },
            {
              name: 'enhanced',
              requestedBudgetMs: Math.max(0, budget - base.elapsedMs),
              elapsedMs: extra.elapsedMs,
              timedOut: extra.timedOut,
              newCodes: extra.codes.length - base.codes.length,
            },
          ],
          collection: {
            ...extra.collection,
            conflicts: [
              ...(base.collection?.conflicts ?? []),
              ...(extra.collection?.conflicts ?? []),
            ],
          },
        }
      : {}),
  };
}
