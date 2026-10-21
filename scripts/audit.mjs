#!/usr/bin/env node
/**
 * audit.mjs — reconstruct a decision from receipts alone.
 *
 *   node scripts/audit.mjs --po PO-AER-5519
 *   node scripts/audit.mjs --tamper-check
 *
 * Replay reads the JSONL chain, verifies the hash links, and prints an ordered
 * account of context, decision, verdict, authorization, and effect. It never
 * consults a model, source documents, or the MCP server.
 *
 * --tamper-check copies a synthetic chain into scratch space, flips one byte,
 * re-verifies, and exits 0 only when the break is detected and named.
 * Real ledger files are not written.
 */
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { append, ledgerPath, openLedger, readChain, verifyChain } from '../src/ledger/index.mjs';
import {
  authorizationConsumed,
  contextAssembled,
  decisionFailed,
  decisionRequested,
  decisionReturned,
  tripwireFired,
  verdictRecorded,
} from '../src/ledger/receipts.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXIT = { OK: 0, FAIL: 1, USAGE: 2 };

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error('usage: node scripts/audit.mjs --po <PO>');
  console.error('       node scripts/audit.mjs --tamper-check');
  process.exitCode = EXIT.USAGE;
}

function parseArgs(argv) {
  let po = null;
  let tamper = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tamper-check') tamper = true;
    else if (arg === '--po') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) return { error: 'missing value for --po' };
      po = value;
    } else if (arg.startsWith('--')) return { error: `unknown flag: ${arg}` };
    else return { error: `unexpected argument: ${arg}` };
  }
  if (tamper && po) return { error: 'use --po or --tamper-check, not both' };
  if (!tamper && po === null) return { error: 'missing required --po <PO> (or pass --tamper-check)' };
  return { po, tamper };
}

function loadPolicyKinds() {
  const policy = JSON.parse(readFileSync(path.join(REPO_ROOT, 'policy', 'policy.json'), 'utf8'));
  if (!Array.isArray(policy?.ledger?.kinds)) {
    throw new Error('policy.ledger.kinds is missing');
  }
  return policy.ledger.kinds;
}

const STAGE_TITLES = {
  context_assembled: 'Context assembled',
  decision_requested: 'Decision requested',
  decision_returned: 'Decision returned',
  verdict: 'Verdict',
  authorization_minted: 'Authorization minted',
  authorization_consumed: 'Authorization consumed',
  decision_failed: 'Decision failed',
  effect_performed: 'Effect performed',
  effect_denied: 'Effect denied',
  tripwire_fired: 'Tripwire fired',
};

const PAYLOAD_BUILDERS = {
  context_assembled: contextAssembled,
  decision_requested: decisionRequested,
  decision_returned: decisionReturned,
  decision_failed: decisionFailed,
  authorization_consumed: authorizationConsumed,
  verdict: verdictRecorded,
  tripwire_fired: tripwireFired,
};

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dump(value) {
  return JSON.stringify(value, null, 2);
}

function receiptsOf(chain, kind) {
  return chain.filter((receipt) => receipt.kind === kind);
}

function receiptPayload(receipt) {
  const build = PAYLOAD_BUILDERS[receipt.kind];
  return build ? build(receipt.payload) : receipt.payload;
}

