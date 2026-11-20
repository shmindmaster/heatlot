# Integrations

## Two provider paths

- **PDF inspection** (`src/inspection/inspect.mjs`): `replay` reads authored
  `fixtures/extraction/<packet>.json`; `reference` reads visible lines deterministically.
  Neither calls a live model. CLI `verify --provider reference` selects the latter.
- **Original foundry typed decisions** (`src/providers/index.mjs`): default
  `src/providers/replay.mjs` reads `fixtures/provider/`, with canonical-schema
  validation and bounded repair. Live adapters derive strict tool-use or
  structured-output contracts. A missing replay fixture fails by name, never
  falling through to a live call.

Anthropic and OpenAI live typed-decision adapters require `HEATLOT_LIVE=1`.
`npm run verify:live` exercises the original foundry injection scenario, not PDF
extraction. Leave live flags and credentials unset for all offline checks.

## HTTP and console

`npx heatlot@0.4.0 serve` binds to `127.0.0.1:4140`, serves the static console
from `console/` at `/`, Scalar at `/docs/api`, and OpenAPI 3.1 at `/openapi.json`.
The committed contract is [api/openapi.json](api/openapi.json); route declarations
are in `src/api/app.mjs`. No console build step is needed. See
[Development](DEVELOPMENT.md) for serving from the container.

Under `/api/packets/{packet}`, GET the packet, `documents/{doc}/lines`,
`documents/{doc}/pdf`, `inspection`, or `receipts`; POST `inspect`, `approve`,
or `release`. `/api/health` and `/api/packets` provide health and the queue.
`doc` is `mtr` or `coc`. Inspect before approving. Approval takes JSON
`{"by":"J. Mendez"}`; release takes `{"authorization": <the returned object>}`.
Non-ACCEPT inspections still return HTTP 200 with the verdict in the body.
Broker refusals return 409; errors use `{error:{code,message,rule?}}`.
See OpenAPI for the full request and error schemas.

There is no authentication: `by` is a supplied inspector label, not a verified
identity. Do not expose this local reference API as a shared service.

## MCP

Two stdio servers live in `mcp-servers/`. Launch them in the development image
(or the installed package for the Heatlot server):

```text
node mcp-servers/heatlot/src/server.mjs
node mcp-servers/kestrel-foundry-data/src/server.mjs
```

`heatlot` calls the HTTP routes in process. Its four tools are `packets.list`,
`packets.inspect`, `documents.lines`, and `receipts.verify`. Inspect records a
stored inspection, signed receipts, and a quarantine NCR for non-ACCEPT verdicts.
There is no approve/release tool. Read tools may initialize local broker
keys/directories; annotations describe their domain effect, not zero filesystem writes.

`kestrel-foundry-data` is read-only over the original synthetic foundry dataset
and requires a checkout (it is not in the root npm package). Complete generated
tool tables and decision schemas are in [API.md](API.md).

Both servers also accept `--http <port>` for local Streamable HTTP at `/mcp`
(port 0 chooses a free port). They bind to loopback and validate localhost Host
and Origin headers; this is used by the conformance suite, not a hosted endpoint.

## Configuration

| Variable / option | Scope and default |
|---|---|
| `HEATLOT_OUT` / CLI `--out` | Inspection records and signing keys; default `.heatlot` in the working directory; `--out` wins |
| `serve --port` / `--packets` | Port 4140; bundled `data/packets/` by default |
| `NO_COLOR` | Disables CLI colour when set |
| `HEATLOT_PROVIDER` | Foundry typed-decision selector; default `replay` (`verify:live` defaults to `anthropic`) |
| `HEATLOT_LIVE` | Only value `1` permits live typed-decision calls; does not enable live PDF extraction |
| `ANTHROPIC_API_KEY` | Live Anthropic credential; SDK also supports an `ant auth login` profile |
| `OPENAI_API_KEY` | Required for live OpenAI |
| `HEATLOT_ANTHROPIC_MODEL` | Default `claude-sonnet-5-5` |
| `HEATLOT_ANTHROPIC_EFFORT` | Default `medium`; allowed `low`, `medium`, `high`, `xhigh`, `max` |
| `HEATLOT_OPENAI_MODEL` | Default `gpt-6.1-sol`; endpoint fixed to `api.openai.com` |

Model names above are adapter defaults, not evidence of fresh live verification.
Historical live recordings are linked from [Operations](OPERATIONS.md).
