/**
 * The broker: the only path from an agent's request to a real effect.
 *
 *   const broker = new Broker({ dir: '.heatlot', privateKey });
 *   const sendEmail = broker.guard('send_email', realSendEmail);
 *   await sendEmail(payload, { authorization });   // refused unless authorized for exactly this payload
 *
 * An authorization is minted by `approve()` (a human, or deterministic code you trust), is bound to
 * the tool and to the sha256 of the exact payload, is single-use, and is never minted if any input
 * that fed the decision was labelled untrusted. Mint, consumption, refusal and outcome are all
 * signed receipts on the ledger, so single use survives a restart and a forged token has no mint.
 */
import { randomUUID } from 'node:crypto';
import { Ledger, hashOf, sha256, verifyChain } from './receipts.mjs';

export class HeatlotRefusal extends Error {
  constructor(rule, message, receipt) {
    super(`heatlot-broker refused (${rule}): ${message}`);
    this.name = 'HeatlotRefusal';
    this.rule = rule;
    this.receipt = receipt;
  }
}

/** A piece of content that fed a decision, labelled by where it came from. */
function block(content, { source, trust }) {
  if (typeof source !== 'string' || source === '') throw new TypeError('every input needs a source');
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return Object.freeze({ source, trust, sha256: sha256(text) });
}

export const trusted = (content, opts = {}) => block(content, { source: opts.source, trust: 'trusted' });
export const untrusted = (content, opts = {}) => block(content, { source: opts.source, trust: 'untrusted' });

export class Broker {
  constructor({ dir, privateKey, publicKey } = {}) {
    this.ledger = new Ledger(dir, { privateKey, publicKey });
  }

  /**
   * Mint a single-use authorization for one tool and one exact payload.
   * Throws HeatlotRefusal (and records the refusal) if any input is untrusted.
   */
  approve(tool, payload, { by, inputs = [] } = {}) {
    if (typeof tool !== 'string' || tool === '') throw new TypeError('tool name required');
    if (typeof by !== 'string' || by === '') throw new TypeError('approve() needs `by`: who or what approved this');
    for (const input of inputs) {
      if (!input || typeof input.sha256 !== 'string' || !['trusted', 'untrusted'].includes(input.trust)) {
        throw new TypeError('inputs must be created with trusted() or untrusted()');
      }
    }
    const tainted = inputs.filter((input) => input.trust !== 'trusted');
    const payloadSha = hashOf(payload);
    if (tainted.length > 0) {
      const receipt = this.ledger.append('authorization_refused', {
        tool, payload_sha256: payloadSha, by, rule: 'untrusted-input',
        untrusted: tainted.map(({ source, sha256: s }) => ({ source, sha256: s })),
      });
      throw new HeatlotRefusal('untrusted-input', `${tainted.length} untrusted input(s) fed this decision: ${tainted.map((t) => t.source).join(', ')}`, receipt);
    }
    const id = randomUUID();
    const receipt = this.ledger.append('authorization_minted', {
      id, tool, payload_sha256: payloadSha, by,
      inputs: inputs.map(({ source, sha256: s }) => ({ source, sha256: s })),
    });
    return Object.freeze({ id, tool, payload_sha256: payloadSha, mint_receipt_sha256: receipt.receipt_sha256 });
  }

  /**
   * Check an authorization against the ledger without consuming it.
   * Returns { ok: true, mint } or { ok: false, rule, message }.
   */
  check(tool, payload, authorization) {
    const chain = this.ledger.read();
    const verified = verifyChain(chain, this.ledger.publicKey);
    if (!verified.ok) return { ok: false, rule: 'ledger-broken', message: `receipt ${verified.brokenAt}: ${verified.reason}` };
    if (!authorization || typeof authorization.id !== 'string') return { ok: false, rule: 'no-authorization', message: `${tool} needs an authorization from approve()` };
    const mint = chain.find((r) => r.kind === 'authorization_minted' && r.payload.id === authorization.id);
    if (!mint) return { ok: false, rule: 'never-minted', message: `authorization ${authorization.id} was never minted on this ledger` };
    if (mint.receipt_sha256 !== authorization.mint_receipt_sha256) return { ok: false, rule: 'mint-mismatch', message: 'authorization does not match its mint receipt' };
    if (mint.payload.tool !== tool) return { ok: false, rule: 'wrong-tool', message: `authorized for ${mint.payload.tool}, not ${tool}` };
    if (mint.payload.payload_sha256 !== hashOf(payload)) return { ok: false, rule: 'payload-changed', message: 'payload differs from the one that was approved' };
    if (chain.some((r) => r.kind === 'authorization_consumed' && r.payload.id === authorization.id)) {
      return { ok: false, rule: 'already-used', message: `authorization ${authorization.id} was already used` };
    }
    return { ok: true, mint };
  }

  /** Consume an authorization (records it) or throw HeatlotRefusal (records the denial). */
  consume(tool, payload, authorization) {
    const verdict = this.check(tool, payload, authorization);
    if (!verdict.ok) {
      const receipt = this.ledger.append('effect_denied', { tool, payload_sha256: hashOf(payload), rule: verdict.rule, authorization_id: authorization?.id ?? null });
      throw new HeatlotRefusal(verdict.rule, verdict.message, receipt);
    }
    this.ledger.append('authorization_consumed', { id: authorization.id, tool });
    return verdict.mint;
  }

  /** Record that a read-only call happened. No authorization needed; the receipt is the audit trail. */
  recordRead(tool, args) {
    return this.ledger.append('read_performed', { tool, args_sha256: hashOf(args ?? null) });
  }

  /** Record the outcome of an authorized effect. */
  recordOutcome(tool, authorization, outcome) {
    return this.ledger.append(outcome.ok ? 'effect_performed' : 'effect_failed', {
      tool, authorization_id: authorization.id, result_sha256: outcome.ok ? hashOf(outcome.result ?? null) : null,
      error: outcome.ok ? undefined : String(outcome.error?.message ?? outcome.error),
    });
  }

  /** Wrap a side-effecting function so it runs only with a valid, unused authorization for that exact payload. */
  guard(tool, fn) {
    if (typeof fn !== 'function') throw new TypeError('guard() wraps a function');
    return async (payload, { authorization } = {}) => {
      this.consume(tool, payload, authorization);
      try {
        const result = await fn(payload);
        this.recordOutcome(tool, authorization, { ok: true, result });
        return result;
      } catch (error) {
        this.recordOutcome(tool, authorization, { ok: false, error });
        throw error;
      }
    };
  }

  /** Verify this broker's whole ledger. */
  verify() {
    return verifyChain(this.ledger.read(), this.ledger.publicKey);
  }
}
