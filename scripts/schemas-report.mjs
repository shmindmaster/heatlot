#!/usr/bin/env node
/**
 * schemas:report — per decision: canonical schema, which provider features
 * enforce which constraints, vendor subset differences, and the refusal
 * fixture that proves the constraint bites.
 *
 *   npm run schemas:report
 *   npm run schemas:report -- --provider openai
 *   npm run schemas:report -- --strict
 */
import { listDecisions } from '../src/decisions/registry.mjs';
import { toStrictTool, transformForAnthropic, ANTHROPIC_GRAMMAR, anthropicEnforces } from '../src/providers/anthropic.mjs';
import { toStructuredOutput, transformForOpenAI, isOpenAICompliant, OPENAI_STRUCTURED, openaiEnforces } from '../src/providers/openai.mjs';

const KEYWORDS = [
  'additionalProperties', 'required', 'enum', 'const', 'pattern', 'format',
  'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength',
  'allOf', 'if', 'then', 'else', 'anyOf', 'not',
];

function parseArgs(argv) {
  let provider = null;
  let strict = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider') provider = argv[++i];
    else if (argv[i] === '--strict') strict = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('usage: node scripts/schemas-report.mjs [--provider openai|anthropic] [--strict]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return { provider, strict };
}

function collectKeywords(node, found = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectKeywords(item, found));
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  for (const [key, value] of Object.entries(node)) {
    if (KEYWORDS.includes(key)) found.add(key);
    collectKeywords(value, found);
  }
  return found;
}

function pad(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function cell(keyword, vendor, dropped) {
  if (vendor === 'ajv') return 'enforced';
  if (vendor === 'openai' && keyword === 'const') return '→ enum';
  if (dropped.includes(keyword)) return 'stripped';
  if (vendor === 'anthropic') {
    const status = anthropicEnforces(keyword);
    if (status === 'enforced') return 'grammar';
    if (status === 'not-enforced') return 'stripped';
    return '—';
  }
  if (vendor === 'openai') {
    const status = openaiEnforces(keyword);
    if (status === 'enforced') return 'grammar';
    if (status === 'not-supported') return 'stripped';
    return '—';
  }
  return '—';
}

function printTable(used, droppedAnthropic, droppedOpenAI) {
  const cols = ['keyword', 'canonical', 'anthropic strict', 'openai structured', 'ajv/repair'];
  const widths = [22, 12, 18, 18, 12];
  const header = cols.map((c, i) => pad(c, widths[i])).join('  ');
  console.log(header);
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const keyword of KEYWORDS) {
    if (!used.has(keyword)) continue;
    const row = [
      keyword,
      'yes',
      cell(keyword, 'anthropic', droppedAnthropic),
      cell(keyword, 'openai', droppedOpenAI),
      'enforced',
    ];
    console.log(row.map((c, i) => pad(c, widths[i])).join('  '));
  }
}

function printDifferences(used, droppedAnthropic, droppedOpenAI) {
  const lines = [];
  if (used.has('if') || used.has('then') || used.has('allOf')) {
    lines.push('  • if/then completeness rules live only on the canonical schema. Neither vendor grammar enforces them; Ajv and the verifier do.');
  }
  if (used.has('const')) {
    lines.push('  • const: Anthropic grammar keeps it; OpenAI rewrites it to enum: [value].');
  }
  if (used.has('minimum') || used.has('maximum')) {
    lines.push('  • numeric bounds (minimum/maximum): OpenAI grammar enforces them; Anthropic strips them (400 otherwise).');
  }
  if (used.has('minItems') || used.has('maxItems')) {
    lines.push('  • minItems/maxItems: OpenAI grammar enforces them; Anthropic only accepts minItems of 0 or 1 and strips the rest.');
  }
  if (used.has('pattern')) {
    lines.push('  • pattern: both grammars enforce it (Anthropic: no lookaround/backreferences). Ajv is the portable check.');
  }
  if (used.has('format')) {
    lines.push('  • format: both list date among supported string formats. Ajv registers date locally.');
  }
  lines.push('  • OpenAI requires additionalProperties:false and every property in required; Anthropic allows optional properties.');
  if (droppedAnthropic.length) lines.push(`  • Anthropic transform dropped: ${droppedAnthropic.join(', ')}`);
  if (droppedOpenAI.length) lines.push(`  • OpenAI transform dropped: ${droppedOpenAI.join(', ')}`);
  console.log('Vendor subset differences');
  for (const line of lines) console.log(line);
}

