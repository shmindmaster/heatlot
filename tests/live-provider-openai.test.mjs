/**
 * The live OpenAI adapter, exercised against a stubbed transport.
 *
 * No network: globalThis.fetch is replaced per test and reached only through
 * liveFetch. Pins the request shape (strict json_schema, fixed endpoint, no
 * sampling knobs) and proves every outcome returns or throws with provenance.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { completeWithProvenance, DEFAULT_OPENAI_MODEL, LiveDecisionError } from '../src/providers/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INCOMPLETE = JSON.parse(readFileSync(path.join(REPO_ROOT, 'evals', 'expected', 'coc-report.incomplete.valid.json'), 'utf8'));

const completion = (overrides = {}) => ({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  model: DEFAULT_OPENAI_MODEL,
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(INCOMPLETE), refusal: null } }],
  usage: { prompt_tokens: 2100, completion_tokens: 480 },
  ...overrides,
});

async function withTransport(respond, fn) {
  const saved = { fetch: globalThis.fetch, live: process.env.HEATLOT_LIVE, key: process.env.OPENAI_API_KEY, model: process.env.HEATLOT_OPENAI_MODEL, base: process.env.OPENAI_BASE_URL };
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, headers: new Headers(init?.headers) });
    const { status = 200, json } = respond();
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_openai_stub_01' } });
  };
  process.env.HEATLOT_LIVE = '1';
  process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1/v1';
  delete process.env.HEATLOT_OPENAI_MODEL;
  try {
    await fn(requests);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [k, v] of [['HEATLOT_LIVE', saved.live], ['OPENAI_API_KEY', saved.key], ['HEATLOT_OPENAI_MODEL', saved.model], ['OPENAI_BASE_URL', saved.base]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const ask = () => completeWithProvenance({ decisionId: 'coc-report', prompt: 'records follow', provider: 'openai' });

test('openai request is strict json_schema to the fixed endpoint, whatever OPENAI_BASE_URL says', async () => {
  await withTransport(() => ({ json: completion() }), async (requests) => {
    await ask();
    assert.equal(requests.length, 1, 'exactly one request, no silent retries');
    const { url, body } = requests[0];
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(body.model, DEFAULT_OPENAI_MODEL);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    for (const removed of ['temperature', 'top_p', 'tools', 'tool_choice']) assert.equal(Object.hasOwn(body, removed), false, `${removed} must not be sent`);
  });
});

test('a completion returns the validated value with full provenance', async () => {
  await withTransport(() => ({ json: completion() }), async () => {
    const { value, provenance } = await ask();
    assert.equal(value.status, INCOMPLETE.status);
    assert.deepEqual(
      { provider: provenance.provider, served: provenance.model_served, rid: provenance.request_id, in: provenance.input_tokens, out: provenance.output_tokens, stop: provenance.stop_reason },
      { provider: 'openai', served: DEFAULT_OPENAI_MODEL, rid: 'req_openai_stub_01', in: 2100, out: 480, stop: 'stop' },
    );
    assert.equal(Number.isInteger(provenance.latency_ms), true);
  });
});

test('a structured-outputs refusal fails closed with provenance', async () => {
  const json = completion({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null, refusal: 'I cannot help with that.' } }] });
  await withTransport(() => ({ json }), async () => {
    await assert.rejects(ask(), (e) => e instanceof LiveDecisionError && /declined/.test(e.message) && e.provenance.request_id === 'req_openai_stub_01');
  });
});

test('an HTTP error carries provenance and the provider message', async () => {
  await withTransport(() => ({ status: 400, json: { error: { message: 'Invalid schema for response_format' } } }), async (requests) => {
    await assert.rejects(ask(), (e) => e instanceof LiveDecisionError && /HTTP 400\): Invalid schema/.test(e.message) && e.provenance.request_id === 'req_openai_stub_01');
    assert.equal(requests.length, 1);
  });
});

test('truncated or non-JSON content fails closed with provenance', async () => {
  const json = completion({ choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '{"status":"inc', refusal: null } }] });
  await withTransport(() => ({ json }), async () => {
    await assert.rejects(ask(), (e) => e instanceof LiveDecisionError && /not JSON/.test(e.message) && e.provenance.stop_reason === 'length');
  });
});

test('schema-invalid content is rejected and keeps provenance', async () => {
  const json = completion({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"status":"complete"}', refusal: null } }] });
  await withTransport(() => ({ json }), async () => {
    await assert.rejects(ask(), (e) => e instanceof LiveDecisionError && /failed the coc-report schema/.test(e.message) && e.provenance.provider === 'openai');
  });
});
