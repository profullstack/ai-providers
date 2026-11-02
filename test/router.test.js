import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AiRouter,
  ProviderError,
  classify,
  createAiProviders,
  extractJson,
  C0mputeProvider,
  OpenAIProvider,
  AnthropicProvider,
} from '../src/index.js';

const ok = (name, text = 'hi') => ({
  name,
  calls: 0,
  async generate() {
    this.calls++;
    return { text, model: `${name}-m`, usage: { inputTokens: 1, outputTokens: 1, estimated: false } };
  },
});
const failing = (name, status, message) => ({
  name,
  calls: 0,
  async generate() {
    this.calls++;
    throw new ProviderError(name, message, { status });
  },
});

test('c0mpute answers first when it can', async () => {
  const c = ok('c0mpute');
  const o = ok('openai');
  const a = ok('anthropic');
  const r = await new AiRouter({ primary: [c], fallback: [o, a] }).generateText({ user: 'x' });
  assert.equal(r.provider, 'c0mpute');
  assert.equal(o.calls + a.calls, 0);
});

test('fallback order alternates so the two paid providers share the load', async () => {
  const router = new AiRouter({
    primary: [failing('c0mpute', 503, 'no node')],
    fallback: [ok('openai'), ok('anthropic')],
    capacityMs: 0,
  });
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push((await router.generateText({ user: 'x' })).provider);
  assert.deepEqual(seen, ['openai', 'anthropic', 'openai', 'anthropic']);
});

test('the real crawlproof errors classify as billing and park the provider', async () => {
  assert.equal(
    classify(429, 'You have no credits remaining. Add credits to continue using the API'),
    'billing',
  );
  assert.equal(classify(400, 'Your credit balance is too low to access the Anthropic API.'), 'billing');
  assert.equal(classify(429, 'Rate limit reached for requests'), 'capacity');
  assert.equal(classify(400, 'messages: field required'), 'invalid');

  let now = 0;
  const o = failing('openai', 429, 'You have no credits remaining.');
  const a = failing('anthropic', 400, 'Your credit balance is too low');
  const c = ok('c0mpute');
  const router = new AiRouter({ fallback: [o, a], now: () => now });
  await assert.rejects(router.generateText({ user: 'x' }), /AI generation failed/);
  assert.equal(o.calls, 1);
  // Parked: the next call does not hit the dead keys again.
  await assert.rejects(router.generateText({ user: 'x' }), /parked/);
  assert.equal(o.calls, 1);
  assert.equal(a.calls, 1);
  now += 61 * 60_000;
  await assert.rejects(router.generateText({ user: 'x' }));
  assert.equal(o.calls, 2);
  router.primary.push(c);
  assert.equal((await router.generateText({ user: 'x' })).provider, 'c0mpute');
});

