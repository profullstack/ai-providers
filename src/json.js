/**
 * Getting JSON out of a model that was asked for JSON.
 *
 * Small open models wrap it in fences, add a sentence before it, or think out
 * loud in <think> tags first. This takes the first complete top-level JSON
 * object or array in the text.
 */
export function extractJson(text) {
  if (typeof text !== 'string') throw new Error('no text');
  let s = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {}
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in the answer');
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error('the JSON in the answer is incomplete');
}

/**
 * Validates with whatever the caller passed: a zod schema (safeParse/parse),
 * a plain function that returns the value or throws, or nothing.
 */
export function validate(schema, value) {
  if (!schema) return value;
  if (typeof schema.safeParse === 'function') {
    const r = schema.safeParse(value);
    if (r.success) return r.data;
    const issues = (r.error?.issues ?? [])
      .slice(0, 8)
      .map((i) => `${(i.path ?? []).join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`does not match the schema: ${issues || r.error?.message || 'invalid'}`);
  }
  if (typeof schema.parse === 'function') return schema.parse(value);
  if (typeof schema === 'function') return schema(value);
  return value;
}

export function jsonInstructions(name, jsonSchema) {
  return [
    `Return only one JSON object${name ? ` (${name})` : ''}. No Markdown, no code fences, no commentary.`,
    ...(jsonSchema ? ['It must match this JSON schema:', JSON.stringify(jsonSchema)] : []),
  ].join('\n');
}
