import { scan, decodeMatrix, type QRCode, type PixelImage } from 'qr-sal';
import { createScanner, imageFromBlob } from 'qr-sal/browser';
const image: PixelImage = { width: 100, height: 100, data: new Uint8Array(10000) };
const codes: QRCode[] = scan(image, { multiple: true }).codes;
const text: string = codes[0].text;
const version: number = decodeMatrix(new Uint8Array(441), 21).version;
const scanner = createScanner();
void scanner.scan(image, { trace: true }, { signal: new AbortController().signal });
void imageFromBlob(new Blob(), { maxPixels: 1000000 });
scanner.dispose();
void text;
void version;
// @ts-expect-error Pixel buffers cannot be ordinary arrays.
scan({ width: 21, height: 21, data: [] });
// @ts-expect-error time limits are numbers.
scan(image, { timeLimitMs: 'fast' });
