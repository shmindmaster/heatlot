# heatlot — project memory

A reference architecture for deterministic agent control, with a runnable example: a
quality-control agent for Kestrel Castings (synthetic foundry data only — no real client data
ever enters this repo). `packages/broker/` is the extracted, published library.

## Architecture in one paragraph

A read-only MCP server (`mcp-servers/kestrel-foundry-data`) is the data boundary over the
synthetic dataset in `data/`. Five typed decisions (`policy/policy.json`) are assembled from
numbered reference docs in `references/` and bounded memory files in `context/`. Every decision
output conforms to a JSON Schema in `schemas/`; cert-of-conformance completeness is verified
deterministically against content hashes in `data/index.json` — an agent literally cannot mark
a missing record "present" and pass validation.

## Conventions

- Node >= 20, ESM (`.mjs`), zero runtime dependencies outside `package.json`. No build step.
- Scripts are deterministic and idempotent. `npm run generate:data` reproduces the dataset
  byte-identically (seeded PRNG, no wall-clock reads).
- Agent guarantees live in code, schemas, and hooks — never only in prompt prose.
- `data/`, `references/`, and `schemas/` are immutable to agents (enforced by
  `hooks/publish-gate.mjs`). Agent-written reports go to `reports/drafts/`; publishing to
  `reports/published/` requires human confirmation.
- Tests: `npm test` (app and `packages/broker`); every guard: `npm run evals:mutate`.
- Never commit real Kestrel data, credentials, or export-controlled content. Synthetic only.
