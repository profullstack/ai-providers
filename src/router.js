/**
 * The order every call takes:
 *
 *   1. primary providers in order (c0mpute)
 *   2. fallback providers, rotated one step per call so the paid ones share
 *      the load evenly: call 1 tries openai then anthropic, call 2 tries
 *      anthropic then openai, and so on
 *
 * A provider that fails is parked so the next calls do not pay its latency:
 *   billing  (no credits, bad key)      parked `billingMs`, default 1 hour
 *   capacity (429, 5xx, no node, timeout) parked 30 s, doubling to 10 min
 *   invalid / output                     not parked
 * A success clears it.
 */
import { ProviderError, toProviderError } from './errors.js';
import { extractJson, validate, jsonInstructions, unwrapEcho } from './json.js';

export class AllProvidersFailedError extends Error {
  constructor(attempts, skipped = []) {
    const parts = attempts.map((a) => a.error.message);
    for (const s of skipped) parts.push(`${s.name}: parked ${Math.ceil(s.waitMs / 1000)}s after ${s.reason}`);
    super(`AI generation failed (${parts.join('; ') || 'no provider configured'})`);
    this.name = 'AllProvidersFailedError';
    this.attempts = attempts;
    this.skipped = skipped;
  }
}

export class AiRouter {
  /**
   * @param {object} opts
   * @param {Array<{name:string, generate?:Function}>} [opts.primary]
   * @param {Array<{name:string, generate?:Function}>} [opts.fallback]
   * @param {boolean} [opts.rotate]
   * @param {number} [opts.billingMs]
   * @param {number} [opts.capacityMs]
   * @param {number} [opts.capacityMaxMs]
   * @param {(e: object) => void} [opts.onAttempt]
   * @param {() => number} [opts.now]
   */
  constructor(opts = {}) {
    this.primary = opts.primary ?? [];
    this.fallback = opts.fallback ?? [];
    this.rotate = opts.rotate ?? true;
    this.billingMs = opts.billingMs ?? 60 * 60_000;
    this.capacityMs = opts.capacityMs ?? 30_000;
    this.capacityMaxMs = opts.capacityMaxMs ?? 10 * 60_000;
    this.onAttempt = opts.onAttempt;
    this.now = opts.now ?? Date.now;
    this.turn = 0;
    /** @type {Map<string, {until:number, strikes:number, reason:string}>} */
    this.parked = new Map();
  }

  get providers() {
    return [...this.primary, ...this.fallback];
  }

  /** The providers the next call would try, in order, and the ones skipped. */
  plan() {
    const n = this.fallback.length;
    const shift = this.rotate && n > 1 ? this.turn % n : 0;
    const rotated = [...this.fallback.slice(shift), ...this.fallback.slice(0, shift)];
    const now = this.now();
    const order = [];
    const skipped = [];
    for (const p of [...this.primary, ...rotated]) {
      const park = this.parked.get(p.name);
      if (park && park.until > now) skipped.push({ name: p.name, waitMs: park.until - now, reason: park.reason });
      else order.push(p);
    }
    return { order, skipped };
  }

  status() {
    const now = this.now();
    return this.providers.map((p) => {
      const park = this.parked.get(p.name);
      const active = park && park.until > now;
      return {
        name: p.name,
        tier: this.primary.includes(p) ? 'primary' : 'fallback',
        available: !active,
        ...(active ? { parkedForMs: park.until - now, reason: park.reason } : {}),
      };
    });
  }

