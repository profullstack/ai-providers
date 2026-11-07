/**
 * The paid fallbacks, over plain fetch so the package has no SDK dependency.
 *
 * OpenAI: Chat Completions. Anthropic: Messages. Both return real token counts.
 */
import { ProviderError, toProviderError } from './errors.js';
import { toMessages } from './c0mpute.js';
import { sseEvents } from './sse.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';

async function failure(provider, res) {
  const body = await res.text().catch(() => '');
  let message = body.slice(0, 500);
  try {
    const j = JSON.parse(body);
    message = j?.error?.message ?? j?.message ?? message;
  } catch {}
  return new ProviderError(provider, `${res.status} ${message}`.trim(), { status: res.status });
}

function withTimeout(req, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? ms);
  const onAbort = () => controller.abort();
  req.signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    },
  };
}

export class OpenAIProvider {
  constructor(opts = {}) {
    this.name = 'openai';
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = opts.model || DEFAULT_OPENAI_MODEL;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  generate(req) {
    return this.#call(req);
  }

  /** Chat Completions with `stream: true`; `onToken` gets each delta. */
  stream(req, onToken) {
    return this.#call(req, onToken);
  }

  async #call(req, onToken) {
    const t = withTimeout(req, this.timeoutMs);
    try {
      const model = req.models?.openai || this.model;
      const res = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model,
          messages: toMessages(req),
          max_completion_tokens: req.maxTokens ?? 1024,
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          ...(onToken ? { stream: true, stream_options: { include_usage: true } } : {}),
        }),
        signal: t.signal,
      });
      if (!res.ok) throw await failure('openai', res);
      if (onToken) return await readOpenAIStream(res, model, onToken);
      const j = await res.json();
      return {
        text: j.choices?.[0]?.message?.content ?? '',
        model: j.model ?? model,
        usage: {
          inputTokens: j.usage?.prompt_tokens ?? 0,
          outputTokens: j.usage?.completion_tokens ?? 0,
          estimated: false,
        },
      };
    } catch (err) {
      throw toProviderError('openai', err);
    } finally {
      t.done();
    }
  }
}

export class AnthropicProvider {
  constructor(opts = {}) {
    this.name = 'anthropic';
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.model = opts.model || DEFAULT_ANTHROPIC_MODEL;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  generate(req) {
    return this.#call(req);
  }

  /** Messages with `stream: true`; `onToken` gets each text delta. */
  stream(req, onToken) {
    return this.#call(req, onToken);
  }

  async #call(req, onToken) {
    const t = withTimeout(req, this.timeoutMs);
    try {
      const model = req.models?.anthropic || this.model;
      const all = toMessages(req);
      const system = all.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const messages = all.filter((m) => m.role !== 'system');
      const res = await this.fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 1024,
          ...(system ? { system } : {}),
          messages,
          ...(onToken ? { stream: true } : {}),
        }),
        signal: t.signal,
      });
      if (!res.ok) throw await failure('anthropic', res);
      if (onToken) return await readAnthropicStream(res, model, onToken);
      const j = await res.json();
      const text = (j.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return {
        text,
        model: j.model ?? model,
        usage: {
          inputTokens: j.usage?.input_tokens ?? 0,
          outputTokens: j.usage?.output_tokens ?? 0,
          estimated: false,
        },
      };
    } catch (err) {
      throw toProviderError('anthropic', err);
    } finally {
      t.done();
    }
  }
}

const parse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

async function readOpenAIStream(res, model, onToken) {
  if (!res.body) throw new ProviderError('openai', 'no response body to stream', { status: 502 });
  let text = '';
  let usage;
  let finished = false;
  for await (const { data: raw } of sseEvents(res.body)) {
    if (raw === '[DONE]') {
      finished = true;
      break;
    }
    const j = parse(raw);
    if (!j) continue;
    if (j.error) throw new ProviderError('openai', String(j.error.message ?? 'stream error'), { status: 502 });
    if (j.model) model = j.model;
    if (j.usage) usage = j.usage;
    const piece = j.choices?.[0]?.delta?.content;
    if (typeof piece === 'string' && piece) {
      text += piece;
      onToken(piece);
    }
  }
  if (!finished) {
    throw new ProviderError('openai', 'the stream ended before the answer finished', {
      status: 502,
      kind: 'capacity',
    });
  }
  return {
    text,
    model,
    usage: {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? Math.ceil(text.length / 4),
      estimated: !usage,
    },
  };
}

async function readAnthropicStream(res, model, onToken) {
  if (!res.body) throw new ProviderError('anthropic', 'no response body to stream', { status: 502 });
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let finished = false;
  for await (const { event, data: raw } of sseEvents(res.body)) {
    const j = parse(raw);
    if (!j) continue;
    const type = j.type ?? event;
    if (type === 'message_start') {
      if (j.message?.model) model = j.message.model;
      inputTokens = j.message?.usage?.input_tokens ?? inputTokens;
      outputTokens = j.message?.usage?.output_tokens ?? outputTokens;
    } else if (type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) {
      text += j.delta.text;
      onToken(j.delta.text);
    } else if (type === 'message_delta') {
      outputTokens = j.usage?.output_tokens ?? outputTokens;
    } else if (type === 'message_stop') {
      finished = true;
      break;
    } else if (type === 'error') {
      const message = String(j.error?.message ?? 'stream error');
      const status = j.error?.type === 'overloaded_error' ? 529 : 502;
      throw new ProviderError('anthropic', message, { status });
    }
  }
  if (!finished) {
    throw new ProviderError('anthropic', 'the stream ended before the answer finished', {
      status: 502,
      kind: 'capacity',
    });
  }
  return { text, model, usage: { inputTokens, outputTokens, estimated: false } };
}
