import type { Context, Hono } from 'hono';
import type { ArtificerChannel } from '../api/types.js';
import type { Engine } from '../engine/engine.js';

async function handleChannelPayload(
  c: Context,
  channel: ArtificerChannel,
  payload: Record<string, unknown>,
  engine: Engine,
) {
  const message = await channel.receive(payload);

  if (message.metadata?._challenge) {
    return c.json({ challenge: message.metadata._challenge });
  }
  if (message.metadata?._ping) {
    const formatted = await channel.format({
      content: message.content,
      metadata: message.metadata,
    });
    return c.json(formatted);
  }
  if (message.metadata?._skip) {
    return c.json({ ok: true });
  }

  const channelContext =
    message.metadata && typeof message.metadata.channel === 'string'
      ? {
          name: message.metadata.channel,
          metadata: message.metadata,
          includeFullReceipt: Boolean(message.metadata.includeFullReceipt),
          originContent:
            typeof message.metadata.originContent === 'string'
              ? message.metadata.originContent
              : message.content,
        }
      : undefined;

  if (message.metadata?._async) {
    void engine.receiveMessage(message.content, channelContext);
    const formatted = await channel.format({
      content: '',
      metadata: message.metadata,
    });
    return c.json(formatted);
  }

  const result = await engine.receiveMessage(message.content, channelContext);
  const formatted = await channel.format({
    content: result.content ?? '',
    metadata: message.metadata,
  });
  return c.json(formatted);
}

export function mountChannels(
  app: Hono,
  channels: ArtificerChannel[],
  engine: Engine,
): void {
  for (const channel of channels) {
    app.post(`/channels/${channel.name}`, async (c) => {
      if (channel.definition.verify) {
        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const body = await c.req.text();
        const valid = await channel.definition.verify(headers, body);
        if (!valid) {
          return c.json({ error: 'Verification failed' }, 401);
        }

        const payload = JSON.parse(body) as Record<string, unknown>;
        return handleChannelPayload(c, channel, payload, engine);
      }

      const payload = await c.req.json<Record<string, unknown>>();
      return handleChannelPayload(c, channel, payload, engine);
    });
  }
}
