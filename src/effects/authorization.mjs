import { createHash } from 'node:crypto';
import { append, readChain } from '../ledger/index.mjs';
import { verifyCompleteness } from '../../scripts/verify-completeness.mjs';

// Single use is a fact on the subject's ledger, not a flag in process memory.
// An in-memory set forgets on restart, so a captured authorization could be
// replayed against a fresh process; a consumed receipt in the hash chain cannot
// be forgotten without breaking the chain the broker verifies first.
function consumedOnLedger(subject, authorizationId) {
  return readChain(subject).some((receipt) => receipt.kind === 'authorization_consumed'
    && receipt.payload?.authorization_id === authorizationId);
}

// An authorization is honoured only if the ledger shows it being minted: the
// receipt at mint_seq must be the authorization_minted record for this id. A
// self-consistent object assembled outside mintAuthorization has no such receipt.
function mintedOnLedger(subject, authorization) {
  if (!Number.isInteger(authorization.mint_seq) || authorization.mint_seq < 1) return false;
  const receipt = readChain(subject)[authorization.mint_seq - 1];
  return receipt?.kind === 'authorization_minted'
    && receipt.payload?.authorization_id === authorization.authorization_id;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex');
}

function verdictBody(verifier, contextBlocks) {
  const inputHashes = verifier.items.map((item) => ({
    source: item.expected_path,
    sha256: sha256({
      type: item.type,
      expected_path: item.expected_path,
      on_file: item.on_file,
      sha256: item.sha256,
      integrity: item.integrity,
    }),
  }));
  const normalizedContext = contextBlocks.map((block) => ({
    source: block.source,
    sha256: block.sha256,
    trust: block.trust,
  }));
  return {
    type: 'VerdictRecord',
    rule: 'coc-completeness',
    subject: verifier.po,
    outcome: verifier.status.toUpperCase(),
    missing_records: [...verifier.missing_records],
    checked_at: verifier.checked_at,
    input_hashes: inputHashes,
    context_blocks: normalizedContext,
  };
}

function verdictSummary(verdict) {
  return {
    rule: verdict.rule,
    subject: verdict.subject,
    outcome: verdict.outcome,
    missing_records: [...verdict.missing_records],
    checked_at: verdict.checked_at,
  };
}

function contextBlockError(contextBlocks) {
  for (const block of contextBlocks) {
    if (!block || typeof block.source !== 'string' || !/^[0-9a-f]{64}$/.test(block.sha256)) {
      return 'each context block must name source and sha256';
    }
    if (block.trust !== 'trusted' && block.trust !== 'untrusted') {
      return 'each context block trust must be "trusted" or "untrusted"';
    }
  }
  return null;
}

function verdictShapeError(verdict) {
  for (const field of ['rule', 'subject', 'outcome', 'checked_at']) {
    if (typeof verdict[field] !== 'string' || verdict[field] === '') return `${field} must be a non-empty string`;
  }
  if (!['COMPLETE', 'INCOMPLETE'].includes(verdict.outcome)) return 'outcome must be COMPLETE or INCOMPLETE';
  if (!Array.isArray(verdict.missing_records)) return 'missing_records must be an array';
  if (!verdict.missing_records.every((record) => typeof record === 'string' && record !== '')) {
    return 'missing_records must contain non-empty strings';
  }
  if (!Array.isArray(verdict.input_hashes)) return 'input_hashes must be an array';
  for (const input of verdict.input_hashes) {
    if (!input || typeof input.source !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256)) {
      return 'each input hash must name source and sha256';
    }
  }
  if (!Array.isArray(verdict.context_blocks)) return 'context_blocks must be an array';
  const invalidContext = contextBlockError(verdict.context_blocks);
  if (invalidContext) return invalidContext;
  if (!/^[0-9a-f]{64}$/.test(verdict.verdict_sha256 ?? '')) return 'verdict_sha256 must be sha256';
  return null;
}

export function createVerdictRecord(subject, { contextBlocks = [] } = {}) {
  const verifier = verifyCompleteness(subject);
  if (verifier === null) throw new Error(`cannot create verdict: unknown subject "${subject}"`);
  if (!Array.isArray(contextBlocks)) throw new TypeError('contextBlocks must be an array');
  const invalidContext = contextBlockError(contextBlocks);
  if (invalidContext) throw new TypeError(invalidContext);

  const body = verdictBody(verifier, contextBlocks);
  return Object.freeze({ ...body, verdict_sha256: sha256(body) });
}

