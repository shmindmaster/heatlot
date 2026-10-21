/**
 * ledger.test.mjs — append-only JSONL chain, hash links, fail-closed kinds.
 *
 * Run: node --test tests/ledger.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  GENESIS_PREV_SHA256,
  append,
  openLedger,
  readChain,
  sha256Canonical,
  verifyChain,
} from '../src/ledger/index.mjs';

function isolated(t) {
  const ledgerRoot = mkdtempSync(path.join(os.tmpdir(), 'heatlot-ledger-'));
  t.after(() => rmSync(ledgerRoot, { recursive: true, force: true }));
  return { ledgerRoot };
}

test('chain verification passes on a good chain', (t) => {
  const { ledgerRoot } = isolated(t);
  const subject = 'CHAIN-GOOD';
  openLedger(subject, { ledgerRoot });
  const first = append('verdict', 'test-actor', subject, { step: 1 }, { ledgerRoot });
  const second = append('effect_denied', 'test-actor', subject, { step: 2 }, { ledgerRoot });

  assert.equal(first.seq, 1);
  assert.equal(first.ts_logical, 1);
  assert.equal(first.prev_sha256, GENESIS_PREV_SHA256);
  assert.equal(second.seq, 2);
  assert.equal(second.prev_sha256, first.sha256);
  assert.equal(first.ts_logical < second.ts_logical, true);

  const verified = verifyChain(subject, { ledgerRoot });
  assert.equal(verified.ok, true);
  assert.equal(verified.length, 2);
  assert.equal(verified.brokenAt, undefined);

  const chain = readChain(subject, { ledgerRoot });
  assert.equal(chain.length, 2);
  assert.equal(chain[0].sha256, first.sha256);
});

test('a mutated receipt is caught and the broken index is named', (t) => {
  const { ledgerRoot } = isolated(t);
  const subject = 'CHAIN-MUTATED';
  append('context_assembled', 'test-actor', subject, { n: 1 }, { ledgerRoot });
  append('verdict', 'test-actor', subject, { n: 2 }, { ledgerRoot });
  append('effect_denied', 'test-actor', subject, { n: 3 }, { ledgerRoot });

  const file = openLedger(subject, { ledgerRoot }).path;
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 3);
  const marker = '"sha256":"';
  const at = lines[1].indexOf(marker);
  assert.notEqual(at, -1);
  const pos = at + marker.length;
  const current = lines[1][pos];
  lines[1] = `${lines[1].slice(0, pos)}${current === '0' ? '1' : '0'}${lines[1].slice(pos + 1)}`;
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');

  const verified = verifyChain(subject, { ledgerRoot });
  assert.equal(verified.ok, false);
  assert.equal(verified.brokenAt, 1);
  assert.match(verified.reason, /index 1/);
});

test('an unknown kind is rejected', (t) => {
  const { ledgerRoot } = isolated(t);
  assert.throws(
    () => append('not-a-real-kind', 'test-actor', 'KIND-REJECT', {}, { ledgerRoot }),
    /unknown ledger kind "not-a-real-kind"/,
  );
  const verified = verifyChain('KIND-REJECT', { ledgerRoot });
  assert.equal(verified.ok, true);
  assert.equal(verified.length, 0);
});

test('payload hash covers canonical JSON of the unsigned receipt', (t) => {
  const { ledgerRoot } = isolated(t);
  const receipt = append('tripwire_fired', 'test-actor', 'HASH-CHECK', { z: 1, a: 2 }, { ledgerRoot });
  const { sha256, ...unsigned } = receipt;
  assert.equal(sha256, sha256Canonical(unsigned));
  assert.equal(receipt.payload_sha256, sha256Canonical(receipt.payload));
});
