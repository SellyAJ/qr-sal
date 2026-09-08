import { correctBlock } from './reed-solomon.mjs';
import { ECC, BLOCKS, alignmentCenters, rawCodewords } from './tables.mjs';
const pop = (x) => {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
};
function bch(data, polynomial, degree) {
  let value = data << degree;
  for (let i = 31 - Math.clz32(value); i >= degree; i--)
    if (value & (1 << i)) value ^= polynomial << (i - degree);
  return (data << degree) | value;
}
function format(matrix, n, audit = null) {
  const get = (x, y) => matrix[y * n + x];
  let a = 0,
    b = 0;
  const addA = (x, y) => (a = (a << 1) | get(x, y)),
    addB = (x, y) => (b = (b << 1) | get(x, y));
  for (let x = 0; x < 6; x++) addA(x, 8);
  addA(7, 8);
  addA(8, 8);
  addA(8, 7);
  for (let y = 5; y >= 0; y--) addA(8, y);
  for (let y = n - 1; y >= n - 7; y--) addB(8, y);
  for (let x = n - 8; x < n; x++) addB(x, 8);
  const matches = [];
  for (let data = 0; data < 32; data++) {
    const code = bch(data, 0x537, 10) ^ 0x5412;
    const distance = Math.min(pop(code ^ a), pop(code ^ b));
    if (distance <= 3) matches.push({ data, distance });
  }
  matches.sort((x, y) => x.distance - y.distance);
  if (audit) audit.format = { copyA: a, copyB: b, candidates: matches };
  if (
    !matches.length ||
    (matches[1] && matches[1].distance === matches[0].distance)
  )
    throw Error('Unreadable QR format');
  const { data, distance } = matches[0];
  return {
    level: { 1: 0, 0: 1, 3: 2, 2: 3 }[data >> 3],
    mask: data & 7,
    formatCorrections: distance,
  };
}
function versionCheck(matrix, n, v, audit = null) {
  if (v < 7) return;
  let a = 0,
    b = 0;
  for (let y = 5; y >= 0; y--)
    for (let x = n - 9; x >= n - 11; x--) {
      a = (a << 1) | matrix[y * n + x];
      b = (b << 1) | matrix[x * n + y];
    }
  const expected = bch(v, 0x1f25, 12);
  if (audit)
    audit.versionCheck = {
      expectedVersion: v,
      copyADistance: pop(expected ^ a),
      copyBDistance: pop(expected ^ b),
    };
  if (Math.min(pop(expected ^ a), pop(expected ^ b)) > 3)
    throw Error('QR version mismatch');
}
function reserved(n, v) {
  const map = new Uint8Array(n * n);
  const mark = (x, y, w, h) => {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) map[j * n + i] = 1;
  };
  mark(0, 0, 9, 9);
  mark(n - 8, 0, 8, 9);
  mark(0, n - 8, 9, 8);
  mark(6, 9, 1, n - 17);
  mark(9, 6, n - 17, 1);
  const centers = alignmentCenters(v);
  for (let j = 0; j < centers.length; j++)
    for (let i = 0; i < centers.length; i++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === centers.length - 1) ||
        (i === centers.length - 1 && j === 0)
      )
        continue;
      mark(centers[i] - 2, centers[j] - 2, 5, 5);
    }
  if (v >= 7) {
    mark(n - 11, 0, 3, 6);
    mark(0, n - 11, 6, 3);
  }
  return map;
}
const masked = (mask, x, y) =>
  [
    (x + y) % 2 === 0,
    y % 2 === 0,
    x % 3 === 0,
    (x + y) % 3 === 0,
    (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    ((x * y) % 2) + ((x * y) % 3) === 0,
    (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask];
function extract(matrix, n, v, mask, confidence = null) {
  const blocked = reserved(n, v),
    bytes = [];
  const reliability = [];
  let minimum = 1;
  let value = 0,
    bits = 0,
    up = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let i = 0; i < n; i++) {
      const y = up ? n - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (blocked[y * n + x]) continue;
        if (confidence) minimum = Math.min(minimum, confidence[y * n + x]);
        value =
          (value << 1) | (matrix[y * n + x] ^ (masked(mask, x, y) ? 1 : 0));
        if (++bits === 8) {
          bytes.push(value);
          if (confidence) reliability.push(minimum);
          minimum = 1;
          value = 0;
          bits = 0;
        }
      }
    }
    up = !up;
  }
  const count = rawCodewords(v);
  if (bytes.length !== count) throw Error('Invalid QR data size');
  if (confidence) bytes.reliability = reliability;
  return bytes;
}
function repair(bytes, v, level, audit = null) {
  const count = BLOCKS[level][v],
    ecc = ECC[level][v],
    shortLength = Math.floor(bytes.length / count),
    shortCount = count - (bytes.length % count);
  const blocks = Array.from({ length: count }, (_, i) => ({
    dataLength: shortLength - ecc + (i >= shortCount ? 1 : 0),
    bytes: new Uint8Array(shortLength + (i >= shortCount ? 1 : 0)),
    reliability: bytes.reliability
      ? new Float32Array(shortLength + (i >= shortCount ? 1 : 0))
      : null,
  }));
  let cursor = 0;
  for (let i = 0; i <= shortLength - ecc; i++)
    for (const block of blocks)
      if (i < block.dataLength) {
        if (block.reliability) block.reliability[i] = bytes.reliability[cursor];
        block.bytes[i] = bytes[cursor++];
      }
  for (let i = 0; i < ecc; i++)
    for (const block of blocks) {
      if (block.reliability)
        block.reliability[block.dataLength + i] = bytes.reliability[cursor];
      block.bytes[block.dataLength + i] = bytes[cursor++];
    }
  if (cursor !== bytes.length) throw Error('Block layout mismatch');
  const result = [];
  if (audit) audit.repair = { blockCount: count, eccPerBlock: ecc, blocks: [] };
  let corrected = 0,
    erasureRecovered = false;
  for (const block of blocks) {
    const blockAudit = audit
      ? { index: audit.repair.blocks.length, dataLength: block.dataLength }
      : null;
    if (audit) audit.repair.blocks.push(blockAudit);
    let repaired;
    try {
      repaired = correctBlock(block.bytes, ecc, blockAudit);
    } catch (originalError) {
      if (blockAudit) blockAudit.originalFailure = originalError.message;
      if (!block.reliability) throw originalError;
      const ranked = Array.from(block.reliability, (value, position) => ({
        value,
        position,
      }))
        .filter((r) => r.value < 0.22)
        .sort((a, b) => a.value - b.value || a.position - b.position);
      const candidates = [],
        attempts = [];
      // Failed recovery is the useful diagnostic case. Retain this evidence
      // before throwing, without changing which corrections are accepted.
      if (blockAudit)
        Object.assign(blockAudit, {
          erasureEligibleCodewords: ranked.length,
          reliabilityMeasure:
            'Minimum sampled luminance distance within each codeword; not a probability',
          rankedErasureCandidates: ranked.slice(0, Math.max(0, ecc - 4)),
          erasureTrials: attempts,
        });
      for (
        let count = 2;
        count <= Math.min(ecc - 4, ranked.length);
        count += 2
      ) {
        const positions = ranked.slice(0, count).map((r) => r.position),
          trialAudit = {};
        try {
          const result = correctBlock(block.bytes, ecc, trialAudit, positions);
          // Keep two parity equations beyond the errors/erasures actually used.
          if (trialAudit.capacityUsed > ecc - 2) {
            attempts.push({
              count,
              accepted: false,
              error: 'Insufficient spare parity',
              ...trialAudit,
            });
            continue;
          }
          candidates.push({ result, audit: trialAudit });
          attempts.push({
            count,
            accepted: true,
            capacityUsed: trialAudit.capacityUsed,
            ...(blockAudit ? trialAudit : {}),
          });
        } catch (e) {
          attempts.push({
            count,
            accepted: false,
            error: e.message,
            ...(blockAudit ? trialAudit : {}),
          });
        }
      }
      if (!candidates.length) throw originalError;
      if (
        candidates.some((c) =>
          c.result.bytes.some((v, i) => v !== candidates[0].result.bytes[i]),
        )
      )
        throw Error('Ambiguous QR erasure recovery');
      repaired = candidates[0].result;
      erasureRecovered = true;
      if (blockAudit)
        Object.assign(blockAudit, candidates[0].audit, {
          erasureRecovery: true,
          erasureTrials: attempts,
        });
    }
    if (blockAudit) blockAudit.correctedCodewords = repaired.corrected;
    corrected += repaired.corrected;
    result.push(...repaired.bytes.slice(0, block.dataLength));
  }
  return { bytes: Uint8Array.from(result), corrected, erasureRecovered };
}
function segments(bytes, version, strictPadding = false) {
  let cursor = 0,
    encoding = null,
    fnc = false;
  const strings = [],
    payload = [];
  const read = (n) => {
    if (cursor + n > bytes.length * 8) throw Error('Truncated QR data');
    let result = 0;
    for (let i = 0; i < n; i++, cursor++)
      result = (result << 1) | ((bytes[cursor >> 3] >> (7 - (cursor & 7))) & 1);
    return result;
  };
  const group = version < 10 ? 0 : version < 27 ? 1 : 2,
    alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  while (bytes.length * 8 - cursor >= 4) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 7) {
      let eci = read(8);
      if ((eci & 128) === 0) {
      } else if ((eci & 192) === 128) eci = ((eci & 63) << 8) | read(8);
      else if ((eci & 224) === 192) eci = ((eci & 31) << 16) | read(16);
      else throw Error('Invalid ECI');
      encoding = { 3: 'iso-8859-1', 20: 'shift_jis', 26: 'utf-8', 27: 'ascii' }[
        eci
      ];
      if (!encoding) throw Error('Unsupported QR character encoding');
      continue;
    }
    if (mode === 5) {
      fnc = true;
      continue;
    }
    if (mode === 9) {
      fnc = true;
      read(8);
      continue;
    }
    if (mode === 3)
      throw Error('Structured-append QR needs its companion symbols');
    const countBits = {
      1: [10, 12, 14],
      2: [9, 11, 13],
      4: [8, 16, 16],
      8: [8, 10, 12],
    }[mode];
    if (!countBits) throw Error('Unsupported QR segment');
    let count = read(countBits[group]),
      text = '';
    if (mode === 1) {
      while (count) {
        const take = Math.min(count, 3),
          value = read(take === 3 ? 10 : take === 2 ? 7 : 4);
        if (value >= 10 ** take) throw Error('Invalid numeric segment');
        text += String(value).padStart(take, '0');
        count -= take;
      }
    }
    if (mode === 2) {
      while (count >= 2) {
        const value = read(11);
        if (value >= 2025) throw Error('Invalid alphanumeric segment');
        text += alphabet[Math.floor(value / 45)] + alphabet[value % 45];
        count -= 2;
      }
      if (count) {
        const value = read(6);
        if (value >= 45) throw Error('Invalid alphanumeric segment');
        text += alphabet[value];
      }
      if (fnc) text = text.replace(/%%|%/g, (s) => (s === '%%' ? '%' : '\x1d'));
    }
    if (mode === 4) {
      const data = Uint8Array.from({ length: count }, () => read(8));
      payload.push(...data);
      if (encoding === 'iso-8859-1')
        text = Array.from(data, (b) => String.fromCharCode(b)).join('');
      else {
        try {
          text = new TextDecoder(encoding ?? 'utf-8', { fatal: true }).decode(
            data,
          );
        } catch (e) {
          if (encoding) throw e;
          text = Array.from(data, (b) => String.fromCharCode(b)).join('');
        }
      }
    }
    if (mode === 8) {
      const data = [];
      for (let i = 0; i < count; i++) {
        const value = read(13);
        let sjis = (Math.floor(value / 192) << 8) | (value % 192);
        sjis += sjis < 0x1f00 ? 0x8140 : 0xc140;
        data.push(sjis >> 8, sjis & 255);
      }
      text = new TextDecoder('shift_jis', { fatal: true }).decode(
        Uint8Array.from(data),
      );
      payload.push(...data);
    }
    strings.push(text);
  }
  if (strictPadding) {
    while (cursor % 8 && cursor < bytes.length * 8)
      if (read(1) !== 0) throw Error('Nonzero QR terminator padding');
    let expected = 0xec;
    while (cursor < bytes.length * 8) {
      if (read(8) !== expected)
        throw Error('Invalid QR pad codeword after erasure recovery');
      expected ^= 0xfd;
    }
  }
  if (!strings.length) throw Error('Empty QR payload');
  return { text: strings.join(''), byteSegments: payload };
}
export function decodeMatrix(
  matrix,
  size,
  audit = null,
  { confidence = null } = {},
) {
  const version = (size - 17) / 4;
  if (
    !Number.isInteger(version) ||
    version < 1 ||
    version > 40 ||
    matrix.length !== size * size
  )
    throw Error('Not a Model 2 QR grid');
  if (
    confidence &&
    (confidence.length !== matrix.length ||
      confidence.some((v) => !Number.isFinite(v) || v < 0 || v > 1))
  )
    throw Error('Invalid grid confidence');
  if (audit) Object.assign(audit, { stage: 'format', version, size });
  const info = format(matrix, size, audit);
  if (audit)
    Object.assign(audit, {
      formatCorrections: info.formatCorrections,
      mask: info.mask,
      errorCorrection: ['L', 'M', 'Q', 'H'][info.level],
    });
  versionCheck(matrix, size, version, audit);
  const extracted = extract(matrix, size, version, info.mask, confidence);
  if (audit)
    Object.assign(audit, {
      stage: 'error-correction',
      extractedCodewords: extracted.length,
    });
  const repaired = repair(extracted, version, info.level, audit);
  if (audit) audit.stage = 'payload';
  const decoded = segments(repaired.bytes, version, repaired.erasureRecovered);
  if (audit) audit.stage = 'decoded';
  return {
    ...decoded,
    version,
    size,
    errorCorrection: ['L', 'M', 'Q', 'H'][info.level],
    mask: info.mask,
    correctedCodewords: repaired.corrected,
    formatCorrections: info.formatCorrections,
    checksumPassed: true,
  };
}
