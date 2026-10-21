/**
 * Provider surface: one schema, two vendor adapters, bounded repair, replay.
 *
 * Covers: adapters derive from one schema and disagree only where documented;
 * OpenAI transform is compliant for every registered decision; repair stops
 * at two retries; missing fixture errors clearly; replay is byte-identical;
 * no code path reaches the network when HEATLOT_LIVE is unset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDecision, listDecisions } from '../src/decisions/registry.mjs';
import { toStrictTool, transformForAnthropic, ANTHROPIC_GRAMMAR } from '../src/providers/anthropic.mjs';
import { toStructuredOutput, transformForOpenAI, isOpenAICompliant, OPENAI_STRUCTURED } from '../src/providers/openai.mjs';
import { repair, RepairClosedError, MAX_RETRIES, compile } from '../src/providers/repair.mjs';
import { complete as replayComplete, keyFor, MissingFixtureError, lookupFixture } from '../src/providers/replay.mjs';
import { complete, selectProvider, liveFetch } from '../src/providers/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loadFixture = (name) => JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures', 'provider', name), 'utf8'));

const mer = loadFixture('coc-report-po-mer-5532.json');
const hero = loadFixture('coc-report-po-aer-5519-hero.json');
const ncr = loadFixture('ncr-triage-ncr-2026-0114.json');
const violating = loadFixture('ncr-triage-schema-violating.json');

function jsonHas(node, keyword) {
  if (Array.isArray(node)) return node.some((item) => jsonHas(item, keyword));
  if (!node || typeof node !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(node, keyword)) return true;
  return Object.values(node).some((value) => jsonHas(value, keyword));
}

function withLiveUnset(fn) {
  const priorLive = process.env.HEATLOT_LIVE;
  const priorProvider = process.env.HEATLOT_PROVIDER;
  delete process.env.HEATLOT_LIVE;
  delete process.env.HEATLOT_PROVIDER;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (priorLive === undefined) delete process.env.HEATLOT_LIVE;
      else process.env.HEATLOT_LIVE = priorLive;
      if (priorProvider === undefined) delete process.env.HEATLOT_PROVIDER;
      else process.env.HEATLOT_PROVIDER = priorProvider;
    });
}

test('both adapters derive from one schema and set the strict flag', () => {
  const schema = getDecision('coc-report').schema;
  const tool = toStrictTool(schema, { name: 'coc-report' });
  const format = toStructuredOutput(schema, { name: 'coc-report' });
  assert.equal(tool.strict, true);
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.type, 'json_schema');
  assert.equal(tool.input_schema.type, 'object');
  assert.equal(format.json_schema.schema.type, 'object');
  assert.equal(tool.input_schema.additionalProperties, false);
  assert.equal(format.json_schema.schema.additionalProperties, false);
});

test('adapters disagree only where the vendor subsets are documented', () => {
  for (const decision of listDecisions()) {
    const canonical = decision.schema;
    const anthropic = transformForAnthropic(canonical).schema;
    const openai = transformForOpenAI(canonical).schema;

    // Neither grammar accepts if/then. The completeness invariant stays on Ajv.
    assert.equal(jsonHas(anthropic, 'if'), false, `${decision.id} anthropic still has if`);
    assert.equal(jsonHas(openai, 'if'), false, `${decision.id} openai still has if`);
    assert.equal(jsonHas(openai, 'then'), false);
    assert.equal(jsonHas(openai, 'else'), false);
    assert.equal(jsonHas(openai, 'allOf'), false, `${decision.id} openai still has allOf`);
    assert.equal(jsonHas(openai, 'const'), false, `${decision.id} openai still has const`);

    // OpenAI requires every property; Anthropic does not rewrite optionals.
    if (openai.properties) {
      assert.deepEqual([...openai.required].sort(), Object.keys(openai.properties).sort());
    }

    // const -> enum is the documented OpenAI rewrite. Anthropic keeps const.
    if (jsonHas(canonical, 'const')) {
      assert.equal(jsonHas(anthropic, 'const'), true, `${decision.id} anthropic dropped const`);
      assert.equal(jsonHas(openai, 'enum'), true);
    }

    // numeric bounds: OpenAI keeps, Anthropic strips.
    if (jsonHas(canonical, 'minimum')) {
      assert.equal(jsonHas(anthropic, 'minimum'), false, `${decision.id} anthropic kept minimum`);
      assert.equal(jsonHas(openai, 'minimum'), true, `${decision.id} openai dropped minimum`);
    }

    assert.equal(ANTHROPIC_GRAMMAR.notEnforced.includes('if'), true);
    assert.equal(OPENAI_STRUCTURED.notSupported.includes('allOf'), true);
  }
});

test('OpenAI transform produces a compliant variant for every registered decision', () => {
  for (const decision of listDecisions()) {
    const { schema } = transformForOpenAI(decision.schema);
    const { ok, issues } = isOpenAICompliant(schema);
    assert.equal(ok, true, `${decision.id}: ${issues.join('; ')}`);
  }
});

test('repair loop stops at two retries — a fourth generate never happens', async () => {
  const schema = getDecision('ncr-triage').schema;
  let calls = 0;
  const invalid = violating.response;
  await assert.rejects(
    () => repair(async () => {
      calls += 1;
      assert.ok(calls <= 1 + MAX_RETRIES, 'a fourth generate must never happen');
      return invalid;
    }, schema),
    (err) => {
      assert.equal(err instanceof RepairClosedError, true);
      assert.equal(err.attempts.length, 1 + MAX_RETRIES);
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.equal(MAX_RETRIES, 2);
});

test('repair accepts a valid body on the first attempt and does not retry', async () => {
  const schema = getDecision('ncr-triage').schema;
  let calls = 0;
  const value = await repair(async () => {
    calls += 1;
    return ncr.response;
  }, schema);
  assert.equal(calls, 1);
  assert.equal(value.cause_code, 'P02');
});

test('missing fixture errors with the key and how to record it', () => {
  const prompt = 'this prompt has no recorded pair';
  const lookup = keyFor({ decisionId: 'coc-report', prompt, providerName: 'replay' });
  assert.throws(
    () => replayComplete({ decisionId: 'coc-report', prompt }),
    (err) => {
      assert.equal(err instanceof MissingFixtureError, true);
      assert.match(err.message, new RegExp(`missing replay fixture for key ${lookup.key}`));
      assert.match(err.message, /decisionId=coc-report/);
      assert.match(err.message, /providerName=replay/);
      assert.match(err.message, new RegExp(`fixtures/provider/${lookup.key}\\.json`));
      assert.match(err.message, /Never fall through to a live provider/);
      return true;
    },
  );
});

test('replay is byte-identical across two runs', async () => {
  await withLiveUnset(async () => {
    const first = await complete({ decisionId: mer.decisionId, prompt: mer.prompt });
    const second = await complete({ decisionId: mer.decisionId, prompt: mer.prompt });
    const a = JSON.stringify(first);
    const b = JSON.stringify(second);
    assert.equal(a, b);
    assert.equal(first.po, 'PO-MER-5532');
    assert.equal(first.status, 'complete');
  });
});

test('no code path reaches the network when HEATLOT_LIVE is unset', async () => {
  await withLiveUnset(async () => {
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetches += 1;
      throw new Error(`unexpected fetch ${args[0]}`);
    };
    try {
      await complete({ decisionId: mer.decisionId, prompt: mer.prompt });
      await complete({ decisionId: ncr.decisionId, prompt: ncr.prompt });
      assert.equal(selectProvider().name, 'replay');
      assert.throws(() => selectProvider('openai'), /live-only/);
      assert.throws(() => selectProvider('anthropic'), /live-only/);
      assert.throws(() => liveFetch('https://example.invalid'), /HEATLOT_LIVE is unset/);
      assert.equal(fetches, 0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

test('schema-violating replay fails closed through repair and never returns the partial object', async () => {
  await withLiveUnset(async () => {
    await assert.rejects(
      () => complete({ decisionId: violating.decisionId, prompt: violating.prompt }),
      (err) => {
        assert.equal(err instanceof RepairClosedError, true);
        assert.equal(err.attempts.length, 3);
        assert.match(err.message, /cause_code|pattern|X99/);
        return true;
      },
    );
  });
});

test('hero AER-5519 COMPLETE claim is schema-valid and factually incomplete', () => {
  const schema = getDecision('coc-report').schema;
  const validate = compile(schema);
  assert.equal(validate(hero.response), true, JSON.stringify(validate.errors));
  assert.equal(hero.response.status, 'complete');
  const mechanical = hero.response.items.find((item) => item.type === 'mechanical-test');
  assert.equal(mechanical.on_file, true);
  assert.equal(mechanical.sha256, 'f'.repeat(64));

  const res = spawnSync(process.execPath, ['scripts/verify-completeness.mjs', 'PO-AER-5519', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 3);
  const verdict = JSON.parse(res.stdout);
  assert.equal(verdict.status, 'incomplete');
  assert.deepEqual(verdict.missing_records, ['mechanical-test']);
});

test('hero replay returns the fabricated complete draft unchanged', async () => {
  await withLiveUnset(async () => {
    const draft = await complete({ decisionId: hero.decisionId, prompt: hero.prompt });
    assert.equal(draft.status, 'complete');
    assert.equal(draft.po, 'PO-AER-5519');
    assert.deepEqual(draft.missing_records, []);
    const recorded = lookupFixture({ decisionId: hero.decisionId, prompt: hero.prompt });
    assert.equal(JSON.stringify(draft), JSON.stringify(recorded.response));
  });
});
