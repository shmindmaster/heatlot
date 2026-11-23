import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFields } from '../src/inspection/fields.mjs';

const lines = (...texts) => texts.map((text, i) => ({ page: 1, line: i + 1, text }));

test('the signatory line is read with its cite', () => {
  const f = readFields('coc', lines('Signed:  J. Ortega, QA Manager'));
  assert.deepEqual(f.signatory, { value: 'J. Ortega, QA Manager', cite: { doc: 'coc', page: 1, line: 1 } });
});

test('a whitespace-only signature is not a signatory', () => {
  assert.equal(readFields('coc', lines('Signed:    ')).signatory, null);
});

test('a pathological signature line is read in linear time', () => {
  const text = `Signed:${' '.repeat(200_000)}\n\n`;
  const start = process.hrtime.bigint();
  const f = readFields('mtr', lines(text));
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(f.signatory, null);
  assert.ok(ms < 2000, `readFields took ${ms.toFixed(1)} ms`);
});
