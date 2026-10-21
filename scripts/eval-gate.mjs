#!/usr/bin/env node
/**
 * npm run gate — the release gate.
 *
 * Measures the tree against the floors in evals/gate.json and refuses a release
 * that falls below any of them. Five checks, each one a property a reviewer can
 * name rather than a pass count:
 *
 *   eval-suite            the deterministic eval suite passes, with no fewer
 *                         checks than the baseline (deleting a case is a regression)
 *   guard-coverage        every mutation is caught, with no fewer mutations than
 *                         the baseline (deleting a mutation is a regression)
 *   refusal-correctness   the verifier still discriminates, and the injection
 *                         scenario still ends with no authorization minted and
 *                         no effect performed
 *   replay-determinism    two runs of the injection scenario write byte-identical
 *                         ledgers
 *   audit-replay          the decision replays from receipts alone, and a
 *                         tampered receipt still breaks the chain
 *
 * Writes docs/benchmark.md (deterministic: no times, no paths outside the repo;
 * CI fails if the committed copy is stale) and reports/eval-gate/report.json.
 * `--no-write` measures only; scripts/gate-drill.mjs uses it to prove this gate
 * can fail.
 *
 * Exit 0 release allowed, 1 release blocked, 2 usage or baseline error.
 * Offline: children run with HEATLOT_LIVE stripped.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ledgerPath } from '../src/ledger/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = { ...process.env };
delete ENV.HEATLOT_LIVE;

function node(args) {
  const run = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', env: ENV });
  if (run.error) throw run.error;
  return { status: run.status, out: `${run.stdout}\n${run.stderr}` };
}

// Resolved per call through the ledger module, so policy.ledger.path is the only place the location lives.
const ledgerFile = (subject) => ledgerPath(subject);
const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const kindsIn = (file) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line).kind);

function evalSuite(floor) {
  const run = node(['scripts/run-evals.mjs']);
  const match = run.out.match(/ALL GREEN — (\d+) checks passed/);
  const checks = match ? Number(match[1]) : 0;
  const ok = run.status === 0 && checks >= floor.minChecks;
  return { ok, measured: `${checks} checks passed (exit ${run.status})`, floor: `>= ${floor.minChecks} checks, exit 0` };
}

function guardCoverage(floor) {
  const run = node(['scripts/run-mutations.mjs']);
  const match = run.out.match(/(\d+)\/(\d+) mutations caught/);
  const [caught, total] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  const survivors = [...run.out.matchAll(/mutation\s+(\S+)\s+(SURVIVED|ERROR)/g)].map((m) => m[1]);
  const ok = run.status === 0 && total >= floor.minMutations && (!floor.requireAllCaught || caught === total);
  const detail = survivors.length ? `; not caught: ${survivors.join(', ')}` : '';
  return { ok, measured: `${caught}/${total} caught${detail}`, floor: `>= ${floor.minMutations} mutations, all caught` };
}

function refusalCorrectness(spec) {
  const problems = [];
  for (const { po, exit } of spec.verifier) {
    const run = node(['scripts/verify-completeness.mjs', po]);
    if (run.status !== exit) problems.push(`verify:coc ${po} exited ${run.status}, expected ${exit}`);
  }
  const injection = node(['scripts/demo-injection.mjs']);
  if (injection.status !== 0) problems.push(`demo:injection exited ${injection.status}`);
  const file = ledgerFile(spec.injection.subject);
  if (!existsSync(file)) {
    problems.push(`no ledger for ${spec.injection.subject}`);
  } else {
    const kinds = kindsIn(file);
    for (const kind of spec.injection.forbidKinds) if (kinds.includes(kind)) problems.push(`injection ledger holds ${kind}`);
    for (const kind of spec.injection.requireKinds) if (!kinds.includes(kind)) problems.push(`injection ledger lacks ${kind}`);
    if (spec.injection.denialRule) {
      const denial = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).find((r) => r.kind === 'effect_denied');
      if (denial && denial.payload?.rule !== spec.injection.denialRule) {
        problems.push(`denial receipt names ${denial.payload?.rule}, expected ${spec.injection.denialRule}`);
      }
    }
  }
  return {
    ok: problems.length === 0,
    measured: problems.length ? problems.join('; ') : 'incomplete PO refused, complete PO passes, injection minted nothing, performed nothing, and its denial names the rule that refused',
    floor: 'verifier exits as specified; no authorization or effect under injection',
  };
}

function replayDeterminism(spec) {
  const hashes = [];
  for (let run = 0; run < spec.runs; run++) {
    const result = node(['scripts/demo-injection.mjs']);
    hashes.push(result.status === 0 && existsSync(ledgerFile('PO-AER-5519')) ? sha256File(ledgerFile('PO-AER-5519')) : `exit ${result.status}`);
  }
  const ok = hashes.every((hash) => hash === hashes[0] && /^[0-9a-f]{64}$/.test(hash));
  return { ok, measured: ok ? `${spec.runs} runs, byte-identical ledgers` : `ledgers differ: ${hashes.join(' vs ')}`, floor: `${spec.runs} identical ledgers` };
}

function auditReplay(spec) {
  const audit = node(['scripts/audit.mjs', '--po', spec.po]);
  const tamper = node(['scripts/audit.mjs', '--tamper-check']);
  const ok = audit.status === 0 && tamper.status === 0;
  return { ok, measured: `audit exit ${audit.status}, tamper-check exit ${tamper.status}`, floor: 'both exit 0' };
}

function renderMarkdown(results) {
  const rows = results.map((r) => `| ${r.id} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.measured} | ${r.floor} |`);
  return [
    '# Release gate benchmark',
    '',
    'Generated by `npm run gate` from the floors in `evals/gate.json`. Deterministic: no timestamps, no',
    'model calls. CI regenerates this file and fails if the committed copy differs, so it cannot drift',
    'from the code it describes. `npm run gate:drill` proves the gate blocks a deliberate regression.',
    '',
    '| Check | Result | Measured | Floor |',
    '|---|---|---|---|',
    ...rows,
    '',
    results.every((r) => r.ok) ? '**Release allowed.**' : '**Release blocked.**',
    '',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const write = !args.includes('--no-write');
  const unknown = args.filter((arg) => arg !== '--no-write');
  if (unknown.length) {
    console.error(`unknown argument: ${unknown[0]}`);
    process.exit(2);
  }
  let gate;
  try {
    gate = JSON.parse(readFileSync(path.join(REPO_ROOT, 'evals', 'gate.json'), 'utf8'));
  } catch (error) {
    console.error(`cannot read evals/gate.json: ${error.message}`);
    process.exit(2);
  }

  const checks = [
    ['eval-suite', () => evalSuite(gate.evalSuite)],
    ['guard-coverage', () => guardCoverage(gate.guardCoverage)],
    ['refusal-correctness', () => refusalCorrectness(gate.refusalCorrectness)],
    ['replay-determinism', () => replayDeterminism(gate.replayDeterminism)],
    ['audit-replay', () => auditReplay(gate.auditReplay)],
  ];
  const results = [];
  for (const [id, run] of checks) {
    let result;
    try {
      result = run();
    } catch (error) {
      result = { ok: false, measured: `harness error: ${error.message}`, floor: 'check runs' };
    }
    results.push({ id, ...result });
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${id.padEnd(20)} ${result.measured}`);
  }

  const allowed = results.every((r) => r.ok);
  if (write) {
    writeFileSync(path.join(REPO_ROOT, 'docs', 'benchmark.md'), renderMarkdown(results));
    mkdirSync(path.join(REPO_ROOT, 'reports', 'eval-gate'), { recursive: true });
    writeFileSync(path.join(REPO_ROOT, 'reports', 'eval-gate', 'report.json'), `${JSON.stringify({ allowed, results }, null, 2)}\n`);
  }
  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  console.log(allowed ? '\nRELEASE ALLOWED — every check at or above its floor.' : `\nRELEASE BLOCKED — ${failed.join(', ')}`);
  process.exit(allowed ? 0 : 1);
}

main();
