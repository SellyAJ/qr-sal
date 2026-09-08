import assert from 'node:assert/strict';
import { binarize } from '../src/core/scanner.mjs';

// Independent direct-window calculation: intentionally no integral images.
function reference(gray, w, h, mode) {
  const result = new Uint8Array(gray.length);
  const radius = typeof mode === 'object' ? mode.radius : 20;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0,
        squares = 0,
        count = 0;
      for (let j = Math.max(0, y - radius); j < Math.min(h, y + radius + 1); j++) {
        for (let i = Math.max(0, x - radius); i < Math.min(w, x + radius + 1); i++) {
          const value = gray[j * w + i];
          sum += value;
          squares += value * value;
          count++;
        }
      }
      const mean = sum / count;
      const deviation = Math.sqrt(Math.max(0, squares / count - mean * mean));
      const offset =
        mode === true
          ? 7
          : typeof mode === 'object'
            ? Math.max(0.05, deviation * 0.07)
            : Math.max(0.6, Math.min(7, deviation * 0.15));
      result[y * w + x] = gray[y * w + x] < mean - offset ? 1 : 0;
    }
  }
  return result;
}

let comparisons = 0;
for (const [w, h] of [
  [21, 21],
  [43, 23],
  [25, 65],
]) {
  for (const kind of ['white', 'black', 'gradient', 'noise']) {
    let state = 48319;
    const gray = Uint8Array.from({ length: w * h }, (_, i) => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return kind === 'white'
        ? 255
        : kind === 'black'
          ? 0
          : kind === 'gradient'
            ? Math.floor(((i % w) * 255) / (w - 1))
            : state & 255;
    });
    const original = gray.slice();
    for (const mode of [
      true,
      'contrast',
      { radius: 5 },
      { radius: 10 },
      { radius: 40 },
      { radius: 80 },
    ]) {
      const expected = reference(gray, w, h, mode);
      assert.deepEqual(binarize(gray, w, h, mode), expected);
      assert.deepEqual(
        binarize(gray, w, h, mode, true),
        expected.map((bit) => bit ^ 1),
      );
      assert.deepEqual(gray, original);
      comparisons += 2;
    }
  }
}
console.log(
  JSON.stringify({
    thresholdComparisons: comparisons,
    bordersAndUniformImages: true,
    sourceUnchanged: true,
  }),
);
