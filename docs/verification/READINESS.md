```yaml
product: Heatlot (rebuild of Assay)
repo: C:\Repos\shmindmaster\assay (github.com/shmindmaster/heatlot; renamed from shmindmaster/assay on 2026-10-15)
commit: 377bb8e
verdict: Functionally Ready (not yet released or filmed)
functional_ready: yes
demo_ready: no
production_ready: no
deployed_sha: 46cc33d (release v0.3.0, published as Assay, https://github.com/shmindmaster/heatlot/releases/tag/v0.3.0)
tests: "CI Node 22 + 24 @ 377bb8e: verify:all, gate (26/26 mutations), Schemathesis, Redocly, OpenAPI and reference drift, MCP conformance (2 servers x 2 revisions), smoke:package, test:console (axe WCAG 2.2 AA), test:browser"
films: ["D:\\OneDrive - Maya Modest LLC\\Videos\\Portfolio\\Assay\\01 - The Agent Drafts, Software Decides.mp4 (Assay; superseded by the Heatlot film, not yet made)"]
blockers: ["npm publish of heatlot needs the maintainer's one-time npm login (docs/RELEASING.md)"]
api_surface: "HTTP API (Hono) with OpenAPI 3.1.1 generated from zod, Scalar at /docs/api, Redocly lint, oasdiff and Schemathesis in CI; heatlot MCP server (list/inspect/lines/receipts, no release tool) with conformance at both revisions"
next_action: "Heatlot film (Local-AI narration) in a heavy-work slot; cut v0.4.0 once the maintainer has done the one-time npm setup"
updated: 2026-10-15T11:30:00-05:00
```

# Readiness

## Verdict: Functionally Ready (not yet released or filmed)

Re-rated on 2026-10-15 at `377bb8e`. Heatlot's whole flow runs and is tested in CI: synthetic supplier packets in, cited extraction, specification rules, ACCEPT / INCOMPLETE / NONCONFORMING with every reason cited, quarantine and NCR, a single-use decision-bound release that happens once per packet, and signed receipts, through the CLI, the HTTP API, the MCP server and the inspection console. Every guard is proven able to fail (26 of 26 mutations caught).

| Readiness | Status | Why |
|---|---|---|
| Functional | **Yes** | Every capability in [COVERAGE.md](COVERAGE.md) is at least Tested, except live-model extraction (planned; replay fixtures are authored and labelled) and npm publication. |
| Demo | **No** | The console and `heatlot demo` run with no key, but the Heatlot film is not made yet. |
| Production | **No** | No Heatlot release is tagged, and `heatlot` is not on npm. The package is verified installable (`smoke:package`); the first publish needs the maintainer's npm login. |

## History: Assay verification (v0.3.0)

## Production evidence (v0.3.0)

| Check | Result |
|---|---|
| Tag | `v0.3.0` (annotated) on `46cc33d`, the squash-merge of PR #19 |
| Release workflow | Run 38707067941: `Release gate` success, then `Publish release` success; published 2026-10-15T08:40:12Z |
| Attached gate report | `report.json`: `allowed: true`; eval-suite, guard-coverage, refusal-correctness, replay-determinism and audit-replay all pass |
| Attached benchmark | `benchmark.md`, identical to the committed copy (CI enforces the match) |
| Smoke from the published archive | `npm ci` clean; `verify:coc PO-AER-5519` exit 3 (incomplete); `verify:coc PO-MER-5532` exit 0 (complete); `demo:injection` exit 0 with the authorization refused and the effect denied under `untrusted-context`; 6 receipts, chain verified |

## API surface and contract enforcement (2026-10-15)

The engineering quality pass found two real gaps in the MCP contract and fixed both, with tests that fail on the old behavior. Tool inputs silently dropped unknown arguments, and `tools:report` carried a hand-copied set of schemas that had drifted from the server. Conformance at both protocol revisions now runs in CI and in the release gate. The baselines list only features the server deliberately does not offer, so the verdict stands. Details: [TECHNICAL.md](TECHNICAL.md#api-surface-and-mcp-decision). These changes are on main at `d76aa1e`, where CI passed on Node 20 and Node 22 (run 38734598133). They are not yet in a release; v0.3.0 predates them.

## Blockers

None.

Resolved 2026-10-15:
- The first gated release was cut (v0.3.0).
- The OpenAI live path was verified with full provenance.

## Risks

- The ledger has no external anchor, so it is tamper-evident but not unforgeable. This is documented, not hidden: README §8 and threat model §3.5.
- Accessibility of the Explorer is designed for (focus styles, reduced motion, a narrow layout) but not measured.

## Next highest-value action

Measure the Explorer's accessibility (an axe pass in the browser test), then deliver the format A executive cut once a heavy-work slot frees.

## Gap tracking

Linear is the tracker for shmindmaster products. The Linear connector was not authorized in this session, so the gaps above are tracked here until they can be filed.
