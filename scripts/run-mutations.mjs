#!/usr/bin/env node
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The scratch copy leaves out generated receipts; their location is policy.ledger.path, not a literal.
function ledgerTopDir() {
  const policy = JSON.parse(readFileSync(path.join(REPO_ROOT, 'policy', 'policy.json'), 'utf8'));
  return policy.ledger.path.split(/[\\/]/).filter(Boolean)[0];
}
const DEFAULT_DEFINITIONS = path.join(REPO_ROOT, 'evals', 'mutations');

function parseArgs(argv) {
  let definitions = DEFAULT_DEFINITIONS;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--definitions' && argv[index + 1]) definitions = path.resolve(argv[++index]);
    else throw new Error(`unknown or incomplete argument: ${argv[index]}`);
  }
  return { definitions };
}

function loadDefinitions(directory) {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const definition = JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
      for (const key of ['id', 'guard', 'target', 'expected_eval', 'catcher_pattern']) {
        if (typeof definition[key] !== 'string' || definition[key] === '') {
          throw new Error(`${file}: ${key} must be a non-empty string`);
        }
      }
      if (typeof definition.patch?.find !== 'string' || definition.patch.find === '') {
        throw new Error(`${file}: patch.find must be a non-empty string`);
      }
      if (typeof definition.patch?.replace !== 'string') {
        throw new Error(`${file}: patch.replace must be a string`);
      }
      return definition;
    });
}

function copyRepository(destination) {
  const excluded = new Set(['.git', '.agentlogs', '.briefs', '.heatlot', 'node_modules', ledgerTopDir(), 'reports']);
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith('.heatlot-')) continue;
    cpSync(path.join(REPO_ROOT, entry.name), path.join(destination, entry.name), {
      recursive: entry.isDirectory(),
    });
  }
}

function applyMutation(root, definition) {
  const target = path.resolve(root, ...definition.target.split('/'));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`${definition.id}: target escapes scratch repository`);
  const source = readFileSync(target, 'utf8');
  const first = source.indexOf(definition.patch.find);
  const second = first === -1 ? -1 : source.indexOf(definition.patch.find, first + definition.patch.find.length);
  if (first === -1) throw new Error(`${definition.id}: patch.find did not match ${definition.target}`);
  if (second !== -1) throw new Error(`${definition.id}: patch.find matched ${definition.target} more than once`);
  writeFileSync(target, source.replace(definition.patch.find, definition.patch.replace), 'utf8');
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    // HEATLOT_LIVE is stripped rather than inherited. A mutation child that could
    // reach a live provider would be non-deterministic and billable, and this
    // harness spawns one per mutation.
    env: (() => {
      const child = { ...process.env, HEATLOT_MUTATION_CHILD: '1' };
      delete child.HEATLOT_LIVE;
      return child;
    })(),
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function exerciseMutation(root) {
  const evals = run(process.execPath, ['scripts/run-evals.mjs'], root);
  // The app's tests plus every package's tests: the extracted library is held to the same harness.
  const testFiles = readdirSync(path.join(root, 'tests'))
    .filter((file) => file.endsWith('.test.mjs'))
    .sort()
    .map((file) => `tests/${file}`);
  for (const pkg of readdirSync(path.join(root, 'packages'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const dir = path.join(root, 'packages', pkg, 'test');
    testFiles.push(...readdirSync(dir).filter((file) => file.endsWith('.test.mjs')).sort().map((file) => `packages/${pkg}/test/${file}`));
  }
  const tests = run(process.execPath, ['--test', ...testFiles], root);
  return {
    failed: evals.status !== 0 || tests.status !== 0,
    output: `${evals.output}\n${tests.output}`,
  };
}

function main() {
  let definitions;
  try {
    definitions = loadDefinitions(parseArgs(process.argv.slice(2)).definitions);
  } catch (error) {
    process.stderr.write(`mutation harness: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (definitions.length === 0) {
    process.stderr.write('mutation harness: no mutation definitions found\n');
    process.exitCode = 2;
    return;
  }

  let caught = 0;
  for (const definition of definitions) {
    const scratch = mkdtempSync(path.join(REPO_ROOT, '.heatlot-mutation-'));
    try {
      copyRepository(scratch);
      applyMutation(scratch, definition);
      const result = exerciseMutation(scratch);
      const expectedCatcherFired = result.output.includes(definition.catcher_pattern);
      if (result.failed && expectedCatcherFired) {
        caught++;
        console.log(`mutation  ${definition.id.padEnd(41)} CAUGHT by ${definition.expected_eval}`);
      } else {
        console.log(`mutation  ${definition.id.padEnd(41)} SURVIVED (expected ${definition.expected_eval})`);
      }
    } catch (error) {
      console.log(`mutation  ${definition.id.padEnd(41)} ERROR ${error.message}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  const summary = `${caught}/${definitions.length} mutations caught`;
  if (caught === definitions.length) {
    console.log(`${summary} — every guard in this repo is demonstrably able to fail.`);
    process.exitCode = 0;
  } else {
    console.log(`${summary} — surviving mutations are coverage gaps.`);
    process.exitCode = 1;
  }
}

main();
