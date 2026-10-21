/**
 * The Receipt Explorer's in-page verifier must agree with the ledger.
 *
 * src/explorer/chain.mjs is inlined into an offline HTML page, so it carries its
 * own SHA-256 and canonical JSON. If it ever disagreed with src/ledger, the page
 * could show a green chain the broker would refuse. These tests run both
 * verifiers over a real chain and over every single-byte tamper the page can
 * produce, and require the same verdict and the same broken index.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalize as explorerCanonicalize, sha256Hex, tamperOneByte, verifyLines } from '../src/explorer/chain.mjs';
import { append, canonicalize, verifyChain } from '../src/ledger/index.mjs';
import { loadLedgerLines, renderExplorer } from '../scripts/render-explorer.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(path.join(REPO_ROOT, 'policy', 'policy.json'), 'utf8'));
const KINDS = policy.ledger.kinds;

function scratchChain(subject) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'heatlot-explorer-'));
  const options = { ledgerRoot: root };
  append('context_assembled', 'coc-assembler', subject, { blocks: 3, untrusted: ['data/docs/x.md'] }, options);
  append('decision_returned', 'coc-assembler', subject, { status: 'complete', missing_records: [], provenance: { provider: 'replay' } }, options);
  append('verdict', 'verifier', subject, { rule: 'coc-completeness', outcome: 'INCOMPLETE', missing_records: ['mechanical-test'] }, options);
  append('effect_denied', 'effect-broker', subject, { rule: 'untrusted-context', mismatch: { field: 'trust' } }, options);
  const file = path.join(root, policy.ledger.path, `${subject}.jsonl`);
  return { root, file, options, lines: readFileSync(file, 'utf8').trim().split('\n') };
}

test('the pure SHA-256 matches node:crypto, including multi-block and non-ASCII input', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'released — never the model’s call']) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), JSON.stringify(text.slice(0, 20)));
  }
});

test('the explorer canonical JSON is byte-identical to the ledger canonical JSON', () => {
  const value = { z: 1, a: [true, null, { y: 'é', b: 2.5 }], m: { undefinedDropped: undefined, k: 'v' } };
  assert.equal(explorerCanonicalize(value), canonicalize(value));
});

test('an untouched chain verifies in both verifiers', () => {
  const chain = scratchChain('EXPLORER-OK');
  try {
    const page = verifyLines(chain.lines, { subject: 'EXPLORER-OK', kinds: KINDS });
    const ledger = verifyChain('EXPLORER-OK', chain.options);
    assert.equal(page.ok, true, page.reason);
    assert.equal(ledger.ok, true);
    assert.equal(page.links.every((link) => link.status === 'verified'), true);
  } finally {
    rmSync(chain.root, { recursive: true, force: true });
  }
});

test('tampering one byte in any receipt breaks both verifiers at the same index', () => {
  const chain = scratchChain('EXPLORER-TAMPER');
  try {
    for (let index = 0; index < chain.lines.length; index++) {
      const tampered = [...chain.lines];
      const flip = tamperOneByte(tampered[index]);
      assert.equal(flip.line.length, tampered[index].length, 'exactly one byte changes');
      assert.notEqual(flip.before, flip.after);
      tampered[index] = flip.line;
      writeFileSync(chain.file, `${tampered.join('\n')}\n`);

      const page = verifyLines(tampered, { subject: 'EXPLORER-TAMPER', kinds: KINDS });
      const ledger = verifyChain('EXPLORER-TAMPER', chain.options);
      assert.equal(page.ok, false, `page missed a tamper at ${index}`);
      assert.equal(ledger.ok, false);
      assert.equal(page.brokenAt, ledger.brokenAt);
      assert.equal(page.reason, ledger.reason);
      assert.equal(page.links[index].status, 'broken');
      assert.equal(page.links.slice(index + 1).every((link) => link.status === 'unverified'), true);
    }
  } finally {
    rmSync(chain.root, { recursive: true, force: true });
  }
});

test('the rendered page is deterministic, offline, and carries the verifier', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'heatlot-explorer-render-'));
  try {
    const chain = scratchChain('EXPLORER-RENDER');
    mkdirSync(path.join(root, 'ledger'), { recursive: true });
    writeFileSync(path.join(root, 'ledger', 'EXPLORER-RENDER.jsonl'), `${chain.lines.join('\n')}\n`);
    const sources = [{ id: 'EXPLORER-RENDER', title: 'Scratch chain', file: path.join(root, 'ledger', 'EXPLORER-RENDER.jsonl') }];
    const first = renderExplorer({ sources, context: null });
    const second = renderExplorer({ sources, context: null });
    assert.equal(first, second, 'two renders produce identical bytes');
    assert.doesNotMatch(first, /<script[^>]+src=|<link[^>]+href="http|@import|fetch\(/, 'no network references');
    assert.match(first, /function verifyLines/);
    assert.match(first, /function tamperOneByte/);
    assert.doesNotMatch(first, /^export /m, 'inlined module has no export keywords');
    rmSync(chain.root, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a blank line in the ledger file breaks the chain in the page exactly as it does in the ledger', () => {
  const chain = scratchChain('EXPLORER-BLANK');
  try {
    const cases = {
      'extra trailing newline': `${chain.lines.join('\n')}\n\n`,
      'blank line mid-file': `${chain.lines.slice(0, 2).join('\n')}\n\n${chain.lines.slice(2).join('\n')}\n`,
    };
    for (const [name, raw] of Object.entries(cases)) {
      writeFileSync(chain.file, raw);
      const page = verifyLines(loadLedgerLines(chain.file), { subject: 'EXPLORER-BLANK', kinds: KINDS });
      const ledger = verifyChain('EXPLORER-BLANK', chain.options);
      assert.equal(ledger.ok, false, name);
      assert.equal(page.ok, false, `${name}: the page must not show a green chain the ledger refuses`);
      assert.equal(page.brokenAt, ledger.brokenAt, name);
      assert.equal(page.reason, ledger.reason, name);
    }
    writeFileSync(chain.file, `${chain.lines.join('\n')}\n`);
    assert.equal(verifyLines(loadLedgerLines(chain.file), { subject: 'EXPLORER-BLANK', kinds: KINDS }).ok, true, 'one trailing newline is a terminator');
  } finally {
    rmSync(chain.root, { recursive: true, force: true });
  }
});

test('tampering stays inside the payload object', () => {
  const line = JSON.stringify({ seq: 1, kind: 'verdict', payload: { count: 3, items: [1, 2] }, payload_sha256: 'abcdef', sha256: 'fedcba' });
  assert.throws(() => tamperOneByte(line), /no tamperable byte found in payload/);

  const nested = JSON.stringify({ seq: 1, payload: { note: '{"x":"}', rule: 'untrusted-context' }, payload_sha256: 'abc' });
  const flip = tamperOneByte(nested);
  const start = nested.indexOf('"payload":');
  const end = nested.indexOf(',"payload_sha256"');
  assert.equal(flip.offset > start && flip.offset < end, true, 'the flipped byte is inside the payload');
});
