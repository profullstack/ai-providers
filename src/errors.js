/**
 * One error type for every provider, carrying what the router needs to decide
 * how long to leave a provider alone.
 *
 * kind:
 *   billing   - out of credits, bad or revoked key. Nothing fixes it but a
 *               person, so the provider is parked for a long time.
 *   capacity  - rate limit, no node free, 5xx, timeout. Try again soon.
 *   invalid   - the request itself was wrong (400). Another provider might
 *               accept it, but this one should not be parked for it.
 *   output    - the provider answered but the answer was unusable (empty,
 *               not JSON, failed the schema).
 */
export class ProviderError extends Error {
  /**
   * @param {string} provider
   * @param {string} message
   * @param {{ status?: number, kind?: 'billing'|'capacity'|'invalid'|'output' }} [opts]
   */
  constructor(provider, message, opts = {}) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = opts.status ?? 0;
    this.kind = opts.kind ?? classify(this.status, message);
  }
}

const BILLING_TEXT =
  /credit|billing|quota|insufficient|balance|payment|exceeded your current|no credits|plan/i;

/** Maps an HTTP status and message to a failure kind. */
export function classify(status, message = '') {
  if (status === 401 || status === 402 || status === 403) return 'billing';
  if (status === 429) return BILLING_TEXT.test(message) ? 'billing' : 'capacity';
  if (status === 400 && BILLING_TEXT.test(message) && /credit|balance|billing/i.test(message)) {
    // Anthropic reports an empty balance as a 400 invalid_request_error.
    return 'billing';
  }
  if (status >= 400 && status < 500) return 'invalid';
  return 'capacity';
}

/** Wraps anything thrown by a provider call into a ProviderError. */
export function toProviderError(provider, err) {
  if (err instanceof ProviderError) return err;
  const status = Number(err?.status ?? err?.statusCode ?? 0) || 0;
  const message = err instanceof Error ? err.message : String(err);
  const kind = err?.name === 'AbortError' || err?.name === 'TimeoutError' ? 'capacity' : undefined;
  return new ProviderError(provider, message, { status, ...(kind ? { kind } : {}) });
}
