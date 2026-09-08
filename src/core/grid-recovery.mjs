// Fit only QR's standard alternating timing marks. No receipt text or expected
// payload is an input. Monotonic local shifts account for uneven scan stretching.
export function timingWarp(bits, w, h, map, n) {
  function fit(vertical) {
    const states = Array.from({ length: 25 }, (_, i) => (i - 12) * 0.15),
      start = 8,
      end = n - 9;
    const scores = [],
      parents = [];
    for (let row = start; row <= end; row++) {
      const current = new Float64Array(states.length),
        links = new Int16Array(states.length),
        expected = row & 1 ? 0 : 1;
      for (let k = 0; k < states.length; k++) {
        const shift = states[k];
        let wrong = 0,
          total = 0;
        for (const across of [-0.15, 0, 0.15])
          for (const along of [-0.28, 0, 0.28]) {
            const p = vertical
              ? map(6.5 + across, row + 0.5 + shift + along)
              : map(row + 0.5 + shift + along, 6.5 + across);
            const x = Math.floor(p.x),
              y = Math.floor(p.y);
            total++;
            wrong +=
              x < 0 || y < 0 || x >= w || y >= h || bits[y * w + x] !== expected
                ? 1
                : 0;
          }
        let cost = Infinity,
          previous = -1;
        if (row === start) cost = 0.35 * shift * shift;
        else
          for (
            let j = Math.max(0, k - 3);
            j <= Math.min(states.length - 1, k + 3);
            j++
          ) {
            const d = shift - states[j],
              c = scores.at(-1)[j] + 0.8 * d * d;
            if (c < cost) {
              cost = c;
              previous = j;
            }
          }
        current[k] = cost + wrong / total + 0.015 * shift * shift;
        links[k] = previous;
      }
      scores.push(current);
      parents.push(links);
    }
    let index = 0,
      best = Infinity;
    for (let k = 0; k < states.length; k++) {
      const c = scores.at(-1)[k] + 0.35 * states[k] ** 2;
      if (c < best) {
        best = c;
        index = k;
      }
    }
    const shifts = new Float64Array(n);
    for (let row = end; row >= start; row--) {
      shifts[row] = states[index];
      index = parents[row - start][index];
    }
    // Bridge the first and last timing samples to the unchanged finder centers.
    for (let r = 4; r < start; r++)
      shifts[r] = (shifts[start] * (r - 3)) / (start - 3);
    for (let r = end + 1; r < n - 3; r++)
      shifts[r] = (shifts[end] * (n - 4 - r)) / (n - 4 - end);
    return { shifts, cost: best, maxShift: Math.max(...shifts.map(Math.abs)) };
  }
  const horizontal = fit(false),
    vertical = fit(true);
  const shift = (values, p) => {
    const center = Math.max(0, Math.min(n - 1, p - 0.5)),
      a = Math.floor(center),
      b = Math.min(n - 1, a + 1);
    return values[a] + (values[b] - values[a]) * (center - a);
  };
  return {
    map: (x, y) =>
      map(x + shift(horizontal.shifts, x), y + shift(vertical.shifts, y)),
    trace: {
      horizontal: { ...horizontal, shifts: Array.from(horizontal.shifts) },
      vertical: { ...vertical, shifts: Array.from(vertical.shifts) },
    },
  };
}

