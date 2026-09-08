// Retain actually observed finder locations across photometric passes of one
// image. Only geometry is shared; every payload is read and checked again.
export function mergeFinderObservations(previous, current, limit = 256) {
  const result = previous.map((p) => ({ ...p }));
  for (const p of current) {
    if (
      !Number.isFinite(p.x + p.y + p.module + p.quality) ||
      p.module < 1 ||
      p.quality < 0.76
    )
      continue;
    const index = result.findIndex(
      (q) =>
        Math.max(q.module, p.module) < Math.min(q.module, p.module) * 1.8 &&
        Math.hypot(q.x - p.x, q.y - p.y) < Math.min(q.module, p.module) * 1.5,
    );
    if (index < 0) result.push({ ...p, observationCount: 1 });
    else {
      const old = result[index],
        best = p.quality > old.quality ? p : old;
      result[index] = {
        ...best,
        observationCount: (old.observationCount ?? 1) + 1,
      };
    }
  }
  return result
    .sort(
      (a, b) =>
        b.quality * 2 +
        Math.min(4, b.observationCount ?? 1) * 0.05 -
        (a.quality * 2 + Math.min(4, a.observationCount ?? 1) * 0.05),
    )
    .slice(0, limit);
}
