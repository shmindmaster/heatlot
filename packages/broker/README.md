# @heatlot/broker (internal)

**Your agent can't be talked into an action you didn't authorize.**

`heatlot-broker` sits between an AI agent and its side effects. A wrapped tool runs only with an
authorization that was minted for that tool and that exact payload, has not been used, and was not
derived from untrusted input. Every mint, refusal, use and outcome is an Ed25519-signed,
hash-chained receipt that anyone with the public key can verify offline.

It is the extracted core of this repository's effect broker, kept as an internal package
(`private: true`) until it ships inside the public `heatlot` package. Zero dependencies.
Node 20 or later.

## Wrap a tool in three lines

```js
import { Broker } from '@heatlot/broker';
const broker = new Broker({ dir: '.heatlot', privateKey: process.env.HEATLOT_SIGNING_KEY });
const sendEmail = broker.guard('send_email', realSendEmail);
```

`sendEmail(payload, { authorization })` now refuses, and records why, unless:

| Check | Refusal rule |
|---|---|
| An authorization was passed | `no-authorization` |
| The ledger shows it being minted | `never-minted` |
| It was minted for this tool | `wrong-tool` |
| The payload hashes to exactly what was approved | `payload-changed` |
| It has not been used before (checked on the ledger, so it survives a restart) | `already-used` |
| The ledger's chain and signatures verify | `ledger-broken` |

## Approve, and refuse anything downstream of untrusted content

```js
import { trusted, untrusted } from '@heatlot/broker';

const authorization = broker.approve('send_email', payload, {
  by: 'alice@example.com',                       // a human, or deterministic code you trust
  inputs: [
    trusted(manifest, { source: 'erp/PO-1' }),
    untrusted(supplierNote, { source: 'email/inbound/123' }),
  ],
});
// -> throws HeatlotRefusal('untrusted-input') and writes an authorization_refused receipt
```

The model can read untrusted content and draft whatever it likes. What it cannot do is turn that
content into an authorization: the inputs that fed a decision are bound into the mint, and any
untrusted one blocks it.

## Proxy an MCP server

```bash
node packages/broker/bin/broker.mjs keygen --dir .heatlot
node packages/broker/bin/broker.mjs mcp-proxy --dir .heatlot -- node your-mcp-server.mjs
```

Configure your MCP client to launch the proxy instead of the server. Tools annotated
`readOnlyHint: true` pass through with a receipt. Every other tool call (including a tool the proxy
has not seen listed) needs an authorization in `params._meta["heatlot/authorization"]`:

```bash
node packages/broker/bin/broker.mjs approve --dir .heatlot --tool send_email --args '{"to":"a@example.com"}' --by alice
```

A refused call never reaches the upstream server; the client gets an `isError` result naming the
rule. Works with both MCP protocol eras over stdio.

## Verify the receipts

```bash
node packages/broker/bin/broker.mjs verify --dir .heatlot
# verified: 7 receipts, chain and signatures intact
# BROKEN at receipt 4: payload hash does not match the payload; receipts 5..6 are unverifiable
```

Each receipt carries the sha256 of its payload and of its predecessor, and a signature over its own
hash. Changing one byte breaks the chain at that receipt. Rewriting the chain with recomputed hashes
fails the signature check unless the rewriter holds the private key.

## Limits, stated plainly

- The signing key and the ledger live where the broker runs. Whoever holds the private key can
  rewrite history; nothing anchors the chain externally yet (a transparency log or a remote
  witness would).
- Single use is recorded on the ledger. Two processes appending to one ledger directory at the
  same instant are not serialised; run one broker per ledger.
- Taint is declared, not inferred: the broker refuses untrusted inputs you pass to `approve()`. It
  does not trace data flow through your code.
- It cannot save you from a wrong approval, a compromised host, or an MCP server that lies about
  `readOnlyHint`.

## Every guard is proven able to fail

The repository's mutation harness removes each check above in turn (single use, payload
binding, untrusted-input refusal, the ledger mint lookup, the signature check, the proxy's
fail-closed default) and requires a named test to fail. Run it with `npm run evals:mutate` from the
repository root.

## License

Apache-2.0.
