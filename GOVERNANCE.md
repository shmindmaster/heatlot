# Governance

Heatlot is currently a maintainer-led project. Sarosh Hussain (`@shmindmaster`) is
the founding maintainer and final decision-maker for releases, security fixes,
policy changes, and repository access.

## How decisions are made

Routine fixes are decided in pull-request review. Changes to a security
boundary, schema contract, effect, or project direction begin with a public
issue and record the accepted trade-off in `docs/decisions/` when the decision
is durable.

Decisions favor reproducible evidence over consensus by assertion. A proposed
guard should have a test that fails when the guard is removed or weakened. A
claim should name the command, fixture, or receipt that proves it.

## Contributions and maintainership

Contributors retain credit for their work. Repeated, high-quality contributions
may lead to scoped triage or review access. Broader maintainer access requires a
track record of sound review, security judgment, and care with the project's
fail-closed invariants. No path or timeline is guaranteed.

## Independence

Funding, sponsorship, or employment does not buy a security conclusion or an
undisclosed change in project policy. Material funding that affects priorities
will be disclosed in the repository.
