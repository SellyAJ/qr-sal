export interface PixelImage {
  width: number;
  height: number;
  /** Row-major grayscale (width * height) or RGBA (width * height * 4). */
  data: Uint8Array | Uint8ClampedArray;
}
export interface ScanOptions {
  /** Cooperative budget, 100–60000 ms. Default 12000. Not a hard deadline. */
  timeLimitMs?: number;
  /** Continue looking for additional symbols. Default true. */
  multiple?: boolean;
  /** Enable geometry, contrast, and other recovery passes. Default true. */
  recovery?: boolean;
  /** Enable scale-space retries. Default true. */
  pyramid?: boolean;
  /** Include detailed development diagnostics. May contain sampled input data. */
  trace?: boolean;
}
export interface Point {
  x: number;
  y: number;
}
export interface MatrixResult {
  text: string;
  /** Concatenated byte/Kanji segment bytes; not bytes of numeric/alphanumeric segments. */
  byteSegments: number[];
  version: number;
  size: number;
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  mask: number;
  correctedCodewords: number;
  formatCorrections: number;
  /** QR structural/error-correction checks passed. Not an authenticity guarantee. */
  checksumPassed: true;
}
export interface QRCode extends MatrixResult {
  corners: Point[];
  preprocessing?: string;
  [detail: string]: unknown;
}
export interface ScanResult {
  engine: string;
  codes: QRCode[];
  elapsedMs: number;
  timedOut: boolean;
  reason: string | null;
  /** Diagnostic fields are experimental; their nested schema can change. */
  diagnostics: Record<string, unknown>[];
  failureLog?: Record<string, unknown>;
  collection?: Record<string, unknown>;
  searchPhases?: Record<string, unknown>[];
  image?: { width: number; height: number };
}
export declare const VERSION: string;
export declare function scan(image: PixelImage, options?: ScanOptions): ScanResult;
/** Throws when the matrix fails format, error correction, or payload parsing. */
export declare function decodeMatrix(matrix: Uint8Array, size: number): MatrixResult;
