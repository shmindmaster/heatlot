# Releasing Heatlot

A release is a `v<version>` tag on a commit that is on `main`. `release.yml` then runs the full
verification, the release gate and the gate drill, publishes the GitHub release with the gate
report, and (once enabled) publishes the `heatlot` package to npm with provenance.

## One-time setup for npm (maintainer)

The npm job uses npm trusted publishing: GitHub Actions proves its identity to npm with OIDC,
so no npm token is stored anywhere. npm can only trust a workflow for a package that exists, so
the very first publish is manual.

1. `npm login` as the account that will own `heatlot`.
2. From a clean checkout of the release commit: `npm run smoke:package`, then
   `npm publish --access public`.
3. On npmjs.com, open the `heatlot` package settings, add a **Trusted Publisher**: GitHub
   Actions, repository `shmindmaster/heatlot`, workflow `release.yml`.
4. In the GitHub repository settings, add the repository variable
   `NPM_TRUSTED_PUBLISHING` = `true`.

From then on, pushing a tag `vX.Y.Z` that matches `package.json` publishes to npm after the
gate passes.

## Every release

1. Bump `version` in `package.json` on a branch, with the change notes in the PR. Merge on green.
2. Tag the merge commit: `git tag -a vX.Y.Z -m "Heatlot X.Y.Z"` and push the tag.
3. Check the release run: gate, GitHub release, npm job (when enabled).
4. Verify the published package: `npx heatlot@X.Y.Z demo` exits `3` and names the missing
   tensile test.
