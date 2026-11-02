/**
 * c0mpute: inference on the peer network, through Infernet's chat API.
 *
 *   POST /api/chat {messages, maxTokens, temperature, modelName?, p2p_only}
 *     -> {jobId, source, model}
 *   GET  /api/chat/stream/<jobId>   server-sent events: meta, token..., done | error
 *
 * Without a key the public playground allows 20 requests an hour per IP. A
 * trusted-client key (`ifc_...`, one per app) has its own budget.
 *
 * `p2p_only` (default on) stops Infernet handing the job to its billed hosted
 * fallback; an answer from anything but a peer node is refused.
 *
 * Models are tried in order. A small model on a free node writes junk JSON,
 * so "any node" is off unless `anyModel` is set.
 */
import { ProviderError, toProviderError } from './errors.js';

export const DEFAULT_C0MPUTE_URL = 'https://infernetprotocol.com';
export const DEFAULT_C0MPUTE_MODELS = [
  // House models: every Infernet node pulls these (infernetprotocol.com/house-models.json).
  'huihui_ai/qwen3.5-abliterated:9b',
  'qwen2.5:7b',
  'qwen3:4b',
  'gemma3:4b',
  'huihui_ai/qwen3.5-abliterated:4b',
];

export class C0mputeProvider {
  /**
   * @param {object} [opts]
   * @param {string} [opts.apiKey]
   * @param {string} [opts.baseUrl]
   * @param {string[]} [opts.models]
   * @param {boolean} [opts.anyModel]
   * @param {boolean} [opts.p2pOnly]
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.concurrency]
   * @param {number} [opts.stallMs]
   * @param {typeof fetch} [opts.fetch]
   */
  constructor(opts = {}) {
    this.name = 'c0mpute';
    this.apiKey = opts.apiKey?.trim() || undefined;
    this.baseUrl = (opts.baseUrl || DEFAULT_C0MPUTE_URL).replace(/\/+$/, '');
    this.models = opts.models?.length ? [...opts.models] : [...DEFAULT_C0MPUTE_MODELS];
    this.anyModel = opts.anyModel ?? false;
    this.p2pOnly = opts.p2pOnly ?? true;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    // A job a node accepted but never answers: give up on that model after
    // this long with no stream event and try the next one.
    this.stallMs = opts.stallMs ?? 90_000;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.slots = new Semaphore(opts.concurrency ?? 2);
  }

  /** @param {import('../index.js').TextRequest} req */
  async generate(req) {
    const release = await this.slots.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? this.timeoutMs);
    const onAbort = () => controller.abort();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const messages = toMessages(req);
      const candidates = [...(req.models?.c0mpute ? [req.models.c0mpute] : []), ...this.models];
      const order = [...new Set(candidates)];
      if (this.anyModel) order.push(undefined);

      let last;
      for (const model of order) {
        const res = await this.fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            messages,
            maxTokens: req.maxTokens ?? 1024,
            temperature: req.temperature ?? 0.4,
            ...(this.p2pOnly ? { p2p_only: true } : {}),
            ...(model ? { modelName: model } : {}),
          }),
          signal: controller.signal,
        });
        const job = await res.json().catch(() => ({}));
        if (res.status === 503) {
          // No live node serves this model right now: next model.
          last = new ProviderError('c0mpute', `${model ?? 'any'}: ${job.error ?? 'no node'}`, {
            status: 503,
            kind: 'capacity',
          });
          continue;
        }
        if (!res.ok || !job.jobId) {
          throw new ProviderError('c0mpute', job.error ?? `no job was created (${res.status})`, {
            status: res.status,
          });
        }
        if (this.p2pOnly && job.source && job.source !== 'p2p') {
          throw new ProviderError('c0mpute', `no peer node took the job (source ${job.source})`, {
            status: 503,
            kind: 'capacity',
          });
        }
        const attempt = new AbortController();
        const stop = () => attempt.abort();
        controller.signal.addEventListener('abort', stop, { once: true });
        let stalled = false;
        let stall;
        const arm = () => {
          clearTimeout(stall);
          stall = setTimeout(() => {
            stalled = true;
            attempt.abort();
          }, this.stallMs);
        };
        let out;
        try {
          arm();
          const stream = await this.fetch(`${this.baseUrl}/api/chat/stream/${job.jobId}`, {
            headers: {
              accept: 'text/event-stream',
              ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
            },
            signal: attempt.signal,
          });
          if (!stream.ok || !stream.body) {
            throw new ProviderError('c0mpute', `could not read the job stream (${stream.status})`, {
              status: stream.status || 502,
              kind: 'capacity',
            });
          }
          out = await readStream(stream.body, arm);
        } catch (err) {
          if (!stalled) throw err;
          last = new ProviderError(
            'c0mpute',
            `${model ?? 'any'}: no answer for ${Math.round(this.stallMs / 1000)}s (job ${job.jobId})`,
            { status: 504, kind: 'capacity' },
          );
          continue;
        } finally {
          clearTimeout(stall);
          controller.signal.removeEventListener('abort', stop);
        }
        const prompt = messages.reduce((n, m) => n + m.content.length, 0);
        return {
          text: out.text,
          model: out.model ?? job.model ?? model ?? 'p2p',
          usage: {
            inputTokens: Math.ceil(prompt / 4),
            outputTokens: Math.ceil(out.text.length / 4),
            estimated: true,
          },
        };
      }
      throw last ?? new ProviderError('c0mpute', 'no model configured', { kind: 'invalid' });
    } catch (err) {
      throw toProviderError('c0mpute', err);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
      release();
    }
  }
}

export function toMessages(req) {
  if (req.messages?.length) {
    const sys = req.system ? [{ role: 'system', content: req.system }] : [];
    return [...sys, ...req.messages];
  }
  return [
    ...(req.system ? [{ role: 'system', content: req.system }] : []),
    { role: 'user', content: req.user ?? '' },
  ];
}

/** Reads `meta`, `token` and `done` events until `done` or `error`. */
export async function readStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let model;
  for (;;) {
    const { value, done } = await reader.read();
    if (value?.length) onEvent?.();
    if (value) buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
      const raw = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!event || !raw) continue;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      if (event === 'meta' && typeof data.model === 'string') model = data.model;
      else if (event === 'token' && typeof data.text === 'string') text += data.text;
      else if (event === 'done') {
        await reader.cancel().catch(() => {});
        return { text: typeof data.text === 'string' && data.text ? data.text : text, model };
      } else if (event === 'error') {
        await reader.cancel().catch(() => {});
        throw new ProviderError('c0mpute', String(data.message ?? data.error ?? 'job failed'), {
          status: 502,
          kind: 'capacity',
        });
      }
    }
    if (done) break;
  }
  // No done event: the node or the connection died mid-answer.
  throw new ProviderError(
    'c0mpute',
    text ? 'the stream ended before the answer finished' : 'the stream ended without an answer',
    { status: 502, kind: 'capacity' },
  );
}

class Semaphore {
  constructor(n) {
    this.free = Math.max(1, n);
    this.waiting = [];
  }
  acquire() {
    if (this.free > 0) {
      this.free--;
      return Promise.resolve(() => this.#release());
    }
    return new Promise((resolve) => this.waiting.push(() => resolve(() => this.#release())));
  }
  #release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.free++;
  }
}
