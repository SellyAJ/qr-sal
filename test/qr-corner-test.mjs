import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scanImage, findPatterns } from '../src/core/scanner.mjs';
import { decodeMatrix } from '../src/core/matrix.mjs';
const cases = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
function matrix(row) {
  const bytes = Buffer.from(row.bits, 'base64');
  return Uint8Array.from(
    { length: row.size ** 2 },
    (_, i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1,
  );
}
function raster(row, sx, sy) {
  const bits = matrix(row),
    width = (row.size + 8) * sx,
    height = (row.size + 8) * sy,
    data = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < row.size; y++)
    for (let x = 0; x < row.size; x++)
      if (bits[y * row.size + x])
        for (let j = 0; j < sy; j++)
          for (let i = 0; i < sx; i++)
            data[((y + 4) * sy + j) * width + (x + 4) * sx + i] = 0;
  return { width, height, data };
}
let stretched = 0;
for (const index of [0, 8, 24, 160, 191])
  for (const [sx, sy] of [
    [4, 5],
    [5, 4],
  ]) {
    const row = cases[index],
      image = raster(row, sx, sy),
      r = scanImage(image, { trace: true });
    assert.ok(
      r.codes.some((c) => c.text === row.text),
      `Stretch ${index} ${sx}:${sy}`,
    );
    assert.equal(r.codes[0].decoderTrace.stage, 'decoded');
    assert.ok(r.diagnostics[0].detection.rowsScanned > 0);
    assert.ok(r.diagnostics[0].grouping.combinations > 0);
    stretched++;
  }
// QR-like corners surrounding deterministic random data must not create a payload.
let seed = 719;
const n = 29;
for (let trial = 0; trial < 12; trial++) {
  const bits = Uint8Array.from({ length: n * n }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 31;
  });
  for (const [left, top] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ])
    for (let y = -1; y <= 7; y++)
      for (let x = -1; x <= 7; x++) {
        const xx = left + x,
          yy = top + y;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        bits[yy * n + xx] = d === 3 || d <= 1 ? 1 : 0;
      }
  const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => {
    if (b) bytes[i >> 3] |= 1 << (7 - (i & 7));
  });
  assert.equal(
    scanImage(raster({ size: n, bits: bytes.toString('base64') }, 3, 3)).codes.length,
    0,
  );
}
const row = cases[0],
  bits = matrix(row);
for (let y = 11; y < 21; y++) for (let x = 11; x < 21; x++) bits[y * 21 + x] ^= 1;
const audit = {};
assert.throws(() => decodeMatrix(bits, 21, audit));
assert.equal(audit.stage, 'error-correction');
assert.ok(audit.repair.blocks[0].nonzeroSyndromes > 0);
const deadlineAudit = {};
assert.deepEqual(
  findPatterns(new Uint8Array(10000), 100, 100, deadlineAudit, performance.now() - 1),
  [],
);
assert.equal(deadlineAudit.rowsScanned, 0);
console.log(
  JSON.stringify({
    stretchedImages: stretched,
    falseCornerImages: 12,
    uncorrectableBlockRejected: true,
    detectionDeadline: true,
  }),
);
