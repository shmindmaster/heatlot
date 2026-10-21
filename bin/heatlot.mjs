#!/usr/bin/env node
/**
 * heatlot demo                                        the hero packet, bundled: hidden text changes nothing
 * heatlot verify  <packet-dir> [--provider replay|reference] [--json] [--out .heatlot]
 *     Exit 0 ACCEPT, 3 INCOMPLETE, 4 NONCONFORMING.
 * heatlot approve <packet-dir> --by "<inspector>"     mint a single-use release authorization
 * heatlot release <packet-dir>                         release with the saved authorization (once)
 * heatlot receipts <packet-dir>                        verify the packet's signed receipt chain
 * heatlot serve [--port 4140] [--packets <dir>]        HTTP API on 127.0.0.1, docs at /docs/api
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyChain } from '../packages/broker/src/index.mjs';
import { BrokerRefusal, DEFAULT_OUT, approveRelease, brokerFor, inspect, latestInspection, release } from '../src/inspection/inspect.mjs';

const EXIT = { ACCEPT: 0, INCOMPLETE: 3, NONCONFORMING: 4 };
const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, yellow: (s) => s, dim: (s) => s, bold: (s) => s };

function parse(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (key === 'json') opts.json = true; else opts[key] = argv[++i];
    } else opts._.push(argv[i]);
  }
  return opts;
}

const where = (c) => `${c.doc} p${c.page} l${c.line}`;
const verdictColor = (v) => (v === 'ACCEPT' ? C.green : v === 'NONCONFORMING' ? C.red : C.yellow)(C.bold(v));

function printResult(r) {
  console.log(`${C.bold(r.packet)}  ${r.po.po}  ${r.po.item}`);
  console.log(`  spec ${r.po.spec} Rev ${r.po.spec_revision}   drawing ${r.po.drawing.number} Rev ${r.po.drawing.revision}`);
  console.log(`  model draft  ${r.extraction.draft_verdict ?? '—'} ${C.dim(`(${r.extraction.provenance?.kind ?? 'unknown'} extraction)`)}`);
  for (const u of r.untrusted) console.log(`  ${C.red('untrusted')}    ${where(u)} ${u.why}: "${u.text.slice(0, 70)}${u.text.length > 70 ? '…' : ''}"`);
  for (const x of r.rejected) console.log(`  ${C.red('rejected')}     ${x.document}.${x.field} = ${JSON.stringify(x.value)} cited ${where(x.cite)}: ${x.reason}`);
  console.log('');
  for (const f of r.findings) {
    const mark = f.status === 'pass' ? C.green('pass   ') : f.status === 'fail' ? C.red('FAIL   ') : C.yellow('MISSING');
    console.log(`  ${mark} ${f.rule.padEnd(40)} ${C.dim([...new Set(f.cites.map(where))].join('; '))}`);
    if (f.status !== 'pass') console.log(`          ${f.reason}`);
  }
  console.log('');
  console.log(`  verdict  ${verdictColor(r.verdict)}${r.reasons.length ? `  ${r.reasons.join(', ')}` : ''}`);
  console.log(r.ncr ? `  ${C.red('quarantined')}  ${r.ncr.id} opened` : '  awaiting release: heatlot approve <packet> --by "<inspector>"');
  console.log(`  receipts ${path.relative(process.cwd(), r.ledgerDir)}${path.sep}receipts.jsonl`);
}

async function main(argv) {
  const [command, ...rest] = argv;
  const opts = parse(rest);
  const out = opts.out ? path.resolve(opts.out) : DEFAULT_OUT;
  if (command === 'serve') {
    const { serve } = await import('@hono/node-server');
    const { createApp } = await import('../src/api/app.mjs');
    const port = Number(opts.port ?? 4140);
    const packetsRoot = opts.packets ? path.resolve(opts.packets) : undefined;
    serve({ fetch: createApp({ out, packetsRoot }).fetch, port, hostname: '127.0.0.1' }, (info) => {
      console.log(`heatlot API on http://127.0.0.1:${info.port}  ·  docs http://127.0.0.1:${info.port}/docs/api`);
    });
    return null;
  }
  if (command === 'demo') {
    const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'packets');
    console.log(C.bold('Heatlot demo') + C.dim('  synthetic data · no API key · no network'));
    console.log(C.dim('A PO for 4140 bar arrives with a certificate of conformance and a mill test report.'));
    console.log('');
    const r = await inspect(path.join(bundled, 'PKT-24002'), { out });
    printResult(r);
    console.log('');
    console.log(C.dim('The model drafted COMPLETE. A one-point white line in the PDF told it the test was waived.'));
    console.log(C.dim('The rules computed the verdict from what the visible lines support.'));
    console.log('');
    console.log(`Next: ${C.bold(`heatlot verify ${path.join(bundled, 'PKT-24002R')}`)} (the supplier's corrected resubmission), or ${C.bold('heatlot serve')} for the console and API.`);
    return EXIT[r.verdict];
  }
  const dir = opts._[0] && path.resolve(opts._[0]);
  if (!dir || !existsSync(path.join(dir, 'packet.json'))) {
    console.error('usage: heatlot demo | serve | <verify|approve|release|receipts> <packet-dir> [options]');
    return 2;
  }
  if (command === 'verify') {
    const r = await inspect(dir, { provider: opts.provider ?? 'replay', out });
    if (opts.json) console.log(JSON.stringify({ packet: r.packet, verdict: r.verdict, reasons: r.reasons, findings: r.findings, rejected: r.rejected, untrusted: r.untrusted.map(({ doc, page, line, text, why }) => ({ doc, page, line, text, why })), decision: r.decision, ncr: r.ncr }, null, 2));
    else printResult(r);
    return EXIT[r.verdict];
  }
  if (command === 'approve') {
    if (!opts.by) { console.error('approve needs --by "<inspector name>"'); return 2; }
    const manifest = JSON.parse(readFileSync(path.join(dir, 'packet.json'), 'utf8'));
    const r = latestInspection(manifest.packet, { out }) ?? await inspect(dir, { provider: opts.provider ?? 'replay', out });
    const authorization = approveRelease(r, { by: opts.by });
    writeFileSync(path.join(r.ledgerDir, 'authorization.json'), `${JSON.stringify(authorization, null, 2)}\n`);
    console.log(`authorized: ${r.packet} release by ${opts.by}, single use, bound to decision ${authorization.payload_sha256.slice(0, 12)}…`);
    return 0;
  }
  if (command === 'release') {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'packet.json'), 'utf8'));
    const r = latestInspection(manifest.packet, { out });
    if (!r) { console.error(`${manifest.packet} has not been inspected: heatlot verify first`); return 2; }
    const file = path.join(r.ledgerDir, 'authorization.json');
    const authorization = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
    const record = await release(r, authorization);
    console.log(`${C.green('released')} ${record.packet} (${record.po})`);
    return 0;
  }
  if (command === 'receipts') {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'packet.json'), 'utf8'));
    const broker = brokerFor(manifest.packet, { out });
    const receipts = broker.ledger.read();
    const result = verifyChain(receipts, broker.ledger.publicKey);
    for (const r of receipts) console.log(`  ${String(r.seq).padStart(3)}  ${r.kind.padEnd(22)} ${C.dim(r.receipt_sha256.slice(0, 16))}`);
    console.log(result.ok ? C.green(`verified: ${receipts.length} receipts, chain and signatures intact`) : C.red(`BROKEN at receipt ${result.brokenAt}: ${result.reason}`));
    return result.ok ? 0 : 1;
  }
  console.error(`unknown command: ${command}`);
  return 2;
}

main(process.argv.slice(2)).then((code) => { if (code !== null) process.exitCode = code; }).catch((error) => {
  if (error instanceof BrokerRefusal) { console.error(C.red(error.message)); process.exitCode = 5; }
  else { console.error(`heatlot: ${error.message}`); process.exitCode = 2; }
});
