#!/usr/bin/env node
/**
 * smoke-mcp.mjs — real client handshake against the kestrel-foundry-data MCP server.
 * Spawns the server over stdio, negotiates the protocol revision, checks the tool surface
 * (ten tools, each titled, read-only and typed with an outputSchema), and asserts the demo-critical truths:
 *   1. HT-4471 has no mechanical-test record on file (refusal case)
 *   2. PO-MER-5532 resolves complete (positive case)
 *   3. NCR-2026-0114 carries 3 prior occurrences (repeat offender)
 * Then proves dual-era service (MCP 2026-07-28 plus the 2025-era handshake) over stdio and over
 * the loopback HTTP mode, and that HTTP refuses a foreign Origin.
 * Exits non-zero on any failure.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// The MCP spec revision this repository targets. Pinned here on purpose: if the SDK ever
// negotiated something older, the smoke test must fail rather than follow it.
const EXPECTED_REVISION = '2026-07-28';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(REPO_ROOT, 'mcp-servers', 'kestrel-foundry-data', 'src', 'server.mjs');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
const client = new Client({ name: 'kestrel-smoke-test', version: '0.2.0' }, { versionNegotiation: { mode: 'auto' } });

try {
  await client.connect(transport);

  check(`negotiated protocol revision is ${EXPECTED_REVISION} (modern era)`,
    client.getNegotiatedProtocolVersion() === EXPECTED_REVISION && client.getProtocolEra() === 'modern',
    `${client.getNegotiatedProtocolVersion()} / ${client.getProtocolEra()}`);

  const tools = await client.listTools();
  const expected = ['list_ncrs', 'get_ncr', 'get_heat_lot', 'get_test_record', 'search_documents',
    'get_document', 'list_cert_requirements', 'get_purchase_order', 'get_scrap_records', 'get_audit_scope'];
  const names = tools.tools.map((t) => t.name).sort();
  check('tools/list exposes exactly the 10 read-only tools',
    JSON.stringify(names) === JSON.stringify(expected.sort()), names.join(', '));

  const untyped = tools.tools.filter((t) => !t.outputSchema || t.outputSchema.type !== 'object').map((t) => t.name);
  check('every tool declares an object outputSchema', untyped.length === 0, untyped.join(', '));
  const notReadOnly = tools.tools.filter((t) => t.annotations?.readOnlyHint !== true
    || t.annotations?.destructiveHint !== false || t.annotations?.idempotentHint !== true).map((t) => t.name);
  check('every tool is annotated read-only, idempotent, non-destructive', notReadOnly.length === 0, notReadOnly.join(', '));
  const untitled = tools.tools.filter((t) => typeof t.title !== 'string' || t.title === '').map((t) => t.name);
  check('every tool has a human-readable title', untitled.length === 0, untitled.join(', '));
  const open = tools.tools.filter((t) => t.inputSchema?.additionalProperties !== false).map((t) => t.name);
  check('every tool input schema rejects unknown properties', open.length === 0, open.join(', '));
  check('tools/list carries the 2026-07-28 cache hint (1 h, public)',
    tools.ttlMs === 3_600_000 && tools.cacheScope === 'public', `${tools.ttlMs} / ${tools.cacheScope}`);

  // Successful calls must carry typed structuredContent (the client validates it against the
  // tool's outputSchema); an error result carries the NOT_FOUND text instead.
  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) return JSON.parse(res.content[0].text);
    if (!res.structuredContent) throw new Error(`${name}: missing structuredContent`);
    return res.structuredContent;
  };

  const heat = await call('get_heat_lot', { heat_number: 4471 });
  check('HT-4471 mechanical-test record is absent', heat.records_on_file['mechanical-test'] === false);

  const rec = await call('get_test_record', { heat_number: 4471, record_type: 'mechanical-test' });
  check('get_test_record(4471, mechanical-test) returns found:false', rec.found === false && Boolean(rec.expected_path));

  const poAer = await call('get_purchase_order', { po: 'PO-AER-5519' });
  check('PO-AER-5519 is incomplete with mechanical-test missing',
    poAer.status === 'incomplete' && poAer.missing_records.includes('mechanical-test'));

  const poMer = await call('get_purchase_order', { po: 'PO-MER-5532' });
  check('PO-MER-5532 is complete', poMer.status === 'complete');

  const ncr = await call('get_ncr', { ncr_id: 'NCR-2026-0114' });
  check('NCR-2026-0114 repeat offender (3 priors)',
    ncr.repeat_analysis?.prior_occurrences?.length === 3 && ncr.repeat_analysis?.repeat_offender === true);

  const audit = await call('get_audit_scope', { audit_id: 'AUD-2026-S1' });
  const gapIds = audit.gaps.map((g) => g.id).sort();
  check('Audit gaps are exactly EA-7 and EA-8', JSON.stringify(gapIds) === JSON.stringify(['EA-7', 'EA-8']));

  const doc = await call('get_document', { path: 'docs/quality/ncrs/NCR-2026-0114.md' });
  check('get_document returns hash-verified content', typeof doc.content === 'string' && doc.content.includes('NCR-2026-0114'));

  const refused = await call('get_document', { path: 'docs/../../package.json' });
  check('get_document refuses unindexed path traversal', refused.error === 'NOT_FOUND');

  // Inputs are strict: a misspelled filter must be refused, not dropped. Dropping it would turn
  // list_ncrs({ statuss: 'open' }) into an unfiltered list that looks like an answer.
  let typo;
  try {
    typo = await client.callTool({ name: 'list_ncrs', arguments: { statuss: 'open' } });
  } catch (error) {
    typo = { isError: true, thrown: error.message };
  }
  check('an unknown tool argument is refused, not silently dropped', typo.isError === true && !typo.structuredContent);
} finally {
  await client.close();
}

// Dual era over stdio: a client left on its default negotiation uses the 2025-era initialize handshake.
{
  const legacy = new Client({ name: 'kestrel-smoke-legacy', version: '0.3.0' });
  try {
    await legacy.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
    check('stdio also serves the 2025-era handshake', legacy.getProtocolEra() === 'legacy',
      `${legacy.getNegotiatedProtocolVersion()} / ${legacy.getProtocolEra()}`);
    const res = await legacy.callTool({ name: 'get_purchase_order', arguments: { po: 'PO-AER-5519' } });
    check('a legacy-era tool call returns the same truth', res.structuredContent?.status === 'incomplete');
  } finally {
    await legacy.close();
  }
}

// Loopback HTTP mode: both eras, and Origin enforcement.
{
  const proc = spawn(process.execPath, [SERVER, '--http', '0'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HTTP server did not start')), 15000);
      proc.stdout.on('data', (chunk) => {
        const m = String(chunk).match(/listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      proc.on('exit', (code) => reject(new Error(`HTTP server exited with ${code}`)));
    });
    for (const [label, options, era] of [
      ['2026-07-28', { versionNegotiation: { mode: 'auto' } }, 'modern'],
      ['2025-era', {}, 'legacy'],
    ]) {
      const http = new Client({ name: `kestrel-smoke-http-${era}`, version: '0.3.0' }, options);
      try {
        await http.connect(new StreamableHTTPClientTransport(new URL(url)));
        const res = await http.callTool({ name: 'get_purchase_order', arguments: { po: 'PO-MER-5532' } });
        check(`HTTP serves ${label} (${era} era)`, http.getProtocolEra() === era && res.structuredContent?.status === 'complete',
          `${http.getNegotiatedProtocolVersion()} / ${http.getProtocolEra()}`);
      } finally {
        await http.close();
      }
    }
    const foreign = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://attacker.example' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    check('HTTP refuses a foreign Origin with 403', foreign.status === 403, `status ${foreign.status}`);
  } finally {
    proc.kill();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nMCP smoke: all ${results.length} checks passed` : `\nMCP smoke: ${failed.length} FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
