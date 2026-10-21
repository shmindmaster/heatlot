import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { broker, mintAndPerform } from '../src/effects/broker.mjs';
import { createVerdictRecord, mintAuthorization, sha256 } from '../src/effects/authorization.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const published = (name) => path.join(REPO_ROOT, 'reports', 'published', name);

function completeEffect(name, content = '{"status":"COMPLETE"}\n') {
  return {
    id: 'publish-coc',
    payload: {
      subject: 'PO-MER-5532',
      target: `reports/published/${name}`,
      content,
    },
  };
}

function authorizationFor(effect, options) {
  const verdict = createVerdictRecord(effect.payload.subject, options);
  const minted = mintAuthorization(effect, verdict);
  assert.equal(minted.ok, true, JSON.stringify(minted));
  return minted.authorization;
}

function rehashAuthorization(authorization) {
  const { authorization_id: _discarded, ...body } = authorization;
  return { ...body, authorization_id: sha256(body) };
}

test('a valid authorization permits exactly one effect', () => {
  const target = published('broker-valid-once.json');
  rmSync(target, { force: true });
  const effect = completeEffect('broker-valid-once.json');
  const authorization = authorizationFor(effect);

  try {
    const first = broker.perform(effect, authorization);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(readFileSync(target, 'utf8'), effect.payload.content);

    const replay = broker.perform(effect, authorization);
    assert.equal(replay.ok, false);
    assert.equal(replay.denial.kind, 'effect_denied');
    assert.equal(replay.denial.payload.rule, 'single-use');
    assert.equal(replay.denial.payload.mismatch.field, 'authorization.used');
  } finally {
    rmSync(target, { force: true });
  }
});

