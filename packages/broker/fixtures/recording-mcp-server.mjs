// Records every line it receives to the file named in argv[2], then answers tools/list and requests
// by id, so a test can prove which messages the proxy let through to the upstream server.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const log = process.argv[2];
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  appendFileSync(log, `${line}\n`);
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m && !Array.isArray(m) && m.id !== undefined) out({ jsonrpc: '2.0', id: m.id, result: m.method === 'tools/list' ? { tools: [] } : {} });
});
