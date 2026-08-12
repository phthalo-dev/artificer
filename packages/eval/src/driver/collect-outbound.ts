import { subscribeEvents } from './events.js';

export interface OutboundMessageCollector {
  messages: string[];
  stop: () => Promise<void>;
}

/**
 * Starts an SSE subscription and collects outbound message content until
 * stopped. Resolves only after the subscription attempt is ready, so callers
 * can safely submit the inbound message without racing the event stream.
 */
export async function collectOutboundMessages(
  baseUrl: string,
): Promise<OutboundMessageCollector> {
  const controller = new AbortController();
  const messages: string[] = [];
  let markReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const completed = subscribeEvents(
    baseUrl,
    (event) => {
      if (
        event.kind === 'message' &&
        event.data?.direction === 'outbound' &&
        typeof event.data.content === 'string'
      ) {
        messages.push(event.data.content);
      }
    },
    controller.signal,
    () => markReady?.(),
  );

  await ready;

  return {
    messages,
    stop: async () => {
      controller.abort();
      await completed;
    },
  };
}
