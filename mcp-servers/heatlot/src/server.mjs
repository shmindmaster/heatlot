#!/usr/bin/env node
/**
 * heatlot MCP server: "verify this packet, and cite why".
 *
 * Tools call the HTTP API's routes in process (one code path, one contract), and their input and
 * output schemas are the API's zod schemas.
 *
 *   packets.list       the receiving queue with each packet's status            read-only
 *   packets.inspect    run the inspection: cited findings and the verdict       writes receipts (non-destructive)
 *   documents.lines    a document's text layer as numbered, hashed lines        read-only
 *   receipts.verify    a packet's signed receipt chain, verified                read-only
 *
 * There is no release tool. Release is an inspector's decision, made in the console or the CLI
 * with a single-use authorization; an agent can explain the verdict but cannot ship material.
 *
 * Transports: stdio by default; `--http [port]` serves Streamable HTTP on 127.0.0.1 only, with
 * Host and Origin checked, dual era (2026-07-28 and the 2025-era handshake).
 */
import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import { createApp } from '../../../src/api/app.mjs';
import * as S from '../../../src/api/schemas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const api = createApp({ out: process.env.HEATLOT_OUT ? path.resolve(process.env.HEATLOT_OUT) : undefined });

async function call(method, url) {
  const res = await api.request(url, { method });
  const body = await res.json();
  if (res.status !== 200) return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
}

const READ = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };

export function createServer() {
  const server = new McpServer(
    { name: 'heatlot', version: VERSION },
    { cacheHints: { 'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' }, 'server/discover': { ttlMs: 3_600_000, cacheScope: 'public' } } },
  );

  server.registerTool('packets.list', {
    title: 'List the receiving queue',
    description: 'Every inbound supplier packet with its PO, supplier and current status (received, quarantined, awaiting-release, released) and verdict.',
    inputSchema: z.strictObject({}),
    outputSchema: z.object({ packets: z.array(S.PacketSummary) }),
    annotations: READ,
  }, async () => call('GET', '/api/packets'));

  server.registerTool('packets.inspect', {
    title: 'Inspect a packet and cite why',
    description: 'Check a packet (certificate of conformance + mill test report) against its PO and specification. Returns the verdict (ACCEPT, INCOMPLETE, NONCONFORMING) and every finding with the document, page and line it rests on, plus any extracted value that was rejected and any hidden or instruction-shaped text. Appends signed receipts; never releases material.',
    inputSchema: z.strictObject({ packet: S.PacketId }),
    outputSchema: S.Inspection,
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ packet }) => call('POST', `/api/packets/${packet}/inspect`));

  server.registerTool('documents.lines', {
    title: "Read a document's text layer",
    description: 'The numbered lines of a packet document as read from its PDF text layer, each with its sha256, bounding box and a hidden flag for text set too small to see.',
    inputSchema: z.strictObject({ packet: S.PacketId, doc: S.DocName }),
    outputSchema: z.object({ packet: S.PacketId, doc: S.DocName, lines: z.array(S.Line) }),
    annotations: READ,
  }, async ({ packet, doc }) => call('GET', `/api/packets/${packet}/documents/${doc}/lines`));

  server.registerTool('receipts.verify', {
    title: "Verify a packet's receipts",
    description: "Recompute the packet's hash chain and check every Ed25519 signature. Returns the receipts and where the chain breaks, if it does.",
    inputSchema: z.strictObject({ packet: S.PacketId }),
    outputSchema: S.ReceiptChain,
    annotations: READ,
  }, async ({ packet }) => call('GET', `/api/packets/${packet}/receipts`));

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const httpFlag = process.argv.indexOf('--http');
  console.error(`heatlot MCP ${VERSION}`);
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
      console.log(`heatlot listening on http://127.0.0.1:${http.address().port}/mcp`);
    });
  }
}
