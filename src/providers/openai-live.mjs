/**
 * Live OpenAI adapter: structured outputs (json_schema, strict) with provenance.
 *
 * Reached only through selectProvider('openai') with HEATLOT_LIVE=1, and only
 * through liveFetch, so the one gated network function stays the only way out.
 * The endpoint is fixed to api.openai.com: an inherited OPENAI_BASE_URL (for a
 * local gateway, say) must not silently redirect a verification run.
 *
 * Mirrors the Anthropic adapter's contract. Every call returns provenance:
 * requested and served model, request id, token usage, latency, finish reason.
 * Every failure (HTTP error, refusal, empty or unparseable content) throws a
 * LiveDecisionError carrying the same provenance, so the decision_failed
 * receipt can say exactly what happened. There are no retries.
 */
import { LiveDecisionError } from './anthropic-live.mjs';
import { toStructuredOutput } from './openai.mjs';

export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * @param {{ decision: object, prompt: string, fetch: Function, now?: () => number }} args
 * @returns {Promise<{ value: object, provenance: object }>}
 */
export async function completeOpenAILive({ decision, prompt, fetch, now = () => performance.now() }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('HEATLOT_LIVE=1 requires OPENAI_API_KEY for provider openai');
  const model = process.env.HEATLOT_OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const format = toStructuredOutput(decision.schema, { name: decision.id });
  const provenance = {
    provider: 'openai',
    model_requested: model,
    model_served: null,
    request_id: null,
    response_format: 'json_schema',
    strict: format.json_schema.strict === true,
    stop_reason: null,
    input_tokens: null,
    output_tokens: null,
    latency_ms: null,
  };

  const started = now();
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: {
          type: format.type,
          json_schema: {
            name: format.json_schema.name,
            description: format.json_schema.description,
            strict: format.json_schema.strict,
            schema: format.json_schema.schema,
          },
        },
      }),
    });
  } catch (error) {
    provenance.latency_ms = Math.round(now() - started);
    throw new LiveDecisionError(`openai live call failed (transport error): ${error.message}`, provenance);
  }
  provenance.latency_ms = Math.round(now() - started);
  provenance.request_id = res.headers?.get?.('x-request-id') ?? null;
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message ?? ''; } catch { /* body is not JSON */ }
    throw new LiveDecisionError(`openai live call failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`, provenance);
  }
  const body = await res.json();
  const choice = body.choices?.[0];
  provenance.model_served = body.model ?? null;
  provenance.stop_reason = choice?.finish_reason ?? null;
  provenance.input_tokens = body.usage?.prompt_tokens ?? null;
  provenance.output_tokens = body.usage?.completion_tokens ?? null;

  if (choice?.message?.refusal) {
    throw new LiveDecisionError(`model declined the request: ${choice.message.refusal}`, provenance);
  }
  const text = choice?.message?.content;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new LiveDecisionError(`openai live response contained no content (finish_reason ${provenance.stop_reason ?? 'unknown'})`, provenance);
  }
  try {
    return { value: JSON.parse(text), provenance };
  } catch (error) {
    throw new LiveDecisionError(`openai live content was not JSON: ${error.message}`, provenance);
  }
}
