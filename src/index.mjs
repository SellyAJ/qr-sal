import { scanImage, ENGINE_VERSION } from './core/scanner.mjs';
import { decodeMatrix as readMatrix } from './core/matrix.mjs';

export const VERSION = ENGINE_VERSION;
const booleanOptions = ['multiple', 'recovery', 'pyramid', 'trace'];

/** Decode grayscale or RGBA pixels. Synchronous: use the browser worker adapter in UIs. */
export function scan(image, options = {}) {
  if (!image || typeof image !== 'object')
    throw new TypeError('Expected an image with width, height, and data');
  if (!(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray))
    throw new TypeError('Image data must be a Uint8Array or Uint8ClampedArray');
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Expected scan options');
  // An allowlist keeps internal recovery controls and seed results private.
  const settings = {};
  for (const key of booleanOptions) {
    if (options[key] !== undefined) {
      if (typeof options[key] !== 'boolean')
        throw new TypeError(`${key} must be a boolean`);
      settings[key] = options[key];
    }
  }
  if (options.timeLimitMs !== undefined) {
    if (
      !Number.isFinite(options.timeLimitMs) ||
      options.timeLimitMs < 100 ||
      options.timeLimitMs > 60000
    )
      throw new RangeError('timeLimitMs must be between 100 and 60000');
    settings.timeLimitMs = options.timeLimitMs;
  }
  return scanImage(image, settings);
}

/** Decode a sampled square Model 2 matrix, row-major: 1 is dark and 0 is light. */
export function decodeMatrix(matrix, size) {
  if (
    !(matrix instanceof Uint8Array) ||
    matrix.some((value) => value !== 0 && value !== 1)
  )
    throw new TypeError('Matrix must be a Uint8Array containing only 0 and 1');
  return readMatrix(matrix, size);
}
