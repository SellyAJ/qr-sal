// These describe observed processing stages, not a diagnosis of print damage.
export const STAGES = [
  'detection',
  'alignment',
  'format',
  'error-correction',
  'payload',
  'decoded',
];
export function errorStage(message) {
  if (/RS block|field divisor|correction capacity|checksum/.test(message))
    return 'error-correction';
  if (
    /segment|payload|encoding|ECI|Structured-append|Truncated QR data|encoded data/.test(
      message,
    )
  )
    return 'payload';
  if (/QR format|QR version|Model 2|QR data size|Block layout/.test(message))
    return 'format';
  return 'runtime';
}
export function makeFailureLog(
  attempts,
  { decoded = false, decodedCount = null, timedOut = false } = {},
) {
  let furthestStage = 'detection';
  for (const a of attempts)
    if (STAGES.indexOf(a.furthestStage) > STAGES.indexOf(furthestStage))
      furthestStage = a.furthestStage;
  const outcome = decoded ? 'decoded' : timedOut ? 'timeout' : 'not-decoded';
  const messages = {
    detection: 'Not enough QR-like corner patterns formed a usable candidate.',
    alignment:
      'Corner candidates were found, but no sampled grid passed the shape checks.',
    format:
      'A candidate grid was sampled, but its QR settings could not be read reliably.',
    'error-correction':
      'A candidate reached data repair, but its data did not pass the recovery checks.',
    payload:
      'A candidate reached text decoding, but its stored text could not be parsed.',
  };
  return {
    schemaVersion: 1,
    outcome,
    furthestStage: decoded ? 'decoded' : furthestStage,
    summary: decoded
      ? `Decoded ${decodedCount ?? 'one or more'} QR region(s).${timedOut ? ' The remaining search hit its time limit.' : ''} This does not establish complete-page coverage.`
      : timedOut
        ? 'The scan ran out of time before decoding a QR.'
        : messages[furthestStage],
    limitation:
      'This records scanner behavior. It does not prove the QR is missing or the receipt is damaged; candidate patterns may be false matches.',
    attempts,
  };
}
