#!/usr/bin/env node
/**
 * kestrel-foundry-data — READ-ONLY MCP boundary over the synthetic foundry dataset.
 *
 * This server is the demo's stand-in for the future AWS warehouse + SharePoint estate:
 * agents never read data files directly; they come through these tools. The boundary is
 * enforced in code, not prose:
 *   - there are no write tools at all;
 *   - get_document only serves paths present in data/index.json (no arbitrary file reads)
 *     and re-verifies the sha256 before returning content;
 *   - list/search tools return pruned fields, not whole documents (context budget is real).
 *
 * Determinism: the calendar anchor comes from data/index.json (anchor_date), never the wall
 * clock, so the demo behaves identically on any day it is run.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.KESTREL_DATA_ROOT
  ? path.resolve(process.env.KESTREL_DATA_ROOT)
  : path.resolve(SERVER_DIR, '..', '..', '..', 'data');

// The server reports the product's own version, so a catalog snapshot names the release it came from.
const PRODUCT_VERSION = JSON.parse(readFileSync(path.resolve(SERVER_DIR, '..', '..', '..', 'package.json'), 'utf8')).version;

const loadJson = (rel) => JSON.parse(readFileSync(path.join(DATA_ROOT, ...rel.split('/')), 'utf8'));

const index = loadJson('index.json');
const ncrs = loadJson('exports/qms/ncr-export.json').ncrs;
const heats = loadJson('exports/erp/heat-lot-export.json').heat_lots;
const purchaseOrders = loadJson('exports/erp/open-pos.json').purchase_orders;
const certReqs = loadJson('exports/customers/cert-requirements.json').requirements;
const auditScope = loadJson('exports/quality/audit-scope.json');
const certManifests = loadJson('exports/quality/cert-manifests.json').manifests;
const scrapRows = (() => {
  const lines = readFileSync(path.join(DATA_ROOT, 'exports', 'erp', 'scrap-export.csv'), 'utf8').trim().split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = Object.fromEntries(head.map((h, i) => [h, cols[i]]));
    row.quantity_scrapped = Number(row.quantity_scrapped);
    row.weight_lbs = Number(row.weight_lbs);
    row.cost_usd = Number(row.cost_usd);
    return row;
  });
})();

const ANCHOR = index.anchor_date;
const DAY_MS = 86400000;
const daysBetween = (from, to) => Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / DAY_MS);

const HEAT_RECORD_TYPES = ['chemistry-cert', 'mechanical-test', 'heat-treat-cert', 'dimensional-report', 'radiographic-report', 'penetrant-report'];
const onFile = (rel) => Object.prototype.hasOwnProperty.call(index.documents, rel);
const hashOf = (rel) => index.documents[rel] ?? null;
const heatRecordPath = (heat, type) => `docs/heat-lots/HT-${heat}/${type}-HT-${heat}.md`;

// Every tool returns typed structuredContent (validated against its outputSchema by the SDK) plus
// the same JSON as text for clients that only read content blocks.
const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const notFound = (what) => ({ content: [{ type: 'text', text: JSON.stringify({ error: 'NOT_FOUND', what }) }], isError: true });

// All ten tools are read-only lookups over a static dataset.
const annotations = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };

const ncrCompact = z.looseObject({
  ncr_id: z.string(), date: z.string(), part_number: z.string(), heat_number: z.number(),
  defect_type: z.string(), cause_code: z.string(), cell: z.string(), severity: z.string(),
  disposition: z.string(), status: z.string(), cost_impact_usd: z.number(),
});
const certItem = z.looseObject({ type: z.string(), expected_path: z.string() });

function createServer() {
  // The catalogue is fixed for the life of a release and holds no tenant data, so 2026-07-28 clients
  // may cache tools/list and server/discover for an hour, in shared caches too. The SDK's default
  // ({ ttlMs: 0, cacheScope: 'private' }) would make every client re-list on every turn.
  const listHint = { ttlMs: 3_600_000, cacheScope: 'public' };
  const server = new McpServer(
    { name: 'kestrel-foundry-data', version: PRODUCT_VERSION },
    { cacheHints: { 'tools/list': listHint, 'server/discover': listHint } },
  );

  const tool = (name, config, handler) =>
    server.registerTool(name, { ...config, annotations }, handler);

  tool('list_ncrs', {
    title: 'List non-conformance reports',
    description: 'List non-conformance reports (compact fields). Filter by status, defect type, cell, or recency (days before the dataset anchor date).',
    inputSchema: z.strictObject({
      status: z.enum(['open', 'closed']).optional(),
      defect_type: z.enum(['porosity', 'shrinkage', 'sand-inclusion', 'misrun-cold-shut', 'dimensional', 'chemistry']).optional(),
      cell: z.string().optional(),
      since_days: z.number().int().positive().optional(),
    }),
    outputSchema: z.object({ total: z.number().int(), ncrs: z.array(ncrCompact) }),
  }, async ({ status, defect_type, cell, since_days }) => {
    let rows = ncrs;
    if (status) rows = rows.filter((n) => n.status === status);
    if (defect_type) rows = rows.filter((n) => n.defect_type === defect_type);
    if (cell) rows = rows.filter((n) => n.cell.toLowerCase() === cell.toLowerCase());
    if (since_days) rows = rows.filter((n) => daysBetween(n.date, ANCHOR) <= since_days);
    return ok({
      total: rows.length,
      ncrs: rows.map(({ narrative, ...rest }) => rest),
    });
  });

  tool('get_ncr', {
    title: 'Get one NCR with repeat history',
    description: 'Get one NCR in full, including repeat-offender history: prior NCRs on the same part + defect + cause within 90 days before its date.',
    inputSchema: z.strictObject({ ncr_id: z.string().regex(/^NCR-2026-\d{4}$/) }),
    outputSchema: ncrCompact.extend({
      part_name: z.string(), customer: z.string(), cause_text: z.string(), narrative: z.string(),
      repeat_analysis: z.object({
        prior_occurrences: z.array(z.object({ ncr_id: z.string(), date: z.string(), disposition: z.string() })),
        occurrence_count_90d: z.number().int(),
        repeat_offender: z.boolean(),
      }),
    }),
  }, async ({ ncr_id }) => {
    const ncr = ncrs.find((n) => n.ncr_id === ncr_id);
    if (!ncr) return notFound(`No NCR with id ${ncr_id}`);
    const priors = ncrs.filter((n) =>
      n.ncr_id !== ncr.ncr_id &&
      n.part_number === ncr.part_number &&
      n.defect_type === ncr.defect_type &&
      n.cause_code === ncr.cause_code &&
      n.date <= ncr.date &&
      daysBetween(n.date, ncr.date) <= 90);
    return ok({
      ...ncr,
      repeat_analysis: {
        prior_occurrences: priors.map((p) => ({ ncr_id: p.ncr_id, date: p.date, disposition: p.disposition })),
        occurrence_count_90d: priors.length + 1,
        repeat_offender: priors.length + 1 >= 3,
      },
    });
  });

  tool('get_heat_lot', {
    title: 'Get a heat lot and its records',
    description: 'Get a heat lot: alloy, chemistry, mechanical results, which certification records are on file, and NCRs referencing it.',
    inputSchema: z.strictObject({ heat_number: z.number().int().min(4460).max(4479) }),
    outputSchema: z.looseObject({
      heat_number: z.number(), heat_id: z.string(), alloy: z.string(),
      chemistry: z.record(z.string(), z.number()),
      mechanical: z.looseObject({}),
      records_on_file: z.record(z.string(), z.boolean()),
      linked_ncrs: z.array(z.string()),
    }),
  }, async ({ heat_number }) => {
    const heat = heats.find((h) => h.heat_number === heat_number);
    if (!heat) return notFound(`No heat lot HT-${heat_number}`);
    const records_on_file = Object.fromEntries(
      HEAT_RECORD_TYPES.map((t) => [t, onFile(heatRecordPath(heat_number, t))]),
    );
    return ok({
      ...heat,
      records_on_file,
      linked_ncrs: ncrs.filter((n) => n.heat_number === heat_number).map((n) => n.ncr_id),
    });
  });

  tool('get_test_record', {
    title: 'Get one certification record for a heat',
    description: 'Resolve a single certification record for a heat lot. Returns found:false with the expected path when the record is not on file — it never invents one.',
    inputSchema: z.strictObject({
      heat_number: z.number().int().min(4460).max(4479),
      record_type: z.enum(HEAT_RECORD_TYPES),
    }),
    outputSchema: z.object({
      found: z.boolean(), heat_number: z.number(), record_type: z.string(),
      path: z.string().optional(), sha256: z.string().nullable().optional(),
      expected_path: z.string().optional(), message: z.string().optional(),
    }),
  }, async ({ heat_number, record_type }) => {
    const rel = heatRecordPath(heat_number, record_type);
    if (!onFile(rel)) {
      return ok({ found: false, heat_number, record_type, expected_path: rel, message: `No ${record_type} on file for HT-${heat_number}.` });
    }
    return ok({ found: true, heat_number, record_type, path: rel, sha256: hashOf(rel) });
  });

  tool('search_documents', {
    title: 'Search indexed documents',
    description: 'Search the document index by path tokens (AND-matched, case-insensitive). Returns paths + sha256, never content — call get_document for the body.',
    inputSchema: z.strictObject({
      query: z.string().min(1),
      prefix: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: z.object({ total: z.number().int(), matches: z.array(z.object({ path: z.string(), sha256: z.string() })) }),
  }, async ({ query, prefix, limit }) => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = Object.keys(index.documents)
      .filter((p) => (prefix ? p.startsWith(prefix) : true))
      .filter((p) => tokens.every((t) => p.toLowerCase().includes(t)))
      .slice(0, limit ?? 25)
      .map((p) => ({ path: p, sha256: index.documents[p] }));
    return ok({ total: matches.length, matches });
  });

  tool('get_document', {
    title: 'Read one indexed document (hash-verified)',
    description: 'Fetch one document body by its indexed path. The sha256 is re-verified against the index before anything is returned; unindexed paths are refused.',
    inputSchema: z.strictObject({ path: z.string().min(1) }),
    outputSchema: z.object({ path: z.string(), sha256: z.string(), content: z.string() }),
  }, async ({ path: docPath }) => {
    const rel = docPath.replace(/\\/g, '/').replace(/^data\//, '');
    if (!onFile(rel)) return notFound(`No indexed document at ${rel}`);
    const abs = path.join(DATA_ROOT, ...rel.split('/'));
    const content = readFileSync(abs, 'utf8');
    const actual = createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
    if (actual !== index.documents[rel]) {
      return notFound(`Integrity check failed for ${rel}: file hash does not match the index`);
    }
    return ok({ path: rel, sha256: actual, content });
  });

  tool('list_cert_requirements', {
    title: 'List customer certification requirements',
    description: 'List customer certificate-of-conformance requirement specifications (required record types per customer).',
    inputSchema: z.strictObject({ customer: z.string().optional() }),
    outputSchema: z.object({
      total: z.number().int(),
      requirements: z.array(z.object({ req_id: z.string(), customer: z.string(), required_records: z.array(z.string()) })),
    }),
  }, async ({ customer }) => {
    const rows = customer ? certReqs.filter((r) => r.customer.toLowerCase() === customer.toLowerCase()) : certReqs;
    return ok({ total: rows.length, requirements: rows });
  });

  tool('get_purchase_order', {
    title: 'Get the certification status of a purchase order',
    description: 'Get a purchase order with its cert-of-conformance manifest: every required record, its expected path, and whether it is actually on file. The completeness verdict comes from the index, not from the model.',
    inputSchema: z.strictObject({ po: z.enum(purchaseOrders.map((p) => p.po)) }),
    outputSchema: z.looseObject({
      po: z.string(), customer: z.string(), heat: z.number(),
      items: z.array(certItem.extend({ on_file: z.boolean(), sha256: z.string().nullable() })),
      status: z.enum(['complete', 'incomplete']),
      missing_records: z.array(z.string()),
    }),
  }, async ({ po }) => {
    const manifest = certManifests[po];
    if (!manifest) return notFound(`No cert manifest for ${po}`);
    const items = manifest.required.map((r) => ({
      ...r,
      on_file: onFile(r.expected_path),
      sha256: hashOf(r.expected_path),
    }));
    const missing = items.filter((i) => !i.on_file);
    return ok({
      ...manifest,
      items,
      status: missing.length === 0 ? 'complete' : 'incomplete',
      missing_records: missing.map((m) => m.type),
    });
  });

  tool('get_scrap_records', {
    title: 'Get scrap records',
    description: 'Scrap/yield rows by week, cell and cause code (CASTLINE export). Pruned to the requested number of most recent weeks; includes weekly totals.',
    inputSchema: z.strictObject({ weeks: z.number().int().min(1).max(8).optional() }),
    outputSchema: z.object({
      anchor_date: z.string(),
      weeks: z.array(z.string()),
      weekly_totals: z.array(z.object({ week_ending: z.string(), cost_usd: z.number(), weight_lbs: z.number() })),
      rows: z.array(z.looseObject({ week_ending: z.string(), cell: z.string(), cause_code: z.string(), part_number: z.string(), quantity_scrapped: z.number(), weight_lbs: z.number(), cost_usd: z.number() })),
    }),
  }, async ({ weeks }) => {
    const allWeeks = [...new Set(scrapRows.map((r) => r.week_ending))].sort();
    const selected = allWeeks.slice(-(weeks ?? 8));
    const rows = scrapRows.filter((r) => selected.includes(r.week_ending));
    const weekly_totals = selected.map((w) => ({
      week_ending: w,
      cost_usd: rows.filter((r) => r.week_ending === w).reduce((s, r) => s + r.cost_usd, 0),
      weight_lbs: rows.filter((r) => r.week_ending === w).reduce((s, r) => s + r.weight_lbs, 0),
    }));
    return ok({ anchor_date: ANCHOR, weeks: selected, weekly_totals, rows });
  });

  tool('get_audit_scope', {
    title: 'Get an audit scope and its evidence gaps',
    description: 'Get an audit scope with each evidence area resolved against the document index: present:true/false per area. Absent areas are the gap list.',
    inputSchema: z.strictObject({ audit_id: z.enum([auditScope.audit_id]) }),
    outputSchema: z.object({
      audit_id: z.string(), title: z.string(), window: z.string(),
      evidence_areas: z.array(z.object({ id: z.string(), area: z.string(), expected_path: z.string(), present: z.boolean() })),
      gaps: z.array(z.object({ id: z.string(), area: z.string(), expected_path: z.string() })),
    }),
  }, async ({ audit_id }) => {
    const areas = auditScope.evidence_areas.map((e) => {
      const isDoc = /\.(md|json)$/.test(e.expected_path);
      const present = isDoc ? onFile(e.expected_path)
        : Object.keys(index.documents).some((p) => p.startsWith(e.expected_path + '/'));
      return { ...e, present };
    });
    return ok({
      audit_id,
      title: auditScope.title,
      window: auditScope.window,
      evidence_areas: areas,
      gaps: areas.filter((a) => !a.present).map((a) => ({ id: a.id, area: a.area, expected_path: a.expected_path })),
    });
  });

  return server;
}

// stdio is the default transport (what .mcp.json and the Claude Code plugin launch). serveStdio
// owns era negotiation: one factory serves both the 2026-07-28 and the 2025-era handshakes.
// Any logging goes to stderr — stdout is protocol.
//
// `--http [port]` serves Streamable HTTP on 127.0.0.1 only, for the conformance suite and local
// HTTP clients. createMcpHandler is dual-era by default (2026-07-28 plus the 2025-era stateless
// fallback). Host and Origin are checked against localhost before any request reaches the handler;
// a rejected request gets 403. Port 0 picks a free port; the URL is printed on stdout.
const httpFlag = process.argv.indexOf('--http');
console.error(`kestrel-foundry-data ${PRODUCT_VERSION}: ${Object.keys(index.documents).length} indexed documents, anchor ${ANCHOR}`);
if (httpFlag === -1) {
  serveStdio(createServer);
} else {
  const port = Number(process.argv[httpFlag + 1] ?? 0);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const handle = toNodeHandler(createMcpHandler(createServer));
  const http = createHttpServer(async (req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found; the MCP endpoint is /mcp' }));
      return;
    }
    await handle(req, res);
  });
  http.listen(Number.isInteger(port) && port >= 0 ? port : 0, '127.0.0.1', () => {
    console.log(`kestrel-foundry-data listening on http://127.0.0.1:${http.address().port}/mcp`);
  });
}
