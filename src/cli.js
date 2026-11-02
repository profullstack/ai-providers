#!/usr/bin/env node
/**
 * ai-providers status            which providers are configured, in call order
 * ai-providers ask "prompt"      one call through the router; prints who answered
 * ai-providers ask --json "..."  same, asking for a JSON object
 */
import { createAiProviders } from './index.js';

const [cmd, ...rest] = process.argv.slice(2);
const ai = createAiProviders();

if (cmd === 'status' || !cmd) {
  const { order } = ai.plan();
  console.log(JSON.stringify({ order: order.map((p) => p.name), providers: ai.status() }, null, 2));
} else if (cmd === 'ask') {
  const json = rest[0] === '--json';
  const prompt = (json ? rest.slice(1) : rest).join(' ');
  if (!prompt) {
    console.error('usage: ai-providers ask [--json] "prompt"');
    process.exit(2);
  }
  try {
    const r = json
      ? await ai.generateObject({ user: prompt, maxTokens: 800 })
      : await ai.generateText({ user: prompt, maxTokens: 800 });
    console.error(`# ${r.provider} ${r.model} in=${r.usage.inputTokens} out=${r.usage.outputTokens}`);
    for (const a of r.attempts) console.error(`# skipped: ${a.error.message}`);
    console.log(json ? JSON.stringify(r.object, null, 2) : r.text);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
} else {
  console.error('usage: ai-providers status | ask [--json] "prompt"');
  process.exit(2);
}
