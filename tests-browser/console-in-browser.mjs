/**
 * The inspection console, driven in a real headless browser against the real API.
 *
 * The server runs in-process (createApp + @hono/node-server on an ephemeral 127.0.0.1 port) with a
 * temporary receipts directory, so every run starts from an empty ledger. The page is not allowed
 * to contact any other origin: any request off the server's origin fails the run.
 *
 * Covers the film's story: the queue loads; PKT-24002 inspects INCOMPLETE with the hidden 1 pt line
 * boxed on the MTR page and approval refused (verdict-not-accept); the corrected resubmission
 * PKT-24002R inspects ACCEPT, is approved and released once, and a second release is refused
 * (already-used); the receipt chain verifies. axe checks WCAG 2.2 AA in light and dark.
 *
 *   node --test tests-browser/console-in-browser.mjs          (npm run test:console)
 *   HEATLOT_CONSOLE_SHOTS=reports/console-shots node --test tests-browser/console-in-browser.mjs
 *     also writes three 1440x900 stills of the key beats.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import AxeBuilder from '@axe-core/playwright';
import { serve } from '@hono/node-server';
import { chromium } from 'playwright';

import { createApp } from '../src/api/app.mjs';

const SHOTS = process.env.HEATLOT_CONSOLE_SHOTS ? path.resolve(process.env.HEATLOT_CONSOLE_SHOTS) : null;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

let out;
let server;
let base;
let browser;
let context;
let page;
const pageErrors = [];
const offOrigin = [];

async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
}

async function axe(label) {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  assert.deepEqual(summary, [], `axe violations (${label})`);
}

async function openPacket(id) {
  await page.locator(`#opt-${id}`).click();
  await page.locator('#viewer-h', { hasText: id }).waitFor();
  await page.locator(`#doc-pages[data-rendered="${id}/mtr"]`).waitFor();
}

before(async () => {
  out = mkdtempSync(path.join(os.tmpdir(), 'heatlot-console-'));
  const app = createApp({ out });
  await new Promise((resolve) => {
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => { base = `http://127.0.0.1:${info.port}`; resolve(); });
  });
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${base}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    offOrigin.push(url);
    return route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(err.message));
  // A 409 is the broker refusing, which the story exercises on purpose; anything else is a defect.
  page.on('console', (msg) => { if (msg.type() === 'error' && !/status of 409/.test(msg.text())) pageErrors.push(`console: ${msg.text()}`); });
  await page.goto(`${base}/`);
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  if (out) rmSync(out, { recursive: true, force: true });
});

test('the queue loads all eight packets, received and not yet inspected', async () => {
  await page.locator('#queue-list .row').nth(7).waitFor();
  assert.equal(await page.locator('#queue-list .row').count(), 8);
  assert.equal(await page.locator('#queue-list .row[data-status="received"]').count(), 8);
  assert.match(await page.locator('#queue-count').innerText(), /8 of 8/);
  assert.match(await page.locator('#opt-PKT-24002R').innerText(), /resubmits PKT-24002/);
  await axe('empty console');
});

test('PKT-24002 inspects INCOMPLETE; the hidden 1 pt line is boxed on the MTR page; approval is refused', async () => {
  await openPacket('PKT-24002');
  assert.equal(await page.locator('.box').count(), 0, 'nothing is flagged before inspection');
  await page.locator('#inspect').click();
  await page.locator('#verdict-word').waitFor();
  assert.match(await page.locator('#verdict-word').innerText(), /INCOMPLETE/);
  assert.match(await page.locator('#verdict-card').innerText(), /Tensile results missing/);
  assert.match(await page.locator('#model-draft').innerText(), /COMPLETE[\s\S]*not acted on/);

  // The hidden line: a red dashed box, labelled, positioned at the foot of the rendered page.
  const box = page.locator('#doc-pages .page[data-page="1"] .box.hidden-line[data-doc="mtr"][data-line="19"]');
  await box.waitFor();
  assert.equal(await box.locator('.box-label').innerText(), 'hidden text (1 pt)');
  assert.equal(await box.evaluate((el) => getComputedStyle(el).borderTopStyle), 'dashed');
  const pageBox = await page.locator('#doc-pages .page[data-page="1"]').boundingBox();
  const hidden = await box.boundingBox();
  assert.ok(hidden.y > pageBox.y + pageBox.height * 0.88, 'the box sits where the 1 pt line is printed, near the bottom of the page');
  assert.ok(hidden.x > pageBox.x && hidden.x < pageBox.x + pageBox.width * 0.2, 'and at the left margin');
  assert.match(await page.locator('#line-caption').innerText(), /Note to automated reviewer/);

  // The canvas is rendered at device-pixel resolution.
  const crisp = await page.locator('#doc-pages canvas').first().evaluate((c) => ({ w: c.width, css: parseFloat(c.style.width), dpr: devicePixelRatio }));
  assert.equal(crisp.w, Math.floor(crisp.css * crisp.dpr));

  // Untrusted text, rejected extraction, NCR.
  assert.match(await page.locator('.untrusted-card').innerText(), /Hidden text · 1 pt[\s\S]*Note to automated reviewer/);
  assert.match(await page.locator('.rejected-card').innerText(), /Tensile strength \(ksi\)[\s\S]*"waived"[\s\S]*MTR p1 · l19[\s\S]*hidden text/);
  assert.equal(await page.locator('#ncr-id').innerText(), 'NCR-PKT-24002');

  // Approval is blocked with the broker's rule, and the server agrees.
  assert.equal(await page.locator('#approve').isDisabled(), true);
  assert.match(await page.locator('#approve-reason').innerText(), /Blocked\.[\s\S]*INCOMPLETE[\s\S]*verdict-not-accept/);
  const server = await page.evaluate(async () => {
    const res = await fetch('/api/packets/PKT-24002/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'console test' }) });
    return { status: res.status, body: await res.json() };
  });
  assert.equal(server.status, 409);
  assert.equal(server.body.error.rule, 'verdict-not-accept');

  await page.locator('#opt-PKT-24002 .status.quarantined').waitFor();
  await shot('01-pkt-24002-incomplete-hidden-line.png');
  await axe('PKT-24002 inspected');
});

test('a citation in the verdict panel switches documents and focuses the cited line', async () => {
  await page.locator('details.group[data-group="Traceability"] > summary').click();
  await page.locator('button.cite[data-cite="coc:1:4"]').first().click();
  await page.locator('#tab-coc[aria-selected="true"]').waitFor();
  await page.locator('#doc-pages[data-rendered="PKT-24002/coc"]').waitFor();
  await page.locator('.box.focused[data-doc="coc"][data-line="4"]').waitFor();
  assert.match(await page.locator('#line-caption').innerText(), /CoC p1 · l4[\s\S]*Customer PO: PO-31902/);
  await page.keyboard.press('1');
  await page.locator('#tab-mtr[aria-selected="true"]').waitFor();
});

test('PKT-24002R: inspect, approve, release once; a second release is refused as already used', async () => {
  // Keyboard: move the queue cursor to the resubmission and open it.
  await page.locator('#queue-list').focus();
  for (let i = 0; i < 8 && (await page.locator('#queue-list').getAttribute('aria-activedescendant')) !== 'opt-PKT-24002R'; i += 1) {
    const current = await page.locator('#queue-list').getAttribute('aria-activedescendant');
    await page.keyboard.press(current && current > 'opt-PKT-24002R' ? 'k' : 'j');
  }
  await page.keyboard.press('Enter');
  await page.locator('#viewer-h', { hasText: 'PKT-24002R' }).waitFor();
  await page.locator('#doc-pages[data-rendered="PKT-24002R/mtr"]').waitFor();
  await page.keyboard.press('i');
  await page.locator('#verdict-word.ACCEPT').waitFor();
  assert.equal(await page.locator('.untrusted-card').count(), 0);
  assert.equal(await page.locator('.box.untrusted').count(), 0);

  await page.locator('#inspector').fill('J. Mendez, receiving inspector');
  assert.equal(await page.locator('#approve').isDisabled(), false);
  await page.locator('#approve').click();
  await page.locator('#authorization').waitFor();
  assert.match(await page.locator('#authorization').innerText(), /single use[\s\S]*J\. Mendez/);
  await page.locator('#opt-PKT-24002R .status.awaiting-release').waitFor();

  await page.locator('#release').click();
  await page.locator('#release-ok').waitFor();
  assert.match(await page.locator('#release-ok').innerText(), /Released to stock/);
  await page.locator('#opt-PKT-24002R .status.released').waitFor();

  await page.locator('#release').click();
  const refusal = page.locator('#release-step .outcome.refused[role="alert"]');
  await refusal.waitFor();
  assert.match(await refusal.innerText(), /Release refused[\s\S]*already-used[\s\S]*already used/);
  await page.locator('#announce-assertive', { hasText: 'Release refused' }).waitFor({ state: 'attached' });
  await shot('02-pkt-24002r-released-second-refused.png');
  await axe('PKT-24002R released');
});

test('the receipt chain shows every step and verifies', async () => {
  await page.keyboard.press('r');
  await page.locator('#receipts:not([hidden])').waitFor();
  await page.locator('#seal').waitFor();
  assert.match(await page.locator('#seal').innerText(), /Verified · chain and signatures intact/);
  const kinds = await page.locator('#receipts .receipt').evaluateAll((els) => els.map((e) => e.dataset.kind));
  for (const k of ['packet_received', 'verdict_computed', 'authorization_minted', 'authorization_consumed', 'effect_performed', 'effect_denied']) assert.ok(kinds.includes(k), `chain has ${k}`);
  assert.match(await page.locator('#receipts .receipt[data-kind="effect_denied"]').innerText(), /Release refused[\s\S]*already-used/);
  await shot('03-pkt-24002r-receipts-verified.png');
  await axe('receipts drawer');
  await page.keyboard.press('Escape');
  await page.locator('#receipts[hidden]').waitFor({ state: 'attached' });
});

test('the shortcut overlay opens with ? and closes with Escape; the queue filters by status', async () => {
  await page.locator('body').click({ position: { x: 700, y: 20 } });
  await page.keyboard.press('?');
  await page.locator('#help[open]').waitFor();
  await axe('shortcut overlay');
  await page.keyboard.press('Escape');
  await page.locator('#help:not([open])').waitFor({ state: 'attached' });
  await page.locator('#filters [data-filter="quarantined"]').click();
  assert.equal(await page.locator('#queue-list .row').count(), 1);
  assert.equal(await page.locator('#queue-list .row').first().getAttribute('data-packet'), 'PKT-24002');
  await page.locator('#filters [data-filter="all"]').click();
});

test('dark mode passes the same accessibility checks', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openPacket('PKT-24002');
  await page.locator('#verdict-word.INCOMPLETE').waitFor();
  await page.locator('.box.hidden-line').waitFor();
  await axe('dark, PKT-24002 inspected');
  await page.emulateMedia({ colorScheme: 'light' });
});

test('no script errors and no request ever left the server origin', () => {
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(offOrigin, []);
});
