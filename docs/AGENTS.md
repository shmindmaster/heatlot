# Docs

The root `AGENTS.md` applies.

`docs/API.md` and `docs/TESTING.md` are generated. Change the servers, schemas,
or gate, then regenerate inside the image. Do not hand-edit those two files.

`docs/api/openapi.json` is the published HTTP contract. `npm run docs:openapi`
writes it. The path stays, because released tags and the npm package point at it.

`docs/media/` holds the README images. Live provider recordings are `evidence/`
at the repository root, not under `docs/`.
