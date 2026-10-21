# Functional

## Roles and permissions

Heatlot has no human login. Its "roles" are agents, each with a policy entry in `policy/policy.json` that code enforces. A model is never asked to respect them.

| Agent | May read | May call (MCP tools) | Decisions | Effects |
|---|---|---|---|---|
| `quality-lead` | own memory, `reports/drafts/` | none | `route-request`, `compose-digest` | none |
| `ncr-triage` | defect taxonomy, cause codes | `list_ncrs`, `get_ncr` | `ncr-triage` | none |
| `coc-assembler` | customer cert requirements | five read tools | `coc-report` | `publish-coc` (verdict-gated) |
| `scrap-rollup` | cause codes | `get_scrap_records` | `scrap-rollup` | none |
| `audit-prep` | audit evidence standards | three read tools | `audit-gap-list` | none |

Write boundary: only `reports/drafts/` is writable. `reports/published/` is guarded and needs a `coc-completeness` verdict of `COMPLETE`. `data/`, `schemas/`, `policy/`, `hooks/`, `evals/`, `ledger/` and `.git/` are denied. There is no override path; a mutation proves the suite catches one being re-added.

## Journeys

| Journey | Command | What the user sees | Verified by |
|---|---|---|---|
| Release an incomplete certificate (the refusal) | `npm run demo` | Model drafts COMPLETE; code computes INCOMPLETE (mechanical test missing); authorization refused; effect denied; exit 3 | `verify:all` step `demo` (exit 3) |
| The same under prompt injection | `npm run demo:injection` | Untrusted block labelled, not stripped; denial receipt names `untrusted-context` | `verify:all`, gate `refusal-correctness`, `denialRule` floor |
| Release a complete certificate (the positive case) | `npm run verify:coc -- PO-MER-5532` | exit 0 | `verify:all`, `tests/broker.test.mjs` |
| Live model run | `HEATLOT_LIVE=1 npm run verify:live` | Real Sonnet 5.5 draft; provenance; same refusal; exit 3 | Recorded run `req_011Cg3GxmZmrYjTfuCEWQrTL` |
| Audit a decision with no model | `npm run audit -- --po PO-AER-5519` | Decision reconstructed from receipts; chain verified | `verify:all` step `audit:tamper`, gate `audit-replay` |
| See and tamper the chain | `npm run demo && npm run explorer` | Offline page; Tamper one byte breaks the chain at that link | `tests/explorer.test.mjs` (parity on every tamper); film 01 |
| Ask what an agent may do | `npm run policy:explain -- --agent coc-assembler` | Reads, tools, decisions, effects, binding, single use | Film 01 (terminal stage, real output) |
| Prove the guards can fail | `npm run evals:mutate` | 9/9 mutations caught | `verify:all`, gate `guard-coverage` |
| Gate a release | `npm run gate`, `npm run gate:drill` | RELEASE ALLOWED; 2/2 deliberate regressions blocked | CI on every PR and push to main |
| Use from an MCP client | `.mcp.json` | Read-only MCP tools over the synthetic data | `npm run smoke:mcp` (12 checks) |

## Business rules (code-owned)

- An authorization is minted only from a verdict. It is refused outright if any contributing context block is untrusted.
- It is bound to the effect payload hash and the verdict input hashes, and honoured only if the ledger shows its mint at `mint_seq`.
- It is single use, recorded as an `authorization_consumed` receipt, so a restart cannot replay it.
- A broken chain blocks every effect for that subject (`ledger-chain`).
- The verifier resolves every required record against `data/index.json`: incomplete exits 3, complete exits 0.

## AI and agent behaviour

- Replay is the default and needs no key or network. Live calls need `HEATLOT_LIVE=1`, and `liveFetch` is the only network path; the Anthropic SDK's transport is routed through it.
- Live Anthropic calls: `claude-sonnet-5-5`, strict tool under `tool_choice: auto`, `output_config.effort`, opt-in fallbacks, no hidden retries.
- Every decision receipt carries provenance: fixture key, or requested and served model, request id, tokens, latency and stop reason. A failed call is a `decision_failed` receipt with the same provenance.
- The prompt never tells the model to distrust anything. The defence is in the broker, not the prompt.

## Data in and out

- **In:** the seeded synthetic corpus under `data/`. CI asserts it reproduces byte for byte.
- **Out:** receipts under `ledger/` (gitignored, regenerated); reports under `reports/` (gitignored); one committed live-run record under `docs/evidence/`.

## Error handling and recovery

Fail closed throughout. A missing fixture, malformed policy, invalid subject, broken chain, schema-invalid draft, classifier refusal or HTTP error each produces a named refusal or a recorded receipt, never a default. Tests in `tests/broker.test.mjs`, `tests/live-provider.test.mjs`, `tests/ledger.test.mjs` and `tests/providers.test.mjs` cover these.

## Functional gaps (honest)

| Gap | Severity | Status |
|---|---|---|
| The ledger is not unforgeable: no external anchor, so whoever can rewrite it can also forget a consumed authorization | Design limit | Documented (README §8, threat model §3.5); roadmap item |
| Concurrent appends to one subject are not serialised | Low for a reference | Documented |
| The OpenAI live adapter had never been run live | Medium for the cross-provider claim | **Fixed 2026-10-15.** Run live on `gpt-6.1-sol` (and on the old `gpt-4o-2024-08-06` default before the upgrade); the adapter now records full provenance and fails closed like the Anthropic one |
| Review nits not yet addressed: `effect_performed` uses `authorization.subject`; `deny()` returns an unwritten receipt if `append` throws; guards call `readChain` with no `ledgerRoot` (tests use the repo ledger) | Low | Open; candidates for the next change |
