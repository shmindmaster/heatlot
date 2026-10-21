import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MUTATIONS_DIR = path.join(REPO_ROOT, 'evals', 'mutations');

test('declarative mutations cover at least five distinct guards', () => {
  const definitions = readdirSync(MUTATIONS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(path.join(MUTATIONS_DIR, file), 'utf8')));

  assert.equal(definitions.length >= 5, true);
  assert.equal(new Set(definitions.map((definition) => definition.guard)).size >= 5, true);
  for (const definition of definitions) {
    assert.equal(typeof definition.id, 'string');
    assert.equal(typeof definition.target, 'string');
    assert.equal(typeof definition.patch?.find, 'string');
    assert.equal(typeof definition.patch?.replace, 'string');
    assert.equal(typeof definition.expected_eval, 'string');
  }
});

test('coc schema requires item sha256 rather than merely constraining it when present', () => {
  const schema = JSON.parse(readFileSync(path.join(REPO_ROOT, 'schemas', 'coc-report.schema.json'), 'utf8'));
  const report = JSON.parse(readFileSync(path.join(REPO_ROOT, 'evals', 'expected', 'coc-report.complete.valid.json'), 'utf8'));
  delete report.items[0].sha256;
  const validate = new Ajv2020({ strict: true }).compile(schema);

  assert.equal(validate(report), false, 'a present record without sha256 must be rejected');
});

test('the mutation runner fails when a declared mutation survives', { skip: process.env.HEATLOT_MUTATION_CHILD === '1' }, () => {
  const definitionsDir = mkdtempSync(path.join(os.tmpdir(), 'heatlot-survivor-'));
  const definition = {
    id: 'test/surviving-comment-change',
    guard: 'test-harness',
    target: 'scripts/verify-completeness.mjs',
    patch: {
      find: 'Pure Node, no dependencies.',
      replace: 'Pure Node, no external dependencies.',
    },
    expected_eval: 'intentionally-no-eval-catches-this',
    catcher_pattern: 'intentionally-no-test-output-contains-this',
  };
  writeFileSync(path.join(definitionsDir, 'survivor.json'), `${JSON.stringify(definition, null, 2)}\n`, 'utf8');

  try {
    const result = spawnSync(process.execPath, ['scripts/run-mutations.mjs', '--definitions', definitionsDir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, HEATLOT_MUTATION_CHILD: '1' },
    });
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /SURVIVED/);
    assert.match(output, /0\/1 mutations caught/);
  } finally {
    rmSync(definitionsDir, { recursive: true, force: true });
  }
});
