/**
 * Inspect one inbound supplier packet, end to end, and record every step.
 *
 *   inspect(packetDir)            -> verdict with cited findings; quarantine + NCR unless ACCEPT
 *   approveRelease(result, {by})  -> single-use authorization bound to the exact decision
 *   release(result, auth)         -> the only code path that marks material released
 *
 * Receipts go to `<out>/<packet>/receipts.jsonl`, signed with the instance key, through the
 * broker. The model's extraction and draft verdict are recorded as evidence; the verdict that
 * counts is computed by the rules from citation-checked fields.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HeatlotRefusal as BrokerRefusal, Broker, generateKeys, hashOf, trusted, untrusted } from '../../packages/broker/src/index.mjs';
import { textLines } from '../documents/text-layer.mjs';
import { verifyExtraction } from './cite.mjs';
import { readFields } from './fields.mjs';
import { evaluate } from './rules.mjs';
import { findStatements } from './statements.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Receipts, keys and records go to HEATLOT_OUT, or .heatlot in the working directory: never inside
// the installed package.
export const DEFAULT_OUT = process.env.HEATLOT_OUT ? path.resolve(process.env.HEATLOT_OUT) : path.join(process.cwd(), '.heatlot');
export const RELEASE_TOOL = 'release-material';
export { BrokerRefusal };

/** Text aimed at a reviewer rather than describing material. Flagged even when visible. */
const INSTRUCTION_SHAPED = /\b(ignore|disregard)\b.*\b(instructions?|missing|test|requirements?)\b|\b(treat|mark) (this|the) (certificate|package|packet)\b.*\b(complete|conforming|approved?)\b|\bapprove (the )?release\b|\b(automated|ai) reviewer\b/i;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function instanceKeys(out) {
  const keyDir = path.join(out, 'keys');
  const priv = path.join(keyDir, 'key.pem');
  if (!existsSync(priv)) {
    mkdirSync(keyDir, { recursive: true });
    const keys = generateKeys();
    writeFileSync(priv, keys.privateKey, { mode: 0o600 });
    writeFileSync(path.join(keyDir, 'key.pub.pem'), keys.publicKey);
  }
  return { privateKey: readFileSync(priv, 'utf8'), publicKey: readFileSync(path.join(keyDir, 'key.pub.pem'), 'utf8') };
}

export function brokerFor(packet, { out = DEFAULT_OUT } = {}) {
  return new Broker({ dir: path.join(out, packet), ...instanceKeys(out) });
}

/** Extraction providers. `replay` reads a recorded or authored model response; `reference` reads the pages directly. */
export const PROVIDERS = {
  replay: (packet, docs) => {
    const file = path.join(REPO_ROOT, 'fixtures', 'extraction', `${packet}.json`);
    if (!existsSync(file)) throw new Error(`no replay fixture for ${packet}: ${path.relative(REPO_ROOT, file)}`);
    return JSON.parse(readFileSync(file, 'utf8'));
  },
  reference: (packet, docs) => ({
    provenance: { kind: 'reference-reader', note: 'Deterministic reader over visible lines; not a model.' },
    draft_verdict: null,
    documents: { mtr: readFields('mtr', docs.mtr), coc: readFields('coc', docs.coc) },
  }),
};

