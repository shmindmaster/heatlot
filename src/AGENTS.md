# Source

The root `AGENTS.md` applies.

`src/inspection/` cites lines and applies generated `data/specs/` via deterministic rules.
Material release goes through `src/inspection/inspect.mjs` and `packages/broker`.
The original foundry publish path uses `src/effects/broker.mjs` and `policy/policy.json`.
Inspection defaults to authored extraction replay; `src/providers/replay.mjs` is the
separate foundry typed-decision default. Live adapters stay behind `HEATLOT_LIVE=1`.
`src/documents/text-layer.mjs` is what a citation points at.
