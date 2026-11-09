# @profullstack/ai-providers

One way for every Profullstack app to call a text model.

1. **c0mpute first, always.** Jobs go to the peer network through Infernet's chat API, peer nodes only (`p2p_only`), never Infernet's billed hosted fallback.
2. **OpenAI and Anthropic only as fallbacks, alternating.** Call 1 falls back to OpenAI then Anthropic, call 2 to Anthropic then OpenAI. Neither bill takes all the overflow.
3. **Dead keys are parked, not retried.** No credits or a bad key parks that provider for an hour. A 429, a 5xx or no free node parks it for 30 seconds, doubling up to 10 minutes. A success clears it.

No dependencies. Node 20+, Bun, Workers: anything with `fetch`.

```sh
npm i @profullstack/ai-providers
```

## Use

```js
import { generateText, generateObject } from '@profullstack/ai-providers';

const { text, provider, model } = await generateText({
  system: 'You write short product copy.',
  user: 'One line for a coffee grinder.',
  maxTokens: 200,
});

// JSON: pulled out of whatever the model wrapped it in, validated, and
// repaired once on the same provider before moving to the next one.
import { z } from 'zod';
const Ad = z.object({ headline: z.string(), body: z.string() });
const { object } = await generateObject({
  name: 'Ad',
  schema: Ad,
  jsonSchema: z.toJSONSchema(Ad),
  user: 'Ad copy for crawlproof.com',
});
```

### Streaming

```js
import { streamText } from '@profullstack/ai-providers';

const s = streamText({ system: 'Translate to French.', user: post.body, maxTokens: 2000 });
for await (const piece of s.textStream) res.write(piece);
const { provider, model, text } = await s.result;
```

c0mpute streams its job's `token` events; OpenAI and Anthropic stream with `stream: true`. Fallback works as for `generateText` until the first piece of text has gone out. After that a failure is final (the error has `partial: true`), because the caller has already shown that text. `onToken` in the request is an alternative to iterating, and `getAi().streamText(req)` returns just the final result.

A peer job can wait a while: a CPU node reads a long prompt for a minute or more before its first token. Pass `onStatus` to show where it is: `{stage: 'queued', jobId, node, source, model}` once a node is picked, `{stage: 'started', node, engine}` when that node begins (it is reading the prompt until the first token), `{stage: 'writing', tokens}` per token, and `{stage: 'retry', model, reason}` before the next model is tried. Only c0mpute calls it.

`generateText`, `generateObject` and `streamText` share one router per process (`getAi()`), so rotation and parking see every call. Build your own with `createAiProviders({ env, c0mpute, openai, anthropic, router })`.

### Keep your own provider code

An app with tuned SDK calls (structured outputs, prompt caching, spend tracking) keeps them and uses the router only for order, rotation and parking:

```js
import { getAi, generateObjectOn } from '@profullstack/ai-providers';

const { provider, value } = await getAi().run(async (p) => {
  if (p.name === 'anthropic') return myAnthropicCall();
  if (p.name === 'openai') return myOpenAICall();
  return (await generateObjectOn(p, req)).object; // c0mpute
});
```

A thrown error with `status` 401/402/403, or a 429 or 400 that mentions credits or billing, parks that provider as `billing`.

## Environment

| Variable | Default | |
|---|---|---|
| `C0MPUTE_API_KEY` | none | Infernet **account** key (`ik_live_...`), billed per job. An `ifc_` trusted-client key without an end-user subject, or no key at all, gets the free tier of 10 queries a day. |
| `C0MPUTE_URL` | `https://infernetprotocol.com` | |
| `C0MPUTE_MODELS` | `huihui_ai/qwen3.5-abliterated:9b,qwen2.5:7b,qwen3:4b,gemma3:4b,huihui_ai/qwen3.5-abliterated:4b` | Tried in order. The first is an Infernet house model every node pulls. |
| `C0MPUTE_ANY_MODEL` | off | Let any free node answer as a last resort. Small models write junk JSON. |
| `C0MPUTE_CONCURRENCY` | 2 | c0mpute jobs in flight per process. |
| `C0MPUTE_STALL_MS` | 90000 | A job that streams nothing this long is dropped and the next model tried. |
| `C0MPUTE_TIMEOUT_MS` | 300000 | Whole call. |
| `C0MPUTE_DISABLED` | off | `1` skips c0mpute. |
| `OPENAI_API_KEY`, `AI_OPENAI_MODEL` | `gpt-5-mini` | Fallback. |
| `ANTHROPIC_API_KEY`, `AI_ANTHROPIC_MODEL` | `claude-haiku-5-5` | Fallback. |
| `AI_PAID_FALLBACK` | on | `off` never calls a paid provider (OutreachGraph's rule). |

## CLI

```sh
npx @profullstack/ai-providers status
npx @profullstack/ai-providers ask "one line about c0mpute"
npx @profullstack/ai-providers ask --json 'Return {"ok": true}'
npx @profullstack/ai-providers ask --stream "a haiku about peer nodes"
```

## What c0mpute does not do

Images and embeddings. Apps that generate images keep their image provider and must already cope with it failing.

## License

MIT
