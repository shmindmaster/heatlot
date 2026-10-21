# Contributing to Heatlot

Heatlot welcomes focused bug reports, adversarial fixtures, mutations, and small
changes that strengthen its core claim: software owns hard guarantees while the
model supplies judgment.

## Before opening a change

Open an issue first for a new control surface, a changed policy contract, or a
large port. Small fixes may go directly to a pull request. Keep examples
synthetic and never commit secrets, customer data, or proprietary prompts.

## Local verification

Heatlot requires Node.js 20 or newer.

```bash
npm ci
npm run verify:all
```

After `npm ci`, the verification suite runs without an API key or network call.
The final command intentionally exercises both successful and refused outcomes;
the wrapper checks each expected exit code.

If you change generated data, edit `scripts/generate-data.mjs` and regenerate it.
Do not hand-edit files under `data/`. If you add or weaken a guard, add a mutation
that proves the suite detects the corresponding failure.

## Pull requests

A reviewable pull request should explain the invariant being changed, include a
test for the positive and refusal paths where relevant, update the threat model
or architecture record if the boundary changes, and leave `npm run verify:all`
green. Keep unrelated refactors out of the same change.

By contributing, you agree that your contribution is licensed under Apache-2.0
and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
