import fs from 'node:fs';
import assert from 'node:assert/strict';
import { decodeMatrix as after } from '../src/core/matrix.mjs';
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
let checks = 0,
  failedAudits = 0,
  erasureFailures = 0,
  state = 73061;
const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
function run(fn, grid, n, confidence, audit) {
  try {
    return { result: fn(grid, n, audit, { confidence }) };
  } catch (e) {
    return { error: e.message };
  }
}
for (const f of fixtures.slice(0, 40))
  for (const damage of [0, 3, 9, 21, 45, 90]) {
    const grid = unpack(f),
      n = f.size,
      confidence = new Float32Array(n * n).fill(1);
    for (let k = 0; k < damage; k++) {
      // Central/bottom-right payload area; preserve the three finder headers.
      const x = 9 + Math.floor(random() * (n - 9)),
        y = 9 + Math.floor(random() * (n - 9)),
        i = y * n + x;
      grid[i] ^= 1;
      confidence[i] = random() * 0.18;
    }
    const source = grid.slice(),
      b = {};
    const current = run(after, grid, n, confidence, b);
    if (current.result) assert.equal(current.result.text, f.text);
    assert.deepEqual(run(after, grid, n, confidence, null), current);
    checks++;
    if (b.repair?.blocks.some((block) => block.originalFailure)) failedAudits++;
    for (const block of b.repair?.blocks ?? [])
      if (block.originalFailure && current.error) {
        assert.ok(Array.isArray(block.erasureTrials));
        assert.ok(Number.isInteger(block.erasureEligibleCodewords));
        for (const trial of block.erasureTrials)
          assert.equal(typeof trial.accepted, 'boolean');
        erasureFailures++;
      }
    assert.deepEqual(grid, source);
  }
assert.ok(failedAudits > 10);
assert.ok(erasureFailures > 10);
console.log(
  JSON.stringify({
    matrixCases: checks,
    failedRepairAudits: failedAudits,
    preservedFailedErasureEvidence: erasureFailures,
    traceIndependentResults: true,
    allReturnedPayloadsExact: true,
    sourceUnchanged: true,
  }),
);
