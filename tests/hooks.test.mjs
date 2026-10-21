/**
 * hooks.test.mjs — the publish-gate enforcement contract, exercised exactly the
 * way Claude Code invokes it: JSON hook payload on stdin, exit code as verdict.
 *   exit 2 = block (stderr explains) | exit 0 = allow.
 *
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(REPO_ROOT, 'hooks', 'publish-gate.mjs');

function runGate(payload, { confirmPublish = false, raw = false } = {}) {
  const env = { ...process.env };
  // The gate has no override. confirmPublish sets the environment variable an
  // earlier revision honoured, precisely so the test can prove it no longer does.
  if (confirmPublish) env.KESTREL_PUBLISH_CONFIRMED = '1';
  const res = spawnSync(process.execPath, [GATE], {
    input: raw ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
  assert.ifError(res.error);
  return res;
}

const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } });

test('write under data/ is blocked (exit 2)', () => {
  const res = runGate(write('data/docs/x.md'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /data\//);
});

test('write under references/ is blocked (exit 2)', () => {
  const res = runGate(write('references/01-x.md'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /references\//);
});

test('absolute Windows path into ground truth is blocked (normalization)', () => {
  const res = runGate(write('C:\\Repos\\shmindmaster\\heatlot\\schemas\\coc-report.schema.json'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /schemas\//);
});

test('publish to reports/published/ is blocked', () => {
  const res = runGate(write('reports/published/digest.html'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /requires a coc-completeness verdict of COMPLETE/);
  assert.match(res.stderr, /the hook has no override/);
});

test('no environment variable unblocks a guarded write', () => {
  // The repository claims there is no override path. This is that claim as a test:
  // set the flag a previous revision honoured and confirm the gate still refuses.
  const res = runGate(write('reports/published/digest.html'), { confirmPublish: true });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /the hook has no override/);
});

test('write to reports/drafts/ is allowed', () => {
  const res = runGate(write('reports/drafts/digest.html'));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});

test('write to README.md is blocked (exit 2)', () => {
  const res = runGate(write('README.md'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /reports\/drafts/);
});

test('matched payload with no file_path is blocked (exit 2)', () => {
  const res = runGate({ tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /file_path/);
});

test('malformed stdin is blocked (exit 2)', () => {
  const res = runGate('this is not json{', { raw: true });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /malformed/);
});

test('no agent in the policy is granted Bash or a shell', () => {
  const policy = JSON.parse(readFileSync(path.join(REPO_ROOT, 'policy', 'policy.json'), 'utf8'));
  for (const [agent, grant] of Object.entries(policy.agents)) {
    for (const tool of grant.tools ?? []) {
      assert.doesNotMatch(String(tool), /^(bash|shell|powershell|exec)$/i, `${agent} is granted ${tool}`);
    }
  }
});
