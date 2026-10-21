# Demos

Every item is labelled **real recording** (captured from the running product or a real command) or **substitute**.

## Films

| # | Format | File | Length | SHA-256 | Label | QA |
|---|---|---|---|---|---|---|
| 01 | B: complete functional walkthrough | `D:\OneDrive - Maya Modest LLC\Videos\Portfolio\Heatlot\01 - The Agent Drafts, Software Decides.mp4` (+ `.srt`) | 2:36, 1920x1080 | `9de1e5a08c30c47ed29a635e0e7d8129dc1bbcb17e9bfca5a89179a55e0d8535` | Real recording | See below |

**Film 01 picture:**

- Every screen beat is a headless Playwright take finished with Recast, bound by hash in `capture/receipt.json`.
- The Explorer beats are the real page rendered by `npm run explorer`.
- The terminal and code beats replay real command output captured at `1067715` and source read with `git show`. They play in an offscreen stage page, not a live terminal, so the commands' timing is compressed; the page says so on screen.
- The live run shown is the real Sonnet 5.5 call (`req_011Cg3GxmZmrYjTfuCEWQrTL`).
- The end card is the only non-product frame.

**Film 01 QA, on the delivered file:**

- `validate-product-picture`, `validate-encoded-picture` and `validate-viewer-release`: PASS (0 errors); 95.7% screen time.
- Audio: -16.0 LUFS, true peak -1.3 dBTP.
- Captions: 51 cues, at most 42 characters per line and 19 characters per second.
- Action-result order verified for 8 moments: each result appears before it is spoken.
- Local Qwen3-ASR WER 0.021 against the authored script.
- Story review: 88.

Workspace and evidence: `D:\Local-AI\data\artifacts\media-studio\heatlot-showcase-20261014\qa\`.

Narration: ElevenLabs Bella, `eleven_v4`, not the owner's voice. The bed reuses an earlier film's ElevenLabs music.

## Recorded runs and traces

| Item | Label | Where |
|---|---|---|
| Live Sonnet 5.5 run: receipts and summary | Real recording | [`docs/evidence/live-run-2026-10-14/`](../evidence/live-run-2026-10-14/) |
| Live OpenAI `gpt-6.1-sol` run: receipts and summary | Real recording | [`docs/evidence/live-run-2026-10-15-openai/`](../evidence/live-run-2026-10-15-openai/) |
| Replay demo ledger (`npm run demo`) | Real run, model response replayed from a recorded fixture (labelled as replay on the receipt) | Regenerated on every run; not committed |
| Benchmark (`npm run gate`) | Real run | [`docs/benchmark.md`](../benchmark.md) |
| CI runs on `bfd326c` | Real | See [TESTS.md](TESTS.md) |

## Scripts

`npm run demo`, `npm run demo:injection`, `npm run demo:denied`, `npm run explorer`, `npm run audit -- --po PO-AER-5519`, `npm run policy:explain -- --agent coc-assembler`, `HEATLOT_LIVE=1 npm run verify:live`.

## Production plan (A, C, vertical short)

All three reuse film 01's receipt-bound footage where they can. They render only in an assigned heavy-work slot.

| Asset | Treatment | Length | Picture | Voice and sound | Status |
|---|---|---|---|---|---|
| **A. Hero / executive cut** | Problem-first commercial, two-voice cold open. The agent says "Certificate package complete. Ready to release." The narrator answers "It wasn't." Then proof: injection labelled, live provenance, tamper, guards proven able to fail. Ends on a CTA card. | about 72 s | Film 01 clips S01, S02, S05, S06 and S11 plus the end card; no new capture | ElevenLabs `eleven_v4`: Bella narrates, plus one library voice for the agent's single line (about 780 characters). Reused bed; one signature SFX ("link snaps"), reused across assets. | Screenplay locked in the media workspace (`heatlot-exec-20261015/story/a-cut-screenplay.md`). The earlier 78 s pure-recut draft is superseded. |
| **C. Technical deep dive** | Technical visualization. Follow one receipt from `append()` to the hash chain to `verifyChain()`, then the page's own verifier; then `mint_seq` and the ledger-backed single-use authorization, the broker's check order, live provenance on both adapters, and the mutation harness with the release gate and drill. | 5–6 min | Code stage over real source at the release commit; real JSONL receipts, `npm run audit`, `audit:tamper`, `test:browser` output; one earned diagram (the hash chain); Explorer clips from film 01 | Local Qwen3-TTS narrator (free); the same bed and sting | Not started. Outline above; script next. |
| **Vertical short** | The hook plus the tamper payoff | ≤ 45 s, 1080x1920 | Reframed from A with per-shot source regions: the chain column for the receipts, the seal for the verdict and break, the payload for the claim. Not letterboxed. | A's audio, trimmed | Not started. Cut after A is approved. |

**Remaster due on film 01:** it measures -1.3 dBTP true peak, which passed the release gate in force at the time (≤ -1). The current craft bar is ≤ -1.5. An audio-only remaster and remux in the next slot fixes it without re-rendering the picture.

**ElevenLabs budget for Heatlot:** about 4,000 TTS characters in total.

- Used: about 2,350, for film 01, before the cost-first rule.
- Planned: about 780, for the A-cut, plus one SFX.
- Remaining after A: about 870.
