// Benchmark protocol: one grayscale pixel buffer per line; no expected answers.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { scan } from '../dist/index.mjs';
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const { file, width, height, timeLimitMs } = JSON.parse(line);
    const result = scan(
      { width, height, data: new Uint8Array(readFileSync(file)) },
      { timeLimitMs, multiple: true },
    );
    process.stdout.write(
      JSON.stringify({
        codes: result.codes.map(({ text, corners }) => ({ text, corners })),
        elapsedMs: result.elapsedMs,
        timedOut: result.timedOut,
      }) + '\n',
    );
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.message, codes: [] }) + '\n');
  }
}
