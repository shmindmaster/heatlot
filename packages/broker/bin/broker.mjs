#!/usr/bin/env node
/**
 * heatlot-broker keygen     --dir .heatlot
 * heatlot-broker approve    --dir .heatlot --tool send_email --args '{"to":"x@example.com"}' --by alice
 *                         [--untrusted <source>]...   (refused if any untrusted source fed the decision)
 * heatlot-broker verify     --dir .heatlot                (exit 0 verified, 1 broken)
 * heatlot-broker mcp-proxy  --dir .heatlot -- <command> [args...]
 *
 * Keys: <dir>/key.pem (private, Ed25519) and <dir>/key.pub.pem. The private key is read only by
 * the commands that sign receipts; `verify` needs only the public key.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HeatlotRefusal, Broker, untrusted } from '../src/broker.mjs';
import { generateKeys, keyId, verifyChain, Ledger } from '../src/receipts.mjs';
import { startProxy } from '../src/mcp-proxy.mjs';

const USAGE = 'usage: heatlot-broker <keygen|approve|verify|mcp-proxy> --dir <ledger dir> [options]';

function parse(argv) {
  const dash = argv.indexOf('--');
  const head = dash === -1 ? argv : argv.slice(0, dash);
  const opts = { _: [], untrusted: [], rest: dash === -1 ? [] : argv.slice(dash + 1) };
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const key = a.slice(2);
    const value = head[++i];
    if (value === undefined) throw new Error(`${a} needs a value`);
    if (key === 'untrusted') opts.untrusted.push(value); else opts[key] = value;
  }
  return opts;
}

const keyPaths = (dir) => ({ priv: path.join(dir, 'key.pem'), pub: path.join(dir, 'key.pub.pem') });

function loadBroker(dir) {
  const { priv, pub } = keyPaths(dir);
  if (!existsSync(priv)) throw new Error(`no signing key at ${priv}; run: heatlot-broker keygen --dir ${dir}`);
  return new Broker({ dir, privateKey: readFileSync(priv, 'utf8'), publicKey: existsSync(pub) ? readFileSync(pub, 'utf8') : undefined });
}

function main(argv) {
  const [command, ...rest] = argv;
  const opts = parse(rest);
  const dir = opts.dir ?? '.heatlot';
  switch (command) {
    case 'keygen': {
      const { priv, pub } = keyPaths(dir);
      if (existsSync(priv)) throw new Error(`${priv} already exists; refusing to overwrite a signing key`);
      mkdirSync(dir, { recursive: true });
      const keys = generateKeys();
      writeFileSync(priv, keys.privateKey, { mode: 0o600 });
      try { chmodSync(priv, 0o600); } catch { /* best effort on Windows */ }
      writeFileSync(pub, keys.publicKey);
      console.log(JSON.stringify({ key_id: keyId(keys.publicKey), private_key: priv, public_key: pub }));
      return 0;
    }
    case 'approve': {
      if (!opts.tool || !opts.by) throw new Error('approve needs --tool and --by');
      const payload = JSON.parse(opts.args ?? '{}');
      const inputs = opts.untrusted.map((source) => untrusted(source, { source }));
      const authorization = loadBroker(dir).approve(opts.tool, payload, { by: opts.by, inputs });
      console.log(JSON.stringify(authorization));
      return 0;
    }
    case 'verify': {
      const pub = opts.pub ?? keyPaths(dir).pub;
      const receipts = new Ledger(dir).read();
      const result = verifyChain(receipts, readFileSync(pub, 'utf8'));
      if (result.ok) { console.log(`verified: ${receipts.length} receipts, chain and signatures intact`); return 0; }
      console.log(`BROKEN at receipt ${result.brokenAt}: ${result.reason}; receipts ${result.brokenAt + 1}..${receipts.length - 1} are unverifiable`);
      return 1;
    }
    case 'mcp-proxy': {
      if (opts.rest.length === 0) throw new Error('mcp-proxy needs the upstream server command after --');
      const [cmd, ...cmdArgs] = opts.rest;
      const upstream = startProxy({ broker: loadBroker(dir), command: cmd, args: cmdArgs });
      upstream.on('exit', (code) => process.exit(code ?? 0));
      return null;
    }
    default:
      console.error(USAGE);
      return 2;
  }
}

try {
  const code = main(process.argv.slice(2));
  if (code !== null) process.exitCode = code;
} catch (error) {
  if (error instanceof HeatlotRefusal) { console.error(error.message); process.exitCode = 3; }
  else { console.error(`heatlot-broker: ${error.message}`); process.exitCode = 2; }
}
