# Integrations

Two MCP servers live in `mcp-servers/`. `kestrel-foundry-data` is read-only
over the synthetic dataset. `heatlot` calls the HTTP routes in process.
`packets.inspect` is the only tool that writes, and it only appends receipts.
There is no release tool. Release is an inspector's decision. The tool tables
are generated into `docs/API.md`.

The default model provider is `src/providers/replay.mjs`. It serves recorded
payloads from `fixtures/provider/`, so the strict tool-use and structured-output
adapters actually run. Anthropic and OpenAI live adapters are opt-in through
`HEATLOT_LIVE=1` and `npm run verify:live`. A missing fixture fails by name.
It does not fall through to a live call.

Hidden and instruction-shaped lines are detected with `subtext-scan` plus a
font-size floor under 3 pt. Those lines are tripwires. They are recorded and
passed to the broker as untrusted, so a release that they fed is refused.

The HTTP API is Hono, bound to `127.0.0.1`. `heatlot serve` prints the port
and serves the console from `console/`.
