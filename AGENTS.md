# AGENTS.md — Heatlot

Instructions for any coding agent working in this repository.

## 1. What this repository is

A reference implementation of a deterministic control layer around an LLM agent.
The agent drafts; software decides. Anything needing a hard guarantee — schema,
permission, routing, approval, side effect, final state — is owned by code.

Read `README.md` for the argument and `docs/architecture.md` for the structure
before changing anything.

## 2. Non-negotiable properties

Every one of these is load-bearing. A change that breaks one is a defect even if
the tests pass.

- **Offline.** Once `npm install` has fetched dependencies, no command in this
  repository requires an API key, an account, or a network call. Setup —
  `git clone` and `npm install` — obviously needs the network; nothing after it
  does. The default provider replays fixtures, demo scripts name replay
  explicitly rather than relying on the default, and spawned children have
  `HEATLOT_LIVE` stripped. Live calls are opt-in behind `HEATLOT_LIVE=1` and belong
  only to `npm run verify:live`.
- **Reproducible.** Seeded generators, logical counters, no wall clock in any
  output a test or a reviewer compares. Two runs produce identical bytes.
- **Fail closed.** A missing or malformed input is an error. Never a default,
  never a coercion, never an unbounded retry.
- **No override path.** There is no force flag, environment variable, or debug
  mode that bypasses the effect broker. Adding one is the bug, not the fix.
- **Synthetic only.** Kestrel Castings is fictional. Never introduce a real
  company, person, customer, system, credential, or record — in content, in a
  fixture, in a comment, or in a commit message.

## 3. Change contract

- Dataset changes go through `scripts/generate-data.mjs`, which is seeded and
  reproducible. Never hand-edit anything under `data/`.
- Changing a decision's scope means updating, in the same commit: its schema in
  `schemas/`, its entry in `policy/policy.json`, its eval cases in `evals/cases/`,
  and `docs/architecture.md`.
- `packages/broker/` is the published library. A change to it keeps its own
  tests and its mutations in `evals/mutations/` green, and bumps its version.
- **Adding a guard means adding a mutation.** A new check in the control layer
  is not finished until `evals/mutations/` contains a patch that defeats it and
  the harness proves the suite catches that patch. A guard with no mutation is
  an unverified claim.
- Rules live in `policy/policy.json`. Code reads them; code does not hold its
  own copy. A hard-coded path or permission is a defect.
- Keep proposed, implemented, tested, and verified distinct in commit messages.
  Never describe something as verified without having run it.

## 4. Verify before committing

```
npm test
npm run evals
npm run evals:mutate
npm run smoke:mcp
npm run validate:schemas
npm run verify:all
npm run gate
npm run gate:drill
npm run test:browser   # needs a browser: npx playwright install chromium-headless-shell
```

Report what you verified, not what you wrote. If a command fails, fix it or say
plainly that it fails and why — never work around it silently.
