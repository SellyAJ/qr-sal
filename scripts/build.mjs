import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
await mkdir('dist', { recursive: true });
const common = {
  bundle: true,
  target: 'es2022',
  legalComments: 'eof',
  minify: true,
  banner: {
    js: '/*! QR Sal v0.1.0 | MIT | Copyright 2026 Sal (SellyAJ) | See THIRD-PARTY-NOTICES.txt */',
  },
};
await Promise.all([
  build({
    ...common,
    entryPoints: ['src/index.mjs'],
    format: 'esm',
    outfile: 'dist/index.mjs',
  }),
  build({
    ...common,
    entryPoints: ['src/index.mjs'],
    format: 'cjs',
    outfile: 'dist/index.cjs',
  }),
  build({
    ...common,
    entryPoints: ['src/index.mjs'],
    format: 'iife',
    globalName: 'QRSal',
    outfile: 'dist/qr-sal.js',
  }),
  build({
    ...common,
    entryPoints: ['src/browser.mjs'],
    format: 'esm',
    outfile: 'dist/browser.mjs',
  }),
  build({
    ...common,
    entryPoints: ['src/worker.mjs'],
    format: 'esm',
    outfile: 'dist/worker.mjs',
  }),
]);
await Promise.all([
  cp('src/index.d.ts', 'dist/index.d.ts'),
  cp('src/index.d.ts', 'dist/index.d.cts'),
  cp('src/index.d.ts', 'dist/index.d.mts'),
  cp('src/browser.d.ts', 'dist/browser.d.mts'),
  // .js resolves to the sibling .d.ts for TypeScript consumers.
  readFile('src/browser.d.ts', 'utf8').then((text) =>
    writeFile('dist/browser.d.ts', text.replace('./index.mjs', './index.js')),
  ),
]);
await mkdir('site', { recursive: true });
await cp('demo', 'site', { recursive: true });
await cp('dist', 'site/lib', { recursive: true });
await cp('LICENSE', 'site/LICENSE.txt');
await cp('THIRD-PARTY-NOTICES.txt', 'site/THIRD-PARTY-NOTICES.txt');
const pdf = path.join(root, 'node_modules/pdfjs-dist');
await mkdir('site/vendor', { recursive: true });
await Promise.all(
  ['pdf.mjs', 'pdf.worker.mjs'].map((name) =>
    cp(path.join(pdf, 'build', name), path.join('site/vendor', name)),
  ),
);
await Promise.all(
  ['cmaps', 'standard_fonts', 'wasm'].map((name) =>
    cp(path.join(pdf, name), path.join('site/vendor', name), { recursive: true }),
  ),
);
await cp(path.join(pdf, 'LICENSE'), 'site/vendor/PDFJS-LICENSE.txt');
await writeFile('site/.nojekyll', '');
console.log('Built ESM, CommonJS, browser, worker, types, and static demo.');
