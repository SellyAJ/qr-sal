import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scanImage, binarize } from '../src/core/scanner.mjs';
import { completeFinderPairs } from '../src/core/finder-pairs.mjs';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;
function render({ dark = 0, light = 255, missing = 'none' } = {}) {
  const f = fixtures[4],
    n = f.size,
    packed = Buffer.from(f.bits, 'base64'),
    scale = 5,
    width = 400,
    height = 320,
    data = new Uint8Array(width * height).fill(245),
    x0 = 40,
    y0 = 45;
  for (let y = -4; y < n + 4; y++)
    for (let x = -4; x < n + 4; x++) {
      let bit =
        x >= 0 &&
        y >= 0 &&
        x < n &&
        y < n &&
        (packed[(y * n + x) >> 3] >> (7 - ((y * n + x) & 7))) & 1;
      if (
        (missing === 'center' && x === 3 && y === 3) ||
        (missing === 'finder' && x >= 0 && y >= 0 && x < 7 && y < 7)
      )
        bit = 0;
      if (
        missing === 'payload' &&
        !(
          (x >= n - 7 && x < n && y >= 0 && y < 7) ||
          (x >= 0 && x < 7 && y >= n - 7 && y < n)
        )
      )
        bit = 0;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++)
          data[(y0 + (y + 4) * scale + dy) * width + x0 + (x + 4) * scale + dx] = bit
            ? dark
            : light;
    }
  return { image: { width, height, data }, text: f.text };
}
for (const inverted of [false, true]) {
  const { image, text } = render({
    dark: inverted ? 18 : 8,
    light: inverted ? 8 : 18,
  });
  const result = scanImage(image, { trace: true });
  assert.deepEqual(
    result.codes.map((c) => c.text),
    [text],
    'Low-contrast QR against a bright surrounding page',
  );
}
const damaged = render({ missing: 'center' }),
  result = scanImage(damaged.image, { trace: true });
assert.deepEqual(
  result.codes.map((c) => c.text),
  [damaged.text],
);
const anchors = [
  { x: 167.5, y: 82.5, module: 5, hits: 10, quality: 1 },
  { x: 77.5, y: 172.5, module: 5, hits: 10, quality: 1 },
];
const hints = completeFinderPairs(
  binarize(damaged.image.data, 400, 320),
  400,
  320,
  anchors,
);
assert.ok(
  hints.some((p) => Math.hypot(p.x - 77.5, p.y - 82.5) < 2),
  'Two observed corners locate the remaining visible finder',
);
const missing = render({ missing: 'finder' }).image;
assert.ok(
  !completeFinderPairs(binarize(missing.data, 400, 320), 400, 320, anchors).some(
    (p) => Math.hypot(p.x - 77.5, p.y - 82.5) < 2,
  ),
  'A geometrically plausible empty location fails pixel verification',
);
const intactPayload = render({ missing: 'finder' }),
  sourceBefore = intactPayload.image.data.slice();
assert.deepEqual(
  scanImage(intactPayload.image).codes.map((c) => c.text),
  [intactPayload.text],
  'Two measured border shapes recover the existing payload without painting the missing finder',
);
assert.deepEqual(intactPayload.image.data, sourceBefore);
assert.equal(
  scanImage(render({ missing: 'payload' }).image).codes.length,
  0,
  'Two corners with no QR payload must not produce a result',
);
console.log(
  'Photometry: dim normal/inverted codes, source-preserving missing-finder recovery and empty-payload rejection passed.',
);
