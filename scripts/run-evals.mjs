#!/usr/bin/env node
/**
 * run-evals.mjs — deterministic eval harness for the heatlot plugin.
 *
 * No models are run here. This harness judges the same ground truth the agents
 * are held to, so the structural guarantees are proven by exit codes, not prose:
 *
 *   kind "verifier-exit"  spawn scripts/verify-completeness.mjs <po> --json and
 *                         assert the process exit code and missing_records.
 *                         (The refusal path: an incomplete PO can never exit 0.)
 *   kind "data-truth"     recompute the claim directly from data/ and compare:
 *                           - NCR repeat priors: same part+defect+cause within 90
 *                             days of the NCR date (mirrors the MCP get_ncr rule)
 *                           - scrap top mover: current week vs mean of trailing 4
 *                             weeks by cause+cell; max positive variance with
 *                             week cost > $5000 (the scrap-rollup contract)
 *                           - audit gaps: audit-scope expected_path resolved
 *                             against data/index.json — files exact-match,
 *                             directories prefix-match
 *                           - dataset truths: index counts and named paths
 *                             present/absent on disk and in the index
 *   deterministic CoC draft contract checks
 *                         validate the canonical complete report and reject an
 *                         adversarial report with a fabricated item hash.
 *   schema contract       scripts/validate-schemas.mjs (default fixture mode)
 *                         must exit 0 — every evals/expected fixture behaves as
 *                         named, including the fabricated-CoC rejection.
 *
 * Prints PASS/FAIL per case with a one-line reason, then a summary.
 * Exit 0 when every check passes, 1 otherwise.
 *
 * --live  does NOT run models. Prints the exact
 *           claude -p "<prompt>" --max-turns 15
 *         command per case for a human to run behaviorally, then exits 0.
 *
 * Pure Node, no dependencies.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES_DIR = path.join(REPO_ROOT, 'evals', 'cases');
const DATA_ROOT = path.join(REPO_ROOT, 'data');
const EXPECTED_DIR = path.join(REPO_ROOT, 'evals', 'expected');

const loadJson = (abs) => JSON.parse(readFileSync(abs, 'utf8'));
const loadData = (rel) => loadJson(path.join(DATA_ROOT, ...rel.split('/')));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DAY_MS = 86400000;
const daysBetween = (from, to) =>
  Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / DAY_MS);

function runNode(args) {
  const res = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (res.error) throw res.error;
  return res; // { status, stdout, stderr }
}

function loadCases() {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => loadJson(path.join(CASES_DIR, f)));
}

// ---------- verifier-exit ----------
function checkVerifierExit(expect) {
  const res = runNode(['scripts/verify-completeness.mjs', expect.po, '--json']);
  if (res.status !== expect.exit) {
    return { ok: false, reason: `${expect.po}: expected exit ${expect.exit}, got ${res.status} — ${(res.stderr.trim().split('\n')[0] ?? '')}` };
  }
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    return { ok: false, reason: `${expect.po}: verifier --json output did not parse` };
  }
  if (!eq(report.missing_records, expect.missing)) {
    return { ok: false, reason: `${expect.po}: missing_records ${JSON.stringify(report.missing_records)} != expected ${JSON.stringify(expect.missing)}` };
  }
  return {
    ok: true,
    reason: `${expect.po}: exit ${res.status}, status "${report.status}", missing_records ${JSON.stringify(report.missing_records)} (hash-verified against data/index.json)`,
  };
}


// ---------- data-truth checks ----------
function checkNcrRepeat(expect) {
  const ncrs = loadData('exports/qms/ncr-export.json').ncrs;
  const ncr = ncrs.find((n) => n.ncr_id === expect.ncr);
  if (!ncr) return { ok: false, reason: `${expect.ncr}: not found in exports/qms/ncr-export.json` };
  // Same rule as the MCP get_ncr tool: same part+defect+cause, dated on or
  // before this NCR, within 90 days before its date.
  const priors = ncrs
    .filter((n) =>
      n.ncr_id !== ncr.ncr_id &&
      n.part_number === ncr.part_number &&
      n.defect_type === ncr.defect_type &&
      n.cause_code === ncr.cause_code &&
      n.date <= ncr.date &&
      daysBetween(n.date, ncr.date) <= 90)
    .map((n) => n.ncr_id)
    .sort();
  const count = priors.length + 1;
  if (!eq(priors, expect.prior_ids)) {
    return { ok: false, reason: `${expect.ncr}: priors ${JSON.stringify(priors)} != expected ${JSON.stringify(expect.prior_ids)}` };
  }
  if (count !== expect.occurrence_count_90d) {
    return { ok: false, reason: `${expect.ncr}: occurrence_count_90d ${count} != expected ${expect.occurrence_count_90d}` };
  }
  return { ok: true, reason: `${expect.ncr}: ${count} occurrences in 90d (${ncr.part_number} / ${ncr.defect_type} / ${ncr.cause_code}), priors ${priors.join(', ')}` };
}

function checkScrapTopMover(expect) {
  const lines = readFileSync(path.join(DATA_ROOT, 'exports', 'erp', 'scrap-export.csv'), 'utf8').replace(/\r\n/g, '\n').trim().split('\n');
  const head = lines[0].split(',');
  const rows = lines.slice(1).map((line) => {
    const row = Object.fromEntries(line.split(',').map((c, i) => [head[i], c]));
    row.cost_usd = Number(row.cost_usd);
    return row;
  });
  const weeks = [...new Set(rows.map((r) => r.week_ending))].sort();
  const week = weeks[weeks.length - 1];
  const trailing4 = weeks.slice(-5, -1); // the 4 weeks before the current one
  const costFor = (w, cell, cause) =>
    rows.filter((r) => r.week_ending === w && r.cell === cell && r.cause_code === cause)
      .reduce((s, r) => s + r.cost_usd, 0);
  const groups = [...new Set(rows.map((r) => `${r.cause_code}|${r.cell}`))].sort();
  const ranked = groups
    .map((g) => {
      const [cause_code, cell] = g.split('|');
      const cur = costFor(week, cell, cause_code);
      const avg = trailing4.reduce((s, w) => s + costFor(w, cell, cause_code), 0) / trailing4.length;
      return { cause_code, cell, cur, avg, variance_pct: avg > 0 ? ((cur - avg) / avg) * 100 : 0 };
    })
    .filter((r) => r.variance_pct > 0 && r.cur > 5000)
    .sort((a, b) => b.variance_pct - a.variance_pct || a.cause_code.localeCompare(b.cause_code));
  const top = ranked[0];
  if (week !== expect.week) {
    return { ok: false, reason: `current week ${week} != expected ${expect.week}` };
  }
  if (!top) return { ok: false, reason: 'no cause+cell group passed the positive-variance, >$5000 filter' };
  if (top.cause_code !== expect.top_cause || top.cell !== expect.top_cell) {
    return { ok: false, reason: `top mover ${top.cause_code}/${top.cell} != expected ${expect.top_cause}/${expect.top_cell}` };
  }
  if (top.variance_pct < expect.min_variance_pct) {
    return { ok: false, reason: `top mover variance ${top.variance_pct.toFixed(1)}% < expected floor ${expect.min_variance_pct}%` };
  }
  return {
    ok: true,
    reason: `week ${week}: top mover ${top.cause_code}/${top.cell} at +${top.variance_pct.toFixed(1)}% ($${top.cur} vs $${top.avg.toFixed(2)} trailing-4 avg), floor ${expect.min_variance_pct}%`,
  };
}

function checkAuditGaps(expect) {
  const scope = loadData('exports/quality/audit-scope.json');
  const index = loadData('index.json');
  if (scope.audit_id !== expect.audit) {
    return { ok: false, reason: `audit-scope.json audit_id ${scope.audit_id} != expected ${expect.audit}` };
  }
  const onFile = (rel) => Object.prototype.hasOwnProperty.call(index.documents, rel);
  // Same presence rule as render-digest and the MCP server: files (.md/.json)
  // exact-match an index key; directories prefix-match "<path>/".
  const gaps = scope.evidence_areas
    .filter((e) => {
      const isDoc = /\.(md|json)$/.test(e.expected_path);
      const present = isDoc
        ? onFile(e.expected_path)
        : Object.keys(index.documents).some((p) => p.startsWith(e.expected_path + '/'));
      return !present;
    })
    .map((e) => e.id);
  if (!eq(gaps, expect.gaps_exactly)) {
    return { ok: false, reason: `${expect.audit}: gaps ${JSON.stringify(gaps)} != expected ${JSON.stringify(expect.gaps_exactly)}` };
  }
  return { ok: true, reason: `${expect.audit}: gaps exactly ${gaps.join(', ')} (${scope.evidence_areas.length - gaps.length}/${scope.evidence_areas.length} evidence areas on file)` };
}

function checkDatasetTruths(expect) {
  const index = loadData('index.json');
  const ncrs = loadData('exports/qms/ncr-export.json').ncrs;
  const heats = loadData('exports/erp/heat-lot-export.json').heat_lots;
  const docs = Object.keys(index.documents);
  const facts = [
    ['doc_count', docs.length, expect.doc_count],
    ['ncr_count', ncrs.length, expect.ncr_count],
    ['heat_count', heats.length, expect.heat_count],
  ];
  for (const [name, actual, wanted] of facts) {
    if (actual !== wanted) return { ok: false, reason: `${name} ${actual} != expected ${wanted}` };
  }
  if (index.counts) {
    for (const [name, key] of [['doc_count', 'documents'], ['ncr_count', 'ncrs'], ['heat_count', 'heat_lots']]) {
      if (index.counts[key] !== expect[name]) {
        return { ok: false, reason: `index.counts.${key} ${index.counts[key]} != expected ${expect[name]}` };
      }
    }
  }
  const onFile = (rel) => Object.prototype.hasOwnProperty.call(index.documents, rel);
  const onDisk = (rel) => existsSync(path.join(DATA_ROOT, ...rel.split('/')));
  for (const rel of expect.absent_paths ?? []) {
    if (onFile(rel) || onDisk(rel)) return { ok: false, reason: `${rel} must be absent (index + disk) but was found` };
  }
  for (const rel of expect.present_paths ?? []) {
    if (!onFile(rel) || !onDisk(rel)) return { ok: false, reason: `${rel} must be present (index + disk) but is missing` };
  }
  return { ok: true, reason: `${expect.doc_count} docs / ${expect.ncr_count} NCRs / ${expect.heat_count} heats; ${(expect.absent_paths ?? []).length} absent + ${(expect.present_paths ?? []).length} present paths as expected` };
}

function checkDataTruth(caseDef) {
  const e = caseDef.expect;
  if (e.ncr) return checkNcrRepeat(e);
  if (e.week) return checkScrapTopMover(e);
  if (e.audit) return checkAuditGaps(e);
  if (e.doc_count !== undefined) return checkDatasetTruths(e);
  return { ok: false, reason: `unrecognized data-truth expect shape: ${JSON.stringify(Object.keys(e))}` };
}

// ---------- deterministic CoC draft contract ----------
function checkCocDraftContract(fixture, mutate, expectedExit, expectedMismatch = null) {
  const draft = loadJson(path.join(EXPECTED_DIR, fixture));
  if (mutate) mutate(draft);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'kestrel-coc-eval-'));
  const draftPath = path.join(tempDir, fixture);
  writeFileSync(draftPath, JSON.stringify(draft), 'utf8');
  try {
    const res = runNode(['scripts/validate-coc-report.mjs', draftPath]);
    if (res.status !== expectedExit) {
      return { ok: false, reason: `${fixture}: expected validator exit ${expectedExit}, got ${res.status} — ${res.stderr.trim()}` };
    }
    if (expectedMismatch && !res.stderr.includes(expectedMismatch)) {
      return { ok: false, reason: `${fixture}: expected ${expectedMismatch} rejection, got ${res.stderr.trim()}` };
    }
    return {
      ok: true,
      reason: expectedExit === 0
        ? `${fixture}: canonical draft accepted (deterministic contract; no model runs)`
        : `${fixture}: fabricated claim rejected with ${expectedMismatch} (deterministic contract; no model runs)`,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------- schema contract ----------
function checkSchemaFixtures() {
  const res = runNode(['scripts/validate-schemas.mjs']);
  if (res.status !== 0) {
    const tail = (res.stdout + '\n' + res.stderr).trim().split('\n').filter((l) => l.includes('FAIL')).slice(0, 3).join(' | ');
    return { ok: false, reason: `validate-schemas exited ${res.status}${tail ? ` — ${tail}` : ''}` };
  }
  const summary = res.stdout.trim().split('\n').pop();
  return { ok: true, reason: `validate-schemas exit 0 — ${summary}` };
}

// ---------- modes ----------
function runLive(cases) {
  console.log('LIVE MODE — no models are run by this harness. A human runs each prompt');
  console.log('behaviorally and compares the subagent behavior against evals/cases/<id>.json:\n');
  for (const c of cases) {
    console.log(`# ${c.id} (subagent: ${c.subagent})`);
    console.log(`claude -p "${String(c.prompt).replace(/"/g, '\\"')}" --max-turns 15\n`);
  }
  console.log(`${cases.length} case(s) listed. Producer/reviewer rule: agents produce artifacts;`);
  console.log('this harness + the schemas judge them. An agent never grades itself.');
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  const cases = loadCases();
  if (args.includes('--live')) runLive(cases);

  const results = [];
  for (const c of cases) {
    let r;
    try {
      r = c.kind === 'verifier-exit' ? checkVerifierExit(c.expect)
        : c.kind === 'data-truth' ? checkDataTruth(c)
        : { ok: false, reason: `unknown kind "${c.kind}"` };
    } catch (err) {
      r = { ok: false, reason: `harness error: ${err.message}` };
    }
    results.push({ id: c.id, ...r });
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${c.id} — ${r.reason}`);
  }

  console.log('\nRunning deterministic CoC draft contract checks — no model runs');
  const completeDraft = checkCocDraftContract('coc-report.complete.valid.json', null, 0);
  results.push({ id: 'coc-draft-canonical-complete', ...completeDraft });
  console.log(`${completeDraft.ok ? 'PASS' : 'FAIL'}  coc-draft-canonical-complete — ${completeDraft.reason}`);
  const fabricatedHash = checkCocDraftContract(
    'coc-report.complete.valid.json',
    (draft) => { draft.items[0].sha256 = '0'.repeat(64); },
    1,
    'items mismatch',
  );
  results.push({ id: 'coc-draft-fabricated-hash', ...fabricatedHash });
  console.log(`${fabricatedHash.ok ? 'PASS' : 'FAIL'}  coc-draft-fabricated-hash — ${fabricatedHash.reason}`);

  const schema = checkSchemaFixtures();
  results.push({ id: 'schema-fixtures', ...schema });
  console.log(`${schema.ok ? 'PASS' : 'FAIL'}  schema-fixtures — ${schema.reason}`);

  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length === 0
      ? `\nALL GREEN — ${results.length} checks passed (${cases.length} cases + 2 deterministic CoC draft contract checks + schema contract)`
      : `\n${failed.length} of ${results.length} checks FAILED: ${failed.map((r) => r.id).join(', ')}`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
