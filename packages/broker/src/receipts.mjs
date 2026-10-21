/**
 * Signed, hash-chained receipts.
 *
 * Each receipt carries the sha256 of its payload and of its predecessor, and an Ed25519 signature
 * over its own hash. Anyone holding the public key can verify a ledger offline: a changed byte
 * breaks the hash chain at that receipt, and a rewritten chain fails signature checks unless the
 * rewriter also holds the private key.
 *
 * Canonical JSON (sorted keys, no whitespace) makes the hashes reproducible across processes.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const GENESIS = '0'.repeat(64);

export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number in receipt');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const hashOf = (value) => sha256(canonical(value));

/** A fresh Ed25519 key pair as PEM strings. */
export function generateKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

/** Stable id for a public key: first 16 hex of sha256 over its DER encoding. */
export function keyId(publicKey) {
  const der = createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export function publicKeyFrom(privateKey) {
  return createPublicKey(createPrivateKey(privateKey)).export({ type: 'spki', format: 'pem' });
}

/** Append-only JSONL ledger. One file per ledger directory: `<dir>/receipts.jsonl`. */
export class Ledger {
  constructor(dir, { privateKey, publicKey } = {}) {
    if (!dir) throw new TypeError('ledger directory required');
    this.dir = dir;
    this.file = path.join(dir, 'receipts.jsonl');
    this.privateKey = privateKey ? createPrivateKey(privateKey) : null;
    this.publicKey = publicKey ?? (privateKey ? publicKeyFrom(privateKey) : null);
    this.keyId = this.publicKey ? keyId(this.publicKey) : null;
  }

  read() {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  append(kind, payload) {
    if (!this.privateKey) throw new Error('this ledger was opened without a signing key');
    const chain = this.read();
    const last = chain.at(-1);
    const body = {
      seq: chain.length,
      kind,
      payload,
      payload_sha256: hashOf(payload),
      prev_sha256: last ? last.receipt_sha256 : GENESIS,
      key_id: this.keyId,
    };
    const receiptSha = hashOf(body);
    const receipt = { ...body, receipt_sha256: receiptSha, sig: sign(null, Buffer.from(receiptSha, 'hex'), this.privateKey).toString('base64') };
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(receipt)}\n`);
    return receipt;
  }
}

/**
 * Verify a chain of receipts against a public key.
 * Returns { ok: true, receipts } or { ok: false, brokenAt, reason }. `brokenAt` is the first bad
 * receipt; every receipt after it is unverifiable, because its predecessor can no longer be trusted.
 */
export function verifyChain(receipts, publicKey) {
  if (!publicKey) throw new TypeError('a public key is required to verify receipts');
  const key = createPublicKey(publicKey);
  const expectedKeyId = keyId(publicKey);
  let prev = GENESIS;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    const fail = (reason) => ({ ok: false, brokenAt: i, reason });
    if (r.seq !== i) return fail(`sequence ${r.seq} where ${i} was expected`);
    if (r.prev_sha256 !== prev) return fail('previous-receipt hash does not match');
    if (r.payload_sha256 !== hashOf(r.payload)) return fail('payload hash does not match the payload');
    const { receipt_sha256: claimed, sig, ...body } = r;
    if (hashOf(body) !== claimed) return fail('receipt hash does not match the receipt');
    if (r.key_id !== expectedKeyId) return fail(`signed by key ${r.key_id}, expected ${expectedKeyId}`);
    let signed = false;
    try { signed = verify(null, Buffer.from(claimed, 'hex'), key, Buffer.from(sig ?? '', 'base64')); } catch { signed = false; }
    if (!signed) return fail('signature does not verify');
    prev = claimed;
  }
  return { ok: true, receipts };
}