function accountLines(subject, verification, chain, kinds) {
  const lines = [];
  lines.push(`Audit replay — ${subject}`);
  lines.push(verification.ok
    ? `Chain: OK (${verification.length} receipt${verification.length === 1 ? '' : 's'})`
    : `Chain: BROKEN at index ${verification.brokenAt} — ${verification.reason}`);
  lines.push('');

  if (chain.length === 0) {
    lines.push('No receipts. Nothing to reconstruct.');
    return lines;
  }

  lines.push('Ordered receipts');
  for (const receipt of chain) {
    const title = STAGE_TITLES[receipt.kind] ?? receipt.kind;
    lines.push(`  seq ${receipt.seq}  ts_logical ${receipt.ts_logical}  ${title}`);
    lines.push(`    actor=${receipt.actor}  sha256=${receipt.sha256}`);
    const payload = dump(receiptPayload(receipt)).split('\n');
    for (const row of payload) lines.push(`    ${row}`);
    lines.push('');
  }

  lines.push('Reconstructed stages (from receipts alone)');
  for (const kind of kinds) {
    const title = STAGE_TITLES[kind] ?? kind;
    const matches = receiptsOf(chain, kind);
    if (matches.length === 0) {
      lines.push(`  ${title}: no receipt`);
      continue;
    }
    if (kind === 'context_assembled') {
      for (const receipt of matches) {
        const p = receiptPayload(receipt);
        const details = [];
        if (p.blocks !== undefined) details.push(`${p.blocks} blocks`);
        if (p.used_tokens !== undefined) details.push(`${p.used_tokens} tokens used`);
        lines.push(`  ${title}: ${details.length > 0 ? details.join(', ') : 'receipt present'}`);
        if (Array.isArray(p.untrusted) && p.untrusted.length > 0) {
          lines.push(`    untrusted: ${p.untrusted.join(', ')}`);
        }
      }
    } else if (kind === 'authorization_minted') {
      lines.push(`  ${title}: yes (${matches.length})`);
    } else if (kind === 'effect_denied') {
      for (const receipt of matches) {
        lines.push(`  ${title}: rule=${receipt.payload.rule ?? 'unspecified'} effect=${receipt.payload.effect_id ?? 'unspecified'}`);
      }
    } else if (kind === 'effect_performed') {
      for (const receipt of matches) {
        lines.push(`  ${title}: effect=${receipt.payload.effect_id ?? 'unspecified'} target=${receipt.payload.target ?? 'unspecified'}`);
      }
    } else if (kind === 'verdict') {
      for (const receipt of matches) {
        lines.push(`  ${title}: ${dump(receiptPayload(receipt))}`);
      }
    } else {
      lines.push(`  ${title}: ${matches.length} receipt${matches.length === 1 ? '' : 's'}`);
    }
  }
  return lines;
}

