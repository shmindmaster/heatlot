/**
 * A stdio MCP proxy that puts the broker in front of an existing MCP server.
 *
 *   heatlot-broker mcp-proxy --dir .heatlot --key .heatlot/key.pem -- node my-server.mjs
 *
 * Messages are relayed unchanged in both directions (newline-delimited JSON-RPC, both protocol
 * eras). A client message that is not a single JSON object (a batch array or a bare scalar) is
 * refused with a JSON-RPC error and never reaches the upstream server. Only `tools/call` is intercepted:
 *   - a tool whose tools/list annotations say readOnlyHint: true passes through, with a receipt;
 *   - any other tool (including one the proxy has not seen listed) needs an authorization from
 *     `heatlot-broker approve`, passed in params._meta["heatlot/authorization"]; it must match the
 *     tool and the exact arguments and be unused, or the client gets an isError result and the
 *     upstream server never sees the call.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { HeatlotRefusal } from './broker.mjs';

export const AUTH_META_KEY = 'heatlot/authorization';

export function startProxy({ broker, command, args = [], input = process.stdin, output = process.stdout, stderr = 'inherit' }) {
  const upstream = spawn(command, args, { stdio: ['pipe', 'pipe', stderr], windowsHide: true });
  const readOnly = new Map();          // tool name -> boolean, learned from tools/list results
  const pendingLists = new Set();      // ids of tools/list requests in flight
  const pendingCalls = new Map();      // id -> { tool, authorization } for authorized calls in flight
  const send = (message) => output.write(`${JSON.stringify(message)}\n`);

  createInterface({ input: upstream.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { output.write(`${line}\n`); return; }
    if (message.id !== undefined && pendingLists.has(message.id)) {
      pendingLists.delete(message.id);
      for (const tool of message.result?.tools ?? []) readOnly.set(tool.name, tool.annotations?.readOnlyHint === true);
    }
    if (message.id !== undefined && pendingCalls.has(message.id)) {
      const { tool, authorization } = pendingCalls.get(message.id);
      pendingCalls.delete(message.id);
      const failed = Boolean(message.error) || message.result?.isError === true;
      broker.recordOutcome(tool, authorization, failed ? { ok: false, error: message.error?.message ?? 'tool returned isError' } : { ok: true, result: message.result });
    }
    send(message);
  });

  createInterface({ input }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { upstream.stdin.write(`${line}\n`); return; }
    // Fail closed on any shape the proxy does not gate. A JSON-RPC batch (an array) has no
    // top-level method, so forwarding it would let a tools/call inside skip authorization and the
    // receipt. MCP removed batching in 2025-06-18; both revisions this repo serves (2025-11-25 and
    // 2026-07-28) post-date that, so a batch is refused rather than unpacked.
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: the broker proxy accepts single JSON-RPC request objects only, not batches' } });
      return;
    }
    if (message.method === 'tools/list' && message.id !== undefined) pendingLists.add(message.id);
    if (message.method === 'tools/call') {
      const tool = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (readOnly.get(tool) === true) {
        broker.recordRead(tool, args);
      } else {
        const meta = message.params?._meta ?? {};
        const authorization = meta[AUTH_META_KEY];
        try {
          broker.consume(tool, args, authorization);
        } catch (error) {
          if (!(error instanceof HeatlotRefusal)) throw error;
          send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: error.message }], isError: true } });
          return;
        }
        const { [AUTH_META_KEY]: _, ...rest } = meta;
        message.params = { ...message.params, _meta: Object.keys(rest).length ? rest : undefined };
        if (message.id !== undefined) pendingCalls.set(message.id, { tool, authorization });
      }
    }
    upstream.stdin.write(`${JSON.stringify(message)}\n`);
  }).on('close', () => upstream.stdin.end());

  return upstream;
}
