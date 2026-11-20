# Development

Git, Docker, and an editor are enough. The image is Node 22.

```text
docker compose run --build --rm verify
docker compose run --rm gate
docker compose run --rm drill
docker compose run --rm reference
docker compose run --rm openapi
```

`verify` regenerates `data/` and the packet PDFs, then runs the suite. The
checkout is mounted, and `node_modules` stays in the image. Rebuild when
`package.json` or `package-lock.json` changes.

`gate` rewrites `docs/TESTING.md`. Commit that file when the floors change.
`reference` checks `docs/API.md` and the two `catalog.json` files.
`openapi` checks `docs/api/openapi.json`.

Do not create `node_modules` in the checkout. Do not hand-edit `data/`,
`docs/API.md`, `docs/TESTING.md`, or `docs/api/openapi.json`.

## Run the CLI and console

Override the `verify` service command to run a single command:

```text
docker compose run --rm verify npm run heatlot -- verify data/packets/PKT-24002
docker compose run --rm verify sh
```

The first command intentionally exits 3. The second opens a shell for README npm
examples. Output persists in the checkout's `.heatlot/`; `HEATLOT_OUT` or CLI
`--out` selects another directory.

For the console, run `npx heatlot@0.4.0 serve` outside the checkout with existing
Node >=22.13, then open http://127.0.0.1:4140. The server binds to
`127.0.0.1` only (`bin/heatlot.mjs`), so a container's listener is not reachable
through `docker compose run -p`; there is no Compose service that serves the
console. The Compose `console` service runs browser tests, not a server.
[Integrations](INTEGRATIONS.md) documents routes and configuration.

## Add a guard and its mutation

1. Put the guard at its authority boundary. Foundry permissions belong in
   `policy/policy.json`; packet checks belong in inspection rules or the broker.
2. Add a named test for success, absent/empty inputs and refusal/error cases.
   Refusals should leave auditable reasons rather than silently skipping work.
3. Add `evals/mutations/<guard>.json`, following a neighbor such as
   `inspect-skip-file-recheck.json`: set `id`, `guard`, `target`,
   `patch: {find, replace}`, `expected_eval`, and `catcher_pattern`.
   `find` must match exactly once; the replacement deliberately removes the guard.
   The catcher must name the specific assertion, not a generic error.
4. Run `docker compose run --rm verify npm run evals:mutate`. Scratch copies
   are patched; each mutation must fail with its named catcher.
5. Update docs and, when raising the coverage floor, `evals/gate.json`; regenerate
   `docs/TESTING.md` with `gate`. Run `verify`, `gate`, and `drill`.

Decision-scope changes update schemas, policy, eval cases and architecture together.
[Data](DATA.md) covers generated packets and foundry records.

## Documentation checks

`reference` and `openapi` are check-only services. Regenerate deliberately with
`docker compose run --rm verify npm run docs:reference` or
`docker compose run --rm verify npm run docs:openapi`.
`docker compose run --rm lint` runs Redocly. CI compares OpenAPI against the
latest tag containing the contract and fuzzes HTTP with Schemathesis.
There is no dedicated Markdown link or Mermaid renderer check.

If Docker cannot build, do not install Node or dependencies in this checkout.
With existing supported Node, copy the tree elsewhere, run `npm ci --ignore-scripts`
there, and run `verify:all`, `gate`, `gate:drill`, `docs:reference -- --check`,
`docs:openapi -- --check`, and `lint:openapi` there. This is a fallback check,
not evidence that the Docker/CI environment passed.
