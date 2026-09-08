import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scanImage } from '../src/core/scanner.mjs';
import { timingWarp } from '../src/core/grid-recovery.mjs';
const cases = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
let passed = 0;
for (const index of [8, 16, 24, 32]) {
  const row = cases[index],
    n = row.size,
    bytes = Buffer.from(row.bits, 'base64'),
    scale = 7,
    w = (n + 8) * scale,
    data = new Uint8Array(w * w).fill(255);
  const displacement = (y) =>
    y < 7 || y > n - 7 ? 0 : 0.8 * Math.sin((Math.PI * (y - 7)) / (n - 14));
  for (let y = 0; y < w; y++) {
    const projected = y / scale - 4;
    let source = projected;
    for (let i = 0; i < 8; i++) source = projected - displacement(source);
    const yy = Math.floor(source);
    if (yy < 0 || yy >= n) continue;
    for (let x = 0; x < w; x++) {
      const xx = Math.floor(x / scale - 4);
      if (xx < 0 || xx >= n) continue;
      const bit = yy * n + xx;
      if ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1) data[y * w + x] = 0;
    }
  }
  const result = scanImage({ width: w, height: w, data }, { trace: true });
  assert.ok(
    result.codes.some((c) => c.text === row.text),
    `Nonuniform row stretch ${index}`,
  );
  passed++;
  const bits = Uint8Array.from(data, (v) => (v < 128 ? 1 : 0)),
    warp = timingWarp(
      bits,
      w,
      w,
      (x, y) => ({ x: (x + 4) * scale, y: (y + 4) * scale }),
      n,
    );
  for (const axis of ['horizontal', 'vertical']) {
    const shifts = warp.trace[axis].shifts;
    for (let i = 1; i < shifts.length; i++)
      assert.ok(i + shifts[i] > i - 1 + shifts[i - 1], 'Warp must preserve module order');
    assert.ok(warp.trace[axis].maxShift <= 1.8);
  }
}
console.log(
  JSON.stringify({
    nonuniformStretchFixtures: passed,
    boundedMonotonicWarp: true,
  }),
);
