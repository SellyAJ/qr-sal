import fs from 'node:fs';
import assert from 'node:assert/strict';
import { finderCoreBorders } from '../src/core/core-control.mjs';
import { finderBorders, fitFinderMap } from '../src/core/finder-geometry.mjs';
import { grayGridTrials } from '../src/core/gray-grid.mjs';
import { decodeMatrix } from '../src/core/matrix.mjs';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
let recovered = 0;
for (const index of [0, 4, 8])
  for (const scale of [3, 6]) {
    const f = fixtures[index],
      n = f.size,
      w = (n + 20) * scale,
      packed = Buffer.from(f.bits, 'base64'),
      bits = new Uint8Array(w * w);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if ((packed[(y * n + x) >> 3] >> (7 - ((y * n + x) & 7))) & 1)
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++)
              bits[((y + 10) * scale + dy) * w + (x + 10) * scale + dx] = 1;
    // Connect the outer TL border to outside the local border-tracing window.
    for (let y = 0; y < 10 * scale; y++) bits[y * w + 11 * scale] = 1;
    const source = bits.slice(),
      gray = Uint8Array.from(bits, (v) => (v ? 20 : 240));
    const [tl, tr, bl] = [
      [3.5, 3.5],
      [n - 3.5, 3.5],
      [3.5, n - 3.5],
    ].map(([x, y]) => ({
      x: (x + 10) * scale,
      y: (y + 10) * scale,
      module: scale,
    }));
    const group = { tl, tr, bl };
    assert.equal(finderBorders(bits, w, w, group).corners, null);
    const core = finderCoreBorders(bits, w, w, group);
    assert.ok(core);
    assert.equal(core.inset, 2);
    assert.equal(core.span, 3);
    const fit = fitFinderMap(core, n);
    assert.ok(fit);
    assert.ok(fit.residualModules < 1e-5);
    const texts = [];
    for (const t of grayGridTrials(gray, w, w, fit.map, n))
      try {
        texts.push(decodeMatrix(t.grid, n).text);
      } catch {}
    assert.ok(texts.includes(f.text));
    assert.ok(texts.every((t) => t === f.text));
    assert.deepEqual(bits, source);
    recovered++;
    assert.equal(
      finderCoreBorders(bits, w, w, group, { deadline: performance.now() - 1 }),
      null,
    );
    assert.equal(finderCoreBorders(new Uint8Array(w * w), w, w, group), null);
  }
console.log(
  JSON.stringify({
    connectedOuterBordersRecovered: recovered,
    blankRejections: recovered,
    expiredDeadlines: recovered,
    sourceUnchanged: true,
  }),
);
