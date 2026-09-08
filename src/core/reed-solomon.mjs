// QR's GF(256), primitive polynomial x^8+x^4+x^3+x^2+1 (0x11d).
const exp = new Uint8Array(512),
  log = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  exp[i] = x;
  log[x] = i;
  x <<= 1;
  if (x & 256) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
const mul = (a, b) => (a && b ? exp[log[a] + log[b]] : 0);
const div = (a, b) => {
  if (!b) throw Error('Zero field divisor');
  return a ? exp[(log[a] - log[b] + 255) % 255] : 0;
};
const evaluate = (p, x) => {
  let r = 0;
  for (let i = p.length - 1; i >= 0; i--) r = mul(r, x) ^ p[i];
  return r;
};
function syndromes(bytes, count) {
  return Array.from({ length: count }, (_, i) => {
    let v = 0;
    for (const b of bytes) v = mul(v, exp[i]) ^ b;
    return v;
  });
}
export function correctBlock(input, ecc, audit = null, erasures = []) {
  if (
    !Number.isInteger(ecc) ||
    ecc < 1 ||
    ecc >= input.length ||
    input.length > 255
  )
    throw Error('Invalid RS block');
  if (
    !Array.isArray(erasures) ||
    erasures.length > ecc ||
    new Set(erasures).size !== erasures.length ||
    erasures.some((p) => !Number.isInteger(p) || p < 0 || p >= input.length)
  )
    throw Error('Invalid RS erasures');
  const bytes = Uint8Array.from(input),
    s = syndromes(bytes, ecc);
  if (audit)
    Object.assign(audit, {
      blockLength: bytes.length,
      eccCodewords: ecc,
      maxCorrectableCodewords: Math.floor(ecc / 2),
      nonzeroSyndromes: s.filter(Boolean).length,
    });
  if (s.every((x) => x === 0)) return { bytes, corrected: 0 };
  let modified = s.slice();
  let erasureLocator = [1];
  for (const position of erasures) {
    const x = exp[bytes.length - 1 - position];
    modified = modified.slice(1).map((value, i) => value ^ mul(x, modified[i]));
    const next = Array.from({ length: erasureLocator.length + 1 }, () => 0);
    for (let i = 0; i < erasureLocator.length; i++) {
      next[i] ^= erasureLocator[i];
      next[i + 1] ^= mul(x, erasureLocator[i]);
    }
    erasureLocator = next;
  }
  // Berlekamp–Massey: ascending error-locator coefficients.
  let locator = [1];
  let previous = [1],
    length = 0,
    shift = 1,
    last = 1;
  for (let n = 0; n < modified.length; n++) {
    let discrepancy = modified[n];
    for (let i = 1; i <= length; i++)
      discrepancy ^= mul(locator[i] ?? 0, modified[n - i]);
    if (!discrepancy) {
      shift++;
      continue;
    }
    const saved = locator.slice(),
      factor = div(discrepancy, last);
    while (locator.length < previous.length + shift) locator.push(0);
    for (let i = 0; i < previous.length; i++)
      locator[i + shift] ^= mul(factor, previous[i]);
    if (2 * length <= n) {
      length = n + 1 - length;
      previous = saved;
      last = discrepancy;
      shift = 1;
    } else shift++;
  }
  if (audit) audit.locatorDegree = length;
  if ((!length && !erasures.length) || 2 * length + erasures.length > ecc)
    throw Error('Error correction capacity exceeded');
  const combined = Array.from(
    { length: locator.length + erasureLocator.length - 1 },
    () => 0,
  );
  for (let i = 0; i < locator.length; i++)
    for (let j = 0; j < erasureLocator.length; j++)
      combined[i + j] ^= mul(locator[i], erasureLocator[j]);
  locator = combined;
  const unknownErrors = length;
  length += erasures.length;
  if (audit)
    Object.assign(audit, {
      erasures: erasures.slice(),
      unknownErrors,
      combinedLocatorDegree: length,
      capacityUsed: unknownErrors * 2 + erasures.length,
    });
  const omega = new Uint8Array(ecc);
  for (let i = 0; i < s.length; i++)
    for (let j = 0; j < locator.length && i + j < ecc; j++)
      omega[i + j] ^= mul(s[i], locator[j]);
  const derivative = locator.slice(1).map((v, i) => (i % 2 === 0 ? v : 0));
  let corrected = 0,
    located = 0;
  for (let position = 0; position < bytes.length; position++) {
    const power = bytes.length - 1 - position,
      inverse = exp[(255 - power) % 255];
    if (evaluate(locator, inverse) !== 0) continue;
    const magnitude = mul(
      exp[power],
      div(evaluate(omega, inverse), evaluate(derivative, inverse)),
    );
    bytes[position] ^= magnitude;
    located++;
    if (magnitude) corrected++;
  }
  const remainingSyndromes = syndromes(bytes, ecc).filter(Boolean).length;
  if (audit)
    Object.assign(audit, {
      locatedPositions: located,
      remainingNonzeroSyndromes: remainingSyndromes,
    });
  if (located !== length || remainingSyndromes)
    throw Error('QR checksum failed');
  return { bytes, corrected };
}