function refusal(rule, verdict, field, expected, actual) {
  return Object.freeze({
    ok: false,
    refusal: {
      rule,
      verdict,
      mismatch: { field, expected, actual },
    },
  });
}

export function mintAuthorization(effect, verdict) {
  if (!effect || typeof effect.id !== 'string' || !effect.payload || typeof effect.payload !== 'object') {
    throw new TypeError('effect must contain id and payload');
  }
  if (!verdict || verdict.type !== 'VerdictRecord') {
    return refusal('verdict-required', verdict ?? null, 'verdict.type', 'VerdictRecord', verdict?.type ?? null);
  }
  const invalidVerdict = verdictShapeError(verdict);
  if (invalidVerdict) {
    return refusal('verdict-shape', verdict, 'verdict', 'complete VerdictRecord', invalidVerdict);
  }
  const { verdict_sha256: suppliedVerdictHash, ...verdictWithoutHash } = verdict;
  const actualVerdictHash = sha256(verdictWithoutHash);
  if (suppliedVerdictHash !== actualVerdictHash) {
    return refusal('verdict-integrity', verdict, 'verdict_sha256', actualVerdictHash, suppliedVerdictHash ?? null);
  }
  const untrusted = verdict.context_blocks.find((block) => block.trust === 'untrusted');
  if (untrusted) {
    return refusal('untrusted-context', verdict, `context_blocks.${untrusted.source}.trust`, 'trusted', 'untrusted');
  }

  // mint_seq is the ledger position the mint receipt will occupy. It makes every
  // mint distinct (two mints over identical inputs are two authorizations, each
  // usable once) while staying deterministic: it is a logical counter, not a clock.
  const mintSeq = readChain(verdict.subject).length + 1;
  const body = {
    type: 'EffectAuthorization',
    mint_seq: mintSeq,
    effect_id: effect.id,
    subject: verdict.subject,
    rule: verdict.rule,
    outcome: verdict.outcome,
    payload_sha256: sha256(effect.payload),
    verdict_sha256: verdict.verdict_sha256,
    verdict_input_hashes: structuredClone(verdict.input_hashes),
    context_blocks: structuredClone(verdict.context_blocks),
    verdict: verdictSummary(verdict),
  };
  const authorization = Object.freeze({ ...body, authorization_id: sha256(body) });
  const receipt = append('authorization_minted', 'effect-authorization', verdict.subject, {
    authorization_id: authorization.authorization_id,
    effect_id: effect.id,
    payload_sha256: authorization.payload_sha256,
    verdict_sha256: authorization.verdict_sha256,
    verdict_input_hashes: authorization.verdict_input_hashes,
    rule: authorization.rule,
    outcome: authorization.outcome,
  });
  if (receipt.seq !== mintSeq) {
    throw new Error(`authorization mint raced the ledger: expected seq ${mintSeq}, wrote ${receipt.seq}`);
  }
  return Object.freeze({ ok: true, authorization });
}

