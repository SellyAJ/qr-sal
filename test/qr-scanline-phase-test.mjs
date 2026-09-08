import fs from 'node:fs';
import assert from 'node:assert/strict';
import { latticePhase } from '../src/core/lattice-phase.mjs';
import { grayGridTrials } from '../src/core/gray-grid.mjs';
import { decodeMatrix } from '../src/core/matrix.mjs';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
let recovered = 0,
  baseRecovered = 0;
for (const index of [0, 4, 8])
  for (const sign of [-1, 1]) {
    const f = fixtures[index],
      n = f.size,
      scale = 8,
      w = (n + 16) * scale,
      b = Buffer.from(f.bits, 'base64'),
      gray = new Uint8Array(w * w).fill(235);
    for (let y = 0; y < n * scale; y++) {
      const shift = sign * Math.round(5 * Math.sin((2 * Math.PI * y) / 17));
      for (let x = 0; x < n * scale; x++) {
        const cell = Math.floor(y / scale) * n + Math.floor(x / scale);
        if ((b[cell >> 3] >> (7 - (cell & 7))) & 1)
          gray[(y + 8 * scale) * w + x + 8 * scale + shift] = 25;
      }
    }
    const base = (x, y) => ({ x: (x + 8) * scale, y: (y + 8) * scale }),
      source = gray.slice();
    let initial = false;
    for (const trial of grayGridTrials(gray, w, w, base, n))
      try {
        initial ||= decodeMatrix(trial.grid, n).text === f.text;
      } catch {}
    baseRecovered += initial;
    const texts = [];
    for (const map of latticePhase(gray, w, w, base, n))
      for (const trial of grayGridTrials(gray, w, w, map, n))
        try {
          texts.push(decodeMatrix(trial.grid, n).text);
        } catch {}
    assert.ok(texts.includes(f.text), `fixture ${index} sign ${sign}`);
    assert.ok(texts.every((t) => t === f.text));
    assert.deepEqual(source, gray);
    recovered++;
  }
assert.equal(
  latticePhase(
    new Uint8Array(100 * 100).fill(255),
    100,
    100,
    (x, y) => ({ x: x + 10, y: y + 10 }),
    21,
  ).length,
  0,
);
console.log(
  JSON.stringify({
    rollingScanlineCases: recovered,
    initiallyReadable: baseRecovered,
    sourceUnchanged: true,
    blankRejected: true,
  }),
);
