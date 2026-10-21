# Roadmap

Heatlot is an early public reference implementation. The immediate goal is to
make the deterministic-control pattern easier to test, port, and evaluate
without turning the repository into a hosted product.

## Now

- Keep the offline replay path, full verification suite, mutation harness, and
  synthetic corpus green on supported Node.js versions.
- Publish a versioned first release once CI and the public contribution surface
  have been exercised on the public repository.
- Add more adversarial cases around policy parsing, authorization binding, and
  provider-schema differences.
- Keep the release gate's floors (`evals/gate.json`) rising with the suite; the
  benchmark it writes is `docs/benchmark.md`.

## Next

- Extract the control-layer primitives behind a small, documented API without
  weakening the executable reference implementation.
- Add a second synthetic domain port that demonstrates which parts are reusable
  and which must remain domain-owned.
- Add an optional external ledger anchor and measure the guarantees it adds.

## Not promised

Heatlot is not currently a hosted service, compliance certification, generalized
agent framework, or production security boundary. Those labels will not be used
until the corresponding implementation and evidence exist.
