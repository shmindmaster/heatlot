/**
 * Live Anthropic adapter — strict tool use on the current Sonnet, with provenance.
 *
 * Reached only through selectProvider('anthropic') with HEATLOT_LIVE=1. The SDK's
 * transport is routed through liveFetch, so the one gated network function stays
 * the only way out of the process: with HEATLOT_LIVE unset the SDK cannot connect
 * even if something constructs it.
 *
 * Current-model rules this adapter follows (Claude Sonnet 5.5):
 *   - forced tool_choice ("tool" / "any") is rejected with HTTP 400, so the tool
 *     is offered with tool_choice "auto" and strict: true, and the prompt names it.
 *     Strict mode still makes an out-of-schema argument unrepresentable.
 *   - no temperature, no budget_tokens, no assistant prefill. Depth is controlled
 *     with output_config.effort.
 *   - a classifier decline is HTTP 200 with stop_reason "refusal"; it is checked
 *     before content is read. Server-side fallbacks are opted into, and whether a
 *     fallback model served the turn is recorded rather than hidden.
 *
 * Every call returns provenance — requested and served model, request id, token
 * usage, latency, stop reason — and a failure carries the same provenance, so a
 * receipt can say exactly what happened even when nothing usable came back.
 */
import { toStrictTool } from './anthropic.mjs';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_ANTHROPIC_EFFORT = 'medium';
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class LiveDecisionError extends Error {
  constructor(message, provenance) {
    super(message);
    this.name = 'LiveDecisionError';
    this.provenance = provenance;
  }
}

export function liveSystemPrompt(toolName) {
  return [
    'You are drafting a typed decision for a quality-release workflow.',
    `Answer by calling the \`${toolName}\` tool exactly once. Do not answer in prose.`,
    'Report only what the supplied records support. A record that is not supplied is missing.',
  ].join('\n');
}

function effortFromEnv() {
  const effort = process.env.HEATLOT_ANTHROPIC_EFFORT ?? DEFAULT_ANTHROPIC_EFFORT;
  if (!EFFORTS.has(effort)) {
    throw new Error(`HEATLOT_ANTHROPIC_EFFORT must be one of ${[...EFFORTS].join(', ')}; got "${effort}"`);
  }
  return effort;
}

function usageOf(message) {
  const usage = message?.usage ?? {};
  const iterations = Array.isArray(usage.iterations) ? usage.iterations : [];
  return {
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
    fallback_ran: iterations.some((entry) => entry?.type === 'fallback_message'),
  };
}

/**
 * @param {{ decision: object, prompt: string, fetch: Function, now?: () => number }} args
 * @returns {Promise<{ value: object, provenance: object }>}
 */
export async function completeAnthropicLive({ decision, prompt, fetch, now = () => performance.now() }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const model = process.env.HEATLOT_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const effort = effortFromEnv();
  const tool = toStrictTool(decision.schema, { name: decision.id });
  const provenance = {
    provider: 'anthropic',
    model_requested: model,
    model_served: null,
    request_id: null,
    effort,
    tool: tool.name,
    tool_choice: 'auto',
    strict: true,
    stop_reason: null,
    input_tokens: null,
    output_tokens: null,
    cache_read_input_tokens: null,
    fallback_ran: false,
    latency_ms: null,
  };

  // maxRetries 0: a retry is a decision the caller records, not one the client
  // makes silently. The SDK resolves credentials itself (API key or profile).
  const client = new Anthropic({ fetch, maxRetries: 0 });
  const started = now();
  let data;
  let requestId;
  try {
    ({ data, request_id: requestId } = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort },
      system: liveSystemPrompt(tool.name),
      tools: [{ name: tool.name, description: tool.description, strict: true, input_schema: tool.input_schema }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: prompt }],
    }).withResponse());
  } catch (error) {
    provenance.latency_ms = Math.round(now() - started);
    provenance.request_id = error?.requestID ?? null;
    const status = error?.status ? `HTTP ${error.status}` : 'transport error';
    throw new LiveDecisionError(`anthropic live call failed (${status}): ${error.message}`, provenance);
  }
  provenance.latency_ms = Math.round(now() - started);
  provenance.request_id = requestId ?? null;
  provenance.model_served = data.model ?? null;
  provenance.stop_reason = data.stop_reason ?? null;
  Object.assign(provenance, usageOf(data));

  if (data.stop_reason === 'refusal') {
    const category = data.stop_details?.category ?? 'unspecified';
    throw new LiveDecisionError(`model declined the request (stop_reason refusal, category ${category})`, provenance);
  }
  const block = (data.content ?? []).find((b) => b.type === 'tool_use' && b.name === tool.name);
  if (!block) {
    throw new LiveDecisionError(
      `model returned no ${tool.name} tool call (stop_reason ${data.stop_reason ?? 'unknown'})`,
      provenance,
    );
  }
  return { value: block.input, provenance };
}