test('capacity parking backs off and a success clears it', async () => {
  let now = 0;
  let fail = true;
  const c = {
    name: 'c0mpute',
    calls: 0,
    async generate() {
      this.calls++;
      if (fail) throw new ProviderError('c0mpute', 'no node', { status: 503 });
      return { text: 'ok', model: 'm', usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
    },
  };
  const router = new AiRouter({ primary: [c], now: () => now, capacityMs: 1000 });
  await assert.rejects(router.generateText({ user: 'x' }));
  now += 1001;
  await assert.rejects(router.generateText({ user: 'x' }));
  now += 1001; // second strike parks for 2000
  await assert.rejects(router.generateText({ user: 'x' }), /parked/);
  assert.equal(c.calls, 2);
  now += 1000;
  fail = false;
  await router.generateText({ user: 'x' });
  assert.equal(router.status()[0].available, true);
});

test('generateObject extracts, validates and repairs once', async () => {
  const answers = ['Sure! ```json\n{"title": 5}\n```', '<think>hmm</think>{"title":"Hello"}'];
  const p = {
    name: 'c0mpute',
    prompts: [],
    async generate(req) {
      this.prompts.push(req.user);
      return { text: answers.shift(), model: 'qwen', usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
    },
  };
  const schema = (v) => {
    if (typeof v.title !== 'string') throw new Error('title must be a string');
    return v;
  };
  const r = await new AiRouter({ primary: [p] }).generateObject({ user: 'go', schema, name: 'Post' });
  assert.deepEqual(r.object, { title: 'Hello' });
  assert.match(p.prompts[1], /title must be a string/);
});

test('extractJson finds the first complete object around prose and braces in strings', () => {
  assert.deepEqual(extractJson('Here: {"a":"}{","b":[1,{"c":2}]} trailing {"x":1}'), {
    a: '}{',
    b: [1, { c: 2 }],
  });
  assert.throws(() => extractJson('{"a": 1'), /incomplete/);
});

function sse(events) {
  const body = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

test('C0mputeProvider submits p2p_only with the key and reads the stream', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/chat')) {
      const body = JSON.parse(init.body);
      if (body.modelName === 'big') return Response.json({ error: 'No live node serves "big"' }, { status: 503 });
      return Response.json({ jobId: 'j1', source: 'p2p', model: body.modelName });
    }
    return sse([['meta', { model: 'qwen2.5:7b' }], ['token', { text: 'Hel' }], ['token', { text: 'lo' }], ['done', {}]]);
  };
  const p = new C0mputeProvider({ apiKey: 'ifc_x', models: ['big', 'qwen2.5:7b'], fetch });
  const out = await p.generate({ system: 's', user: 'u' });
  assert.equal(out.text, 'Hello');
  assert.equal(out.model, 'qwen2.5:7b');
  const first = JSON.parse(calls[0].init.body);
  assert.equal(first.p2p_only, true);
  assert.equal(calls[0].init.headers.authorization, 'Bearer ifc_x');
  assert.deepEqual(first.messages[0], { role: 'system', content: 's' });
  assert.equal(calls.length, 3);
});

test('C0mputeProvider refuses an answer from the hosted fallback', async () => {
  const fetch = async () => Response.json({ jobId: 'j', source: 'nim' });
  const p = new C0mputeProvider({ fetch });
  await assert.rejects(p.generate({ user: 'u' }), (e) => e.kind === 'capacity');
});

test('paid adapters map the real error bodies to billing', async () => {
  const o = new OpenAIProvider({
    apiKey: 'k',
    fetch: async () =>
      Response.json({ error: { message: 'You have no credits remaining.' } }, { status: 429 }),
  });
  await assert.rejects(o.generate({ user: 'u' }), (e) => e.kind === 'billing');
  const a = new AnthropicProvider({
    apiKey: 'k',
    fetch: async () =>
      Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
        { status: 400 },
      ),
  });
  await assert.rejects(a.generate({ user: 'u' }), (e) => e.kind === 'billing');
});

test('createAiProviders: c0mpute always, paid only with keys, AI_PAID_FALLBACK=off', () => {
  const names = (r) => r.providers.map((p) => p.name);
  assert.deepEqual(names(createAiProviders({ env: {} })), ['c0mpute']);
  assert.deepEqual(
    names(createAiProviders({ env: { OPENAI_API_KEY: 'a', ANTHROPIC_API_KEY: 'b', C0MPUTE_DISABLED: '0' } })),
    ['c0mpute', 'openai', 'anthropic'],
  );
  assert.deepEqual(
    names(createAiProviders({ env: { OPENAI_API_KEY: 'a', AI_PAID_FALLBACK: 'off' } })),
    ['c0mpute'],
  );
  assert.deepEqual(names(createAiProviders({ env: { C0MPUTE_DISABLED: '1', OPENAI_API_KEY: 'a' } })), ['openai']);
  const r = createAiProviders({ env: { C0MPUTE_MODELS: 'a, b' } });
  assert.deepEqual(r.primary[0].models, ['a', 'b']);
});
