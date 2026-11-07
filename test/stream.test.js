import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AiRouter,
  ProviderError,
  streamText,
  sseEvents,
  C0mputeProvider,
  OpenAIProvider,
  AnthropicProvider,
} from '../src/index.js';

const enc = new TextEncoder();
/** A body that delivers each string as its own chunk, so blocks split across reads. */
const chunked = (chunks) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const s of chunks) c.enqueue(enc.encode(s));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
const named = (events) => chunked(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`));
const dataOnly = (items) => chunked(items.map((d) => `data: ${typeof d === 'string' ? d : JSON.stringify(d)}\n\n`));

const streamer = (name, pieces, { failAfter } = {}) => ({
  name,
  calls: 0,
  async generate() {
    throw new Error('generate should not be called');
  },
  async stream(_req, onToken) {
    this.calls++;
    let text = '';
    for (const [i, p] of pieces.entries()) {
      if (failAfter === i) throw new ProviderError(name, 'node died', { status: 502 });
      text += p;
      onToken(p);
    }
    return { text, model: `${name}-m`, usage: { inputTokens: 1, outputTokens: 1, estimated: true } };
  },
});
const down = (name, status = 503) => ({
  name,
  calls: 0,
  async generate() {
    this.calls++;
    throw new ProviderError(name, 'no node', { status });
  },
  async stream() {
    this.calls++;
    throw new ProviderError(name, 'no node', { status });
  },
});

test('sseEvents splits blocks across chunk boundaries and handles CRLF and a missing final blank line', async () => {
  const body = chunked(['event: a\r\nda', 'ta: {"x":1}\r\n\r\nevent: b\n', 'data: 2\n\ndata: [DONE]']).body;
  const out = [];
  for await (const e of sseEvents(body)) out.push(e);
  assert.deepEqual(out, [
    { event: 'a', data: '{"x":1}' },
    { event: 'b', data: '2' },
    { event: undefined, data: '[DONE]' },
  ]);
});

test('C0mputeProvider.stream emits each token and the tail a done event adds', async () => {
  const fetch = async (url) =>
    url.endsWith('/api/chat')
      ? Response.json({ jobId: 'j1', source: 'p2p' })
      : named([
          ['meta', { model: 'qwen' }],
          ['token', { text: 'Bon' }],
          ['token', { text: 'jour' }],
          ['done', { text: 'Bonjour !' }],
        ]);
  const pieces = [];
  const out = await new C0mputeProvider({ fetch }).stream({ user: 'hi' }, (t) => pieces.push(t));
  assert.deepEqual(pieces, ['Bon', 'jour', ' !']);
  assert.equal(out.text, 'Bonjour !');
  assert.equal(out.model, 'qwen');
});

test('C0mputeProvider.stream: a stall after tokens is an error, not a retry on the next model', async () => {
  let jobs = 0;
  const fetch = async (url, init) => {
    if (url.endsWith('/api/chat')) {
      jobs++;
      return Response.json({ jobId: `j${jobs}`, source: 'p2p' });
    }
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(enc.encode('event: token\ndata: {"text":"Hal"}\n\n'));
          init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        },
      }),
    );
  };
  const p = new C0mputeProvider({ fetch, models: ['a', 'b'], stallMs: 30 });
  await assert.rejects(p.stream({ user: 'x' }, () => {}), /mid-answer/);
  assert.equal(jobs, 1);
});

test('OpenAIProvider.stream reads deltas and usage', async () => {
  let body;
  const fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return dataOnly([
      { model: 'gpt-x', choices: [{ delta: { role: 'assistant' } }] },
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      '[DONE]',
    ]);
  };
  const pieces = [];
  const out = await new OpenAIProvider({ apiKey: 'k', fetch }).stream({ user: 'u' }, (t) => pieces.push(t));
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.deepEqual(pieces, ['Hel', 'lo']);
  assert.equal(out.text, 'Hello');
  assert.equal(out.model, 'gpt-x');
  assert.deepEqual(out.usage, { inputTokens: 5, outputTokens: 2, estimated: false });
});

test('OpenAIProvider.stream: a stream cut before [DONE] is a capacity error', async () => {
  const fetch = async () => dataOnly([{ choices: [{ delta: { content: 'Hel' } }] }]);
  await assert.rejects(
    new OpenAIProvider({ apiKey: 'k', fetch }).stream({ user: 'u' }, () => {}),
    (e) => e.kind === 'capacity',
  );
});

test('AnthropicProvider.stream reads text deltas and usage', async () => {
  let body;
  const fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return named([
      ['message_start', { type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 7, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['ping', { type: 'ping' }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' there' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }],
      ['message_stop', { type: 'message_stop' }],
    ]);
  };
  const pieces = [];
  const out = await new AnthropicProvider({ apiKey: 'k', fetch }).stream({ system: 's', user: 'u' }, (t) =>
    pieces.push(t),
  );
  assert.equal(body.stream, true);
  assert.equal(body.system, 's');
  assert.deepEqual(pieces, ['Hi', ' there']);
  assert.equal(out.text, 'Hi there');
  assert.equal(out.model, 'claude-x');
  assert.deepEqual(out.usage, { inputTokens: 7, outputTokens: 3, estimated: false });
});

test('paid streams fail as billing on the same dead-key bodies as generate', async () => {
  const openai = new OpenAIProvider({
    apiKey: 'k',
    fetch: async () => Response.json({ error: { message: 'Incorrect API key provided' } }, { status: 401 }),
  });
  await assert.rejects(openai.stream({ user: 'u' }, () => {}), (e) => e.kind === 'billing');
  const anthropic = new AnthropicProvider({
    apiKey: 'k',
    fetch: async () =>
      Response.json(
        { type: 'error', error: { message: 'Your credit balance is too low to access the Anthropic API.' } },
        { status: 400 },
      ),
  });
  await assert.rejects(anthropic.stream({ user: 'u' }, () => {}), (e) => e.kind === 'billing');
});

test('router.streamText falls back before the first token and reports who answered', async () => {
  const c = down('c0mpute');
  const o = streamer('openai', ['a', 'b']);
  const pieces = [];
  const r = await new AiRouter({ primary: [c], fallback: [o] }).streamText({
    user: 'x',
    onToken: (t) => pieces.push(t),
  });
  assert.equal(r.provider, 'openai');
  assert.equal(r.text, 'ab');
  assert.deepEqual(pieces, ['a', 'b']);
  assert.equal(r.attempts.length, 1);
});

test('router.streamText: after a token, a failure is final and partial', async () => {
  const c = streamer('c0mpute', ['a', 'b'], { failAfter: 1 });
  const o = streamer('openai', ['z']);
  await assert.rejects(
    new AiRouter({ primary: [c], fallback: [o] }).streamText({ user: 'x' }),
    (e) => e.partial === true && /node died/.test(e.message),
  );
  assert.equal(o.calls, 0);
});

test('router.streamText uses generate for a provider without stream', async () => {
  const plain = {
    name: 'custom',
    async generate() {
      return { text: 'whole', model: 'm', usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
    },
  };
  const pieces = [];
  const r = await new AiRouter({ primary: [plain] }).streamText({ user: 'x', onToken: (t) => pieces.push(t) });
  assert.deepEqual(pieces, ['whole']);
  assert.equal(r.provider, 'custom');
});

test('streamText() yields pieces and resolves result; failures throw from the iterator', async () => {
  const s = streamText({ user: 'x' }, new AiRouter({ primary: [down('c0mpute')], fallback: [streamer('anthropic', ['x', 'y', 'z'])] }));
  const got = [];
  for await (const p of s) got.push(p);
  assert.deepEqual(got, ['x', 'y', 'z']);
  const r = await s.result;
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.text, 'xyz');

  const bad = streamText({ user: 'x' }, new AiRouter({ primary: [down('c0mpute')] }));
  await assert.rejects(async () => {
    for await (const _ of bad.textStream);
  }, /AI generation failed/);
  await assert.rejects(bad.result, /AI generation failed/);
});
