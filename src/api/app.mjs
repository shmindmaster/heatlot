/**
 * The Heatlot HTTP API. Routes are declared with their zod schemas; requests are validated on the
 * way in, and the OpenAPI 3.1 document at /openapi.json is generated from the same declarations.
 * Scalar renders it at /docs/api. Every error uses one envelope: { error: { code, message, rule? } }.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { Scalar } from '@scalar/hono-api-reference';

import { verifyChain } from '../../packages/broker/src/index.mjs';
import { textLines } from '../documents/text-layer.mjs';
import { BrokerRefusal, DEFAULT_OUT, approveRelease, brokerFor, inspect, latestInspection, release } from '../inspection/inspect.mjs';
import * as S from './schemas.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
const json = (schema, description) => ({ content: { 'application/json': { schema } }, description });
const errors = { 404: json(S.ErrorBody, 'Unknown packet'), 400: json(S.ErrorBody, 'Invalid request') };
const bodyErrors = { ...errors, 415: json(S.ErrorBody, 'The body must be application/json') };
const PacketParam = z.object({ packet: S.PacketId.openapi({ param: { name: 'packet', in: 'path' } }) });

export const SCALAR_THEME = `
  .light-mode, .dark-mode { --scalar-color-accent: #c2410c; --scalar-font: "Inter", system-ui, sans-serif; --scalar-font-code: "JetBrains Mono", ui-monospace, monospace; }
  .light-mode { --scalar-background-1: #fbfaf7; --scalar-background-2: #f2f0ea; --scalar-color-1: #14181f; --scalar-color-2: #4b5563; }
  .dark-mode { --scalar-background-1: #0f1216; --scalar-background-2: #171b21; --scalar-color-1: #eceae4; --scalar-color-2: #9aa3ae; --scalar-color-accent: #f97316; }
`;

/**
 * The inspection console: static files, served without a build step. Declared with plain app.get,
 * so none of it appears in the OpenAPI document. Only files under the console directory and the
 * named pdf.js files are reachable; every other path is a 404.
 */
const CONSOLE_DIR = path.join(REPO_ROOT, 'console');
const PDFJS_DIR = path.join(REPO_ROOT, 'node_modules', 'pdfjs-dist');
const PDFJS_FILES = { 'pdf.mjs': 'build/pdf.mjs', 'pdf.worker.mjs': 'build/pdf.worker.mjs' };
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ttf': 'font/ttf', '.pfb': 'application/octet-stream',
};
/** No third-party origin is ever contacted: everything the console loads comes from this server. */
export const CONSOLE_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "font-src 'self' data: blob:",
  "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'",
].join('; ');

