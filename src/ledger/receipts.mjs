function payloadObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function defined(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

export function contextAssembled(value = {}) {
  const payload = payloadObject(value);
  return defined([
    ['blocks', payload.blocks ?? payload.block_count],
    ['used_tokens', payload.used_tokens],
    ['untrusted', payload.untrusted ?? payload.untrusted_sources],
    ['bundle_sha256', payload.bundle_sha256],
  ]);
}

export function decisionRequested(value = {}) {
  const payload = payloadObject(value);
  return defined([
    ['decision', payload.decision],
    ['prompt_chars', payload.prompt_chars],
  ]);
}

export function decisionReturned(value = {}) {
  const payload = payloadObject(value);
  return defined([
    ['status', payload.status],
    ['missing_records', payload.missing_records],
    ['items', payload.items],
    ['provenance', payload.provenance],
  ]);
}

export function verdictRecorded(value = {}) {
  const payload = payloadObject(value);
  return defined([
    ['rule', payload.rule],
    ['outcome', payload.outcome],
    ['missing_records', payload.missing_records],
    ['verdict_sha256', payload.verdict_sha256],
  ]);
}

export function tripwireFired(value = {}) {
  const payload = payloadObject(value);
  return defined([
    ['tripwire', payload.tripwire ?? payload.tripwire_id],
    ['source', payload.source],
    ['action', payload.action],
  ]);
}

export function decisionFailed(value = {}) {
  const payload = payloadObject(value);
  return defined([
    ['decision', payload.decision],
    ['error', payload.error],
    ['provenance', payload.provenance],
  ]);
}

export function authorizationConsumed(value = {}) {
  const payload = payloadObject(value);
  return defined([
    ['authorization_id', payload.authorization_id],
    ['effect_id', payload.effect_id],
    ['payload_sha256', payload.payload_sha256],
  ]);
}
