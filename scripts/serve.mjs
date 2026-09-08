import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../site/', import.meta.url));
const port = Number(process.env.PORT ?? 4187);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    const name = decodeURIComponent(url.pathname);
    const file = path.resolve(root, '.' + name);
    if (file !== root.slice(0, -1) && !file.startsWith(root)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const target = (await stat(file)).isDirectory()
      ? path.join(file, 'index.html')
      : file;
    const body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': types[path.extname(target)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`QR Sal demo: http://127.0.0.1:${port}/`),
);
