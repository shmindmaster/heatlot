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
