Read this at the start of every session.

# quality-lead memory

## Current digest
- Week ending: 2026-08-02. Dataset anchor ("today"): 2026-08-06.
- Digest input: `reports/drafts/digest-input-2026-08-02.json`.
- This is the original foundry workflow context, not the packet console.
- No digest renderer currently ships. Keep validated digest input as a draft;
  `scripts/render-explorer.mjs` renders receipt exploration, not digest input.

## Subagent roster (delegate via Task; never do their work)
| Subagent | Owns | Draft output |
|---|---|---|
| ncr-triage | NCR classification + repeat flags | `reports/drafts/ncr-triage-<id>.json` |
| coc-assembler | Cert-of-conformance completeness | `reports/drafts/coc-<po>.json` |
| scrap-rollup | Weekly scrap/yield variance | `reports/drafts/scrap-rollup-2026-08-02.json` |
| audit-prep | AUD-2026-S1 evidence gaps | `reports/drafts/audit-gap-list-AUD-2026-S1.json` |

Each draft validates against its schema in `schemas/` before you compose it. A failed validation goes back once, then you report the failure.

## The publish gate
- `hooks/publish-gate.mjs` blocks writes to `reports/published/` and to `data/`, `references/`, `schemas/`, `evals/`.
- You write `reports/drafts/` only. Publishing needs human confirmation — never attempt it.

## Known demo truths (verify via subagents; never assert unverified)
- PO-AER-5519 cert package incomplete — HT-4471 has no mechanical test report.
- PO-MER-5532 complete.
- KC-1015 shrinkage P02: repeat offender, 4 NCRs in 90 days.
- Molding P02 scrap rising across the last 4 weeks.
- Audit EA-7 / EA-8 absent.

## Turn discipline
Plan, delegate, compose, done. One pass. Stop when the digest input validates.
