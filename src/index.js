/**
 * @profullstack/ai-providers
 *
 * One way for every Profullstack app to call a text model:
 * c0mpute first, always; OpenAI and Anthropic only as fallbacks, alternating
 * so neither bill takes all the overflow; dead keys parked instead of retried.
 */
import { C0mputeProvider } from './c0mpute.js';
import { OpenAIProvider, AnthropicProvider } from './paid.js';
import { AiRouter } from './router.js';

export * from './errors.js';
export * from './c0mpute.js';
export * from './paid.js';
export * from './router.js';
export * from './json.js';

const OFF = /^(0|off|false|no|none|disabled?)$/i;
const list = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

/**
 * Builds the router from the environment.
 *
 *   C0MPUTE_API_KEY      Infernet account key (ik_live_...), billed per job. No
 *                        key, or an ifc_ key with no subject, gets 10 free
 *                        queries a day.
 *   C0MPUTE_URL          default https://infernetprotocol.com
 *   C0MPUTE_MODELS       comma list, tried in order (C0MPUTE_MODEL also read)
 *   C0MPUTE_ANY_MODEL    1 to let any free node answer as a last resort
 *   C0MPUTE_CONCURRENCY  jobs in flight per process, default 2
 *   C0MPUTE_TIMEOUT_MS   whole job, default 300000
 *   C0MPUTE_STALL_MS     give up on a model whose job streams nothing this long, default 90000
 *   C0MPUTE_DISABLED     1 to skip c0mpute
 *   OPENAI_API_KEY, AI_OPENAI_MODEL
 *   ANTHROPIC_API_KEY, AI_ANTHROPIC_MODEL
 *   AI_PAID_FALLBACK     0/off to never fall back to a paid provider
 *
 * @param {object} [opts]
 * @param {Record<string, string|undefined>} [opts.env]
 * @param {object} [opts.c0mpute]   overrides for C0mputeProvider
 * @param {object} [opts.openai]    overrides for OpenAIProvider
 * @param {object} [opts.anthropic] overrides for AnthropicProvider
 * @param {boolean} [opts.paidFallback]
 * @param {object} [opts.router]    overrides for AiRouter
 */
export function createAiProviders(opts = {}) {
  const env = opts.env ?? (typeof process !== 'undefined' ? process.env : {});
  const primary = [];
  const fallback = [];

  if (!/^(1|true|yes|on)$/i.test(env.C0MPUTE_DISABLED ?? '')) {
    const models = list(env.C0MPUTE_MODELS || env.C0MPUTE_MODEL);
    primary.push(
      new C0mputeProvider({
        apiKey: env.C0MPUTE_API_KEY || env.INFERNET_API_KEY,
        baseUrl: env.C0MPUTE_URL,
        ...(models.length ? { models } : {}),
        anyModel: /^(1|true|yes)$/i.test(env.C0MPUTE_ANY_MODEL ?? ''),
        concurrency: num(env.C0MPUTE_CONCURRENCY),
        timeoutMs: num(env.C0MPUTE_TIMEOUT_MS),
        stallMs: num(env.C0MPUTE_STALL_MS),
        ...opts.c0mpute,
      }),
    );
  }

  const paid = opts.paidFallback ?? !OFF.test(env.AI_PAID_FALLBACK ?? '');
  if (paid) {
    const openaiKey = opts.openai?.apiKey ?? env.OPENAI_API_KEY;
    if (openaiKey) {
      fallback.push(
        new OpenAIProvider({ model: env.AI_OPENAI_MODEL, ...opts.openai, apiKey: openaiKey }),
      );
    }
    const anthropicKey = opts.anthropic?.apiKey ?? env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      fallback.push(
        new AnthropicProvider({ model: env.AI_ANTHROPIC_MODEL, ...opts.anthropic, apiKey: anthropicKey }),
      );
    }
  }

  return new AiRouter({ ...opts.router, primary, fallback });
}

let shared;
/** One router per process, so the breaker and rotation see every call. */
export function getAi() {
  shared ??= createAiProviders();
  return shared;
}

/** Shorthand for getAi().generateText(req). */
export const generateText = (req) => getAi().generateText(req);
/** Shorthand for getAi().generateObject(req). */
export const generateObject = (req) => getAi().generateObject(req);