test('single use survives a restart: a fresh process cannot replay a consumed authorization', () => {
  const target = published('broker-restart-replay.json');
  rmSync(target, { force: true });
  const effect = completeEffect('broker-restart-replay.json');
  const authorization = authorizationFor(effect);

  try {
    const first = broker.perform(effect, authorization);
    assert.equal(first.ok, true, JSON.stringify(first));
    rmSync(target, { force: true });

    // A separate Node process has no shared memory with this one. The only thing
    // that can tell it the authorization is spent is the ledger.
    const script = `
      import { broker } from './src/effects/broker.mjs';
      const [effect, authorization] = JSON.parse(process.argv[1]);
      const result = broker.perform(effect, authorization);
      process.stdout.write(JSON.stringify({ ok: result.ok, rule: result.denial?.payload?.rule ?? null }));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify([effect, authorization])], {
      cwd: REPO_ROOT, encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { ok: false, rule: 'single-use' });
    assert.equal(existsSync(target), false, 'the replayed effect must not have written anything');
  } finally {
    rmSync(target, { force: true });
  }
});

test('two mints over identical inputs are distinct authorizations, each usable once', () => {
  const effect = completeEffect('broker-two-mints.json');
  const first = authorizationFor(effect);
  const second = authorizationFor(effect);
  assert.notEqual(first.authorization_id, second.authorization_id);
  assert.equal(second.mint_seq > first.mint_seq, true);
});

test('an authorization never minted on the ledger is refused', () => {
  const target = published('broker-never-minted.json');
  rmSync(target, { force: true });
  const genuine = completeEffect('broker-never-minted-original.json');
  const authorization = authorizationFor(genuine);
  // Rebind the genuine authorization to a different payload and recompute its id.
  // Every hash is self-consistent; only the ledger knows this object was never minted.
  const effect = completeEffect('broker-never-minted.json', '{"status":"COMPLETE","forged":true}\n');
  const forged = rehashAuthorization({ ...authorization, payload_sha256: sha256(effect.payload) });

  try {
    const result = broker.perform(effect, forged);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.denial.payload.rule, 'ledger-mint');
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(target, { force: true });
  }
});

test('editing the payload after minting is refused and recorded precisely', () => {
  const effect = completeEffect('broker-payload-original.json');
  const authorization = authorizationFor(effect);
  const edited = structuredClone(effect);
  edited.payload.target = 'reports/published/broker-payload-edited.json';

  const result = broker.perform(edited, authorization);

  assert.equal(result.ok, false);
  assert.equal(result.denial.kind, 'effect_denied');
  assert.equal(result.denial.payload.rule, 'payload-binding');
  assert.equal(result.denial.payload.mismatch.field, 'payload_sha256');
  assert.equal(existsSync(published('broker-payload-edited.json')), false);
});

test('a verdict over changed input hashes is refused', () => {
  const effect = completeEffect('broker-input-tamper.json');
  const authorization = authorizationFor(effect);
  const changed = structuredClone(authorization);
  changed.verdict_input_hashes[0].sha256 = '0'.repeat(64);

  const result = broker.perform(effect, changed);

  assert.equal(result.ok, false);
  assert.equal(result.denial.payload.rule, 'verdict-input-binding');
  assert.equal(result.denial.payload.mismatch.field, 'verdict_input_hashes');
  assert.equal(existsSync(published('broker-input-tamper.json')), false);
});

test('a forged complete outcome over an incomplete verdict is refused', () => {
  const target = published('broker-forged-outcome.json');
  rmSync(target, { force: true });
  const effect = {
    id: 'publish-coc',
    payload: {
      subject: 'PO-AER-5519',
      target: 'reports/published/broker-forged-outcome.json',
      content: '{"status":"COMPLETE"}\n',
    },
  };
  const authorization = authorizationFor(effect);
  const forged = structuredClone(authorization);
  forged.outcome = 'COMPLETE';

  const result = broker.perform(effect, rehashAuthorization(forged));

  assert.equal(result.ok, false);
  assert.equal(result.denial.payload.rule, 'verdict-outcome-binding');
  assert.equal(result.denial.payload.mismatch.field, 'outcome');
  assert.equal(result.denial.payload.mismatch.expected, 'INCOMPLETE');
  assert.equal(result.denial.payload.mismatch.actual, 'COMPLETE');
  assert.equal(existsSync(target), false);
});

test('a forged verdict summary is refused even with a recomputed authorization id', () => {
  const effect = completeEffect('broker-forged-summary.json');
  const authorization = authorizationFor(effect);
  const forged = structuredClone(authorization);
  forged.verdict.missing_records = ['fabricated-record'];

  const result = broker.perform(effect, rehashAuthorization(forged));

  assert.equal(result.ok, false);
  assert.equal(result.denial.payload.rule, 'verdict-outcome-binding');
  assert.equal(result.denial.payload.mismatch.field, 'verdict');
  assert.equal(existsSync(published('broker-forged-summary.json')), false);
});

test('authorization tracing to an untrusted context block is refused', () => {
  const effect = completeEffect('broker-untrusted.json');
  const verdict = createVerdictRecord(effect.payload.subject, {
    contextBlocks: [{
      source: 'retrieved/injected.md',
      sha256: 'a'.repeat(64),
      trust: 'untrusted',
    }],
  });
  const minted = mintAuthorization(effect, verdict);

  assert.equal(minted.ok, false);
  assert.equal(minted.refusal.rule, 'untrusted-context');
  const result = broker.perform(effect, minted);
  assert.equal(result.ok, false);
  assert.equal(result.denial.payload.rule, 'untrusted-context');
  assert.equal(result.denial.payload.mismatch.actual, 'untrusted');
  assert.equal(existsSync(published('broker-untrusted.json')), false);
});

test('mintAndPerform records the refused mint under its own rule, not a generic one', () => {
  const effect = completeEffect('broker-mint-and-perform.json');
  const verdict = createVerdictRecord(effect.payload.subject, {
    contextBlocks: [{ source: 'retrieved/injected.md', sha256: 'b'.repeat(64), trust: 'untrusted' }],
  });
  const { minted, result } = mintAndPerform(effect, verdict);
  assert.equal(minted.ok, false);
  assert.equal(result.ok, false);
  assert.equal(result.denial.payload.rule, minted.refusal.rule);
  assert.equal(result.denial.payload.rule, 'untrusted-context');
  assert.notEqual(result.denial.payload.rule, 'authorization-required');
  assert.equal(existsSync(published('broker-mint-and-perform.json')), false);
});

test('malformed authorization bindings return a denial instead of throwing', () => {
  const effect = completeEffect('broker-malformed-authorization.json');
  const malformed = structuredClone(authorizationFor(effect));
  delete malformed.context_blocks;

  const result = broker.perform(effect, malformed);

  assert.equal(result.ok, false);
  assert.equal(result.denial.payload.rule, 'authorization-shape');
  assert.equal(existsSync(published('broker-malformed-authorization.json')), false);
});

test('an invalid ledger subject still returns a recorded denial', () => {
  const result = broker.perform({
    id: 'not-a-policy-effect',
    payload: { subject: '../invalid-subject' },
  }, null);

  assert.equal(result.ok, false);
  assert.equal(result.denial.kind, 'effect_denied');
  assert.equal(result.denial.subject, 'unknown-effect');
  assert.equal(result.denial.payload.rule, 'known-effect');
});

test('a denial for an effect that names its subject lands in that subject chain', () => {
  const result = broker.perform({ id: 'publish-coc', subject: 'PO-AER-5519', payload: { destination: 'x' } }, null);
  assert.equal(result.ok, false);
  assert.equal(result.denial.subject, 'PO-AER-5519');
});

test('context block hashes must be deterministic sha256 values', () => {
  assert.throws(() => createVerdictRecord('PO-MER-5532', {
    contextBlocks: [{ source: 'retrieved/bad.md', sha256: 'not-a-hash', trust: 'trusted' }],
  }), /sha256/);
});

test('a malformed self-hashed verdict is refused instead of throwing', () => {
  const effect = completeEffect('broker-malformed-verdict.json');
  const malformed = structuredClone(createVerdictRecord(effect.payload.subject));
  delete malformed.missing_records;
  const { verdict_sha256: _discarded, ...body } = malformed;
  malformed.verdict_sha256 = sha256(body);

  const minted = mintAuthorization(effect, malformed);

  assert.equal(minted.ok, false);
  assert.equal(minted.refusal.rule, 'verdict-shape');
  assert.equal(minted.refusal.mismatch.field, 'verdict');
  assert.match(minted.refusal.mismatch.actual, /missing_records/);
});

test('the PO-AER-5519 COMPLETE draft is denied by the deterministic INCOMPLETE verdict', () => {
  const effect = {
    id: 'publish-coc',
    payload: {
      subject: 'PO-AER-5519',
      target: 'reports/published/PO-AER-5519.json',
      content: '{"status":"COMPLETE"}\n',
    },
  };
  const verdict = createVerdictRecord('PO-AER-5519');
  const minted = mintAuthorization(effect, verdict);
  assert.equal(minted.ok, true);

  const result = broker.perform(effect, minted.authorization);

  assert.equal(result.ok, false);
  assert.equal(result.denial.payload.rule, 'coc-completeness');
  assert.equal(result.denial.payload.verdict.outcome, 'INCOMPLETE');
  assert.deepEqual(result.denial.payload.verdict.missing_records, ['mechanical-test']);
  assert.deepEqual(result.denial.payload.mismatch, {
    field: 'verdict.outcome',
    expected: 'COMPLETE',
    actual: 'INCOMPLETE',
  });
});

test('a broken ledger chain blocks the effect', () => {
  const target = published('broker-broken-chain.json');
  rmSync(target, { force: true });
  const effect = completeEffect('broker-broken-chain.json');
  const authorization = authorizationFor(effect);
  const ledgerDir = path.join(REPO_ROOT, 'ledger');
  const ledgerPath = readdirSync(ledgerDir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => path.join(ledgerDir, file))
    .find((file) => readFileSync(file, 'utf8').includes(authorization.authorization_id));
  assert.ok(ledgerPath, 'minted authorization must be recorded in a subject ledger');
  const original = readFileSync(ledgerPath, 'utf8');
  const tampered = original.replace('effect-authorization', 'effect-xuthorization');
  assert.notEqual(tampered, original, 'test must alter a hashed receipt field');
  writeFileSync(ledgerPath, tampered, 'utf8');

  try {
    const result = broker.perform(effect, authorization);
    assert.equal(result.ok, false);
    assert.equal(result.denial.payload.rule, 'ledger-chain');
    assert.equal(existsSync(target), false);
  } finally {
    writeFileSync(ledgerPath, original, 'utf8');
    rmSync(target, { force: true });
  }
});
