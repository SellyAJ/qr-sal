import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scanImage } from '../src/core/scanner.mjs';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
let count = 0;
for (const index of [0, 1, 2, 3, 4, 8])
  for (const [a, b] of [
    [0.018, 0.006],
    [0.007, 0.023],
  ]) {
    const row = fixtures[index],
      packed = Buffer.from(row.bits, 'base64'),
      width = 500,
      height = 500,
      k = 14,
      pad = 70;
    const data = new Uint8Array(width * height).fill(255);
    // Analytic inverse of u=k*x/(1+a*x+b*y), v=k*y/(1+a*x+b*y).
    // The source raster uses independent known-good QR matrices.
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = x + 0.5 - pad,
          v = y + 0.5 - pad,
          denominator = k - a * u - b * v;
        if (denominator <= 0) continue;
        const sx = Math.floor(u / denominator),
          sy = Math.floor(v / denominator);
        if (sx < 0 || sy < 0 || sx >= row.size || sy >= row.size) continue;
        if ((packed[(sy * row.size + sx) >> 3] >> (7 - ((sy * row.size + sx) & 7))) & 1)
          data[y * width + x] = 0;
      }
    const result = scanImage({ width, height, data }, { timeLimitMs: 5000, trace: true });
    assert.deepEqual(
      result.codes.map((c) => c.text),
      [row.text],
      `Perspective fixture ${index} (${a},${b})`,
    );
    count++;
  }
// A rotated oblique plane where the apparent finder triangle is far from
// right-angled. Render by an analytic inverse, independently of scanner maps.
{
  const row = fixtures[0],
    packed = Buffer.from(row.bits, 'base64');
  const width = 450,
    height = 450,
    data = new Uint8Array(width * height).fill(255);
  const a = 8.47041847041847,
    b = 8.234728234728236,
    c = 30;
  const d = -0.8369408369408363,
    e = 1.7364117364117364,
    f = 270;
  const g = 0.02308802308802309,
    h = -0.008177008177008178;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x + 0.5,
        v = y + 0.5,
        aa = a - u * g,
        bb = b - u * h;
      const dd = d - v * g,
        ee = e - v * h,
        det = aa * ee - bb * dd;
      if (Math.abs(det) < 1e-8) continue;
      const sx = Math.floor(((u - c) * ee - bb * (v - f)) / det);
      const sy = Math.floor((aa * (v - f) - (u - c) * dd) / det);
      if (
        sx >= 0 &&
        sy >= 0 &&
        sx < row.size &&
        sy < row.size &&
        (packed[(sy * row.size + sx) >> 3] >> (7 - ((sy * row.size + sx) & 7))) & 1
      )
        data[y * width + x] = 0;
    }
  const result = scanImage({ width, height, data }, { timeLimitMs: 5000, trace: true });
  assert.deepEqual(
    result.codes.map((code) => code.text),
    [row.text],
    'Oblique finder-triangle geometry',
  );
  count++;
}
console.log(JSON.stringify({ projectiveImageFixtures: count, exactPayloads: true }));
