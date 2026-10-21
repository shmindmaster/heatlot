#!/usr/bin/env node
/**
 * npm run policy:explain [-- --agent <name>]
 *
 * Prints what policy/policy.json actually grants, per agent: what it may read,
 * what it may call, which decisions it owns, which effects it may attempt, and
 * which gate stands in front of each. Nothing here is computed — the point is
 * that permissions are data, and this reads them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPolicy() {
  const file = path.join(REPO_ROOT, 'policy', 'policy.json');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    console.error(`policy:explain — cannot read ${path.relative(REPO_ROOT, file)}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch (error) {
    console.error(`policy:explain — policy.json does not parse: ${error.message}`);
    process.exit(1);
  }
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const BAR = '─'.repeat(74);
const bullet = (items, empty = 'none') =>
  (items && items.length ? items.map((i) => `\n     · ${i}`).join('') : ` ${empty}`);

function explainAgent(name, spec, policy) {
  console.log(`\n${name}\n${BAR}`);
  console.log(`  reads:${bullet(spec.reads)}`);
  console.log(`  tools:${bullet(spec.tools, 'none — this agent holds no tools of its own')}`);
  console.log(`  decisions:${bullet(spec.decisions)}`);

  const effects = spec.effects ?? [];
  if (effects.length === 0) {
    console.log('  effects: none — this agent cannot cause a side effect');
  } else {
    console.log('  effects:');
    for (const id of effects) {
      const e = policy.effects?.[id];
      if (!e) {
        console.log(`     · ${id}  — NOT DEFINED in policy.effects (this would fail closed)`);
        continue;
      }
      console.log(`     · ${id}`);
      console.log(`         gate       verdict "${e.requiresVerdict}" must be ${e.requiresOutcome}`);
      console.log(`         bound to   ${(e.bindsTo ?? []).join(', ') || 'nothing'}`);
      console.log(`         single use ${e.singleUse ? 'yes' : 'no'}`);
    }
  }
  console.log(`  context budget: ${spec.contextBudgetTokens} tokens`);
}

function explainBoundary(policy) {
  const wb = policy.writeBoundary ?? {};
  console.log(`\nwrite boundary\n${BAR}`);
  console.log(`  allowed:${bullet(wb.allow)}`);
  console.log('  guarded:');
  for (const g of wb.guarded ?? []) {
    console.log(`     · ${g.path}  — requires verdict "${g.requiresVerdict}" = ${g.requiresOutcome}`);
  }
  console.log(`  denied:${bullet(wb.deny)}`);
  console.log('\n  Anything not listed under allowed or guarded is denied. The hook fails');
  console.log('  closed on a missing or malformed policy rather than defaulting open.');
}

function explainTripwires(policy) {
  const tw = policy.tripwires ?? {};
  console.log(`\ntripwires\n${BAR}`);
  for (const [phase, list] of [['input', tw.input ?? []], ['output', tw.output ?? []]]) {
    for (const t of list) {
      console.log(`  ${phase}  ${t.id}`);
      console.log(`         applies to ${t.appliesTo}`);
      console.log(`         action     ${t.action}   (then ${t.onFire})`);
      if (t.patterns) console.log(`         patterns   ${t.patterns.length}`);
    }
  }
  console.log('\n  Input patterns are best-effort telemetry, not the barrier. The barrier');
  console.log('  is that the model holds no release authority — see docs/threat-model.md.');
}

const policy = loadPolicy();
const only = argValue('--agent');

console.log('\nHeatlot — policy/policy.json, as enforced');

if (only) {
  const spec = policy.agents?.[only];
  if (!spec) {
    console.error(`\nunknown agent "${only}" — known: ${Object.keys(policy.agents ?? {}).sort().join(', ')}`);
    process.exit(1);
  }
  explainAgent(only, spec, policy);
} else {
  for (const [name, spec] of Object.entries(policy.agents ?? {})) explainAgent(name, spec, policy);
  explainBoundary(policy);
  explainTripwires(policy);
}
console.log('');
