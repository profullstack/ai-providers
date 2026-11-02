# Fleet AI text-generation inventory for the @profullstack/ai-providers rollout

Survey date 2026-11-02. Read-only. Source: `git grep` against each repo's **origin default branch** (`origin/HEAD`), not the checkout's HEAD. Many local checkouts sit on stale feature branches (smshub is 151 commits behind, rssamplifier.com 199, agenticjobs 121, coinpayportal 96, profullstack-web 74). Scanning HEAD missed real call sites (pairux copilot and translator, c0upons email webhook) and the c0mpute chain OutreachGraph shipped today. No fetch was run, so "origin" means each clone's last fetch.

**Text sites** counts production call sites that generate text or JSON (chat/completions, messages, responses, langchain, AI-SDK). Tests, docs, fixtures, `dist/` and lockfiles are excluded, and false hits (Mailgun, Twilio, Telnyx, the app's own `/api/messages` routes) are removed.

**Effort:** S = one helper or 1 to 2 sites, plain JS/TS. M = 3 or more scattered sites, structured-output or beta SDK features, vision, a non-JS runtime, or a BYO-provider design where c0mpute gets added as an option. L = several surfaces across apps with structured outputs plus media. "n/a" = nothing to convert.

"dev2" means `/home/anthony/www/<domain>` exists (matched by `deploy.env` `REPO=`). "not on dev2" means no dev2 deploy dir; the site may be on Railway or not deployed at all.

| repo | domain | runtime | text sites (count) | shared helper | embeddings | images/audio | vendor-specific | already c0mpute | effort | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| autoblog | npm @profullstack/autoblog 0.4.0 (lib) | Node lib (TS) | 1 | src/quality.ts `scoreQuality` | no | no | no | no | S | **Highest leverage:** consumed by crawlproof.com, coinpayportal, bl0ggers, d0rz, logicsrc, media-streamer, niche-db. Callers pass `anthropicApiKey`, so the API signature changes; release, then bump consumers. |
| link-directories | npm `directories` 1.0.1 | Node lib | 4 | src/ai-helper.js (one class) | no | no | no | no | S | |
| amazon-affiliate | not deployed | Node CLI | 4 | src/openai-script-generator.js | no | no | no | no | S | Plus validate-openai-key.js (a key checker that stays OpenAI-only). Uses @profullstack/social-poster. |
| meshhook | meshhook.com (dev2) | SvelteKit | 4 | scripts/lib/openai-prd-generator.mjs | no | no | no | no | S | dead/example: a dev PRD-writing script, not app runtime. |
| nixamp | nixamp.com (dev2) | Bun, Docker | 3 | src/ai-text.ts (Gemini, OpenAI, Anthropic, JSON answer) + src/event-writer.ts | no | transcription is local whisper.cpp (not OpenAI) | no | no | S | Already a provider chain. |
| qaaas.dev | qaaas.dev (dev2) | Next/Bun + worker | 3 | apps/worker/src/agents/llm.ts (2) + web enhance-qa route | no | no | no | no | S | |
| parklookup.com | parklookup.com (not on dev2) | Next, Supabase edge | 3 | lib/ai/trip-generator.js (incl. streaming) + scripts/import-products.js | no | no | no | no | S | |
| summaryforge-pwa | not on dev2 | Next, Docker | 3 | none (3 quiz API routes, raw fetch) | no | no | no | no | S | |
| qaai | not on dev2 | Next + runner, Docker | 3 | services/runner/lib/llm-client.js (OpenAI, Anthropic, OpenAI-compatible baseUrl) | no | no | no | no | S | |
| agenticjobs | agenticjobs.work (dev2) | Node/Hono, Docker | 2 | src/core/agentwriter.ts (Anthropic then OpenAI fallback) | no | no | no | no | S | Already a fallback chain; swap it for the package. |
| mynaposter | mynaposter.com (dev2) | Bun, Docker | 2 | packages/core/src/ai/{anthropic,openai}.ts + writer-fallback chain (Anthropic, OpenAI, Gemini) | no | gpt-image-2 `generateImage` | no | no | S | Put c0mpute at the head of the writer chain. Images stay on OpenAI. |
| advis0r.com | advis0r.com (dev2) | Bun | 2 | src/providers/{anthropic,openai}.ts | no | ASR: OpenAI whisper-1 is the fallback (Groq/ElevenLabs first) | no | no | S | Add a c0mpute provider next to the existing ones. |
| rssamplifier.com | rssamplifier.com (dev2) | Next, Docker | 2 | packages/translate/src/translate.js (Anthropic create + stream) | no | no | no | no (false positive, see below) | S | Translation streams; the package must stream. |
| demo.movie | demo.movie (dev2) | Next/Bun, Docker | 2 | packages/core/src/llm.ts (Anthropic stream + zodOutputFormat, OpenAI fallback) | no | no | no | no | S | Uses zod structured output; needs JSON mode in the package. |
| media-streamer | bittorrented.com (dev2) | Next, Docker | 2 | none (api/news/summarize route, lib/finance/analysis/pipeline.ts) | no | no | no | no | S | Also consumes @profullstack/autoblog. |
| brisk.news | brisk.news (dev2) | Next, Docker | 2 | none (api/news/opportunities, api/news/summarize) | no | no | no | no | S | |
| cli-tools | none (CLI) | Bun/Node CLI | 2 | src/generate-names.ts | no | gpt-image-2 emoji/icon-hq | ask-web (Perplexity search), nim.ts (NVIDIA NIM) | no | S | Convert only generate-names. Perplexity and NIM are vendor-specific on purpose. |
| day-trading | not deployed | Node | 2 | src/ai/{openai,deepseek}.js | no | no | DeepSeek client | no | S | |
| social-poster | npm @profullstack/social-poster 1.1.0 | Node lib | 2 | src/ai-service.js | no | no | no | no | S | Consumed by amazon-affiliate and mcp-server's social-poster module. |
| ai | npm @profullstack/ai 1.1.1 | Node CLI | 2 | lib/ai-providers.js (OpenAI + Anthropic) | no | no | no | no | S | **Overlaps the new package.** Port it to ai-providers or deprecate it. |
| therapy | npm @profullstack/therapy 1.5.14 | Node CLI | 2 | lib/ai-providers.js (same helper as `ai`) | no | no | no | no | S | |
| propozio-web | not on dev2 | SvelteKit | 2 | src/lib/server/openai.js | no | no | no | no | S | |
| legacy primate.js template x22: bufferoverride-web, divebars-web, elira-web, filez-web, gpuprices-web, groceryprices-web, hynt-web, mowandhaul-web, othr-web, poopscooper-web, quzo-web, referrals-web, rejuvenatedknives-web, speedof-web, stupidsimple-web, tokensaver-web, trendingcto-web, voltserver-web, wiresniff-web, wtfdoc-web, zymo-web, globalthreat-web | none on dev2 | Node (primate) | 2 each (globalthreat-web 4) | the same bin/utils/blog.js copied into every repo (globalthreat also modules/ai.js) | no | dall-e-3 in blog.js | no | no | S each | dead/example: a hand-run blog generator. Most were last really touched 2024 to 2025 (mowandhaul/quzo/globalthreat 2026). One scripted sweep, or archive them. bufferoverride.com deploys the separate `bufferoverride` repo. |
| smshub | smshub.dev (dev2) | Next | 1 | src/lib/ai/auto-reply.ts | no | no | .github/scripts/claude-review.js (CI review bot) | no | S | Local checkout 151 behind. Leave the CI bot alone. |
| profullstack-web | profullstack.com (dev2) | Next/Bun, Docker | 1 | src/lib/motd.mjs | no | no | no | no | S | c0mpute hits are book/content text only. |
| ringhuman.com | ringhuman.com (dev2) | Next/Bun, Docker | 1 | packages/ai/src/route-discovery/extract.ts | no | no | no | no | S | |
| reeleel | reeleel.com (dev2) | Bun (+Python), Docker | 1 | packages/core/src/commentary.ts | no | no | no | no | S | |
| pwamart.com | pwamart.com (dev2) | Bun, Docker | 1 | apps/web/src/profile.js | no | no | no | no (false positive) | S | |
| launchpadder-web | not on dev2 | SvelteKit | 1 | src/lib/services/ai-rewriter.js | no | no | no | no | S | |
| tutorlinkup-web | not on dev2 | SvelteKit | 1 | src/lib/services/openai.js | no | no | no | no | S | |
| lead-generator | npm @profullstack/lead-generator 1.2.4 | Node lib | 1 | src/ai-service.js | no | no | no | no | S | Consumed by firstpayinguser-web. |
| neon-builder | npm @profullstack/neon-builder 1.0.1 | Node CLI | 1 | src/generators/content-generator.js | no | no | no | no | S | |
| viral-video | npm @profullstack/viral-video 0.1.1 | Node CLI | 1 | src/index.js | no | gpt-image-1 + gpt-4o-mini-tts | no | no | S | Only the script step is convertible. |
| ethereumweekly.com | not on dev2 | Node script | 1 | bin/newsletter.js | no | no | no | no | S | |
| commenting-web | not on dev2 | Node | 1 | lib/openai.mjs | no | no | no | no | S | |
| networking-bots | not deployed | Node bot | 1 | src/services/llm.mjs (Groq then OpenAI) | no | no | no | no | S | |
| reddit-networking-bot | not deployed | Node bot | 1 | src/services/llm.mjs (Groq then OpenAI) | no | no | no | no | S | A copy of networking-bots' llm.mjs. |
| vu1nz-gh-actions | GitHub Action | Python | 1 | vu1nz/ai/providers.py | no | no | no | no | S | Python can't import the npm package; point it at c0mpute's OpenAI-compatible endpoint. |
| pickupwidget-web | not on dev2 | SvelteKit | 1 | scripts/createBlogpost.js | no | dall-e-3 | no | no | S | dead/example: a hand-run script. |
| sh1pt | sh1pt.com (dev2) | Next/Python, Docker | 57 (one per provider package) | packages/ai/* (~60 provider packages) | no | no | **yes**: the product is a provider catalogue | mentioned in docs only | S | Not a conversion: add a packages/ai/c0mpute. |
| summary-forge-module | npm @profullstack/summary-forge-module 1.10.2 | Node lib | 9 | src/summary-forge.js (one class, 8 calls) + index.js | no | no | no | no | M | Many prompts but one client; probably the backend for summaryforge-pwa. |
| tronbrowser.dev | tronbrowser.dev (dev2) | Electron + Hono API, Docker | 8 | packages/model-providers/src/adapter-{openai,anthropic}.ts | no | no | **yes**: AI sidebar and API proxy take the user's own key; swarm uses langchain | partial: services/api/src/swarm.ts lists `c0mpute: https://api.c0mpute.com/v1` | M | Make c0mpute the keyless default in the sidebar. |
| firstpayinguser-web | not on dev2 | SvelteKit | 7 | src/lib/server/ai.js (6) + landing-pages.js | no | no | no | no | M | |
| ugig.net | ugig.net (dev2) | Next/Bun, Docker | 6 | none (new OpenAI() per file: directory backfill-tags + fetch-meta routes, lib/resume-parser.ts, scripts/backfill-tags.ts) | no | no | no | no | M | Checkout 46 behind. Add a lib/ai.ts first. |
| fasting | npm @profullstack/fasting 1.6.4 | Node CLI | 5 | none (5 lib/*-estimator/recommender.js, each with its own client) | no | no | no | no | M | |
| makedemo | npm `mkdemo` (unpublished) | Node CLI | 5 | packages/core/src/ai/decision-maker.js + pipeline/llm.js (Anthropic stream + zod); old src/ copy | no | no | no | no | M | Two copies of decision-maker; the src/ one is likely dead. |
| postammo.com | postammo.com (dev2) | Next/Bun, Docker | 4 | none (api/generate route, lib/generation.ts, lib/script-generation.ts, scripts/generate-infographic) | no | dall-e-3 in lib/image-generation.ts, gpt-image in scripts | no | no | M | |
| b1dz.com | b1dz.com (dev2) | Next, Docker | 4 | packages/ai-analyzer/src/providers.ts + apps/web/src/lib/strategy-ai.ts (Anthropic, CF Workers AI fallback) | no | no | partly (model-list probe; DB settings row overrides env) | no | M | Keep the settings-row override working. |
| c0upons | c0upons.com (dev2) | Next/Bun, Docker | 4 | none (lib/scrape.ts, api/webhooks/email, lib/reveal-coupon.ts, lib/reveal-code.ts) | no | no | reveal-code.ts uses the Anthropic beta `toolRunner` with MCP tools (obscura) | no | M | scrape and email are easy. The agentic tool loop needs tool calling or stays on Claude. |
| vu1nz.com | vu1nz.com (dev2) | Python CLI + Next marketing site | 4 | vu1nz/ai/providers.py (OpenAI, Anthropic, OpenRouter, Ollama) | no | no | partly (secret_hunter probes api.openai.com to validate found keys) | no | M | Python: add a c0mpute client class (OpenAI-compatible). |
| coinpayportal | coinpayportal.com (dev2) | Next, Supabase edge | 3 | none (lib/ask/answer.ts: Anthropic beta, OpenAI /v1/responses fallback; lib/finances/categorize-model.ts: beta structured output) | no | no | no | no | M | Also consumes autoblog. Financial categorization; regression-test the JSON. |
| saasrow-web | saasrow.com (dev2) | Next/Bun + Supabase edge functions (Deno) | 3 | none (edge functions draft-email-broadcast, fetch-metadata, generate-news-post) | no | dall-e-3 in generate-banner-images | no | no | M | The package must load in Deno via `npm:`. |
| aiornot.vote | aiornot.vote (dev2) | Next/Bun, Docker | 3 | none (lib/ai-vision.ts, lib/newsletter.ts, packages/seed/src/tips.ts) | no | gpt-image-1 seed images; vision input | no | no | M | newsletter and tips are S. ai-vision is image classification and needs vision. |
| linkedin-networking-bot | not deployed | Node bot | 3 | src/openai-vision.mjs (2, vision) + task-scheduler.mjs | no | vision input | no | no | M | |
| mcp-server | npm @profullstack/mcp-server 1.6.0 (netcup autodeploy) | Node, Docker | 3 | src/utils/modelProviders.js | no | whisper transcribeAudio | **yes**: model_providers module proxies OpenAI/Anthropic/Whisper to MCP clients | no | M | Add c0mpute as a provider; keep the vendor routes. |
| chovy-ai | chovy.com (dev2) | Next | 3 | lib/ai-providers.js (20+ providers, voice) | no | voice (speech/transcriptions on provider keys) | **yes**: BYO workspace provider keys | no | M | Add c0mpute as a provider and the keyless default; don't remove BYO. |
| imageroster | not on dev2 | Next | 2 | packages/analysis/src/{openai,anthropic}-adapter.ts | no | vision input (image_url) | no | no | M | Vision: needs a c0mpute vision model. |
| mediaanalyzer.pro | mediaanalyzer.pro (dev2) | Next/Bun, Docker | 2 | packages/core/src/describe.ts + providers.ts | no | vision (describe media frames) | **yes**: user-registered provider keys (OpenAI-compatible baseUrl, vLLM) | no | M | Add c0mpute as a provider kind; it needs vision. |
| vicoa | not on dev2 (remote is ralyodio/vicoa) | Python backend + Next + Flutter | 2 | backend/src/shared/llms/{openrouter,utils}.py | no | Deepgram voice | **yes**: Claude Code wrapper (Anthropic usage API) | no | M | Only title generation is convertible. A third-party fork; low priority. |
| getprivacycode | getprivacycode.com (dev2) | Bun, Docker | ~15 (agent core, packages/llm protocols) | packages/llm (opencode-style provider protocols) | no | no | **yes**: coding agent (opencode fork), the user chooses the provider | no | M | Not a conversion: add c0mpute as a provider entry. |
| pairux.com | pairux.com (dev2) | Next + Electron desktop, Docker | 5 | none: call-analysis/report.ts (Anthropic beta zod, OpenAI fallback), copilot/llm.ts (OpenAI-compatible COPILOT_LLM_URL), translation/translator.ts (Anthropic beta zod), packages/ai-core provider | no | gpt-image banners, gpt-4o-transcribe-diarize/whisper-1 | no | partial: desktop voice uses `c0mpute speech serve` (tts/stt) | L | Checkout 58 behind. Heaviest app. Structured outputs in 3 places. |
| outreachgraph | outreachgraph.com (dev2) | Next/Bun, Docker | 3 | packages/ai (model.ts, openai.ts, c0mpute.ts) | no | no | no | **yes**: c0mpute leads the chain on origin/main (2026-11-02) | n/a | Done. Optionally swap packages/ai/src/c0mpute.ts for the shared package later. |
| playground | none | Node scripts | 3 | none | no | no | no | no | n/a | dead: 2024 scratch scripts on openai v3 `createChatCompletion`. |
| easyapplier-web | none | Node | 1 | none | no | no | no | no | n/a | dead: one 2023 commit on openai v3 `createCompletion`. |
| nicheforge-wordpress | WordPress plugin | PHP | 1 | includes/class-api-client.php | no | no | likely (plugin users supply their own key) | no | n/a | PHP can't use the npm package. Leave it. |
| opensourcelegends.com | opensourcelegends.com (dev2) | Next | 0 | none | no | gpt-image-1 edits in scripts/*-cards.mjs | no | no | n/a | Images only, offline scripts. |
| nightcell7 | nightcell7.com (dev2) | Next/Bun, Docker | 0 | none | no | gpt-image-2 edits, OpenAI TTS, transcription check (tools/) | no | no | n/a | Image and audio tooling only. |
| moshcoding.com | moshcoding.com (dev2) | Next/Bun, Docker | 0 | none | no | lib/genart.ts gpt-image-2 hero art | no | no | n/a | Images only. |
| launch.anapp.now | launch.anapp.now (dev2) | Next | 0 | none | no | scripts/gen-creatives.py gpt-image-2 | no | no | n/a | Images only, a script. |

## Totals

- **Input and scope:** 115 input lines. 25 were skipped (list below), leaving **90 repos surveyed**. The 22-repo legacy template family is one table row.
- **Need some work: 82 repos.**
  - **S: 61.** 39 single repos plus the 22 legacy template copies, which one sweep can cover.
  - **M: 20.**
    - 14 are plain conversions: summary-forge-module, firstpayinguser, ugig.net, fasting, makedemo, postammo, b1dz, c0upons, vu1nz.com, coinpayportal, saasrow, aiornot, linkedin-networking-bot, imageroster.
    - 6 are vendor-specific "add c0mpute as an option" repos: tronbrowser, mcp-server, chovy-ai, mediaanalyzer, vicoa, getprivacycode.
  - **L: 1** (pairux.com).
- **No conversion: 8.**
  - outreachgraph is already on c0mpute.
  - 4 are images-only (opensourcelegends, nightcell7, moshcoding, launch.anapp.now).
  - 3 are dead or PHP (playground, easyapplier-web, nicheforge-wordpress).
- **Live on dev2 with text generation to convert: 29 apps.**
  - S: agenticjobs, mynaposter, nixamp, advis0r, rssamplifier, demo.movie, bittorrented, brisk.news, smshub, profullstack.com, ringhuman, reeleel, pwamart, qaaas, meshhook (script only).
  - M: ugig, postammo, b1dz, coinpayportal, saasrow, c0upons, aiornot, vu1nz, chovy, tronbrowser, mediaanalyzer, getprivacycode.
  - Also sh1pt (S) and pairux (L).
  - Converting autoblog also covers its 7 consumers indirectly.
- **Embeddings:** none in any production code. The only `text-embedding` hits are model-list fixtures in tests (getprivacycode, mediaanalyzer).
- **Images/audio that stay on OpenAI:** mynaposter, cli-tools, viral-video, postammo, saasrow, aiornot, pairux, nightcell7, opensourcelegends, moshcoding, launch.anapp.now, mcp-server (whisper), chovy-ai (voice), advis0r (ASR fallback), and the 22 legacy blog.js copies (dall-e-3).
- **Vision (needs a c0mpute vision model, or stays on the vendor):** aiornot.vote ai-vision, imageroster, linkedin-networking-bot, mediaanalyzer.pro.
- **Top 10 by text sites:** sh1pt and getprivacycode are left out; they are provider catalogues, not usage.
  1. summary-forge-module 9
  2. tronbrowser.dev 8 (BYO)
  3. firstpayinguser-web 7
  4. ugig.net 6
  5. pairux.com 5
  6. fasting 5
  7. makedemo 5
  8. postammo.com 4
  9. b1dz.com 4
  10. c0upons 4 (vu1nz.com, link-directories and amazon-affiliate also have 4)

## Skipped (25)

| dir | reason |
|---|---|
| crawlproof.com | already converted (this job) |
| crawlproof-pricing, crawlproof-markdown-copy, crawlproof-impressions, crawlproof-audioloud, crawlproof-ads-fix, crawlproof-ad-testing | clones/worktrees of profullstack/crawlproof.com |
| tronbrowser-w3bs-fix | clone of tronbrowser.dev (same origin ref d1e857e) |
| media-streamer-dht-count-cache | clone of media-streamer (same origin ref) |
| coinpayportal-security-runtime, coinpayportal-payouts, coinpayportal-explorer-budget | clones of coinpayportal (same origin ref) |
| nixamp-kind | clone of nixamp |
| profullstack-web-stack-builder, -footer-live, -css, -agentic-stack | clones of profullstack-web |
| mediaanalyzer-search-index | clone of mediaanalyzer.pro |
| smshub-coinpay-link | clone of smshub (same origin ref 0e4f67fc) |
| nightcell7-yards | clone of nightcell7 (same remote) |
| outreachgraph.com (dir) | the same remote as `outreachgraph`; that clone's origin/main is fresher (2026-11-02 vs 10-31) and shows the c0mpute chain |
| brisk-web | a separate repo, but the older primate-template incarnation of brisk; dev2 brisk.news deploys `brisk.news` |
| ugig-web | the 2024 primate-template predecessor of ugig.net; not deployed |
| rss-amplifier | the predecessor of rssamplifier.com; not deployed |
| sassrow-web | an older "sassrow" template site (last real commit 2026-02); saasrow.com deploys saasrow-web |

## False positives in the "AI" or "c0mpute" hits

- **rssamplifier.com: "already c0mpute" is false.** packages/db/src/extracts.js only mentions c0mpute.com as a crawled origin that returned a 500. Its real AI (translate.js) is Anthropic.
- **pwamart.com:** the c0mpute/infernetprotocol hits are seed data in bin/seed-fleet.mjs.
- **coinpayportal, cli-tools, profullstack-web, media-streamer, sh1pt:** the c0mpute/infernet hits are comments, docs, book text, feed lists and sites.json, not inference.
- **nixamp:** the transcription hits are local whisper.cpp, not OpenAI.
- **`messages.create` from Mailgun or Twilio, not Anthropic:** lead-generator (email/sms services), firstpayinguser-web (email.js, email-service.js), globalthreat-web (alert daemon).
- **`/v1/messages` that are not Anthropic:** smshub (Telnyx and its own API), ringhuman (Telnyx), agenticjobs/ugig/pairux/chovy (their own inbox/messages APIs), vu1nz (endpoint wordlists, mail.tm).
- **vu1nz.com secret_hunter:** calls api.openai.com/v1/models to check whether a leaked key is live. That is a security probe, not AI usage.
- **Media regex noise (no real image/audio AI):** launchpadder-web (OpenAI only in CSP, prometheus probe and nock tests), amazon-affiliate (`createImageFilePaths`), mediaanalyzer and chovy (`createImageBitmap`), propozio-web (.socket blobs), outreachgraph ("transcribe" strings in tests), mcp-server (whisper mentions in README/docs/examples, though modelProviders.js transcribeAudio is real).
- **No surveyed repo was entirely a false positive.** Every row has at least one real OpenAI/Anthropic call, though some are only in hand-run scripts.
