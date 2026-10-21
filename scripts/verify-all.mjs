#!/usr/bin/env node
/**
 * npm run verify:all
 *
 * Every claim the README makes, run in order, with the real exit code reported.
 * This is what "green" means for this repository, and it is what CI runs.
 *
 * Nothing here needs an API key or a network call. A step that does would be a
 * defect, not a configuration problem.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// expect: the exit code that means this step behaved correctly. verify:coc on an
// incomplete package is supposed to exit 3 — treating that as a failure would
// invert the whole contract.
const STEPS = [
  { name: 'generate:data', args: ['run', 'generate:data'], expect: 0, proves: 'dataset reproduces from seed' },
  { name: 'generate:packets', args: ['run', 'generate:packets'], expect: 0, proves: 'supplier packet PDFs reproduce byte for byte' },
  { name: 'test', args: ['test'], expect: 0, proves: 'unit tests across the deterministic layer' },
  { name: 'validate:schemas', args: ['run', 'validate:schemas'], expect: 0, proves: 'schemas compile; fixtures behave as named' },
  { name: 'evals', args: ['run', 'evals'], expect: 0, proves: 'eval suite including refusal cases' },
  { name: 'evals:mutate', args: ['run', 'evals:mutate'], expect: 0, proves: 'every guard is able to fail' },
  { name: 'smoke:mcp', args: ['run', 'smoke:mcp'], expect: 0, proves: 'MCP handshake and the data facts' },
  { name: 'heatlot verify PKT-24001', args: ['run', 'heatlot', '--', 'verify', 'data/packets/PKT-24001'], expect: 0, proves: 'a conforming packet is accepted, every finding cited' },
  { name: 'heatlot verify PKT-24002', args: ['run', 'heatlot', '--', 'verify', 'data/packets/PKT-24002'], expect: 3, proves: 'the hero packet: hidden text changes nothing, tensile missing' },
  { name: 'heatlot verify PKT-24003', args: ['run', 'heatlot', '--', 'verify', 'data/packets/PKT-24003'], expect: 4, proves: 'out-of-range chemistry is nonconforming' },
  { name: 'verify:coc PO-AER-5519', args: ['run', 'verify:coc', '--', 'PO-AER-5519'], expect: 3, proves: 'the refusal, agent-free' },
  { name: 'verify:coc PO-MER-5532', args: ['run', 'verify:coc', '--', 'PO-MER-5532'], expect: 0, proves: 'the verifier discriminates' },
  { name: 'audit:tamper', args: ['run', 'audit:tamper'], expect: 0, proves: 'a tampered receipt breaks the chain' },
  { name: 'demo:denied', args: ['run', 'demo:denied'], expect: 0, proves: 'the write boundary denies' },
  { name: 'demo:injection', args: ['run', 'demo:injection'], expect: 0, proves: 'an injected instruction changes nothing released' },
  { name: 'demo', args: ['run', 'demo'], expect: 3, proves: 'the end-to-end refusal' },
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const results = [];

// Children run offline whatever the caller's shell holds. HEATLOT_LIVE is opt-in
// for `npm run verify:live` alone, and inheriting it here would quietly make
// these steps depend on a network and a key.
const OFFLINE_ENV = { ...process.env };
delete OFFLINE_ENV.HEATLOT_LIVE;

for (const step of STEPS) {
  const run = spawnSync(npm, step.args, {
    cwd: REPO_ROOT, encoding: 'utf8', env: OFFLINE_ENV, shell: process.platform === 'win32',
  });
  const code = run.status;
  const ok = code === step.expect;
  results.push({ ...step, code, ok, output: `${run.stdout ?? ''}${run.stderr ?? ''}` });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.name.padEnd(26)} exit ${String(code).padEnd(4)} ${step.proves}`);
}

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length === 0) {
  console.log(`ALL GREEN — ${results.length} steps, every one at its expected exit code.`);
  process.exit(0);
}

console.log(`${failed.length} of ${results.length} steps FAILED\n`);
for (const f of failed) {
  console.log(`--- ${f.name}  (expected exit ${f.expect}, got ${f.code}) ---`);
  console.log(f.output.trimEnd().split('\n').slice(-25).join('\n'));
  console.log('');
}
process.exit(1);
