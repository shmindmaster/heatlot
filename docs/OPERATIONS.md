# Operations

`docker compose run --rm verify` is the definition of green. It is offline.
`docker compose run --rm gate` must say release allowed, and `drill` must
block each regression in `evals/regressions/`.

Live checks are not in CI. `npm run verify:live` with `HEATLOT_LIVE=1` replays
the injection scenario against a real provider and records provenance.
Recorded runs are under `evidence/live-run-2026-10-14/` (Anthropic) and
`evidence/live-run-2026-10-15-openai/` (OpenAI). Do not delete them. Fixtures
go stale until someone runs that command.

Original foundry receipts are an unsigned append-only hash chain under `ledger/`. The chain shows
alteration of a receipt. It does not stop someone with write access from
replacing the whole chain. There is no external anchor and no retention
policy. A clock is not stored. Sequence is a logical counter.

Packet inspection instead writes `inspection.json`, optional `ncr.json`, and
Ed25519-signed `receipts.jsonl` under `.heatlot/<packet>/`. CLI approval saves
`authorization.json`; release writes `release.json`. Set `HEATLOT_OUT` or CLI
`--out` consistently across verify, approve, release and receipts to relocate it.
Keys are generated under the output root's `keys/`; protect the private key and
back it up with the records. The repository provides no rotation or retention
workflow. The key holder can rewrite history; run only one broker per ledger.

`heatlot receipts <packet-dir>` verifies packet chain and signatures;
`npm run audit` checks the original foundry chain, not the packet ledger.
Do not delete a packet ledger to clear a release refusal: it holds consumption
and release history. Corrected supplier submissions should use a new packet ID
with `resubmits` linking to the original (as PKT-24002R does).

The broker has no override. A wrong rule is enforced exactly. Review of a
deterministic rule is the owner's review, not a model retry.

CodeQL stays in `.github/workflows/codeql.yml`. Production dependency audit
runs in CI inside the image.