function within(root, rel) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  const file = path.resolve(root, decoded);
  if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function mountConsole(app) {
  const send = (c, file) => {
    const type = CONTENT_TYPES[path.extname(file)];
    if (!type) return c.json({ error: { code: 'not-found', message: `no route GET ${c.req.path}` } }, 404);
    const headers = { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
    if (type.startsWith('text/html')) Object.assign(headers, { 'content-security-policy': CONSOLE_CSP, 'referrer-policy': 'no-referrer' });
    return c.body(readFileSync(file), 200, headers);
  };
  const missing = (c) => c.json({ error: { code: 'not-found', message: `no route GET ${c.req.path}` } }, 404);
  app.get('/', (c) => send(c, path.join(CONSOLE_DIR, 'index.html')));
  app.get('/console/*', (c) => {
    const file = within(CONSOLE_DIR, c.req.path.slice('/console/'.length));
    return file ? send(c, file) : missing(c);
  });
  app.get('/vendor/pdfjs/standard_fonts/*', (c) => {
    const file = within(path.join(PDFJS_DIR, 'standard_fonts'), c.req.path.slice('/vendor/pdfjs/standard_fonts/'.length));
    return file ? send(c, file) : missing(c);
  });
  app.get('/vendor/pdfjs/:file', (c) => {
    const rel = PDFJS_FILES[c.req.param('file')];
    return rel ? send(c, path.join(PDFJS_DIR, rel)) : missing(c);
  });
}

export function createApp({ packetsRoot = path.join(REPO_ROOT, 'data', 'packets'), out = DEFAULT_OUT, provider = 'replay' } = {}) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: { code: 'invalid-request', message: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') } }, 400);
    },
  });
  const notFound = (c, packet) => c.json({ error: { code: 'not-found', message: `no packet ${packet}` } }, 404);
  const dirOf = (packet) => path.join(packetsRoot, packet);
  const exists = (packet) => existsSync(path.join(dirOf(packet), 'packet.json'));
  const manifest = (packet) => JSON.parse(readFileSync(path.join(dirOf(packet), 'packet.json'), 'utf8'));
  const packetIds = () => readdirSync(packetsRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && exists(d.name)).map((d) => d.name).sort();
  const shape = (r) => ({
    packet: r.packet, verdict: r.verdict, reasons: r.reasons,
    draft_verdict: r.extraction?.draft_verdict ?? null, extraction_provenance: r.extraction?.provenance ?? null,
    findings: r.findings, rejected: r.rejected,
    untrusted: r.untrusted.map(({ doc, page, line, text, why }) => ({ doc, page, line, text, why })),
    decision: r.decision, ncr: r.ncr,
  });
  function summary(packet) {
    const m = manifest(packet);
    const receipts = brokerFor(packet, { out }).ledger.read();
    const last = receipts.filter((r) => r.kind === 'verdict_computed').at(-1);
    const released = receipts.some((r) => r.kind === 'effect_performed');
    const verdict = last?.payload.verdict ?? null;
    const status = released ? 'released' : !verdict ? 'received' : verdict === 'ACCEPT' ? 'awaiting-release' : 'quarantined';
    return { packet, po: m.po.po, item: m.po.item, supplier: m.po.supplier, received: m.received, resubmits: m.resubmits ?? null, status, verdict };
  }

  app.openapi(createRoute({ method: 'get', operationId: 'getHealth', path: '/api/health', tags: ['service'], summary: 'Service health and version', responses: { 200: json(S.Health, 'Healthy') } }),
    (c) => c.json({ name: 'heatlot', version: VERSION, packets: packetIds().length }, 200));

  app.openapi(createRoute({ method: 'get', operationId: 'listPackets', path: '/api/packets', tags: ['packets'], summary: 'The receiving queue: every packet with its current status',
    responses: { 200: json(z.object({ packets: z.array(S.PacketSummary) }), 'The queue') } }),
  (c) => c.json({ packets: packetIds().map(summary) }, 200));

  app.openapi(createRoute({ method: 'get', operationId: 'getPacket', path: '/api/packets/{packet}', tags: ['packets'], summary: 'One packet: its PO line and status', request: { params: PacketParam },
    responses: { 200: json(S.PacketSummary.extend({ po_line: z.record(z.string(), z.unknown()), documents: z.record(z.string(), z.string()) }), 'The packet'), ...errors } }),
  (c) => {
    const { packet } = c.req.valid('param');
    if (!exists(packet)) return notFound(c, packet);
    const m = manifest(packet);
    return c.json({ ...summary(packet), po_line: m.po, documents: m.documents }, 200);
  });

  app.openapi(createRoute({ method: 'get', operationId: 'getDocumentLines', path: '/api/packets/{packet}/documents/{doc}/lines', tags: ['documents'], summary: 'The text layer of one document, as numbered, hashed lines',
    request: { params: PacketParam.extend({ doc: S.DocName.openapi({ param: { name: 'doc', in: 'path' } }) }) },
    responses: { 200: json(z.object({ packet: S.PacketId, doc: S.DocName, lines: z.array(S.Line) }), 'Lines'), ...errors } }),
  async (c) => {
    const { packet, doc } = c.req.valid('param');
    if (!exists(packet)) return notFound(c, packet);
    const lines = await textLines(readFileSync(path.join(dirOf(packet), manifest(packet).documents[doc])));
    return c.json({ packet, doc, lines }, 200);
  });

  app.openapi(createRoute({ method: 'get', operationId: 'getDocumentPdf', path: '/api/packets/{packet}/documents/{doc}/pdf', tags: ['documents'], summary: 'The document as received (PDF bytes)',
    request: { params: PacketParam.extend({ doc: S.DocName.openapi({ param: { name: 'doc', in: 'path' } }) }) },
    responses: { 200: { content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } }, description: 'PDF' }, ...errors } }),
  (c) => {
    const { packet, doc } = c.req.valid('param');
    if (!exists(packet)) return notFound(c, packet);
    return c.body(readFileSync(path.join(dirOf(packet), manifest(packet).documents[doc])), 200, { 'content-type': 'application/pdf' });
  });

  app.openapi(createRoute({ method: 'post', operationId: 'inspectPacket', path: '/api/packets/{packet}/inspect', tags: ['inspection'], summary: 'Inspect the packet: cited extraction, rules, verdict; quarantine unless ACCEPT',
    request: { params: PacketParam }, responses: { 200: json(S.Inspection, 'The inspection, every finding cited'), ...errors } }),
  async (c) => {
    const { packet } = c.req.valid('param');
    if (!exists(packet)) return notFound(c, packet);
    return c.json(shape(await inspect(dirOf(packet), { out, provider })), 200);
  });

  app.openapi(createRoute({ method: 'get', operationId: 'getInspection', path: '/api/packets/{packet}/inspection', tags: ['inspection'], summary: 'The last recorded inspection of the packet (no new receipts)',
    request: { params: PacketParam }, responses: { 200: json(S.Inspection, 'The stored inspection'), ...errors } }),
  (c) => {
    const { packet } = c.req.valid('param');
    if (!exists(packet)) return notFound(c, packet);
    const stored = latestInspection(packet, { out });
    if (!stored) return c.json({ error: { code: 'not-found', message: `${packet} has not been inspected yet` } }, 404);
    return c.json(shape(stored), 200);
  });

  const notInspected = (c, packet) => c.json({ error: { code: 'refused', message: `${packet} has not been inspected; inspect it first`, rule: 'not-inspected' } }, 409);

  app.openapi(createRoute({ method: 'post', operationId: 'approveRelease', path: '/api/packets/{packet}/approve', tags: ['release'], summary: "The inspector's approval of the last inspection: a single-use release authorization bound to its decision",
    request: { params: PacketParam, body: { content: { 'application/json': { schema: S.ApproveRequest } }, required: true } },
    responses: { 200: json(S.Authorization, 'Authorization minted'), 409: json(S.ErrorBody, 'Refused: not inspected, not ACCEPT, already released, or untrusted input fed the decision'), ...bodyErrors } }),
  async (c) => {
    const { packet } = c.req.valid('param');
    if (!exists(packet)) return notFound(c, packet);
    const { by } = c.req.valid('json');
    const r = latestInspection(packet, { out });
    if (!r) return notInspected(c, packet);
    try { return c.json(approveRelease(r, { by }), 200); } catch (e) {
      if (e instanceof BrokerRefusal) return c.json({ error: { code: 'refused', message: e.message, rule: e.rule } }, 409);
      throw e;
    }
  });

  app.openapi(createRoute({ method: 'post', operationId: 'releasePacket', path: '/api/packets/{packet}/release', tags: ['release'], summary: 'Release the material. Runs once per authorization.',
    request: { params: PacketParam, body: { content: { 'application/json': { schema: S.ReleaseRequest } }, required: true } },
    responses: { 200: json(S.ReleaseRecord, 'Released'), 409: json(S.ErrorBody, 'Refused: not inspected, already used, already released, never minted, the decision changed, or the packet changed after inspection'), ...bodyErrors } }),
  async (c) => {
    const { packet } = c.req.valid('param');
    if (!exists(packet)) return notFound(c, packet);
    const { authorization } = c.req.valid('json');
    const r = latestInspection(packet, { out });
    if (!r) return notInspected(c, packet);
    try { return c.json(await release(r, authorization), 200); } catch (e) {
      if (e instanceof BrokerRefusal) return c.json({ error: { code: 'refused', message: e.message, rule: e.rule } }, 409);
      throw e;
    }
  });

  app.openapi(createRoute({ method: 'get', operationId: 'getReceipts', path: '/api/packets/{packet}/receipts', tags: ['receipts'], summary: "The packet's signed receipt chain, verified",
    request: { params: PacketParam }, responses: { 200: json(S.ReceiptChain, 'Receipts and verification'), ...errors } }),
  (c) => {
    const { packet } = c.req.valid('param');
    if (!exists(packet)) return notFound(c, packet);
    const broker = brokerFor(packet, { out });
    const receipts = broker.ledger.read();
    const v = verifyChain(receipts, broker.ledger.publicKey);
    return c.json({ packet, verified: v.ok, broken_at: v.ok ? null : v.brokenAt, reason: v.ok ? null : v.reason, public_key_pem: broker.ledger.publicKey, receipts }, 200);
  });

  app.doc31('/openapi.json', {
    openapi: '3.1.1',
    info: {
      title: 'Heatlot API', version: VERSION, license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
      description: 'Every certificate, checked against the record. Inspect inbound supplier packets (certificate of conformance + mill test report) against the PO and the specification. Every finding is cited to a document line; release needs a single-use authorization bound to the exact decision. Synthetic data only.',
    },
    servers: [{ url: 'http://127.0.0.1:4140', description: 'Local' }],
    tags: [
      { name: 'packets', description: 'The receiving queue' },
      { name: 'documents', description: 'Documents as received, and their text layers' },
      { name: 'inspection', description: 'Cited extraction, rules and verdict' },
      { name: 'release', description: 'Single-use, decision-bound release' },
      { name: 'receipts', description: 'Signed, hash-chained audit trail' },
      { name: 'service', description: 'Health' },
    ],
  });
  app.get('/docs/api', Scalar({ url: '/openapi.json', pageTitle: 'Heatlot API', customCss: SCALAR_THEME, hideClientButton: false }));
  mountConsole(app);
  // Framework errors keep their status inside the one envelope: a body that is not JSON is 415,
  // malformed JSON is 400. Only a genuine fault is 500.
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const status = err.status;
      const code = status === 415 ? 'unsupported-media-type' : status === 400 ? 'invalid-request' : status === 404 ? 'not-found' : 'internal';
      return c.json({ error: { code, message: err.message || 'invalid request' } }, status);
    }
    return c.json({ error: { code: 'internal', message: err.message } }, 500);
  });
  // A known path called with the wrong method is 405 with an Allow header, not 404.
  const ROUTES = [
    [/^\/api\/health$/, ['GET']], [/^\/api\/packets$/, ['GET']], [/^\/api\/packets\/[^/]+$/, ['GET']],
    [/^\/api\/packets\/[^/]+\/documents\/[^/]+\/(lines|pdf)$/, ['GET']], [/^\/api\/packets\/[^/]+\/(receipts|inspection)$/, ['GET']],
    [/^\/api\/packets\/[^/]+\/(inspect|approve|release)$/, ['POST']], [/^\/openapi\.json$/, ['GET']], [/^\/docs\/api$/, ['GET']],
  ];
  app.notFound((c) => {
    const allowed = ROUTES.find(([re]) => re.test(c.req.path))?.[1];
    if (allowed && !allowed.includes(c.req.method)) {
      return c.json({ error: { code: 'method-not-allowed', message: `${c.req.method} is not allowed on ${c.req.path}; use ${allowed.join(', ')}` } }, 405, { allow: allowed.join(', ') });
    }
    return c.json({ error: { code: 'not-found', message: `no route ${c.req.method} ${c.req.path}` } }, 404);
  });
  return app;
}
