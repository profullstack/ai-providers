export type ProviderName = 'c0mpute' | 'openai' | 'anthropic' | (string & {});
export type FailureKind = 'billing' | 'capacity' | 'invalid' | 'output';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TextRequest {
  system?: string;
  /** Single user turn. Ignored when `messages` is set. */
  user?: string;
  messages?: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask for a JSON object (OpenAI json_object mode; the others are told so). */
  json?: boolean;
  /** Per-provider model override for this call. */
  models?: { c0mpute?: string; openai?: string; anthropic?: string };
  /** Label passed to onAttempt, for spend and failure logs. */
  feature?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** true when counted as characters / 4 (c0mpute reports no token counts). */
  estimated: boolean;
}

export interface ProviderOutput {
  text: string;
  model: string;
  usage: Usage;
}

export interface TextProvider {
  readonly name: ProviderName;
  generate(req: TextRequest): Promise<ProviderOutput>;
}

export interface Attempt {
  provider: string;
  error: ProviderError;
}

export interface TextResult extends ProviderOutput {
  provider: ProviderName;
  attempts: Attempt[];
}

/** Anything with safeParse (zod), parse, or a plain function. */
export type SchemaLike<T> =
  | { safeParse(v: unknown): { success: true; data: T } | { success: false; error: any } }
  | { parse(v: unknown): T }
  | ((v: unknown) => T);

export interface ObjectRequest<T = unknown> extends TextRequest {
  schema?: SchemaLike<T>;
  /** Shown to the model. With zod 4: z.toJSONSchema(schema). */
  jsonSchema?: Record<string, unknown>;
  name?: string;
  /** Repair attempts per provider after an unusable answer. Default 1. */
  repairs?: number;
}

export interface ObjectResult<T> {
  object: T;
  text: string;
  model: string;
  usage: Usage;
  provider: ProviderName;
  attempts: Attempt[];
}

export interface AttemptEvent {
  provider: string;
  feature?: string;
  ok: boolean;
  ms: number;
  kind?: FailureKind;
  error?: string;
}

export interface RouterOptions {
  primary?: TextProvider[];
  fallback?: TextProvider[];
  /** Alternate the fallback order every call. Default true. */
  rotate?: boolean;
  billingMs?: number;
  capacityMs?: number;
  capacityMaxMs?: number;
  onAttempt?: (e: AttemptEvent) => void;
  now?: () => number;
}

export interface ProviderStatus {
  name: string;
  tier: 'primary' | 'fallback';
  available: boolean;
  parkedForMs?: number;
  reason?: FailureKind;
}

export declare class AiRouter {
  constructor(opts?: RouterOptions);
  readonly primary: TextProvider[];
  readonly fallback: TextProvider[];
  readonly providers: TextProvider[];
  plan(): { order: TextProvider[]; skipped: { name: string; waitMs: number; reason: string }[] };
  status(): ProviderStatus[];
  run<T, P extends { name: string } = TextProvider>(
    task: (provider: P) => Promise<T>,
    opts?: { feature?: string; only?: string[] },
  ): Promise<{ provider: ProviderName; value: T; attempts: Attempt[] }>;
  generateText(req: TextRequest): Promise<TextResult>;
  generateObject<T = unknown>(req: ObjectRequest<T>): Promise<ObjectResult<T>>;
}

export declare function generateObjectOn<T = unknown>(
  provider: TextProvider,
  req: ObjectRequest<T>,
): Promise<{ object: T; text: string; model: string; usage: Usage }>;

export declare class ProviderError extends Error {
  constructor(provider: string, message: string, opts?: { status?: number; kind?: FailureKind });
  readonly provider: string;
  readonly status: number;
  readonly kind: FailureKind;
}
export declare class AllProvidersFailedError extends Error {
  readonly attempts: Attempt[];
  readonly skipped: { name: string; waitMs: number; reason: string }[];
}
export declare function classify(status: number, message?: string): FailureKind;
export declare function toProviderError(provider: string, err: unknown): ProviderError;

export interface C0mputeOptions {
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  anyModel?: boolean;
  p2pOnly?: boolean;
  timeoutMs?: number;
  concurrency?: number;
  /** No stream event for this long: try the next model. Default 90000. */
  stallMs?: number;
  fetch?: typeof fetch;
}
export declare const DEFAULT_C0MPUTE_URL: string;
export declare const DEFAULT_C0MPUTE_MODELS: string[];
export declare class C0mputeProvider implements TextProvider {
  constructor(opts?: C0mputeOptions);
  readonly name: 'c0mpute';
  generate(req: TextRequest): Promise<ProviderOutput>;
}

export interface PaidOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export declare const DEFAULT_OPENAI_MODEL: string;
export declare const DEFAULT_ANTHROPIC_MODEL: string;
export declare class OpenAIProvider implements TextProvider {
  constructor(opts?: PaidOptions);
  readonly name: 'openai';
  generate(req: TextRequest): Promise<ProviderOutput>;
}
export declare class AnthropicProvider implements TextProvider {
  constructor(opts?: PaidOptions);
  readonly name: 'anthropic';
  generate(req: TextRequest): Promise<ProviderOutput>;
}

export declare function extractJson(text: string): unknown;
export declare function validate<T>(schema: SchemaLike<T> | undefined, value: unknown): T;
export declare function unwrapEcho(value: unknown, jsonSchema?: Record<string, unknown>, name?: string): unknown;
export declare function jsonInstructions(name?: string, jsonSchema?: Record<string, unknown>): string;

export interface CreateOptions {
  env?: Record<string, string | undefined>;
  c0mpute?: C0mputeOptions;
  openai?: PaidOptions;
  anthropic?: PaidOptions;
  paidFallback?: boolean;
  router?: Omit<RouterOptions, 'primary' | 'fallback'>;
}
export declare function createAiProviders(opts?: CreateOptions): AiRouter;
export declare function getAi(): AiRouter;
export declare function generateText(req: TextRequest): Promise<TextResult>;
export declare function generateObject<T = unknown>(req: ObjectRequest<T>): Promise<ObjectResult<T>>;
