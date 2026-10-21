import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { append, verifyChain } from '../ledger/index.mjs';
import { consumeAuthorization, inspectAuthorization, mintAuthorization } from './authorization.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, 'policy', 'policy.json');

function loadPolicy() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
  if (!policy || typeof policy !== 'object' || !policy.effects || !policy.writeBoundary) {
    throw new Error('policy must define effects and writeBoundary');
  }
  if (!Array.isArray(policy.writeBoundary.guarded)) {
    throw new Error('policy writeBoundary.guarded must be an array');
  }
  return policy;
}

function safeRelativeTarget(target) {
  if (typeof target !== 'string' || target.trim() === '') return null;
  const normalized = target.trim().replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.includes('..') || parts.includes('')) return null;
  const absolute = path.resolve(REPO_ROOT, ...parts);
  if (!absolute.startsWith(`${REPO_ROOT}${path.sep}`)) return null;
  return { relative: path.posix.normalize(normalized), absolute };
}

function subjectOf(effect, authorization) {
  const candidate = authorization?.subject
    ?? authorization?.refusal?.verdict?.subject
    ?? effect?.payload?.subject
    ?? effect?.subject
    ?? 'unknown-effect';
  return typeof candidate === 'string' && /^[A-Za-z0-9._-]+$/.test(candidate)
    ? candidate
    : 'unknown-effect';
}

function deny(effect, authorization, details) {
  const subject = subjectOf(effect, authorization);
  const payload = {
    receipt_type: 'DenialReceipt',
    effect_id: effect?.id ?? null,
    rule: details.rule,
    verdict: details.verdict ?? authorization?.verdict ?? null,
    mismatch: details.mismatch,
  };
  let receipt;
  try {
    receipt = append('effect_denied', 'effect-broker', subject, payload);
  } catch (error) {
    receipt = {
      kind: 'effect_denied',
      actor: 'effect-broker',
      subject,
      payload: { ...payload, ledger_error: error.message },
    };
  }
  return { ok: false, denial: receipt };
}

export function perform(effect, authorization) {
  if (!effect || typeof effect.id !== 'string' || !effect.payload || typeof effect.payload !== 'object') {
    return deny(effect, authorization, {
      rule: 'effect-shape', verdict: authorization?.verdict ?? null,
      mismatch: { field: 'effect', expected: '{id,payload}', actual: effect ?? null },
    });
  }

  let policy;
  try {
    policy = loadPolicy();
  } catch (error) {
    return deny(effect, authorization, {
      rule: 'policy-valid', verdict: authorization?.verdict ?? null,
      mismatch: { field: 'policy', expected: 'valid policy/policy.json', actual: error.message },
    });
  }
  const effectPolicy = policy.effects[effect.id];
  if (!effectPolicy) {
    return deny(effect, authorization, {
      rule: 'known-effect', verdict: authorization?.verdict ?? null,
      mismatch: { field: 'effect.id', expected: Object.keys(policy.effects).sort(), actual: effect.id },
    });
  }

  const subject = subjectOf(effect, authorization);
  const chain = verifyChain(subject);
  if (!chain.ok) {
    return deny(effect, authorization, {
      rule: 'ledger-chain', verdict: authorization?.verdict ?? null,
      mismatch: { field: 'ledger.chain', expected: 'valid', actual: chain.reason ?? `broken at ${chain.brokenAt}` },
    });
  }

  const authorizationMismatch = inspectAuthorization(effect, authorization);
  if (authorizationMismatch) return deny(effect, authorization, authorizationMismatch);

  if (authorization.rule !== effectPolicy.requiresVerdict) {
    return deny(effect, authorization, {
      rule: effectPolicy.requiresVerdict, verdict: authorization.verdict,
      mismatch: { field: 'verdict.rule', expected: effectPolicy.requiresVerdict, actual: authorization.rule },
    });
  }
  if (authorization.outcome !== effectPolicy.requiresOutcome) {
    return deny(effect, authorization, {
      rule: effectPolicy.requiresVerdict, verdict: authorization.verdict,
      mismatch: { field: 'verdict.outcome', expected: effectPolicy.requiresOutcome, actual: authorization.outcome },
    });
  }

  const target = safeRelativeTarget(effect.payload.target);
  const guarded = target && policy.writeBoundary.guarded.find((entry) =>
    target.relative.startsWith(entry.path)
      && entry.requiresVerdict === authorization.rule
      && entry.requiresOutcome === authorization.outcome);
  if (!target || !guarded) {
    return deny(effect, authorization, {
      rule: 'write-boundary', verdict: authorization.verdict,
      mismatch: {
        field: 'payload.target',
        expected: policy.writeBoundary.guarded.map((entry) => entry.path),
        actual: effect.payload.target ?? null,
      },
    });
  }
  if (typeof effect.payload.content !== 'string') {
    return deny(effect, authorization, {
      rule: 'effect-payload', verdict: authorization.verdict,
      mismatch: { field: 'payload.content', expected: 'string', actual: typeof effect.payload.content },
    });
  }
  if (!consumeAuthorization(authorization)) {
    return deny(effect, authorization, {
      rule: 'single-use', verdict: authorization.verdict,
      mismatch: { field: 'authorization.used', expected: false, actual: true },
    });
  }

  try {
    mkdirSync(path.dirname(target.absolute), { recursive: true });
    writeFileSync(target.absolute, effect.payload.content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    return deny(effect, authorization, {
      rule: 'effect-write', verdict: authorization.verdict,
      mismatch: { field: 'payload.target', expected: 'new writable target', actual: error.code ?? error.message },
    });
  }

  const receipt = append('effect_performed', 'effect-broker', authorization.subject, {
    effect_id: effect.id,
    authorization_id: authorization.authorization_id,
    payload_sha256: authorization.payload_sha256,
    target: target.relative,
  });
  return { ok: true, receipt };
}

/**
 * Mint from a verdict, then attempt the effect with whatever the mint returned.
 * A refused mint is handed to the broker as the refusal itself, so the denial
 * receipt names the rule that refused (untrusted-context, say) rather than a
 * generic "no authorization supplied" that reads like a caller's mistake.
 */
export function mintAndPerform(effect, verdict) {
  const minted = mintAuthorization({ id: effect.id, payload: effect.payload }, verdict);
  const result = perform(effect, minted.ok ? minted.authorization : minted);
  return { minted, result };
}

export const broker = Object.freeze({ perform, mintAndPerform });
