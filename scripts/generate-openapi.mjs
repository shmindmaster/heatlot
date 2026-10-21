#!/usr/bin/env node
/**
 * npm run docs:openapi — write docs/api/openapi.json from the API's route declarations.
 * `--check` fails if the committed document differs, so the published contract cannot drift
 * from the code that serves it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/api/app.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(REPO_ROOT, 'docs', 'api', 'openapi.json');
const doc = await (await createApp().request('/openapi.json')).json();
const text = `${JSON.stringify(doc, null, 2)}\n`;
if (process.argv.includes('--check')) {
  let current = null;
  try { current = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'); } catch { /* missing */ }
  if (current !== text) { console.error('docs/api/openapi.json is stale: run npm run docs:openapi and commit'); process.exit(1); }
  console.log(`openapi.json matches the code (${Object.keys(doc.paths).length} paths)`);
} else {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, text);
  console.log(`wrote docs/api/openapi.json (OpenAPI ${doc.openapi}, ${Object.keys(doc.paths).length} paths)`);
}
