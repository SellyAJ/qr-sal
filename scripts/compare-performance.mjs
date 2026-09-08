// Compare trusted local releases on identical pre-rendered grayscale inputs.
// Manifest: [{ width, height, bufferFile }]. Paths may be relative to the manifest.
// Usage: node scripts/compare-performance.mjs manifest.json old/index.mjs new/index.mjs output.json
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { sameRegion } from '../src/core/regions.mjs';

const [manifestFile, baselineModule, candidateModule, outputFile] = process.argv.slice(2);
if (!manifestFile || !baselineModule || !candidateModule || !outputFile)
  throw new Error(
    'Expected manifest, baseline module, candidate module and new output path',
  );
if (fs.existsSync(outputFile))
  throw new Error('Output exists; preserve the previous measurement');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (!Array.isArray(manifest) || !manifest.length)
  throw new Error('Expected a nonempty input array');
const baseline = await import(pathToFileURL(path.resolve(baselineModule)).href);
const candidate = await import(pathToFileURL(path.resolve(candidateModule)).href);
const options = { multiple: true, timeLimitMs: 35000 };
const images = [];
for (const [index, input] of manifest.entries()) {
  const data = new Uint8Array(
    fs.readFileSync(path.resolve(path.dirname(manifestFile), input.bufferFile)),
  );
  if (data.length !== input.width * input.height)
    throw new Error('Expected one grayscale byte per pixel');
  const image = { width: input.width, height: input.height, data };
  const pixelsSha256 = createHash('sha256').update(data).digest('hex');
  const run = (api) => {
    const start = performance.now();
    const result = api.scan(image, options);
    const elapsedMs = performance.now() - start;
    if (createHash('sha256').update(data).digest('hex') !== pixelsSha256)
      throw new Error('A decoder modified the comparison input');
    return { result, elapsedMs };
  };
  run(baseline);
  run(candidate);
  const trials = [];
  for (let repeat = 0; repeat < 3; repeat++) {
    const results = {};
    for (const name of repeat % 2
      ? ['candidate', 'baseline']
      : ['baseline', 'candidate']) {
      results[name] = run(name === 'baseline' ? baseline : candidate);
    }
    const a = results.candidate.result,
      b = results.baseline.result;
    const available = new Set(a.codes.map((_, i) => i));
    let missing = 0;
    for (const code of b.codes) {
      const match = a.codes.findIndex(
        (other, i) =>
          available.has(i) && other.text === code.text && sameRegion(other, code),
      );
      if (match < 0) missing++;
      else available.delete(match);
    }
    trials.push({
      repeat,
      baselineMs: results.baseline.elapsedMs,
      candidateMs: results.candidate.elapsedMs,
      baselineTimeout: b.timedOut,
      candidateTimeout: a.timedOut,
      baselineCount: b.codes.length,
      candidateCount: a.codes.length,
      missingLocationTextPairs: missing,
      additionalLocationTextPairs: available.size,
    });
  }
  images.push({
    input: index,
    width: image.width,
    height: image.height,
    pixelsSha256,
    trials,
  });
  console.log(`${index + 1}/${manifest.length} inputs compared`);
}
fs.writeFileSync(
  outputFile,
  JSON.stringify(
    {
      baselineVersion: baseline.VERSION,
      candidateVersion: candidate.VERSION,
      node: process.version,
      options,
      warmupsPerVersion: 1,
      repeats: 3,
      method:
        'Sequential alternating order. Exact text and one-to-one sameRegion matching. No raw payloads or local paths in the report. Keep timeout-censored timings separate.',
      images,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
