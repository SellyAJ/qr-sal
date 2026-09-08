import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = process.argv[2];
const moduleUrl = directory
  ? pathToFileURL(path.resolve(directory, 'scanner.mjs'))
  : new URL('../src/core/scanner.mjs', import.meta.url);
const { scanImage } = await import(moduleUrl.href);
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const width = 149;
const data = new Uint8Array(width * width);
let random = 1234;
for (let i = 0; i < data.length; i++) {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  data[i] = random >>> 24;
}
const original = data.slice();
const checks = [];
try {
  for (const requested of [35000, 60000, 90000]) {
    let clock = 0;
    // Model the passage of work time without making the test wait a minute.
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: { now: () => (clock += 25) },
    });
    const result = scanImage(
      { width, height: width, data },
      { timeLimitMs: requested, trace: true },
    );
    const effective = Math.min(requested, 60000);
    assert.ok(result.elapsedMs > effective - 2000);
    assert.ok(result.elapsedMs < effective + 2000);
    assert.ok(result.timedOut);
    assert.deepEqual(result.codes, []);
    assert.deepEqual(data, original);
    checks.push({ requested, simulatedElapsedMs: result.elapsedMs });
  }
} finally {
  Object.defineProperty(globalThis, 'performance', descriptor);
}
console.log(
  JSON.stringify({ fullBudgetHonored: true, upperBoundRetained: true, checks }),
);