// Recover a mildly distorted module lattice from image edges, without knowing
// any data bits. Fit overlapping strips: paper stretch/skew can differ across
// the symbol, so one timing line cannot describe the entire printed grid.
export function edgeWarp(bits, w, h, map, n, { deadline = Infinity } = {}) {
  if (n < 21 || n > 177 || !Number.isInteger(n)) return null;
  const bands = 3,
    radius = 0.25,
    smoothness = 2,
    states = Array.from({ length: 41 }, (_, i) => (i - 20) * 0.1);
  function fit(vertical, band) {
    const center = ((band + 0.5) * n) / bands,
      start = Math.max(0.5, center - n / bands),
      end = Math.min(n - 0.5, center + n / bands),
      scores = [],
      parents = [];
    const get = (along, across) => {
      const p = vertical ? map(across, along) : map(along, across),
        x = Math.floor(p.x),
        y = Math.floor(p.y);
      return Number.isFinite(x) &&
        Number.isFinite(y) &&
        x >= 0 &&
        y >= 0 &&
        x < w &&
        y < h
        ? bits[y * w + x]
        : -1;
    };
    for (let k = 1; k < n; k++) {
      if (performance.now() > deadline) return null;
      const costs = new Float64Array(states.length),
        links = new Int16Array(states.length);
      for (let s = 0; s < states.length; s++) {
        const p = k + states[s];
        let boundary = 0,
          interior = 0,
          count = 0;
        for (let across = start; across < end; across++) {
          const a = get(p - radius, across),
            b = get(p + radius, across),
            c = get(p + 0.5 - radius, across),
            d = get(p + 0.5 + radius, across);
          if (a < 0 || b < 0 || c < 0 || d < 0) continue;
          boundary += a !== b;
          interior += c !== d;
          count++;
        }
        let cost = Infinity,
          from = -1;
        if (k === 1)
          cost = Math.abs(states[s]) <= 0.4 ? 2 * states[s] ** 2 : Infinity;
        else
          for (
            let j = Math.max(0, s - 4);
            j <= Math.min(states.length - 1, s + 4);
            j++
          ) {
            const candidate =
              scores.at(-1)[j] + smoothness * (states[s] - states[j]) ** 2;
            if (candidate < cost) {
              cost = candidate;
              from = j;
            }
          }
        // Edges should lie between modules; their interiors should be stable.
        // Missing image pixels never count as evidence of a white module.
        costs[s] =
          count >= 0.75 * (end - start)
            ? cost + (interior - boundary) / count + 0.004 * states[s] ** 2
            : Infinity;
        links[s] = from;
      }
      scores.push(costs);
      parents.push(links);
    }
    let best = Infinity,
      index = -1;
    for (let s = 0; s < states.length; s++) {
      if (Math.abs(states[s]) > 0.4) continue;
      const cost = scores.at(-1)[s] + 2 * states[s] ** 2;
      if (cost < best) {
        best = cost;
        index = s;
      }
    }
    if (index < 0) return null;
    const shifts = new Float64Array(n + 1);
    for (let k = n - 1; k > 0; k--) {
      shifts[k] = states[index];
      index = parents[k - 1][index];
    }
    return {
      center,
      start,
      end,
      shifts,
      edgeCost: best,
      maxShift: Math.max(...shifts.map(Math.abs)),
    };
  }
  const horizontal = [],
    vertical = [];
  for (let b = 0; b < bands; b++) {
    const x = fit(false, b),
      y = fit(true, b);
    if (!x || !y) return null;
    horizontal.push(x);
    vertical.push(y);
  }
  const interpolate = (values, position) => {
    const p = Math.max(0, Math.min(n, position)),
      a = Math.floor(p),
      b = Math.min(n, a + 1);
    return values[a] + (values[b] - values[a]) * (p - a);
  };
  const field = (curves, along, across) => {
    const p = Math.max(0, Math.min(bands - 1, (across / n) * bands - 0.5)),
      a = Math.floor(p),
      b = Math.min(bands - 1, a + 1);
    return (
      interpolate(curves[a].shifts, along) * (1 - (p - a)) +
      interpolate(curves[b].shifts, along) * (p - a)
    );
  };
  return {
    map: (x, y) => map(x + field(horizontal, x, y), y + field(vertical, y, x)),
    trace: {
      method: 'overlapping-strip-edges',
      bands,
      radius,
      smoothness,
      maxShiftModules: 2,
      maxAdjacentShiftModules: 0.4,
      horizontal: horizontal.map((r) => ({
        ...r,
        shifts: Array.from(r.shifts),
      })),
      vertical: vertical.map((r) => ({ ...r, shifts: Array.from(r.shifts) })),
    },
  };
}