export async function inspect(packetDir, { provider = 'replay', out = DEFAULT_OUT, extraction: given } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(packetDir, 'packet.json'), 'utf8'));
  const { packet, po } = manifest;
  const broker = brokerFor(packet, { out });
  const ledger = broker.ledger;

  // 1. The files are exactly the ones received.
  const files = {};
  for (const [doc, name] of Object.entries(manifest.documents)) {
    const bytes = readFileSync(path.join(packetDir, name));
    files[doc] = { name, sha256: sha256(bytes), bytes };
    if (files[doc].sha256 !== manifest.sha256[name]) throw new Error(`${packet}/${name} does not match the hash it was received with`);
  }
  ledger.append('packet_received', { packet, po: po.po, resubmits: manifest.resubmits ?? null, files: Object.fromEntries(Object.entries(files).map(([d, f]) => [d, { name: f.name, sha256: f.sha256 }])) });

  // 2. Text layers, with every line a reader cannot see, or that addresses the reviewer, labelled untrusted.
  const docs = {};
  const untrustedLines = [];
  for (const [doc, f] of Object.entries(files)) {
    docs[doc] = await textLines(f.bytes);
    for (const line of docs[doc]) {
      const why = line.hidden ? 'hidden-text' : INSTRUCTION_SHAPED.test(line.text) ? 'instruction-shaped' : null;
      if (!why) continue;
      untrustedLines.push({ doc, ...line, why });
      ledger.append('tripwire_fired', { doc, page: line.page, line: line.line, line_sha256: line.sha256, font_pt: line.font_pt, reason: why });
    }
  }
  ledger.append('text_layer_read', Object.fromEntries(Object.entries(docs).map(([d, lines]) => [d, { lines: lines.length, lines_sha256: hashOf(lines.map((l) => l.sha256)) }])));

  // 3. The model drafts. Its output is evidence, recorded as received.
  const extraction = given ?? PROVIDERS[provider](packet, docs);
  ledger.append('extraction_drafted', { provider, provenance: extraction.provenance ?? null, draft_verdict: extraction.draft_verdict ?? null, extraction_sha256: hashOf(extraction.documents) });

  // 4. Only what the pages support is admitted.
  const { admitted, rejected } = verifyExtraction(docs, extraction);
  ledger.append('citations_checked', { rejected });

  // 5. The rules decide.
  const spec = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data', 'specs', `${po.spec}.json`), 'utf8'));
  const statements = findStatements(spec.required_statements.map((s) => s.id), docs);
  const { verdict, reasons, findings } = evaluate({ po, spec, admitted, statements });
  const decision = {
    packet, po: po.po, verdict, reasons,
    files: Object.fromEntries(Object.entries(files).map(([d, f]) => [d, f.sha256])),
    spec: { id: spec.id, revision: po.spec_revision, sha256: hashOf(spec) },
    findings_sha256: hashOf(findings),
  };
  const decisionReceipt = ledger.append('verdict_computed', { ...decision, draft_verdict: extraction.draft_verdict ?? null });

  // 6. Anything but ACCEPT quarantines the material and opens a nonconformance record.
  let ncr = null;
  if (verdict !== 'ACCEPT') {
    ncr = {
      id: `NCR-${packet}`, packet, po: po.po, disposition: 'quarantine', verdict,
      reasons: findings.filter((f) => f.status !== 'pass'),
      untrusted_lines: untrustedLines.map(({ doc, page, line, text, why }) => ({ doc, page, line, text, why })),
      opened_from_receipt: decisionReceipt.receipt_sha256,
    };
    writeFileSync(path.join(broker.ledger.dir, 'ncr.json'), `${JSON.stringify(ncr, null, 2)}\n`);
    ledger.append('ncr_opened', { id: ncr.id, disposition: 'quarantine', verdict, reasons });
  }

  // 7. The inspection is stored, so approval and release act on exactly what was inspected.
  const record = {
    packet, packet_dir: path.resolve(packetDir), po, verdict, reasons, findings, rejected,
    untrusted: untrustedLines.map(({ doc, page, line, text, why, sha256: s }) => ({ doc, page, line, text, why, sha256: s })),
    decision, ncr,
    extraction: { draft_verdict: extraction.draft_verdict ?? null, provenance: extraction.provenance ?? null },
    docs_lines: Object.fromEntries(Object.entries(docs).map(([d, lines]) => [d, lines.map((l) => ({ line: l.line, sha256: l.sha256 }))])),
    verdict_receipt_sha256: decisionReceipt.receipt_sha256,
  };
  writeFileSync(path.join(broker.ledger.dir, 'inspection.json'), `${JSON.stringify(record, null, 2)}\n`);

  return { ...record, docs, extraction, ledgerDir: ledger.dir, out };
}

/** The last stored inspection of a packet, or null if it has never been inspected. */
export function latestInspection(packet, { out = DEFAULT_OUT } = {}) {
  const file = path.join(out, packet, 'inspection.json');
  if (!existsSync(file)) return null;
  return { ...JSON.parse(readFileSync(file, 'utf8')), ledgerDir: path.join(out, packet), out };
}

