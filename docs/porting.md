# 1. Porting Heatlot to another domain

The foundry is not the point. It is a domain where a wrong answer leaves a paper
trail, which makes the control layer legible in a terminal. Everything structural
here transfers to any domain with the same shape.

## 1.1 Does your domain fit?

The pattern earns its cost when four things are true.

**There is a decision with a consequence.** Something gets released, paid,
submitted, approved or sent. If the output is only ever read by a person who then
decides, you need S1, S2 and S6 and can skip S4 and S5.

**Correctness is resolvable against evidence you hold.** The completeness rule
here is "does this record exist and hash as claimed". Yours might be "does this
invoice line reconcile to a purchase order", "is this claim code valid for this
diagnosis", "does this filing cite a case that exists". If nothing in your system
can answer the question, S4 has nothing to compute and the model's judgment is
all you have — be honest about that rather than dressing it up.

**Being wrong is expensive enough to justify refusing.** A control layer's
characteristic behaviour is declining to act. In a domain where stopping costs
more than a rare bad output, this is the wrong architecture.

**Someone will ask how a decision was made.** If not, S6 is overhead.

## 1.2 What to change

In rough order of effort.

| Layer | What changes | Effort |
|---|---|---|
| `data/` and `scripts/generate-data.mjs` | Your corpus, or a connector to the real one | Largest |
| `mcp-servers/` | Read-only tools over your sources | Large |
| `references/`, `context/` | Your domain vocabulary and memory | Moderate |
| `schemas/` | Your decision contracts | Moderate |
| `scripts/verify-*.mjs` | Your deterministic rules | Moderate, and the part to get right |
| `policy/policy.json` | Your agents, boundaries, effects, tripwires | Small |
| `evals/` | Your cases, including refusals; a mutation per guard | Small per guard, ongoing |

## 1.3 What not to change

These are the pattern, not the example.

`src/ledger/` is domain-free — receipts, hashing and chain verification do not
know what a heat lot is.

`src/effects/` is domain-free apart from which verdict authorizes which effect,
and that lives in `policy/policy.json`, not in code.

`src/providers/` and `src/decisions/` are domain-free; they care about schemas,
not about what the schemas describe.

`src/context/assembler.mjs` is domain-free apart from block priorities, which are
configuration.

If you find yourself editing one of these to accommodate your domain, something
domain-specific has leaked into a general layer — that is the signal to push it
back out into `policy/policy.json` or a schema.

## 1.4 The order that works

1. **Write the verifier first**, before any agent. If you cannot compute your
   correctness rule deterministically, stop — you have learned the most important
   thing about the project, and it is better learned now.
2. **Write the refusal eval second.** One case where the rule says no, and the
   exit code that means it. This is your contract.
3. **Write the mutation third.** Break the verifier deliberately and confirm the
   refusal case notices. A guard you have not seen fail is not yet evidence.
4. **Then the schema, then the agent.** By this point the agent has nothing to
   prove — the guarantee is already held elsewhere, and the agent is a drafting
   convenience.

That order is deliberately the reverse of how agent projects usually go. Starting
with the agent produces a demo; starting with the verifier produces a system.

## 1.5 A caution about the deterministic rule

Moving authority out of the model does not eliminate the risk of being wrong. It
relocates it into `scripts/verify-*.mjs`, where a mistake is enforced precisely,
every time, with a receipt attesting to it.

That trade is worth making — systematic errors are findable and unpredictable
ones are not — but it means the deterministic rules deserve the review attention
that would otherwise go to prompts. `docs/threat-model.md` §4 states this plainly,
and it is the thing most likely to bite a port.
