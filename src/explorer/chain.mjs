/**
 * Browser-portable chain verifier for the Receipt Explorer.
 *
 * The explorer is a single offline HTML file, so it cannot import node:crypto.
 * This module is plain JavaScript with no imports — a pure SHA-256 and the same
 * canonical JSON as src/ledger/index.mjs — and render-explorer.mjs inlines its
 * source into the page. tests/explorer.test.mjs proves it reaches the same
 * verdict as the ledger's own verifyChain on real and tampered chains, so the
 * page cannot show "verified" for a chain the broker would refuse.
 *
 * No `import` and no Node globals: keep it that way, or the inlined copy breaks.
 */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, '0')).join('');
}

/** Canonical JSON, byte-for-byte the same as src/ledger/index.mjs canonicalize(). */
export function canonicalize(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error('cannot canonicalize non-finite number');
    return JSON.stringify(value);
  }
  if (type !== 'object') throw new Error(`cannot canonicalize ${type}`);
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalize(item))).join(',')}]`;
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

const GENESIS = '0'.repeat(64);
const REQUIRED = ['seq', 'ts_logical', 'kind', 'actor', 'subject', 'payload', 'payload_sha256', 'prev_sha256', 'sha256'];

/**
 * Verify raw JSONL lines the way the ledger does, and report per-link status so
 * the page can colour each receipt. Returns
 *   { ok, length, brokenAt, reason, links: [{ index, status, receipt, recomputed }] }
 * where status is 'verified' before a break, 'broken' at it, 'unverified' after.
 */
export function verifyLines(lines, { subject, kinds }) {
  const links = [];
  let prev = GENESIS;
  let previousLogical = 0;
  let brokenAt = null;
  let reason = null;

  for (let index = 0; index < lines.length; index++) {
    if (brokenAt !== null) {
      let receipt = null;
      try { receipt = JSON.parse(lines[index]); } catch { /* shown as unverified */ }
      links.push({ index, status: 'unverified', receipt, recomputed: null });
      continue;
    }
    const fail = (message, receipt = null, recomputed = null) => {
      brokenAt = index;
      reason = `${message} at index ${index}`;
      links.push({ index, status: 'broken', receipt, recomputed });
    };
    if (lines[index].trim() === '') { fail('empty JSONL line'); continue; }
    let receipt;
    try { receipt = JSON.parse(lines[index]); } catch { fail('malformed JSON'); continue; }
    if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) { fail('receipt is not an object'); continue; }
    const missing = REQUIRED.find((field) => !Object.prototype.hasOwnProperty.call(receipt, field));
    if (missing) { fail(`missing field ${missing}`, receipt); continue; }
    if (!kinds.includes(receipt.kind)) { fail(`unknown kind "${receipt.kind}"`, receipt); continue; }
    if (receipt.subject !== subject) { fail(`subject mismatch (expected "${subject}")`, receipt); continue; }
    if (receipt.seq !== index + 1) { fail(`seq ${receipt.seq} is not ${index + 1}`, receipt); continue; }
    if (!Number.isInteger(receipt.ts_logical) || receipt.ts_logical <= previousLogical) { fail('ts_logical is not monotonic', receipt); continue; }
    const payloadHash = sha256Hex(canonicalize(receipt.payload));
    if (receipt.payload_sha256 !== payloadHash) { fail('payload_sha256 mismatch', receipt, { payload_sha256: payloadHash }); continue; }
    if (receipt.prev_sha256 !== prev) { fail('prev_sha256 does not match previous receipt', receipt, { prev_sha256: prev }); continue; }
    const { sha256: stored, ...unsigned } = receipt;
    const recomputed = sha256Hex(canonicalize(unsigned));
    if (typeof stored !== 'string' || stored !== recomputed) { fail('sha256 mismatch', receipt, { sha256: recomputed }); continue; }
    links.push({ index, status: 'verified', receipt, recomputed: { payload_sha256: payloadHash, sha256: recomputed } });
    prev = stored;
    previousLogical = receipt.ts_logical;
  }
  return brokenAt === null
    ? { ok: true, length: lines.length, brokenAt: null, reason: null, links }
    : { ok: false, length: lines.length, brokenAt, reason, links };
}

// Index just past the JSON value that starts at `from` (an object or array), honouring strings and escapes.
function valueEnd(line, from) {
  let depth = 0;
  let inString = false;
  for (let i = from; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Flip exactly one byte inside a receipt's payload: the first letter or digit of
 * the first string value inside the payload object (array elements included),
 * advanced by one within its class (a→b, 9→0). Keys and escape sequences are never
 * touched, so the line still parses and the break is caught by the hash check
 * rather than the JSON parser. The scan stops at the payload's closing brace; a
 * payload with no string value is refused rather than tampering a hash field next
 * to it. Returns the new line and where the change landed, so the page can show
 * the exact byte.
 */
export function tamperOneByte(line) {
  const key = line.indexOf('"payload":');
  if (key === -1) throw new Error('receipt has no payload to tamper with');
  const open = key + '"payload":'.length;
  const end = line[open] === '{' ? valueEnd(line, open) : -1;
  if (end === -1) throw new Error('receipt payload is not an object');
  for (let i = open; i < end; i++) {
    if (line[i] !== '"') continue;
    // Walk to the closing quote, remembering the first flippable character that is not part of an escape.
    let candidate = -1;
    let close = i + 1;
    for (; close < end && line[close] !== '"'; close++) {
      if (line[close] === '\\') { close++; continue; }
      if (candidate === -1 && /[0-9A-Za-z]/.test(line[close])) candidate = close;
    }
    let after = close + 1;
    while (line[after] === ' ') after++;
    const isKey = line[after] === ':';
    i = close;
    if (isKey || candidate === -1) continue;
    const ch = line[candidate];
    const next = ch === '9' ? '0' : ch === 'z' ? 'a' : ch === 'Z' ? 'A' : String.fromCharCode(ch.charCodeAt(0) + 1);
    return { line: line.slice(0, candidate) + next + line.slice(candidate + 1), offset: candidate, before: ch, after: next };
  }
  throw new Error('no tamperable byte found in payload');
}
