import assert from 'node:assert/strict';
import { scanImage } from '../src/core/scanner.mjs';
import { errorStage, makeFailureLog } from '../src/core/diagnostics.mjs';
const blank = {
  width: 100,
  height: 100,
  data: new Uint8Array(10000).fill(255),
};
assert.equal(
  scanImage(blank).failureLog,
  undefined,
  'Trace must be off for the shipped UI',
);
const result = scanImage(blank, { trace: true });
assert.equal(result.failureLog.furthestStage, 'detection');
assert.equal(result.failureLog.outcome, 'not-decoded');
for (const mode of ['global', 'adaptive', 'contrast', 'global-inverted'])
  assert.ok(result.failureLog.attempts.some((a) => a.preprocessing === mode));
assert.ok(
  result.failureLog.attempts.every((a) => a.preprocessing && a.candidateGrids === 0),
);
assert.equal(errorStage('QR checksum failed'), 'error-correction');
assert.equal(errorStage('QR version mismatch'), 'format');
assert.equal(errorStage('Unsupported QR character encoding'), 'payload');
const attempts = [
  { furthestStage: 'error-correction' },
  { furthestStage: 'format' },
  { furthestStage: 'detection' },
];
assert.equal(
  makeFailureLog(attempts).furthestStage,
  'error-correction',
  'Later shallow failures must not erase deeper observations',
);
assert.equal(makeFailureLog(attempts, { decoded: true }).outcome, 'decoded');
assert.equal(makeFailureLog(attempts, { timedOut: true }).outcome, 'timeout');
console.log(
  'QR development diagnostics: opt-in, labeled attempts, stage classification, deepest-stage preservation, success and timeout passed.',
);
