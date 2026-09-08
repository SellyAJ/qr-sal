import { bilinear } from './preprocess.mjs';
// Data-independent lattice phase: measured edges repeat at module boundaries.
// Fine scanline shifts can survive after a broad three-strip warp averages out.
export function latticePhase(
  gray,
  w,
  h,
  base,
  n,
  { deadline = Infinity } = {},
) {
  if (n < 21 || n > 85) return [];
  const step = 0.125,
    profiles = [];
  const pixel = (x, y) => {
    const p = base(x, y);
    return p.x >= 0.5 && p.y >= 0.5 && p.x <= w - 0.5 && p.y <= h - 0.5
      ? bilinear(gray, w, h, p.x, p.y)
      : NaN;
  };
  for (const vertical of [false, true]) {
    const phases = [],
      strengths = [];
    let previous = 0,
      supported = 0;
    for (let across = 0; across <= n; across += step) {
      if (performance.now() > deadline) return [];
      let cosine = 0,
        sine = 0,
        total = 0;
      for (let along = 0.2; along < n - 0.2; along += 0.125) {
        const a = vertical
          ? pixel(across, along - 0.07)
          : pixel(along - 0.07, across);
        const b = vertical
          ? pixel(across, along + 0.07)
          : pixel(along + 0.07, across);
        if (!Number.isFinite(a + b)) continue;
        const weight = (a - b) ** 2;
        cosine += weight * Math.cos(2 * Math.PI * along);
        sine += weight * Math.sin(2 * Math.PI * along);
        total += weight;
      }
      const strength = total > 1 ? Math.hypot(cosine, sine) / total : 0;
      let phase = previous;
      if (strength >= 0.1) {
        const raw = Math.atan2(sine, cosine) / (2 * Math.PI);
        phase = raw + Math.round(previous - raw);
        if (Math.abs(phase) <= 1.75) {
          supported++;
          previous = phase;
        } else phase = previous;
      }
      phases.push(phase);
      strengths.push(strength);
    }
    if (supported < phases.length * 0.5) return [];
    // Remove integer ambiguity at the strong finder rows, without fixing data.
    const anchor = phases
      .slice(0, Math.min(phases.length, 7 / step))
      .sort((a, b) => a - b)[Math.floor(Math.min(phases.length, 7 / step) / 2)];
    const integer = Math.round(anchor);
    for (let i = 0; i < phases.length; i++) phases[i] -= integer;
    profiles.push({ phases, strengths, supported });
  }
  const interpolate = (profile, p) => {
    const i = Math.max(0, Math.min(profile.phases.length - 1, p / step)),
      a = Math.floor(i),
      b = Math.min(profile.phases.length - 1, a + 1);
    return profile.phases[a] * (1 - (i - a)) + profile.phases[b] * (i - a);
  };
  return ['horizontal', 'vertical', 'both']
    .map((axis) => {
      const map = (x, y) =>
        base(
          x + (axis !== 'vertical' ? interpolate(profiles[0], y) : 0),
          y + (axis !== 'horizontal' ? interpolate(profiles[1], x) : 0),
        );
      map.latticePhase = {
        method: 'scanline-edge-phase',
        axis,
        step,
        profiles,
        baseCorners: [base(0, 0), base(n, 0), base(n, n), base(0, n)],
        baseCurvedGeometry: base.curvedGeometry,
      };
      for (let y = 0; y <= n; y += n / 16)
        for (let x = 0; x <= n; x += n / 16) {
          const p = map(x, y),
            a = map(x + 0.05, y),
            b = map(x, y + 0.05),
            q = base(x, y),
            u = base(x + 0.05, y),
            v = base(x, y + 0.05);
          const determinant =
            (a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x);
          const original =
            (u.x - q.x) * (v.y - q.y) - (u.y - q.y) * (v.x - q.x);
          const ratio = determinant / original;
          if (!Number.isFinite(ratio) || ratio < 0.025 || ratio > 10)
            return null;
        }
      return map;
    })
    .filter(Boolean);
}
