/**
 * Minimal Server-Sent Events consumer for the runtime's /events stream.
 *
 * The runtime emits one SSE per engine event: the SSE `event:` field is the
 * event kind and `data:` is the JSON envelope `{ kind, at, data }`. A periodic
 * `ping` event (data = a timestamp string) is filtered out.
 */

export interface RuntimeEvent {
  kind: 'message' | 'workstream' | 'run' | 'tool';
  at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

/**
 * Connects to the runtime's event stream and invokes `onEvent` for each engine
 * event until `signal` aborts. Resolves when the stream ends or is aborted;
 * never throws for an expected abort.
 */
export async function subscribeEvents(
  baseUrl: string,
  onEvent: (event: RuntimeEvent) => void,
  signal: AbortSignal,
  onReady?: () => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/events`, {
      signal,
      headers: { accept: 'text/event-stream' },
    });
  } catch {
    onReady?.();
    return; // connection failed (e.g. already aborted); progress is best-effort
  }
  if (!res.body) {
    onReady?.();
    return;
  }

  onReady?.();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      // SSE messages are separated by a blank line.
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        dispatch(block, onEvent);
      }
    }
  } catch {
    // Aborted or stream error: stop quietly.
  } finally {
    reader.cancel().catch(() => {});
  }
}

function dispatch(block: string, onEvent: (event: RuntimeEvent) => void): void {
  let eventName = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (eventName === 'ping' || !data) return;
  try {
    const envelope = JSON.parse(data) as RuntimeEvent;
    if (envelope && envelope.kind) onEvent(envelope);
  } catch {
    // Ignore malformed frames.
  }
}
