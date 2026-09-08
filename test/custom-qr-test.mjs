import fs from 'node:fs';
import assert from 'node:assert/strict';
import { decodeMatrix } from '../src/core/matrix.mjs';
import { scanImage } from '../src/core/scanner.mjs';
const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url), 'utf8'),
).cases;
for (const row of fixture) {
  const bytes = Buffer.from(row.bits, 'base64');
  row.matrix = Uint8Array.from(
    { length: row.size ** 2 },
    (_, i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1,
  );
  const result = decodeMatrix(row.matrix, row.size);
  assert.equal(result.text, row.text);
  assert.equal(result.correctedCodewords, 0);
  const damaged = row.matrix.slice();
  damaged[damaged.length - 1] ^= 1;
  assert.equal(decodeMatrix(damaged, row.size).text, row.text);
}
assert.throws(() => decodeMatrix(new Uint8Array(21 * 21), 21));
function raster(row, rotate = false, invert = false) {
  const scale = 4,
    width = (row.size + 8) * scale,
    data = new Uint8Array(width * width).fill(invert ? 0 : 255);
  for (let y = 0; y < row.size; y++)
    for (let x = 0; x < row.size; x++)
      if (row.matrix[y * row.size + x])
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const xx = (x + 4) * scale + dx,
              yy = (y + 4) * scale + dy;
            data[rotate ? xx * width + (width - 1 - yy) : yy * width + xx] = invert
              ? 255
              : 0;
          }
  return { width, height: width, data };
}
let imageCases = 0;
for (const i of [0, 4, 8, 24, 36, 156, 160, 163, 170, 191])
  for (const [rotate, invert] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const row = fixture[i],
      result = scanImage(raster(row, rotate, invert));
    assert.ok(
      result.codes.some((c) => c.text === row.text),
      `Image ${i}, rotate=${rotate}, invert=${invert}`,
    );
    imageCases++;
  }
assert.equal(
  scanImage({ width: 200, height: 200, data: new Uint8Array(40000).fill(255) }).codes
    .length,
  0,
);
let seed = 123;
const noise = Uint8Array.from({ length: 40000 }, () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed >>> 24;
});
assert.equal(scanImage({ width: 200, height: 200, data: noise }).codes.length, 0);
console.log(
  JSON.stringify({
    matrixFixtures: fixture.length,
    damagedMatrixFixtures: fixture.length,
    imageFixtures: imageCases,
    negativeCases: 2,
    checks:
      'Independent QR fixtures; exact payloads; error correction; rotation; inversion; blank/noise rejection',
  }),
);
