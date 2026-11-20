## What changes

Describe the invariant, behavior, or documentation being changed.

## Evidence

- [ ] `docker compose run --build --rm verify`, `gate` and `drill` pass
- [ ] Positive and refusal paths are covered where relevant
- [ ] A changed or new guard has a mutation that proves it can fail
- [ ] Generated data was changed through its generator (foundry: `scripts/generate-data.mjs`; packets/specs: `scripts/generate-packets.mjs`), not by hand
- [ ] No secrets, customer data, proprietary prompts, or real operational records are included

## Boundary impact

Name any change to schemas, policy, authorization, effects, receipts, provider transforms, or documented threat assumptions. Write `none` if there is no boundary change.