  #fail(name, err) {
    if (err.kind !== 'billing' && err.kind !== 'capacity') return;
    const prev = this.parked.get(name);
    const strikes = (prev?.strikes ?? 0) + 1;
    const ms =
      err.kind === 'billing'
        ? this.billingMs
        : Math.min(this.capacityMaxMs, this.capacityMs * 2 ** (strikes - 1));
    this.parked.set(name, { until: this.now() + ms, strikes, reason: err.kind });
  }

  /**
   * Runs `task(provider)` on each provider in order until one returns.
   * The building block: generateText/generateObject use it, and an app with
   * its own provider code (structured outputs, prompt caching) can too.
   *
   * @template T
   * @param {(provider: any) => Promise<T>} task
   * @param {{ feature?: string, only?: string[], final?: () => boolean }} [opts]
   *   `final`, checked after a failure: true stops here instead of moving on
   *   (streamText sets it once text has gone out).
   * @returns {Promise<{ provider: string, value: T, attempts: object[] }>}
   */
  async run(task, opts = {}) {
    const { order, skipped } = this.plan();
    this.turn++;
    const attempts = [];
    for (const provider of order) {
      if (opts.only && !opts.only.includes(provider.name)) continue;
      const started = this.now();
      try {
        const value = await task(provider);
        this.parked.delete(provider.name);
        this.onAttempt?.({ provider: provider.name, feature: opts.feature, ok: true, ms: this.now() - started });
        return { provider: provider.name, value, attempts };
      } catch (raw) {
        const error = toProviderError(provider.name, raw);
        this.#fail(provider.name, error);
        attempts.push({ provider: provider.name, error });
        this.onAttempt?.({
          provider: provider.name,
          feature: opts.feature,
          ok: false,
          ms: this.now() - started,
          kind: error.kind,
          error: error.message,
        });
        if (opts.final?.()) {
          const err = new AllProvidersFailedError(attempts, skipped);
          err.partial = true;
          throw err;
        }
      }
    }
    throw new AllProvidersFailedError(attempts, skipped);
  }

  /**
   * @param {import('../index.js').TextRequest} req
   */
  async generateText(req) {
    const { provider, value, attempts } = await this.run(async (p) => {
      const out = await p.generate(req);
      if (!out.text?.trim()) throw new ProviderError(p.name, 'empty answer', { kind: 'output' });
      return out;
    }, req);
    return { ...value, provider, attempts };
  }

  /**
   * Streams text: `req.onToken` gets each piece as it arrives, and the promise
   * resolves to the same result generateText returns. Providers are tried in
   * the usual order, but only until one has streamed something: after the
   * first token a failure is final (`error.partial === true`), since the
   * caller has already shown that text. A provider with no `stream` method is
   * called with `generate` and its whole answer sent as one token.
   *
   * @param {import('../index.js').StreamRequest} req
   */
  async streamText(req) {
    let emitted = false;
    const send = (t) => {
      if (!t) return;
      emitted = true;
      req.onToken?.(t);
    };
    const { provider, value, attempts } = await this.run(
      async (p) => {
        const out =
          typeof p.stream === 'function'
            ? await p.stream(req, send)
            : await p.generate(req).then((o) => {
                if (o.text?.trim()) send(o.text);
                return o;
              });
        if (!out.text?.trim()) throw new ProviderError(p.name, 'empty answer', { kind: 'output' });
        return out;
      },
      { feature: req.feature, only: req.only, final: () => emitted },
    );
    return { ...value, provider, attempts };
  }

  /**
   * Asks for JSON, extracts it, validates it against `schema`. An unusable
   * answer gets one repair attempt on the same provider before moving on.
   *
   * @param {import('../index.js').ObjectRequest} req
   */
  async generateObject(req) {
    const { provider, value, attempts } = await this.run((p) => generateObjectOn(p, req), req);
    return { ...value, provider, attempts };
  }
}

export async function generateObjectOn(provider, req) {
  const system = [req.system, jsonInstructions(req.name, req.jsonSchema)].filter(Boolean).join('\n\n');
  const base = { ...req, system, json: true };
  const read = (text) => validate(req.schema, unwrapEcho(extractJson(text), req.jsonSchema, req.name));
  let out = await provider.generate(base);
  let object;
  try {
    object = read(out.text);
  } catch (first) {
    const repairs = req.repairs ?? 1;
    if (repairs < 1) throw new ProviderError(provider.name, first.message, { kind: 'output' });
    const user = req.user ?? req.messages?.at(-1)?.content ?? '';
    out = await provider.generate({
      ...base,
      messages: undefined,
      user: [
        user,
        '',
        'Your previous answer could not be used:',
        first.message,
        '',
        'Previous answer:',
        String(out.text).slice(0, 4000),
        '',
        'Answer again with only the corrected JSON object.',
      ].join('\n'),
    });
    try {
      object = read(out.text);
    } catch (second) {
      throw new ProviderError(provider.name, second.message, { kind: 'output' });
    }
  }
  return { object, text: out.text, model: out.model, usage: out.usage };
}
