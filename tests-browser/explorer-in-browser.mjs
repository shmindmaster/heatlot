/**
 * The Receipt Explorer, driven in a real headless browser.
 *
 * tests/explorer.test.mjs proves the page's verifier agrees with the ledger.
 * This proves the page itself does what it shows: a fresh chain renders green,
 * Tamper one byte turns the seal red at the receipt that was changed and marks
 * every later receipt unverifiable, Restore brings the chain back, and the
 * controls work from the keyboard.
 *
 * Named outside node --test's discovery patterns, so `npm test` stays browser-free; run with
 * `npm run test:browser` (CI installs Chromium first).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import { append } from '../src/ledger/index.mjs';
import { renderExplorer } from '../scripts/render-explorer.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(path.join(REPO_ROOT, 'policy', 'policy.json'), 'utf8'));
const SUBJECT = 'BROWSER-CHAIN';

let root;
let browser;
let page;

before(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'heatlot-explorer-browser-'));
  const options = { ledgerRoot: root };
  append('context_assembled', 'coc-assembler', SUBJECT, { blocks: 3, untrusted: ['data/docs/x.md'] }, options);
  append('decision_returned', 'coc-assembler', SUBJECT, { status: 'complete', missing_records: [], provenance: { provider: 'replay', fixture_key: 'a'.repeat(64) } }, options);
  append('verdict', 'verifier', SUBJECT, { rule: 'coc-completeness', outcome: 'INCOMPLETE', missing_records: ['mechanical-test'] }, options);
  append('effect_denied', 'effect-broker', SUBJECT, { rule: 'untrusted-context', mismatch: { field: 'trust' } }, options);
  const ledgerFile = path.join(root, policy.ledger.path, `${SUBJECT}.jsonl`);
  const html = renderExplorer({ sources: [{ id: 'scratch', title: 'Scratch chain', file: ledgerFile }], context: null });
  const htmlFile = path.join(root, 'explorer.html');
  writeFileSync(htmlFile, html);

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(htmlFile).href);
  await page.locator('.tag').first().waitFor();
  assert.deepEqual(errors, [], 'the page loads without script errors');
});

after(async () => {
  await browser?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

test('a fresh chain renders verified, every link green', async () => {
  await assert.doesNotReject(page.locator('#seal:not(.broken)', { hasText: 'Chain verified' }).waitFor());
  assert.equal(await page.locator('.chain li').count(), 4);
  assert.equal(await page.locator('.chain li.verified').count(), 4);
});

test('tampering one byte breaks the chain at that receipt and marks later receipts unverifiable', async () => {
  await page.locator('.tag[data-i="1"]').click();
  await page.locator('#detail-h', { hasText: 'Model decision' }).waitFor();
  await page.locator('#tamper').click();
  await page.locator('#seal.broken').waitFor();
  assert.match(await page.locator('#seal').innerText(), /Chain broken at receipt 2/);
  assert.match(await page.locator('#seal').innerText(), /payload_sha256 mismatch/);
  assert.equal(await page.locator('.chain li.verified').count(), 1, 'receipt 1 is still linked');
  assert.equal(await page.locator('.chain li:nth-child(2)').getAttribute('class'), 'broken');
  assert.equal(await page.locator('.chain li.unverified').count(), 2, 'receipts 3 and 4 are unverifiable');
  assert.equal(await page.locator('.raw mark').count(), 1, 'exactly one byte is highlighted');
  assert.match(await page.locator('#readout').innerText(), /Changed byte \d+ of receipt 2/);
  assert.equal(await page.locator('#tamper').isDisabled(), true);
});

test('restore brings the whole chain back', async () => {
  await page.locator('#restore').click();
  await page.locator('#seal:not(.broken)').waitFor();
  assert.equal(await page.locator('.chain li.verified').count(), 4);
  assert.equal(await page.locator('#restore').isDisabled(), true);
});

test('the controls work from the keyboard', async () => {
  await page.locator('.tag[data-i="2"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#detail-h', { hasText: 'Verdict computed' }).waitFor();
  await page.locator('#tamper').focus();
  await page.keyboard.press('Enter');
  await page.locator('#seal.broken').waitFor();
  assert.match(await page.locator('#seal').innerText(), /Chain broken at receipt 3/);
  await page.locator('#restore').focus();
  await page.keyboard.press('Enter');
  await page.locator('#seal:not(.broken)').waitFor();
});
