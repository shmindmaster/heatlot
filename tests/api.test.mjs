import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from '@hono/zod-openapi';

import { createApp } from '../src/api/app.mjs';
import * as S from '../src/api/schemas.mjs';

const app = () => createApp({ out: mkdtempSync(path.join(tmpdir(), 'heatlot-api-')) });
const post = (a, url, body) => a.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
async function valid(res, schema, status = 200) {
  assert.equal(res.status, status);
  const body = await res.json();
  const parsed = schema.safeParse(body);
  assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3)));
  return body;
}

test('api: the queue and a packet validate against their schemas', async () => {
  const a = app();
  const q = await valid(await a.request('/api/packets'), z.object({ packets: S.PacketSummary.array() }));
  assert.ok(q.packets.length >= 8);
  assert.ok(q.packets.every((p) => p.status === 'received'));
  await valid(await a.request('/api/health'), S.Health);
});

test('api: inspecting the hero packet returns INCOMPLETE with the hidden citation rejected', async () => {
  const a = app();
  const body = await valid(await post(a, '/api/packets/PKT-24002/inspect'), S.Inspection);
  assert.equal(body.verdict, 'INCOMPLETE');
  assert.equal(body.draft_verdict, 'COMPLETE');
  assert.equal(body.rejected[0].reason, 'cited-line-hidden');
  assert.equal(body.ncr.disposition, 'quarantine');
});

test('api: release works once; refusals use the error envelope with the broker rule', async () => {
  const a = app();
  const early = await valid(await post(a, '/api/packets/PKT-24002R/approve', { by: 'J. Mendez' }), S.ErrorBody, 409);
  assert.equal(early.error.rule, 'not-inspected');
  await post(a, '/api/packets/PKT-24002/inspect');
  await post(a, '/api/packets/PKT-24002R/inspect');
  const refused = await valid(await post(a, '/api/packets/PKT-24002/approve', { by: 'inspector' }), S.ErrorBody, 409);
  assert.equal(refused.error.rule, 'verdict-not-accept');
  const auth = await valid(await post(a, '/api/packets/PKT-24002R/approve', { by: 'J. Mendez' }), S.Authorization);
  await valid(await post(a, '/api/packets/PKT-24002R/release', { authorization: auth }), S.ReleaseRecord);
  const again = await valid(await post(a, '/api/packets/PKT-24002R/release', { authorization: auth }), S.ErrorBody, 409);
  assert.equal(again.error.rule, 'already-used');
  const second = await valid(await post(a, '/api/packets/PKT-24002R/approve', { by: 'someone else' }), S.ErrorBody, 409);
  assert.equal(second.error.rule, 'already-released');
  const chain = await valid(await a.request('/api/packets/PKT-24002R/receipts'), S.ReceiptChain);
  assert.equal(chain.verified, true);
});

test('api: the last inspection can be read without re-inspecting', async () => {
  const a = app();
  await valid(await a.request('/api/packets/PKT-24003/inspection'), S.ErrorBody, 404);
  await post(a, '/api/packets/PKT-24003/inspect');
  const before = (await (await a.request('/api/packets/PKT-24003/receipts')).json()).receipts.length;
  const stored = await valid(await a.request('/api/packets/PKT-24003/inspection'), S.Inspection);
  assert.equal(stored.verdict, 'NONCONFORMING');
  const after = (await (await a.request('/api/packets/PKT-24003/receipts')).json()).receipts.length;
  assert.equal(after, before, 'reading an inspection writes no receipts');
});

test('api: invalid input is rejected at the boundary', async () => {
  const a = app();
  await valid(await post(a, '/api/packets/PKT-24002R/approve', { by: '' }), S.ErrorBody, 400);
  await valid(await post(a, '/api/packets/PKT-24002R/approve', { by: 'x', extra: true }), S.ErrorBody, 400);
  await valid(await a.request('/api/packets/PKT-99999'), S.ErrorBody, 404);
  await valid(await a.request('/api/packets/not-a-packet'), S.ErrorBody, 400);
});

test('api: the document text layer and the PDF are served as received', async () => {
  const a = app();
  const lines = await a.request('/api/packets/PKT-24002/documents/mtr/lines');
  const body = await lines.json();
  assert.equal(body.lines.filter((l) => l.hidden).length, 1);
  const pdf = await a.request('/api/packets/PKT-24002/documents/mtr/pdf');
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('api: OpenAPI 3.1 is served and Scalar renders it at /docs/api', async () => {
  const a = app();
  const doc = await (await a.request('/openapi.json')).json();
  assert.match(doc.openapi, /^3\.1\./);
  assert.ok(doc.paths['/api/packets/{packet}/release'].post.responses['409']);
  const docs = await a.request('/docs/api');
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /openapi\.json/);
});
