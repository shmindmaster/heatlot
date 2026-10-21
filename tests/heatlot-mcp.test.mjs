import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp-servers', 'heatlot', 'src', 'server.mjs');

async function connect(options) {
  const client = new Client({ name: 'heatlot-test', version: '1' }, options);
  const env = { ...process.env, HEATLOT_OUT: mkdtempSync(path.join(tmpdir(), 'heatlot-mcp-')) };
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env, stderr: 'ignore' }));
  return client;
}

test('heatlot mcp: both protocol eras, four strict and annotated tools, no release tool', async () => {
  for (const [options, era] of [[{ versionNegotiation: { mode: 'auto' } }, 'modern'], [{}, 'legacy']]) {
    const client = await connect(options);
    try {
      assert.equal(client.getProtocolEra(), era);
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ['documents.lines', 'packets.inspect', 'packets.list', 'receipts.verify']);
      assert.ok(tools.every((t) => t.inputSchema.additionalProperties === false && t.outputSchema && t.title));
      assert.ok(!tools.some((t) => /release|approve/.test(t.name)), 'release is a human decision, never an MCP tool');
      assert.deepEqual(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name), ['packets.inspect']);
    } finally { await client.close(); }
  }
});

test('heatlot mcp: inspect cites why, and an unknown argument is refused', async () => {
  const client = await connect({ versionNegotiation: { mode: 'auto' } });
  try {
    const r = await client.callTool({ name: 'packets.inspect', arguments: { packet: 'PKT-24002' } });
    assert.equal(r.structuredContent.verdict, 'INCOMPLETE');
    assert.equal(r.structuredContent.rejected[0].reason, 'cited-line-hidden');
    assert.ok(r.structuredContent.findings.every((f) => f.status !== 'pass' || f.cites.length > 0), 'every passing finding is cited');
    let typo;
    try { typo = await client.callTool({ name: 'packets.inspect', arguments: { packet: 'PKT-24002', force: true } }); } catch { typo = { isError: true }; }
    assert.equal(typo.isError, true);
  } finally { await client.close(); }
});
