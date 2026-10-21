# Security policy

Heatlot is a reference implementation, not a hosted service. Security reports are
still important because people may reuse its policy, authorization, ledger, and
provider-adapter patterns in systems that do make real changes.

## Supported version

Security fixes target the current `main` branch and the latest tagged release
(currently v0.3.x). The project is pre-1.0, so there is no long-term support line.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository. Please do not
open a public issue for a suspected vulnerability.

Include the affected file or control surface, a minimal reproduction, the
expected security property, the observed result, and any suggested test or
mutation that would keep the defect from returning. Do not include real
credentials, customer data, or production records.

The maintainer will acknowledge a complete report as soon as practical, assess
impact, and coordinate disclosure after a fix is available. No response-time or
remediation-time guarantee is made.

## Scope

High-value reports include bypasses of the effect broker, authorization replay,
write-boundary escapes, receipt-chain tampering that goes undetected, unsafe
provider-schema transforms, or source content that can alter a deterministic
outcome. The documented limitations in `docs/threat-model.md` are not themselves
vulnerabilities.
