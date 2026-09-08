import assert from 'node:assert/strict';
import { mergeFinderObservations } from '../src/core/finder-fusion.mjs';
const a = { x: 10, y: 10, module: 3, quality: 0.8, hits: 4 };
const b = { x: 10.5, y: 9.5, module: 3.1, quality: 1, hits: 3 };
const separate = { x: 30, y: 10, module: 3, quality: 0.9, hits: 2 };
const first = [a],
  next = [b, separate];
const immutable = JSON.stringify([first, next]);
const merged = mergeFinderObservations(first, next);
assert.equal(merged.length, 2);
assert.equal(merged[0].x, b.x);
assert.equal(merged[0].observationCount, 2);
assert.equal(JSON.stringify([first, next]), immutable);
assert.notEqual(merged[0], b);
assert.notEqual(merged[1], separate);
assert.equal(
  mergeFinderObservations(
    [],
    [
      { ...a, x: NaN },
      { ...a, module: 0 },
      { ...a, quality: 0.5 },
    ],
  ).length,
  0,
);
assert.equal(mergeFinderObservations([], [a, separate], 1).length, 1);
assert.equal(mergeFinderObservations([a], [{ ...a, module: 7 }]).length, 2);
// A new image receives a new empty observation pool; there is no module cache.
assert.equal(mergeFinderObservations([], []).length, 0);
console.log(
  JSON.stringify({
    clusterMerge: true,
    separateRegionsRetained: true,
    invalidRejected: 3,
    bounded: true,
    sourceUnchanged: true,
    noSharedState: true,
  }),
);
