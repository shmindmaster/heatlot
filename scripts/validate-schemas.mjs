#!/usr/bin/env node
/**
 * validate-schemas.mjs — schema contract gate for the heatlot plugin.
 *
 * Modes:
 *   node scripts/validate-schemas.mjs --schema <name> --file <json>
 *       Validate one JSON file against schemas/<name>.schema.json.
 *       Exit 0 = valid, 1 = invalid (ajv errors printed compactly), 2 = usage/IO error.
 *
 *   node scripts/validate-schemas.mjs          (no args)
 *       Compile every schemas/*.schema.json, then check every fixture in
 *       evals/expected/ by naming convention:
 *         <schema>.<case>.valid.json    MUST validate
 *         <schema>.<case>.invalid.json  MUST be rejected
 *       (<case> is optional: <schema>.valid.json is also accepted.)
 *       A fixture schema name resolves to schemas/<name>.schema.json, falling
 *       back to schemas/<name>-output.schema.json (e.g. fixtures named
 *       ncr-triage.* bind to ncr-triage-output.schema.json).
 *       One line per fixture; exit 1 on any surprise, 0 when all behave as named.
 *
 * Uses ajv (root devDependency) with the draft 2020-12 meta-schema. ESM.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS_DIR = path.join(REPO_ROOT, 'schemas');
const FIXTURES_DIR = path.join(REPO_ROOT, 'evals', 'expected');

function makeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  // ISO calendar date, round-trip checked (rejects e.g. 2026-02-31). Registered
  // locally so schemas can use "format": "date" without the ajv-formats package.
  ajv.addFormat('date', {
    type: 'string',
    validate: (s) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    },
  });
  return ajv;
}

function formatErrors(errors) {
  return (errors ?? [])
    .map((e) => `    ${e.instancePath || '/'} [${e.keyword}] ${e.message} ${JSON.stringify(e.params)}`)
    .join('\n');
}

function schemaPathFor(name) {
  const candidates = [
    path.join(SCHEMAS_DIR, `${name}.schema.json`),
    path.join(SCHEMAS_DIR, `${name}-output.schema.json`),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function compileSchema(ajv, schemaPath) {
  return ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
}

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage:');
  console.error('  node scripts/validate-schemas.mjs --schema <name> --file <json>');
  console.error('  node scripts/validate-schemas.mjs            # compile all schemas, check evals/expected fixtures');
  process.exitCode = 2;
}

/** Single-file mode: exit 0 valid / 1 invalid / 2 error. */
function runSingle(schemaName, file) {
  const schemaPath = schemaPathFor(schemaName);
  if (!schemaPath) {
    console.error(`error: no schema for "${schemaName}" (looked for ${schemaName}.schema.json and ${schemaName}-output.schema.json in schemas/)`);
    process.exitCode = 2;
    return;
  }
  const ajv = makeAjv();
  let validate;
  try {
    validate = compileSchema(ajv, schemaPath);
  } catch (err) {
    console.error(`error: schema ${path.basename(schemaPath)} does not compile: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  } catch (err) {
    console.error(`error: cannot read/parse ${file}: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  if (validate(data)) {
    console.log(`VALID   ${file} conforms to ${path.basename(schemaPath)}`);
    process.exitCode = 0;
  } else {
    console.log(`INVALID ${file} vs ${path.basename(schemaPath)}:`);
    console.log(formatErrors(validate.errors));
    process.exitCode = 1;
  }
}

/** "<schema>.<case>.valid.json" / "<schema>.invalid.json" -> { schema, caseName, expectValid } */
function parseFixtureName(file) {
  const m = file.match(/^(.+)\.(valid|invalid)\.json$/);
  if (!m) return null;
  const base = m[1];
  const dot = base.lastIndexOf('.');
  return {
    schema: dot === -1 ? base : base.slice(0, dot),
    caseName: dot === -1 ? 'default' : base.slice(dot + 1),
    expectValid: m[2] === 'valid',
  };
}

/** Fixture mode: exit 0 when every schema compiles and every fixture behaves as named. */
function runFixtures() {
  let surprises = 0;
  const ajv = makeAjv();
  const validators = new Map();

  const schemaFiles = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json')).sort();
  for (const f of schemaFiles) {
    const name = f.replace(/\.schema\.json$/, '');
    try {
      validators.set(name, compileSchema(ajv, path.join(SCHEMAS_DIR, f)));
      console.log(`SCHEMA OK    ${f}`);
    } catch (err) {
      surprises++;
      console.log(`SCHEMA FAIL  ${f} — does not compile: ${err.message}`);
    }
  }

  if (!existsSync(FIXTURES_DIR)) {
    console.log('FAIL         evals/expected/ does not exist — no fixtures to check');
    process.exitCode = 1;
    return;
  }

  const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort();
  let checked = 0;
  for (const f of fixtureFiles) {
    const parsed = parseFixtureName(f);
    if (!parsed) {
      console.log(`SKIP         ${f} — not a <schema>.<case>.(valid|invalid).json fixture`);
      continue;
    }
    checked++;
    const { schema, expectValid } = parsed;
    const validate = validators.get(schema) ?? validators.get(`${schema}-output`);
    if (!validate) {
      surprises++;
      console.log(`FAIL         ${f} — no compiled schema for "${schema}" (tried ${schema}, ${schema}-output)`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(path.join(FIXTURES_DIR, f), 'utf8'));
    } catch (err) {
      surprises++;
      console.log(`FAIL         ${f} — unreadable JSON: ${err.message}`);
      continue;
    }
    const ok = validate(data);
    if (ok === expectValid) {
      console.log(`PASS         ${f} — ${expectValid ? 'validates' : 'rejected'}, as expected`);
    } else {
      surprises++;
      if (ok) {
        console.log(`FAIL         ${f} — expected REJECTION but it validated`);
      } else {
        console.log(`FAIL         ${f} — expected to validate but was rejected:`);
        console.log(formatErrors(validate.errors));
      }
    }
  }

  console.log(
    surprises === 0
      ? `ALL GOOD — ${schemaFiles.length} schemas compiled, ${checked} fixtures behaved as named`
      : `${surprises} surprise(s) across ${schemaFiles.length} schemas and ${checked} fixtures`
  );
  process.exitCode = surprises === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    runFixtures();
    return;
  }
  let schema = null;
  let file = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--schema') schema = args[++i];
    else if (args[i] === '--file') file = args[++i];
    else {
      usage(`unknown argument: ${args[i]}`);
      return;
    }
  }
  if (!schema || !file) {
    usage('both --schema <name> and --file <json> are required');
    return;
  }
  runSingle(schema, file);
}

main();


