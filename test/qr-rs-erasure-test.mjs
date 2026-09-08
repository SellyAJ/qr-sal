import fs from 'node:fs';
import assert from 'node:assert/strict';
import { correctBlock } from '../src/core/reed-solomon.mjs';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-rs-erasures.json', import.meta.url)),
).cases;
let seed = 38173,
  cases = 0;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
for (const f of fixtures) {
  assert.deepEqual([...correctBlock(f.encoded, f.ecc).bytes], f.encoded);
  for (let erased = 0; erased <= f.ecc; erased++)
    for (const extraGood of [0, 1]) {
      const errors = Math.floor((f.ecc - erased) / 2);
      const positions = Array.from({ length: f.encoded.length }, (_, i) => i);
      for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
      }
      const erasedPositions = positions.slice(0, erased),
        data = Uint8Array.from(f.encoded);
      for (const p of positions.slice(extraGood && erased ? 1 : 0, erased + errors))
        data[p] ^= 1 + Math.floor(random() * 255);
      const before = data.slice(),
        audit = {};
      const decoded = correctBlock(data, f.ecc, audit, erasedPositions);
      assert.deepEqual(
        [...decoded.bytes],
        f.encoded,
        JSON.stringify({ ecc: f.ecc, erased, errors, extraGood }),
      );
      assert.deepEqual(data, before);
      if (audit.capacityUsed !== undefined) assert.ok(audit.capacityUsed <= f.ecc);
      cases++;
    }
  for (const bad of [
    [-1],
    [f.encoded.length],
    [1, 1],
    [0.5],
    Array.from({ length: f.ecc + 1 }, (_, i) => i),
  ])
    assert.throws(() => correctBlock(f.encoded, f.ecc, null, bad));
}
console.log(
  JSON.stringify({
    independentBlocks: fixtures.length,
    errorAndErasureCases: cases,
    invalidMetadataCases: fixtures.length * 5,
    exactBytes: true,
    sourceUnchanged: true,
  }),
);
