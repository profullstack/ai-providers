# Fleet rollout: every app's AI on c0mpute

Started 2026-11-02. OpenAI answers 429 "no credits", Anthropic answers 400 "credit balance too low", and neither gets topped up. c0mpute is the default for all text and JSON generation from now on. OpenAI and Anthropic remain only as alternating fallbacks for when credit comes back.

Inventory: [FLEET-INVENTORY.md](FLEET-INVENTORY.md) (115 repos hit, 25 skipped as scratch copies, 90 surveyed, **82 need work**: 61 S, 20 M, 1 L).

## Per-app recipe

1. `bun add @profullstack/ai-providers@<exact>` (pin exact; bun can resolve a stale `latest`).
2. Route the app's text calls through it:
   - **No helper yet:** `generateText` / `generateObject` straight from the package.
   - **Has its own Anthropic/OpenAI code worth keeping** (structured outputs, caching, spend rows): keep it as the paid tier and wrap it with `getAi().run(p => ...)`, the way crawlproof does (`lib/lx/backendAi.ts`).
   - **Already a provider chain** (nixamp, mynaposter, agenticjobs, advis0r, OutreachGraph): put c0mpute at the head of the chain.
3. Any "is a paid key set?" gate also counts c0mpute (`C0MPUTE_DISABLED` is the only off switch).
4. Embeddings and images stay on their vendor and must not be fatal. crawlproof articles failed outright on an embedding 429.
5. Mint an Infernet trusted-client key, one per app:
   - `KEY=ifc_$(openssl rand -hex 24)`
   - append `<app>:<sha256(KEY)>` to `INFERNET_TRUSTED_CLIENT_KEYS` in `~/www/infernetprotocol.com/app.env` (back it up first)
   - recreate with `docker compose -f docker-compose.app.yml --env-file deploy.env up -d app`. Without `--env-file` it lands on a random port and 503s.
6. Put `C0MPUTE_API_KEY` (and `C0MPUTE_TIMEOUT_MS` for long outputs) in the app's `app.env` and its logicsrc vault.
7. Test, merge, deploy, then trigger one real generation in prod and check that `provider` is `c0mpute`.

Fan-out is 3 repos at a time (STANDING, dev2 OOM 2026-10-19).

## Order

| Wave | What | Why first |
|---|---|---|
| 0 | **Done 2026-11-02:** package 0.1.0, crawlproof.com (#424), stack.md AI row (profullstack-web #181) | crawlproof was the one failing loudly |
| 1 | `@profullstack/autoblog` `scoreQuality` | one release fixes 7 apps: crawlproof, coinpayportal, bl0ggers, d0rz, logicsrc, media-streamer, niche-db |
| 2 | Shared npm libs: social-poster, lead-generator, summary-forge-module, link-directories (`directories`), neon-builder, therapy, viral-video (script step only) | consumers inherit the change by bumping |
| 3 | Live dev2 apps with a provider chain: nixamp, mynaposter, agenticjobs, advis0r, demo.movie, rssamplifier.com (needs streaming), qaaas.dev, ringhuman, reeleel, pwamart, smshub auto-reply, profullstack-web motd, brisk.news, bittorrented | revenue and traffic |
| 4 | Remaining live dev2 apps (29 in total with wave 3; see the inventory) | |
| 5 | Off-dev2 and undeployed repos (parklookup, summaryforge-pwa, qaai, propozio, launchpadder, tutorlinkup, commenting, ethereumweekly, networking bots, day-trading, amazon-affiliate) | lower value; convert when touched |
| 6 | 22 legacy primate `-web` repos carrying the same `bin/utils/blog.js` | one scripted sweep, or archive them |

Not conversions:
- **sh1pt** gets a `packages/ai/c0mpute` provider (the product is a provider catalogue).
- **tronbrowser.dev**: c0mpute becomes the default option next to BYO user keys.
- **cli-tools** Perplexity/NIM and **smshub**'s CI review bot stay as they are.
- **@profullstack/ai** (the old CLI wrapper) gets ported onto this package or deprecated.

## Package gaps the rollout needs

| Need | Who | Plan |
|---|---|---|
| Streaming text | rssamplifier translate, parklookup trip generator | `streamText()` over the same SSE reader (0.2.0) |
| Tool calling | c0upons agent loop | JSON-schema tool emulation on c0mpute, real tools on paid fallbacks |
| Vision | aiornot, imageroster, mediaanalyzer, linkedin-networking-bot | stays on vendor until a c0mpute vision model is a house model |
| OpenAI-compatible endpoint | vu1nz (Python) and anything non-JS | Infernet `/v1/chat/completions` shim over `/api/chat` |
| Deprecate `@profullstack/ai` | | `npm deprecate` pointing here |

## Risk: c0mpute supply

On 2026-11-02 `qwen2.5:7b`, `qwen3:4b` and `gemma3:4b` were listed but had no live node, and accepted jobs sat unanswered for 150 s. Only the house model `huihui_ai/qwen3.5-abliterated:9b` answered (24 to 41 s per short JSON). That is why it leads the default model list and why `C0MPUTE_STALL_MS` drops a silent job after 90 s.

Every app moved here adds load to a handful of CPU and iGPU nodes. Before wave 3:
- check `/api/nodes` for live capacity
- consider a non-abliterated 7-9B house model for customer-facing copy
- watch Infernet's no_provider rate per trusted key
