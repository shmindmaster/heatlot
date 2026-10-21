# Evals — heatlot

This directory is the judgment layer. It exists so that every claim the demo
makes about agent behavior is backed by a process exit code, not by prose.

## Layout

- `cases/*.json` — six eval cases, each `{id, subagent, kind, prompt, expect}`.
  The `prompt` is the natural-language request a user would give the subagent
  (used by `--live` mode); `expect` is the machine-checkable truth.
- `expected/*.json` — schema fixtures consumed by `scripts/validate-schemas.mjs`:
  `*.valid.json` must validate, `*.invalid.json` must be rejected.
- The runner is `scripts/run-evals.mjs`.

## What the suite proves (structural guarantees)

1. **The refusal path is fail-closed** (`coc-po-aer-5519-refusal`,
   `coc-po-mer-5532-complete`, kind `verifier-exit`). The harness spawns
   `scripts/verify-completeness.mjs <po> --json` and asserts the process exit
   code and `missing_records`. PO-AER-5519 must exit **3** with
   `["mechanical-test"]`; PO-MER-5532 must exit **0**. Completeness is decided
   by re-hashing files against `data/index.json`, so an agent literally cannot
   mark a missing record "present" and pass.
2. **Repeat-offender math** (`ncr-0114-repeat-offender`, kind `data-truth`).
   Recomputed from `data/exports/qms/ncr-export.json`: same part + defect +
   cause within 90 days of the NCR date. NCR-2026-0114 must carry exactly the
   priors NCR-2026-0091 / -0098 / -0107 — 4 occurrences in 90 days.
3. **Top-mover math** (`scrap-top-mover`, kind `data-truth`). Recomputed from
   `data/exports/erp/scrap-export.csv`: current week cost vs the mean of
   the trailing 4 weeks, grouped by cause + cell; the top mover is the max
   positive variance with week cost > $5,000. For week 2026-08-02 that is
   **P02 in Molding** at +31.8% (floor asserted: 30%).
4. **Gap detection** (`audit-gaps`, kind `data-truth`). Every
   `audit-scope.json` `expected_path` is resolved against `data/index.json` —
   file paths exact-match, directories prefix-match. AUD-2026-S1 gaps must be
   exactly **EA-7, EA-8**.
5. **Dataset truths** (`dataset-truths`, kind `data-truth`). 160 documents,
   36 NCRs, 20 heat lots; the HT-4471 mechanical test is absent from index and
   disk while HT-4468's is present.
6. **Schema contracts** (runner step `schema-fixtures`). The harness spawns
   `scripts/validate-schemas.mjs` (default mode) and requires exit 0: all five
   schemas compile and every `expected/` fixture behaves as named — including
   `coc-report.fabricated.invalid.json`, a CoC report that claims a missing
   record is present, which the schema must reject.

## How to run

```powershell
npm run evals          # deterministic harness; exit 0 = all green
npm test               # node --test tests/*.test.mjs (data integrity, completeness,
                       # schemas, hooks, digest)
npm run demo           # full E2E gate + on-camera checklist
node scripts/run-evals.mjs --live
```

`--live` runs **no models**. It prints the exact
`claude -p "<prompt>" --max-turns 15` command per case so a human can run the
behavioral side on camera and compare what the subagent does against the
`expect` block in `evals/cases/<id>.json`.

## The producer/reviewer rule

Agents produce artifacts (draft CoC reports, scrap rollups, triage notes,
digest input). **This harness and the schemas judge them — an agent never
grades itself.** The separation is enforced, not conventional:

- `hooks/publish-gate.mjs` blocks agent writes to `data/`, `references/`,
  `schemas/`, `evals/`, and `context/` (exit 2) — an agent cannot edit the
  cases it is judged by, the fixtures, or the ground truth.
- Publishing to `reports/published/` is blocked outright at the hook. It is
  reachable only through the effect broker, against an authorization minted from
  a deterministic verdict. No environment variable opens it.
- Case expectations are computed from `data/` by the harness at run time, so
  "passing" means agreeing with the dataset, not with the agent's output.

Changing a subagent's scope means updating its agent file, its schema, its
eval cases here, and `docs/architecture.md` in the same commit (see
`AGENTS.md`).
