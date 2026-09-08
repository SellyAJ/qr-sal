import fs from 'node:fs';
import assert from 'node:assert/strict';
import { decodeMatrix } from '../src/core/matrix.mjs';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
const unpack = (f) => {
  const b = Buffer.from(f.bits, 'base64');
  return Uint8Array.from(
    { length: f.size * f.size },
    (_, i) => (b[i >> 3] >> (7 - (i & 7))) & 1,
  );
};
for (const f of fixtures) assert.equal(decodeMatrix(unpack(f), f.size).text, f.text);
let recovered = 0;
for (const [index, errors] of [
  [1, 6],
  [2, 7],
  [3, 9],
]) {
  const f = fixtures[index],
    n = f.size,
    grid = unpack(f),
    confidence = new Float32Array(n * n).fill(1),
    cells = [];
  let up = true;
  for (let right = n - 1; right >= 9; right -= 2) {
    for (let i = 0; i < n; i++) {
      const y = up ? n - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (y <= 8 && x >= n - 8) continue;
        if (y === 6) continue;
        cells.push(y * n + x);
      }
    }
    up = !up;
  }
  for (let b = 0; b < errors; b++) {
    grid[cells[b * 8]] ^= 1;
    if (b < 4) confidence[cells[b * 8]] = 0;
  }
  assert.throws(() => decodeMatrix(grid, n));
  const source = grid.slice(),
    audit = {};
  assert.equal(decodeMatrix(grid, n, audit, { confidence }).text, f.text);
  assert.ok(audit.repair.blocks.some((b) => b.erasureRecovery));
  assert.deepEqual(grid, source);
  recovered++;
  assert.throws(() => decodeMatrix(grid, n, null, { confidence: new Float32Array(1) }));
  assert.throws(() =>
    decodeMatrix(grid, n, null, {
      confidence: new Float32Array(n * n).fill(NaN),
    }),
  );
}
console.log(
  JSON.stringify({
    unchangedMatrixFixtures: fixtures.length,
    previouslyUncorrectableRecovered: recovered,
    metadataRejections: recovered * 2,
  }),
);
