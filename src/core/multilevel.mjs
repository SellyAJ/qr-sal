// Histogram-only multi-level Otsu: preserve a dark QR's contrast when a bright
// reflection otherwise dominates the two-class cutoff.
export function multiThresholds(gray) {
  const count = new Float64Array(257),
    sum = new Float64Array(257),
    hist = new Uint32Array(256);
  for (const value of gray) hist[value]++;
  for (let i = 0; i < 256; i++) {
    count[i + 1] = count[i] + hist[i];
    sum[i + 1] = sum[i] + hist[i] * i;
  }
  const dp = Array.from({ length: 5 }, () =>
      new Float64Array(257).fill(-Infinity),
    ),
    parents = Array.from({ length: 5 }, () => new Int16Array(257).fill(-1));
  dp[0][0] = 0;
  for (let k = 1; k <= 4; k++)
    for (let end = k; end <= 256; end++)
      for (let start = k - 1; start < end; start++) {
        const w = count[end] - count[start];
        if (!w || !Number.isFinite(dp[k - 1][start])) continue;
        const value = dp[k - 1][start] + (sum[end] - sum[start]) ** 2 / w;
        if (value > dp[k][end]) {
          dp[k][end] = value;
          parents[k][end] = start;
        }
      }
  const thresholds = [];
  for (const k of [3, 4]) {
    if (!Number.isFinite(dp[k][256])) continue;
    let end = 256;
    for (let level = k; level > 1; level--) {
      const start = parents[level][end];
      if (start < 1) break;
      thresholds.push(start - 1);
      end = start;
    }
  }
  return [...new Set(thresholds)].sort((a, b) => a - b);
}
