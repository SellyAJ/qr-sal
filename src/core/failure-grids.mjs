// Developer evidence only. Neither ranking nor stored grids feed the decoder.
export class FailureGridLog {
  constructor({ maxRegions = 12, perRegion = 6 } = {}) {
    if (
      !Number.isInteger(maxRegions) ||
      maxRegions < 1 ||
      maxRegions > 64 ||
      !Number.isInteger(perRegion) ||
      perRegion < 1 ||
      perRegion > 32
    )
      throw Error('Invalid failed-grid diagnostic limits');
    this.maxRegions = maxRegions;
    this.perRegion = perRegion;
    this.regions = [];
    this.counts = {
      considered: 0,
      duplicate: 0,
      capacityDiscarded: 0,
      invalidGeometry: 0,
    };
  }
  record(grid, n, map, metadata, decoder, confidence = null) {
    this.counts.considered++;
    if (
      !grid ||
      grid.length !== n * n ||
      !Number.isInteger(n) ||
      n < 21 ||
      n > 177
    )
      return;
    let corners;
    try {
      corners = [
        [0, 0],
        [n, 0],
        [n, n],
        [0, n],
      ].map(([x, y]) => map(x, y));
    } catch {
      this.counts.invalidGeometry++;
      return;
    }
    if (corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      this.counts.invalidGeometry++;
      return;
    }
    const center = {
      x: corners.reduce((a, p) => a + p.x, 0) / 4,
      y: corners.reduce((a, p) => a + p.y, 0) / 4,
    };
    const span = Math.hypot(
      corners[0].x - corners[2].x,
      corners[0].y - corners[2].y,
    );
    if (span <= 0) {
      this.counts.invalidGeometry++;
      return;
    }
    let region = this.regions.find(
      (r) =>
        Math.hypot(center.x - r.center.x, center.y - r.center.y) <
          0.15 * Math.min(span, r.span) &&
        span / r.span > 0.7 &&
        span / r.span < 1.43,
    );
    if (!region) {
      if (this.regions.length >= this.maxRegions) {
        this.counts.capacityDiscarded++;
        return;
      }
      region = { center, span, records: [] };
      this.regions.push(region);
    }
    const finderErrors = [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ].map(([sx, sy]) => {
      let wrong = 0;
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++) {
          const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          wrong += grid[(sy + y) * n + sx + x] !== (d === 3 || d <= 1 ? 1 : 0);
        }
      return wrong;
    });
    let timingErrors = 0;
    for (let i = 8; i < n - 8; i++) {
      timingErrors += grid[6 * n + i] !== (i % 2 === 0 ? 1 : 0);
      timingErrors += grid[i * n + 6] !== (i % 2 === 0 ? 1 : 0);
    }
    const score =
      finderErrors.reduce((a, b) => a + b, 0) / 147 +
      timingErrors / (2 * Math.max(1, n - 16)) +
      (decoder?.formatCorrections ?? 4) / 10;
    if (
      region.records.length >= this.perRegion &&
      score > region.records.at(-1).score
    ) {
      this.counts.capacityDiscarded++;
      return;
    }
    const packed = new Uint8Array(Math.ceil((n * n) / 8));
    for (let i = 0; i < grid.length; i++)
      packed[i >> 3] |= (grid[i] & 1) << (7 - (i & 7));
    const hex = (b) =>
      Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
    const gridBits = hex(packed);
    if (
      region.records.some((r) => r.gridSize === n && r.gridBits === gridBits)
    ) {
      this.counts.duplicate++;
      return;
    }
    const confidenceHex =
      confidence &&
      confidence.length === grid.length &&
      confidence.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
        ? hex(Uint8Array.from(confidence, (v) => Math.round(v * 255)))
        : undefined;
    region.records.push({
      gridSize: n,
      gridBits,
      confidenceHex,
      score,
      finderErrors,
      timingErrors,
      corners,
      ...metadata,
      decoder,
    });
    region.records.sort((a, b) => a.score - b.score);
    if (region.records.length > this.perRegion) {
      region.records.pop();
      this.counts.capacityDiscarded++;
    }
  }
  snapshot() {
    return {
      schemaVersion: 1,
      ...this.counts,
      maxRegions: this.maxRegions,
      perRegion: this.perRegion,
      confidenceEncoding:
        'Unsigned bytes / 255: quantized luminance distance, not probability.',
      limitation:
        'Bounded failed samples selected by visible QR controls; not exhaustive and never runtime recovery inputs.',
      samples: this.regions.flatMap((r, index) =>
        r.records.map((record) => ({ region: index, ...record })),
      ),
    };
  }
}
