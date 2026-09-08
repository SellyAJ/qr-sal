import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scanBinary } from '../src/core/scanner.mjs';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
let recovered = 0;
for (const index of [0, 4, 8])
  for (const missing of [0, 1, 2]) {
    const f = fixtures[index],
      n = f.size,
      scale = 5,
      w = (n + 8) * scale,
      packed = Buffer.from(f.bits, 'base64');
    const grid = Uint8Array.from(
      { length: n * n },
      (_, i) => (packed[i >> 3] >> (7 - (i & 7))) & 1,
    );
    const [left, top] = [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ][missing];
    const bits = new Uint8Array(w * w);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (x >= left && x < left + 7 && y >= top && y < top + 7) continue;
        if (!grid[y * n + x]) continue;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++)
            bits[((y + 4) * scale + dy) * w + (x + 4) * scale + dx] = 1;
      }
    const source = bits.slice(),
      result = scanBinary(bits, w, w, {
        trace: true,
        gray: Uint8Array.from(bits, (v) => (v ? 0 : 255)),
        enhanced: true,
        deadline: performance.now() + 5000,
      });
    assert.ok(
      result.codes.some((c) => c.text === f.text),
      `fixture ${index}, missing ${missing}`,
    );
    assert.ok(result.codes.every((c) => c.text === f.text));
    assert.deepEqual(source, bits);
    recovered++;
    // The same two corner patterns with all payload/timing cells blank is not a QR.
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const inFinder = [
          [0, 0],
          [n - 7, 0],
          [0, n - 7],
        ].some(([a, b]) => x >= a && x < a + 7 && y >= b && y < b + 7);
        if (inFinder) continue;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++)
            bits[((y + 4) * scale + dy) * w + (x + 4) * scale + dx] = 0;
      }
    assert.equal(
      scanBinary(bits, w, w, {
        gray: Uint8Array.from(bits, (v) => (v ? 0 : 255)),
        enhanced: true,
        deadline: performance.now() + 5000,
      }).codes.length,
      0,
    );
  }
console.log(
  JSON.stringify({
    recoveredMissingCorners: recovered,
    rejectedEmptyPayloads: recovered,
    sourceUnchanged: true,
  }),
);
