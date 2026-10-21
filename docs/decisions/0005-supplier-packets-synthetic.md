# 0005. Synthetic supplier packets as generated PDFs

**Status:** accepted (2026-10-15)

## Context

Heatlot verifies supplier certificates of conformance and mill test reports. A credible demo and
test suite need real PDFs: text laid out on pages, scanned-looking copies, and the attack that
matters most here, text that is present in the PDF's text layer but invisible on the page.
Real supplier paperwork cannot be used: it belongs to other companies and carries real heat
numbers, names and signatures.

## Decision

`scripts/generate-packets.mjs` writes every packet with `pdf-lib`, deterministically (fixed
metadata dates, no random ids), from the scenarios in `scripts/packets-world.mjs`. Every
company, mill, person, part number, heat and specification is fictional. The specification
table (`data/specs/HLS-4140.json`) is modelled on the shape of public material specifications:
chemistry ranges, minimum mechanicals, required tests and required statements. No specification
text is copied.

`src/documents/text-layer.mjs` reads a PDF into numbered lines with `pdfjs-dist`: page, line,
text, sha256 of the text, bounding box and font size. These lines are what every citation points
at. A line set below 3 pt is flagged `hidden`.

## Consequences

- The packets reproduce byte for byte; `verify:all` regenerates them and CI fails if they drift.
- The hero packet (PKT-24002) has no tensile result and a one-point white line telling an
  automated reviewer the test was waived. It is the case the film and the evals are built on.
- Hidden-text detection by font size catches this attack, not every one: white text at normal
  size, or text under an image, needs the rendering-based check planned for the extraction step.
