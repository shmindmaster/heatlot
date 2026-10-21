# 0006. Cited extraction; the rules decide; release through the broker

**Status:** accepted (2026-10-15)

## Context

A model can read a mill test report faster than a person, and it can be confidently wrong or
manipulated by text the person never sees. The inspection decision has to be right when the
model is wrong.

## Decision

- The model (or the replayed response of one) returns every field as `{ value, cite }`, where
  `cite` names the document, page and line. Its draft verdict is recorded and never acted on.
- `src/inspection/cite.mjs` admits a value only if the cited line exists, is visible, and says
  the value. Admitted values carry the cited line's sha256. Rejected values are reported with the
  reason and treated as absent.
- `src/inspection/rules.mjs` computes the verdict from admitted values and the spec table:
  required tests, chemistry and mechanical limits, specification revision against the PO, heat
  traceability from PO to CoC to mill heat, and required statements. NONCONFORMING outranks
  INCOMPLETE, which outranks ACCEPT. Every finding carries its citations.
- Hidden lines (under 3 pt) and instruction-shaped lines are tripwires: recorded as receipts and
  passed to the broker as untrusted inputs, so a release approval that they fed is refused.
- `src/inspection/inspect.mjs` writes a signed receipt at each step through `packages/broker`.
  Anything but ACCEPT quarantines the material and writes a nonconformance record. Release needs
  an inspector's approval, which is minted only for an ACCEPT, bound to the hash of the decision
  (packet files, spec, verdict, findings), and usable once.

## Consequences

- A planted or hallucinated value cannot carry a packet to ACCEPT: it is either not on its cited
  line, or on a hidden one.
- The replay fixtures are authored, and labelled as authored in their provenance. PKT-24002's
  fixture simulates a model that believed the hidden note. A live-model adapter will record real
  responses with provenance kind `recorded`.
- Each run appends to the packet's ledger, so re-inspecting a packet extends its audit trail
  rather than replacing it.
