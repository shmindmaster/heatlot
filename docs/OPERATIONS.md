# Operations

`docker compose run --rm verify` is the definition of green. It is offline.
`docker compose run --rm gate` must say release allowed, and `drill` must
block each regression in `evals/regressions/`.

Live checks are not in CI. `npm run verify:live` with `HEATLOT_LIVE=1` replays
the injection scenario against a real provider and records provenance.
Recorded runs are under `evidence/live-run-2026-10-14/` (Anthropic) and
`evidence/live-run-2026-10-15-openai/` (OpenAI). Do not delete them. Fixtures
go stale until someone runs that command.

Receipts are an append-only hash chain under `ledger/`. The chain shows
alteration of a receipt. It does not stop someone with write access from
replacing the whole chain. There is no external anchor and no retention
policy. A clock is not stored. Sequence is a logical counter.

The broker has no override. A wrong rule is enforced exactly. Review of a
deterministic rule is the owner's review, not a model retry.

CodeQL stays in `.github/workflows/codeql.yml`. Production dependency audit
runs in CI inside the image.
