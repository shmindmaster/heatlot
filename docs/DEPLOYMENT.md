# Deployment

There is no hosted application. Release procedure is a `v<version>` tag on a
reviewed commit on `main`; the workflow triggers on any pushed `v*` tag and does
not itself check ancestry. `.github/workflows/release.yml` runs the Compose
checks as CI, publishes the GitHub release with `docs/TESTING.md` and
`reports/eval-gate/report.json`, and publishes the npm package only when the
repository variable `NPM_TRUSTED_PUBLISHING` is `true`.

The npm job uses trusted publishing. No npm token is stored. npm can trust a
workflow only after the package exists. v0.4.0 is already published; the following
is the bootstrap procedure, not a step to repeat for every release:

1. From a clean checkout of the release commit, `docker compose run --rm smoke`,
   then `npm publish --access public` by the account that will own `heatlot`.
2. On npm, add a trusted publisher: GitHub Actions, repository
   `shmindmaster/heatlot`, workflow `release.yml`.
3. Set the repository variable `NPM_TRUSTED_PUBLISHING` to `true`.

After that, bump `version` in `package.json`, merge, and tag
`git tag -a vX.Y.Z -m "Heatlot X.Y.Z"`. The published check is
`npx heatlot@X.Y.Z demo`, which exits 3 and names the missing tensile test.

`docs/api/openapi.json` is the contract compared against the last tag that
contains it. A breaking change needs a major version.
