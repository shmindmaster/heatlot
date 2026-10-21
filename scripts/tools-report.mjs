#!/usr/bin/env node
/**
 * tools:report — per MCP tool in mcp-servers/kestrel-foundry-data/:
 *   input schema, median response token cost against fixtures/provider,
 *   and the eval case that exercises it.
 *
 * Ends with "Tools deliberately not added, and why".
 *
 *   npm run tools:report
 *   npm run tools:report -- --provider openai
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFunctionDefinition } from '../src/providers/openai.mjs';
import { listToolFixtures } from '../src/providers/replay.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The tool inventory is the live server's tools/list result, snapshotted by `npm run docs:reference`
// into catalog.json (CI fails if it drifts from the server). Nothing here restates a schema; the only
// local fact is which eval case exercises each tool.
const CATALOG = JSON.parse(readFileSync(path.join(REPO_ROOT, 'mcp-servers', 'kestrel-foundry-data', 'catalog.json'), 'utf8'));
const EVAL_CASES = {
  list_ncrs: 'ncr-0114-repeat-offender',
  get_ncr: 'ncr-0114-repeat-offender',
  get_heat_lot: 'coc-po-aer-5519-refusal',
  get_test_record: 'coc-po-aer-5519-refusal',
  search_documents: 'dataset-truths',
  get_document: 'ncr-0114-repeat-offender',
  list_cert_requirements: 'coc-po-aer-5519-refusal',
  get_purchase_order: 'coc-po-aer-5519-refusal',
  get_scrap_records: 'scrap-top-mover',
  get_audit_scope: 'audit-gaps',
};
const TOOLS = CATALOG.tools.map((t) => {
  if (!EVAL_CASES[t.name]) throw new Error(`tool ${t.name} has no eval case in tools-report EVAL_CASES`);
  return { ...t, evalCase: EVAL_CASES[t.name] };
});

const NOT_ADDED = [
  {
    name: 'write_document / update_ncr / close_ncr / create_record',
    why: 'The MCP boundary is read-only by construction. A write tool would let the model mutate the ground truth the verifier hashes against.',
  },
  {
    name: 'read_file / list_directory / glob_data',
    why: 'Those bypass get_document\'s index allowlist and sha256 re-check. Agents never read data/ directly.',
  },
  {
    name: 'execute_sql / query_warehouse / dump_corpus',
    why: 'Unconstrained query is how context budgets die. List/search tools return pruned fields; bodies are fetched one indexed path at a time.',
  },
  {
    name: 'approve_shipment / sign_coc / publish_report / send_email',
    why: 'Side effects belong to the effect broker. A tool that ships, signs, or mails would move a decision the model is not allowed to make.',
  },
  {
    name: 'get_ncr_history / get_part / get_po / get_cert_manifest / list_documents',
    why: 'Policy.json names capabilities; the server implements the smallest tool that actually answers them (get_ncr already returns 90-day priors; get_purchase_order already returns the manifest). Duplicate tools add tokens without adding facts.',
  },
];

export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
}

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function tokensFor(toolName) {
  const fixture = listToolFixtures().find((f) => f.name === toolName);
  const responses = (fixture?.calls ?? []).map((call) => call.response);
  const tokens = responses.map((response) => estimateTokens(response));
  return {
    n: tokens.length,
    median: median(tokens),
    samples: tokens,
    fixture: fixture ? `fixtures/provider/${fixture.file}` : null,
  };
}

function parseArgs(argv) {
  let provider = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider') provider = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('usage: node scripts/tools-report.mjs [--provider openai]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return { provider };
}

function printTool(tool, { provider }) {
  const cost = tokensFor(tool.name);
  console.log('-'.repeat(78));
  console.log(`tool      ${tool.name}`);
  console.log(`eval      evals/cases/${tool.evalCase}.json`);
  console.log(`tokens    median ${cost.median ?? 'n/a'}  (n=${cost.n}, 4-char estimate, fixtures/provider)`);
  if (cost.samples.length) console.log(`samples   ${cost.samples.join(', ')}`);
  console.log(`desc      ${tool.description}`);
  console.log('');
  if (provider === 'openai') {
    const fn = toFunctionDefinition(tool.inputSchema, { name: tool.name, description: tool.description });
    fn.function.name = tool.name;
    console.log('OpenAI function definition (strict, derived from the same input schema)');
    console.log(JSON.stringify({ type: fn.type, function: fn.function }, null, 2));
  } else {
    console.log('input schema');
    console.log(JSON.stringify(tool.inputSchema, null, 2));
  }
  console.log('');
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  console.log(`heatlot tools:report — kestrel-foundry-data, ${TOOLS.length} read-only tools (from catalog.json)`);
  console.log('Token costs are median JSON.stringify(response).length/4 against fixtures/provider.');
  console.log('That is a deterministic estimate, not a vendor tokenizer.');
  if (flags.provider === 'openai') {
    console.log('Rendering OpenAI function definitions (strict: true) via src/providers/openai.mjs.');
  }
  console.log('');
  console.log(`tools on the server: ${TOOLS.length}`);
  console.log('');

  for (const tool of TOOLS) printTool(tool, flags);

  console.log('='.repeat(78));
  console.log('Tools deliberately not added, and why');
  console.log('');
  console.log(`Tool restraint is a design decision. ${TOOLS.length} read-only tools is the inventory;`);
  console.log('everything below was considered and rejected.');
  console.log('');
  for (const item of NOT_ADDED) {
    console.log(`  ${item.name}`);
    console.log(`    ${item.why}`);
    console.log('');
  }
}

main();
