import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { AUTH_META_KEY, Broker, generateKeys, startProxy } from '../src/index.mjs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-mcp-server.mjs');

function harness() {
  const broker = new Broker({ dir: mkdtempSync(path.join(tmpdir(), 'heatlot-proxy-')), privateKey: generateKeys().privateKey });
  const input = new PassThrough();
  const output = new PassThrough();
  const upstream = startProxy({ broker, command: process.execPath, args: [SERVER], input, output, stderr: 'ignore' });
  const waiting = new Map();
  createInterface({ input: output }).on('line', (line) => {
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
  let next = 1;
  const request = (method, params) => new Promise((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const close = () => { input.end(); upstream.kill(); };
  return { broker, request, close };
}

test('read-only tools pass through with a receipt', async () => {
  const { broker, request, close } = harness();
  try {
    await request('tools/list', {});
    const res = await request('tools/call', { name: 'lookup_order', arguments: { po: 'PO-1' } });
    assert.equal(res.result.structuredContent.ran, 'lookup_order');
    assert.equal(broker.ledger.read().at(-1).kind, 'read_performed');
  } finally { close(); }
});

test('an effect tool without authorization never reaches the server', async () => {
  const { broker, request, close } = harness();
  try {
    await request('tools/list', {});
    const res = await request('tools/call', { name: 'send_email', arguments: { to: 'a@example.com' } });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /no-authorization/);
    assert.equal(res.result.structuredContent, undefined);
    assert.equal(broker.ledger.read().at(-1).kind, 'effect_denied');
  } finally { close(); }
});

test('an unlisted tool is treated as an effect (fail closed)', async () => {
  const { request, close } = harness();
  try {
    const res = await request('tools/call', { name: 'lookup_order', arguments: {} });
    assert.equal(res.result.isError, true);
  } finally { close(); }
});

test('an authorized effect reaches the server once, without the authorization in _meta', async () => {
  const { broker, request, close } = harness();
  try {
    await request('tools/list', {});
    const args = { to: 'a@example.com' };
    const authorization = broker.approve('send_email', args, { by: 'alice' });
    const ok = await request('tools/call', { name: 'send_email', arguments: args, _meta: { [AUTH_META_KEY]: authorization } });
    assert.equal(ok.result.structuredContent.ran, 'send_email');
    assert.equal(ok.result.structuredContent.sawMeta, null);
    const replay = await request('tools/call', { name: 'send_email', arguments: args, _meta: { [AUTH_META_KEY]: authorization } });
    assert.match(replay.result.content[0].text, /already-used/);
    assert.ok(broker.ledger.read().some((r) => r.kind === 'effect_performed'));
    assert.equal(broker.verify().ok, true);
  } finally { close(); }
});
