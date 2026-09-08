/** One worker per scanner. A scanner runs one request at a time. */
export function createScanner({
  workerUrl = new URL('./worker.mjs', import.meta.url),
} = {}) {
  let worker;
  let pending;
  let sequence = 0;
  let disposed = false;
  const abort = () => new DOMException('Scan cancelled', 'AbortError');
  function finish(error, result) {
    if (!pending) return;
    const request = pending;
    pending = undefined;
    clearTimeout(request.timer);
    request.signal?.removeEventListener('abort', request.cancel);
    error ? request.reject(error) : request.resolve(result);
  }
  function stop(error = abort()) {
    worker?.terminate();
    worker = undefined;
    finish(error);
  }
  function getWorker() {
    if (worker) return worker;
    worker = new Worker(workerUrl, { type: 'module', name: 'qr-sal' });
    worker.onmessage = ({ data }) => {
      if (data.id !== pending?.id) return;
      finish(data.error ? new Error(data.error) : null, data.result);
    };
    worker.onerror = () =>
      stop(
        new Error(
          'Scanner worker could not run. Check the worker URL and browser policy.',
        ),
      );
    worker.onmessageerror = () =>
      stop(new Error('Scanner worker returned an unreadable response.'));
    return worker;
  }
  return {
    scan(image, options = {}, { signal } = {}) {
      if (disposed) return Promise.reject(new Error('Scanner has been disposed'));
      if (pending)
        return Promise.reject(
          new Error('Scanner is busy; await the previous scan or cancel it'),
        );
      if (signal?.aborted) return Promise.reject(abort());
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        try {
          const current = getWorker();
          const budget = Number.isFinite(options.timeLimitMs)
            ? Math.min(60000, Math.max(100, options.timeLimitMs))
            : 12000;
          const cancel = () => stop();
          pending = {
            id,
            resolve,
            reject,
            signal,
            cancel,
            timer: setTimeout(
              () =>
                stop(
                  new Error('Scanner exceeded its worker deadline. Try a smaller image.'),
                ),
              budget + 5000,
            ),
          };
          signal?.addEventListener('abort', cancel, { once: true });
          // Structured cloning preserves the caller's pixel buffer. No detachment.
          current.postMessage({
            id,
            image: { width: image.width, height: image.height, data: image.data },
            options,
          });
        } catch (error) {
          if (pending) finish(error);
          else reject(error);
        }
      });
    },
    cancel: () => stop(),
    dispose() {
      disposed = true;
      stop();
    },
  };
}

/** Raster images only; PDFs need a renderer. EXIF orientation follows createImageBitmap. */
export async function imageFromBlob(blob, { maxPixels = 8_000_000 } = {}) {
  if (!(blob instanceof Blob)) throw new TypeError('Expected an image Blob or File');
  if (blob.size > 50 * 1024 * 1024) throw new RangeError('Image must be at most 50 MB');
  if (!Number.isFinite(maxPixels) || maxPixels < 441 || maxPixels > 20_000_000)
    throw new RangeError('maxPixels must be between 441 and 20000000');
  if (!/^image\/(png|jpeg|webp|gif|bmp|x-ms-bmp)$/.test(blob.type))
    throw new TypeError('Choose a PNG, JPEG, WebP, GIF, or BMP image');
  const bitmap = await createImageBitmap(blob);
  try {
    const ratio = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.floor(bitmap.width * ratio));
    const height = Math.max(1, Math.floor(bitmap.height * ratio));
    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}
