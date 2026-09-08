import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const tests = readdirSync(new URL('../test/', import.meta.url))
  .filter((name) => name.endsWith('-test.mjs') || name.endsWith('.test.mjs'))
  .sort();
let failed = 0;
for (const name of tests) {
  console.log(`\n${name}`);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(`../test/${name}`, import.meta.url))],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) failed++;
}
console.log(`\n${tests.length - failed}/${tests.length} suites passed`);
process.exitCode = failed ? 1 : 0;
