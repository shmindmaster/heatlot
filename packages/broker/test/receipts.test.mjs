import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sign, createPrivateKey } from 'node:crypto';

import { Ledger, canonical, generateKeys, hashOf, verifyChain } from '../src/receipts.mjs';

const keys = generateKeys();
function ledgerWith(n) {
  const ledger = new Ledger(mkdtempSync(path.join(tmpdir(), 'heatlot-receipts-')), { privateKey: keys.privateKey });
  for (let i = 0; i < n; i++) ledger.append('step', { i, note: `receipt ${i}` });
  return ledger;
}

test('canonical JSON sorts keys and is whitespace-free', () => {
  assert.equal(canonical({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
});

test('one changed byte breaks the chain at that receipt', () => {
  const ledger = ledgerWith(4);
  assert.equal(verifyChain(ledger.read(), keys.publicKey).ok, true);
  const lines = readFileSync(ledger.file, 'utf8').split('\n');
  lines[2] = lines[2].replace('receipt 2', 'receipt 9');
  writeFileSync(ledger.file, lines.join('\n'));
  const result = verifyChain(ledger.read(), keys.publicKey);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 2);
});

test('a rewritten chain with recomputed hashes fails the signature check', () => {
  const ledger = ledgerWith(3);
  const receipts = ledger.read();
  // An attacker without the private key edits receipt 1 and recomputes every hash consistently.
  receipts[1].payload = { i: 1, note: 'approved by nobody' };
  receipts[1].payload_sha256 = hashOf(receipts[1].payload);
  for (let i = 1; i < receipts.length; i++) {
    receipts[i].prev_sha256 = receipts[i - 1].receipt_sha256;
    const { receipt_sha256: _, sig, ...body } = receipts[i];
    receipts[i].receipt_sha256 = hashOf(body);
  }
  const result = verifyChain(receipts, keys.publicKey);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 1);
  assert.match(result.reason, /signature/);
});

test('a chain signed by another key fails verification', () => {
  const ledger = ledgerWith(2);
  const other = generateKeys();
  const receipts = ledger.read().map((r) => ({ ...r, sig: sign(null, Buffer.from(r.receipt_sha256, 'hex'), createPrivateKey(other.privateKey)).toString('base64') }));
  const result = verifyChain(receipts, keys.publicKey);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 0);
});
