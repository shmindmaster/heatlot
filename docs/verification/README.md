# Heatlot verification pack

Evidence for one question: is Heatlot complete, integrated, tested, demonstrable, and production-verified? Every claim here links to a command that was run, a commit, or a recording. Nothing in this folder is a plan presented as done.

Commit the evidence ran against: `bfd326c` (main, after PR [#16](https://github.com/shmindmaster/heatlot/pull/16)) and its pre-merge head `1067715`, which has an identical tree.

## What Heatlot is

A runnable, offline reference implementation of a deterministic control layer around an LLM agent: **the agent drafts, software decides.** The demonstration domain is a fictional sand-casting foundry, Kestrel Castings, releasing certificates of conformance. Every record is synthetic and generated from a seed.

- **Users:** engineers and platform leads evaluating how to take guarantees out of the prompt and put them in code; quality and compliance leaders who need bounded delegation; reviewers of the open-source repository.
- **Differentiation:** an injected instruction can change what the model says but not what is released. Single use is a ledger fact. Every guard has a mutation that proves the suite catches its removal, and releases are gated on that.
- **Not:** a hosted service, a compliance certification, or a production security boundary (README section 8, ROADMAP "Not promised").

## Capability inventory

| # | Capability | Where |
|---|---|---|
| S1 | Context assembler: budgeted, hashed, trust-labelled blocks; recorded drops | `src/context/assembler.mjs` |
| S2 | Typed decisions: one JSON Schema to Anthropic strict tool use and OpenAI structured outputs; bounded repair | `src/decisions/`, `src/providers/` |
| S2+ | Live Anthropic adapter (Claude Sonnet 5.5) with provenance on every decision receipt | `src/providers/anthropic-live.mjs`, `scripts/verify-live.mjs` |
| S3 | Policy as data and a PreToolUse write-boundary hook (fail closed) | `policy/policy.json`, `hooks/publish-gate.mjs` |
| S4 | Deterministic completeness verifier (exit 0 / 3) | `scripts/verify-completeness.mjs` |
| S5 | Effect broker with ledger-minted, single-use authorizations bound to the payload and verdict hashes | `src/effects/` |
| S6 | Hash-chained receipt ledger, audit replay, tamper check | `src/ledger/`, `scripts/audit.mjs` |
| S6+ | Receipt Explorer: offline page that recomputes the chain and tampers one byte | `scripts/render-explorer.mjs`, `src/explorer/chain.mjs` |
| S7 | Eval suite, mutation harness, eval-gated release and gate drill | `evals/`, `scripts/run-mutations.mjs`, `scripts/eval-gate.mjs`, `scripts/gate-drill.mjs` |
| — | Read-only MCP server (10 tools, SDK v2, spec 2026-07-28) | `mcp-servers/kestrel-foundry-data/` |
| — | `heatlot-broker` library: guard, approve, Ed25519-signed receipts, MCP proxy | `packages/broker/` |

## The pack

| File | Answers |
|---|---|
| [FUNCTIONAL.md](FUNCTIONAL.md) | Roles, journeys, rules, AI behaviour, errors, gaps |
| [TECHNICAL.md](TECHNICAL.md) | Architecture diagram, boundaries, AI, CI/CD, the critical-path trace |
| [COVERAGE.md](COVERAGE.md) | Capability to evidence matrix; integrations and their verification level |
| [TESTS.md](TESTS.md) | Every executed test command, where, against which commit, and its result |
| [DEMOS.md](DEMOS.md) | Delivered films and recorded runs, each labelled real or substitute |
| [READINESS.md](READINESS.md) | Verdict, the three readiness types, blockers, next action |

## Existing material this pack links to rather than repeats

- Showcase assessment: `AgentHub\runtime\coding-agent-dispatch\reports\showcase\heatlot.md` (2026-10-14).
- Independent review of PR #16 (Cline, five findings, all fixed in `1067715`): `...\reports\showcase-prep\heatlot-pr16-review.md`.
- In-repo: [architecture](../architecture.md), [threat model](../threat-model.md), [benchmark](../benchmark.md), [decisions](../decisions/), [live-run evidence](../evidence/live-run-2026-10-14/).