/** True once release-material has been performed for this packet. Material is released at most once. */
function alreadyReleased(broker) {
  return broker.ledger.read().some((r) => r.kind === 'effect_performed' && r.payload.tool === RELEASE_TOOL);
}

/** The inspector's approval. Refused unless the verdict is ACCEPT and no untrusted line fed the decision. */
export function approveRelease(result, { by, out = result.out } = {}) {
  const broker = brokerFor(result.packet, { out });
  if (alreadyReleased(broker)) {
    const receipt = broker.ledger.append('authorization_refused', { tool: RELEASE_TOOL, payload_sha256: hashOf(result.decision), by, rule: 'already-released' });
    throw new BrokerRefusal('already-released', `${result.packet} has already been released; material is released once`, receipt);
  }
  if (result.decision.verdict !== 'ACCEPT') {
    const receipt = broker.ledger.append('authorization_refused', { tool: RELEASE_TOOL, payload_sha256: hashOf(result.decision), by, rule: 'verdict-not-accept', verdict: result.decision.verdict });
    throw new BrokerRefusal('verdict-not-accept', `${result.packet} is ${result.decision.verdict}; only an ACCEPT can be released`, receipt);
  }
  const inputs = [];
  const docLines = result.docs_lines ?? Object.fromEntries(Object.entries(result.docs).map(([d, lines]) => [d, lines.map((l) => ({ line: l.line, sha256: l.sha256 }))]));
  for (const [doc, lines] of Object.entries(docLines)) {
    const flagged = new Set(result.untrusted.filter((u) => u.doc === doc).map((u) => u.line));
    const clean = lines.filter((l) => !flagged.has(l.line));
    inputs.push(trusted(clean.map((l) => l.sha256).join('\n'), { source: `${result.packet}/${doc}` }));
    for (const u of result.untrusted.filter((x) => x.doc === doc)) inputs.push(untrusted(u.text, { source: `${result.packet}/${doc}#p${u.page}l${u.line}` }));
  }
  return broker.approve(RELEASE_TOOL, result.decision, { by, inputs });
}

/** Mark the material released. The only writer of release.json, and it runs once per authorization. */
export async function release(result, authorization, { out = result.out } = {}) {
  const broker = brokerFor(result.packet, { out });
  // A reused authorization is the broker's to refuse (already-used); a fresh one for material
  // that has already gone out is refused here.
  const reused = broker.ledger.read().some((r) => r.kind === 'authorization_consumed' && r.payload.id === authorization?.id);
  if (!reused && alreadyReleased(broker)) {
    const receipt = broker.ledger.append('effect_denied', { tool: RELEASE_TOOL, payload_sha256: hashOf(result.decision), rule: 'already-released', authorization_id: authorization?.id ?? null });
    throw new BrokerRefusal('already-released', `${result.packet} has already been released; material is released once`, receipt);
  }
  // The files on disk must still be the ones the decision was made on.
  if (result.packet_dir) {
    const manifest = JSON.parse(readFileSync(path.join(result.packet_dir, 'packet.json'), 'utf8'));
    for (const [doc, name] of Object.entries(manifest.documents)) {
      if (sha256(readFileSync(path.join(result.packet_dir, name))) !== result.decision.files[doc]) {
        const receipt = broker.ledger.append('effect_denied', { tool: RELEASE_TOOL, payload_sha256: hashOf(result.decision), rule: 'packet-changed', document: doc, authorization_id: authorization?.id ?? null });
        throw new BrokerRefusal('packet-changed', `${result.packet}/${name} changed after it was inspected; inspect it again`, receipt);
      }
    }
  }
  const doRelease = broker.guard(RELEASE_TOOL, async (decision) => {
    const record = { packet: decision.packet, po: decision.po, released: true, decision_sha256: hashOf(decision), authorization_id: authorization?.id };
    writeFileSync(path.join(broker.ledger.dir, 'release.json'), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  });
  return doRelease(result.decision, { authorization });
}