function renderHtml(subject, verification, chain, kinds, lines) {
  const statusClass = verification.ok ? 'ok' : 'broken';
  const status = verification.ok
    ? `Chain OK — ${verification.length} receipts`
    : `Chain BROKEN at index ${esc(verification.brokenAt)} — ${esc(verification.reason ?? '')}`;

  const rows = chain.map((receipt) => {
    const title = STAGE_TITLES[receipt.kind] ?? receipt.kind;
    return `<article class="receipt">
  <h3>seq ${esc(receipt.seq)} · ${esc(title)}</h3>
  <p class="meta">actor ${esc(receipt.actor)} · ts_logical ${esc(receipt.ts_logical)}</p>
  <p class="hash">sha256 ${esc(receipt.sha256)}</p>
  <p class="hash">prev ${esc(receipt.prev_sha256)}</p>
  <pre>${esc(dump(receiptPayload(receipt)))}</pre>
</article>`;
  }).join('\n');

  const stages = kinds.map((kind) => {
    const title = STAGE_TITLES[kind] ?? kind;
    const matches = receiptsOf(chain, kind);
    const body = matches.length === 0
      ? '<p class="missing">no receipt</p>'
      : `<pre>${esc(dump(matches.map(receiptPayload)))}</pre>`;
    return `<section><h3>${esc(title)}</h3>${body}</section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Audit ${esc(subject)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 16px/1.45 system-ui, sans-serif; margin: 2rem auto; max-width: 52rem; padding: 0 1rem; }
    h1, h2, h3 { font-weight: 650; }
    .banner { padding: 0.75rem 1rem; border-radius: 6px; margin: 1rem 0; }
    .ok { background: #d7f5d7; color: #0d3b0d; }
    .broken { background: #ffd6d6; color: #5c1010; }
    .receipt, section { border: 1px solid #8884; border-radius: 6px; padding: 0.75rem 1rem; margin: 0.75rem 0; }
    .meta, .hash, .missing { color: #555; font-size: 0.92rem; }
    .hash { font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
    pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Consolas, monospace; font-size: 0.85rem; }
    @media (prefers-color-scheme: dark) {
      .ok { background: #143d14; color: #c6f0c6; }
      .broken { background: #4a1515; color: #ffd0d0; }
    }
  </style>
</head>
<body>
  <h1>Audit replay — ${esc(subject)}</h1>
  <p class="banner ${statusClass}">${status}</p>
  <p>Reconstructed from receipts alone. No model, no source documents, no MCP server.</p>
  <h2>Ordered receipts</h2>
  ${rows || '<p class="missing">No receipts.</p>'}
  <h2>Stages</h2>
  ${stages}
  <h2>Text account</h2>
  <pre>${esc(lines.join('\n'))}</pre>
</body>
</html>
`;
}

function writeReport(subject, html) {
  const dir = path.join(REPO_ROOT, 'reports', 'audit');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${subject}.html`);
  writeFileSync(file, html, 'utf8');
  return file;
}

function flipOneByteInSha256(text) {
  const marker = '"sha256":"';
  const at = text.indexOf(marker);
  if (at === -1) throw new Error('scratch receipt has no sha256 field to flip');
  const pos = at + marker.length;
  const current = text[pos];
  if (!current) throw new Error('scratch receipt sha256 field is empty');
  const next = current === '0' ? '1' : '0';
  return { text: `${text.slice(0, pos)}${next}${text.slice(pos + 1)}`, pos };
}

function runTamperCheck() {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'heatlot-audit-tamper-'));
  const subject = 'TAMPER-CHECK';
  try {
    openLedger(subject, { ledgerRoot: scratch });
    append('verdict', 'audit-tamper', subject, { n: 1, note: 'genesis' }, { ledgerRoot: scratch });
    append('effect_denied', 'audit-tamper', subject, { n: 2, rule: 'tamper-demo' }, { ledgerRoot: scratch });
    const original = openLedger(subject, { ledgerRoot: scratch }).path;
    const before = verifyChain(subject, { ledgerRoot: scratch });
    if (!before.ok || before.length !== 2) {
      console.error(`tamper-check setup failed: chain was not valid (${dump(before)})`);
      process.exitCode = EXIT.FAIL;
      return;
    }

    const copyRoot = path.join(scratch, 'copy');
    const copyFile = ledgerPath(subject, { ledgerRoot: copyRoot });
    mkdirSync(path.dirname(copyFile), { recursive: true });
    copyFileSync(original, copyFile);
    const raw = readFileSync(copyFile, 'utf8');
    const flipped = flipOneByteInSha256(raw);
    writeFileSync(copyFile, flipped.text, 'utf8');

    const after = verifyChain(subject, { ledgerRoot: copyRoot });
    const detected = after.ok === false && Number.isInteger(after.brokenAt);
    console.log(`tamper-check: flipped 1 byte at offset ${flipped.pos} in a scratch copy`);
    console.log(`original: ok=${before.ok} length=${before.length}`);
    console.log(`tampered: ok=${after.ok} length=${after.length} brokenAt=${after.brokenAt} reason=${after.reason}`);
    if (detected) {
      console.log(`PASS: tampering detected at index ${after.brokenAt}`);
      process.exitCode = EXIT.OK;
    } else {
      console.error('FAIL: tampering was not detected');
      process.exitCode = EXIT.FAIL;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function runReplay(po) {
  let kinds;
  try {
    kinds = loadPolicyKinds();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = EXIT.USAGE;
    return;
  }

  const verification = verifyChain(po);
  let chain = [];
  try {
    chain = readChain(po);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = EXIT.FAIL;
    return;
  }

  const lines = accountLines(po, verification, chain, kinds);
  console.log(lines.join('\n'));

  const html = renderHtml(po, verification, chain, kinds, lines);
  const report = writeReport(po, html);
  console.log(`HTML ${path.relative(REPO_ROOT, report).replace(/\\/g, '/')}`);

  if (!verification.ok) {
    process.exitCode = EXIT.FAIL;
    return;
  }
  if (chain.length === 0) {
    console.error(`error: no receipts for ${po}`);
    process.exitCode = EXIT.FAIL;
    return;
  }
  process.exitCode = EXIT.OK;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    usage(parsed.error);
    return;
  }
  try {
    if (parsed.tamper) runTamperCheck();
    else runReplay(parsed.po);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = EXIT.FAIL;
  }
}

main();
