import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = process.argv[2];
const url = (name) =>
  directory
    ? pathToFileURL(path.resolve(directory, name))
    : new URL(`../src/core/${name}`, import.meta.url);
const { FailureGridLog } = await import(url('failure-grids.mjs').href);
const { scanBinary } = await import(url('scanner.mjs').href);
const size = 21;
const grid = new Uint8Array(size * size);
const confidence = new Float32Array(size * size).fill(0.25);
const original = grid.slice();
const originalConfidence = confidence.slice();
const decoder = { stage: 'error-correction', formatCorrections: 0 };
const log = new FailureGridLog({ maxRegions: 2, perRegion: 2 });
log.record(grid, size, (x, y) => ({ x, y }), { mode: 'first' }, decoder, confidence);
log.record(grid, size, (x, y) => ({ x, y }), { mode: 'duplicate' }, decoder, confidence);
log.record(
  grid,
  size,
  (x, y) => ({ x: x + 200, y }),
  { mode: 'second' },
  decoder,
  confidence,
);
for (let i = 0; i < 30; i++) {
  const changed = grid.slice();
  changed[200 + i] = 1;
  log.record(
    changed,
    size,
    (x, y) => ({ x, y }),
    { mode: 'variation' },
    decoder,
    confidence,
  );
}
log.record(grid, size, () => ({ x: NaN, y: 0 }), {}, decoder);
log.record(grid, size, (x, y) => ({ x: x + 400, y }), {}, decoder);
const snapshot = JSON.parse(JSON.stringify(log.snapshot()));
assert.ok(snapshot.samples.length <= 4);
assert.equal(new Set(snapshot.samples.map((s) => s.region)).size, 2);
assert.equal(snapshot.duplicate, 1);
assert.equal(snapshot.invalidGeometry, 1);
assert.ok(snapshot.capacityDiscarded > 0);
assert.equal(snapshot.samples[0].confidenceHex.length, size * size * 2);
assert.ok(
  Math.abs(parseInt(snapshot.samples[0].confidenceHex.slice(0, 2), 16) / 255 - 0.25) <=
    0.5 / 255,
);
assert.deepEqual(grid, original);
assert.deepEqual(confidence, originalConfidence);
assert.throws(() => new FailureGridLog({ maxRegions: 0 }));
assert.throws(() => new FailureGridLog({ perRegion: 33 }));

const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases[4];
const packed = Buffer.from(fixture.bits, 'base64');
const scale = 4;
const width = (fixture.size + 8) * scale;
const pixels = new Uint8Array(width * width);
for (let y = 0; y < fixture.size * scale; y++) {
  for (let x = 0; x < fixture.size * scale; x++) {
    const i = Math.floor(y / scale) * fixture.size + Math.floor(x / scale);
    pixels[(y + 4 * scale) * width + x + 4 * scale] =
      (packed[i >> 3] >> (7 - (i & 7))) & 1;
  }
}
const quiet = scanBinary(pixels, width, width);
const traced = scanBinary(pixels, width, width, { trace: true });
assert.equal(quiet.diagnostics.failureGridAudit, undefined);
assert.ok(traced.diagnostics.failureGridAudit);
assert.deepEqual(
  traced.codes.map((c) => c.text),
  quiet.codes.map((c) => c.text),
);
assert.equal(traced.codes[0].text, fixture.text);
console.log(
  JSON.stringify({
    bounded: true,
    perRegion: true,
    immutableInputs: true,
    traceOnly: true,
    exactFixtureText: true,
  }),
);
