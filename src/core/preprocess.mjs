// Deterministic transforms of source pixels. No generated image content.
export function bilinear(gray, width, height, x, y) {
  const fx = Math.max(0, Math.min(width - 1, x - 0.5));
  const fy = Math.max(0, Math.min(height - 1, y - 0.5));
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1),
    y1 = Math.min(height - 1, y0 + 1);
  const dx = fx - x0,
    dy = fy - y0;
  return (
    gray[y0 * width + x0] * (1 - dx) * (1 - dy) +
    gray[y0 * width + x1] * dx * (1 - dy) +
    gray[y1 * width + x0] * (1 - dx) * dy +
    gray[y1 * width + x1] * dx * dy
  );
}

export function resizeGray(gray, width, height, factor) {
  if (![0.5, 2, 4].includes(factor)) throw Error('Unsupported QR image scale');
  const w = Math.ceil(width / factor),
    h = Math.ceil(height / factor);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (factor < 1) {
        data[y * w + x] = Math.round(
          bilinear(gray, width, height, (x + 0.5) * factor, (y + 0.5) * factor),
        );
        continue;
      }
      let sum = 0,
        count = 0;
      for (let dy = 0; dy < factor && y * factor + dy < height; dy++)
        for (let dx = 0; dx < factor && x * factor + dx < width; dx++) {
          sum += gray[(y * factor + dy) * width + x * factor + dx];
          count++;
        }
      data[y * w + x] = Math.round(sum / count);
    }
  return { width: w, height: h, data };
}

export function filterGray(gray, w, h, axis) {
  if (!['horizontal', 'vertical', 'both', 'smooth'].includes(axis))
    throw Error('Unsupported QR pixel filter');
  const filtered = new Uint8Array(gray.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        a = gray[y * w + Math.max(0, x - 1)],
        b = gray[Math.max(0, y - 1) * w + x];
      filtered[i] =
        axis === 'horizontal'
          ? Math.min(gray[i], a)
          : axis === 'vertical'
            ? Math.min(gray[i], b)
            : axis === 'both'
              ? Math.min(gray[i], a, b)
              : Math.round(
                  (gray[i] * 4 +
                    a +
                    b +
                    gray[y * w + Math.min(w - 1, x + 1)] +
                    gray[Math.min(h - 1, y + 1) * w + x]) /
                    8,
                );
    }
  return filtered;
}
