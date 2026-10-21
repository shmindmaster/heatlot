/**
 * Append-only receipt ledger. JSONL under ledger/, one file per subject.
 *
 * Hashes are SHA-256 over canonical JSON (object keys sorted recursively).
 * Time is a per-file logical counter. Wall clocks never enter a receipt.
 * Valid kinds are read from policy/policy.json; they are not hard-coded here.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, 'policy', 'policy.json');
export const GENESIS_PREV_SHA256 = '0'.repeat(64);

function loadPolicy() {
  if (!existsSync(POLICY_PATH)) {
    throw new Error(`missing policy file: policy/policy.json`);
  }
  let policy;
  try {
    policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`malformed policy/policy.json: ${error.message}`);
  }
  const ledger = policy?.ledger;
  if (!ledger || typeof ledger !== 'object') {
    throw new Error('policy.ledger is missing');
  }
  if (typeof ledger.path !== 'string' || ledger.path.trim() === '') {
    throw new Error('policy.ledger.path must be a non-empty relative path');
  }
  if (path.isAbsolute(ledger.path) || ledger.path.split(/[\\/]/).includes('..')) {
    throw new Error('policy.ledger.path must be a relative path without ".."');
  }
  if (!Array.isArray(ledger.kinds) || ledger.kinds.length === 0) {
    throw new Error('policy.ledger.kinds is missing or empty');
  }
  if (ledger.kinds.some((kind) => typeof kind !== 'string' || kind === '')) {
    throw new Error('policy.ledger.kinds must be an array of non-empty strings');
  }
  return policy;
}

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
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function isHexSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validateSubject(subject) {
  if (typeof subject !== 'string' || subject === '') {
    throw new Error('subject is required');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(subject)) {
    throw new Error(`invalid ledger subject "${subject}": use letters, digits, ".", "_" or "-"`);
  }
}

function ledgerRoot(options = {}) {
  return options.ledgerRoot ?? REPO_ROOT;
}

function ledgerFile(subject, options = {}) {
  validateSubject(subject);
  const policy = options.policy ?? loadPolicy();
  return path.join(ledgerRoot(options), policy.ledger.path, `${subject}.jsonl`);
}

/** Split ledger JSONL exactly as the verifier does: one trailing newline is a terminator, any other empty line is a line. */
export function splitJsonl(raw) {
  if (raw === '') return [];
  const lines = raw.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Absolute path of a subject's ledger file, from policy.ledger.path. */
export function ledgerPath(subject, options = {}) {
  return ledgerFile(subject, options);
}

/** Absolute path of the ledger directory, from policy.ledger.path. */
export function ledgerDir(options = {}) {
  return path.join(ledgerRoot(options), loadPolicy().ledger.path);
}

export function openLedger(subject, options = {}) {
  const policy = loadPolicy();
  const file = ledgerFile(subject, { ...options, policy });
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '', 'utf8');
  return { subject, path: file, policy };
}

export function append(kind, actor, subject, payload, options = {}) {
  if (typeof kind !== 'string' || kind === '') throw new Error('kind is required');
  if (typeof actor !== 'string' || actor === '') throw new Error('actor is required');
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be a JSON object');
  }
  const policy = loadPolicy();
  const kinds = policy.ledger.kinds;
  if (!kinds.includes(kind)) {
    throw new Error(`unknown ledger kind "${kind}"; policy.ledger.kinds allows: ${kinds.join(', ')}`);
  }
  const opened = openLedger(subject, options);
  const chain = readChain(subject, options);
  const seq = chain.length + 1;
  const receipt = {
    seq,
    ts_logical: seq,
    kind,
    actor,
    subject,
    payload,
    payload_sha256: sha256Canonical(payload),
    prev_sha256: chain.length === 0 ? GENESIS_PREV_SHA256 : chain[chain.length - 1].sha256,
  };
  receipt.sha256 = sha256Canonical(receipt);
  appendFileSync(opened.path, `${JSON.stringify(receipt)}\n`, 'utf8');
  return receipt;
}

export function readChain(subject, options = {}) {
  const file = ledgerFile(subject, options);
  if (!existsSync(file)) return [];
  const lines = splitJsonl(readFileSync(file, 'utf8'));
  return lines.map((line, index) => {
    if (line.trim() === '') {
      throw new Error(`empty JSONL line at index ${index} for subject "${subject}"`);
    }
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`malformed JSON at index ${index} for subject "${subject}": ${error.message}`);
    }
  });
}

function broken(length, brokenAt, reason) {
  return { ok: false, length, brokenAt, reason };
}

function receiptReason(index, message) {
  return `${message} at index ${index}`;
}

export function verifyChain(subject, options = {}) {
  const policy = loadPolicy();
  const file = ledgerFile(subject, { ...options, policy });
  if (!existsSync(file)) return { ok: true, length: 0 };
  const lines = splitJsonl(readFileSync(file, 'utf8'));
  const kinds = policy.ledger.kinds;
  const receipts = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() === '') {
      return broken(lines.length, index, receiptReason(index, 'empty JSONL line'));
    }
    let receipt;
    try {
      receipt = JSON.parse(lines[index]);
    } catch {
      return broken(lines.length, index, receiptReason(index, 'malformed JSON'));
    }
    receipts.push(receipt);
  }

  let prev = GENESIS_PREV_SHA256;
  let previousLogical = 0;
  for (let index = 0; index < receipts.length; index++) {
    const receipt = receipts[index];
    if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
      return broken(receipts.length, index, receiptReason(index, 'receipt is not an object'));
    }
    const required = ['seq', 'ts_logical', 'kind', 'actor', 'subject', 'payload', 'payload_sha256', 'prev_sha256', 'sha256'];
    for (const field of required) {
      if (!Object.prototype.hasOwnProperty.call(receipt, field)) {
        return broken(receipts.length, index, receiptReason(index, `missing field ${field}`));
      }
    }
    if (!kinds.includes(receipt.kind)) {
      return broken(receipts.length, index, receiptReason(index, `unknown kind "${receipt.kind}"`));
    }
    if (receipt.subject !== subject) {
      return broken(receipts.length, index, receiptReason(index, `subject mismatch (expected "${subject}")`));
    }
    if (receipt.seq !== index + 1) {
      return broken(receipts.length, index, receiptReason(index, `seq ${receipt.seq} is not ${index + 1}`));
    }
    if (!Number.isInteger(receipt.ts_logical) || receipt.ts_logical <= previousLogical) {
      return broken(receipts.length, index, receiptReason(index, 'ts_logical is not monotonic'));
    }
    if (receipt.payload_sha256 !== sha256Canonical(receipt.payload)) {
      return broken(receipts.length, index, receiptReason(index, 'payload_sha256 mismatch'));
    }
    if (receipt.prev_sha256 !== prev) {
      return broken(receipts.length, index, receiptReason(index, 'prev_sha256 does not match previous receipt'));
    }
    const { sha256: stored, ...unsigned } = receipt;
    if (!isHexSha256(stored) || stored !== sha256Canonical(unsigned)) {
      return broken(receipts.length, index, receiptReason(index, 'sha256 mismatch'));
    }
    prev = stored;
    previousLogical = receipt.ts_logical;
  }
  return { ok: true, length: receipts.length };
}