function printDecision(decision, { provider, strict }) {
  const used = collectKeywords(decision.schema);
  const anthropic = transformForAnthropic(decision.schema);
  const openai = transformForOpenAI(decision.schema);
  const tool = toStrictTool(decision.schema, { name: decision.id });
  const format = toStructuredOutput(decision.schema, { name: decision.id });
  const compliant = isOpenAICompliant(openai.schema);

  console.log('='.repeat(78));
  console.log(`decision  ${decision.id}`);
  console.log(`schema    ${decision.schemaFile}   ($id ${decision.schema.$id ?? '—'})`);
  console.log(`agent     ${decision.agent}`);
  console.log(`title     ${decision.schema.title}`);
  console.log(`refusal   ${decision.refusal.path}`);
  console.log(`  bites   ${decision.refusal.bites}`);
  console.log(`  proof   ${decision.refusal.constraint}`);
  console.log('');

  if (provider === 'openai') {
    console.log('OpenAI structured-output response_format (derived, not hand-written)');
    console.log(`  name=${format.json_schema.name}  strict=${format.json_schema.strict}  compliant=${compliant.ok}`);
    if (!compliant.ok) {
      for (const issue of compliant.issues) console.log(`  ISSUE ${issue}`);
    }
    console.log(JSON.stringify({ type: format.type, json_schema: { name: format.json_schema.name, strict: format.json_schema.strict, schema: format.json_schema.schema } }, null, 2));
    console.log('');
    printDifferences(used, anthropic.dropped, openai.dropped);
    return;
  }

  if (provider === 'anthropic' || strict) {
    console.log('Anthropic strict tool-use definition (derived, not hand-written)');
    console.log(`  name=${tool.name}  strict=${tool.strict}`);
    console.log('  grammar enforces: ' + ANTHROPIC_GRAMMAR.enforced.join(', '));
    console.log('  grammar does not enforce: ' + ANTHROPIC_GRAMMAR.notEnforced.join(', '));
    console.log(JSON.stringify({ name: tool.name, description: tool.description, strict: tool.strict, input_schema: tool.input_schema }, null, 2));
    console.log('');
    printTable(used, anthropic.dropped, openai.dropped);
    console.log('');
    printDifferences(used, anthropic.dropped, openai.dropped);
    return;
  }

  printTable(used, anthropic.dropped, openai.dropped);
  console.log('');
  printDifferences(used, anthropic.dropped, openai.dropped);
  console.log('');
}

function printPreamble({ provider, strict }) {
  console.log('heatlot schemas:report — one schema, two runtimes, portable repair');
  console.log('Canonical documents: schemas/*.schema.json (draft 2020-12).');
  console.log('Anthropic: strict tool use (grammar-constrained sampling).');
  console.log('OpenAI: structured outputs (strict json_schema response_format).');
  console.log('Neither subset covers if/then. Ajv repair + the CoC verifier still own those invariants.');
  if (provider) console.log(`Filter: --provider ${provider}`);
  if (strict) console.log('Filter: --strict (Anthropic grammar view)');
  console.log('');
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  printPreamble(flags);
  for (const decision of listDecisions()) {
    printDecision(decision, flags);
    console.log('');
  }
  console.log('='.repeat(78));
  console.log('OpenAI structured-outputs requires:');
  console.log(`  additionalProperties: ${OPENAI_STRUCTURED.requires.additionalProperties}`);
  console.log(`  all properties required: ${OPENAI_STRUCTURED.requires.allPropertiesRequired}`);
  console.log('Anthropic strict tool use requires additionalProperties: false but allows optional properties.');
  console.log('Repair (Ajv) validates the canonical schema, not the vendor subset.');
}

main();
