# heatlot

Receiving inspection for supplier certificates and mill test reports. The model
drafts; software decides. `packages/broker` is the published effect broker.
`mcp-servers/kestrel-foundry-data` is the read-only data boundary. `mcp-servers/heatlot`
calls the same routes as the HTTP API. Kestrel Castings is fictional.

## Commands

```text
docker compose run --build --rm verify
docker compose run --rm gate
docker compose run --rm drill
```

`verify` is `npm run verify:all`. Do not install Node or create `node_modules`
in the checkout. Do not set `HEATLOT_LIVE` for these commands.

## Rules

- Offline after the image exists. Live calls are `npm run verify:live` with
  `HEATLOT_LIVE=1` only.
- Seeded generators, logical counters, no wall clock in compared output.
- Fail closed. No override path around `src/effects/broker.mjs`.
- Dataset changes go through `scripts/generate-data.mjs`. Do not hand-edit `data/`.
- A new guard needs a mutation in `evals/mutations/`.
- Rules live in `policy/policy.json`. `data/`, `references/`, and `schemas/`
  are not agent-writable; `hooks/publish-gate.mjs` enforces that.
  Draft reports go to `reports/drafts/`.
- A decision-scope change updates `schemas/`, `policy/policy.json`,
  `evals/cases/`, and `docs/ARCHITECTURE.md` together.
- The root `AGENTS.md` applies in every directory.

## Done

`verify`, `gate`, and `drill` pass, and `docs/TESTING.md` matches the gate.
Docs in `docs/` match the change. npm publish is a separate release.
