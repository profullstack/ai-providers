/**
 * Server-sent events from a fetch body, one `{event, data}` per block.
 * Shared by c0mpute's job stream and the paid providers' streaming APIs.
 * Leaving the loop early (return/throw) cancels the body.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {() => void} [onChunk] called for every non-empty chunk read
 */
export async function* sseEvents(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value?.length) onChunk?.();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) buffer += '\n\n';
      buffer = buffer.replace(/\r\n/g, '\n');
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        if (!block.trim()) continue;
        const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        yield { event, data };
      }
      if (done) {
        finished = true;
        return;
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
  }
}
