// Local, observed 3×3 finder-core borders. Nothing is extrapolated or painted.
import { componentFinders } from './component-finders.mjs';
export function finderCoreBorders(
  bits,
  w,
  h,
  group,
  { deadline = Infinity } = {},
) {
  if (performance.now() > deadline) return null;
  const { tl, tr, bl } = group,
    ul = Math.hypot(tr.x - tl.x, tr.y - tl.y),
    vl = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const ux = (tr.x - tl.x) / ul,
    uy = (tr.y - tl.y) / ul,
    vx = (bl.x - tl.x) / vl,
    vy = (bl.y - tl.y) / vl,
    det = ux * vy - uy * vx;
  if (!Number.isFinite(det) || det < 0.2) return null;
  const corners = [],
    trace = [];
  for (const p of [tl, tr, bl]) {
    if (performance.now() > deadline || p.module < 1) return null;
    const radius = Math.ceil(p.module * 6),
      x0 = Math.max(0, Math.floor(p.x) - radius),
      y0 = Math.max(0, Math.floor(p.y) - radius),
      rw = Math.min(w, Math.ceil(p.x) + radius) - x0,
      rh = Math.min(h, Math.ceil(p.y) + radius) - y0;
    if (rw * rh > 500000) return null;
    const crop = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++)
      crop.set(
        bits.subarray((y + y0) * w + x0, (y + y0) * w + x0 + rw),
        y * rw,
      );
    const found = componentFinders(crop, rw, rh, { deadline })
      .map((c) => ({
        ...c,
        x: c.x + x0,
        y: c.y + y0,
        componentEvidence: {
          ...c.componentEvidence,
          coreCorners: c.componentEvidence.coreCorners.map((q) => ({
            x: q.x + x0,
            y: q.y + y0,
          })),
        },
      }))
      .filter((c) => Math.hypot(c.x - p.x, c.y - p.y) < p.module * 1.5)
      .sort(
        (a, b) =>
          Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
      );
    if (!found.length) return null;
    const c = found[0],
      quad = c.componentEvidence.coreCorners;
    const score = (q) =>
      ((q.x - p.x) * (vy - uy) + (q.y - p.y) * (ux - vx)) / det;
    const first = quad.reduce(
      (best, q, i) => (score(q) < score(quad[best]) ? i : best),
      0,
    );
    const ordered = quad.map((_, i) => quad[(first + i) % 4]);
    corners.push(ordered);
    trace.push({
      center: { x: c.x, y: c.y },
      observedCoreCorners: ordered,
      evidence: c.componentEvidence,
    });
  }
  return { corners, trace, inset: 2, span: 3 };
}
