// Minimal newline-delimited JSON-RPC MCP server for the proxy tests: one read-only tool, one effect.
import { createInterface } from 'node:readline';
const tools = [
  { name: 'lookup_order', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
  { name: 'send_email', annotations: { readOnlyHint: false, destructiveHint: false }, inputSchema: { type: 'object' } },
];
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'tools/list') out({ jsonrpc: '2.0', id: m.id, result: { tools } });
  else if (m.method === 'tools/call') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `${m.params.name} ran` }], structuredContent: { ran: m.params.name, sawMeta: m.params._meta ?? null } } });
  else if (m.id !== undefined) out({ jsonrpc: '2.0', id: m.id, result: {} });
});
