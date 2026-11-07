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

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Small models shown a JSON Schema often answer in the shape of the schema, with
 * correct values one level down: {"$schema":..., "type":"object", "properties":
 * {"headline":"Real copy", ...}, "required":[...]}. Nothing is wrong with the
 * values, but validating that object reports every field as undefined. Same for
 * {"ad_copy":{...}}, where the object is wrapped in its own name.
 *
 * Only unwraps when the top level has none of the schema's fields and the inner
 * object has at least one, so a schema with a field really called `properties`
 * is left alone.
 */
export function unwrapEcho(value, jsonSchema, name) {
  const keys = Object.keys(jsonSchema?.properties ?? {});
  if (!keys.length || !isObject(value) || keys.some((k) => k in value)) return value;
  const entries = Object.values(value);
  const candidates = [value.properties, name ? value[name] : undefined, entries.length === 1 ? entries[0] : undefined];
  return candidates.find((c) => isObject(c) && keys.some((k) => k in c)) ?? value;
}

export function jsonInstructions(name, jsonSchema) {
  // The meta keys add nothing to the answer and are what start a model copying
  // the schema instead of filling it in.
  const { $schema, $id, ...shape } = jsonSchema ?? {};
  return [
    `Return only one JSON object${name ? ` (${name})` : ''}. No Markdown, no code fences, no commentary.`,
    ...(jsonSchema
      ? [
          'It must match this JSON schema:',
          JSON.stringify(shape),
          'The schema describes your answer, it is not part of it. Put each value at the top level of the object, and never write the words "type", "properties" or "required" as keys.',
        ]
      : []),
  ].join('\n');
}
