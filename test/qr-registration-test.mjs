import fs from 'node:fs';
import assert from 'node:assert/strict';
import { refineMap } from '../src/core/refine-map.mjs';
import { grayGridTrials } from '../src/core/gray-grid.mjs';
import { decodeMatrix } from '../src/core/matrix.mjs';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
let recovered = 0;
for (const index of [0, 4, 8])
  for (const sign of [-1, 1]) {
    const f = fixtures[index],
      n = f.size,
      scale = 6,
      w = (n + 12) * scale,
      b = Buffer.from(f.bits, 'base64'),
      gray = new Uint8Array(w * w).fill(235);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if ((b[(y * n + x) >> 3] >> (7 - ((y * n + x) & 7))) & 1)
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++)
              gray[((y + 6) * scale + dy) * w + (x + 6) * scale + dx] = 25;
    const source = gray.slice();
    const base = (x, y) => ({
      x: (x + 6) * scale + sign * (2.5 + (0.8 * x) / n),
      y: (y + 6) * scale - sign * (1.8 + (0.8 * y) / n),
    });
    const map = refineMap(gray, w, w, base, n);
    assert.ok(map);
    assert.ok(map.registration.after < map.registration.before * 0.98);
    assert.ok(
      map.registration.cornerDisplacementsModules.every((v) => Math.abs(v) <= 1.5),
    );
    const texts = [];
    for (const trial of grayGridTrials(gray, w, w, map, n))
      try {
        texts.push(decodeMatrix(trial.grid, n).text);
      } catch {}
    assert.ok(texts.includes(f.text), `fixture ${index}, sign ${sign}`);
    assert.ok(texts.every((t) => t === f.text));
    assert.deepEqual(gray, source);
    recovered++;
    assert.equal(
      refineMap(gray, w, w, base, n, { deadline: performance.now() - 1 }),
      null,
    );
  }
assert.equal(
  refineMap(
    new Uint8Array(200 * 200).fill(255),
    200,
    200,
    (x, y) => ({ x: x + 20, y: y + 20 }),
    21,
  ),
  null,
);
console.log(
  JSON.stringify({
    registeredImages: recovered,
    expiredDeadlines: recovered,
    blankRejections: 1,
    sourceUnchanged: true,
  }),
);
