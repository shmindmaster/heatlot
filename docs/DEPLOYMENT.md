# Deployment

There is no hosted application. A release is a `v<version>` tag on a commit
that is on `main`. `.github/workflows/release.yml` runs the same Compose
checks as CI, publishes the GitHub release with `docs/TESTING.md` and
`reports/eval-gate/report.json`, and publishes the npm package only when the
repository variable `NPM_TRUSTED_PUBLISHING` is `true`.

The npm job uses trusted publishing. No npm token is stored. npm can trust a
workflow only after the package exists, so the first publish is manual:

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
