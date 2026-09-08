import { scan } from './index.mjs';
self.onmessage = ({ data }) => {
  const { id, image, options } = data;
  try {
    self.postMessage({ id, result: scan(image, options) });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Scan failed',
    });
  }
};
