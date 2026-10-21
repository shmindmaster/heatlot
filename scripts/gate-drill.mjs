#!/usr/bin/env node
/**
 * npm run gate:drill — proof that the release gate can fail.
 *
 * A gate that has never blocked anything is decoration. For each deliberate
 * regression in evals/regressions/, this copies the repository to a scratch
 * directory, applies the regression, runs the release gate there, and requires
 * the gate to block the release with the check the regression names.
 *
 * Exit 0 when every regression is blocked by its named check, 1 when any one
 * slips through (the gate has a hole), 2 on a malformed regression definition.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The scratch copy leaves out generated receipts; their location is policy.ledger.path, not a literal.
function ledgerTopDir() {
  const policy = JSON.parse(readFileSync(path.join(REPO_ROOT, 'policy', 'policy.json'), 'utf8'));
  return policy.ledger.path.split(/[\\/]/).filter(Boolean)[0];
}
const REGRESSIONS = path.join(REPO_ROOT, 'evals', 'regressions');
const ENV = { ...process.env };
delete ENV.HEATLOT_LIVE;

function load() {
  return readdirSync(REGRESSIONS).filter((f) => f.endsWith('.json')).sort().map((file) => {
    const def = JSON.parse(readFileSync(path.join(REGRESSIONS, file), 'utf8'));
    for (const key of ['id', 'description', 'expected_block']) {
      if (typeof def[key] !== 'string' || def[key] === '') throw new Error(`${file}: ${key} must be a non-empty string`);
    }
    if (!def.delete && !(def.target && def.patch?.find && typeof def.patch.replace === 'string')) {
      throw new Error(`${file}: needs either "delete" or "target" + "patch.find" + "patch.replace"`);
    }
    return def;
  });
}

function copyRepository(destination) {
  const excluded = new Set(['.git', '.agentlogs', '.briefs', 'node_modules', ledgerTopDir(), 'reports']);
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith('.heatlot-')) continue;
    cpSync(path.join(REPO_ROOT, entry.name), path.join(destination, entry.name), { recursive: entry.isDirectory() });
  }
}

function resolveInside(root, relative) {
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`${relative} escapes the scratch repository`);
  return target;
}

function apply(root, def) {
  if (def.delete) {
    rmSync(resolveInside(root, def.delete));
    return;
  }
  const target = resolveInside(root, def.target);
  const source = readFileSync(target, 'utf8');
  const count = source.split(def.patch.find).length - 1;
  if (count !== 1) throw new Error(`${def.id}: patch.find matched ${count} times in ${def.target}`);
  writeFileSync(target, source.replace(def.patch.find, def.patch.replace));
}

function main() {
  let definitions;
  try {
    definitions = load();
  } catch (error) {
    console.error(`gate drill: ${error.message}`);
    process.exit(2);
  }
  if (definitions.length === 0) {
    console.error('gate drill: no regressions defined');
    process.exit(2);
  }

  let blocked = 0;
  for (const def of definitions) {
    // Scratch lives inside the repository so Node resolves node_modules by walking up.
    const scratch = mkdtempSync(path.join(REPO_ROOT, '.heatlot-drill-'));
    try {
      copyRepository(scratch);
      apply(scratch, def);
      const run = spawnSync(process.execPath, ['scripts/eval-gate.mjs', '--no-write'], { cwd: scratch, encoding: 'utf8', env: ENV });
      const failedChecks = [...run.stdout.matchAll(/^FAIL\s+(\S+)/gm)].map((m) => m[1]);
      const ok = run.status === 1 && failedChecks.includes(def.expected_block);
      if (ok) blocked++;
      console.log(`regression  ${def.id.padEnd(34)} ${ok ? `BLOCKED by ${def.expected_block}` : `NOT BLOCKED (gate exit ${run.status}, failed: ${failedChecks.join(', ') || 'none'})`}`);
      console.log(`            ${def.description}`);
    } catch (error) {
      console.log(`regression  ${def.id.padEnd(34)} ERROR ${error.message}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const all = blocked === definitions.length;
  console.log(`\n${blocked}/${definitions.length} deliberate regressions blocked${all ? ' — the release gate is able to fail.' : ' — the gate has a hole.'}`);
  process.exit(all ? 0 : 1);
}

main();
