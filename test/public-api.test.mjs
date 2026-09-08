import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { scan, decodeMatrix, VERSION } from '../dist/index.mjs';
const require = createRequire(import.meta.url);
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/qr-matrices.json', import.meta.url)),
).cases[0];
const bytes = Buffer.from(fixture.bits, 'base64');
const matrix = Uint8Array.from(
  { length: fixture.size ** 2 },
  (_, index) => (bytes[index >> 3] >> (7 - (index & 7))) & 1,
);
const width = (fixture.size + 8) * 4;
const pixels = new Uint8Array(width * width).fill(255);
for (let y = 0; y < fixture.size; y++)
  for (let x = 0; x < fixture.size; x++)
    if (matrix[y * fixture.size + x])
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++)
          pixels[((y + 4) * 4 + dy) * width + (x + 4) * 4 + dx] = 0;

test('ESM, CommonJS and browser global return exact payloads and leave pixels untouched', () => {
  const context = vm.createContext({
    Uint8Array,
    Uint8ClampedArray,
    TextDecoder,
    performance,
  });
  vm.runInContext(
    readFileSync(new URL('../dist/qr-sal.js', import.meta.url), 'utf8'),
    context,
  );
  for (const api of [
    { scan, decodeMatrix, VERSION },
    require('../dist/index.cjs'),
    context.QRSal,
  ]) {
    const before = pixels.slice();
    const result = api.scan({ width, height: width, data: pixels }, { multiple: false });
    assert.equal(result.codes.length, 1);
    assert.equal(result.codes[0].text, fixture.text);
    assert.equal(result.codes[0].corners.length, 4);
    assert.equal(result.codes[0].checksumPassed, true);
    assert.equal(result.engine, 'qr-sal-0.1.0');
    assert.deepEqual(pixels, before);
    assert.equal(api.decodeMatrix(matrix, fixture.size).text, fixture.text);
  }
});
test('RGBA and grayscale behave identically; unknown internal options cannot inject codes', () => {
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++)
    rgba.set([pixels[i], pixels[i], pixels[i], 255], i * 4);
  const result = scan({ width, height: width, data: rgba }, { multiple: false });
  assert.equal(result.codes[0].text, fixture.text);
  const blank = scan(
    { width: 100, height: 100, data: new Uint8Array(10000).fill(255) },
    { timeLimitMs: 100, seedCodes: [{ text: 'injected' }], enhanced: true },
  );
  assert.equal(blank.codes.length, 0);
});
test('invalid inputs and invalid matrices fail explicitly', () => {
  for (const value of [null, {}, { width, height: width, data: [] }])
    assert.throws(() => scan(value), TypeError);
  const image = { width, height: width, data: pixels };
  for (const timeLimitMs of [NaN, Infinity, -1, 99, 60001, '12000'])
    assert.throws(() => scan(image, { timeLimitMs }), RangeError);
  assert.throws(() => scan(image, { multiple: 'yes' }), TypeError);
  assert.throws(() => scan({ ...image, width: 0 }));
  assert.throws(() => scan({ ...image, data: pixels.subarray(1) }));
  assert.throws(() => decodeMatrix(new Uint8Array(441).fill(2), 21), TypeError);
  assert.throws(() => decodeMatrix(new Uint8Array(441), 21));
});
