# API reference

## `scan(image, options?)`

Synchronous decode. The image is `{ width, height, data }`. Grayscale uses one byte per pixel. RGBA uses four bytes per pixel, in that order. Width and height must each be at least 21 pixels, with a maximum of 20 million pixels. Inputs are copied internally and never intentionally changed or detached.

| Option        | Default | Meaning                                                                                                                                          |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `timeLimitMs` | `12000` | Cooperative budget, from 100 to 60,000 milliseconds. Individual operations may overrun it.                                                       |
| `multiple`    | `true`  | Keep searching after finding a symbol. `false` stops additional passes after a success, but a successful pass may already return multiple codes. |
| `recovery`    | `true`  | Enable additional recovery passes.                                                                                                               |
| `pyramid`     | `true`  | Enable scale-space retries.                                                                                                                      |
| `trace`       | `false` | Include detailed development traces. These may contain decoded text and sampled source fragments.                                                |

The public wrapper copies only documented options. Internal seed results, known-answer data and geometry hints cannot be supplied to `scan`.

The return value includes `engine`, `codes`, `elapsedMs`, `timedOut`, `reason` and `diagnostics`. Every code includes:

| Field                                     | Meaning                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                                    | Decoded text. Always treat it as untrusted input.                                                                                                                 |
| `byteSegments`                            | Concatenated bytes from byte and Kanji segments. This is not a serialization of all segments; numeric and alphanumeric content exists in `text`.                  |
| `corners`                                 | Four boundary points, `{ x, y }`, in the processed input image coordinate system. Treat them as a polygon rather than assuming screen-relative top-left order.    |
| `version`, `size`                         | QR version and modules per side.                                                                                                                                  |
| `errorCorrection`, `mask`                 | Correction level (L/M/Q/H) and mask number.                                                                                                                       |
| `correctedCodewords`, `formatCorrections` | Error-repair counts, not a calibrated confidence score.                                                                                                           |
| `checksumPassed`                          | QR format, parsing and Reed–Solomon checks succeeded. The name is retained for compatibility; it does not mean a cryptographic checksum or issuer authentication. |

Geometry and diagnostic details beyond these fields are experimental. The decoder can return conflicting, independently validated readings of the same region; it does not silently pick one using expected content. With tracing enabled, `collection.conflicts` records observed contradictions. Any conflicting readings require investigation. Do not count raw results as a guaranteed count of physical symbols.

## Browser worker

```js
import { createScanner, imageFromBlob } from 'qr-sal/browser';
const scanner = createScanner({ workerUrl: '/assets/qr-sal-worker.mjs' });
const controller = new AbortController();

try {
  const image = await imageFromBlob(file);
  const result = await scanner.scan(
    image,
    { timeLimitMs: 35000 },
    {
      signal: controller.signal,
    },
  );
  console.log(result.codes);
} finally {
  scanner.dispose();
}
```

`cancel()` terminates the running worker and rejects its request with `AbortError`; the next scan creates a fresh worker. `dispose()` permanently closes that scanner. There is one in-flight request per scanner. A concurrent request rejects with a busy error. An independent watchdog terminates a stuck worker five seconds after the requested budget; those partial results are unavailable. Pixel buffers are cloned, not transferred away from the caller.

The default worker URL is `worker.mjs` beside the browser adapter. When using a bundler, explicitly copy the built worker into public assets if it does not handle `new URL('./worker.mjs', import.meta.url)`. Use HTTP(S), not `file://`, and a CSP that permits same-origin module workers.

`imageFromBlob(file, { maxPixels: 8000000 })` supports PNG, JPEG, WebP, GIF and BMP accepted by the browser. It uses `createImageBitmap`, which applies the browser’s image orientation handling. Animated files use a single decoded frame. Large images are proportionally downscaled, so corners are in the resized coordinate system. Encoded inputs are capped at 50 MB. Decoding the source image may allocate memory before resizing; apply stricter upstream limits for untrusted bulk inputs.

PDF rendering belongs to the application. The demo uses PDF.js, then supplies rendered RGBA pages to the same worker. It processes up to 100 pages, in order, and retains finished page results on cancellation. At most 8 million rendered pixels per page are passed to the decoder.

## Classic script

Copy `dist/qr-sal.js` beside your page:

```html
<script src="./qr-sal.js"></script>
<script>
  const result = QRSal.scan(imageData, { multiple: false });
  console.log(result.codes);
</script>
```

This is synchronous and can block rendering. The demo uses the worker adapter instead.

## Node / CommonJS

```js
const { scan } = require('qr-sal');
const result = scan({ width, height, data: grayscaleBuffer });
console.log(result.codes);
```

Node input must already be decoded into grayscale/RGBA pixels using an image loader you choose. Compressed PNG/JPEG file bytes are not pixel data. Use worker threads or process isolation around untrusted or large workloads; a cooperative budget alone is not a security boundary.

## `decodeMatrix(matrix, size)`

Reads an already sampled, square QR Model 2 module grid: a `Uint8Array` containing only 0 (light) and 1 (dark), in row-major order. The grid excludes the surrounding quiet zone. This lower-level API throws on invalid input, failed correction or unsupported payloads. It returns the same text/metadata fields as an image decode, without corners.

## Encodings

Numeric, alphanumeric, byte and Kanji segment modes are supported. FNC1 headers are recognized; this is not a complete GS1 application parser. Supported ECI assignments: 3 (ISO-8859-1), 20 (Shift JIS), 26 (UTF-8), and 27 (ASCII). For unlabelled bytes, UTF-8 is attempted with a Latin-1 fallback. The runtime must provide the corresponding `TextDecoder` encodings. Structured-append QR messages are rejected until companion-symbol assembly is implemented. Unknown modes/ECI assignments are rejected rather than guessed.
