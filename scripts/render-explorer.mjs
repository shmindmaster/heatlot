#!/usr/bin/env node
/**
 * npm run explorer — render the Receipt Explorer.
 *
 * One self-contained, offline HTML file over the hash-chained ledger: every
 * receipt as a tag on a chain, the hashes that link them, the context the agent
 * saw with its trust labels, the verdict inputs, and the provenance of each
 * decision. "Tamper one byte" flips a single byte in a receipt and re-verifies
 * in the page; the chain turns red at the link that broke and everything after
 * it becomes unverifiable.
 *
 * The in-page verifier is src/explorer/chain.mjs, inlined. tests/explorer.test.mjs
 * proves it reaches the same verdict as src/ledger on real and tampered chains.
 *
 * Usage:
 *   npm run demo && npm run explorer        # replay ledger + recorded live run
 *   npm run explorer -- --ledger <file.jsonl> [--ledger <file>] [--out <file>]
 *
 * Deterministic: no timestamps, no network references. Output defaults to
 * reports/explorer/index.html (gitignored); open it straight from disk.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assemble } from '../src/context/assembler.mjs';
import { ledgerPath, splitJsonl } from '../src/ledger/index.mjs';
import { verifyCompleteness } from './verify-completeness.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHAIN_MODULE = path.join(REPO_ROOT, 'src', 'explorer', 'chain.mjs');
const DEFAULT_OUT = path.join(REPO_ROOT, 'reports', 'explorer', 'index.html');
const SUBJECT = 'PO-AER-5519';
const TASK =
  'Assemble the cert-of-conformance package for PO-AER-5519 and tell me whether it is complete. ' +
  'If any required record is not on file, report it as missing — never fabricate one.';

const DEFAULT_SOURCES = [
  { id: 'replay', title: 'Replay demo', note: 'npm run demo — recorded model response', file: ledgerPath(SUBJECT) },
  { id: 'live', title: 'Live run, Claude Sonnet 5.5', note: 'npm run verify:live — 2026-10-14', file: path.join(REPO_ROOT, 'docs', 'evidence', 'live-run-2026-10-14', `${SUBJECT}.anthropic.jsonl`) },
  { id: 'live-openai', title: 'Live run, OpenAI', note: 'HEATLOT_PROVIDER=openai npm run verify:live — 2026-10-15', file: path.join(REPO_ROOT, 'docs', 'evidence', 'live-run-2026-10-15-openai', `${SUBJECT}.openai.jsonl`) },
];

function rel(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

/** The context bundle and verdict inputs for the subject, computed without touching the repo ledger. */
export function buildContext() {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'heatlot-explorer-context-'));
  try {
    const bundle = assemble({ agent: 'coc-assembler', task: TASK, entityRefs: { po: SUBJECT } }, { ledgerRoot: scratch });
    const verifier = verifyCompleteness(SUBJECT);
    return {
      subject: SUBJECT,
      budget_tokens: bundle.budget_tokens,
      used_tokens: bundle.used_tokens,
      bundle_sha256: bundle.sha256,
      blocks: bundle.blocks.filter((b) => b.source !== 'task').map((b) => ({
        source: b.source,
        reason: b.reason,
        trust: b.trust,
        tokens: b.tokens,
        sha256: b.sha256,
        fired: (b.fired ?? []).map((f) => f.id ?? String(f)),
        excerpt: b.trust === 'untrusted' ? fromLastHeading(b.text) : null,
      })),
      verdict: {
        outcome: verifier.status.toUpperCase(),
        missing_records: verifier.missing_records,
        items: verifier.items.map((item) => ({
          type: item.type, expected_path: item.expected_path, on_file: item.on_file, sha256: item.sha256,
        })),
      },
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Untrusted blocks are shown from their last markdown heading, where an appended
// note (the usual shape of an injected instruction) starts; the whole block is
// still one click away in the source file.
function fromLastHeading(text) {
  const trimmed = text.trim();
  const at = trimmed.lastIndexOf('\n## ');
  return at === -1 ? trimmed : trimmed.slice(at + 1);
}

function inlineChainModule() {
  return readFileSync(CHAIN_MODULE, 'utf8').replace(/^export /gm, '');
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * Read a ledger file into the lines the page verifies, split exactly as src/ledger splits them.
 * Dropping empty lines here would let the page show a green chain the broker refuses.
 */
export function loadLedgerLines(file) {
  return splitJsonl(readFileSync(file, 'utf8'));
}

export function renderExplorer({ sources, context }) {
  const policy = JSON.parse(readFileSync(path.join(REPO_ROOT, 'policy', 'policy.json'), 'utf8'));
  const ledgers = sources.map((source) => {
    const lines = loadLedgerLines(source.file);
    let first = {};
    try { first = lines.length ? JSON.parse(lines[0]) : {}; } catch { /* the page reports the malformed line */ }
    return { id: source.id, title: source.title, note: source.note ?? rel(source.file), file: rel(source.file), subject: first.subject ?? null, lines };
  });
  const data = { kinds: policy.ledger.kinds, ledgers, context };
  return PAGE
    .replace('/*__CHAIN__*/', () => inlineChainModule())
    .replace('"__DATA__"', () => jsonForScript(data));
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Heatlot Receipt Explorer: the hash-chained decision ledger, verified in the page.">
<title>Heatlot Receipt Explorer</title>
<style>
:root {
  --paper: #e8ebed; --panel: #f6f7f8; --ink: #1a1f24; --muted: #59636c; --rule: #c9d0d5;
  --tag: #c99a2e; --tag-ink: #2b2208; --tag-face: #f3e3b8;
  --ok: #2e8b74; --ok-soft: #d6ece5; --bad: #b23a24; --bad-soft: #f4d9d2; --dim: #9aa4ac;
  --untrusted: #b23a24; --focus: #1f6fb2;
  --ui: "Bahnschrift", "DIN Alternate", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif;
  --mono: "Cascadia Mono", "SF Mono", ui-monospace, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #161c21; --panel: #1e262d; --ink: #e6eaed; --muted: #95a1ab; --rule: #2f3a43;
    --tag: #d8a93c; --tag-ink: #1d1604; --tag-face: #3a3018;
    --ok: #4fb89a; --ok-soft: #173229; --bad: #e0634a; --bad-soft: #3a1c16; --dim: #56626c;
    --untrusted: #e0634a; --focus: #6fb0ea; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --paper: #161c21; --panel: #1e262d; --ink: #e6eaed; --muted: #95a1ab; --rule: #2f3a43;
  --tag: #d8a93c; --tag-ink: #1d1604; --tag-face: #3a3018;
  --ok: #4fb89a; --ok-soft: #173229; --bad: #e0634a; --bad-soft: #3a1c16; --dim: #56626c;
  --untrusted: #e0634a; --focus: #6fb0ea; color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--ui); font-size: 16px; line-height: 1.45; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.mono { font-family: var(--mono); font-size: 0.82rem; }

header { display: grid; grid-template-columns: auto 1fr auto; gap: 28px; align-items: center; padding: 18px 28px; border-bottom: 1px solid var(--rule); }
.mark { font-size: 1.05rem; letter-spacing: 0.01em; }
.mark b { font-weight: 700; font-size: 1.35rem; margin-right: 8px; }
.sources { display: flex; gap: 6px; flex-wrap: wrap; }
.sources button { background: transparent; border: 1px solid var(--rule); border-radius: 999px; padding: 6px 14px; cursor: pointer; color: var(--muted); }
.sources button[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.seal { display: flex; align-items: center; gap: 14px; padding: 10px 18px 10px 12px; border-radius: 10px; border: 2px solid var(--ok); background: var(--ok-soft); min-width: 360px; transition: background .25s, border-color .25s; }
.seal svg { flex: none; }
.seal strong { display: block; font-size: 1.25rem; line-height: 1.1; }
.seal span { color: var(--muted); font-size: 0.9rem; }
.seal.broken { border-color: var(--bad); background: var(--bad-soft); }
.seal.broken strong { color: var(--bad); }

main { display: grid; grid-template-columns: 340px minmax(0, 1fr) 430px; gap: 0; height: calc(100vh - 77px); }
main > section { overflow: auto; padding: 22px 26px 120px; }
main > section + section { border-left: 1px solid var(--rule); }
h2 { font-size: 1.05rem; font-weight: 600; margin: 0 0 4px; }
.sub { color: var(--muted); font-size: 0.9rem; margin: 0 0 18px; }

/* The chain: tags joined by drawn links. */
.chain { list-style: none; margin: 0; padding: 0; }
.chain li { position: relative; }
.link { display: block; height: 30px; margin-left: 22px; }
.link path { fill: none; stroke: var(--ok); stroke-width: 3.2; transition: stroke .25s; }
.chain li.broken .link path { stroke: var(--bad); stroke-dasharray: 4 5; }
.chain li.unverified .link path { stroke: var(--dim); }
.tag { width: 100%; display: grid; grid-template-columns: 40px 1fr; gap: 12px; align-items: center; text-align: left; cursor: pointer;
  background: var(--tag-face); border: 1.5px solid var(--tag); border-radius: 6px 14px 14px 6px; padding: 10px 12px; }
.tag .hole { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--tag); background: var(--paper); display: grid; place-items: center; font-weight: 700; font-size: 0.95rem; color: var(--ink); }
.tag .kind { font-weight: 600; font-size: 1rem; display: block; }
.tag .meta { color: var(--muted); font-size: 0.82rem; display: block; }
.tag[aria-current="true"] { box-shadow: 0 0 0 3px var(--ink); }
li.broken .tag { background: var(--bad-soft); border-color: var(--bad); }
li.broken .tag .hole { border-color: var(--bad); color: var(--bad); }
li.unverified .tag { background: transparent; border-color: var(--dim); border-style: dashed; }
li.unverified .tag .hole { border-color: var(--dim); color: var(--dim); }
.status-word { font-size: 0.78rem; font-weight: 600; }
li.verified .status-word { color: var(--ok); }
li.broken .status-word { color: var(--bad); }
li.unverified .status-word { color: var(--muted); }

/* Detail */
.receipt-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 4px; }
.receipt-head h1 { font-size: 2rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.receipt-head .who { color: var(--muted); }
.hashes { display: grid; grid-template-columns: 150px 1fr; gap: 6px 16px; margin: 18px 0 22px; padding: 14px 16px; background: var(--panel); border-radius: 8px; }
.hashes dt { color: var(--muted); font-size: 0.9rem; }
.hashes dd { margin: 0; overflow-wrap: anywhere; }
.hashes dd.bad { color: var(--bad); }
.hashes dd .expected { display: block; color: var(--muted); }
.raw { background: var(--panel); border-radius: 8px; padding: 14px 16px; overflow-wrap: anywhere; white-space: pre-wrap; margin: 0 0 22px; max-height: 190px; overflow: auto; }
.raw mark { background: var(--bad); color: #fff; padding: 0 2px; border-radius: 2px; }
pre.payload { background: var(--panel); border-radius: 8px; padding: 14px 16px; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.prov { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; margin: 0 0 22px; }
.prov div { background: var(--panel); padding: 10px 12px; }
.prov dt { color: var(--muted); font-size: 0.8rem; }
.prov dd { margin: 2px 0 0; font-size: 1.05rem; font-weight: 600; overflow-wrap: anywhere; }
h3 { font-size: 0.95rem; font-weight: 600; margin: 0 0 8px; color: var(--muted); }

.actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 0 0 18px; margin-bottom: 18px; border-bottom: 1px solid var(--rule); }
.btn { border: 2px solid var(--ink); background: var(--ink); color: var(--paper); padding: 10px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; }
.btn.ghost { background: transparent; color: var(--ink); }
.btn.danger { border-color: var(--bad); background: var(--bad); color: #fff; }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.readout { color: var(--muted); font-size: 0.95rem; }
.readout strong { color: var(--bad); }

/* Context */
.blocks { list-style: none; margin: 0 0 26px; padding: 0; display: grid; gap: 8px; }
.block { border: 1px solid var(--rule); border-radius: 8px; padding: 7px 10px; background: var(--panel); }
.blocks { gap: 6px; }
.block .src { font-family: var(--mono); font-size: 0.8rem; overflow-wrap: anywhere; }
.block .why { color: var(--muted); font-size: 0.85rem; }
.trust { float: right; font-size: 0.78rem; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--ok); color: var(--ok); margin-left: 8px; }
.block.untrusted { border-color: var(--untrusted); border-width: 2px; }
.block.untrusted .trust { border-color: var(--untrusted); color: var(--untrusted); }
.excerpt { margin: 8px 0 0; padding: 8px 10px; border-left: 3px solid var(--untrusted); font-family: var(--mono); font-size: 0.76rem; white-space: pre-wrap; color: var(--ink); max-height: 210px; overflow: auto; }
.items { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.items li { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; padding: 8px 10px; border-radius: 6px; background: var(--panel); }
.items .type { font-weight: 600; }
.items .state { font-size: 0.85rem; font-weight: 600; color: var(--ok); }
.items li.missing { outline: 2px solid var(--bad); }
.items li.missing .state { color: var(--bad); }
.items .h { grid-column: 1 / -1; color: var(--muted); }
.outcome { font-size: 1.6rem; font-weight: 700; margin: 4px 0 12px; }
.outcome.incomplete { color: var(--bad); }
.outcome.complete { color: var(--ok); }
.synthetic { margin-top: 26px; color: var(--muted); font-size: 0.85rem; }

@media (max-width: 1100px) {
  main { grid-template-columns: 1fr; height: auto; }
  main > section { padding-bottom: 40px; }
  main > section + section { border-left: 0; border-top: 1px solid var(--rule); }
  header { grid-template-columns: 1fr; }
  .seal { min-width: 0; }
  .prov { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<header>
  <div class="mark"><b>Heatlot</b>Receipt Explorer</div>
  <nav class="sources" aria-label="Ledger"></nav>
  <div class="seal" role="status" aria-live="polite" id="seal"></div>
</header>
<main>
  <section aria-labelledby="chain-h">
    <h2 id="chain-h">Receipt chain</h2>
    <p class="sub" id="chain-sub"></p>
    <ol class="chain" id="chain"></ol>
  </section>
  <section aria-labelledby="detail-h" id="detail-wrap">
    <div class="actions">
      <button class="btn danger" id="tamper" type="button">Tamper one byte</button>
      <button class="btn ghost" id="restore" type="button" disabled>Restore original</button>
      <span class="readout" id="readout">Pick a receipt, then change a single byte of it.</span>
    </div>
    <div id="detail"></div>
  </section>
  <section aria-labelledby="ctx-h" id="context"></section>
</main>
<script type="application/json" id="data">"__DATA__"</script>
<script>
/*__CHAIN__*/

const DATA = JSON.parse(document.getElementById('data').textContent);
const params = new URLSearchParams(location.search);
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');
const TITLES = {
  context_assembled: 'Context assembled', decision_requested: 'Decision requested', decision_returned: 'Model decision',
  decision_failed: 'Model call failed', verdict: 'Verdict computed', authorization_minted: 'Authorization minted',
  authorization_consumed: 'Authorization used', effect_performed: 'Effect performed', effect_denied: 'Effect denied',
  tripwire_fired: 'Tripwire fired',
};
const state = { ledger: null, lines: [], original: [], selected: 0, tamper: null };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (h) => (typeof h === 'string' ? h.slice(0, 12) + '…' : '—');

function headline(receipt) {
  const p = receipt?.payload ?? {};
  switch (receipt?.kind) {
    case 'decision_returned': return 'model says ' + String(p.status ?? '?').toUpperCase();
    case 'verdict': return 'code says ' + (p.outcome ?? '?');
    case 'effect_denied': return 'refused: ' + (p.rule ?? '?');
    case 'effect_performed': return 'published ' + (p.target ?? '');
    case 'tripwire_fired': return (p.source ?? '').split('/').pop() + ' marked untrusted';
    case 'decision_failed': return p.error ?? 'model call failed';
    default: return receipt?.actor ?? '';
  }
}

function selectLedger(id) {
  state.ledger = DATA.ledgers.find((l) => l.id === id);
  state.lines = [...state.ledger.lines];
  state.original = [...state.ledger.lines];
  state.tamper = null;
  const verdictIndex = state.lines.findIndex((l) => l.includes('"kind":"decision_returned"'));
  state.selected = verdictIndex >= 0 ? verdictIndex : 0;
  document.querySelectorAll('.sources button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
  render();
}

function render() {
  const result = verifyLines(state.lines, { subject: state.ledger.subject, kinds: DATA.kinds });
  renderSeal(result);
  renderChain(result);
  renderDetail(result);
  $('restore').disabled = !state.tamper;
  $('tamper').disabled = !!state.tamper;
}

function renderSeal(result) {
  const seal = $('seal');
  seal.classList.toggle('broken', !result.ok);
  const icon = result.ok
    ? '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="none" stroke="var(--ok)" stroke-width="3"/><path d="M10 17.5l5 5 9-11" fill="none" stroke="var(--ok)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="none" stroke="var(--bad)" stroke-width="3"/><path d="M11 11l12 12M23 11L11 23" stroke="var(--bad)" stroke-width="3.4" stroke-linecap="round"/></svg>';
  seal.innerHTML = icon + (result.ok
    ? '<div><strong>Chain verified</strong><span>' + result.length + ' of ' + result.length + ' links recomputed in this page</span></div>'
    : '<div><strong>Chain broken at receipt ' + (result.brokenAt + 1) + '</strong><span>' + esc(result.reason.replace(/ at index \\d+$/, '')) + '; ' + (result.length - result.brokenAt - 1) + ' later receipts unverifiable</span></div>');
}

function renderChain(result) {
  $('chain-sub').innerHTML = esc(state.ledger.note) + '<br><span class="mono">' + esc(state.ledger.file) + '</span>';
  $('chain').innerHTML = result.links.map((link, i) => {
    const r = link.receipt;
    const word = { verified: 'linked', broken: 'broken link', unverified: 'unverifiable' }[link.status];
    const connector = i === 0 ? '' : '<svg class="link" viewBox="0 0 40 30" width="40" height="30" aria-hidden="true"><path d="M14 2 q-6 7 0 13 M26 2 q6 7 0 13 M14 15 q-6 7 0 13 M26 15 q6 7 0 13"/></svg>';
    return '<li class="' + link.status + '">' + connector +
      '<button class="tag" type="button" data-i="' + i + '"' + (i === state.selected ? ' aria-current="true"' : '') + '>' +
      '<span class="hole">' + (r?.seq ?? i + 1) + '</span>' +
      '<span><span class="kind">' + esc(TITLES[r?.kind] ?? r?.kind ?? 'unreadable') + '</span>' +
      '<span class="meta">' + esc(headline(r)) + '</span>' +
      '<span class="status-word">' + word + '</span></span></button></li>';
  }).join('');
  document.querySelectorAll('.tag').forEach((b) => b.addEventListener('click', () => { state.selected = Number(b.dataset.i); render(); }));
}

function hashRow(label, stored, recomputed) {
  const bad = recomputed !== undefined && recomputed !== null && stored !== recomputed;
  return '<dt>' + label + '</dt><dd class="mono' + (bad ? ' bad' : '') + '">' + esc(stored ?? '—') +
    (bad ? '<span class="expected">recomputed ' + esc(recomputed) + '</span>' : '') + '</dd>';
}

function provenanceBlock(p) {
  if (!p) return '';
  if (p.provider === 'replay') {
    return '<h3>Who produced this decision</h3><dl class="prov"><div><dt>Provider</dt><dd>Replay fixture</dd></div>' +
      '<div style="grid-column: span 3"><dt>Fixture key</dt><dd class="mono">' + esc(p.fixture_key) + '</dd></div></dl>';
  }
  const cell = (k, v) => '<div><dt>' + k + '</dt><dd>' + esc(v ?? '—') + '</dd></div>';
  // Anthropic receipts carry effort, tool choice and fallback; OpenAI receipts carry the response format.
  const openai = p.provider === 'openai';
  return '<h3>Who produced this decision</h3><dl class="prov">' +
    cell('Model served', p.model_served) + (openai ? cell('Provider', 'OpenAI') : cell('Effort', p.effort)) +
    cell('Tokens in / out', (p.input_tokens ?? '—') + ' / ' + (p.output_tokens ?? '—')) +
    cell('Latency', p.latency_ms != null ? (p.latency_ms / 1000).toFixed(1) + ' s' : '—') +
    (openai ? cell('Output', (p.response_format ?? '') + (p.strict ? ', strict' : '')) : cell('Tool call', (p.tool_choice ?? '') + (p.strict ? ', strict' : ''))) +
    cell('Stop reason', p.stop_reason) +
    (openai ? cell('Retries', 'none') : cell('Fallback used', p.fallback_ran ? 'yes' : 'no')) +
    '<div><dt>Request id</dt><dd class="mono" style="font-size:.78rem">' + esc(p.request_id ?? '—') + '</dd></div></dl>';
}

function renderDetail(result) {
  const link = result.links[state.selected];
  const r = link.receipt;
  const line = state.lines[state.selected];
  let raw = esc(line);
  if (state.tamper && state.tamper.index === state.selected) {
    const o = state.tamper.offset;
    raw = esc(line.slice(0, o)) + '<mark>' + esc(line[o]) + '</mark>' + esc(line.slice(o + 1));
  }
  const prev = state.selected > 0 ? result.links[state.selected - 1].receipt?.sha256 : '0'.repeat(64);
  const rec = link.recomputed ?? {};
  $('detail').innerHTML =
    '<div class="receipt-head"><h1 id="detail-h">' + esc(TITLES[r?.kind] ?? 'Unreadable receipt') + '</h1>' +
    '<span class="who">receipt ' + (state.selected + 1) + ', written by ' + esc(r?.actor ?? 'unknown') + '</span></div>' +
    '<dl class="hashes">' +
      hashRow('Previous link', r?.prev_sha256, link.status === 'broken' ? (rec.prev_sha256 ?? prev) : undefined) +
      hashRow('Payload hash', r?.payload_sha256, rec.payload_sha256) +
      hashRow('Receipt hash', r?.sha256, rec.sha256) +
    '</dl>' +
    (r?.payload?.provenance ? provenanceBlock(r.payload.provenance) : '') +
    '<h3>Receipt as stored</h3><div class="raw mono">' + raw + '</div>' +
    '<h3>Payload</h3><pre class="payload mono">' + esc(JSON.stringify(r?.payload ?? null, null, 2)) + '</pre>';
}

function renderContext() {
  const c = DATA.context;
  if (!c) { $('context').innerHTML = '<h2 id="ctx-h">Context</h2><p class="sub">No context bundle in this render.</p>'; return; }
  const blocks = c.blocks.map((b) =>
    '<li class="block ' + b.trust + '"><span class="trust">' + (b.trust === 'untrusted' ? 'Untrusted' : 'Trusted') + '</span>' +
    '<div class="src">' + esc(b.source) + '</div>' +
    (b.trust === 'untrusted' ? '<div class="why">' + esc(b.reason) + ', ' + b.tokens + ' tokens, tripwire ' + esc(b.fired.join(', ') || 'fired') + '</div>' : '') +
    (b.trust === 'untrusted' ? '<div class="excerpt">' + esc(b.excerpt) + '</div>' : '') + '</li>').join('');
  const items = c.verdict.items.map((it) =>
    '<li class="' + (it.on_file ? '' : 'missing') + '"><span class="type">' + esc(it.type) + '</span>' +
    '<span class="state">' + (it.on_file ? 'on file' : 'not on file') + '</span>' +
    '<span class="h mono">' + (it.sha256 ? short(it.sha256) : esc(it.expected_path)) + '</span></li>').join('');
  $('context').innerHTML =
    '<h2 id="ctx-h">What the agent saw</h2><p class="sub">' + c.blocks.length + ' blocks, ' + c.used_tokens + ' of ' + c.budget_tokens + ' tokens. Untrusted blocks are labelled, not stripped.</p>' +
    '<ul class="blocks">' + blocks + '</ul>' +
    '<h2>What the files say</h2><p class="sub">The verifier resolves every required record against data/index.json.</p>' +
    '<div class="outcome ' + c.verdict.outcome.toLowerCase() + '">' + c.verdict.outcome + '</div>' +
    '<ul class="items">' + items + '</ul>' +
    '<p class="synthetic">Kestrel Castings is fictional. Every record here is synthetic.</p>';
}

$('tamper').addEventListener('click', () => {
  const i = state.selected;
  const flip = tamperOneByte(state.lines[i]);
  state.lines[i] = flip.line;
  state.tamper = { index: i, offset: flip.offset };
  render();
  $('readout').innerHTML = 'Changed byte ' + flip.offset + ' of receipt ' + (i + 1) + ': <strong>' + esc(flip.before) + '</strong> to <strong>' + esc(flip.after) + '</strong>';
});
$('restore').addEventListener('click', () => {
  state.lines = [...state.original];
  state.tamper = null;
  render();
  $('readout').textContent = 'Restored. Every link recomputes again.';
});

document.querySelector('.sources').innerHTML = DATA.ledgers.map((l) =>
  '<button type="button" data-id="' + esc(l.id) + '" aria-pressed="false">' + esc(l.title) + '</button>').join('');
document.querySelectorAll('.sources button').forEach((b) => b.addEventListener('click', () => selectLedger(b.dataset.id)));
renderContext();
selectLedger(params.get('ledger') && DATA.ledgers.some((l) => l.id === params.get('ledger')) ? params.get('ledger') : DATA.ledgers[0].id);
</script>
</body>
</html>
`;

function parseArgs(argv) {
  const ledgers = [];
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ledger' && argv[i + 1]) ledgers.push(path.resolve(argv[++i]));
    else if (argv[i] === '--out' && argv[i + 1]) out = path.resolve(argv[++i]);
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  return { ledgers, out };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const sources = args.ledgers.length
    ? args.ledgers.map((file, i) => ({ id: `ledger-${i + 1}`, title: path.basename(file, '.jsonl'), file }))
    : DEFAULT_SOURCES.filter((source) => existsSync(source.file));
  const missing = args.ledgers.filter((file) => !existsSync(file));
  if (missing.length) {
    console.error(`no such ledger: ${missing.join(', ')}`);
    process.exit(2);
  }
  if (sources.length === 0) {
    console.error(`no ledger to show. Run \`npm run demo\` first, or pass --ledger <file.jsonl>.`);
    process.exit(2);
  }
  const html = renderExplorer({ sources, context: buildContext() });
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, html);
  console.log(`Receipt Explorer: ${rel(args.out)}  (${sources.map((s) => s.title).join(', ')})`);
  console.log(`Open it from disk: ${pathToFileURL(args.out).href}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
