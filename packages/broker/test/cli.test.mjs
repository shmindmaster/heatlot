import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'broker.mjs');
const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', windowsHide: true });

test('cli: keygen, approve, verify, and refuse an untrusted approval with exit 3', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'heatlot-cli-'));
  assert.equal(cli('keygen', '--dir', dir).status, 0);
  assert.equal(cli('keygen', '--dir', dir).status, 2, 'never overwrites a signing key');
  const approved = cli('approve', '--dir', dir, '--tool', 'send_email', '--args', '{"to":"a@example.com"}', '--by', 'alice');
  assert.equal(approved.status, 0);
  assert.equal(JSON.parse(approved.stdout).tool, 'send_email');
  const refused = cli('approve', '--dir', dir, '--tool', 'send_email', '--args', '{}', '--by', 'agent', '--untrusted', 'po-note.md');
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /untrusted-input/);
  assert.equal(cli('verify', '--dir', dir).status, 0);
  const file = path.join(dir, 'receipts.jsonl');
  writeFileSync(file, readFileSync(file, 'utf8').replace('alice', 'mallory'));
  const broken = cli('verify', '--dir', dir);
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /BROKEN at receipt 0/);
});
