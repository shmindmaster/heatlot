# 4. Replay by default, live calls opt-in

**Status:** accepted
**Surface:** S2

## 4.1 Decision

The default provider is `src/providers/replay.mjs`, which serves recorded
request and response pairs from `fixtures/provider/`. No documented command
requires an API key, an account, or a network call. Live provider calls are
opt-in behind `HEATLOT_LIVE=1` and are exercised only by `npm run verify:live`,
which is not part of `npm run demo` or `npm test`.

## 4.2 The constraint that forced it

Three constraints, all pointing the same way.

**Adoption.** A reviewer decides whether to read this in the first minute. A
prompt for a key spends that minute and usually ends the evaluation.

**Reproducibility.** The demos assert on exact output — a missing record, a
refusal, a `+31.8%` variance. A live model makes each run different, and a demo
that differs per run cannot be audited, which contradicts the repository's entire
argument.

**What is being demonstrated.** The claim is about the control layer, not about
model quality. The hero case needs the model to produce a specific wrong answer —
`COMPLETE` for PO-AER-5519 — so the broker can be seen catching it. Sampling for
that is unreliable and expensive; recording it is neither.

## 4.3 Alternatives rejected

**Live calls by default.** Rejected on all three constraints above.

**A local model.** Rejected: it trades a key for a multi-gigabyte download and a
GPU assumption, which is worse on adoption, and it does not fix reproducibility.

**A hand-written mock returning canned objects.** Rejected because it would not
exercise the adapters. Recorded fixtures are real provider payloads, so the
strict tool-use and structured-output paths are genuinely traversed rather than
stubbed past. The distinction is the difference between testing the thing and
testing around it.

**Dropping the live path entirely.** Rejected. Without it the adapters are
unfalsifiable — the fixtures would only ever prove they agree with themselves.
`npm run verify:live` is how a change to an adapter gets checked against the real
API, deliberately and by choice, rather than on every run. It replays the
injection scenario against the live model and records provenance on every
decision receipt; one recorded run is kept under `docs/evidence/` so a reader
without a key can see what a live receipt contains.

## 4.4 Consequences accepted

Fixtures go stale. A provider changing its response shape will not break
anything until someone runs the live path, so `npm run verify:live` is the only
thing standing between a recorded fixture and a fiction. This is the real cost of
the decision and it is not fully mitigated.

A missing fixture must fail loudly, naming the key and how to record it. A silent
fallthrough to a live call would reintroduce every constraint above at the worst
possible moment.

The replay key is a hash of decision id, prompt hash and provider name, so any
change to prompt assembly invalidates the fixtures. That coupling is intentional
— a fixture that survives a prompt change is no longer recording the same
question — but it makes prompt edits more expensive than they look.
