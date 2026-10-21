# Tests

Every row is a command that was executed. "Commit" is the tree it ran against; `1067715` (PR head) and `bfd326c` (squash-merged main) have identical trees.

## Continuous integration (GitHub Actions, ubuntu-latest)

| Run | Commit | Job | Result |
|---|---|---|---|
| [38698163920](https://github.com/shmindmaster/heatlot/actions/runs/38698163920) | `bfd326c` (main) | Node 20 verification | success: `npm audit --omit=dev` 0 vulnerabilities; `verify:all` ALL GREEN 12/12; corpus reproducible; `gate` RELEASE ALLOWED; benchmark unchanged; `gate:drill` 2/2 blocked |
| 38698163920 | `bfd326c` | Node 22 verification | success (same steps, same results) |
| 38698164047 | `bfd326c` | CodeQL JavaScript | success |
| [38674130953](https://github.com/shmindmaster/heatlot/actions/runs/38674130953) | `1067715` (PR head) | Node 20, Node 22 verification | success (2026-10-15T03:03–03:04Z) |
| [38707061289](https://github.com/shmindmaster/heatlot/actions/runs/38707061289) | `46cc33d` (main, v0.3.0) | Node 20, Node 22 verification | success |
| [38715583822](https://github.com/shmindmaster/heatlot/actions/runs/38715583822) | `afea269` (PR #26 head) | Node 20 verification | **failure**, conformance step only: `@modelcontextprotocol/conformance` imports `fs.globSync`, which Node 20 lacks. Fixed in `7450320`, which runs conformance on the Node 22 leg with a version guard. Node 22 passed in the same run |
| [38716923519](https://github.com/shmindmaster/heatlot/actions/runs/38716923519) | `7450320` (PR #26 head) | Node 20, Node 22 verification; CodeQL | success; merged as `d76aa1e` |
| [38734598133](https://github.com/shmindmaster/heatlot/actions/runs/38734598133) | `d76aa1e` (main) | Node 20 verification | success: `verify:all` ALL GREEN 12/12 (incl. `smoke:mcp` 21/21); `gate` RELEASE ALLOWED; `docs:reference --check` clean; `conformance-baseline` 4/4; conformance skipped by design on Node 20 |
| 38734598133 | `d76aa1e` | Node 22 verification | success: as Node 20, plus `conformance:mcp` 2026-07-28 exit 0 (24 pass, 17 baselined) and 2025-11-25 exit 0 (34 pass, 25 baselined) |
| 38734598001 | `d76aa1e` | CodeQL JavaScript | success |
| [38707067941](https://github.com/shmindmaster/heatlot/actions/runs/38707067941) | `v0.3.0` tag | Release gate, then Publish release | success: gate and drill passed; release published 2026-10-15T08:40:12Z with `benchmark.md` and `report.json` (`allowed: true`, 5/5) |

`verify:all` runs, each at its expected exit code: `generate:data`, `test`, `validate:schemas`, `evals`, `evals:mutate`, `smoke:mcp`, `verify:coc PO-AER-5519` (3), `verify:coc PO-MER-5532` (0), `audit:tamper`, `demo:denied`, `demo:injection`, `demo` (3).

## Release smoke test (published artifact)

| Command | Artifact | When (CT) | Result |
|---|---|---|---|
| `npm ci` from `heatlot-0.3.0.tar.gz` (release source archive) | v0.3.0 | 2026-10-15 | clean install |
| `node scripts/verify-completeness.mjs PO-AER-5519` | v0.3.0 | 2026-10-15 | exit 3, INCOMPLETE (mechanical-test missing) |
| `node scripts/verify-completeness.mjs PO-MER-5532` | v0.3.0 | 2026-10-15 | exit 0, COMPLETE |
| `node scripts/demo-injection.mjs` | v0.3.0 | 2026-10-15 | exit 0; authorization refused and effect denied under `untrusted-context`; 6 receipts; chain verified |

## Local (Windows 11, Node 26.11.1)

| Command | Commit | When (CT) | Result |
|---|---|---|---|
| `npm test` (two consecutive runs) | `1067715` | 2026-10-14 | 92/92 pass, 0 fail, both runs |
| `npm run verify:all` | `1067715` | 2026-10-14 | ALL GREEN 12/12 |
| `npm run gate` | `1067715` | 2026-10-14 | RELEASE ALLOWED, 5/5 checks |
| `npm run gate:drill` | `1067715` | 2026-10-14 | 2/2 deliberate regressions blocked |
| `npm run evals:mutate` | `1067715` | 2026-10-14 | 9/9 mutations caught |
| `npm run smoke:mcp` | `a0a07c0` (MCP v2 merge) | 2026-10-14 | 12/12 checks; negotiated revision 2026-07-28 |
| `npm audit --omit=dev --audit-level=high` | `a0a07c0` | 2026-10-14 | 0 vulnerabilities |
| `claude plugin validate .` | `a0a07c0` | 2026-10-14 | passed with two pre-existing warnings |
| `HEATLOT_LIVE=1 npm run verify:live` (Anthropic) | `1067715` | 2026-10-14 | exit 3 (expected refusal); `claude-sonnet-5-5`, `req_011Cg3GxmZmrYjTfuCEWQrTL`; denial rule `untrusted-context`; [evidence](../evidence/live-run-2026-10-14/) |
| `HEATLOT_LIVE=1 HEATLOT_PROVIDER=openai npm run verify:live` (old default `gpt-4o-2024-08-06`) | `4699c2c` | 2026-10-15 | exit 3 (expected refusal); model INCOMPLETE; denial `untrusted-context`; exposed thin provenance (fixed) |
| `HEATLOT_LIVE=1 HEATLOT_PROVIDER=openai npm run verify:live` (`gpt-6.1-sol`) | release/v0.3.0 | 2026-10-15 | exit 3 (expected refusal); `req_971f4bc010bd427db04b44503f04cff3`, 3423/808 tokens, 13.6 s; model INCOMPLETE; denial `untrusted-context`; [evidence](../evidence/live-run-2026-10-15-openai/) |
| `node --test tests/live-provider-openai.test.mjs` | release/v0.3.0 | 2026-10-15 | 6/6 pass |
| `npm run test:browser` | test/explorer-browser | 2026-10-15 | 4/4 pass; with the payload-hash check disabled, the tamper test fails (mutation caught) |
| `npm run smoke:mcp` | `afea269` (PR #26) | 2026-10-15 | 21/21 checks: 2026-07-28 and 2025-11-25 on stdio and on loopback HTTP; foreign Origin 403; strict inputs; titles; cache hint. With the old loose input schemas, the two strict-input checks fail (guard proven able to fail) |
| `npm run conformance:mcp` | `afea269` (PR #26) | 2026-10-15 | 2026-07-28: 24 pass, 17 expected failures, exit 0. 2025-11-25: 34 pass, 25 expected failures, 1 warning (stateless, no session ID), exit 0. A baselined check that passes (`tools-list`) fails the run as stale |
| `node --test tests/conformance-baseline.test.mjs` | `afea269` (PR #26) | 2026-10-15 | 4/4: a growing baseline is caught, a shrinking one passes, core checks can never be baselined |
| `npm run docs:reference -- --check` | `afea269` (PR #26) | 2026-10-15 | reference docs and `catalog.json` match the server and the schemas |
| `npm test` | `afea269` (PR #26) | 2026-10-15 | 102/102 pass |
| `npm audit --audit-level=high` (all deps, incl. the conformance devDependency) | `afea269` (PR #26) | 2026-10-15 | 0 vulnerabilities |

## Heatlot (local, Windows 11, Node 26.11.1, 2026-10-15)

| Command | Result |
|---|---|
| `npm test` | 141/141 pass: inspection flow, API (responses parsed with their own schemas), heatlot MCP, packets, broker, control layer |
| `npm run evals:mutate` (inspection and API mutations run individually) | every new mutation caught; 26 in total, gate floor 26 |
| `st run docs/api/openapi.json --checks all --max-examples 25` (Schemathesis 4.29.1) against `heatlot serve` | 545/545 generated cases pass, after fixing 415/400/405 handling the first run exposed |
| `npm run conformance:mcp` | heatlot and kestrel-foundry-data servers PASS at 2026-07-28 and 2025-11-25 against their baselines |
| `npm run lint:openapi` (Redocly 2.64.0) | valid, no warnings |
| `npm run smoke:package` | 6/6: the packed tarball carries exactly the runtime, installs into an empty directory, `heatlot demo` exits 3, `heatlot verify PKT-24002R` exits 0, output stays out of `node_modules` |

## By category

| Category | Coverage | Evidence |
|---|---|---|
| Unit | Ledger, broker, authorization, providers, live adapter (stubbed transport), context, decisions, schemas, completeness, explorer parity, conformance baseline rules; `packages/broker` (guard, approve, receipts, MCP proxy, CLI: 17 tests) | `tests/*.test.mjs` (102 tests) |
| Contract / schema | Every fixture validates or is rejected as named; one schema, three enforcement paths | `validate:schemas`, `tests/schemas.test.mjs`, `schemas:report` |
| Integration (in process) | Context, decision, verdict, mint, broker and ledger end to end | `demo`, `demo:injection`, `demo:denied` inside `verify:all` |
| Integration (live provider) | Anthropic and OpenAI live adapters against the real APIs | One recorded `verify:live` run each |
| Integration (MCP) | Both protocol eras on stdio and on loopback Streamable HTTP; the 10 tools' data facts; strict inputs; Origin check | `smoke:mcp` (21 checks) |
| Protocol conformance (MCP) | `@modelcontextprotocol/conformance` at 2026-07-28 and 2025-11-25 against the loopback HTTP server; committed check-level baselines that may only shrink | `conformance:mcp` in CI and the release gate |
| Generated-reference drift | `catalog.json`, `docs/reference/mcp-tools.md` and `docs/reference/decision-schemas.md` regenerated and compared | `docs:reference --check` in CI and the release gate |
| Authorization / negative | Replay after restart (separate process), never-minted forgery, payload edit, forged verdict, untrusted context, broken chain, malformed bindings | `tests/broker.test.mjs` |
| Recovery / failure paths | Classifier refusal, prose answer, HTTP 529, schema-invalid output (provenance kept), bad effort | `tests/live-provider.test.mjs` |
| Guard ability to fail | 9 mutations; release gate with 2 drilled regressions | `evals:mutate`, `gate:drill` |
| End-to-end browser | `npm run test:browser` (Playwright 1.64.1, headless Chromium) in CI and in the release gate: fresh chain renders verified; Tamper one byte breaks the chain at that receipt with later receipts unverifiable; Restore; keyboard operation. Proven able to fail: disabling the page's payload-hash check fails the tamper test. Earlier, before this test existed: no automated browser test in CI. The Explorer was driven by headless Playwright for the film. Of 20 recorded takes, 19 were valid with every expected response observed; one timed out on a CPU-starved machine and was re-recorded. That is demo evidence, not a test suite. | `docs/verification/DEMOS.md` |
| Accessibility / responsive | **Not tested.** The Explorer has keyboard focus styles, reduced-motion handling and a single-column layout under 1100 px, but nothing measures them. | — |
| Security | CodeQL, `npm audit`, no-network-without-flag test, threat model | CI; `tests/providers.test.mjs`; `docs/threat-model.md` |
| Performance | Not applicable at this scale; not measured | — |

## Failures seen and fixed this cycle

- Five findings from the independent PR #16 review: wrong denial rule recorded, blank lines hidden from the Explorer, lost provenance on a schema failure, unbounded tamper, hard-coded ledger path. Each has a test and was fixed in `1067715`.
- One race introduced and removed on the way: a test that spawned the demo rewrote the shared ledger while another test file appended to it. It was replaced by an in-process `mintAndPerform` test.
