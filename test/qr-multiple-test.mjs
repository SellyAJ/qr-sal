import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scanImage } from '../src/core/scanner.mjs';
import { collectCode } from '../src/core/regions.mjs';
const cases = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
function scene(count, inverted = false) {
  const width = 600,
    height = Math.ceil(count / 5) * 125,
    data = new Uint8Array(width * height).fill(255),
    expected = [];
  for (let i = 0; i < count; i++) {
    const f = cases[(i % 2) * 4],
      bits = Buffer.from(f.bits, 'base64'),
      scale = 3,
      x0 = (i % 5) * 120 + 12,
      y0 = Math.floor(i / 5) * 125 + 12;
    const invert = inverted && i % 2 === 1;
    for (let y = -4; y < f.size + 4; y++)
      for (let x = -4; x < f.size + 4; x++) {
        const black =
          x >= 0 &&
          y >= 0 &&
          x < f.size &&
          y < f.size &&
          (bits[(y * f.size + x) >> 3] >> (7 - ((y * f.size + x) & 7))) & 1;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++)
            data[(y0 + (y + 4) * scale + dy) * width + x0 + (x + 4) * scale + dx] = (
              black ? !invert : invert
            )
              ? 0
              : 255;
      }
    expected.push(f.text);
  }
  return { image: { width, height, data }, expected };
}
for (const [count, invert] of [
  [2, false],
  [4, true],
  [60, false],
]) {
  const { image, expected } = scene(count, invert);
  const result = scanImage(image, { trace: true, timeLimitMs: 10000 });
  assert.deepEqual(
    result.codes.map((c) => c.text).sort((a, b) => a.localeCompare(b)),
    expected.sort((a, b) => a.localeCompare(b)),
    `All ${count} physical codes, inverted=${invert}`,
  );
  assert.equal(result.collection.conflicts.length, 0);
  assert.equal(result.collection.completeness, 'unknown-without-external-reference');
  if (count === 4)
    assert.ok(result.diagnostics.some((d) => d.preprocessing === 'global-inverted'));
}
const square = (x, size = 10) => [
  { x, y: 0 },
  { x: x + size, y: 0 },
  { x: x + size, y: size },
  { x, y: size },
];
const codes = [],
  conflicts = [];
collectCode(codes, { text: 'repeated', corners: square(0) }, conflicts);
collectCode(codes, { text: 'repeated', corners: square(15) }, conflicts);
collectCode(codes, { text: 'repeated', corners: square(0.1) }, conflicts);
assert.equal(
  codes.length,
  2,
  'Nearby identical payloads remain distinct; jitter is deduplicated',
);
collectCode(codes, { text: 'conflicting', corners: square(0.2) }, conflicts);
assert.equal(conflicts.length, 1, 'Conflicting validated readings are surfaced');
assert.equal(codes.length, 3);
console.log(
  'Multiple QR: 2, mixed-polarity 4, 60 symbols, repeated payloads, jitter and conflicts passed.',
);
