import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { baselineEntries, grownEntries } from '../scripts/conformance-mcp.mjs';

const BASE = [
  '# expected failures',
  'server:',
  '  - prompts-list:prompts-list # failure: capability not offered',
  '  - resources-list:resources-list # failure: capability not offered',
  '',
].join('\n');

test('baselineEntries reads scenario:check ids and ignores comments', () => {
  assert.deepEqual(baselineEntries(BASE), ['prompts-list:prompts-list', 'resources-list:resources-list']);
});

test('a baseline that shrinks passes the shrink-only rule', () => {
  const shrunk = BASE.replace(/.*resources-list.*\n/, '');
  assert.deepEqual(grownEntries(shrunk, BASE), []);
});

test('a baseline that grows is caught, naming the added entry', () => {
  const grown = `${BASE}  - tools-list:tools-list # hiding a regression\n`;
  assert.deepEqual(grownEntries(grown, BASE), ['tools-list:tools-list']);
});

test('the committed baselines only list features the server does not offer', () => {
  for (const [server, rev] of ['heatlot', 'kestrel-foundry-data'].flatMap((s) => ['2026-07-28', '2025-11-25'].map((r) => [s, r]))) {
    const text = readFileSync(new URL(`../mcp-servers/${server}/conformance/${rev}.yml`, import.meta.url), 'utf8');
    const lines = text.split('\n').filter((l) => l.startsWith('  - '));
    assert.ok(lines.length > 0, `${rev} baseline is empty`);
    for (const line of lines) {
      assert.match(line, /# (failure|warning): /, `${rev}: every entry carries a reason: ${line}`);
      assert.doesNotMatch(line, /^ {2}- tools-list:|dns-rebinding|server-initialize|ping:/, `${rev}: a core check must never be baselined: ${line}`);
    }
  }
});
