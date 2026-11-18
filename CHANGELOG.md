# Changelog

All notable changes to Heatlot are documented here. The format is based on
Keep a Changelog (https://keepachangelog.com/en/1.1.0/), and this project
adheres to Semantic Versioning (https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-18

First release published to npm as heatlot. Run the hero packet with no clone
and no API key: npx heatlot demo (exits 3, INCOMPLETE, naming the missing
tensile test).

### Added
- Cited extraction: every field proposes a value with its document, page and
  line, and a hash of that line. A value not on a visible cited line is rejected.
- Specification rules as data: chemistry and mechanical ranges, required tests,
  revision match, heat traceability and required statements compute the verdict
  (ACCEPT, INCOMPLETE, NONCONFORMING).
- Single-use release authorization bound to the hash of the exact decision,
  enforced by the effect broker; quarantine and a nonconformance record otherwise.
- Ed25519-signed, hash-chained receipts that verify offline.
- Synthetic supplier packets (CoC and MTR PDFs), including a hidden-text attack.
- HTTP API with a generated OpenAPI 3.1 document and Scalar reference; heatlot
  MCP server; conformance across both protocol eras with a shrink-only baseline.
- Browser inspection console: queue, PDF with cited highlights, rule-by-rule
  verdict, release and receipt chain, with an axe WCAG 2.2 AA scan.
- Mutation harness: 30 mutations, each removing a guard, all required to be caught.
- npm-ready package with a standalone install-and-run smoke test in CI.

### Changed
- Rebranded from Assay to Heatlot; Node.js 22.13 or newer.
- Hidden-text detection now uses subtext-scan: colour against background, cover,
  clip, render mode, opacity and layer, in addition to tiny type.
- Guard-coverage release floor raised to 30 mutations, all caught.
- The broker is extracted as packages/broker, a zero-dependency library.

### Fixed
- Hidden-text grouping, cross-document citations and MCP batch rejection
  (verified review findings).
- Accessible names for console document tabs; citations contain their visible labels.

### Security
- The fail-closed effect broker is the only code path that can release material;
  there is no override flag. A release that depended on untrusted text is refused.

## [0.3.0] - 2026-10-15

Released as Assay. Earlier reference implementation of the same deterministic
control layer on the synthetic Kestrel Castings foundry dataset.

## [0.2.0] - 2026-09-16

Released as Assay. Deterministic control layer reference.

[0.4.0]: https://github.com/shmindmaster/heatlot/releases/tag/v0.4.0
[0.3.0]: https://github.com/shmindmaster/heatlot/releases/tag/v0.3.0
[0.2.0]: https://github.com/shmindmaster/heatlot/releases/tag/v0.2.0