export function inspectAuthorization(effect, candidate) {
  if (candidate?.ok === false && candidate.refusal) return candidate.refusal;
  if (!candidate || candidate.type !== 'EffectAuthorization') {
    return {
      rule: 'authorization-required',
      verdict: candidate?.verdict ?? null,
      mismatch: { field: 'authorization.type', expected: 'EffectAuthorization', actual: candidate?.type ?? null },
    };
  }
  if (!Array.isArray(candidate.verdict_input_hashes) || !Array.isArray(candidate.context_blocks)) {
    return {
      rule: 'authorization-shape', verdict: candidate.verdict ?? null,
      mismatch: {
        field: 'authorization.bindings',
        expected: 'verdict_input_hashes and context_blocks arrays',
        actual: 'missing or malformed',
      },
    };
  }
  const invalidContext = contextBlockError(candidate.context_blocks);
  if (invalidContext) {
    return {
      rule: 'authorization-shape', verdict: candidate.verdict ?? null,
      mismatch: {
        field: 'authorization.context_blocks',
        expected: 'blocks with source, sha256, and trust',
        actual: invalidContext,
      },
    };
  }
  const verifier = verifyCompleteness(candidate.subject);
  if (verifier === null) {
    return {
      rule: 'authorization-shape', verdict: candidate.verdict ?? null,
      mismatch: {
        field: 'authorization.subject',
        expected: 'known subject',
        actual: candidate.subject ?? null,
      },
    };
  }
  if (candidate.effect_id !== effect.id) {
    return {
      rule: 'effect-binding', verdict: candidate.verdict,
      mismatch: { field: 'effect_id', expected: effect.id, actual: candidate.effect_id },
    };
  }
  const actualPayloadHash = sha256(effect.payload);
  if (candidate.payload_sha256 !== actualPayloadHash) {
    return {
      rule: 'payload-binding', verdict: candidate.verdict,
      mismatch: { field: 'payload_sha256', expected: candidate.payload_sha256, actual: actualPayloadHash },
    };
  }
  const currentVerdict = verdictBody(verifier, candidate.context_blocks);
  if (canonicalJson(candidate.verdict_input_hashes) !== canonicalJson(currentVerdict.input_hashes)) {
    return {
      rule: 'verdict-input-binding', verdict: candidate.verdict,
      mismatch: { field: 'verdict_input_hashes', expected: currentVerdict.input_hashes, actual: candidate.verdict_input_hashes },
    };
  }
  if (candidate.outcome !== currentVerdict.outcome) {
    return {
      rule: 'verdict-outcome-binding', verdict: candidate.verdict,
      mismatch: { field: 'outcome', expected: currentVerdict.outcome, actual: candidate.outcome ?? null },
    };
  }
  const currentVerdictHash = sha256(currentVerdict);
  if (candidate.verdict_sha256 !== currentVerdictHash) {
    return {
      rule: 'verdict-outcome-binding', verdict: candidate.verdict,
      mismatch: { field: 'verdict_sha256', expected: currentVerdictHash, actual: candidate.verdict_sha256 ?? null },
    };
  }
  const currentSummary = verdictSummary(currentVerdict);
  if (canonicalJson(candidate.verdict) !== canonicalJson(currentSummary)) {
    return {
      rule: 'verdict-outcome-binding', verdict: candidate.verdict,
      mismatch: { field: 'verdict', expected: currentSummary, actual: candidate.verdict ?? null },
    };
  }
  const untrusted = candidate.context_blocks.find((block) => block.trust === 'untrusted');
  if (untrusted) {
    return {
      rule: 'untrusted-context', verdict: candidate.verdict,
      mismatch: { field: `context_blocks.${untrusted.source}.trust`, expected: 'trusted', actual: 'untrusted' },
    };
  }
  const { authorization_id: suppliedId, ...body } = candidate;
  const actualId = sha256(body);
  if (suppliedId !== actualId) {
    return {
      rule: 'authorization-integrity', verdict: candidate.verdict,
      mismatch: { field: 'authorization_id', expected: actualId, actual: suppliedId ?? null },
    };
  }
  if (!mintedOnLedger(candidate.subject, candidate)) {
    return {
      rule: 'ledger-mint', verdict: candidate.verdict,
      mismatch: { field: 'authorization.mint_seq', expected: 'authorization_minted receipt for this id', actual: candidate.mint_seq ?? null },
    };
  }
  if (consumedOnLedger(candidate.subject, candidate.authorization_id)) {
    return {
      rule: 'single-use', verdict: candidate.verdict,
      mismatch: { field: 'authorization.used', expected: false, actual: true },
    };
  }
  return null;
}

/**
 * Mark an authorization used by appending an authorization_consumed receipt.
 * Returns false if the ledger already holds one. Called by the broker after
 * every other check and before the write, so a write that then fails leaves the
 * authorization spent: failing closed, never re-usable.
 */
export function consumeAuthorization(authorization) {
  if (consumedOnLedger(authorization.subject, authorization.authorization_id)) return false;
  append('authorization_consumed', 'effect-broker', authorization.subject, {
    authorization_id: authorization.authorization_id,
    effect_id: authorization.effect_id,
    payload_sha256: authorization.payload_sha256,
  });
  return true;
}
