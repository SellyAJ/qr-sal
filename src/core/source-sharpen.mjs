// Bounded Gaussian unsharp filtering of measured pixels, before localization.
export function sharpenSource(gray, w, h, sigma, amount, deadline = Infinity) {
  if (
    !Number.isFinite(sigma) ||
    sigma <= 0 ||
    sigma > 8 ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 3
  )
    throw Error('Invalid source filter');
  const radius = Math.ceil(sigma * 2.5),
    kernel = Array.from({ length: radius * 2 + 1 }, (_, i) =>
      Math.exp(-(((i - radius) / sigma) ** 2) / 2),
    ),
    sum = kernel.reduce((a, b) => a + b, 0);
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const horizontal = new Float32Array(gray.length),
    result = new Uint8Array(gray.length);
  for (let y = 0; y < h; y++) {
    if ((y & 31) === 0 && performance.now() > deadline) return null;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let value = 0;
      if (x >= radius && x < w - radius) {
        for (let k = -radius; k <= radius; k++)
          value += gray[row + x + k] * kernel[k + radius];
      } else {
        for (let k = -radius; k <= radius; k++)
          value +=
            gray[row + Math.max(0, Math.min(w - 1, x + k))] *
            kernel[k + radius];
      }
      horizontal[row + x] = value;
    }
  }
  for (let y = 0; y < h; y++) {
    if ((y & 31) === 0 && performance.now() > deadline) return null;
    const row = y * w,
      sourceRows = Int32Array.from(
        kernel,
        (_, i) => Math.max(0, Math.min(h - 1, y + i - radius)) * w,
      );
    for (let x = 0; x < w; x++) {
      let value = 0;
      for (let k = 0; k < kernel.length; k++)
        value += horizontal[sourceRows[k] + x] * kernel[k];
      result[row + x] = Math.round(
        Math.max(
          0,
          Math.min(255, gray[row + x] + amount * (gray[row + x] - value)),
        ),
      );
    }
  }
  return result;
}
