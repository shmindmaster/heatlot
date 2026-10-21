/**
 * The API contract. These zod schemas validate every request and response at runtime, and the
 * OpenAPI document is generated from them; nothing is described twice.
 */
import { z } from '@hono/zod-openapi';

export const PacketId = z.string().regex(/^PKT-\d{5}R?$/).openapi({ example: 'PKT-24002', description: 'Inbound supplier packet id' });
export const DocName = z.enum(['mtr', 'coc']).openapi({ description: 'mtr: mill test report; coc: certificate of conformance' });
export const Verdict = z.enum(['ACCEPT', 'INCOMPLETE', 'NONCONFORMING']);

export const Citation = z.object({
  doc: DocName,
  page: z.number().int().min(1),
  line: z.number().int().min(1),
  text: z.string().optional().openapi({ description: 'The cited line, as read from the PDF text layer' }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional().openapi({ description: 'sha256 of the cited line text' }),
}).openapi('Citation');

export const Finding = z.object({
  rule: z.string().openapi({ example: 'required-test-missing:tensile' }),
  status: z.enum(['pass', 'fail', 'missing']),
  reason: z.string(),
  cites: z.array(Citation),
}).openapi('Finding');

export const Rejection = z.object({
  document: z.string(),
  field: z.string().openapi({ example: 'mechanical.tensile_ksi' }),
  value: z.unknown(),
  cite: Citation.partial().nullable().optional(),
  reason: z.enum(['no-citation', 'unknown-document', 'cited-line-missing', 'cited-line-hidden', 'value-not-on-cited-line']),
}).openapi('Rejection');

export const UntrustedLine = z.object({
  doc: DocName, page: z.number().int(), line: z.number().int(), text: z.string(),
  why: z.enum(['hidden-text', 'instruction-shaped']),
}).openapi('UntrustedLine');

export const Decision = z.object({
  packet: PacketId,
  po: z.string(),
  verdict: Verdict,
  reasons: z.array(z.string()),
  files: z.record(z.string(), z.string()),
  spec: z.object({ id: z.string(), revision: z.string(), sha256: z.string() }),
  findings_sha256: z.string(),
}).openapi('Decision', { description: 'The payload a release authorization is bound to' });

export const Ncr = z.object({
  id: z.string(), packet: PacketId, po: z.string(), disposition: z.literal('quarantine'), verdict: Verdict,
  reasons: z.array(Finding), untrusted_lines: z.array(UntrustedLine), opened_from_receipt: z.string(),
}).openapi('NonconformanceRecord');

export const Inspection = z.object({
  packet: PacketId,
  verdict: Verdict,
  reasons: z.array(z.string()),
  draft_verdict: z.string().nullable().openapi({ description: "The model's draft. Recorded, never acted on." }),
  extraction_provenance: z.object({ kind: z.string(), note: z.string().optional() }).passthrough().nullable(),
  findings: z.array(Finding),
  rejected: z.array(Rejection),
  untrusted: z.array(UntrustedLine),
  decision: Decision,
  ncr: Ncr.nullable(),
}).openapi('Inspection');

export const PacketSummary = z.object({
  packet: PacketId,
  po: z.string(),
  item: z.string(),
  supplier: z.string(),
  received: z.string(),
  resubmits: PacketId.nullable(),
  status: z.enum(['received', 'quarantined', 'awaiting-release', 'released']),
  verdict: Verdict.nullable(),
}).openapi('PacketSummary');

export const Line = z.object({
  page: z.number().int(), line: z.number().int(), text: z.string(), sha256: z.string(),
  bbox: z.array(z.number()).length(4).openapi({ description: 'PDF points, origin bottom-left: [x0, y0, x1, y1]' }),
  font_pt: z.number(), hidden: z.boolean(),
}).openapi('TextLine');

export const Authorization = z.object({
  id: z.string().uuid(), tool: z.literal('release-material'),
  payload_sha256: z.string(), mint_receipt_sha256: z.string(),
}).openapi('Authorization', { description: 'Single use, bound to the exact Decision it was minted for' });

export const ApproveRequest = z.object({ by: z.string().min(1).max(200).openapi({ example: 'J. Mendez, receiving inspector' }) }).strict().openapi('ApproveRequest');
export const ReleaseRequest = z.object({ authorization: Authorization }).strict().openapi('ReleaseRequest');
export const ReleaseRecord = z.object({ packet: PacketId, po: z.string(), released: z.literal(true), decision_sha256: z.string(), authorization_id: z.string() }).openapi('ReleaseRecord');

export const Receipt = z.object({
  seq: z.number().int(), kind: z.string(), payload: z.unknown(), payload_sha256: z.string(),
  prev_sha256: z.string(), key_id: z.string(), receipt_sha256: z.string(), sig: z.string(),
}).openapi('Receipt');

export const ReceiptChain = z.object({
  packet: PacketId,
  verified: z.boolean(),
  broken_at: z.number().int().nullable(),
  reason: z.string().nullable(),
  public_key_pem: z.string(),
  receipts: z.array(Receipt),
}).openapi('ReceiptChain');

export const ERROR_CODES = ['not-found', 'invalid-request', 'unsupported-media-type', 'method-not-allowed', 'refused', 'internal'];

export const ErrorBody = z.object({
  error: z.object({
    // The set of codes may grow, so it is declared extensible: clients must tolerate a code they do not know.
    code: z.string().openapi({ 'x-extensible-enum': ERROR_CODES, description: `One of ${ERROR_CODES.join(', ')}; new codes may be added.` }),
    message: z.string(),
    rule: z.string().optional().openapi({ description: 'For a refusal: the broker rule that refused, e.g. already-used' }),
  }),
}).openapi('Error');

export const Health = z.object({ name: z.literal('heatlot'), version: z.string(), packets: z.number().int() }).openapi('Health');
