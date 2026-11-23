/**
 * run-evals-live.test.mjs — the --live prompt listing quotes each prompt as one
 * shell double-quoted argument, so backslashes, quotes, `$` and backticks in a
 * prompt cannot end the string early or expand.
 *
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { shellDoubleQuote } from '../scripts/run-evals.mjs';

const roundTrip = (value) => {
  const res = spawnSync('sh', ['-c', `printf '%s' ${shellDoubleQuote(value)}`], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
};

test('shellDoubleQuote escapes backslashes before the quote they precede', () => {
  assert.equal(shellDoubleQuote('a\\"b'), '"a\\\\\\"b"');
  assert.equal(roundTrip('ends with backslash\\'), 'ends with backslash\\');
  assert.equal(roundTrip('a\\"; echo injected; "'), 'a\\"; echo injected; "');
});

test('shellDoubleQuote keeps $ and backticks literal', () => {
  for (const value of ['$HOME', '`id`', '$(id)', 'plain "quoted" text', 'C:\\path\\to\\file']) {
    assert.equal(roundTrip(value), value);
  }
});
