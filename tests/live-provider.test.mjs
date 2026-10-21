/**
 * The live Anthropic adapter, exercised against a stubbed transport.
 *
 * No network: globalThis.fetch is replaced for the duration of each test, and
 * the only way the SDK reaches it is through liveFetch. These tests pin the
 * request shape the current Sonnet requires (auto tool choice with strict: true,
 * effort instead of sampling knobs, opt-in fallbacks) and prove that every
 * outcome — a tool call, a refusal, a prose answer, an HTTP error — returns or
 * throws with provenance attached.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  completeWithProvenance,
  DEFAULT_ANTHROPIC_MODEL,
  LiveDecisionError,
} from '../src/providers/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INCOMPLETE = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'evals', 'expected', 'coc-report.incomplete.valid.json'), 'utf8'),
);

function messageBody(overrides = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: DEFAULT_ANTHROPIC_MODEL,
    stop_reason: 'tool_use',
    stop_details: null,
    content: [{ type: 'tool_use', id: 'toolu_test', name: 'coc-report', input: INCOMPLETE }],
    usage: { input_tokens: 2400, output_tokens: 310, cache_read_input_tokens: 0, iterations: null },
    ...overrides,
  };
}

async function withLiveTransport(respond, fn) {
  const saved = {
    fetch: globalThis.fetch,
    live: process.env.HEATLOT_LIVE,
    key: process.env.ANTHROPIC_API_KEY,
    model: process.env.HEATLOT_ANTHROPIC_MODEL,
    effort: process.env.HEATLOT_ANTHROPIC_EFFORT,
  };
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    const headers = new Headers(init?.headers);
    requests.push({ url: String(url), body, headers });
    const { status = 200, json } = respond(body);
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json', 'request-id': 'req_stubbed_0001' },
    });
  };
  process.env.HEATLOT_LIVE = '1';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';
  delete process.env.HEATLOT_ANTHROPIC_MODEL;
  delete process.env.HEATLOT_ANTHROPIC_EFFORT;
  try {
    await fn(requests);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [env, value] of [
      ['HEATLOT_LIVE', saved.live], ['ANTHROPIC_API_KEY', saved.key],
      ['HEATLOT_ANTHROPIC_MODEL', saved.model], ['HEATLOT_ANTHROPIC_EFFORT', saved.effort],
    ]) {
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
  }
}

const ask = () => completeWithProvenance({ decisionId: 'coc-report', prompt: 'records follow', provider: 'anthropic' });

test('live request uses auto tool choice with strict: true, effort, and opt-in fallbacks', async () => {
  await withLiveTransport(() => ({ json: messageBody() }), async (requests) => {
    await ask();
    assert.equal(requests.length, 1, 'exactly one request, no silent retries');
    const { url, body, headers } = requests[0];
    assert.match(url, /\/v1\/messages/);
    assert.equal(body.model, 'claude-sonnet-5-5');
    assert.deepEqual(body.tool_choice, { type: 'auto' }, 'forced tool_choice is a 400 on the current Sonnet');
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].strict, true);
    assert.equal(body.tools[0].input_schema.additionalProperties, false);
    assert.deepEqual(body.output_config, { effort: 'medium' });
    assert.equal(body.fallbacks, 'default');
    assert.match(headers.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
    for (const removed of ['temperature', 'top_p', 'top_k', 'thinking']) {
      assert.equal(Object.hasOwn(body, removed), false, `${removed} must not be sent`);
    }
    assert.equal(body.messages.at(-1).role, 'user', 'no assistant prefill');
  });
});

test('a tool call returns the validated value with full provenance', async () => {
  await withLiveTransport(() => ({ json: messageBody() }), async () => {
    const { value, provenance } = await ask();
    assert.equal(value.status, INCOMPLETE.status);
    assert.equal(provenance.provider, 'anthropic');
    assert.equal(provenance.model_requested, 'claude-sonnet-5-5');
    assert.equal(provenance.model_served, 'claude-sonnet-5-5');
    assert.equal(provenance.request_id, 'req_stubbed_0001');
    assert.equal(provenance.input_tokens, 2400);
    assert.equal(provenance.output_tokens, 310);
    assert.equal(provenance.stop_reason, 'tool_use');
    assert.equal(provenance.fallback_ran, false);
    assert.equal(Number.isInteger(provenance.latency_ms), true);
  });
});

test('a served fallback is recorded, not hidden', async () => {
  const body = messageBody({
    model: 'claude-sonnet-5',
    usage: { input_tokens: 10, output_tokens: 5, iterations: [{ type: 'message' }, { type: 'fallback_message' }] },
  });
  await withLiveTransport(() => ({ json: body }), async () => {
    const { provenance } = await ask();
    assert.equal(provenance.fallback_ran, true);
    assert.equal(provenance.model_served, 'claude-sonnet-5');
  });
});

test('a classifier refusal fails closed and carries provenance', async () => {
  const body = messageBody({
    stop_reason: 'refusal',
    stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
    content: [],
  });
  await withLiveTransport(() => ({ json: body }), async () => {
    await assert.rejects(ask(), (error) => {
      assert.ok(error instanceof LiveDecisionError);
      assert.match(error.message, /refusal, category general_harms/);
      assert.equal(error.provenance.stop_reason, 'refusal');
      assert.equal(error.provenance.request_id, 'req_stubbed_0001');
      return true;
    });
  });
});

test('a prose answer with no tool call fails closed', async () => {
  const body = messageBody({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'It is complete.' }] });
  await withLiveTransport(() => ({ json: body }), async () => {
    await assert.rejects(ask(), /no coc-report tool call \(stop_reason end_turn\)/);
  });
});

test('an HTTP error is not retried and carries provenance', async () => {
  const error = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };
  await withLiveTransport(() => ({ status: 529, json: error }), async (requests) => {
    await assert.rejects(ask(), (thrown) => {
      assert.ok(thrown instanceof LiveDecisionError);
      assert.match(thrown.message, /HTTP 529/);
      assert.equal(thrown.provenance.model_served, null);
      return true;
    });
    assert.equal(requests.length, 1);
  });
});

test('a schema-invalid tool input is rejected after the call and keeps its provenance', async () => {
  const body = messageBody({ content: [{ type: 'tool_use', id: 't', name: 'coc-report', input: { status: 'complete' } }] });
  await withLiveTransport(() => ({ json: body }), async () => {
    await assert.rejects(ask(), (error) => {
      assert.ok(error instanceof LiveDecisionError, `expected LiveDecisionError, got ${error.name}`);
      assert.match(error.message, /failed the coc-report schema/);
      assert.equal(error.provenance.request_id, 'req_stubbed_0001');
      assert.equal(error.provenance.model_served, 'claude-sonnet-5-5');
      assert.equal(error.provenance.input_tokens, 2400);
      assert.equal(error.provenance.stop_reason, 'tool_use');
      return true;
    });
  });
});

test('an unknown effort level is refused before any request', async () => {
  await withLiveTransport(() => ({ json: messageBody() }), async (requests) => {
    process.env.HEATLOT_ANTHROPIC_EFFORT = 'turbo';
    await assert.rejects(ask(), /HEATLOT_ANTHROPIC_EFFORT must be one of/);
    assert.equal(requests.length, 0);
  });
});

test('replay provenance names the fixture key it served', async () => {
  const prompt =
    'Assemble the cert-of-conformance package for PO-AER-5519 and tell me whether it is complete. ' +
    'If any required record is not on file, report it as missing — never fabricate one.';
  const { provenance } = await completeWithProvenance({ decisionId: 'coc-report', prompt, provider: 'replay' });
  assert.equal(provenance.provider, 'replay');
  assert.match(provenance.fixture_key, /^[0-9a-f]{64}$/);
});
