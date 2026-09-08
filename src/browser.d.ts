import type { PixelImage, ScanOptions, ScanResult } from './index.mjs';
export interface Scanner {
  scan(
    image: PixelImage,
    options?: ScanOptions,
    request?: { signal?: AbortSignal },
  ): Promise<ScanResult>;
  cancel(): void;
  dispose(): void;
}
export declare function createScanner(options?: { workerUrl?: string | URL }): Scanner;
/** Large images are downscaled to maxPixels (default 8 million). */
export declare function imageFromBlob(
  blob: Blob,
  options?: { maxPixels?: number },
): Promise<ImageData>;
