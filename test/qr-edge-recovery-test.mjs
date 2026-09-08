import assert from 'node:assert/strict';
import fs from 'node:fs';
import { edgeWarp } from '../src/core/grid-recovery.mjs';
import { sample } from '../src/core/scanner.mjs';
import { decodeMatrix } from '../src/core/matrix.mjs';

const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-edge-matrices.json', import.meta.url), 'utf8'),
).cases;
let recovered = 0;
for (const fixture of fixtures) {
  const n = fixture.size,
    scale = 7,
    w = (n + 8) * scale,
    packed = Buffer.from(fixture.bits, 'base64'),
    matrix = Uint8Array.from(
      { length: n * n },
      (_, i) => (packed[i >> 3] >> (7 - (i & 7))) & 1,
    );
  assert.equal(decodeMatrix(matrix, n).text, fixture.text);
  for (const strength of [0.6, 1.0]) {
    // A spatially varying distortion, rendered without any decoder helpers.
    const displacement = (x, y) => ({
      x: 0.2 * Math.sin((Math.PI * x) / n) * Math.sin((Math.PI * y) / n),
      y: strength * Math.sin((Math.PI * y) / n) * (1 - (0.5 * x) / n),
    });
    const bits = new Uint8Array(w * w);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const tx = (x + 0.5) / scale - 4,
          ty = (y + 0.5) / scale - 4;
        let sx = tx,
          sy = ty;
        for (let k = 0; k < 8; k++) {
          const d = displacement(sx, sy);
          sx = tx - d.x;
          sy = ty - d.y;
        }
        const xx = Math.floor(sx),
          yy = Math.floor(sy);
        if (xx >= 0 && yy >= 0 && xx < n && yy < n) bits[y * w + x] = matrix[yy * n + xx];
      }
    const map = (x, y) => ({ x: (x + 4) * scale, y: (y + 4) * scale });
    const warp = edgeWarp(bits, w, w, map, n);
    assert.ok(warp);
    for (const axis of ['horizontal', 'vertical'])
      for (const band of warp.trace[axis]) {
        assert.ok(band.maxShift <= 2);
        for (let k = 1; k < band.shifts.length; k++) {
          assert.ok(Math.abs(band.shifts[k] - band.shifts[k - 1]) <= 0.400001);
          assert.ok(k + band.shifts[k] > k - 1 + band.shifts[k - 1]);
        }
      }
    const grid = sample(bits, w, w, warp.map, n);
    assert.ok(grid);
    assert.equal(
      decodeMatrix(grid, n).text,
      fixture.text,
      `Version ${(n - 17) / 4}, stretch ${strength}`,
    );
    assert.equal(edgeWarp(bits, w, w, map, n, { deadline: -Infinity }), null);
    recovered++;
  }
}
const outside = edgeWarp(
  new Uint8Array(10000),
  100,
  100,
  () => ({ x: -100, y: -100 }),
  41,
);
assert.equal(outside, null, 'Out of image cannot become white-module evidence');
console.log(
  JSON.stringify({
    denseDistortedSymbols: recovered,
    boundedMonotonicStrips: true,
    deadlineAndBounds: true,
  }),
);
