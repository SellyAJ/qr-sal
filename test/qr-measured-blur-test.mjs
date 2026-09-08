import fs from 'node:fs';
import assert from 'node:assert/strict';
import { deblurGrid } from '../src/core/grid-deblur.mjs';
import { decodeMatrix } from '../src/core/matrix.mjs';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-measured-blur.json', import.meta.url)),
).cases;
let recovered = 0,
  newRecoveries = 0,
  incorrect = 0;
const failures = [];
for (const f of fixtures) {
  let base = false;
  try {
    base =
      decodeMatrix(
        Uint8Array.from(f.values, (v) => (v < 130 ? 1 : 0)),
        f.size,
      ).text === f.text;
  } catch {}
  const values = Float64Array.from(f.values),
    source = values.slice();
  const outputs = [];
  for (const t of deblurGrid(values, f.size))
    try {
      outputs.push(decodeMatrix(t.grid, f.size).text);
    } catch {}
  recovered += outputs.includes(f.text);
  newRecoveries += !base && outputs.includes(f.text);
  incorrect += outputs.filter((t) => t !== f.text).length;
  if (!outputs.includes(f.text))
    failures.push({ index: f.index, sx: f.sigmaX, sy: f.sigmaY, base });
  assert.deepEqual(source, values);
}
assert.equal(incorrect, 0);
assert.ok(newRecoveries > 0);
assert.equal(deblurGrid(new Float64Array(21 * 21).fill(200), 21).length, 0);
assert.equal(
  deblurGrid(Float64Array.from(fixtures[0].values), fixtures[0].size, {
    deadline: performance.now() - 1,
  }).length,
  0,
);
console.log(
  JSON.stringify({
    cases: fixtures.length,
    recovered,
    newRecoveries,
    incorrect,
    failures,
    sourceUnchanged: true,
  }),
);
