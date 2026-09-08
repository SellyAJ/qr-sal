import assert from 'node:assert/strict';
import fs from 'node:fs';
import { grayGridTrials } from '../src/core/gray-grid.mjs';
import { decodeMatrix } from '../src/core/matrix.mjs';

const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases;

// Independent image formation: convolve a rendered code with a Gaussian PSF.
// Neither the sampling code nor its unsharp filter constructs these pixels.
function render(fixture, sigmaModules, inverted = false, corrupt = false) {
  const n = fixture.size,
    scale = 6,
    width = (n + 8) * scale,
    packed = Buffer.from(fixture.bits, 'base64'),
    source = new Float64Array(width * width).fill(205);
  let seed = 781;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const index = y * n + x;
      let bit = (packed[index >> 3] >> (7 - (index & 7))) & 1;
      if (corrupt && x >= 9 && y >= 9) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        bit = seed >>> 31;
      }
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++)
          source[((y + 4) * scale + dy) * width + (x + 4) * scale + dx] = bit ? 25 : 205;
    }
  const sigma = sigmaModules * scale,
    radius = Math.ceil(3 * sigma),
    kernel = Array.from({ length: radius * 2 + 1 }, (_, i) =>
      Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)),
    ),
    weight = kernel.reduce((a, b) => a + b),
    horizontal = new Float64Array(source.length),
    data = new Uint8Array(source.length);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++)
        sum +=
          source[y * width + Math.max(0, Math.min(width - 1, x + k))] *
          kernel[k + radius];
      horizontal[y * width + x] = sum / weight;
    }
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++)
        sum +=
          horizontal[Math.max(0, Math.min(width - 1, y + k)) * width + x] *
          kernel[k + radius];
      data[y * width + x] = Math.round(inverted ? 255 - sum / weight : sum / weight);
    }
  return {
    data,
    width,
    n,
    map: (x, y) => ({ x: (x + 4) * scale, y: (y + 4) * scale }),
  };
}

let recovered = 0,
  checked = 0;
for (const index of [0, 4, 8, 24])
  for (const sigma of [0.45, 0.55, 0.65])
    for (const inverted of [false, true]) {
      const fixture = fixtures[index],
        { data, width, n, map } = render(fixture, sigma, inverted),
        source = data.slice(),
        successful = [];
      for (const trial of grayGridTrials(data, width, width, map, n)) {
        if (!trial.trace.shapeAccepted) continue;
        let decoded;
        try {
          decoded = decodeMatrix(trial.grid, n);
        } catch {
          continue;
        }
        assert.equal(
          decoded.text,
          fixture.text,
          'Every accepted trial must match the independent fixture',
        );
        successful.push(trial.trace.mode);
      }
      if (
        successful.includes('module-unsharp') &&
        successful.every((m) => m === 'module-unsharp')
      )
        recovered++;
      assert.deepEqual(data, source, 'Source evidence is never mutated');
      checked++;
    }
assert.ok(
  recovered > 0,
  'Sharpening must recover at least one independently blurred fixture the older trials cannot read',
);

let illuminationRecovered = 0;
for (const inverted of [false, true]) {
  const fixture = fixtures[8],
    { data, width, n, map } = render(fixture, 0.25);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const distance =
          ((x / 6 - 4 - n * 0.6) ** 2 + (y / 6 - 4 - n * 0.6) ** 2) / (2 * 5 ** 2),
        luminance = data[y * width + x] * 0.25 + 150 * Math.exp(-distance);
      data[y * width + x] = Math.round(inverted ? 255 - luminance : luminance);
    }
  for (const trial of grayGridTrials(data, width, width, map, n)) {
    if (!trial.trace.shapeAccepted) continue;
    let decoded;
    try {
      decoded = decodeMatrix(trial.grid, n);
    } catch {
      continue;
    }
    assert.equal(decoded.text, fixture.text);
    if (trial.trace.mode === 'module-local-mean') illuminationRecovered++;
  }
}
assert.ok(
  illuminationRecovered >= 2,
  'Module-scale illumination correction must recover both polarities',
);

for (const index of [0, 4, 8, 24]) {
  const { data, width, n, map } = render(fixtures[index], 0.45, false, true);
  for (const trial of grayGridTrials(data, width, width, map, n))
    assert.throws(
      () => decodeMatrix(trial.grid, n),
      'Randomized payload cells must not be repaired into a claimed answer',
    );
  assert.deepEqual(
    grayGridTrials(data, width, width, map, n, { deadline: -Infinity }),
    [],
  );
  assert.deepEqual(
    grayGridTrials(data, width, width, () => ({ x: -10, y: -10 }), n),
    [],
  );
}
console.log(
  JSON.stringify({
    blurredCases: checked,
    recoveredOnlyWithUnsharp: recovered,
    illuminationTrialsRecovered: illuminationRecovered,
    corruptedSymbolsRejected: 4,
    sourcePreserved: true,
  }),
);
